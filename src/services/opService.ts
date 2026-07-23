import { supabase } from "@/integrations/supabase/client";

/**
 * Service do módulo Ordem de Produção (OP-1.3 — leitura da lista).
 *
 * Leitura DIRETA nas tabelas op_* (a RLS gateia por producao.access — policies
 * de SELECT criadas na OP-1.2). Escritas (criar/editar/transição) virão por RPC
 * SECURITY DEFINER nas tarefas OP-1.4/1.5, nunca por `.insert()` direto.
 *
 * Padrão da casa: `(supabase as any).from(...)`; resolução de nomes (tipo,
 * emissor) em lote por `.in(...)` — mesmo approach de ProjetoRequisicoes.
 */

export interface OrdemProducaoListItem {
  id: string;
  numero: string;
  numero_referencia: string | null;
  status: string;
  tipo_id: string;
  tipo_ordem: string;
  tipo_produto: string;
  destino: string;
  produto_familia: string | null;
  lote: string | null;
  data_inicio: string | null;
  data_fim_planejada: string | null;
  observacoes: string | null;
  emitido_por: string | null;
  emitido_depto: string | null;
  emitido_em: string | null;
  created_at: string;
  updated_at: string;
  // Derivados (resolvidos no service):
  tipo_nome: string | null;
  tipo_codigo: string | null;
  itens_count: number;
  itens_qtd_total: number;
  emitido_por_nome: string | null;
}

export interface OrdemTipo {
  id: string;
  codigo: string;
  nome: string;
}

export interface FiltrosComuns {
  status?: string;
  tipoId?: string;
  dataInicioDe?: string; // "YYYY-MM-DD"
  dataInicioAte?: string; // "YYYY-MM-DD"
  busca?: string; // por numero
}

export interface ListarOrdensParams extends FiltrosComuns {
  orderBy?: { field: string; dir: "asc" | "desc" } | null;
  pagina: number;
  pageSize: number;
}

/** Aplica os filtros server-side compartilhados (status, tipo, período, busca). */
function aplicarFiltros(query: any, p: FiltrosComuns): any {
  if (p.status && p.status !== "todos") query = query.eq("status", p.status);
  if (p.tipoId && p.tipoId !== "todos") query = query.eq("tipo_id", p.tipoId);
  if (p.busca) {
    // Escapa curinga/PostgREST; busca só por numero (ex.: "2026-0501").
    const termo = p.busca.replace(/[,()%]/g, " ").trim();
    if (termo) query = query.ilike("numero", `%${termo}%`);
  }
  // Período por data_inicio: só filtra quando AMBOS estão preenchidos.
  if (p.dataInicioDe && p.dataInicioAte) {
    query = query.gte("data_inicio", p.dataInicioDe).lte("data_inicio", p.dataInicioAte);
  }
  return query;
}

/**
 * Lista paginada de OPs + total (count exato). Resolve, em lote, o nome do tipo,
 * o agregado de itens (nº de SKUs e soma das quantidades) e o nome do emissor.
 */
