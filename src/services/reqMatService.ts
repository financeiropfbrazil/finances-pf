import { supabase } from "@/integrations/supabase/client";
import { aplicarFiltroStatusRM } from "@/lib/statusRM";

/**
 * Service do módulo Produção > RM (OP-2.4 — LEITURA do espelho).
 *
 * Lê as tabelas `op_reqmat` / `op_reqmat_itens` / `op_reqmat_lotes` (espelho do
 * Alvo, escrito só pelo `sync-reqmat`) e `op_requisicoes` (o livro do Hub, onde
 * mora o vínculo OP↔RM). A RLS gateia a leitura.
 *
 * ⚠ Desde a OP-2.7 este arquivo TAMBÉM escreve — mas só no LIVRO e só por RPC
 *   `SECURITY DEFINER` gateada por `producao.rm.create` (bloco no fim do
 *   arquivo). `op_requisicoes` continua sem policy de INSERT/UPDATE para
 *   `authenticated`: abrir a tabela seria a classe do BL-5. O espelho segue
 *   escrito só pelo `sync-reqmat` (service_role), e a escrita no Alvo vive em
 *   `alvoReqMatSaveService.ts`.
 *
 * Padrão da casa (igual `opService.ts`): `(supabase as any).from(...)` e
 * resolução de nomes EM LOTE por `.in(...)`, nunca N+1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TRÊS REGRAS QUE NÃO SE NEGOCIAM (medidas em campo, §10.4 e §10.20 do PLANO-OP)
 *
 * 1. `quantidade_saldo` é ESPELHADO, nunca recalculado. Saldo NÃO é
 *    `quantidade − quantidade_atendida`: quando o almoxarifado atende a mais, o
 *    excedente vai para `quantidade_atendida_maior` e o saldo NÃO fica negativo.
 *    Prova: RM 0000002251, item 18 — pedido 100, atendido 147, saldo 0,
 *    excedente 47. Quem "consertar" isso para uma subtração quebra a conta.
 *
 * 2. `quantidade_atendida_maior` é o excedente CARIMBADO pelo Alvo. Nunca
 *    derivar de `atendida − pedida`.
 *
 * 3. Na tabela de lotes, somar `quantidade` — NUNCA `quantidade_bruta`. O
 *    significado do `quantidade_bruta` não está fechado: a RM 2275 gravou 5
 *    para 1 galão atendido e a 2272 gravou 4 nas DUAS linhas de um rateio de 4.
 *    Quem somar `quantidade_bruta` conta errado.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * REQUISIÇÃO PRODUÇÃO. Filtro-base de todas as consultas desta tela, fixo e
 * invisível ao usuário: é o único tipo que representa material saindo do
 * estoque para uma OP (280 das 680 RMs de 2026). O espelho guarda os quatro
 * tipos de propósito — quem filtra é quem consome (§10.22). Sem este filtro, o
 * consolidado da OP somaria saída de material de consumo como insumo de
 * produção, e o erro seria SILENCIOSO (o número continua parecendo plausível).
 */
export const TIPO_RM_PRODUCAO = "0000002";

/** Teto do PostgREST hospedado. Acima disso a resposta vem truncada em silêncio. */
const PAGE_DB = 1000;

/**
 * Lê uma tabela inteira em páginas de 1000. O PostgREST do Supabase hospedado
 * corta em `db-max-rows` sem avisar — a mesma armadilha que a REC-3.0 tratou no
 * sync. A trava de 20 páginas é backstop de loop, não limite de negócio.
 */
async function buscarTudo<T>(fabrica: (de: number, ate: number) => any): Promise<T[]> {
  const out: T[] = [];
  let de = 0;
  for (let i = 0; i < 20; i++) {
    const { data, error } = await fabrica(de, de + PAGE_DB - 1);
    if (error) throw new Error(error.message);
    const lote = (data || []) as T[];
    out.push(...lote);
    if (lote.length < PAGE_DB) break;
    de += PAGE_DB;
  }
  return out;
}

/** Escapa os separadores que o PostgREST usa em `or()`/`ilike`. */
function limparTermo(termo: string): string {
  return termo.replace(/[,()%]/g, " ").trim();
}

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface FiltrosRM {
  status?: string; // "todos" | literal do Alvo
  dataDe?: string; // "YYYY-MM-DD"
  dataAte?: string; // "YYYY-MM-DD"
  busca?: string; // número ou descrição
  usuario?: string; // "todos" | codigo_usuario
  comSaldo?: boolean; // só RMs com item em aberto
  semOp?: boolean; // só RMs sem vínculo no livro do Hub
}

export interface ListarRMsParams extends FiltrosRM {
  orderBy?: { field: string; dir: "asc" | "desc" } | null;
  pagina: number;
  pageSize: number;
}

export interface RMListItem {
  numero: string;
  codigo_empresa_filial: string;
  data: string | null;
  descricao: string | null;
  status: string | null;
  origem: string | null;
  tipo_atendimento: string | null;
  codigo_usuario: string | null;
  codigo_funcionario: string | null;
  codigo_centro_ctrl: string | null;
  codigo_loc_armaz: string | null;
  detalhes_carregados_em: string | null;
  ausente_desde: string | null;
  // Derivados (resolvidos em lote):
  funcionario_nome: string | null;
  centro_nome: string | null;
  itens_count: number;
  qtd_pedida: number;
  qtd_atendida: number;
  qtd_saldo: number;
  qtd_excedente: number;
  op_numero: string | null;
  op_id: string | null;
  status_envio: string | null;
}

