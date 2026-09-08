-- =====================================================================
-- SQL-ACOMPANHA-TESTE-HUGO.sql
-- Teste operacional: requisitante comum + anexo → fila do líder → envio
-- =====================================================================
-- Preparado em 08/09/2026, 11h1x BRT. Somente leitura — nada aqui escreve.
-- O que este teste exercita pela PRIMEIRA VEZ desde 07/09: aprovação por
-- TERCEIRO (líder ≠ autor) com anexo, e a conclusão do envio nesse caminho.
-- A correção do ANEXO_CONGELADO foi validada só na auto-aprovação.
--
-- =====================================================================
-- 1. HUGO — CONFERIDO EM 08/09/2026 11h1x BRT
-- =====================================================================
--   user_id ......... c4888699-704b-4827-9371-0f459b900404
--   email ........... hugo.maffei@pfbrazil.com          is_active = true
--   is_admin ........ FALSE ✓ (sem bypass — é o ponto do teste)
--   lidera CC ....... NENHUM ✓ (nem ativo, nem revogado)
--   papel ........... requisitante ✓ (desde 14/04/2026)
--
-- ⚠️ DUAS COISAS QUE VOCÊ NÃO MENCIONOU, e que não invalidam o teste:
--
--   (a) Ele tem MAIS DE UM papel: além de `requisitante`, tem
--       `analista_compras` (desde 02/06) e `controller_intercompany`.
--       Conferi permissão por permissão: NENHUMA delas aprova requisição.
--       O que `analista_compras` acrescenta é `compras.requisicoes.view_all`
--       (ele enxerga requisições de terceiros) e permissões de Pedidos.
--       O roteamento não olha permissão, olha liderança de CC — então a
--       requisição cai na sua fila do mesmo jeito. Mas ele não é um
--       requisitante "puro": se o teste for para medir também o que um
--       requisitante comum ENXERGA, esse papel contamina a observação.
--
--   (b) `profiles.alvo_usuario` do Hugo é NULL — ele não tem login do ERP.
--       Isso NÃO impede: o gateway cai no login de serviço e registra o
--       evento `login_servico_provisorio`. Medido, não suposto: o Tiago
--       também tem alvo_usuario NULL e a requisição dele foi criada no Alvo
--       hoje (0001480), e o Hugo já tem 9 das 10 requisições com número.
--       CONSEQUÊNCIA: o documento sai no ERP com o login de serviço, não com
--       o do Hugo. Se a rastreabilidade por usuário importa para este teste,
--       cadastre o `alvo_usuario` dele ANTES — mas aí você muda uma variável.
--
-- =====================================================================
-- 2. CC E CAMINHO
-- =====================================================================
-- CC 00010.00002.00003 → líder ativo: Pedro Scrignoli, e SÓ ele (atribuído
-- em 07/08/2026, ativo, não revogado). Requisição do Hugo nesse CC cai na
-- sua fila. Rota esperada da submissão: PENDENTE.
--
-- ⚠️ O CC QUE MANDA É O DO ITEM, não o do cabeçalho — a fonte canônica do
-- roteamento é o item (o cron chega a lançar erro se o item não tiver CC).
-- Oriente o Hugo a deixar cabeçalho E item no MESMO CC 00010.00002.00003, e
-- SEM rateio. Isso mantém o teste single-CC e isola a variável que você quer
-- medir. Rateio entre CCs é outro teste — o multi-CC segue não exercitado, e
-- misturar os dois faria um eventual erro ficar ambíguo.
--
-- IMPEDIMENTOS CONHECIDOS NESTE CAMINHO:
--   • Unidade do produto. Produto com Divisor, unidade dependente ou
--     dimensional é BLOQUEADO por falta de contrato (CONVERSAO_NAO_COMPROVADA),
--     e a criação falha. Produto seguro comprovado hoje: 001.014.031
--     (MEMORIA RAM NOTEBOOK 16GB, UNID posição 1) — foi o item que passou no
--     caminho completo até o ERP hoje de manhã.
--   • Anexo: precisa ser arquivo pequeno e novo. Anexo antigo/incompleto faz
--     a submissão recusar com ANEXO_SEM_INTEGRIDADE.
--   • O Hugo NUNCA passou pelo gate atual: das 10 requisições dele, ZERO têm
--     `aprovacao_submetida_em`. As 3 com anexo que chegaram ao ERP são todas
--     anteriores a 07/09, pelo caminho antigo. Ou seja, para ele também é
--     estreia.
--
-- ESTADO DA BASE NA PREPARAÇÃO (tudo verde):
--   correção do trigger aplicada = true · janela = aberta · cron = true
--   sync_settings = true · envios incertos = 0
--   6aab4fe2 = sincronizada/0001481, anexo com numero_alvo_ao_enviar=0001481
--   linha residual 6d096fc7 = cancelada, sem número
-- =====================================================================


