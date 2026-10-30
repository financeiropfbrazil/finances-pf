/**
 * Download de controle das etapas — Notas Fiscais (NF-e) e Notas de Serviço (NFS-e) (PLANO-NFE NFE-6 /
 * PLANO-NFSE NFSE-1.15). Colunas combinadas com o Pedro em 30/10/2026: o que cada etapa registrou (quando e quem)
 * e os dias entre as etapas, para conferência e controle de tempo.
 *
 * Fonte: RPCs `nfe_relatorio_etapas` / `nfse_relatorio_etapas` (período De/Até pela emissão). A tela passa o período e
 * as notas que estão na lista no momento do clique — o arquivo sai igual ao que se vê (filtros de busca, "No Alvo" etc.).
 * Excel (ExcelJS), no padrão do download do Rastreio: blocos coloridos, datas de verdade, filtro, aba "Sobre".
 */
import { supabase } from "@/integrations/supabase/client";

export type TipoNota = "nfe" | "nfse";

export interface LinhaEtapas {
  id?: string;
  chave_acesso?: string;
  numero: string | null;
  fornecedor: string | null;
  cnpj: string | null;
  valor: number | null;
  emissao: string | null;
  situacao_fisco?: string | null;
  pedidos: string | null;
  data_pedido: string | null;
  pedido_aprovado_em: string | null;
  dias_pedido_emissao: number | null;
  chave_movestq: number | null;
  lancado_em: string | null;
  digitado_em: string | null;
  nf_anexado_em: string | null;
  nf_anexado_por: string | null;
  boleto_anexado_em: string | null;
  boleto_anexado_por: string | null;
  docfin: number | null;
  parcelas_total: number;
  parcelas_pagas: number;
  proximo_vencimento: string | null;
  pago_em: string | null;
  situacao_pagamento: string | null;
  etapa_atual: string;
  dias_emissao_lancamento: number | null;
  dias_em_aberto: number | null;
  dias_emissao_digitacao: number | null;
  dias_lancamento_pagamento: number | null;
  dias_atraso: number | null;
}

/** Linhas do período (todas as notas com emissão entre `de` e `ate`). */
export async function buscarRelatorioEtapas(tipo: TipoNota, de: string, ate: string): Promise<LinhaEtapas[]> {
  const rpc = tipo === "nfe" ? "nfe_relatorio_etapas" : "nfse_relatorio_etapas";
  const { data, error } = await (supabase as any).rpc(rpc, { p_de: de, p_ate: ate });
  if (error) throw new Error(error.message);
  return ((data as { linhas?: LinhaEtapas[] } | null)?.linhas ?? []) as LinhaEtapas[];
}

// ════════════════════════════════════════════════════════════
// COLUNAS
// ════════════════════════════════════════════════════════════
type Tipo = "texto" | "data" | "datahora" | "valor" | "inteiro";

interface Coluna {
  bloco: string;
  label: string;
  tipo: Tipo;
  largura: number;
  /** destaque em vermelho: "negativo" (nota antes do pedido) ou "positivo" (atraso) */
  alerta?: "negativo" | "positivo";
  /** célula em itálico laranja — o número ainda está correndo (ex.: nota não lançada, contada até hoje) */
  provisorio?: (l: LinhaEtapas) => boolean;
  valor: (l: LinhaEtapas) => string | number | Date | null;
}

const BLOCOS: Record<string, string> = {
  Nota: "FF0891B2",
  Pedido: "FF2563EB",
  MovEstq: "FF059669",
  Anexos: "FF7C3AED",
  DocFin: "FFD97706",
  Controle: "FF64748B",
};

const t = (v: string | null | undefined) => v ?? "";
const n = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
/** "YYYY-MM-DD" → meia-noite UTC do dia (o ExcelJS grava em UTC; assim não cai no dia anterior em lugar nenhum). */
const d = (v: string | null | undefined): Date | null => {
  const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};
