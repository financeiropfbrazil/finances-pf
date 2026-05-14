/**
 * Service da Frente 3 — Intercompany / Reembolso NF.
 *
 * Camada única que fala com:
 *   - Supabase (RPCs + view v_movestq_disponivel)
 *   - Gateway erp-proxy (POST /movestq/sync, POST /reembolso-nf/emit)
 *
 * Hooks TanStack Query em src/hooks/useReembolsoNf.ts consomem este service.
 * Componentes NUNCA chamam Supabase ou fetch direto — sempre via hooks.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  MovEstqDisponivel,
  MovEstqFiltros,
  RascunhoDetails,
  InitOrResumeRascunhoResult,
  RascunhoMutationResult,
  TipoBloco,
  EmitReembolsoNFRequest,
  EmitReembolsoNFResponse,
  SyncMovEstqRequest,
  SyncMovEstqResponse,
} from "@/types/intercompanyReembolsoNf";
import { TIPO_BLOCO_KONTO } from "@/types/intercompanyReembolsoNf";

const GATEWAY_URL = "https://erp-proxy.onrender.com";

// ═════════════════════════════════════════════════════════════
// Erros
// ═════════════════════════════════════════════════════════════

export type ReembolsoNfErrorKind = "network" | "auth" | "validation" | "alvo_orfao";

export class ReembolsoNfError extends Error {
  readonly kind: ReembolsoNfErrorKind;
  readonly details?: {
    chave_orfa?: number;
    raw?: unknown;
    httpStatus?: number;
  };

  constructor(kind: ReembolsoNfErrorKind, message: string, details?: ReembolsoNfError["details"]) {
    super(message);
    this.kind = kind;
    this.details = details;
    this.name = "ReembolsoNfError";
  }
}

const ERROR_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /duplicate key.*unique constraint/i, message: "Já existe uma invoice com esse número. Tente outro." },
  { pattern: /rascunho vazio|empty rascunho/i, message: "Adicione pelo menos um item à cesta antes de emitir." },
  {
    pattern: /items? without konto_at|item sem konto/i,
    message: "Há itens sem Konto AT escolhido. Complete a classificação antes de emitir.",
  },
  {
    pattern: /rateio.*not found|rateio.*não encontrado/i,
    message: "Esta NF não está mais disponível (possivelmente já foi usada por outra cesta).",
  },
  { pattern: /invalid tipo_bloco/i, message: "Tipo de bloco inválido. Recarregue a página e tente novamente." },
  { pattern: /period invalid|período inválido/i, message: "Período inválido. Use formato AAAA-MM-DD." },
  { pattern: /item não encontrado|item not found/i, message: "Este item não está mais na cesta. Recarregue a página." },
  { pattern: /classe não mapeada|class not mapped/i, message: "Classe contábil sem mapeamento. Acione o financeiro." },
];

export function friendlyErrorMessage(error: unknown): string {
  if (error instanceof ReembolsoNfError) {
    if (error.kind === "alvo_orfao") {
      const chave = error.details?.chave_orfa ?? "—";
      return `Atenção: a invoice foi criada no Alvo (chave ${chave}) mas houve falha ao registrar no Hub. Acione TI imediatamente.`;
    }
    if (error.kind === "auth") {
      return "Sua sessão expirou. Faça login novamente.";
    }
    if (error.kind === "network") {
      return "Conexão instável. Verifique sua internet e tente novamente.";
    }
    for (const { pattern, message } of ERROR_PATTERNS) {
      if (pattern.test(error.message)) return message;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Erro inesperado. Tente novamente.";
}

function classifySupabaseError(error: { code?: string; message?: string }): ReembolsoNfError {
  const code = error.code ?? "";
  const message = error.message ?? "Erro desconhecido";

  if (code === "PGRST301" || code === "42501") {
    return new ReembolsoNfError("auth", message, { raw: error });
  }
  if (code.startsWith("P0") || code.startsWith("23")) {
    return new ReembolsoNfError("validation", message, { raw: error });
  }
  return new ReembolsoNfError("network", message, { raw: error });
}

function classifyGatewayResponse(
  status: number,
  body: { success?: boolean; error?: string; chave_docfin_alvo_orfa?: number } | null,
): ReembolsoNfError | null {
  if (status >= 200 && status < 300 && body?.success !== false && !body?.chave_docfin_alvo_orfa) {
    return null;
  }
  if (body?.chave_docfin_alvo_orfa) {
    return new ReembolsoNfError("alvo_orfao", body.error ?? "Falha ao registrar invoice no Hub após emissão no Alvo.", {
      chave_orfa: body.chave_docfin_alvo_orfa,
      raw: body,
      httpStatus: status,
    });
  }
  if (status === 401 || status === 403) {
    return new ReembolsoNfError("auth", body?.error ?? "Sessão inválida.", { raw: body, httpStatus: status });
  }
  if (status >= 500) {
    return new ReembolsoNfError("network", body?.error ?? "Servidor temporariamente indisponível.", {
      raw: body,
      httpStatus: status,
    });
  }
  return new ReembolsoNfError("validation", body?.error ?? `Erro ${status}`, { raw: body, httpStatus: status });
}

// ═════════════════════════════════════════════════════════════
// Autenticação
// ═════════════════════════════════════════════════════════════

function getAccessToken(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        return parsed?.access_token ?? null;
      }
    }
  } catch (e) {
    console.error("Erro lendo access token", e);
  }
  return null;
}

async function callGateway<TResp>(path: string, body: unknown): Promise<TResp> {
  const token = getAccessToken();
  if (!token) {
    throw new ReembolsoNfError("auth", "Sessão não encontrada. Faça login novamente.");
  }

  let resp: Response;
  try {
    resp = await fetch(`${GATEWAY_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new ReembolsoNfError("network", "Não foi possível conectar ao servidor.", { raw: e });
  }

  let parsed: any = null;
  try {
    parsed = await resp.json();
  } catch {
    throw new ReembolsoNfError("network", `Resposta inválida do servidor (HTTP ${resp.status}).`, {
      httpStatus: resp.status,
    });
  }

  const err = classifyGatewayResponse(resp.status, parsed);
  if (err) throw err;

  return parsed as TResp;
}

// ═════════════════════════════════════════════════════════════
// View v_movestq_disponivel — Lado 1
// ═════════════════════════════════════════════════════════════

/**
 * Lista NFs disponíveis pra adicionar à cesta. Filtros aplicados server-side.
 *
 * Defaults aplicados quando filtros não informados:
 *   - status_classificacao = "classificado" (esconde aguardando)
 *   - data_emissao_de = hoje - 30 dias
 *
 * Para mostrar NFs aguardando, passe status_classificacao: null EXPLICITAMENTE.
 * Ordenado por data_emissao DESC (mais recentes primeiro).
 */
