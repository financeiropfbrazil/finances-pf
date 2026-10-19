-- =====================================================================
-- Diagnóstico antes do cron do ADN (NFSE-1.9) — 19/10/2026, ordem do Pedro:
-- "rode manual agora e faça um diagnóstico para ter certeza que está correto e merece um cron permanente ativo".
-- SOMENTE LEITURA (a drenagem manual foi a única escrita: request 32147, run ea2e3afe).
-- Projeto hbtggrbauguukewiknew (fingerprint 2.305 pedidos).
-- =====================================================================

-- 1. Drenagem manual de 19/10 13h52 BRT (mesmo procedimento da NFSE-0.5):
--    select net.http_post(url := 'https://hbtggrbauguukewiknew.supabase.co/functions/v1/nfse-adn-sonda',
--      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
--                   (select decrypted_secret from vault.decrypted_secrets where name = 'sync_compras_cron_secret')),
--      body := '{"modo":"drenar","triggered_by":"manual_admin","max_lotes":30}'::jsonb, timeout_milliseconds := 150000);
--    Resultado: HTTP 200, NSU 1.645→1.653, 2 lotes, 8 docs (8 NFSE tomador), parou: fim_da_fila, 0 erro, 4,5 s.

-- 2. Integridade (19/10: 1.653 docs, NSU 1..1.653, 0 buraco, 0 sem XML, 0 erro de extração, 0 chave repetida)
select (select count(*) from nfse_adn_doc) docs, (select max(nsu) from nfse_adn_doc) max_nsu,
       (select count(*) from generate_series(1, (select max(nsu) from nfse_adn_doc)) g(n)
         where not exists (select 1 from nfse_adn_doc d where d.nsu = g.n)) buracos_nsu,
       (select count(*) from nfse_adn_doc where extracao_erro is not null) erros_extracao,
       (select count(*) from nfse_adn_doc where xml is null or btrim(xml) = '') sem_xml,
       (select count(*) from (select chave_acesso, tipo_documento, coalesce(tipo_evento, '') from nfse_adn_doc
                              group by 1, 2, 3 having count(*) > 1) s) chave_repetida;

-- 3. Ritmo e atraso do ADN (19/10: 6,3 docs/dia, máx. 17; emissão→ADN p50 0,9 d, p90 1,8 d; 0 com > 30 d;
--    27 notas emitidas antes de ago/2026 chegaram desde set — o NSU pega chegada tardia, a data de emissão não)
with dia as (select (gerado_em at time zone 'America/Sao_Paulo')::date d, count(*) n
             from nfse_adn_doc where gerado_em >= '2026-08-20' group by 1),
lag as (select extract(epoch from (gerado_em - data_emissao::timestamptz)) / 86400 dias
        from nfse_adn_doc where tipo_documento = 'NFSE' and papel_pf = 'tomador' and data_emissao >= '2026-09-01')
select (select round(avg(n), 1) from dia) docs_por_dia, (select max(n) from dia) docs_dia_max,
       (select round(percentile_cont(0.5) within group (order by dias)::numeric, 1) from lag) atraso_p50_dias,
       (select round(percentile_cont(0.9) within group (order by dias)::numeric, 1) from lag) atraso_p90_dias,
       (select count(*) from nfse_adn_doc where tipo_documento = 'NFSE' and papel_pf = 'tomador'
          and gerado_em >= '2026-09-01' and data_emissao < '2026-08-01') antigas_chegadas_desde_set;

-- 4. Alvo → ADN por mês (19/10: set 120/129 = 93,0%; out 23/30 = 76,7%. Faltam em out: as 5 de Rio Preto de 01–05/10
--    da 0.6 — AQN 408, Arcontemp 35463/35465, Cia. Brasileira de Software 40851/40915 — + Oximed e pessoa física,
--    fornecedores que nunca aparecem. Nenhuma nota desses 3 fornecedores chegou desde 15/09, por número ou valor.)
with alvo as (
  select f.cpf_cnpj_entidade cnpj, ltrim(f.doc_numero, '0') num, min(f.data_emissao) emissao
  from fin_parcelas_pagar f
  where f.especie = 'NFS-e' and f.ausente_no_alvo_em is null and f.data_emissao >= '2026-09-01' group by 1, 2),
adn as (select prestador_doc cnpj, ltrim(numero, '0') num from nfse_adn_doc where tipo_documento = 'NFSE' and papel_pf = 'tomador')
select to_char(a.emissao, 'YYYY-MM') mes, count(*) no_alvo, count(x.num) no_adn, round(100.0 * count(x.num) / count(*), 1) pct
from alvo a left join adn x on x.cnpj = a.cnpj and x.num = a.num group by 1 order by 1;

-- 5. Cobertura do eixo "No Alvo": o espelho fin_parcelas_pagar só tem títulos com vencimento ≥ 01/01/2026
--    (19/10: menor data_vencimento = 2026-01-01). Nota emitida antes disso aparece "não lançada" sem que o Hub saiba
--    (2023-T3 a 2025-T3: 100% "não lançada"; 2025-12: 4 de 13 achadas; 2026-01 em diante: 79–92%). → Correção NFSE-1.2-A.
select (select min(data_vencimento) from fin_parcelas_pagar) menor_vencimento_espelho,
       to_char(date_trunc('quarter', data_emissao), 'YYYY-"T"Q') trimestre, count(*) nfse,
       count(*) filter (where situacao_alvo = 'nao_lancada') nao_lancada
from v_nfse_recebida group by 2 order by 2;
