// src/services/parseNfeXml.ts
//
// Parser de XML de NF-e (modelo 55) no front-end. Mesma lógica da Edge Function
// receber-nfe, para o upload manual. Retorna os campos prontos para inserir em
// compras_nfe + os itens para dados_extraidos.
//
// ── Etapa B (C1) ──────────────────────────────────────────────────────────
// Estendido para extrair os IMPOSTOS POR ITEM (ICMS/PIS/COFINS/IPI) de dentro
// do bloco <imposto> de cada <det>. Antes só os TOTAIS da nota (<ICMSTot>) eram
// lidos; os itens não tinham imposto. O lançamento de NF-e no Alvo (Caminho C1)
// pré-preenche os tributos do item a partir do que o fornecedor destacou no XML.
//
// Robusto a qualquer CST: não procura o grupo intermediário literal (ICMS00,
// PISAliq, etc.) — extrai a tag final onde quer que ela esteja dentro do bloco
// do tributo. Assim aceita ICMS00/10/20…, PISAliq/Outr/NT, COFINS idem.
export interface ParsedNfeItemImposto {
  // ICMS
  icms_cst: string | null;
  icms_orig: string | null;
  icms_mod_bc: string | null;
  icms_base: number | null;
  icms_percentual: number | null;
  icms_valor: number | null;
  // PIS
  pis_cst: string | null;
  pis_base: number | null;
  pis_percentual: number | null;
  pis_valor: number | null;
  // COFINS
  cofins_cst: string | null;
  cofins_base: number | null;
  cofins_percentual: number | null;
  cofins_valor: number | null;
  // IPI
  ipi_cst: string | null;
  ipi_base: number | null;
  ipi_percentual: number | null;
  ipi_valor: number | null;
}