export async function listarOrdens(params: ListarOrdensParams): Promise<{
  ordens: OrdemProducaoListItem[];
  total: number;
}> {
  const inicio = (params.pagina - 1) * params.pageSize;
  const fim = inicio + params.pageSize - 1;

  let query = (supabase as any).from("op_ordens").select("*", { count: "exact" });
  query = aplicarFiltros(query, params);

  if (params.orderBy) {
    query = query.order(params.orderBy.field, { ascending: params.orderBy.dir === "asc", nullsFirst: false });
  } else {
    query = query.order("created_at", { ascending: false, nullsFirst: false });
  }
  query = query.range(inicio, fim);

  const { data, count, error } = await query;
  if (error) throw error;

  const rows: any[] = data || [];
  if (rows.length === 0) return { ordens: [], total: count || 0 };

  const tipoIds = Array.from(new Set(rows.map((r) => r.tipo_id).filter(Boolean)));
  const opIds = rows.map((r) => r.id);
  const emitidoIds = Array.from(new Set(rows.map((r) => r.emitido_por).filter(Boolean)));

  const [tiposRes, itensRes, profsRes] = await Promise.all([
    tipoIds.length
      ? (supabase as any).from("op_tipos").select("id, nome, codigo").in("id", tipoIds)
      : Promise.resolve({ data: [] as any[] }),
    (supabase as any).from("op_ordem_itens").select("op_id, quantidade_planejada").in("op_id", opIds),
    emitidoIds.length
      ? supabase.from("profiles").select("user_id, full_name").in("user_id", emitidoIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const tipoMap = new Map<string, { nome: string; codigo: string }>();
  (tiposRes.data || []).forEach((t: any) => tipoMap.set(t.id, { nome: t.nome, codigo: t.codigo }));

  const aggMap = new Map<string, { count: number; total: number }>();
  (itensRes.data || []).forEach((it: any) => {
    const cur = aggMap.get(it.op_id) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(it.quantidade_planejada || 0);
    aggMap.set(it.op_id, cur);
  });

  const nomeMap = new Map<string, string>();
  (profsRes.data || []).forEach((p: any) => nomeMap.set(p.user_id, p.full_name));

  const ordens: OrdemProducaoListItem[] = rows.map((r) => {
    const tipo = r.tipo_id ? tipoMap.get(r.tipo_id) : undefined;
    const agg = aggMap.get(r.id) || { count: 0, total: 0 };
    return {
      ...r,
      tipo_nome: tipo?.nome ?? null,
      tipo_codigo: tipo?.codigo ?? null,
      itens_count: agg.count,
      itens_qtd_total: agg.total,
      emitido_por_nome: r.emitido_por ? nomeMap.get(r.emitido_por) ?? null : null,
    };
  });

  return { ordens, total: count || 0 };
}

/**
 * Contagem por status honrando os filtros de tipo/período/busca (NÃO o de
 * status — os chips mostram todos os estados para navegar entre eles). Dataset
 * pequeno (produção), então varre a coluna `status` e tabula client-side.
 */
export async function contarPorStatus(params: Omit<FiltrosComuns, "status">): Promise<Record<string, number>> {
  let query = (supabase as any).from("op_ordens").select("status");
  query = aplicarFiltros(query, params);
  const { data, error } = await query;
  if (error) throw error;
  const counts: Record<string, number> = {};
  (data || []).forEach((r: any) => {
    counts[r.status] = (counts[r.status] || 0) + 1;
  });
  return counts;
}

/** Tipos de OP ativos (para o filtro por tipo). */
export async function listarTipos(): Promise<OrdemTipo[]> {
  const { data, error } = await (supabase as any)
    .from("op_tipos")
    .select("id, codigo, nome, ordem")
    .eq("ativo", true)
    .order("ordem", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []).map((t: any) => ({ id: t.id, codigo: t.codigo, nome: t.nome }));
}

// ── OP-1.4: picker de SKU + criação via RPC ───────────────────────────────────

/** Resultado do picker de SKU (snapshot do catálogo espelho). */
export interface StockPickerRow {
  codigo_produto: string;
  codigo_alternativo: string | null;
  nome_produto: string;
  unidade_medida: string | null;
}

/** Quantos resultados por busca (acima disso, avisa para refinar). */
export const SKU_MAX_RESULTADOS = 30;

/**
 * Busca produtos no catálogo espelho para o picker da OP. Só `ativo=true`.
 * Busca por `codigo_alternativo` + `nome_produto` + `codigo_produto` — NUNCA
 * por `codigo_barras` (ambiguidade; achado OP-1.1). Escapa os separadores do
 * `or()` do PostgREST (mesma armadilha do ProductCombobox).
 */
export async function buscarProdutos(termo: string): Promise<StockPickerRow[]> {
  const t = termo.replace(/[,()%]/g, " ").trim();
  if (t.length < 2) return [];
  const padrao = `%${t}%`;
  const { data, error } = await (supabase as any)
    .from("stock_products")
    .select("codigo_produto, codigo_alternativo, nome_produto, unidade_medida")
    .or([`codigo_alternativo.ilike.${padrao}`, `nome_produto.ilike.${padrao}`, `codigo_produto.ilike.${padrao}`].join(","))
    .eq("ativo", true)
    .order("nome_produto")
    .limit(SKU_MAX_RESULTADOS);
  if (error) throw new Error(error.message);
  return (data || []) as StockPickerRow[];
}

/** Último depto usado pelo usuário (pré-preenche emitido_depto). "" se não houver. */
export async function ultimoDeptoDoUsuario(userId: string): Promise<string> {
  const { data, error } = await (supabase as any)
    .from("op_ordens")
    .select("emitido_depto")
    .eq("emitido_por", userId)
    .not("emitido_depto", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return "";
  return data?.emitido_depto ?? "";
}

export interface NovaOPDados {
  tipo_id: string;
  tipo_ordem: string;
  tipo_produto: string;
  destino: string;
  produto_familia: string | null;
  lote: string | null;
  data_inicio: string | null; // "YYYY-MM-DD"
  data_fim_planejada: string | null; // "YYYY-MM-DD"
  numero_referencia: string | null;
  observacoes: string | null;
  emitido_depto: string | null;
}

export interface NovaOPItem {
  codigo_produto: string;
  codigo_alternativo_produto: string | null;
  produto_nome: string;
  produto_unidade: string | null;
  quantidade_planejada: number;
}

/**
 * Cria a OP (RASCUNHO) via RPC SECURITY DEFINER `op_criar_ordem` — o número é
 * gerado pela RPC no salvamento (op_proximo_numero está em lockdown; só ela
 * chama). Retorna id + número (buscado logo após, para o toast).
 */
export async function criarOrdem(dados: NovaOPDados, itens: NovaOPItem[]): Promise<{ id: string; numero: string }> {
  const { data: id, error } = await (supabase as any).rpc("op_criar_ordem", { p_dados: dados, p_itens: itens });
  if (error) throw new Error(error.message);
  const { data: row } = await (supabase as any).from("op_ordens").select("numero").eq("id", id).maybeSingle();
  return { id: id as string, numero: row?.numero ?? "" };
}

/** Abre a OP (RASCUNHO → ABERTA) via RPC `op_transicao_status`. */
export async function abrirOrdem(opId: string): Promise<void> {
  const { error } = await (supabase as any).rpc("op_transicao_status", { p_op_id: opId, p_para: "ABERTA" });
  if (error) throw new Error(error.message);
}

// ── OP-1.5: detalhe + mutações (edição, transições, carimbos) ─────────────────

export interface OrdemDetalhe {
  ordem: Record<string, any>; // op_ordens + nomes resolvidos (tipo_nome, *_por_nome)
  itens: any[]; // op_ordem_itens (order sequencia)
  historico: any[]; // op_status_historico + usuario_nome (order created_at asc)
}

/** Carrega a OP completa (cabeçalho + itens + histórico) com nomes resolvidos. */
export async function obterOrdem(opId: string): Promise<OrdemDetalhe> {
  const { data: ordem, error } = await (supabase as any).from("op_ordens").select("*").eq("id", opId).single();
  if (error) throw new Error(error.message);

  const [itensRes, histRes, tipoRes] = await Promise.all([
    (supabase as any).from("op_ordem_itens").select("*").eq("op_id", opId).order("sequencia", { ascending: true }),
    (supabase as any).from("op_status_historico").select("*").eq("op_id", opId).order("created_at", { ascending: true }),
    (supabase as any).from("op_tipos").select("nome, codigo").eq("id", ordem.tipo_id).maybeSingle(),
  ]);

  const itens = itensRes.data || [];
  const historico = histRes.data || [];

  const ids = new Set<string>();
  [ordem.emitido_por, ordem.aprovado_por, ordem.cancelada_por, ordem.fechada_por].forEach((u: string | null) => {
    if (u) ids.add(u);
  });
  historico.forEach((h: any) => {
    if (h.usuario) ids.add(h.usuario);
  });

  const nomeMap = new Map<string, string>();
  if (ids.size) {
    const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", Array.from(ids));
    (profs || []).forEach((p: any) => nomeMap.set(p.user_id, p.full_name));
  }

  return {
    ordem: {
      ...ordem,
      tipo_nome: tipoRes.data?.nome ?? null,
      emitido_por_nome: ordem.emitido_por ? nomeMap.get(ordem.emitido_por) ?? null : null,
      aprovado_por_nome: ordem.aprovado_por ? nomeMap.get(ordem.aprovado_por) ?? null : null,
      cancelada_por_nome: ordem.cancelada_por ? nomeMap.get(ordem.cancelada_por) ?? null : null,
      fechada_por_nome: ordem.fechada_por ? nomeMap.get(ordem.fechada_por) ?? null : null,
    },
    itens,
    historico: historico.map((h: any) => ({ ...h, usuario_nome: h.usuario ? nomeMap.get(h.usuario) ?? null : null })),
  };
}

/** Atualiza rascunho (só status RASCUNHO — enforced na RPC). */
export async function atualizarRascunho(opId: string, dados: NovaOPDados, itens: NovaOPItem[]): Promise<void> {
  const { error } = await (supabase as any).rpc("op_atualizar_rascunho", { p_op_id: opId, p_dados: dados, p_itens: itens });
  if (error) throw new Error(error.message);
}

/** Transição de status (valida o mapa + gate na RPC). Motivo obrigatório em CANCELADA. */
export async function transicionar(opId: string, para: string, motivo?: string): Promise<void> {
  const params: Record<string, any> = { p_op_id: opId, p_para: para };
  if (motivo != null) params.p_motivo = motivo;
  const { error } = await (supabase as any).rpc("op_transicao_status", params);
  if (error) throw new Error(error.message);
}

/** Carimba aprovação (aprovado_por=auth.uid(), aprovado_em=now(), aprovado_depto). Gate manage. */
export async function registrarAprovacao(opId: string, depto: string): Promise<void> {
  const { error } = await (supabase as any).rpc("op_registrar_aprovacao", { p_op_id: opId, p_depto: depto });
  if (error) throw new Error(error.message);
}

/** Carimba comunicação (comunicado_a, comunicado_depto, comunicado_em=now()). Gate manage. */
export async function registrarComunicacao(opId: string, comunicadoA: string, depto: string): Promise<void> {
  const { error } = await (supabase as any).rpc("op_registrar_comunicacao", {
    p_op_id: opId,
    p_comunicado_a: comunicadoA,
    p_depto: depto,
  });
  if (error) throw new Error(error.message);
}
