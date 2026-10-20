-- =====================================================================
-- NFSE-1.5 — Sync automático do ADN, criado DESLIGADO (PLANO-NFSE.md §3) — 20/10/2026
-- Projeto: hbtggrbauguukewiknew. OK do Pedro em 20/10/2026 ("sim" a preparar o cron desligado).
--   1. sync_settings 'nfse-adn-sonda' (kill-switch; a Edge e a função leem)
--   2. call_nfse_adn_cron(p_triggered_by): SECURITY DEFINER, segredo do Vault, não sobrepõe execução aberta,
--      espera crescente após falhas seguidas (30 min → 1 h → 2 h → 4 h → teto 6 h), chama a Edge em modo drenar
--   3. job pg_cron 'nfse-adn-sonda' de 30 em 30 min, 07h00–18h30 BRT, dias úteis ('0,30 10-21 * * 1-5' em UTC),
--      CRIADO COM active = false — ligar é a NFSE-1.9, com OK do Pedro.
-- Padrão: call_sync_parcelas_pagar_nf_cron (docs/rastreio-pagamentos/F2-aplicar.sql). Edge exigida: v2 (NFSE-1.4).
-- Rollback: NFSE-1.5-rollback.sql.
-- =====================================================================

-- ── Pré-voo (parar se divergir) ──────────────────────────────────────
-- select count(*) from public.compras_pedidos;                                   -- ≈ 2.310 em 20/10/2026
-- select to_regprocedure('public.call_nfse_adn_cron(text)');                      -- NULL
-- select count(*) from cron.job where jobname = 'nfse-adn-sonda';                  -- 0
-- select count(*) from public.sync_settings where job_name = 'nfse-adn-sonda';     -- 0
-- select count(*) from vault.decrypted_secrets where name = 'sync_compras_cron_secret';  -- 1

-- ── 1. Kill-switch ───────────────────────────────────────────────────
insert into public.sync_settings (job_name, enabled, schedule_cron)
values ('nfse-adn-sonda', true, '0,30 10-21 * * 1-5');

-- ── 2. Função chamada pelo job ───────────────────────────────────────
create function public.call_nfse_adn_cron(p_triggered_by text default 'pg_cron'::text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'vault'
as $function$
declare
  v_secret     text;
  v_request_id bigint;
  v_url        text := 'https://hbtggrbauguukewiknew.supabase.co/functions/v1/nfse-adn-sonda';
  v_safe       text;
  v_falhas     integer;
  v_ultima     timestamptz;
  v_espera     interval;
begin
  v_safe := case when p_triggered_by in ('pg_cron', 'manual_admin', 'test') then p_triggered_by else 'pg_cron' end;

  -- Kill-switch desligado: não chama (a Edge registraria uma run "Pausado" a cada 30 min).
  if exists (select 1 from public.sync_settings where job_name = 'nfse-adn-sonda' and enabled = false) then
    return null;
  end if;

  -- Outra execução ainda aberta: não sobrepõe (a Edge para em ~100 s; 5 min cobre folga).
  if exists (select 1 from public.sync_runs
             where job_type = 'nfse_adn' and finished_at is null
               and started_at > now() - interval '5 minutes') then
    return null;
  end if;

  -- Espera crescente: N falhas seguidas (as runs mais recentes com total_erros > 0, até a última sem erro)
  -- → espera 30 min × 2^(N−1), teto 6 h, contada do início da última run.
  with r as (
    select started_at, coalesce(total_erros, 0) > 0 as falhou,
           row_number() over (order by started_at desc) as rn
    from public.sync_runs
    where job_type = 'nfse_adn' and finished_at is not null
    order by started_at desc
    limit 20
  )
  select coalesce(min(rn) filter (where not falhou), (select count(*) + 1 from r)) - 1,
         max(started_at)
    into v_falhas, v_ultima
  from r;

  if v_falhas > 0 then
    v_espera := least(interval '30 minutes' * power(2, v_falhas - 1), interval '6 hours');
    if now() < v_ultima + v_espera then
      return null;
    end if;
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
    body := jsonb_build_object('modo', 'drenar', 'triggered_by', v_safe, 'max_lotes', 30),
    timeout_milliseconds := 150000
  ) into v_request_id;

  return v_request_id;
end;
$function$;

comment on function public.call_nfse_adn_cron(text) is
  'NFSE-1.5: chamada do job nfse-adn-sonda à Edge (modo drenar). Respeita sync_settings, não sobrepõe execução '
  'aberta e espera 30 min → 1 h → 2 h → 4 h → 6 h após falhas seguidas. Só postgres/service_role executam.';

-- Toda função nova em public nasce com EXECUTE nominal para anon/authenticated (CLAUDE.md, BL-27).
revoke execute on function public.call_nfse_adn_cron(text) from public, anon, authenticated;

-- ── 3. Job, criado desligado ─────────────────────────────────────────
do $$
declare
  v_job bigint;
begin
  v_job := cron.schedule('nfse-adn-sonda', '0,30 10-21 * * 1-5',
                         $cmd$ select public.call_nfse_adn_cron('pg_cron'); $cmd$);
  perform cron.alter_job(job_id := v_job, active := false);
end $$;

-- ── 4. Conferência dentro da transação ───────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.call_nfse_adn_cron(text)', 'execute')
     or has_function_privilege('authenticated', 'public.call_nfse_adn_cron(text)', 'execute') then
    raise exception 'ACESSOS: anon/authenticated ficaram com EXECUTE em call_nfse_adn_cron. Transação desfeita.';
  end if;
  if not exists (select 1 from cron.job where jobname = 'nfse-adn-sonda' and schedule = '0,30 10-21 * * 1-5'
                   and not active and btrim(command) = 'select public.call_nfse_adn_cron(''pg_cron'');') then
    raise exception 'CRON: o job nfse-adn-sonda não ficou como esperado (agenda, comando ou desligado). Transação desfeita.';
  end if;
end $$;
