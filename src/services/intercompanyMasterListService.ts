import { supabase } from "@/integrations/supabase/client";
import type {
  MasterFiltros,
  MasterFiltrosDisponiveis,
  MasterListResponse,
  MasterRateioDetalhe,
} from "@/types/intercompanyMaster";

/**
 * Busca filtros disponíveis (anos, tipos, status, classes, kontos, CCs).
 * Cacheia bem porque muda raramente.
 */
export async function buscarFiltrosDisponiveis(): Promise<MasterFiltrosDisponiveis> {
  const { data, error } = await (supabase as any).rpc("get_master_filtros_disponiveis");
  if (error) throw new Error(error.message);
  return data as MasterFiltrosDisponiveis;
}

/**
 * Lista invoices da master unificada com filtros, paginação e resumo agregado.
 * Retorna items + pagination + resumo num único request.
 */
export async function listarMaster(
  filtros: MasterFiltros = {},
  page: number = 1,
  pageSize: number = 20,
): Promise<MasterListResponse> {
  // Sanitiza: remove chaves null/undefined/'' antes de mandar
  const filtrosLimpos: Record<string, any> = {};
  Object.entries(filtros).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== "") {
      filtrosLimpos[k] = v;
    }
  });

  const { data, error } = await (supabase as any).rpc("listar_intercompany_master", {
    p_filtros: filtrosLimpos,
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) throw new Error(error.message);
  return data as MasterListResponse;
}

/**
 * Busca rateios detalhados de um invoice Hub específico (com nome do CC).
 * Usado pelo accordion ao expandir uma linha "Hub".
 * Não chama RPC — query direta porque só precisa de SELECT + JOIN.
 */
export async function buscarRateiosDetalhe(masterId: string): Promise<MasterRateioDetalhe[]> {
  const { data, error } = await (supabase as any)
    .from("intercompany_invoices_master_rateios")
    .select(
      `
      centro_custo_erp_code,
      percentual,
      valor_eur,
      ordem,
      cost_centers!inner (name)
    `,
    )
    .eq("master_id", masterId)
    .order("ordem", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((r: any) => ({
    centro_custo_erp_code: r.centro_custo_erp_code,
    centro_custo_nome: r.cost_centers?.name ?? null,
    percentual: Number(r.percentual),
    valor_eur: Number(r.valor_eur),
    ordem: r.ordem,
  }));
}

/**
 * Exporta a listagem completa (TODAS as linhas que batem nos filtros, sem paginação)
 * pra alimentar a geração de Excel client-side.
 *
 * Estratégia: chama listarMaster com page_size=200 (limite da RPC) e itera páginas
 * até esgotar. Funciona bem pra até ~10k linhas; pra mais que isso vamos precisar
 * mudar pra streaming server-side (futuro).
 */
export async function buscarTudoParaExportar(filtros: MasterFiltros = {}): Promise<MasterListResponse["items"]> {
  const PAGE_SIZE = 200;
  const allItems: MasterListResponse["items"] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const resp = await listarMaster(filtros, page, PAGE_SIZE);
    allItems.push(...resp.items);
    totalPages = resp.pagination.total_pages;
    page++;
    // safety: máximo 50 páginas (10k linhas)
    if (page > 50) {
      console.warn("[buscarTudoParaExportar] Atingido limite de 50 páginas (10000 linhas).");
      break;
    }
  } while (page <= totalPages);

  return allItems;
}
