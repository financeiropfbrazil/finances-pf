-- =====================================================================
-- PROJ-L2.2 — projeto_pedido_excluir
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md secao 4 (L2.2)
--
-- ESTADO: PENDENTE de aplicacao (bloco 2/4).
--
-- PRE-REQUISITOS: PROJ-L1, PROJ-L2.0
--
-- DECISOES IMPLEMENTADAS:
--   D-3  so exclui status 'rascunho' ou 'erro' — e vale INCLUSIVE PARA ADMIN.
--        A razao e integridade Hub x ERP, nao permissao: nem o admin apaga pelo
--        Hub um pedido que ja existe no Alvo. Por isso a checagem esta FORA do
--        ramo `if not v_is_admin`.
--   D-13 so exclui pedido da fase corrente do projeto (nao apaga historico de
--        fase encerrada)
-- =====================================================================

drop function if exists public.projeto_pedido_excluir(uuid);

create or replace function public.projeto_pedido_excluir(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  c_evt  constant text := 'pedido_excluido';
  c_perm constant text := 'projetos.pedidos.create';
  v_uid      uuid := auth.uid();
  v_is_admin boolean;
  v_row      public.projeto_requisicoes%rowtype;
  v_proj     public.projetos%rowtype;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  v_is_admin := public._is_admin();

  select * into v_row from public.projeto_requisicoes where id = p_id for update;
  if not found then
    raise exception 'Pedido não encontrado' using errcode = 'P0002';
  end if;

  select * into v_proj from public.projetos where id = v_row.projeto_id for update;
  if not found then
    raise exception 'Projeto não encontrado' using errcode = 'P0002';
  end if;

  if not v_is_admin then
    if not public._user_has_perm(c_perm) then
      raise exception 'Sem permissão para gerenciar pedidos de projeto (%)', c_perm
        using errcode = '42501';
    end if;
    if v_proj.responsavel_id is distinct from v_uid then
      raise exception 'Apenas o responsável do projeto pode excluir pedidos'
        using errcode = '42501';
    end if;
    if v_proj.fase_atual = 'budget_em_aprovacao' then
      raise exception 'Budget em aprovação — exclusão bloqueada' using errcode = '22023';
    end if;
    -- D-13: nao apagar historico de fase encerrada
    if v_row.fase is distinct from v_proj.fase_atual then
      raise exception 'Só é possível excluir pedidos da fase corrente (pedido: "%", projeto: "%")',
        v_row.fase, v_proj.fase_atual using errcode = '22023';
    end if;
    if v_row.bloqueado then
      raise exception 'Pedido bloqueado — somente administrador pode excluir'
        using errcode = '42501';
    end if;
  end if;

  -- D-3 vale para TODOS (inclusive admin): a razao e integridade Hub x ERP, nao permissao.
  if v_row.status not in ('rascunho','erro') then
    raise exception 'Só é possível excluir pedido em rascunho ou erro (status atual: "%")',
      v_row.status using errcode = '22023';
  end if;

  delete from public.projeto_requisicoes where id = p_id;

  -- requisicao_id vai null de proposito: a FK e ON DELETE SET NULL e a linha ja
  -- nao existe; o id fica preservado no snapshot dentro de detalhes.
  perform public.projeto_evento_log(
    v_row.projeto_id, null, c_evt, v_row.fase, v_row.valor_total, null,
    jsonb_build_object('requisicao_id', v_row.id,
                       'sequencia',     v_row.sequencia,
                       'snapshot',      to_jsonb(v_row))
  );

  return jsonb_build_object(
    'success', true, 'deleted', true,
    'id', v_row.id, 'sequencia', v_row.sequencia,
    'descricao', v_row.descricao, 'valor_total', v_row.valor_total
  );
end;
$function$;

revoke all     on function public.projeto_pedido_excluir(uuid) from public, anon;
grant  execute on function public.projeto_pedido_excluir(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

-- Verificacao por leitura
select p.proname,
       pg_get_function_identity_arguments(p.oid)                 as assinatura,
       p.prosecdef                                               as security_definer,
       p.proconfig::text                                         as search_path,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  as auth_executa,
       has_function_privilege('anon',          p.oid, 'EXECUTE')  as anon_executa,
       (pg_get_functiondef(p.oid) ilike '%projeto_evento_log%')   as chama_evento_log,
       (pg_get_functiondef(p.oid) ilike '%responsavel_id%')       as usa_responsavel_id
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='projeto_pedido_excluir';
-- Esperado: true | {"search_path=public, auth"} | true | false | true | true

-- =====================================================================
-- ROLLBACK:
--   drop function if exists public.projeto_pedido_excluir(uuid);
-- =====================================================================
