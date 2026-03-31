import { supabase } from "@/integrations/supabase/client";

interface DecodedDoc {
  NSU: number;
  ChaveAcesso: string;
  TipoDocumento: string;
  TipoEvento: string | null;
  DataHoraGeracao: string;
  xml: string;
}

export interface ParsedNfse {
  chaveAcesso: string;
  numero: string | null;
  prestadorCnpj: string | null;
  prestadorCpf: string | null;
  prestadorNome: string | null;
  prestadorInscricaoMunicipal: string | null;
  prestadorMunicipioCodigo: string | null;
  prestadorMunicipioNome: string | null;
  prestadorUf: string | null;
  tomadorCnpj: string | null;
  tomadorCpf: string | null;
  tomadorNome: string | null;
  valorServico: number | null;
  valorLiquido: number | null;
  valorDeducoes: number | null;
  valorDescontoCondicionado: number | null;
  valorDescontoIncondicionado: number | null;
  baseCalculoIss: number | null;
  aliquotaIss: number | null;
  valorIss: number | null;
  issRetido: boolean | null;
  valorIssRetido: number | null;
  valorPis: number | null;
  valorCofins: number | null;
  valorInss: number | null;
  valorIrrf: number | null;
  valorCsll: number | null;
  valorTotalRetencoes: number | null;
  codigoServico: string | null;
  cnae: string | null;
  descricaoServico: string | null;
  dataEmissao: string | null;
  dataCompetencia: string | null;
  municipioIncidenciaCodigo: string | null;
  municipioIncidenciaNome: string | null;
  naturezaTributacao: string | null;
}

// Helper: get direct text of a child tag (not nested descendants' concatenated text)
const getDirectChildText = (parent: Element | null, tagName: string): string | null => {
  if (!parent) return null;
  const el = parent.getElementsByTagName(tagName)[0];
  if (!el) return null;
  // If the element has child elements, get only direct text nodes to avoid concatenation
  if (el.children.length > 0) {
    const textNodes = Array.from(el.childNodes).filter(n => n.nodeType === 3);
    const text = textNodes.map(n => n.textContent?.trim()).filter(Boolean).join("");
    return text || null;
  }
  return el.textContent?.trim() || null;
};

const getLeafText = (parent: Element | null, tagName: string): string | null => {
  if (!parent) return null;
  const el = parent.getElementsByTagName(tagName)[0];
  return el?.textContent?.trim() || null;
};

const getLeafFloat = (parent: Element | null, tagName: string): number | null => {
  const val = getLeafText(parent, tagName);
  if (!val) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
};

