-- NFE-11 — rollback: volta "4 · PDF da nota" e "5 · Boleto" à etapa atual do Excel (corpo da NFE-8, md5 1a0025af…).
-- Só com ordem do Pedro.
do $$
declare
  v_fn    regprocedure := 'public.nfe_relatorio_etapas(date,date)'::regprocedure;
  v_def   text;
  v_velho text;
  v_novo  text := 'then ''3 · MovEstq''';
begin
  v_velho := 'then ''3 · MovEstq''' || chr(10) || repeat(' ', 15) || 'when l.nf_anexado_em is null then ''4 · PDF da nota'''
             || chr(10) || repeat(' ', 15) || 'when l.faturavel and l.boleto_anexado_em is null then ''5 · Boleto''';

  if (select md5(prosrc) from pg_proc where oid = v_fn) <> '27bc3432cd2b07c6287ab75ef5926747' then
    raise exception 'nfe_relatorio_etapas não está como a NFE-11 deixou — conferir antes do rollback';
  end if;
  v_def := pg_get_functiondef(v_fn);
  execute replace(v_def, v_novo, v_velho);
  if (select md5(prosrc) from pg_proc where oid = v_fn) <> '1a0025af69d85fd6f1198077da953e33' then
    raise exception 'Rollback não devolveu o corpo da NFE-8 — transação desfeita';
  end if;
end $$;
