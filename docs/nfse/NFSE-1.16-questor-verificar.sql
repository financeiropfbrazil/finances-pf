-- NFSE-1.16 — conferência (só leitura)
select p.oid::regprocedure, p.proacl::text, p.prosecdef, md5(p.prosrc) from pg_proc p where p.proname = 'nfse_relatorio_questor';
-- esperado: {postgres=X,authenticated=X,service_role=X} · true · 91ee4673a250c5f1de96eab3fb352a19

select (select count(*) from public.questor_natureza) naturezas,            -- 45
       (select count(*) from public.questor_natureza_classe) classes,       -- 74
       (select count(*) from public.questor_natureza_classe where observacao is not null) provisorias,  -- 30
       has_table_privilege('authenticated', 'public.questor_natureza_classe', 'select') auth_le,      -- false
       has_function_privilege('anon', 'public.nfse_relatorio_questor(date, date)', 'execute') anon;   -- false

begin;
set local statement_timeout = '55s';
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table _r on commit drop as select public.nfse_relatorio_questor('2026-01-01', '2026-10-31') j;
select jsonb_array_length(j->'linhas') linhas,
  (select jsonb_object_agg(coalesce(o, '(sem classe)'), n)
     from (select x->>'classe_origem' o, count(*) n from jsonb_array_elements(j->'linhas') x group by 1) t) por_origem,
  (select count(*) from jsonb_array_elements(j->'linhas') x where x->>'natureza' is not null) com_natureza,
  (select count(*) from jsonb_array_elements(j->'linhas') x where x->>'classe' is not null and x->>'natureza' is null) classe_sem_de_para
from _r;
rollback;

-- ── Resultado (30/10/2026) ──
-- Aplicado (migration nfse_1_16_questor_natureza). Hugo, jan–out/2026: 1.328 notas; classe pelo DocFin 120, pelo pedido
-- 593, pelo fornecedor 192, sem classe 423; 859 com natureza; 46 com classe sem de/para (21.14 Terceiros – outros 27,
-- 14.08 Consultoria comercial 11, 8 classes com 1 nota). Lançadas e normais no fisco: 806 de 1.092 com natureza
-- (outubro: 63 de 90). Mirlene (Operador de Compras) passa; usuário sem papel 42501; authenticated lendo a tabela →
-- permission denied; anon sem EXECUTE. Parte de leitura medida antes de aplicar: 832 ms para jan–out.
