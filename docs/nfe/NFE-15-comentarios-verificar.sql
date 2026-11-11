-- NFE-15 — conferência (só leitura; os testes de gravação ficam dentro de begin … rollback)
select relrowsecurity rls, (select count(*) from pg_policies where tablename = 'nota_comentario') policies,
       has_table_privilege('authenticated', 'public.nota_comentario', 'select') auth_le_direto,
       has_table_privilege('anon', 'public.nota_comentario', 'select') anon_le_direto
from pg_class where oid = 'public.nota_comentario'::regclass;
-- esperado: true · 0 · false · false
select p.oid::regprocedure, p.proacl::text,
       has_function_privilege('anon', p.oid, 'execute') anon
from pg_proc p where p.proname in ('nota_comentarios', 'nota_comentario_adicionar');
-- esperado: {postgres=X,authenticated=X,service_role=X} · anon false nas duas

-- Hugo (Analista Fiscal) comenta numa NF-e e lê; texto vazio e 281 caracteres recusados; clique duplo não duplica
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.nota_comentario_adicionar('nfe', (select chave_acesso from compras_nfe order by data_emissao desc limit 1), 'Conferir o boleto com o fornecedor.');
select public.nota_comentario_adicionar('nfe', (select chave_acesso from compras_nfe order by data_emissao desc limit 1), 'Conferir o boleto com o fornecedor.');
select public.nota_comentario_adicionar('nfe', (select chave_acesso from compras_nfe order by data_emissao desc limit 1), '   ');
select public.nota_comentario_adicionar('nfe', (select chave_acesso from compras_nfe order by data_emissao desc limit 1), repeat('x', 281));
select jsonb_array_length(public.nota_comentarios('nfe', (select chave_acesso from compras_nfe order by data_emissao desc limit 1)));  -- 1
rollback;

-- Mirlene (Operador de Compras): NFS-e passa; NF-e 42501
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'mirlene.oliveira@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.nota_comentario_adicionar('nfse', (select chave_acesso from nfse_adn_doc where tipo_documento = 'NFSE' order by nsu desc limit 1), 'Prestador avisou atraso no boleto.');
select public.nota_comentarios('nfe', (select chave_acesso from compras_nfe limit 1));   -- 42501
rollback;
