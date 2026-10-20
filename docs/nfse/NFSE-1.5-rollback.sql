-- NFSE-1.5 — rollback (objetos novos desta tarefa; nada existente é tocado).
select cron.unschedule('nfse-adn-sonda');
drop function if exists public.call_nfse_adn_cron(text);
delete from public.sync_settings where job_name = 'nfse-adn-sonda';
