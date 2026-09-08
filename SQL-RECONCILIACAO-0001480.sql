-- =====================================================================
-- SQL-RECONCILIACAO-0001480.sql
-- Requisição do Tiago (5eb2c25e) x linha 6d096fc7 ocupando o número 0001480
-- =====================================================================
-- Gerado em 08/09/2026, 09h5x BRT. MCP read-only: NADA foi executado por mim.
--
-- ⚠️ URGENTE — LEIA ANTES DE QUALQUER COISA
-- O cron está ATIVO e o próximo ciclo é numa hora cheia (08h–17h BRT).
-- No próximo ciclo, o Job 4 vai:
--   1. pedir /req-comp/list dos últimos 30 dias (ele NÃO filtra pelo cursor);
--   2. receber 0001480 "Aberto" (o documento do Tiago);
--   3. casar por (filial|numero) com a linha 6d096fc7, que está 'cancelada';
--   4. como GerouPedComp="Não" e Status="Aberto", `reaberturaConfirmada` é
--      verdadeiro e LIBERA o rebaixamento de status terminal;
--   5. gravar 6d096fc7 como 'sincronizada'.
-- Resultado: a linha órfã (sem descrição, sem requisitante, sem itens) vira o
-- espelho do documento do Tiago, e a requisição real dele continua sem número.
-- POR ISSO O BLOCO 1 PAUSA O CRON PRIMEIRO. Não pule.
--
-- =====================================================================
-- DIAGNÓSTICO — o que a evidência mostra (e onde diverge da hipótese)
-- =====================================================================
-- A linha 6d096fc7 NÃO é resíduo do ciclo com 152 erros. Medido:
--   • criada em 07/09 08:00:05 (ciclo das 08h, que teve total_erros = 0),
--     não às 11:00; cancelada às 09:00:15, não às 12:00;
--   • evento `descoberta_alvo` COM resposta_alvo do ERP gravada, dizendo:
--       Numero 0001480 · NumeroDocumento 0001480 · Data 2026-09-07
--       DataHoraDigitacao 2026-09-07T07:59:01 · ModuloOrigem "Manual"
--       CodigoUsuario "PEDRO.SCRIGNOLI" · CodigoFuncionario 0000149
--       CodigoCentroCtrl 00010.00002.00003 · CodigoFinalidadeCompra 0000006
--       Descricao null · Status "Aberto" · Aprovada "Total"
--     Ou seja: ela ESPELHA UM DOCUMENTO REAL, criado à mão no ERP por você em
--     07/09 07:59 — a requisição 0001480 citada em `requisicao-unidades.ts`
--     ("contrato Fator comprovado por Produto/Load + ReqComp/Insert nativo").
--   • o evento `cancelada_alvo` das 09:00 tem resposta_alvo {"not_found": true}:
--     o documento SUMIU do Alvo (foi excluído lá), e o Hub espelhou como
--     'cancelada'. O Alvo nunca disse "cancelada" — disse "não existe".
--
-- CAUSA-RAIZ REAL: o Alvo REUTILIZOU o número. O documento de teste foi
-- excluído no ERP, o número 0001480 voltou ao pool, e o Insert do Tiago hoje
-- recebeu esse mesmo número. A UNIQUE (codigo_empresa_filial, numero_alvo) não
-- prevê reatribuição, e a linha do documento excluído seguiu ocupando a chave.
--
-- CAUSA-RAIZ SECUNDÁRIA (a que deixou o Tiago pendurado): o caminho de erro do
-- envio não registrou nada. A auditoria de 5eb2c25e termina em
-- `envio_reivindicado` (09:41:51); não há `envio_pos_aprovacao_falha`,
-- `erro_ultimo_envio` está null e o token continua preso. Quem falhou ao gravar
-- o número NÃO chamou `concluir_envio_requisicao` com o erro.
--
-- =====================================================================
-- ⛔ VERIFICAÇÃO HUMANA OBRIGATÓRIA ANTES DO BLOCO 3
-- =====================================================================
-- Toda a reconciliação se apoia na hipótese de reutilização de número, que é
-- extraordinária. Ela é barata de confirmar: abra 0001480 no Alvo AGORA e
-- compare. Os dois documentos são completamente diferentes.
--
--                          | 0001480 de 07/09 (antigo) | requisição do Tiago
--   DataHoraDigitacao      | 07/09/2026 07:59:01       | 08/09/2026 ~09:41
--   ModuloOrigem / usuário | "Manual" / PEDRO.SCRIGNOLI| integração
--   CodigoFuncionario      | 0000149                   | 0000167 (TIAGO F. DE CARLI)
--   CodigoCentroCtrl       | 00010.00002.00003         | 00008.00001.00003
--   CodigoFinalidadeCompra | 0000006                   | 0000003
--   Item                   | (não capturado)           | 001.014.031 MEMORIA RAM
--                          |                           | 16GB, qtd 2, UNID pos. 1
--
-- Se o 0001480 que você viu tem funcionário 0000167, CC 00008.00001.00003 e o
-- item de memória RAM  →  é o documento do Tiago: SIGA.
-- Se tem funcionário 0000149 / CC 00010.00002.00003 / digitação de 07/09
--   →  é o documento antigo: PARE. Não vincule. O número do Tiago é outro.
-- =====================================================================


