-- PAP-2 — conferência. As regras (só leitura):
select tablename, policyname, cmd, roles::text, qual, with_check
from pg_policies where schemaname = 'public' and tablename in ('profiles', 'user_permissions') order by tablename, cmd;
-- esperado: profiles_ler (SELECT true) · profiles_admin_criar (INSERT, _is_admin) · profiles_admin_alterar (UPDATE, _is_admin)
--           user_permissions_ler (SELECT própria linha ou admin) · user_permissions_admin_gravar (ALL, _is_admin)

-- Teste como usuário — tudo dentro de begin … rollback (nada fica gravado). Tem UPDATE/DELETE: o MCP pede confirmação.
begin;
create temp table _u as select email, user_id from profiles where email in ('mirlene.oliveira@pfbrazil.com', 'pedro.scrignoli@pfbrazil.com', 'hugo.maffei@pfbrazil.com');
create temp table _r (quem text, caso text, resultado text);
grant select on _u to authenticated; grant insert on _r to authenticated;
do $$
declare
  u record; n int; hugo uuid;
begin
  select user_id into hugo from _u where email like 'hugo%';
  for u in select * from _u where email not like 'hugo%' loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into n from public.profiles;                                   insert into _r values (u.email, '1 ler perfis', n::text);
    update public.profiles set full_name = full_name where user_id = u.user_id;  get diagnostics n = row_count; insert into _r values (u.email, '2 alterar o próprio nome', n || ' linha(s)');
    update public.profiles set full_name = 'Fulano' where user_id = hugo;        get diagnostics n = row_count; insert into _r values (u.email, '3 trocar o nome do Hugo', n || ' linha(s)');
    update public.profiles set alvo_usuario = 'X' where user_id = hugo;          get diagnostics n = row_count; insert into _r values (u.email, '4 trocar usuário do Alvo do Hugo', n || ' linha(s)');
    delete from public.profiles where user_id = hugo;                            get diagnostics n = row_count; insert into _r values (u.email, '5 apagar o perfil do Hugo', n || ' linha(s)');
    begin
      insert into public.profiles (user_id, email, full_name, is_admin, is_active)
      values (hugo, 'hugo.maffei@pfbrazil.com', 'Hugo', false, true)
      on conflict (user_id) do update set full_name = excluded.full_name, updated_at = now();
      get diagnostics n = row_count; insert into _r values (u.email, '6 upsert como a tela de Usuários', n || ' linha(s)');
    exception when others then insert into _r values (u.email, '6 upsert como a tela de Usuários', sqlstate || ' ' || left(sqlerrm, 70)); end;
    begin
      insert into public.profiles (user_id, email, full_name) values (gen_random_uuid(), 'novo@x', 'Novo');
      insert into _r values (u.email, '7 criar perfil novo', 'passou');
    exception when others then insert into _r values (u.email, '7 criar perfil novo', sqlstate || ' ' || left(sqlerrm, 70)); end;
    begin
      perform public.hub_clear_must_change_password();
      insert into _r values (u.email, '8 troca de senha obrigatória (RPC)', 'passou');
    exception when others then insert into _r values (u.email, '8 troca de senha obrigatória (RPC)', sqlstate || ' ' || left(sqlerrm, 70)); end;
    select count(*) into n from public.user_permissions;                           insert into _r values (u.email, '9 ler user_permissions', n::text);
    begin
      insert into public.user_permissions (user_id, menu_key, allowed) values (u.user_id, 'contas_pagar', true);
      insert into _r values (u.email, '10 se dar menu antigo (contas_pagar)', 'passou');
    exception when others then insert into _r values (u.email, '10 se dar menu antigo (contas_pagar)', sqlstate || ' ' || left(sqlerrm, 70)); end;
    execute 'reset role';
  end loop;
end $$;
select * from _r order by quem, (split_part(caso, ' ', 1))::int;
rollback;
-- esperado Mirlene: 1 = todos · 2 a 5 = 0 linha(s) · 6 e 7 = 42501 · 8 passou · 9 = 0 · 10 = 42501
-- esperado Pedro:   1 = todos · 2 a 4 = 1 linha(s) · 5 = 0 linha(s) (ninguém apaga) · 6 = 1 linha(s) · 7 passou · 8 passou · 9 = 0 · 10 passou
