begin;
set local lock_timeout='5s';
create table public.compras_requisicoes_janela (
 id boolean primary key default true check(id),
 modo text not null check(modo in ('fechada','aceite','aberta')),
 usuarios uuid[] not null default '{}',
 iniciada_em timestamptz not null default now(),
 atualizada_em timestamptz not null default now()
);
alter table public.compras_requisicoes_janela enable row level security;
revoke all on public.compras_requisicoes_janela from public,anon,authenticated,service_role;
insert into public.compras_requisicoes_janela(id,modo) values(true,'fechada');

create function public.req_janela_permite(p_user uuid) returns boolean
language sql stable security definer set search_path=public
as $$ select coalesce((select modo='aberta' or (modo='aceite' and p_user=any(usuarios))
 from compras_requisicoes_janela where id),false) $$;
revoke all on function public.req_janela_permite(uuid) from public,anon,authenticated,service_role;

create function public.req_janela_guard() returns trigger
language plpgsql security definer set search_path=public
as $$
declare v_uid uuid:=auth.uid(); v_modo text;
begin
 select modo into v_modo from compras_requisicoes_janela where id;
 if v_uid is not null then
  if not req_janela_permite(v_uid) then
   raise exception 'Criação e envio de requisições suspensos para implantação/aceite multi-CC.';
  end if;
  if v_modo='aceite' and (new.descricao not like 'ACEITE-MULTICC-%' or new.descricao is null) then
   raise exception 'Operação restrita ao aceite: identifique a requisição com ACEITE-MULTICC-.';
  end if;
 elsif tg_op='INSERT' and current_setting('role',true)='service_role' and v_modo<>'aberta' then
  raise exception 'Sincronização de requisições suspensa durante o aceite multi-CC.';
 end if;
 return new;
end $$;
revoke all on function public.req_janela_guard() from public,anon,authenticated,service_role;
create trigger trg_req_janela before insert or update on public.compras_requisicoes
for each row execute function public.req_janela_guard();

-- Preserva o contrato revisto; o corpo fica privado e a entrada mantém a mesma ACL.
alter function public.iniciar_envio_requisicao(uuid,uuid) rename to req_iniciar_envio_sem_janela;
revoke all on function public.req_iniciar_envio_sem_janela(uuid,uuid) from public,anon,authenticated,service_role;
create function public.iniciar_envio_requisicao(p_req_id uuid,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
begin
 if not req_janela_permite(p_user_id) then
  raise exception 'Envio suspenso para implantação/aceite multi-CC.';
 end if;
 if (select modo='aceite' from compras_requisicoes_janela where id) and not exists(
  select 1 from compras_requisicoes r,compras_requisicoes_janela j
  where r.id=p_req_id and r.requisitante_user_id=any(j.usuarios)
  and r.created_at>=j.iniciada_em and r.descricao like 'ACEITE-MULTICC-%'
 ) then raise exception 'Envio restrito a requisições novas identificadas para o aceite multi-CC.'; end if;
 return req_iniciar_envio_sem_janela(p_req_id,p_user_id);
end $$;
revoke all on function public.iniciar_envio_requisicao(uuid,uuid) from public,anon,authenticated;
grant execute on function public.iniciar_envio_requisicao(uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
