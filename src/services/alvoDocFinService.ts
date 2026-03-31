import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";
import { updatePaymentStatuses, type PaymentUpdateItem, type PaymentUpdateResult } from "@/services/paymentStatusUpdater";

const DOCFIN_BASE_URL = "https://pef.it4you.inf.br/api";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_SESSION_RETRIES = 3;

/**
 * Fetch com retry para conflito de sessão (HTTP 409).
 * Limpa token, re-autentica e tenta novamente até MAX_SESSION_RETRIES.
 */
async function fetchComRetry(
  url: string,
  token: string
): Promise<{ resp: Response; usedToken: string }> {
  const doFetch = (t: string) =>
    fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json", "riosoft-token": t },
    });

  let currentToken = token;

  for (let attempt = 1; attempt <= MAX_SESSION_RETRIES; attempt++) {
    const resp = await doFetch(currentToken);

    if (resp.status !== 409) {
      return { resp, usedToken: currentToken };
    }

    console.warn(`[fetchComRetry] 409 session conflict (tentativa ${attempt}/${MAX_SESSION_RETRIES})`);

    if (attempt === MAX_SESSION_RETRIES) {
      throw new Error(
        "Conflito de sessão ERP persistente (HTTP 409). Feche outras sessões do ERP e tente novamente."
      );
    }

    clearAlvoToken();
    await delay(1000 * attempt);

    const reAuth = await authenticateAlvo();
    if (!reAuth.success || !reAuth.token) {
      throw new Error("Falha na re-autenticação após conflito de sessão (409)");
    }

    currentToken = reAuth.token;
  }

  throw new Error("Falha inesperada no fluxo de retry de sessão ERP");
}

export interface SyncDocFinResult {
  inserted: number;
  updated: number;
  errors: number;
  skipped: number;
}

export interface EnrichResult {
  matched: number;
  skipped: number;
  errors: number;
}

const CURRENCY_MAP: Record<string, string> = {
  "0000001": "BRL",
  "0000002": "USD",
  "0000003": "EUR",
};

function mapPaymentStatus(codigoSituacao: string): string {
  if (codigoSituacao === "01.002") return "recebido";
  if (codigoSituacao === "01.003") return "parcial";
  return "em_aberto";
}

function mapDocType(especie: string): string {
  if (especie === "INV") return "inv";
  if (especie === "NFS") return "nfs-e";
  return "inv";
}

