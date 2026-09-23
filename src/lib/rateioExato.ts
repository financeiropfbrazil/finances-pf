/**
 * rateioExato.ts — rateio de centro de custo por VALOR, com fechamento exato.
 *
 * Card RATEIO-MASSA (23/09/2026). Núcleo puro: sem React, sem Supabase, sem Alvo.
 * Tudo aqui é aritmética inteira e texto — testado em `src/test/rateio-exato.test.ts`.
 *
 * 🔴 REGRA DE OURO: o VALOR em centavos é a verdade; o PERCENTUAL é consequência.
 *
 *   - Valores são inteiros em CENTAVOS. A soma fecha por construção.
 *   - Percentuais são inteiros em UNIDADES de 0,0001 ponto percentual
 *     (100,0000% = 1.000.000 unidades), distribuídos pelo MAIOR RESTO (método de
 *     Hamilton): a soma dá 1.000.000 exatos e cada linha fica a menos de 0,0001 p.p.
 *     do percentual exato.
 *   - Nenhuma soma é feita em ponto flutuante. Número decimal só aparece na SAÍDA
 *     (payload do Alvo / tela), convertido de inteiro no último passo.
 *
 * Por que 4 casas: é a precisão com que o Alvo grava `Percentual` do rateio
 * (medido em 23/09/2026: 33,3333 no 0004371, 88,8894 no 0004691; nenhuma linha do
 * espelho `compras_pedidos_itens_rateio` com 5 casas ou mais).
 *
 * Por que o valor NÃO pode ser recalculado a partir do percentual: num total de
 * R$ 52.350,00, um passo de 0,0001% vale R$ 0,05. O percentual de 4 casas não
 * alcança cada centavo — R$ 2.057,14 é 3,929589…%; 3,9295% devolve R$ 2.057,09 e
 * 3,9296% devolve R$ 2.057,15. Por isso o valor viaja EXPLÍCITO até o Alvo, que o
 * grava como recebe (provado no 0004919: o Alvo guardou no item as linhas que o Hub
 * mandou, mesmo somando R$ 19.415,03 contra R$ 19.415,04).
 */

// ════════════════════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════════════════════

export const CASAS_PERCENTUAL = 4;
/** 1 ponto percentual = 10.000 unidades (4 casas). */
export const UNIDADES_POR_PONTO = 10_000;
/** 100,0000% em unidades. */
export const UNIDADES_100_POR_CENTO = 1_000_000;

export class RateioExatoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateioExatoError";
  }
}

function assertInteiroNaoNegativo(n: number, nome: string): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RateioExatoError(`${nome} deve ser um inteiro não negativo (recebido: ${n}).`);
  }
}

// ════════════════════════════════════════════════════════════
// 1. DISTRIBUIÇÃO EXATA — MAIOR RESTO
// ════════════════════════════════════════════════════════════

/**
 * Divide `total` unidades inteiras proporcionalmente a `pesos` inteiros, com soma EXATA.
 *
 * Cada parte recebe o piso da sua cota exata (peso × total ÷ soma dos pesos); as
 * unidades que faltam para fechar o total vão, uma a uma, para as partes com a MAIOR
 * fração descartada. Desempate: maior peso, depois ordem original — o resultado é
 * determinístico (mesma entrada, mesma saída, em qualquer máquina).
 *
 * Garantias (cobertas por teste, inclusive com milhares de casos aleatórios):
 *   - soma das partes === total;
 *   - cada parte é o piso ou o teto da cota exata (erro < 1 unidade);
 *   - peso 0 recebe 0.
 *
 * A conta é feita em BigInt: centavos × 1.000.000 estouraria a precisão do `number`
 * acima de ~R$ 90 milhões.
 */
