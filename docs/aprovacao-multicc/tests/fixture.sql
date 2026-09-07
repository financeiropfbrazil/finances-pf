-- Fixture local: colunas consultadas em produção, dados inteiramente sintéticos.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql as $uid$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $uid$;
grant usage on schema auth,public to authenticated,anon,service_role;
grant execute on function auth.uid() to authenticated,anon,service_role;
create table profiles(user_id uuid primary key,full_name text,is_admin boolean default false,funcionario_alvo_codigo text,alvo_usuario text);
create table hub_roles(id uuid primary key,codigo text);
create table hub_user_roles(user_id uuid,role_id uuid,revogado_em timestamptz);
create table hub_permissions(id uuid primary key,codigo text);
create table hub_role_permissions(role_id uuid,permission_id uuid);
create table public.compras_lideres_cc (id uuid not null default gen_random_uuid(), lider_user_id uuid not null, codigo_centro_ctrl text not null, ativo boolean not null default true, created_at timestamp with time zone not null default now(), atribuido_por uuid, atribuido_em timestamp with time zone, revogado_por uuid, revogado_em timestamp with time zone, motivo text);
create table public.compras_motivos_rejeicao (id uuid not null default gen_random_uuid(), codigo text not null, rotulo text not null, exige_observacao boolean not null default false, ordem integer not null default 0, ativo boolean not null default true, created_at timestamp with time zone not null default now());
create table public.compras_requisicoes (id uuid not null default gen_random_uuid(), requisitante_user_id uuid, status text not null default 'rascunho'::text, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now(), enviado_em timestamp with time zone, tentativa_envio_em timestamp with time zone, erro_ultimo_envio text, codigo_empresa_filial text not null default '1.01'::text, numero_alvo text, codigo_funcionario text, codigo_centro_ctrl text, codigo_finalidade_compra text, descricao text, data_necessidade timestamp with time zone, texto text, funcionario_nome text, centro_ctrl_nome text, finalidade_compra_label text, total_itens integer, numero_pedido_compra_alvo text, cnpj_sugestao_requisicao text, data_abertura_alvo timestamp with time zone, vinculo_atualizado_em timestamp with time zone, vinculo_atualizado_por text, vinculo_ultima_acao text, aprovada_por_user_id uuid, aprovada_em timestamp with time zone, aprovacao_automatica boolean not null default false, rejeitada_por_user_id uuid, rejeitada_em timestamp with time zone, motivo_rejeicao text, motivo_rejeicao_codigo text);
create table public.compras_requisicoes_arquivos (id uuid not null default gen_random_uuid(), requisicao_id uuid not null, upload_identify_guid uuid not null, nome_original text not null, storage_path text not null, mime_type text not null, tamanho_bytes bigint not null, numero_alvo_ao_enviar text, uploaded_by_user_id uuid, created_at timestamp with time zone not null default now(), updated_at timestamp with time zone not null default now());
create table public.compras_requisicoes_auditoria (id uuid not null default gen_random_uuid(), requisicao_id uuid not null, evento text not null, user_id uuid, user_nome text, payload_enviado jsonb, resposta_alvo jsonb, sucesso boolean, mensagem_erro text, created_at timestamp with time zone not null default now());
create table public.compras_requisicoes_itens (id uuid not null default gen_random_uuid(), requisicao_id uuid not null, created_at timestamp with time zone not null default now(), sequencia integer not null default 0, item_servico boolean not null default false, codigo_produto text not null, codigo_alternativo_produto text, codigo_prod_unid_med text not null, quantidade numeric(18,9) not null, data_necessidade timestamp with time zone not null, codigo_centro_ctrl text not null, observacao text, produto_nome text, produto_unidade text);
create table public.compras_requisicoes_itens_classe_rec_desp (id uuid not null default gen_random_uuid(), item_id uuid not null, codigo_classe_rec_desp text not null, classe_rec_desp_label text, percentual numeric(5,2) not null, created_at timestamp with time zone not null default now());
create table public.compras_requisicoes_rateio_cc (id uuid not null default gen_random_uuid(), rateio_classe_id uuid not null, codigo_centro_ctrl text not null, centro_ctrl_label text, percentual numeric(9,4) not null, created_at timestamp with time zone not null default now());
create table public.compras_requisicoes_rateio_classes (id uuid not null default gen_random_uuid(), requisicao_id uuid not null, codigo_classe_rec_desp text not null, classe_rec_desp_label text, percentual numeric(9,4) not null, origem text not null, created_at timestamp with time zone not null default now());
alter table compras_requisicoes add primary key(id);
alter table compras_requisicoes_itens add primary key(id);
alter table compras_requisicoes_rateio_classes add primary key(id);
alter table compras_requisicoes_rateio_cc add primary key(id);
alter table compras_requisicoes_itens add foreign key(requisicao_id) references compras_requisicoes(id) on delete cascade;
alter table compras_requisicoes_itens_classe_rec_desp add foreign key(item_id) references compras_requisicoes_itens(id) on delete cascade;
alter table compras_requisicoes_rateio_classes add foreign key(requisicao_id) references compras_requisicoes(id) on delete cascade;
alter table compras_requisicoes_rateio_cc add foreign key(rateio_classe_id) references compras_requisicoes_rateio_classes(id) on delete cascade;
alter table compras_requisicoes add check(status in ('rascunho','pendente_envio','erro_envio','sincronizada','cancelada','convertida_pedido','pendente_aprovacao','aprovada','rejeitada'));
create function user_has_permission(p_user_id uuid,p_permission_code text) returns boolean language sql security definer set search_path=public as $perm$
 select coalesce((select is_admin from profiles where user_id=p_user_id),false) or exists(select 1 from hub_user_roles ur join hub_role_permissions rp on rp.role_id=ur.role_id join hub_permissions p on p.id=rp.permission_id where ur.user_id=p_user_id and ur.revogado_em is null and p.codigo=p_permission_code)
