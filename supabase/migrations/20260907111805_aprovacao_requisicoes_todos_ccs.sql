-- Preparação local. Aplicação futura coordenada com frontend e gateway.
-- Executar como uma transação via psql, nunca supabase db push neste projeto.
begin;
set local lock_timeout = '5s';

lock table public.compras_requisicoes in share row exclusive mode;
do $preflight$
begin
  if exists (select 1 from public.compras_requisicoes where numero_alvo is null
    and status in ('pendente_aprovacao','aprovada','pendente_envio')) then
    raise exception 'TRANSICAO_REQUER_REVISAO: existem requisicoes em andamento';
  end if;
end;
$preflight$;

-- Preserva integralmente a expressão vigente, inclusive eventos acrescentados antes do rollout.
DO $auditoria_constraint$
declare v_expr text;
begin
 select pg_get_expr(conbin,conrelid) into v_expr from pg_constraint
 where conrelid='public.compras_requisicoes_auditoria'::regclass and conname='compras_requisicoes_auditoria_evento_check';
 if v_expr is null then raise exception 'CONSTRAINT_AUDITORIA_AUSENTE'; end if;
 alter table public.compras_requisicoes_auditoria drop constraint compras_requisicoes_auditoria_evento_check;
 execute format('alter table public.compras_requisicoes_auditoria add constraint compras_requisicoes_auditoria_evento_check CHECK ((%s) OR evento = ANY (%L::text[]))',
   v_expr, '{cc_dispensado_autor,cc_sem_lider,cc_pendente,aprovacao_cc_registrada,cc_sem_lider_fechamento,login_servico_provisorio,envio_reivindicado}');
end;
$auditoria_constraint$;

CREATE OR REPLACE FUNCTION public.req_evento_obrigatorio(p_req_id uuid, p_evento text, p_detalhe jsonb, p_sucesso boolean DEFAULT true)
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
end;
$function$
;

revoke all on function public.req_evento_obrigatorio(uuid,text,jsonb,boolean) from public,anon,authenticated;

alter table public.compras_requisicoes add column aprovacao_submetida_em timestamptz;
alter table public.compras_requisicoes add column envio_token uuid;
-- Rascunhos existentes mantêm compatibilidade; novas criações precisam finalizar
-- todos os filhos antes de poder submeter (falha de upload não perde rateio em retry).
alter table public.compras_requisicoes add column criacao_concluida boolean not null default true;
alter table public.compras_requisicoes alter column criacao_concluida set default false;

create table public.compras_requisicoes_aprovacao_grupos (
  requisicao_id uuid not null references public.compras_requisicoes(id) on delete restrict,
  codigo_centro_ctrl text not null check (length(btrim(codigo_centro_ctrl)) > 0),
  aprovado_por uuid,
  aprovado_em timestamptz,
  automatica boolean not null default false,
  sem_lider_na_submissao boolean not null,
  dispensa_sem_lider_em timestamptz,
  primary key (requisicao_id, codigo_centro_ctrl),
  check ((aprovado_por is null) = (aprovado_em is null))
);
create index req_aprovacao_cc on public.compras_requisicoes_aprovacao_grupos(codigo_centro_ctrl,requisicao_id);
alter table public.compras_requisicoes_aprovacao_grupos enable row level security;
revoke all on public.compras_requisicoes_aprovacao_grupos from public, anon, authenticated;

create or replace function public.req_ccs_envolvidos(p_req_id uuid)
returns table(codigo_centro_ctrl text) language sql stable security definer set search_path=public
as $ccs$
  select distinct btrim(cc) from (
    select r.codigo_centro_ctrl cc from compras_requisicoes r where r.id=p_req_id
    union all select i.codigo_centro_ctrl from compras_requisicoes_itens i where i.requisicao_id=p_req_id
    union all select c.codigo_centro_ctrl from compras_requisicoes_rateio_cc c
      join compras_requisicoes_rateio_classes cl on cl.id=c.rateio_classe_id where cl.requisicao_id=p_req_id
  ) x where nullif(btrim(cc),'') is not null;
$ccs$;
revoke all on function public.req_ccs_envolvidos(uuid) from public,anon,authenticated;

create or replace function public.req_lider_cc(p_user uuid,p_cc text)
returns boolean language sql stable security definer set search_path=public
as $lider$
 select exists(select 1 from compras_lideres_cc l
   join hub_user_roles ur on ur.user_id=l.lider_user_id and ur.revogado_em is null
   join hub_roles r on r.id=ur.role_id and r.codigo='lider_departamento'
   where l.lider_user_id=p_user and l.codigo_centro_ctrl=p_cc and l.ativo)
   and public.user_has_permission(p_user,'compras.requisicoes.aprovar');
$lider$;
revoke all on function public.req_lider_cc(uuid,text) from public,anon,authenticated;

create or replace function public.req_cc_tem_lider(p_cc text)
returns boolean language sql stable security definer set search_path=public
as $tem$
 select exists(select 1 from compras_lideres_cc l where l.codigo_centro_ctrl=p_cc
   and l.ativo and public.req_lider_cc(l.lider_user_id,p_cc));
