-- NFE-6 — conferência (só leitura)
select p.oid::regprocedure, p.proacl::text, p.prosecdef from pg_proc p where p.proname = 'nfe_relatorio_etapas';
-- esperado: {postgres=X,authenticated=X,service_role=X} · true

begin;
set local statement_timeout = '55s';
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
with r as (select public.nfe_relatorio_etapas('2026-01-01', '2026-10-31') j)
select jsonb_array_length(j->'linhas') linhas,
  (select count(*) from jsonb_array_elements(j->'linhas') x where (x->>'dias_pedido_emissao')::int < 0) nf_antes_do_pedido,
  (select count(*) from jsonb_array_elements(j->'linhas') x where x->>'digitado_em' is not null) com_digitacao,
  (select jsonb_object_agg(e, n) from (select x->>'etapa_atual' e, count(*) n from jsonb_array_elements(j->'linhas') x group by 1) t) etapas
from r;
rollback;

-- ── Resultado (30/10/2026) ──
-- Aplicado (migration nfe_6_relatorio_etapas). Hugo, jan–out/2026: 974 notas em 239 ms; 701 com pedido; 93 emitidas
-- antes do pedido; 833 lançadas, 206 com data de digitação (out/2026: 66 de 78 — o Hub lê o MovEstq de todo título
-- novo desde 16/10); etapas: 170 em 2·Pedidos, 61 em 3·MovEstq, 743 em 4·PDF da nota. Mirlene: 42501.
-- Teste do Excel na tela (prévia com 4 linhas reais, busca "klinger"): RPC chamada com 01/10–31/10, arquivo com as 2
-- notas filtradas, 26 colunas em 6 blocos, digitação em horário de Brasília, −1 em vermelho, aba "Sobre" com filtro.
