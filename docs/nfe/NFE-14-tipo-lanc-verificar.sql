-- NFE-14 — conferência (só leitura)
select proacl::text, prosecdef,
       has_function_privilege('anon', 'public.alvo_tipo_lanc(bigint[])', 'execute') anon
from pg_proc where oid = 'public.alvo_tipo_lanc(bigint[])'::regprocedure;
-- esperado: {postgres=X,authenticated=X,service_role=X} · true · false

-- Como Hugo (Analista Fiscal): tipos dos lançamentos de outubro
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select codigo_tipo_lanc, descricao, count(*)
from public.alvo_tipo_lanc((select array_agg(chave_movestq) from public.rastreio_nf where data_emissao between '2026-10-01' and '2026-10-31'))
group by 1, 2 order by 3 desc;
rollback;

-- Como Mirlene (Operador de Compras — vê a NFS-e): passa; usuário sem nenhum dos dois papéis: 42501
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'mirlene.oliveira@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select count(*) from public.alvo_tipo_lanc(array[21731, 22056]::bigint[]);   -- 2
rollback;
