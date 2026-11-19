-- NFE-17 — conferência (só leitura; tudo em begin … rollback). Rodar de novo se a regra das sugestões mudar no detalhe.
select p.oid::regprocedure, has_function_privilege('anon', p.oid, 'execute') anon,
       has_function_privilege('authenticated', p.oid, 'execute') authenticated
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('pedidos_aprovacao', 'nfse_pedidos_sugeridos', 'nfe_pedidos_sugeridos', '_nfse_texto_pedido');
-- esperado: anon false nas 4; authenticated false só no _nfse_texto_pedido

-- IGUALDADE com a tela (NFS-e): o lote × nfse_recebida_detalhe, nota a nota. O detalhe da NFS-e leva ~1,6 s:
-- no máximo ~27 notas por chamada (limit/offset). 11/11/2026: 53/53 com sugestão + 28/28 sem sugestão = iguais.
begin;
create temp table _u as select user_id from profiles where email = 'hugo.maffei@pfbrazil.com';
create temp table _k as select chave_acesso from v_nfse_recebida where data_emissao >= '2026-01-01';
create temp table _r (chave text, igual boolean, detalhe jsonb, lote jsonb);
grant select on _u, _k to authenticated; grant insert, select on _r to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from _u), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare lote jsonb; k text; d jsonb; l jsonb;
begin
  lote := public.nfse_pedidos_sugeridos(array(select chave_acesso from _k));
  for k in select e->>'chave_acesso' from jsonb_array_elements(lote) e order by 1 limit 27 offset 0 loop
    d := coalesce(public.nfse_recebida_detalhe(k)->'pedidos'->'candidatos', '[]'::jsonb);
    l := coalesce((select e->'candidatos' from jsonb_array_elements(lote) e where e->>'chave_acesso' = k), '[]'::jsonb);
    insert into _r values (k, d = l, case when d <> l then d end, case when d <> l then l end);
  end loop;
end $$;
reset role;
select count(*) comparadas, count(*) filter (where igual) iguais from _r;
rollback;

-- IGUALDADE com a tela (NF-e): o detalhe da NF-e leva ~0,17 s — ~260 notas por chamada.
-- 11/11/2026: as 1.038 NF-e de 2026 iguais (20 com sugestão + 1.018 sem).
begin;
create temp table _u as select user_id from profiles where email = 'hugo.maffei@pfbrazil.com';
create temp table _k as select id from compras_nfe where data_emissao >= '2026-01-01';
create temp table _r (id uuid, igual boolean);
grant select on _u, _k to authenticated; grant insert, select on _r to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from _u), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare lote jsonb; k uuid; d jsonb; l jsonb;
begin
  lote := public.nfe_pedidos_sugeridos(array(select id from _k));
  for k in select id from _k order by id limit 260 offset 0 loop
    d := coalesce(public.nfe_recebida_detalhe(k)->'pedidos'->'candidatos', '[]'::jsonb);
    l := coalesce((select e->'candidatos' from jsonb_array_elements(lote) e where (e->>'id')::uuid = k), '[]'::jsonb);
    insert into _r values (k, d = l);
  end loop;
end $$;
reset role;
select count(*) comparadas, count(*) filter (where igual) iguais from _r;
rollback;

-- Mirlene (Operador de Compras): aprovação e sugeridos da NFS-e passam; NF-e 42501; auxiliar interno negado
begin;
create temp table _u as select user_id from profiles where email = 'mirlene.oliveira@pfbrazil.com';
grant select on _u to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from _u), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.pedidos_aprovacao(array['0004317', '0004669']);
select public.nfse_pedidos_sugeridos(array['33045572205662679000106000000000025826112797837008']) -> 0 -> 'candidatos' -> 0 ->> 'numero';  -- 0004324
select public.nfe_pedidos_sugeridos(array['024d463f-8420-4899-870f-991d120126bb']::uuid[]);  -- 42501
rollback;
