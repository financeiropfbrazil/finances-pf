begin;
set local lock_timeout='5s';
lock table public.compras_requisicoes in share row exclusive mode;
do $$ begin
 if exists(select 1 from public.compras_requisicoes where status in ('pendente_aprovacao','aprovada','pendente_envio','erro_envio')) then
  raise exception 'PARAR: há requisições em transição';
 end if;
 if exists(select 1 from public.compras_requisicoes r join lateral (
  select evento from public.compras_requisicoes_auditoria where requisicao_id=r.id
  and evento in ('envio_tentado','envio_sucesso','envio_falha','envio_pos_aprovacao_sucesso','envio_pos_aprovacao_falha')
  order by created_at desc limit 1
 ) a on true where nullif(btrim(r.numero_alvo),'') is null
 and a.evento in ('envio_tentado','envio_sucesso','envio_pos_aprovacao_sucesso')) then
  raise exception 'PARAR: há envio sem confirmação';
 end if;
end $$;
create function public.req_implantacao_suspensa() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is not null or current_setting('role',true)='service_role' then
  raise exception 'Criação/envio temporariamente suspensos para implantação multi-CC.';
 end if;
 return new;
end $$;
revoke all on function public.req_implantacao_suspensa() from public,anon,authenticated,service_role;
create trigger trg_req_implantacao_suspensa before insert or update on public.compras_requisicoes
for each row execute function public.req_implantacao_suspensa();
update public.sync_settings set enabled=false,paused_at=now(),paused_by='0b52e262-2fd2-4e84-b414-456b8eb6df65',
 paused_reason='Implantação multi-CC autorizada; manter pausado até aceite',updated_at=now()
where job_name='sync-compras-status-cron';
select cron.alter_job(1,active:=false);
commit;