export function parseNfseXml(xmlString: string, chaveAcessoFallback: string): ParsedNfse {
  const result: ParsedNfse = {
    chaveAcesso: chaveAcessoFallback,
    numero: null, prestadorCnpj: null, prestadorCpf: null, prestadorNome: null,
    prestadorInscricaoMunicipal: null, prestadorMunicipioCodigo: null, prestadorMunicipioNome: null,
    prestadorUf: null, tomadorCnpj: null, tomadorCpf: null, tomadorNome: null,
    valorServico: null, valorLiquido: null, valorDeducoes: null,
    valorDescontoCondicionado: null, valorDescontoIncondicionado: null,
    baseCalculoIss: null, aliquotaIss: null, valorIss: null, issRetido: null,
    valorIssRetido: null, valorPis: null, valorCofins: null, valorInss: null,
    valorIrrf: null, valorCsll: null, valorTotalRetencoes: null,
    codigoServico: null, cnae: null, descricaoServico: null,
    dataEmissao: null, dataCompetencia: null,
    municipioIncidenciaCodigo: null, municipioIncidenciaNome: null, naturezaTributacao: null,
  };

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");

    const infNFSe = doc.getElementsByTagName("infNFSe")[0] || null;

    // === Nível infNFSe (fora do DPS) ===
    result.numero = getLeafText(infNFSe, "nNFSe");
    result.municipioIncidenciaCodigo = getLeafText(infNFSe, "cLocIncid");
    result.municipioIncidenciaNome = getLeafText(infNFSe, "xLocIncid");

    // Valores calculados — filho direto de infNFSe, NÃO o que está dentro do DPS
    const valoresNFSe = infNFSe
      ? Array.from(infNFSe.children).find(el => el.tagName === "valores") || null
      : null;
    if (valoresNFSe) {
      result.baseCalculoIss = getLeafFloat(valoresNFSe as Element, "vBC");
      result.aliquotaIss = getLeafFloat(valoresNFSe as Element, "pAliqAplic");
      result.valorIss = getLeafFloat(valoresNFSe as Element, "vISSQN");
      result.valorTotalRetencoes = getLeafFloat(valoresNFSe as Element, "vTotalRet");
      result.valorLiquido = getLeafFloat(valoresNFSe as Element, "vLiq");
    }

    // === Emitente (prestador) — infNFSe > emit ===
    const emit = infNFSe?.getElementsByTagName("emit")[0] || null;
    result.prestadorCnpj = getLeafText(emit, "CNPJ");
    result.prestadorNome = getLeafText(emit, "xNome");
    result.prestadorInscricaoMunicipal = getLeafText(emit, "IM");
    const enderNac = emit?.getElementsByTagName("enderNac")[0] || null;
    result.prestadorMunicipioCodigo = getLeafText(enderNac, "cMun");
    result.prestadorUf = getLeafText(enderNac, "UF");

    // === DPS / infDPS ===
    const infDPS = doc.getElementsByTagName("infDPS")[0] || null;

    // Fallback número
    if (!result.numero) result.numero = getLeafText(infDPS, "nDPS");

    result.dataEmissao = getLeafText(infDPS, "dhEmi");
    result.dataCompetencia = getLeafText(infDPS, "dCompet");

    // Série
    // serie is a field on ParsedNfse? No, but we can store it via the import. For now, skip in parsed.

    // Prestador fallback via prest (dentro do DPS)
    const prest = infDPS?.getElementsByTagName("prest")[0] || null;
    if (!result.prestadorCnpj) result.prestadorCnpj = getLeafText(prest, "CNPJ");
    result.prestadorCpf = getLeafText(prest, "CPF");

    // Tomador via toma
    const toma = infDPS?.getElementsByTagName("toma")[0] || null;
    result.tomadorCnpj = getLeafText(toma, "CNPJ");
    result.tomadorCpf = getLeafText(toma, "CPF");
    result.tomadorNome = getLeafText(toma, "xNome");

    // Serviço — cServ children individually (fix concatenation bug)
    const cServ = infDPS?.getElementsByTagName("cServ")[0] || null;
    result.codigoServico = getLeafText(cServ, "cTribNac");
    result.descricaoServico = getLeafText(cServ, "xDescServ");
    result.cnae = getLeafText(cServ, "CNAE") || getLeafText(infDPS, "CNAE");

    // Valores do DPS (dentro de infDPS > valores)
    const valoresDPS = infDPS?.getElementsByTagName("valores")[0] || null;
    const vServPrest = valoresDPS?.getElementsByTagName("vServPrest")[0] || null;
    result.valorServico = getLeafFloat(vServPrest, "vServ") || getLeafFloat(valoresDPS, "vServ");

    const vDescCondIncond = valoresDPS?.getElementsByTagName("vDescCondIncond")[0] || null;
    result.valorDescontoIncondicionado = getLeafFloat(vDescCondIncond, "vDescIncond");
    result.valorDescontoCondicionado = getLeafFloat(vDescCondIncond, "vDescCond");

    const vDedRed = valoresDPS?.getElementsByTagName("vDedRed")[0] || null;
    result.valorDeducoes = getLeafFloat(vDedRed, "vDR");

    // Tributos do DPS
    const trib = valoresDPS?.getElementsByTagName("trib")[0] || null;
    const tribMun = trib?.getElementsByTagName("tribMun")[0] || null;
    const tribFed = trib?.getElementsByTagName("tribFed")[0] || null;

    // ISS retido — tpRetISSQN: 2 = retido
    const tpRet = getLeafText(tribMun, "tpRetISSQN");
    if (tpRet) {
      result.issRetido = tpRet === "2";
      if (result.issRetido && result.valorIss != null) {
        result.valorIssRetido = result.valorIss;
      }
    }

    // Fallback alíquota ISS from tribMun if not found in valoresNFSe
    if (result.aliquotaIss == null) {
      result.aliquotaIss = getLeafFloat(tribMun, "pAliq");
    }

    // Natureza da tributação
    result.naturezaTributacao = getLeafText(tribMun, "tribISSQN");

    // Tributos federais
    const piscofins = tribFed?.getElementsByTagName("piscofins")[0] || null;
    result.valorPis = getLeafFloat(piscofins, "vPis");
    result.valorCofins = getLeafFloat(piscofins, "vCofins");
    result.valorInss = getLeafFloat(tribFed, "vRetCP");
    result.valorIrrf = getLeafFloat(tribFed, "vRetIRRF");
    result.valorCsll = getLeafFloat(tribFed, "vRetCSLL");

    // Fallback prestador nome from global xNome if still null
    if (!result.prestadorNome) {
      const globalXNome = doc.getElementsByTagName("xNome")[0];
      result.prestadorNome = globalXNome?.textContent?.trim() || null;
    }
  } catch (err) {
    console.warn("Erro ao parsear XML NFS-e:", err);
  }

  return result;
}

