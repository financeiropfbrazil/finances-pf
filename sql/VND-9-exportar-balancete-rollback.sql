-- =====================================================================
-- Rollback do VND-9 (sql/VND-9-exportar-balancete.sql). Antes: apagar a Edge
-- exportar-notas-balancete no painel (ou desligar pela chave abaixo).
-- Desligar sem apagar: update public.sync_settings set enabled = false
--   where job_name = 'exportar-notas-balancete';
-- =====================================================================
delete from public.sync_settings where job_name = 'exportar-notas-balancete';
drop function if exists public.balancete_exportar_mes(date, integer, integer);
drop function if exists public.balancete_exportar_resumo(integer);
drop table if exists public.nf_saida_exportacao_log;
