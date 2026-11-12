// =====================================================================
// exportar-notas-cbs — lógica (sem rede, sem Supabase). PLANO-VENDAS.md §21.
// Testes: logica.test.ts
// =====================================================================

// Comparação da chave em tempo constante (não revela quantos caracteres batem).
export function chaveConfere(recebida: string | null, esperada: string): boolean {
  if (!recebida || !esperada) return false;
  const a = new TextEncoder().encode(recebida);
  const b = new TextEncoder().encode(esperada);
  let dif = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) dif |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return dif === 0;
}

export interface Chave {
  modelo: string;
  serie: string;
  numero: number;
}

export interface Pedido {
  desde: string; // AAAA-MM-DD
  apos: Chave | null; // a página começa depois desta nota
  limite: number;
}

const inteiro = (v: unknown, padrao: number, min: number, max: number) => {
  const n = typeof v === "number" ? Math.floor(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

// Data 'AAAA-MM-DD' válida, de 01/01/2024 até hoje.
export function dataValida(d: unknown, hojeISO: string): boolean {
  if (typeof d !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d) return false;
  return d >= "2024-01-01" && d <= hojeISO;
}

// A chave que veio em "ultimo" na página anterior.
export function lerChave(v: unknown): Chave | null | { erro: string } {
  if (v === undefined || v === null) return null;
  const c = v as Record<string, unknown>;
  if (
    typeof v !== "object" ||
    typeof c.modelo !== "string" || !/^[A-Za-z0-9-]{2,10}$/.test(c.modelo) ||
    typeof c.serie !== "string" || !/^[0-9]{1,5}$/.test(c.serie) ||
    typeof c.numero !== "number" || !Number.isSafeInteger(c.numero) || c.numero < 1
  ) {
    return { erro: "apos deve ser { modelo, serie, numero } como em 'ultimo'" };
  }
  return { modelo: c.modelo, serie: c.serie, numero: c.numero };
}

// { "desde": "AAAA-MM-DD", "apos": {modelo, serie, numero} | null, "limite": 500 }
export function lerPedido(body: unknown, hojeISO: string): Pedido | { erro: string } {
  if (!body || typeof body !== "object") return { erro: "corpo JSON obrigatório" };
  const b = body as Record<string, unknown>;
  const desde = b.desde ?? "2026-01-01";
  if (!dataValida(desde, hojeISO)) return { erro: "desde deve ser 'AAAA-MM-DD' entre 2024-01-01 e hoje" };
  const apos = lerChave(b.apos);
  if (apos && "erro" in apos) return apos;
  return { desde: desde as string, apos, limite: inteiro(b.limite, 500, 1, 1000) };
}
