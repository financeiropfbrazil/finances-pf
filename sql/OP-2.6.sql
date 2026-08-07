-- =============================================================================
-- OP-2.6 · Registrar o job 'reqmat' no roteador das telas de cron
-- =============================================================================
-- Projeto Supabase: hbtggrbauguukewiknew  (Financial Hub)
-- Aplicar no SQL EDITOR. NÃO usar supabase db push (proibido neste projeto).
-- Idempotente e reexecutável. Verificação e rollback no fim do arquivo.
--
-- ESCOPO: DUAS funções, uma linha nova em cada. Nenhuma tabela, coluna, policy,
-- grant, cron job ou secret é tocado. Não há DML.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 PEDRO — QUANDO APLICAR
-- ─────────────────────────────────────────────────────────────────────────────
-- APLIQUE FORA DAS JANELAS DE CRON. `CREATE OR REPLACE FUNCTION` troca a
-- definição enquanto o banco está no ar, e CINCO telas de cron em produção
-- (Requisições, Despesas, DocFin, NF-e, Intercompany) resolvem o job por
-- `_sync_cron_resolve` a cada 30 s de refetch.
--
-- Minutos OCUPADOS (levantados de `cron.job` em 07/08/2026, 12 jobs ativos):
--
--     :00   sync-compras-status-cron · sync-despesas · sync-lote · sync-produtos
--           · sync-empregare · tomticket-onboarding · notify-pedido-* (*/15)
--     :10   sync-docfin-3x-dia
--     :15   notify-pedido-criador-scan · notify-pedido-concluido-scan (*/15)
--     :25   sync-reqmat-4x-dia
--     :30   sync-intercompany-3x-dia · notify-pedido-* (*/15)
--     :45   sync-laudos-4x-dia · notify-pedido-* (*/15)
--
-- ⇒ JANELA SEGURA: qualquer minuto em :05, :20, :35, :40, :50 ou :55.
--    (Os dois `notify-pedido-*` rodam a cada 15 min o dia inteiro; por isso
--    :15/:30/:45 estão fora mesmo fora do horário comercial.)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DEPENDÊNCIAS — CONFERIDAS EM 07/08/2026 (MCP read-only, fingerprint
-- `compras_pedidos` = 1819). AS DUAS JÁ EXISTEM; este arquivo não as cria.
-- ─────────────────────────────────────────────────────────────────────────────
-- ✅ `sync_settings` tem a linha do job:
--       job_name      = 'sync-reqmat'
--       schedule_cron = '25 12,15,18,21 * * 1-5'
--       enabled       = true
--       paused_at     = null   (paused_by e paused_reason também null)
--
-- ✅ `sync_runs` já aceita o tipo: `sync_runs_job_type_check` enumera
--    ('requisicoes','pedidos','bicephalous','despesas','docfin_despesas',
--     'nfe','intercompany','lote','produtos','laudos','reqmat')
--    — 'reqmat' entrou na OP-2.3. Execuções registradas desde 05/08/2026,
--    TODAS com `total_erros = 0` (12 na conferência de 07/08 às 16h05 BRT,
--    4 delas `triggered_by='pg_cron'`).
--
-- ✅ `cron.job` jobid 25 'sync-reqmat-4x-dia', schedule '25 12,15,18,21 * * 1-5',
--    active = true — em sincronia com `sync_settings.schedule_cron`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE NÃO EXISTE RPC INTERMEDIÁRIA (o ponto da tarefa)
-- ─────────────────────────────────────────────────────────────────────────────
-- `call_sync_reqmat_cron` é a ÚNICA das nove `call_sync_*_cron` sem EXECUTE
-- para `anon`/`authenticated` — nasceu com REVOKE na OP-2.3, de propósito.
-- Isso NÃO impede o botão "Rodar Agora": `sync_cron_trigger_now` é
-- SECURITY DEFINER com owner `postgres`, então a chamada interna roda com os
-- privilégios do owner e o REVOKE não a alcança. O usuário continua sem poder
-- chamar `call_sync_reqmat_cron` diretamente — que é exatamente o desejado.
--
-- ⇒ Duas linhas de SQL, e o disparador segue trancado.
--
-- (Verificado: `_sync_cron_resolve`, `sync_cron_trigger_now`,
--  `call_sync_reqmat_cron` — os três com proowner = 'postgres'.)
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUE AS FUNÇÕES VÃO INTEIRAS, E NÃO SÓ O `case` NOVO
-- ─────────────────────────────────────────────────────────────────────────────
-- `CREATE OR REPLACE FUNCTION` substitui o corpo INTEIRO — não existe "replace
-- parcial". Pior: ele NÃO herda `SECURITY DEFINER` nem `SET search_path` da
-- definição anterior. Um replace que esquecesse essas duas cláusulas
-- transformaria `sync_cron_trigger_now` numa função SECURITY INVOKER com
-- search_path da sessão — e ela deixaria de conseguir chamar as
-- `call_sync_*_cron` (perderia o owner) e de enxergar `vault`. Armadilha
-- registrada no repo; por isso as duas funções aparecem abaixo por extenso,
-- copiadas de `pg_get_functiondef()` em 07/08/2026 com uma linha acrescentada
-- em cada.
--
-- ⚠ `_sync_cron_resolve` é IMMUTABLE e **não** é SECURITY DEFINER (proconfig
--   null, prosecdef false — medido). Preservado como está: ela só resolve
--   literais, não lê nenhum objeto, então não precisa de definer nem de
--   search_path fixo. Não a "endureça" ao mexer.
--
-- ⚠ Ao acrescentar um job novo aqui no futuro, lembre que ele passa a valer de
--   uma vez para as SEIS telas: status, histórico, pausar, despausar e rodar
--   agora — `sync_cron_get_status`, `sync_cron_list_runs`, `sync_cron_pause` e
--   `sync_cron_resume` também resolvem por esta função.
-- =============================================================================


