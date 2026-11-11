/**
 * Regras puras do seletor de período De / Até (PLANO-NFE NFE-13) — sem React.
 * Datas sempre "YYYY-MM-DD" (dia local, sem hora).
 */

export type CampoPeriodo = "de" | "ate";

export interface RascunhoPeriodo {
  de: string | null;
  ate: string | null;
  /** Campo que o próximo clique no calendário preenche. */
  ativo: CampoPeriodo;
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** Data real? (rejeita 31/02, 00/01 etc.) */
function valida(a: number, m: number, d: number): boolean {
  if (a < 1900 || a > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(a, m, 0).getDate();
}

/**
 * Lê o que a pessoa digitou: "dd/mm/aaaa", "dd/mm/aa", "dd-mm-aaaa", "ddmmaaaa" ou já em ISO "aaaa-mm-dd".
 * Devolve ISO ou null (incompleto ou data que não existe).
 */
export function lerDataDigitada(texto: string): string | null {
  const t = texto.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return valida(a, mes, d) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/) ?? t.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mes = Number(m[2]);
  const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return valida(a, mes, d) ? `${a}-${p2(mes)}-${p2(d)}` : null;
}

/** Máscara enquanto digita: só dígitos, com as barras no lugar ("1112026" → "11/12/026"). */
export function mascaraData(texto: string): string {
  const d = texto.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** "YYYY-MM-DD" → "dd/mm/aaaa" (vazio se não houver). */
export function formatarDataBR(iso: string | null | undefined): string {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * Clique num dia do calendário, conforme o campo ativo:
 *   - "de": vira a data inicial; se a final ficou antes dela, a final é limpa; o próximo clique é a final.
 *   - "ate": sem inicial, o dia vira a inicial; antes da inicial, o dia vira a nova inicial (a final segue em aberto);
 *     senão vira a final e o próximo clique recomeça pela inicial.
 */
export function escolherDia(r: RascunhoPeriodo, dia: string): RascunhoPeriodo {
  if (r.ativo === "de" || !r.de) {
    return { de: dia, ate: r.ate && r.ate < dia ? null : r.ate, ativo: "ate" };
  }
  if (dia < r.de) return { de: dia, ate: null, ativo: "ate" };
  return { de: r.de, ate: dia, ativo: "de" };
}

/** Na hora de aplicar: só a inicial = um dia só; final antes da inicial = troca as duas. */
export function periodoFinal(r: { de: string | null; ate: string | null }): { de: string; ate: string } | null {
  if (!r.de && !r.ate) return null;
  const de = r.de ?? r.ate!;
  const ate = r.ate ?? r.de!;
  return de <= ate ? { de, ate } : { de: ate, ate: de };
}

/** Dias do período, contando os dois extremos ("01/11 a 30/11" = 30). */
export function diasNoPeriodo(de: string | null, ate: string | null): number | null {
  const f = periodoFinal({ de, ate });
  if (!f) return null;
  const dia = (iso: string) => {
    const [a, m, d] = iso.split("-").map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((dia(f.ate) - dia(f.de)) / 86_400_000) + 1;
}
