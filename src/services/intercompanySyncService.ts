import { supabase } from "@/integrations/supabase/client";

const GATEWAY_URL = "https://erp-proxy.onrender.com";

export interface SyncBatchRequest {
  dataInicial: string; // YYYY-MM-DD
  dataFinal?: string; // YYYY-MM-DD, opcional
}

export interface SyncBatchSummary {
  total_listed: number;
  total_mapped: number;
  total_failed: number;
  elapsed_ms: number;
  elapsed_alvo_ms: number;
  by_especie: Record<string, number>;
  failures: Array<{
    chave: number;
    especie: string;
    error: string;
  }>;
}

export interface SyncBatchPersistence {
  success: boolean;
  inserted: number;
  updated: number;
  fatal_error?: string;
}

export interface SyncBatchResponse {
  summary: SyncBatchSummary;
  persistence: SyncBatchPersistence | null;
}

/**
 * Sincroniza DocFins intercompany do Alvo (PEF Áustria, entidade 0000017)
 * dentro de uma janela de datas. Pipeline:
 *   Alvo (RetrievePage + Load + notaFiscal/Load) → mapeamento → RPC upsert no Supabase
 *
 * Retorna resumo: quantos foram listados, mapeados, persistidos.
 * Atualiza tabela intercompany_invoices (não cria masters automaticamente).
 *
 * Espera ~4-8s para janelas pequenas (1-2 semanas), até ~30s para
 * janelas maiores (~3 meses). Timeout do gateway no Render: 100s.
 */
export async function syncIntercompanyFromAlvo(request: SyncBatchRequest): Promise<SyncBatchResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;

  if (!accessToken) {
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  const resp = await fetch(`${GATEWAY_URL}/intercompany/sync-batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(request),
  });

  if (!resp.ok) {
    // Tenta extrair mensagem do gateway (JSON {error, details})
    let errorMsg = `Gateway retornou HTTP ${resp.status}`;
    try {
      const errBody = await resp.json();
      if (errBody?.error) errorMsg = errBody.error;
    } catch {
      // body não é JSON, mantém msg padrão
    }
    throw new Error(errorMsg);
  }

  return (await resp.json()) as SyncBatchResponse;
}
