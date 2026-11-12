// =====================================================================
// exportar-notas-balancete — lógica (sem rede, sem Supabase). PLANO-VENDAS.md §20.
// Testes: logica.test.ts
// =====================================================================

// Tira os campos vazios exatamente como os scripts de leitura do Balancete P&F
// (balancete-starter, docs/alvo/ler-notasfiscais-no-hub.js, função `limpa`):
// null, "", 0, false, listas vazias e objetos que ficaram vazios.
// O script de carga do Balancete foi escrito para esse formato.
export function limpa(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(limpa);
  if (o && typeof o === "object") {
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (v === null || v === "" || v === 0 || v === false) continue;
      if (Array.isArray(v) && !v.length) continue;
      const c = limpa(v);
      if (c && typeof c === "object" && !Array.isArray(c) && !Object.keys(c as object).length) continue;
      r[k] = c;
    }
    return r;
  }
  return o;
}

// Comparação da chave em tempo constante (não revela quantos caracteres batem).
export function chaveConfere(recebida: string | null, esperada: string): boolean {
  if (!recebida || !esperada) return false;
  const a = new TextEncoder().encode(recebida);
  const b = new TextEncoder().encode(esperada);
  let dif = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) dif |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return dif === 0;
}

export type Pedido =
  | { acao: "resumo"; meses: number }
  | { acao: "mes"; mes: string; pagina: number; porPagina: number };

const inteiro = (v: unknown, padrao: number, min: number, max: number) => {
  const n = typeof v === "number" ? Math.floor(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

// Mês 'YYYY-MM' dentro dos últimos 24 meses (contando o atual), nunca futuro.
export function mesValido(mes: unknown, hojeISO: string): boolean {
  if (typeof mes !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return false;
  const [a, m] = mes.split("-").map(Number);
  const [ha, hm] = hojeISO.slice(0, 7).split("-").map(Number);
  const dif = (ha - a) * 12 + (hm - m);
  return dif >= 0 && dif < 24;
}

export function lerPedido(body: any, hojeISO: string): Pedido | { erro: string } {
  if (!body || typeof body !== "object") return { erro: "corpo JSON obrigatório" };
  if (body.acao === "resumo") return { acao: "resumo", meses: inteiro(body.meses, 13, 1, 24) };
  if (body.acao === "mes") {
    if (!mesValido(body.mes, hojeISO)) return { erro: "mes deve ser 'AAAA-MM' dos últimos 24 meses" };
    return { acao: "mes", mes: body.mes, pagina: inteiro(body.pagina, 1, 1, 1000), porPagina: inteiro(body.por_pagina, 20, 1, 50) };
  }
  return { erro: "acao deve ser 'resumo' ou 'mes'" };
}

// Página do mês no formato dos arquivos dos scripts ("forma A" do relatório do Balancete):
// { gerado_em, loads: { chave: nota }, series: { controle: { s, l, p } }, erros: {} }
export function respostaMes(
  dados: { mes: string; total: number; na_pagina: number; sem_detalhe: string[]; loads: Record<string, unknown>; series: Record<string, unknown> },
  pagina: number,
  porPagina: number,
  agoraISO: string,
) {
  const loads: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dados.loads ?? {})) loads[k] = limpa(v);
  return {
    gerado_em: agoraISO,
    mes: dados.mes,
    pagina,
    por_pagina: porPagina,
    total: dados.total,
    paginas: Math.max(1, Math.ceil((dados.total ?? 0) / porPagina)),
    na_pagina: dados.na_pagina,
    sem_detalhe: dados.sem_detalhe ?? [],
    loads,
    series: dados.series ?? {},
    erros: {},
  };
}
