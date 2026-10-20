-- NFSE-1.9 + NFSE-1.13 — conferência (só leitura)

-- 1. Estado dos jobs e dos kill-switches
select jobid, jobname, schedule, active from cron.job where jobid in (30, 34, 35) order by jobid;
select job_name, enabled, schedule_cron from public.sync_settings where job_name in ('nfse-adn-sonda', 'sync-parcelas-pagar');

-- 2. Execuções do pg_cron (succeeded aqui = o net.http_post foi enfileirado; o resultado real está em sync_runs)
select jobid, status, start_time at time zone 'America/Sao_Paulo' as inicio_brt, left(return_message, 80) as msg
from cron.job_run_details where jobid in (30, 35) and start_time > now() - interval '1 day' order by start_time desc;

-- 3. Resultado real: runs do ADN e do contas a pagar (lista = a do job 30; nf = a do job 34)
select job_type, triggered_by, started_at at time zone 'America/Sao_Paulo' as inicio_brt, duracao_ms,
       total_consultados, total_mudaram, total_erros, left(observacao, 160) as observacao
from public.sync_runs
where job_type in ('nfse_adn', 'parcelas_pagar') and started_at > now() - interval '1 day'
  and (job_type = 'nfse_adn' or observacao like '[lista]%')
order by started_at desc;

-- 4. Critério da NFSE-1.9: 1 dia útil de runs pg_cron do ADN sem erro e NSU contíguo
select count(*) as runs, count(*) filter (where coalesce(total_erros, 0) > 0) as com_erro,
       count(*) filter (where finished_at is null) as abertas
from public.sync_runs where job_type = 'nfse_adn' and triggered_by = 'pg_cron' and started_at > now() - interval '1 day';
select max(nsu) as nsu_max, count(*) as docs, max(nsu) - count(*) as buracos from public.nfse_adn_doc;

-- ── Resultado (20/10/2026) ──
-- Aplicado às 10h54 BRT pelo MCP (arquivo NFSE-1.9-cron-aplicar.sql sem alteração; pré-voo e conferência ok).
-- Consulta separada: 30 '40 9,15 * * 1-5' ligado; 35 '0,30 10-21 * * 1-5' ligado; kill-switches ligados.