$tem$;
revoke all on function public.req_cc_tem_lider(text) from public,anon,authenticated;

create or replace function public.req_aprovacao_completa(p_req_id uuid)
returns boolean language sql stable security definer set search_path=public
as $completa$
 select exists(select 1 from compras_requisicoes_aprovacao_grupos where requisicao_id=p_req_id)
 and not exists(select 1 from compras_requisicoes_aprovacao_grupos g where g.requisicao_id=p_req_id
   and g.aprovado_em is null and public.req_cc_tem_lider(g.codigo_centro_ctrl));
$completa$;
revoke all on function public.req_aprovacao_completa(uuid) from public,anon,authenticated;

-- Sem backfill: quantidade legada é principal; solicitada/posição só vêm do Load.
alter table public.compras_requisicoes_itens
 add column quantidade_solicitada numeric(18,9) check (quantidade_solicitada > 0),
 add column posicao_prod_unid_med integer check (posicao_prod_unid_med > 0),
 add column conversao_unidade jsonb;

create or replace function public.submeter_requisicao(p_req_id uuid)
returns text language plpgsql security definer set search_path=public
as $submeter$
declare v_req compras_requisicoes; v_cc record; v_tem boolean; v_auto boolean; v_algum boolean:=false;
begin
 if auth.uid() is null or not public.user_has_permission(auth.uid(),'compras.requisicoes.create') then return 'SEM_PERMISSAO'; end if;
 -- Mesma ordem de locks nas decisões: mapa antes do pai. Sem HTTP dentro da transação.
 lock table compras_lideres_cc,hub_user_roles,hub_role_permissions in share mode;
 select * into v_req from compras_requisicoes where id=p_req_id for update;
 if not found then return 'NAO_ENCONTRADA'; end if;
 if v_req.status is distinct from 'rascunho' then return 'STATUS_INVALIDO:'||coalesce(v_req.status,'null'); end if;
 if v_req.requisitante_user_id is distinct from auth.uid() and not coalesce((select is_admin from profiles where user_id=auth.uid()),false) then return 'NAO_AUTORIZADO'; end if;
 if nullif(btrim(v_req.codigo_centro_ctrl),'') is null then return 'SEM_CENTRO_CUSTO'; end if;
 if not exists(select 1 from compras_requisicoes_itens where requisicao_id=p_req_id) then return 'SEM_ITENS'; end if;
 if exists(select 1 from compras_requisicoes_arquivos where requisicao_id=p_req_id and (conteudo_sha256 is null or storage_path not like p_req_id::text||'/%')) then return 'ANEXO_SEM_INTEGRIDADE'; end if;
 if exists(select 1 from compras_requisicoes_itens where requisicao_id=p_req_id and
   (quantidade_solicitada is null or posicao_prod_unid_med is null or conversao_unidade is null
    or conversao_unidade->>'tipo' is distinct from 'Fator'
    or (conversao_unidade->>'peso')::numeric <= 0
    or codigo_prod_unid_med is distinct from conversao_unidade->>'codigo'
    or posicao_prod_unid_med is distinct from (conversao_unidade->>'posicao')::integer
    or quantidade is distinct from quantidade_solicitada*(conversao_unidade->>'peso')::numeric)) then return 'UNIDADE_INCOMPLETA_OU_DIVERGENTE'; end if;
 if not v_req.criacao_concluida then return 'CRIACAO_INCOMPLETA'; end if;
 if v_req.total_itens is not null and v_req.total_itens<>(select count(*) from compras_requisicoes_itens where requisicao_id=p_req_id) then return 'CRIACAO_INCOMPLETA'; end if;
 if exists(select 1 from compras_requisicoes_rateio_classes where requisicao_id=p_req_id) then
   if (select sum(percentual) from compras_requisicoes_rateio_classes where requisicao_id=p_req_id) <> 100
     or exists(select 1 from compras_requisicoes_rateio_classes cl where cl.requisicao_id=p_req_id
       and coalesce((select sum(c.percentual) from compras_requisicoes_rateio_cc c where c.rateio_classe_id=cl.id),0)<>100) then
     return 'RATEIO_INVALIDO';
   end if;
   if not exists(select 1 from compras_requisicoes_rateio_classes cl join compras_requisicoes_rateio_cc c on c.rateio_classe_id=cl.id
     where cl.requisicao_id=p_req_id and btrim(c.codigo_centro_ctrl)=btrim(v_req.codigo_centro_ctrl)) then return 'CABECALHO_FORA_RATEIO'; end if;
 end if;
 for v_cc in select * from public.req_ccs_envolvidos(p_req_id) loop
   v_tem:=public.req_cc_tem_lider(v_cc.codigo_centro_ctrl);
   -- É o AUTOR, mesmo quando um admin submete por ele.
   v_auto:=public.req_lider_cc(v_req.requisitante_user_id,v_cc.codigo_centro_ctrl);
   v_algum:=v_algum or v_tem;
   insert into compras_requisicoes_aprovacao_grupos(requisicao_id,codigo_centro_ctrl,aprovado_por,aprovado_em,automatica,sem_lider_na_submissao) values(p_req_id,v_cc.codigo_centro_ctrl,
     case when v_auto then v_req.requisitante_user_id end,case when v_auto then now() end,v_auto,not v_tem);
   perform public.req_evento_obrigatorio(p_req_id,case when v_auto then 'cc_dispensado_autor' when not v_tem then 'cc_sem_lider' else 'cc_pendente' end,
     jsonb_build_object('cc',v_cc.codigo_centro_ctrl,'autor',v_req.requisitante_user_id));
 end loop;
 if public.req_aprovacao_completa(p_req_id) then
   update compras_requisicoes_aprovacao_grupos set dispensa_sem_lider_em=now() where requisicao_id=p_req_id and aprovado_em is null;
   update compras_requisicoes set status='aprovada',aprovacao_submetida_em=now(),aprovada_em=now(),
     aprovada_por_user_id=case when v_algum then v_req.requisitante_user_id end,
     aprovacao_automatica=v_algum,erro_ultimo_envio=null,updated_at=now() where id=p_req_id;
   perform public.req_evento_obrigatorio(p_req_id,case when v_algum then 'aprovada_lider' else 'submetida_sem_gate' end,jsonb_build_object('multi_cc',true));
   return case when v_algum then 'AUTO_APROVADA' else 'SEM_GATE' end;
 end if;
 update compras_requisicoes set status='pendente_aprovacao',aprovacao_submetida_em=now(),erro_ultimo_envio=null,updated_at=now() where id=p_req_id;
 perform public.req_evento_obrigatorio(p_req_id,'enviada_aprovacao',jsonb_build_object('multi_cc',true));
 return 'PENDENTE';