export interface RMItem {
  numero_reqmat: string;
  sequencia: number;
  codigo_produto: string | null;
  codigo_alternativo_produto: string | null;
  codigo_prod_unid_med: string | null;
  posicao_prod_unid_med: number | null;
  codigo_loc_armaz: string | null;
  quantidade: number;
  quantidade_atendida: number;
  quantidade_saldo: number;
  quantidade_atendida_maior: number;
  quantidade_devolvida: number;
  quantidade_perdida: number;
  data_atendimento: string | null;
  data_hora_atendimento: string | null;
  codigo_funcionario_atendente: string | null;
  produto_nome: string | null;
  produto_unidade_catalogo: string | null;
  controla_lote: boolean;
}

export interface RMLote {
  id: string;
  numero_reqmat: string;
  sequencia_item: number;
  codigo_produto: string | null;
  codigo_loc_armaz: string | null;
  numero_ctrl_lote: string | null;
  data_validade_ctrl_lote: string | null;
  /** Parte deste lote. É esta que soma — `quantidade_bruta` NÃO (ver topo). */
  quantidade: number;
  operacao: string | null;
}

export interface RMDetalhe {
  cabecalho: Record<string, any>;
  itens: RMItem[];
  lotes: RMLote[];
  vinculo: { op_id: string; op_numero: string | null; status_envio: string; criado_em: string } | null;
}

export interface ContagemRM {
  /** Só das RMs VIVAS no Alvo — as ausentes saem daqui e vão para `ausentes`. */
  porStatus: Record<string, number>;
  total: number;
  comSaldo: number;
  /** RMs que sumiram do Alvo (`ausente_desde` carimbado pelo sync). */
  ausentes: number;
}

// ── Filtros server-side ──────────────────────────────────────────────────────

/**
 * Aplica o filtro-base (tipo produção) + os filtros do usuário. O `comSaldo` e
 * o `semOp` NÃO entram aqui: dependem de outra tabela e são resolvidos por
 * lista de números em `numerosComSaldo`/`numerosComOp`.
 */
function aplicarFiltros(query: any, p: FiltrosRM): any {
  query = query.eq("codigo_tipo_req_mat", TIPO_RM_PRODUCAO);

  // Status EFETIVO: o filtro vive em `statusRM.ts`, junto do badge, porque a
  // ausência precede o status do Alvo e as duas metades têm de andar juntas.
  query = aplicarFiltroStatusRM(query, p.status);

  if (p.usuario && p.usuario !== "todos") query = query.eq("codigo_usuario", p.usuario);

  if (p.busca) {
    const termo = limparTermo(p.busca);
    if (termo) {
      const padrao = `%${termo}%`;
      query = query.or([`numero.ilike.${padrao}`, `descricao.ilike.${padrao}`].join(","));
    }
  }

  // `data` é timestamptz. O usuário escolhe DIA, então ancoramos o intervalo no
  // fuso de Brasília (-03:00, sem horário de verão desde 2019) — o mesmo
  // offset que o Alvo devolve nas datas da RM.
  if (p.dataDe) query = query.gte("data", `${p.dataDe}T00:00:00-03:00`);
  if (p.dataAte) query = query.lte("data", `${p.dataAte}T23:59:59-03:00`);

  return query;
}

/**
 * Números de RM com pelo menos um item em aberto — MEDIDO na tabela de itens,
 * não inferido do status do cabeçalho.
 *
 * Hoje a correlação com `status <> 'Atendida Total'` é perfeita (120 de 120),
 * mas inferir seria repetir o erro que a §10.4 documenta: o status do cabeçalho
 * esconde as duas pontas — uma RM "Atendida Parcial" pode ter itens com
 * excedente E itens zerados ao mesmo tempo.
 */
async function numerosComSaldo(): Promise<Set<string>> {
  const linhas = await buscarTudo<{ numero_reqmat: string }>((de, ate) =>
    (supabase as any).from("op_reqmat_itens").select("numero_reqmat").gt("quantidade_saldo", 0).range(de, ate),
  );
  return new Set(linhas.map((l) => l.numero_reqmat));
}

/** Números de RM que já têm vínculo com uma OP no livro do Hub. */
async function numerosComOp(): Promise<Set<string>> {
  const linhas = await buscarTudo<{ numero_reqmat: string | null }>((de, ate) =>
    (supabase as any).from("op_requisicoes").select("numero_reqmat").not("numero_reqmat", "is", null).range(de, ate),
  );
  return new Set(linhas.map((l) => l.numero_reqmat).filter(Boolean) as string[]);
}

/**
 * Restrição por número derivada dos filtros que dependem de OUTRA tabela
 * (`comSaldo` vive nos itens, `semOp` vive no livro). Resolvida uma vez, antes
 * da consulta, e aplicada de forma síncrona — as duas consultas da tela (lista
 * e contagem) usam a mesma.
 *
 * `"vazio"` significa "a restrição existe e não casa com nada" — diferente de
 * `null` ("não há restrição"). Confundir os dois faria a tela mostrar TUDO
 * quando o filtro deveria mostrar NADA.
 */
type Restricao = { incluir: string[] } | { excluir: string[] } | "vazio" | null;

