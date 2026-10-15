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

/**
 * Etapa do pedido no funil do Rastreio de Compras (ESPELHO do Alvo, atualizado
 * de hora em hora) — informativa. Etapa nova que o Rastreio venha a criar cai
 * no tom neutro, sem quebrar a tela.
 */
const TOM_ETAPA: Record<string, Tom> = {
  "Pedido em aprovação": "neutro",
  "Aguardando NF": "info",
  "Em inspeção (laudo)": "info",
  "Aguardando pagamento": "atencao",
  "Adiantamento pago (sem NF)": "sucesso",
  "Pago (1ª parcela)": "sucesso",
  "Encerrado sem NF ligada": "neutro",
  Cancelado: "perigo",
};

export const tomEtapa = (etapa: string): Tom => TOM_ETAPA[etapa] ?? "neutro";

/**
 * Situação de um título a pagar, pela regra de prova do Rastreio
 * (`rastreio_classe_pagamento`): só é "Pago" com baixa E movimento bancário.
 */
const PAGAMENTO: Record<string, { label: string; tom: Tom }> = {
  pago: { label: "Pago", tom: "sucesso" },
  quitado_adto: { label: "Quitado por adiantamento", tom: "sucesso" },
  baixa_sem_mov: { label: "Baixado sem movimento bancário", tom: "atencao" },
  agrupado: { label: "Agrupado em outro título", tom: "neutro" },
  aberto: { label: "Em aberto", tom: "info" },
};

export const situacaoPagamento = (classe: string) => PAGAMENTO[classe] ?? { label: "Situação desconhecida", tom: "neutro" as Tom };