-- =====================================================================
-- 3. ⚠️ O TESTE JÁ COMEÇOU — E NÃO É O QUE FOI PLANEJADO
-- =====================================================================
-- Enquanto eu preparava este arquivo, o Hugo criou a requisição. Ela apareceu
-- entre duas consultas minhas (11:21:36), então isto é observação, não plano:
--
--   id ............. 2155cbf8-dffa-4d18-a450-d0cbfdb26338
--   descrição ...... "teste"
--   status ......... pendente_aprovacao  ✓ o gate funcionou, caiu na fila
--   criada 11:21:36 · submetida 11:21:38 · sem token · sem número
--
-- DUAS DIFERENÇAS EM RELAÇÃO AO QUE VOCÊ PEDIU:
--
--   ❌ ANEXOS = 0. O objetivo declarado do teste era exercitar a conclusão do
--      envio COM ANEXO no fluxo de aprovação por terceiro — exatamente o que a
--      correção do ANEXO_CONGELADO destravou e que só foi validado na
--      auto-aprovação. Sem anexo, esse caminho continua sem validação.
--
--   ⚠️ É MULTI-CC. São 2 itens em 2 CCs:
--         00010.00002.00003 → líder Pedro Scrignoli
--         00010.00002.00008 → líder guilherme.oliveira
--      Isto é a ESTREIA do caminho multi-CC em produção — o risco que você
--      aceitou explicitamente ao dispensar o teste Caio/Ana. Está acontecendo
--      agora, sem preparação, e com duas variáveis nunca testadas ao mesmo
--      tempo (multi-CC + aprovação por terceiro): se algo falhar, a causa fica
--      ambígua.
--
-- CONSEQUÊNCIA IMEDIATA: VOCÊ NÃO FECHA ESTE TESTE SOZINHO.
-- O envio ao ERP só dispara quando TODOS os grupos estiverem decididos. Se
-- você aprovar o seu CC, a requisição fica pendente do Guilherme e NADA vai ao
-- ERP. Ou você chama o Guilherme, ou o teste para no meio.
--
-- E quando o segundo aprovar, o Insert acontece de verdade: "teste" vira
-- documento real no ERP, que alguém vai ter de cancelar depois.
--
-- SUGESTÃO (decisão sua):
--   1. Aproveite esta requisição para medir o multi-CC — é informação valiosa
--      e já está na fila. Combine com o Guilherme, e tenha o F1 à mão: quando
--      a última aprovação disparar o envio, é o momento de risco.
--   2. Peça ao Hugo uma SEGUNDA requisição, single-CC (cabeçalho e item em
--      00010.00002.00003) e COM anexo, que é o teste que você desenhou. Aí
--      cada uma mede uma coisa.
-- =====================================================================


-- =====================================================================
-- Q0 — PRÉ-VOO (rode ANTES de chamar o Hugo)
-- =====================================================================
-- Esperado: correcao_trigger=true · janela='aberta' · cron=true · sync=true
--           envios_incertos=0 · pendentes_na_sua_fila = (o que já houver)
-- Se `correcao_trigger` vier false, PARE: o teste vai falhar em
-- ANEXO_CONGELADO de novo. Aplique o BLOCO 1 de SQL-CORRIGE-ANEXO-CONGELADO.sql.

select
  (select (pg_get_functiondef(p.oid) like '%array[''numero_alvo_ao_enviar'',''updated_at'']%')
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='fn_req_congelar_conteudo')            as correcao_trigger,
  (select modo from public.compras_requisicoes_janela)                            as janela,
  (select active from cron.job where jobid=1)                                     as cron,
  (select enabled from public.sync_settings
    where job_name='sync-compras-status-cron')                                    as sync,
  (select count(*) from public.compras_requisicoes
    where envio_token is not null and numero_alvo is null)                        as envios_incertos,
  (select count(*) from public.compras_requisicoes
    where status='pendente_aprovacao')                                            as pendentes_na_fila;