async function resolverRestricao(p: FiltrosRM): Promise<Restricao> {
  if (!p.comSaldo && !p.semOp) return null;

  const vazio: Promise<Set<string> | null> = Promise.resolve(null);
  const [comSaldo, comOp] = await Promise.all<Set<string> | null>([
    p.comSaldo ? numerosComSaldo() : vazio,
    p.semOp ? numerosComOp() : vazio,
  ]);

  if (comSaldo) {
    // Com saldo (e, se pedido, sem OP) → lista positiva. Hoje são ~120 números;
    // o universo do tipo produção é ~280/ano, então a URL do `.in()` não corre
    // risco de estourar. Se o módulo passar a cobrir os outros tipos, medir.
    const base = comOp ? Array.from(comSaldo).filter((n) => !comOp.has(n)) : Array.from(comSaldo);
    return base.length ? { incluir: base } : "vazio";
  }

  // Só `semOp`: expressa-se por exclusão. Lista vazia = ninguém tem OP ⇒ o
  // filtro não exclui nada (é o estado de hoje: `op_requisicoes` tem 0 linhas).
  const excluir = comOp ? Array.from(comOp) : [];
  return excluir.length ? { excluir } : null;
}

function aplicarRestricao(query: any, r: Restricao): any {
  if (!r || r === "vazio") return query;
  if ("incluir" in r) return query.in("numero", r.incluir);
  return query.not("numero", "in", `(${r.excluir.join(",")})`);
}

// ── Leitura: lista ───────────────────────────────────────────────────────────

const CAMPOS_LISTA =
  "codigo_empresa_filial, numero, data, descricao, status, origem, tipo_atendimento, codigo_usuario, codigo_funcionario, codigo_centro_ctrl, codigo_loc_armaz, detalhes_carregados_em, ausente_desde";

/**
 * Lista paginada de RMs de produção + total exato. Os agregados por RM (itens,
 * pedido, atendido, saldo, excedente) são somados a partir dos itens das RMs
 * DA PÁGINA — uma consulta a mais, não N.
 */
