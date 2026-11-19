-- =====================================================================
-- NFE-8 — "Sem como saber" para NF-e sem venda não achada no Alvo (PLANO-NFE.md) — 10/11/2026
-- Projeto: hbtggrbauguukewiknew. Ordem do Pedro (10/11): "todas, em sequência" (propostas da revisão de 10/11).
--
-- Problema: nota sem CFOP de venda (remessa, retorno, consignação, comodato…) aparecia como "No Alvo: não encontrada"
--   mesmo quando foi lançada: o espelho do Alvo no Hub (rastreio_nf / fin_parcelas_pagar) só tem MovEstq com título
--   a pagar ou pedido (medido em 10/11: 841 de 846 lançamentos desde set com título, os outros 5 com pedido).
--   64 notas desde abril (R$ 1,0 mi) contavam como "não encontradas".
-- O que muda:
--   1. nfe_relatorio_etapas (Excel): nota não lançada sem CFOP de venda → etapa "Sem como saber (sem venda)" e
--      sem "dias em aberto". Troca SÓ esses dois trechos, dentro do banco (pg_get_functiondef + replace), com md5 antes
--      (55347bdb…, o da NFE-6) e depois (1a0025af…). create or replace preserva o ACL.
--   2. Função nova nfe_alvo_espelho_desde(): a data em que o espelho do contas a pagar começa (a mesma conta do
--      detalhe, meta.alvo_espelho_desde) — a lista precisa dela para dizer "Sem dado do Alvo" (fin_parcelas_pagar é
--      só admin). Gate nfe_pode_acessar(); revoke de public e anon.
--   O detalhe (nfe_recebida_detalhe) não muda: a tela deriva "sem como saber" de situacao_alvo + faturavel.
-- Rollback: NFE-8-sem-como-saber-rollback.sql.
-- =====================================================================

do $$
declare
  v_fn  regprocedure := 'public.nfe_relatorio_etapas(date,date)'::regprocedure;
  v_def text;
  a_ant text := 'when not l.lancada and l.antes_espelho then ''Sem dado do Alvo''';
  a_nov text;
  b_ant text := '''dias_em_aberto'', case when not l.lancada then';
  b_nov text := '''dias_em_aberto'', case when not l.lancada and l.faturavel then';
begin
  a_nov := a_ant || chr(10) || '               when not l.lancada and not l.faturavel then ''Sem como saber (sem venda)''';

  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if (select md5(prosrc) from pg_proc where oid = v_fn) <> '55347bdbfb80aeb29abd2f8e40bb0905' then
    raise exception 'nfe_relatorio_etapas mudou desde a NFE-6 — conferir antes de aplicar';
  end if;
  if to_regprocedure('public.nfe_alvo_espelho_desde()') is not null then
    raise exception 'nfe_alvo_espelho_desde já existe — NFE-8 já aplicada?';
  end if;

  v_def := pg_get_functiondef(v_fn);
  if position(a_ant in v_def) = 0 or position(b_ant in v_def) = 0 then
    raise exception 'Trecho a trocar não encontrado em nfe_relatorio_etapas';
  end if;
  execute replace(replace(v_def, a_ant, a_nov), b_ant, b_nov);

  if (select md5(prosrc) from pg_proc where oid = v_fn) <> '1a0025af69d85fd6f1198077da953e33' then
    raise exception 'md5 novo de nfe_relatorio_etapas não confere — transação desfeita';
  end if;
end $$;

create function public.nfe_alvo_espelho_desde()
returns date
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $fn$
begin
  if not public.nfe_pode_acessar() then
    raise exception 'Sem permissão para Notas Fiscais' using errcode = '42501';
  end if;
  -- Mesma conta do detalhe da NF-e (nfe_recebida_detalhe → meta.alvo_espelho_desde).
  return (select min(f.data_vencimento) from public.fin_parcelas_pagar f);
end;
$fn$;

comment on function public.nfe_alvo_espelho_desde() is
  'NFE-8 (PLANO-NFE): data em que o espelho do contas a pagar do Alvo começa; nota emitida antes = "Sem dado do Alvo".';

-- Toda função nova em public nasce com EXECUTE nominal para anon (default privileges do Supabase): tirar com a assinatura.
revoke execute on function public.nfe_alvo_espelho_desde() from public, anon;