end;
$submeter$;

create or replace function public.aprovar_requisicao(p_req_id uuid)
returns text language plpgsql security definer set search_path=public
as $aprovar$
declare v_req compras_requisicoes; v_admin boolean;
begin
 if auth.uid() is null or not public.user_has_permission(auth.uid(),'compras.requisicoes.aprovar') then return 'SEM_PERMISSAO'; end if;
 lock table compras_lideres_cc,hub_user_roles,hub_role_permissions in share mode;
 select * into v_req from compras_requisicoes where id=p_req_id for update;
 if not found then return 'NAO_ENCONTRADA'; end if;
 if v_req.status is distinct from 'pendente_aprovacao' then return 'STATUS_INVALIDO:'||coalesce(v_req.status,'null'); end if;
 v_admin:=coalesce((select is_admin from profiles where user_id=auth.uid()),false);
 if not v_admin and not exists(select 1 from compras_requisicoes_aprovacao_grupos g where g.requisicao_id=p_req_id and public.req_lider_cc(auth.uid(),g.codigo_centro_ctrl)) then return 'FORA_DO_SEU_CC'; end if;
 update compras_requisicoes_aprovacao_grupos g set aprovado_por=auth.uid(),aprovado_em=now(),automatica=false
   where g.requisicao_id=p_req_id and g.aprovado_em is null and (v_admin or public.req_lider_cc(auth.uid(),g.codigo_centro_ctrl));
 perform public.req_evento_obrigatorio(p_req_id,'aprovacao_cc_registrada',jsonb_build_object('admin',v_admin,'ccs',
   (select jsonb_agg(codigo_centro_ctrl) from compras_requisicoes_aprovacao_grupos where requisicao_id=p_req_id and aprovado_por=auth.uid())));
 if not public.req_aprovacao_completa(p_req_id) then return 'PARCIAL'; end if;
 update compras_requisicoes_aprovacao_grupos set dispensa_sem_lider_em=now() where requisicao_id=p_req_id and aprovado_em is null;
 perform public.req_evento_obrigatorio(p_req_id,'cc_sem_lider_fechamento',jsonb_build_object('ccs',
   (select coalesce(jsonb_agg(codigo_centro_ctrl),'[]'::jsonb) from compras_requisicoes_aprovacao_grupos where requisicao_id=p_req_id and dispensa_sem_lider_em is not null)));
 update compras_requisicoes set status='aprovada',aprovada_por_user_id=auth.uid(),aprovada_em=now(),aprovacao_automatica=false,updated_at=now() where id=p_req_id;
 perform public.req_evento_obrigatorio(p_req_id,'aprovada_lider',jsonb_build_object('automatica',false,'multi_cc',true,'admin',v_admin));
 return 'FINAL';
end;
$aprovar$;

