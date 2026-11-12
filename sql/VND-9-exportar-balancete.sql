-- =====================================================================
-- VND-9 — janela de leitura das notas de saída para o Balancete P&F
-- (PLANO-VENDAS.md §20). Ordem do Pedro em 12/11/2026 (etapa H2 do desenho
-- "Notas fiscais do Hub no Balancete, sem carga manual").
-- Só ACRESCENTA: log de exportação, 2 funções SÓ DE LEITURA usadas pela Edge
-- exportar-notas-balancete (service_role) e a chave de desligar.
-- Rollback: sql/VND-9-exportar-balancete-rollback.sql
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint falhou: este não parece o projeto hbtggrbauguukewiknew';
  end if;
  if to_regclass('public.nf_saida_serie_cadastro') is null then
    raise exception 'VND-8 não aplicado (nf_saida_serie_cadastro não existe)';
  end if;
  if to_regclass('public.nf_saida_exportacao_log') is not null then
    raise exception 'VND-9 já aplicado';
  end if;
end $$;

-- 1. Registro de cada chamada da janela (quem chamou é sempre o Balancete, pela chave).
create table public.nf_saida_exportacao_log (
  id     bigint generated always as identity primary key,
  quando timestamptz not null default now(),
  acao   text not null,
  mes    date,
  pagina integer,
  notas  integer,
  ms     integer,
  erro   text
);
alter table public.nf_saida_exportacao_log enable row level security;
create policy nf_saida_exportacao_log_admin_select on public.nf_saida_exportacao_log
  for select to authenticated using (_is_admin());
revoke all on public.nf_saida_exportacao_log from anon;
revoke insert, update, delete, truncate, references, trigger on public.nf_saida_exportacao_log from authenticated;

-- 2. Resumo por mês (emissão): o Balancete compara a impressão digital com a da última carga
--    e só busca o mês que mudou. Entram as notas de SAÍDA que ainda existem no Alvo.
create function public.balancete_exportar_resumo(p_meses integer default 13) returns jsonb
language sql stable security definer set search_path = public as $$
  with meses as (
    select generate_series(
             (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)
               - make_interval(months => greatest(1, least(coalesce(p_meses, 13), 24)) - 1))::date,
             date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date,
             interval '1 month')::date as mes
  ), notas as (
    select s.id, date_trunc('month', s.data_emissao)::date as mes, s.modelo, s.serie, s.numero_alvo,
           s.payload_hash, s.cancelada, s.detalhe_status, s.situacao_hub
      from nf_saida s
     where s.tipo_nota = 'Saída' and s.ausente_desde is null
       and s.data_emissao >= (select min(m.mes) from meses m)
  ), ser as (
    select n.mes, n.id, x.controle_num_serie, c.status, c.numero_serie
      from notas n
      join nf_saida_item_serie x on x.nf_saida_id = n.id
      left join nf_saida_serie_cadastro c on c.controle_num_serie = x.controle_num_serie
  ), por_nota as (
    select n.*,
           (select string_agg(z.controle_num_serie::text || ':' || coalesce(z.numero_serie, ''), ',' order by z.controle_num_serie)
              from ser z where z.id = n.id) as series_txt
      from notas n
  )
  select jsonb_build_object(
    'gerado_em', now(),
    'agendamento_ativo', (select j.active from cron.job j where j.jobname = 'sync-nf-saida-3x-dia'),
    'ultima_rodada', (select jsonb_build_object('inicio', r.started_at, 'fim', r.finished_at, 'erros', r.total_erros,
                                                'observacao', left(r.observacao, 300))
                        from sync_runs r where r.job_type = 'nf_saida' and r.finished_at is not null
                       order by r.started_at desc limit 1),
    -- rotina completa = lista dos últimos 45 dias chegou ao corte e não parou pelo tempo
    'ultima_rotina_completa', (select max(r.finished_at) from sync_runs r
                                where r.job_type = 'nf_saida' and r.observacao like '[rotina]%'
                                  and r.observacao not like '%LISTA INCOMPLETA%'
                                  and r.observacao not like '%PARADO PELO WATCHDOG%'),
    -- varredura completa = lista da madrugada que chegou ao corte de 13 meses
    'ultima_varredura_completa', (select max(r.finished_at) from sync_runs r
                                   where r.job_type = 'nf_saida' and r.observacao like '[lista]%'
                                     and r.observacao not like '%LISTA INCOMPLETA%'
                                     and r.observacao not like '%PARADO PELO WATCHDOG%'),
    'meses', coalesce((select jsonb_agg(jsonb_build_object(
        'mes', to_char(m.mes, 'YYYY-MM'),
        'notas', (select count(*) from notas n where n.mes = m.mes),
        'canceladas', (select count(*) from notas n where n.mes = m.mes and n.cancelada),
        'provisorias', (select count(*) from notas n where n.mes = m.mes and n.situacao_hub = 'provisoria'),
        'pendentes_detalhe', (select count(*) from notas n where n.mes = m.mes and n.detalhe_status <> 'carregado'),
        'series', (select count(*) from ser z where z.mes = m.mes),
        'series_sem_numero', (select count(*) from ser z where z.mes = m.mes and (z.status is null or z.status = 'erro')),
        'series_estacionadas', (select count(*) from ser z where z.mes = m.mes and z.status in ('estacionado', 'ausente')),
        'impressao_digital', (select md5(coalesce(string_agg(p.modelo || '|' || p.serie || '|' || p.numero_alvo || '|'
                                                             || coalesce(p.payload_hash, '') || '|' || coalesce(p.series_txt, ''),
                                                             ';' order by p.modelo, p.serie, p.numero_alvo), ''))
                                from por_nota p where p.mes = m.mes))
        order by m.mes) from meses m), '[]'::jsonb))
