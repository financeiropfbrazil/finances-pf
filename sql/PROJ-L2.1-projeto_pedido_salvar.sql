-- =====================================================================
-- PROJ-L2.1 — projeto_pedido_salvar (create + update de pedido de projeto)
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md secao 4 (L2.1)
--
-- ESTADO: PENDENTE de aplicacao (bloco 1/4 da aplicacao funcao-a-funcao).
--
-- PRE-REQUISITOS (todos ja verificados em 07/08):
--   PROJ-L1  (projeto_eventos + projeto_requisicoes.atualizado_por)
--   PROJ-L2.0 (projeto_evento_log)
--
-- DECISOES IMPLEMENTADAS:
--   D-1  teto orcamentario validado no banco
--   D-2  pedido enviado ao Alvo e imutavel para nao-admin
--   D-6  NAO atribui sequencia na criacao — deixa o DEFAULT nextval agir
--   D-10 estouro de teto RETORNA success:false (nao RAISE) — senao o RAISE
--        desfaria o INSERT do evento teto_rejeitado na mesma transacao
--   D-11 envelope {success, operacao, pedido}
--   D-12 fase de pedido existente e imutavel (Budget aprovado = historico)
--   R-1  (L4) o front DEVE tratar success !== true como erro
-- =====================================================================

drop function if exists public.projeto_pedido_salvar(uuid, uuid, jsonb);