-- Rejeição preserva catálogo, observação e terminalidade da função de produção.
create or replace function public.rejeitar_requisicao(p_req_id uuid,p_motivo_codigo text,p_observacao text)
returns text language plpgsql security definer set search_path=public
as $rejeitar$
declare v_req compras_requisicoes; v_motivo compras_motivos_rejeicao; v_obs text; v_admin boolean;
begin
 if auth.uid() is null or not public.user_has_permission(auth.uid(),'compras.requisicoes.aprovar') then return 'SEM_PERMISSAO'; end if;
 select * into v_motivo from compras_motivos_rejeicao where codigo=p_motivo_codigo and ativo;
 if not found then return 'MOTIVO_INVALIDO'; end if;
 v_obs:=nullif(trim(coalesce(p_observacao,'')),'');
 if v_motivo.exige_observacao and (v_obs is null or length(v_obs)<5) then return 'OBSERVACAO_OBRIGATORIA'; end if;
 lock table compras_lideres_cc,hub_user_roles,hub_role_permissions in share mode;
 select * into v_req from compras_requisicoes where id=p_req_id for update;
 if not found then return 'NAO_ENCONTRADA'; end if;
 if v_req.status is distinct from 'pendente_aprovacao' then return 'STATUS_INVALIDO:'||coalesce(v_req.status,'null'); end if;
 v_admin:=coalesce((select is_admin from profiles where user_id=auth.uid()),false);
 if not v_admin and not exists(select 1 from compras_requisicoes_aprovacao_grupos g where g.requisicao_id=p_req_id and public.req_lider_cc(auth.uid(),g.codigo_centro_ctrl)) then return 'FORA_DO_SEU_CC'; end if;
 update compras_requisicoes set status='rejeitada',rejeitada_por_user_id=auth.uid(),rejeitada_em=now(),
   motivo_rejeicao_codigo=v_motivo.codigo,motivo_rejeicao=v_obs,updated_at=now() where id=p_req_id;
 perform public.req_evento_obrigatorio(p_req_id,'rejeitada_lider',jsonb_build_object('motivo_codigo',v_motivo.codigo,'motivo_rotulo',v_motivo.rotulo,'observacao',v_obs,'multi_cc',true));
 return 'OK';
end;
$rejeitar$;

-- Leitura autorizada centralizada: fila/detalhe não decidem mais pelo cabeçalho.
create or replace function public.req_ccs_aprovacao(p_req_id uuid)
returns table(codigo_centro_ctrl text) language sql stable security definer set search_path=public
as $snapshot_cc$
 select g.codigo_centro_ctrl from compras_requisicoes_aprovacao_grupos g where g.requisicao_id=p_req_id
 union all select c.codigo_centro_ctrl from public.req_ccs_envolvidos(p_req_id) c
 where not exists(select 1 from compras_requisicoes_aprovacao_grupos where requisicao_id=p_req_id);
$snapshot_cc$;
revoke all on function public.req_ccs_aprovacao(uuid) from public,anon,authenticated;

create or replace function public.req_pode_ler_aprovacao(p_req_id uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public
as $ler$
 select p_user is not null and exists(select 1 from compras_requisicoes r where r.id=p_req_id and (
   r.requisitante_user_id=p_user or public.user_has_permission(p_user,'compras.requisicoes.view_all')
   or exists(select 1 from profiles p where p.user_id=p_user and p.funcionario_alvo_codigo=r.codigo_funcionario)
   or (r.status<>'rascunho' and exists(select 1 from public.req_ccs_aprovacao(r.id) c where public.req_lider_cc(p_user,c.codigo_centro_ctrl)))));
$ler$;
revoke all on function public.req_pode_ler_aprovacao(uuid,uuid) from public,anon,authenticated;

create or replace function public.requisicao_aprovacao_cc(p_req_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public
as $detalhe$
begin
 if not public.req_pode_ler_aprovacao(p_req_id,auth.uid()) then raise exception 'SEM_PERMISSAO'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('codigo_centro_ctrl',c.codigo_centro_ctrl,
   'aprovado_por',g.aprovado_por,'aprovado_em',g.aprovado_em,'automatica',coalesce(g.automatica,false),
   'lider_atual',public.req_lider_cc(auth.uid(),c.codigo_centro_ctrl),
   'situacao',case when g.aprovado_em is not null then case when g.automatica then 'dispensado_autor' else 'aprovado' end
     when (select status from compras_requisicoes where id=p_req_id)='rejeitada' then 'rejeitado'
     when (select status from compras_requisicoes where id=p_req_id) not in ('rascunho','pendente_aprovacao') and g.requisicao_id is not null then 'sem_lider'
     when not public.req_cc_tem_lider(c.codigo_centro_ctrl) then 'sem_lider' else 'pendente' end,
   'aprovado_nome',(select full_name from profiles where user_id=g.aprovado_por),
   'lideres',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'nome',p.full_name)),'[]'::jsonb)
     from compras_lideres_cc l join profiles p on p.user_id=l.lider_user_id
     where l.codigo_centro_ctrl=c.codigo_centro_ctrl and public.req_lider_cc(l.lider_user_id,c.codigo_centro_ctrl))
 ) order by c.codigo_centro_ctrl) from public.req_ccs_aprovacao(p_req_id) c
 left join compras_requisicoes_aprovacao_grupos g on g.requisicao_id=p_req_id and g.codigo_centro_ctrl=c.codigo_centro_ctrl),'[]'::jsonb);
