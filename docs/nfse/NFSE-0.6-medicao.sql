-- =====================================================================
-- NFSE-0.6 — Medição de cobertura do ADN × NFS-e lançadas no Alvo (SOMENTE LEITURA)
-- Projeto: hbtggrbauguukewiknew (Financial Hub). Resultado de 16/10/2026: NFSE-0.6-RELATORIO.md.
--
-- Dois eixos, sempre nomeados (regra LIVRO × ESPELHO do CLAUDE.md):
--   "No Alvo"  = fin_parcelas_pagar, espécie 'NFS-e' (espelho do contas a pagar do Alvo; o LIVRO da P&F)
--   "No fisco" = nfse_adn_doc, NFSE com a P&F tomadora (espelho do ADN)
-- Casamento: CNPJ/CPF do prestador + número da nota sem zeros à esquerda
--   (Alvo: doc_numero — o campo numero é "NF/série-parcela"; ADN: infNFSe/nNFSe).
-- Plano B testado (CNPJ + valor ±0,05 + emissão ±5 dias): não achou nenhuma nota a mais → a numeração bate.
-- Cidade do lado Alvo: cadastro do fornecedor (compras_entidades_cache.municipio);
-- do lado ADN: município emissor (cmun_emissor, IBGE). Rio Preto 3549805, São Paulo 3550308.
-- =====================================================================

-- ── A. Alvo → ADN, últimos 90 dias, por cidade do cadastro ───────────
with alvo as (
  select f.cpf_cnpj_entidade cnpj, ltrim(f.doc_numero, '0') num, min(f.data_emissao) emissao, sum(f.valor_original) valor,
         max(e.municipio) municipio, max(e.uf) uf
  from public.fin_parcelas_pagar f
  left join public.compras_entidades_cache e on e.codigo_entidade = f.codigo_entidade
  where f.especie = 'NFS-e' and f.data_emissao >= current_date - 90 and f.ausente_no_alvo_em is null
  group by 1, 2),
adn as (
  select prestador_doc cnpj, ltrim(numero, '0') num, data_emissao, valor_servico, valor_liquido
  from public.nfse_adn_doc where tipo_documento = 'NFSE' and papel_pf = 'tomador'),
casa as (
  select a.*,
    exists (select 1 from adn x where x.cnpj = a.cnpj and x.num = a.num) as por_numero,
    exists (select 1 from adn x where x.cnpj = a.cnpj and abs(x.data_emissao - a.emissao) <= 5
              and (abs(x.valor_servico - a.valor) <= 0.05 or abs(x.valor_liquido - a.valor) <= 0.05)) as por_valor,
    exists (select 1 from adn x where x.cnpj = a.cnpj) as fornecedor_no_adn
  from alvo a)
select coalesce(municipio || '/' || uf, '(TOTAL)') cidade_cadastro, count(*) no_alvo,
       count(*) filter (where por_numero) achadas_por_numero,
       count(*) filter (where not por_numero and por_valor) achadas_so_por_valor,
       count(*) filter (where not por_numero and not por_valor) faltam,
       count(*) filter (where not por_numero and not por_valor and fornecedor_no_adn) faltam_mas_fornecedor_no_adn,
       round(100.0 * count(*) filter (where por_numero or por_valor) / count(*), 1) cobertura_pct
from casa group by grouping sets ((municipio, uf), ()) order by no_alvo desc;

-- ── B. Série mensal 2026 (Alvo → ADN): Rio Preto, São Paulo, outras ──
with alvo as (
  select f.cpf_cnpj_entidade cnpj, ltrim(f.doc_numero, '0') num, min(f.data_emissao) emissao, max(e.municipio) municipio
  from public.fin_parcelas_pagar f
  left join public.compras_entidades_cache e on e.codigo_entidade = f.codigo_entidade
  where f.especie = 'NFS-e' and f.data_emissao >= date '2026-01-01' and f.ausente_no_alvo_em is null
  group by 1, 2),