export function distribuirPorMaiorResto(pesos: readonly number[], total: number): number[] {
  assertInteiroNaoNegativo(total, "total");
  pesos.forEach((p, i) => assertInteiroNaoNegativo(p, `peso[${i}]`));

  if (pesos.length === 0) {
    if (total === 0) return [];
    throw new RateioExatoError("Não há linhas para ratear o total.");
  }

  const somaPesos = pesos.reduce((s, p) => s + BigInt(p), BigInt(0));
  if (somaPesos === BigInt(0)) {
    if (total === 0) return pesos.map(() => 0);
    throw new RateioExatoError("Não há base para ratear: todas as linhas valem zero.");
  }

  const totalBig = BigInt(total);
  const partes: bigint[] = [];
  const restos: bigint[] = [];
  let somaPartes = BigInt(0);
  for (const p of pesos) {
    const numerador = BigInt(p) * totalBig;
    const parte = numerador / somaPesos;
    partes.push(parte);
    restos.push(numerador % somaPesos);
    somaPartes += parte;
  }

  // 0 ≤ falta < número de linhas (cada piso perde menos de 1 unidade).
  const falta = Number(totalBig - somaPartes);
  const ordem = pesos
    .map((_, i) => i)
    .sort((a, b) => {
      if (restos[a] !== restos[b]) return restos[b] > restos[a] ? 1 : -1;
      if (pesos[a] !== pesos[b]) return pesos[b] - pesos[a];
      return a - b;
    });
  for (let k = 0; k < falta; k++) {
    partes[ordem[k]] += BigInt(1);
  }
  return partes.map((p) => Number(p));
}

/** Percentuais (em unidades de 0,0001 p.p.) proporcionais a valores em centavos. Soma = 1.000.000. */
export function unidadesPorValor(centavos: readonly number[]): number[] {
  return distribuirPorMaiorResto(centavos, UNIDADES_100_POR_CENTO);
}

/** Centavos proporcionais a percentuais em unidades. Soma = `totalCentavos`, exata. */
export function centavosPorUnidades(totalCentavos: number, unidades: readonly number[]): number[] {
  return distribuirPorMaiorResto(unidades, totalCentavos);
}

// ════════════════════════════════════════════════════════════
// 2. CONVERSÕES (inteiro ⇄ decimal) — só na borda
// ════════════════════════════════════════════════════════════

/** 42980 → 4.298 (número pronto para o payload; JSON imprime "4.298"). */
export function unidadesParaPercentual(unidades: number): number {
  assertInteiroNaoNegativo(unidades, "unidades");
  return unidades / UNIDADES_POR_PONTO;
}

/**
 * 4.298 → 42980. Aceita até 4 casas; mais que isso é recusado para não arredondar
 * em silêncio um percentual digitado.
 */
export function percentualParaUnidades(percentual: number): number {
  if (!Number.isFinite(percentual) || percentual < 0) {
    throw new RateioExatoError(`Percentual inválido: ${percentual}.`);
  }
  const bruto = percentual * UNIDADES_POR_PONTO;
  const unidades = Math.round(bruto);
  if (Math.abs(bruto - unidades) > 1e-6) {
    throw new RateioExatoError(`Percentual com mais de ${CASAS_PERCENTUAL} casas decimais: ${percentual}.`);
  }
  return unidades;
}

/** 205714 → 2057.14 (número pronto para o payload). */
export function centavosParaReais(centavos: number): number {
  if (!Number.isSafeInteger(centavos)) throw new RateioExatoError(`Centavos inválidos: ${centavos}.`);
  return centavos / 100;
}

/** 2057.14 → 205714. Para valores que JÁ têm no máximo 2 casas (ex.: `round2` do item). */
export function reaisParaCentavos(reais: number): number {
  if (!Number.isFinite(reais)) throw new RateioExatoError(`Valor inválido: ${reais}.`);
  return Math.round(reais * 100);
}

/** 42980 → "4,2980%". Formatação inteira, sem float. */
export function formatarPercentualUnidades(unidades: number): string {
  assertInteiroNaoNegativo(unidades, "unidades");
  const inteiro = Math.floor(unidades / UNIDADES_POR_PONTO);
  const fracao = String(unidades % UNIDADES_POR_PONTO).padStart(CASAS_PERCENTUAL, "0");
  return `${inteiro},${fracao}%`;
}