-- =============================================================================
-- 1) `_sync_cron_resolve` — alias do job → (job_name, job_type)
-- =============================================================================
-- Diferença para a versão em produção: SOMENTE o ramo 'reqmat'.
create or replace function public._sync_cron_resolve(p_job text)
returns table(job_name text, job_type text)
language plpgsql
immutable
as $function$
begin
  case p_job
    when 'compras' then
      job_name := 'sync-compras-status-cron'; job_type := 'bicephalous';
    when 'nfe' then
      job_name := 'sync-nfe'; job_type := 'nfe';
    when 'intercompany' then
      job_name := 'sync-intercompany'; job_type := 'intercompany';
    when 'reqmat' then                                        -- ✅ OP-2.6
      job_name := 'sync-reqmat'; job_type := 'reqmat';
    else
      raise exception 'Job desconhecido: %', p_job;
  end case;
  return next;
end;
$function$;


-- =============================================================================
-- 2) `sync_cron_trigger_now` — botão "Rodar Agora" das telas
-- =============================================================================
-- Diferença para a versão em produção: SOMENTE o ramo 'reqmat' do segundo
-- `case`. `SECURITY DEFINER` e `SET search_path` reescritos por obrigação
-- (ver a nota no cabeçalho) — os valores são os mesmos de hoje.
create or replace function public.sync_cron_trigger_now(p_job text default 'compras'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'vault', 'extensions'
as $function$
declare
  v_settings RECORD;
  v_request_id bigint;
  v_job_name text;
begin
  if not _user_has_perm('ferramentas.cron.view') then
    raise exception 'Sem permissão: ferramentas.cron.view';
  end if;
  if auth.uid() is null then raise exception 'Sessão sem auth.uid()'; end if;

  select job_name into v_job_name from _sync_cron_resolve(p_job);

  select enabled, paused_reason into v_settings
  from sync_settings where job_name = v_job_name limit 1;

  if not v_settings.enabled then
    raise exception 'Cron está pausado (motivo: %). Despause antes de rodar manualmente.',
      COALESCE(v_settings.paused_reason, 'sem motivo registrado');
  end if;

  case p_job
    when 'compras' then v_request_id := call_sync_compras_status_cron('manual_admin');
    when 'nfe'     then v_request_id := call_sync_nfe_cron('manual_admin');
    when 'intercompany' then v_request_id := call_sync_intercompany_cron('manual_admin');
    when 'reqmat'  then v_request_id := call_sync_reqmat_cron('manual_admin');  -- ✅ OP-2.6
    else raise exception 'Job sem função de disparo: %', p_job;
  end case;

  return jsonb_build_object('ok', true, 'request_id', v_request_id,
    'triggered_at', now(),
    'message', 'Cron disparado manualmente. Acompanhe via histórico.');
end;
$function$;


-- =============================================================================
-- 3) PostgREST — recarregar o cache de schema
-- =============================================================================
-- Sem isto, a chamada `supabase.rpc('sync_cron_trigger_now', {p_job:'reqmat'})`
-- pode continuar batendo na assinatura em cache até o próximo reload.
notify pgrst, 'reload schema';