export async function listarRMs(params: ListarRMsParams): Promise<{ rms: RMListItem[]; total: number }> {
  const restricao = await resolverRestricao(params);
  if (restricao === "vazio") return { rms: [], total: 0 };

  const inicio = (params.pagina - 1) * params.pageSize;
  const fim = inicio + params.pageSize - 1;

  let query = (supabase as any).from("op_reqmat").select(CAMPOS_LISTA, { count: "exact" });
  query = aplicarFiltros(query, params);
  query = aplicarRestricao(query, restricao);

  if (params.orderBy) {
    query = query.order(params.orderBy.field, { ascending: params.orderBy.dir === "asc", nullsFirst: false });
  } else {
    // Ordenação padrão: a RM é evento datado, e é a ordem em que a operação
    // pensa. `numero` desempata (mesma data, várias RMs no dia).
    query = query.order("data", { ascending: false, nullsFirst: false });
  }
  query = query.order("numero", { ascending: false }).range(inicio, fim);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);

  const rows: any[] = data || [];
  if (rows.length === 0) return { rms: [], total: count || 0 };

  const numeros = rows.map((r) => r.numero);
  const funcionarios = Array.from(new Set(rows.map((r) => r.codigo_funcionario).filter(Boolean)));
  const centros = Array.from(new Set(rows.map((r) => r.codigo_centro_ctrl).filter(Boolean)));

  const [itens, vinculos, funcRes, ccRes] = await Promise.all([
    buscarTudo<any>((de, ate) =>
      (supabase as any)
        .from("op_reqmat_itens")
        .select("numero_reqmat, quantidade, quantidade_atendida, quantidade_saldo, quantidade_atendida_maior")
        .in("numero_reqmat", numeros)
        .range(de, ate),
    ),
    (supabase as any).from("op_requisicoes").select("numero_reqmat, op_id, status_envio").in("numero_reqmat", numeros),
    funcionarios.length
      ? (supabase as any).from("funcionarios_alvo_cache").select("codigo, nome").in("codigo", funcionarios)
      : Promise.resolve({ data: [] as any[] }),
    centros.length
      ? (supabase as any).from("cost_centers").select("erp_code, name").in("erp_code", centros)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  // Agregado por RM. `quantidade_saldo` é somado COMO VEM do Alvo.
  const agg = new Map<string, { n: number; pedida: number; atendida: number; saldo: number; excedente: number }>();
  itens.forEach((it: any) => {
    const cur = agg.get(it.numero_reqmat) || { n: 0, pedida: 0, atendida: 0, saldo: 0, excedente: 0 };
    cur.n += 1;
    cur.pedida += Number(it.quantidade || 0);
    cur.atendida += Number(it.quantidade_atendida || 0);
    cur.saldo += Number(it.quantidade_saldo || 0);
    cur.excedente += Number(it.quantidade_atendida_maior || 0);
    agg.set(it.numero_reqmat, cur);
  });

  const opIds = Array.from(new Set(((vinculos.data || []) as any[]).map((v) => v.op_id).filter(Boolean)));
  const opNumeroPorId = new Map<string, string>();
  if (opIds.length) {
    const { data: ops } = await (supabase as any).from("op_ordens").select("id, numero").in("id", opIds);
    (ops || []).forEach((o: any) => opNumeroPorId.set(o.id, o.numero));
  }
  const vinculoPorNumero = new Map<string, any>();
  ((vinculos.data || []) as any[]).forEach((v) => {
    if (v.numero_reqmat) vinculoPorNumero.set(v.numero_reqmat, v);
  });

  const nomeFunc = new Map<string, string>();
  ((funcRes.data || []) as any[]).forEach((f) => nomeFunc.set(f.codigo, f.nome));
  const nomeCentro = new Map<string, string>();
  ((ccRes.data || []) as any[]).forEach((c) => nomeCentro.set(c.erp_code, c.name));

  const rms: RMListItem[] = rows.map((r) => {
    const a = agg.get(r.numero) || { n: 0, pedida: 0, atendida: 0, saldo: 0, excedente: 0 };
    const v = vinculoPorNumero.get(r.numero);
    return {
      ...r,
      funcionario_nome: r.codigo_funcionario ? nomeFunc.get(r.codigo_funcionario) ?? null : null,
      centro_nome: r.codigo_centro_ctrl ? nomeCentro.get(r.codigo_centro_ctrl) ?? null : null,
      itens_count: a.n,
      qtd_pedida: a.pedida,
      qtd_atendida: a.atendida,
      qtd_saldo: a.saldo,
      qtd_excedente: a.excedente,
      op_id: v?.op_id ?? null,
      op_numero: v?.op_id ? opNumeroPorId.get(v.op_id) ?? null : null,
      status_envio: v?.status_envio ?? null,
    };
  });

  return { rms, total: count || 0 };
}

/**
 * Contagem por status + total + quantas têm saldo em aberto, honrando todos os
 * filtros MENOS o de status (os chips servem para navegar entre estados).
 * Universo pequeno (280 RMs de produção em 2026), então varremos a coluna e
 * tabulamos no cliente — mesmo approach de `opService.contarPorStatus`.
 */
export async function contarPorStatus(params: Omit<FiltrosRM, "status">): Promise<ContagemRM> {
  const restricao = await resolverRestricao(params);
  if (restricao === "vazio") return { porStatus: {}, total: 0, comSaldo: 0, ausentes: 0 };

  const linhas = await buscarTudo<{ numero: string; status: string | null; ausente_desde: string | null }>(
    (de, ate) => {
      let q = (supabase as any).from("op_reqmat").select("numero, status, ausente_desde");
      q = aplicarFiltros(q, params);
      q = aplicarRestricao(q, restricao);
      return q.range(de, ate);
    },
  );

  // Espelha a precedência de `getStatusRM`: RM ausente NÃO conta no status do
  // Alvo. Sem isso, o chip "Atendida Total" somaria uma RM que a tela mostra
  // riscada como "Excluída no ERP" — filtro e badge divergindo na contagem.
  const porStatus: Record<string, number> = {};
  let ausentes = 0;
  linhas.forEach((r) => {
    if (r.ausente_desde) {
      ausentes++;
      return;
    }
    const k = r.status || "";
    porStatus[k] = (porStatus[k] || 0) + 1;
  });

  const comSaldoSet = await numerosComSaldo();
  const comSaldo = linhas.filter((r) => comSaldoSet.has(r.numero)).length;

  return { porStatus, total: linhas.length, comSaldo, ausentes };
}

/** Requisitantes distintos (`codigo_usuario`) das RMs de produção — para o filtro. */
export async function listarRequisitantes(): Promise<string[]> {
  const linhas = await buscarTudo<{ codigo_usuario: string | null }>((de, ate) =>
    (supabase as any)
      .from("op_reqmat")
      .select("codigo_usuario")
      .eq("codigo_tipo_req_mat", TIPO_RM_PRODUCAO)
      .not("codigo_usuario", "is", null)
      .range(de, ate),
  );
  return Array.from(new Set(linhas.map((l) => l.codigo_usuario).filter(Boolean) as string[])).sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
}

// ── Leitura: detalhe ─────────────────────────────────────────────────────────

/**
 * RM completa: cabeçalho + itens + lotes + vínculo com a OP.
 *
 * O espelho NÃO guarda o nome do produto (só os códigos), então o nome vem de
 * `stock_products` por join em lote. `controla_lote` também: é o discriminador
 * de rastreabilidade que o `ReqMat/Load` não traz (§6.3-N).
 */
export async function obterRM(numero: string): Promise<RMDetalhe> {
  const { data: cabecalho, error } = await (supabase as any)
    .from("op_reqmat")
    .select("*")
    .eq("numero", numero)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!cabecalho) throw new Error("Requisição não encontrada ou sem acesso.");

  const [itensRaw, lotesRaw, vinculoRes] = await Promise.all([
    buscarTudo<any>((de, ate) =>
      (supabase as any)
        .from("op_reqmat_itens")
        .select("*")
        .eq("numero_reqmat", numero)
        .order("sequencia", { ascending: true })
        .range(de, ate),
    ),
    buscarTudo<any>((de, ate) =>
      (supabase as any)
        .from("op_reqmat_lotes")
        .select("*")
        .eq("numero_reqmat", numero)
        .order("sequencia_item", { ascending: true })
        .order("data_validade_ctrl_lote", { ascending: true, nullsFirst: false })
        .range(de, ate),
    ),
    (supabase as any)
      .from("op_requisicoes")
      .select("op_id, status_envio, criado_em")
      .eq("numero_reqmat", numero)
      .maybeSingle(),
  ]);

  const codigos = Array.from(new Set(itensRaw.map((i: any) => i.codigo_produto).filter(Boolean))) as string[];
  const produtos = new Map<string, { nome: string; unidade: string | null; controla_lote: boolean }>();
  if (codigos.length) {
    const { data: prods } = await (supabase as any)
      .from("stock_products")
      .select("codigo_produto, nome_produto, unidade_medida, controla_lote")
      .in("codigo_produto", codigos);
    (prods || []).forEach((p: any) =>
      produtos.set(p.codigo_produto, {
        nome: p.nome_produto,
        unidade: p.unidade_medida,
        controla_lote: p.controla_lote === true,
      }),
    );
  }

  const itens: RMItem[] = itensRaw.map((i: any) => {
    const p = i.codigo_produto ? produtos.get(i.codigo_produto) : undefined;
    return {
      ...i,
      quantidade: Number(i.quantidade || 0),
      quantidade_atendida: Number(i.quantidade_atendida || 0),
      // Espelhado, nunca recalculado (ver o cabeçalho deste arquivo).
      quantidade_saldo: Number(i.quantidade_saldo || 0),
      quantidade_atendida_maior: Number(i.quantidade_atendida_maior || 0),
      quantidade_devolvida: Number(i.quantidade_devolvida || 0),
      quantidade_perdida: Number(i.quantidade_perdida || 0),
      produto_nome: p?.nome ?? null,
      produto_unidade_catalogo: p?.unidade ?? null,
      controla_lote: p?.controla_lote ?? false,
    };
  });

  const lotes: RMLote[] = lotesRaw.map((l: any) => ({
    ...l,
    // `quantidade` = a parte DESTE lote. `quantidade_bruta` fica de fora de
    // propósito: significado não fechado (§10.20).
    quantidade: Number(l.quantidade || 0),
  }));

  let vinculo: RMDetalhe["vinculo"] = null;
  const v = (vinculoRes as any)?.data;
  if (v?.op_id) {
    const { data: op } = await (supabase as any).from("op_ordens").select("numero").eq("id", v.op_id).maybeSingle();
    vinculo = { op_id: v.op_id, op_numero: op?.numero ?? null, status_envio: v.status_envio, criado_em: v.criado_em };
  }

  return { cabecalho, itens, lotes, vinculo };
}

