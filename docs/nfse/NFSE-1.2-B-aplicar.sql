-- =====================================================================
-- NFSE-1.2-B — Correção (Pedro, 21/10/2026: "corrija"): NFS-e lançada no Alvo com OUTRO número (Microsoft → DIV)
-- Projeto: hbtggrbauguukewiknew.
-- Problema: a view só reconhece "lançada" por CNPJ + número da NFS-e. A Microsoft cita o número da fatura na
--   descrição ("G168240607 - 02684 - Processamento de dados…") e o Alvo lançou essas notas como DIV com esse número
--   (DIV 168240607, G168502469…) → 10 NFS-e de jul–ago/2026 apareciam "não lançadas", já pagas no cartão.
-- Solução: sem título pelo número, vale o título do MESMO CNPJ cujo número (6+ dígitos) a própria nota cita na
--   descrição/informações complementares, com o mesmo valor (serviço ou líquido, ±R$ 0,01), nunca projeção
--   (projecao = 'Sim'). Novas colunas no fim: alvo_vinculo ('numero' | 'citado_na_nota') e alvo_doc_numero.
-- Comparado antes de aplicar (consulta só de leitura): 1.519 notas nos dois corpos; 10 mudam de nao_lancada para
--   lancada_outra_especie (todas Microsoft/DIV, pagas); 0 outra diferença. Tempo: lista 4 meses 390 → 463 ms;
--   detalhe de 1 nota 307 → 341 ms.
-- Não muda: as 73 NFS-e da Microsoft sem documento no Alvo (jan–mai sem nenhum lançamento) seguem nao_lancada.
-- create or replace: mesmas colunas na mesma ordem + 2 no fim; security_invoker mantido; ACL preservado.
-- Rollback: NFSE-1.2-B-rollback.sql (lógica da 1.2-A, com as 2 colunas novas vazias — sem DROP).
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if (select md5(pg_get_viewdef('public.v_nfse_recebida'::regclass, true))) <> '08814f110ca20905ddc003b01cfab311' then
    raise exception 'v_nfse_recebida mudou desde a leitura de 21/10 — conferir antes de aplicar';
  end if;
end $$;

