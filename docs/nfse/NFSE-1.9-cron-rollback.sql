-- NFSE-1.9 + NFSE-1.13 — rollback: volta os jobs 35 e 30 ao estado de antes de 20/10/2026 ~10h55 BRT.
-- Estado salvo antes da mudança:
--   35 nfse-adn-sonda              '0,30 10-21 * * 1-5'  active = false
--   30 sync-parcelas-pagar-diario  '40 9 * * 1-5'        active = true
--   sync_settings('sync-parcelas-pagar').schedule_cron =
--     '40 9 * * 1-5 (lista, 06h40 BRT) + */3 * * * * (nf, só com fila e sem outra execução rodando)'
-- Parar só o ADN, na hora, sem mexer no cron: update public.sync_settings set enabled = false where job_name = 'nfse-adn-sonda';
begin;
select cron.alter_job(job_id := 35, active := false);
select cron.alter_job(job_id := 30, schedule := '40 9 * * 1-5');
update public.sync_settings
   set schedule_cron = '40 9 * * 1-5 (lista, 06h40 BRT) + */3 * * * * (nf, só com fila e sem outra execução rodando)',
       updated_at = now()
 where id = '9a3d51a5-9b3a-4c5a-9820-84a8fdc5e2d0'
   and job_name = 'sync-parcelas-pagar';
commit;