// ── Leitura: consolidado por OP ──────────────────────────────────────────────

export interface ConsolidadoRequisicao {
  numero_reqmat: string | null;
  status_envio: string;
  criado_em: string;
  criado_por_nome: string | null;
  // Do espelho (null enquanto o sync não alcançou a RM):
  data: string | null;
  descricao: string | null;
  status: string | null;
  origem: string | null;
  /** Carimbo de exclusão no Alvo — precede o status na exibição (getStatusRM). */
  ausente_desde: string | null;
  itens_count: number;
  /**
   * O espelho já viu esta RM? `false` = criada no Hub e ainda não sincronizada
   * (o cron anda 4×/dia). Distingue "ainda não chegou" de "não existe" — sem
   * isto, a linha aparece vazia e parece defeito.
   */
  no_espelho: boolean;
}

export interface ConsolidadoInsumo {
  codigo_produto: string;
  codigo_alternativo_produto: string | null;
  produto_nome: string | null;
  unidade: string | null;
  qtd_pedida: number;
  qtd_atendida: number;
  qtd_saldo: number;
  qtd_excedente: number;
  lotes: { numero_ctrl_lote: string | null; data_validade_ctrl_lote: string | null; quantidade: number }[];
}

export interface ConsolidadoOP {
  requisicoes: ConsolidadoRequisicao[];
  insumos: ConsolidadoInsumo[];
}

/**
 * Consolidado de material de uma OP: as RMs abertas contra ela e a soma por
 * insumo.
 *
 * 🔴 Soma `quantidade_atendida`, NUNCA `quantidade` — o que a OP consumiu é o
 * que saiu do estoque, não o que foi pedido (§10.4). `quantidade` e
 * `quantidade_saldo` vão junto como leitura, não como base de conta.
 *
 * O filtro `codigo_tipo_req_mat = '0000002'` é redundante aqui (o livro só
 * nasce da tela de RM, que fixa o tipo) e está mantido de propósito: é defesa
 * contra uma RM que entre no livro por outro caminho amanhã, e o erro que ele
 * evita seria silencioso.
 */
