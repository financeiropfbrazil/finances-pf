-- Rollback do VND-4 (correção): volta a lista de 05/11/2026 (sem 'nf_saida').
-- Só funciona se não houver linha com job_type = 'nf_saida' em sync_runs;
-- se houver, decidir com o Pedro antes (apagar essas linhas é DELETE em tabela compartilhada).
alter table public.sync_runs drop constraint sync_runs_job_type_check;
alter table public.sync_runs add constraint sync_runs_job_type_check
  check (job_type = any (array[
    'requisicoes'::text, 'pedidos'::text, 'bicephalous'::text, 'despesas'::text,
    'docfin_despesas'::text, 'nfe'::text, 'intercompany'::text, 'lote'::text,
    'produtos'::text, 'laudos'::text, 'reqmat'::text, 'estoque'::text,
    'parcelas_pagar'::text, 'nfse_adn'::text]));
