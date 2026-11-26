// =====================================================================
// exportar-notas-recebidas-cbs — lógica (sem rede, sem Supabase). PLANO-NFE.md, NFE-22.
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

export type Tipo = "nfe" | "nfse";
export interface Pedido {
  tipo: Tipo;
  desde: string; // AAAA-MM-DD (data de emissão)
  apos: string | null; // a página começa depois desta chave de acesso
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

// { "tipo": "nfe" | "nfse", "desde": "AAAA-MM-DD", "apos": "<chave>" | null, "limite": 100 } (máx. 300)
export function lerPedido(body: unknown, hojeISO: string): Pedido | { erro: string } {
  if (!body || typeof body !== "object") return { erro: "corpo JSON obrigatório" };
  const b = body as Record<string, unknown>;
  if (b.tipo !== "nfe" && b.tipo !== "nfse") return { erro: "tipo deve ser 'nfe' ou 'nfse'" };
  const desde = b.desde ?? "2026-01-01";
  if (!dataValida(desde, hojeISO)) return { erro: "desde deve ser 'AAAA-MM-DD', de 2024-01-01 até hoje" };
  let apos: string | null = null;
  if (b.apos !== undefined && b.apos !== null) {
    // Chave de acesso: NF-e 44 dígitos; NFS-e nacional 50 caracteres (dígitos).
    if (typeof b.apos !== "string" || !/^\d{44}$|^\d{50}$/.test(b.apos)) {
      return { erro: "apos deve ser a chave de acesso que veio em 'ultimo'" };
    }
    apos = b.apos;
  }
  return { tipo: b.tipo, desde: desde as string, apos, limite: inteiro(b.limite, 100, 1, 300) };
}

// Só pessoa jurídica (14 dígitos) sai do Hub: CPF nunca vai para o Cockpit (LGPD).
export function cnpj(doc: unknown): string | null {
  const d = typeof doc === "string" ? doc.replace(/\D/g, "") : "";
  return d.length === 14 ? d : null;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const tag = (xml: string, nome: string): string | undefined =>
  new RegExp(`<${nome}>([^<]*)</${nome}>`).exec(xml)?.[1]?.trim();

export interface Valores {
  base: number | null;
  cbs: number | null;
  ibs: number | null;
}

// NF-e: totais da nota em <total><IBSCBSTot> (vBCIBSCBS, gIBS/vIBS, gCBS/vCBS). Sem o grupo: tudo null.
export function valoresNfe(xml: string | null): Valores {
  const bloco = xml ? /<IBSCBSTot>([\s\S]*?)<\/IBSCBSTot>/.exec(xml)?.[1] : undefined;
  if (!bloco) return { base: null, cbs: null, ibs: null };
  const gIBS = /<gIBS>([\s\S]*?)<\/gIBS>/.exec(bloco)?.[1] ?? "";
  const gCBS = /<gCBS>([\s\S]*?)<\/gCBS>/.exec(bloco)?.[1] ?? "";
  return { base: num(tag(bloco, "vBCIBSCBS")), cbs: num(tag(gCBS, "vCBS")), ibs: num(tag(gIBS, "vIBS")) };
}

// NFS-e nacional: o grupo <IBSCBS> da nota (o que tem <totCIBS>): base em <valores><vBC>,
// IBS em gIBS/vIBSTot e CBS em gCBS/vCBS. Competência e série vêm da DPS.
export function valoresNfse(xml: string | null): Valores & { competencia: string | null; serie: string | null } {
  if (!xml) return { base: null, cbs: null, ibs: null, competencia: null, serie: null };
  const competencia = tag(xml, "dCompet")?.slice(0, 10) ?? null;
  const serie = tag(xml, "serie") ?? null;
  const grupo = /<IBSCBS>((?:(?!<\/IBSCBS>)[\s\S])*?<totCIBS>[\s\S]*?)<\/IBSCBS>/.exec(xml)?.[1];
  if (!grupo) return { base: null, cbs: null, ibs: null, competencia, serie };
  const tot = /<totCIBS>([\s\S]*?)<\/totCIBS>/.exec(grupo)?.[1] ?? "";
  const gCBS = /<gCBS>([\s\S]*?)<\/gCBS>/.exec(tot)?.[1] ?? "";
  const valores = /<valores>([\s\S]*?)<\/valores>/.exec(grupo)?.[1] ?? "";
  return {
    base: num(tag(valores, "vBC")),
    cbs: num(tag(gCBS, "vCBS")),
    ibs: num(tag(tot, "vIBSTot")),
    competencia,
    serie,
  };
}

/** Uma NF-e como viaja para o Cockpit: só o cabeçalho e os valores de CBS/IBS (sem XML). */
export function montarNfe(n: Record<string, any>) {
  const v = valoresNfe(n.raw_xml ?? null);
  return {
    chave: n.chave_acesso as string,
    modelo: "NF-e",
    serie: n.serie ?? null,
    numero: n.numero ?? null,
    emissao: n.data_emissao ?? null,
    competencia: null,
    emitente_cnpj: cnpj(n.emitente_cnpj),
    emitente_nome: cnpj(n.emitente_cnpj) ? (n.emitente_nome ?? null) : null,
    emitente_uf: n.emitente_uf ?? null,
    valor_total: n.valor_total ?? null,
    base_cbs: v.base,
    valor_cbs: v.cbs,
    valor_ibs: v.ibs,
    // NF-e: o Hub não acompanha o cancelamento no fisco (PLANO-NFE, regra 2): null = não se sabe.
    cancelada: null,
    chegou_em: n.imported_at ?? null,
  };
}

/** Uma NFS-e como viaja para o Cockpit (a situação no fisco vem do ambiente nacional). */
export function montarNfse(n: Record<string, any>, xml: string | null) {
  const v = valoresNfse(xml);
  const doc = cnpj(n.prestador_doc);
  return {
    chave: n.chave_acesso as string,
    modelo: "NFS-e",
    serie: v.serie,
    numero: n.numero ?? null,
    emissao: n.data_emissao ?? null,
    competencia: v.competencia,
    emitente_cnpj: doc,
    emitente_nome: doc ? (n.prestador_nome ?? null) : null,
    emitente_uf: null,
    municipio: n.municipio_emissor ?? null,
    valor_total: n.valor_servico ?? null,
    base_cbs: v.base,
    valor_cbs: v.cbs,
    valor_ibs: v.ibs,
    cancelada: n.situacao_fisco === "cancelada" || n.situacao_fisco === "substituida",
    situacao_fisco: n.situacao_fisco ?? null,
    lancada_alvo: n.situacao_alvo ?? null,
    entrada_alvo: n.alvo_data_entrada ?? null,
  };
}
