import { supabase } from "@/integrations/supabase/client";

/**
 * Service do módulo Recebimento (REC-1.1 — Fila de Inspeção).
 *
 * Leitura DIRETA em `rec_laudos` (espelho read-only da entidade Laudo do
 * ERP Alvo, preenchido só pela Edge Function `sync-laudos`). A RLS gateia
 * por `_is_admin()` — não existe permissão nova nem escrita por tela.
 *
 * POR QUE CARREGAMOS O CONJUNTO INTEIRO (e não paginado):
 * a tela agrupa por NF e calcula KPIs sobre TODA a fila; paginar no
 * servidor quebraria os grupos e daria KPI de página. O volume é pequeno
 * (751 laudos em todo o ano de 2026). Há um teto explícito de segurança —
 * `TETO_LINHAS` — e, se ele for atingido, o retorno avisa (`truncado`),
 * nunca corta em silêncio.
 */

/** Teto de segurança do carregamento. Atingido ⇒ `truncado: true` na UI. */
export const TETO_LINHAS = 3000;

export interface LaudoFila {
  codigo_empresa_filial: string;
  numero: string;
  status: string | null;
  data_emissao: string | null;
  data_resultado: string | null;
  numero_documento: string | null; // nº da NF de origem
  especie_documento: string | null;
  chave_movestq: number | null; // MovEstq de origem (lançamento da NF)
  codigo_produto: string | null;
  quantidade: number | null;
  codigo_prod_unid_med: string | null;
  codigo_loc_armaz: string | null;
  resultado_analise: string | null;
  numero_ctrl_lote: string | null;
  data_validade_ctrl_lote: string | null;
  quantidade_aprovada: number | null;
  quantidade_reprovada: number | null;
  valor_reprovado: number | null;
  enriquecido_em: string | null;
  sincronizado_em: string | null;
  // Derivados (resolvidos aqui):
  produto_nome: string | null;
  produto_unidade: string | null;
  dias_parado: number | null; // hoje − data_emissao (dias de calendário)
  dias_inspecao: number | null; // data_resultado − data_emissao (só concluídos)
}

export interface FilaResultado {
  laudos: LaudoFila[];
  truncado: boolean;
  sincronizadoEm: string | null; // sincronizado_em mais recente do conjunto
}

/** Faixas de "dias parado" — cor só para exceção (padrão Bloomberg-calm). */
export type FaixaDias = "todas" | "ate15" | "de16a45" | "acima45";

export const FAIXAS_DIAS: { value: FaixaDias; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "ate15", label: "Até 15 dias" },
  { value: "de16a45", label: "16 a 45 dias" },
  { value: "acima45", label: "Acima de 45 dias" },
];

export function faixaDe(dias: number | null | undefined): Exclude<FaixaDias, "todas"> | null {
  if (dias === null || dias === undefined) return null;
  if (dias <= 15) return "ate15";
  if (dias <= 45) return "de16a45";
  return "acima45";
}

/**
 * Dias de calendário entre duas datas, no fuso do navegador.
 * Comparamos DIAS (não horas) — "parado desde 08/05" tem que dar o mesmo
 * número para quem olha às 9h e às 18h.
 */
/** Converte o que o PostgREST devolver (string de `numeric`, número, null) em número. */
function numOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function diffDias(deISO: string | null | undefined, ateISO?: string | null): number | null {
  if (!deISO) return null;
  const de = new Date(deISO);
  const ate = ateISO ? new Date(ateISO) : new Date();
  if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime())) return null;
  const a = new Date(de.getFullYear(), de.getMonth(), de.getDate()).getTime();
  const b = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

const COLUNAS = [
  "codigo_empresa_filial",
  "numero",
  "status",
  "data_emissao",
  "data_resultado",
  "numero_documento",
  "especie_documento",
  "chave_movestq",
  "codigo_produto",
  "quantidade",
  "codigo_prod_unid_med",
  "codigo_loc_armaz",
  "resultado_analise",
  "numero_ctrl_lote",
  "data_validade_ctrl_lote",
  "quantidade_aprovada",
  "quantidade_reprovada",
  "valor_reprovado",
  "enriquecido_em",
  "sincronizado_em",
].join(", ");

/**
 * Carrega os laudos de um status (ou todos) e resolve o nome do produto em
 * lote via `stock_products`. Ordem: mais antigo primeiro — é uma FILA.
 */
