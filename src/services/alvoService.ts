const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const TOKEN_STORAGE_KEY = "alvo_erp_token";
const TOKEN_TIMESTAMP_KEY = "alvo_erp_token_ts";
const TOKEN_TTL_MS = 25 * 60 * 1000;

export interface AlvoResponse {
  success: boolean;
  data?: any;
  error?: string;
  error_code?: string;
  details?: string;
}

interface TokenResult {
  success: boolean;
  token?: string;
  source?: "cache" | "rede";
  error?: string;
  error_code?: string;
}

const ERROR_LABELS: Record<string, string> = {
  AUTH_FAILED: "Autenticação ERP falhou",
  AUTH_NETWORK_ERROR: "Erro de rede (autenticação)",
  ERP_NETWORK_ERROR: "Erro de rede (ERP)",
  ERP_AUTH_ERROR: "Token expirado/inválido",
  ERP_API_ERROR: "Erro da API do ERP",
  TOKEN_EXPIRED: "Token expirado",
  TOKEN_NOT_RECEIVED: "Token não recebido",
  NETWORK_ERROR: "Erro de rede",
  SESSION_CONFLICT: "Sessão ERP conflitante",
  EMPTY_RESPONSE: "Resposta vazia do ERP",
  UNEXPECTED_FORMAT: "Formato de resposta inesperado",
};

export function getErrorLabel(code?: string): string {
  if (!code) return "Erro desconhecido";
  return ERROR_LABELS[code] || code;
}

// ── Token cache ──

function getCachedToken(): { token: string; source: "cache" } | null {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const timestamp = localStorage.getItem(TOKEN_TIMESTAMP_KEY);
  if (!token || !timestamp) return null;
  if (Date.now() - Number(timestamp) < TOKEN_TTL_MS) {
    return { token, source: "cache" };
  }
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(TOKEN_TIMESTAMP_KEY);
  return null;
}

function saveTokenToCache(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.setItem(TOKEN_TIMESTAMP_KEY, String(Date.now()));
}

export function getAlvoToken(): string | null {
  return getCachedToken()?.token ?? null;
}

export function clearAlvoToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(TOKEN_TIMESTAMP_KEY);
}

// ── Auth via direct fetch ──

