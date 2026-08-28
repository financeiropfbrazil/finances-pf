-- =====================================================================
-- §14.2-A defesa (a) — alinhar o CHECK de compras_requisicoes_auditoria
--                      ao valor que o código já monta: 'sync_status'
-- Preparado em 28/08/2026. Pedro executa no SQL Editor.
-- =====================================================================
--
-- POR QUE ESTE SQL EXISTE
-- O cron de requisições monta `eventoAudit = "sync_status"` no ramo em que o
-- status volta a `sincronizada`
-- (supabase/functions/sync-compras-status-cron/index.ts, ~:1113).
-- `sync_status` NÃO está no CHECK `compras_requisicoes_auditoria_evento_check`
-- — 15 valores, nenhum é esse (conferido pelo MCP em 28/08/2026 10:54 UTC).
-- O insert seria REJEITADO pelo banco.
--
-- Hoje é código morto por ACIDENTE DE FLUXO, não por desenho: a fila só traz
-- requisições já em `sincronizada` (`:970`), o mapper devolve `sincronizada`, e
-- a execução para no `if (novoStatus === req.status)` de cima. É por isso que
-- `sync_status` tem zero ocorrências na tabela. Quem mexer no filtro da fila
-- acorda o defeito.
--
-- 🔴 AS DUAS DEFESAS SÃO COMPLEMENTARES. NENHUMA BASTA SOZINHA.
--   (a) ESTE SQL: alinha o CHECK ao código. Conserta ESTE valor, não a classe.
--   (b) JÁ COMMITADO (`9171141`, exige deploy da Edge Function): o insert passa
--       a conferir o `error` e NÃO conta `total_mudaram++` quando ele falha.
--       Conserta a CLASSE — qualquer evento futuro fora do CHECK.
--   Sem (b), um valor novo fora do CHECK reproduz o problema inteiro.
--   Sem (a), o ciclo passa a acusar erro em vez de mentir — mas o status
--   continua sendo gravado sem auditoria, que é o dano do §14.2.
--
-- ORDEM: tanto faz. (a) e (b) são independentes e nenhuma depende da outra para
-- ser segura. Se rodar (a) antes do deploy de (b), o efeito é só que o ramo
-- passa a poder gravar — o que já é melhor do que rejeitar em silêncio.
--
-- RISCO: baixo. Um CHECK que ACRESCENTA um valor aceito nunca invalida linha
-- existente. Ainda assim o BLOCO 2 valida a constraint contra a tabela inteira
-- antes de trocar, e o BLOCO 4 remede.
--
-- ⚠️ A tabela é append-only desde o card B4 (INSERT mantido, UPDATE/DELETE
-- revogados). Este script NÃO mexe em grants nem em policies — só na constraint.
-- =====================================================================


-- ---------------------------------------------------------------------
-- BLOCO 0 — PRÉ-VOO. Confirma o projeto ANTES de qualquer escrita.
-- Esperado: fp_pedidos na casa dos milhares (ordem de 2.000 em ago/2026) e
-- fp_tabela = true. O número exato NÃO é critério — quem identifica o projeto é
-- o project_ref hbtggrbauguukewiknew na conexão.
-- ---------------------------------------------------------------------
select current_database()                                            as db,
       (select count(*) from public.compras_pedidos)                 as fp_pedidos,
       (to_regclass('public.compras_requisicoes_auditoria') is not null) as fp_tabela,
       now() at time zone 'UTC'                                      as agora_utc;


-- ---------------------------------------------------------------------
-- BLOCO 1 — PREVIEW. Não escreve nada.
-- (1a) O CHECK como está hoje. (1b) Os eventos realmente presentes na tabela.
-- (1c) Confirma que 'sync_status' não é aceito HOJE e não existe HOJE.
-- ---------------------------------------------------------------------
select con.conname, pg_get_constraintdef(con.oid) as definicao_atual
from pg_constraint con
join pg_class c      on c.oid = con.conrelid
join pg_namespace n  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'compras_requisicoes_auditoria'
  and con.contype = 'c';

select evento, count(*) as linhas, min(created_at) as primeiro, max(created_at) as ultimo
from public.compras_requisicoes_auditoria
group by evento
order by linhas desc;

select
  (select count(*) from public.compras_requisicoes_auditoria where evento = 'sync_status') as ja_existem_sync_status,
  (select pg_get_constraintdef(con.oid) like '%sync_status%'
     from pg_constraint con
     join pg_class c     on c.oid = con.conrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='compras_requisicoes_auditoria'
      and con.conname='compras_requisicoes_auditoria_evento_check')                        as check_ja_aceita;
-- Esperado ANTES: ja_existem_sync_status = 0  e  check_ja_aceita = false.


