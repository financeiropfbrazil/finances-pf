/**
 * AJUSTE 7.2 — resolução de ESCOPO de visibilidade do módulo Suprimentos.
 *
 * O modelo RBAC tem três escopos por recurso (Permissoes_e_Roles_v2 §6):
 *   view_own  → só o que eu criei
 *   view_cc   → tudo o que onera os centros de custo que eu LIDERO   ← Ajuste 7.2
 *   view_all  → toda a base
 *
 * Quem resolve é o servidor (`user_has_permission` dentro das RPCs), nunca a UI:
 * a tela só consome a resposta. As RPCs devolvem as duas coisas que o cliente NÃO
 * consegue decidir sozinho — qual escopo o usuário tem, e quais pedidos o rateio
 * alcança (o CC do pedido vive na tabela neta `compras_pedidos_itens_rateio`, que o
 * PostgREST não filtra sem duplicar o pai e quebrar o `count`).
 *
 * Filtro, ordenação, paginação e `count` continuam nas queries das telas — é o que
 * torna a NÃO-REGRESSÃO estrutural: para quem não tem `view_cc`, nada muda.
 */
import { supabase } from "@/integrations/supabase/client";

export type EscopoCompras = "all" | "cc" | "own" | "nenhum";

/** Pedido alcançado pelo rateio, com os CCs (meus) que o alcançaram — o chip usa isso. */
export interface PedidoPorRateio {
  id: string;
  ccs: string[];
}

interface EscopoBase {
  escopo: EscopoCompras;
  isAdmin: boolean;
  ccs: string[];
  motivo: string | null;
  /**
   * true quando a RPC não pôde responder (SQL do Ajuste 7.2 ainda não executado, ou
   * falha de transporte). Quem consome DEVE cair no comportamento anterior — nunca
   * em silêncio: `erroMensagem` diz o porquê e o console registra.
   */
  indisponivel: boolean;
  erroMensagem: string | null;
  /**
   * Por que ficou indisponível:
   *   'rpc_ausente' → esperado na janela entre publicar e rodar o SQL-AJUSTE72.md
   *                   (só console.warn: nesse momento ninguém tem view_cc ainda,
   *                    então alertar na tela seria barulho para todo mundo);
   *   'erro'        → inesperado; a tela DEVE mostrar isso ao usuário.
   */
  motivoFalha: "rpc_ausente" | "erro" | null;
}

/** Requisições não precisam de campo extra além da base. */
export type EscopoRequisicoes = EscopoBase;

export interface EscopoPedidos extends EscopoBase {
  pedidosPorRateio: PedidoPorRateio[];
  /** true quando o conjunto por rateio passou do teto da RPC (800) e foi cortado. */
  truncado: boolean;
  /** Só no modo "um pedido" (tela de detalhe); null na listagem. */
  permitido: boolean | null;
}

const ESCOPO_INDISPONIVEL: EscopoBase = {
  escopo: "nenhum",
  isAdmin: false,
  ccs: [],
  motivo: null,
  indisponivel: true,
  erroMensagem: null,
  motivoFalha: "erro",
};

/**
 * A RPC ainda não existe no banco? O PostgREST responde PGRST202
 * ("Could not find the function … in the schema cache"). É estado ESPERADO na janela
 * entre publicar o código e o Pedro rodar o `SQL-AJUSTE72.md` — e é diferente de um
 * erro de verdade, por isso a mensagem é outra.
 */
function rpcAusente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /could not find the function|schema cache/i.test(error.message || "");
}

function traduzirFalha(contexto: string, error: { code?: string; message?: string } | null): string {
  if (rpcAusente(error)) {
    return `A visão por centro de custo depende da função ${contexto} no banco, que ainda não foi criada (SQL-AJUSTE72.md). A listagem seguiu com o escopo anterior.`;
  }
  return `Falha ao resolver o escopo de ${contexto}: ${error?.message || "erro desconhecido"}. A listagem seguiu com o escopo anterior.`;
}

function normalizarCcs(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((c): c is string => typeof c === "string" && c.length > 0);
}

