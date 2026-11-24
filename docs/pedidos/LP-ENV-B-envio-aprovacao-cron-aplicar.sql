-- =====================================================================
-- LP-ENV B — Leitura de hora em hora dos pedidos ainda não enviados para aprovação (Pedro, 24/11/2026)
-- Projeto: hbtggrbauguukewiknew. Edge: supabase/functions/pedidos-envio-aprovacao-cron (v1, verify_jwt=false).
-- Por quê: a rotina de compras (job 1) relê 100 de ~360 pedidos por hora → cada pedido a cada 3–4 h (o atraso medido
--   entre envio e leitura teve mediana de 7 h). Esta Edge relê só os pedidos em aberto, dos últimos 90 dias, ainda sem
--   data de envio (~40) e grava enviado_aprovacao_em (origem 'leitura') assim que o Alvo mostra o envio.
-- Horário: minuto :10, 10h–23h UTC (7h–20h BRT), dias úteis. Minuto livre (:00 compras/ADN, :17 lacunas, :20 vendas).
-- Rollback: LP-ENV-B-envio-aprovacao-cron-rollback.sql.
-- =====================================================================
do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then raise exception 'Fingerprint'; end if;
  if exists (select 1 from cron.job where jobname = 'pedidos-envio-aprovacao') then raise exception 'job já existe'; end if;
end $$;

create function public.call_pedidos_envio_aprovacao_cron(p_triggered_by text default 'pg_cron')
returns bigint
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
-- LP-ENV B (PLANO-PEDIDOS): dispara a Edge pedidos-envio-aprovacao-cron com o segredo do cron de compras.
declare
  v_secret text;
  v_request_id bigint;
  v_safe text := case when p_triggered_by in ('pg_cron', 'manual_admin', 'test') then p_triggered_by else 'pg_cron' end;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'sync_compras_cron_secret' limit 1;
  if v_secret is null then
    raise exception 'Secret sync_compras_cron_secret não encontrado no Vault';
  end if;
  select net.http_post(
    url := 'https://hbtggrbauguukewiknew.supabase.co/functions/v1/pedidos-envio-aprovacao-cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('triggered_by', v_safe),
    timeout_milliseconds := 150000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke execute on function public.call_pedidos_envio_aprovacao_cron(text) from public, anon, authenticated;

select cron.schedule('pedidos-envio-aprovacao', '10 10-23 * * 1-5',
  $cron$ select public.call_pedidos_envio_aprovacao_cron('pg_cron'); $cron$);
