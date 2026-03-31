import { supabase } from "@/integrations/supabase/client";
import { authenticateAlvo, clearAlvoToken } from "@/services/alvoService";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const RATE_LIMIT_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 30000;

// ── Types ──

export interface PaymentUpdateItem {
  id: string;
  docfin_key: number;
  amount_brl: number | null;
  currency: string;
}

export interface PaymentUpdateProgress {
  item: PaymentUpdateItem;
  status: "processing" | "updated" | "unchanged" | "error";
  message?: string;
}

export interface PaymentUpdateResult {
  updated: number;
  errors: number;
  unchanged: number;
}

// ── Helpers ──

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Fetch DocFin with loadChild=All (browser-side) ──

async function fetchDocFin(
  docfinKey: number,
  token: string
): Promise<{ success: boolean; data?: any; error?: string; isSessionConflict?: boolean }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const resp = await fetch(
      `${ERP_BASE_URL}/DocFin/Load?codigoEmpresaFilial=1.01&chave=${docfinKey}&loadChild=All`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "riosoft-token": token,
        },
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    const text = await resp.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!resp.ok) {
      if (resp.status === 409) {
        return { success: false, error: "SESSION_CONFLICT", isSessionConflict: true };
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

async function processPaymentItem(
  item: PaymentUpdateItem,
  token: string,
  onProgress: (progress: PaymentUpdateProgress) => void
): Promise<{ changed: boolean; error: boolean; newToken?: string }> {
  onProgress({ item, status: "processing" });

  let currentToken = token;
  let result = await fetchDocFin(item.docfin_key, currentToken);

  // Handle session conflict
  if (!result.success && result.isSessionConflict) {
    console.log("⚠️ Sessão conflitante, re-autenticando...");
    clearAlvoToken();
    await delay(1000);
    const reAuth = await authenticateAlvo();
    if (reAuth.success && reAuth.token) {
      currentToken = reAuth.token;
      result = await fetchDocFin(item.docfin_key, currentToken);
    }
  }

  if (!result.success) {
    onProgress({ item, status: "error", message: result.error || "Erro ao buscar DocFin" });
    return { changed: false, error: true, newToken: currentToken !== token ? currentToken : undefined };
  }

  const data = result.data;
  const parcelas: any[] = data?.ParcDocFinChildList || data?.parcDocFinChildList || [];

  // ── Derive consolidated payment data ──
  let paymentStatus: string;
  let totalPago = 0;
  let totalFxVariation = 0;
  let lastPaymentDate: string | null = null;
  let avgPaymentRate: number | null = null;
  let totalAdditions = 0;
  let totalDeductions = 0;
  let headerSituacao: string | null = data?.CodigoSituacao || data?.codigoSituacao || null;

  if (parcelas.length > 0) {
    const parcelasPagas = parcelas.filter((p: any) => (p.CodigoSituacao || p.codigoSituacao) === "01.002");
    const totalParcelas = parcelas.length;

    // Status
    if (parcelasPagas.length === totalParcelas) paymentStatus = "recebido";
    else if (parcelasPagas.length > 0) paymentStatus = "parcial";
    else paymentStatus = "em_aberto";

    // Total paid
    totalPago = parcelasPagas.reduce((sum: number, p: any) =>
      sum + (parseFloat(p.ValorPago || p.valorPago || "0") || 0), 0);

    // FX variation (all parcelas)
    totalFxVariation = parcelas.reduce((sum: number, p: any) =>
      sum + (parseFloat(p.ValorVariacaoCambial || p.valorVariacaoCambial || "0") || 0), 0);

    // Weighted average exchange rate using ValorCotacao weighted by ValorPago
    const sumCotacaoWeighted = parcelasPagas.reduce((sum: number, p: any) =>
      sum + (parseFloat(p.ValorCotacao || p.valorCotacao || "0") || 0) * (parseFloat(p.ValorPago || p.valorPago || "0") || 0), 0);
    avgPaymentRate = totalPago > 0 ? sumCotacaoWeighted / totalPago : null;

    // Last payment date
    lastPaymentDate = parcelasPagas
      .map((p: any) => p.DataPagamento || p.dataPagamento)
      .filter(Boolean)
      .sort()
      .pop() || null;

    // Additions: Juros + Multa + OutrosAcrescimos
    totalAdditions = parcelas.reduce((sum: number, p: any) =>
      sum
      + (parseFloat(p.ValorJuros || p.valorJuros || "0") || 0)
      + (parseFloat(p.ValorMulta || p.valorMulta || "0") || 0)
      + (parseFloat(p.ValorOutrosAcrescimos || p.valorOutrosAcrescimos || "0") || 0), 0);

    // Deductions: Desconto + OutrosDescontos + DespesaBancaria
    totalDeductions = parcelas.reduce((sum: number, p: any) =>
      sum
      + (parseFloat(p.ValorDesconto || p.valorDesconto || "0") || 0)
      + (parseFloat(p.ValorOutrosDescontos || p.valorOutrosDescontos || "0") || 0)
      + (parseFloat(p.ValorDespesaBancaria || p.valorDespesaBancaria || "0") || 0), 0);
  } else {
    // No parcelas — use header CodigoSituacao only
    if (headerSituacao === "01.002") paymentStatus = "recebido";
    else if (headerSituacao?.startsWith("01.003")) paymentStatus = "parcial";
    else paymentStatus = "em_aberto";
  }

  // ── Build update payload ──
  const updatePayload: Record<string, any> = {
    payment_status: paymentStatus,
    payment_updated_at: new Date().toISOString(),
  };

  if (lastPaymentDate) updatePayload.payment_date = lastPaymentDate;
  if (avgPaymentRate !== null) updatePayload.payment_exchange_rate = avgPaymentRate;
  if (totalPago > 0) updatePayload.payment_amount_brl = totalPago;
  if (totalFxVariation !== 0) updatePayload.fx_variation = totalFxVariation;
  if (totalAdditions > 0) updatePayload.payment_additions = totalAdditions;
  if (totalDeductions > 0) updatePayload.payment_deductions = totalDeductions;

  // ── Check if anything actually changed ──
  // For items that were already at the same status and no new payment data, skip
  const hasPaymentData = lastPaymentDate || totalPago > 0 || totalFxVariation !== 0;

  // Query current status to compare
  const { data: currentRow } = await supabase
    .from("intercompany")
    .select("payment_status")
    .eq("id", item.id)
    .single();

  if (currentRow?.payment_status === paymentStatus && !hasPaymentData) {
    onProgress({ item, status: "unchanged", message: `Status mantido: ${paymentStatus}` });
    return { changed: false, error: false, newToken: currentToken !== token ? currentToken : undefined };
  }

  // ── Update intercompany ──
  const { error: icError } = await supabase
    .from("intercompany")
    .update(updatePayload)
    .eq("id", item.id);

  if (icError) {
    onProgress({ item, status: "error", message: `Erro DB: ${icError.message}` });
    return { changed: false, error: true, newToken: currentToken !== token ? currentToken : undefined };
  }

  onProgress({
    item,
    status: "updated",
    message: `DocFin ${item.docfin_key} → ${paymentStatus}${totalPago > 0 ? ` (R$ ${totalPago.toLocaleString("pt-BR", { minimumFractionDigits: 2 })})` : ""}`,
  });

  return { changed: true, error: false, newToken: currentToken !== token ? currentToken : undefined };
}

// ── Main exported function ──

export async function updatePaymentStatuses(
  items: PaymentUpdateItem[],
  onProgress: (progress: PaymentUpdateProgress) => void
): Promise<PaymentUpdateResult> {
  const result: PaymentUpdateResult = { updated: 0, errors: 0, unchanged: 0 };

  if (items.length === 0) return result;

  // Authenticate
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    onProgress({
      item: items[0],
      status: "error",
      message: auth.error || "Falha na autenticação",
    });
    result.errors = items.length;
    return result;
  }

  let currentToken = auth.token;

  for (let i = 0; i < items.length; i++) {
    try {
      const res = await processPaymentItem(items[i], currentToken, onProgress);
      if (res.newToken) currentToken = res.newToken;
      if (res.error) result.errors++;
      else if (res.changed) result.updated++;
      else result.unchanged++;
    } catch (err: any) {
      console.error(`❌ Erro inesperado no item ${items[i].id}:`, err.message);
      onProgress({ item: items[i], status: "error", message: err.message });
      result.errors++;
    }

    if (i < items.length - 1) {
      await delay(RATE_LIMIT_DELAY_MS);
    }
  }

  console.log(`✅ Payment status update concluído: ${JSON.stringify(result)}`);
  return result;
}
