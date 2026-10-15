-- =====================================================================
-- PROJ-L11 — Parcelas editáveis no pedido do Actual + Etapa (Rastreio)
-- Projeto Supabase: hbtggrbauguukewiknew
-- Plano: PLANO-PROJETOS.md seção 3 (L11) — decisões do Pedro em 15/10/2026:
--   as duas mudanças juntas; prazos contam da Data do Pedido por padrão;
--   Data da Entrega sugerida = hoje + 30.
--
-- ESTADO: PENDENTE de aplicação (aguarda OK do Pedro).
-- Sem DELETE/DROP — pode ir pelo MCP. O rollback (que tem DROP) fica em
-- PROJ-L11-rollback.sql e vai pelo SQL Editor, se um dia precisar.
--
-- O QUE MUDA:
--   1. projeto_requisicoes ganha 4 colunas (todas opcionais; pedido antigo
--      fica null = parcelas calculadas no envio, como hoje):
--        data_entrega        date   — "Data da Entrega" do pedido no Alvo
--        data_base_parcelas  text   — 'Data do Pedido' | 'Data da Entrega'
--        parcelas            jsonb  — [{sequencia, dias_entre_parcelas,
--                                       valor_parcela, data_vencimento}]
--        parcelas_manuais    bool   — true = a pessoa editou; o envio manda
--                                     exatamente o que está gravado
--   2. projeto_pedido_salvar passa a gravar esses campos e RECUSA parcelas
--      que não somam o valor do pedido (R-1: o front valida, o banco garante).
--      Todo o resto da função é idêntico ao que está no banco (md5 da fonte
--      anterior: f15054b867fe7ec97efb1ca1823ed360, salva no rollback).
--   3. RPC nova projeto_pedidos_etapa: etapa de cada pedido do projeto, lida da
--      mv_rastreio_compras (a mesma do Rastreio de Compras, atualizada de hora
--      em hora). Só leitura; mesma regra de visão dos anexos (projeto_pode_ver).
--
-- REGRA DO PROJETO: toda função NOVA em public nasce com EXECUTE para anon.
-- O bloco 4 revoga de anon, com a assinatura completa, depois do create.
-- (projeto_pedido_salvar é create or replace sobre função existente: mantém o ACL.)
-- =====================================================================


-- =====================================================================
-- 0) PRÉ-VOO (rodar antes; parar se divergir)
-- =====================================================================
-- select (select count(*) from public.compras_pedidos)     as compras_pedidos,  -- ~2.290
--        (select count(*) from public.projeto_requisicoes) as pedidos_projeto,  -- ~80
--        md5(pg_get_functiondef('public.projeto_pedido_salvar(uuid,uuid,jsonb)'::regprocedure)) as md5_salvar,
--        -- esperado: f15054b867fe7ec97efb1ca1823ed360
--        (select count(*) from information_schema.columns where table_schema = 'public'
--           and table_name = 'projeto_requisicoes'
--           and column_name in ('data_entrega','data_base_parcelas','parcelas','parcelas_manuais')) as colunas_novas; -- 0


-- =====================================================================
-- 1) Colunas
-- =====================================================================
alter table public.projeto_requisicoes
  add column if not exists data_entrega       date,
  add column if not exists data_base_parcelas text,
  add column if not exists parcelas           jsonb,
  add column if not exists parcelas_manuais   boolean not null default false;

alter table public.projeto_requisicoes
  add constraint projeto_requisicoes_data_base_parcelas_chk
    check (data_base_parcelas is null or data_base_parcelas in ('Data do Pedido', 'Data da Entrega'));

alter table public.projeto_requisicoes
  add constraint projeto_requisicoes_parcelas_array_chk
    check (parcelas is null or jsonb_typeof(parcelas) = 'array');