/** 205714 → "R$ 2.057,14". */
export function formatarCentavosBRL(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) return "—";
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fracao = String(abs % 100).padStart(2, "0");
  return `${negativo ? "-" : ""}R$ ${inteiro},${fracao}`;
}

// ════════════════════════════════════════════════════════════
// 3. LEITURA DE VALOR EM REAIS (texto colado do Excel)
// ════════════════════════════════════════════════════════════

// `erro`/`valor` existem nos dois ramos (opcionais) porque o projeto roda com
// `strict: false`, onde o TS não estreita a união pelo `ok`.
export type ResultadoParse<T> = { ok: true; valor: T; erro?: undefined } | { ok: false; valor?: undefined; erro: string };

/**
 * Lê um valor em reais escrito por gente ou copiado do Excel e devolve CENTAVOS.
 *
 * Aceita: "R$ 2.250,00", "2.057,14", "2057,14", "2057.14", "17.100", "17100",
 * "1,234,567.89", "R$ 900,00" com espaço não separável do Excel.
 *
 * Recusa (com mensagem) em vez de adivinhar:
 *   - negativo, texto que não é valor;
 *   - mais de 2 casas decimais (ex.: "2057,142857" de célula sem arredondar) —
 *     arredondar aqui mudaria o total em silêncio;
 *   - "1,234" — ambíguo entre mil e um real com 234 milésimos.
 *
 * Regra do ponto sozinho: "17.100" (três dígitos depois) é milhar, como no Brasil;
 * "17.1" / "2057.14" (um ou dois dígitos) é decimal, como no Excel em inglês. Qualquer
 * leitura errada aparece na conferência do total, que é obrigatória antes de aplicar.
 */
export function parseValorBRLParaCentavos(texto: string): ResultadoParse<number> {
  const bruto = String(texto ?? "").trim();
  if (!bruto) return { ok: false, erro: "Valor vazio." };

  const s = bruto.replace(/R\$/gi, "").replace(/[\s\u00a0\u202f]/g, "");
  if (/^\(.*\)$/.test(s) || s.startsWith("-") || s.endsWith("-")) {
    return { ok: false, erro: `Valor negativo não é aceito no rateio: "${bruto}".` };
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) {
    return { ok: false, erro: `Não é um valor em reais: "${bruto}".` };
  }

  const ultimoPonto = s.lastIndexOf(".");
  const ultimaVirgula = s.lastIndexOf(",");
  let inteiro = "";
  let decimal = "";

  const grupoMilhar = (sep: string) => new RegExp(`^[1-9]\\d{0,2}(\\${sep}\\d{3})+$`);
  const erroCasas: ResultadoParse<number> = {
    ok: false,
    erro: `"${bruto}" tem mais de 2 casas decimais — arredonde na planilha (a soma precisa fechar no centavo).`,
  };

  if (ultimoPonto >= 0 && ultimaVirgula >= 0) {
    // Os dois separadores: o último é o decimal.
    const sepDecimal = ultimoPonto > ultimaVirgula ? "." : ",";
    const sepMilhar = sepDecimal === "." ? "," : ".";
    const idx = s.lastIndexOf(sepDecimal);
    const parteInteira = s.slice(0, idx);
    decimal = s.slice(idx + 1);
    if (parteInteira.includes(sepDecimal)) {
      return { ok: false, erro: `Separador decimal repetido em "${bruto}".` };
    }
    if (parteInteira.includes(sepMilhar)) {
      if (!grupoMilhar(sepMilhar).test(parteInteira)) {
        return { ok: false, erro: `Separador de milhar fora do lugar em "${bruto}".` };
      }
      inteiro = parteInteira.split(sepMilhar).join("");
    } else {
      inteiro = parteInteira;
    }
    if (decimal.length > 2) return erroCasas;
  } else if (ultimaVirgula >= 0) {
    const partes = s.split(",");
    if (partes.length === 2) {
      if (partes[1].length <= 2) {
        inteiro = partes[0];
        decimal = partes[1];
      } else if (partes[1].length === 3) {
        return { ok: false, erro: `Valor ambíguo "${bruto}": escreva 1.234,00 (mil) ou 1,23 (um real).` };
      } else {
        return erroCasas;
      }
    } else {
      if (!grupoMilhar(",").test(s)) return { ok: false, erro: `Separador fora do lugar em "${bruto}".` };
      inteiro = s.replace(/,/g, "");
    }
  } else if (ultimoPonto >= 0) {
    const partes = s.split(".");
    if (partes.length === 2) {
      if (partes[1].length <= 2) {
        inteiro = partes[0];
        decimal = partes[1];
      } else if (partes[1].length === 3) {
        if (!grupoMilhar(".").test(s)) return { ok: false, erro: `Separador fora do lugar em "${bruto}".` };
        inteiro = partes[0] + partes[1];
      } else {
        return erroCasas;
      }
    } else {
      if (!grupoMilhar(".").test(s)) return { ok: false, erro: `Separador fora do lugar em "${bruto}".` };
      inteiro = s.replace(/\./g, "");
    }
  } else {
    inteiro = s;
  }

  if (inteiro === "") inteiro = "0"; // ",50" → R$ 0,50
  if (!/^\d+$/.test(inteiro) || !/^\d{0,2}$/.test(decimal)) {
    return { ok: false, erro: `Não é um valor em reais: "${bruto}".` };
  }
  const centavos = Number(inteiro) * 100 + Number(`${decimal}00`.slice(0, 2));
  if (!Number.isSafeInteger(centavos)) return { ok: false, erro: `Valor grande demais: "${bruto}".` };
  return { ok: true, valor: centavos };
}

