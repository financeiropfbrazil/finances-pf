-- =====================================================================
-- LR-PAG · Fase 2 — fim do laço do cron do passo NF (sync-parcelas-pagar)
-- Projeto: hbtggrbauguukewiknew (Financial Hub). Registro no PLANO-PEDIDOS.md.
--
-- Problema (medido em 15/10/2026): quando o Alvo recusa um item com código
-- diferente de 404/412, o item fica na fila e o cron de 3 em 3 min chama a
-- Edge de novo, sem limite. Em 14/10, NFs 21121/21125/21128 com HTTP 417:
-- 157 execuções com erro entre 01:03 e 08:48.
--
-- O que faz (UMA transação; qualquer falha desfaz tudo):
--   0. Pré-voo: fingerprint + portão e job 31 iguais aos analisados.
--   1. Cria rastreio_tentativa: por (etapa, item), quantas falhas, quando
--      tentar de novo e o último erro. Quem grava é a Edge v9.
--   2. O portão (call_sync_parcelas_pagar_nf_cron) passa a ignorar itens em
--      espera (proxima_em no futuro) ou estacionados (5+ falhas). Sem isso,
--      a fila "não vazia" continuaria disparando a Edge a cada 3 min.
--   3. Renomeia o job 31 ("…-nf-noturno", que roda o dia todo) para
--      "sync-parcelas-pagar-nf-fila": mesma agenda, mesmo comando.
--
-- Não toca em nenhuma view (as 3 views da MV seguem com o md5 da Fase 1).
-- Compatível com a Edge v8: com a tabela vazia, o portão age como antes.
-- Rollback: F2-rollback.sql.
-- =====================================================================

begin;

-- ── 0. Pré-voo ───────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000
     or to_regclass('public.intercompany_invoices_master_blocos_manual') is null
     or to_regclass('public.mv_rastreio_compras') is null then
    raise exception 'PRÉ-VOO: este banco não parece o Financial Hub (hbtggrbauguukewiknew). Nada foi alterado.';
  end if;
  if to_regclass('public.rastreio_tentativa') is not null then
    raise exception 'PRÉ-VOO: rastreio_tentativa já existe (execução anterior?). Ver F2-rollback.sql.';
  end if;
  if md5(pg_get_functiondef('public.call_sync_parcelas_pagar_nf_cron(text)'::regprocedure)) <> '3f2be704c9cce8ae79e4abda627eba9e' then
    raise exception 'PRÉ-VOO: o portão call_sync_parcelas_pagar_nf_cron mudou desde a análise de 15/10.';
  end if;
  if not exists (select 1 from cron.job where jobid = 31 and jobname = 'sync-parcelas-pagar-nf-noturno'
                   and schedule = '*/3 * * * *' and active
                   and btrim(command) = 'select public.call_sync_parcelas_pagar_nf_cron(''pg_cron'');') then
    raise exception 'PRÉ-VOO: o job 31 não está como analisado (nome/agenda/comando).';
  end if;
  if exists (select 1 from cron.job where jobname = 'sync-parcelas-pagar-nf-fila') then
    raise exception 'PRÉ-VOO: já existe job com o nome novo.';
  end if;
end $$;

-- ── 1. Tentativas por item ───────────────────────────────────────────
create table public.rastreio_tentativa (
  etapa            text        not null check (etapa in ('P', 'B1', 'B2')),
  chave            text        not null,
  tentativas       integer     not null default 0,
  proxima_em       timestamptz,
  ultimo_erro      text,
  primeiro_erro_em timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  primary key (etapa, chave)
);
comment on table public.rastreio_tentativa is
  'LR-PAG F2: falhas por item do passo NF do sync-parcelas-pagar-cron (P = pedido, B1 = chave_docfin, B2 = chave_movestq). '
  'Espera 15 min, 1 h, 6 h e 24 h após a 1ª a 4ª falha; com 5 falhas o item fica estacionado (não é mais tentado). '
  'Sucesso apaga a linha. Para liberar um item estacionado: delete da linha.';
alter table public.rastreio_tentativa enable row level security;
-- Só a Edge (service_role) escreve; ninguém do app lê. O default do Supabase daria tudo a anon/authenticated.
revoke all on public.rastreio_tentativa from public, anon, authenticated;
grant all on public.rastreio_tentativa to service_role;
grant select on public.rastreio_tentativa to klaus_readonly;

-- ── 2. Portão ignora itens em espera ou estacionados ─────────────────
-- create or replace mantém o ACL de hoje (postgres e service_role).
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
  -- Itens em espera ou estacionados (rastreio_tentativa, LR-PAG F2) não contam:
  -- sem isso, um item que o Alvo recusa dispararia a função a cada 3 min.
  if not exists (select 1 from public.fin_parcelas_pagar f
                 where f.origem = 'Estoque' and f.load_em is null
                   and not exists (select 1 from public.rastreio_tentativa t
                                   where t.etapa = 'B1' and t.chave = f.chave_docfin::text
                                     and (t.tentativas >= 5 or t.proxima_em > now())))
     and not exists (select 1 from public.v_rastreio_nf_pendentes p
                     where not exists (select 1 from public.rastreio_tentativa t
                                       where t.etapa = 'B2' and t.chave = p.chave_movestq::text
                                         and (t.tentativas >= 5 or t.proxima_em > now())))
     and not exists (select 1 from public.v_rastreio_pedido_fila p
                     where not exists (select 1 from public.rastreio_tentativa t
                                       where t.etapa = 'P' and t.chave = p.pedido_numero
                                         and (t.tentativas >= 5 or t.proxima_em > now()))) then
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

-- ── 3. Job com nome que diz o que faz ────────────────────────────────
select cron.schedule('sync-parcelas-pagar-nf-fila', '*/3 * * * *',
                     $cmd$ select public.call_sync_parcelas_pagar_nf_cron('pg_cron'); $cmd$);
select cron.unschedule(31);

-- ── 4. Conferência dentro da transação ───────────────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.rastreio_tentativa', 'select')
     or has_table_privilege('authenticated', 'public.rastreio_tentativa', 'select')
     or has_function_privilege('anon', 'public.call_sync_parcelas_pagar_nf_cron(text)', 'execute') then
    raise exception 'ACESSOS: anon/authenticated ficaram com acesso indevido. Transação desfeita.';
  end if;
  if exists (select 1 from cron.job where jobid = 31)
     or not exists (select 1 from cron.job where jobname = 'sync-parcelas-pagar-nf-fila'
                      and schedule = '*/3 * * * *' and active
                      and btrim(command) = 'select public.call_sync_parcelas_pagar_nf_cron(''pg_cron'');') then
    raise exception 'CRON: a troca de nome do job não ficou como esperado. Transação desfeita.';
  end if;
end $$;

commit;
