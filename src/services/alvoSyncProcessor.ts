import { supabase } from "@/integrations/supabase/client";
import { authenticateAlvo, clearAlvoToken } from "@/services/alvoService";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const RATE_LIMIT_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 30000;

// ── Currency mapping ──
const CURRENCY_MAP: Record<string, string> = {
  "0000001": "BRL",
  "0000002": "USD",
  "0000003": "EUR",
};

// ── Types ──

export interface SyncQueueItem {
  id: string;
  doc_type: string;
  doc_number: string;
  api_params: Record<string, string | number>;
  status: string;
  result_summary?: string | null;
  error_message?: string | null;
}

export interface SyncCounters {
  success: number;
  errors: number;
  duplicates: number;
  divergents: number;
}

export interface SyncResult {
  success: boolean;
  counters: SyncCounters;
  error?: string;
}

// ── Helpers ──

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function padNumber(num: string, length: number): string {
  return num.replace(/\D/g, "").padStart(length, "0");
}

function extractInvoiceReference(dadosAdicionais: string | null): string | null {
  if (!dadosAdicionais) return null;
  const match = dadosAdicionais.match(/(?:invoice|inv)[\s.]*([\d]+[\/][\d]+)/i);
  return match ? match[1] : null;
}

function deriveTransactionType(cfop: string | null): string {
  if (!cfop) return "outros";
  const code = cfop.replace(/\D/g, "");
  if (code.startsWith("7")) return "exportacao";
  if (code.startsWith("6")) return "venda_interestadual";
  if (code.startsWith("5")) return "venda_interna";
  return "outros";
}

function buildAlvoDocumentId(docType: string, data: any): string {
  if (docType === "inv") {
    return `INV|${data.Chave || data.chave || ""}`;
  }
  const modelo = data.ModeloCtrlDf || data.modeloCtrlDf || "";
  const serie = data.SerieCtrlDf || data.serieCtrlDf || "";
  const numero = data.Numero || data.numero || "";
  return `${modelo}|${serie}|${numero}`;
}

function isJsonEqual(a: any, b: any): boolean {
  const keysToCompare = [
    "ValorOriginal", "ValorTotal", "CambioOriginal", "CodigoIndEconomicoOrigem",
    "RazaoSocialEntidade", "NomePais", "CFOP", "DadosAdicionais",
    "Cancelada", "Denegada", "DataEmissao", "DataCompetencia",
  ];
  for (const key of keysToCompare) {
    if (JSON.stringify(a?.[key]) !== JSON.stringify(b?.[key])) return false;
  }
  return true;
}

// ── Direct ERP fetch (browser-side) ──

