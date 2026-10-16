-- =====================================================================
-- NFSE-0.3 — ROLLBACK do CHECK de sync_runs (volta à lista de 16/10, sem 'nfse_adn').
-- Projeto: hbtggrbauguukewiknew (Financial Hub). Só com ordem do Pedro.
--
-- Se já houver execuções da sonda em sync_runs (job_type = 'nfse_adn'), o CHECK
-- antigo não pode voltar sem apagá-las — e apagar histórico não é feito aqui:
-- a transação para e mostra quantas são. Decidir com o Pedro.
-- Antes: apagar/desligar a Edge nfse-adn-sonda (senão a próxima execução falha).
-- =====================================================================

begin;
set local lock_timeout = '5s';

do $$
declare v_linhas bigint;
begin
  if (select count(*) from public.compras_pedidos) < 2000
     or to_regclass('public.intercompany_invoices_master_blocos_manual') is null then
    raise exception 'PRÉ-VOO: este banco não parece o Financial Hub (hbtggrbauguukewiknew). Nada foi alterado.';
  end if;
  select count(*) into v_linhas from public.sync_runs where job_type = 'nfse_adn';
  if v_linhas > 0 then
    raise exception 'sync_runs tem % execução(ões) nfse_adn: o CHECK antigo não volta sem apagá-las. Nada foi alterado.', v_linhas;
  end if;
end $$;

alter table public.sync_runs drop constraint sync_runs_job_type_check;
alter table public.sync_runs add constraint sync_runs_job_type_check check (job_type = any (array[
  'requisicoes'::text, 'pedidos'::text, 'bicephalous'::text, 'despesas'::text, 'docfin_despesas'::text,
  'nfe'::text, 'intercompany'::text, 'lote'::text, 'produtos'::text, 'laudos'::text, 'reqmat'::text,
  'estoque'::text, 'parcelas_pagar'::text
]));

do $$
begin
  if (select md5(pg_get_constraintdef(oid)) from pg_constraint
       where conrelid = 'public.sync_runs'::regclass and conname = 'sync_runs_job_type_check')
     <> 'dbd3f916fabb656f8d0e11b1df9d5dd5' then
    raise exception 'ROLLBACK: o CHECK não voltou idêntico ao de 16/10 (md5). Transação desfeita.';
  end if;
end $$;

commit;