// ════════════════════════════════════════════════════════════
// 4. LEITURA DA LISTA COLADA (uma linha por centro de custo)
// ════════════════════════════════════════════════════════════

/** Código de centro de custo no formato do Alvo: 00010.00002.00001 (grupos de 5). */
export const RE_CODIGO_CC = /^\d{5}(\.\d{5})+$/;

export interface LinhaColada {
  /** Número da linha no texto colado (1 = primeira). */
  linha: number;
  textoOriginal: string;
  /** Nome do centro de custo como veio (vazio se a linha só trouxe o código). */
  nome: string;
  /** Código no formato do Alvo, se a linha trouxe um. */
  codigo: string | null;
  centavos: number;
}

export interface LinhaIgnorada {
  linha: number;
  textoOriginal: string;
  motivo: "cabecalho" | "total" | "valor_zero";
  centavos?: number;
}

export interface LinhaComErro {
  linha: number;
  textoOriginal: string;
  erro: string;
}

export interface ResultadoColagem {
  linhas: LinhaColada[];
  ignoradas: LinhaIgnorada[];
  erros: LinhaComErro[];
}

const NOMES_DE_TOTAL = new Set(["TOTAL", "TOTAL GERAL", "SOMA", "SUBTOTAL", "SUB TOTAL", "SUB - TOTAL", "VALOR TOTAL"]);

/** Célula que é percentual ("32,66%") ou só o símbolo da moeda — nunca é nome nem valor. */
function celulaDescartavel(celula: string): boolean {
  return /%\s*$/.test(celula) || /^R\$$/i.test(celula);
}

function separarCelulas(linha: string): string[] {
  if (linha.includes("\t")) return linha.split("\t");
  if (linha.includes(";")) return linha.split(";");
  // "Almoxarifado/Expedição  R$ 2.250,00": o valor é o último bloco numérico.
  // Um percentual no fim da linha ("... 17.100,00 32,66%") é descartado antes.
  const semPercentual = linha.replace(/\s+[\d.,]+\s*%\s*$/, "");
  const m = semPercentual.match(/^(.*?)[\s|:]+((?:R\$\s*)?[-(]?[\d.,]+\)?-?)\s*$/i);
  if (m) return [m[1], m[2]];
  return [semPercentual];
}

