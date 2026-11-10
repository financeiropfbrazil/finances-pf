-- =====================================================================
-- NFE-11 — etapas 4 (PDF da nota) e 5 (boleto) opcionais na NF-e (PLANO-NFE.md) — 10/11/2026
-- Projeto: hbtggrbauguukewiknew. Ordem do Pedro (10/11): "todas, em sequência" (propostas da revisão de 10/11).
--
-- Problema: nenhum anexo foi enviado desde a NFE-3 (30/10) e o lançamento da NF-e pelo Hub não existe, então toda
--   nota lançada ficava parada em "4 · PDF da nota" no Excel (795 de 1.012 em jan–nov) e as etapas 4 e 5 ficavam
--   "pendentes" no detalhe — ruído.
-- O que muda: nfe_relatorio_etapas deixa de parar em "4 · PDF da nota" e "5 · Boleto" (a nota lançada vai para
--   "6 · DocFin" ou "Concluída"). As colunas de anexo continuam no Excel. Troca SÓ esse trecho, dentro do banco,
--   com md5 antes (1a0025af…, o da NFE-8) e depois (27bc3432…). create or replace preserva o ACL.
--   O detalhe (tela) mostra 4 e 5 como "Opcional". NFS-e não muda.
-- Rollback: NFE-11-anexos-opcionais-rollback.sql.
-- =====================================================================

do $$
declare
  v_fn    regprocedure := 'public.nfe_relatorio_etapas(date,date)'::regprocedure;
  v_def   text;
  v_velho text;
  v_novo  text := 'then ''3 · MovEstq''';
begin
  v_velho := 'then ''3 · MovEstq''' || chr(10) || repeat(' ', 15) || 'when l.nf_anexado_em is null then ''4 · PDF da nota'''
             || chr(10) || repeat(' ', 15) || 'when l.faturavel and l.boleto_anexado_em is null then ''5 · Boleto''';

  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if (select md5(prosrc) from pg_proc where oid = v_fn) <> '1a0025af69d85fd6f1198077da953e33' then
    raise exception 'nfe_relatorio_etapas não está como a NFE-8 deixou — conferir antes de aplicar';
  end if;

  v_def := pg_get_functiondef(v_fn);
  if position(v_velho in v_def) = 0 then
    raise exception 'Trecho a trocar não encontrado em nfe_relatorio_etapas';
  end if;
  execute replace(v_def, v_velho, v_novo);

  if (select md5(prosrc) from pg_proc where oid = v_fn) <> '27bc3432cd2b07c6287ab75ef5926747' then
    raise exception 'md5 novo de nfe_relatorio_etapas não confere — transação desfeita';
  end if;
end $$;
