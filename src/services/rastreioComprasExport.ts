/**
 * Exportação XLSX do Rastreio de Compras (ExcelJS).
 *
 * Exporta TODAS as linhas do filtro da tela (não só a página): a tela chama
 * `listarTudo`, que busca em blocos de 1000 e confere a contagem.
 *
 * Planilha "Rastreio": linha 1 = blocos (Requisição, Pedido, NF, NF candidata,
 * Estoque, Pagamento, Prazos) mesclados e coloridos; linha 2 = colunas; cabeçalho e
 * 1ª coluna congelados; autofiltro. Datas são datas de verdade (dd/mm/aaaa),
 * valores e dias são números — o Excel ordena, filtra e soma.
 * Planilha "Sobre": filtro aplicado, momento da exportação e glossário.
 */
import type { CampoData, LinhaRastreio, NfCandidata } from "./rastreioComprasService";
import { CAMPOS_DATA, FILTRO_NF_CANDIDATA, dataLocal } from "./rastreioComprasService";

type Tipo = "texto" | "data" | "valor" | "inteiro";

interface Coluna {
  bloco: string;
  label: string;
  tipo: Tipo;
  largura: number;
  valor: (l: LinhaRastreio) => string | number | Date | null;
}

const BLOCOS: Record<string, string> = {
  // cor de fundo do cabeçalho de cada bloco (ARGB)
  Linha: "FF475569",
  Requisição: "FF7C3AED",
  Pedido: "FF2563EB",
  NF: "FF0891B2",
  "NF candidata (recebida, não lançada)": "FFB45309",
  Estoque: "FF059669",
  Pagamento: "FFD97706",
  "Prazos (dias)": "FF64748B",
};

const n = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const t = (v: string | null | undefined): string => v ?? "";
// ExcelJS grava datas em UTC: meia-noite UTC do dia certo, para a célula não
// cair no dia anterior em fuso positivo (ex.: quem abrir na Áustria).
const d = (v: string | null | undefined): Date | null => {
  const x = dataLocal(v);
  return x ? new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) : null;
};