function extractDate(val: string | null | undefined): string | null {
  if (!val) return null;
  // Handle ISO or date-like strings
  const d = val.substring(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export async function sincronizarIntercompanyPorPeriodo(
  ano: number,
  mes: number,
  onProgress?: (current: number, total: number, message: string) => void
): Promise<SyncDocFinResult> {
  // 1. Authenticate
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    throw new Error(`Falha na autenticação ERP: ${auth.error || "Token não obtido"}`);
  }

  // 2. Fetch all pages from DocFin/RetrievePage
  const allItems: any[] = [];
  let pageIndex = 1;
  const pageSize = 500;

  onProgress?.(0, 0, "Buscando títulos DocFin do ERP...");

  let currentToken = auth.token;

  while (true) {
    const filter = `CodigoEmpresaFilial = '1.01' AND Tipo = 'REC' AND CodigoEntidade = '0000017'`;
    const params = new URLSearchParams({
      filter,
      order: "Competencia",
      pageSize: String(pageSize),
      pageIndex: String(pageIndex),
    });

    const { resp, usedToken } = await fetchComRetry(
      `${DOCFIN_BASE_URL}/DocFin/RetrievePage?${params.toString()}`,
      currentToken
    );
    currentToken = usedToken;

    if (!resp.ok) {
      throw new Error(`Erro HTTP ${resp.status} ao buscar DocFin página ${pageIndex}`);
    }

    const data = await resp.json();
    const items: any[] = Array.isArray(data) ? data : (data?.lista ?? data?.Registros ?? data?.Items ?? []);

    if (!items.length) break;

    allItems.push(...items);
    onProgress?.(allItems.length, 0, `Página ${pageIndex}: ${items.length} títulos carregados...`);

    if (items.length < pageSize) break;
    pageIndex++;
  }

  // 3. Filter by competence period (ano/mes)
  const targetMonth = String(mes).padStart(2, "0");
  const targetPrefix = `${ano}-${targetMonth}`;

  const filtered = allItems.filter((item) => {
    const comp = extractDate(item.Competencia);
    return comp && comp.startsWith(targetPrefix);
  });

  onProgress?.(0, filtered.length, `${filtered.length} títulos encontrados para ${targetMonth}/${ano}. Processando...`);

  // 4. Get period_id
  const competenceDateStr = `${ano}-${targetMonth}-01`;
  const { data: periodId, error: periodErr } = await supabase.rpc("find_or_create_period", {
    p_competence_date: competenceDateStr,
  });

  if (periodErr || !periodId) {
    throw new Error(`Erro ao obter período: ${periodErr?.message || "Período não retornado"}`);
  }

  // 5. Process each DocFin
  const result: SyncDocFinResult = { inserted: 0, updated: 0, errors: 0, skipped: 0 };

  for (let i = 0; i < filtered.length; i++) {
    const item = filtered[i];
    try {
      const chave = item.Chave;
      if (!chave) {
        result.skipped++;
        continue;
      }

      const currency = CURRENCY_MAP[item.CodigoIndEconomico] ?? "EUR";
      const mapped = {
        docfin_key: chave,
        document_reference: item.Numero ? String(item.Numero) : null,
        related_company: item.NomeEntidade || "Áustria",
        currency,
        exchange_rate: Number(item.CotacaoIndice) || 1,
        original_amount: Number(item.ValorDocumento) || 0,
        due_date: extractDate(item.DataBaseVencimento),
        issue_date: extractDate(item.DataEmissao),
        competence_date: extractDate(item.Competencia),
        description: item.Observacao ? String(item.Observacao).substring(0, 200) : "",
        payment_status: mapPaymentStatus(item.CodigoSituacao || ""),
        doc_type: mapDocType(item.Especie || ""),
        direction: "a_receber" as const,
        source: "alvo" as const,
        country: "Áustria",
        period_id: periodId,
        transaction_type: "outros",
        status: "em_aberto",
      };

      // Check if already exists
      const { data: existing } = await supabase
        .from("intercompany")
        .select("id")
        .eq("docfin_key", chave)
        .maybeSingle();

      if (existing) {
        // Update financial fields only
        const { error: updateErr } = await supabase
          .from("intercompany")
          .update({
            original_amount: mapped.original_amount,
            exchange_rate: mapped.exchange_rate,
            due_date: mapped.due_date,
            payment_status: mapped.payment_status,
          })
          .eq("id", existing.id);

        if (updateErr) {
          console.error(`Erro ao atualizar DocFin ${chave}:`, updateErr);
          result.errors++;
        } else {
          result.updated++;
        }
      } else {
        // Insert new record (omit amount_brl — it's a generated column)
        const { error: insertErr } = await supabase
          .from("intercompany")
          .insert(mapped);

        if (insertErr) {
          console.error(`Erro ao inserir DocFin ${chave}:`, insertErr);
          result.errors++;
        } else {
          result.inserted++;
        }
      }

      onProgress?.(i + 1, filtered.length, `Processado ${i + 1}/${filtered.length}: DocFin ${chave}`);
    } catch (err: any) {
      console.error(`Erro processando item ${i}:`, err);
      result.errors++;
    }
  }

  return result;
}

export async function enriquecerNFsComDocFin(
  ano: number,
  mes: number,
  onProgress?: (current: number, total: number, message: string) => void
): Promise<EnrichResult> {
  // 1. Get period_id
  const targetMonth = String(mes).padStart(2, "0");
  const competenceDateStr = `${ano}-${targetMonth}-01`;
  const { data: periodId, error: periodErr } = await supabase.rpc("find_or_create_period", {
    p_competence_date: competenceDateStr,
  });

  if (periodErr || !periodId) {
    throw new Error(`Erro ao obter período: ${periodErr?.message || "Período não retornado"}`);
  }

  // 2. Fetch intercompany records missing docfin_key
  const { data: pending, error: pendingErr } = await supabase
    .from("intercompany")
    .select("id, document_reference")
    .eq("period_id", periodId)
    .in("doc_type", ["nf-e", "nfs-e"])
    .is("docfin_key", null)
    .eq("source", "alvo");

  if (pendingErr) {
    throw new Error(`Erro ao buscar registros pendentes: ${pendingErr.message}`);
  }

  if (!pending || pending.length === 0) {
    return { matched: 0, skipped: 0, errors: 0 };
  }

  onProgress?.(0, pending.length, `${pending.length} NF-e/NFS-e sem DocFin. Buscando chaves do ERP...`);

  // 3. Authenticate and fetch all DocFin RECs
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    throw new Error(`Falha na autenticação ERP: ${auth.error || "Token não obtido"}`);
  }

  const docFinMap = new Map<string, number>();
  let pageIndex = 1;
  const pageSize = 1000;
  let currentToken = auth.token;

  while (true) {
    const filter = `CodigoEmpresaFilial = '1.01' AND Tipo = 'REC' AND CodigoEntidade = '0000017'`;
    const params = new URLSearchParams({
      filter,
      order: "Competencia",
      pageSize: String(pageSize),
      pageIndex: String(pageIndex),
    });

    const { resp, usedToken } = await fetchComRetry(
      `${DOCFIN_BASE_URL}/DocFin/RetrievePage?${params.toString()}`,
      currentToken
    );
    currentToken = usedToken;

    if (!resp.ok) {
      throw new Error(`Erro HTTP ${resp.status} ao buscar DocFin página ${pageIndex}`);
    }

    const data = await resp.json();
    const items: any[] = Array.isArray(data) ? data : (data?.lista ?? data?.Registros ?? data?.Items ?? []);

    if (!items.length) break;

    for (const item of items) {
      if (item.Numero && item.Chave) {
        docFinMap.set(String(item.Numero), Number(item.Chave));
      }
    }

    if (items.length < pageSize) break;
    pageIndex++;
  }

  onProgress?.(0, pending.length, `Map com ${docFinMap.size} chaves DocFin. Pareando...`);

  // 4. Match and update
  const result: EnrichResult = { matched: 0, skipped: 0, errors: 0 };

  for (let i = 0; i < pending.length; i++) {
    const row = pending[i];
    try {
      const docRef = row.document_reference;
      if (!docRef) {
        result.skipped++;
        onProgress?.(i + 1, pending.length, `${i + 1}/${pending.length}: sem document_reference — pulado`);
        continue;
      }

      const chave = docFinMap.get(docRef);
      if (!chave) {
        result.skipped++;
        onProgress?.(i + 1, pending.length, `${i + 1}/${pending.length}: DocFin não encontrado para "${docRef}"`);
        continue;
      }

      const { error: updateErr } = await supabase
        .from("intercompany")
        .update({ docfin_key: chave })
        .eq("id", row.id);

      if (updateErr) {
        console.error(`Erro ao atualizar docfin_key para ${row.id}:`, updateErr);
        result.errors++;
      } else {
        result.matched++;
      }

      onProgress?.(i + 1, pending.length, `${i + 1}/${pending.length}: DocRef "${docRef}" → Chave ${chave}`);
    } catch (err: any) {
      console.error(`Erro processando item ${i}:`, err);
      result.errors++;
    }
  }

  return result;
}