adn as (select prestador_doc cnpj, ltrim(numero, '0') num from public.nfse_adn_doc where tipo_documento = 'NFSE' and papel_pf = 'tomador')
select to_char(date_trunc('month', emissao), 'YYYY-MM') mes,
       count(*) filter (where municipio = 'SÃO JOSÉ DO RIO PRETO') rp_alvo,
       count(*) filter (where municipio = 'SÃO JOSÉ DO RIO PRETO' and exists (select 1 from adn x where x.cnpj = a.cnpj and x.num = a.num)) rp_no_adn,
       count(*) filter (where municipio = 'SÃO PAULO') sp_alvo,
       count(*) filter (where municipio = 'SÃO PAULO' and exists (select 1 from adn x where x.cnpj = a.cnpj and x.num = a.num)) sp_no_adn,
       count(*) filter (where municipio not in ('SÃO JOSÉ DO RIO PRETO', 'SÃO PAULO')) outras_alvo,
       count(*) filter (where municipio not in ('SÃO JOSÉ DO RIO PRETO', 'SÃO PAULO') and exists (select 1 from adn x where x.cnpj = a.cnpj and x.num = a.num)) outras_no_adn
from alvo a group by 1 order by 1;

-- ── C. Jan–set/2026 (sem o efeito de outubro): notas e fornecedores ──
with alvo as (
  select f.cpf_cnpj_entidade cnpj, ltrim(f.doc_numero, '0') num, max(e.municipio) municipio
  from public.fin_parcelas_pagar f
  left join public.compras_entidades_cache e on e.codigo_entidade = f.codigo_entidade
  where f.especie = 'NFS-e' and f.ausente_no_alvo_em is null and f.data_emissao between date '2026-01-01' and date '2026-09-30'
  group by 1, 2),
adn as (select prestador_doc cnpj, ltrim(numero, '0') num from public.nfse_adn_doc where tipo_documento = 'NFSE' and papel_pf = 'tomador'),
m as (select a.*, case when municipio in ('SÃO JOSÉ DO RIO PRETO','SÃO PAULO') then municipio else 'OUTRAS' end grupo,
             exists (select 1 from adn x where x.cnpj = a.cnpj and x.num = a.num) achada,
             exists (select 1 from adn x where x.cnpj = a.cnpj) forn_no_adn
      from alvo a)
select coalesce(grupo, '(TOTAL)') grupo, count(*) notas_jan_set, count(*) filter (where achada) achadas,
       round(100.0 * count(*) filter (where achada) / count(*), 1) cobertura_notas_pct,
       count(distinct cnpj) fornecedores, count(distinct cnpj) filter (where forn_no_adn) fornecedores_no_adn,
       count(*) filter (where not achada and not forn_no_adn) faltas_fornecedor_ausente,
       count(*) filter (where not achada and forn_no_adn) faltas_fornecedor_presente
from m group by grouping sets ((grupo), ()) order by notas_jan_set desc;

-- ── D. Faltas dos últimos 90 dias, uma a uma (Alvo sem ADN) ──────────
with alvo as (
  select f.cpf_cnpj_entidade cnpj, ltrim(f.doc_numero, '0') num, min(f.data_emissao) emissao, sum(f.valor_original) valor,
         max(e.municipio) municipio, max(e.nome) fornecedor, max(f.data_entrada) entrada
  from public.fin_parcelas_pagar f
  left join public.compras_entidades_cache e on e.codigo_entidade = f.codigo_entidade
  where f.especie = 'NFS-e' and f.data_emissao >= current_date - 90 and f.ausente_no_alvo_em is null
  group by 1, 2),
adn as (select prestador_doc cnpj, ltrim(numero, '0') num, data_emissao, valor_servico from public.nfse_adn_doc
        where tipo_documento = 'NFSE' and papel_pf = 'tomador')
