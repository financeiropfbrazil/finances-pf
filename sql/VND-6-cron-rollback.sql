-- Rollback do VND-6 (sql/VND-6-cron.sql). Só com ordem do Pedro.
select cron.unschedule('sync-nf-saida-3x-dia');
delete from public.sync_settings where job_name = 'sync-nf-saida';
drop function if exists public.call_sync_nf_saida_cron(text, jsonb);
