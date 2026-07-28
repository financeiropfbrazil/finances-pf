-- =============================================================================
-- REC-1.1 · Agendamento do sync-laudos  (módulo Recebimento)
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
-- Idempotente e reexecutável. Verificação e rollback no fim do arquivo.
--
-- ⚠ PRÉ-REQUISITO: a Edge Function `sync-laudos` já deve estar publicada:
--     supabase functions deploy sync-laudos \
--       --no-verify-jwt --project-ref hbtggrbauguukewiknew
--   Aplicar este bloco ANTES do deploy só agenda chamadas para um 404.
--
-- O QUE ESTE BLOCO FAZ (3 peças, o mesmo padrão dos outros crons):
--   1. public.call_sync_laudos_cron(p_triggered_by) — dispara a Edge
--      Function via pg_net com o CRON_SECRET lido do Vault.
--   2. sync_settings('sync-laudos') — kill-switch (enabled=false pausa
--      sem mexer no agendamento).
--   3. cron.schedule('sync-laudos-4x-dia') — 4x por dia útil.
--
-- CADÊNCIA ESCOLHIDA: '45 11,14,17,20 * * 1-5' (UTC) = 08:45 / 11:45 /
--   14:45 / 17:45 BRT, dias úteis. Minuto 45 para não colidir com o
--   sync-compras-status-cron (de hora cheia, 11–20 UTC) nem com os crons
--   de despesas/docfin/intercompany (minutos 00/10/30 às 10,15,19 UTC).
--   A fila de inspeção anda em dias, não em minutos — 4x/dia sobra.
--   Convergência inicial do enriquecimento (teto de 100 Loads por
--   execução, ~751 laudos): ~8 execuções ≈ 2 dias úteis. Para acelerar,
--   disparar manualmente: select public.call_sync_laudos_cron('manual_admin');
-- =============================================================================


-- ─── 1. DISPARADOR (pg_net + CRON_SECRET do Vault) ───────────────────────────
create or replace function public.call_sync_laudos_cron(p_triggered_by text default 'pg_cron'::text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions'
as $function$
declare
  v_secret      text;
  v_request_id  bigint;
  v_url         text := 'https://hbtggrbauguukewiknew.supabase.co/functions/v1/sync-laudos';
  v_safe_trigger text;
begin
  -- Valida triggered_by (whitelist) — mesmo contrato das outras call_sync_*
  if p_triggered_by not in ('pg_cron', 'manual_admin', 'test') then
    v_safe_trigger := 'pg_cron';
  else
    v_safe_trigger := p_triggered_by;
  end if;

  -- Lê o secret do Vault (o MESMO CRON_SECRET de todos os crons do Hub)
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'sync_compras_cron_secret'
   limit 1;

  if v_secret is null then
    raise exception 'Secret sync_compras_cron_secret não encontrado no Vault';
  end if;

  -- Chamada HTTP assíncrona (pg_net não espera a resposta)
  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object(
      'triggered_by', v_safe_trigger
    ),
    timeout_milliseconds := 180000
  ) into v_request_id;

  return v_request_id;
end;
$function$;


-- ─── 2. KILL-SWITCH (sync_settings) ──────────────────────────────────────────
-- enabled=false faz a Edge Function registrar "Pausado" em sync_runs e sair
-- sem tocar no Alvo — sem precisar desagendar o cron.
insert into public.sync_settings (job_name, enabled, schedule_cron)
values ('sync-laudos', true, '45 11,14,17,20 * * 1-5')
on conflict (job_name) do update
  set schedule_cron = excluded.schedule_cron,
      updated_at    = now();


-- ─── 3. AGENDAMENTO (pg_cron) ────────────────────────────────────────────────
-- cron.schedule com o mesmo jobname substitui o agendamento existente
-- (idempotente); o unschedule antes evita duplicata em bases antigas.
select cron.unschedule('sync-laudos-4x-dia')
 where exists (select 1 from cron.job where jobname = 'sync-laudos-4x-dia');

select cron.schedule(
  'sync-laudos-4x-dia',
  '45 11,14,17,20 * * 1-5',
  $$ select public.call_sync_laudos_cron('pg_cron'); $$
);


-- =============================================================================
-- VERIFICAÇÃO (rodar DEPOIS de aplicar)
-- =============================================================================
-- fingerprint do projeto (deve bater com o registrado na sessão: 1720)
--   select count(*) as fingerprint from public.compras_pedidos;
--
-- a) disparador existe e é SECURITY DEFINER
--   select proname, prosecdef from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public' and p.proname='call_sync_laudos_cron';
--
-- b) kill-switch
--   select job_name, enabled, schedule_cron from public.sync_settings
--    where job_name = 'sync-laudos';
--
-- c) agendamento (esperado: 1 linha, active=true)
--   select jobid, jobname, schedule, command, active from cron.job
--    where jobname = 'sync-laudos-4x-dia';
--
-- d) PRIMEIRO DISPARO MANUAL (depois do deploy da função):
--   select public.call_sync_laudos_cron('manual_admin');
--   -- ~1 min depois:
--   select started_at, finished_at, duracao_ms, total_candidatos,
--          total_consultados, total_mudaram, total_erros, observacao
--     from public.sync_runs
--    where job_type = 'laudos'
--    order by started_at desc limit 5;
--
-- e) o espelho encheu?
--   select status, count(*) as laudos, sum(quantidade) as unidades
--     from public.rec_laudos group by status order by 1;
--   select count(*) as sem_lote from public.rec_laudos where enriquecido_em is null;


-- =============================================================================
-- ROLLBACK (só se precisar desfazer)
-- =============================================================================
--   select cron.unschedule('sync-laudos-4x-dia');
--   update public.sync_settings set enabled = false,
--          paused_reason = 'rollback REC-1.1', paused_at = now()
--    where job_name = 'sync-laudos';
--   drop function if exists public.call_sync_laudos_cron(text);
--   -- os dados já sincronizados em rec_laudos podem ficar (espelho read-only);
--   -- para limpar:  truncate table public.rec_laudos;
