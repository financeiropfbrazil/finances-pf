-- NFSE-1.11-C — conferência (só leitura)

-- 1. Corpo novo, ACL intacto (sem anon), SECURITY DEFINER
select md5(prosrc) as md5, proacl::text as acl, prosecdef
from pg_proc where oid = 'public.nfse_recebida_detalhe(text)'::regprocedure;
-- esperado: md5 7610786c982f063f82a5d6eb01e46d00 · {postgres=X,authenticated=X,service_role=X} · true

-- 2. Como Operador de Compras sem admin: os casos da investigação
begin;
set local statement_timeout = '50s';
select set_config('request.jwt.claims', json_build_object('sub', '41b07a68-8576-4699-b905-374604edd158', 'role', 'authenticated')::text, true);
set local role authenticated;
with d(nome, chave) as (values
  ('Rio Ponto 16063', '35498051221383007000100000000001606326104710803864'),
  ('WT 1703', '41069022207454238000136000000000170326095394325913'),
  ('WT 1771', '41069022207454238000136000000000177126105289365636'),
  ('WT 1812', '41069022207454238000136000000000181226105652898408'),
  ('WT 1772', '41069022207454238000136000000000177226107870286332'),
  ('WT 1813', '41069022207454238000136000000000181326100415680380'),
  ('Microsoft 263262547', '35503081204712500000107000026326254726100722258050'),
  ('Strattner 30948', '35057081233250713000758000000003094826100952313272'),
  ('MEDLAB 142255', '35503081255405955000110000000014225526108870720223'),
  ('Previne 581', '35314072209554382000170000000000058126104924619455')),
r as (select nome, public.nfse_recebida_detalhe(chave) as j from d)
select nome, j->'nota'->>'valor_servico' as valor_nota,
  (select string_agg(c->>'numero' || ' saldo ' || (c->>'saldo')
           || coalesce(' disputa:' || (select string_agg((x->>'numero') || '=' || (x->>'valor'), ',') from jsonb_array_elements(c->'disputa') x), '')
           || case when (c->>'saldo_nao_confirmado')::boolean then ' [não confirmado]' else '' end, ' | ')
     from jsonb_array_elements(j->'pedidos'->'candidatos') c) as candidatos
from r;
rollback;

-- 3. 40 não lançadas mais recentes: nenhum Encerrado, nenhum fora de ±20%
begin;
set local statement_timeout = '55s';
select set_config('request.jwt.claims', json_build_object('sub', '41b07a68-8576-4699-b905-374604edd158', 'role', 'authenticated')::text, true);
create temp table _chaves on commit drop as
  select chave_acesso, valor_servico from public.v_nfse_recebida
  where situacao_fisco = 'normal' and situacao_alvo = 'nao_lancada' order by data_emissao desc limit 40;
grant select on _chaves to authenticated;
set local role authenticated;
with r as (select k.valor_servico as v, public.nfse_recebida_detalhe(k.chave_acesso)->'pedidos'->'candidatos' as cs from _chaves k),
c as (select r.v, x from r, jsonb_array_elements(r.cs) x)
select (select count(*) from r) as notas, (select count(*) from r where jsonb_array_length(cs) > 0) as com_candidato,
  count(*) as candidatos, count(*) filter (where x->>'status' = 'Encerrado') as encerrados,
  count(*) filter (where abs((x->>'saldo')::numeric - v) > 0.2 * v) as fora_20,
  count(*) filter (where jsonb_array_length(x->'disputa') > 0) as com_disputa,
  count(*) filter (where (x->>'saldo_nao_confirmado')::boolean) as nao_confirmados
from c;
rollback;

-- ── Resultado (20/10/2026) ──
-- Aplicado pelo MCP (migration nfse_1_11_c_candidatos, mesmo corpo deste arquivo), pré-voo ok (fingerprint, md5 2762673a…).
-- 1. md5 7610786c982f063f82a5d6eb01e46d00; ACL {postgres,authenticated,service_role}; security definer — ok.
--    Usuário sem papel (0394942d…) → 42501 — ok. Tempo: Microsoft (81 notas pendentes do fornecedor) 274 ms; Rio Ponto 215 ms.
-- 2. Rio Ponto 16063 → só 0005125 (0002864 Encerrado saiu).
--    WT 1771 → 0005082 (saldo = valor exato) + 0005123; WT 1703 e 1812 → 0005123 com disputa (0005082 ficou com a 1771;
--    0002796 Encerrado saiu); WT 1772 → 0005121 (exato); WT 1813 → nenhum (0005121 é exato da 1772; 0002896 Encerrado saiu).
--    Microsoft 263262547 → 0003482 em disputa com 7 notas de jan–jul; Strattner 30948 → 0002824 [não confirmado, pedido
--    de nov/2025] e 0003952, ambos em disputa com 3 notas; MEDLAB 142255 → 0005029 em disputa com 2; Previne 581 → nenhum.
-- 3. 40 não lançadas: 9 com candidato, 12 candidatos, 0 Encerrado, 0 fora de ±20%, 8 com disputa, 0 não confirmados.
