/**
 * Constantes e formatadores do módulo de Projetos (sem JSX — ficam fora do .tsx
 * para o Fast Refresh do Vite não recarregar a página inteira a cada edição).
 */

export type Tom = "neutro" | "info" | "sucesso" | "atencao" | "perigo";

export const FASES: Record<string, { label: string; tom: Tom }> = {
  budget: { label: "Budget", tom: "atencao" },
  budget_em_aprovacao: { label: "Em aprovação", tom: "info" },
  actual: { label: "Actual", tom: "sucesso" },
};

/** Status LOCAL do pedido (Hub) — não confundir com o status no ERP. */
export const STATUS_PEDIDO: Record<string, { label: string; tom: Tom }> = {
  rascunho: { label: "Rascunho", tom: "neutro" },
  enviado: { label: "Enviado ao ERP", tom: "sucesso" },
  erro: { label: "Erro no envio", tom: "perigo" },
};

/** Tom pelo consumo do orçamento: normal, perto do teto (≥ 90%) e estourado (> 100%). */
export function tomConsumo(pct: number): Tom {
  if (pct > 100) return "perigo";
  if (pct >= 90) return "atencao";
  return "info";
}

export const fmtMoeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** `yyyy-mm-dd` → `dd/mm/yyyy` sem passar por Date (evita deslocamento de fuso). */
export const fmtData = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
};

export const pct = (valor: number, base: number) => (base > 0 ? (valor / base) * 100 : 0);

/** Percentual para exibir: inteiro, ou uma casa abaixo de 10%. */
export const fmtPct = (p: number) => `${p < 10 && p > 0 ? p.toFixed(1).replace(".", ",") : Math.round(p)}%`;
