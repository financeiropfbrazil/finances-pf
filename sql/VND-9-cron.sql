-- =====================================================================
-- VND-9 — frequência da leitura de saídas (PLANO-VENDAS.md §20.3)
-- Ordem do Pedro em 12/11/2026 ("o mais profissional e que não deixe nenhuma
-- nota de fora"). Rollback: sql/VND-9-cron-rollback.sql
--
-- 1. Rotina de hora em hora, das 07h20 às 20h20 BRT, dias úteis (era 08h20,
--    13h20 e 18h20). Mesmo job 37, só muda o horário.
-- 2. Varredura toda madrugada (02h00–02h15 BRT = 05h00–05h15 UTC), relendo a
--    lista dos últimos 13 meses em 3 rodadas (uma página de 300 leva ~30 s e a
--    Edge para aos 110 s) e uma rotina reforçada para ler o que mudou:
--      a) NF-e, páginas 1–3     b) NF-e, páginas 3–5 (chega ao corte de 13 meses)
--      c) NFS-e, páginas 1–3    d) rotina com até 200 detalhes e 200 séries
--    A rodada (a) termina com "LISTA INCOMPLETA" de propósito: a (b) continua.
-- Os jobs novos nascem DESLIGADOS e só ligam depois do teste manual.
-- =====================================================================

select cron.alter_job(37, schedule := '20 10-23 * * 1-5');
update public.sync_settings
   set schedule_cron = '20 10-23 * * 1-5 (UTC) = de hora em hora, 07h20–20h20 BRT, dias úteis; varredura 02h00–02h15 BRT todos os dias',
       updated_at = now()
 where job_name = 'sync-nf-saida';

select cron.alter_job(cron.schedule('sync-nf-saida-varredura-a', '0 5 * * *', $c$
  select public.call_sync_nf_saida_cron('pg_cron', jsonb_build_object(
    'modo', 'lista', 'modelos', jsonb_build_array('NF-e'), 'pagina_inicial', 1, 'max_paginas', 3,
    'desde', to_char((now() at time zone 'America/Sao_Paulo') - interval '13 months', 'YYYY-MM-DD')));
$c$), active := false);

select cron.alter_job(cron.schedule('sync-nf-saida-varredura-b', '5 5 * * *', $c$
  select public.call_sync_nf_saida_cron('pg_cron', jsonb_build_object(
    'modo', 'lista', 'modelos', jsonb_build_array('NF-e'), 'pagina_inicial', 3, 'max_paginas', 3,
    'desde', to_char((now() at time zone 'America/Sao_Paulo') - interval '13 months', 'YYYY-MM-DD')));
$c$), active := false);

select cron.alter_job(cron.schedule('sync-nf-saida-varredura-c', '10 5 * * *', $c$
  select public.call_sync_nf_saida_cron('pg_cron', jsonb_build_object(
    'modo', 'lista', 'modelos', jsonb_build_array('NFS-e'), 'pagina_inicial', 1, 'max_paginas', 3,
    'desde', to_char((now() at time zone 'America/Sao_Paulo') - interval '13 months', 'YYYY-MM-DD')));
$c$), active := false);

select cron.alter_job(cron.schedule('sync-nf-saida-varredura-d', '15 5 * * *', $c$
  select public.call_sync_nf_saida_cron('pg_cron', jsonb_build_object('max_detalhes', 200, 'max_series', 200));
$c$), active := false);