-- =====================================================================
-- BLOCO 1 — PAUSAR O CRON (fazer JÁ, antes de investigar mais)
-- =====================================================================
-- Impede que o próximo ciclo ressuscite a linha 6d096fc7 como 'sincronizada'.
-- Esperado: retorno vazio (alter_job é void).

select cron.alter_job(1, active := false);

-- Conferência: esperado active = false.
select jobid, jobname, schedule, active from cron.job where jobid = 1;


-- =====================================================================
-- BLOCO 2 — PRÉ-VOO (somente leitura)
-- =====================================================================
-- Esperado exatamente:
--   real_status = 'aprovada' · real_numero = null · real_token NÃO nulo
--   fantasma_status = 'cancelada' · fantasma_numero = '0001480'
--   linhas_com_0001480 = 1 · cron_ativo = false
-- Qualquer divergência: PARE e reavalie — o estado mudou desde o diagnóstico.

select
  (select status      from public.compras_requisicoes where id='5eb2c25e-1d03-4f24-85fa-c362d35f7a1f') as real_status,
  (select numero_alvo from public.compras_requisicoes where id='5eb2c25e-1d03-4f24-85fa-c362d35f7a1f') as real_numero,
  (select envio_token from public.compras_requisicoes where id='5eb2c25e-1d03-4f24-85fa-c362d35f7a1f') as real_token,
  (select status      from public.compras_requisicoes where id='6d096fc7-b65c-4baf-90c6-07c266ac1e73') as fantasma_status,
  (select numero_alvo from public.compras_requisicoes where id='6d096fc7-b65c-4baf-90c6-07c266ac1e73') as fantasma_numero,
  (select count(*)    from public.compras_requisicoes where btrim(coalesce(numero_alvo,''))='0001480') as linhas_com_0001480,
  (select active      from cron.job where jobid=1)                                                     as cron_ativo;


-- =====================================================================
-- BLOCO 3 — RECONCILIAÇÃO (transação única: ou tudo, ou nada)
-- =====================================================================
-- Só cole depois da verificação humana acima.
--
-- O que faz, nesta ordem:
--   3.1 registra na auditoria da linha 6d096fc7 que o número foi liberado, com
--       o motivo e o número antigo preservados no payload;
--   3.2 libera o número em 6d096fc7 — SEM apagar a linha (ver nota abaixo) e
--       marcando a descrição para quem abrir depois entender o que é;
--   3.3 registra na auditoria da requisição do Tiago o ato de reconciliação;
--   3.4 conclui o envio pela RPC autorizada `concluir_envio_requisicao`, que é
--       idempotente por token — não repete Insert no ERP, apenas grava o
--       número que o ERP já devolveu, marca 'sincronizada' e audita.
--
-- POR QUE NÃO APAGAR a linha 6d096fc7: a FK
-- compras_requisicoes_auditoria.requisicao_id é ON DELETE CASCADE. Apagá-la
-- destruiria os dois eventos de auditoria, inclusive o `descoberta_alvo` que
-- guarda a resposta do ERP — a única prova de que 0001480 existiu antes e de
-- que o ERP reatribuiu o número. Ela não é lixo: é o espelho de um documento
-- real que foi excluído no Alvo.
--
-- Esperado: a última linha do bloco devolve 'SINCRONIZADA'.

