// =====================================================================
// exportar-notas-recebidas-balancete — lógica (sem rede, sem Supabase). PLANO-NFE.md, NFE-21.
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
export type Pedido =
  | { acao: "resumo"; meses: number }
  | { acao: "mes"; tipo: Tipo; mes: string; pagina: number; porPagina: number };

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
    if (body.tipo !== "nfe" && body.tipo !== "nfse") return { erro: "tipo deve ser 'nfe' ou 'nfse'" };
    if (!mesValido(body.mes, hojeISO)) return { erro: "mes deve ser 'AAAA-MM' dos últimos 24 meses" };
    return {
      acao: "mes",
      tipo: body.tipo,
      mes: body.mes,
      pagina: inteiro(body.pagina, 1, 1, 1000),
      porPagina: inteiro(body.por_pagina, 20, 1, 50),
    };
  }
  return { erro: "acao deve ser 'resumo' ou 'mes'" };
}

// Primeiro dia do mês e primeiro dia do mês seguinte ('YYYY-MM-01'), para filtrar data_emissao.
export function intervaloMes(mes: string): { de: string; ate: string } {
  const [a, m] = mes.split("-").map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  return { de: `${mes}-01`, ate: `${prox}-01` };
}

// Os últimos n meses até o de hoje, do mais antigo para o mais novo ('YYYY-MM').
export function ultimosMeses(n: number, hojeISO: string): string[] {
  let [a, m] = hojeISO.slice(0, 7).split("-").map(Number);
  const r: string[] = [];
  for (let i = 0; i < n; i++) {
    r.unshift(`${a}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; a -= 1; }
  }
  return r;
}

// ---------------------------------------------------------------------
// Impressão digital do mês: muda quando entra, sai ou muda uma nota do mês (inclusive a situação dela no Hub).
// O Balancete compara com a da última carga e só busca o mês se mudou.
// ---------------------------------------------------------------------

// Campos da NF-e que entram na impressão (a nota em si não muda depois de chegar; o que muda é a situação no Hub).
export const CAMPOS_IMPRESSAO_NFE = [
  "chave_acesso", "updated_at", "status_lancamento", "recebido", "pedido_compra_numero", "erp_chave_movestq", "situacao",
] as const;
// Da NFS-e: a situação no fisco e no Alvo (dias_desde_emissao fica de fora: muda todo dia sem a nota mudar).
export const CAMPOS_IMPRESSAO_NFSE = [
  "nsu", "chave_acesso", "situacao_fisco", "cancelada_em", "situacao_alvo", "alvo_chave_docfin", "alvo_chave_movestq",
  "alvo_valor", "alvo_parcelas", "alvo_pagamento", "alvo_pedido", "alvo_vinculo",
] as const;

export function linhaImpressao(linha: Record<string, unknown>, campos: readonly string[], extra: unknown = null): string {
  return JSON.stringify([...campos.map((c) => linha[c] ?? null), extra]);
}

export async function impressao(linhas: string[]): Promise<string> {
  const texto = [...linhas].sort().join("\n");
  const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Pedidos vinculados no Hub, por nota, em ordem estável (o principal primeiro).
export function pedidosPorNota(vinculos: { nfe_id: string; pedido_numero: string; is_principal: boolean | null }[]) {
  const r = new Map<string, { pedido: string; principal: boolean }[]>();
  for (const v of vinculos) {
    const l = r.get(v.nfe_id) ?? [];
    l.push({ pedido: v.pedido_numero, principal: !!v.is_principal });
    r.set(v.nfe_id, l);
  }
  for (const l of r.values()) l.sort((x, y) => Number(y.principal) - Number(x.principal) || x.pedido.localeCompare(y.pedido));
  return r;
}

// Resumo por mês: quantidade e impressão de cada tipo, para todos os meses pedidos (mês sem nota = 0).
export async function resumoMeses(
  meses: string[],
  nfe: { linha: Record<string, any>; pedidos: unknown }[],
  nfse: Record<string, any>[],
) {
  const grupos = new Map<string, { nfe: string[]; nfse: string[] }>(meses.map((m) => [m, { nfe: [], nfse: [] }]));
  for (const { linha, pedidos } of nfe) {
    const g = grupos.get(String(linha.data_emissao).slice(0, 7));
    if (g) g.nfe.push(linhaImpressao(linha, CAMPOS_IMPRESSAO_NFE, pedidos));
  }
  for (const linha of nfse) {
    const g = grupos.get(String(linha.data_emissao).slice(0, 7));
    if (g) g.nfse.push(linhaImpressao(linha, CAMPOS_IMPRESSAO_NFSE));
  }
  const r = [];
  for (const [mes, g] of grupos) {
    r.push({
      mes,
      nfe: { notas: g.nfe.length, impressao: await impressao(g.nfe) },
      nfse: { notas: g.nfse.length, impressao: await impressao(g.nfse) },
    });
  }
  return r;
}

// ---------------------------------------------------------------------
// Uma nota como viaja para o Balancete: o documento do fornecedor (XML completo) e a situação dela nas telas do Hub.
// É o DOCUMENTO RECEBIDO, não o lançamento no Alvo (esse é outro dado, "notas de entrada" no Balancete).
// ---------------------------------------------------------------------

export function montarNfe(n: Record<string, any>, pedidos: { pedido: string; principal: boolean }[] = []) {
  return {
    tipo: "NF-e",
    chave: n.chave_acesso,
    numero: n.numero,
    serie: n.serie,
    modelo: n.modelo,
    emissao: n.data_emissao,
    natureza_operacao: n.natureza_operacao,
    emitente: {
      cnpj: n.emitente_cnpj, nome: n.emitente_nome, ie: n.emitente_ie, uf: n.emitente_uf, municipio: n.emitente_municipio,
    },
    destinatario: { cnpj: n.destinatario_cnpj, nome: n.destinatario_nome },
    valores: {
      produtos: n.valor_produtos, frete: n.valor_frete, seguro: n.valor_seguro, desconto: n.valor_desconto,
      outras_despesas: n.valor_outras_despesas, ipi: n.valor_ipi, base_icms: n.base_calculo_icms, icms: n.valor_icms,
      base_icms_st: n.base_icms_st, icms_st: n.valor_icms_st, ii: n.valor_ii, fcp: n.valor_fcp, pis: n.valor_pis,
      cofins: n.valor_cofins, total: n.valor_total,
    },
    no_hub: {
      chegou_em: n.imported_at,
      origem: n.origem,
      situacao: n.situacao,
      status_lancamento: n.status_lancamento,
      lancado_em: n.lancado_em,
      recebido: n.recebido,
      recebido_em: n.recebido_em,
      chave_movestq_alvo: n.erp_chave_movestq,
      pedido_do_lancamento: n.pedido_compra_numero
        ? {
          numero: n.pedido_compra_numero, entidade: n.pedido_compra_entidade, classe: n.pedido_compra_classe,
          centro_custo: n.pedido_compra_centro_custo, cond_pagamento: n.pedido_compra_cond_pagamento,
          valor: n.pedido_compra_valor,
        }
        : null,
      pedidos_vinculados_no_hub: pedidos,
      atualizado_em: n.updated_at,
    },
    xml: n.raw_xml,
  };
}

export function montarNfse(n: Record<string, any>, xml: string | null) {
  return {
    tipo: "NFS-e",
    chave: n.chave_acesso,
    nsu: n.nsu,
    numero: n.numero,
    emissao: n.data_emissao,
    prestador: { documento: n.prestador_doc, nome: n.prestador_nome },
    municipio_emissor: { codigo: n.cmun_emissor, nome: n.municipio_emissor },
    tomador_documento: n.tomador_doc,
    intermediario_documento: n.intermediario_doc,
    valores: { servico: n.valor_servico, liquido: n.valor_liquido },
    no_fisco: { situacao: n.situacao_fisco, cancelada_em: n.cancelada_em, gerada_em: n.gerado_em },
    no_alvo: {
      situacao: n.situacao_alvo, especies: n.alvo_especies, chave_docfin: n.alvo_chave_docfin,
      chave_movestq: n.alvo_chave_movestq, data_entrada: n.alvo_data_entrada, valor: n.alvo_valor,
      parcelas: n.alvo_parcelas, pagamento: n.alvo_pagamento, pedido: n.alvo_pedido, vinculo: n.alvo_vinculo,
      numero_documento: n.alvo_doc_numero, cnpj: n.alvo_cnpj,
    },
    xml,
  };
}

export function paginacao(total: number, pagina: number, porPagina: number) {
  return { total, pagina, por_pagina: porPagina, paginas: Math.max(1, Math.ceil((total ?? 0) / porPagina)) };
}
