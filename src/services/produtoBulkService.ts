/**
 * Service de edição em massa de produtos.
 *
 * Responsabilidades:
 * - Cliente para as 3 rotas do erp-proxy /produto/* (list-by-alternativos, load, save-partial)
 * - Wrappers das RPCs SECURITY DEFINER (bulk_edit_*) no Supabase
 * - Helpers de montagem de payload SavePartial mínimo seguro
 *
 * NÃO contém lógica de UI nem de wizard. É puramente camada de serviço,
 * chamada pelas páginas em src/pages/ferramentas/.
 */

import { supabase } from "@/integrations/supabase/client";

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";

// ─── Tipos públicos ───────────────────────────────────────────────

export type BulkJobTipo = "produtos_campos" | "produtos_unidade_medida";

export type BulkJobStatus = "pendente" | "em_execucao" | "concluido" | "concluido_com_erros" | "falhou" | "revertido";

export type BulkItemStatus = "pendente" | "pulado" | "sucesso" | "falha" | "revertido";

export interface ProdutoLookupResult {
  found: Array<{
    alternativo: string;
    codigo: string;
    nome: string;
    status: string;
  }>;
  not_found: string[];
}

export interface BulkJob {
  id: string;
  tipo: BulkJobTipo;
  status: BulkJobStatus;
  criado_por: string;
  criado_em: string;
  iniciado_em: string | null;
  concluido_em: string | null;
  total_itens: number;
  itens_sucesso: number;
  itens_falha: number;
  itens_pulado: number;
  campos_alterados: string[];
  observacoes: string | null;
}

export interface BulkJobItem {
  id: string;
  job_id: string;
  sequencia: number;
  identificador: string;
  codigo_alvo: string | null;
  status: BulkItemStatus;
  snapshot_antes: any;
  payload_enviado: any;
  response_alvo: any;
  http_status: number | null;
  erro_mensagem: string | null;
  processado_em: string | null;
  revertido_em: string | null;
  reverted_payload: any;
}

// ─── Helpers internos ─────────────────────────────────────────────

async function getSupabaseJWT(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sessão do Supabase inválida. Faça login novamente.");
  }
  return session.access_token;
}

async function callGatewayProduto(path: string, method: "GET" | "POST", body?: unknown): Promise<any> {
  const jwt = await getSupabaseJWT();
  const url = `${ERP_PROXY_URL}${path}`;

  const resp = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    ...(method === "POST" && body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    // resposta sem body ou inválida
  }

  if (!resp.ok) {
    const msg = data?.error || `HTTP ${resp.status}`;
    const err = new Error(msg) as Error & {
      status?: number;
      details?: any;
    };
    err.status = resp.status;
    err.details = data?.details;
    throw err;
  }

  return data;
}

// ─── 1. Chamadas ao erp-proxy ─────────────────────────────────────

/**
 * Busca produtos no Alvo a partir de uma lista de Códigos Alternativos.
 * Retorna mapa Alternativo → Codigo + lista de não encontrados.
 *
 * Chamada lenta (~10-30s) porque traz a lista completa de produtos do Alvo.
 * Use só uma vez no início do bulk (pre-check).
 */
export async function listProdutosByAlternativos(alternativos: string[]): Promise<ProdutoLookupResult> {
  if (!Array.isArray(alternativos) || alternativos.length === 0) {
    throw new Error("Lista de alternativos vazia.");
  }
  if (alternativos.length > 1000) {
    throw new Error("Máximo 1000 alternativos por chamada.");
  }

  const resp = await callGatewayProduto("/produto/list-by-alternativos", "POST", { alternativos });
  return resp as ProdutoLookupResult;
}

/**
 * Carrega 1 produto completo do Alvo com todas as ChildLists.
 * Usado para snapshot pré-save (backup).
 */
export async function loadProduto(codigo: string): Promise<any> {
  if (!codigo || typeof codigo !== "string") {
    throw new Error("Código do produto é obrigatório.");
  }
  const path = `/produto/load?codigo=${encodeURIComponent(codigo)}`;
  return await callGatewayProduto(path, "GET");
}

