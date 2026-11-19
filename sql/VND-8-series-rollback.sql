-- =====================================================================
-- Rollback do VND-8 (sql/VND-8-series.sql). Apaga só o que o VND-8 criou.
-- Antes: voltar a Edge sync-nf-saida-cron para a v2 (git revert do commit do
-- VND-8 + deploy), senão a rotina vai procurar a fila que deixa de existir.
-- =====================================================================
drop function if exists public.nf_saida_serie_registrar_falha(bigint, text);
drop function if exists public.nf_saida_serie_gravar(bigint, jsonb);
drop view if exists public.v_nf_saida_serie_fila;
drop table if exists public.nf_saida_serie_cadastro;