export async function atualizarPagamentosDocFin(
  ano: number,
  mes: number,
  onProgress?: (current: number, total: number, message: string) => void
): Promise<PaymentUpdateResult> {
  const targetMonth = String(mes).padStart(2, "0");
  const competenceDateStr = `${ano}-${targetMonth}-01`;
  const { data: periodId, error: periodErr } = await supabase.rpc("find_or_create_period", {
    p_competence_date: competenceDateStr,
  });

  if (periodErr || !periodId) {
    throw new Error(`Erro ao obter período: ${periodErr?.message || "Período não retornado"}`);
  }

  const { data: rows, error: fetchErr } = await supabase
    .from("intercompany")
    .select("id, docfin_key, amount_brl, currency")
    .eq("period_id", periodId)
    .eq("source", "alvo")
    .not("docfin_key", "is", null)
    .or("payment_status.is.null,payment_status.eq.em_aberto");

  if (fetchErr) {
    throw new Error(`Erro ao buscar registros: ${fetchErr.message}`);
  }

  if (!rows || rows.length === 0) {
    return { updated: 0, errors: 0, unchanged: 0 };
  }

  onProgress?.(0, rows.length, `${rows.length} títulos para atualizar pagamentos...`);

  const items: PaymentUpdateItem[] = rows.map((r) => ({
    id: r.id,
    docfin_key: r.docfin_key!,
    amount_brl: r.amount_brl,
    currency: r.currency,
  }));

  let processed = 0;
  const result = await updatePaymentStatuses(items, (progress) => {
    processed++;
    onProgress?.(processed, items.length, `${processed}/${items.length}: DocFin ${progress.item.docfin_key} → ${progress.status}${progress.message ? ` (${progress.message})` : ""}`);
  });

  return result;
}