/**
 * Dispara o SavePartial?action=Update no Alvo para um produto.
 * Recebe o payload já montado (use montarPayloadSavePartial para construir).
 */
export async function savePartialProduto(payload: any): Promise<any> {
  if (!payload || !payload.Codigo) {
    throw new Error("Payload inválido: campo Codigo obrigatório.");
  }
  return await callGatewayProduto("/produto/save-partial", "POST", payload);
}

// ─── 2. Montagem de payload seguro ────────────────────────────────

/**
 * Monta o payload mínimo seguro para SavePartial?action=Update de produto.
 *
 * Estratégia validada empiricamente:
 * - Envia Codigo (chave) + todos os campos a alterar
 * - Preserva ProdUnidMedChildList simplificada (3 campos por item)
 * - Preserva Produto1Object com ProdLocArmazChildList simplificada (3 campos)
 * - Inclui flags TipoFormulario/UploadIdentify exigidas pelo Alvo
 *
 * O Alvo trata campos não enviados como "preservar valor atual" (merge).
 * Para ChildLists com chave composta (Codigo+CodigoUnidMedida+Posicao), enviar
 * só a chave já preserva a linha — não zera os outros campos.
 *
 * @param loadResult JSON completo retornado por loadProduto()
 * @param novosCampos Objeto com pares { campo: novoValor } a alterar
 */
export function montarPayloadSavePartial(loadResult: any, novosCampos: Record<string, any>): any {
  if (!loadResult || !loadResult.Codigo) {
    throw new Error("loadResult inválido — falta Codigo");
  }

  const codigo = String(loadResult.Codigo);

  // ProdUnidMedChildList simplificada (preserva todas as UMs com formato de 3 campos)
  const unidMedList = Array.isArray(loadResult.ProdUnidMedChildList)
    ? loadResult.ProdUnidMedChildList.map((u: any) => ({
        CodigoProduto: codigo,
        CodigoUnidMedida: u.CodigoUnidMedida,
        Posicao: u.Posicao,
      }))
    : [];

  // ProdLocArmazChildList dentro de Produto1Object (preserva todos os locais)
  const locArmazList = Array.isArray(loadResult.Produto1Object?.ProdLocArmazChildList)
    ? loadResult.Produto1Object.ProdLocArmazChildList.map((l: any) => ({
        CodigoEmpresaFilial: l.CodigoEmpresaFilial,
        CodigoProduto: codigo,
        CodigoLocArmaz: l.CodigoLocArmaz,
      }))
    : [];

  // Payload base (formato validado em produção)
  const payload: any = {
    Codigo: codigo,
    CodigoEntidadeImportacao: null,
    HistoricoProdutoNovo: null,
    NomeTipoProduto: null,
    ProdutoIdAlternativo: null,
    TipoFormulario: "Normal",
    UploadIdentify: "",
    ProdUnidMedChildList: unidMedList,
    Produto1Object: {
      Codigo: codigo,
      ProdLocArmazChildList: locArmazList,
    },
  };

  // Aplica os campos novos (sobrescreve qualquer campo que entre em conflito)
  for (const [key, value] of Object.entries(novosCampos)) {
    payload[key] = value;
  }

  return payload;
}

// ─── 3. RPCs do Supabase (jobs de bulk edit) ──────────────────────

/**
 * Cria um novo job de bulk edit. Retorna o job_id.
 */
export async function createBulkJob(params: {
  tipo: BulkJobTipo;
  total_itens: number;
  campos_alterados: string[];
  input_planilha: any;
  parametros?: any;
}): Promise<string> {
  const { data, error } = await (supabase as any).rpc("bulk_edit_create_job", {
    p_tipo: params.tipo,
    p_total_itens: params.total_itens,
    p_campos_alterados: params.campos_alterados,
    p_input_planilha: params.input_planilha,
    p_parametros: params.parametros || {},
  });

  if (error) {
    throw new Error(`Erro ao criar job: ${error.message}`);
  }
  return data as string;
}

/**
 * Marca o job como em_execucao e registra iniciado_em.
 */
export async function startBulkJob(jobId: string): Promise<void> {
  const { error } = await (supabase as any).rpc("bulk_edit_start_job", {
    p_job_id: jobId,
  });
  if (error) {
    throw new Error(`Erro ao iniciar job: ${error.message}`);
  }
}

