-- =====================================================================
-- SQL-RECONCILIACAO-0004869.sql
-- ⛔ NÃO COLE OS BLOCOS DE ESCRITA — ESTE ARQUIVO FICOU OBSOLETO
-- =====================================================================
-- Reescrito em 08/09/2026 ~14h25 BRT, depois que o estado mudou.
--
-- A versão anterior deste arquivo (commit dc1c979) fazia
--   update compras_pedidos ... where numero='0004869'
-- e isso **não funciona mais**: a linha do pedido 0004869 foi EXCLUÍDA do Hub.
-- Colar aquele SQL afetaria 0 linhas — inofensivo, mas inútil.
--
-- =====================================================================
-- 1. O QUE MUDOU
-- =====================================================================
-- O pedido 0004869 foi apagado do Hub pela tela (a lista permite excluir
-- pedidos em `rascunho` / `erro_envio`). No ERP ele **continua existindo** —
-- confirmado pelo Pedro: é o pedido criado a partir da requisição 0001464,
-- R$ 3.880, fornecedor OLIVEIRA E OLIVEIRA, e o timeout estourou depois de o
-- Alvo gravar.
--
-- 🔴 **A exclusão levou a auditoria junto.** A FK é
--    `compras_pedidos_auditoria.pedido_id … ON DELETE CASCADE`,
-- e os 7 eventos do pedido (incluindo o `Default_CommandTimeout` das 14:07:25 e
-- o `PROTEGIDO_APROVACAO` das 14:08:11) **não existem mais no banco**. Medido:
-- 0 linhas de auditoria mencionando 0004869, 0 linhas órfãs.
-- É o mesmo risco que fez a reconciliação do 0001480 preservar a linha fantasma
-- em vez de apagá-la. **Excluir pedido no Hub destrói a trilha — inclusive de
-- pedido que existe no ERP.**
--
-- =====================================================================
-- 2. NÃO É PRECISO SQL: O SYNC SE REPARA SOZINHO
-- =====================================================================
-- O Job 3 (descoberta de pedidos) vai encontrar 0004869 no `/ped-comp/list` e
-- recriar a linha. E, como a baixa da requisição foi feita no ERP às 14:08:10,
-- o list traz `NumeroReqComp = 0001464` — então o vínculo volta dos DOIS lados,
-- sem intervenção:
--
--   • lado do pedido   → `index.ts:1473-1477`: grava `numero_req_comp`,
--     `codigo_empresa_filial_req_comp` e `vinculo_requisicao = 'com_vinculo'`;
--   • lado da requisição → `index.ts:1524-1541`: se
--     `numero_pedido_compra_alvo` estiver NULL (é o caso), grava '0004869'.
--
-- ⚠️ Detalhe que explica por que isso funciona no sync e falhava na tela: o Job 3
-- usa **o mesmo `upsert`** que causou o PROTEGIDO_APROVACAO no navegador. Ele
-- passa porque a Edge roda como `service_role`, e `fn_req_protege_aprovacao` só
-- atua sobre `authenticated`/`anon`. O defeito sempre foi exclusivo do caminho do
-- navegador — por isso o sync vinha vinculando 257 requisições sem problema.
--
-- =====================================================================
-- 3. O QUE FAZER
-- =====================================================================
-- a) **Publique a correção** (commit cd31e11, já em origin/main). Sem isso, toda
--    nova criação de pedido a partir de requisição continua falhando.
-- b) **Não cole SQL de escrita para este caso.** Espere um ciclo do cron
--    (hora cheia, 08h–17h BRT) e rode a conferência abaixo.
-- c) Se depois de dois ciclos o pedido não voltar, aí sim me chame: aí é
--    problema de descoberta, e o SQL será outro.
--
-- =====================================================================
-- CONFERÊNCIA (somente leitura) — rodar depois do próximo ciclo
-- =====================================================================
-- Esperado quando o sync tiver rodado:
--   ped_status = 'sincronizado' · ped_origem = false (descoberto)
--   ped_req = '0001464' · ped_vinculo = 'com_vinculo'
--   req_vinculo = '0004869'   ← o elo dos dois lados, restaurado sozinho
--
-- Enquanto vier tudo NULL, o ciclo ainda não passou pelo pedido.

select
  (select status_local::text  from public.compras_pedidos where numero='0004869') as ped_status,
  (select criado_no_hub       from public.compras_pedidos where numero='0004869') as ped_origem,
  (select numero_req_comp     from public.compras_pedidos where numero='0004869') as ped_req,
  (select vinculo_requisicao  from public.compras_pedidos where numero='0004869') as ped_vinculo,
  (select valor_total         from public.compras_pedidos where numero='0004869') as ped_valor,
  (select numero_pedido_compra_alvo from public.compras_requisicoes
    where numero_alvo='0001464')                                                  as req_vinculo,
  (select status from public.compras_requisicoes where numero_alvo='0001464')     as req_status,
  (select to_char(max(started_at) at time zone 'America/Sao_Paulo','DD/MM HH24:MI')
     from public.sync_runs where job_type='bicephalous')                          as ultimo_ciclo;


-- =====================================================================
-- VIGIAR O 0004868 (somente leitura)
-- =====================================================================
-- Este continua em aberto e é o único ponto que exige o ERP.
-- A PRIMEIRA tentativa (a do `Default_CommandTimeout`, 14:07:25) consumiu o
-- número 0004868. O 0004869 saiu da SEGUNDA tentativa, que falhou por
-- PROTEGIDO_APROVACAO — ou seja, a confirmação de que "o timeout estourou depois
-- de gravar" se aplica ao 0004869, mas **não responde pelo 0004868**.
--
-- Se 0004868 existir no ERP, é um pedido fantasma de R$ 3.880 — duplicata do
-- 0004869 — e precisa ser cancelado lá. Se não existir, o Alvo só consumiu a
-- numeração.
--
-- Se esta query devolver 1 linha, o documento existe e o sync o descobriu.

select numero, status_local::text, criado_no_hub, valor_total,
       to_char(created_at at time zone 'America/Sao_Paulo','DD/MM HH24:MI') as descoberto_brt,
       left(coalesce(nome_entidade,''),35) as fornecedor, numero_req_comp
  from public.compras_pedidos
 where numero = '0004868';
