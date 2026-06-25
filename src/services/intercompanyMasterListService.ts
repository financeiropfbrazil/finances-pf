import { supabase } from "@/integrations/supabase/client";
import type {
  MasterBlocoDetalhe,
  MasterFiltros,
  MasterFiltrosDisponiveis,
  MasterListResponse,
} from "@/types/intercompanyMaster";

/**
 * Busca filtros disponíveis (anos, tipos, status, classes, kontos, CCs).
 */
export async function buscarFiltrosDisponiveis(): Promise<MasterFiltrosDisponiveis> {
  const { data, error } = await (supabase as any).rpc("get_master_filtros_disponiveis");
  if (error) throw new Error(error.message);
  return data as MasterFiltrosDisponiveis;
}

/**
 * Lista invoices da master unificada com filtros, paginação e resumo agregado.
 */
export async function listarMaster(
  filtros: MasterFiltros = {},
  page: number = 1,
  pageSize: number = 20,
): Promise<MasterListResponse> {
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
 * Busca blocos detalhados de um invoice (com rateios e nomes de CCs).
 * Usado pelo accordion ao expandir uma linha.
 */
export async function buscarBlocosDetalhe(masterId: string): Promise<MasterBlocoDetalhe[]> {
  // 1. Busca blocos da master
  const { data: blocos, error: errBlocos } = await (supabase as any)
    .from("intercompany_invoices_master_blocos")
    .select(
      `
      id,
      ordem,
      tipo_bloco,
      descricao,
      classe_codigo,
      konto_at_numero,
      valor_eur,
      classification_status
    `,
    )
    .eq("master_id", masterId)
    .order("ordem", { ascending: true });

  if (errBlocos) throw new Error(errBlocos.message);
  if (!blocos || blocos.length === 0) return [];

  // 2. Busca todos os rateios desses blocos numa query só
  const blocoIds = blocos.map((b: any) => b.id);
  const { data: rateios, error: errRateios } = await (supabase as any)
    .from("intercompany_invoices_master_bloco_rateios")
    .select(
      `
      bloco_id,
      centro_custo_erp_code,
      percentual,
      valor_eur,
      ordem,
      cost_centers!inner (name)
    `,
    )
    .in("bloco_id", blocoIds)
    .order("ordem", { ascending: true });

  if (errRateios) throw new Error(errRateios.message);

  // 3. Busca descrições dos kontos AT
  const kontosUnicos = Array.from(new Set(blocos.map((b: any) => b.konto_at_numero).filter(Boolean)));
  const kontosMap = new Map<string, string>();
  if (kontosUnicos.length > 0) {
    const { data: kontos } = await (supabase as any)
      .from("intercompany_kontos")
      .select("numero, descricao_pt")
      .in("numero", kontosUnicos);
    (kontos || []).forEach((k: any) => kontosMap.set(k.numero, k.descricao_pt));
  }

  // 4. Monta resposta agrupando rateios por bloco
  return blocos.map((b: any) => ({
    id: b.id,
    ordem: b.ordem,
    tipo_bloco: b.tipo_bloco,
    descricao: b.descricao,
    classe_codigo: b.classe_codigo,
    konto_at_numero: b.konto_at_numero,
    konto_at_descricao: b.konto_at_numero ? (kontosMap.get(b.konto_at_numero) ?? null) : null,
    valor_eur: Number(b.valor_eur),
    classification_status: b.classification_status,
    rateios: (rateios || [])
      .filter((r: any) => r.bloco_id === b.id)
      .map((r: any) => ({
        centro_custo_erp_code: r.centro_custo_erp_code,
        centro_custo_nome: r.cost_centers?.name ?? null,
        percentual: Number(r.percentual),
        valor_eur: Number(r.valor_eur),
        ordem: r.ordem,
      })),
  }));
}

/**
 * Exporta lista completa pra Excel (varre todas as páginas).
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
    if (page > 50) {
      console.warn("[buscarTudoParaExportar] Atingido limite de 50 páginas (10000 linhas).");
      break;
    }
  } while (page <= totalPages);

  return allItems;
}

/**
 * Lista os Kontos ativos selecionáveis para o editor inline da listagem.
 * Exclui o 77930 (destino do markup automático, não é Konto de classificação direta).
 */
export async function listarKontosAtivos(): Promise<{ numero: string; descricao: string }[]> {
  const { data, error } = await (supabase as any)
    .from("intercompany_kontos")
    .select("numero, descricao_pt")
    .eq("ativo", true)
    .neq("numero", "77930")
    .order("numero", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((k: any) => ({ numero: String(k.numero), descricao: k.descricao_pt }));
}

/**
 * Altera inline o Konto AT de uma invoice MONO-BLOCO.
 * Chama a RPC atualizar_konto_bloco_inline, que aplica todas as travas no servidor:
 * exige permissão intercompany.classify, só aceita invoice de 1 bloco, recusa o 77930.
 * A RPC devolve mensagens de erro claras em português, repassadas aqui.
 */
export async function atualizarKontoBlocoInline(masterId: string, kontoNumero: string): Promise<void> {
  const { error } = await (supabase as any).rpc("atualizar_konto_bloco_inline", {
    p_master_id: masterId,
    p_konto_at_numero: kontoNumero,
  });
  if (error) throw new Error(error.message);
}

/**
 * Detalhe leve do master para o painel lateral: origem (enum cru, define o bucket
 * do PDF), flag de pago, e a lista de anexos (PDFs gerados pelo Hub).
 */
export async function buscarDetalheMaster(
  masterId: string,
): Promise<{ origem: string; pago: boolean; anexos: { filename: string; storage_path: string }[] }> {
  const { data, error } = await (supabase as any)
    .from("intercompany_invoices_master")
    .select("origem, pago, anexos")
    .eq("id", masterId)
    .single();

  if (error) throw new Error(error.message);
  return {
    origem: data?.origem,
    pago: data?.pago ?? false,
    anexos: Array.isArray(data?.anexos) ? data.anexos : [],
  };
}

/**
 * Liga/desliga a flag "Pago" de uma invoice. Chama a RPC definir_pago_master,
 * gated por intercompany.classify. (Mais tarde o Alvo preenche essa mesma coluna.)
 */
export async function definirPagoMaster(masterId: string, pago: boolean): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("definir_pago_master", {
    p_master_id: masterId,
    p_pago: pago,
  });
  if (error) throw new Error(error.message);
  return data as boolean;
}
