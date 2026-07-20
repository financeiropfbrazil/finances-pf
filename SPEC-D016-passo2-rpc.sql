-- ============================================================================
-- SPEC-D016 — PASSO 2 (banco): RPC desp_registrar_orfaos
-- ----------------------------------------------------------------------------
-- Projeto: hbtggrbauguukewiknew  |  Data: 2026-07-20  |  Card: D-016
-- Revisão 2 (20/07): correção do bug de chave duplicada no lote — ver abaixo.
--
-- ⚠️ APLICAR EM TRÊS EXECUÇÕES SEPARADAS (armadilha 34).
--    NÃO envolver em BEGIN...COMMIT único: o rollback esconde o erro real.
--    Rodar a PARTE 1, conferir; PARTE 2, conferir; PARTE 3 (verificação).
--
-- Substitui o .upsert() do cliente JS, que sobrescreveria as colunas enviadas e
-- com isso APAGARIA DECISÃO HUMANA: um órfão marcado como IGNORADO voltaria a
-- DETECTADO na rodada seguinte, em silêncio, e o mesmo caso seria reanalisado
-- para sempre. Mesma família do problema que o D-016 existe para resolver.
--
-- ----------------------------------------------------------------------------
-- REVISÃO 2 — bug corrigido (achado do Pedro, 20/07):
--   Se p_linhas contiver a MESMA chave duas vezes, o Postgres aborta com
--     ERROR 21000: ON CONFLICT DO UPDATE command cannot affect row a second time
--   Caminho concreto: a paginação que monta `chavesNoBanco` no proxy usa
--   .range() SEM .order() — sem ordenação explícita o Postgres não garante
--   ordem estável entre páginas, e a mesma linha pode vir em duas.
--   É EXATAMENTE o mecanismo diagnosticado como causa raiz do D-006.
--   Defesa em profundidade: (a) DISTINCT ON aqui; (b) .order() no proxy.
--   Ver armadilha 36 e card D-018 no PLANO-DESPESAS.md.
-- ============================================================================


-- ############################################################################
-- PARTE 1 — a função (executar SOZINHA; corpo $$)
-- ############################################################################