/** Escopo de REQUISIÇÕES do usuário logado. Nunca lança: degrada avisando. */
export async function carregarEscopoRequisicoes(): Promise<EscopoRequisicoes> {
  const { data, error } = await (supabase as any).rpc("listar_requisicoes_escopo");

  if (error || !data) {
    const mensagem = traduzirFalha("listar_requisicoes_escopo", error);
    // Fallback NUNCA silencioso (regra 6 do Ajuste 7.1, mantida no 7.2).
    const ausente = rpcAusente(error);
    if (ausente) console.warn(`[escopo_requisicoes] ${mensagem}`);
    else console.error(`[escopo_requisicoes] ${mensagem}`, error);
    return { ...ESCOPO_INDISPONIVEL, erroMensagem: mensagem, motivoFalha: ausente ? "rpc_ausente" : "erro" };
  }

  return {
    escopo: (data.escopo as EscopoCompras) ?? "nenhum",
    isAdmin: data.is_admin === true,
    ccs: normalizarCcs(data.ccs),
    motivo: data.motivo ?? null,
    indisponivel: false,
    erroMensagem: null,
    motivoFalha: null,
  };
}

/** Escopo de PEDIDOS do usuário logado (modo listagem). Nunca lança: degrada avisando. */
export async function carregarEscopoPedidos(): Promise<EscopoPedidos> {
  const { data, error } = await (supabase as any).rpc("listar_pedidos_escopo");

  if (error || !data) {
    const mensagem = traduzirFalha("listar_pedidos_escopo", error);
    const ausente = rpcAusente(error);
    if (ausente) console.warn(`[escopo_pedidos] ${mensagem}`);
    else console.error(`[escopo_pedidos] ${mensagem}`, error);
    return {
      ...ESCOPO_INDISPONIVEL,
      erroMensagem: mensagem,
      motivoFalha: ausente ? "rpc_ausente" : "erro",
      pedidosPorRateio: [],
      truncado: false,
      permitido: null,
    };
  }

  const pedidos: PedidoPorRateio[] = Array.isArray(data.pedidos_cc)
    ? data.pedidos_cc
        .filter((p: any) => p && typeof p.id === "string")
        .map((p: any) => ({ id: p.id as string, ccs: normalizarCcs(p.ccs) }))
    : [];

  return {
    escopo: (data.escopo as EscopoCompras) ?? "nenhum",
    isAdmin: data.is_admin === true,
    ccs: normalizarCcs(data.ccs),
    motivo: data.motivo ?? null,
    indisponivel: false,
    erroMensagem: null,
    motivoFalha: null,
    pedidosPorRateio: pedidos,
    truncado: data.truncado === true,
    permitido: null,
  };
}

/**
 * Modo "um pedido": a MESMA regra da listagem responde se este pedido pode ser aberto.
 * É o que evita o defeito do Ajuste 7.1 se repetindo em Pedidos — lista e detalhe
 * passam a ler a mesma fonte de verdade.
 */
export async function consultarEscopoPedido(pedidoId: string): Promise<EscopoPedidos> {
  const { data, error } = await (supabase as any).rpc("listar_pedidos_escopo", { p_pedido_id: pedidoId });

  if (error || !data) {
    const mensagem = traduzirFalha("listar_pedidos_escopo", error);
    const ausente = rpcAusente(error);
    if (ausente) console.warn(`[escopo_pedido_detalhe] ${mensagem}`);
    else console.error(`[escopo_pedido_detalhe] ${mensagem}`, error);
    return {
      ...ESCOPO_INDISPONIVEL,
      erroMensagem: mensagem,
      motivoFalha: ausente ? "rpc_ausente" : "erro",
      pedidosPorRateio: [],
      truncado: false,
      permitido: null,
    };
  }

  return {
    escopo: (data.escopo as EscopoCompras) ?? "nenhum",
    isAdmin: data.is_admin === true,
    ccs: normalizarCcs(data.ccs),
    motivo: data.motivo ?? null,
    indisponivel: false,
    erroMensagem: null,
    motivoFalha: null,
    pedidosPorRateio: [],
    truncado: false,
    permitido: data.permitido === true,
  };
}

/**
 * Valor pronto para um ramo `in.(…)` do PostgREST dentro de um `.or()`.
 * Aspas duplas em cada item: os códigos de CC têm pontos e os números do Alvo são
 * texto — sem aspas, um valor com vírgula ou parêntese quebraria o filtro inteiro.
 */
export function listaParaFiltroOr(valores: string[]): string {
  return valores.map((v) => `"${String(v).replace(/"/g, "")}"`).join(",");
}
