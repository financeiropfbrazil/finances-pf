-- NFSE-1.2 — conferência (somente leitura). Mesma regra da NFSE-0.6 (consulta E) rodada no mesmo dia → números iguais.
-- 19/10/2026: 1.495 notas (1.495 chaves) · 90 dias: 415 no ADN, 295 lançadas como NFS-e, 1 em outra espécie,
-- 11 canceladas não lançadas, 61 não lançadas há mais de 15 dias = R$ 230.864,49 (= consulta E da 0.6 rodada no mesmo dia)
-- · 2 canceladas no fisco e lançadas (ambas pagas — os DocFin 24896 e 26294 da 0.6) · 0 sem município · 0 nome com &amp;.
select count(*) total, count(distinct chave_acesso) chaves,
       count(*) filter (where data_emissao >= current_date - 90) no_adn_90d,
       count(*) filter (where data_emissao >= current_date - 90 and situacao_alvo = 'lancada_nfse') lancada_nfse_90d,
       count(*) filter (where data_emissao >= current_date - 90 and situacao_alvo = 'lancada_outra_especie') outra_especie_90d,
       count(*) filter (where data_emissao >= current_date - 90 and situacao_alvo = 'nao_lancada' and situacao_fisco <> 'normal') canceladas_nao_lancadas_90d,
       count(*) filter (where data_emissao >= current_date - 90 and situacao_alvo = 'nao_lancada' and situacao_fisco = 'normal' and dias_desde_emissao > 15) nao_lancadas_15d,
       round(sum(valor_servico) filter (where data_emissao >= current_date - 90 and situacao_alvo = 'nao_lancada' and situacao_fisco = 'normal' and dias_desde_emissao > 15), 2) valor_nao_lancadas_15d,
       count(*) filter (where situacao_fisco <> 'normal' and situacao_alvo <> 'nao_lancada') canceladas_e_lancadas,
       count(*) filter (where municipio_emissor is null) sem_municipio
from public.v_nfse_recebida;

-- ACL: só postgres, service_role e klaus_readonly (leitura, como nfse_adn_doc) — 19/10: confere
select relacl from pg_class where oid = 'public.v_nfse_recebida'::regclass;