-- =====================================================================
-- Q1 — A QUERY DO FECHAMENTO (rode DEPOIS do teste)
-- =====================================================================
-- Pega automaticamente a requisição mais recente do Hugo criada hoje.
-- Se preferir fixar, troque o CTE por: select '<id>'::uuid as id
--
-- ✅ CICLO FECHOU quando:
--   status = 'sincronizada' · numero_alvo preenchido · enviado_em preenchido
--   anexos = 1 e anexos_com_numero = 1 (o numero_alvo_ao_enviar propagou)
--   sha_preservado = true · envio_token_preso = false
--
-- ❌ Qualquer outra combinação: vá para a seção de SINAIS DE FALHA (Q4).

with alvo as (
  select id from public.compras_requisicoes
   where requisitante_user_id = 'c4888699-704b-4827-9371-0f459b900404'
     and created_at >= current_date
   order by created_at desc limit 1
)
select r.id,
       left(r.descricao,50)                                                        as descricao,
       r.status,
       r.numero_alvo,
       to_char(r.enviado_em at time zone 'America/Sao_Paulo','DD/MM HH24:MI:SS')   as enviado_brt,
       to_char(r.aprovacao_submetida_em at time zone 'America/Sao_Paulo','DD/MM HH24:MI:SS') as submetida_brt,
       to_char(r.aprovada_em at time zone 'America/Sao_Paulo','DD/MM HH24:MI:SS')  as aprovada_brt,
       pa.full_name                                                                as aprovada_por,
       r.aprovacao_automatica,
       r.codigo_centro_ctrl,
       (select count(*) from public.compras_requisicoes_arquivos a
         where a.requisicao_id=r.id)                                               as anexos,
       (select count(*) from public.compras_requisicoes_arquivos a
         where a.requisicao_id=r.id and a.numero_alvo_ao_enviar is not null)       as anexos_com_numero,
       (select string_agg(a.nome_original || ' → ' || coalesce(a.numero_alvo_ao_enviar,'(VAZIO)'), '; ')
          from public.compras_requisicoes_arquivos a where a.requisicao_id=r.id)   as anexo_detalhe,
       (select bool_and(a.conteudo_sha256 is not null and length(a.conteudo_sha256)=64)
          from public.compras_requisicoes_arquivos a where a.requisicao_id=r.id)   as sha_preservado,
       (r.envio_token is not null and r.numero_alvo is null)                       as envio_token_preso,
       coalesce(r.erro_ultimo_envio,'(sem erro)')                                  as erro
  from public.compras_requisicoes r
  join alvo on alvo.id = r.id
  left join public.profiles pa on pa.user_id = r.aprovada_por_user_id;


-- =====================================================================
-- Q2 — TRILHA DE AUDITORIA COMPLETA
-- =====================================================================
-- Trilha ESPERADA neste caminho (líder ≠ autor). Atenção: os quatro
-- primeiros eventos nunca foram observados juntos em produção — é o que o
-- teste está medindo. Os três últimos são os que vi hoje nos dois casos.
--
--   criada                       (hugo.maffei)
--   cc_pendente                  ← o CC tem líder: abre grupo pendente
--   enviada_aprovacao            ← foi para a sua fila
--   aprovacao_cc_registrada      ← sua decisão no CC
--   aprovada_lider               ← fechamento da aprovação
--   login_servico_provisorio     (sistema — Hugo não tem alvo_usuario)
--   envio_reivindicado           (sistema — token gerado)
--   envio_pos_aprovacao_sucesso  ← ✅ O EVENTO QUE FECHA O CICLO
--
-- 🔴 Se a trilha TERMINAR em `envio_reivindicado`, é o padrão dos dois
--    incidentes de hoje: o Insert foi disparado e o desfecho não foi
--    registrado. Vá direto ao sinal F1 (Q4).