/** Melhor candidata (rank 1) — só existe em linha sem NF ligada. */
const c1 = (l: LinhaRastreio): NfCandidata | null => (l.nf_candidatas && l.nf_candidatas[0]) || null;
const BLOCO_CAND = "NF candidata (recebida, não lançada)";
const fmtValor = (v: number | null) =>
  v === null ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const COLUNAS: Coluna[] = [
  { bloco: "Linha", label: "Etapa atual", tipo: "texto", largura: 24, valor: (l) => t(l.etapa) },

  { bloco: "Requisição", label: "Nº requisição", tipo: "texto", largura: 16, valor: (l) => t(l.req_numeros) },
  {
    bloco: "Requisição",
    label: "Descrição (requisição sem pedido)",
    tipo: "texto",
    largura: 34,
    valor: (l) => t(l.req_descricao),
  },
  { bloco: "Requisição", label: "Abertura", tipo: "data", largura: 12, valor: (l) => d(l.req_abertura) },
  { bloco: "Requisição", label: "Requisitante", tipo: "texto", largura: 28, valor: (l) => t(l.req_requisitante) },
  { bloco: "Requisição", label: "CC da requisição", tipo: "texto", largura: 26, valor: (l) => t(l.req_cc_nome ?? l.req_cc_codigo) },
  { bloco: "Requisição", label: "Aprovação do líder (Hub)", tipo: "data", largura: 14, valor: (l) => d(l.req_aprovacao_lider) },

  { bloco: "Pedido", label: "Nº pedido", tipo: "texto", largura: 11, valor: (l) => t(l.pedido_numero) },
  { bloco: "Pedido", label: "Data do pedido", tipo: "data", largura: 12, valor: (l) => d(l.pedido_data) },
  { bloco: "Pedido", label: "Aprovação (Alvo)", tipo: "data", largura: 12, valor: (l) => d(l.pedido_aprovacao) },
  { bloco: "Pedido", label: "Status", tipo: "texto", largura: 13, valor: (l) => t(l.pedido_status) },
  { bloco: "Pedido", label: "Natureza", tipo: "texto", largura: 10, valor: (l) => t(l.pedido_natureza) },
  { bloco: "Pedido", label: "Fornecedor", tipo: "texto", largura: 36, valor: (l) => t(l.pedido_fornecedor) },
  { bloco: "Pedido", label: "CNPJ", tipo: "texto", largura: 17, valor: (l) => t(l.pedido_cnpj) },
  { bloco: "Pedido", label: "Valor do pedido", tipo: "valor", largura: 14, valor: (l) => n(l.pedido_valor) },
  { bloco: "Pedido", label: "Moeda", tipo: "texto", largura: 7, valor: (l) => t(l.pedido_moeda) },
  { bloco: "Pedido", label: "Condição de pagamento", tipo: "texto", largura: 18, valor: (l) => t(l.pedido_cond_pagamento) },
  { bloco: "Pedido", label: "CC do pedido", tipo: "texto", largura: 26, valor: (l) => t(l.pedido_cc_nome ?? l.pedido_cc) },
  { bloco: "Pedido", label: "Comprador", tipo: "texto", largura: 20, valor: (l) => t(l.pedido_comprador) },

  { bloco: "NF", label: "Nº NF", tipo: "texto", largura: 12, valor: (l) => t(l.nf_numero) },
  { bloco: "NF", label: "Espécie", tipo: "texto", largura: 8, valor: (l) => t(l.nf_especie) },
  { bloco: "NF", label: "Emissão", tipo: "data", largura: 12, valor: (l) => d(l.nf_emissao) },
  { bloco: "NF", label: "Entrada", tipo: "data", largura: 12, valor: (l) => d(l.nf_entrada) },
  { bloco: "NF", label: "Valor total da NF", tipo: "valor", largura: 14, valor: (l) => n(l.nf_valor_total) },
  { bloco: "NF", label: "Valor deste pedido na NF", tipo: "valor", largura: 14, valor: (l) => n(l.valor_pedido_na_nf) },
  { bloco: "NF", label: "Nº de NFs do pedido", tipo: "inteiro", largura: 10, valor: (l) => n(l.pedido_qtd_nfs) },
  { bloco: "NF", label: "Fonte do vínculo", tipo: "texto", largura: 20, valor: (l) => t(l.fontes_vinculo) },

  { bloco: BLOCO_CAND, label: "Qtd candidatas", tipo: "inteiro", largura: 10, valor: (l) => n(l.nf_candidatas_qtd) || null },
  { bloco: BLOCO_CAND, label: "Nº NF sugerida", tipo: "texto", largura: 12, valor: (l) => t(c1(l)?.nf_numero) },
  { bloco: BLOCO_CAND, label: "Motivo", tipo: "texto", largura: 24, valor: (l) => t(c1(l)?.motivo) },
  { bloco: BLOCO_CAND, label: "Emitente", tipo: "texto", largura: 30, valor: (l) => t(c1(l)?.emitente_nome) },
  { bloco: BLOCO_CAND, label: "Emissão", tipo: "data", largura: 12, valor: (l) => d(c1(l)?.data_emissao) },
  { bloco: BLOCO_CAND, label: "Recebida em", tipo: "data", largura: 12, valor: (l) => d(c1(l)?.recebida_em) },
  { bloco: BLOCO_CAND, label: "Valor da NF", tipo: "valor", largura: 13, valor: (l) => n(c1(l)?.valor_total) },
  { bloco: BLOCO_CAND, label: "Valor que bateu", tipo: "valor", largura: 13, valor: (l) => n(c1(l)?.valor_comparado) },
  { bloco: BLOCO_CAND, label: "Base da comparação", tipo: "texto", largura: 28, valor: (l) => t(c1(l)?.base) },
  { bloco: BLOCO_CAND, label: "Diferença %", tipo: "valor", largura: 10, valor: (l) => n(c1(l)?.diferenca_pct) },
  {
    bloco: BLOCO_CAND,
    label: "Também sugerida para",
    tipo: "texto",
    largura: 14,
    valor: (l) => (c1(l)?.outros_pedidos ?? []).join(", "),
  },
  {
    bloco: BLOCO_CAND,
    label: "Outras candidatas",
    tipo: "texto",
    largura: 30,
    valor: (l) =>
      (l.nf_candidatas ?? [])
        .slice(1)
        .map((c) => `NF ${c.nf_numero ?? "?"} (${fmtValor(c.valor_total)})`)
        .join(" · "),
  },

  { bloco: "Estoque", label: "Laudo(s)", tipo: "texto", largura: 16, valor: (l) => t(l.laudo_numeros) },
  {
    bloco: "Estoque",
    label: "Laudos concluídos",
    tipo: "texto",
    largura: 10,
    valor: (l) => (l.laudo_qtd ? `${l.laudo_concluidos ?? 0}/${l.laudo_qtd}` : ""),
  },
  { bloco: "Estoque", label: "Confirmação no estoque", tipo: "data", largura: 13, valor: (l) => d(l.laudo_conclusao) },
  { bloco: "Estoque", label: "Resultado", tipo: "texto", largura: 14, valor: (l) => t(l.laudo_resultado) },

  { bloco: "Pagamento", label: "Adiantamento · vencimento", tipo: "data", largura: 13, valor: (l) => d(l.adto_vencimento) },
  { bloco: "Pagamento", label: "Adiantamento · valor", tipo: "valor", largura: 13, valor: (l) => n(l.adto_valor) },
  { bloco: "Pagamento", label: "Adiantamento · pago em", tipo: "data", largura: 13, valor: (l) => d(l.adto_pagamento) },
  { bloco: "Pagamento", label: "Adiantamento · situação", tipo: "texto", largura: 16, valor: (l) => t(l.adto_situacao) },
  { bloco: "Pagamento", label: "Projeção parc. 1 · vencimento", tipo: "data", largura: 13, valor: (l) => d(l.proj_p1_vencimento) },
  { bloco: "Pagamento", label: "Projeção parc. 1 · realizada em", tipo: "data", largura: 13, valor: (l) => d(l.proj_p1_pagamento) },
  { bloco: "Pagamento", label: "Projeção parc. 1 · valor", tipo: "valor", largura: 13, valor: (l) => n(l.proj_p1_valor) },
  { bloco: "Pagamento", label: "Título da NF", tipo: "texto", largura: 14, valor: (l) => t(l.tit_numero) },
  { bloco: "Pagamento", label: "Título parc. 1 · vencimento", tipo: "data", largura: 13, valor: (l) => d(l.tit_p1_vencimento) },
  { bloco: "Pagamento", label: "Título parc. 1 · pago em", tipo: "data", largura: 13, valor: (l) => d(l.tit_p1_pagamento) },
  { bloco: "Pagamento", label: "Título parc. 1 · valor pago", tipo: "valor", largura: 13, valor: (l) => n(l.tit_p1_valor_pago) },
  { bloco: "Pagamento", label: "Título · situação", tipo: "texto", largura: 18, valor: (l) => t(l.tit_p1_situacao) },
  {
    bloco: "Pagamento",
    label: "Título · parcelas pagas",
    tipo: "texto",
    largura: 10,
    valor: (l) => (l.tit_qtd_parcelas ? `${l.tit_qtd_pagas ?? 0}/${l.tit_qtd_parcelas}` : ""),
  },
  { bloco: "Pagamento", label: "Título ligado por", tipo: "texto", largura: 18, valor: (l) => t(l.tit_ligacao) },
  { bloco: "Pagamento", label: "1º pagamento", tipo: "data", largura: 13, valor: (l) => d(l.primeiro_pagamento) },
  { bloco: "Pagamento", label: "Origem do 1º pagamento", tipo: "texto", largura: 18, valor: (l) => t(l.primeiro_pagamento_origem) },

  { bloco: "Prazos (dias)", label: "Req → Pedido", tipo: "inteiro", largura: 9, valor: (l) => n(l.dias_req_pedido) },
  { bloco: "Prazos (dias)", label: "Pedido → Aprovação", tipo: "inteiro", largura: 10, valor: (l) => n(l.dias_pedido_aprovacao) },
  { bloco: "Prazos (dias)", label: "Aprovação → NF", tipo: "inteiro", largura: 10, valor: (l) => n(l.dias_aprovacao_nf) },
  { bloco: "Prazos (dias)", label: "NF → Estoque", tipo: "inteiro", largura: 9, valor: (l) => n(l.dias_nf_estoque) },
  { bloco: "Prazos (dias)", label: "NF → Pagamento", tipo: "inteiro", largura: 10, valor: (l) => n(l.dias_nf_pagamento) },
  { bloco: "Prazos (dias)", label: "Ciclo total", tipo: "inteiro", largura: 9, valor: (l) => n(l.dias_ciclo_total) },

  { bloco: "Linha", label: "Chave MovEstq", tipo: "inteiro", largura: 11, valor: (l) => n(l.chave_movestq) },
];

