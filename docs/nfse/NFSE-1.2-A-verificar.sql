-- NFSE-1.2-A — conferência (somente leitura)
-- 1. Antes de 2026 não sobra "nao_lancada"; de 2026 em diante os números não mudam (19/10: 2026-T1 47 · T2 58 · T3 59 não lançadas)
select to_char(date_trunc('quarter', data_emissao), 'YYYY-"T"Q') trimestre, count(*) nfse,
       count(*) filter (where situacao_alvo = 'nao_lancada') nao_lancada,
       count(*) filter (where situacao_alvo = 'sem_dado_alvo') sem_dado,
       count(*) filter (where situacao_alvo like 'lancada%') lancadas
from public.v_nfse_recebida group by 1 order by 1;
-- 2. Opções da view preservadas (security_invoker=on) e ACL sem anon/authenticated
select reloptions, relacl from pg_class where oid = 'public.v_nfse_recebida'::regclass;
select proacl from pg_proc where proname = 'nfse_recebidas_listar';

-- ── Resultado (20/10/2026, MCP apply_migration "nfse_1_2_a_sem_dado_alvo") ──
-- 2023-T3 a 2025-T3: 0 não lançada, 195 sem dado · 2025-T4: 0 não lançada, 35 sem dado, 5 lançadas
-- 2026-T1/T2/T3: 47/58/59 não lançadas (iguais à 1.2) · 0 sem dado em 2026
-- reloptions = {security_invoker=on}; ACL da view e da RPC iguais às de antes (sem anon).