end;
$detalhe$;

create or replace function public.requisicoes_fila_aprovacao()
returns table(requisicao jsonb,aguardando_voce boolean) language sql stable security definer set search_path=public
as $fila$
 select to_jsonb(r),coalesce((select is_admin from profiles where user_id=auth.uid()),false)
   or exists(select 1 from compras_requisicoes_aprovacao_grupos g where g.requisicao_id=r.id and g.aprovado_em is null and public.req_lider_cc(auth.uid(),g.codigo_centro_ctrl))
 from compras_requisicoes r where r.status='pendente_aprovacao'
 and auth.uid() is not null and public.user_has_permission(auth.uid(),'compras.requisicoes.aprovar')
 and (coalesce((select is_admin from profiles where user_id=auth.uid()),false)
   or exists(select 1 from compras_requisicoes_aprovacao_grupos g where g.requisicao_id=r.id and public.req_lider_cc(auth.uid(),g.codigo_centro_ctrl)))
 order by r.created_at,r.id;
$fila$;

-- Objetos novos têm conteúdo vinculado por SHA-256 ao metadado congelado.
alter table public.compras_requisicoes_arquivos add column conteudo_sha256 text
 check (conteudo_sha256 ~ '^[0-9a-f]{64}$');

-- Policy helper mantém o lock do pai até o fim da operação de Storage no Postgres.
create or replace function public.req_storage_rascunho(p_name text)
returns boolean language plpgsql security definer set search_path=public
as $storage_rascunho$
declare v_req compras_requisicoes; v_id text:=split_part(p_name,'/',1);
begin
 if auth.uid() is null or not public.user_has_permission(auth.uid(),'compras.requisicoes.create')
   or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or p_name not like '%/_%' then return false; end if;
 select * into v_req from compras_requisicoes where id=v_id::uuid for update;
 return found and v_req.status='rascunho' and v_req.aprovacao_submetida_em is null and v_req.numero_alvo is null
   and (v_req.requisitante_user_id=auth.uid() or coalesce((select is_admin from profiles where user_id=auth.uid()),false));
end;
$storage_rascunho$;
revoke all on function public.req_storage_rascunho(text) from public,anon,authenticated;
grant execute on function public.req_storage_rascunho(text) to authenticated;

-- RESTRICTIVE soma uma condição AND às policies atuais, sem abrir outros buckets.
-- UPDATE continua sem concessão permissiva: o Hub usa upload upsert:false.
create policy compras_req_obj_insert_guard on storage.objects as restrictive for insert to authenticated
 with check (bucket_id <> 'compras-requisicoes' or public.req_storage_rascunho(name));
create policy compras_req_obj_delete_guard on storage.objects as restrictive for delete to authenticated
 using (bucket_id <> 'compras-requisicoes' or public.req_storage_rascunho(name));
create policy compras_req_obj_update_guard on storage.objects as restrictive for update to authenticated
 using (bucket_id <> 'compras-requisicoes' or public.req_storage_rascunho(name))
 with check (bucket_id <> 'compras-requisicoes' or public.req_storage_rascunho(name));

-- Impedir mutações no documento submetido e nos pais de origem/destino dos filhos.
create or replace function public.fn_req_congelar_conteudo()
returns trigger language plpgsql security definer set search_path=public
as $congelar$
declare v_old jsonb; v_new jsonb; v_id uuid; v_ids uuid[]:='{}'; v_req compras_requisicoes;
begin
 if tg_op<>'INSERT' then v_old:=to_jsonb(old); end if;
 if tg_op<>'DELETE' then v_new:=to_jsonb(new); end if;
 if tg_table_name='compras_requisicoes' then
   if tg_op='UPDATE' and old.aprovacao_submetida_em is not null and old.numero_alvo is null
     and (to_jsonb(new)-array['status','aprovada_por_user_id','aprovada_em','aprovacao_automatica','rejeitada_por_user_id','rejeitada_em','motivo_rejeicao','motivo_rejeicao_codigo','updated_at','enviado_em','tentativa_envio_em','erro_ultimo_envio','numero_alvo','envio_token'])
       is distinct from (to_jsonb(old)-array['status','aprovada_por_user_id','aprovada_em','aprovacao_automatica','rejeitada_por_user_id','rejeitada_em','motivo_rejeicao','motivo_rejeicao_codigo','updated_at','enviado_em','tentativa_envio_em','erro_ultimo_envio','numero_alvo','envio_token']) then
     raise exception 'REQUISICAO_CONGELADA: clone para alterar o conteudo';
   end if;
 else
   if tg_table_name='compras_requisicoes_rateio_cc' then
     select array_agg(requisicao_id) into v_ids from compras_requisicoes_rateio_classes
       where id in ((v_old->>'rateio_classe_id')::uuid,(v_new->>'rateio_classe_id')::uuid);
   elsif tg_table_name='compras_requisicoes_itens_classe_rec_desp' then
     select array_agg(requisicao_id) into v_ids from compras_requisicoes_itens
       where id in ((v_old->>'item_id')::uuid,(v_new->>'item_id')::uuid);
   else v_ids:=array[(v_old->>'requisicao_id')::uuid,(v_new->>'requisicao_id')::uuid]; end if;
   for v_id in select distinct x from unnest(v_ids) x where x is not null order by x loop
     select * into v_req from compras_requisicoes where id=v_id for update;
     if tg_table_name='compras_requisicoes_arquivos' and v_req.aprovacao_submetida_em is not null
       and (tg_op<>'UPDATE' or (v_new-'numero_alvo_ao_enviar') is distinct from (v_old-'numero_alvo_ao_enviar')) then
       raise exception 'ANEXO_CONGELADO'; end if;
     if v_req.aprovacao_submetida_em is not null and v_req.numero_alvo is null then raise exception 'REQUISICAO_CONGELADA: itens e rateio nao podem mudar'; end if;
     if current_setting('role',true) in ('authenticated','anon') and v_req.numero_alvo is null and (v_req.status<>'rascunho'
       or (v_req.requisitante_user_id is distinct from auth.uid() and not coalesce((select is_admin from profiles where user_id=auth.uid()),false))) then raise exception 'SEM_PERMISSAO'; end if;
   end loop;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end;
