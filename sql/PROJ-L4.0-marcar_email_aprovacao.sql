-- =====================================================================
-- PROJ-L4.0 — projeto_marcar_email_aprovacao   (correcao do achado A-7)
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md · achado A-7 · decisao D-15
--
-- ESTADO: PENDENTE de aplicacao. Rodar ANTES do Publish do L4.
--
-- O BUG (A-7, comprovado nos dados em 07/08):
--   ProjetoRequisicoes.tsx:579 grava email_aprovacao_enviado_em com .upsert()
--   em `projetos`, SEM capturar `error`, e DEPOIS que enviar_budget_para_aprovacao
--   ja mudou a fase para 'budget_em_aprovacao'. A policy de UPDATE nao cobre:
--   o ramo edit_own exige fase_atual='budget' e a responsavel nao e a aprovadora.
--   Resultado medido: os 2 projetos da Ana tem enviado_para_aprovacao_em
--   preenchido e email_aprovacao_enviado_em NULL; o do admin (bypass) tem os dois.
--
-- A CORRECAO (D-15): RPC dedicada, SECURITY DEFINER, gate admin OU responsavel,
--   SEM restricao de fase — a fase e justamente o que derruba o caminho direto.
--
-- Descartado de proposito: gravar o timestamp dentro de
--   enviar_budget_para_aprovacao, que roda ANTES do e-mail e registraria um
--   envio que pode nunca ter acontecido.
--
-- PRE-REQUISITO: nenhum alem das tabelas do modulo (nao depende do L3).
-- =====================================================================

drop function if exists public.projeto_marcar_email_aprovacao(uuid);

create or replace function public.projeto_marcar_email_aprovacao(p_projeto_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_uid      uuid := auth.uid();
  v_is_admin boolean;
  v_proj     public.projetos%rowtype;
  v_quando   timestamptz;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  v_is_admin := public._is_admin();

  select * into v_proj from public.projetos where id = p_projeto_id for update;
  if not found then
    raise exception 'Projeto não encontrado' using errcode = 'P0002';
  end if;

  -- Gate: admin OU responsavel. SEM checagem de fase (ver cabecalho).
  if not v_is_admin and v_proj.responsavel_id is distinct from v_uid then
    raise exception 'Apenas o responsável do projeto pode registrar o envio do e-mail'
      using errcode = '42501';
  end if;

  -- Idempotente: se ja houver timestamp, mantem o primeiro (o envio original).
  v_quando := coalesce(v_proj.email_aprovacao_enviado_em, now());

  update public.projetos
     set email_aprovacao_enviado_em = v_quando,
         updated_at                 = now()
   where id = p_projeto_id;

  return jsonb_build_object(
    'success', true,
    'projeto_id', p_projeto_id,
    'email_aprovacao_enviado_em', v_quando,
    'ja_estava_registrado', (v_proj.email_aprovacao_enviado_em is not null)
  );
end;
$function$;

revoke all     on function public.projeto_marcar_email_aprovacao(uuid) from public, anon;
grant  execute on function public.projeto_marcar_email_aprovacao(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

-- =====================================================================
-- VERIFICACAO POR LEITURA
-- =====================================================================
select p.proname,
       pg_get_function_identity_arguments(p.oid)                 as assinatura,
       p.prosecdef                                               as security_definer,
       p.proconfig::text                                         as search_path,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  as auth_executa,
       has_function_privilege('anon',          p.oid, 'EXECUTE')  as anon_executa,
       (pg_get_functiondef(p.oid) ~* $re$responsavel_id\s+is\s+distinct\s+from\s+v_uid$re$) as gate_por_responsavel,
       (pg_get_functiondef(p.oid) ilike '%fase_atual%')           as restringe_fase
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='projeto_marcar_email_aprovacao';
-- Esperado: true | {"search_path=public, auth"} | true | false | true | FALSE
--   restringe_fase = false e o ponto do D-15.

-- Estado do A-7 antes/depois (rodar de novo apos o L6 para ver virar true):
select nome, fase_atual,
       enviado_para_aprovacao_em  is not null as teve_envio_aprovacao,
       email_aprovacao_enviado_em is not null as gravou_timestamp_email
  from public.projetos order by created_at;
-- Hoje (medido 07/08): Rio Valves = true/FALSE · Caipira = true/FALSE · teste = true/true

-- =====================================================================
-- SMOKE TEST (opcional; Regra 10: sem temp table, um bloco, rollback no fim)
-- Esperado: success=true, ja_estava_registrado=false
-- =====================================================================
/*
begin;
select set_config('request.jwt.claims',
       json_build_object('sub','e96876e1-57d3-4ca2-ac14-c20931e95489',
                         'role','authenticated')::text, true);
set local role authenticated;
select public.projeto_marcar_email_aprovacao(
         (select id from public.projetos where nome='Congresso Rio Valves')) as resultado;
rollback;
*/

-- =====================================================================
-- ROLLBACK:
--   drop function if exists public.projeto_marcar_email_aprovacao(uuid);
--   notify pgrst, 'reload schema';
-- =====================================================================
