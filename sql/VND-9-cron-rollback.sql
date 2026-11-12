-- Rollback do VND-9 (frequência): volta o job 37 para 3×/dia útil e apaga a varredura.
select cron.alter_job(37, schedule := '20 11,16,21 * * 1-5');
update public.sync_settings
   set schedule_cron = '20 11,16,21 * * 1-5 (UTC) = 08h20, 13h20, 18h20 BRT, dias úteis', updated_at = now()
 where job_name = 'sync-nf-saida';
select cron.unschedule('sync-nf-saida-varredura-a');
select cron.unschedule('sync-nf-saida-varredura-b');
select cron.unschedule('sync-nf-saida-varredura-c');
select cron.unschedule('sync-nf-saida-varredura-d');