$congelar$;
revoke all on function public.fn_req_congelar_conteudo() from public,anon,authenticated;
create trigger trg_req_congelar before update on public.compras_requisicoes for each row execute function public.fn_req_congelar_conteudo();
create trigger trg_req_congelar before insert or update or delete on public.compras_requisicoes_itens for each row execute function public.fn_req_congelar_conteudo();
create trigger trg_req_congelar before insert or update or delete on public.compras_requisicoes_itens_classe_rec_desp for each row execute function public.fn_req_congelar_conteudo();
create trigger trg_req_congelar before insert or update or delete on public.compras_requisicoes_rateio_classes for each row execute function public.fn_req_congelar_conteudo();
create trigger trg_req_congelar before insert or update or delete on public.compras_requisicoes_rateio_cc for each row execute function public.fn_req_congelar_conteudo();
create trigger trg_req_congelar before insert or update or delete on public.compras_requisicoes_arquivos for each row execute function public.fn_req_congelar_conteudo();

create or replace function public.fn_req_protege_aprovacao()
returns trigger language plpgsql set search_path=public
as $proteger$
begin
 if current_user in ('authenticated','anon') then
   if tg_op='INSERT' then
     if (new.status is distinct from 'rascunho' and not exists(select 1 from compras_requisicoes r where r.id=new.id and r.numero_alvo is not null and r.numero_alvo=new.numero_alvo and r.status not in ('pendente_aprovacao','aprovada','rejeitada'))) or new.aprovacao_submetida_em is not null or new.envio_token is not null
       or (new.numero_alvo is not null and not exists(select 1 from compras_requisicoes r where r.id=new.id and r.numero_alvo=new.numero_alvo)) or new.aprovada_por_user_id is not null or new.aprovada_em is not null
       or new.rejeitada_por_user_id is not null or new.rejeitada_em is not null or new.motivo_rejeicao is not null
       or new.motivo_rejeicao_codigo is not null or new.aprovacao_automatica or new.criacao_concluida then raise exception 'PROTEGIDO_APROVACAO'; end if;
   else
     if old.status in ('pendente_aprovacao','aprovada','rejeitada') or (old.aprovacao_submetida_em is not null and old.numero_alvo is null) then raise exception 'PROTEGIDO_APROVACAO'; end if;
     if tg_op='UPDATE' and ((old.status='rascunho' and new.status is distinct from old.status) or new.status in ('pendente_aprovacao','aprovada','rejeitada') or new.requisitante_user_id is distinct from old.requisitante_user_id
       or new.numero_alvo is distinct from old.numero_alvo or new.aprovacao_submetida_em is distinct from old.aprovacao_submetida_em
       or new.envio_token is distinct from old.envio_token or new.criacao_concluida is distinct from old.criacao_concluida or new.aprovada_em is distinct from old.aprovada_em
       or new.aprovada_por_user_id is distinct from old.aprovada_por_user_id or new.aprovacao_automatica is distinct from old.aprovacao_automatica
       or new.rejeitada_por_user_id is distinct from old.rejeitada_por_user_id or new.rejeitada_em is distinct from old.rejeitada_em
       or new.motivo_rejeicao is distinct from old.motivo_rejeicao or new.motivo_rejeicao_codigo is distinct from old.motivo_rejeicao_codigo) then raise exception 'PROTEGIDO_APROVACAO'; end if;
   end if;
   if (case when tg_op='DELETE' then old.status='rascunho' else new.status='rascunho' end) and (case when tg_op='DELETE' then old.requisitante_user_id else new.requisitante_user_id end) is distinct from auth.uid()
      and not coalesce((select is_admin from profiles where user_id=auth.uid()),false) then raise exception 'SEM_PERMISSAO'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end;
$proteger$;

