// Linha digitável de boleto — conferência por regra (Febraban). Sem dependências: roda no Deno (Edge) e no
// vitest. A IA lê o boleto; este arquivo decide se a leitura é válida. Nada aqui confia no modelo.
//
// Bancário: linha de 47 dígitos (5 campos) ↔ código de barras de 44.
//   código de barras = banco(3) moeda(1) DV-geral(1) fator(4) valor(10) campo-livre(25)
//   campos 1–3 da linha têm DV módulo 10; o DV geral é módulo 11 sobre os outros 43 dígitos.
// Arrecadação (concessionária/tributo): 48 dígitos começando por 8, 4 blocos de 11 + DV; o 3º dígito diz o
//   módulo (6/7 → 10, 8/9 → 11) e se o valor é real (6/8) ou referência (7/9).

export type TipoBoleto = "bancario" | "arrecadacao";

export interface LinhaConferida {
  valida: boolean;
  tipo: TipoBoleto | null;
  /** Só os dígitos da linha (47 ou 48). */
  linha: string;
  /** Linha formatada como impressa no boleto. */
  linha_formatada: string | null;
  codigo_barras: string | null;
  banco: string | null;
  valor: number | null;
  /** YYYY-MM-DD; null quando o fator é 0000 (sem vencimento) ou arrecadação. */
  vencimento: string | null;
  fator_vencimento: string | null;
  erros: string[];
}

export const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Módulo 10: pesos 2,1,2,1… da direita; soma os algarismos de cada produto. */
export function modulo10(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    let p = Number(numero[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

/** Módulo 11 com pesos 2..9 da direita. Retorna o resto (a regra do DV muda entre bancário e arrecadação). */
function restoModulo11(numero: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numero.length - 1; i >= 0; i--) {
    soma += Number(numero[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  return soma % 11;
}

/** DV geral do boleto bancário: 11 − resto; 0, 10 e 11 viram 1. */
export function dvBancario(codigo43: string): number {
  const dv = 11 - restoModulo11(codigo43);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** DV módulo 11 da arrecadação: resto 0 ou 1 → 0; senão 11 − resto. */
export function dvArrecadacao11(numero: string): number {
  const r = restoModulo11(numero);
  return r === 0 || r === 1 ? 0 : 11 - r;
}

const DIA = 86_400_000;
const BASE_1997 = Date.UTC(1997, 9, 7); // 07/10/1997 = fator 0
const BASE_2025 = Date.UTC(2025, 1, 22); // 22/02/2025 = fator 1000 do 2º ciclo (Febraban)

/**
 * Fator de vencimento → data. O fator chegou a 9999 em 21/02/2025 e recomeçou em 1000; a cada 9.000 dias o
 * ciclo se repete. Entre as datas possíveis, vale a mais próxima da data de referência (emissão ou hoje).
 */
export function vencimentoDoFator(fator: string, referencia: Date = new Date()): string | null {
  const f = Number(fator);
  if (!f) return null;
  const candidatos: number[] = [BASE_1997 + f * DIA];
  if (f >= 1000) for (let ciclo = 0; ciclo < 3; ciclo++) candidatos.push(BASE_2025 + (f - 1000 + ciclo * 9000) * DIA);
  const ref = referencia.getTime();
  const melhor = candidatos.reduce((a, b) => (Math.abs(b - ref) < Math.abs(a - ref) ? b : a));
  return new Date(melhor).toISOString().slice(0, 10);
}

function formatarBancaria(l: string) {
  return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
}

function conferirBancaria(l: string, referencia?: Date): LinhaConferida {
  const erros: string[] = [];
  const campos = [l.slice(0, 9), l.slice(10, 20), l.slice(21, 31)];
  const dvs = [l[9], l[20], l[31]];
  campos.forEach((c, i) => {
    if (modulo10(c) !== Number(dvs[i])) erros.push(`DV do campo ${i + 1} não confere (módulo 10)`);
  });
  const codigo = l.slice(0, 4) + l[32] + l.slice(33, 47) + l.slice(4, 9) + l.slice(10, 20) + l.slice(21, 31);
  const semDv = codigo.slice(0, 4) + codigo.slice(5);
  if (dvBancario(semDv) !== Number(codigo[4])) erros.push("DV geral do código de barras não confere (módulo 11)");
  if (l[3] !== "9") erros.push("Moeda diferente de real (9)");
  const fator = l.slice(33, 37);
  return {
    valida: erros.length === 0,
    tipo: "bancario",
    linha: l,
    linha_formatada: formatarBancaria(l),
    codigo_barras: codigo,
    banco: l.slice(0, 3),
    valor: Number(l.slice(37, 47)) / 100,
    vencimento: vencimentoDoFator(fator, referencia),
    fator_vencimento: fator,
    erros,
  };
}

function conferirArrecadacao(l: string): LinhaConferida {
  const erros: string[] = [];
  const blocos = [0, 1, 2, 3].map((i) => l.slice(i * 12, i * 12 + 11));
  const dvsBloco = [0, 1, 2, 3].map((i) => Number(l[i * 12 + 11]));
  const codigo = blocos.join("");
  const ident = codigo[2];
  const mod10 = ident === "6" || ident === "7";
  if (!mod10 && ident !== "8" && ident !== "9") erros.push(`3º dígito "${ident}" não é identificador válido (6, 7, 8 ou 9)`);
  blocos.forEach((b, i) => {
    const dv = mod10 ? modulo10(b) : dvArrecadacao11(b);
    if (dv !== dvsBloco[i]) erros.push(`DV do bloco ${i + 1} não confere`);
  });
  const semDv = codigo.slice(0, 3) + codigo.slice(4);
  const dvGeral = mod10 ? modulo10(semDv) : dvArrecadacao11(semDv);
  if (dvGeral !== Number(codigo[3])) erros.push("DV geral não confere");
  const valorReal = ident === "6" || ident === "8";
  return {
    valida: erros.length === 0,
    tipo: "arrecadacao",
    linha: l,
    linha_formatada: [0, 1, 2, 3].map((i) => `${l.slice(i * 12, i * 12 + 11)}-${l[i * 12 + 11]}`).join(" "),
    codigo_barras: codigo,
    banco: null,
    valor: valorReal ? Number(codigo.slice(4, 15)) / 100 : null,
    vencimento: null,
    fator_vencimento: null,
    erros,
  };
}

/** Confere uma linha digitável (com ou sem pontos/espaços). `referencia` escolhe o ciclo do fator de vencimento. */
export function conferirLinhaDigitavel(entrada: string | null | undefined, referencia?: Date): LinhaConferida {
  const l = soDigitos(entrada);
  if (l.length === 47) return conferirBancaria(l, referencia);
  if (l.length === 48 && l[0] === "8") return conferirArrecadacao(l);
  return {
    valida: false,
    tipo: null,
    linha: l,
    linha_formatada: null,
    codigo_barras: null,
    banco: null,
    valor: null,
    vencimento: null,
    fator_vencimento: null,
    erros: [`A linha tem ${l.length} dígitos — o boleto bancário tem 47 e o de arrecadação 48 (começando por 8)`],
  };
}