export async function consolidadoDaOP(opId: string): Promise<ConsolidadoOP> {
  const { data: livro, error } = await (supabase as any)
    .from("op_requisicoes")
    // `payload_enviado` entra para a RM recém-criada não aparecer em branco: até
    // o sync chegar (≤3h), é a ÚNICA cópia do que foi pedido (§10.14).
    .select("numero_reqmat, status_envio, criado_em, criado_por, payload_enviado")
    .eq("op_id", opId)
    .order("criado_em", { ascending: false });
  if (error) throw new Error(error.message);

  const linhas: any[] = livro || [];
  if (linhas.length === 0) return { requisicoes: [], insumos: [] };

  const numeros = linhas.map((l) => l.numero_reqmat).filter(Boolean) as string[];
  const criadores = Array.from(new Set(linhas.map((l) => l.criado_por).filter(Boolean)));

  const [cabecalhos, profsRes] = await Promise.all([
    numeros.length
      ? buscarTudo<any>((de, ate) =>
          (supabase as any)
            .from("op_reqmat")
            .select("numero, data, descricao, status, origem, ausente_desde")
            .in("numero", numeros)
            .eq("codigo_tipo_req_mat", TIPO_RM_PRODUCAO)
            .range(de, ate),
        )
      : Promise.resolve([] as any[]),
    criadores.length
      ? supabase.from("profiles").select("user_id, full_name").in("user_id", criadores as string[])
      : Promise.resolve({ data: [] as any[] }),
  ]);

  // Só entram no consolidado as RMs que o espelho confirma como tipo produção.
  const numerosValidos = cabecalhos.map((c: any) => c.numero);

  const itens = numerosValidos.length
    ? await buscarTudo<any>((de, ate) =>
        (supabase as any)
          .from("op_reqmat_itens")
          .select(
            "numero_reqmat, codigo_produto, codigo_alternativo_produto, quantidade, quantidade_atendida, quantidade_saldo, quantidade_atendida_maior",
          )
          .in("numero_reqmat", numerosValidos)
          .range(de, ate),
      )
    : [];

  const lotes = numerosValidos.length
    ? await buscarTudo<any>((de, ate) =>
        (supabase as any)
          .from("op_reqmat_lotes")
          .select("numero_reqmat, codigo_produto, numero_ctrl_lote, data_validade_ctrl_lote, quantidade")
          .in("numero_reqmat", numerosValidos)
          .range(de, ate),
      )
    : [];

  const cabPorNumero = new Map<string, any>();
  cabecalhos.forEach((c: any) => cabPorNumero.set(c.numero, c));
  const itensPorRM = new Map<string, number>();
  itens.forEach((i: any) => itensPorRM.set(i.numero_reqmat, (itensPorRM.get(i.numero_reqmat) || 0) + 1));
  const nomePorUser = new Map<string, string>();
  (((profsRes as any).data || []) as any[]).forEach((p) => nomePorUser.set(p.user_id, p.full_name));

  const requisicoes: ConsolidadoRequisicao[] = linhas.map((l) => {
    const c = l.numero_reqmat ? cabPorNumero.get(l.numero_reqmat) : undefined;
    return {
      numero_reqmat: l.numero_reqmat,
      status_envio: l.status_envio,
      criado_em: l.criado_em,
      criado_por_nome: l.criado_por ? nomePorUser.get(l.criado_por) ?? null : null,
      data: c?.data ?? null,
      // Sem espelho ainda ⇒ mostra a descrição do próprio pedido, do livro.
      descricao: c?.descricao ?? l.payload_enviado?.descricao ?? null,
      status: c?.status ?? null,
      /** `false` enquanto o sync não trouxe o cabeçalho — a tela avisa. */
      no_espelho: !!c,
      origem: c?.origem ?? null,
      ausente_desde: c?.ausente_desde ?? null,
      itens_count: l.numero_reqmat ? itensPorRM.get(l.numero_reqmat) || 0 : 0,
    };
  });

  // Agregação por insumo. `quantidade_atendida` é a base; as demais acompanham.
  const porProduto = new Map<string, ConsolidadoInsumo>();
  itens.forEach((i: any) => {
    if (!i.codigo_produto) return;
    const cur =
      porProduto.get(i.codigo_produto) ||
      ({
        codigo_produto: i.codigo_produto,
        codigo_alternativo_produto: i.codigo_alternativo_produto ?? null,
        produto_nome: null,
        unidade: null,
        qtd_pedida: 0,
        qtd_atendida: 0,
        qtd_saldo: 0,
        qtd_excedente: 0,
        lotes: [],
      } as ConsolidadoInsumo);
    cur.qtd_pedida += Number(i.quantidade || 0);
    cur.qtd_atendida += Number(i.quantidade_atendida || 0);
    cur.qtd_saldo += Number(i.quantidade_saldo || 0);
    cur.qtd_excedente += Number(i.quantidade_atendida_maior || 0);
    porProduto.set(i.codigo_produto, cur);
  });

  lotes.forEach((l: any) => {
    const alvo = l.codigo_produto ? porProduto.get(l.codigo_produto) : undefined;
    if (!alvo) return;
    alvo.lotes.push({
      numero_ctrl_lote: l.numero_ctrl_lote,
      data_validade_ctrl_lote: l.data_validade_ctrl_lote,
      quantidade: Number(l.quantidade || 0), // nunca `quantidade_bruta`
    });
  });

  const codigos = Array.from(porProduto.keys());
  if (codigos.length) {
    const { data: prods } = await (supabase as any)
      .from("stock_products")
      .select("codigo_produto, nome_produto, unidade_medida")
      .in("codigo_produto", codigos);
    (prods || []).forEach((p: any) => {
      const alvo = porProduto.get(p.codigo_produto);
      if (alvo) {
        alvo.produto_nome = p.nome_produto;
        alvo.unidade = p.unidade_medida;
      }
    });
  }

  const insumos = Array.from(porProduto.values()).sort((a, b) =>
    (a.produto_nome || a.codigo_produto).localeCompare(b.produto_nome || b.codigo_produto, "pt-BR"),
  );

  return { requisicoes, insumos };
}

// ═════════════════════════════════════════════════════════════════════════════
// OP-2.7 — ESCRITA (só no livro, só por RPC) + apoio da tela de criação
// ═════════════════════════════════════════════════════════════════════════════

