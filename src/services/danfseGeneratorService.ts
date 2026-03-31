import jsPDF from "jspdf";

// ── Helpers ──

const matchesTag = (element: Element, tag: string): boolean => (
  element.localName === tag ||
  element.tagName === tag ||
  element.tagName.endsWith(`:${tag}`)
);

const parseXml = (xml: string): Document | null => {
  try {
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    return parsed.getElementsByTagName("parsererror").length ? null : parsed;
  } catch {
    return null;
  }
};

const findFirst = (node: Document | Element | null, tag: string): Element | null => {
  if (!node) return null;
  return Array.from(node.getElementsByTagName("*")).find((element) => matchesTag(element, tag)) ?? null;
};

const findDirect = (node: Element | null, tag: string): Element | null => {
  if (!node) return null;
  return Array.from(node.children).find((element) => matchesTag(element, tag)) ?? null;
};

const textOf = (node: Document | Element | null, tag?: string): string | null => {
  const target = tag ? findFirst(node, tag) : node;
  const value = target?.textContent?.trim();
  return value ? value : null;
};

const attrOf = (node: Element | null, attr: string): string | null => {
  const value = node?.getAttribute(attr)?.trim();
  return value ? value : null;
};

const toNum = (value: string | null | undefined): number => {
  const parsed = Number.parseFloat((value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCnpj = (c: string | null): string => {
  if (!c) return "N/D";
  const d = c.replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return c;
};

const formatCEP = (c: string | null): string => {
  if (!c) return "";
  const d = c.replace(/\D/g, "");
  if (d.length === 8) return d.replace(/^(\d{5})(\d{3})$/, "$1-$2");
  return c;
};

const fmtVal = (v: string | null): string => {
  if (!v) return "0,00";
  const n = toNum(v);
  if (Number.isNaN(n)) return "0,00";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (d: string | null): string => {
  if (!d) return "N/D";
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString("pt-BR");
  } catch {
    return d;
  }
};

// ── Main ──

export function gerarDanfsePdf(rawXml: string, filename?: string): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = 210;
  const ml = 10;
  const mr = 10;
  const cw = pw - ml - mr; // content width
  let y = 10;

  // ── Parse XML ──
  const xmlDoc = parseXml(rawXml);
  const infNFSe = findFirst(xmlDoc, "infNFSe");
  const dpsBlock = findDirect(infNFSe, "DPS") ?? findFirst(infNFSe, "DPS");
  const infDPS = findDirect(dpsBlock, "infDPS") ?? findFirst(dpsBlock, "infDPS");

  // Chave de acesso
  const idAttr = attrOf(infNFSe, "Id") || "";
  const chaveAcesso = idAttr.replace(/^NFS/i, "") || "";

  const nNFSe = textOf(infNFSe, "nNFSe");
  const xLocEmi = textOf(infNFSe, "xLocEmi");
  const xLocIncid = textOf(infNFSe, "xLocIncid");
  const dhProc = textOf(infNFSe, "dhProc");

  // Valores nível infNFSe (fora do DPS)
  const valoresNFSe = findDirect(infNFSe, "valores");
  const vBCInf = textOf(valoresNFSe, "vBC");
  const pAliqAplicInf = textOf(valoresNFSe, "pAliqAplic");
  const vISSQNInf = textOf(valoresNFSe, "vISSQN");
  const vTotalRetInf = textOf(valoresNFSe, "vTotalRet");
  const vLiqInf = textOf(valoresNFSe, "vLiq");

  // Emit (prestador)
  const emitBlock = findDirect(infNFSe, "emit") ?? findFirst(infNFSe, "emit");
  const emitCnpj = textOf(emitBlock, "CNPJ");
  const emitIM = textOf(emitBlock, "IM");
  const emitNome = textOf(emitBlock, "xNome");
  const emitFant = textOf(emitBlock, "xFant");
  const emitEnderNac = findDirect(emitBlock, "enderNac") ?? findFirst(emitBlock, "enderNac") ?? findFirst(emitBlock, "endNac");
  const emitLgr = textOf(emitEnderNac, "xLgr") || "";
  const emitNro = textOf(emitEnderNac, "nro") || "";
  const emitCpl = textOf(emitEnderNac, "xCpl") || "";
  const emitBairro = textOf(emitEnderNac, "xBairro") || "";
  const emitUF = textOf(emitEnderNac, "UF") || "";
  const emitCEP = textOf(emitEnderNac, "CEP");
  const emitMun = textOf(emitEnderNac, "xMun") || textOf(emitEnderNac, "cMun") || xLocEmi || "";
  const emitEndereco = [emitLgr, emitNro, emitCpl, emitBairro].filter(Boolean).join(", ");

  // Toma (tomador)
  const tomaBlock = findDirect(infDPS, "toma") ?? findFirst(infDPS, "toma");
  const tomaCnpj = textOf(tomaBlock, "CNPJ") || textOf(tomaBlock, "CPF");
  const tomaNome = textOf(tomaBlock, "xNome");
  const tomaEndBlock = findDirect(tomaBlock, "end") ?? findFirst(tomaBlock, "end");
  const tomaEnderNac = findDirect(tomaEndBlock, "endNac") ?? findFirst(tomaEndBlock, "endNac") ?? findFirst(tomaBlock, "enderNac");
  const tomaLgr = textOf(tomaEndBlock, "xLgr") || textOf(tomaEnderNac, "xLgr") || "";
  const tomaNro = textOf(tomaEndBlock, "nro") || textOf(tomaEnderNac, "nro") || "";
  const tomaCpl = textOf(tomaEndBlock, "xCpl") || textOf(tomaEnderNac, "xCpl") || "";
  const tomaBairro = textOf(tomaEndBlock, "xBairro") || textOf(tomaEnderNac, "xBairro") || "";
  const tomaUF = textOf(tomaEnderNac, "UF") || "";
  const tomaEmail = textOf(tomaBlock, "email");
  const tomaEndereco = [tomaLgr, tomaNro, tomaCpl, tomaBairro].filter(Boolean).join(", ");

  // Serviço
  const servBlock = findDirect(infDPS, "serv") ?? findFirst(infDPS, "serv");
  const cServBlock = findDirect(servBlock, "cServ") ?? findFirst(servBlock, "cServ");
  const cTribNac = textOf(cServBlock, "cTribNac");
  const xDescServ = textOf(cServBlock, "xDescServ");

  // DPS dates
  const dhEmi = textOf(infDPS, "dhEmi") || dhProc;
  const dCompet = textOf(infDPS, "dCompet");

  // Valores DPS
  const valoresDPSBlock = findDirect(infDPS, "valores") ?? findFirst(infDPS, "valores");
  const vServPrestBlock = findDirect(valoresDPSBlock, "vServPrest") ?? findFirst(valoresDPSBlock, "vServPrest");
  const vServ = textOf(vServPrestBlock, "vServ") ?? textOf(valoresDPSBlock, "vServ") ?? vLiqInf ?? "0.00";
  const vDescCondIncondBlock = findDirect(valoresDPSBlock, "vDescCondIncond") ?? findFirst(valoresDPSBlock, "vDescCondIncond");
  const vDescIncond = textOf(vDescCondIncondBlock, "vDescIncond") ?? "0.00";
  const vDescCond = textOf(vDescCondIncondBlock, "vDescCond") ?? "0.00";
  const vDedRedBlock = findDirect(valoresDPSBlock, "vDedRed") ?? findFirst(valoresDPSBlock, "vDedRed");
  const vDR = textOf(vDedRedBlock, "vDR") ?? "0.00";

  // Tributos
  const tribBlock = findDirect(valoresDPSBlock, "trib") ?? findFirst(valoresDPSBlock, "trib");
  const tribFedBlock = findDirect(tribBlock, "tribFed") ?? findFirst(tribBlock, "tribFed");
  const piscofinsBlock = findDirect(tribFedBlock, "piscofins") ?? findFirst(tribFedBlock, "piscofins");
  const vPis = textOf(piscofinsBlock, "vPis") ?? textOf(tribFedBlock, "vPis") ?? "0.00";
  const vCofins = textOf(piscofinsBlock, "vCofins") ?? textOf(tribFedBlock, "vCofins") ?? "0.00";
  const vRetIRRF = textOf(tribFedBlock, "vRetIRRF") ?? "0.00";
  const vRetCSLL = textOf(tribFedBlock, "vRetCSLL") ?? "0.00";
  const vRetCP = textOf(tribFedBlock, "vRetCP") ?? "0.00";

  const tribMunBlock = findDirect(tribBlock, "tribMun") ?? findFirst(tribBlock, "tribMun");
  const pAliq = textOf(tribMunBlock, "pAliq");
  const tpRetISSQN = textOf(tribMunBlock, "tpRetISSQN");

  const vBC = vBCInf ?? textOf(valoresDPSBlock, "vBC") ?? vServ;
  const pAliqAplic = pAliqAplicInf ?? pAliq;
  const vISSQN = vISSQNInf ?? textOf(tribMunBlock, "vISSQN") ?? "0.00";
  const vTotalRet = vTotalRetInf ?? String((toNum(vPis) + toNum(vCofins) + toNum(vRetIRRF) + toNum(vRetCSLL) + toNum(vRetCP)).toFixed(2));
  const vLiq = (() => {
    if (toNum(vLiqInf) > 0) return vLiqInf as string;
    const calculado = toNum(vServ) - toNum(vDR) - toNum(vDescIncond) - toNum(vDescCond) - toNum(vTotalRet);
    if (calculado > 0) return calculado.toFixed(2);
    return vServ;
  })();

  // ── Draw PDF ──

  // ── Draw PDF ──

  const DARK_BLUE: [number, number, number] = [30, 58, 95];
  const LIGHT_GRAY: [number, number, number] = [240, 240, 240];
  const WHITE: [number, number, number] = [255, 255, 255];

  const drawBox = (x: number, yPos: number, w: number, h: number, fill?: [number, number, number]) => {
    if (fill) {
      doc.setFillColor(...fill);
      doc.rect(x, yPos, w, h, "F");
    }
    doc.setDrawColor(180, 180, 180);
    doc.rect(x, yPos, w, h, "S");
  };

  const drawLabel = (label: string, value: string, x: number, yPos: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text(label, x, yPos);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    doc.text(value || "N/D", x, yPos + 4);
  };

  const drawSectionTitle = (title: string, yPos: number): number => {
    drawBox(ml, yPos, cw, 7, LIGHT_GRAY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(30, 58, 95);
    doc.text(title, ml + 3, yPos + 5);
    return yPos + 9;
  };

  const checkPage = (needed: number) => {
    if (y + needed > 280) {
      doc.addPage();
      y = 10;
    }
  };

  // ═══ HEADER ═══
  drawBox(ml, y, cw, 18, DARK_BLUE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...WHITE);
  doc.text("DANFSE - Documento Auxiliar da NFS-e", pw / 2, y + 8, { align: "center" });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Nota Fiscal de Serviço Eletrônica - Padrão Nacional", pw / 2, y + 14, { align: "center" });
  y += 21;

  // ═══ BLOCO 1 — Identificação ═══
  checkPage(20);
  drawBox(ml, y, cw, 16);
  const col1 = ml + 3;
  const col2 = ml + 45;
  const col3 = ml + 100;
  const col4 = ml + 145;
  drawLabel("Nº NFS-e", nNFSe || "N/D", col1, y + 3);
  drawLabel("Data Emissão", fmtDate(dhEmi), col2, y + 3);
  drawLabel("Competência", fmtDate(dCompet), col3, y + 3);
  drawLabel("Local Incidência", xLocIncid || "N/D", col4, y + 3);
  y += 19;

  // ═══ BLOCO 2 — Prestador ═══
  checkPage(30);
  y = drawSectionTitle("PRESTADOR DE SERVIÇOS", y);
  drawBox(ml, y, cw, 20);
  drawLabel("CNPJ", formatCnpj(emitCnpj), col1, y + 3);
  drawLabel("Inscrição Municipal", emitIM || "—", col2, y + 3);
  const emitNomeText = (emitNome || emitFant || "N/D").substring(0, 65);
  const emitNomeLines = doc.splitTextToSize(emitNomeText, cw - (col3 - ml) - 3);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  doc.text(emitNomeLines, col3, y + 7);
  drawLabel("Endereço", (emitEndereco || "N/D").substring(0, 80), col1, y + 11);
  const munUfCep = [emitMun, emitUF, formatCEP(emitCEP)].filter(Boolean).join(" - ");
  drawLabel("Município/UF/CEP", munUfCep || "N/D", col3, y + 11);
  y += 23;

  // ═══ BLOCO 3 — Tomador ═══
  checkPage(30);
  y = drawSectionTitle("TOMADOR DE SERVIÇOS", y);
  drawBox(ml, y, cw, 20);
  drawLabel("CNPJ", formatCnpj(tomaCnpj), col1, y + 3);
  const tomaNomeText = (tomaNome || "N/D").substring(0, 65);
  const tomaNomeLines = doc.splitTextToSize(tomaNomeText, cw - (col3 - ml) - 3);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  doc.text(tomaNomeLines, col3, y + 7);
  drawLabel("Endereço", (tomaEndereco || "N/D").substring(0, 80), col1, y + 11);
  if (tomaEmail) {
    drawLabel("E-mail", tomaEmail.substring(0, 45), col3, y + 11);
  }
  y += 23;

  // ═══ BLOCO 4 — Serviço ═══
  checkPage(30);
  y = drawSectionTitle("DISCRIMINAÇÃO DO SERVIÇO", y);
  const servCode = cTribNac ? `Código: ${cTribNac}` : "";
  const descText = xDescServ || "N/D";
  const descLines = doc.splitTextToSize(descText, cw - 6);
  const descHeight = Math.max(descLines.length * 4 + 10, 16);
  drawBox(ml, y, cw, descHeight);
  if (servCode) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text(servCode, col1, y + 4);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(30, 30, 30);
  doc.text(descLines, col1, y + (servCode ? 9 : 5));
  y += descHeight + 3;

  // ═══ BLOCO 5 — Valores ═══
  checkPage(45);
  y = drawSectionTitle("VALORES E TRIBUTOS", y);

  // Linha 1: Serviço, Deduções, Desc, Base Cálculo, Alíquota, ISS
  const valColW = cw / 6;
  drawBox(ml, y, cw, 14);
  const valLabels1 = ["Valor Serviços", "Deduções", "Desc. Incond.", "Base Cálculo", "Alíquota ISS", "Valor ISS"];
  const valValues1 = [fmtVal(vServ), fmtVal(vDR), fmtVal(vDescIncond), fmtVal(vBC), pAliqAplic ? `${fmtVal(pAliqAplic)}%` : (pAliq ? `${fmtVal(pAliq)}%` : "N/D"), fmtVal(vISSQN)];
  for (let i = 0; i < 6; i++) {
    drawLabel(valLabels1[i], valValues1[i], ml + 3 + i * valColW, y + 3);
  }
  y += 16;

  // Linha 2: PIS, COFINS, IRRF, CSLL, INSS, Total Retenções
  drawBox(ml, y, cw, 14);
  const valLabels2 = ["PIS", "COFINS", "IRRF", "CSLL", "INSS", "Total Retenções"];
  const valValues2 = [fmtVal(vPis), fmtVal(vCofins), fmtVal(vRetIRRF), fmtVal(vRetCSLL), fmtVal(vRetCP), fmtVal(vTotalRet)];
  for (let i = 0; i < 6; i++) {
    drawLabel(valLabels2[i], valValues2[i], ml + 3 + i * valColW, y + 3);
  }
  y += 16;

  // ISS Retido info
  const issRetido = tpRetISSQN === "2";
  if (issRetido) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(180, 50, 50);
    doc.text("ISS RETIDO PELO TOMADOR", ml + 3, y);
    y += 4;
  }

  // Valor Líquido destaque — use vLiq from infNFSe; if zero/missing, calculate from DPS values
  const valorLiquidoFinal = (parseFloat(vLiq || "0") !== 0)
    ? vLiq
    : String(
        (parseFloat(vServ || "0")) -
        (parseFloat(vDR || "0")) -
        (parseFloat(vDescIncond || "0")) -
        (parseFloat(vDescCond || "0")) -
        (parseFloat(vTotalRet || "0"))
      );
  // If calculated value is negative or zero, just show vServ as the main value
  const valorExibir = parseFloat(valorLiquidoFinal || "0") > 0 ? valorLiquidoFinal : vServ;
  drawBox(ml, y, cw, 12, DARK_BLUE);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...WHITE);
  doc.text(`VALOR LÍQUIDO: R$ ${fmtVal(valorExibir)}`, pw / 2, y + 8, { align: "center" });
  y += 15;

  // ═══ BLOCO 6 — Chave de Acesso ═══
  checkPage(18);
  y = drawSectionTitle("CHAVE DE ACESSO", y);
  drawBox(ml, y, cw, 10);
  doc.setFont("courier", "bold");
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  doc.text(chaveAcesso || "N/D", pw / 2, y + 6.5, { align: "center" });
  y += 14;

  // ═══ RODAPÉ ═══
  const footY = 282;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(140, 140, 140);
  doc.text(
    "Documento auxiliar da NFS-e gerado a partir do XML fiscal. Não substitui o documento eletrônico original.",
    pw / 2,
    footY,
    { align: "center" }
  );
  doc.text(
    `Gerado em ${new Date().toLocaleDateString("pt-BR")} pelo P&F Financial Controller`,
    pw / 2,
    footY + 4,
    { align: "center" }
  );

  // ── Save ──
  const fname = filename || `DANFSE_${nNFSe || "sem-numero"}.pdf`;
  doc.save(fname);
}

export function gerarDanfsePdfBlob(rawXml: string): Blob {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  // Reutilizar a mesma lógica de geração — chamamos gerarDanfsePdf internamente
  // mas precisamos recriar o doc para obter o blob sem salvar
  // Para evitar duplicar toda a lógica, usamos output('blob')
  
  // Parse e gerar o PDF no doc
  const pw = 210;
  const ml = 10;
  const mr = 10;
  const cw = pw - ml - mr;
  let y = 10;

  const xmlDoc = parseXml(rawXml);
  const infNFSe = findFirst(xmlDoc, "infNFSe");
  const dpsBlock = findDirect(infNFSe, "DPS") ?? findFirst(infNFSe, "DPS");
  const infDPS = findDirect(dpsBlock, "infDPS") ?? findFirst(dpsBlock, "infDPS");

  const idAttr = attrOf(infNFSe, "Id") || "";
  const chaveAcesso = idAttr.replace(/^NFS/i, "") || "";
  const nNFSe = textOf(infNFSe, "nNFSe");
  const xLocEmi = textOf(infNFSe, "xLocEmi");
  const xLocIncid = textOf(infNFSe, "xLocIncid");
  const dhProc = textOf(infNFSe, "dhProc");

  const valoresNFSe = findDirect(infNFSe, "valores");
  const vBCInf = textOf(valoresNFSe, "vBC");
  const pAliqAplicInf = textOf(valoresNFSe, "pAliqAplic");
  const vISSQNInf = textOf(valoresNFSe, "vISSQN");
  const vTotalRetInf = textOf(valoresNFSe, "vTotalRet");
  const vLiqInf = textOf(valoresNFSe, "vLiq");

  const emitBlock = findDirect(infNFSe, "emit") ?? findFirst(infNFSe, "emit");
  const emitCnpj = textOf(emitBlock, "CNPJ");
  const emitIM = textOf(emitBlock, "IM");
  const emitNome = textOf(emitBlock, "xNome");
  const emitFant = textOf(emitBlock, "xFant");
  const emitEnderNac = findDirect(emitBlock, "enderNac") ?? findFirst(emitBlock, "enderNac") ?? findFirst(emitBlock, "endNac");
  const emitLgr = textOf(emitEnderNac, "xLgr") || "";
  const emitNro = textOf(emitEnderNac, "nro") || "";
  const emitCpl = textOf(emitEnderNac, "xCpl") || "";
  const emitBairro = textOf(emitEnderNac, "xBairro") || "";
  const emitUF = textOf(emitEnderNac, "UF") || "";
  const emitCEP = textOf(emitEnderNac, "CEP");
  const emitMun = textOf(emitEnderNac, "xMun") || textOf(emitEnderNac, "cMun") || xLocEmi || "";
  const emitEndereco = [emitLgr, emitNro, emitCpl, emitBairro].filter(Boolean).join(", ");

  const tomaBlock = findDirect(infDPS, "toma") ?? findFirst(infDPS, "toma");
  const tomaCnpj = textOf(tomaBlock, "CNPJ") || textOf(tomaBlock, "CPF");
  const tomaNome = textOf(tomaBlock, "xNome");
  const tomaEndBlock = findDirect(tomaBlock, "end") ?? findFirst(tomaBlock, "end");
  const tomaEnderNac = findDirect(tomaEndBlock, "endNac") ?? findFirst(tomaEndBlock, "endNac") ?? findFirst(tomaBlock, "enderNac");
  const tomaLgr = textOf(tomaEndBlock, "xLgr") || textOf(tomaEnderNac, "xLgr") || "";
  const tomaNro = textOf(tomaEndBlock, "nro") || textOf(tomaEnderNac, "nro") || "";
  const tomaCpl = textOf(tomaEndBlock, "xCpl") || textOf(tomaEnderNac, "xCpl") || "";
  const tomaBairro = textOf(tomaEndBlock, "xBairro") || textOf(tomaEnderNac, "xBairro") || "";
  const tomaEmail = textOf(tomaBlock, "email");
  const tomaEndereco = [tomaLgr, tomaNro, tomaCpl, tomaBairro].filter(Boolean).join(", ");

  const servBlock = findDirect(infDPS, "serv") ?? findFirst(infDPS, "serv");
  const cServBlock = findDirect(servBlock, "cServ") ?? findFirst(servBlock, "cServ");
  const cTribNac = textOf(cServBlock, "cTribNac");
  const xDescServ = textOf(cServBlock, "xDescServ");

  const dhEmi = textOf(infDPS, "dhEmi") || dhProc;
  const dCompet = textOf(infDPS, "dCompet");

  const valoresDPSBlock = findDirect(infDPS, "valores") ?? findFirst(infDPS, "valores");
  const vServPrestBlock = findDirect(valoresDPSBlock, "vServPrest") ?? findFirst(valoresDPSBlock, "vServPrest");
  const vServ = textOf(vServPrestBlock, "vServ") ?? textOf(valoresDPSBlock, "vServ") ?? vLiqInf ?? "0.00";
  const vDescCondIncondBlock = findDirect(valoresDPSBlock, "vDescCondIncond") ?? findFirst(valoresDPSBlock, "vDescCondIncond");
  const vDescIncond = textOf(vDescCondIncondBlock, "vDescIncond") ?? "0.00";
  const vDescCond = textOf(vDescCondIncondBlock, "vDescCond") ?? "0.00";
  const vDedRedBlock = findDirect(valoresDPSBlock, "vDedRed") ?? findFirst(valoresDPSBlock, "vDedRed");
  const vDR = textOf(vDedRedBlock, "vDR") ?? "0.00";

  const tribBlock = findDirect(valoresDPSBlock, "trib") ?? findFirst(valoresDPSBlock, "trib");
  const tribFedBlock = findDirect(tribBlock, "tribFed") ?? findFirst(tribBlock, "tribFed");
  const piscofinsBlock = findDirect(tribFedBlock, "piscofins") ?? findFirst(tribFedBlock, "piscofins");
  const vPis = textOf(piscofinsBlock, "vPis") ?? textOf(tribFedBlock, "vPis") ?? "0.00";
  const vCofins = textOf(piscofinsBlock, "vCofins") ?? textOf(tribFedBlock, "vCofins") ?? "0.00";
  const vRetIRRF = textOf(tribFedBlock, "vRetIRRF") ?? "0.00";
  const vRetCSLL = textOf(tribFedBlock, "vRetCSLL") ?? "0.00";
  const vRetCP = textOf(tribFedBlock, "vRetCP") ?? "0.00";

  const tribMunBlock = findDirect(tribBlock, "tribMun") ?? findFirst(tribBlock, "tribMun");
  const pAliq = textOf(tribMunBlock, "pAliq");
  const tpRetISSQN = textOf(tribMunBlock, "tpRetISSQN");

  const vBC = vBCInf ?? textOf(valoresDPSBlock, "vBC") ?? vServ;
  const pAliqAplic = pAliqAplicInf ?? pAliq;
  const vISSQN = vISSQNInf ?? textOf(tribMunBlock, "vISSQN") ?? "0.00";
  const vTotalRet = vTotalRetInf ?? String((toNum(vPis) + toNum(vCofins) + toNum(vRetIRRF) + toNum(vRetCSLL) + toNum(vRetCP)).toFixed(2));
  const vLiq = (() => {
    if (toNum(vLiqInf) > 0) return vLiqInf as string;
    const calculado = toNum(vServ) - toNum(vDR) - toNum(vDescIncond) - toNum(vDescCond) - toNum(vTotalRet);
    if (calculado > 0) return calculado.toFixed(2);
    return vServ;
  })();

  const DARK_BLUE: [number, number, number] = [30, 58, 95];
  const LIGHT_GRAY: [number, number, number] = [240, 240, 240];
  const WHITE: [number, number, number] = [255, 255, 255];

  const drawBox = (x: number, yPos: number, w: number, h: number, fill?: [number, number, number]) => {
    if (fill) { doc.setFillColor(...fill); doc.rect(x, yPos, w, h, "F"); }
    doc.setDrawColor(180, 180, 180); doc.rect(x, yPos, w, h, "S");
  };
  const drawLabel = (label: string, value: string, x: number, yPos: number) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(100, 100, 100); doc.text(label, x, yPos);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(30, 30, 30); doc.text(value || "N/D", x, yPos + 4);
  };
  const drawSectionTitle = (title: string, yPos: number): number => {
    drawBox(ml, yPos, cw, 7, LIGHT_GRAY);
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(30, 58, 95); doc.text(title, ml + 3, yPos + 5);
    return yPos + 9;
  };
  const checkPage = (needed: number) => { if (y + needed > 280) { doc.addPage(); y = 10; } };

  drawBox(ml, y, cw, 18, DARK_BLUE);
  doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...WHITE);
  doc.text("DANFSE - Documento Auxiliar da NFS-e", pw / 2, y + 8, { align: "center" });
  doc.setFontSize(8); doc.setFont("helvetica", "normal");
  doc.text("Nota Fiscal de Serviço Eletrônica - Padrão Nacional", pw / 2, y + 14, { align: "center" });
  y += 21;

  checkPage(20); drawBox(ml, y, cw, 16);
  const col1 = ml + 3; const col2 = ml + 45; const col3 = ml + 100; const col4 = ml + 145;
  drawLabel("Nº NFS-e", nNFSe || "N/D", col1, y + 3);
  drawLabel("Data Emissão", fmtDate(dhEmi), col2, y + 3);
  drawLabel("Competência", fmtDate(dCompet), col3, y + 3);
  drawLabel("Local Incidência", xLocIncid || "N/D", col4, y + 3);
  y += 19;

  checkPage(30); y = drawSectionTitle("PRESTADOR DE SERVIÇOS", y);
  drawBox(ml, y, cw, 20);
  drawLabel("CNPJ", formatCnpj(emitCnpj), col1, y + 3);
  drawLabel("Inscrição Municipal", emitIM || "—", col2, y + 3);
  const emitNomeText = (emitNome || emitFant || "N/D").substring(0, 65);
  const emitNomeLines = doc.splitTextToSize(emitNomeText, cw - (col3 - ml) - 3);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(30, 30, 30);
  doc.text(emitNomeLines, col3, y + 7);
  drawLabel("Endereço", (emitEndereco || "N/D").substring(0, 80), col1, y + 11);
  const munUfCep = [emitMun, emitUF, formatCEP(emitCEP)].filter(Boolean).join(" - ");
  drawLabel("Município/UF/CEP", munUfCep || "N/D", col3, y + 11);
  y += 23;

  checkPage(30); y = drawSectionTitle("TOMADOR DE SERVIÇOS", y);
  drawBox(ml, y, cw, 20);
  drawLabel("CNPJ", formatCnpj(tomaCnpj), col1, y + 3);
  const tomaNomeText = (tomaNome || "N/D").substring(0, 65);
  const tomaNomeLines = doc.splitTextToSize(tomaNomeText, cw - (col3 - ml) - 3);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(30, 30, 30);
  doc.text(tomaNomeLines, col3, y + 7);
  drawLabel("Endereço", (tomaEndereco || "N/D").substring(0, 80), col1, y + 11);
  if (tomaEmail) drawLabel("E-mail", tomaEmail.substring(0, 45), col3, y + 11);
  y += 23;

  checkPage(30); y = drawSectionTitle("DISCRIMINAÇÃO DO SERVIÇO", y);
  const servCode = cTribNac ? `Código: ${cTribNac}` : "";
  const descText = xDescServ || "N/D";
  const descLines = doc.splitTextToSize(descText, cw - 6);
  const descHeight = Math.max(descLines.length * 4 + 10, 16);
  drawBox(ml, y, cw, descHeight);
  if (servCode) { doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(100, 100, 100); doc.text(servCode, col1, y + 4); }
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(30, 30, 30);
  doc.text(descLines, col1, y + (servCode ? 9 : 5));
  y += descHeight + 3;

  checkPage(45); y = drawSectionTitle("VALORES E TRIBUTOS", y);
  const valColW = cw / 6;
  drawBox(ml, y, cw, 14);
  const valLabels1 = ["Valor Serviços", "Deduções", "Desc. Incond.", "Base Cálculo", "Alíquota ISS", "Valor ISS"];
  const valValues1 = [fmtVal(vServ), fmtVal(vDR), fmtVal(vDescIncond), fmtVal(vBC), pAliqAplic ? `${fmtVal(pAliqAplic)}%` : "N/D", fmtVal(vISSQN)];
  for (let i = 0; i < 6; i++) drawLabel(valLabels1[i], valValues1[i], ml + 3 + i * valColW, y + 3);
  y += 16;

  drawBox(ml, y, cw, 14);
  const valLabels2 = ["PIS", "COFINS", "IRRF", "CSLL", "INSS", "Total Retenções"];
  const valValues2 = [fmtVal(vPis), fmtVal(vCofins), fmtVal(vRetIRRF), fmtVal(vRetCSLL), fmtVal(vRetCP), fmtVal(vTotalRet)];
  for (let i = 0; i < 6; i++) drawLabel(valLabels2[i], valValues2[i], ml + 3 + i * valColW, y + 3);
  y += 16;

  const issRetido = tpRetISSQN === "2";
  if (issRetido) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(7); doc.setTextColor(180, 50, 50);
    doc.text("ISS RETIDO PELO TOMADOR", ml + 3, y); y += 4;
  }

  const valorLiquidoFinal = (parseFloat(vLiq || "0") !== 0) ? vLiq : String((parseFloat(vServ || "0")) - (parseFloat(vDR || "0")) - (parseFloat(vDescIncond || "0")) - (parseFloat(vDescCond || "0")) - (parseFloat(vTotalRet || "0")));
  const valorExibir = parseFloat(valorLiquidoFinal || "0") > 0 ? valorLiquidoFinal : vServ;
  drawBox(ml, y, cw, 12, DARK_BLUE);
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...WHITE);
  doc.text(`VALOR LÍQUIDO: R$ ${fmtVal(valorExibir)}`, pw / 2, y + 8, { align: "center" });
  y += 15;

  checkPage(18); y = drawSectionTitle("CHAVE DE ACESSO", y);
  drawBox(ml, y, cw, 10);
  doc.setFont("courier", "bold"); doc.setFontSize(9); doc.setTextColor(30, 30, 30);
  doc.text(chaveAcesso || "N/D", pw / 2, y + 6.5, { align: "center" });
  y += 14;

  const footY = 282;
  doc.setFont("helvetica", "normal"); doc.setFontSize(6); doc.setTextColor(140, 140, 140);
  doc.text("Documento auxiliar da NFS-e gerado a partir do XML fiscal. Não substitui o documento eletrônico original.", pw / 2, footY, { align: "center" });
  doc.text(`Gerado em ${new Date().toLocaleDateString("pt-BR")} pelo P&F Financial Controller`, pw / 2, footY + 4, { align: "center" });

  return doc.output("blob") as Blob;
}