export async function getMovEstqDisponivel(filtros: MovEstqFiltros = {}): Promise<MovEstqDisponivel[]> {
  // Default: últimos 30 dias se data_de não foi passada
  const hoje = new Date();
  const trintaDiasAtras = new Date(hoje);
  trintaDiasAtras.setDate(hoje.getDate() - 30);
  const dataDeDefault = trintaDiasAtras.toISOString().slice(0, 10);

  let query = (supabase as any).from("v_movestq_disponivel").select("*").order("data_emissao", { ascending: false });

  // Datas (com default de 30 dias se não passada)
  const dataDe = filtros.data_emissao_de ?? dataDeDefault;
  query = query.gte("data_emissao", dataDe);
  if (filtros.data_emissao_ate) {
    query = query.lte("data_emissao", filtros.data_emissao_ate);
  }

  // Classe / CC / Espécie
  if (filtros.codigo_classe) query = query.eq("codigo_classe", filtros.codigo_classe);
  if (filtros.codigo_centro_ctrl) query = query.eq("codigo_centro_ctrl", filtros.codigo_centro_ctrl);
  if (filtros.especie) query = query.eq("especie", filtros.especie);

  // Status: default = "classificado" se filtros.status_classificacao === undefined.
  // Se passou null EXPLÍCITO, não aplica filtro (mostra tudo).
  if (filtros.status_classificacao === undefined) {
    query = query.eq("status_classificacao", "classificado");
  } else if (filtros.status_classificacao !== null) {
    query = query.eq("status_classificacao", filtros.status_classificacao);
  }

  // Busca textual
  if (filtros.busca && filtros.busca.trim()) {
    const q = `%${filtros.busca.trim()}%`;
    query = query.or(`nome_entidade.ilike.${q},numero.ilike.${q}`);
  }

  const { data, error } = await query;
  if (error) throw classifySupabaseError(error);
  return (data ?? []) as MovEstqDisponivel[];
}

// ═════════════════════════════════════════════════════════════
// RPCs do rascunho — Lado 2
// ═════════════════════════════════════════════════════════════

export async function initOrResumeRascunho(): Promise<InitOrResumeRascunhoResult> {
  const { data, error } = await (supabase as any).rpc("init_or_resume_rascunho");
  if (error) throw classifySupabaseError(error);
  return data as InitOrResumeRascunhoResult;
}

export async function getRascunhoDetails(): Promise<RascunhoDetails> {
  const { data, error } = await (supabase as any).rpc("get_rascunho_details");
  if (error) throw classifySupabaseError(error);
  return data as RascunhoDetails;
}

export async function addRateioToRascunho(rateioId: string): Promise<RascunhoMutationResult> {
  const { data, error } = await (supabase as any).rpc("add_rateio_to_rascunho", {
    p_movestq_rateio_id: rateioId,
  });
  if (error) throw classifySupabaseError(error);
  return data as RascunhoMutationResult;
}

export async function removeRateioFromRascunho(itemId: string): Promise<RascunhoMutationResult> {
  const { data, error } = await (supabase as any).rpc("remove_rateio_from_rascunho", {
    p_item_id: itemId,
  });
  if (error) throw classifySupabaseError(error);
  return data as RascunhoMutationResult;
}

export async function setRascunhoItemKonto(itemId: string, tipoBloco: TipoBloco): Promise<RascunhoMutationResult> {
  const kontoNumero = TIPO_BLOCO_KONTO[tipoBloco];
  if (!kontoNumero) {
    throw new ReembolsoNfError("validation", `Tipo de bloco inválido: ${tipoBloco}`);
  }
  const { data, error } = await (supabase as any).rpc("set_rascunho_item_konto", {
    p_item_id: itemId,
    p_tipo_bloco: tipoBloco,
    p_konto_at_numero: kontoNumero,
  });
  if (error) throw classifySupabaseError(error);
  return data as RascunhoMutationResult;
}

export async function discardRascunho(): Promise<RascunhoMutationResult> {
  const { data, error } = await (supabase as any).rpc("discard_rascunho");
  if (error) throw classifySupabaseError(error);
  return data as RascunhoMutationResult;
}

// ═════════════════════════════════════════════════════════════
// Rotas do gateway
// ═════════════════════════════════════════════════════════════

export async function syncMovEstq(req: SyncMovEstqRequest): Promise<SyncMovEstqResponse> {
  return callGateway<SyncMovEstqResponse>("/intercompany/movestq/sync", req);
}

export async function emitirInvoice(req: EmitReembolsoNFRequest): Promise<EmitReembolsoNFResponse> {
  return callGateway<EmitReembolsoNFResponse>("/intercompany/reembolso-nf/emit", req);
}
