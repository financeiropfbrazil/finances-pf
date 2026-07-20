-- ============================================================
-- D-010 etapa 2 — ROLLBACK (sem DROP VIEW)
-- Reverte a SEMÂNTICA: valor_despesa volta a somar TUDO e valor_fora_controle
-- vira 0. NÃO remove a coluna valor_fora_controle (CREATE OR REPLACE não dropa
-- coluna, e DROP VIEW está vetado) — ela fica inofensiva (constante 0), as RPCs
-- antigas não a selecionam. Restaura o total original R$ 31.831.095,41.
-- A view mantém as 15 colunas na MESMA ordem da etapa 2 (exigência do CREATE OR REPLACE).
-- ============================================================
begin;

-- 1. View revertida: valor_despesa = soma de tudo (comportamento original);
--    valor_fora_controle = 0 (última coluna, mesma posição/tipo da etapa 2). Sem LEFT JOIN.
CREATE OR REPLACE VIEW public.v_despesa_realizada_unificada_base AS
 SELECT 'MovEstq'::text AS fonte,
    d.chave_movestq::text AS chave,
    d.codigo_empresa_filial AS filial,
    d.especie, d.numero, d.data_competencia,
    d.codigo_entidade, d.nome_entidade, d.cpf_cnpj_entidade,
    r.ano, r.mes,
    sum(r.valor_brl) AS valor_despesa,
    count(*) AS qtd_rateios,
    count(DISTINCT r.codigo_centro_ctrl) AS qtd_ccs,
    0::numeric AS valor_fora_controle
   FROM desp_realizado_doc d
     JOIN desp_realizado_rateio r ON r.codigo_empresa_filial = d.codigo_empresa_filial AND r.chave_movestq = d.chave_movestq
  GROUP BY d.chave_movestq, d.codigo_empresa_filial, d.especie, d.numero, d.data_competencia, d.codigo_entidade, d.nome_entidade, d.cpf_cnpj_entidade, r.ano, r.mes
UNION ALL
 SELECT 'DocFin'::text AS fonte,
    d.chave_docfin::text AS chave,
    d.codigo_empresa_filial AS filial,
    d.especie, d.numero, d.data_competencia,
    d.codigo_entidade, d.nome_entidade, d.cpf_cnpj_entidade,
    r.ano, r.mes,
    sum(r.valor_brl) AS valor_despesa,
    count(*) AS qtd_rateios,
    count(DISTINCT r.codigo_centro_ctrl) AS qtd_ccs,
    0::numeric AS valor_fora_controle
   FROM desp_docfin_doc d
     JOIN desp_docfin_rateio r ON r.codigo_empresa_filial = d.codigo_empresa_filial AND r.chave_docfin = d.chave_docfin
  GROUP BY d.chave_docfin, d.codigo_empresa_filial, d.especie, d.numero, d.data_competencia, d.codigo_entidade, d.nome_entidade, d.cpf_cnpj_entidade, r.ano, r.mes;

