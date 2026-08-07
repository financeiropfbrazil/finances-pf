-- =====================================================================
-- PROJ-L2.0 — Helper interna de log de evento
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md secao 4 (L2)
--
-- ESTADO: APLICADO em 07/08/2026 (verificado: secdef=true,
--         search_path=public/auth, auth_executa=false apos o revoke).
--
-- PRE-REQUISITO: PROJ-L1 aplicado (tabela projeto_eventos).
--
-- POR QUE EXISTE:
--   1. A coluna `evento` nao tem CHECK (decisao registrada). O catalogo fechado
--      aqui dentro faz o papel do CHECK num lugar so — um typo vira excecao,
--      nao categoria fantasma no report.
--   2. Centraliza a resolucao do e-mail por profiles.user_id (FH47 /
--      Permissoes_v2 §2.4). NUNCA profiles.id.
--
-- NAO E ENDPOINT: revogada de authenticated/anon de proposito. So as RPCs
--   SECURITY DEFINER do L2 a chamam (executam como owner).
-- =====================================================================

drop function if exists public.projeto_evento_log(uuid,uuid,text,text,numeric,numeric,jsonb);

create or replace function public.projeto_evento_log(
  p_projeto_id    uuid,
  p_requisicao_id uuid,
  p_evento        text,
  p_fase          text    default null,
  p_valor_antes   numeric default null,
  p_valor_depois  numeric default null,
  p_detalhes      jsonb   default null
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  -- CATALOGO FECHADO. Evento novo => acrescentar AQUI (unico lugar) antes de usar.
  c_eventos constant text[] := array[
    'pedido_criado', 'pedido_editado', 'pedido_excluido',
    'pedido_enviado_alvo', 'teto_rejeitado',
    'budget_enviado_aprovacao', 'budget_aprovado'
  ];
  v_uid   uuid := auth.uid();
  v_email text;
  v_id    uuid;
begin
  if p_evento is null or not (p_evento = any (c_eventos)) then
    raise exception 'Evento desconhecido: "%". Permitidos: %',
      coalesce(p_evento, '<null>'), array_to_string(c_eventos, ', ')
      using errcode = '22023';
  end if;

  -- FH47 / Permissoes_v2 §2.4: SEMPRE profiles.user_id = auth.uid(). NUNCA profiles.id.
  -- E-mail e enfeite de report: se nao resolver, grava null e segue.
  begin
    select pr.email into v_email
      from public.profiles pr
     where pr.user_id = v_uid;
  exception when others then
    v_email := null;
  end;

  insert into public.projeto_eventos (
    projeto_id, requisicao_id, evento, fase,
    valor_antes, valor_depois, detalhes, usuario_id, usuario_email
  ) values (
    p_projeto_id, p_requisicao_id, p_evento, p_fase,
    p_valor_antes, p_valor_depois, p_detalhes, v_uid, v_email
  ) returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.projeto_evento_log(uuid,uuid,text,text,numeric,numeric,jsonb)
  from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Verificacao por leitura
select p.proname,
       p.prosecdef                                               as security_definer,
       p.proconfig::text                                         as search_path,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  as auth_executa
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='projeto_evento_log';
-- Esperado: true | {"search_path=public, auth"} | false  <-- false e o correto aqui

-- =====================================================================
-- ROLLBACK:
--   drop function if exists public.projeto_evento_log(uuid,uuid,text,text,numeric,numeric,jsonb);
-- =====================================================================
