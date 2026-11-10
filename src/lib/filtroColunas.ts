/**
 * Filtro no cabeçalho da tabela, no estilo do Excel (PLANO-NFE NFE-12) — regras puras, sem React.
 *
 * Cada coluna declara como é filtrada:
 *   - "valores":   lista de valores com caixa de seleção (a linha pode ter mais de um valor, ex.: os CFOPs da nota —
 *                  passa se algum deles estiver marcado);
 *   - "texto":     "contém" (sem diferenciar maiúscula/minúscula);
 *   - "intervalo": número mínimo e/ou máximo.
 * As opções de uma coluna saem das linhas que passam pelos OUTROS filtros (em cascata, como no Excel).
 */

export type TipoFiltroColuna = "valores" | "texto" | "intervalo";

export type FiltroColuna =
  | { tipo: "valores"; aceitos: string[] }
  | { tipo: "texto"; texto: string }
  | { tipo: "intervalo"; min: number | null; max: number | null };

export interface DefColuna<L> {
  id: string;
  rotulo: string;
  tipo: TipoFiltroColuna;
  /** "valores": os valores da linha (chaves; vazio = "(vazio)"). */
  valores?: (l: L) => string[];
  /** "valores": como a chave aparece na lista (ex.: data ISO → dd/mm/aaaa). */
  rotuloValor?: (v: string) => string;
  /** "valores": ordem da lista (padrão: pelo rótulo). */
  ordem?: (a: string, b: string) => number;
  /** "texto": o texto procurado. */
  texto?: (l: L) => string;
  /** "intervalo": o número da linha. */
  numero?: (l: L) => number | null;
}

export type FiltrosColunas = Record<string, FiltroColuna | undefined>;

/** Chave usada para linha sem valor na coluna. */
export const VAZIO = "";

/** O filtro está mexendo em alguma coisa? */
export function filtroAtivo(f: FiltroColuna | undefined): boolean {
  if (!f) return false;
  if (f.tipo === "texto") return f.texto.trim() !== "";
  if (f.tipo === "intervalo") return f.min !== null || f.max !== null;
  return true; // "valores": a lista de aceitos existe (mesmo vazia = nada passa, como no Excel)
}

function valoresDa<L>(l: L, def: DefColuna<L>): string[] {
  const v = def.valores?.(l) ?? [];
  return v.length > 0 ? v : [VAZIO];
}

/** A linha passa no filtro desta coluna? */
export function passaFiltro<L>(l: L, def: DefColuna<L>, f: FiltroColuna | undefined): boolean {
  if (!filtroAtivo(f)) return true;
  if (f!.tipo === "valores") {
    const aceitos = new Set(f!.aceitos);
    return valoresDa(l, def).some((v) => aceitos.has(v));
  }
  if (f!.tipo === "texto") {
    return (def.texto?.(l) ?? "").toLowerCase().includes(f!.texto.trim().toLowerCase());
  }
  const n = def.numero?.(l) ?? null;
  if (n === null) return false;
  if (f!.min !== null && n < f!.min) return false;
  if (f!.max !== null && n > f!.max) return false;
  return true;
}

/** Linhas que passam em todos os filtros (menos o da coluna `exceto`, para montar as opções dela). */
export function aplicarFiltros<L>(linhas: L[], defs: DefColuna<L>[], filtros: FiltrosColunas, exceto?: string): L[] {
  const ativos = defs.filter((d) => d.id !== exceto && filtroAtivo(filtros[d.id]));
  if (ativos.length === 0) return linhas;
  return linhas.filter((l) => ativos.every((d) => passaFiltro(l, d, filtros[d.id])));
}

/** Valores distintos da coluna com quantas linhas têm cada um, na ordem da coluna. */
export function opcoesDaColuna<L>(linhas: L[], def: DefColuna<L>): { valor: string; rotulo: string; n: number }[] {
  const contagem = new Map<string, number>();
  for (const l of linhas) for (const v of new Set(valoresDa(l, def))) contagem.set(v, (contagem.get(v) ?? 0) + 1);
  const rotulo = (v: string) => (v === VAZIO ? "(vazio)" : def.rotuloValor ? def.rotuloValor(v) : v);
  const ordem = def.ordem ?? ((a: string, b: string) => rotulo(a).localeCompare(rotulo(b), "pt-BR", { numeric: true }));
  return [...contagem.entries()]
    .map(([valor, n]) => ({ valor, rotulo: rotulo(valor), n }))
    .sort((a, b) => (a.valor === VAZIO ? 1 : b.valor === VAZIO ? -1 : ordem(a.valor, b.valor)));
}

/** "1.234,56" ou "1234.56" → número; vazio ou inválido → null (campos mín./máx. do filtro). */
export function lerNumeroDigitado(s: string): number | null {
  const t = s.trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!t) return null;
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(n) ? n : null;
}

const fmtNum = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** Os filtros ativos em texto — para a aba "Sobre" do Excel (ex.: "CFOP: 5101, 5102"). */
export function descreverFiltros<L>(defs: DefColuna<L>[], filtros: FiltrosColunas): string[] {
  const out: string[] = [];
  for (const d of defs) {
    const f = filtros[d.id];
    if (!filtroAtivo(f)) continue;
    if (f!.tipo === "valores") {
      const rot = f!.aceitos.map((v) => (v === VAZIO ? "(vazio)" : d.rotuloValor ? d.rotuloValor(v) : v));
      const lista = rot.length > 6 ? `${rot.slice(0, 6).join(", ")} e mais ${rot.length - 6}` : rot.join(", ");
      out.push(`${d.rotulo}: ${lista || "nenhum"}`);
    } else if (f!.tipo === "texto") {
      out.push(`${d.rotulo} contém "${f!.texto.trim()}"`);
    } else {
      const partes = [f!.min !== null && `≥ ${fmtNum(f!.min)}`, f!.max !== null && `≤ ${fmtNum(f!.max)}`].filter(Boolean);
      out.push(`${d.rotulo} ${partes.join(" e ")}`);
    }
  }
  return out;
}