CREATE OR REPLACE FUNCTION public.desp_registrar_orfaos(p_linhas jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inseridos    integer := 0;
  v_atualizados  integer := 0;
  v_sem_snapshot integer := 0;
  v_recebidas    integer := 0;
  v_distintas    integer := 0;
BEGIN
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'D016: p_linhas deve ser um array jsonb';
  END IF;

  -- GUARDA DE ENTRADA: snapshot é o motivo de existir desta tabela.
  -- Linha sem doc_json seria uma quarentena inútil -> aborta antes de gravar.
  SELECT count(*) INTO v_sem_snapshot
  FROM jsonb_array_elements(p_linhas) AS e
  WHERE e->'doc_json' IS NULL OR jsonb_typeof(e->'doc_json') = 'null';

  IF v_sem_snapshot > 0 THEN
    RAISE EXCEPTION 'D016: % linha(s) sem doc_json - registro abortado', v_sem_snapshot;
  END IF;

  WITH bruto AS (
    SELECT * FROM jsonb_populate_recordset(null::public.desp_docfin_orfaos, p_linhas)
  ),
  -- ══════════════════════════════════════════════════════════════════════════
  -- DEDUP OBRIGATÓRIO (revisão 2). Sem isto, chave repetida no MESMO lote faz
  -- o ON CONFLICT abortar com 21000 ("cannot affect row a second time").
  -- Desempate: fica a linha MAIS INFORMATIVA (com rateios, mais rateios).
  -- Se preferir o critério mínimo, corte o ORDER BY após chave_docfin.
  -- ══════════════════════════════════════════════════════════════════════════
  entrada AS (
    SELECT DISTINCT ON (codigo_empresa_filial, chave_docfin) *
    FROM bruto
    ORDER BY codigo_empresa_filial,
             chave_docfin,
             (rateios_json IS NOT NULL) DESC,
             n_rateios DESC NULLS LAST
  ),
  gravado AS (
    INSERT INTO public.desp_docfin_orfaos AS o (
      codigo_empresa_filial, chave_docfin, competencia, ano, mes,
      especie, numero, codigo_entidade, nome_entidade,
      valor_documento, valor_rateio_total, n_rateios,
      data_emissao, codigo_situacao, sync_em_original,
      doc_json, rateios_json, origem_rodada,
      -- colunas de controle: valores iniciais explícitos (não confiar em DEFAULT)
      status, primeira_deteccao_em, ultima_deteccao_em, n_deteccoes,
      created_at, updated_at
    )
    SELECT
      x.codigo_empresa_filial, x.chave_docfin, x.competencia, x.ano, x.mes,
      x.especie, x.numero, x.codigo_entidade, x.nome_entidade,
      x.valor_documento, x.valor_rateio_total, x.n_rateios,
      x.data_emissao, x.codigo_situacao, x.sync_em_original,
      x.doc_json, x.rateios_json, x.origem_rodada,
      'DETECTADO', now(), now(), 1,
      now(), now()
    FROM entrada AS x
    ON CONFLICT (codigo_empresa_filial, chave_docfin) DO UPDATE SET
      -- ══════════════ ATUALIZA (fatos do documento, vindos do Alvo) ══════════
      competencia         = EXCLUDED.competencia,
      ano                 = EXCLUDED.ano,
      mes                 = EXCLUDED.mes,
      especie             = EXCLUDED.especie,
      numero              = EXCLUDED.numero,
      codigo_entidade     = EXCLUDED.codigo_entidade,
      nome_entidade       = EXCLUDED.nome_entidade,
      valor_documento     = EXCLUDED.valor_documento,
      valor_rateio_total  = EXCLUDED.valor_rateio_total,
      n_rateios           = EXCLUDED.n_rateios,
      data_emissao        = EXCLUDED.data_emissao,
      codigo_situacao     = EXCLUDED.codigo_situacao,
      sync_em_original    = EXCLUDED.sync_em_original,
      doc_json            = EXCLUDED.doc_json,        -- refresca o snapshot
      rateios_json        = EXCLUDED.rateios_json,
      origem_rodada       = EXCLUDED.origem_rodada,   -- última rodada que detectou
      ultima_deteccao_em  = now(),
      n_deteccoes         = o.n_deteccoes + 1,        -- incrementa de verdade
      updated_at          = now()
      -- ══════════════ PRESERVA — NUNCA sobrescrever ═════════════════════════
      --   status                -> decisão humana (IGNORADO/REMOVIDO/RESTAURADO)
      --   primeira_deteccao_em  -> quando o problema apareceu pela 1ª vez
      --   removido_em           -> histórico da remoção
      --   removido_por          -> histórico da remoção
      --   restaurado_em         -> histórico da restauração
      --   tem_gemeo             -> análise humana/agente
      --   gemeo_fonte           -> análise humana/agente
      --   gemeo_ref             -> análise humana/agente
      --   observacao            -> texto humano
      --   id, created_at        -> identidade da linha
      -- (a ausência dessas colunas neste SET é INTENCIONAL — não "acrescentar
      --  o que faltou": omitir aqui é o que as protege)
    RETURNING (xmax = 0) AS foi_insert
  )
  SELECT
    (SELECT count(*) FROM bruto),
    (SELECT count(*) FROM entrada),
    count(*) FILTER (WHERE foi_insert),
    count(*) FILTER (WHERE NOT foi_insert)
  INTO v_recebidas, v_distintas, v_inseridos, v_atualizados
  FROM gravado;

  RETURN jsonb_build_object(
    'inseridos',            v_inseridos,
    'atualizados',          v_atualizados,
    'total',                v_inseridos + v_atualizados,
    'recebidas',            v_recebidas,
    -- ⚠️ SINAL DE DIAGNÓSTICO: > 0 significa que o proxy mandou a MESMA chave
    -- mais de uma vez no lote, ou seja, PAGINAÇÃO INSTÁVEL (armadilha 36).
    -- A RPC absorve sem quebrar, mas o proxy precisa ser corrigido (D-018).
    'duplicadas_no_lote',   v_recebidas - v_distintas
  );
END
$$;


-- ############################################################################
-- PARTE 2 — permissões (executar SOZINHA, depois de conferir a PARTE 1)
--           REVOKE ALL FROM public derruba o service_role junto (armadilha 35)
-- ############################################################################

REVOKE ALL ON FUNCTION public.desp_registrar_orfaos(jsonb)
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.desp_registrar_orfaos(jsonb)
  TO service_role;


-- ############################################################################
-- PARTE 3 — verificação (executar SOZINHA)
-- ############################################################################

-- V1. Função criada, SECURITY DEFINER, grants no alvo exato
SELECT p.proname,
       p.prosecdef AS security_definer,                                                              -- t
       has_function_privilege('service_role',  'public.desp_registrar_orfaos(jsonb)', 'EXECUTE') AS exec_service,  -- t
       has_function_privilege('anon',          'public.desp_registrar_orfaos(jsonb)', 'EXECUTE') AS exec_anon,     -- f
       has_function_privilege('authenticated', 'public.desp_registrar_orfaos(jsonb)', 'EXECUTE') AS exec_auth      -- f
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'desp_registrar_orfaos';

-- V2. GUARDA DE ENTRADA: linha sem doc_json deve levantar exceção
BEGIN;
SELECT public.desp_registrar_orfaos(
  '[{"codigo_empresa_filial":"1.01","chave_docfin":999999999,
     "competencia":"2026-06-01","ano":2026,"mes":6}]'::jsonb);
ROLLBACK;
-- ESPERADO: ERRO 'D016: 1 linha(s) sem doc_json - registro abortado'
-- ⚠️ Se retornar {"inseridos":1,...}, a guarda NÃO está funcionando.

-- V3. TESTE DE PRESERVAÇÃO — o que motivou trocar o .upsert() pela RPC.
--     Insere, marca como IGNORADO com análise humana, re-registra e confere
--     que a decisão SOBREVIVEU. Tudo dentro de transação abortada.
BEGIN;

-- 3a. primeira detecção
SELECT public.desp_registrar_orfaos(
  '[{"codigo_empresa_filial":"1.01","chave_docfin":999999999,
     "competencia":"2026-06-01","ano":2026,"mes":6,
     "especie":"PC","numero":"TESTE-D016","valor_documento":100.00,
     "valor_rateio_total":100.00,"n_rateios":1,
     "doc_json":{"teste":"v1"},"origem_rodada":"teste"}]'::jsonb);
