-- NFSE-1.15 — conferência (só leitura)
select p.oid::regprocedure, p.proacl::text, p.prosecdef from pg_proc p where p.proname = 'nfse_relatorio_etapas';
-- esperado: {postgres=X,authenticated=X,service_role=X} · true

begin;
set local statement_timeout = '55s';
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
with r as (select public.nfse_relatorio_etapas('2026-01-01', '2026-10-31') j)
select jsonb_array_length(j->'linhas') linhas,
  (select count(*) from jsonb_array_elements(j->'linhas') x where (x->>'dias_pedido_emissao')::int < 0) nf_antes_do_pedido,
  (select jsonb_object_agg(e, n) from (select x->>'etapa_atual' e, count(*) n from jsonb_array_elements(j->'linhas') x group by 1) t) etapas
from r;
rollback;

-- ── Resultado (30/10/2026) ──
-- Aplicado (migration nfse_1_15_relatorio_etapas). Hugo, jan–out/2026: 1.328 notas em 970 ms; 927 com pedido; 214
-- emitidas antes do pedido; 1.105 lançadas, 247 com data de digitação; etapas: 350 em 2·Pedidos, 923 em 4·PDF da nota,
-- 2 em 6·DocFin, 40 canceladas e 13 substituídas no fisco. Mirlene (Operador de Compras, tem Notas de Serviço): passa.
