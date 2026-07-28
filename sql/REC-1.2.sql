-- =============================================================================
-- REC-1.2 · sync_runs: estender CHECK de job_type para aceitar 'laudos'
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- APLICADO em 28/07/2026 no SQL Editor (fingerprint compras_pedidos = 1720).
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
--
-- MOTIVO
-- A Edge Function sync-laudos (REC-1.1) falhava no PASSO ZERO, antes de qualquer
-- chamada ao Alvo:
--   ERROR 23514 — new row for relation "sync_runs" violates check constraint
--   "sync_runs_job_type_check"
--   Failing row: (..., 'manual_admin', 'laudos', 0, 0, 0, 0, ...)
--
-- `public.sync_runs.job_type` tem CHECK ENUMERADO. A tabela é compartilhada por
-- todos os syncs do Hub. ⇒ REGRA: todo sync NOVO precisa estender esta constraint
-- ANTES do primeiro disparo, senão falha ao abrir o registro de execução.
--
-- Nota: existe também `sync_runs_triggered_by_check`, restrito a
-- ('pg_cron','manual_admin','test'). A Edge Function já sanitiza esse valor.
--
-- SEGURANÇA
-- - ADITIVO: os 9 valores originais preservados, na mesma ordem. Só entra 'laudos'.
-- - TRANSAÇÃO OBRIGATÓRIA: a tabela é gravada por 7 crons ativos; sem o
--   begin/commit a tabela ficaria sem CHECK entre o drop e o add.
-- - Conferir a saída do SELECT antes do COMMIT. Se algo divergir: ROLLBACK.
-- =============================================================================

begin;

alter table public.sync_runs
  drop constraint sync_runs_job_type_check;

alter table public.sync_runs
  add constraint sync_runs_job_type_check
  check (job_type = any (array[
    'requisicoes'::text,
    'pedidos'::text,
    'bicephalous'::text,
    'despesas'::text,
    'docfin_despesas'::text,
    'nfe'::text,
    'intercompany'::text,
    'lote'::text,
    'produtos'::text,
    'laudos'::text          -- << único valor novo (REC-1.2, 28/07/2026)
  ]));

-- CONFERIR ANTES DO COMMIT: deve listar os 10 valores acima.
select pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = 'public.sync_runs'::regclass
  and conname = 'sync_runs_job_type_check';

commit;


-- =============================================================================
-- VERIFICAÇÃO (rodar DEPOIS de aplicar)
-- =============================================================================
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid='public.sync_runs'::regclass and contype='c';
--
--   -- nenhum job existente pode ter sido invalidado
--   select job_type, count(*) from sync_runs group by 1 order by 1;
--
--   -- teste real: dispara o sync e confere que o registro abre
--   select public.call_sync_laudos_cron('manual_admin');
--   select started_at, duracao_ms, total_candidatos, total_consultados,
--          total_erros, observacao
--     from sync_runs where job_type='laudos'
--    order by started_at desc limit 3;


-- =============================================================================
-- ROLLBACK (volta aos 9 valores originais)
-- =============================================================================
--   begin;
--   alter table public.sync_runs drop constraint sync_runs_job_type_check;
--   alter table public.sync_runs
--     add constraint sync_runs_job_type_check
--     check (job_type = any (array[
--       'requisicoes'::text,'pedidos'::text,'bicephalous'::text,'despesas'::text,
--       'docfin_despesas'::text,'nfe'::text,'intercompany'::text,'lote'::text,
--       'produtos'::text
--     ]));
--   commit;
--   -- ⚠ Só é seguro se NÃO houver linhas com job_type='laudos' em sync_runs.
--   --    Conferir antes:  select count(*) from sync_runs where job_type='laudos';
