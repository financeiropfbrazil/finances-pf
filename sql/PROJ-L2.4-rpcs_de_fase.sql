-- =====================================================================
-- PROJ-L2.4 — RPCs de transicao de fase (reaplicacao completa)
--   enviar_budget_para_aprovacao · aprovar_budget_projeto
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md secao 4 (L2.3 e L2.4) · decisao D-9
--
-- ESTADO: PENDENTE de aplicacao (bloco 4/4).
--   Verificado em 07/08 que as duas continuam IDENTICAS ao baseline do L0
--   (md5 afc3f2dc... e eb594b06..., tem_evento=false, tem_responsavel_id=false,
--   tem_perm_approve=false). O `search_path=public, auth` que ja aparece nelas
--   NAO e sinal de reaplicacao — elas ja nasciam assim (secao 10.3 do plano).
--
-- PRE-REQUISITOS: PROJ-L1, PROJ-L2.0
--
-- MUDANCAS EM RELACAO AO BASELINE (fonte integral do "antes": plano, secao 10.3):
--   [enviar_budget_para_aprovacao]
--     - gate de titularidade: criado_por -> responsavel_id (L2.4). O codigo passa
--       a fazer o que a mensagem de erro sempre prometeu ("Apenas o responsavel").
--     - v_responsavel_email tambem migra de criado_por -> responsavel_id.
--     - evento 'budget_enviado_aprovacao'.
--   [aprovar_budget_projeto]
--     - D-9: adiciona _user_has_perm('projetos.approve') ao gate. Sem isso, um
--       aprovador com o papel REVOGADO continuaria aprovando.
--     - evento 'budget_aprovado'.
--     - a copia Budget->Actual preserva a `sequencia` do Budget (D-6, de proposito).
--
-- Regra 7: CREATE OR REPLACE nao preserva SECURITY DEFINER nem SET search_path —
--   ambos estao REDECLARADOS abaixo. A assinatura nao muda, entao os GRANTS
--   existentes sao preservados (por isso nao ha DROP aqui).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) enviar_budget_para_aprovacao
-- ---------------------------------------------------------------------
create or replace function public.enviar_budget_para_aprovacao(p_projeto_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  c_evt constant text := 'budget_enviado_aprovacao';
  v_projeto record;
  v_uid uuid := auth.uid();
  v_is_admin boolean := public._is_admin();
  v_total_budget numeric;
  v_count_budget int;
  v_aprovador_email text;
  v_aprovador_nome text;
  v_responsavel_email text;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  -- Lock pessimista contra duplo clique
  select * into v_projeto from public.projetos where id = p_projeto_id for update;
  if not found then
    raise exception 'Projeto não encontrado' using errcode = 'P0002';
  end if;

  -- L2.4: titularidade oficial e responsavel_id (era criado_por)
  if not v_is_admin and v_projeto.responsavel_id is distinct from v_uid then
    raise exception 'Apenas o responsável do projeto ou um administrador pode enviar para aprovação'
      using errcode = '42501';
  end if;

  if v_projeto.fase_atual <> 'budget' then
    raise exception 'Projeto não está em fase Budget (fase atual: %)', v_projeto.fase_atual
      using errcode = '22023';
  end if;

  if v_projeto.aprovador_id is null then
    raise exception 'Aprovador não foi definido para este projeto. Edite o projeto e defina um aprovador antes de enviar para aprovação.'
      using errcode = '22023';
  end if;

  select count(*), coalesce(sum(valor_total), 0)
    into v_count_budget, v_total_budget
    from public.projeto_requisicoes
   where projeto_id = p_projeto_id and fase = 'budget';

  if v_count_budget = 0 then
    raise exception 'Adicione pelo menos 1 pedido de compra em Budget antes de enviar para aprovação'
      using errcode = '22023';
  end if;

  update public.projetos
     set fase_atual                 = 'budget_em_aprovacao',
         status                     = 'pendente_aprovacao',
         enviado_para_aprovacao_em  = now(),
         enviado_para_aprovacao_por = v_uid,
         updated_at                 = now()
   where id = p_projeto_id;

  -- metadados para o front disparar o e-mail (Edge notify-aprovador-budget)
  select p.email, coalesce(p.full_name, p.email)
    into v_aprovador_email, v_aprovador_nome
    from public.profiles p where p.user_id = v_projeto.aprovador_id;

  -- tambem migrado de criado_por -> responsavel_id (titularidade oficial)
  select p.email into v_responsavel_email
    from public.profiles p where p.user_id = v_projeto.responsavel_id;

  perform public.projeto_evento_log(
    p_projeto_id, null, c_evt, 'budget', null, v_total_budget,
    jsonb_build_object('count_pedidos', v_count_budget,
                       'orcamento', v_projeto.orcamento,
                       'aprovador_id', v_projeto.aprovador_id,
                       'aprovador_email', v_aprovador_email)
  );

  return jsonb_build_object(
    'success', true,
    'projeto_id', p_projeto_id,
    'projeto_nome', v_projeto.nome,
    'aprovador_id', v_projeto.aprovador_id,
    'aprovador_email', v_aprovador_email,
    'aprovador_nome', v_aprovador_nome,
    'responsavel_email', v_responsavel_email,
    'total_budget', v_total_budget,
    'orcamento', v_projeto.orcamento,
    'count_pedidos', v_count_budget,
    'enviado_em', now()
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- 2) aprovar_budget_projeto
-- ---------------------------------------------------------------------
create or replace function public.aprovar_budget_projeto(p_projeto_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  c_evt  constant text := 'budget_aprovado';
  c_perm constant text := 'projetos.approve';
  v_projeto record;
  v_uid uuid := auth.uid();
  v_is_admin boolean := public._is_admin();
  v_aprovador_email text;
  v_count_actual_existente int;
  v_count_actual_final int;
  v_total_actual numeric;
begin
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  -- Lock pessimista contra duplo clique
  select * into v_projeto from public.projetos where id = p_projeto_id for update;
  if not found then
    raise exception 'Projeto não encontrado' using errcode = 'P0002';
  end if;

  if not v_is_admin then
    if v_projeto.aprovador_id is distinct from v_uid then
      raise exception 'Apenas o aprovador designado ou um administrador pode aprovar este projeto'
        using errcode = '42501';
    end if;
    -- D-9: sem isto, um aprovador com o papel REVOGADO continuaria aprovando.
    if not public._user_has_perm(c_perm) then
      raise exception 'Sem permissão para aprovar projetos (%)', c_perm
        using errcode = '42501';
    end if;
  end if;

  if v_projeto.fase_atual <> 'budget_em_aprovacao' then
    raise exception 'Projeto não está aguardando aprovação (fase atual: %). Use enviar_budget_para_aprovacao primeiro.',
      v_projeto.fase_atual using errcode = '22023';
  end if;

  select email into v_aprovador_email from public.profiles where user_id = v_uid;

  -- Idempotencia: se ja existem pedidos Actual neste projeto, nao duplicar
  select count(*) into v_count_actual_existente
    from public.projeto_requisicoes
   where projeto_id = p_projeto_id and fase = 'actual';

  if v_count_actual_existente = 0 then
    -- Copia Budget -> Actual (D-6: a sequencia do Budget e preservada de proposito,
    -- para manter a correspondencia visivel ao operador entre as duas fases)
    insert into public.projeto_requisicoes (
      projeto_id, fase, budget_origem_id, sequencia, descricao,
      fornecedor_codigo, fornecedor_nome, fornecedor_cnpj,
      cond_pagamento_codigo, cond_pagamento_nome,
      itens, classe_rateio, valor_total,
      status, bloqueado, criado_por, created_at, updated_at
    )
    select
      projeto_id, 'actual', id, sequencia, descricao,
      fornecedor_codigo, fornecedor_nome, fornecedor_cnpj,
      cond_pagamento_codigo, cond_pagamento_nome,
      itens, classe_rateio, valor_total,
      'rascunho', false, criado_por, now(), now()
    from public.projeto_requisicoes
    where projeto_id = p_projeto_id and fase = 'budget';
  end if;

  update public.projetos
     set fase_atual          = 'actual',
         status              = 'aprovado',
         budget_aprovado_por = v_aprovador_email,
         budget_aprovado_em  = now(),
         updated_at          = now()
   where id = p_projeto_id;

  select count(*), coalesce(sum(valor_total), 0)
    into v_count_actual_final, v_total_actual
    from public.projeto_requisicoes
   where projeto_id = p_projeto_id and fase = 'actual';

  perform public.projeto_evento_log(
    p_projeto_id, null, c_evt, 'actual', null, v_total_actual,
    jsonb_build_object('copiados', v_count_actual_final,
                       'ja_existiam', v_count_actual_existente,
                       'novos_nesta_chamada', v_count_actual_final - v_count_actual_existente,
                       'aprovado_por', v_aprovador_email,
                       'orcamento', v_projeto.orcamento)
  );

  return jsonb_build_object(
    'success', true,
    'projeto_id', p_projeto_id,
    'projeto_nome', v_projeto.nome,
    'copiados', v_count_actual_final,
    'ja_existiam', v_count_actual_existente,
    'novos_nesta_chamada', v_count_actual_final - v_count_actual_existente,
    'total_actual', v_total_actual,
    'aprovado_por', v_aprovador_email,
    'aprovado_em', now()
  );
end;
$function$;

notify pgrst, 'reload schema';

-- Verificacao por leitura
select p.proname,
       p.prosecdef                                               as security_definer,
       p.proconfig::text                                         as search_path,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  as auth_executa,
       (pg_get_functiondef(p.oid) ilike '%projeto_evento_log%')   as chama_evento_log,
       (pg_get_functiondef(p.oid) ilike '%responsavel_id%')       as usa_responsavel_id,
       (pg_get_functiondef(p.oid) ilike '%projetos.approve%')     as tem_perm_approve,
       md5(pg_get_functiondef(p.oid))                             as md5_atual
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public'
   and p.proname in ('enviar_budget_para_aprovacao','aprovar_budget_projeto')
 order by p.proname;
-- Esperado (2 linhas):
--   aprovar_budget_projeto:       secdef=true, chama_evento_log=true,
--                                 tem_perm_approve=TRUE, md5 <> eb594b06c9d593a7597dd72c4ce3de15
--   enviar_budget_para_aprovacao: secdef=true, chama_evento_log=true,
--                                 usa_responsavel_id=TRUE, md5 <> afc3f2dc30f4492b54c6013d19d31a54

-- =====================================================================
-- ROLLBACK: reaplicar o fonte original das duas funcoes, preservado
--           integralmente na secao 10.3 do PLANO-PROJETOS.md
--           (md5 de referencia: afc3f2dc... e eb594b06...).
-- =====================================================================
