-- =====================================================================
-- SQL-RECONCILIACAO-0004869.sql
-- Pedido 0004869 (Elisangela) x requisição 0001464
-- =====================================================================
-- Gerado em 08/09/2026, ~14h30 BRT. MCP read-only: NADA executado por mim.
--
-- ⚠️ ANTES DE COLAR ISTO: PUBLIQUE A CORREÇÃO.
-- A trilha deste pedido mostra que o código em produção ainda é o ANTIGO:
--   14:08:11  envio_falha  "Erro ao vincular o pedido 0004869 à requisição:
--                           PROTEGIDO_APROVACAO"
-- O commit cd31e11 está no origin/main, mas o Publish do Lovable é manual.
-- Enquanto não publicar, TODA nova tentativa de criar pedido a partir de
-- requisição continua criando documento no ERP e falhando — reconciliar sem
-- publicar é enxugar gelo.
--
-- =====================================================================
-- O QUE ACONTECEU (trilha completa, compras_pedidos_auditoria)
-- =====================================================================
--   14:07:03  criado_hub      pedido nasce como rascunho
--   14:07:07  envio_tentado   1ª tentativa
--   14:07:25  envio_falha     Default_CommandTimeout  ← 18 s, timeout DO ALVO
--   14:07:59  editado_hub     a pessoa editou e tentou de novo
--   14:08:02  envio_tentado   2ª tentativa
--   14:08:10  req_baixada     baixa da requisição no ERP: OK
--   14:08:11  envio_falha     PROTEGIDO_APROVACAO  ← o defeito antigo, de novo
--
-- Estado atual: pedido 0004869, status_local='erro_envio', numero preservado,
-- status no Alvo 'Aberto', valor 3.880,00, fornecedor OLIVEIRA E OLIVEIRA.
-- Requisição 0001464: 'sincronizada', numero_pedido_compra_alvo NULL.
--
-- ⚠️ O NÚMERO 0004868 NÃO EXISTE NO HUB. A 1ª tentativa (a do timeout)
-- consumiu esse número no Alvo. Duas leituras possíveis, e nenhuma informação
-- no Hub as separa:
--   (a) o Alvo CRIOU o documento 0004868 e o timeout ocorreu depois de gravar
--       → há um pedido fantasma de R$ 3.880 no ERP, a cancelar;
--   (b) o Alvo abortou e apenas consumiu a numeração
--       → buraco na sequência, sem documento.
-- **Confira 0004868 no ERP antes de encerrar o caso.** O próximo ciclo do sync
-- também responde sozinho: se o documento existir, o Job 3 vai descobri-lo
-- (foi o que aconteceu com o 0004867 às 13:00).
-- Este SQL NÃO mexe no 0004868 — só no 0004869, que é certo.
-- =====================================================================


-- =====================================================================
-- BLOCO 0 — PRÉ-VOO (somente leitura)
-- =====================================================================
-- Esperado:
--   ped_status='erro_envio' · ped_numero='0004869' · req_status='sincronizada'
--   req_vinculo=NULL · ped_0004868_no_hub=0 · duplicidade_numero=0
-- Se `req_vinculo` já vier preenchido, PARE: alguém reconciliou antes.

select
  (select status_local::text from public.compras_pedidos where numero='0004869')      as ped_status,
  (select numero from public.compras_pedidos where numero='0004869')                  as ped_numero,
  (select numero_req_comp from public.compras_pedidos where numero='0004869')         as ped_req,
  (select status from public.compras_requisicoes where numero_alvo='0001464')         as req_status,
  (select numero_pedido_compra_alvo from public.compras_requisicoes
    where numero_alvo='0001464')                                                      as req_vinculo,
  (select count(*) from public.compras_pedidos where numero='0004868')                as ped_0004868_no_hub,
  (select count(*) from (select codigo_empresa_filial, numero from public.compras_pedidos
                          group by 1,2 having count(*)>1) d)                          as duplicidade_numero;


-- =====================================================================
-- BLOCO 1 — RECONCILIAÇÃO (transação única)
-- =====================================================================
-- Não usa a RPC `vincular_pedido_requisicao`: ela recusa pedido que já tenha
-- `numero_req_comp` ("Este pedido já está vinculado à requisição %"), e este
-- tem '0001464' desde a criação. Escrita direta é segura aqui — no SQL Editor
-- você é `postgres`, e `fn_req_protege_aprovacao` só atua sobre
-- authenticated/anon; `fn_req_congelar_conteudo` exige
-- `aprovacao_submetida_em` não nulo, que nesta requisição é NULL.
-- `compras_pedidos` não tem trigger nenhum.
--
-- NENHUM Insert é repetido no ERP: o documento 0004869 já existe lá.
--
-- Esperado: 1 linha em cada returning; resultado final no BLOCO 2.

begin;

-- 1.1 — conclui o pedido: sai de erro_envio, limpa o erro, marca o vínculo
update public.compras_pedidos
   set status_local = 'enviado_alvo',
       erro_envio = null,
       vinculo_requisicao = 'com_vinculo',
       vinculo_atualizado_em = now(),
       vinculo_atualizado_por = 'Reconciliação manual — Pedro',
       vinculo_ultima_acao = 'vinculado',
       updated_at = now()
 where numero = '0004869'
   and codigo_empresa_filial = '1.01'
   and status_local::text = 'erro_envio'
returning numero, status_local, numero_req_comp, vinculo_requisicao;