export interface ParsedNfe {
  chave_acesso: string;
  numero: string | null;
  serie: string | null;
  modelo: string | null;
  natureza_operacao: string | null;
  data_emissao: string | null;
  emitente_cnpj: string | null;
  emitente_nome: string | null;
  valor_produtos: number | null;
  valor_frete: number | null;
  valor_seguro: number | null;
  valor_desconto: number | null;
  valor_outras_despesas: number | null;
  base_calculo_icms: number | null;
  valor_icms: number | null;
  base_icms_st: number | null;
  valor_icms_st: number | null;
  valor_ipi: number | null;
  valor_ii: number | null;
  valor_pis: number | null;
  valor_cofins: number | null;
  valor_fcp: number | null;
  valor_total: number | null;
  itens: any[];
}
function pick(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : null;
}
function num(xml: string, tag: string): number | null {
  const v = pick(xml, tag);
  if (v === null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function block(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

// ── Helpers da Etapa B (C1) ───────────────────────────────────────────────
//
// pickDeep: pega a PRIMEIRA ocorrência de uma tag simples em qualquer
// profundidade dentro de um trecho (ignora o grupo intermediário).
// Ex.: pickDeep(blocoICMS, "vICMS") acha <vICMS> esteja em ICMS00, ICMS10, etc.
function pickDeep(xml: string | null, tag: string): string | null {
  if (!xml) return null;
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : null;
}
function numDeep(xml: string | null, tag: string): number | null {
  const v = pickDeep(xml, tag);
  if (v === null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// Extrai os impostos de um item a partir do bloco <imposto> do <det>.
// Cada tributo (ICMS/PIS/COFINS/IPI) tem um sub-bloco cujo nome do grupo
// varia por CST; por isso isolamos o bloco do tributo e usamos pickDeep.
function parseItemImposto(det: string): ParsedNfeItemImposto {
  const imposto = block(det, "imposto") || "";
  const blocoICMS = block(imposto, "ICMS");
  const blocoPIS = block(imposto, "PIS");
  const blocoCOFINS = block(imposto, "COFINS");
  const blocoIPI = block(imposto, "IPI");

  return {
    // ICMS
    icms_cst: pickDeep(blocoICMS, "CST"),
    icms_orig: pickDeep(blocoICMS, "orig"),
    icms_mod_bc: pickDeep(blocoICMS, "modBC"),
    icms_base: numDeep(blocoICMS, "vBC"),
    icms_percentual: numDeep(blocoICMS, "pICMS"),
    icms_valor: numDeep(blocoICMS, "vICMS"),
    // PIS
    pis_cst: pickDeep(blocoPIS, "CST"),
    pis_base: numDeep(blocoPIS, "vBC"),
    pis_percentual: numDeep(blocoPIS, "pPIS"),
    pis_valor: numDeep(blocoPIS, "vPIS"),
    // COFINS
    cofins_cst: pickDeep(blocoCOFINS, "CST"),
    cofins_base: numDeep(blocoCOFINS, "vBC"),
    cofins_percentual: numDeep(blocoCOFINS, "pCOFINS"),
    cofins_valor: numDeep(blocoCOFINS, "vCOFINS"),
    // IPI (pode ser IPINT = não tributado, sem base/valor)
    ipi_cst: pickDeep(blocoIPI, "CST"),
    ipi_base: numDeep(blocoIPI, "vBC"),
    ipi_percentual: numDeep(blocoIPI, "pIPI"),
    ipi_valor: numDeep(blocoIPI, "vIPI"),
  };
}

/**
 * Parseia o XML de uma NF-e. Lança erro se a chave de acesso não tiver 44 dígitos
 * (sinal de que não é um XML de NF-e válido).
 */
export function parseNfeXml(xml: string): ParsedNfe {
  const idMatch = xml.match(/<infNFe[^>]*\bId="([^"]+)"/);
  const idRaw = idMatch ? idMatch[1] : "";
  const chave = idRaw.replace(/^NFe/, "").trim();
  if (chave.length !== 44) {
    throw new Error(`Chave de acesso inválida (esperado 44 dígitos, veio "${chave}")`);
  }
  const ide = block(xml, "ide") || "";
  const emit = block(xml, "emit") || "";
  const tot = block(xml, "ICMSTot") || "";
  const itens: any[] = [];
  const detRegex = /<det\s+nItem="(\d+)"[\s\S]*?<\/det>/g;
  let dm: RegExpExecArray | null;
  while ((dm = detRegex.exec(xml)) !== null) {
    const det = dm[0];
    const prod = block(det, "prod") || "";
    itens.push({
      numero_item: Number(dm[1]),
      codigo_produto: pick(prod, "cProd"),
      descricao: pick(prod, "xProd"),
      ncm: pick(prod, "NCM"),
      cfop: pick(prod, "CFOP"),
      unidade: pick(prod, "uCom"),
      quantidade: num(prod, "qCom"),
      valor_unitario: num(prod, "vUnCom"),
      valor_total: num(prod, "vProd"),
      pedido_xml: pick(prod, "xPed"),
      item_pedido_xml: pick(prod, "nItemPed"),
      // ── Etapa B (C1): impostos do item, do bloco <imposto> ──
      imposto: parseItemImposto(det),
    });
  }
  return {
    chave_acesso: chave,
    numero: pick(ide, "nNF"),
    serie: pick(ide, "serie"),
    modelo: pick(ide, "mod"),
    natureza_operacao: pick(ide, "natOp"),
    data_emissao: pick(ide, "dhEmi"),
    emitente_cnpj: pick(emit, "CNPJ"),
    emitente_nome: pick(emit, "xNome"),
    valor_produtos: num(tot, "vProd"),
    valor_frete: num(tot, "vFrete"),
    valor_seguro: num(tot, "vSeg"),
    valor_desconto: num(tot, "vDesc"),
    valor_outras_despesas: num(tot, "vOutro"),
    base_calculo_icms: num(tot, "vBC"),
    valor_icms: num(tot, "vICMS"),
    base_icms_st: num(tot, "vBCST"),
    valor_icms_st: num(tot, "vST"),
    valor_ipi: num(tot, "vIPI"),
    valor_ii: num(tot, "vII"),
    valor_pis: num(tot, "vPIS"),
    valor_cofins: num(tot, "vCOFINS"),
    valor_fcp: num(tot, "vFCP"),
    valor_total: num(tot, "vNF"),
    itens,
  };
}