$perm$;
grant all on all tables in schema public to service_role;
grant select,insert,update,delete on all tables in schema public to authenticated;
alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;

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
create trigger trg_req_protege_aprovacao before insert or update or delete on compras_requisicoes for each row execute function fn_req_protege_aprovacao();
-- Constraint real consultada em produção em 07/09/2026 (adicionada ao fim abaixo).

alter table public.compras_requisicoes_auditoria add constraint compras_requisicoes_auditoria_evento_check CHECK ((evento = ANY (ARRAY['criada'::text, 'editada'::text, 'envio_tentado'::text, 'envio_sucesso'::text, 'envio_falha'::text, 'cancelada_alvo'::text, 'convertida_pedido'::text, 'vinculado_pedido'::text, 'desvinculado_pedido'::text, 'enviada_aprovacao'::text, 'aprovada_lider'::text, 'rejeitada_lider'::text, 'submetida_sem_gate'::text, 'envio_pos_aprovacao_sucesso'::text, 'envio_pos_aprovacao_falha'::text, 'descoberta_alvo'::text, 'sync_status'::text])));

-- Colunas usadas pelo snapshot de unidades; dados abaixo são sintéticos.
create table stock_products(codigo_produto text primary key, unidade_medida text);
insert into stock_products values ('PROD','UN');
-- Estrutura mínima para executar as policies reais de objetos. Não emula S3/HTTP.
create schema storage;
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,anon,service_role;
grant all on storage.objects to authenticated,service_role;
create policy compras_req_storage_insert on storage.objects for insert to authenticated with check (bucket_id='compras-requisicoes');
create policy compras_req_storage_select on storage.objects for select to authenticated using (bucket_id='compras-requisicoes');
create policy compras_req_storage_delete on storage.objects for delete to authenticated using (bucket_id='compras-requisicoes');
