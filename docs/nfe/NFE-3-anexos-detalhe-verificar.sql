-- NFE-3 — conferência (só leitura)

-- 1. Objetos e acessos
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id in ('nfe-nf-pdf', 'nfe-boleto-pdf');
select policyname, cmd from pg_policies where schemaname = 'storage' and policyname like 'nfe_anexos_%';
select p.oid::regprocedure, p.proacl::text from pg_proc p
where p.proname in ('nfe_storage_pode_gravar', 'nfe_anexo_registrar', 'nfe_anexo_remover', 'nfe_recebida_detalhe');

-- 2. Como Hugo: detalhe das 12 notas mais recentes + 1 upload (tempo e conteúdo das etapas)
begin;
set local statement_timeout = '50s';
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'hugo.maffei@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
with amostra as ((select id from public.compras_nfe order by data_emissao desc limit 12)
                 union all (select id from public.compras_nfe where origem = 'Upload' limit 1)),
r as (select c.numero, c.emitente_nome, c.valor_total, public.nfe_recebida_detalhe(a.id) j from amostra a join public.compras_nfe c on c.id = a.id)
select numero, left(emitente_nome, 22) forn, valor_total, j->'nota'->>'situacao_alvo' alvo, j->'nota'->>'faturavel' fat,
  jsonb_array_length(j->'pedidos'->'vinculados') vinc,
  (select string_agg((c->>'numero') || ' f' || (c->>'forca') || ' s' || (c->>'saldo'), ' | ') from jsonb_array_elements(j->'pedidos'->'candidatos') c) cand,
  jsonb_array_length(j->'docfin'->'parcelas') parc
from r;
rollback;

-- 3. Como Mirlene: 42501 no detalhe
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from profiles where email = 'mirlene.oliveira@pfbrazil.com'), 'role', 'authenticated')::text, true);
set local role authenticated;
create or replace function pg_temp.t() returns text language plpgsql as $$
begin perform public.nfe_recebida_detalhe((select id from public.compras_nfe limit 1)); return 'passou';
exception when others then return sqlstate; end $$;
select pg_temp.t();
rollback;

-- ── Resultado (30/10/2026) ──
-- Aplicado pelo MCP (migration nfe_3_anexos_detalhe). 2 buckets privados; ACL sem anon.
-- 2. Hugo, 13 notas, 41–332 ms cada: Biocollagen 1838/1837 lançadas (MovEstq 21540/21561, 1 pedido do Alvo, 1 parcela);
--    Gráfica FB Caza 1273 → 0005184 citado (saldo = valor); CTEC 15640 → 0004617 citado (+19%); JK Rio Preto 184 → 0005099
--    citado; Allatra 9253 → 3 pedidos de R$ 13.500 em disputa; ATM TOP e CEIME sem CFOP de venda → sem candidato;
--    upload HTS 249494 lançada (MovEstq 17539, 6 parcelas).
