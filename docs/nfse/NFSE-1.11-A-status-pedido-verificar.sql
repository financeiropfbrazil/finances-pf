-- NFSE-1.11-A — conferência (só leitura)

-- 1. Corpo novo, ACL intacto (sem anon), SECURITY DEFINER
select md5(prosrc) as md5, proacl::text as acl, prosecdef
from pg_proc where oid = 'public.nfse_recebida_detalhe(text)'::regprocedure;
-- esperado: md5 52a3404811361e0e5c74149e19aff966 · {postgres=X,authenticated=X,service_role=X} · true

-- 2. Como Operador de Compras sem admin: os 6 eixos do Alvo chegam em vinculados e candidatos
begin;
select set_config('request.jwt.claims', json_build_object('sub', '41b07a68-8576-4699-b905-374604edd158', 'role', 'authenticated')::text, true);
set local role authenticated;
select 'candidato' as tipo, c->>'numero' as numero, c->>'status' as status, c->>'aprovado' as aprovado,
       c->>'status_aprovacao' as status_aprovacao, c->>'enviou_aprovacao' as enviou, c->>'comprado' as comprado,
       c->>'proximo_aprovador' as proximo, c->>'status_local' as status_local
from jsonb_array_elements(public.nfse_recebida_detalhe('35498051221383007000100000000001606326104710803864')->'pedidos'->'candidatos') c
union all
select 'vinculado', v->>'numero', v->>'status', v->>'aprovado', v->>'status_aprovacao', v->>'enviou_aprovacao',
       v->>'comprado', v->>'proximo_aprovador', v->>'status_local'
from jsonb_array_elements(public.nfse_recebida_detalhe('35503081208933911000183000000005408326101225329776')->'pedidos'->'vinculados') v;
rollback;

-- 3. Amostra: 1º candidato das 30 NFS-e não lançadas mais recentes (limite de 45 s — as 209 de uma vez passam de 60 s)
begin;
set local statement_timeout = '45s';
select set_config('request.jwt.claims', json_build_object('sub', '41b07a68-8576-4699-b905-374604edd158', 'role', 'authenticated')::text, true);
create temp table _chaves on commit drop as
  select chave_acesso from public.v_nfse_recebida where situacao_alvo = 'nao_lancada' and situacao_fisco = 'normal'
  order by data_emissao desc limit 30;
grant select on _chaves to authenticated;
set local role authenticated;
with d as (select public.nfse_recebida_detalhe(chave_acesso)->'pedidos'->'candidatos'->0 as c1 from _chaves)
select case when c1 is null then 'sem candidato'
            when c1->>'aprovado' = 'Total' and c1->>'status_aprovacao' = 'Finalizada' then '1º candidato 100% aprovado'
            else '1º candidato NÃO aprovado' end as situacao,
       coalesce(c1->>'status', '—') as status_alvo, count(*) as notas
from d group by 1, 2 order by 1, 3 desc;
rollback;

-- ── Resultado (20/10/2026) ──
-- Aplicado pelo MCP (migration nfse_1_11_a_status_pedido), pré-voo ok (fingerprint 2.312, md5 anterior fd50a0b1…).
-- 1. md5 52a3404811361e0e5c74149e19aff966; ACL {postgres,authenticated,service_role}; security definer — ok.
-- 2. Operador sem admin: NFS-e 16063 (Rio Ponto) → 0005125 Reavaliar/Não/Nenhum/enviou Não/comprado Não e
--    0002864 Encerrado/Total/Finalizada/comprado Sim; ELUS 54083 → vinculado 0004727 Encerrado/Total/Finalizada/
--    enviou Sim/comprado Sim (próximo aprovador ainda preenchido no Alvo). Todos com status_local sincronizado.
-- 3. 30 não lançadas mais recentes: 12 com 1º candidato 100% aprovado (Pendente 7, Aberto 4, Encerrado 1),
--    1 com 1º candidato não aprovado (Reavaliar), 17 sem candidato.
-- Censo de compras_pedidos (sem rascunho): Aprovado='Total' só aparece com StatusAprovacao='Finalizada';
--   há Encerrado sem aprovação (5) e Cancelado/Cancelado Parcial com aprovação total (25) — status ≠ aprovação.
