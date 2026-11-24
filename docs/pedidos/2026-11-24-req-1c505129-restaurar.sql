-- Restaura a requisição 1c505129 excluída em 24/11/2026 (backup: 2026-11-24-req-1c505129-backup.json).
-- Rodar como postgres (os gatilhos de proteção de aprovação só valem para os papéis do app).
-- ATENÇÃO: a restauração volta o card "Aprovada — erro no envio" (a 0001707 continua na d2072ec5).
-- Ordem: cabeçalho SEM aprovacao_submetida_em (senão fn_req_congelar_conteudo recusa itens/anexo de requisição
-- submetida) → itens, anexo, grupo de aprovação, auditoria → recoloca aprovacao_submetida_em.
do $$
declare
  j jsonb := $json$ COLE_AQUI_O_JSON_DO_BACKUP $json$::jsonb;
  v_sub timestamptz := (j->'compras_requisicoes'->>'aprovacao_submetida_em')::timestamptz;
begin
  insert into public.compras_requisicoes
    select * from jsonb_populate_record(null::public.compras_requisicoes,
                                        (j->'compras_requisicoes') || '{"aprovacao_submetida_em": null}'::jsonb);
  insert into public.compras_requisicoes_itens
    select * from jsonb_populate_recordset(null::public.compras_requisicoes_itens, j->'compras_requisicoes_itens');
  insert into public.compras_requisicoes_arquivos
    select * from jsonb_populate_recordset(null::public.compras_requisicoes_arquivos, j->'compras_requisicoes_arquivos');
  insert into public.compras_requisicoes_aprovacao_grupos
    select * from jsonb_populate_recordset(null::public.compras_requisicoes_aprovacao_grupos, j->'compras_requisicoes_aprovacao_grupos');
  insert into public.compras_requisicoes_auditoria
    select * from jsonb_populate_recordset(null::public.compras_requisicoes_auditoria, j->'compras_requisicoes_auditoria');
  update public.compras_requisicoes set aprovacao_submetida_em = v_sub where id = '1c505129-86b2-40e9-a8f9-adec84fe2706';
end $$;