-- esperado: {"inseridos":1,"atualizados":0,"total":1,"recebidas":1,"duplicadas_no_lote":0}

-- 3b. decisão humana + análise de gêmeo
UPDATE public.desp_docfin_orfaos
   SET status='IGNORADO', observacao='decisao humana de teste',
       tem_gemeo=true, gemeo_fonte='movestq', gemeo_ref='chave_movestq=123'
 WHERE chave_docfin=999999999;

-- 3c. segunda detecção (a rodada seguinte do cron)
SELECT public.desp_registrar_orfaos(
  '[{"codigo_empresa_filial":"1.01","chave_docfin":999999999,
     "competencia":"2026-06-01","ano":2026,"mes":6,
     "especie":"PC","numero":"TESTE-D016","valor_documento":100.00,
     "valor_rateio_total":100.00,"n_rateios":1,
     "doc_json":{"teste":"v2"},"origem_rodada":"teste2"}]'::jsonb);
-- esperado: {"inseridos":0,"atualizados":1,"total":1,...}

-- 3d. conferência
SELECT status,                                   -- IGNORADO  (PRESERVADO)
       observacao,                               -- 'decisao humana de teste' (PRESERVADO)
       tem_gemeo, gemeo_fonte, gemeo_ref,        -- true / movestq / ... (PRESERVADOS)
       n_deteccoes,                              -- 2  (INCREMENTOU)
       doc_json->>'teste',                       -- v2 (SNAPSHOT REFRESCADO)
       origem_rodada,                            -- teste2 (ATUALIZADO)
       primeira_deteccao_em = ultima_deteccao_em AS mesmas_datas  -- f (1ª PRESERVADA)
  FROM public.desp_docfin_orfaos
 WHERE chave_docfin = 999999999;

ROLLBACK;
-- ⚠️ Se `status` vier 'DETECTADO' ou os campos de gêmeo vierem nulos,
--    o ON CONFLICT está sobrescrevendo o que não devia -> NÃO prosseguir.

-- ════════════════════════════════════════════════════════════════════════════
-- V5. TESTE DA CHAVE DUPLICADA NO LOTE (revisão 2 — o bug que o Pedro achou).
--     Mesma chave duas vezes no MESMO array. Sem o DISTINCT ON isto aborta com
--       ERROR 21000: ON CONFLICT DO UPDATE command cannot affect row a second time
--     Com o DISTINCT ON, tem de gravar UMA linha e ACUSAR a duplicata.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;
SELECT public.desp_registrar_orfaos(
  '[{"codigo_empresa_filial":"1.01","chave_docfin":999999999,
     "competencia":"2026-06-01","ano":2026,"mes":6,
     "especie":"PC","numero":"DUP-1","valor_documento":100.00,
     "n_rateios":1,"doc_json":{"v":"a"},"origem_rodada":"teste"},
    {"codigo_empresa_filial":"1.01","chave_docfin":999999999,
     "competencia":"2026-06-01","ano":2026,"mes":6,
     "especie":"PC","numero":"DUP-2","valor_documento":100.00,
     "n_rateios":1,"doc_json":{"v":"b"},"origem_rodada":"teste"}]'::jsonb);
-- ESPERADO: {"inseridos":1,"atualizados":0,"total":1,
--            "recebidas":2,"duplicadas_no_lote":1}
-- ⚠️ Se der ERROR 21000, o DISTINCT ON não está ativo -> NÃO prosseguir.

SELECT count(*) AS deve_ser_1 FROM public.desp_docfin_orfaos WHERE chave_docfin = 999999999;
ROLLBACK;

-- V6. Confirmar que os testes não deixaram resíduo
SELECT count(*) AS deve_ser_zero
  FROM public.desp_docfin_orfaos WHERE chave_docfin = 999999999;


-- ============================================================================
-- ROLLBACK DESTA PARTE
-- ============================================================================
-- DROP FUNCTION IF EXISTS public.desp_registrar_orfaos(jsonb);
