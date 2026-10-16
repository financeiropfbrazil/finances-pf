-- =====================================================================
-- NFSE-0.3 — sync_runs passa a aceitar job_type = 'nfse_adn'
-- Projeto: hbtggrbauguukewiknew (Financial Hub). Registro no PLANO-NFSE.md.
--
-- Problema (medido em 16/10/2026): sync_runs tem
--   CHECK (job_type = ANY (ARRAY['requisicoes', …, 'parcelas_pagar']))
-- sem tipo de NFS-e. A Edge nfse-adn-sonda falharia já no insert que abre a
-- execução — e sem sync_runs a sonda não deixa rastro do que fez.
--
-- O que faz (UMA transação; qualquer falha desfaz tudo):
--   0. Pré-voo: fingerprint + o CHECK atual é exatamente o medido (md5).
--   1. Troca o CHECK pelo mesmo, com 'nfse_adn' no fim da lista. Nenhum valor sai.
--   2. Confere: a definição nova é a antiga + 'nfse_adn'; aceita 'nfse_adn',
--      continua recusando tipo desconhecido (teste em savepoint, nada fica gravado).
--
-- Nome do tipo: 'nfse_adn' (não 'nfse_adn_sonda'): a sonda é a fase 0 do
-- importador — o sync da Fase 1 continua no mesmo tipo.
--
-- Efeito em produção: sync_runs é usada por todos os syncs. O ALTER segura um
-- lock exclusivo por milissegundos (17,8 mil linhas, 7,7 MB). lock_timeout de 5 s:
-- se algum sync estiver gravando, a transação desiste em vez de enfileirar os
-- outros — basta rodar de novo. Evitar 06h40 e 09h40 (sync-parcelas-pagar
-- diário) e o minuto :55 (rastreio-compras-refresh).
-- Rollback: NFSE-0.3-sync-runs-rollback.sql.
-- =====================================================================

begin;
set local lock_timeout = '5s';

-- ── 0. Pré-voo ───────────────────────────────────────────────────────
do $$
declare v_def text;
begin
  if (select count(*) from public.compras_pedidos) < 2000
     or to_regclass('public.intercompany_invoices_master_blocos_manual') is null
     or to_regclass('public.nfse_adn_doc') is null then
    raise exception 'PRÉ-VOO: este banco não parece o Financial Hub com a NFSE-0.2 aplicada. Nada foi alterado.';
  end if;
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conrelid = 'public.sync_runs'::regclass and conname = 'sync_runs_job_type_check';
  if v_def is null or md5(v_def) <> 'dbd3f916fabb656f8d0e11b1df9d5dd5' then
    raise exception 'PRÉ-VOO: sync_runs_job_type_check mudou desde 16/10 (ou já tem nfse_adn): %', v_def;
  end if;
  -- guarda a definição antiga para a conferência do passo 2
  perform set_config('nfse03.check_antigo', v_def, true);
end $$;

-- ── 1. CHECK com 'nfse_adn' ──────────────────────────────────────────
alter table public.sync_runs drop constraint sync_runs_job_type_check;
alter table public.sync_runs add constraint sync_runs_job_type_check check (job_type = any (array[
  'requisicoes'::text, 'pedidos'::text, 'bicephalous'::text, 'despesas'::text, 'docfin_despesas'::text,
  'nfe'::text, 'intercompany'::text, 'lote'::text, 'produtos'::text, 'laudos'::text, 'reqmat'::text,
  'estoque'::text, 'parcelas_pagar'::text,
  'nfse_adn'::text   -- NFSE-0.3: sonda/sync do ADN da NFS-e Nacional
]));

-- ── 2. Conferência ───────────────────────────────────────────────────
do $$
declare
  v_antigo   text := current_setting('nfse03.check_antigo');
  v_novo     text;
  v_esperado text;
begin
  select pg_get_constraintdef(oid) into v_novo
    from pg_constraint where conrelid = 'public.sync_runs'::regclass and conname = 'sync_runs_job_type_check';
  v_esperado := replace(v_antigo, '''parcelas_pagar''::text]', '''parcelas_pagar''::text, ''nfse_adn''::text]');
  if v_esperado = v_antigo or v_novo is distinct from v_esperado then
    raise exception 'CONFERÊNCIA: o CHECK novo não é o antigo + nfse_adn. Novo: % | Esperado: %', v_novo, v_esperado;
  end if;
end $$;

savepoint teste_check;
insert into public.sync_runs (triggered_by, job_type, observacao, finished_at)
values ('test', 'nfse_adn', 'NFSE-0.3: teste do CHECK (desfeito no savepoint)', now());
do $$
begin
  begin
    insert into public.sync_runs (triggered_by, job_type) values ('test', 'tipo_que_nao_existe');
    raise exception 'CONFERÊNCIA: o CHECK aceitou um tipo desconhecido.';
  exception when check_violation then
    null;   -- esperado
  end;
end $$;
rollback to savepoint teste_check;

do $$
begin
  if exists (select 1 from public.sync_runs where job_type = 'nfse_adn') then
    raise exception 'CONFERÊNCIA: sobrou linha de teste em sync_runs. Transação desfeita.';
  end if;
end $$;

commit;
