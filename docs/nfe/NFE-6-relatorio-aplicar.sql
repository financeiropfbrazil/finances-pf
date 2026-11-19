-- =====================================================================
-- NFE-6 — download de controle das etapas da NF-e (PLANO-NFE.md) — 30/10/2026
-- Projeto: hbtggrbauguukewiknew. Colunas combinadas com o Pedro no chat (30/10/2026), só leitura.
-- RPC nfe_relatorio_etapas(p_de, p_ate): uma linha por NF-e com emissão no período, com o que cada etapa registrou
-- (quando e quem) e os dias entre etapas. Devolve jsonb (sem o teto de 1000 linhas do PostgREST).
-- Regras de cada coluna:
--   pedidos            = os do lançamento no Alvo (MovEstq); sem lançamento, os vinculados no Hub (nota marcada como
--                        vinculada). Sugestões automáticas NÃO entram.
--   data_pedido        = a mais recente entre os pedidos da nota; dias_pedido_emissao = emissão − data_pedido
--                        (negativo = nota emitida antes do pedido, o que está errado).
--   pedido_aprovado_em = a aprovação mais recente no Alvo entre os pedidos.
--   lancado_em         = data de entrada no Alvo; digitado_em = data e hora da digitação (só quando o Hub leu o MovEstq).
--   atraso             = maior atraso entre as parcelas, contra o vencimento do fornecedor (data_vencimento):
--                        paga → pagamento − vencimento; aberta e vencida → hoje − vencimento.
--   etapa_atual        = 1ª etapa não concluída (nota sem CFOP de venda pula pedido, boleto e DocFin).
-- Gate: nfe_pode_acessar(). Período: De e Até obrigatórios, no máximo ~3 anos.
-- Rollback: NFE-6-relatorio-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if to_regprocedure('public.nfe_relatorio_etapas(date,date)') is not null then
    raise exception 'nfe_relatorio_etapas já existe — conferir antes de aplicar';
  end if;
end $$;

