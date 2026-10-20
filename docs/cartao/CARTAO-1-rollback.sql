-- CARTAO-1 — rollback (só objetos novos desta tarefa; nada existente é tocado).
-- ORDEM: primeiro reverter o front no main (git revert + push + Publish) — o import grava data_base_vencimento
-- e quebraria sem a coluna. Derrubar a coluna APAGA as bases de vencimento digitadas desde a CARTAO-1.
drop function if exists public.fn_cartao_definir_base_vencimento(uuid[], date);
alter table public.cartao_import_item drop column if exists data_base_vencimento;