$$;

-- 3. Conteúdo de um mês, em páginas: a última versão de cada nota (o mesmo objeto do
--    notaFiscal/Load que os scripts do Balancete baixam) e o número impresso das séries.
create function public.balancete_exportar_mes(p_mes date, p_offset integer default 0, p_limite integer default 25)
returns jsonb
language sql stable security definer set search_path = public as $$
  with base as (
    select s.id, s.modelo, s.serie, s.numero_alvo
      from nf_saida s
     where s.tipo_nota = 'Saída' and s.ausente_desde is null
       and s.data_emissao >= date_trunc('month', p_mes)::date
       and s.data_emissao < (date_trunc('month', p_mes) + interval '1 month')::date
  ), pagina as (
    select b.* from base b
     order by b.modelo, b.serie, b.numero_alvo
     offset greatest(coalesce(p_offset, 0), 0)
     limit least(greatest(coalesce(p_limite, 25), 1), 50)
  ), versao as (
    select distinct on (v.nf_saida_id) v.nf_saida_id, v.payload_alvo
      from nf_saida_versao v
     where v.nf_saida_id in (select p.id from pagina p)
     order by v.nf_saida_id, v.versao desc
  )
  select jsonb_build_object(
    'mes', to_char(date_trunc('month', p_mes), 'YYYY-MM'),
    'total', (select count(*) from base),
    'na_pagina', (select count(*) from pagina),
    'sem_detalhe', coalesce((select jsonb_agg(p.modelo || ' ' || p.numero_alvo)
                               from pagina p where not exists (select 1 from versao v where v.nf_saida_id = p.id)), '[]'::jsonb),
    'loads', coalesce((select jsonb_object_agg(p.modelo || '|' || p.serie || '|' || p.numero_alvo, v.payload_alvo)
                         from pagina p join versao v on v.nf_saida_id = p.id), '{}'::jsonb),
    'series', coalesce((select jsonb_object_agg(c.controle_num_serie::text,
                                                jsonb_build_object('s', c.numero_serie, 'l', c.numero_ctrl_lote, 'p', c.codigo_produto))
                          from (select distinct x.controle_num_serie
                                  from nf_saida_item_serie x where x.nf_saida_id in (select p.id from pagina p)) k
                          join nf_saida_serie_cadastro c on c.controle_num_serie = k.controle_num_serie and c.status = 'ok'),
                       '{}'::jsonb))
$$;

revoke execute on function public.balancete_exportar_resumo(integer)               from public, anon, authenticated;
revoke execute on function public.balancete_exportar_mes(date, integer, integer)   from public, anon, authenticated;
grant  execute on function public.balancete_exportar_resumo(integer)               to service_role;
grant  execute on function public.balancete_exportar_mes(date, integer, integer)   to service_role;

-- 4. Chave de desligar da janela (enabled = false → a Edge responde 503 sem ler nada).
insert into public.sync_settings (job_name, enabled, schedule_cron)
values ('exportar-notas-balancete', true, 'sob demanda: o Balancete P&F busca a cada 30 minutos');