-- =============================================================================
-- VERIFICAÇÃO EMPÍRICA (rodar no SQL Editor logo após aplicar)
-- =============================================================================
-- a) o roteador conhece o job novo E os três antigos continuam de pé:
--
--   select 'compras' as alias, * from public._sync_cron_resolve('compras')
--   union all select 'nfe',          * from public._sync_cron_resolve('nfe')
--   union all select 'intercompany', * from public._sync_cron_resolve('intercompany')
--   union all select 'reqmat',       * from public._sync_cron_resolve('reqmat');
--
--   Esperado: 4 linhas; a de 'reqmat' com job_name='sync-reqmat' e
--   job_type='reqmat'. Se qualquer uma das três primeiras sumir ou mudar,
--   ROLLBACK imediato — são as telas em produção.
--
-- b) alias inexistente continua falhando alto (não devolve linha vazia):
--
--   select * from public._sync_cron_resolve('nao-existe');
--   -- Esperado: ERROR  Job desconhecido: nao-existe
--
-- c) as duas funções mantiveram os atributos (a armadilha do CREATE OR REPLACE):
--
--   select proname,
--          prosecdef                         as security_definer,
--          provolatile                       as volatilidade,
--          proconfig                         as search_path,
--          pg_get_userbyid(proowner)         as owner
--     from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('_sync_cron_resolve','sync_cron_trigger_now');
--
--   Esperado, EXATAMENTE:
--     _sync_cron_resolve    | f | i | (null)                              | postgres
--     sync_cron_trigger_now | t | v | {"search_path=public, vault, extensions"} | postgres
--
-- d) o disparador segue TRANCADO para o usuário final (é o ponto da tarefa):
--
--   select has_function_privilege('anon',          'public.call_sync_reqmat_cron(text)', 'EXECUTE') as anon,
--          has_function_privilege('authenticated', 'public.call_sync_reqmat_cron(text)', 'EXECUTE') as auth;
--
--   Esperado: false / false. Este arquivo não concede nada — se virar true,
--   algo mais foi aplicado junto.
--
-- e) na TELA (`Ferramentas > Cron RM`), com o Pedro logado no app:
--    · o cartão de status carrega (schedule '25 12,15,18,21 * * 1-5', Ativo);
--    · o histórico lista as execuções de `job_type='reqmat'`;
--    · "Rodar Agora" responde sem erro e nasce uma linha nova em `sync_runs`
--      com `triggered_by='manual_admin'` (~55 s até `finished_at`):
--
--   select started_at, finished_at, duracao_ms, triggered_by, total_erros, observacao
--     from public.sync_runs where job_type='reqmat'
--    order by started_at desc limit 3;
--
-- f) as CINCO telas antigas continuam vivas — teste de fumaça obrigatório,
--    é o único risco real desta mudança. Abrir e ver o status carregar em:
--    /ferramentas/cron-req · /ferramentas/cron-despesas · /ferramentas/cron-docfin
--    /ferramentas/cron-nfe · /ferramentas/cron-intercompany
--
--    ⚠ Duas delas ('despesas' e 'docfin') NÃO passam por `_sync_cron_resolve`
--      — usam RPCs dedicadas. As que dependem de verdade são cron-req,
--      cron-nfe e cron-intercompany.