create function public.nfe_relatorio_etapas(p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_res jsonb;
begin
  if not public.nfe_pode_acessar() then
    raise exception 'Sem permissão para Notas Fiscais' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 1100 then
    raise exception 'Período inválido: De e Até são obrigatórios (até 3 anos).' using errcode = '22023';
  end if;

  with nf as (
    select c.id, c.numero, c.emitente_nome, regexp_replace(coalesce(c.emitente_cnpj, ''), '\D', '', 'g') as cnpj,
           c.valor_total, c.data_emissao, c.chave_acesso, c.status_lancamento,
           (jsonb_typeof(c.dados_extraidos->'itens') <> 'array' or jsonb_array_length(c.dados_extraidos->'itens') = 0
            or exists (select 1 from jsonb_array_elements(c.dados_extraidos->'itens') i
                        where coalesce(i->>'cfop', '') ~ '^[567](1[0-2][0-9]|40[0-9]|551|92[29]|933)$')) as faturavel
    from public.compras_nfe c
    where c.data_emissao between p_de and p_ate
  ), alvo as materialized (
    select a.nfe_id, a.chave_movestq, a.data_entrada from public.compras_nfe_no_alvo(p_de, p_ate) a
  ), ped_num as (
    select nf.id, p.pedido_numero as numero
    from nf join alvo a on a.nfe_id = nf.id
    join public.rastreio_nf_pedido p on p.chave_movestq = a.chave_movestq and p.codigo_empresa_filial = '1.01'
    union
    select nf.id, v.pedido_numero
    from nf join public.compras_nfe_pedidos v on v.nfe_id = nf.id
    where nf.status_lancamento = 'vinculada'
      and not exists (select 1 from alvo a join public.rastreio_nf_pedido p
                        on p.chave_movestq = a.chave_movestq and p.codigo_empresa_filial = '1.01'
                      where a.nfe_id = nf.id)
  ), ped as (
    select x.id, string_agg(x.numero, ', ' order by x.numero) as pedidos,
           max(cp.data_pedido) as data_pedido, max(cp.data_aprovacao_alvo) as aprovado_em
    from ped_num x
    left join public.compras_pedidos cp on cp.numero = x.numero and cp.codigo_empresa_filial = '1.01'
    group by x.id
  ), mov as (
    select a.nfe_id, a.chave_movestq, coalesce(r.data_entrada, a.data_entrada) as data_entrada, r.data_hora_digitacao
    from alvo a
    left join public.rastreio_nf r on r.chave_movestq = a.chave_movestq and r.codigo_empresa_filial = '1.01'
  ), anx as (
    select a.chave_acesso, a.tipo, a.enviado_em, coalesce(pr.full_name, pr.email) as por
    from public.nfe_anexo a
    left join public.profiles pr on pr.user_id = a.enviado_por
    where a.substituido_em is null and a.removido_em is null
      and a.chave_acesso in (select nf.chave_acesso from nf)
  ), parc as (
    select nf.id, f.chave_docfin, f.data_vencimento, f.data_pagamento,
           public.rastreio_classe_pagamento(f.codigo_situacao, f.numero_mov_ctrl_banc, f.tipo_cobranca)
             in ('pago', 'quitado_adto') as paga
    from nf
    join public.fin_parcelas_pagar f
      on regexp_replace(coalesce(f.cpf_cnpj_entidade, ''), '\D', '', 'g') = nf.cnpj
     and ltrim(f.doc_numero, '0') = ltrim(nf.numero, '0')
     and f.ausente_no_alvo_em is null
  ), fin as (
    select p.id, min(p.chave_docfin) as docfin, count(*) as total, count(*) filter (where p.paga) as pagas,
           min(p.data_vencimento) filter (where not p.paga) as proximo_vencimento,
           max(p.data_pagamento) filter (where p.paga) as pago_em,
           bool_or(not p.paga and p.data_vencimento < current_date) as vencida,
           max(case when p.paga and p.data_pagamento is not null then p.data_pagamento - p.data_vencimento
                    when not p.paga and p.data_vencimento < current_date then current_date - p.data_vencimento end) as atraso
    from parc p group by p.id
  ), linhas as (
    select nf.*, ped.pedidos, ped.data_pedido, ped.aprovado_em, mov.chave_movestq, mov.data_entrada,
           mov.data_hora_digitacao,
           anf.enviado_em as nf_anexado_em, anf.por as nf_anexado_por,
           abo.enviado_em as boleto_anexado_em, abo.por as boleto_anexado_por,
           fin.docfin, coalesce(fin.total, 0) as parcelas_total, coalesce(fin.pagas, 0) as parcelas_pagas,
           fin.proximo_vencimento, fin.pago_em, fin.vencida, fin.atraso,
           mov.nfe_id is not null as lancada,
           nf.data_emissao < (select min(f.data_vencimento) from public.fin_parcelas_pagar f) as antes_espelho
    from nf
    left join ped on ped.id = nf.id
    left join mov on mov.nfe_id = nf.id
    left join anx anf on anf.chave_acesso = nf.chave_acesso and anf.tipo = 'nf'
    left join anx abo on abo.chave_acesso = nf.chave_acesso and abo.tipo = 'boleto'
    left join fin on fin.id = nf.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'numero', l.numero, 'fornecedor', l.emitente_nome, 'cnpj', l.cnpj, 'valor', l.valor_total,
           'emissao', l.data_emissao,
           'pedidos', l.pedidos, 'data_pedido', l.data_pedido,
           'pedido_aprovado_em', (l.aprovado_em at time zone 'America/Sao_Paulo')::date,
           'dias_pedido_emissao', l.data_emissao - l.data_pedido,
           'chave_movestq', l.chave_movestq, 'lancado_em', l.data_entrada,
           'digitado_em', l.data_hora_digitacao,
           'nf_anexado_em', l.nf_anexado_em, 'nf_anexado_por', l.nf_anexado_por,
           'boleto_anexado_em', l.boleto_anexado_em, 'boleto_anexado_por', l.boleto_anexado_por,
           'docfin', l.docfin, 'parcelas_total', l.parcelas_total, 'parcelas_pagas', l.parcelas_pagas,
           'proximo_vencimento', l.proximo_vencimento, 'pago_em', l.pago_em,
           'situacao_pagamento', case when l.parcelas_total = 0 then null
                                      when l.parcelas_pagas = l.parcelas_total then 'Pago'
                                      when l.vencida then 'Vencido'
                                      when l.parcelas_pagas > 0 then 'Parcial'
                                      else 'Em aberto' end,
           'etapa_atual', case
               when not l.lancada and l.antes_espelho then 'Sem dado do Alvo'
               when l.faturavel and l.pedidos is null then '2 · Pedidos'
               when not l.lancada then '3 · MovEstq'
               when l.nf_anexado_em is null then '4 · PDF da nota'
               when l.faturavel and l.boleto_anexado_em is null then '5 · Boleto'
               when l.faturavel and (l.parcelas_total = 0 or l.parcelas_pagas < l.parcelas_total) then '6 · DocFin'
               else 'Concluída' end,
           'dias_emissao_lancamento', l.data_entrada - l.data_emissao,
           'dias_em_aberto', case when not l.lancada then current_date - l.data_emissao end,
           'dias_emissao_digitacao', (l.data_hora_digitacao at time zone 'America/Sao_Paulo')::date - l.data_emissao,
           'dias_lancamento_pagamento', case when l.parcelas_total > 0 and l.parcelas_pagas = l.parcelas_total
                                             then l.pago_em - l.data_entrada end,
           'dias_atraso', l.atraso)
         order by l.data_emissao desc, l.numero), '[]'::jsonb)
    into v_res
    from linhas l;

  return jsonb_build_object('de', p_de, 'ate', p_ate, 'gerado_em', now(), 'linhas', v_res);
end;
$function$;

comment on function public.nfe_relatorio_etapas(date, date) is
  'NFE-6: download de controle das etapas da NF-e (nota, pedido, MovEstq, anexos, DocFin e dias entre etapas) para o '
  'período de emissão. Só leitura. Gate nfe_pode_acessar().';

revoke execute on function public.nfe_relatorio_etapas(date, date) from public, anon;
grant execute on function public.nfe_relatorio_etapas(date, date) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.nfe_relatorio_etapas(date, date)', 'execute') then
    raise exception 'ACESSOS: anon ficou com EXECUTE. Transação desfeita.';
  end if;
end $$;