-- 1.2 — grava o vínculo do lado da requisição (o que o PROTEGIDO_APROVACAO impediu)
update public.compras_requisicoes
   set numero_pedido_compra_alvo = '0004869',
       vinculo_atualizado_em = now(),
       vinculo_atualizado_por = 'Reconciliação manual — Pedro',
       vinculo_ultima_acao = 'vinculado',
       updated_at = now()
 where numero_alvo = '0001464'
   and numero_pedido_compra_alvo is null
returning id, numero_alvo, status, numero_pedido_compra_alvo;

-- 1.3 — auditoria do lado do pedido
insert into public.compras_pedidos_auditoria
  (pedido_id, evento, user_id, user_nome, sucesso, payload_enviado, mensagem_erro)
select p.id, 'vinculado_requisicao', null, 'Reconciliação manual — Pedro', true,
       jsonb_build_object(
         'acao','reconciliacao manual',
         'pedido','0004869','requisicao','0001464',
         'causa','Insert concluido no Alvo (documento Aberto, R$ 3.880). O Hub falhou ao gravar o vinculo com PROTEGIDO_APROVACAO, porque a versao em producao ainda usa upsert em compras_requisicoes (corrigido em cd31e11, pendente de Publish).',
         'primeira_tentativa','Default_CommandTimeout as 14:07:25; numero 0004868 consumido no Alvo e NAO presente no Hub — conferir no ERP',
         'sem_novo_insert', true),
       'Reconciliacao manual: vinculo gravado sem repetir Insert no ERP.'
  from public.compras_pedidos p
 where p.numero = '0004869' and p.codigo_empresa_filial = '1.01';

-- 1.4 — auditoria do lado da requisição
insert into public.compras_requisicoes_auditoria
  (requisicao_id, evento, user_id, user_nome, sucesso, payload_enviado, mensagem_erro)
select r.id, 'vinculado_pedido', null, 'Reconciliação manual — Pedro', true,
       jsonb_build_object(
         'acao','reconciliacao manual',
         'pedido','0004869','requisicao','0001464','sem_novo_insert', true),
       'Reconciliacao manual do pedido 0004869, que ja existia no ERP.'
  from public.compras_requisicoes r
 where r.numero_alvo = '0001464';

commit;


-- =====================================================================
-- BLOCO 2 — CONFERÊNCIA (somente leitura)
-- =====================================================================
-- Esperado:
--   ped_status='enviado_alvo' · ped_erro=NULL · ped_vinculo='com_vinculo'
--   req_vinculo='0004869' · req_status='sincronizada' (inalterado)
--   auditoria_pedido = 8 eventos (eram 7)
--   pedidos_em_erro_envio = 0  — os casos da manhã já foram tratados por você
--   (0004865 e RASCUNHO-a28ae319 excluídos; 0004867 marcado 'sem_vinculo'),
--   então este era o último em erro_envio.

select
  (select status_local::text from public.compras_pedidos where numero='0004869')        as ped_status,
  (select erro_envio from public.compras_pedidos where numero='0004869')                as ped_erro,
  (select vinculo_requisicao from public.compras_pedidos where numero='0004869')        as ped_vinculo,
  (select numero_pedido_compra_alvo from public.compras_requisicoes
    where numero_alvo='0001464')                                                        as req_vinculo,
  (select status from public.compras_requisicoes where numero_alvo='0001464')           as req_status,
  (select count(*) from public.compras_pedidos_auditoria a
     join public.compras_pedidos p on p.id=a.pedido_id where p.numero='0004869')        as auditoria_pedido,
  (select count(*) from public.compras_pedidos where status_local::text='erro_envio')   as pedidos_em_erro_envio;

-- Trilha final do pedido, em ordem.
select to_char(a.created_at at time zone 'America/Sao_Paulo','DD/MM HH24:MI:SS') as brt,
       a.evento, a.sucesso, coalesce(a.user_nome,'(sistema)') as quem,
       left(coalesce(a.mensagem_erro,''),90) as mensagem
  from public.compras_pedidos_auditoria a
  join public.compras_pedidos p on p.id = a.pedido_id
 where p.numero = '0004869'
 order by a.created_at;


-- =====================================================================
-- BLOCO 3 — VIGIAR O 0004868 (somente leitura, rodar depois de um ciclo)
-- =====================================================================
-- Se voltar 1 linha, o documento EXISTE no Alvo e foi criado pela tentativa que
-- deu timeout: é pedido fantasma de R$ 3.880 a cancelar no ERP (decisão sua).
-- Se continuar 0 depois de alguns ciclos, o Alvo só consumiu a numeração.

select numero, status_local::text, criado_no_hub, valor_total,
       to_char(created_at at time zone 'America/Sao_Paulo','DD/MM HH24:MI') as descoberto_brt,
       left(coalesce(nome_entidade,''),35) as fornecedor
  from public.compras_pedidos
 where numero = '0004868';


-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- O BLOCO 1 é atômico. Se precisar desfazer depois de aplicado:
--
--   update public.compras_pedidos
--      set status_local='erro_envio', vinculo_requisicao='nao_verificado',
--          vinculo_atualizado_em=null, vinculo_atualizado_por=null,
--          vinculo_ultima_acao=null, updated_at=now()
--    where numero='0004869';
--
--   update public.compras_requisicoes
--      set numero_pedido_compra_alvo=null, vinculo_atualizado_em=null,
--          vinculo_atualizado_por=null, vinculo_ultima_acao=null, updated_at=now()
--    where numero_alvo='0001464';
--
-- Não apague os eventos de auditoria: a trilha do que foi feito deve sobreviver.
-- =====================================================================
