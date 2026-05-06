/**
 * Service legado do Alvo — agora roteado 100% via erp-proxy.
 *
 * Antes: chamava pef.it4you.inf.br direto do browser (CORS error,
 * senha exposta no localStorage).
 *
 * Agora: todas as chamadas vão pra https://erp-proxy.onrender.com/alvo/passthrough
 * com JWT do Supabase. Login técnico do Alvo é resolvido no servidor.
 *
 * Os campos de credencial na tela de Configurações ("alvo_username",
 * "alvo_password", "alvo_user_integration") tornaram-se obsoletos e
 * podem ser removidos da UI — a infra do Render já tem ALVO_USER/
 * ALVO_PASSWORD nas envvars.
 */

import { supabase } from "@/integrations/supabase/client";

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";

export interface AlvoResponse {
  success: boolean;
  data?: any;
  error?: string;
  error_code?: string;
  details?: string;
}

interface TokenResult {
  success: boolean;
  source?: "cache" | "rede";
  error?: string;
  error_code?: string;
}

const ERROR_LABELS: Record<string, string> = {
  AUTH_FAILED: "Autenticação ERP falhou",
  ERP_NETWORK_ERROR: "Erro de rede (ERP)",
  ERP_AUTH_ERROR: "Token expirado/inválido",
  ERP_API_ERROR: "Erro da API do ERP",
  EMPTY_RESPONSE: "Resposta vazia do ERP",
  UNEXPECTED_FORMAT: "Formato de resposta inesperado",
  PROXY_AUTH_ERROR: "Sessão Supabase expirada — faça login novamente.",
};

export function getErrorLabel(code?: string): string {
  if (!code) return "Erro desconhecido";
  return ERROR_LABELS[code] || code;
}

// ── Compatibilidade com código antigo ──
// Estas funções ficam vazias por compatibilidade. Não há mais token
// gerenciado no frontend — tudo é resolvido pelo erp-proxy.

export function getAlvoToken(): string | null {
  return null; // sem cache local
}

export function clearAlvoToken(): void {
  // no-op — preservado pra não quebrar imports antigos
}

/**
 * Testa a conexão fazendo uma chamada simples via erp-proxy.
 * O proxy faz Login + SelectCompany internamente.
 */
export async function authenticateAlvo(): Promise<TokenResult> {
  // Faz uma chamada real ao Alvo (CentroCusto leve) pra validar
  // toda a cadeia: Supabase auth → erp-proxy auth → Alvo Login + SelectCompany
  const result = await callErpViaProxy("CentroCusto/GetRegistros", "POST", {
    QuantidadeRegistroPagina: 1,
    IndicePagina: 1,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      error_code: result.error_code,
    };
  }
  return { success: true, source: "rede" };
}

// ── Chamada genérica via erp-proxy ──

async function callErpViaProxy(endpoint: string, method: "GET" | "POST", payload?: unknown): Promise<AlvoResponse> {
  // Pega JWT atual do Supabase
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return {
      success: false,
      error: "Sessão Supabase ausente. Faça login novamente.",
      error_code: "PROXY_AUTH_ERROR",
    };
  }

  try {
    const resp = await fetch(`${ERP_PROXY_URL}/alvo/passthrough`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ endpoint, method, payload }),
    });

    const body = await resp.json();

    if (!resp.ok || !body.ok) {
      // Erros estruturados do proxy
      if (resp.status === 401) {
        return {
          success: false,
          error: "Sessão Supabase expirada. Faça login novamente.",
          error_code: "PROXY_AUTH_ERROR",
        };
      }
      if (resp.status === 403) {
        return {
          success: false,
          error: body.error || "Endpoint não autorizado no gateway.",
          error_code: "ERP_API_ERROR",
        };
      }
      // Erros do Alvo via proxy
      if (body.status === 401 || body.status === 403 || body.status === 409) {
        return {
          success: false,
          error: `HTTP ${body.status} — Token Alvo inválido (servidor revalida automaticamente)`,
          error_code: "ERP_AUTH_ERROR",
        };
      }
      return {
        success: false,
        error: body.error || `HTTP ${resp.status}`,
        error_code: "ERP_API_ERROR",
        details: typeof body.data === "string" ? body.data : JSON.stringify(body.data).substring(0, 300),
      };
    }

    return { success: true, data: body.data };
  } catch (err: any) {
    console.error("❌ Proxy network error:", err);
    return {
      success: false,
      error: err?.message || "Erro de conexão com o gateway",
      error_code: "ERP_NETWORK_ERROR",
    };
  }
}

