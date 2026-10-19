-- NFSE-1.3 — conferência. Testes de usuário numa transação desfeita (claims simulados).

-- 1. SECURITY DEFINER e ACL sem anon
select p.oid::regprocedure, p.prosecdef, p.proacl
from pg_proc p where p.proname in ('nfse_recebidas_listar', 'nfse_recebida_xml');

-- 2. Operador de Compras SEM is_admin (papel analista_compras): lê.
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-OPERADOR-COMPRAS>', 'role', 'authenticated')::text, true);
select r->'total' total, r->'indicadores' indicadores, r->'atualizado_em' atualizado_em
from public.nfse_recebidas_listar('2026-09-01', '2026-09-30') r;
rollback;

-- 3. Usuário sem compras.nfse.access: 42501. 4. Role anon: permission denied.
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<UUID-SEM-PERMISSAO>', 'role', 'authenticated')::text, true);
select public.nfse_recebidas_listar('2026-09-01', '2026-09-30');
rollback;

-- ── Resultado da aplicação (19/10/2026, MCP apply_migration "nfse_1_2_v_nfse_recebida" + "nfse_1_3_rpcs_leitura") ──
-- 1. prosecdef = true nas duas; proacl = {postgres=X, authenticated=X, service_role=X} (sem anon)
-- 2. Operador de Compras sem is_admin (papel analista_compras), set/2026: total 142 · lançadas 119 · não lançadas 20
--    (todas há mais de 15 dias, R$ 72.844,13) · canceladas 3 · canceladas e lançadas 0 · atualizado_em = última run
--    nfse_adn (16/10 20:04 UTC). XML da 1ª nota: 6.025 caracteres. Filtro alvo=nao_lancada + fisco=normal → 20.
-- 3. Usuário sem compras.nfse.access → 42501 "Sem permissão para Notas de Serviço"
-- 4. role anon → permission denied for function; role authenticated lendo a view direto → permission denied for view
