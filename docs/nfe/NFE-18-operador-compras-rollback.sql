-- NFE-18 — rollback. Só com ordem do Pedro. Reverter o commit da tela junto.
-- 1. As funções de vínculo voltam a exigir compras.nfe.create (nfe_pode_gravar)
do $$
declare f text; def text;
begin
  foreach f in array array['public.compras_nfe_vincular_pedidos(uuid,jsonb)', 'public.compras_nfe_desvincular(uuid)'] loop
    def := pg_get_functiondef(f::regprocedure);
    execute replace(def, 'public.nfe_pode_vincular()', 'public.nfe_pode_gravar()');
  end loop;
end $$;
-- md5 esperado depois: vincular 8add1957bed20c0692361db4ec0489fa · desvincular 5a6f25c1a4049a649ac4ac2596c29073
drop function if exists public.nfe_pode_vincular();
-- 2. Papéis e catálogo como antes
delete from public.hub_role_permissions rp
 using public.hub_roles r, public.hub_permissions p
 where rp.role_id = r.id and rp.permission_id = p.id and r.codigo = 'analista_compras'
   and p.codigo in ('compras.nfe.access', 'compras.nfe.create', 'compras.rastreio.access');
delete from public.hub_permissions where codigo = 'compras.nfe.vincular';   -- leva junto os vínculos dos papéis (ON DELETE CASCADE)
update public.hub_permissions set descricao = 'Cadastrar/extrair Notas Fiscais (NF-e)' where codigo = 'compras.nfe.create';
