-- =====================================================================
-- NFSE-1.18 — Correção (Pedro, 17/11/2026: "1. Sim"): NFS-e lançadas no Alvo que o Hub mostrava "não lançadas"
-- Projeto: hbtggrbauguukewiknew.
-- Problema: a view só reconhece "lançada" por CNPJ exato + número (ou, desde a 1.2-B, pelo número que a nota cita).
--   Dois casos lançados de fato ficavam de fora:
--   (a) OUTRA FILIAL: a nota é de uma filial do prestador e o Alvo lançou no cadastro de outra filial (mesma raiz de
--       CNPJ) — ex.: HORA PARK 3613133, nota do CNPJ 01808151005798, lançada no Alvo no 01808151003159
--       (DocFin 34684, MovEstq 21850). Também H. STRATTNER ×3, SENAI ×3, DELL ×2, DHL, DELTA COWORKING.
--   (b) SEM O ANO: número nacional com o prefixo do ano (2600000000053) lançado no Alvo só com o sequencial (53) —
--       NET EVENTOS, CARDIOCENTER, CIRCULO FILMES (e EDER PAULO MARTINS 2500000000131, lançada como NF-e 131).
-- Solução: sem título pelo número no CNPJ da nota (e sem citação), vale, nesta ordem:
--   3) título de OUTRA filial (8 primeiros dígitos iguais, CNPJ de 14 dígitos) com o mesmo número;
--   4) título do mesmo CNPJ com o número sem o prefixo do ano (13–15 dígitos começando pelo AA da emissão);
--   sempre com o mesmo valor (serviço ou líquido, ±R$ 0,01) e nunca projeção. Um vínculo por nota, na ordem de
--   confiança número > citado na nota > outra filial > sem o ano. alvo_vinculo ganha 'numero_outra_filial' e
--   'numero_sem_ano'; coluna nova no fim: alvo_cnpj (o CNPJ do título achado no Alvo).
-- Comparado antes de aplicar (consulta só de leitura, 17/11/2026): 1.678 notas nos dois corpos, 1 linha por nota;
--   15 mudam — 14 de nao_lancada para lancada_nfse (as 149 não lançadas com situação fiscal normal caem para 135) e
--   1 de sem_dado_alvo para lancada_outra_especie (EDER, NF-e 131); 0 nota já ligada muda.
-- Não entra (de propósito): número "vizinho" (diferença de 1–2 no número) — duvidoso, segue não lançada.
-- create or replace: mesmas colunas na mesma ordem + 1 no fim; security_invoker mantido; ACL preservado.
-- Rollback: NFSE-1.18-vinculo-filial-ano-rollback.sql (lógica da 1.2-B, com alvo_cnpj mantida — sem DROP).
-- =====================================================================

do $$
begin
  if (select count(*) from public.compras_pedidos) < 2000 then
    raise exception 'Fingerprint: não parece o Financial Hub';
  end if;
  if (select md5(pg_get_viewdef('public.v_nfse_recebida'::regclass, true))) <> 'c2f53be029d616bee002c3b3547f5629' then
    raise exception 'v_nfse_recebida mudou desde a leitura de 17/11 — conferir antes de aplicar';
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
        ), por_raiz AS (
         -- NFSE-1.18: sem título pelo número no CNPJ da nota, vale o título de OUTRA filial do mesmo prestador
         -- (mesma raiz de CNPJ, 8 primeiros dígitos) com o mesmo número e o mesmo valor, nunca projeção
         -- (ex.: HORA PARK 3613133 — nota do CNPJ ...005798, lançada no Alvo no cadastro ...003159)
         SELECT DISTINCT ON (n.chave_acesso) n.chave_acesso,
            t.cnpj, t.num, t.tem_nfse, t.especies, t.chave_docfin, t.chave_movestq, t.data_entrada, t.valor, t.parcelas,
            t.pagas, t.abertas, t.agrupadas, t.pedido_titulo, t.doc_numero,
            'numero_outra_filial'::text AS vinculo
           FROM nota n
             JOIN titulo t ON left(t.cnpj, 8) = left(n.prestador_doc, 8) AND t.num = n.num AND t.cnpj <> n.prestador_doc
          WHERE length(n.prestador_doc) = 14 AND length(t.cnpj) = 14 AND NOT t.so_projecao
            AND (abs(t.valor - n.valor_servico) <= 0.01 OR abs(t.valor - n.valor_liquido) <= 0.01)
          ORDER BY n.chave_acesso, t.cnpj
        ), por_sem_ano AS (
         -- NFSE-1.18: número nacional com o prefixo do ano (AA + sequencial: 2600000000053) lançado no Alvo só com o
         -- sequencial (53) — mesmo CNPJ, mesmo valor, nunca projeção
         SELECT DISTINCT ON (n.chave_acesso) n.chave_acesso,
            t.cnpj, t.num, t.tem_nfse, t.especies, t.chave_docfin, t.chave_movestq, t.data_entrada, t.valor, t.parcelas,
            t.pagas, t.abertas, t.agrupadas, t.pedido_titulo, t.doc_numero,
            'numero_sem_ano'::text AS vinculo
           FROM nota n
             JOIN titulo t ON t.cnpj = n.prestador_doc AND t.num = ltrim(substr(n.numero, 3), '0'::text)
          WHERE n.numero ~ '^[0-9]{13,15}$'::text AND left(n.numero, 2) = to_char(n.data_emissao::timestamp, 'YY'::text)
            AND ltrim(substr(n.numero, 3), '0'::text) <> ''::text AND NOT t.so_projecao
            AND (abs(t.valor - n.valor_servico) <= 0.01 OR abs(t.valor - n.valor_liquido) <= 0.01)
          ORDER BY n.chave_acesso, t.num
        ), vinculo AS (
         -- NFSE-1.18: 1 vínculo por nota, na ordem de confiança: número > citado na nota > outra filial > sem o ano
         SELECT DISTINCT ON (u.chave_acesso) u.*
           FROM ( SELECT 1 AS prioridade, por_numero.* FROM por_numero
                 UNION ALL
                  SELECT 2, por_citacao.* FROM por_citacao
                 UNION ALL
                  SELECT 3, por_raiz.* FROM por_raiz
                 UNION ALL
                  SELECT 4, por_sem_ano.* FROM por_sem_ano) u
          ORDER BY u.chave_acesso, u.prioridade
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
    t.doc_numero AS alvo_doc_numero,
    t.cnpj AS alvo_cnpj
   FROM nota n
     LEFT JOIN evento ev ON ev.chave_acesso = n.chave_acesso
     LEFT JOIN vinculo t ON t.chave_acesso = n.chave_acesso
;

comment on view public.v_nfse_recebida is
  'NFSE-1.2 (PLANO-NFSE.md): 1 linha por NFS-e do ADN com a P&F tomadora. situacao_fisco = o que o FISCO diz '
  '(eventos do ADN); situacao_alvo = o que o ALVO tem (fin_parcelas_pagar, regra da NFSE-0.6; NFSE-1.2-B: também '
  'o título do mesmo CNPJ cujo número a nota cita, com o mesmo valor; NFSE-1.18: também o título de outra filial '
  'do prestador com o mesmo número, ou com o número sem o prefixo do ano, sempre com o mesmo valor — alvo_vinculo '
  'diz qual e alvo_cnpj o CNPJ do título). Lida só pelas RPCs nfse_recebidas_listar / nfse_recebida_detalhe / '
  'nfse_recebida_xml e pelos relatórios.';