-- 2. RPC listar original (resumo sem soma_fora_controle; não seleciona valor_fora_controle)
CREATE OR REPLACE FUNCTION public.listar_despesa_realizada_unificada(p_ano integer DEFAULT NULL::integer, p_mes integer DEFAULT NULL::integer, p_fonte text DEFAULT NULL::text, p_especie text DEFAULT NULL::text, p_busca text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
  v_soma  numeric;
  v_items jsonb;
  v_like  text;
BEGIN
  IF NOT _is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores';
  END IF;
  IF p_limit > 100 THEN p_limit := 100; END IF;
  IF p_limit < 1   THEN p_limit := 20;  END IF;
  IF p_offset < 0  THEN p_offset := 0;   END IF;
  v_like := CASE WHEN p_busca IS NULL OR length(trim(p_busca)) = 0
                 THEN NULL ELSE '%' || lower(trim(p_busca)) || '%' END;
  WITH filtrada AS (
    SELECT b.fonte, b.chave, b.filial, b.especie, b.numero,
           b.data_competencia, b.ano, b.mes,
           b.codigo_entidade, b.nome_entidade, b.cpf_cnpj_entidade,
           b.valor_despesa, b.qtd_rateios, b.qtd_ccs
    FROM v_despesa_realizada_unificada_base b
    WHERE (p_ano     IS NULL OR b.ano = p_ano)
      AND (p_mes     IS NULL OR b.mes = p_mes)
      AND (p_fonte   IS NULL OR b.fonte = p_fonte)
      AND (p_especie IS NULL OR b.especie = p_especie)
      AND (v_like IS NULL
           OR lower(coalesce(b.nome_entidade, '')) LIKE v_like
           OR lower(coalesce(b.codigo_entidade, '')) LIKE v_like
           OR lower(coalesce(b.numero, '')) LIKE v_like)
  ),
  totais AS (
    SELECT count(*) AS total, COALESCE(sum(valor_despesa), 0) AS soma FROM filtrada
  ),
  pagina AS (
    SELECT * FROM filtrada
    ORDER BY data_competencia DESC NULLS LAST, fonte, chave
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    (SELECT total FROM totais),
    (SELECT soma FROM totais),
    COALESCE((SELECT jsonb_agg(row_to_json(pagina)) FROM pagina), '[]'::jsonb)
  INTO v_total, v_soma, v_items;
  RETURN jsonb_build_object(
    'items', v_items,
    'pagination', jsonb_build_object(
      'total', v_total, 'page', (p_offset / p_limit) + 1, 'page_size', p_limit,
      'total_pages', CASE WHEN v_total = 0 THEN 1 ELSE CEIL(v_total::numeric / p_limit)::int END
    ),
    'resumo', jsonb_build_object('total_docs', v_total, 'soma_brl', v_soma)
  );
END;
$function$;

-- 3. RPC get_despesa_realizada_rateios original (sem em_controle no retorno)
CREATE OR REPLACE FUNCTION public.get_despesa_realizada_rateios(p_fonte text, p_chave text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rateios jsonb;
  v_chave   bigint;
BEGIN
  IF NOT _is_admin() THEN
    RAISE EXCEPTION 'Acesso restrito a administradores';
  END IF;
  v_chave := p_chave::bigint;
  IF p_fonte = 'MovEstq' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rateios
    FROM (
      SELECT r.ordem_classe, r.codigo_classe, r.ordem_rateio,
             r.codigo_centro_ctrl, cc.name AS nome_centro_ctrl,
             r.valor_brl, r.percentual, r.classificacao, r.categoria
      FROM desp_realizado_rateio r
      LEFT JOIN cost_centers cc ON cc.erp_code = r.codigo_centro_ctrl
      WHERE r.chave_movestq = v_chave
      ORDER BY r.ordem_classe, r.ordem_rateio
    ) t;
  ELSIF p_fonte = 'DocFin' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rateios
    FROM (
      SELECT r.ordem_classe, r.codigo_classe, r.ordem_rateio,
             r.codigo_centro_ctrl, cc.name AS nome_centro_ctrl,
             r.valor_brl, r.percentual, r.classificacao, r.categoria
      FROM desp_docfin_rateio r
      LEFT JOIN cost_centers cc ON cc.erp_code = r.codigo_centro_ctrl
      WHERE r.chave_docfin = v_chave
      ORDER BY r.ordem_classe, r.ordem_rateio
    ) t;
  ELSE
    RAISE EXCEPTION 'Fonte inválida: % (esperado MovEstq ou DocFin)', p_fonte;
  END IF;
  RETURN v_rateios;
END;
$function$;

commit;

-- Validação pós-rollback: total volta ao original, fora fixo em 0:
--   select round(sum(valor_despesa),2) total, round(sum(valor_fora_controle),2) fora
--   from v_despesa_realizada_unificada_base;   -- 31831095.41 / 0.00