-- ---------------------------------------------------------------------
-- BLOCO 2 — APPLY. Idempotente: pode rodar duas vezes sem efeito diferente.
--
-- A lista abaixo é o CHECK vigente, LIDO do banco em 28/08/2026 10:54 UTC,
-- MAIS 'sync_status'. Nenhum valor foi removido — confira contra o BLOCO 1
-- antes de rodar; se o CHECK do banco divergir desta lista, PARE: alguém mexeu
-- nele entre a leitura e agora.
--
-- `NOT VALID` + `VALIDATE` em vez de um ADD direto: a validação passa a ser um
-- passo próprio, que trava se alguma linha existente não couber. Como este CHECK
-- só ACRESCENTA um valor, ele não pode reprovar nada — e é exatamente por isso
-- que o VALIDATE tem de rodar e passar, em vez de ser presumido.
-- ---------------------------------------------------------------------
begin;

alter table public.compras_requisicoes_auditoria
  drop constraint if exists compras_requisicoes_auditoria_evento_check;

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
    -- NOVO — §14.2-A defesa (a). O cron já monta este valor; o CHECK é que não o
    -- aceitava. Gêmeo no código: sync-compras-status-cron/index.ts, `eventoAudit`.
    'sync_status'::text
  ])) not valid;

alter table public.compras_requisicoes_auditoria
  validate constraint compras_requisicoes_auditoria_evento_check;

commit;


-- ---------------------------------------------------------------------
-- BLOCO 3 — NOTIFY. O CHECK não muda a API, mas custa nada e evita cache velho.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- BLOCO 4 — VERIFY. Remedindo na hora. Não confie no "Success" do editor.
-- Esperado: v_aceita_sync_status = true, v_validada = true, v_qtd_valores = 16,
-- e v_eventos_orfaos = 0 (nenhuma linha existente ficou fora do CHECK novo).
-- ---------------------------------------------------------------------
select
  con.conname,
  pg_get_constraintdef(con.oid)                                     as definicao_nova,
  pg_get_constraintdef(con.oid) like '%sync_status%'                as v_aceita_sync_status,
  con.convalidated                                                  as v_validada,
  (select count(*)
     from regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''::text', 'g')) as v_qtd_valores
from pg_constraint con
join pg_class c      on c.oid = con.conrelid
join pg_namespace n  on n.oid = c.relnamespace
where n.nspname='public'
  and c.relname='compras_requisicoes_auditoria'
  and con.conname='compras_requisicoes_auditoria_evento_check';

-- Nenhuma linha existente pode ter ficado fora (deve devolver 0).
select count(*) as v_eventos_orfaos
from public.compras_requisicoes_auditoria
where evento not in (
  'criada','editada','envio_tentado','envio_sucesso','envio_falha','cancelada_alvo',
  'convertida_pedido','vinculado_pedido','desvinculado_pedido','enviada_aprovacao',
  'aprovada_lider','rejeitada_lider','submetida_sem_gate',
  'envio_pos_aprovacao_sucesso','envio_pos_aprovacao_falha','sync_status'
);

-- Prova funcional do que se quer: um INSERT com 'sync_status' passa a ser aceito.
-- Roda dentro de BEGIN/ROLLBACK, então NADA é gravado.
begin;
  insert into public.compras_requisicoes_auditoria (requisicao_id, evento, user_nome, sucesso)
  select id, 'sync_status', 'PROVA DO VERIFY — nao gravado', true
  from public.compras_requisicoes limit 1;
  select 'INSERT com sync_status ACEITO (e revertido a seguir)' as v_prova_funcional;
rollback;


-- =====================================================================
-- ROLLBACK — NÃO EXECUTAR. Só para guardar.
-- Volta o CHECK exatamente ao que estava em 28/08/2026 10:54 UTC.
-- =====================================================================
-- begin;
-- alter table public.compras_requisicoes_auditoria
--   drop constraint if exists compras_requisicoes_auditoria_evento_check;
-- alter table public.compras_requisicoes_auditoria
--   add constraint compras_requisicoes_auditoria_evento_check
--   check (evento = any (array[
--     'criada'::text,'editada'::text,'envio_tentado'::text,'envio_sucesso'::text,
--     'envio_falha'::text,'cancelada_alvo'::text,'convertida_pedido'::text,
--     'vinculado_pedido'::text,'desvinculado_pedido'::text,'enviada_aprovacao'::text,
--     'aprovada_lider'::text,'rejeitada_lider'::text,'submetida_sem_gate'::text,
--     'envio_pos_aprovacao_sucesso'::text,'envio_pos_aprovacao_falha'::text
--   ]));
-- commit;
-- ⚠️ O rollback só é seguro enquanto NÃO existir linha com evento='sync_status'.
--    Confira antes: select count(*) from public.compras_requisicoes_auditoria
--                    where evento='sync_status';
