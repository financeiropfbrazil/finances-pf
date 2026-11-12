-- PAP-2 — rollback (só com ordem do Pedro): volta as duas tabelas para "liberado para todos os logados".
drop policy if exists profiles_ler on public.profiles;
drop policy if exists profiles_admin_criar on public.profiles;
drop policy if exists profiles_admin_alterar on public.profiles;
create policy "Allow all for authenticated on profiles" on public.profiles
  for all to authenticated using (true) with check (true);

drop policy if exists user_permissions_ler on public.user_permissions;
drop policy if exists user_permissions_admin_gravar on public.user_permissions;
create policy "Allow all for authenticated on user_permissions" on public.user_permissions
  for all to authenticated using (true) with check (true);