-- Somente wrapper de rascunho abre escrita de rateio para o cliente.
create or replace function public.salvar_rateio_requisicao(p_req_id uuid,p_rateio jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $salvar$
declare v_req compras_requisicoes;
begin
 if auth.uid() is null or not public.user_has_permission(auth.uid(),'compras.requisicoes.create') then raise exception 'SEM_PERMISSAO'; end if;
 select * into v_req from compras_requisicoes where id=p_req_id for update;
 if not found or v_req.status<>'rascunho' or v_req.aprovacao_submetida_em is not null then raise exception 'STATUS_INVALIDO'; end if;
 if v_req.requisitante_user_id is distinct from auth.uid() and not coalesce((select is_admin from profiles where user_id=auth.uid()),false) then raise exception 'SEM_PERMISSAO'; end if;
 return public.req_replace_rateio(p_req_id,p_rateio,'hub');
end;
$salvar$;

-- Cliente não pode afirmar que o ERP recebeu. Desfecho agora é responsabilidade do gateway.
create or replace function public.finalizar_rascunho_requisicao(p_req_id uuid)
returns void language plpgsql security definer set search_path=public
as $finalizar_criacao$
declare v_req compras_requisicoes;
begin
 if auth.uid() is null or not public.user_has_permission(auth.uid(),'compras.requisicoes.create') then raise exception 'SEM_PERMISSAO'; end if;
 select * into v_req from compras_requisicoes where id=p_req_id for update;
 if not found or v_req.status<>'rascunho' then raise exception 'STATUS_INVALIDO'; end if;
 if v_req.requisitante_user_id is distinct from auth.uid() and not coalesce((select is_admin from profiles where user_id=auth.uid()),false) then raise exception 'SEM_PERMISSAO'; end if;
 if not exists(select 1 from compras_requisicoes_itens where requisicao_id=p_req_id)
   or (v_req.total_itens is not null and v_req.total_itens<>(select count(*) from compras_requisicoes_itens where requisicao_id=p_req_id)) then raise exception 'CRIACAO_INCOMPLETA'; end if;
 update compras_requisicoes set criacao_concluida=true where id=p_req_id;
end;
$finalizar_criacao$;
revoke all on function public.finalizar_rascunho_requisicao(uuid) from public,anon;
grant execute on function public.finalizar_rascunho_requisicao(uuid) to authenticated;

create or replace function public.registrar_erro_rascunho_requisicao(p_req_id uuid,p_erro text)
returns void language plpgsql security definer set search_path=public
as $erro_rascunho$
declare v_req compras_requisicoes;
begin
 if auth.uid() is null or not public.user_has_permission(auth.uid(),'compras.requisicoes.create') then raise exception 'SEM_PERMISSAO'; end if;
 select * into v_req from compras_requisicoes where id=p_req_id for update;
 if not found or v_req.status<>'rascunho' or v_req.aprovacao_submetida_em is not null then raise exception 'STATUS_INVALIDO'; end if;
 if v_req.requisitante_user_id is distinct from auth.uid() and not coalesce((select is_admin from profiles where user_id=auth.uid()),false) then raise exception 'SEM_PERMISSAO'; end if;
 update compras_requisicoes set erro_ultimo_envio=p_erro,updated_at=now() where id=p_req_id;
end;
$erro_rascunho$;
revoke all on function public.registrar_erro_rascunho_requisicao(uuid,text) from public,anon;
grant execute on function public.registrar_erro_rascunho_requisicao(uuid,text) to authenticated;
revoke all on function public.registrar_envio_requisicao(uuid,text,text) from public,anon,authenticated;
revoke all on function public.submeter_requisicao(uuid),public.aprovar_requisicao(uuid),public.rejeitar_requisicao(uuid,text,text),public.requisicao_aprovacao_cc(uuid),public.requisicoes_fila_aprovacao(),public.salvar_rateio_requisicao(uuid,jsonb) from public,anon;
grant execute on function public.submeter_requisicao(uuid),public.aprovar_requisicao(uuid),public.rejeitar_requisicao(uuid,text,text),public.requisicao_aprovacao_cc(uuid),public.requisicoes_fila_aprovacao(),public.salvar_rateio_requisicao(uuid,jsonb) to authenticated;

-- Contrato exclusivo do gateway: reivindicação atômica, sem liberar por timeout.
create or replace function public.iniciar_envio_requisicao(p_req_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $iniciar$
declare v_req compras_requisicoes; v_token uuid; v_login text; v_admin boolean;
begin
 if p_user_id is null then raise exception 'SEM_PERMISSAO'; end if;
 select * into v_req from compras_requisicoes where id=p_req_id for update;
 if not found then raise exception 'NAO_ENCONTRADA'; end if;
 v_admin:=coalesce((select is_admin from profiles where user_id=p_user_id),false);
 if not coalesce((v_admin or (v_req.requisitante_user_id=p_user_id and
   (public.user_has_permission(p_user_id,'compras.requisicoes.reenviar_own') or
    (v_req.tentativa_envio_em is null and public.user_has_permission(p_user_id,'compras.requisicoes.create'))))
   or exists(select 1 from compras_requisicoes_aprovacao_grupos g where g.requisicao_id=p_req_id and public.req_lider_cc(p_user_id,g.codigo_centro_ctrl))),false) then raise exception 'SEM_PERMISSAO'; end if;
 if v_req.status<>'aprovada' or v_req.aprovacao_submetida_em is null or v_req.numero_alvo is not null
   or not exists(select 1 from compras_requisicoes_aprovacao_grupos where requisicao_id=p_req_id)
   or exists(select 1 from compras_requisicoes_aprovacao_grupos where requisicao_id=p_req_id and aprovado_em is null and dispensa_sem_lider_em is null) then raise exception 'APROVACAO_INCOMPLETA'; end if;
 if v_req.envio_token is not null then raise exception 'ENVIO_EM_ANDAMENTO_OU_INCERTO: reconciliar antes de tentar novamente'; end if;
 select nullif(btrim(alvo_usuario),'') into v_login from profiles where user_id=p_user_id;
 if v_login is null then
   v_login:='PEDRO.SCRIGNOLI';
   insert into compras_requisicoes_auditoria(requisicao_id,evento,user_id,payload_enviado,sucesso) values(p_req_id,'login_servico_provisorio',p_user_id,jsonb_build_object('login',v_login),true);
 end if;
 if v_login !~ '^[A-Z0-9][A-Z0-9._-]*$' then raise exception 'LOGIN_ALVO_INVALIDO'; end if;
 v_token:=gen_random_uuid();
 update compras_requisicoes set envio_token=v_token,tentativa_envio_em=now(),erro_ultimo_envio=null where id=p_req_id;
 insert into compras_requisicoes_auditoria(requisicao_id,evento,user_id,payload_enviado,sucesso)
 values(p_req_id,'envio_reivindicado',p_user_id,jsonb_build_object('token',v_token,'codigo_usuario',v_login),true);
 return jsonb_build_object('token',v_token,'codigo_usuario',v_login,'requisicao',to_jsonb(v_req),
   'itens',(select jsonb_agg(to_jsonb(i) order by i.sequencia,i.id) from compras_requisicoes_itens i where i.requisicao_id=p_req_id),
   'rateio',coalesce((select jsonb_agg(to_jsonb(cl)||jsonb_build_object('ccs',
     (select jsonb_agg(to_jsonb(c) order by c.id) from compras_requisicoes_rateio_cc c where c.rateio_classe_id=cl.id)) order by cl.id)
     from compras_requisicoes_rateio_classes cl where cl.requisicao_id=p_req_id),'[]'::jsonb),
   'arquivos',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from compras_requisicoes_arquivos a where a.requisicao_id=p_req_id),'[]'::jsonb));
