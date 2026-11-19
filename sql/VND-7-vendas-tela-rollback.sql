-- Rollback do VND-7 (sql/VND-7-vendas-tela.sql). Só com ordem do Pedro.
-- A tela some junto (o front recebe "Sem permissão" / função inexistente); reverter também o commit do front.
drop function if exists public.vendas_itens_listar(date, date, text, text[], text[], text[], boolean);
drop function if exists public.vendas_nota_detalhe(uuid);
drop function if exists public.vendas_notas_listar(date, date, text, text[], text[], text[], boolean, integer, integer);
drop function if exists public._vendas_notas_filtradas(date, date, text, text[], text[], text[], boolean);
-- Papel e permissão: só se ninguém recebeu o papel (senão, revogar antes pela tela de usuários).
delete from public.hub_role_permissions rp
 using public.hub_roles r, public.hub_permissions p
 where rp.role_id = r.id and rp.permission_id = p.id and r.codigo = 'visualizador_vendas' and p.codigo = 'vendas.notas.access'
   and not exists (select 1 from public.hub_user_roles ur where ur.role_id = r.id and ur.revogado_em is null);
delete from public.hub_roles r where r.codigo = 'visualizador_vendas'
   and not exists (select 1 from public.hub_user_roles ur where ur.role_id = r.id);
delete from public.hub_permissions p where p.codigo = 'vendas.notas.access'
   and not exists (select 1 from public.hub_role_permissions rp where rp.permission_id = p.id);