-- =============================================================================
-- ROLLBACK — as duas funções como estavam em 07/08/2026, ANTES desta aplicação
-- =============================================================================
-- Colar as duas juntas e o `notify` no fim. Reverte 100% do arquivo.
--
-- create or replace function public._sync_cron_resolve(p_job text)
-- returns table(job_name text, job_type text)
-- language plpgsql
-- immutable
-- as $function$
-- begin
--   case p_job
--     when 'compras' then
--       job_name := 'sync-compras-status-cron'; job_type := 'bicephalous';
--     when 'nfe' then
--       job_name := 'sync-nfe'; job_type := 'nfe';
--     when 'intercompany' then
--       job_name := 'sync-intercompany'; job_type := 'intercompany';
--     else
--       raise exception 'Job desconhecido: %', p_job;
--   end case;
--   return next;
-- end;
-- $function$;
--
-- create or replace function public.sync_cron_trigger_now(p_job text default 'compras'::text)
-- returns jsonb
-- language plpgsql
-- security definer
-- set search_path to 'public', 'vault', 'extensions'
-- as $function$
-- declare
--   v_settings RECORD;
--   v_request_id bigint;
--   v_job_name text;
-- begin
--   if not _user_has_perm('ferramentas.cron.view') then
--     raise exception 'Sem permissão: ferramentas.cron.view';
--   end if;
--   if auth.uid() is null then raise exception 'Sessão sem auth.uid()'; end if;
--
--   select job_name into v_job_name from _sync_cron_resolve(p_job);
--
--   select enabled, paused_reason into v_settings
--   from sync_settings where job_name = v_job_name limit 1;
--
--   if not v_settings.enabled then
--     raise exception 'Cron está pausado (motivo: %). Despause antes de rodar manualmente.',
--       COALESCE(v_settings.paused_reason, 'sem motivo registrado');
--   end if;
--
--   case p_job
--     when 'compras' then v_request_id := call_sync_compras_status_cron('manual_admin');
--     when 'nfe'     then v_request_id := call_sync_nfe_cron('manual_admin');
--     when 'intercompany' then v_request_id := call_sync_intercompany_cron('manual_admin');
--     else raise exception 'Job sem função de disparo: %', p_job;
--   end case;
--
--   return jsonb_build_object('ok', true, 'request_id', v_request_id,
--     'triggered_at', now(),
--     'message', 'Cron disparado manualmente. Acompanhe via histórico.');
-- end;
-- $function$;
--
-- notify pgrst, 'reload schema';
--
-- ⚠ Depois do rollback, a tela `Ferramentas > Cron RM` passa a dar
--   "Job desconhecido: reqmat" ao carregar. O cron automático NÃO é afetado:
--   o pg_cron chama `call_sync_reqmat_cron` direto, sem passar por aqui.


-- =============================================================================
-- NOTA DE PASSAGEM — correção ao rollback do `sql/OP-2.5.sql`
-- =============================================================================
-- Aquele arquivo sugere, no bloco de rollback:
--
--   select public.sync_cron_pause(p_reason => 'motivo', p_job => 'sync-reqmat');
--
-- `p_job` é o ALIAS, não o `job_name` — hoje essa linha falha com
-- "Job desconhecido: sync-reqmat". DEPOIS de aplicar este arquivo, a forma
-- correta passa a existir e é:
--
--   select public.sync_cron_pause(p_reason => 'motivo', p_job => 'reqmat');
--   select public.sync_cron_resume(p_job => 'reqmat');
--
-- (O `sql/OP-2.5.sql` não foi alterado — bloco já registrado é imutável.)
