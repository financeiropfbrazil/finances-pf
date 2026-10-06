/**
 * Rastreio de Compras — Requisição → Pedido → NF → Estoque → Pagamento.
 *
 * Fonte única: RPC `rastreio_compras_listar` (SECURITY DEFINER, só admin),
 * que lê a materialized view `mv_rastreio_compras` (atualizada de hora em hora
 * pelo pg_cron, e sob demanda pela RPC `rastreio_compras_atualizar`).
 *
 * Grão: UMA LINHA POR PEDIDO × NF. Pedido sem NF = 1 linha com o bloco NF
 * vazio. NF que atende 2+ pedidos aparece em cada um, com o "valor deste
 * pedido na NF"; o título (pagamento) é da NF e se repete nessas linhas.
 *
 * A RPC devolve um jsonb (sem o teto de 1000 linhas do PostgREST) e aceita
 * `p_limit` até 1000 — a exportação pede em blocos de 1000 e confere a
 * contagem no fim.
 */
import { supabase } from "@/integrations/supabase/client";

export type CampoData = "pedido" | "requisicao" | "nf" | "pagamento";

export const CAMPOS_DATA: { valor: CampoData; label: string }[] = [
  { valor: "pedido", label: "Data do pedido" },
  { valor: "requisicao", label: "Abertura da requisição" },
  { valor: "nf", label: "Entrada da NF" },
  { valor: "pagamento", label: "1º pagamento" },
];

/** Ordem do funil — a mesma da coluna etapa_ordem da view. */
export const ETAPAS_ORDEM = [
  "Pedido em aprovação",
  "Aguardando NF",
  "Em inspeção (laudo)",
  "Aguardando pagamento",
  "Adiantamento pago (sem NF)",
  "Pago (NF não ligada)",
  "Pago (1ª parcela)",
  "Encerrado sem NF ligada",
  "Cancelado",
] as const;

export interface LinhaRastreio {
  pedido_numero: string;
  chave_movestq: number | null;
  etapa: string;
  etapa_ordem: number | null;
  // Requisição
  req_numeros: string | null;
  req_qtd: number | null;
  req_abertura: string | null;
  req_requisitante: string | null;
  req_cc_codigo: string | null;
  req_cc_nome: string | null;
  req_status_alvo: string | null;
  req_aprovacao_lider: string | null;
  // Pedido
  pedido_data: string | null;
  pedido_aprovacao: string | null;
  pedido_status: string | null;
  pedido_codigo_fornecedor: string | null;
  pedido_fornecedor: string | null;
  pedido_cnpj: string | null;
  pedido_valor: number | null;
  pedido_moeda: string | null;
  pedido_cond_pagamento: string | null;
  pedido_cc: string | null;
  pedido_cc_nome: string | null;
  pedido_classe: string | null;
  pedido_natureza: string | null;
  pedido_comprador: string | null;
  // NF
  nf_numero: string | null;
  nf_especie: string | null;
  nf_emissao: string | null;
  nf_entrada: string | null;
  nf_valor_total: number | null;
  nf_fornecedor: string | null;
  nf_tipo_lanc: string | null;
  valor_pedido_na_nf: number | null;
  pedido_qtd_nfs: number | null;
  fontes_vinculo: string | null;
  // Estoque
  laudo_numeros: string | null;
  laudo_qtd: number | null;
  laudo_concluidos: number | null;
  laudo_conclusao: string | null;
  laudo_resultado: string | null;
  // Pagamento — adiantamento
  adto_vencimento: string | null;
  adto_valor: number | null;
  adto_pagamento: string | null;
  adto_situacao: string | null;
  // Pagamento — projeção do pedido (parcela 1)
  proj_p1_vencimento: string | null;
  proj_p1_pagamento: string | null;
  proj_p1_valor: number | null;
  proj_p1_valor_pago: number | null;
  proj_qtd_parcelas: number | null;
  // Pagamento — título da NF (parcela 1)
  tit_numero: string | null;
  tit_p1_vencimento: string | null;
  tit_p1_prorrogacao: string | null;
  tit_p1_pagamento: string | null;
  tit_p1_valor: number | null;
  tit_p1_valor_pago: number | null;
  tit_p1_situacao: string | null;
  tit_qtd_parcelas: number | null;
  tit_qtd_pagas: number | null;
  tit_ligacao: string | null;
  // Consolidado
  primeiro_pagamento: string | null;
  primeiro_pagamento_origem: string | null;
  // Prazos (dias corridos)
  dias_req_pedido: number | null;
  dias_pedido_aprovacao: number | null;
  dias_aprovacao_nf: number | null;
  dias_nf_estoque: number | null;
  dias_nf_pagamento: number | null;
  dias_ciclo_total: number | null;
}

export interface FiltroRastreio {
  de: string | null; // YYYY-MM-DD
  ate: string | null; // YYYY-MM-DD
  campoData: CampoData;
  busca: string;
  etapas: string[];
}

export interface RespostaRastreio {
  total: number;
  atualizado_em: string | null;
  etapas: { etapa: string; qtd: number }[];
  linhas: LinhaRastreio[];
}

export const TAMANHO_BLOCO_EXPORT = 1000;

export async function listarRastreio(
  filtro: FiltroRastreio,
  limit: number,
  offset: number,
): Promise<RespostaRastreio> {
  const { data, error } = await (supabase as any).rpc("rastreio_compras_listar", {
    p_de: filtro.de,
    p_ate: filtro.ate,
    p_campo_data: filtro.campoData,
    p_busca: filtro.busca.trim() || null,
    p_etapas: filtro.etapas.length > 0 ? filtro.etapas : null,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Partial<RespostaRastreio>;
  return {
    total: Number(r.total ?? 0),
    atualizado_em: r.atualizado_em ?? null,
    etapas: Array.isArray(r.etapas) ? r.etapas : [],
    linhas: Array.isArray(r.linhas) ? (r.linhas as LinhaRastreio[]) : [],
  };
}

/**
 * Busca TODAS as linhas do filtro, em blocos de 1000, e confere a contagem.
 * `onProgresso` recebe (carregadas, total) a cada bloco.
 */
export async function listarTudo(
  filtro: FiltroRastreio,
  onProgresso?: (carregadas: number, total: number) => void,
): Promise<LinhaRastreio[]> {
  const todas: LinhaRastreio[] = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += TAMANHO_BLOCO_EXPORT) {
    const r = await listarRastreio(filtro, TAMANHO_BLOCO_EXPORT, offset);
    total = r.total;
    todas.push(...r.linhas);
    onProgresso?.(todas.length, total);
    if (r.linhas.length === 0) break;
  }
  if (todas.length !== total) {
    throw new Error(
      `A contagem não fechou: o filtro tem ${total} linhas e vieram ${todas.length}. ` +
        "Os dados podem ter sido atualizados durante a exportação — tente de novo.",
    );
  }
  return todas;
}

/** Recalcula a materialized view (~5 s). Devolve o novo "atualizado em". */
export async function atualizarDados(): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("rastreio_compras_atualizar");
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

// ════════════════════════════════════════════════════════════
// Datas — colunas `date` chegam "YYYY-MM-DD": parse por componentes LOCAIS
// para o dia não voltar no fuso de Brasília.
// ════════════════════════════════════════════════════════════
export function dataLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [a, m, d] = iso.split("-").map(Number);
    return new Date(a, m - 1, d);
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isoDia(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
