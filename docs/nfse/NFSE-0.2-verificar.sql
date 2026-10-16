-- =====================================================================
-- NFSE-0.2 — VERIFICAÇÃO (somente leitura)
-- Parte A: logo depois do NFSE-0.2-aplicar.sql.
-- Parte B: depois da drenagem (NFSE-0.5) — qualidade da extração.
-- =====================================================================

-- ── A1. Objetos, RLS e acessos ───────────────────────────────────────
select to_regclass('public.nfse_adn_doc')                                        as tabela,
       (select count(*) from public.nfse_adn_doc)                                as linhas,          -- 0 antes da sonda
       (select relrowsecurity from pg_class where oid = 'public.nfse_adn_doc'::regclass) as rls,     -- true
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'nfse_adn_doc') as policies, -- 0
       has_table_privilege('anon', 'public.nfse_adn_doc', 'select')               as anon_le,         -- false
       has_table_privilege('authenticated', 'public.nfse_adn_doc', 'select')      as auth_le,         -- false
       has_table_privilege('service_role', 'public.nfse_adn_doc', 'insert')       as service_grava,   -- true
       has_table_privilege('klaus_readonly', 'public.nfse_adn_doc', 'select')     as klaus_le,        -- true
       has_function_privilege('anon', 'public.nfse_adn_xp(xml,text)', 'execute') as anon_exec_xp,    -- false
       has_function_privilege('anon', 'public.nfse_adn_doc_extrair()', 'execute') as anon_exec_trg,  -- false
       (select tgenabled from pg_trigger where tgname = 'nfse_adn_doc_extrair'
          and tgrelid = 'public.nfse_adn_doc'::regclass)                          as gatilho;         -- O

-- ── A2. ACL completa (para o diário) ─────────────────────────────────
select 'tabela' as objeto, relacl::text as acl from pg_class where oid = 'public.nfse_adn_doc'::regclass
union all
select p.oid::regprocedure::text, p.proacl::text from pg_proc p
 where p.oid in ('public.nfse_adn_xp(xml,text)'::regprocedure, 'public.nfse_adn_doc_extrair()'::regprocedure);

-- ── B1. Depois da drenagem: o que chegou e o que a extração conseguiu ─
select tipo_documento, tipo_evento, papel_pf,
       count(*)                                  as docs,
       count(*) filter (where extracao_erro is not null) as com_erro_extracao,
       count(*) filter (where numero is null)    as sem_numero,
       count(*) filter (where cmun_emissor is null) as sem_municipio,
       min(data_emissao) as primeira_emissao, max(data_emissao) as ultima_emissao,
       min(nsu) as nsu_min, max(nsu) as nsu_max
from public.nfse_adn_doc
group by 1, 2, 3
order by docs desc;

-- ── B2. Erros de extração (examinar o XML destas linhas) ──────────────
select nsu, tipo_documento, extracao_erro, left(xml, 200) as xml_inicio
from public.nfse_adn_doc
where extracao_erro is not null and extracao_erro <> 'sem XML'
order by nsu
limit 20;
