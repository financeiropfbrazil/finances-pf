import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REQUEST_TIMEOUT_MS = 30000;
const RATE_LIMIT_DELAY_MS = 500;
const ERP_DATA_BASE_URL = "https://pef.it4you.inf.br/api";

// ── Currency mapping ──
const CURRENCY_MAP: Record<string, string> = {
  "0000001": "BRL",
  "0000002": "USD",
  "0000003": "EUR",
};

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

// ── Auth & API calls via alvo-proxy (avoids firewall block) ──

async function authenticateViaProxy(supabaseUrl: string, supabaseServiceKey: string): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const proxyUrl = `${supabaseUrl}/functions/v1/alvo-proxy`;
    const resp = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ action: "login" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const data = await resp.json();
    if (!data.success) {
      return { success: false, error: data.error || "Proxy auth failed" };
    }

    const token = data.data?.token;
    if (!token) {
      return { success: false, error: "Token não recebido via proxy." };
    }

    return { success: true, token };
  } catch (err: any) {
    return { success: false, error: `Proxy auth error: ${err.message}` };
  }
}

// ── Fetch document from Alvo ──

async function fetchDocument(docType: string, apiParams: any, token: string, supabaseUrl: string, supabaseServiceKey: string): Promise<{ success: boolean; data?: any; error?: string }> {
  let endpoint: string;

  if (docType === "nf-e") {
    const numero = padNumber(apiParams.numero || "", 10);
    endpoint = `NotaFiscal/Load?modeloCtrlDf=NF-e&serieCtrlDf=1&numero=${numero}`;
  } else if (docType === "nfs-e") {
    const numero = padNumber(apiParams.numero || "", 10);
    endpoint = `NotaFiscal/Load?modeloCtrlDf=NFS-e&serieCtrlDf=001&numero=${numero}`;
  } else if (docType === "inv") {
    const chave = apiParams.numero || apiParams.chave || "";
    endpoint = `DocFin/Load?codigoEmpresaFilial=1.01&chave=${chave}`;
  } else {
    return { success: false, error: `Tipo de documento desconhecido: ${docType}` };
  }

  try {
    const proxyUrl = `${supabaseUrl}/functions/v1/alvo-proxy`;
    const resp = await fetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        action: "call",
        endpoint,
        method: "GET",
        token,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const result = await resp.json();
    if (!result.success) {
      return { success: false, error: result.error || `Proxy error: HTTP ${resp.status}` };
    }

    const data = result.data;

    // Check for error message
    if (data?.Message || data?.message) {
      return { success: false, error: data.Message || data.message };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: `Proxy fetch error: ${err.message}` };
  }
}

// ── Process a single queue item ──

