-- =====================================================================
-- §14.2-A defesa (a) — alinhar o CHECK de compras_requisicoes_auditoria
--            aos DOIS valores que o código já monta: 'sync_status' e 'descoberta_alvo'
-- Preparado em 28/08/2026, corrigido no mesmo dia (ver §URGÊNCIA). Pedro executa.
-- =====================================================================
--
-- POR QUE ESTE SQL EXISTE
-- O cron de requisições monta `eventoAudit = "sync_status"` no ramo em que o
-- status volta a `sincronizada` — em DOIS lugares de
-- supabase/functions/sync-compras-status-cron/index.ts: no Job 1
-- (`syncStatusRequisicoes`) e no Job 4 (`syncDescobrirRequisicoes`, ramo de
-- reabertura).
-- `sync_status` NÃO está no CHECK `compras_requisicoes_auditoria_evento_check`
-- — 15 valores, nenhum é esse (conferido pelo MCP em 28/08/2026 10:54 UTC).
-- O insert seria REJEITADO pelo banco.
--
-- ⚠️ CORREÇÃO DE 28/08/2026 — ESTE SQL DEIXOU DE SER PREVENTIVO.
-- A primeira versão deste arquivo dizia que `sync_status` era "código morto por
-- acidente de fluxo". Isso vale para o **Job 1**, e só para ele: lá a fila é
-- `.eq("status","sincronizada")` e o mapper devolve os valores que já estão no
-- CHECK. **Mas o mesmo ternário existe no Job 4** (`syncDescobrirRequisicoes`,
-- ramo de reabertura), e lá ele É alcançável: `reaberturaConfirmada` libera o
-- rebaixamento `convertida_pedido` → `sincronizada`, o UPDATE grava o status e
-- zera `numero_pedido_compra_alvo`, e o insert de auditoria é rejeitado em
-- silêncio. **É a assinatura exata das 6 requisições do §14.2** — 5 com o vínculo
-- zerado ali, e a 0001215 com vínculo porque o Job 2/Job 3 re-vinculam quando o
-- campo está null (o que também explica a "anomalia dentro da anomalia").
--
-- 🔴 E há um SEGUNDO evento fora do CHECK, pior porque já falha há três meses:
-- `descoberta_alvo`, montado no ramo de INSERT do Job 4 desde 26/05/2026.
-- **MEDIDO em 28/08/2026 11:4x UTC:** `descoberta_alvo` tem **0 linhas** na
-- tabela, e **69 requisições não têm NENHUMA linha de auditoria** — todas com
-- `requisitante_user_id` null, isto é, **todas nascidas no Job 4** (que já
-- descobriu 125 no total). Toda requisição nova vinda do Alvo entra no Hub sem
-- linha de origem, e o ciclo conta como sucesso.
--
-- ⇒ Sem este SQL, a defesa (b) faz o cron passar a ACUSAR o erro — mas a escrita
--   continua acontecendo sem auditoria. Os dois valores precisam entrar.
--
-- 🔴 AS DUAS DEFESAS SÃO COMPLEMENTARES. NENHUMA BASTA SOZINHA.
--   (a) ESTE SQL: alinha o CHECK ao código. Conserta ESTES DOIS valores, não a classe.
--   (b) JÁ COMMITADO (`9171141` + o commit de correção que estendeu ao Job 4;
--       exige deploy da Edge Function): os inserts passam a conferir o `error`.
--       Conserta a CLASSE — qualquer evento futuro fora do CHECK.
--   Sem (b), um valor novo fora do CHECK reproduz o problema inteiro.
--   Sem (a), o ciclo passa a acusar erro em vez de mentir — mas o status
--   continua sendo gravado sem auditoria, que é o dano do §14.2.
--
-- ORDEM: tanto faz. (a) e (b) são independentes e nenhuma depende da outra para
-- ser segura. Se rodar (a) antes do deploy de (b), o efeito é só que o ramo
-- passa a poder gravar — o que já é melhor do que rejeitar em silêncio.
--
-- RISCO: baixo. Um CHECK que ACRESCENTA valores aceitos nunca invalida linha
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
  (select count(*) from public.compras_requisicoes_auditoria where evento = 'sync_status')     as ja_existem_sync_status,
  (select count(*) from public.compras_requisicoes_auditoria where evento = 'descoberta_alvo') as ja_existem_descoberta_alvo,
  (select count(*) from public.compras_requisicoes r
     where not exists (select 1 from public.compras_requisicoes_auditoria a where a.requisicao_id = r.id)) as reqs_sem_auditoria_nenhuma,
  (select pg_get_constraintdef(con.oid) like '%sync_status%'
     from pg_constraint con
     join pg_class c     on c.oid = con.conrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='compras_requisicoes_auditoria'
      and con.conname='compras_requisicoes_auditoria_evento_check')                        as check_ja_aceita;
