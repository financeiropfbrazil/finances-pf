-- NFSE-1.11-B — conferência (só leitura)

-- 1. Corpo novo, ACL intacto (sem anon), SECURITY DEFINER
select md5(prosrc) as md5, proacl::text as acl, prosecdef
from pg_proc where oid = 'public.nfse_recebida_detalhe(text)'::regprocedure;
-- esperado: md5 2762673a8d3b9b9664492edeb3729a3c · {postgres=X,authenticated=X,service_role=X} · true

-- 2. Como Operador de Compras sem admin: os 3 casos de referência
begin;
select set_config('request.jwt.claims', json_build_object('sub', '41b07a68-8576-4699-b905-374604edd158', 'role', 'authenticated')::text, true);
set local role authenticated;
with d(nome, chave) as (values
  ('SPSP 173241', '35290051266494923000155000000017324126108328685351'),
  ('Rio Ponto 16063', '35498051221383007000100000000001606326104710803864'),
  ('ELUS 54083', '35503081208933911000183000000005408326101225329776')),
r as (select nome, public.nfse_recebida_detalhe(chave) as j from d)
select nome, j->'nota'->>'valor_servico' as valor_nota, jsonb_array_length(j->'pedidos'->'candidatos') as n_cand,
  (select string_agg(c->>'numero' || ' f' || (c->>'forca') || ' saldo ' || (c->>'saldo') || ' dif ' || (c->>'diferenca'), ' | ')
     from jsonb_array_elements(j->'pedidos'->'candidatos') c) as candidatos,
  (select string_agg(x->>'numero' || ' nesta nota ' || (x->>'valor_na_nf'), ' | ')
     from jsonb_array_elements(j->'pedidos'->'vinculados') x) as vinculados
from r;
rollback;

-- 3. 40 não lançadas mais recentes: nenhum candidato com saldo fora de ±20%, no máximo 3 por nota
begin;
set local statement_timeout = '50s';
select set_config('request.jwt.claims', json_build_object('sub', '41b07a68-8576-4699-b905-374604edd158', 'role', 'authenticated')::text, true);
create temp table _chaves on commit drop as
  select chave_acesso, valor_servico from public.v_nfse_recebida
  where situacao_fisco = 'normal' and situacao_alvo = 'nao_lancada' order by data_emissao desc limit 40;
grant select on _chaves to authenticated;
set local role authenticated;
with d as (select k.valor_servico as v, public.nfse_recebida_detalhe(k.chave_acesso)->'pedidos'->'candidatos' as cs from _chaves k)
select count(*) as notas, count(*) filter (where jsonb_array_length(cs) > 0) as com_candidato,
  sum(jsonb_array_length(cs)) as candidatos, max(jsonb_array_length(cs)) as max_por_nota,
  (select count(*) from d, jsonb_array_elements(d.cs) c where abs((c->>'saldo')::numeric - d.v) > 0.2 * d.v) as fora_20,
  (select count(*) from d, jsonb_array_elements(d.cs) c where c->>'forca' = '1') as citados
from d;
rollback;

-- ── Resultado (20/10/2026) ──
-- Aplicado pelo MCP (migration nfse_1_11_b_detector_saldo), pré-voo ok (fingerprint 2.312, md5 anterior 52a34048…).
-- 1. md5 2762673a8d3b9b9664492edeb3729a3c; ACL {postgres,authenticated,service_role}; security definer — ok.
--    Usuário sem papel (0394942d…) → 42501 "Sem permissão para Notas de Serviço" — ok.
-- 2. SPSP 173241 (R$ 19.641,15): 0 candidatos (antes: 0004814, Encerrado, saldo fantasma R$ 3.338,77 = retenções);
--    Rio Ponto 16063 (R$ 180): 0005125 saldo 180 (+0,00) e 0002864 saldo 150 (−30,00);
--    ELUS 54083: ligado 0004727, "nesta nota" R$ 1.239,74 (= itens; igual ao cabeçalho neste caso).
-- 3. 40 não lançadas: 11 com candidato, 18 candidatos, máx. 3 por nota, 0 fora de ±20%, 2 citados na nota.
--    (Antes, nas mesmas 40: 55 candidatos, 33 deles por "citado" ou "contrato recorrente" com valor > 3× a nota.)
-- Medição de precisão (382 NFS-e lançadas com pedido, jun–set, pedidos como estão hoje):
--   antes  — 609 sugeridos, 293 errados, pedido certo na lista em 316, 1º sugerido certo em 279;
--   depois — 327 sugeridos, 132 errados, pedido certo na lista em 195, 1º sugerido certo em 191.
--   As 121 notas que perdem a sugestão certa são de pedido-contrato (saldo bem maior que a nota) — decisão do Pedro.