export async function importarNfsesDoSefaz(documentos: DecodedDoc[]) {
  const result = { total: documentos.length, importadas: 0, duplicadas: 0, erros: [] as string[] };
  if (documentos.length === 0) return result;

  // Check existing
  const chaves = documentos.map(d => d.ChaveAcesso).filter(Boolean);
  let existingSet = new Set<string>();
  if (chaves.length > 0) {
    const { data } = await supabase.from("compras_nfse").select("chave_acesso").in("chave_acesso", chaves);
    existingSet = new Set((data || []).map(r => r.chave_acesso));
  }

  for (const doc of documentos) {
    try {
      if (existingSet.has(doc.ChaveAcesso)) {
        result.duplicadas++;
        continue;
      }

      const isEvento = doc.TipoDocumento === "EVENTO";
      const isCancelamento = isEvento && doc.TipoEvento === "CANCELAMENTO";

      // If cancellation event, update existing record
      if (isCancelamento) {
        await supabase.from("compras_nfse").update({ situacao: "cancelada", updated_at: new Date().toISOString() }).eq("chave_acesso", doc.ChaveAcesso);
      }

      const parsed = parseNfseXml(doc.xml || "", doc.ChaveAcesso);

      const { error } = await supabase.from("compras_nfse").insert({
        chave_acesso: doc.ChaveAcesso,
        nsu: doc.NSU,
        tipo_documento: doc.TipoDocumento,
        tipo_evento: doc.TipoEvento || null,
        data_emissao: parsed.dataEmissao || doc.DataHoraGeracao || null,
        numero: parsed.numero,
        prestador_cnpj: parsed.prestadorCnpj,
        prestador_cpf: parsed.prestadorCpf,
        prestador_nome: parsed.prestadorNome,
        prestador_inscricao_municipal: parsed.prestadorInscricaoMunicipal,
        prestador_municipio_codigo: parsed.prestadorMunicipioCodigo,
        prestador_municipio_nome: parsed.prestadorMunicipioNome,
        prestador_uf: parsed.prestadorUf,
        tomador_cnpj: parsed.tomadorCnpj,
        tomador_cpf: parsed.tomadorCpf,
        tomador_nome: parsed.tomadorNome,
        valor_servico: parsed.valorServico,
        valor_liquido: parsed.valorLiquido,
        valor_deducoes: parsed.valorDeducoes,
        valor_desconto_condicionado: parsed.valorDescontoCondicionado,
        valor_desconto_incondicionado: parsed.valorDescontoIncondicionado,
        base_calculo_iss: parsed.baseCalculoIss,
        aliquota_iss: parsed.aliquotaIss,
        valor_iss: parsed.valorIss,
        iss_retido: parsed.issRetido,
        valor_iss_retido: parsed.valorIssRetido,
        valor_pis: parsed.valorPis,
        valor_cofins: parsed.valorCofins,
        valor_retencao_inss: parsed.valorInss,
        valor_retencao_irrf: parsed.valorIrrf,
        valor_retencao_csll: parsed.valorCsll,
        valor_total_retencoes: parsed.valorTotalRetencoes,
        codigo_servico: parsed.codigoServico,
        cnae: parsed.cnae,
        descricao_servico: parsed.descricaoServico,
        data_competencia: parsed.dataCompetencia,
        municipio_incidencia_codigo: parsed.municipioIncidenciaCodigo,
        municipio_incidencia_nome: parsed.municipioIncidenciaNome,
        natureza_tributacao: parsed.naturezaTributacao,
        raw_xml: doc.xml || null,
        raw_json: null,
        situacao: isCancelamento ? "cancelada" : "normal",
        imported_at: new Date().toISOString(),
      });

      if (error) {
        result.erros.push(`NSU ${doc.NSU}: ${error.message}`);
      } else {
        result.importadas++;
      }
    } catch (err: any) {
      result.erros.push(`NSU ${doc.NSU}: ${err.message}`);
    }
  }

  return result;
}
