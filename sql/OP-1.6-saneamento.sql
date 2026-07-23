-- =====================================================================
-- OP-1.6 · SANEAMENTO PRÉ-GO-LIVE · SQL Editor (hbtggrbauguukewiknew)
-- Remove TODAS as op_ordens (todas são de TESTE da Fase 1) + reset do contador
-- para 500, de modo que a PRIMEIRA OP REAL de produção nasça como 2026-0501.
--
-- DECISÃO DO PEDRO (23/07/2026). Aplicar SÓ DEPOIS de fechar o checklist residual
-- da OP-1.6 (a bateria ainda cria a 2026-0503 de teste — este saneamento a apaga
-- junto com as demais).
--
-- PROTOCOLO: copiar DO ARQUIVO, nunca do terminal (linhas longas corrompem).
-- Sem números fixos: apaga TUDO em op_ordens. As FKs de op_ordem_itens e
-- op_status_historico são ON DELETE CASCADE (a exclusão de op_ordens já limparia
-- as filhas); os deletes explícitos abaixo são redundância defensiva + clareza.
-- =====================================================================

-- 1) DRY-RUN — rode ANTES e confirme que são SÓ OPs de teste (motivo/valores):
select o.numero, o.status, o.motivo_cancelamento, o.emitido_depto,
       (select count(*) from public.op_ordem_itens i where i.op_id = o.id) as itens,
       (select count(*) from public.op_status_historico h where h.op_id = o.id) as eventos,
       o.created_at
from public.op_ordens o
order by o.numero;

select 'total_op_ordens' as k, count(*)::text as v from public.op_ordens
union all
select 'op_numeracao_2026_antes', ultimo::text from public.op_numeracao where ano = 2026;

-- 2) SANEAMENTO — transação atômica (tudo ou nada):
begin;
  delete from public.op_status_historico;
  delete from public.op_ordem_itens;
  delete from public.op_ordens;
  update public.op_numeracao set ultimo = 500 where ano = 2026;
commit;

-- 3) VERIFICAÇÃO — esperado: op_ordens=0, op_ordem_itens=0, op_status_historico=0, contador=500:
select 'op_ordens' as t, count(*)::text as n from public.op_ordens
union all select 'op_ordem_itens', count(*)::text from public.op_ordem_itens
union all select 'op_status_historico', count(*)::text from public.op_status_historico
union all select 'op_numeracao_2026', ultimo::text from public.op_numeracao where ano = 2026;

-- =====================================================================
-- Sem ROLLBACK: a operação é o próprio "reset". Se precisar reverter ANTES do
-- commit, use `rollback;` no lugar do `commit;`. Depois de commitado, os dados
-- de teste deixam de existir por definição (é o objetivo).
-- =====================================================================