async function fetchDocumentDirect(
  docType: string,
  apiParams: Record<string, string | number>,
  token: string
): Promise<{ success: boolean; data?: any; error?: string; isSessionConflict?: boolean }> {
  let endpoint: string;

  if (docType === "nf-e") {
    const numero = padNumber(String(apiParams.numero || ""), 10);
    endpoint = `NotaFiscal/Load?modeloCtrlDf=NF-e&serieCtrlDf=1&numero=${numero}`;
  } else if (docType === "nfs-e") {
    const numero = padNumber(String(apiParams.numero || ""), 10);
    endpoint = `NotaFiscal/Load?modeloCtrlDf=NFS-e&serieCtrlDf=001&numero=${numero}`;
  } else if (docType === "inv") {
    const chave = apiParams.chave || apiParams.numero || "";
    endpoint = `DocFin/Load?codigoEmpresaFilial=1.01&chave=${chave}`;
  } else {
    return { success: false, error: `Tipo de documento desconhecido: ${docType}` };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const resp = await fetch(`${ERP_BASE_URL}/${endpoint}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "riosoft-token": token,
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const text = await resp.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!resp.ok) {
      if (resp.status === 409) {
        return { success: false, error: `SESSION_CONFLICT`, isSessionConflict: true };
      }
      return { success: false, error: `HTTP ${resp.status}` };
    }

    if (data?.Message || data?.message) {
      return { success: false, error: data.Message || data.message };
    }

    return { success: true, data };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { success: false, error: "Timeout: ERP não respondeu em 30s" };
    }
    return { success: false, error: err.message || "Erro de conexão" };
  }
}

// ── Process a single item ──

async function processItem(
  item: SyncQueueItem,
  token: string,
  counters: SyncCounters,
  onProgress: (item: SyncQueueItem) => void
): Promise<{ newToken?: string }> {
  const { id, doc_type, api_params, doc_number } = item;

  // Mark as processing
  item.status = "processing";
  await supabase.from("sync_queue").update({ status: "processing" }).eq("id", id);
  onProgress(item);

  let currentToken = token;
  let result = await fetchDocumentDirect(doc_type, api_params, currentToken);

  // Handle session conflict: clear token, re-authenticate, retry once
  if (!result.success && result.isSessionConflict) {
    console.log("⚠️ Sessão conflitante detectada, re-autenticando...");
    clearAlvoToken();
    await delay(1000);
    const reAuth = await authenticateAlvo();
    if (reAuth.success && reAuth.token) {
      currentToken = reAuth.token;
      result = await fetchDocumentDirect(doc_type, api_params, currentToken);
    }
  }

  if (!result.success) {
    item.status = "error";
    item.error_message = result.isSessionConflict
      ? "Sessão ERP conflitante — outro usuário logado com as mesmas credenciais."
      : (result.error || "Erro desconhecido");
    await supabase.from("sync_queue").update({
      status: "error",
      error_message: item.error_message,
      processed_at: new Date().toISOString(),
    }).eq("id", id);
    counters.errors++;
    onProgress(item);
    return { newToken: currentToken !== token ? currentToken : undefined };
  }

  const data = result.data;

  // Check cancelled/denied for NFs
  if (doc_type === "nf-e" || doc_type === "nfs-e") {
    if (data.Cancelada === "Sim" || data.Denegada === "Sim") {
      item.status = "error";
      item.error_message = data.Cancelada === "Sim" ? "Nota cancelada" : "Nota denegada";
      await supabase.from("sync_queue").update({
        status: "error",
        error_message: item.error_message,
        processed_at: new Date().toISOString(),
      }).eq("id", id);
      counters.errors++;
      onProgress(item);
      return {};
    }
  }

  const alvoDocumentId = buildAlvoDocumentId(doc_type, data);

  // Check for existing doc
  const { data: existing } = await supabase
    .from("intercompany_alvo_docs")
    .select("id, raw_json, intercompany_id")
    .eq("alvo_document_id", alvoDocumentId)
    .maybeSingle();

  if (existing) {
    // Check if the intercompany record is missing (partial sync recovery)
    const missingIntercompany = !existing.intercompany_id;

    // Resolve docfin_key early so we can patch duplicates/divergents too
    const isInv = doc_type === "inv";
    const docfinKeyFromParams = api_params.docfin_key ? parseInt(String(api_params.docfin_key)) : null;
    const docfinKeyEarly = isInv ? parseInt(String(api_params.chave)) : docfinKeyFromParams;

    if (missingIntercompany) {
      // The alvo_doc exists but intercompany record was never created (previous error).
      // Fall through to create the intercompany record, reusing the existing alvo_doc.
      console.log(`🔄 Recuperando registro intercompany faltante para ${alvoDocumentId}`);
    } else if (isJsonEqual(existing.raw_json, data)) {
      // Duplicate — but update docfin_key if it was provided and is missing
      if (docfinKeyEarly && existing.intercompany_id) {
        await Promise.all([
          supabase.from("intercompany_alvo_docs").update({ docfin_key: docfinKeyEarly }).eq("id", existing.id),
          supabase.from("intercompany").update({ docfin_key: docfinKeyEarly }).eq("id", existing.intercompany_id),
        ]);
      }
      item.status = "duplicate";
      item.result_summary = `Já importado: ${alvoDocumentId}`;
      await supabase.from("sync_queue").update({
        status: "duplicate",
        result_summary: item.result_summary,
        processed_at: new Date().toISOString(),
      }).eq("id", id);
      counters.duplicates++;
      onProgress(item);
      return {};
    } else {
      // Divergent — also update docfin_key if provided
      const divergentUpdate: Record<string, any> = {
        raw_json_new: data,
        sync_status: "divergent",
        updated_at: new Date().toISOString(),
      };
      if (docfinKeyEarly) divergentUpdate.docfin_key = docfinKeyEarly;
      await supabase.from("intercompany_alvo_docs").update(divergentUpdate).eq("id", existing.id);

      if (docfinKeyEarly && existing.intercompany_id) {
        await supabase.from("intercompany").update({ docfin_key: docfinKeyEarly }).eq("id", existing.intercompany_id);
      }

      item.status = "divergent";
      item.result_summary = `Divergência detectada: ${alvoDocumentId}`;
      await supabase.from("sync_queue").update({
        status: "divergent",
        result_summary: item.result_summary,
        processed_at: new Date().toISOString(),
      }).eq("id", id);
      counters.divergents++;
      onProgress(item);
      return {};
    }
  }

  // ── New document ──
  const isInv = doc_type === "inv";
  const docfinKeyFromParams = api_params.docfin_key ? parseInt(String(api_params.docfin_key)) : null;
  const docfinKey = isInv ? parseInt(String(api_params.chave)) : docfinKeyFromParams;
  const dadosAdicionais = data.DadosAdicionais || data.dadosAdicionais || null;
  const invoiceRef = extractInvoiceReference(dadosAdicionais);
  const cfop = data.CodigoNatOperacaoProduto || data.CodigoNatOperacaoServico || null;
  const competenceDate = data.DataCompetencia || data.DataEmissao || null;
  const issueDate = data.DataEmissao || null;

  // Currency & amount logic per doc type
  let currency: string;
  let valorOriginal: number;
  let cambioOriginal: number;
  let valorBRL: number;

  if (doc_type === "nfs-e") {
    // NFS-e is ALWAYS in BRL — use ValorServico
    currency = "BRL";
    valorOriginal = parseFloat(data.ValorServico || data.ValorTotal || "0") || 0;
    cambioOriginal = 1;
    valorBRL = valorOriginal;
  } else if (isInv) {
    const currCode = data.CodigoIndEconomico || "0000001";
    currency = CURRENCY_MAP[currCode] || "BRL";
    valorOriginal = parseFloat(data.ValorDocumento || "0") || 0;
    cambioOriginal = parseFloat(data.CotacaoIndice || "1") || 1;
    valorBRL = parseFloat(data.ValorConvertido || "0") || 0;
  } else {
    // NF-e
    const currCode = data.CodigoIndEconomicoOrigem || "0000001";
    currency = CURRENCY_MAP[currCode] || "BRL";
    valorOriginal = parseFloat(data.ValorOriginal || "0") || 0;
    cambioOriginal = parseFloat(data.CambioOriginal || "1") || 1;
    valorBRL = parseFloat(data.ValorTotal || "0") || 0;
  }

  // Get or create period
  let periodId: string | null = null;
  if (competenceDate) {
    const { data: periodResult } = await supabase.rpc("find_or_create_period", {
      p_competence_date: competenceDate,
    });
    periodId = periodResult;
  }

  if (!periodId) {
    item.status = "error";
    item.error_message = "Data de competência ausente — período não determinado.";
    await supabase.from("sync_queue").update({
      status: "error",
      error_message: item.error_message,
      processed_at: new Date().toISOString(),
    }).eq("id", id);
    counters.errors++;
    onProgress(item);
    return {};
  }

  // Insert into intercompany_alvo_docs
  const alvoDoc = {
    alvo_document_id: alvoDocumentId,
    doc_type,
    nf_model: isInv ? null : (data.ModeloCtrlDf || null),
    nf_series: isInv ? null : (data.SerieCtrlDf || null),
    nf_number: isInv ? null : (data.Numero || doc_number),
    entity_code: data.CodigoEntidade || data.codigoEntidade || "",
    entity_name: isInv ? (data.NomeEntidade || null) : (data.RazaoSocialEntidade || data.NomeEntidade || null),
    country_code: data.SiglaPais || null,
    currency,
    original_amount: valorOriginal,
    exchange_rate: cambioOriginal,
    cfop,
    invoice_reference: invoiceRef,
    document_origin: data.DocumentoOrigem || null,
    dados_adicionais: dadosAdicionais ? dadosAdicionais.substring(0, 2000) : null,
    issue_date: issueDate,
    competence_date: competenceDate,
    is_cancelled: data.Cancelada === "Sim",
    service_value: parseFloat(data.ValorServico || "0") || null,
    product_value: parseFloat(data.ValorProduto || "0") || null,
    freight_value: parseFloat(data.ValorFrete || "0") || null,
    tax_iss: parseFloat(data.ValorISS || "0") || null,
    tax_pis: parseFloat(data.ValorPISServicoRF || data.ValorPIS || "0") || null,
    tax_cofins: parseFloat(data.ValorCOFINSServicoRF || data.ValorCOFINS || "0") || null,
    tax_csll: parseFloat(data.ValorCSLLServicoRF || data.ValorCSLL || "0") || null,
    docfin_key: docfinKey ?? (data.Chave ? parseInt(data.Chave) : null),
    raw_json: data,
    sync_status: "synced",
  };

  // Skip alvo_doc insert if recovering from partial sync
  let docId: string;
  if (existing && !existing.intercompany_id) {
    docId = existing.id;
  } else {
    const { data: insertedDoc, error: docError } = await supabase
      .from("intercompany_alvo_docs")
      .insert(alvoDoc)
      .select("id")
      .single();

    if (docError) {
      item.status = "error";
      item.error_message = `Erro ao inserir doc: ${docError.message}`;
      await supabase.from("sync_queue").update({
        status: "error",
        error_message: item.error_message,
        processed_at: new Date().toISOString(),
      }).eq("id", id);
      counters.errors++;
      onProgress(item);
      return {};
    }
    docId = insertedDoc.id;
  }

  // Insert into intercompany
  const relatedCompany = isInv ? (data.NomeEntidade || "Desconhecida") : (data.RazaoSocialEntidade || data.NomeEntidade || "Desconhecida");
  const transactionType = isInv ? "invoice_direta" : deriveTransactionType(cfop);
  const description = isInv
    ? (data.Observacao || "").substring(0, 200)
    : (dadosAdicionais ? dadosAdicionais.substring(0, 200) : "");

  const taxTotal =
    (parseFloat(data.ValorISS || data.ValorPISServicoRF ? data.ValorISS || "0" : "0") || 0) +
    (parseFloat(data.ValorPISServicoRF || data.ValorPIS || "0") || 0) +
    (parseFloat(data.ValorCOFINSServicoRF || data.ValorCOFINS || "0") || 0) +
    (parseFloat(data.ValorCSLLServicoRF || data.ValorCSLL || "0") || 0);

  const intercompanyRecord = {
    period_id: periodId,
    related_company: relatedCompany,
    country: data.NomePais || "Desconhecido",
    transaction_type: transactionType,
    description,
    currency,
    original_amount: valorOriginal,
    exchange_rate: cambioOriginal,
    
    direction: "a_receber" as const,
    document_reference: data.DocumentoOrigem || null,
    status: "em_aberto",
    source: "alvo",
    alvo_document_id: alvoDocumentId,
    doc_type,
    nf_number: isInv ? null : (data.Numero || doc_number),
    nf_series: isInv ? null : (data.SerieCtrlDf || null),
    nf_model: isInv ? null : (data.ModeloCtrlDf || null),
    cfop,
    alvo_entity_code: data.CodigoEntidade || null,
    alvo_country_code: data.SiglaPais || null,
    invoice_reference: invoiceRef,
    issue_date: issueDate,
    competence_date: competenceDate,
    service_value: parseFloat(data.ValorServico || "0") || null,
    product_value: parseFloat(data.ValorProduto || "0") || null,
    freight_value: parseFloat(data.ValorFrete || "0") || null,
    tax_total: taxTotal || null,
    docfin_key: docfinKey,
  };

  const { data: insertedIC, error: icError } = await supabase
    .from("intercompany")
    .insert(intercompanyRecord)
    .select("id")
    .single();

  if (icError) {
    console.error("Erro ao inserir intercompany:", icError.message);
  }

  // Link alvo_doc → intercompany
  if (insertedIC) {
    await supabase.from("intercompany_alvo_docs")
      .update({ intercompany_id: insertedIC.id })
      .eq("id", docId);
  }

  // Success
  const summary = `R$ ${valorBRL.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} - ${relatedCompany.substring(0, 50)}`;
  item.status = "success";
  item.result_summary = summary;

  await supabase.from("sync_queue").update({
    status: "success",
    result_summary: summary,
    processed_at: new Date().toISOString(),
  }).eq("id", id);
  counters.success++;
  onProgress(item);
  return {};
}

// ── Main exported function ──

export async function processSyncBatch(
  syncBatchId: string,
  queueItems: SyncQueueItem[],
  onProgress: (updatedItem: SyncQueueItem) => void
): Promise<SyncResult> {
  const counters: SyncCounters = { success: 0, errors: 0, duplicates: 0, divergents: 0 };

  // 1. Authenticate
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    await (supabase.from("sync_log") as any).update({
      status: "failed",
      finished_at: new Date().toISOString(),
    }).eq("sync_batch_id", syncBatchId);

    return { success: false, counters, error: auth.error || "Falha na autenticação" };
  }

  console.log("✅ Autenticado no Alvo ERP (browser-side)");

  // 2. Mark sync_log as running
  await (supabase.from("sync_log") as any).update({
    status: "running",
    details: { total_items: queueItems.length },
  }).eq("sync_batch_id", syncBatchId);

  let currentToken = auth.token;

  // 3. Process each item sequentially
  for (let i = 0; i < queueItems.length; i++) {
    try {
      const result = await processItem(queueItems[i], currentToken, counters, onProgress);
      if (result.newToken) {
        currentToken = result.newToken;
      }
    } catch (err: any) {
      console.error(`❌ Erro inesperado no item ${queueItems[i].id}:`, err.message);
      queueItems[i].status = "error";
      queueItems[i].error_message = `Erro inesperado: ${err.message}`;
      await supabase.from("sync_queue").update({
        status: "error",
        error_message: queueItems[i].error_message,
        processed_at: new Date().toISOString(),
      }).eq("id", queueItems[i].id);
      counters.errors++;
      onProgress(queueItems[i]);
    }

    // Rate limiting (skip after last item)
    if (i < queueItems.length - 1) {
      await delay(RATE_LIMIT_DELAY_MS);
    }
  }

  // 4. Update sync_log as completed
  await (supabase.from("sync_log") as any).update({
    status: "completed",
    finished_at: new Date().toISOString(),
    records_processed: counters.success + counters.duplicates + counters.divergents,
    records_errors: counters.errors,
    details: { success_count: counters.success, duplicate_count: counters.duplicates, divergent_count: counters.divergents },
  }).eq("sync_batch_id", syncBatchId);

  console.log(`✅ Batch concluído: ${JSON.stringify(counters)}`);

  return { success: true, counters };
}
