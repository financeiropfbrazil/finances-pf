import { supabase } from "@/integrations/supabase/client";

interface SefazDoc {
  json: any;
  xml: string;
  nsu: string;
  schema: string;
}

interface ImportResult {
  total: number;
  importadas: number;
  duplicadas: number;
  erros: string[];
}

function toFloat(v: any): number | null {
  if (v == null) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function toInt(v: any): number | null {
  if (v == null) return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function situacaoToText(code: any): string | null {
  const c = parseInt(code, 10);
  if (c === 1) return "autorizada";
  if (c === 2) return "denegada";
  if (c === 3) return "cancelada";
  return null;
}

function extractIcmsValue(icmsObj: any): number | null {
  if (!icmsObj) return null;
  // ICMS can be in any sub-object like ICMS00, ICMS10, ICMS20, etc.
  for (const key of Object.keys(icmsObj)) {
    const sub = icmsObj[key];
    if (sub?.vICMS != null) return toFloat(sub.vICMS);
  }
  return null;
}

function extractFromResNFe(doc: SefazDoc) {
  const r = doc.json?.resNFe;
  if (!r) return null;
  const chaveAcesso = r.chNFe || "";
  if (!chaveAcesso) return null;

  return {
    header: {
      chave_acesso: chaveAcesso,
      numero: r.nNF || null,
      serie: null as string | null,
      data_emissao: r.dhEmi || null,
      fornecedor_cnpj: r.CNPJ || null,
      fornecedor_nome: r.xNome || null,
      fornecedor_ie: null as string | null,
      fornecedor_uf: null as string | null,
      valor_total: toFloat(r.vNF),
      valor_produtos: null as number | null,
      valor_frete: null as number | null,
      valor_desconto: null as number | null,
      valor_icms: null as number | null,
      valor_ipi: null as number | null,
      valor_pis: null as number | null,
      valor_cofins: null as number | null,
      tipo_operacao: r.tpNF || null,
      situacao: situacaoToText(r.cSitNFe),
      nsu: doc.nsu,
      schema_type: "resNFe",
      raw_json: doc.json,
      raw_xml: doc.xml,
    },
    itens: [] as any[],
  };
}

function extractFromProcNFe(doc: SefazDoc) {
  const nfeProc = doc.json?.nfeProc;
  const infNFe = nfeProc?.NFe?.infNFe;
  if (!infNFe) return null;

  let chaveAcesso = nfeProc?.protNFe?.infProt?.chNFe || "";
  if (!chaveAcesso) {
    // Try from infNFe Id attribute
    const id = infNFe?.["@_Id"] || infNFe?.Id || "";
    chaveAcesso = id.replace(/^NFe/, "");
  }
  if (!chaveAcesso) return null;

  const ide = infNFe.ide || {};
  const emit = infNFe.emit || {};
  const tot = infNFe.total?.ICMSTot || {};

  const header = {
    chave_acesso: chaveAcesso,
    numero: ide.nNF || null,
    serie: ide.serie || null,
    data_emissao: ide.dhEmi || null,
    fornecedor_cnpj: emit.CNPJ || null,
    fornecedor_nome: emit.xNome || null,
    fornecedor_ie: emit.IE || null,
    fornecedor_uf: emit.enderEmit?.UF || null,
    valor_total: toFloat(tot.vNF),
    valor_produtos: toFloat(tot.vProd),
    valor_frete: toFloat(tot.vFrete),
    valor_desconto: toFloat(tot.vDesc),
    valor_icms: toFloat(tot.vICMS),
    valor_ipi: toFloat(tot.vIPI),
    valor_pis: toFloat(tot.vPIS),
    valor_cofins: toFloat(tot.vCOFINS),
    tipo_operacao: ide.tpNF || null,
    situacao: "autorizada",
    nsu: doc.nsu,
    schema_type: "procNFe",
    raw_json: doc.json,
    raw_xml: doc.xml,
  };

  // Extract items
  let detRaw = infNFe.det;
  if (!detRaw) return { header, itens: [] };
  if (!Array.isArray(detRaw)) detRaw = [detRaw];

  const itens = detRaw.map((d: any) => {
    const prod = d.prod || {};
    const imposto = d.imposto || {};
    return {
      numero_item: toInt(d["@_nItem"] || d.nItem || prod.nItem),
      codigo_produto: prod.cProd || null,
      descricao: prod.xProd || null,
      ncm: prod.NCM || null,
      cfop: prod.CFOP || null,
      unidade: prod.uCom || null,
      quantidade: toFloat(prod.qCom),
      valor_unitario: toFloat(prod.vUnCom),
      valor_total: toFloat(prod.vProd),
      valor_desconto: toFloat(prod.vDesc),
      valor_icms: extractIcmsValue(imposto.ICMS),
      valor_ipi: toFloat(imposto.IPI?.IPITrib?.vIPI),
      valor_pis: toFloat(imposto.PIS?.PISAliq?.vPIS ?? imposto.PIS?.PISOutr?.vPIS),
      valor_cofins: toFloat(imposto.COFINS?.COFINSAliq?.vCOFINS ?? imposto.COFINS?.COFINSOutr?.vCOFINS),
    };
  });

  return { header, itens };
}

export async function importarNfesDoSefaz(documentos: SefazDoc[]): Promise<ImportResult> {
  const result: ImportResult = { total: documentos.length, importadas: 0, duplicadas: 0, erros: [] };

  // Pre-check existing chaves in batch
  const allChaves: string[] = [];
  const parsedDocs: { chave: string; header: any; itens: any[] }[] = [];

  for (const doc of documentos) {
    const isResNFe = doc.schema?.includes("resNFe");
    const isProcNFe = doc.schema?.includes("procNFe");
    let extracted: { header: any; itens: any[] } | null = null;

    if (isResNFe) extracted = extractFromResNFe(doc);
    else if (isProcNFe) extracted = extractFromProcNFe(doc);

    if (!extracted) {
      result.erros.push(`NSU ${doc.nsu}: schema não suportado (${doc.schema})`);
      continue;
    }

    allChaves.push(extracted.header.chave_acesso);
    parsedDocs.push({ chave: extracted.header.chave_acesso, header: extracted.header, itens: extracted.itens });
  }

  // Batch check existence
  const existingSet = new Set<string>();
  if (allChaves.length > 0) {
    // Query in batches of 50
    for (let i = 0; i < allChaves.length; i += 50) {
      const batch = allChaves.slice(i, i + 50);
      const { data: existing } = await supabase
        .from("compras_nfe")
        .select("chave_acesso")
        .in("chave_acesso", batch);
      (existing || []).forEach((e) => existingSet.add(e.chave_acesso));
    }
  }

  // Import each doc individually
  for (const { chave, header, itens } of parsedDocs) {
    if (existingSet.has(chave)) {
      result.duplicadas++;
      continue;
    }

    try {
      const { data: inserted, error: insertError } = await supabase
        .from("compras_nfe")
        .insert({
          chave_acesso: header.chave_acesso,
          numero: header.numero,
          serie: header.serie,
          data_emissao: header.data_emissao,
          fornecedor_cnpj: header.fornecedor_cnpj,
          fornecedor_nome: header.fornecedor_nome,
          fornecedor_ie: header.fornecedor_ie,
          fornecedor_uf: header.fornecedor_uf,
          valor_total: header.valor_total,
          valor_produtos: header.valor_produtos,
          valor_frete: header.valor_frete,
          valor_desconto: header.valor_desconto,
          valor_icms: header.valor_icms,
          valor_ipi: header.valor_ipi,
          valor_pis: header.valor_pis,
          valor_cofins: header.valor_cofins,
          tipo_operacao: header.tipo_operacao,
          situacao: header.situacao,
          nsu: header.nsu,
          schema_type: header.schema_type,
          raw_json: header.raw_json,
          raw_xml: header.raw_xml,
          imported_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (insertError) {
        result.erros.push(`NSU ${header.nsu}: ${insertError.message}`);
        continue;
      }

      // Insert items if any
      if (itens.length > 0 && inserted?.id) {
        const itensPayload = itens.map((item) => ({
          compras_nfe_id: inserted.id,
          ...item,
        }));

        const { error: itensError } = await supabase
          .from("compras_nfe_itens")
          .insert(itensPayload);

        if (itensError) {
          result.erros.push(`NSU ${header.nsu} (itens): ${itensError.message}`);
        }
      }

      result.importadas++;
    } catch (err: any) {
      result.erros.push(`NSU ${header.nsu}: ${err.message}`);
    }
  }

  return result;
}
