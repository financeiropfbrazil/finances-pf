/**
 * Service da Frente 3 — Intercompany / Reembolso NF.
 *
 * Camada única que fala com:
 *   - Supabase (RPCs + view v_movestq_disponivel)
 *   - Gateway erp-proxy (POST /movestq/sync, POST /reembolso-nf/emit)
 *
 * Hooks TanStack Query em src/hooks/useReembolsoNf.ts consomem este service.
 * Componentes NUNCA chamam Supabase ou fetch direto — sempre via hooks.
 *
 * Tratamento de erro: ver classifyError() e ReembolsoNfError abaixo.
 * Cada função pode lançar ReembolsoNfError com kind discriminado.
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

/**
 * Erro padronizado da Frente 3. Sempre que o service lança erro, é esta classe.
 * O componente pode discriminar com `error.kind` e mostrar UX apropriada.
 */
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

// ─── Catálogo de mensagens técnico → amigável ──────────────────
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

/**
 * Converte mensagem técnica em texto amigável pra Sandra.
 * Se nenhum padrão bater, devolve a mensagem original (fallback).
 */
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
    // validation — tenta traduzir
    for (const { pattern, message } of ERROR_PATTERNS) {
      if (pattern.test(error.message)) return message;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Erro inesperado. Tente novamente.";
}

// ─── Classificadores internos ──────────────────────────────────

/** Classifica erro de RPC Supabase. */
function classifySupabaseError(error: { code?: string; message?: string }): ReembolsoNfError {
  const code = error.code ?? "";
  const message = error.message ?? "Erro desconhecido";

  if (code === "PGRST301" || code === "42501") {
    return new ReembolsoNfError("auth", message, { raw: error });
  }
  // RAISE EXCEPTION em RPCs PL/pgSQL usa códigos P0xxx, ou Postgres erros 23xxx (constraint)
  if (code.startsWith("P0") || code.startsWith("23")) {
    return new ReembolsoNfError("validation", message, { raw: error });
  }
  return new ReembolsoNfError("network", message, { raw: error });
}