/**
 * Interpreta o texto colado (Excel, CSV com ";", ou "nome  valor" separado por espaços).
 *
 * Em cada linha, o VALOR é a última célula que se lê como reais; o CÓDIGO (se houver)
 * é a célula no formato 00010.00002.00001; o NOME é o resto. Linhas vazias somem;
 * cabeçalho (primeira linha sem valor), linha de TOTAL e valor zero são IGNORADAS e
 * relatadas — nunca descartadas em silêncio.
 */
export function interpretarListaColada(texto: string): ResultadoColagem {
  const resultado: ResultadoColagem = { linhas: [], ignoradas: [], erros: [] };
  const brutas = String(texto ?? "").split(/\r?\n/);
  let primeiraNaoVazia = true;

  brutas.forEach((original, idx) => {
    const numeroLinha = idx + 1;
    if (!original.trim()) return;
    const ehPrimeira = primeiraNaoVazia;
    primeiraNaoVazia = false;

    const celulas = separarCelulas(original)
      .map((c) => c.trim())
      .filter((c) => c !== "" && !celulaDescartavel(c));

    // Valor = última célula que se lê como reais (e que não é código de CC).
    let idxValor = -1;
    let centavos = 0;
    let erroValor: string | null = null;
    for (let i = celulas.length - 1; i >= 0; i--) {
      if (RE_CODIGO_CC.test(celulas[i])) continue;
      const r = parseValorBRLParaCentavos(celulas[i]);
      if (r.ok) {
        idxValor = i;
        centavos = r.valor;
        break;
      }
      if (erroValor === null && /\d/.test(celulas[i])) erroValor = r.erro;
      if (i === celulas.length - 1 && /\d/.test(celulas[i])) break; // a última célula parecia valor e falhou
    }

    const outras = celulas.filter((_, i) => i !== idxValor);
    const codigo = outras.find((c) => RE_CODIGO_CC.test(c)) ?? null;
    const nome = outras.filter((c) => !RE_CODIGO_CC.test(c)).join(" ").trim();

    if (idxValor < 0) {
      if (ehPrimeira && !erroValor) {
        resultado.ignoradas.push({ linha: numeroLinha, textoOriginal: original, motivo: "cabecalho" });
      } else {
        resultado.erros.push({
          linha: numeroLinha,
          textoOriginal: original,
          erro: erroValor ?? "Linha sem valor em reais.",
        });
      }
      return;
    }

    if (!nome && !codigo) {
      resultado.erros.push({ linha: numeroLinha, textoOriginal: original, erro: "Linha sem nome nem código de centro de custo." });
      return;
    }

    if (nome && NOMES_DE_TOTAL.has(normalizarTextoCC(nome))) {
      resultado.ignoradas.push({ linha: numeroLinha, textoOriginal: original, motivo: "total", centavos });
      return;
    }

    if (centavos === 0) {
      resultado.ignoradas.push({ linha: numeroLinha, textoOriginal: original, motivo: "valor_zero", centavos: 0 });
      return;
    }

    resultado.linhas.push({ linha: numeroLinha, textoOriginal: original, nome, codigo, centavos });
  });

  return resultado;
}

// ════════════════════════════════════════════════════════════
// 5. CASAMENTO COM O CADASTRO DE CENTROS DE CUSTO
// ════════════════════════════════════════════════════════════

export interface CentroCustoRef {
  erp_code: string;
  name: string;
}

/**
 * Normaliza nome de CC para comparação: sem acento, maiúsculo, travessões viram "-",
 * espaço uniforme em volta de "/", "-" e "&", espaços colapsados.
 *   "TI – Tecnologia da Informação" → "TI - TECNOLOGIA DA INFORMACAO"
 *   "Almoxarifado/Expedição"        → "ALMOXARIFADO / EXPEDICAO"
 */
export function normalizarTextoCC(texto: string): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .toUpperCase()
    .replace(/\s*([/&-])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[:;,.]+$/, "");
}

const PALAVRAS_VAZIAS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E", "-", "/", "&"]);

function radical(palavra: string): string {
  let p = palavra;
  if (p.length > 4 && p.endsWith("S")) p = p.slice(0, -1);
  if (p.length > 4 && /[AEO]$/.test(p)) p = p.slice(0, -1);
  return p;
}

