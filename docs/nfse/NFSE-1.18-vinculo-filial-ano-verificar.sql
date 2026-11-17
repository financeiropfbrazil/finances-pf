-- NFSE-1.18 — conferência (só leitura)

-- 1. View com security_invoker e ACL intactos; corpo novo
select c.reloptions, c.relacl::text as acl, md5(pg_get_viewdef(c.oid, true)) as md5_def
from pg_class c where c.oid = 'public.v_nfse_recebida'::regclass;
-- esperado (17/11/2026): {security_invoker=on} · {postgres, service_role, klaus_readonly=r} · 72cd99be90bc693360cc7e27196a025a

-- 2. Uma linha por nota
select count(*) as linhas, count(distinct chave_acesso) as notas from public.v_nfse_recebida;
-- esperado (17/11/2026): 1678 · 1678

-- 3. Distribuição por situação e por vínculo
select situacao_alvo, coalesce(alvo_vinculo, '∅') as vinculo, count(*)
from public.v_nfse_recebida group by 1, 2 order by 1, 2;
-- esperado (17/11/2026): numero 1225 · citado_na_nota 10 · numero_outra_filial 11 · numero_sem_ano 4 · ∅ 428;
-- não lançadas com situação fiscal normal: 135 (eram 149)

-- 4. As notas achadas pelas regras novas (para o fiscal: nota × cadastro usado no Alvo)
select alvo_vinculo, numero, data_emissao, prestador_nome, prestador_doc as cnpj_nota, alvo_cnpj as cnpj_no_alvo,
       valor_servico, alvo_valor, alvo_especies, alvo_doc_numero, alvo_chave_docfin, alvo_chave_movestq, alvo_pagamento
from public.v_nfse_recebida
where alvo_vinculo in ('numero_outra_filial', 'numero_sem_ano')
order by alvo_vinculo, prestador_nome, data_emissao;

-- 5. Nenhum título do Alvo ligado a duas notas por causa das regras novas
select alvo_cnpj, alvo_doc_numero, count(*)
from public.v_nfse_recebida
where alvo_cnpj is not null
group by 1, 2
having count(*) > 1 and bool_or(alvo_vinculo in ('numero_outra_filial', 'numero_sem_ano'));
-- esperado: 0 linhas

-- 6. Como usuário sem admin (Hugo): lista e detalhe trazem alvo_vinculo e alvo_cnpj
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', 'c4888699-704b-4827-9371-0f459b900404', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table _r on commit drop as
select d::jsonb->'nota'->>'alvo_vinculo' as vinculo, d::jsonb->'nota'->>'alvo_cnpj' as cnpj_no_alvo,
       d::jsonb->'nota'->>'situacao_alvo' as situacao
from (select public.nfse_recebida_detalhe('35503081201808151005798000000361313326107666767577') d) x;
select * from _r;
-- esperado: numero_outra_filial · 01808151003159 · lancada_nfse (HORA PARK 3613133)
rollback;
