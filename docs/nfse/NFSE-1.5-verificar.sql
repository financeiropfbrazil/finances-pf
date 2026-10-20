-- NFSE-1.5 — conferência
-- 1. Job existe e está DESLIGADO; kill-switch ligado; função sem EXECUTE para anon/authenticated
select jobid, jobname, schedule, active, command from cron.job where jobname = 'nfse-adn-sonda';
select job_name, enabled, schedule_cron from public.sync_settings where job_name = 'nfse-adn-sonda';
select p.oid::regprocedure, p.prosecdef, p.proacl from pg_proc p where p.proname = 'call_nfse_adn_cron';

-- 2. Chamada manual da função (o que o job fará): abre 1 run triggered_by = 'pg_cron' com o carimbo da Edge v2
-- select public.call_nfse_adn_cron('pg_cron');
-- select started_at, finished_at, triggered_by, total_erros, observacao from public.sync_runs
--  where job_type = 'nfse_adn' order by started_at desc limit 1;

-- ── Resultado (20/10/2026 08h26 BRT, MCP apply_migration "nfse_1_5_cron_desligado") ──
-- job 35 'nfse-adn-sonda', '0,30 10-21 * * 1-5', active = false, comando conferido
-- sync_settings 'nfse-adn-sonda' enabled = true · call_nfse_adn_cron SECURITY DEFINER, ACL {postgres, service_role}
-- chamada manual: request 32297 → HTTP 200, run 58a99aa2 triggered_by pg_cron, "NSU 1653→1656 · docs 3 ·
-- parou: fim_da_fila · edge nfse-adn-sonda v2-2026-10-20", 0 erro, 3,6 s (prova a 1.4 no ar)
