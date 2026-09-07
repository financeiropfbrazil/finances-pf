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

CREATE OR REPLACE FUNCTION public.fn_req_protege_aprovacao()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  protegidos constant text[] := array['pendente_aprovacao','aprovada','rejeitada'];
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      if new.status = any(protegidos)
         or new.aprovada_por_user_id is not null or new.aprovada_em is not null
         or new.rejeitada_por_user_id is not null or new.rejeitada_em is not null
         or new.motivo_rejeicao is not null
         or new.motivo_rejeicao_codigo is not null   -- AJUSTE 1.3
         or coalesce(new.aprovacao_automatica,false) then
        raise exception 'PROTEGIDO_APROVACAO: use as RPCs do fluxo de aprovacao (insert)';
      end if;
      return new;
    elsif tg_op = 'UPDATE' then
      if old.status = any(protegidos)
         or new.status = any(protegidos)
         or new.aprovada_por_user_id  is distinct from old.aprovada_por_user_id
         or new.aprovada_em           is distinct from old.aprovada_em
         or new.aprovacao_automatica  is distinct from old.aprovacao_automatica
         or new.rejeitada_por_user_id is distinct from old.rejeitada_por_user_id
         or new.rejeitada_em          is distinct from old.rejeitada_em
         or new.motivo_rejeicao       is distinct from old.motivo_rejeicao
         or new.motivo_rejeicao_codigo is distinct from old.motivo_rejeicao_codigo  -- AJUSTE 1.3
      then
        raise exception 'PROTEGIDO_APROVACAO: use as RPCs do fluxo de aprovacao (update)';
      end if;
      return new;
    else
      if old.status = any(protegidos) then
        raise exception 'PROTEGIDO_APROVACAO: registro do fluxo de aprovacao nao pode ser excluido via API';
      end if;
      return old;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
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