function radicais(texto: string): string[] {
  return normalizarTextoCC(texto)
    .split(" ")
    .filter((w) => w && !PALAVRAS_VAZIAS.has(w))
    .map(radical);
}

export type CasamentoCC =
  | { tipo: "exato"; por: "codigo" | "nome"; cc: CentroCustoRef }
  | { tipo: "ambiguo"; sugestoes: CentroCustoRef[] }
  | { tipo: "nao_encontrado"; sugestoes: CentroCustoRef[] };

/**
 * Casa uma linha colada com o cadastro. SÓ é automático quando o código bate, ou
 * quando o nome normalizado bate com UM único centro de custo. Qualquer coisa
 * aproximada vira SUGESTÃO — quem escolhe é a pessoa. ("Laboratório" nunca pode
 * virar "LAB PESQUISA" sem ninguém ver.)
 */
export function casarCentroDeCusto(
  entrada: { nome: string; codigo: string | null },
  cadastro: readonly CentroCustoRef[],
): CasamentoCC {
  if (entrada.codigo) {
    const porCodigo = cadastro.find((c) => c.erp_code === entrada.codigo);
    if (porCodigo) return { tipo: "exato", por: "codigo", cc: porCodigo };
  }

  const alvo = normalizarTextoCC(entrada.nome);
  if (alvo) {
    const porNome = cadastro.filter((c) => normalizarTextoCC(c.name) === alvo);
    if (porNome.length === 1) return { tipo: "exato", por: "nome", cc: porNome[0] };
    if (porNome.length > 1) return { tipo: "ambiguo", sugestoes: porNome };
  }

  // Sugestões: todos os radicais da entrada presentes no nome do CC (igual ou prefixo ≥ 4).
  const tokens = radicais(entrada.nome);
  if (tokens.length === 0) return { tipo: "nao_encontrado", sugestoes: [] };

  const casa = (t: string, cand: string) =>
    t === cand || (t.length >= 4 && cand.startsWith(t)) || (cand.length >= 4 && t.startsWith(cand));

  const pontuados = cadastro
    .map((cc) => {
      const doCC = radicais(cc.name);
      const achados = tokens.filter((t) => doCC.some((c) => casa(t, c))).length;
      return { cc, achados, sobra: doCC.length - achados };
    })
    .filter((p) => p.achados > 0);

  const completos = pontuados.filter((p) => p.achados === tokens.length);
  const base = completos.length > 0 ? completos : pontuados;
  const sugestoes = base
    .sort((a, b) => b.achados - a.achados || a.sobra - b.sobra || a.cc.name.localeCompare(b.cc.name))
    .slice(0, 5)
    .map((p) => p.cc);

  return sugestoes.length > 0 ? { tipo: "ambiguo", sugestoes } : { tipo: "nao_encontrado", sugestoes: [] };
}

// ════════════════════════════════════════════════════════════
// 6. RATEIO DE UM ITEM POR VALOR (classe → CCs)
// ════════════════════════════════════════════════════════════

export interface CcValorEntrada {
  codigo_centro_ctrl: string;
  centro_ctrl_label?: string;
  centavos: number;
}

export interface ClasseValorEntrada {
  codigo_classe_rec_desp: string;
  classe_rec_desp_label?: string;
  ccs: CcValorEntrada[];
}

export interface CcValorExato {
  codigo_centro_ctrl: string;
  centro_ctrl_label?: string;
  centavos: number;
  /** Percentual DENTRO da classe, em unidades de 0,0001 p.p. Soma 1.000.000 por classe. */
  unidades: number;
  /** Quantas linhas de entrada viraram esta (>1 = CC repetido, somado). */
  linhasOriginais: number;
}

export interface ClasseValorExata {
  codigo_classe_rec_desp: string;
  classe_rec_desp_label?: string;
  centavos: number;
  /** Percentual da classe no TOTAL (do item ou do pedido), em unidades. Soma 1.000.000. */
  unidades: number;
  ccs: CcValorExato[];
}