/** Retorno normalizado das RPCs do livro. */
export interface ResultadoLivro {
  ok: boolean;
  mensagem?: string;
  erroCodigo?: string;
}

/**
 * Executa uma RPC do módulo e normaliza os DOIS modos de falha: erro do
 * PostgREST (RAISE no banco) e envelope `success:false` (HTTP 200).
 *
 * Mesmo contrato do `chamarRpc` de `projetosService.ts` — que não é exportado,
 * por isso a lógica aparece aqui. Se um dia virar utilitário compartilhado, os
 * dois devem passar a importá-lo em vez de manter duas cópias.
 */
async function rpcLivro(nome: string, params: Record<string, unknown>): Promise<{ res: ResultadoLivro; data: any }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(nome, params);

  if (error) {
    console.error(`[reqMatService] ${nome} — erro`, { code: error.code, message: error.message, params });
    return { res: { ok: false, mensagem: error.message || `Falha em ${nome}`, erroCodigo: error.code }, data: null };
  }
  if (data && typeof data === "object" && data.success === false) {
    return {
      res: { ok: false, mensagem: data.mensagem || `Falha em ${nome}`, erroCodigo: data.erro_codigo },
      data,
    };
  }
  return { res: { ok: true }, data };
}

/**
 * Cria a linha do livro em `pendente`, ANTES do POST ao Alvo (§10.14).
 *
 * O `payload` inteiro vai para `payload_enviado`: entre o POST e o primeiro
 * sync, é a ÚNICA cópia do que foi pedido — não existe tabela de itens do
 * livro, por desenho.
 */
export async function criarRMNoLivro(
  opId: string,
  payload: Record<string, unknown>,
): Promise<ResultadoLivro & { id: string }> {
  const { res, data } = await rpcLivro("op_rm_criar", { p_op_id: opId, p_payload: payload });
  return { ...res, id: (data?.id as string) ?? "" };
}

/**
 * Registra o resultado do passo 1.
 *
 * Com número → `enviado` (a RM EXISTE no ERP), e o `erro` vai junto quando o
 * passo 2 falhou depois. Sem número → `erro`.
 */
export async function marcarRMEnviada(
  id: string,
  numero: string | null,
  resposta: unknown,
  erro: string | null,
): Promise<ResultadoLivro> {
  const { res } = await rpcLivro("op_rm_marcar_enviado", {
    p_id: id,
    p_numero: numero,
    p_resposta: resposta ?? null,
    p_erro: erro,
  });
  return res;
}

/** Registra o passo 3 — só depois de o `Load` devolver `TipoAtendimento = "Manual"`. */
export async function marcarRMConfirmada(id: string, resposta: unknown): Promise<ResultadoLivro> {
  const { res } = await rpcLivro("op_rm_marcar_confirmado", { p_id: id, p_resposta: resposta ?? null });
  return res;
}

// ── Apoio do modal ───────────────────────────────────────────────────────────

export interface OPAberta {
  id: string;
  numero: string;
  status: string;
  data_inicio: string | null;
  produto_familia: string | null;
}

/**
 * OPs que podem receber RM. Só `ABERTA`/`EM_ANDAMENTO` — a mesma régua que a
 * RPC `op_rm_criar` aplica no banco (defesa em profundidade).
 */
