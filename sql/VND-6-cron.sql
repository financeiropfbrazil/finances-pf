-- =====================================================================
-- VND-6 — agendamento da Edge sync-nf-saida-cron (PLANO-VENDAS.md §15)
-- NÃO APLICADO. Aplicar só com ordem do Pedro.
-- 1. Função de disparo (molde de call_sync_parcelas_pagar_cron), SEM o furo
--    do BL-27: revoke de public/anon/authenticated com a assinatura completa.
-- 2. Linha de kill-switch em sync_settings.
-- 3. cron.job criado e DESATIVADO (liga só com ordem expressa).
-- Horário: 20 11,16,21 * * 1-5 (UTC) = 08h20, 13h20 e 18h20 BRT, dias úteis —
-- fora das janelas 07h30/12h30/16h30 e sem colidir com os jobs ativos.
-- Rollback: sql/VND-6-cron-rollback.sql
-- =====================================================================

create or replace function public.call_sync_nf_saida_cron(
  p_triggered_by text default 'pg_cron',
  p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare
  v_secret     text;
  v_request_id bigint;
  v_url        text := 'https://hbtggrbauguukewiknew.supabase.co/functions/v1/sync-nf-saida-cron';
  v_safe       text;
begin
  v_safe := case when p_triggered_by in ('pg_cron', 'manual_admin', 'test') then p_triggered_by else 'pg_cron' end;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'sync_compras_cron_secret'
   limit 1;
  if v_secret is null then
    raise exception 'Secret sync_compras_cron_secret não encontrado no Vault';
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := coalesce(p_body, '{}'::jsonb) || jsonb_build_object('triggered_by', v_safe),
    timeout_milliseconds := 150000
  ) into v_request_id;

  return v_request_id;
end;
$function$;

revoke execute on function public.call_sync_nf_saida_cron(text, jsonb) from public, anon, authenticated;

insert into public.sync_settings (job_name, enabled, schedule_cron)
values ('sync-nf-saida', true, '20 11,16,21 * * 1-5 (UTC) = 08h20, 13h20, 18h20 BRT, dias úteis');

select cron.schedule('sync-nf-saida-3x-dia', '20 11,16,21 * * 1-5',
                     $$ select public.call_sync_nf_saida_cron('pg_cron'); $$);
update cron.job set active = false where jobname = 'sync-nf-saida-3x-dia';
