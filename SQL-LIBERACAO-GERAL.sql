-- =====================================================================
-- SQL-LIBERACAO-GERAL.sql
-- Fim da janela de aceite multi-CC — liberação da operação geral
-- =====================================================================
-- Gerado em 08/09/2026 por sessão do Claude Code (MCP read-only: NADA foi
-- executado por mim; toda escrita abaixo é do Pedro, no SQL Editor).
--
-- DECISÃO DO PEDRO (08/09/2026): liberar a operação geral SEM executar o
-- teste Caio/Ana. Risco aceito explicitamente: o caminho multi-CC (rateio
-- entre CCs + aprovação de vários líderes) nunca foi exercitado com dado
-- real. A primeira requisição multi-CC de produção será a primeira execução
-- real desse caminho. O fluxo single-CC está validado.
--
-- PASSO 1 (pré-requisito não-pulável do ACEITE-ALVO.md) — CONFERIDO E LIMPO
-- em 08/09/2026, 09h09 BRT: 0 token de envio sem confirmação, 0 requisição
-- em transição, 0 número no Alvo sem persistência no Hub, 0 numero_alvo
-- duplicado, 0 escrita em compras_requisicoes desde a pausa de 07/09 16:24
-- UTC. O BLOCO 0 abaixo RE-EXECUTA essa conferência na hora da colagem.
--
-- NÃO reexecutar ABRIR-SOMENTE-ACEITE.sql nem SQL-INTEGRAL.sql.
--
-- ORDEM OBRIGATÓRIA: 0 -> A -> C -> B.
--   A vem antes de B/C porque o trigger trg_req_janela barra o INSERT de
--   requisições por service_role enquanto modo <> 'aberta' ("Sincronização
--   de requisições suspensa durante o aceite multi-CC"). Religar o cron com
--   a janela em 'aceite' produziria erro no sync.
--   C vem antes de B para não gerar um ciclo abortado: com
--   sync_settings.enabled = false a Edge grava uma linha "Sync pausado: ..."
--   em sync_runs e sai (index.ts:2716).
--
-- Cole UM BLOCO POR VEZ e confira o resultado antes de seguir.
-- =====================================================================


-- =====================================================================
-- BLOCO 0 — PRÉ-VOO (somente leitura). Gate do Passo 1.
-- =====================================================================
-- Esperado: UMA linha, veredito = 'LIBERAR', todos os contadores em 0 e
-- estado_atual = 'aceite | cron=false | sync=false'.
--
-- Se vier 'PARAR': NÃO siga. Não reconcilie por suposição, não limpe
-- tokens, não repita Insert com resposta incerta. Reporte.

select
  case when (select count(*) from public.compras_requisicoes
             where envio_token is not null and numero_alvo is null) = 0
        and (select count(*) from public.compras_requisicoes
             where status in ('pendente_aprovacao','aprovada','pendente_envio','erro_envio')) = 0
        and (select count(*) from public.compras_requisicoes r
             join lateral (select evento from public.compras_requisicoes_auditoria
                           where requisicao_id = r.id
                             and evento in ('envio_tentado','envio_sucesso','envio_falha',
                                            'envio_pos_aprovacao_sucesso','envio_pos_aprovacao_falha')
                           order by created_at desc limit 1) a on true
             where nullif(btrim(r.numero_alvo),'') is null
               and a.evento in ('envio_tentado','envio_sucesso','envio_pos_aprovacao_sucesso')) = 0
        and (select count(*) from public.compras_requisicoes
             where enviado_em is not null and nullif(btrim(numero_alvo),'') is null) = 0
        and (select count(*) from (select nullif(btrim(numero_alvo),'') n
                                   from public.compras_requisicoes
                                   where nullif(btrim(numero_alvo),'') is not null
                                   group by 1 having count(*) > 1) d) = 0
       then 'LIBERAR' else 'PARAR' end                                      as veredito,
  (select count(*) from public.compras_requisicoes
   where envio_token is not null and numero_alvo is null)                   as token_sem_numero,
  (select count(*) from public.compras_requisicoes
   where status in ('pendente_aprovacao','aprovada','pendente_envio','erro_envio')) as em_transicao,
  (select count(*) from public.compras_requisicoes
   where enviado_em is not null and nullif(btrim(numero_alvo),'') is null)   as enviado_sem_numero,
  (select count(*) from (select nullif(btrim(numero_alvo),'') n
                         from public.compras_requisicoes
                         where nullif(btrim(numero_alvo),'') is not null
                         group by 1 having count(*) > 1) d)                 as numero_duplicado,
  (select count(*) from public.compras_requisicoes
   where updated_at > timestamptz '2026-09-07 16:24:27+00')                 as escritas_pos_pausa,
  (select j.modo from public.compras_requisicoes_janela j)
    || ' | cron=' || (select c.active::text from cron.job c where c.jobid = 1)
    || ' | sync=' || (select s.enabled::text from public.sync_settings s
                      where s.job_name = 'sync-compras-status-cron')        as estado_atual;


-- =====================================================================
-- BLOCO A — Janela: 'aceite' -> 'aberta'
-- =====================================================================
-- Efeito: req_janela_permite() passa a devolver true para TODOS os usuários
-- (deixa de exigir estar na lista dos 4 participantes), o prefixo obrigatório
-- 'ACEITE-MULTICC-' deixa de ser exigido, e o INSERT por service_role (sync)
-- volta a ser aceito.
-- O array `usuarios` NÃO é apagado: em modo 'aberta' ele é ignorado pela
-- função, e preservá-lo mantém o registro de quem participou do aceite.
--
-- Esperado: 1 linha — modo='aberta', usuarios_preservados=4, atualizada_em=agora.

update public.compras_requisicoes_janela
   set modo = 'aberta',
       atualizada_em = now()
 where id
returning modo, coalesce(array_length(usuarios,1),0) as usuarios_preservados, atualizada_em;

-- Conferência de leitura do BLOCO A.
-- Esperado: modo='aberta', usuarios=4, iniciada_brt preservada em
-- 07/09 15:42:23 (criação da tabela pelo SQL integral). A atualizada_brt
-- deixa de ser 07/09 15:59:31 (abertura do aceite) e passa a ser agora.
select modo,
       coalesce(array_length(usuarios,1),0)            as usuarios,
       iniciada_em   at time zone 'America/Sao_Paulo'  as iniciada_brt,
       atualizada_em at time zone 'America/Sao_Paulo'  as atualizada_brt
  from public.compras_requisicoes_janela;


-- =====================================================================
-- BLOCO C — sync_settings: enabled = true
-- =====================================================================
-- (executado ANTES do BLOCO B; ver nota de ordem no cabeçalho)
-- NÃO toca schedule_cron ('0 11-20 * * 1-5') nem paused_at/paused_by, que
-- ficam como histórico da pausa (IMPLANTACAO.md: "preservando o schedule e
-- o histórico da pausa").
--
-- Esperado: 1 linha — enabled=true, schedule_cron inalterado.

update public.sync_settings
   set enabled = true,
       updated_at = now()
 where job_name = 'sync-compras-status-cron'
returning job_name, enabled, schedule_cron, paused_at, paused_reason;

-- Conferência de leitura do BLOCO C.
-- Esperado: enabled=true, schedule_cron='0 11-20 * * 1-5'.
select job_name, enabled, schedule_cron,
       paused_at at time zone 'America/Sao_Paulo' as paused_brt,
       paused_reason
  from public.sync_settings
 where job_name = 'sync-compras-status-cron';


-- ---------------------------------------------------------------------
-- BLOCO C2 — OPCIONAL (cosmético): corrigir o texto do motivo
-- ---------------------------------------------------------------------
-- O BLOCO C deixa enabled=true convivendo com paused_reason = "Implantação
-- multi-CC autorizada; manter pausado até aceite" — texto que passa a
-- contradizer o estado. Este bloco reescreve só o texto, preservando
-- paused_at/paused_by. Rode se quiser, ou pule.
-- Para usar: remova os comentários das quatro linhas abaixo.
--
-- update public.sync_settings
--    set paused_reason = 'Retomado em 08/09/2026 por decisão do Pedro; aceite multi-CC encerrado sem o teste Caio/Ana',
--        updated_at = now()
--  where job_name = 'sync-compras-status-cron'
-- returning job_name, enabled, paused_reason;


-- =====================================================================
-- BLOCO B — cron jobid 1: active = true (schedule PRESERVADO)
-- =====================================================================
-- cron.alter_job só altera os parâmetros informados; os demais permanecem.
-- Passando apenas `active`, o schedule '0 11-20 * * 1-5' é preservado — é o
-- mesmo formato usado no PAUSAR.sql para desligar.
-- NÃO passar o parâmetro `schedule` aqui, em hipótese alguma.
--
-- Esperado: uma linha com alter_job vazio (a função retorna void).

select cron.alter_job(1, active := true);

-- Conferência de leitura do BLOCO B.
-- Esperado: jobname='sync-compras-status-cron-hourly',
--           schedule='0 11-20 * * 1-5', active=true, database='postgres'.
select jobid, jobname, schedule, active, database
  from cron.job
 where jobid = 1;


-- =====================================================================
-- BLOCO D — Conferência final consolidada (somente leitura)
-- =====================================================================
-- Esperado: 3 linhas, todas com ok = true.

select 'janela' as controle,
       (select modo from public.compras_requisicoes_janela)             as valor,
       (select modo from public.compras_requisicoes_janela) = 'aberta'  as ok
union all
select 'cron jobid 1',
       (select jobname || ' active=' || active::text || ' schedule=' || schedule
          from cron.job where jobid = 1),
       (select active and schedule = '0 11-20 * * 1-5' from cron.job where jobid = 1)
union all
select 'sync_settings',
       (select 'enabled=' || enabled::text || ' schedule=' || coalesce(schedule_cron,'(null)')
          from public.sync_settings where job_name = 'sync-compras-status-cron'),
       (select enabled and schedule_cron = '0 11-20 * * 1-5'
          from public.sync_settings where job_name = 'sync-compras-status-cron');


-- =====================================================================
-- ROLLBACK (se o primeiro ciclo der errado)
-- =====================================================================
-- Repausa tudo, sem desfazer a implantação multi-CC e sem tocar em
-- requisições, grupos, auditoria ou tokens. Cole na ordem B -> C -> A.
--
--   select cron.alter_job(1, active := false);
--
--   update public.sync_settings
--      set enabled = false, updated_at = now()
--    where job_name = 'sync-compras-status-cron';
--
--   update public.compras_requisicoes_janela
--      set modo = 'aceite', atualizada_em = now()
--    where id;
--
-- (modo 'aceite' devolve a restrição aos 4 participantes já gravados em
--  `usuarios`; para travar todos, inclusive eles, use 'fechada'.)
-- =====================================================================
