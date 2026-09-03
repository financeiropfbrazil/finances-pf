-- =====================================================================
-- SQL S1.1 — alinhar o CHECK de eventos da auditoria de requisições ao código
-- Missão Sync de Pedidos · pré-requisito do gate de saída da §4
-- Gerado em 03/09/2026. NÃO EXECUTADO pelo agente (MCP read-only).
-- =====================================================================
--
-- POR QUE ISTO ENTROU NUMA SESSÃO SOBRE PEDIDOS
-- ---------------------------------------------
-- A §4 do AJUSTE-S1.1 exige deploy da Edge Function, e a versão publicada está
-- 2 commits atrás do `main`. Um deles, `11cbe2b` (28/08), transforma uma falha
-- SILENCIOSA de auditoria em erro CONTADO. A falha é real e acontece hoje:
--
--   • `descoberta_alvo` NÃO está no CHECK e é usado pelo Job 4 desde 26/05/2026.
--     Medido: ZERO linhas com esse evento na tabela; 69 requisições sem nenhuma
--     linha de auditoria.
--   • `sync_status` também não está no CHECK; é usado no ramo de reabertura do
--     Job 4 — o que explicou as 6 requisições do §14.2.
--
-- Sem este DDL, o deploy de `11cbe2b` faz `sync_runs.total_erros` subir ~2/dia
-- (a taxa de descoberta de requisições novas medida em 24/08 e 31/08), de forma
-- permanente. Isso **viola o gate de saída da §4** ("`sync_runs` sem falha") e,
-- pior, aposenta "zero erros" como sinal de saúde do cron.
--
-- Com este DDL aplicado ANTES do deploy, o insert passa a funcionar: a auditoria
-- volta a ser gravada e nenhum erro novo aparece.
--
-- ORDEM CORRETA:  1) rodar este SQL   2) deploy da função   3) conferir sync_runs
--
-- ⚠️ DECISÃO DO PEDRO. Este arquivo é proposta, não execução.
--    Alternativa (se preferir não mexer no CHECK agora): adiar o deploy dos dois
--    commits fazendo o deploy a partir de um branch sem eles — mais trabalhoso,
--    e deixa a falha silenciosa de pé.

-- ── 1. Estado atual (conferir antes) ─────────────────────────────────
-- Esperado: 15 valores, sem 'descoberta_alvo' e sem 'sync_status'.
select pg_get_constraintdef(oid) as check_atual
from pg_constraint
where conrelid = 'public.compras_requisicoes_auditoria'::regclass
  and contype = 'c';

-- ── 2. Confirmar que nenhum valor em uso ficaria de fora ─────────────
-- Esperado: só os 15 do CHECK (o banco não deixaria entrar outro).
select evento, count(*) linhas
from compras_requisicoes_auditoria
group by 1 order by 2 desc;

-- ── 3. O ALTER ───────────────────────────────────────────────────────
-- Acrescenta os DOIS valores que o código já usa. Nada é removido, então
-- nenhuma linha existente pode violar a nova constraint.
begin;

alter table public.compras_requisicoes_auditoria
  drop constraint compras_requisicoes_auditoria_evento_check;

alter table public.compras_requisicoes_auditoria
  add constraint compras_requisicoes_auditoria_evento_check
  check (evento = any (array[
    'criada'::text,
    'editada'::text,
    'envio_tentado'::text,
    'envio_sucesso'::text,
    'envio_falha'::text,
    'cancelada_alvo'::text,
    'convertida_pedido'::text,
    'vinculado_pedido'::text,
    'desvinculado_pedido'::text,
    'enviada_aprovacao'::text,
    'aprovada_lider'::text,
    'rejeitada_lider'::text,
    'submetida_sem_gate'::text,
    'envio_pos_aprovacao_sucesso'::text,
    'envio_pos_aprovacao_falha'::text,
    -- novos: já usados pelo Job 4 do cron
    'descoberta_alvo'::text,
    'sync_status'::text
  ]));

-- ── 4. Conferência DENTRO da transação ───────────────────────────────
-- Esperado: 17 valores, incluindo os dois novos.
select pg_get_constraintdef(oid) as check_novo
from pg_constraint
where conrelid = 'public.compras_requisicoes_auditoria'::regclass
  and contype = 'c';

-- Esperado: 0 linhas (nada existente viola).
select count(*) as linhas_violando
from compras_requisicoes_auditoria
where evento <> all (array[
  'criada','editada','envio_tentado','envio_sucesso','envio_falha','cancelada_alvo',
  'convertida_pedido','vinculado_pedido','desvinculado_pedido','enviada_aprovacao',
  'aprovada_lider','rejeitada_lider','submetida_sem_gate','envio_pos_aprovacao_sucesso',
  'envio_pos_aprovacao_falha','descoberta_alvo','sync_status'
]);

-- Se os dois SELECTs acima estiverem como esperado:
commit;
-- Se algo estiver diferente:
-- rollback;

-- ── 5. ROLLBACK depois do commit, se precisar ────────────────────────
-- Só é seguro enquanto NÃO houver linha com os eventos novos. Conferir antes:
--   select count(*) from compras_requisicoes_auditoria
--    where evento in ('descoberta_alvo','sync_status');
-- Se der 0, dá para voltar ao CHECK de 15 valores repetindo o bloco 3 sem as
-- duas últimas linhas. Se der > 0, apagar essas linhas seria perder rastro de
-- auditoria — nesse caso NÃO reverter.