begin;

-- 3.1
insert into public.compras_requisicoes_auditoria
  (requisicao_id, evento, user_id, user_nome, sucesso, resposta_alvo, mensagem_erro)
values
  ('6d096fc7-b65c-4baf-90c6-07c266ac1e73', 'editada', null,
   'Reconciliação manual — Pedro', true,
   jsonb_build_object(
     'acao', 'numero_alvo liberado',
     'numero_alvo_anterior', '0001480',
     'motivo', 'Documento manual 0001480 (digitado no Alvo em 07/09/2026 07:59 por PEDRO.SCRIGNOLI) foi excluido no ERP; o sync recebeu not_found em 07/09 09:00 e marcou cancelada. O ERP reatribuiu o numero 0001480 ao Insert da requisicao 5eb2c25e (Tiago) em 08/09/2026 09:41.',
     'linha_preservada', true),
   'Numero liberado para reconciliacao da requisicao 5eb2c25e-1d03-4f24-85fa-c362d35f7a1f. Linha e auditoria preservadas.');

-- 3.2
update public.compras_requisicoes
   set numero_alvo = null,
       descricao   = 'RESIDUO DE ESPELHO — documento 0001480 digitado manualmente no Alvo em 07/09/2026 e excluido no ERP no mesmo dia. Numero liberado em 08/09/2026 porque o ERP o reatribuiu a outra requisicao. Nao reutilizar esta linha.',
       updated_at  = now()
 where id = '6d096fc7-b65c-4baf-90c6-07c266ac1e73'
   and btrim(coalesce(numero_alvo,'')) = '0001480';

-- 3.3
insert into public.compras_requisicoes_auditoria
  (requisicao_id, evento, user_id, user_nome, sucesso, resposta_alvo, mensagem_erro)
values
  ('5eb2c25e-1d03-4f24-85fa-c362d35f7a1f', 'editada', null,
   'Reconciliação manual — Pedro', true,
   jsonb_build_object(
     'acao', 'reconciliacao de envio incerto',
     'numero_alvo_confirmado', '0001480',
     'confirmado_por', 'Pedro, conferencia direta no ERP',
     'causa', 'Insert concluido no Alvo, gravacao no Hub barrada por uq_compras_requisicoes_filial_numero_alvo, ocupada pela linha 6d096fc7 (documento excluido no ERP cujo numero foi reatribuido).',
     'sem_novo_insert', true),
   'Conclusao idempotente pela RPC concluir_envio_requisicao. Nenhum Insert repetido no ERP.');

-- 3.4 — conclusão idempotente pelo mecanismo autorizado.
-- O token é lido da própria linha, não copiado à mão: se alguém o tiver
-- alterado, a RPC recusa com TENTATIVA_INVALIDA e a transação inteira aborta.
select public.concluir_envio_requisicao(
         '5eb2c25e-1d03-4f24-85fa-c362d35f7a1f'::uuid,
         (select envio_token from public.compras_requisicoes
           where id = '5eb2c25e-1d03-4f24-85fa-c362d35f7a1f'),
         '0001480',
         null,
         false
       ) as resultado;

commit;


-- =====================================================================
-- BLOCO 4 — CONFERÊNCIA PÓS-RECONCILIAÇÃO (somente leitura)
-- =====================================================================
-- Esperado:
--   real_status = 'sincronizada' · real_numero = '0001480' · real_enviado_em = agora
--   fantasma_numero = null · fantasma_status = 'cancelada' (inalterado)
--   linhas_com_0001480 = 1  (só a do Tiago)
--   auditoria_fantasma = 3 eventos (era 2, +1 do passo 3.1)
--   auditoria_real     = 7 eventos (era 5, +1 do passo 3.3 e +1 da RPC)

