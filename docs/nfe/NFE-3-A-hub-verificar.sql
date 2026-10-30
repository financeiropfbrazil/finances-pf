-- NFE-3-A — conferência (só leitura; o vínculo de teste roda dentro de begin … rollback)

-- 1. Corpo novo, ACL intacto
select md5(prosrc) md5, proacl::text acl from pg_proc where oid = 'public.nfe_recebida_detalhe(uuid)'::regprocedure;
-- esperado: md5 a3efe598e912cb4d723b0003dad93c93 · {postgres=X,authenticated=X,service_role=X}

-- 2. Cenário da pergunta do Pedro: NF-e 7750 (DIP, R$ 316,90) tem o 0005190 como candidato; vincular o 0005190 no Hub
--    a outra nota de valor parecido tira o pedido da lista da 7750. Tudo desfeito no rollback.
begin;
set local statement_timeout = '50s';
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table _r on commit drop as
select 'antes'::text fase, (select string_agg((c->>'numero') || ' saldo ' || (c->>'saldo'), ' | ')
  from jsonb_array_elements(public.nfe_recebida_detalhe('f6a6337b-937a-4cfa-a4f7-368016e9dae5')->'pedidos'->'candidatos') c) cand;
insert into _r select 'vincula', (public.compras_nfe_vincular_pedidos(
  (select c.id from public.compras_nfe c where c.id <> 'f6a6337b-937a-4cfa-a4f7-368016e9dae5' and c.status_lancamento = 'pendente'
     and c.valor_total between 300 and 340 order by c.data_emissao desc limit 1),
  '[{"numero":"0005190","codigo_empresa_filial":"1.01"}]'::jsonb))->>'success';
insert into _r select 'depois', coalesce((select string_agg((c->>'numero') || ' saldo ' || (c->>'saldo'), ' | ')
  from jsonb_array_elements(public.nfe_recebida_detalhe('f6a6337b-937a-4cfa-a4f7-368016e9dae5')->'pedidos'->'candidatos') c), '(nenhum candidato)');
select * from _r;
rollback;

-- ── Resultado (30/10/2026) ──
-- Aplicado pelo MCP (migration nfe_3a_candidato_desconta_vinculo_hub), pré-voo ok (md5 anterior 0059fe2b…).
-- 1. md5 a3efe598e912cb4d723b0003dad93c93; ACL igual — ok.
-- 2. antes: 0005190 saldo 316,90 · vínculo no Hub à NF 1273 (R$ 311,40) · depois: nenhum candidato (sobram R$ 5,50).
--    Com uma nota de R$ 23 o saldo cai para 293,90 e o pedido continua (dentro de ±20%) — desconto proporcional ok.
-- 3. 14 notas mais recentes: candidatos iguais aos da NFE-3 onde não há vínculo no Hub; 52–192 ms.