// ── Helpers ──

function extractArray(raw: any): any[] | null {
  if (Array.isArray(raw)) return raw;
  const candidates = [raw?.lista, raw?.Registros, raw?.Documentos, raw?.items, raw?.Data, raw?.data];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return null;
}

// ── Public API (mesma assinatura de antes) ──

export async function fetchCostCenters(): Promise<AlvoResponse> {
  return callErpViaProxy("CentroCusto/GetRegistros", "POST", {
    QuantidadeRegistroPagina: 9999,
    IndicePagina: 1,
  });
}

export interface FaturaERP {
  Id: string;
  Numero?: string;
  DataVencimento?: string;
  ValorBruto?: number;
  ObservacaoDocFin?: string;
  CodigoNomeEntidade?: string;
  Tipo?: string;
  Realizado?: string;
  [key: string]: unknown;
}

export async function fetchFaturasERP(dataIni: string, dataFim: string, codigoBanco?: string): Promise<AlvoResponse> {
  let filtro = `DataVencimento >= '${dataIni}' AND DataVencimento <= '${dataFim}'`;
  if (codigoBanco) {
    filtro += ` AND CodigoTipoPagRec = '${codigoBanco}'`;
  }

  const result = await callErpViaProxy("FaturaFin/GetRegistros", "POST", {
    filtro,
    propriedades: "Id, Numero, DataVencimento, ValorBruto, ObservacaoDocFin, CodigoNomeEntidade, Tipo, Realizado",
  });

  if (!result.success) return result;

  const items = extractArray(result.data);
  if (items === null) {
    return {
      success: false,
      error: "Formato não reconhecido.",
      error_code: "UNEXPECTED_FORMAT",
      details: JSON.stringify(result.data).substring(0, 300),
    };
  }
  return {
    success: true,
    data: items,
    error_code: items.length === 0 ? "EMPTY_RESPONSE" : undefined,
  };
}

export async function fetchExtratoCaixa(dataInicial: string, dataFinal: string): Promise<AlvoResponse> {
  const result = await callErpViaProxy("DocFin/GetListaRelatorio", "POST", {
    DataIni: dataInicial,
    DataFim: dataFinal,
  });

  if (!result.success) return result;

  const items = extractArray(result.data);
  if (items === null) {
    return {
      success: false,
      error: "Formato não reconhecido.",
      error_code: "UNEXPECTED_FORMAT",
      details: JSON.stringify(result.data).substring(0, 300),
    };
  }
  return {
    success: true,
    data: items,
    error_code: items.length === 0 ? "EMPTY_RESPONSE" : undefined,
  };
}

export interface BaixaTituloResult {
  success: boolean;
  erpId: string;
  error?: string;
  error_code?: string;
}

export async function baixarTitulo(erpId: string, dataPagamento: string): Promise<BaixaTituloResult> {
  const result = await callErpViaProxy("FaturaFin/GerarRealizado", "POST", {
    Id: erpId,
    DataPagamento: dataPagamento,
  });

  if (!result.success) {
    return {
      success: false,
      erpId,
      error: result.error,
      error_code: result.error_code,
    };
  }
  return { success: true, erpId };
}

export async function fetchEstoqueERP(): Promise<AlvoResponse> {
  return callErpViaProxy("Produto/GetRegistros", "POST", {
    QuantidadeRegistroPagina: 9999,
    IndicePagina: 1,
  });
}

export interface ApiTestResult {
  success: boolean;
  status?: number;
  duration_ms: number;
  data?: unknown;
  error?: string;
  error_code?: string;
  raw?: string;
}
