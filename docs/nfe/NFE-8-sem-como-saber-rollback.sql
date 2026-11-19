-- NFE-8 — rollback: devolve nfe_relatorio_etapas ao corpo da NFE-6 (md5 55347bdb…) e remove nfe_alvo_espelho_desde().
-- Só com ordem do Pedro. A tela publicada depois da NFE-8 chama nfe_alvo_espelho_desde(): sem ela, a lista volta a
-- mostrar "Não encontrada" para as notas antigas (a chamada falha e é ignorada) — reverter o commit junto.
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

  if (select md5(prosrc) from pg_proc where oid = v_fn) <> '1a0025af69d85fd6f1198077da953e33' then
    raise exception 'nfe_relatorio_etapas não está como a NFE-8 deixou — conferir antes do rollback';
  end if;
  v_def := pg_get_functiondef(v_fn);
  execute replace(replace(v_def, a_nov, a_ant), b_nov, b_ant);
  if (select md5(prosrc) from pg_proc where oid = v_fn) <> '55347bdbfb80aeb29abd2f8e40bb0905' then
    raise exception 'Rollback não devolveu o corpo da NFE-6 — transação desfeita';
  end if;
end $$;

drop function if exists public.nfe_alvo_espelho_desde();