/** Classifica erro do gateway erp-proxy a partir de Response + body parseado. */
function classifyGatewayResponse(
  status: number,
  body: { success?: boolean; error?: string; chave_docfin_alvo_orfa?: number } | null,
): ReembolsoNfError | null {
  // Sucesso
  if (status >= 200 && status < 300 && body?.success !== false && !body?.chave_docfin_alvo_orfa) {
    return null;
  }
  // Erro tardio: Alvo gravou, Hub falhou
  if (body?.chave_docfin_alvo_orfa) {
    return new ReembolsoNfError("alvo_orfao", body.error ?? "Falha ao registrar invoice no Hub após emissão no Alvo.", {
      chave_orfa: body.chave_docfin_alvo_orfa,
      raw: body,
      httpStatus: status,
    });
  }
  // Auth
  if (status === 401 || status === 403) {
    return new ReembolsoNfError("auth", body?.error ?? "Sessão inválida.", { raw: body, httpStatus: status });
  }
  // 5xx — provavelmente Render acordando ou bug do gateway
  if (status >= 500) {
    return new ReembolsoNfError("network", body?.error ?? "Servidor temporariamente indisponível.", {
      raw: body,
      httpStatus: status,
    });
  }
  // 4xx com success: false — erro de validação de negócio
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

// ═════════════════════════════════════════════════════════════
// Helper genérico pra chamadas ao gateway
// ═════════════════════════════════════════════════════════════

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
    // Network puro (sem internet, DNS, CORS bloqueado, etc)
    throw new ReembolsoNfError("network", "Não foi possível conectar ao servidor.", { raw: e });
  }

  // Tenta parsear JSON mesmo em erro — o gateway costuma devolver { success: false, error: "..." }
  let parsed: any = null;
  try {
    parsed = await resp.json();
  } catch {
    // Se não conseguiu parsear, é provavelmente um 502/503 do Render
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
 * Lista NFs disponíveis pra adicionar à cesta. Filtragem é server-side via SELECT;
 * a view já exclui rateios já consumidos (Cenário A).
 *
 * @param filtros aplicados como WHERE clause no SELECT. Tudo opcional.
 */
export async function getMovEstqDisponivel(filtros: MovEstqFiltros = {}): Promise<MovEstqDisponivel[]> {
  let query = (supabase as any).from("v_movestq_disponivel").select("*").order("data_emissao", { ascending: false });

  if (filtros.data_de) query = query.gte("data_emissao", filtros.data_de);
  if (filtros.data_ate) query = query.lte("data_emissao", filtros.data_ate);
  if (filtros.codigo_classe) query = query.eq("codigo_classe", filtros.codigo_classe);
  if (filtros.codigo_centro_ctrl) query = query.eq("codigo_centro_ctrl", filtros.codigo_centro_ctrl);
  // busca: texto livre em fornecedor/numero — usa ilike concatenado
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

/**
 * Cria rascunho do user ou recupera o existente. Idempotente.
 * Chamada na entrada da página (Passo 3.5).
 */
export async function initOrResumeRascunho(): Promise<InitOrResumeRascunhoResult> {
  const { data, error } = await (supabase as any).rpc("init_or_resume_rascunho");
  if (error) throw classifySupabaseError(error);
  return data as InitOrResumeRascunhoResult;
}

/**
 * Estado completo da cesta. Driver principal do Lado 2.
 */
export async function getRascunhoDetails(): Promise<RascunhoDetails> {
  const { data, error } = await (supabase as any).rpc("get_rascunho_details");
  if (error) throw classifySupabaseError(error);
  return data as RascunhoDetails;
}

/**
 * Adiciona um rateio MovEstq à cesta.
 * Sandra clica checkbox no Lado 1 → este método é chamado.
 */
export async function addRateioToRascunho(rateioId: string): Promise<RascunhoMutationResult> {
  const { data, error } = await (supabase as any).rpc("add_rateio_to_rascunho", {
    p_movestq_rateio_id: rateioId,
  });
  if (error) throw classifySupabaseError(error);
  return data as RascunhoMutationResult;
}

/**
 * Remove um item da cesta (lixeirinha no Lado 2).
 */
export async function removeRateioFromRascunho(itemId: string): Promise<RascunhoMutationResult> {
  const { data, error } = await (supabase as any).rpc("remove_rateio_from_rascunho", {
    p_item_id: itemId,
  });
  if (error) throw classifySupabaseError(error);
  return data as RascunhoMutationResult;
}

/**
 * Sandra escolhe o tipo de bloco no dropdown. Konto AT é derivado.
 */
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

/**
 * Descarta rascunho ativo. Sandra usa botão "Descartar".
 */
export async function discardRascunho(): Promise<RascunhoMutationResult> {
  const { data, error } = await (supabase as any).rpc("discard_rascunho");
  if (error) throw classifySupabaseError(error);
  return data as RascunhoMutationResult;
}

// ═════════════════════════════════════════════════════════════
// Rotas do gateway
// ═════════════════════════════════════════════════════════════

/**
 * Sincroniza NFs do Alvo (MovEstq) pra view. Sandra usa botão "Sincronizar".
 * Pode demorar (até 30s pra períodos grandes + Render cold start).
 */
export async function syncMovEstq(req: SyncMovEstqRequest): Promise<SyncMovEstqResponse> {
  return callGateway<SyncMovEstqResponse>("/intercompany/movestq/sync", req);
}

/**
 * Emite a INV no Alvo + converte rascunho → master no Hub.
 *
 * Operação atômica do ponto de vista do Hub. Mas se Alvo gravou e Hub falhou,
 * o body vem com `chave_docfin_alvo_orfa` populado — nesse caso este método
 * lança ReembolsoNfError com kind="alvo_orfao" e details.chave_orfa preenchido.
 * O componente deve detectar e abrir o modal crítico bloqueante.
 */
export async function emitirInvoice(req: EmitReembolsoNFRequest): Promise<EmitReembolsoNFResponse> {
  return callGateway<EmitReembolsoNFResponse>("/intercompany/reembolso-nf/emit", req);
}
