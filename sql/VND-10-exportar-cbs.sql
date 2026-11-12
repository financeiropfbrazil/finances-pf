-- =====================================================================
-- VND-10 — janela de leitura das notas de saída para o Cockpit CBS
-- (PLANO-VENDAS.md §21). Ordem do Pedro em 12/11/2026.
-- Só ACRESCENTA: log próprio, 1 função SÓ DE LEITURA usada pela Edge
-- exportar-notas-cbs (service_role) e a chave de desligar.
-- Não altera nf_saida, o sync, a janela do Balancete (VND-9) nem telas.
-- Rollback: sql/VND-10-exportar-cbs-rollback.sql
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint falhou: este não parece o projeto hbtggrbauguukewiknew';
  end if;
  if to_regclass('public.nf_saida') is null then
    raise exception 'VND-3 não aplicado (nf_saida não existe)';
  end if;
  if to_regclass('public.cbs_exportacao_log') is not null then
    raise exception 'VND-10 já aplicado';
  end if;
end $$;

-- 1. Registro de cada chamada (quem chama é sempre o Cockpit CBS, pela chave).
create table public.cbs_exportacao_log (
  id      bigint generated always as identity primary key,
  quando  timestamptz not null default now(),
  desde   date,
  apos    text,
  notas   integer,
  total   integer,
  ms      integer,
  erro    text
);
alter table public.cbs_exportacao_log enable row level security;
create policy cbs_exportacao_log_admin_select on public.cbs_exportacao_log
  for select to authenticated using (_is_admin());
revoke all on public.cbs_exportacao_log from anon;
revoke insert, update, delete, truncate, references, trigger on public.cbs_exportacao_log from authenticated;

-- 2. Uma página das notas de SAÍDA que ainda existem no Alvo, emitidas desde p_desde,
--    só com os campos da checagem do Cockpit (cabeçalho; sem itens nem payload).
--    Paginação pela chave (modelo, série, número): a próxima página começa depois de
--    'ultimo', então uma nota que some no meio da leitura não faz outra ser pulada.
--    LGPD: CNPJ só de pessoa jurídica; de pessoa física não sai nem o CPF nem o nome.
create function public.cbs_exportar_notas_saida(
  p_desde date, p_apos_modelo text default null, p_apos_serie text default null,
  p_apos_numero bigint default null, p_limite integer default 500)
returns jsonb
language sql stable security definer set search_path = public as $$
  with base as (
    select s.*
      from nf_saida s
     where s.tipo_nota = 'Saída' and s.ausente_desde is null
       and s.data_emissao >= greatest(coalesce(p_desde, date '2026-01-01'), date '2024-01-01')
  ), pagina as (
    select b.* from base b
     where p_apos_modelo is null
        or (b.modelo, b.serie, b.numero) > (p_apos_modelo, p_apos_serie, p_apos_numero)
     order by b.modelo, b.serie, b.numero
     limit least(greatest(coalesce(p_limite, 500), 1), 1000)
  ), ultimo as (
    select p.modelo, p.serie, p.numero from pagina p order by p.modelo desc, p.serie desc, p.numero desc limit 1
  )
  select jsonb_build_object(
    'gerado_em', now(),
    'desde', greatest(coalesce(p_desde, date '2026-01-01'), date '2024-01-01'),
    'total', (select count(*) from base),
    'ultimo', (select jsonb_build_object('modelo', u.modelo, 'serie', u.serie, 'numero', u.numero) from ultimo u),
    'restantes', (select count(*) from base b, ultimo u where (b.modelo, b.serie, b.numero) > (u.modelo, u.serie, u.numero)),
    -- quando o espelho leu o Alvo pela última vez (lista), para o Cockpit mostrar o atraso real
    'alvo_lido_em', (select max(s.ultima_leitura_lista_em) from nf_saida s),
    'agendamento_ativo', (select j.active from cron.job j where j.jobname = 'sync-nf-saida-3x-dia'),
    'notas', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'modelo',         p.modelo,
        'serie',          p.serie,
        'numero',         p.numero,
        'emissao',        p.data_emissao,
        'competencia',    p.data_competencia,
        'digitacao',      (p.data_digitacao at time zone 'America/Sao_Paulo')::date,
        'cliente_codigo', p.codigo_entidade,
        'cliente_nome',   case when p.tipo_pessoa = 'Jurídica' then p.razao_social else 'Pessoa física' end,
        'cliente_cnpj',   case when p.tipo_pessoa = 'Jurídica'
                                and regexp_replace(coalesce(p.cpf_cnpj, ''), '\D', '', 'g') ~ '^[0-9]{14}$'
                               then regexp_replace(p.cpf_cnpj, '\D', '', 'g') end,
        'uf',             p.uf,
        'pais',           p.sigla_pais,
        'pais_nome',      p.nome_pais,
        'cidade',         p.nome_cidade,
        'natureza',       case when p.modelo = 'NFS-e'
                               then coalesce(p.codigo_nat_operacao_servico, p.codigo_nat_operacao_produto)
                               else coalesce(p.codigo_nat_operacao_produto, p.codigo_nat_operacao_servico) end,
        'valor_total',    p.valor_total,
        'base_cbs',       case when (p.payload_lista->>'BaseCBS') ~ '^-?[0-9]+(\.[0-9]+)?$'
                               then (p.payload_lista->>'BaseCBS')::numeric end,
        'valor_cbs',      p.valor_cbs,
        'valor_ibs',      coalesce(p.valor_ibs_uf, 0) + coalesce(p.valor_ibs_cidade, 0),
        'valor_iss',      p.valor_iss,
        'cancelada',      p.cancelada,
        'substituida',    p.substituida,
        'denegada',       p.denegada,
        'numero_retorno', p.numero_nfse_prefeitura,
        'situacao_hub',   p.situacao_hub,
        'alvo_atualizado_em', p.alvo_atualizado_em))
        order by p.modelo, p.serie, p.numero) from pagina p), '[]'::jsonb))
$$;

revoke execute on function public.cbs_exportar_notas_saida(date, text, text, bigint, integer) from public, anon, authenticated;
grant  execute on function public.cbs_exportar_notas_saida(date, text, text, bigint, integer) to service_role;

-- 3. Chave de desligar da janela (enabled = false → a Edge responde 503 sem ler nada).
insert into public.sync_settings (job_name, enabled, schedule_cron)
values ('exportar-notas-cbs', true, 'sob demanda: o Cockpit CBS busca de hora em hora');
