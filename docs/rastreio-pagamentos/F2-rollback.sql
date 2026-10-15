-- =====================================================================
-- LR-PAG · Fase 2 — ROLLBACK do SQL (F2-aplicar.sql)
-- Volta o portão ao texto de 15/10 (md5 conferido), o job ao nome antigo e
-- remove rastreio_tentativa. Uma transação.
--
-- ORDEM: primeiro redeployar a Edge v8 (a v9 grava em rastreio_tentativa):
--   git show <commit-v8>:supabase/functions/sync-parcelas-pagar-cron/index.ts
--   → supabase functions deploy sync-parcelas-pagar-cron --project-ref hbtggrbauguukewiknew
-- (com o kill-switch sync_settings 'sync-parcelas-pagar' desligado durante o deploy).
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.rastreio_tentativa') is null then
    raise exception 'ROLLBACK: rastreio_tentativa não existe — a F2 não está aplicada.';
  end if;
end $$;

create or replace function public.call_sync_parcelas_pagar_nf_cron(p_triggered_by text default 'pg_cron'::text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'vault'
as $function$
declare
  v_secret     text;
  v_request_id bigint;
  v_url        text := 'https://hbtggrbauguukewiknew.supabase.co/functions/v1/sync-parcelas-pagar-cron';
  v_safe       text;
begin
  v_safe := case when p_triggered_by in ('pg_cron', 'manual_admin', 'test') then p_triggered_by else 'pg_cron' end;

  -- Filas vazias (pedidos sem NF, títulos e NFs): não chama a função.
  if not exists (select 1 from public.fin_parcelas_pagar where origem = 'Estoque' and load_em is null)
     and not exists (select 1 from public.v_rastreio_nf_pendentes)
     and not exists (select 1 from public.v_rastreio_pedido_fila) then
    return null;
  end if;

  -- Outra execução ainda aberta (ex.: a diária das 06h40): não sobrepõe.
  if exists (select 1 from public.sync_runs
             where job_type = 'parcelas_pagar' and finished_at is null
               and started_at > now() - interval '4 minutes') then
    return null;
  end if;

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
    body := jsonb_build_object('triggered_by', v_safe, 'modo', 'nf'),
    timeout_milliseconds := 300000
  ) into v_request_id;

  return v_request_id;
end;
$function$;

select cron.schedule('sync-parcelas-pagar-nf-noturno', '*/3 * * * *',
                     $cmd$ select public.call_sync_parcelas_pagar_nf_cron('pg_cron'); $cmd$);
select cron.unschedule(jobid) from cron.job where jobname = 'sync-parcelas-pagar-nf-fila';

drop table public.rastreio_tentativa;

do $$
begin
  if md5(pg_get_functiondef('public.call_sync_parcelas_pagar_nf_cron(text)'::regprocedure)) <> '3f2be704c9cce8ae79e4abda627eba9e' then
    raise exception 'ROLLBACK: o portão restaurado não bate com o de 15/10. Transação desfeita.';
  end if;
end $$;

commit;
