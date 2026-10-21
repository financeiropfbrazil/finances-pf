-- NFSE-1.2-B — conferência (só leitura)

-- 1. View com security_invoker e ACL intactos; corpo novo
select c.reloptions, c.relacl::text as acl, md5(pg_get_viewdef(c.oid, true)) as md5_def
from pg_class c where c.oid = 'public.v_nfse_recebida'::regclass;
-- esperado: {security_invoker=on} · {postgres, service_role, klaus_readonly=r} · c2f53be029d616bee002c3b3547f5629

-- 2. Distribuição por situação e por vínculo
select situacao_alvo, coalesce(alvo_vinculo, '∅') as vinculo, count(*)
from public.v_nfse_recebida group by 1, 2 order by 1, 2;

-- 3. As notas achadas pela citação
select numero, prestador_nome, data_emissao, valor_servico, alvo_especies, alvo_doc_numero, alvo_pagamento
from public.v_nfse_recebida where alvo_vinculo = 'citado_na_nota' order by data_emissao;

-- 4. Como Operador sem admin (lista + detalhe) e como usuário sem papel
begin;
create function pg_temp.tenta(p_uid uuid) returns text language plpgsql as $$
declare r jsonb; d jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  r := public.nfse_recebidas_listar(p_de := '2026-07-01', p_ate := '2026-07-31', p_busca := '256973039');
  d := public.nfse_recebida_detalhe((r->'itens'->0->>'chave_acesso'));
  return (r->'itens'->0->>'numero') || ' · ' || (r->'itens'->0->>'situacao_alvo') || ' · ' || (r->'itens'->0->>'alvo_especies') || ' '
      || coalesce(r->'itens'->0->>'alvo_doc_numero', '-') || ' (' || coalesce(r->'itens'->0->>'alvo_vinculo', '-') || ') · detalhe: '
      || (d->'nota'->>'situacao_alvo');
exception when others then return sqlstate || ' ' || sqlerrm;
end $$;
set local role authenticated;
select pg_temp.tenta('41b07a68-8576-4699-b905-374604edd158') as operador, pg_temp.tenta('0394942d-4458-481c-9681-23ec641e91fd') as sem_permissao;
rollback;

-- ── Resultado (21/10/2026) ──
-- Antes de aplicar (consulta só de leitura comparando os dois corpos): 1.519 notas nos dois; 10 mudaram de
--   nao_lancada para lancada_outra_especie (citado_na_nota), todas Microsoft/DIV e pagas no cartão; 0 outra diferença.
--   Tempo: lista de 4 meses (to_jsonb de todas as colunas) 390 → 463 ms; detalhe de 1 nota 307 → 341 ms.
-- Aplicado pelo MCP (migration nfse_1_2_b_vinculo_por_citacao), pré-voo ok (fingerprint 2.317, md5 anterior 08814f11…).
-- 1. {security_invoker=on}; ACL {postgres, service_role, klaus_readonly=r}; md5 c2f53be0….
-- 2. nao_lancada 250 · lancada_nfse 1.027 · sem_dado_alvo 231 · lancada_outra_especie 11 (1 por número + 10 citadas).
-- 3. 256973039→DIV 168240607 · 256975413→168311284 · 256981682→G168502469 · 257044393→G170727394 ·
--    257065316→G171387794 · 257066288→G171449398 · 257078598→G171851901 · 257098411→G172451917 ·
--    257105830→G172633923 · 257132639→173486163 — todas pagas.
-- 4. Operador: "256973039 · lancada_outra_especie · DIV 168240607 (citado_na_nota) · detalhe: lancada_outra_especie";
--    sem papel: 42501.
-- Seguem nao_lancada: 73 NFS-e da Microsoft. Jan–mai/2026: 41 notas sem nenhum documento da Microsoft no Alvo;
--   as projeções "PC" do pedido não têm o valor das notas (câmbio), então não há como ligar nota a projeção.
