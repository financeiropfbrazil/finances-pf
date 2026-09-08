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
-- BLOCO E — ACOMPANHAMENTO DO PRIMEIRO CICLO (somente leitura)
-- =====================================================================
-- Colar logo após o primeiro ciclo (a cada hora cheia entre 08h e 17h BRT).
-- Nada aqui escreve.

-- E1. O ciclo rodou? Como terminou?
-- Esperado: 1+ linha nova job_type='bicephalous', orfa=false, total_erros=0,
--           seg entre ~40 e ~120, observacao "Job2 elegíveis(sem limit)=...".
-- ALERTA: orfa=true (morreu no meio) · total_erros>0 · observacao
--         "Sync pausado" (faltou o BLOCO C) · nenhuma linha (cron não disparou).
select to_char(started_at at time zone 'America/Sao_Paulo','DD/MM HH24:MI') as inicio_brt,
       (finished_at is null)            as orfa,
       total_candidatos, total_mudaram, total_erros,
       round(duracao_ms/1000.0,1)       as seg,
       left(coalesce(observacao,''),90) as observacao
  from public.sync_runs
 where job_type = 'bicephalous'
   and started_at >= current_date
 order by started_at desc;

-- E2. Se houve erro: qual, e de que tipo (req x ped)?
-- ALERTA ESPECÍFICO DA v51 — estes três nunca rodaram em produção:
--   REQ_ITEM_<n>_PRODUTO_DIVERGENTE .... espelho x Alvo divergem no produto
--   Quantidade principal ausente/inválida no ReqComp/Load
--   Unidade ausente no ReqComp/Load
-- Erro "Falha na autenticação do Alvo" / HTTP 502 = gateway/ERP fora, não é a v51.
select to_char(r.started_at at time zone 'America/Sao_Paulo','DD/MM HH24:MI') as brt,
       e->>'tipo' as tipo, left(e->>'erro',140) as erro, count(*) as qtd
  from public.sync_runs r, jsonb_array_elements(r.detalhes) e
 where r.job_type = 'bicephalous' and r.started_at >= current_date and (e ? 'erro')
 group by 1,2,3
 order by 4 desc;

-- E3. O backfill implícito de unidades da v51 está avançando?
-- Esperado: `incompletos` CAINDO a cada ciclo (parte dos 462 de 468).
-- ALERTA: `divergentes_produto` > 0, ou `quantidade` mudando em requisição
--         antiga sem que ninguém tenha mexido nela.
-- (a tabela de itens não tem updated_at; a métrica é `incompletos` caindo)
select count(*)                                                                as itens_espelhados,
       count(*) filter (where i.quantidade_solicitada is null
                           or i.posicao_prod_unid_med is null)                 as incompletos,
       count(*) filter (where i.quantidade_solicitada is not null
                          and i.posicao_prod_unid_med is not null)             as completos,
       count(*) filter (where i.conversao_unidade is not null)                 as com_conversao
  from public.compras_requisicoes_itens i
  join public.compras_requisicoes r on r.id = i.requisicao_id
 where nullif(btrim(r.numero_alvo),'') is not null;

-- E4. O sync voltou a inserir requisições (o guard da janela saiu do caminho)?
-- Esperado: nenhuma exceção; requisições novas do Alvo entram normalmente.
-- ALERTA: 0 requisição nova por vários ciclos + erro tipo 'req' no E2 com a
--         mensagem "Sincronização de requisições suspensa" = BLOCO A não foi aplicado.
select count(*) filter (where created_at >= current_date) as requisicoes_novas_hoje,
       count(*) filter (where updated_at >= current_date) as requisicoes_tocadas_hoje,
       max(updated_at) at time zone 'America/Sao_Paulo'   as ultima_escrita_brt
  from public.compras_requisicoes;

-- E5. Âncora anti-wipe de agosto/2026 — a conferência que não pode falhar.
-- Esperado: 228 pedidos. Valor em 08/09 antes do religamento: 2.739.159,50
--           (congelado em 03/09: 2.739.015,00; +R$ 144,50, variação legítima do ERP).
-- ALERTA: contagem <> 228, ou valor CAINDO — queda é o padrão de wipe.
select count(*)                              as pedidos,
       round(sum(valor_total)::numeric,2)    as total,
       count(*) filter (where coalesce(valor_total,0) = 0) as zerados
  from public.compras_pedidos
 where data_pedido >= date '2026-08-01' and data_pedido < date '2026-09-01';

-- E6. O gate da S1.1 seguiu drenando rateio?
-- Esperado: linhas crescendo (era 1.123 em 08/09, antes do religamento).
select count(*)                                                          as linhas_rateio,
       count(distinct item_id)                                           as itens_com_rateio,
       count(*) filter (where created_at >= current_date)                as criadas_hoje
  from public.compras_pedidos_itens_rateio;

-- E7. Primeira requisição multi-CC de produção — o caminho NUNCA exercitado.
-- Esperado enquanto ninguém criar uma: 0 linhas.
-- Quando aparecer a primeira, é a estreia real do multi-CC: acompanhar de perto
-- (grupos abertos x decididos, um único envio ao final, nenhum Insert antes do
-- fechamento de todos os grupos).
select g.requisicao_id,
       count(*)                                                as grupos,
       count(*) filter (where g.aprovado_em is not null)       as decididos,
       count(*) filter (where g.automatica)                    as automaticos,
       count(*) filter (where g.sem_lider_na_submissao)        as sem_lider,
       max(g.aprovado_em) at time zone 'America/Sao_Paulo'     as ultima_decisao_brt
  from public.compras_requisicoes_aprovacao_grupos g
 group by g.requisicao_id
 order by 6 desc nulls last;


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