export interface RateioExato {
  totalCentavos: number;
  classes: ClasseValorExata[];
  /** Repetições somadas (o Alvo tem UNIQUE em classe+CC por item — card D4). */
  consolidacoes: Array<{ codigo_classe_rec_desp: string; codigo_centro_ctrl: string | null; linhas: number }>;
}

/**
 * Monta o rateio EXATO a partir de valores em centavos: agrupa classe e CC repetidos
 * (somando centavos, nunca percentuais), e deriva os percentuais pelo maior resto.
 *   - classe: unidades relativas ao TOTAL;
 *   - CC: unidades relativas à CLASSE (convenção do Alvo nos dois níveis).
 * Lança erro se algum CC com valor > 0 ficaria com 0,0000% (valor pequeno demais para
 * 4 casas) ou se o total for zero.
 */
export function montarRateioExatoPorValor(classesEntrada: readonly ClasseValorEntrada[]): RateioExato {
  const consolidacoes: RateioExato["consolidacoes"] = [];
  const porClasse = new Map<
    string,
    { label?: string; entradas: number; ccs: Map<string, { label?: string; centavos: number; linhas: number }> }
  >();

  for (const cls of classesEntrada) {
    if (!cls.codigo_classe_rec_desp) throw new RateioExatoError("Há uma classe sem código no rateio.");
    let grupo = porClasse.get(cls.codigo_classe_rec_desp);
    if (!grupo) {
      grupo = { label: cls.classe_rec_desp_label, entradas: 0, ccs: new Map() };
      porClasse.set(cls.codigo_classe_rec_desp, grupo);
    }
    grupo.entradas += 1;
    for (const cc of cls.ccs) {
      if (!cc.codigo_centro_ctrl) {
        throw new RateioExatoError(`Classe ${cls.codigo_classe_rec_desp}: há um centro de custo sem código.`);
      }
      assertInteiroNaoNegativo(cc.centavos, `Valor do CC ${cc.codigo_centro_ctrl}`);
      const atual = grupo.ccs.get(cc.codigo_centro_ctrl);
      if (atual) {
        atual.centavos += cc.centavos;
        atual.linhas += 1;
      } else {
        grupo.ccs.set(cc.codigo_centro_ctrl, { label: cc.centro_ctrl_label, centavos: cc.centavos, linhas: 1 });
      }
    }
  }

  const classesBase = Array.from(porClasse.entries()).map(([codigo, g]) => {
    if (g.entradas > 1) consolidacoes.push({ codigo_classe_rec_desp: codigo, codigo_centro_ctrl: null, linhas: g.entradas });
    const ccs = Array.from(g.ccs.entries()).map(([codigoCC, acc]) => {
      if (acc.linhas > 1) consolidacoes.push({ codigo_classe_rec_desp: codigo, codigo_centro_ctrl: codigoCC, linhas: acc.linhas });
      return { codigo_centro_ctrl: codigoCC, centro_ctrl_label: acc.label, centavos: acc.centavos, linhasOriginais: acc.linhas };
    });
    const centavos = ccs.reduce((s, c) => s + c.centavos, 0);
    return { codigo_classe_rec_desp: codigo, classe_rec_desp_label: g.label, centavos, ccs };
  });

  const totalCentavos = classesBase.reduce((s, c) => s + c.centavos, 0);
  if (totalCentavos <= 0) throw new RateioExatoError("O rateio precisa ter valor maior que zero.");

  const unidadesClasses = unidadesPorValor(classesBase.map((c) => c.centavos));
  const classes: ClasseValorExata[] = classesBase.map((cls, i) => {
    if (cls.centavos === 0) {
      throw new RateioExatoError(`A classe ${cls.codigo_classe_rec_desp} está com valor zero — remova-a.`);
    }
    const unidadesCcs = unidadesPorValor(cls.ccs.map((c) => c.centavos));
    const ccs = cls.ccs.map((cc, j) => {
      if (cc.centavos === 0) {
        throw new RateioExatoError(`O CC ${cc.codigo_centro_ctrl} está com valor zero — remova a linha.`);
      }
      if (unidadesCcs[j] === 0) {
        throw new RateioExatoError(
          `O CC ${cc.codigo_centro_ctrl} (${formatarCentavosBRL(cc.centavos)}) é pequeno demais para aparecer com 4 casas no percentual.`,
        );
      }
      return { ...cc, unidades: unidadesCcs[j] };
    });
    if (unidadesClasses[i] === 0) {
      throw new RateioExatoError(`A classe ${cls.codigo_classe_rec_desp} é pequena demais para aparecer com 4 casas no percentual.`);
    }
    return { ...cls, unidades: unidadesClasses[i], ccs };
  });

  return { totalCentavos, classes, consolidacoes };
}