with alvo as (
  select id from public.compras_requisicoes
   where requisitante_user_id = 'c4888699-704b-4827-9371-0f459b900404'
     and created_at >= current_date
   order by created_at desc limit 1
)
select to_char(a.created_at at time zone 'America/Sao_Paulo','DD/MM HH24:MI:SS') as brt,
       a.evento,
       a.sucesso,
       coalesce(a.user_nome,'(sistema)')                                         as quem,
       left(coalesce(a.mensagem_erro,''),120)                                    as erro,
       (a.resposta_alvo is not null)                                             as tem_resposta_alvo
  from public.compras_requisicoes_auditoria a
  join alvo on alvo.id = a.requisicao_id
 order by a.created_at;


-- =====================================================================
-- Q3 — GRUPOS DE APROVAÇÃO (o gate funcionou?)
-- =====================================================================
-- Esperado no teste PLANEJADO (single-CC): 1 linha, 00010.00002.00003,
--           aprovado_por = Pedro, aprovado_em preenchido, automatica = false,
--           sem_lider_na_submissao = false.
-- ⚠️ NO TESTE QUE ESTÁ EM CURSO (ver seção 3): são 2 linhas —
--    00010.00002.00003 (Pedro) e 00010.00002.00008 (guilherme.oliveira).
--    Só quando AS DUAS tiverem aprovado_em preenchido é que o envio dispara.
-- 🔴 automatica = true  → houve auto-aprovação; o teste NÃO exercitou o
--    caminho de terceiro (rota AUTO_APROVADA, não PENDENTE).
-- 🔴 sem_lider_na_submissao = true → o CC foi lido como sem líder: confira se
--    o CC do ITEM é mesmo 00010.00002.00003.
-- 🔴 0 linhas → não passou pelo gate (rota SEM_GATE): o teste não mediu nada.

with alvo as (
  select id from public.compras_requisicoes
   where requisitante_user_id = 'c4888699-704b-4827-9371-0f459b900404'
     and created_at >= current_date
   order by created_at desc limit 1
)
select g.codigo_centro_ctrl,
       p.full_name                                                             as aprovado_por,
       to_char(g.aprovado_em at time zone 'America/Sao_Paulo','DD/MM HH24:MI:SS') as aprovado_brt,
       g.automatica,
       g.sem_lider_na_submissao,
       to_char(g.dispensa_sem_lider_em at time zone 'America/Sao_Paulo','DD/MM HH24:MI') as dispensa_brt
  from public.compras_requisicoes_aprovacao_grupos g
  join alvo on alvo.id = g.requisicao_id
  left join public.profiles p on p.user_id = g.aprovado_por
 order by g.codigo_centro_ctrl;


-- =====================================================================
-- Q4 — SINAIS DE FALHA E O QUE FAZER
-- =====================================================================
-- Rode este gate junto com a Q1. Esperado: TODAS as colunas em 0.

select (select count(*) from public.compras_requisicoes
         where envio_token is not null and numero_alvo is null)                 as f1_envio_incerto,
       (select count(*) from public.compras_requisicoes
         where status in ('pendente_envio','erro_envio'))                       as f2_em_transicao,
       (select count(*) from (select nullif(btrim(numero_alvo),'') n
                                from public.compras_requisicoes
                               where nullif(btrim(numero_alvo),'') is not null
                               group by 1 having count(*)>1) d)                 as f3_numero_duplicado,
       (select count(*) from public.compras_requisicoes r
         where r.requisitante_user_id is null and r.created_at >= current_date) as f4_descoberta_orfa,
       (select count(*) from public.compras_requisicoes_arquivos a
          join public.compras_requisicoes r on r.id=a.requisicao_id
         where nullif(btrim(r.numero_alvo),'') is not null
           and a.numero_alvo_ao_enviar is null)                                 as f5_anexo_sem_numero,
       (select count(*) from public.sync_runs
         where job_type='bicephalous' and started_at >= current_date
           and (total_erros > 0 or finished_at is null))                        as f6_ciclo_com_erro;