create or replace view public.v_nfse_recebida with (security_invoker = on) as
 WITH nota AS NOT MATERIALIZED (
         SELECT d.nsu,
            d.chave_acesso,
            d.numero,
            ltrim(d.numero, '0'::text) AS num,
            d.data_emissao,
            d.prestador_doc,
            replace(d.prestador_nome, '&amp;'::text, '&'::text) AS prestador_nome,
            d.cmun_emissor,
            NULLIF(btrim(replace("substring"(d.xml, '<xLocEmi>([^<]*)</xLocEmi>'::text), '&amp;'::text, '&'::text)), ''::text) AS municipio_emissor,
            d.tomador_doc,
            d.intermediario_doc,
            d.valor_servico,
            d.valor_liquido,
            d.gerado_em,
            d.xml
           FROM nfse_adn_doc d
          WHERE d.tipo_documento = 'NFSE'::text AND d.papel_pf = 'tomador'::text
        ), evento AS (
         SELECT e.chave_acesso,
            bool_or(e.tipo_evento = 'CANCELAMENTO_POR_SUBSTITUICAO'::text) AS substituida,
            max(e.gerado_em) AS cancelada_em
           FROM nfse_adn_doc e
          WHERE e.tipo_documento = 'EVENTO'::text AND (e.tipo_evento = ANY (ARRAY['CANCELAMENTO'::text, 'CANCELAMENTO_POR_SUBSTITUICAO'::text]))
          GROUP BY e.chave_acesso
        ), limite AS (
         SELECT min(f.data_vencimento) AS inicio
           FROM fin_parcelas_pagar f
        ), titulo AS (
         SELECT f.cpf_cnpj_entidade AS cnpj,
            ltrim(f.doc_numero, '0'::text) AS num,
            bool_or(f.especie = 'NFS-e'::text) AS tem_nfse,
            string_agg(DISTINCT f.especie, ', '::text) AS especies,
            min(f.chave_docfin) AS chave_docfin,
            min(f.chave_movestq) AS chave_movestq,
            min(f.data_entrada) AS data_entrada,
            sum(f.valor_original) AS valor,
            count(*) AS parcelas,
            count(*) FILTER (WHERE c.classe = ANY (ARRAY['pago'::text, 'quitado_adto'::text])) AS pagas,
            count(*) FILTER (WHERE c.classe = 'aberto'::text) AS abertas,
            count(*) FILTER (WHERE c.classe = 'agrupado'::text) AS agrupadas,
            min(f.pedido_numero) AS pedido_titulo,
            min(f.doc_numero) AS doc_numero,
            bool_and(COALESCE(f.projecao, 'Não'::text) = 'Sim'::text) AS so_projecao
           FROM fin_parcelas_pagar f
             CROSS JOIN LATERAL ( SELECT rastreio_classe_pagamento(f.codigo_situacao, f.numero_mov_ctrl_banc, f.tipo_cobranca) AS classe) c
          WHERE f.ausente_no_alvo_em IS NULL
          GROUP BY f.cpf_cnpj_entidade, (ltrim(f.doc_numero, '0'::text))
        ), citavel AS (
         -- NFSE-1.2-B: título que pode ser achado pela citação na nota (número com 6+ dígitos, nunca projeção)
         SELECT t.*,
            ltrim(regexp_replace(t.num, '\D'::text, ''::text, 'g'::text), '0'::text) AS num_dig
           FROM titulo t
          WHERE NOT t.so_projecao AND length(ltrim(regexp_replace(t.num, '\D'::text, ''::text, 'g'::text), '0'::text)) >= 6
        ), por_numero AS (
         SELECT n.chave_acesso,
            t.cnpj, t.num, t.tem_nfse, t.especies, t.chave_docfin, t.chave_movestq, t.data_entrada, t.valor, t.parcelas,
            t.pagas, t.abertas, t.agrupadas, t.pedido_titulo, t.doc_numero,
            'numero'::text AS vinculo
           FROM nota n
             JOIN titulo t ON t.cnpj = n.prestador_doc AND t.num = n.num
        ), por_citacao AS (
         -- NFSE-1.2-B: sem título pelo número, vale o título do mesmo CNPJ cujo número a própria nota cita na descrição
         -- (ex.: Microsoft "G168240607 - …" lançada como DIV 168240607), com o mesmo valor
         SELECT DISTINCT ON (n.chave_acesso) n.chave_acesso,
            t.cnpj, t.num, t.tem_nfse, t.especies, t.chave_docfin, t.chave_movestq, t.data_entrada, t.valor, t.parcelas,
            t.pagas, t.abertas, t.agrupadas, t.pedido_titulo, t.doc_numero,
            'citado_na_nota'::text AS vinculo
           FROM nota n
             JOIN citavel t ON t.cnpj = n.prestador_doc
          WHERE (abs(t.valor - n.valor_servico) <= 0.01 OR abs(t.valor - n.valor_liquido) <= 0.01)
            AND NOT EXISTS ( SELECT 1 FROM titulo t0 WHERE t0.cnpj = n.prestador_doc AND t0.num = n.num)
            AND concat_ws(' '::text, "substring"(n.xml, '<xDescServ>([^<]*)</xDescServ>'::text), "substring"(n.xml, '<xInfComp>([^<]*)</xInfComp>'::text))
                ~ (('(?<![0-9])0*'::text || t.num_dig) || '(?![0-9])'::text)
          ORDER BY n.chave_acesso, t.num
        ), vinculo AS (
         SELECT * FROM por_numero
        UNION ALL
         SELECT * FROM por_citacao
        )
 SELECT n.nsu,
    n.chave_acesso,
    n.numero,
    n.data_emissao,
    n.prestador_doc,
    n.prestador_nome,
    n.cmun_emissor,
    n.municipio_emissor,
    n.tomador_doc,
    n.intermediario_doc,
    n.valor_servico,
    n.valor_liquido,
    n.gerado_em,
        CASE
            WHEN ev.chave_acesso IS NULL THEN 'normal'::text
            WHEN ev.substituida THEN 'substituida'::text
            ELSE 'cancelada'::text
        END AS situacao_fisco,
    ev.cancelada_em,
        CASE
            WHEN t.tem_nfse THEN 'lancada_nfse'::text
            WHEN t.cnpj IS NOT NULL THEN 'lancada_outra_especie'::text
            WHEN n.data_emissao < (( SELECT l.inicio
               FROM limite l)) THEN 'sem_dado_alvo'::text
            ELSE 'nao_lancada'::text
        END AS situacao_alvo,
    t.especies AS alvo_especies,
    t.chave_docfin AS alvo_chave_docfin,
    t.chave_movestq AS alvo_chave_movestq,
    t.data_entrada AS alvo_data_entrada,
    t.valor AS alvo_valor,
    t.parcelas AS alvo_parcelas,
        CASE
            WHEN t.parcelas IS NULL THEN NULL::text
            WHEN t.pagas = t.parcelas THEN 'pago'::text
            WHEN t.abertas = t.parcelas THEN 'em_aberto'::text
            WHEN t.abertas > 0 THEN 'parcial'::text
            WHEN t.agrupadas > 0 THEN 'agrupado'::text
            ELSE 'baixa_sem_prova'::text
        END AS alvo_pagamento,
    COALESCE(( SELECT string_agg(DISTINCT p.pedido_numero, ', '::text) AS string_agg
           FROM rastreio_nf_pedido p
          WHERE p.chave_movestq = t.chave_movestq AND p.codigo_empresa_filial = '1.01'::text), t.pedido_titulo) AS alvo_pedido,
    CURRENT_DATE - n.data_emissao AS dias_desde_emissao,
    t.vinculo AS alvo_vinculo,
    t.doc_numero AS alvo_doc_numero
   FROM nota n
     LEFT JOIN evento ev ON ev.chave_acesso = n.chave_acesso
     LEFT JOIN vinculo t ON t.chave_acesso = n.chave_acesso
;

comment on view public.v_nfse_recebida is
  'NFSE-1.2 (PLANO-NFSE.md): 1 linha por NFS-e do ADN com a P&F tomadora. situacao_fisco = o que o FISCO diz '
  '(eventos do ADN); situacao_alvo = o que o ALVO tem (fin_parcelas_pagar, regra da NFSE-0.6; NFSE-1.2-B: também '
  'o título do mesmo CNPJ cujo número a nota cita, com o mesmo valor — alvo_vinculo diz qual). Lida só pelas RPCs '
  'nfse_recebidas_listar / nfse_recebida_detalhe / nfse_recebida_xml.';