export interface CcPercentualEntrada {
  codigo_centro_ctrl: string;
  centro_ctrl_label?: string;
  percentual: number;
}

export interface ClassePercentualEntrada {
  codigo_classe_rec_desp: string;
  classe_rec_desp_label?: string;
  percentual: number;
  ccs: CcPercentualEntrada[];
}

/**
 * Converte um rateio digitado em PERCENTUAL em centavos exatos para um total, pelo
 * maior resto nos dois níveis (classe no item, CC na classe). Usado quando o pedido
 * mistura item por valor com item por percentual, e na troca "% → R$" da tela.
 *
 * Ex.: 33,33 / 33,33 / 33,34 de R$ 19.415,04 → 6.471,03 + 6.471,03 + 6.472,98 =
 * 19.415,04 exatos (o 0004919 saiu com 19.415,03 no item pelo caminho antigo).
 */
export function converterPercentualEmValor(
  classes: readonly ClassePercentualEntrada[],
  totalCentavos: number,
): ClasseValorEntrada[] {
  assertInteiroNaoNegativo(totalCentavos, "totalCentavos");
  if (classes.length === 0) return [];
  const centavosClasses = centavosPorUnidades(
    totalCentavos,
    classes.map((c) => percentualParaUnidades(c.percentual)),
  );
  return classes.map((cls, i) => {
    const centavosCcs =
      cls.ccs.length === 0
        ? []
        : centavosPorUnidades(
            centavosClasses[i],
            cls.ccs.map((cc) => percentualParaUnidades(cc.percentual)),
          );
    return {
      codigo_classe_rec_desp: cls.codigo_classe_rec_desp,
      classe_rec_desp_label: cls.classe_rec_desp_label,
      ccs: cls.ccs.map((cc, j) => ({
        codigo_centro_ctrl: cc.codigo_centro_ctrl,
        centro_ctrl_label: cc.centro_ctrl_label,
        centavos: centavosCcs[j],
      })),
    };
  });
}

// ════════════════════════════════════════════════════════════
// 7. AGREGAÇÃO NO CABEÇALHO DO PEDIDO
// ════════════════════════════════════════════════════════════

/**
 * Soma o rateio exato de todos os itens por (classe, CC) — em centavos, sem
 * recalcular nada — e deriva os percentuais do cabeçalho pelo maior resto:
 * classe relativa ao total do pedido, CC relativo à classe.
 * A soma das classes é o total do pedido POR CONSTRUÇÃO: não há "ajuste residual".
 */
export function agregarRateioExatoDoPedido(itens: readonly RateioExato[]): RateioExato {
  const entradas: ClasseValorEntrada[] = itens.flatMap((item) =>
    item.classes.map((cls) => ({
      codigo_classe_rec_desp: cls.codigo_classe_rec_desp,
      classe_rec_desp_label: cls.classe_rec_desp_label,
      ccs: cls.ccs.map((cc) => ({
        codigo_centro_ctrl: cc.codigo_centro_ctrl,
        centro_ctrl_label: cc.centro_ctrl_label,
        centavos: cc.centavos,
      })),
    })),
  );
  const agregado = montarRateioExatoPorValor(entradas);
  // No cabeçalho, somar a mesma classe/CC de itens diferentes é o esperado — não é
  // repetição a avisar.
  return { ...agregado, consolidacoes: [] };
}
