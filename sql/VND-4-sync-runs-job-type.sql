-- =====================================================================
-- VND-4 (correção) — liberar job_type 'nf_saida' em public.sync_runs
-- Motivo: a 1ª chamada autenticada da Edge sync-nf-saida-cron (05/11/2026,
-- net request 36143) falhou com 23514 em sync_runs_job_type_check: a lista
-- de tipos é fechada. Nada foi gravado (0 runs, 0 notas).
-- Muda SÓ a lista do CHECK: acrescenta 'nf_saida' ao fim; as 14 entradas
-- atuais ficam iguais, na mesma ordem. Uma transação (apply_migration).
-- Rollback: sql/VND-4-sync-runs-job-type-rollback.sql
-- =====================================================================
alter table public.sync_runs drop constraint sync_runs_job_type_check;
alter table public.sync_runs add constraint sync_runs_job_type_check
  check (job_type = any (array[
    'requisicoes'::text, 'pedidos'::text, 'bicephalous'::text, 'despesas'::text,
    'docfin_despesas'::text, 'nfe'::text, 'intercompany'::text, 'lote'::text,
    'produtos'::text, 'laudos'::text, 'reqmat'::text, 'estoque'::text,
    'parcelas_pagar'::text, 'nfse_adn'::text,
    'nf_saida'::text]));