export async function listarLaudos(params: { status: string }): Promise<FilaResultado> {
  let query = (supabase as any)
    .from("rec_laudos")
    .select(COLUNAS)
    .order("data_emissao", { ascending: true, nullsFirst: false })
    .order("numero", { ascending: true })
    .limit(TETO_LINHAS);

  if (params.status && params.status !== "todos") {
    query = query.eq("status", params.status);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows: any[] = data || [];
  if (rows.length === 0) return { laudos: [], truncado: false, sincronizadoEm: null };

  // Nome/unidade do produto — espelho do catálogo, resolvido em lote.
  const codigos = Array.from(new Set(rows.map((r) => r.codigo_produto).filter(Boolean)));
  const prodMap = new Map<string, { nome: string | null; unidade: string | null }>();
  if (codigos.length > 0) {
    const { data: prods } = await (supabase as any)
      .from("stock_products")
      .select("codigo_produto, nome_produto, unidade_medida")
      .in("codigo_produto", codigos);
    (prods || []).forEach((p: any) =>
      prodMap.set(p.codigo_produto, { nome: p.nome_produto ?? null, unidade: p.unidade_medida ?? null }),
    );
  }

  let maisRecente: string | null = null;
  const laudos: LaudoFila[] = rows.map((r) => {
    const prod = r.codigo_produto ? prodMap.get(r.codigo_produto) : undefined;
    if (r.sincronizado_em && (!maisRecente || r.sincronizado_em > maisRecente)) maisRecente = r.sincronizado_em;
    return {
      ...r,
      // `numeric` do Postgres chega como STRING no PostgREST ("32.000000000").
      // Convertemos aqui, na fronteira, para ninguém somar texto adiante.
      quantidade: numOuNull(r.quantidade),
      quantidade_aprovada: numOuNull(r.quantidade_aprovada),
      quantidade_reprovada: numOuNull(r.quantidade_reprovada),
      valor_reprovado: numOuNull(r.valor_reprovado),
      chave_movestq: numOuNull(r.chave_movestq),
      produto_nome: prod?.nome ?? null,
      produto_unidade: r.codigo_prod_unid_med || prod?.unidade || null,
      dias_parado: diffDias(r.data_emissao),
      dias_inspecao: r.data_resultado ? diffDias(r.data_emissao, r.data_resultado) : null,
    } as LaudoFila;
  });

  return { laudos, truncado: rows.length >= TETO_LINHAS, sincronizadoEm: maisRecente };
}

/** Status distintos presentes no espelho — alimenta o filtro sem chutar domínio. */
export async function listarStatusDisponiveis(): Promise<string[]> {
  const { data, error } = await (supabase as any).from("rec_laudos").select("status").limit(TETO_LINHAS);
  if (error) throw error;
  const set = new Set<string>();
  (data || []).forEach((r: any) => {
    if (r.status) set.add(r.status);
  });
  return Array.from(set).sort();
}

// ─────────────────────────────────────────────────────────────────────
// Agregações da tela (feitas sobre o conjunto JÁ FILTRADO)
// ─────────────────────────────────────────────────────────────────────

/** Status do Alvo que significa "a inspeção terminou". */
export const STATUS_CONCLUIDO = "Concluído";

export function estaConcluido(l: LaudoFila): boolean {
  return l.status === STATUS_CONCLUIDO;
}

export interface KpisFila {
  lotes: number;
  pendentes: number; // ainda não concluídos — os que de fato esperam
  concluidos: number;
  unidades: number;
  /** Maior espera entre os laudos NÃO concluídos (um concluído não está parado). */
  diasMaisAntigo: number | null;
  /** Média de `data_resultado − data_emissao` entre os concluídos. */
  tempoMedioInspecao: number | null;
  /** Soma de `valor_reprovado` — o que a Qualidade recusou, em R$. */
  valorReprovado: number;
  nfs: number;
  semLote: number; // ainda não enriquecidos (Laudo/Load não rodou)
}

export function calcularKpis(laudos: LaudoFila[]): KpisFila {
  let unidades = 0;
  let diasMaisAntigo: number | null = null;
  let semLote = 0;
  let pendentes = 0;
  let concluidos = 0;
  let valorReprovado = 0;
  let somaInspecao = 0;
  let nInspecao = 0;
  const nfs = new Set<string>();

  for (const l of laudos) {
    unidades += Number(l.quantidade) || 0;
    if (l.numero_documento) nfs.add(l.numero_documento);
    if (!l.numero_ctrl_lote) semLote++;
    valorReprovado += Number(l.valor_reprovado) || 0;

    if (estaConcluido(l)) {
      concluidos++;
      if (l.dias_inspecao !== null) {
        somaInspecao += l.dias_inspecao;
        nInspecao++;
      }
    } else {
      pendentes++;
      // "Mais antigo" mede ESPERA: só conta quem ainda não foi liberado.
      if (l.dias_parado !== null && (diasMaisAntigo === null || l.dias_parado > diasMaisAntigo)) {
        diasMaisAntigo = l.dias_parado;
      }
    }
  }

  return {
    lotes: laudos.length,
    pendentes,
    concluidos,
    unidades,
    diasMaisAntigo,
    tempoMedioInspecao: nInspecao > 0 ? Math.round(somaInspecao / nInspecao) : null,
    valorReprovado,
    nfs: nfs.size,
    semLote,
  };
}

export interface GrupoNF {
  nf: string; // "—" quando o laudo não tem NF
  laudos: LaudoFila[];
  unidades: number;
  /** Maior espera do grupo, contando só os laudos NÃO concluídos. */
  diasMaisAntigo: number | null;
}

/** Agrupa por NF; grupos ordenados pelo lote mais antigo (a fila real). */
export function agruparPorNF(laudos: LaudoFila[]): GrupoNF[] {
  const mapa = new Map<string, GrupoNF>();

  for (const l of laudos) {
    const nf = l.numero_documento || "—";
    let g = mapa.get(nf);
    if (!g) {
      g = { nf, laudos: [], unidades: 0, diasMaisAntigo: null };
      mapa.set(nf, g);
    }
    g.laudos.push(l);
    g.unidades += Number(l.quantidade) || 0;
    // Mesma regra do KPI: concluído não está esperando, não conta.
    if (!estaConcluido(l) && l.dias_parado !== null && (g.diasMaisAntigo === null || l.dias_parado > g.diasMaisAntigo)) {
      g.diasMaisAntigo = l.dias_parado;
    }
  }

  return Array.from(mapa.values()).sort((a, b) => (b.diasMaisAntigo ?? -1) - (a.diasMaisAntigo ?? -1));
}
