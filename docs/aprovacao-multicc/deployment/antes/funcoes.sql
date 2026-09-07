CREATE OR REPLACE FUNCTION public._req_evento(p_req_id uuid, p_evento text, p_detalhe jsonb, p_sucesso boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome text;
begin
  select full_name into v_nome from profiles where user_id = auth.uid();

  insert into compras_requisicoes_auditoria
    (requisicao_id, evento, user_id, user_nome, payload_enviado, sucesso, mensagem_erro)
  values
    (p_req_id,
     p_evento,
     auth.uid(),
     coalesce(v_nome, 'Sistema'),
     p_detalhe,
     coalesce(p_sucesso, true),
     case when coalesce(p_sucesso, true) then null
          else left(coalesce(p_detalhe->>'erro', 'erro desconhecido'), 2000) end);
exception when others then
  raise warning '_req_evento falhou para % (%): %', p_req_id, p_evento, sqlerrm;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.aprovar_requisicao(p_req_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record;
  v_admin boolean;
begin
  if auth.uid() is null then return 'SEM_PERMISSAO'; end if;

  if not public.user_has_permission(auth.uid(), 'compras.requisicoes.aprovar') then
    return 'SEM_PERMISSAO';
  end if;

  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'pendente_aprovacao' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  v_admin := coalesce((select is_admin from profiles where user_id = auth.uid()), false);
  if not v_admin and not exists (
      select 1 from compras_lideres_cc
       where codigo_centro_ctrl = v_req.codigo_centro_ctrl
         and lider_user_id = auth.uid() and ativo) then
    return 'FORA_DO_SEU_CC';
  end if;

  update compras_requisicoes
     set status='aprovada', aprovada_por_user_id=auth.uid(), aprovada_em=now(),
         aprovacao_automatica=false, updated_at=now()
   where id = p_req_id;
  perform public._req_evento(p_req_id, 'aprovada_lider',
           jsonb_build_object('automatica', false, 'cc', v_req.codigo_centro_ctrl));
  return 'OK';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.registrar_envio_requisicao(p_req_id uuid, p_numero_alvo text, p_erro text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record;
  v_admin boolean;
  v_autorizado boolean;
begin
  if auth.uid() is null then return 'NAO_AUTORIZADO'; end if;

  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'aprovada' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  v_admin := coalesce((select is_admin from profiles where user_id = auth.uid()), false);
  v_autorizado := v_admin
    or coalesce(v_req.requisitante_user_id = auth.uid(), false)
    or exists (select 1 from compras_lideres_cc
                where codigo_centro_ctrl = v_req.codigo_centro_ctrl
                  and lider_user_id = auth.uid() and ativo);
  if not v_autorizado then return 'NAO_AUTORIZADO'; end if;

  if p_numero_alvo is not null then
    update compras_requisicoes
       set numero_alvo = p_numero_alvo,
           status = 'sincronizada',
           enviado_em = now(),
           erro_ultimo_envio = null,
           updated_at = now()
     where id = p_req_id;
    perform public._req_evento(p_req_id, 'envio_pos_aprovacao_sucesso',
             jsonb_build_object('numero_alvo', p_numero_alvo));
    return 'SINCRONIZADA';
  else
    update compras_requisicoes
       set erro_ultimo_envio = coalesce(p_erro, 'erro desconhecido'),
           tentativa_envio_em = now(),
           updated_at = now()
     where id = p_req_id;
    perform public._req_evento(p_req_id, 'envio_pos_aprovacao_falha',
             jsonb_build_object('erro', left(coalesce(p_erro,'?'), 500)), false);
    return 'ERRO_REGISTRADO';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rejeitar_requisicao(p_req_id uuid, p_motivo_codigo text, p_observacao text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record;
  v_admin boolean;
  v_motivo record;
  v_obs text;
begin
  if auth.uid() is null then return 'SEM_PERMISSAO'; end if;

  if not public.user_has_permission(auth.uid(), 'compras.requisicoes.aprovar') then
    return 'SEM_PERMISSAO';
  end if;

  -- AJUSTE 1.3: motivo vem do catálogo (G3). A checagem de permissão vem ANTES da
  -- do catálogo de propósito: quem não pode aprovar não descobre o catálogo pelos erros.
  select * into v_motivo
    from compras_motivos_rejeicao
   where codigo = p_motivo_codigo and ativo;
  if not found then return 'MOTIVO_INVALIDO'; end if;

  v_obs := nullif(trim(coalesce(p_observacao, '')), '');
  if v_motivo.exige_observacao and (v_obs is null or length(v_obs) < 5) then
    return 'OBSERVACAO_OBRIGATORIA';
  end if;

  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'pendente_aprovacao' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  v_admin := coalesce((select is_admin from profiles where user_id = auth.uid()), false);
  if not v_admin and not exists (
      select 1 from compras_lideres_cc
       where codigo_centro_ctrl = v_req.codigo_centro_ctrl
         and lider_user_id = auth.uid() and ativo) then
    return 'FORA_DO_SEU_CC';
  end if;

  update compras_requisicoes
     set status='rejeitada',
         rejeitada_por_user_id=auth.uid(),
         rejeitada_em=now(),
         motivo_rejeicao_codigo=v_motivo.codigo,
         motivo_rejeicao=v_obs,
         updated_at=now()
   where id = p_req_id;

  perform public._req_evento(p_req_id, 'rejeitada_lider',
           jsonb_build_object('motivo_codigo', v_motivo.codigo,
                              'motivo_rotulo', v_motivo.rotulo,
                              'observacao', v_obs,
                              'cc', v_req.codigo_centro_ctrl));
  return 'OK';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.vincular_pedido_requisicao(p_pedido_id uuid, p_requisicao_id uuid, p_origem text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ped RECORD;
  v_req RECORD;
  v_user_id uuid;
  v_user_nome text;
  v_agora timestamptz := now();
  v_detalhe jsonb;
BEGIN
  v_user_id := auth.uid();

  IF p_origem = 'manual' THEN
    IF NOT user_has_permission(v_user_id, 'compras.pedidos.create') THEN
      RAISE EXCEPTION 'Sem permissão para vincular pedidos a requisições.';
    END IF;
  END IF;

  -- Nome do usuário: profiles.user_id liga ao auth.uid()
  SELECT coalesce(full_name, email) INTO v_user_nome FROM profiles WHERE user_id = v_user_id;
  v_user_nome := coalesce(v_user_nome, p_origem);

  SELECT id, numero, numero_req_comp INTO v_ped
  FROM compras_pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF v_ped.numero_req_comp IS NOT NULL THEN
    RAISE EXCEPTION 'Este pedido já está vinculado à requisição %.', v_ped.numero_req_comp;
  END IF;

  SELECT id, numero_alvo, codigo_empresa_filial, numero_pedido_compra_alvo INTO v_req
  FROM compras_requisicoes WHERE id = p_requisicao_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Requisição não encontrada.'; END IF;
  IF v_req.numero_pedido_compra_alvo IS NOT NULL THEN
    RAISE EXCEPTION 'Esta requisição já gerou o pedido %.', v_req.numero_pedido_compra_alvo;
  END IF;

  UPDATE compras_pedidos
  SET numero_req_comp = v_req.numero_alvo,
      codigo_empresa_filial_req_comp = v_req.codigo_empresa_filial,
      vinculo_atualizado_em = v_agora,
      vinculo_atualizado_por = v_user_nome,
      vinculo_ultima_acao = 'vinculado',
      updated_at = v_agora
  WHERE id = p_pedido_id;

  UPDATE compras_requisicoes
  SET numero_pedido_compra_alvo = v_ped.numero,
      vinculo_atualizado_em = v_agora,
      vinculo_atualizado_por = v_user_nome,
      vinculo_ultima_acao = 'vinculado',
      updated_at = v_agora
  WHERE id = p_requisicao_id;

  v_detalhe := jsonb_build_object(
    'acao', 'vinculado', 'origem', p_origem,
    'pedido_numero', v_ped.numero, 'pedido_id', p_pedido_id,
    'requisicao_numero', v_req.numero_alvo, 'requisicao_id', p_requisicao_id
  );

  INSERT INTO compras_pedidos_auditoria (pedido_id, evento, user_id, user_nome, sucesso, payload_enviado, created_at)
  VALUES (p_pedido_id, 'vinculado_requisicao', v_user_id, v_user_nome, true, v_detalhe, v_agora);

  INSERT INTO compras_requisicoes_auditoria (requisicao_id, evento, user_id, user_nome, sucesso, payload_enviado, created_at)
  VALUES (p_requisicao_id, 'vinculado_pedido', v_user_id, v_user_nome, true, v_detalhe, v_agora);

  RETURN jsonb_build_object(
    'sucesso', true, 'pedido_numero', v_ped.numero, 'requisicao_numero', v_req.numero_alvo,
    'origem', p_origem, 'vinculado_em', v_agora, 'vinculado_por', v_user_nome
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.desvincular_pedido_requisicao(p_pedido_id uuid, p_origem text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ped RECORD;
  v_req RECORD;
  v_user_id uuid;
  v_user_nome text;
  v_agora timestamptz := now();
  v_detalhe jsonb;
BEGIN
  v_user_id := auth.uid();

  IF p_origem = 'manual' THEN
    IF NOT user_has_permission(v_user_id, 'compras.pedidos.create') THEN
      RAISE EXCEPTION 'Sem permissão para desvincular pedidos de requisições.';
    END IF;
  END IF;

  SELECT coalesce(full_name, email) INTO v_user_nome FROM profiles WHERE user_id = v_user_id;
  v_user_nome := coalesce(v_user_nome, p_origem);

  SELECT id, numero, numero_req_comp INTO v_ped
  FROM compras_pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido não encontrado.'; END IF;
  IF v_ped.numero_req_comp IS NULL THEN
    RAISE EXCEPTION 'Este pedido não está vinculado a nenhuma requisição.';
  END IF;

  SELECT id, numero_alvo INTO v_req
  FROM compras_requisicoes
  WHERE numero_alvo = v_ped.numero_req_comp AND numero_pedido_compra_alvo = v_ped.numero
  FOR UPDATE;

  IF v_req.id IS NOT NULL THEN
    UPDATE compras_requisicoes
    SET numero_pedido_compra_alvo = NULL,
        vinculo_atualizado_em = v_agora, vinculo_atualizado_por = v_user_nome,
        vinculo_ultima_acao = 'desvinculado', updated_at = v_agora
    WHERE id = v_req.id;
  END IF;

  UPDATE compras_pedidos
  SET numero_req_comp = NULL, codigo_empresa_filial_req_comp = NULL,
      vinculo_atualizado_em = v_agora, vinculo_atualizado_por = v_user_nome,
      vinculo_ultima_acao = 'desvinculado', updated_at = v_agora
  WHERE id = p_pedido_id;

  v_detalhe := jsonb_build_object(
    'acao', 'desvinculado', 'origem', p_origem,
    'pedido_numero', v_ped.numero, 'pedido_id', p_pedido_id,
    'requisicao_numero', v_ped.numero_req_comp, 'requisicao_id', v_req.id
  );

  INSERT INTO compras_pedidos_auditoria (pedido_id, evento, user_id, user_nome, sucesso, payload_enviado, created_at)
  VALUES (p_pedido_id, 'desvinculado_requisicao', v_user_id, v_user_nome, true, v_detalhe, v_agora);

  IF v_req.id IS NOT NULL THEN
    INSERT INTO compras_requisicoes_auditoria (requisicao_id, evento, user_id, user_nome, sucesso, payload_enviado, created_at)
    VALUES (v_req.id, 'desvinculado_pedido', v_user_id, v_user_nome, true, v_detalhe, v_agora);
  END IF;

  RETURN jsonb_build_object(
    'sucesso', true, 'pedido_numero', v_ped.numero, 'requisicao_desvinculada', v_ped.numero_req_comp,
    'origem', p_origem, 'desvinculado_em', v_agora, 'desvinculado_por', v_user_nome
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.submeter_requisicao(p_req_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record;
  v_is_lider boolean;
  v_tem_lider boolean;
begin
  if auth.uid() is null then return 'SEM_PERMISSAO'; end if;

  select * into v_req from compras_requisicoes where id = p_req_id for update;
  if not found then return 'NAO_ENCONTRADA'; end if;
  if v_req.status <> 'rascunho' then return 'STATUS_INVALIDO:' || coalesce(v_req.status,'null'); end if;

  if v_req.requisitante_user_id is distinct from auth.uid()
     and not exists (select 1 from profiles where user_id = auth.uid() and is_admin) then
    return 'NAO_AUTORIZADO';
  end if;
  if not public.user_has_permission(auth.uid(), 'compras.requisicoes.create') then
    return 'SEM_PERMISSAO';
  end if;
  if v_req.codigo_centro_ctrl is null then return 'SEM_CENTRO_CUSTO'; end if;

  select exists (select 1 from compras_lideres_cc
                  where codigo_centro_ctrl = v_req.codigo_centro_ctrl and ativo)
    into v_tem_lider;
  if not v_tem_lider then
    -- AJUSTE 1.3: este ramo não tinha UPDATE; passa a existir só para limpar o erro
    -- da tentativa anterior (o envio legado, logo em seguida, grava o desfecho real).
    update compras_requisicoes
       set erro_ultimo_envio = null, updated_at = now()
     where id = p_req_id;
    perform public._req_evento(p_req_id, 'submetida_sem_gate',
             jsonb_build_object('cc', v_req.codigo_centro_ctrl));
    return 'SEM_GATE';
  end if;

  select exists (select 1 from compras_lideres_cc
                  where codigo_centro_ctrl = v_req.codigo_centro_ctrl
                    and lider_user_id = auth.uid() and ativo)
    into v_is_lider;
  if v_is_lider then
    update compras_requisicoes
       set status='aprovada', aprovada_por_user_id=auth.uid(), aprovada_em=now(),
           aprovacao_automatica=true,
           erro_ultimo_envio=null,          -- AJUSTE 1.3
           updated_at=now()
     where id = p_req_id;
    perform public._req_evento(p_req_id, 'aprovada_lider',
             jsonb_build_object('automatica', true, 'cc', v_req.codigo_centro_ctrl));
    return 'AUTO_APROVADA';
  end if;

  update compras_requisicoes
     set status='pendente_aprovacao',
         erro_ultimo_envio=null,            -- AJUSTE 1.3
         updated_at=now()
   where id = p_req_id;
  perform public._req_evento(p_req_id, 'enviada_aprovacao',
           jsonb_build_object('cc', v_req.codigo_centro_ctrl));
  return 'PENDENTE';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.req_replace_rateio(p_requisicao_id uuid, p_rateio jsonb, p_origem text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_classe jsonb;
  v_cc jsonb;
  v_ccs jsonb;
  v_classe_id uuid;
  v_qtd_classes integer;
  v_ord_classe integer;
  v_ord_cc integer;
  v_percentual_classe numeric;
  v_percentual_cc numeric;
  v_soma_classes numeric := 0;
  v_soma_cc numeric;
  v_classes_inseridas integer := 0;
  v_ccs_inseridos integer := 0;
begin
  if p_requisicao_id is null then
    raise exception 'REQUISICAO_NULA';
  end if;

  if not exists (
    select 1
    from public.compras_requisicoes
    where id = p_requisicao_id
  ) then
    raise exception 'REQUISICAO_NAO_ENCONTRADA: %', p_requisicao_id;
  end if;

  if p_origem is null or p_origem not in ('hub', 'alvo') then
    raise exception 'ORIGEM_INVALIDA: %', coalesce(p_origem, '<null>');
  end if;

  if jsonb_typeof(p_rateio) is distinct from 'array' then
    raise exception 'RATEIO_DEVE_SER_ARRAY';
  end if;

  v_qtd_classes := jsonb_array_length(p_rateio);

  for v_classe, v_ord_classe in
    select elemento, ordinalidade::integer
    from jsonb_array_elements(p_rateio) with ordinality as e(elemento, ordinalidade)
  loop
    if nullif(btrim(v_classe ->> 'codigo_classe_rec_desp'), '') is null then
      raise exception 'CLASSE_SEM_CODIGO: posicao %', v_ord_classe;
    end if;

    v_percentual_classe := nullif(v_classe ->> 'percentual', '')::numeric;
    if v_qtd_classes = 1 and coalesce(v_percentual_classe, 0) = 0 then
      v_percentual_classe := 100;
    end if;

    if v_percentual_classe is null
       or v_percentual_classe <= 0
       or v_percentual_classe > 100 then
      raise exception 'PERCENTUAL_CLASSE_INVALIDO: posicao %, valor %',
        v_ord_classe,
        coalesce(v_classe ->> 'percentual', '<null>');
    end if;

    v_percentual_classe := round(v_percentual_classe, 4);
    v_soma_classes := v_soma_classes + v_percentual_classe;
    v_ccs := v_classe -> 'ccs';

    if jsonb_typeof(v_ccs) is distinct from 'array' then
      raise exception 'RATEIO_CC_DEVE_SER_ARRAY: classe %', v_ord_classe;
    end if;

    if jsonb_array_length(v_ccs) = 0 then
      raise exception 'CLASSE_SEM_RATEIO_CC: posicao %', v_ord_classe;
    end if;

    v_soma_cc := 0;
    for v_cc, v_ord_cc in
      select elemento, ordinalidade::integer
      from jsonb_array_elements(v_ccs) with ordinality as e(elemento, ordinalidade)
    loop
      if nullif(btrim(v_cc ->> 'codigo_centro_ctrl'), '') is null then
        raise exception 'CC_SEM_CODIGO: classe %, posicao %', v_ord_classe, v_ord_cc;
      end if;

      v_percentual_cc := nullif(v_cc ->> 'percentual', '')::numeric;
      if v_percentual_cc is null
         or v_percentual_cc <= 0
         or v_percentual_cc > 100 then
        raise exception 'PERCENTUAL_CC_INVALIDO: classe %, posicao %, valor %',
          v_ord_classe,
          v_ord_cc,
          coalesce(v_cc ->> 'percentual', '<null>');
      end if;

      v_soma_cc := v_soma_cc + round(v_percentual_cc, 4);
    end loop;

    if round(v_soma_cc, 4) <> 100.0000 then
      raise exception 'SOMA_CC_INVALIDA: classe %, soma %', v_ord_classe, round(v_soma_cc, 4);
    end if;
  end loop;

  if v_qtd_classes > 0 and round(v_soma_classes, 4) <> 100.0000 then
    raise exception 'SOMA_CLASSES_INVALIDA: soma %', round(v_soma_classes, 4);
  end if;

  delete from public.compras_requisicoes_rateio_classes
  where requisicao_id = p_requisicao_id;

  for v_classe, v_ord_classe in
    select elemento, ordinalidade::integer
    from jsonb_array_elements(p_rateio) with ordinality as e(elemento, ordinalidade)
  loop
    v_percentual_classe := nullif(v_classe ->> 'percentual', '')::numeric;
    if v_qtd_classes = 1 and coalesce(v_percentual_classe, 0) = 0 then
      v_percentual_classe := 100;
    end if;

    insert into public.compras_requisicoes_rateio_classes (
      requisicao_id,
      codigo_classe_rec_desp,
      classe_rec_desp_label,
      percentual,
      origem
    ) values (
      p_requisicao_id,
      btrim(v_classe ->> 'codigo_classe_rec_desp'),
      nullif(v_classe ->> 'classe_rec_desp_label', ''),
      round(v_percentual_classe, 4),
      p_origem
    )
    returning id into v_classe_id;

    v_classes_inseridas := v_classes_inseridas + 1;
    v_ccs := v_classe -> 'ccs';

    for v_cc, v_ord_cc in
      select elemento, ordinalidade::integer
      from jsonb_array_elements(v_ccs) with ordinality as e(elemento, ordinalidade)
    loop
      insert into public.compras_requisicoes_rateio_cc (
        rateio_classe_id,
        codigo_centro_ctrl,
        centro_ctrl_label,
        percentual
      ) values (
        v_classe_id,
        btrim(v_cc ->> 'codigo_centro_ctrl'),
        nullif(v_cc ->> 'centro_ctrl_label', ''),
        round((v_cc ->> 'percentual')::numeric, 4)
      );

      v_ccs_inseridos := v_ccs_inseridos + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'classes_inseridas', v_classes_inseridas,
    'ccs_inseridos', v_ccs_inseridos
  );
end;
$function$
;