async function processItem(
  supabase: any,
  item: any,
  token: string,
  counters: { success: number; error: number; duplicate: number; divergent: number },
  supabaseUrl: string,
  supabaseServiceKey: string
): Promise<void> {
  const { id, doc_type, api_params, doc_number } = item;

  // Mark as processing
  await supabase.from("sync_queue").update({ status: "processing" }).eq("id", id);

  const result = await fetchDocument(doc_type, api_params, token, supabaseUrl, supabaseServiceKey);

  if (!result.success) {
    await supabase.from("sync_queue").update({
      status: "error",
      error_message: result.error,
      processed_at: new Date().toISOString(),
    }).eq("id", id);
    counters.error++;
    return;
  }

  const data = result.data;

  // For NF-e/NFS-e: check cancelled/denied
  if (doc_type === "nf-e" || doc_type === "nfs-e") {
    if (data.Cancelada === "Sim" || data.Denegada === "Sim") {
      await supabase.from("sync_queue").update({
        status: "error",
        error_message: data.Cancelada === "Sim" ? "Nota cancelada" : "Nota denegada",
        processed_at: new Date().toISOString(),
      }).eq("id", id);
      counters.error++;
      return;
    }
  }

  // Build document ID
  const alvoDocumentId = buildAlvoDocumentId(doc_type, data);

  // Check if already exists
  const { data: existing } = await supabase
    .from("intercompany_alvo_docs")
    .select("id, raw_json")
    .eq("alvo_document_id", alvoDocumentId)
    .maybeSingle();

  if (existing) {
    if (isJsonEqual(existing.raw_json, data)) {
      // Duplicate
      await supabase.from("sync_queue").update({
        status: "duplicate",
        result_summary: `Já importado: ${alvoDocumentId}`,
        processed_at: new Date().toISOString(),
      }).eq("id", id);
      counters.duplicate++;
    } else {
      // Divergent — update raw_json and mark
      await supabase.from("intercompany_alvo_docs").update({
        raw_json: data,
        sync_status: "divergent",
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);

      await supabase.from("sync_queue").update({
        status: "divergent",
        result_summary: `Divergência detectada: ${alvoDocumentId}`,
        processed_at: new Date().toISOString(),
      }).eq("id", id);
      counters.divergent++;
    }
    return;
  }

  // ── New document: insert into intercompany_alvo_docs + intercompany ──

  const currencyCode = data.CodigoIndEconomicoOrigem || "0000001";
  const currency = CURRENCY_MAP[currencyCode] || "BRL";
  const dadosAdicionais = data.DadosAdicionais || data.dadosAdicionais || null;
  const invoiceRef = extractInvoiceReference(dadosAdicionais);
  const cfop = data.CFOP || data.Cfop || null;
  const competenceDate = data.DataCompetencia || data.DataEmissao || null;
  const issueDate = data.DataEmissao || null;

  const valorOriginal = parseFloat(data.ValorOriginal || data.valorOriginal || "0") || 0;
  const cambioOriginal = parseFloat(data.CambioOriginal || data.cambioOriginal || "1") || 1;
  const valorTotal = parseFloat(data.ValorTotal || data.valorTotal || "0") || 0;

  // Get or create period
  let periodId: string | null = null;
  if (competenceDate) {
    const { data: periodResult } = await supabase.rpc("find_or_create_period", {
      p_competence_date: competenceDate,
    });
    periodId = periodResult;
  }

  if (!periodId) {
    await supabase.from("sync_queue").update({
      status: "error",
      error_message: "Não foi possível determinar o período (data de competência ausente).",
      processed_at: new Date().toISOString(),
    }).eq("id", id);
    counters.error++;
    return;
  }

  // Insert into intercompany_alvo_docs
  const alvoDoc = {
    alvo_document_id: alvoDocumentId,
    doc_type: doc_type,
    nf_model: data.ModeloCtrlDf || null,
    nf_series: data.SerieCtrlDf || null,
    nf_number: data.Numero || doc_number,
    entity_code: data.CodigoEntidade || data.codigoEntidade || "",
    entity_name: data.RazaoSocialEntidade || data.razaoSocialEntidade || null,
    country_code: data.CodigoPais || data.codigoPais || null,
    currency,
    original_amount: valorOriginal,
    exchange_rate: cambioOriginal,
    amount_brl: valorTotal,
    cfop,
    invoice_reference: invoiceRef,
    document_origin: data.DocumentoOrigem || null,
    dados_adicionais: dadosAdicionais ? dadosAdicionais.substring(0, 2000) : null,
    issue_date: issueDate,
    competence_date: competenceDate,
    is_cancelled: data.Cancelada === "Sim",
    service_value: parseFloat(data.ValorServico || "0") || null,
    product_value: parseFloat(data.ValorProdutos || "0") || null,
    freight_value: parseFloat(data.ValorFrete || "0") || null,
    tax_iss: parseFloat(data.ValorISS || "0") || null,
    tax_pis: parseFloat(data.ValorPIS || "0") || null,
    tax_cofins: parseFloat(data.ValorCOFINS || "0") || null,
    tax_csll: parseFloat(data.ValorCSLL || "0") || null,
    docfin_key: data.Chave ? parseInt(data.Chave) : null,
    raw_json: data,
    sync_status: "synced",
  };

  const { data: insertedDoc, error: docError } = await supabase
    .from("intercompany_alvo_docs")
    .insert(alvoDoc)
    .select("id")
    .single();

  if (docError) {
    await supabase.from("sync_queue").update({
      status: "error",
      error_message: `Erro ao inserir doc: ${docError.message}`,
      processed_at: new Date().toISOString(),
    }).eq("id", id);
    counters.error++;
    return;
  }

  // Insert into intercompany
  const intercompanyRecord = {
    period_id: periodId,
    related_company: data.RazaoSocialEntidade || "Desconhecida",
    country: data.NomePais || "Brasil",
    transaction_type: deriveTransactionType(cfop),
    description: dadosAdicionais ? dadosAdicionais.substring(0, 200) : "",
    currency,
    original_amount: valorOriginal,
    exchange_rate: cambioOriginal,
    amount_brl: valorTotal,
    direction: "a_receber",
    document_reference: data.DocumentoOrigem || null,
    status: "em_aberto",
    source: "alvo",
    alvo_document_id: alvoDocumentId,
    doc_type,
    nf_number: data.Numero || doc_number,
    nf_series: data.SerieCtrlDf || null,
    nf_model: data.ModeloCtrlDf || null,
    cfop,
    alvo_entity_code: data.CodigoEntidade || null,
    alvo_country_code: data.CodigoPais || null,
    invoice_reference: invoiceRef,
    issue_date: issueDate,
    competence_date: competenceDate,
    service_value: parseFloat(data.ValorServico || "0") || null,
    product_value: parseFloat(data.ValorProdutos || "0") || null,
    freight_value: parseFloat(data.ValorFrete || "0") || null,
    tax_total: (parseFloat(data.ValorISS || "0") || 0) +
               (parseFloat(data.ValorPIS || "0") || 0) +
               (parseFloat(data.ValorCOFINS || "0") || 0) +
               (parseFloat(data.ValorCSLL || "0") || 0) || null,
  };

  const { data: insertedIC, error: icError } = await supabase
    .from("intercompany")
    .insert(intercompanyRecord)
    .select("id")
    .single();

  if (icError) {
    console.error("Erro ao inserir intercompany:", icError.message);
  }

  // Link alvo_doc to intercompany
  if (insertedIC && insertedDoc) {
    await supabase.from("intercompany_alvo_docs")
      .update({ intercompany_id: insertedIC.id })
      .eq("id", insertedDoc.id);
  }

  // Build summary
  const summary = `R$ ${valorTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} - ${(data.RazaoSocialEntidade || doc_number).substring(0, 50)}`;

  await supabase.from("sync_queue").update({
    status: "success",
    result_summary: summary,
    processed_at: new Date().toISOString(),
  }).eq("id", id);

  counters.success++;
}

// ── Main handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate JWT - require authenticated user
  const authResult = await validateAuth(req);
  if (!authResult) {
    return unauthorizedResponse();
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { sync_batch_id } = await req.json();

    if (!sync_batch_id) {
      return new Response(
        JSON.stringify({ error: "sync_batch_id é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`🔄 Starting sync batch: ${sync_batch_id}`);

    // Authenticate via alvo-proxy (routes through Make.com to avoid firewall)
    const auth = await authenticateViaProxy(supabaseUrl, supabaseServiceKey);
    if (!auth.success || !auth.token) {
      await supabase.from("sync_log").update({
        status: "failed",
        completed_at: new Date().toISOString(),
      }).eq("sync_batch_id", sync_batch_id);

      return new Response(
        JSON.stringify({ error: `Autenticação falhou: ${auth.error}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ Authenticated with Alvo ERP via proxy");

    // Fetch pending items
    const { data: items, error: fetchError } = await supabase
      .from("sync_queue")
      .select("*")
      .eq("sync_batch_id", sync_batch_id)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: `Erro ao buscar fila: ${fetchError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!items || items.length === 0) {
      return new Response(
        JSON.stringify({ message: "Nenhum item pendente neste batch." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update sync_log total
    await supabase.from("sync_log").update({
      total_items: items.length,
    }).eq("sync_batch_id", sync_batch_id);

    const counters = { success: 0, error: 0, duplicate: 0, divergent: 0 };

    // Process each item with rate limiting
    for (let i = 0; i < items.length; i++) {
      try {
        await processItem(supabase, items[i], auth.token, counters, supabaseUrl, supabaseServiceKey);
      } catch (err: any) {
        console.error(`❌ Unexpected error processing item ${items[i].id}:`, err.message);
        await supabase.from("sync_queue").update({
          status: "error",
          error_message: `Erro inesperado: ${err.message}`,
          processed_at: new Date().toISOString(),
        }).eq("id", items[i].id);
        counters.error++;
      }

      // Update counters after each item
      await supabase.from("sync_log").update({
        success_count: counters.success,
        error_count: counters.error,
        duplicate_count: counters.duplicate,
        divergent_count: counters.divergent,
      }).eq("sync_batch_id", sync_batch_id);

      // Rate limiting delay (skip after last item)
      if (i < items.length - 1) {
        await delay(RATE_LIMIT_DELAY_MS);
      }
    }

    // Mark batch as completed
    await supabase.from("sync_log").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      success_count: counters.success,
      error_count: counters.error,
      duplicate_count: counters.duplicate,
      divergent_count: counters.divergent,
    }).eq("sync_batch_id", sync_batch_id);

    console.log(`✅ Batch completed: ${JSON.stringify(counters)}`);

    return new Response(
      JSON.stringify({ success: true, counters }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("❌ Worker error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