function nomeArquivo(de: string | null, ate: string | null): string {
  const agora = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  const carimbo = `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}_${p(agora.getHours())}${p(agora.getMinutes())}`;
  const periodo = de || ate ? `_${de ?? "inicio"}_a_${ate ?? "hoje"}` : "_tudo";
  return `rastreio-compras${periodo}_${carimbo}.xlsx`;
}

function fmtBR(iso: string | null): string {
  const x = dataLocal(iso);
  if (!x) return "—";
  const p = (v: number) => String(v).padStart(2, "0");
  return `${p(x.getDate())}/${p(x.getMonth() + 1)}/${x.getFullYear()}`;
}

export interface ContextoExport {
  de: string | null;
  ate: string | null;
  campoData: CampoData;
  busca: string;
  etapas: string[];
  atualizadoEm: string | null;
}

export async function exportarRastreioXLSX(
  linhas: LinhaRastreio[],
  ctx: ContextoExport,
): Promise<{ arquivo: string; linhas: number }> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Financial Hub";
  wb.created = new Date();

  // ── Planilha principal ─────────────────────────────────────
  const ws = wb.addWorksheet("Rastreio", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 2 }],
  });
  ws.columns = COLUNAS.map((c) => ({ width: c.largura }));

  // Linha 1: blocos mesclados
  const linhaBlocos = ws.getRow(1);
  let inicio = 1;
  for (let i = 1; i <= COLUNAS.length; i++) {
    const atual = COLUNAS[i - 1].bloco;
    const prox = COLUNAS[i]?.bloco;
    if (prox !== atual) {
      if (i > inicio) ws.mergeCells(1, inicio, 1, i);
      const cel = linhaBlocos.getCell(inicio);
      cel.value = atual === "Linha" ? "" : atual;
      for (let c = inicio; c <= i; c++) {
        linhaBlocos.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLOCOS[atual] } };
      }
      cel.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cel.alignment = { horizontal: "center", vertical: "middle" };
      inicio = i + 1;
    }
  }
  linhaBlocos.height = 20;

  // Linha 2: colunas
  const linhaCab = ws.getRow(2);
  COLUNAS.forEach((c, i) => {
    const cel = linhaCab.getCell(i + 1);
    cel.value = c.label;
    cel.font = { bold: true, color: { argb: "FF0F172A" } };
    cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    cel.alignment = { vertical: "middle", wrapText: true };
    cel.border = { bottom: { style: "thin", color: { argb: "FF94A3B8" } } };
  });
  linhaCab.height = 32;

  // Dados
  for (const l of linhas) {
    ws.addRow(COLUNAS.map((c) => c.valor(l)));
  }

  // Formatos por coluna
  COLUNAS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.tipo === "data") col.numFmt = "dd/mm/yyyy";
    else if (c.tipo === "valor") col.numFmt = "#,##0.00";
    else if (c.tipo === "inteiro") col.numFmt = "0";
  });
  // numFmt da coluna também pega o cabeçalho — devolve texto puro nas 2 primeiras linhas
  for (const r of [1, 2]) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cel) => {
      cel.numFmt = "@";
    });
  }

  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + linhas.length, column: COLUNAS.length } };

  // ── Planilha "Sobre" ───────────────────────────────────────
  const sobre = wb.addWorksheet("Sobre");
  sobre.columns = [{ width: 30 }, { width: 100 }];
  const campo = CAMPOS_DATA.find((x) => x.valor === ctx.campoData)?.label ?? ctx.campoData;
  const info: [string, string][] = [
    ["Relatório", "Rastreio de Compras — Requisição → Pedido → NF → Estoque → Pagamento"],
    ["Período", `${fmtBR(ctx.de)} a ${fmtBR(ctx.ate)} (por ${campo.toLowerCase()})`],
    ["Busca", ctx.busca.trim() || "—"],
    [
      "Etapas",
      ctx.etapas.length
        ? ctx.etapas.map((e) => (e === FILTRO_NF_CANDIDATA ? "Com NF recebida não lançada" : e)).join(", ")
        : "Todas",
    ],
    ["Linhas exportadas", String(linhas.length)],
    ["Dados atualizados em", ctx.atualizadoEm ? new Date(ctx.atualizadoEm).toLocaleString("pt-BR") : "—"],
    ["Exportado em", new Date().toLocaleString("pt-BR")],
    ["", ""],
    [
      "Grão",
      "Uma linha por pedido × NF. Pedido sem NF = uma linha com o bloco NF vazio. Requisição que ainda não virou pedido = uma linha só com o bloco Requisição (Nº pedido vazio).",
    ],
    [
      "Filtro por data do pedido",
      "Nas linhas de requisição sem pedido vale a data de abertura da requisição. Filtrando por entrada da NF ou 1º pagamento, essas linhas não aparecem.",
    ],
    [
      "NF com 2+ pedidos",
      "Aparece em cada pedido. \"Valor deste pedido na NF\" é a parte do pedido (com IPI/frete quando o Alvo informa); o título de pagamento é da NF e se repete nessas linhas — não some o pagamento.",
    ],
    ["Requisição", "Espelho das requisições do Alvo (abertura = data/hora de digitação). Aprovação do líder vem do Hub (só requisições criadas no Hub)."],
    ["Estoque", "Laudo concluído = confirmação no estoque (E0000163). Serviço não tem laudo."],
    [
      "Pagamento",
      "Adiantamento (PC série A), projeção do pedido (PC série 0, parcela 1) e título da NF (parcela 1), lidos do DocFin. 1º pagamento = o mais cedo entre adiantamento e título da NF; sem título ligado, vale a projeção realizada.",
    ],
    [
      "NF candidata",
      "Só em pedido sem NF ligada: NF recebida em Compras → Notas Fiscais (XML) e ainda não lançada no Alvo que pode ser do pedido. " +
        "Motivos, do mais forte ao mais fraco: \"Vinculada em Compras → NF\" (alguém vinculou na tela), \"Pedido citado na NF\" (o XML traz o nº do pedido) " +
        "e \"Mesmo fornecedor e valor\" (raiz do CNPJ igual e valor ±10% — contra o total, o valor faturado sem itens de retorno, ou um item). " +
        "É sugestão: o vínculo de verdade aparece quando a NF é lançada no Alvo citando o pedido. As colunas mostram a melhor; \"Outras candidatas\" lista as demais (até 3).",
    ],
    ["Título ligado por", "\"Chave da NF\" = DocFin.ChaveMovEstq (exato). \"Número + fornecedor\" = mesmo número de documento e mesma entidade."],
    ["", ""],
    ["Etapas", ""],
    ["Requisição em aprovação", "Requisição criada no Hub aguardando o líder do centro de custo (ainda não está no Alvo)."],
    ["Requisição aprovada (não enviada ao Alvo)", "Aprovada pelo líder no Hub, mas o envio ao Alvo não aconteceu — verificar."],
    ["Aguardando pedido", "Requisição aberta no Alvo, sem pedido gerado e sem pedido que a cite."],
    ["Pedido em aprovação", "Sem NF e sem data de aprovação no Alvo."],
    ["Aguardando NF", "Pedido aprovado, nenhuma NF ligada ainda."],
    ["Em inspeção (laudo)", "NF lançada, laudo(s) ainda não concluído(s)."],
    ["Aguardando pagamento", "NF lançada (e estoque confirmado, quando produto), 1ª parcela ainda não paga."],
    ["Pago (1ª parcela)", "1ª parcela do título da NF paga (ou projeção realizada)."],
    ["Pago (NF não ligada)", "Projeção do pedido realizada, mas a NF ainda não foi ligada ao pedido nas fontes do Hub."],
    ["Adiantamento pago (sem NF)", "Adiantamento pago, NF ainda não ligada."],
    ["Encerrado sem NF ligada", "Pedido encerrado no Alvo sem NF ligada e sem pagamento identificado."],
    ["Cancelado", "Pedido cancelado no Alvo."],
    ["Requisição cancelada", "Requisição cancelada no Alvo sem ter virado pedido."],
    ["Requisição rejeitada", "Requisição rejeitada pelo líder no Hub."],
  ];
  info.forEach(([k, v], i) => {
    const r = sobre.getRow(i + 1);
    r.getCell(1).value = k;
    r.getCell(2).value = v;
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
  });

  // ── Download ───────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const arquivo = nomeArquivo(ctx.de, ctx.ate);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = arquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  return { arquivo, linhas: linhas.length };
}
