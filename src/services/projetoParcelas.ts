/**
 * Parcelas do pedido de compra do Projetos (fase Actual) — L11.
 *
 * Funções puras: cálculo a partir da condição de pagamento, edição com
 * vencimento e "dias" sempre coerentes, validação e montagem do bloco
 * `ParcPagPedCompChildList` do Alvo. Sem acesso a banco — quem busca a
 * condição é o chamador.
 *
 * Diferenças deliberadas em relação ao Suprimentos (`pedidosService.calcularParcelas`):
 *
 * 1. FRAÇÃO COM DOIS SIGNIFICADOS. `condicoes_pagamento_parcelas.percentual_fracao`
 *    vem do Alvo em dois formatos: nas condições antigas é DIVISOR (3 = 1/3) e em
 *    24 condições mais novas é PERCENTUAL (50 = 50%) — medido em 15/10/2026, sem
 *    coluna que diga qual é qual. Tratar tudo como divisor faz uma "2 X" de
 *    R$ 1.000 virar R$ 20 + R$ 980, e a soma continua batendo (erro silencioso).
 *    Aqui o formato é deduzido pela soma: Σ(1/f) = 1 → divisor; Σf = 100 →
 *    percentual; nenhum dos dois → partes iguais.
 * 2. VENCIMENTO E DIAS LIGADOS. No Suprimentos os dois campos são independentes
 *    e podem ir ao Alvo contraditórios (ex.: 5 parcelas no mesmo dia com "30 dias
 *    entre"). Aqui mudar um recalcula o outro.
 *
 * Convenção de "dias" (a mesma que o Projetos já mandava ao Alvo): 1ª parcela =
 * dias depois da data base; demais = dias depois da parcela anterior.
 */

export type BaseParcelasProjeto = "Data do Pedido" | "Data da Entrega";

/** Decisão do Pedro em 15/10/2026: no Projetos os prazos contam da Data do Pedido. */
export const BASE_PARCELAS_PROJETO_PADRAO: BaseParcelasProjeto = "Data do Pedido";
export const BASES_PARCELAS_PROJETO: { valor: BaseParcelasProjeto; ajuda: string }[] = [
  { valor: "Data do Pedido", ajuda: "Os prazos da condição contam a partir do dia do envio ao ERP." },
  { valor: "Data da Entrega", ajuda: "Os prazos da condição contam a partir da Data da Entrega." },
];
/** Data da Entrega sugerida = hoje + 30 (decisão do Pedro em 15/10/2026). */
export const DIAS_ENTREGA_PADRAO = 30;
/** Validade do pedido no Alvo = entrega + 30 (o Suprimentos usa hoje+30 / hoje+60). */
export const DIAS_VALIDADE_APOS_ENTREGA = 30;

export interface ParcelaProjeto {
  sequencia: number;
  /** 1ª: dias depois da data base; demais: dias depois da parcela anterior. */
  dias_entre_parcelas: number;
  valor_parcela: number;
  /** YYYY-MM-DD */
  data_vencimento: string;
}

export interface LinhaCondicao {
  numero: number;
  dias_prazo: number;
  percentual_fracao: number | string | null;
}

export interface ResumoCondicao {
  quantidade_parcelas?: number | null;
  dias_entre_parcelas?: number | null;
  primeiro_vencimento_apos?: number | null;
}

export function normalizarBaseParcelas(v: unknown): BaseParcelasProjeto {
  return v === "Data da Entrega" ? "Data da Entrega" : "Data do Pedido";
}

// ── Datas (YYYY-MM-DD, aritmética em UTC: sem surpresa de fuso/horário de verão) ──

const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

