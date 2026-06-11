// src/services/parseNfeXml.ts
//
// Parser de XML de NF-e (modelo 55) no front-end. Mesma lógica da Edge Function
// receber-nfe, para o upload manual. Retorna os campos prontos para inserir em
// compras_nfe + os itens para dados_extraidos.

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
