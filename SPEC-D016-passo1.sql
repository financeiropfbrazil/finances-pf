-- ============================================================================
-- SPEC-D016 — PASSO 1: quarentena/auditoria de órfãos do DocFin
-- ----------------------------------------------------------------------------
-- Projeto: hbtggrbauguukewiknew  |  Data: 2026-07-20  |  Card: D-016
-- Aplicar pelo SQL Editor do Supabase (MCP está read-only).
--
-- Aditivo e isolado:
--   * nenhuma tabela existente é alterada
--   * nenhuma FK aponta para a tabela nova
--   * rollback no rodapé deste arquivo
--
-- Objetivo: nenhum documento é apagado sem que exista, JÁ COMMITADO, um
-- snapshot completo dele. O snapshot é gravado NA DETECÇÃO (quando o doc
-- ainda existe), não na remoção.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tabela de quarentena
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.desp_docfin_orfaos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- identificação
  codigo_empresa_filial text        NOT NULL,
  chave_docfin          bigint      NOT NULL,
  competencia           date        NOT NULL,
  ano                   integer     NOT NULL,   -- ano/mes DO RATEIO (armadilha 24)
  mes                   integer     NOT NULL,

  -- negócio (desnormalizado: consulta sem abrir o jsonb)
  especie               text,
  numero                text,
  codigo_entidade       text,
  nome_entidade         text,
  valor_documento       numeric,
  valor_rateio_total    numeric,                -- o que sai do total se for removido
  n_rateios             integer,
  data_emissao          date,
  codigo_situacao       text,
  sync_em_original      timestamptz,            -- o sync_em que o marcou como órfão

  -- SNAPSHOT COMPLETO — é isto que torna a deleção reversível
  doc_json              jsonb       NOT NULL,   -- to_jsonb(desp_docfin_doc), inclui payload_alvo
  rateios_json          jsonb,                  -- array de to_jsonb(desp_docfin_rateio)

  -- ciclo de vida
  status                text        NOT NULL DEFAULT 'DETECTADO'
                        CHECK (status IN ('DETECTADO','REMOVIDO','RESTAURADO','IGNORADO')),
  primeira_deteccao_em  timestamptz NOT NULL DEFAULT now(),
  ultima_deteccao_em    timestamptz NOT NULL DEFAULT now(),
  n_deteccoes           integer     NOT NULL DEFAULT 1,
  removido_em           timestamptz,
  removido_por          text,
  restaurado_em         timestamptz,
  origem_rodada         text,                   -- 'cron' | 'manual_admin' | ...
  observacao            text,

  -- análise de gêmeo (preenchida por rotina/agente, NUNCA pelo motor)
  tem_gemeo             boolean,
  gemeo_fonte           text,                   -- 'movestq' | 'docfin'
  gemeo_ref             text,                   -- ex.: 'chave_movestq=17290 NFS-e 32'

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_desp_docfin_orfaos UNIQUE (codigo_empresa_filial, chave_docfin)
);

CREATE INDEX IF NOT EXISTS ix_desp_orfaos_comp   ON public.desp_docfin_orfaos (ano, mes);
CREATE INDEX IF NOT EXISTS ix_desp_orfaos_status ON public.desp_docfin_orfaos (status);
CREATE INDEX IF NOT EXISTS ix_desp_orfaos_remov  ON public.desp_docfin_orfaos (removido_em DESC);

-- RLS ativo e SEM policies (armadilha 2): acesso só via RPC SECURITY DEFINER.
-- O proxy grava com service_role, que tem rolbypassrls = true (verificado
-- em 20/07/2026), portanto a gravação do snapshot NÃO é bloqueada.
ALTER TABLE public.desp_docfin_orfaos ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.desp_docfin_orfaos IS
  'D-016: quarentena de docs orfaos do DocFin. Snapshot gravado NA DETECCAO (doc ainda existe); '
  'delecao so via desp_remover_orfaos_verificado, na mesma transacao, apos verificar o snapshot.';