-- =====================================================================
-- 2) projeto_pedido_salvar — grava e valida as parcelas
--    Diferenças para a versão anterior (marcadas com "L11"):
--      - c_campos inclui os 4 campos novos (entram no diff do evento)
--      - bloco (h2): valida data base e parcelas
--      - INSERT/UPDATE gravam os 4 campos
--      - edição vinda de front antigo (sem a chave "parcelas") não apaga as
--        parcelas gravadas — a não ser que o valor do pedido mude; aí elas
--        caem e o envio volta a calcular pela condição
-- =====================================================================
create or replace function public.projeto_pedido_salvar(p_projeto_id uuid, p_id uuid default null::uuid, p_dados jsonb default '{}'::jsonb)
returns jsonb
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
    'cond_pagamento_codigo','cond_pagamento_nome','itens','classe_rateio','valor_total',
    'data_entrega','data_base_parcelas','parcelas','parcelas_manuais'          -- L11
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
  -- L11
  v_tem_parc     boolean;
  v_entrega      date;
  v_base         text;
  v_parcelas     jsonb;
  v_manuais      boolean;
  v_parc_soma    numeric;
  v_parc_ruins   int;
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

  -- (h2) L11: entrega, data base e parcelas (só no Actual — o Budget não vai ao Alvo)
  v_tem_parc := p_dados ? 'parcelas';
  v_entrega  := null;
  v_base     := null;
  v_parcelas := null;
  v_manuais  := false;
  if v_fase = 'actual' then
    if coalesce(p_dados->>'data_entrega', '') <> '' then
      if (p_dados->>'data_entrega') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Data da Entrega inválida' using errcode = '22023';
      end if;
      v_entrega := (p_dados->>'data_entrega')::date;
    end if;

    v_base := nullif(btrim(coalesce(p_dados->>'data_base_parcelas', '')), '');
    if v_base is not null and v_base not in ('Data do Pedido', 'Data da Entrega') then
      raise exception 'Data base das parcelas inválida: %', v_base using errcode = '22023';
    end if;
    if v_base = 'Data da Entrega' and v_entrega is null then
      raise exception 'Informe a Data da Entrega para contar as parcelas a partir dela' using errcode = '22023';
    end if;

    if jsonb_typeof(p_dados->'parcelas') = 'array' and jsonb_array_length(p_dados->'parcelas') > 0 then
      v_parcelas := p_dados->'parcelas';
      v_manuais  := coalesce((p_dados->>'parcelas_manuais')::boolean, false);

      select count(*) filter (where coalesce((e->>'valor_parcela')::numeric, 0) <= 0
                                 or coalesce(e->>'data_vencimento', '') !~ '^\d{4}-\d{2}-\d{2}$'),
             coalesce(sum(round(coalesce((e->>'valor_parcela')::numeric, 0), 2)), 0)
        into v_parc_ruins, v_parc_soma
        from jsonb_array_elements(v_parcelas) e;

      if v_parc_ruins > 0 then
        raise exception 'Toda parcela precisa de valor maior que zero e data de vencimento'
          using errcode = '22023';
      end if;
      if v_parc_soma <> v_valor then
        raise exception 'A soma das parcelas (R$ %) precisa ser igual ao valor do pedido (R$ %)',
          to_char(v_parc_soma, 'FM9999999990.00'), to_char(v_valor, 'FM9999999990.00')
          using errcode = '22023';
      end if;
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

    -- L11: front antigo (sem a chave "parcelas") preserva o que está gravado,
    -- exceto se o valor mudou — parcelas de outro valor não podem ir ao Alvo.
    if not v_tem_parc then
      if v_old.valor_total = v_valor then
        v_entrega  := v_old.data_entrega;
        v_base     := v_old.data_base_parcelas;
        v_parcelas := v_old.parcelas;
        v_manuais  := v_old.parcelas_manuais;
      else
        v_entrega  := v_old.data_entrega;
        v_base     := v_old.data_base_parcelas;
        v_parcelas := null;
        v_manuais  := false;
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
      data_entrega, data_base_parcelas, parcelas, parcelas_manuais,          -- L11
      status, fase, criado_por, atualizado_por, created_at, updated_at
    ) values (
      p_projeto_id, v_descricao,
      nullif(btrim(coalesce(p_dados->>'fornecedor_codigo','')), ''),
      nullif(btrim(coalesce(p_dados->>'fornecedor_nome','')), ''),
      nullif(btrim(coalesce(p_dados->>'fornecedor_cnpj','')), ''),
      nullif(btrim(coalesce(p_dados->>'cond_pagamento_codigo','')), ''),
      nullif(btrim(coalesce(p_dados->>'cond_pagamento_nome','')), ''),
      v_itens, v_rateio, v_valor,
      v_entrega, v_base, v_parcelas, coalesce(v_manuais, false),            -- L11
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
      data_entrega          = v_entrega,                                    -- L11
      data_base_parcelas    = v_base,                                       -- L11
      parcelas              = v_parcelas,                                   -- L11
      parcelas_manuais      = coalesce(v_manuais, false),                   -- L11
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


-- =====================================================================
-- 3) Etapa dos pedidos do projeto (fonte: Rastreio de Compras)
--    Uma linha por pedido. Pedido com 2+ NFs mostra a etapa MENOS avançada
--    (menor etapa_ordem): nunca "Pago" se outra NF ainda aguarda pagamento.
--    Pedido enviado que ainda não está na MV (o Rastreio roda aos :55) não
--    vem na lista — o front mostra "Aguardando atualização".
-- =====================================================================
create or replace function public.projeto_pedidos_etapa(p_projeto_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;
  if not public.projeto_pode_ver(p_projeto_id) then
    raise exception 'Sem permissão para ver este projeto' using errcode = '42501';
  end if;

  with peds as (
    select distinct r.numero_pedido_alvo as numero
      from public.projeto_requisicoes r
     where r.projeto_id = p_projeto_id
       and r.numero_pedido_alvo is not null
  ),
  agg as (
    select m.pedido_numero,
           (array_agg(m.etapa order by m.etapa_ordem nulls last))[1] as etapa,
           min(m.etapa_ordem)                                         as etapa_ordem,
           count(m.nf_numero)                                         as qtd_nf
      from public.mv_rastreio_compras m
      join peds on peds.numero = m.pedido_numero
     group by m.pedido_numero
  )
  select jsonb_build_object(
           'success',       true,
           'atualizado_em', (select max(atualizado_em) from public.mv_rastreio_compras),
           'pedidos',       coalesce((select jsonb_agg(jsonb_build_object(
                                        'numero',      a.pedido_numero,
                                        'etapa',       a.etapa,
                                        'etapa_ordem', a.etapa_ordem,
                                        'qtd_nf',      a.qtd_nf)
                                      order by a.pedido_numero)
                                       from agg a), '[]'::jsonb)
         )
    into v_out;

  return v_out;
end;
$$;


-- =====================================================================
-- 4) Privilégios da função nova (assinatura completa)
-- =====================================================================
revoke execute on function public.projeto_pedidos_etapa(uuid) from anon, public;
grant execute on function public.projeto_pedidos_etapa(uuid) to authenticated;

notify pgrst, 'reload schema';


-- =====================================================================
-- 5) VERIFICAÇÃO POR LEITURA (rodar separado)
-- =====================================================================
-- select
--   (select count(*) from information_schema.columns where table_schema = 'public'
--      and table_name = 'projeto_requisicoes'
--      and column_name in ('data_entrega','data_base_parcelas','parcelas','parcelas_manuais')) as colunas_novas,   -- 4
--   (select count(*) from public.projeto_requisicoes where parcelas is not null)                    as com_parcelas,    -- 0
--   md5(pg_get_functiondef('public.projeto_pedido_salvar(uuid,uuid,jsonb)'::regprocedure))          as md5_salvar_novo,
--   has_function_privilege('anon', 'public.projeto_pedidos_etapa(uuid)', 'EXECUTE')                as anon_etapa,      -- false
--   has_function_privilege('anon', 'public.projeto_pedido_salvar(uuid,uuid,jsonb)', 'EXECUTE')     as anon_salvar;     -- igual a antes