export async function authenticateAlvo(): Promise<TokenResult> {
  const cached = getCachedToken();
  if (cached) return { success: true, token: cached.token, source: "cache" };

  const login = localStorage.getItem("alvo_username") || "";
  const senha = localStorage.getItem("alvo_password") || "";
  const integrationUser = localStorage.getItem("alvo_user_integration") || login;

  if (!login || !senha) {
    return { success: false, error: "Credenciais não configuradas. Vá em Configurações → Integração ERP Alvo.", error_code: "AUTH_FAILED" };
  }

  try {
    const resp = await fetch(`${ERP_BASE_URL}/RsLogin/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userName: login,
        password: senha,
        userNameIntegration: integrationUser,
      }),
    });

    const text = await resp.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!resp.ok) {
      return { success: false, error: `HTTP ${resp.status}`, error_code: "AUTH_FAILED" };
    }

    // Token may come as plain string, or inside an object (token, Token, access_token, etc.)
    let token: string | undefined;
    if (typeof data === "string") {
      token = data.replace(/"/g, "");
    } else if (data) {
      token = data.token || data.Token || data.access_token || data.AccessToken;
      // Some ERPs return the token in a nested structure
      if (!token && typeof data === "object") {
        // Check response headers as fallback
        const headerToken = resp.headers.get("riosoft-token") || resp.headers.get("Token");
        if (headerToken) token = headerToken;
      }
    }

    if (!token) {
      console.warn("⚠️ Auth response (no token found):", data);
      return { success: false, error: "Token não recebido na resposta.", error_code: "TOKEN_NOT_RECEIVED" };
    }

    saveTokenToCache(token);
    console.log("✅ Token obtido via rede (RsLogin/Login)");
    return { success: true, token, source: "rede" };
  } catch (err: any) {
    console.error("❌ Auth network error:", err);
    return { success: false, error: err.message || "Erro de rede", error_code: "AUTH_NETWORK_ERROR" };
  }
}

// ── Ensure token helper ──

async function ensureToken(): Promise<{ token: string } | { error: string; error_code: string }> {
  let token = getAlvoToken();
  if (token) return { token };
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    return { error: auth.error || "Falha ao obter token.", error_code: auth.error_code || "AUTH_FAILED" };
  }
  return { token: auth.token };
}

// ── Generic ERP call via direct fetch ──

async function callErp(endpoint: string, method: "GET" | "POST", payload?: unknown): Promise<AlvoResponse> {
  const tokenResult = await ensureToken();
  if ("error" in tokenResult) {
    return { success: false, error: tokenResult.error, error_code: tokenResult.error_code };
  }
  const { token } = tokenResult;
  console.log(`🔑 Token via [${getCachedToken()?.source ?? "rede"}]`);

  try {
    const resp = await fetch(`${ERP_BASE_URL}/${endpoint}`, {
      method,
      headers: { "Content-Type": "application/json", "riosoft-token": token },
      ...(method === "POST" && payload ? { body: JSON.stringify(payload) } : {}),
    });

    const text = await resp.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        clearAlvoToken();
        return { success: false, error: `HTTP ${resp.status} — Token inválido`, error_code: "ERP_AUTH_ERROR" };
      }
      return { success: false, error: `HTTP ${resp.status}`, error_code: "ERP_API_ERROR", details: typeof data === "string" ? data : JSON.stringify(data).substring(0, 300) };
    }

    return { success: true, data };
  } catch (err: any) {
    console.error("❌ ERP network error:", err);
    return { success: false, error: err.message || "Erro de conexão", error_code: "ERP_NETWORK_ERROR" };
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

// ── Public API ──

export async function fetchCostCenters(): Promise<AlvoResponse> {
  return callErp("CentroCusto/GetRegistros", "POST", {
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

  const result = await callErp("FaturaFin/GetRegistros", "POST", {
    filtro,
    propriedades: "Id, Numero, DataVencimento, ValorBruto, ObservacaoDocFin, CodigoNomeEntidade, Tipo, Realizado",
  });

  if (!result.success) return result;

  const items = extractArray(result.data);
  if (items === null) {
    return { success: false, error: "Formato não reconhecido.", error_code: "UNEXPECTED_FORMAT", details: JSON.stringify(result.data).substring(0, 300) };
  }
  return { success: true, data: items, error_code: items.length === 0 ? "EMPTY_RESPONSE" : undefined };
}

export async function fetchExtratoCaixa(dataInicial: string, dataFinal: string): Promise<AlvoResponse> {
  const result = await callErp("DocFin/GetListaRelatorio", "POST", {
    DataIni: dataInicial,
    DataFim: dataFinal,
  });

  if (!result.success) return result;

  const items = extractArray(result.data);
  if (items === null) {
    return { success: false, error: "Formato não reconhecido.", error_code: "UNEXPECTED_FORMAT", details: JSON.stringify(result.data).substring(0, 300) };
  }
  return { success: true, data: items, error_code: items.length === 0 ? "EMPTY_RESPONSE" : undefined };
}

export interface BaixaTituloResult {
  success: boolean;
  erpId: string;
  error?: string;
  error_code?: string;
}

export async function baixarTitulo(erpId: string, dataPagamento: string): Promise<BaixaTituloResult> {
  const result = await callErp("FaturaFin/GerarRealizado", "POST", {
    Id: erpId,
    DataPagamento: dataPagamento,
  });

  if (!result.success) {
    return { success: false, erpId, error: result.error, error_code: result.error_code };
  }
  return { success: true, erpId };
}

// ── Laboratório de API ──

export async function fetchEstoqueERP(): Promise<AlvoResponse> {
  return callErp("Produto/GetRegistros", "POST", {
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