-- ---------------------------------------------------------------------
-- F1 — REQUISIÇÃO CRIADA NO ALVO SEM CONFIRMAÇÃO NO HUB (o padrão de hoje)
-- ---------------------------------------------------------------------
-- COMO SE APRESENTA: status 'aprovada', numero_alvo null, envio_token
-- preenchido, trilha terminando em `envio_reivindicado`, erro_ultimo_envio
-- null. A tela mostra "desfecho do envio INCERTO" (texto novo).
--
-- O QUE FAZER, NESTA ORDEM:
--   1. ⛔ NÃO clique em Reenviar e não peça ao Hugo que reenvie. O documento
--      provavelmente EXISTE no ERP; reenviar duplica.
--   2. PAUSE O CRON:  select cron.alter_job(1, active := false);
--      Sem isso, o Job 4 descobre o número no /req-comp/list e cria uma linha
--      órfã ocupando-o — foi o que transformou o caso do Tiago num conflito
--      de chave única. Você tem até a próxima hora cheia.
--   3. Abra o ERP e ache o documento: filial 1.01, CC 00010.00002.00003,
--      digitado na hora do teste, com o item do Hugo. Anote o número.
--   4. Confirme que ele é do teste (e não um número reatribuído): confira
--      DataHoraDigitacao, CodigoFuncionario 0000029 e o item.
--   5. Conclua pelo mecanismo autorizado, idempotente por token — o mesmo
--      padrão dos dois casos de hoje:
--        select public.concluir_envio_requisicao(
--                 '<id da requisição>'::uuid,
--                 (select envio_token from public.compras_requisicoes
--                   where id='<id da requisição>'),
--                 '<numero do ERP>', null, false);
--      Retorno esperado: 'SINCRONIZADA'.
--   6. Rode Q1/Q2 e religue o cron: select cron.alter_job(1, active := true);
-- NUNCA: limpar envio_token, repetir o Insert, ou gravar numero_alvo por
-- UPDATE direto.
--
-- ---------------------------------------------------------------------
-- F2 — ANEXO_CONGELADO de novo
-- ---------------------------------------------------------------------
-- Significa que a correção não está no ar (Q0 daria correcao_trigger=false)
-- ou que existe OUTRO caminho de escrita no anexo que a lista branca não
-- cobre. O documento provavelmente já está no ERP → trate como F1 para
-- destravar, e me traga a mensagem exata: se o trigger está corrigido e
-- ainda barrou, a lista branca precisa de outra coluna.
--
-- ---------------------------------------------------------------------
-- F3 — A REQUISIÇÃO NÃO CAIU NA SUA FILA
-- ---------------------------------------------------------------------
-- Q3 com 0 linhas, ou trilha com `submetida_sem_gate`/`cc_sem_lider`.
-- Causa provável: o CC do ITEM não é 00010.00002.00003 (o item manda).
-- O que fazer: nada de correção manual — o teste não mediu o que queria.
-- Confira o CC do item e repita com o item no CC certo.
--
-- ---------------------------------------------------------------------
-- F4 — AUTO-APROVAÇÃO (Q3 com automatica = true)
-- ---------------------------------------------------------------------
-- O Hugo teria sido tratado como líder/autor dispensado. Não deveria
-- acontecer (ele não lidera CC nenhum). Se acontecer, PARE o teste e me
-- avise: é defeito de roteamento, não do envio.
--
-- ---------------------------------------------------------------------
-- F5 — ANEXO SEM numero_alvo_ao_enviar, com a requisição sincronizada
-- ---------------------------------------------------------------------
-- Ciclo fechou pela metade: o cabeçalho gravou e o anexo não. Não corrija na
-- mão — me avise. Indica que a RPC concluiu parcialmente, o que não deveria
-- ser possível (ela roda em transação).
--
-- ---------------------------------------------------------------------
-- F6 — CICLO DE SYNC COM ERRO OU ÓRFÃO no dia do teste
-- ---------------------------------------------------------------------
-- Pode não ter relação com o teste (erro de leitura do gateway acontece).
-- Investigue o detalhe antes de atribuir ao teste:
--   select to_char(r.started_at at time zone 'America/Sao_Paulo','DD/MM HH24:MI') as brt,
--          e->>'tipo' as tipo, left(e->>'erro',140) as erro, count(*) as qtd
--     from public.sync_runs r, jsonb_array_elements(r.detalhes) e
--    where r.job_type='bicephalous' and r.started_at >= current_date and (e ? 'erro')
--    group by 1,2,3 order by 4 desc;
-- =====================================================================