select
  (select status      from public.compras_requisicoes where id='5eb2c25e-1d03-4f24-85fa-c362d35f7a1f') as real_status,
  (select numero_alvo from public.compras_requisicoes where id='5eb2c25e-1d03-4f24-85fa-c362d35f7a1f') as real_numero,
  (select to_char(enviado_em at time zone 'America/Sao_Paulo','DD/MM HH24:MI:SS')
     from public.compras_requisicoes where id='5eb2c25e-1d03-4f24-85fa-c362d35f7a1f')                   as real_enviado_brt,
  (select numero_alvo from public.compras_requisicoes where id='6d096fc7-b65c-4baf-90c6-07c266ac1e73') as fantasma_numero,
  (select status      from public.compras_requisicoes where id='6d096fc7-b65c-4baf-90c6-07c266ac1e73') as fantasma_status,
  (select count(*)    from public.compras_requisicoes where btrim(coalesce(numero_alvo,''))='0001480') as linhas_com_0001480,
  (select count(*)    from public.compras_requisicoes_auditoria where requisicao_id='6d096fc7-b65c-4baf-90c6-07c266ac1e73') as auditoria_fantasma,
  (select count(*)    from public.compras_requisicoes_auditoria where requisicao_id='5eb2c25e-1d03-4f24-85fa-c362d35f7a1f') as auditoria_real;

-- Trilha completa da requisição do Tiago, em ordem.
select to_char(created_at at time zone 'America/Sao_Paulo','DD/MM HH24:MI:SS') as brt,
       evento, sucesso, coalesce(user_nome,'(sistema)') as quem
  from public.compras_requisicoes_auditoria
 where requisicao_id = '5eb2c25e-1d03-4f24-85fa-c362d35f7a1f'
 order by created_at;

-- Gate geral de envios incertos — esperado 0 em todas as colunas.
select (select count(*) from public.compras_requisicoes
         where envio_token is not null and numero_alvo is null)                    as token_sem_numero,
       (select count(*) from public.compras_requisicoes
         where status in ('pendente_aprovacao','aprovada','pendente_envio','erro_envio')) as em_transicao,
       (select count(*) from (select nullif(btrim(numero_alvo),'') n
                                from public.compras_requisicoes
                               where nullif(btrim(numero_alvo),'') is not null
                               group by 1 having count(*)>1) d)                    as numero_duplicado;


-- =====================================================================
-- BLOCO 5 — RELIGAR O CRON
-- =====================================================================
-- Só depois do BLOCO 4 vir como esperado.
-- Com 0001480 agora apontando para a requisição do Tiago, o Job 4 vai casar o
-- list com a linha certa e apenas manter o status — não há mais linha órfã
-- disputando o número.
-- Esperado: retorno vazio; conferência com active=true e schedule preservado.

select cron.alter_job(1, active := true);

select jobid, jobname, schedule, active from cron.job where jobid = 1;


-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- O BLOCO 3 é atômico: se qualquer passo falhar, nada é aplicado.
-- Se já tiver sido aplicado e você precisar desfazer (não recomendado sem
-- reavaliar o caso), a ordem inversa é:
--
--   select cron.alter_job(1, active := false);
--
--   update public.compras_requisicoes
--      set numero_alvo = null, status = 'aprovada', enviado_em = null, updated_at = now()
--    where id = '5eb2c25e-1d03-4f24-85fa-c362d35f7a1f';
--   -- (o envio_token é preservado pela RPC; a requisição volta a "envio incerto")
--
--   update public.compras_requisicoes
--      set numero_alvo = '0001480', descricao = null, updated_at = now()
--    where id = '6d096fc7-b65c-4baf-90c6-07c266ac1e73';
--
-- NÃO apague os eventos de auditoria: a trilha do que foi feito deve
-- sobreviver ao desfazimento.
-- =====================================================================