/** Instante → data e hora de Brasília gravadas "como estão" (quem abre na Áustria vê o horário de Brasília). */
const dh = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const x = new Date(v);
  if (Number.isNaN(x.getTime())) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(x)
      .map((q) => [q.type, q.value]),
  );
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute));
};
const ROTULO_FISCO: Record<string, string> = { normal: "Normal", cancelada: "Cancelada", substituida: "Substituída" };

function colunas(tipo: TipoNota): Coluna[] {
  return [
    { bloco: "Nota", label: "Número", tipo: "texto", largura: 12, valor: (l) => t(l.numero) },
    { bloco: "Nota", label: "Fornecedor", tipo: "texto", largura: 36, valor: (l) => t(l.fornecedor) },
    { bloco: "Nota", label: "CNPJ", tipo: "texto", largura: 17, valor: (l) => t(l.cnpj) },
    { bloco: "Nota", label: tipo === "nfe" ? "Valor total" : "Valor do serviço", tipo: "valor", largura: 14, valor: (l) => n(l.valor) },
    { bloco: "Nota", label: "Emissão", tipo: "data", largura: 11, valor: (l) => d(l.emissao) },
    ...(tipo === "nfse"
      ? [{ bloco: "Nota", label: "Situação no fisco", tipo: "texto", largura: 13, valor: (l: LinhaEtapas) => ROTULO_FISCO[l.situacao_fisco ?? ""] ?? t(l.situacao_fisco) } as Coluna]
      : []),

    { bloco: "Pedido", label: "Pedido", tipo: "texto", largura: 16, valor: (l) => t(l.pedidos) },
    { bloco: "Pedido", label: "Data do pedido", tipo: "data", largura: 11, valor: (l) => d(l.data_pedido) },
    { bloco: "Pedido", label: "Pedido aprovado em", tipo: "data", largura: 11, valor: (l) => d(l.pedido_aprovado_em) },
    { bloco: "Pedido", label: "Dias: pedido → emissão", tipo: "inteiro", largura: 11, alerta: "negativo", valor: (l) => n(l.dias_pedido_emissao) },

    { bloco: "MovEstq", label: "Chave do MovEstq", tipo: "inteiro", largura: 11, valor: (l) => n(l.chave_movestq) },
    { bloco: "MovEstq", label: "Lançado no Alvo em", tipo: "data", largura: 11, valor: (l) => d(l.lancado_em) },
    { bloco: "MovEstq", label: "Data da digitação", tipo: "datahora", largura: 16, valor: (l) => dh(l.digitado_em) },

    { bloco: "Anexos", label: "PDF da nota anexado em", tipo: "datahora", largura: 16, valor: (l) => dh(l.nf_anexado_em) },
    { bloco: "Anexos", label: "PDF da nota anexado por", tipo: "texto", largura: 18, valor: (l) => t(l.nf_anexado_por) },
    { bloco: "Anexos", label: "Boleto anexado em", tipo: "datahora", largura: 16, valor: (l) => dh(l.boleto_anexado_em) },
    { bloco: "Anexos", label: "Boleto anexado por", tipo: "texto", largura: 18, valor: (l) => t(l.boleto_anexado_por) },

    { bloco: "DocFin", label: "DocFin", tipo: "inteiro", largura: 10, valor: (l) => n(l.docfin) },
    {
      bloco: "DocFin",
      label: "Parcelas (pagas/total)",
      tipo: "texto",
      largura: 11,
      valor: (l) => (l.parcelas_total > 0 ? `${l.parcelas_pagas}/${l.parcelas_total}` : ""),
    },
    { bloco: "DocFin", label: "Próximo vencimento", tipo: "data", largura: 11, valor: (l) => d(l.proximo_vencimento) },
    { bloco: "DocFin", label: "Pago em", tipo: "data", largura: 11, valor: (l) => d(l.pago_em) },
    { bloco: "DocFin", label: "Situação do pagamento", tipo: "texto", largura: 13, valor: (l) => t(l.situacao_pagamento) },

    { bloco: "Controle", label: "Etapa atual", tipo: "texto", largura: 18, valor: (l) => t(l.etapa_atual) },
    {
      bloco: "Controle",
      label: "Dias: emissão → lançamento",
      tipo: "inteiro",
      largura: 14,
      // só número (Pedro, 30/10): nota ainda não lançada = dias desde a emissão até hoje, em itálico laranja
      provisorio: (l) => n(l.dias_emissao_lancamento) === null && n(l.dias_em_aberto) !== null,
      valor: (l) => n(l.dias_emissao_lancamento) ?? n(l.dias_em_aberto),
    },
    { bloco: "Controle", label: "Dias: emissão → digitação", tipo: "inteiro", largura: 12, valor: (l) => n(l.dias_emissao_digitacao) },
    { bloco: "Controle", label: "Dias: lançamento → pagamento", tipo: "inteiro", largura: 13, valor: (l) => n(l.dias_lancamento_pagamento) },
    { bloco: "Controle", label: "Dias de atraso", tipo: "inteiro", largura: 10, alerta: "positivo", valor: (l) => n(l.dias_atraso) },
  ];
}

