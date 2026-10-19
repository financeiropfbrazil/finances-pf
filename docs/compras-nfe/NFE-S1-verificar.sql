-- NFE-S1 — conferência (somente leitura; os testes de usuário rodam numa transação desfeita no fim)

-- 1. Objeto, SECURITY DEFINER e ACL (não pode aparecer anon=X)
select p.oid::regprocedure, p.prosecdef, p.proacl
from pg_proc p where p.oid = to_regprocedure('public.compras_nfe_no_alvo(date,date)');

-- 2. Como admin (troque o uuid pelo do admin): total do período e quantas achadas por fonte.
--    Referência de 19/10/2026 sobre as 932 NF-e: 793 achadas (14 chave, 738 contas a pagar, 9 despesas, 32 intercompany).
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-ADMIN>', 'role', 'authenticated')::text, true);
select fonte, count(*) from public.compras_nfe_no_alvo('2020-01-01', '2030-12-31') group by 1 order by 2 desc;
rollback;

-- 3. Como usuário sem admin e sem a permissão legada "compras": deve dar 42501.
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-SEM-PERMISSAO>', 'role', 'authenticated')::text, true);
select count(*) from public.compras_nfe_no_alvo('2026-10-01', '2026-10-31');
rollback;

-- ── Resultado da aplicação (19/10/2026, via MCP apply_migration "nfe_s1_compras_nfe_no_alvo") ──
-- 1. prosecdef = true · proacl = {postgres=X, authenticated=X, service_role=X} (sem anon)
-- 2. admin, todas as datas: 793 de 932 achadas — Contas a pagar do Alvo 738 · Intercompany 32 · chave de acesso 14 · Despesas 9.
--    As 139 não encontradas: 65 de out/2026 (ainda não digitadas) e a maioria das demais com natureza de remessa/retorno/bonificação.
-- 3. usuário sem admin e sem "compras": ERROR 42501 "Sem permissão para Notas Fiscais"
-- 4. role anon: ERROR 42501 "permission denied for function compras_nfe_no_alvo"
