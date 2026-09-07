import type { RateioCCClasseInput } from "@/services/requisicoesService";

export function centrosEnvolvidos(cabecalho: string, itens: Array<{ codigo_centro_ctrl?: string }>, rateio: RateioCCClasseInput[] = []): string[] {
  return [...new Set([cabecalho, ...itens.map((i) => i.codigo_centro_ctrl || cabecalho),
    ...rateio.flatMap((c) => c.ccs.map((cc) => cc.codigo_centro_ctrl))].map((c) => c?.trim()).filter(Boolean))].sort();
}

export function validarRateioCC(cabecalho: string, rateio: RateioCCClasseInput[]): string | null {
  if (!rateio.length) return null;
  const percentualValido = (n: number) => Number.isFinite(n) && n > 0 && n <= 100;
  const soma = (ns: number[]) => ns.reduce((s, n) => s + Math.round(n * 10000), 0) === 1000000;
  if (!soma(rateio.map((c) => c.percentual))) return "Os percentuais das classes devem somar 100%.";
  for (const c of rateio) {
    if (!c.codigo_classe_rec_desp?.trim() || !percentualValido(c.percentual)) return "Informe classe e percentual válido no rateio por CC.";
    if (!c.ccs.length || !soma(c.ccs.map((cc) => cc.percentual))) return "Os CCs de cada classe devem somar 100%.";
    if (c.ccs.some((cc) => !cc.codigo_centro_ctrl?.trim() || !percentualValido(cc.percentual))) return "Informe centro de custo e percentual positivo em todas as linhas.";
  }
  if (!rateio.some((c) => c.ccs.some((cc) => cc.codigo_centro_ctrl.trim() === cabecalho.trim()))) return "O CC principal deve fazer parte do rateio por CC.";
  return null;
}