// ════════════════════════════════════════════════════════════
// EXCEL
// ════════════════════════════════════════════════════════════
export interface ContextoExportEtapas {
  de: string;
  ate: string;
  /** filtros da tela no momento do clique, já em texto (ex.: ["No Alvo: não encontradas", "Busca: dip"]) */
  filtros: string[];
}

const fmtBR = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const REGRAS: [string, string][] = [
  ["Período", "Pela data de emissão da nota, inclusive. É o período escolhido na tela no momento do download."],
  ["Pedido", "Pedido(s) do lançamento no Alvo (MovEstq). Na NF-e ainda não lançada, o pedido vinculado no Hub (botão \"Vincular\"). Sugestões automáticas não entram."],
  ["Data do pedido", "Com mais de um pedido, a mais recente."],
  ["Pedido aprovado em", "Data de aprovação no Alvo; com mais de um pedido, a mais recente."],
  ["Dias: pedido → emissão", "Emissão da nota − data do pedido. 0 = mesmo dia · positivo = pedido antes da nota (o certo) · NEGATIVO (vermelho) = nota emitida antes do pedido (errado)."],
  ["Lançado no Alvo em", "Data de entrada da nota no Alvo."],
  ["Data da digitação", "Data e hora em que a nota foi digitada no Alvo (horário de Brasília). Vazia quando o Hub ainda não leu o MovEstq da nota — o Hub lê o MovEstq de todo título novo desde 16/10/2026; antes disso a cobertura é parcial."],
  ["Anexos", "PDF da nota (DANFE na NF-e) e PDF do boleto anexados no Hub, com quem anexou. Existem desde 20/10/2026 (NFS-e) e 30/10/2026 (NF-e)."],
  ["DocFin", "Título da nota no contas a pagar do Alvo, lido às 06h40 e 12h40 (dias úteis). Parcela paga = paga com movimento bancário ou quitada por adiantamento."],
  ["Próximo vencimento", "O menor vencimento (do fornecedor) entre as parcelas em aberto."],
  ["Pago em", "A data de pagamento mais recente entre as parcelas pagas."],
  ["Situação do pagamento", "Pago (todas) · Vencido (alguma em aberto com vencimento passado) · Parcial · Em aberto. Vazio = sem título no Alvo."],
  ["Etapa atual", "A 1ª etapa não concluída: 2 · Pedidos · 3 · MovEstq · 4 · PDF da nota · 5 · Boleto · 6 · DocFin (todas as parcelas pagas) · Concluída. NF-e sem CFOP de venda (remessa, retorno…) pula pedido, boleto e DocFin."],
  ["Dias: emissão → lançamento", "Data de entrada no Alvo − emissão. Nota ainda não lançada: dias desde a emissão até hoje, em itálico laranja (\"Lançado no Alvo em\" fica vazio)."],
  ["Dias: emissão → digitação", "Data da digitação − emissão."],
  ["Dias: lançamento → pagamento", "Pagamento da última parcela − data de entrada no Alvo (só quando todas estão pagas)."],
  ["Dias de atraso", "Maior atraso entre as parcelas, contra o vencimento do fornecedor: paga → pagamento − vencimento; em aberto e vencida → hoje − vencimento. Negativo = pago antes do vencimento. Positivo em vermelho."],
];