export async function listarOPsAbertas(): Promise<OPAberta[]> {
  const { data, error } = await (supabase as any)
    .from("op_ordens")
    .select("id, numero, status, data_inicio, produto_familia")
    .in("status", ["ABERTA", "EM_ANDAMENTO"])
    .order("numero", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as OPAberta[];
}

export interface CentroCusto {
  codigo: string;
  nome: string;
}

/** Default do centro de custo — 105 das RMs de produção do ano usam este. */
export const CENTRO_CUSTO_PADRAO = "00009.00001.00001";

/**
 * Centros de custo para o dropdown.
 *
 * 🔴 A FONTE É `cost_centers`, **NÃO** `rh_centros_custo`. As duas existem e
 *    DIVERGEM no mesmo código: `00001.00005.00002` é "PRODUCAO VALVULAS" e
 *    INATIVO na `cost_centers`, e "PRODUCAO PERICARDIO" e ATIVO na
 *    `rh_centros_custo`. Pior: `00009.00001.00001` — o default, e o centro em
 *    uso corrente — **não existe** na `rh_centros_custo` (a árvore para em
 *    `00009.00001`). Quem escolher a tabela pelo nome mais óbvio pega a lista
 *    errada e não percebe.
 *
 * (b) O filtro `is_active` some com CINCO centros históricos de produção —
 *     SUPORTE PRODUCAO, PRODUCAO VALVULAS (162 RMs no ano!), PRODUCAO CATETER,
 *     PRODUCAO CORTE PERICARDIO e ALMOXARIFADO/EXPEDICAO. É o certo: eles não
 *     recebem RM nova. Se alguém perguntar por que uma RM antiga tem centro que
 *     não está na lista, é por isto — não é bug.
 */
export async function listarCentrosCusto(): Promise<CentroCusto[]> {
  const { data, error } = await (supabase as any)
    .from("cost_centers")
    .select("erp_code, name")
    .eq("is_active", true)
    .eq("group_type", "F")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((c: any) => ({ codigo: c.erp_code, nome: c.name }));
}

export interface FuncionarioDoUsuario {
  codigo: string;
  nome: string;
}

/**
 * (c) FUNCIONÁRIO: FIXO, do usuário logado. Sem dropdown.
 *
 * Decisão do Pedro (07/08/2026), e ela MUDA o uso atual de propósito: medimos
 * que MARIA.EDUARDA criou RMs com cinco funcionários diferentes (214 com o
 * dela, 17 com o da Rafaela…) e que 9 das 16 do Ryan saíram com o `0000098`.
 * A regra passa a ser: **quem requisita responde pela requisição**; quem retira
 * fica registrado nos campos de Entrega, no atendimento.
 *
 * Para virar editável depois, troque este resolvedor por um Combobox de
 * `funcionarios_alvo_cache` (`status = 'Trabalhando'`) — não há mais nada preso
 * a esta decisão.
 *
 * ⚠ Sem de-para, NÃO SE CRIA RM: 5 de 52 perfis estão sem
 *   `funcionario_alvo_codigo`. É o gate do L7-B de Projetos, na mesma forma —
 *   mensagem clara e caminho de saída, não erro genérico. Devolve `null`.
 *
 * ⚠ `profiles` casa por `user_id` (o uid do auth), NÃO por `id` — pegadinha
 *   registrada no §10.23.
 */
export async function funcionarioDoUsuario(userId: string): Promise<FuncionarioDoUsuario | null> {
  const { data: perfil } = await (supabase as any)
    .from("profiles")
    .select("funcionario_alvo_codigo")
    .eq("user_id", userId)
    .maybeSingle();

  const codigo = (perfil?.funcionario_alvo_codigo || "").trim();
  if (!codigo) return null;

  const { data: func } = await (supabase as any)
    .from("funcionarios_alvo_cache")
    .select("codigo, nome")
    .eq("codigo", codigo)
    .maybeSingle();

  return { codigo, nome: func?.nome || codigo };
}

// ── Livro: o que ainda não chegou ao espelho ─────────────────────────────────

export interface RMNoLivro {
  id: string;
  op_id: string;
  op_numero: string | null;
  numero_reqmat: string | null;
  status_envio: string;
  criado_em: string;
  erro_mensagem: string | null;
  descricao: string | null;
  /** O payload guardado — a única cópia do pedido até o sync chegar. */
  payload: any;
}

/**
 * RMs do livro que o espelho AINDA NÃO VIU.
 *
 * A fila lê `op_reqmat`, que só anda 4×/dia — então uma RM criada agora fica
 * invisível por até 3h e o operador conclui, com razão, que "criei e não
 * apareceu". Estas linhas são renderizadas no topo com badge próprio e somem
 * sozinhas quando o sync alcançar.
 *
 * Não é otimismo de UI: é o livro, que é dado real do Hub, gravado por RPC.
 */
export async function listarRMsPendentesSync(opId?: string): Promise<RMNoLivro[]> {
  let q = (supabase as any)
    .from("op_requisicoes")
    .select("id, op_id, numero_reqmat, status_envio, criado_em, erro_mensagem, payload_enviado")
    .in("status_envio", ["pendente", "enviado"])
    .order("criado_em", { ascending: false });
  if (opId) q = q.eq("op_id", opId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const linhas: any[] = data || [];
  if (linhas.length === 0) return [];

  // Quais já apareceram no espelho? Essas saem — quem manda é `op_reqmat`.
  const numeros = linhas.map((l) => l.numero_reqmat).filter(Boolean) as string[];
  const jaNoEspelho = new Set<string>();
  if (numeros.length > 0) {
    const { data: espelho } = await (supabase as any).from("op_reqmat").select("numero").in("numero", numeros);
    (espelho || []).forEach((e: any) => jaNoEspelho.add(e.numero));
  }

  const pendentes = linhas.filter((l) => !l.numero_reqmat || !jaNoEspelho.has(l.numero_reqmat));
  if (pendentes.length === 0) return [];

  const opIds = Array.from(new Set(pendentes.map((l) => l.op_id).filter(Boolean)));
  const mapaOp = new Map<string, string>();
  if (opIds.length > 0) {
    const { data: ops } = await (supabase as any).from("op_ordens").select("id, numero").in("id", opIds);
    (ops || []).forEach((o: any) => mapaOp.set(o.id, o.numero));
  }

  return pendentes.map((l) => ({
    id: l.id,
    op_id: l.op_id,
    op_numero: mapaOp.get(l.op_id) ?? null,
    numero_reqmat: l.numero_reqmat,
    status_envio: l.status_envio,
    criado_em: l.criado_em,
    erro_mensagem: l.erro_mensagem,
    descricao: l.payload_enviado?.descricao ?? null,
    payload: l.payload_enviado,
  }));
}

/**
 * A OP tem RM `enviado` NÃO confirmada?
 *
 * 🔴 É a trava anti-duplicata da tela. Nesse estado a RM existe no ERP e está
 *    em `Automático` — ou seja, morta. O reflexo do operador ("não funcionou,
 *    vou de novo") criaria uma SEGUNDA RM. Enquanto houver uma assim, "Nova RM"
 *    fica indisponível para AQUELA OP e a tela oferece "Concluir envio".
 */
export async function rmPendenteDeConclusao(opId: string): Promise<RMNoLivro | null> {
  const pendentes = await listarRMsPendentesSync(opId);
  return pendentes.find((p) => p.status_envio === "enviado" && !!p.numero_reqmat) ?? null;
}
