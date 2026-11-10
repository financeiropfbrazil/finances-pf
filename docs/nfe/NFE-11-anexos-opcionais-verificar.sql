-- NFE-11 — conferência (só leitura)
select md5(prosrc), proacl::text from pg_proc where oid = 'public.nfe_relatorio_etapas(date,date)'::regprocedure;
-- esperado: 27bc3432cd2b07c6287ab75ef5926747 · {postgres=X,authenticated=X,service_role=X}

-- Como Hugo (Analista Fiscal, sem admin): etapas do Excel de jan–nov — nenhuma em "4 · PDF da nota" / "5 · Boleto"
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
select x->>'etapa_atual' etapa, count(*) n
from jsonb_array_elements(public.nfe_relatorio_etapas('2026-01-01', '2026-11-30')->'linhas') x
group by 1 order by 1;
rollback;