-- Esperado ANTES (medido 28/08/2026 11:4x UTC): ja_existem_sync_status = 0,
-- ja_existem_descoberta_alvo = 0, reqs_sem_auditoria_nenhuma = 69, check_ja_aceita = false.
-- 🔴 As 69 são o passivo já materializado: requisições descobertas pelo Job 4 sem
--    linha de origem. Este SQL NÃO as recupera — a resposta do Alvo daquele momento
--    não existe mais. Ele só impede que a 70ª aconteça.


-- ---------------------------------------------------------------------
-- BLOCO 2 — APPLY. Idempotente: pode rodar duas vezes sem efeito diferente.
--
-- A lista abaixo é o CHECK vigente, LIDO do banco em 28/08/2026 10:54 UTC,
-- MAIS 'sync_status' e 'descoberta_alvo'. Nenhum valor foi removido — confira
-- contra o BLOCO 1 antes de rodar; se o CHECK do banco divergir desta lista,
-- PARE: alguém mexeu nele entre a leitura e agora.
--
-- `NOT VALID` + `VALIDATE` em vez de um ADD direto: a validação passa a ser um
-- passo próprio, que trava se alguma linha existente não couber. Como este CHECK
-- só ACRESCENTA valores, ele não pode reprovar nada — e é exatamente por isso
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
    -- NOVOS — §14.2-A defesa (a). O cron já monta os dois valores; o CHECK é que
    -- não os aceitava. Gêmeos no código, em sync-compras-status-cron/index.ts:
    --   'sync_status'     → `eventoAudit` no Job 1 (inalcançável) E no Job 4
    --                       (ramo de reabertura — ALCANÇÁVEL, é o do §14.2)
    --   'descoberta_alvo' → ramo de INSERT do Job 4, falhando desde 26/05/2026
    'sync_status'::text,
    'descoberta_alvo'::text
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
-- Esperado: v_aceita_sync_status = true, v_aceita_descoberta_alvo = true,
-- v_validada = true, v_qtd_valores = 17,
-- e v_eventos_orfaos = 0 (nenhuma linha existente ficou fora do CHECK novo).
-- ---------------------------------------------------------------------
select
  con.conname,
  pg_get_constraintdef(con.oid)                                     as definicao_nova,
  pg_get_constraintdef(con.oid) like '%sync_status%'                as v_aceita_sync_status,
  pg_get_constraintdef(con.oid) like '%descoberta_alvo%'            as v_aceita_descoberta_alvo,
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
  'envio_pos_aprovacao_sucesso','envio_pos_aprovacao_falha','sync_status','descoberta_alvo'
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
-- ⚠️ O rollback só é seguro enquanto NÃO existir linha com 'sync_status' nem
--    'descoberta_alvo'. Confira antes:
--    select evento, count(*) from public.compras_requisicoes_auditoria
--     where evento in ('sync_status','descoberta_alvo') group by 1;
-- ⚠️ E lembre que o rollback REARMA a armadilha do Job 4: volta a rejeitar a
--    auditoria de toda requisição descoberta e de toda reabertura.