/** Monta a planilha (sem baixar) — separado do download para poder ser testado. */
export async function montarPlanilhaEtapas(tipo: TipoNota, linhas: LinhaEtapas[], ctx: ContextoExportEtapas) {
  const ExcelJS = (await import("exceljs")).default;
  const COLUNAS = colunas(tipo);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Financial Hub";
  wb.created = new Date();

  const ws = wb.addWorksheet(tipo === "nfe" ? "NF-e" : "NFS-e", { views: [{ state: "frozen", xSplit: 2, ySplit: 2 }] });
  ws.columns = COLUNAS.map((c) => ({ width: c.largura }));

  // Linha 1: blocos mesclados
  const linhaBlocos = ws.getRow(1);
  let inicio = 1;
  for (let i = 1; i <= COLUNAS.length; i++) {
    const atual = COLUNAS[i - 1].bloco;
    if (COLUNAS[i]?.bloco !== atual) {
      if (i > inicio) ws.mergeCells(1, inicio, 1, i);
      const cel = linhaBlocos.getCell(inicio);
      cel.value = atual;
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

  for (const l of linhas) {
    const linha = ws.addRow(COLUNAS.map((c) => c.valor(l)));
    COLUNAS.forEach((c, i) => {
      if (c.provisorio?.(l)) linha.getCell(i + 1).font = { italic: true, color: { argb: "FFD97706" } };
    });
  }

  COLUNAS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.tipo === "data") col.numFmt = "dd/mm/yyyy";
    else if (c.tipo === "datahora") col.numFmt = "dd/mm/yyyy hh:mm";
    else if (c.tipo === "valor") col.numFmt = "#,##0.00";
    else if (c.tipo === "inteiro") col.numFmt = "0";
  });
  for (const r of [1, 2]) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cel) => {
      cel.numFmt = "@";
    });
  }

  // Destaques em vermelho (nota antes do pedido; atraso)
  if (linhas.length > 0) {
    COLUNAS.forEach((c, i) => {
      if (!c.alerta) return;
      const letra = ws.getColumn(i + 1).letter;
      ws.addConditionalFormatting({
        ref: `${letra}3:${letra}${2 + linhas.length}`,
        rules: [
          {
            type: "cellIs",
            operator: c.alerta === "negativo" ? "lessThan" : "greaterThan",
            formulae: ["0"],
            priority: 1,
            style: { font: { color: { argb: "FFDC2626" }, bold: true } },
          },
        ],
      });
    });
  }

  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + linhas.length, column: COLUNAS.length } };

  // Aba "Sobre"
  const sobre = wb.addWorksheet("Sobre");
  sobre.columns = [{ width: 30 }, { width: 110 }];
  const info: [string, string][] = [
    ["Relatório", tipo === "nfe" ? "Notas Fiscais (NF-e) — controle das etapas" : "Notas de Serviço (NFS-e) — controle das etapas"],
    ["Período (emissão)", `${fmtBR(ctx.de)} a ${fmtBR(ctx.ate)}`],
    ["Filtros da tela", ctx.filtros.length ? ctx.filtros.join(" · ") : "Nenhum"],
    ["Notas exportadas", String(linhas.length)],
    ["Exportado em", new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + " (Brasília)"],
    ["", ""],
    ...REGRAS,
  ];
  info.forEach(([k, v], i) => {
    const r = sobre.getRow(i + 1);
    r.getCell(1).value = k;
    r.getCell(2).value = v;
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
  });

  return wb;
}

/** Gera e baixa o Excel. Devolve o nome do arquivo e quantas linhas foram. */
export async function exportarEtapasXLSX(
  tipo: TipoNota,
  linhas: LinhaEtapas[],
  ctx: ContextoExportEtapas,
): Promise<{ arquivo: string; linhas: number }> {
  const wb = await montarPlanilhaEtapas(tipo, linhas, ctx);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const arquivo = `${tipo === "nfe" ? "notas-fiscais" : "notas-servico"}-etapas_${ctx.de}_a_${ctx.ate}.xlsx`;
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