create or replace function public.projeto_pedido_salvar(
  p_projeto_id uuid,
  p_id         uuid  default null,
  p_dados      jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  c_evt_criado  constant text := 'pedido_criado';
  c_evt_editado constant text := 'pedido_editado';
  c_evt_teto    constant text := 'teto_rejeitado';
  c_perm        constant text := 'projetos.pedidos.create';
  c_campos      constant text[] := array[
    'descricao','fornecedor_codigo','fornecedor_nome','fornecedor_cnpj',
    'cond_pagamento_codigo','cond_pagamento_nome','itens','classe_rateio','valor_total'
  ];

  v_uid       uuid := auth.uid();
  v_is_admin  boolean;
  v_proj      public.projetos%rowtype;
  v_old       public.projeto_requisicoes%rowtype;
  v_new       public.projeto_requisicoes%rowtype;
  v_fase      text;
  v_descricao text;
  v_valor     numeric;
  v_itens     jsonb;
  v_rateio    jsonb;
  v_soma      numeric;
  v_outras    numeric;
  v_saldo     numeric;
  v_diff      jsonb;
begin
  -- (a) autenticado
  if v_uid is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  v_is_admin := public._is_admin();

  -- (d) projeto + LOCK: serializa duplo-clique e congela o teto nesta transacao
  select * into v_proj from public.projetos where id = p_projeto_id for update;
  if not found then
    raise exception 'Projeto não encontrado' using errcode = 'P0002';
  end if;

  -- payload
  v_descricao := btrim(coalesce(p_dados->>'descricao', ''));
  v_fase      := coalesce(p_dados->>'fase', v_proj.fase_atual);
  v_valor     := round(coalesce((p_dados->>'valor_total')::numeric, 0), 2);
  v_itens     := coalesce(p_dados->'itens', '[]'::jsonb);
  v_rateio    := coalesce(p_dados->'classe_rateio', '[]'::jsonb);

  -- (b) admin pula (c),(d),(e)
  if not v_is_admin then
    -- (c) permissao
    if not public._user_has_perm(c_perm) then
      raise exception 'Sem permissão para gerenciar pedidos de projeto (%)', c_perm
        using errcode = '42501';
    end if;

    -- (d) titularidade: responsavel_id (secao 1 — titularidade oficial)
    if v_proj.responsavel_id is distinct from v_uid then
      raise exception 'Apenas o responsável do projeto pode gerenciar pedidos'
        using errcode = '42501';
    end if;

    -- (e) fase coerente
    if v_proj.fase_atual = 'budget_em_aprovacao' then
      raise exception 'Budget em aprovação — edição bloqueada' using errcode = '22023';
    end if;
    if v_proj.fase_atual not in ('budget','actual') then
      raise exception 'Projeto em fase inválida para pedidos: %', v_proj.fase_atual
        using errcode = '22023';
    end if;
    if v_fase is distinct from v_proj.fase_atual then
      raise exception 'Pedido da fase "%" não pode ser gravado com o projeto na fase "%"',
        v_fase, v_proj.fase_atual using errcode = '22023';
    end if;
  end if;

  -- conteudo (espelha o front; mensagem amigavel no lugar de erro de constraint)
  if v_descricao = '' then
    raise exception 'Preencha a descrição do pedido' using errcode = '22023';
  end if;
  if jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) = 0 then
    raise exception 'Adicione pelo menos 1 item ao pedido' using errcode = '22023';
  end if;

  -- (h) rateio = 100%
  if jsonb_typeof(v_rateio) = 'array' and jsonb_array_length(v_rateio) > 0 then
    select coalesce(sum((e->>'percentual')::numeric), 0) into v_soma
      from jsonb_array_elements(v_rateio) e;
    if abs(v_soma - 100) > 0.01 then
      raise exception 'Rateio deve somar 100%% (atual: %)', round(v_soma, 2)
        using errcode = '22023';
    end if;
  end if;

  -- (f) linha alvo (edicao)
  if p_id is not null then
    select * into v_old from public.projeto_requisicoes where id = p_id for update;
    if not found then
      raise exception 'Pedido não encontrado' using errcode = 'P0002';
    end if;
    if v_old.projeto_id is distinct from p_projeto_id then
      raise exception 'Pedido não pertence a este projeto' using errcode = '22023';
    end if;
    -- D-12: fase de pedido existente e imutavel (Budget aprovado = registro historico)
    if v_old.fase is distinct from v_fase then
      raise exception 'Pedido pertence à fase "%" — não pode ser gravado como "%"',
        v_old.fase, v_fase using errcode = '22023';
    end if;
    if not v_is_admin then
      if v_old.status = 'enviado' then                                    -- D-2
        raise exception 'Pedido já enviado ao Alvo (#%) — somente administrador pode alterar',
          coalesce(v_old.numero_pedido_alvo, '?') using errcode = '42501';
      end if;
      if v_old.bloqueado then
        raise exception 'Pedido bloqueado — somente administrador pode alterar'
          using errcode = '42501';
      end if;
    end if;
  end if;

  -- (g) TETO (D-1). So vale com orcamento definido — espelha ProjetoRequisicoes.tsx:382.
  if v_proj.orcamento > 0 then
    select coalesce(sum(valor_total), 0) into v_outras
      from public.projeto_requisicoes
     where projeto_id = p_projeto_id
       and fase = v_fase
       and (p_id is null or id <> p_id);

    if v_outras + v_valor > v_proj.orcamento then
      v_saldo := v_proj.orcamento - v_outras;

      perform public.projeto_evento_log(
        p_projeto_id, p_id, c_evt_teto, v_fase,
        case when p_id is null then null else v_old.valor_total end, v_valor,
        jsonb_build_object(
          'orcamento',            v_proj.orcamento,
          'total_outros_pedidos', v_outras,
          'valor_solicitado',     v_valor,
          'saldo_disponivel',     v_saldo,
          'excedente',            (v_outras + v_valor) - v_proj.orcamento,
          'operacao',             case when p_id is null then 'criacao' else 'edicao' end
        )
      );

      -- D-10: retorno, NAO raise. Um RAISE aqui desfaria o evento acima.
      -- O L4 trata success=false como erro (requisito R-1).
      return jsonb_build_object(
        'success',          false,
        'erro_codigo',      'teto_excedido',
        'mensagem',         'Orçamento excedido: disponível R$ ' || to_char(v_saldo, 'FM9999999990.00'),
        'orcamento',        v_proj.orcamento,
        'saldo_disponivel', v_saldo,
        'valor_solicitado', v_valor,
        'excedente',        (v_outras + v_valor) - v_proj.orcamento
      );
    end if;
  end if;

  -- (i) grava
  if p_id is null then
    -- D-6: NAO atribui sequencia — deixa o DEFAULT nextval agir.
    insert into public.projeto_requisicoes (
      projeto_id, descricao,
      fornecedor_codigo, fornecedor_nome, fornecedor_cnpj,
      cond_pagamento_codigo, cond_pagamento_nome,
      itens, classe_rateio, valor_total,
      status, fase, criado_por, atualizado_por, created_at, updated_at
    ) values (
      p_projeto_id, v_descricao,
      nullif(btrim(coalesce(p_dados->>'fornecedor_codigo','')), ''),
      nullif(btrim(coalesce(p_dados->>'fornecedor_nome','')), ''),
      nullif(btrim(coalesce(p_dados->>'fornecedor_cnpj','')), ''),
      nullif(btrim(coalesce(p_dados->>'cond_pagamento_codigo','')), ''),
      nullif(btrim(coalesce(p_dados->>'cond_pagamento_nome','')), ''),
      v_itens, v_rateio, v_valor,
      'rascunho',                       -- status na criacao e sempre rascunho
      v_fase, v_uid, v_uid, now(), now()
    ) returning * into v_new;

    perform public.projeto_evento_log(
      p_projeto_id, v_new.id, c_evt_criado, v_fase, null, v_valor,
      jsonb_build_object('sequencia', v_new.sequencia, 'descricao', v_new.descricao)
    );
  else
    -- status, fase, sequencia, criado_por e bloqueado NAO se alteram aqui.
    update public.projeto_requisicoes set
      descricao             = v_descricao,
      fornecedor_codigo     = nullif(btrim(coalesce(p_dados->>'fornecedor_codigo','')), ''),
      fornecedor_nome       = nullif(btrim(coalesce(p_dados->>'fornecedor_nome','')), ''),
      fornecedor_cnpj       = nullif(btrim(coalesce(p_dados->>'fornecedor_cnpj','')), ''),
      cond_pagamento_codigo = nullif(btrim(coalesce(p_dados->>'cond_pagamento_codigo','')), ''),
      cond_pagamento_nome   = nullif(btrim(coalesce(p_dados->>'cond_pagamento_nome','')), ''),
      itens                 = v_itens,
      classe_rateio         = v_rateio,
      valor_total           = v_valor,
      atualizado_por        = v_uid,
      updated_at            = now()
     where id = p_id
    returning * into v_new;

    select jsonb_object_agg(k, jsonb_build_object('antes', to_jsonb(v_old)->k,
                                                  'depois', to_jsonb(v_new)->k))
      into v_diff
      from unnest(c_campos) as k
     where (to_jsonb(v_old)->k) is distinct from (to_jsonb(v_new)->k);

    perform public.projeto_evento_log(
      p_projeto_id, v_new.id, c_evt_editado, v_fase, v_old.valor_total, v_new.valor_total,
      jsonb_build_object('sequencia', v_new.sequencia,
                         'campos_alterados', coalesce(v_diff, '{}'::jsonb))
    );
  end if;

  -- (k) D-11: envelope
  return jsonb_build_object(
    'success',  true,
    'operacao', case when p_id is null then 'criado' else 'editado' end,
    'pedido',   to_jsonb(v_new)
  );
end;
$function$;

revoke all     on function public.projeto_pedido_salvar(uuid,uuid,jsonb) from public, anon;
grant  execute on function public.projeto_pedido_salvar(uuid,uuid,jsonb) to authenticated, service_role;

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
 where n.nspname='public' and p.proname='projeto_pedido_salvar';
-- Esperado: true | {"search_path=public, auth"} | true | false | true | true

-- =====================================================================
-- ROLLBACK:
--   drop function if exists public.projeto_pedido_salvar(uuid,uuid,jsonb);
-- =====================================================================
