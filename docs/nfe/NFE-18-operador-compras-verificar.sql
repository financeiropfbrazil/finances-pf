-- NFE-18 — conferência (só leitura; os testes ficam dentro de begin … rollback)
select r.codigo, string_agg(p.codigo, ', ' order by p.codigo) permissoes
from hub_roles r join hub_role_permissions rp on rp.role_id = r.id join hub_permissions p on p.id = rp.permission_id
where r.codigo in ('analista_compras', 'analista_fiscal', 'admin') and p.codigo in
      ('compras.nfe.access', 'compras.nfe.create', 'compras.nfe.vincular', 'compras.nfse.access', 'compras.rastreio.access')
group by r.codigo;
-- esperado: analista_compras = nfe.access, nfe.create, nfse.access, rastreio.access (SEM nfe.vincular)
--           analista_fiscal  = nfe.access, nfe.create, nfe.vincular, nfse.access

select p.oid::regprocedure, md5(pg_get_functiondef(p.oid)), has_function_privilege('anon', p.oid, 'execute') anon
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('compras_nfe_vincular_pedidos', 'compras_nfe_desvincular', 'nfe_pode_vincular');
-- 12/11/2026: vincular 6af93985…, desvincular 475a9d7a…, nfe_pode_vincular a3a61459…; anon false nas 3

-- Mirlene (Operador de Compras) × Hugo (Analista Fiscal) × alex (só Requisitante)
begin;
create temp table _u as select email, user_id from profiles where email in ('mirlene.oliveira@pfbrazil.com', 'hugo.maffei@pfbrazil.com', 'alex.silva@pfbrazil.com');
create temp table _n as select id from compras_nfe where data_emissao >= '2026-11-01' and status_lancamento is distinct from 'vinculada' order by data_emissao desc limit 1;
create temp table _r (quem text, caso text, resultado text);
grant select on _u, _n to authenticated; grant insert on _r to authenticated;
do $$
declare u record;
begin
  for u in select * from _u loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.user_id, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into _r values (u.email, 'acessar / gravar / vincular',
      public.nfe_pode_acessar()::text || ' / ' || public.nfe_pode_gravar()::text || ' / ' || public.nfe_pode_vincular()::text);
    begin
      perform public.compras_nfe_vincular_pedidos((select id from _n), '[{"numero":"0004669"}]'::jsonb);
      insert into _r values (u.email, 'vincular', 'passou');
    exception when others then insert into _r values (u.email, 'vincular', sqlstate); end;
    execute 'reset role';
  end loop;
end $$;
select * from _r order by quem, caso;
rollback;
-- esperado: Mirlene true/true/false e vincular 42501 · Hugo true/true/true e passou · alex false/false/false e 42501
