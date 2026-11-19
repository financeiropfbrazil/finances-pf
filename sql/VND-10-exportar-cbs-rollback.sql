-- =====================================================================
-- Rollback do VND-10 (sql/VND-10-exportar-cbs.sql). Antes: apagar a Edge
-- exportar-notas-cbs no painel (ou desligar pela chave abaixo).
-- Desligar sem apagar: update public.sync_settings set enabled = false
--   where job_name = 'exportar-notas-cbs';
-- =====================================================================
delete from public.sync_settings where job_name = 'exportar-notas-cbs';
drop function if exists public.cbs_exportar_notas_saida(date, text, text, bigint, integer);
drop table if exists public.cbs_exportacao_log;