export function ehDataValida(ymd: unknown): ymd is string {
  if (typeof ymd !== "string" || !RE_YMD.test(ymd)) return false;
  const d = new Date(`${ymd}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

export function somarDias(ymd: string, dias: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** b − a, em dias. */
export function diferencaDias(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Data local de hoje (o navegador está no Brasil ou na Áustria — vale o dia de quem clica). */
export function hojeYMD(agora: Date = new Date()): string {
  const m = String(agora.getMonth() + 1).padStart(2, "0");
  const d = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${m}-${d}`;
}

export function fmtDataBR(ymd: string): string {
  return ehDataValida(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : "—";
}

const centavos = (v: number) => Math.round((Number(v) || 0) * 100);

// ── Cálculo a partir da condição ──

export type ModoFracao = "divisor" | "percentual" | "partes_iguais";

/** Participação de cada parcela (somam 1) e o formato deduzido do cadastro. */
export function interpretarFracoes(linhas: readonly LinhaCondicao[]): { partes: number[]; modo: ModoFracao } {
  const f = linhas.map((l) => Number(l.percentual_fracao));
  const n = linhas.length;
  const validas = f.every((x) => Number.isFinite(x) && x > 0);
  if (validas && Math.abs(f.reduce((s, x) => s + 1 / x, 0) - 1) < 0.001) {
    return { partes: f.map((x) => 1 / x), modo: "divisor" };
  }
  if (validas && Math.abs(f.reduce((s, x) => s + x, 0) - 100) < 0.05) {
    return { partes: f.map((x) => x / 100), modo: "percentual" };
  }
  return { partes: f.map(() => 1 / n), modo: "partes_iguais" };
}

/**
 * Linhas equivalentes a partir do resumo de `condicoes_pagamento` — só para
 * condição sem linhas em `condicoes_pagamento_parcelas` (é o cálculo que o
 * Projetos fazia antes do L11).
 */
export function linhasDoResumo(c: ResumoCondicao): LinhaCondicao[] {
  const qtd = Math.max(1, Number(c.quantidade_parcelas) || 1);
  const entre = Number(c.dias_entre_parcelas) || 0;
  const primeiro = Number(c.primeiro_vencimento_apos) || 0;
  return Array.from({ length: qtd }, (_, i) => ({
    numero: i + 1,
    dias_prazo: primeiro + entre * i,
    percentual_fracao: qtd,
  }));
}

/** Parcelas automáticas: vencimento = data base + prazo; valor pela fração; última fecha o total. */
export function calcularParcelasProjeto(
  linhasCondicao: readonly LinhaCondicao[],
  valorTotal: number,
  dataBase: string,
): ParcelaProjeto[] {
  if (linhasCondicao.length === 0) throw new Error("Condição de pagamento sem parcelas cadastradas.");
  if (!ehDataValida(dataBase)) throw new Error("Data base das parcelas inválida.");
  const linhas = [...linhasCondicao].sort((a, b) => a.numero - b.numero);
  const { partes } = interpretarFracoes(linhas);
  const totalC = centavos(valorTotal);
  let acumuladoC = 0;

  return linhas.map((l, i) => {
    const ultima = i === linhas.length - 1;
    const valorC = ultima ? totalC - acumuladoC : Math.round(totalC * partes[i]);
    acumuladoC += valorC;
    const prazo = Number(l.dias_prazo) || 0;
    const prazoAnterior = i === 0 ? 0 : Number(linhas[i - 1].dias_prazo) || 0;
    return {
      sequencia: i + 1,
      dias_entre_parcelas: prazo - prazoAnterior,
      valor_parcela: valorC / 100,
      data_vencimento: somarDias(dataBase, prazo),
    };
  });
}

// ── Edição (vencimento e dias sempre coerentes) ──

const renumerar = (ps: ParcelaProjeto[]) => ps.map((p, i) => ({ ...p, sequencia: i + 1 }));

/** Recalcula os "dias" de todas a partir dos vencimentos. */
export function recalcularDias(ps: readonly ParcelaProjeto[], dataBase: string): ParcelaProjeto[] {
  return renumerar(
    ps.map((p, i) => ({
      ...p,
      dias_entre_parcelas: diferencaDias(i === 0 ? dataBase : ps[i - 1].data_vencimento, p.data_vencimento),
    })),
  );
}

/** Troca o vencimento de uma parcela: os "dias" dela e da seguinte acompanham. */
export function alterarVencimento(
  ps: readonly ParcelaProjeto[],
  idx: number,
  novaData: string,
  dataBase: string,
): ParcelaProjeto[] {
  if (!ehDataValida(novaData)) return [...ps];
  return recalcularDias(
    ps.map((p, i) => (i === idx ? { ...p, data_vencimento: novaData } : p)),
    dataBase,
  );
}

/** Troca os "dias" de uma parcela: o vencimento dela muda e as seguintes andam junto. */
export function alterarDias(
  ps: readonly ParcelaProjeto[],
  idx: number,
  novosDias: number,
  dataBase: string,
): ParcelaProjeto[] {
  const dias = Math.max(0, Math.trunc(Number(novosDias) || 0));
  const out = ps.map((p) => ({ ...p }));
  for (let i = idx; i < out.length; i++) {
    const anterior = i === 0 ? dataBase : out[i - 1].data_vencimento;
    if (i === idx) out[i].dias_entre_parcelas = dias;
    out[i].data_vencimento = somarDias(anterior, out[i].dias_entre_parcelas);
  }
  return renumerar(out);
}

export function alterarValor(ps: readonly ParcelaProjeto[], idx: number, valor: number): ParcelaProjeto[] {
  const v = Math.max(0, Math.round((Number(valor) || 0) * 100) / 100);
  return ps.map((p, i) => (i === idx ? { ...p, valor_parcela: v } : p));
}

/** Nova parcela 30 dias depois da última, com o valor que falta para fechar o total. */
export function adicionarParcela(
  ps: readonly ParcelaProjeto[],
  dataBase: string,
  valorTotal: number,
): ParcelaProjeto[] {
  const ultima = ps[ps.length - 1];
  const faltaC = centavos(valorTotal) - ps.reduce((s, p) => s + centavos(p.valor_parcela), 0);
  return renumerar([
    ...ps,
    {
      sequencia: ps.length + 1,
      dias_entre_parcelas: 30,
      valor_parcela: Math.max(0, faltaC) / 100,
      data_vencimento: somarDias(ultima ? ultima.data_vencimento : dataBase, 30),
    },
  ]);
}

/** Remove a parcela; a seguinte passa a contar os dias a partir da anterior. */
export function removerParcela(ps: readonly ParcelaProjeto[], idx: number, dataBase: string): ParcelaProjeto[] {
  if (ps.length <= 1) return [...ps];
  return recalcularDias(
    ps.filter((_, i) => i !== idx),
    dataBase,
  );
}

export function somaParcelas(ps: readonly ParcelaProjeto[]): number {
  return ps.reduce((s, p) => s + centavos(p.valor_parcela), 0) / 100;
}

// ── Validação ──

/**
 * Devolve a primeira mensagem de problema, ou null. `hoje` (YYYY-MM-DD) liga a
 * regra do envio: nenhuma parcela pode vencer antes do dia do envio.
 */
export function validarParcelas(
  ps: readonly ParcelaProjeto[] | null | undefined,
  valorTotal: number,
  opcoes: { hoje?: string } = {},
): string | null {
  if (!ps || ps.length === 0) return "Inclua ao menos uma parcela.";
  for (const p of ps) {
    if (!(Number(p.valor_parcela) > 0)) return `A parcela ${p.sequencia} está sem valor.`;
    if (!ehDataValida(p.data_vencimento)) return `A parcela ${p.sequencia} está sem data de vencimento.`;
  }
  for (let i = 1; i < ps.length; i++) {
    if (ps[i].data_vencimento < ps[i - 1].data_vencimento) {
      return `A parcela ${ps[i].sequencia} vence antes da parcela ${ps[i - 1].sequencia}.`;
    }
  }
  const somaC = ps.reduce((s, p) => s + centavos(p.valor_parcela), 0);
  const totalC = centavos(valorTotal);
  if (somaC !== totalC) {
    const fmt = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return `A soma das parcelas (${fmt(somaC)}) precisa ser igual ao valor do pedido (${fmt(totalC)}).`;
  }
  if (opcoes.hoje) {
    const vencida = ps.find((p) => p.data_vencimento < opcoes.hoje!);
    if (vencida) {
      return `A parcela ${vencida.sequencia} vence em ${fmtDataBR(vencida.data_vencimento)}, antes de hoje. Revise as parcelas do pedido.`;
    }
  }
  return null;
}

// ── Alvo ──

const isoAlvo = (ymd: string) => `${ymd}T00:00:00`;

/** `ParcPagPedCompChildList` no formato que o Projetos já mandava (validado nos pedidos de 08–10/2026). */
export function parcelasParaAlvo(ps: readonly ParcelaProjeto[], valorTotal: number) {
  const n = ps.length;
  const total = Number(valorTotal) || 0;
  return ps.map((p, i) => ({
    CodigoEmpresaFilial: "",
    NumeroPedComp: "",
    Sequencia: i + 1,
    NumeroDuplicata: n === 1 ? "1" : `${i + 1}/${n}`,
    DiasEntreParcelas: p.dias_entre_parcelas,
    PercentualFracao: total > 0 ? Number(((p.valor_parcela / total) * 100).toFixed(4)) : 0,
    ValorParcela: Number(Number(p.valor_parcela).toFixed(2)),
    DataVencimento: isoAlvo(p.data_vencimento),
  }));
}

export interface DatasPedidoAlvo {
  DataEntrega: string;
  DataValidade: string;
  DataBaseVencimento: string;
  DataBaseVencimentoParcela: BaseParcelasProjeto;
  /** YYYY-MM-DD da data base (para recalcular parcelas automáticas no envio). */
  dataBase: string;
}

/**
 * Datas do cabeçalho no envio. Pedido anterior ao L11 (sem Data da Entrega)
 * sai exatamente como antes: tudo no dia do envio, base "Data do Pedido".
 */
export function datasParaAlvo(
  req: { data_entrega?: string | null; data_base_parcelas?: string | null },
  hoje: string,
): DatasPedidoAlvo {
  const entrega = ehDataValida(req.data_entrega) ? req.data_entrega : null;
  const base = entrega ? normalizarBaseParcelas(req.data_base_parcelas) : "Data do Pedido";
  const dataBase = base === "Data da Entrega" && entrega ? entrega : hoje;
  return {
    DataEntrega: isoAlvo(entrega ?? hoje),
    DataValidade: isoAlvo(entrega ? somarDias(entrega, DIAS_VALIDADE_APOS_ENTREGA) : hoje),
    DataBaseVencimento: isoAlvo(dataBase),
    DataBaseVencimentoParcela: base,
    dataBase,
  };
}