/**
 * Grava o resultado de UM item do bulk (idempotente — UPSERT por job_id+sequencia).
 */
export async function recordBulkItem(params: {
  job_id: string;
  sequencia: number;
  identificador: string;
  codigo_alvo: string | null;
  snapshot_antes: any;
  payload_enviado: any;
  response_alvo: any;
  http_status: number | null;
  status: BulkItemStatus;
  erro_mensagem?: string | null;
}): Promise<string> {
  const { data, error } = await (supabase as any).rpc("bulk_edit_record_item", {
    p_job_id: params.job_id,
    p_sequencia: params.sequencia,
    p_identificador: params.identificador,
    p_codigo_alvo: params.codigo_alvo,
    p_snapshot_antes: params.snapshot_antes,
    p_payload_enviado: params.payload_enviado,
    p_response_alvo: params.response_alvo,
    p_http_status: params.http_status,
    p_status: params.status,
    p_erro_mensagem: params.erro_mensagem || null,
  });

  if (error) {
    throw new Error(`Erro ao registrar item: ${error.message}`);
  }
  return data as string;
}

/**
 * Finaliza o job com contadores e calcula status final.
 */
export async function finishBulkJob(params: {
  job_id: string;
  itens_sucesso: number;
  itens_falha: number;
  itens_pulado: number;
  observacoes?: string;
}): Promise<void> {
  const { error } = await (supabase as any).rpc("bulk_edit_finish_job", {
    p_job_id: params.job_id,
    p_itens_sucesso: params.itens_sucesso,
    p_itens_falha: params.itens_falha,
    p_itens_pulado: params.itens_pulado,
    p_observacoes: params.observacoes || null,
  });
  if (error) {
    throw new Error(`Erro ao finalizar job: ${error.message}`);
  }
}

/**
 * Marca um item como revertido (uso pelo fluxo de restore).
 */
export async function markItemReverted(params: { item_id: string; reverted_payload: any }): Promise<void> {
  const { error } = await (supabase as any).rpc("bulk_edit_mark_item_reverted", {
    p_item_id: params.item_id,
    p_reverted_payload: params.reverted_payload,
  });
  if (error) {
    throw new Error(`Erro ao marcar item revertido: ${error.message}`);
  }
}

/**
 * Marca o job como revertido (após todos itens revertidos).
 */
export async function markJobReverted(jobId: string): Promise<void> {
  const { error } = await (supabase as any).rpc("bulk_edit_mark_job_reverted", {
    p_job_id: jobId,
  });
  if (error) {
    throw new Error(`Erro ao marcar job revertido: ${error.message}`);
  }
}

// ─── 4. Queries de leitura (read-only, vão direto na tabela) ──────

/**
 * Lista jobs de bulk edit do usuário (mais recentes primeiro).
 */
export async function listBulkJobs(limit: number = 50): Promise<BulkJob[]> {
  const { data, error } = await (supabase as any)
    .from("hub_bulk_edit_jobs")
    .select("*")
    .order("criado_em", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Erro ao listar jobs: ${error.message}`);
  }
  return (data || []) as BulkJob[];
}

/**
 * Carrega um job específico com todos os seus itens.
 */
export async function getBulkJobWithItems(jobId: string): Promise<{ job: BulkJob; items: BulkJobItem[] }> {
  const [{ data: jobData, error: jobErr }, { data: itemsData, error: itemsErr }] = await Promise.all([
    (supabase as any).from("hub_bulk_edit_jobs").select("*").eq("id", jobId).single(),
    (supabase as any)
      .from("hub_bulk_edit_jobs_items")
      .select("*")
      .eq("job_id", jobId)
      .order("sequencia", { ascending: true }),
  ]);

  if (jobErr || !jobData) {
    throw new Error(`Job não encontrado: ${jobErr?.message}`);
  }
  if (itemsErr) {
    throw new Error(`Erro ao listar itens: ${itemsErr.message}`);
  }

  return {
    job: jobData as BulkJob,
    items: (itemsData || []) as BulkJobItem[],
  };
}
