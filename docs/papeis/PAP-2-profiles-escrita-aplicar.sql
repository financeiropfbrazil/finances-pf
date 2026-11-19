-- =====================================================================
-- PAP-2 — fechar a escrita em profiles e user_permissions (PLANO-PAPEIS.md) — 12/11/2026
-- Projeto: hbtggrbauguukewiknew. Ordem do Pedro (12/11): "ok, aplique o 2º".
--
-- Problema: as duas tabelas tinham a policy "Allow all for authenticated" (ALL, true/true): qualquer logado podia,
-- pela API, apagar o perfil de outra pessoa (inclusive o do admin — e o is_admin mora no perfil), trocar nome, usuário
-- do Alvo e "troca de senha obrigatória" de outra pessoa. O gatilho profiles_guard_privilegios já barrava is_admin,
-- is_active, user_id e email — continua valendo.
--
-- Depois:
--   profiles         ler: todos os logados (as telas mostram nomes) · criar/alterar: só admin · apagar: ninguém pela API
--   user_permissions ler: a própria linha (admin lê tudo)             · gravar: só admin
-- Quem grava hoje e continua funcionando: tela de Usuários (só admin, upsert); troca de senha obrigatória (RPC
-- hub_clear_must_change_password, SECURITY DEFINER); Edges de convite/criação (chave de serviço).
-- Rollback: PAP-2-profiles-escrita-rollback.sql.
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles') <> 1
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
                     and policyname = 'Allow all for authenticated on profiles' and cmd = 'ALL' and qual = 'true')
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'user_permissions') <> 1
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_permissions'
                     and policyname = 'Allow all for authenticated on user_permissions' and cmd = 'ALL' and qual = 'true') then
    raise exception 'As policies de profiles/user_permissions não são as esperadas — revisar antes de aplicar';
  end if;
end $$;

-- profiles
drop policy "Allow all for authenticated on profiles" on public.profiles;
create policy profiles_ler on public.profiles
  for select to authenticated using (true);
create policy profiles_admin_criar on public.profiles
  for insert to authenticated with check ((select public._is_admin()));
create policy profiles_admin_alterar on public.profiles
  for update to authenticated using ((select public._is_admin())) with check ((select public._is_admin()));
-- sem policy de DELETE: ninguém apaga perfil pela API

-- user_permissions (permissões de menu do sistema antigo; vazia em 12/11/2026)
drop policy "Allow all for authenticated on user_permissions" on public.user_permissions;
create policy user_permissions_ler on public.user_permissions
  for select to authenticated using (user_id = (select auth.uid()) or (select public._is_admin()));
create policy user_permissions_admin_gravar on public.user_permissions
  for all to authenticated using ((select public._is_admin())) with check ((select public._is_admin()));