select a.municipio, left(a.fornecedor, 30) fornecedor, a.num num_alvo, a.emissao, a.entrada, a.valor,
       (select count(*) from adn x where x.cnpj = a.cnpj) notas_fornecedor_no_adn,
       (select max(x.data_emissao) from adn x where x.cnpj = a.cnpj) ultima_no_adn
from alvo a where not exists (select 1 from adn x where x.cnpj = a.cnpj and x.num = a.num)
order by a.municipio, a.fornecedor, a.emissao;

-- ── E. ADN → Alvo, últimos 90 dias, por município emissor ────────────
with adn as (
  select d.prestador_doc cnpj, ltrim(d.numero, '0') num, d.data_emissao, d.valor_servico, d.cmun_emissor,
         exists (select 1 from public.nfse_adn_doc ev where ev.tipo_documento = 'EVENTO' and ev.chave_acesso = d.chave_acesso
                   and ev.tipo_evento in ('CANCELAMENTO', 'CANCELAMENTO_POR_SUBSTITUICAO')) cancelada
  from public.nfse_adn_doc d where d.tipo_documento = 'NFSE' and d.papel_pf = 'tomador' and d.data_emissao >= current_date - 90),
alvo_qq as (select cpf_cnpj_entidade cnpj, ltrim(doc_numero, '0') num, string_agg(distinct especie, ',') especies
            from public.fin_parcelas_pagar where ausente_no_alvo_em is null group by 1, 2),
r as (select a.*, q.especies, case when a.cmun_emissor = '3549805' then 'São José do Rio Preto'
                                   when a.cmun_emissor = '3550308' then 'São Paulo' else 'outras' end cidade
      from adn a left join alvo_qq q on q.cnpj = a.cnpj and q.num = a.num)
select coalesce(cidade, '(TOTAL)') cidade_emissora, count(*) no_adn,
       count(*) filter (where especies like '%NFS-e%') lancada_como_nfse,
       count(*) filter (where especies is not null and especies not like '%NFS-e%') lancada_outra_especie,
       count(*) filter (where especies is null and cancelada) nao_lancada_cancelada,
       count(*) filter (where especies is null and not cancelada and data_emissao >= current_date - 15) nao_lancada_recente_15d,
       count(*) filter (where especies is null and not cancelada and data_emissao < current_date - 15) nao_lancada_antiga,
       round(sum(valor_servico) filter (where especies is null and not cancelada and data_emissao < current_date - 15), 2) valor_nao_lancada_antiga
from r group by grouping sets ((cidade), ()) order by no_adn desc;

-- ── F. Canceladas no fisco × lançadas no Alvo (destaque D6) ──────────
with canc as (
  select d.prestador_doc cnpj, ltrim(d.numero, '0') num, d.data_emissao, d.valor_servico, d.prestador_nome, d.cmun_emissor,
         (select max(ev.gerado_em) from public.nfse_adn_doc ev where ev.tipo_documento = 'EVENTO' and ev.chave_acesso = d.chave_acesso
            and ev.tipo_evento in ('CANCELAMENTO', 'CANCELAMENTO_POR_SUBSTITUICAO')) cancelada_em
  from public.nfse_adn_doc d where d.tipo_documento = 'NFSE' and d.papel_pf = 'tomador')
select left(c.prestador_nome, 35) prestador, c.cmun_emissor, c.num, c.data_emissao, c.valor_servico,
       (c.cancelada_em at time zone 'America/Sao_Paulo')::date cancelada_no_fisco_em,
       f.chave_docfin, sum(f.valor_original) valor_alvo, max(f.data_entrada) lancada_em, max(f.data_pagamento) pago_em
from canc c
join public.fin_parcelas_pagar f on f.cpf_cnpj_entidade = c.cnpj and ltrim(f.doc_numero, '0') = c.num and f.ausente_no_alvo_em is null
where c.cancelada_em is not null
group by 1, 2, 3, 4, 5, 6, 7;