end;
$iniciar$;

create or replace function public.concluir_envio_requisicao(p_req_id uuid,p_token uuid,p_numero text,p_erro text,p_falha_definitiva boolean default false)
returns text language plpgsql security definer set search_path=public
as $concluir$
declare v_req compras_requisicoes;
begin
 select * into v_req from compras_requisicoes where id=p_req_id for update;
 if not found or p_token is null or v_req.envio_token is distinct from p_token then raise exception 'TENTATIVA_INVALIDA'; end if;
 if v_req.numero_alvo is not null then
   if v_req.numero_alvo=p_numero then return 'SINCRONIZADA'; end if;
   raise exception 'JA_ENVIADA';
 end if;
 if nullif(btrim(p_numero),'') is not null then
   update compras_requisicoes set numero_alvo=btrim(p_numero),status='sincronizada',enviado_em=now(),erro_ultimo_envio=null,updated_at=now() where id=p_req_id;
   update compras_requisicoes_arquivos set numero_alvo_ao_enviar=btrim(p_numero) where requisicao_id=p_req_id;
 else
   update compras_requisicoes set erro_ultimo_envio=coalesce(p_erro,'Envio incerto: reconciliar com o ERP'),
     envio_token=case when p_falha_definitiva then null else envio_token end,updated_at=now() where id=p_req_id;
 end if;
 insert into compras_requisicoes_auditoria(requisicao_id,evento,resposta_alvo,sucesso,mensagem_erro)
 values(p_req_id,case when nullif(btrim(p_numero),'') is not null then 'envio_pos_aprovacao_sucesso' else 'envio_pos_aprovacao_falha' end,
   jsonb_build_object('token',p_token,'numero_alvo',p_numero,'falha_definitiva',p_falha_definitiva),nullif(btrim(p_numero),'') is not null,p_erro);
 return case when nullif(btrim(p_numero),'') is not null then 'SINCRONIZADA' else 'ERRO_REGISTRADO' end;
end;
$concluir$;
revoke all on function public.iniciar_envio_requisicao(uuid,uuid),public.concluir_envio_requisicao(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.iniciar_envio_requisicao(uuid,uuid),public.concluir_envio_requisicao(uuid,uuid,text,text,boolean) to service_role;

notify pgrst,'reload schema';
commit;
