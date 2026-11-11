/**
 * Aprovação do pedido e pedidos sugeridos nos Excel de notas (PLANO-NFE NFE-17, Pedro 11/11/2026).
 *
 * - Aprovação: RPC `pedidos_aprovacao` (status de aprovação do pedido no Alvo, espelhado no Hub).
 * - Sugeridos: RPCs `nfe_pedidos_sugeridos` / `nfse_pedidos_sugeridos` — os MESMOS candidatos da etapa 2 do detalhe,
 *   calculados em lote (conferidos nota a nota contra o detalhe em 11/11/2026: 1.038 NF-e e 81 NFS-e iguais).
 * Comum ao Excel de etapas (NF-e e NFS-e) e ao Excel da contabilidade (NFS-e).
 */
import { supabase } from "@/integrations/supabase/client";

export interface AprovacaoPedido {
  numero: string;
  status: string | null;
  status_aprovacao: string | null;
  aprovado: string | null;
  aprovado_total: boolean;
  data_aprovacao_alvo: string | null;
}

export interface PedidoSugerido {
  numero: string;
  status_aprovacao: string | null;
  aprovado: string | null;
  diferenca_pct: number | null;
  forca: number | null;
}

/** Campos que entram na linha do Excel. */
export interface PedidosDaLinha {
  /** Aprovação do(s) pedido(s) da coluna "Pedido"; null = nota sem pedido. */
  pedido_aprovacao: string | null;
  /** true = todos aprovados (aprovação finalizada e total); false = algum não; null = sem pedido. */
  pedido_aprovado: boolean | null;
  pedidos_sugeridos: string | null;
  sugeridos_aprovacao: string | null;
  sugeridos_aprovados: boolean | null;
}

const LOTE = 1000;

function lotes<T>(itens: T[]): T[][] {
  const r: T[][] = [];
  for (let i = 0; i < itens.length; i += LOTE) r.push(itens.slice(i, i + LOTE));
  return r;
}

/** "0003810, 0003811" → ["0003810", "0003811"] (o formato das colunas de pedido dos relatórios). */
export function separarPedidos(texto: string | null | undefined): string[] {
  return (texto ?? "")
    .split(/\s*[,;·/]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function buscarAprovacaoPedidos(numeros: string[]): Promise<Map<string, AprovacaoPedido>> {
  const unicos = [...new Set(numeros.filter(Boolean))];
  const mapa = new Map<string, AprovacaoPedido>();
  for (const lote of lotes(unicos)) {
    const { data, error } = await (supabase as any).rpc("pedidos_aprovacao", { p_numeros: lote });
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as AprovacaoPedido[]) mapa.set(p.numero, p);
  }
  return mapa;
}

async function buscarSugeridos(
  rpc: "nfe_pedidos_sugeridos" | "nfse_pedidos_sugeridos",
  parametro: "p_ids" | "p_chaves",
  chaveSaida: "id" | "chave_acesso",
  chaves: string[],
): Promise<Map<string, PedidoSugerido[]>> {
  const unicas = [...new Set(chaves.filter(Boolean))];
  const mapa = new Map<string, PedidoSugerido[]>();
  for (const lote of lotes(unicas)) {
    const { data, error } = await (supabase as any).rpc(rpc, { [parametro]: lote });
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      mapa.set(String(r[chaveSaida]), ((r.candidatos ?? []) as PedidoSugerido[]).filter((c) => !!c?.numero));
    }
  }
  return mapa;
}

/** NF-e: id da nota → pedidos sugeridos (só notas sem pedido no lançamento do Alvo). */
export const buscarSugeridosNfe = (ids: string[]) => buscarSugeridos("nfe_pedidos_sugeridos", "p_ids", "id", ids);
/** NFS-e: chave de acesso → pedidos sugeridos (só notas sem pedido no lançamento do Alvo). */
export const buscarSugeridosNfse = (chaves: string[]) =>
  buscarSugeridos("nfse_pedidos_sugeridos", "p_chaves", "chave_acesso", chaves);

const aprovadoTotal = (p: { status_aprovacao: string | null; aprovado: string | null }) =>
  p.status_aprovacao === "Finalizada" && p.aprovado === "Total";

/** Rótulo de um pedido: Aprovado · Em Andamento · Reavaliar · Nenhum… · Fora do Hub (pedido que o Hub não tem). */
export function rotuloAprovacao(p: { status_aprovacao: string | null; aprovado: string | null } | undefined): string {
  if (!p) return "Fora do Hub";
  if (aprovadoTotal(p)) return "Aprovado";
  return p.status_aprovacao?.trim() || "Sem aprovação";
}

/** Vários pedidos: "Aprovado" se todos estão aprovados; senão "0004317: Reavaliar · 0004318: Aprovado". */
function juntarRotulos(itens: { numero: string; rotulo: string; aprovado: boolean }[]): {
  texto: string | null;
  aprovado: boolean | null;
} {
  if (itens.length === 0) return { texto: null, aprovado: null };
  const todos = itens.every((i) => i.aprovado);
  if (itens.length === 1) return { texto: itens[0].rotulo, aprovado: todos };
  return { texto: todos ? "Aprovado" : itens.map((i) => `${i.numero}: ${i.rotulo}`).join(" · "), aprovado: todos };
}

const pct = (v: number | null) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "";
  const n = Number(v);
  if (n === 0) return "exato";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
};

/** "0005253 (citado, exato) · 0005256 (+1,4%)" — na ordem da etapa 2. */
export function textoSugeridos(cands: PedidoSugerido[] | undefined): string | null {
  if (!cands?.length) return null;
  return cands
    .map((c) => {
      const det = [c.forca === 1 ? "citado na nota" : "", pct(c.diferenca_pct)].filter(Boolean).join(", ");
      return det ? `${c.numero} (${det})` : c.numero;
    })
    .join(" · ");
}

/** Monta os campos de pedido de uma linha a partir da coluna "Pedido", da aprovação e dos sugeridos da nota. */
export function pedidosDaLinha(
  pedidos: string | null | undefined,
  aprovacao: Map<string, AprovacaoPedido>,
  sugeridos: PedidoSugerido[] | undefined,
): PedidosDaLinha {
  const doPedido = juntarRotulos(
    separarPedidos(pedidos).map((numero) => {
      const a = aprovacao.get(numero);
      return { numero, rotulo: rotuloAprovacao(a), aprovado: !!a && a.aprovado_total };
    }),
  );
  const dosSugeridos = juntarRotulos(
    (sugeridos ?? []).map((c) => ({ numero: c.numero, rotulo: rotuloAprovacao(c), aprovado: aprovadoTotal(c) })),
  );
  return {
    pedido_aprovacao: doPedido.texto,
    pedido_aprovado: doPedido.aprovado,
    pedidos_sugeridos: textoSugeridos(sugeridos),
    sugeridos_aprovacao: dosSugeridos.texto,
    sugeridos_aprovados: dosSugeridos.aprovado,
  };
}
