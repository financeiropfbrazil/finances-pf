-- NFE-8 — conferência (só leitura)
select md5(prosrc) from pg_proc where oid = 'public.nfe_relatorio_etapas(date,date)'::regprocedure;
-- esperado: 1a0025af69d85fd6f1198077da953e33

select p.proacl::text, p.prosecdef,
       has_function_privilege('anon', 'public.nfe_alvo_espelho_desde()', 'execute') anon,
       has_function_privilege('authenticated', 'public.nfe_alvo_espelho_desde()', 'execute') autenticado
from pg_proc p where p.oid = 'public.nfe_alvo_espelho_desde()'::regprocedure;
-- esperado: {postgres=X,authenticated=X,service_role=X} · true · anon false · autenticado true

-- Como Hugo (Analista Fiscal, sem admin): data do espelho e etapas do Excel de jan–nov
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.nfe_alvo_espelho_desde() espelho_desde;   -- 2026-01-01
select x->>'etapa_atual' etapa, count(*) n, count(*) filter (where x->>'dias_em_aberto' is not null) com_dias_em_aberto
from jsonb_array_elements(public.nfe_relatorio_etapas('2026-01-01', '2026-11-30')->'linhas') x
group by 1 order by 1;
rollback;

-- Como Mirlene (sem Analista Fiscal): 42501 nas duas
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'mirlene.oliveira@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.nfe_alvo_espelho_desde();
rollback;