-- ---------------------------------------------------------------------------
-- 2. RPC de deleção atômica e verificada
--    O cliente JS do Supabase NAO abre transacao: a atomicidade vive aqui.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.desp_remover_orfaos_verificado(
  p_filial  text,
  p_chaves  bigint[],
  p_origem  text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sem_snapshot bigint[];
  v_removidos    int     := 0;
  v_valor        numeric := 0;
BEGIN
  -- GUARDA: nenhuma chave pode ser apagada sem snapshot commitado e nao-nulo.
  -- Se UMA estiver desprotegida, NINGUEM sai (validado: caso misto aborta tudo).
  SELECT array_agg(c) INTO v_sem_snapshot
  FROM unnest(p_chaves) AS c
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.desp_docfin_orfaos AS o
    WHERE o.codigo_empresa_filial = p_filial
      AND o.chave_docfin          = c
      AND o.doc_json IS NOT NULL
  );

  IF v_sem_snapshot IS NOT NULL THEN
    RAISE EXCEPTION 'D016: % chave(s) sem snapshot - remocao abortada: %',
      array_length(v_sem_snapshot, 1), v_sem_snapshot;
  END IF;

  SELECT coalesce(sum(r.valor_brl), 0) INTO v_valor
  FROM public.desp_docfin_rateio AS r
  WHERE r.codigo_empresa_filial = p_filial
    AND r.chave_docfin = ANY(p_chaves);

  DELETE FROM public.desp_docfin_rateio AS r
   WHERE r.codigo_empresa_filial = p_filial
     AND r.chave_docfin = ANY(p_chaves);

  DELETE FROM public.desp_docfin_doc AS d
   WHERE d.codigo_empresa_filial = p_filial
     AND d.chave_docfin = ANY(p_chaves);
  GET DIAGNOSTICS v_removidos = ROW_COUNT;

  UPDATE public.desp_docfin_orfaos AS o
     SET status        = 'REMOVIDO',
         removido_em   = now(),
         removido_por  = p_origem,
         origem_rodada = p_origem,
         updated_at    = now()
   WHERE o.codigo_empresa_filial = p_filial
     AND o.chave_docfin = ANY(p_chaves)
     AND o.status <> 'REMOVIDO';

  RETURN jsonb_build_object('removidos', v_removidos, 'valor_rateio', v_valor);
END
$$;

REVOKE ALL ON FUNCTION public.desp_remover_orfaos_verificado(text, bigint[], text)
  FROM public, anon, authenticated;

COMMIT;


-- ============================================================================
-- VERIFICAÇÃO — rodar DEPOIS, fora da transação acima
-- ============================================================================

-- V1. Tabela criada, vazia, RLS ativo, zero policies
SELECT (SELECT count(*)        FROM public.desp_docfin_orfaos)                        AS linhas,     -- 0
       (SELECT relrowsecurity  FROM pg_class WHERE relname = 'desp_docfin_orfaos')    AS rls_ativo,  -- t
       (SELECT count(*)        FROM pg_policies WHERE tablename = 'desp_docfin_orfaos') AS policies; -- 0

-- V2. Índices e unique
SELECT indexname
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'desp_docfin_orfaos'
 ORDER BY 1;
-- esperado: desp_docfin_orfaos_pkey · ix_desp_orfaos_comp · ix_desp_orfaos_remov
--           · ix_desp_orfaos_status · uq_desp_docfin_orfaos

-- V3. Função criada como SECURITY DEFINER, sem grant público
SELECT p.proname,
       p.prosecdef AS security_definer,
       coalesce(array_to_string(p.proacl, ','), '(sem ACL publica)') AS acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'desp_remover_orfaos_verificado';
-- esperado: security_definer = t

-- V4. TESTE DA GUARDA — o mais importante.
--     Chave inexistente na quarentena => a funcao DEVE levantar exceção.
--     Envelopado em transacao abortada por seguranca.
BEGIN;
SELECT public.desp_remover_orfaos_verificado('1.01', ARRAY[999999999]::bigint[], 'teste_guarda');
ROLLBACK;
-- ESPERADO: ERRO
--   'D016: 1 chave(s) sem snapshot - remocao abortada: {999999999}'
--
-- ⚠️ Se retornar {"removidos":0,"valor_rateio":0} EM VEZ de erro, a guarda NAO
--    esta funcionando -> NAO prosseguir para o passo 2.
--
-- Comportamento validado por simulação em 20/07 (expressão testada contra
-- tabela existente, 4 cenários):
--   chave sem snapshot ....... array devolvido -> dispara
--   chave com snapshot ....... NULL            -> nao dispara
--   array vazio .............. NULL            -> nao dispara, nada apagado
--   misto (1 com + 1 sem) .... array devolvido -> dispara e aborta TUDO


-- ============================================================================
-- ROLLBACK DO PASSO 1
-- ============================================================================
-- DROP FUNCTION IF EXISTS public.desp_remover_orfaos_verificado(text, bigint[], text);
-- DROP TABLE    IF EXISTS public.desp_docfin_orfaos;
