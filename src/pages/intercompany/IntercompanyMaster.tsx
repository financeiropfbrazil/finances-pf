import { useState, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx-js-style";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  AlertCircle,
  ArrowDownToLine,
  Calendar as CalendarIcon,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Banknote,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  atualizarKontoBlocoInline,
  buscarBlocosDetalhe,
  buscarDetalheMaster,
  buscarFiltrosDisponiveis,
  buscarTudoParaExportar,
  definirPagoMaster,
  exportarBlocosIntercompany,
  importarPdfAnexo,
  listarKontosAtivos,
  listarMaster,
  resumoConsolidadoIntercompany,
} from "@/services/intercompanyMasterListService";
import { MasterCambioModal } from "@/components/intercompany/MasterCambioModal";
import { downloadIntercompanyPdf } from "@/utils/downloadIntercompanyPdf";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import type {
  MasterBlocoDetalhe,
  MasterClassificationStatus,
  MasterFiltros,
  MasterFiltrosDisponiveis,
  MasterItem,
  MasterStatusUnificado,
} from "@/types/intercompanyMaster";

const PAGE_SIZE = 20;

const formatBRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatEUR = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "EUR" });
const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// ── Tom semântico (rotina = quieto, exceção = salta) ───────────────────────
type Tone = "danger" | "warning" | "success" | "info" | "muted";

const TONE_TEXT: Record<Tone, string> = {
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
  info: "text-info",
  muted: "text-muted-foreground",
};
const TONE_DOT: Record<Tone, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  success: "bg-success",
  info: "bg-info",
  muted: "bg-muted-foreground",
};

// Status na LINHA: dot + texto em caixa alta (estilo ledger das imagens)
function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap text-[10px] font-bold uppercase tracking-wide",
        TONE_TEXT[tone],
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      {label}
    </span>
  );
}

// status_unificado → tom (emitida é rotina → muted; exceções saltam)
const statusTone: Record<MasterStatusUnificado, Tone> = {
  rascunho: "muted",
  pendente_emissao: "warning",
  emitida: "muted",
  erro: "danger",
  sincronizada: "info",
  classificada: "success",
  pendente_eur: "warning",
  pendente_revisao: "warning",
  validada: "success",
  reconciliada: "info",
};

// Para os badges de contagem do resumo (tokenizados)
const statusColor: Record<MasterStatusUnificado, string> = {
  rascunho: "bg-muted text-muted-foreground border-border",
  pendente_emissao: "bg-warning/12 text-warning border-warning/30",
  emitida: "bg-muted text-muted-foreground border-border",
  erro: "bg-danger/15 text-danger border-danger/40",
  sincronizada: "bg-info/12 text-info border-info/30",
  classificada: "bg-success/12 text-success border-success/30",
  pendente_eur: "bg-warning/12 text-warning border-warning/30",
  pendente_revisao: "bg-warning/12 text-warning border-warning/30",
  validada: "bg-success/12 text-success border-success/30",
  reconciliada: "bg-info/12 text-info border-info/30",
};

const classificationTone: Record<MasterClassificationStatus, Tone> = {
  classified: "success",
  needs_konto_at: "warning",
  unclassified: "danger",
};

const classificationColor: Record<MasterClassificationStatus, string> = {
  classified: "bg-success/12 text-success border-success/30",
  needs_konto_at: "bg-warning/12 text-warning border-warning/30",
  unclassified: "bg-danger/15 text-danger border-danger/40 font-medium",
};

const classificationLabel: Record<MasterClassificationStatus, string> = {
  classified: "Classified",
  needs_konto_at: "Needs Konto AT",
  unclassified: "Unclassified",
};

const classificationEmoji: Record<MasterClassificationStatus, string> = {
  classified: "✓",
  needs_konto_at: "!",
  unclassified: "?",
};

// ── i18n dos enums de dados (somente exibição na tela) ─────────────────────
// O export Excel continua usando classificationLabel (inglês fixo, p/ Áustria).
type Lang = "pt" | "en";

const TIPO_I18N: Record<string, { pt: string; en: string }> = {
  servico: { pt: "Serviço", en: "Service" },
  venda: { pt: "Venda", en: "Sale" },
  reembolso: { pt: "Reembolso", en: "Reimbursement" },
  importacao: { pt: "Importação", en: "Import" },
  exportacao: { pt: "Exportação", en: "Export" },
};
const tipoLabel = (lang: Lang, tipo: string | null | undefined) => (tipo ? (TIPO_I18N[tipo]?.[lang] ?? tipo) : "—");

const CLASSIF_I18N: Record<MasterClassificationStatus, { pt: string; en: string }> = {
  classified: { pt: "Classificada", en: "Classified" },
  needs_konto_at: { pt: "Falta Konto AT", en: "Needs Konto AT" },
  unclassified: { pt: "Não classificada", en: "Unclassified" },
};
const classifLabel = (lang: Lang, s: MasterClassificationStatus) => CLASSIF_I18N[s]?.[lang] ?? s;

const STATUS_I18N: Record<MasterStatusUnificado, { pt: string; en: string }> = {
  rascunho: { pt: "Rascunho", en: "Draft" },
  pendente_emissao: { pt: "Pendente Emissão", en: "Pending Issue" },
  emitida: { pt: "Emitida", en: "Issued" },
  erro: { pt: "Erro", en: "Error" },
  sincronizada: { pt: "Sincronizada", en: "Synced" },
  classificada: { pt: "Classificada", en: "Classified" },
  pendente_eur: { pt: "Pendente EUR", en: "Pending EUR" },
  pendente_revisao: { pt: "Pendente Revisão", en: "Pending Review" },
  validada: { pt: "Validada", en: "Validated" },
  reconciliada: { pt: "Reconciliada", en: "Reconciled" },
};
const statusLabel = (lang: Lang, s: MasterStatusUnificado) => STATUS_I18N[s]?.[lang] ?? s;

// ── Export Excel (xlsx-js-style) ────────────────────────────────────────────
const XLS_EUR = '"€" #,##0.00';
const XLS_BRL = '"R$" #,##0.00';
const XLS_PCT = "0.0%";
const XLS_INT = "#,##0";

const xlsBorder = {
  top: { style: "thin", color: { rgb: "FFBFBFBF" } },
  bottom: { style: "thin", color: { rgb: "FFBFBFBF" } },
  left: { style: "thin", color: { rgb: "FFBFBFBF" } },
  right: { style: "thin", color: { rgb: "FFBFBFBF" } },
};
const styHeader = {
  font: { bold: true, color: { rgb: "FFFFFFFF" } },
  fill: { fgColor: { rgb: "FF1F4E79" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: xlsBorder,
};
const styTitle = { font: { bold: true, sz: 14, color: { rgb: "FF1F4E79" } } };
const stySection = {
  font: { bold: true, sz: 11, color: { rgb: "FFFFFFFF" } },
  fill: { fgColor: { rgb: "FF2F5496" } },
};
const styTotal = { font: { bold: true }, fill: { fgColor: { rgb: "FFDDEBF7" } }, border: xlsBorder };
const styLabel = { font: { bold: true } };

const cNum = (v: number | null | undefined, z: string, s: any = {}) => ({ v: Number(v ?? 0), t: "n", z, s });
const cTxt = (v: any, s: any = {}) => ({ v: v == null ? "" : String(v), t: "s", s });
const cBlank = () => null;
// célula de fórmula viva (com valor em cache pra aparecer antes do recálculo)
const cFormula = (formula: string, cached: number, z: string, s: any = {}) => ({
  t: "n",
  f: formula,
  v: Number(cached ?? 0),
  z,
  s,
});
const colL = (c: number) => XLSX.utils.encode_col(c);

function sheetFromMatrix(matrix: any[][]) {
  const ws: any = {};
  let maxC = 0;
  matrix.forEach((row, r) => {
    if (row.length - 1 > maxC) maxC = row.length - 1;
    row.forEach((cell, c) => {
      if (cell == null) return;
      ws[XLSX.utils.encode_cell({ r, c })] = cell;
    });
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, matrix.length - 1), c: maxC } });
  return ws;
}

const isEmitted = (s: string) => !["rascunho", "pendente_emissao", "erro"].includes(s);

function buildIntercompanyWorkbook(items: any[], blocos: any, consolidado: any) {
  const wb = XLSX.utils.book_new();
  const sumEur = (arr: any[]) => arr.reduce((a, i) => a + (Number(i.valor_eur) || 0), 0);
  const sumBrl = (arr: any[]) => arr.reduce((a, i) => a + (Number(i.valor_brl) || 0), 0);
  const g = (o: any, k: string) => (o && o[k] != null ? Number(o[k]) : 0);

  // ===== Aba 1: Reconciliation (BR side) =====
  {
    const emitted = items.filter((i) => isEmitted(i.status_unificado));
    const paid = emitted.filter((i) => i.pago);
    const open = emitted.filter((i) => !i.pago);
    const emEur = sumEur(emitted);
    const pctPaid = emEur ? sumEur(paid) / emEur : 0;
    const c = consolidado || {};
    const ag = c.aging || {};

    const m: any[][] = [];
    m.push([cTxt("INTERCOMPANY RECONCILIATION — BR SIDE", styTitle)]);
    m.push([
      cTxt(`Generated: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, {
        font: { italic: true, color: { rgb: "FF808080" } },
      }),
    ]);
    m.push([]);
    m.push([cTxt("PERIOD (respects active filter) — flow / movement", stySection)]);
    m.push([
      cTxt("Metric", styHeader),
      cTxt("Invoices", styHeader),
      cTxt("EUR", styHeader),
      cTxt("BRL", styHeader),
      cTxt("% Paid", styHeader),
    ]);
    m.push([
      cTxt("Emitted", styLabel),
      cNum(emitted.length, XLS_INT),
      cNum(emEur, XLS_EUR),
      cNum(sumBrl(emitted), XLS_BRL),
      cBlank(),
    ]);
    m.push([
      cTxt("Paid", styLabel),
      cNum(paid.length, XLS_INT),
      cNum(sumEur(paid), XLS_EUR),
      cNum(sumBrl(paid), XLS_BRL),
      cNum(pctPaid, XLS_PCT),
    ]);
    m.push([
      cTxt("Open", styLabel),
      cNum(open.length, XLS_INT),
      cNum(sumEur(open), XLS_EUR),
      cNum(sumBrl(open), XLS_BRL),
      cBlank(),
    ]);
    m.push([]);
    m.push([cTxt("CONSOLIDATED POSITION (all dates, ignores filter) — balance / stock", stySection)]);
    m.push([cTxt("Metric", styHeader), cTxt("Invoices", styHeader), cTxt("EUR", styHeader), cTxt("BRL", styHeader)]);
    m.push([
      cTxt("Emitted", styLabel),
      cNum(g(c.emitido, "qtd"), XLS_INT),
      cNum(g(c.emitido, "eur"), XLS_EUR),
      cNum(g(c.emitido, "brl"), XLS_BRL),
    ]);
    m.push([
      cTxt("Paid", styLabel),
      cNum(g(c.pago, "qtd"), XLS_INT),
      cNum(g(c.pago, "eur"), XLS_EUR),
      cNum(g(c.pago, "brl"), XLS_BRL),
    ]);
    m.push([
      cTxt("Open", styLabel),
      cNum(g(c.em_aberto, "qtd"), XLS_INT),
      cNum(g(c.em_aberto, "eur"), XLS_EUR),
      cNum(g(c.em_aberto, "brl"), XLS_BRL),
    ]);
    m.push([]);
    m.push([cTxt("AGING — open invoices by days since issue", stySection)]);
    m.push([cTxt("Bucket", styHeader), cTxt("Invoices", styHeader), cTxt("EUR", styHeader), cTxt("BRL", styHeader)]);
    const agingRow = (label: string, key: string) =>
      m.push([
        cTxt(label),
        cNum(g(ag[key], "qtd"), XLS_INT),
        cNum(g(ag[key], "eur"), XLS_EUR),
        cNum(g(ag[key], "brl"), XLS_BRL),
      ]);
    const agFirst = m.length + 1; // Excel row do primeiro balde
    agingRow("0–30 days", "d0_30");
    agingRow("31–60 days", "d31_60");
    agingRow("61–90 days", "d61_90");
    agingRow("90+ days", "d90_mais");
    const agLast = agFirst + 3;
    m.push([
      cTxt("Total open", styTotal),
      cFormula(`SUM(B${agFirst}:B${agLast})`, g(c.em_aberto, "qtd"), XLS_INT, styTotal),
      cFormula(`SUM(C${agFirst}:C${agLast})`, g(c.em_aberto, "eur"), XLS_EUR, styTotal),
      cFormula(`SUM(D${agFirst}:D${agLast})`, g(c.em_aberto, "brl"), XLS_BRL, styTotal),
    ]);

    const ws = sheetFromMatrix(m);
    ws["!cols"] = [{ wch: 46 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, "1. Reconciliation");
  }

  // ===== Abas 2 & 3: matrizes =====
  const buildMatrix = (dimKey: "konto" | "classe", noLabel: string, sheetName: string) => {
    const dimSet = new Set<string>();
    blocos.alocacoes.forEach((a: any) => {
      const code = dimKey === "konto" ? a.konto_numero : a.classe_codigo;
      if (code) dimSet.add(String(code));
    });
    const dims = [...dimSet].sort((x, y) => {
      const nx = parseInt(x),
        ny = parseInt(y);
      if (!isNaN(nx) && !isNaN(ny)) return nx - ny;
      return x.localeCompare(y);
    });
    const allocMap = new Map<string, Map<string, number>>();
    blocos.alocacoes.forEach((a: any) => {
      const code = String((dimKey === "konto" ? a.konto_numero : a.classe_codigo) ?? noLabel);
      if (!allocMap.has(a.numero_invoice)) allocMap.set(a.numero_invoice, new Map());
      const mm = allocMap.get(a.numero_invoice)!;
      mm.set(code, (mm.get(code) || 0) + (Number(a.valor_eur) || 0));
    });

    const m: any[][] = [];
    m.push([cTxt(sheetName.toUpperCase(), styTitle)]);
    m.push([]);
    m.push([
      cTxt("Invoice", styHeader),
      cTxt("Date", styHeader),
      ...dims.map((d) => cTxt(d, styHeader)),
      cTxt(noLabel, styHeader),
      cTxt("Total", styHeader),
    ]);

    const colTotals = new Array(dims.length).fill(0);
    let noTotal = 0;
    let grand = 0;
    const noColIdx = 2 + dims.length;
    const totalColIdx = 2 + dims.length + 1;

    items.forEach((inv) => {
      const am = allocMap.get(inv.numero_invoice) || new Map<string, number>();
      const invTotal = Number(inv.valor_eur) || 0;
      let sumAlloc = 0;
      am.forEach((val) => (sumAlloc += val));
      const noVal = (am.get(noLabel) || 0) + (invTotal - sumAlloc);
      const R = m.length + 1; // Excel row desta invoice
      const row = [cTxt(inv.numero_invoice), cTxt(formatDate(inv.data_emissao))];
      dims.forEach((d, idx) => {
        const v = am.get(d) || 0;
        colTotals[idx] += v;
        row.push(v ? cNum(v, XLS_EUR) : cBlank());
      });
      noTotal += noVal;
      row.push(Math.abs(noVal) > 0.005 ? cNum(noVal, XLS_EUR) : cBlank());
      // Total da linha = soma viva das colunas de valor (Konto/Classe + (no ...))
      row.push(cFormula(`SUM(${colL(2)}${R}:${colL(noColIdx)}${R})`, invTotal, XLS_EUR, styLabel));
      grand += invTotal;
      m.push(row);
    });

    const firstDataRow = 4;
    const lastDataRow = 3 + items.length;
    const hasRows = items.length > 0;
    const sumColCell = (cidx: number, cached: number) =>
      hasRows
        ? cFormula(`SUM(${colL(cidx)}${firstDataRow}:${colL(cidx)}${lastDataRow})`, cached, XLS_EUR, styTotal)
        : cNum(cached, XLS_EUR, styTotal);

    m.push([
      cTxt("TOTAL", styTotal),
      cTxt("", styTotal),
      ...dims.map((_d, idx) => sumColCell(2 + idx, colTotals[idx])),
      sumColCell(noColIdx, noTotal),
      sumColCell(totalColIdx, grand),
    ]);

    const ws = sheetFromMatrix(m);
    ws["!cols"] = [{ wch: 12 }, { wch: 12 }, ...dims.map(() => ({ wch: 14 })), { wch: 14 }, { wch: 16 }];
    const lastCol = 2 + dims.length + 1;
    ws["!autofilter"] = {
      ref: `${XLSX.utils.encode_cell({ r: 2, c: 0 })}:${XLSX.utils.encode_cell({ r: 2 + items.length, c: lastCol })}`,
    };
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  };

  buildMatrix("konto", "(no Konto)", "2. By Konto");
  buildMatrix("classe", "(no Class)", "3. By Class");

  // ===== Aba 4: Raw =====
  {
    const headers = [
      "Invoice No",
      "Date",
      "Type",
      "Specie",
      "Class Code",
      "Class Name",
      "Konto AT",
      "Konto Description",
      "Amount EUR",
      "Amount BRL",
      "Exchange Rate",
      "Paid",
      "Paid At",
      "Total Blocks",
      "Total CCs",
      "Cost Centers",
      "Source",
      "Status",
      "Status Reason",
      "Classification",
      "Alvo Key",
      "Alvo Document No",
      "Description",
      "Alvo Category",
    ];
    const m: any[][] = [headers.map((h) => cTxt(h, styHeader))];
    items.forEach((i) => {
      m.push([
        cTxt(i.numero_invoice),
        cTxt(formatDate(i.data_emissao)),
        cTxt(i.tipo),
        cTxt(i.especie),
        cTxt(i.classe_codigo),
        cTxt(i.classe_nome),
        cTxt(i.konto_at_numero),
        cTxt(i.konto_at_descricao),
        cNum(i.valor_eur, XLS_EUR),
        cNum(i.valor_brl, XLS_BRL),
        cNum(i.cambio, "#,##0.0000"),
        cTxt(i.pago ? "Yes" : "No"),
        cTxt(i.pago_em ? format(new Date(i.pago_em), "dd/MM/yyyy") : ""),
        cNum(i.total_blocos, XLS_INT),
        cNum(i.total_ccs, XLS_INT),
        cTxt((i.ccs_codigos || []).join(" | ")),
        cTxt(i.origem),
        cTxt(i.status_label),
        cTxt(i.status_motivo),
        cTxt(classificationLabel[i.classification_status_agregado] ?? i.classification_status_agregado),
        cTxt(i.chave_docfin_alvo),
        cTxt(i.numero_documento_alvo),
        cTxt(i.descricao),
        cTxt(i.origem_categoria),
      ]);
    });
    const ws = sheetFromMatrix(m);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(10, Math.min(30, h.length + 2)) }));
    ws["!autofilter"] = { ref: `A1:${XLSX.utils.encode_cell({ r: items.length, c: headers.length - 1 })}` };
    XLSX.utils.book_append_sheet(wb, ws, "4. Raw");
  }

  return wb;
}

export default function IntercompanyMaster() {
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  // ─── STATE: Filtros ───────────────────────────────────────────────────
  const [dataDe, setDataDe] = useState<Date | undefined>(undefined);
  const [dataAte, setDataAte] = useState<Date | undefined>(undefined);
  const [tipo, setTipo] = useState<string>("");
  const [statusF, setStatusF] = useState<string>("");
  const [origem, setOrigem] = useState<string>("");
  const [classe, setClasse] = useState<string>("");
  const [konto, setKonto] = useState<string>("");
  const [ccCode, setCcCode] = useState<string>("");
  const [ccPopoverOpen, setCcPopoverOpen] = useState(false);
  const [ccSearch, setCcSearch] = useState("");
  const [busca, setBusca] = useState<string>("");
  const [buscaDebounced, setBuscaDebounced] = useState<string>("");
  const [page, setPage] = useState(1);
  const [detailItem, setDetailItem] = useState<MasterItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exportando, setExportando] = useState(false);

  // ─── STATE: Modal câmbio ──────────────────────────────────────────────
  const [cambioModalOpen, setCambioModalOpen] = useState(false);
  const [cambioMasterItem, setCambioMasterItem] = useState<MasterItem | null>(null);

  // Debounce busca
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 400);
    return () => clearTimeout(t);
  }, [busca]);

  // Reset page ao mudar filtros
  useEffect(() => {
    setPage(1);
  }, [dataDe, dataAte, tipo, statusF, origem, classe, konto, ccCode, buscaDebounced]);

  const filtros: MasterFiltros = useMemo(
    () => ({
      data_de: dataDe ? format(dataDe, "yyyy-MM-dd") : null,
      data_ate: dataAte ? format(dataAte, "yyyy-MM-dd") : null,
      tipo: (tipo || null) as any,
      status: (statusF || null) as any,
      origem: (origem || null) as any,
      classe_codigo: classe || null,
      konto_at_numero: konto || null,
      cc_erp_code: ccCode || null,
      busca: buscaDebounced || null,
    }),
    [dataDe, dataAte, tipo, statusF, origem, classe, konto, ccCode, buscaDebounced],
  );

  const filtrosAtivos = useMemo(() => {
    return Object.values(filtros).filter((v) => v !== null && v !== "").length;
  }, [filtros]);

  // ─── Queries ──────────────────────────────────────────────────────────
  const filtrosQuery = useQuery({
    queryKey: ["intercompany_master_filtros_disponiveis"],
    queryFn: buscarFiltrosDisponiveis,
    staleTime: 5 * 60 * 1000,
  });

  const listQuery = useQuery({
    queryKey: ["intercompany_master_list", filtros, page],
    queryFn: () => listarMaster(filtros, page, PAGE_SIZE),
  });

  const filtrosDisp: MasterFiltrosDisponiveis | undefined = filtrosQuery.data;

  // ─── Handlers ─────────────────────────────────────────────────────────
  const limparFiltros = () => {
    setDataDe(undefined);
    setDataAte(undefined);
    setTipo("");
    setStatusF("");
    setOrigem("");
    setClasse("");
    setKonto("");
    setCcCode("");
    setBusca("");
  };

  const handleExportar = async () => {
    setExportando(true);
    try {
      const [items, blocos, consolidado] = await Promise.all([
        buscarTudoParaExportar(filtros),
        exportarBlocosIntercompany(filtros),
        resumoConsolidadoIntercompany(),
      ]);

      const wb = buildIntercompanyWorkbook(items as any[], blocos, consolidado);
      const dataStr = format(new Date(), "yyyy-MM-dd_HH-mm");
      XLSX.writeFile(wb, `intercompany_report_${dataStr}.xlsx`, { cellStyles: true });
    } catch (err) {
      console.error("Erro ao exportar:", err);
      toast.error(`${t("icm.toast.export_fail")}: ${(err as Error).message}`);
    } finally {
      setExportando(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("icm.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("icm.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`} />
            {t("icm.btn.refresh")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportar} disabled={exportando || listQuery.isLoading}>
            {exportando ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                {t("icm.btn.exporting")}
              </>
            ) : (
              <>
                <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
                {t("icm.btn.export")}
              </>
            )}
          </Button>
          <Button size="sm" onClick={() => navigate("/intercompany/reembolsos/novo")}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("icm.btn.new_reembolso")}
          </Button>
        </div>
      </div>

      {/* Barra de Filtros */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{t("icm.filters.title")}</span>
              {filtrosAtivos > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {filtrosAtivos} {t("icm.filters.active")}
                </Badge>
              )}
            </div>
            {filtrosAtivos > 0 && (
              <Button variant="ghost" size="sm" onClick={limparFiltros} className="h-7 text-xs">
                <X className="mr-1 h-3 w-3" />
                {t("icm.filters.clear")}
              </Button>
            )}
          </div>

          {/* Linha 1 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">{t("icm.filters.date_from")}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-full justify-start text-left font-normal h-9 text-xs",
                      !dataDe && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {dataDe ? format(dataDe, "dd/MM/yyyy", { locale: ptBR }) : "—"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dataDe} onSelect={setDataDe} initialFocus locale={ptBR} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">{t("icm.filters.date_to")}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-full justify-start text-left font-normal h-9 text-xs",
                      !dataAte && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {dataAte ? format(dataAte, "dd/MM/yyyy", { locale: ptBR }) : "—"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dataAte} onSelect={setDataAte} initialFocus locale={ptBR} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">{t("icm.filters.type")}</Label>
              <Select value={tipo || "_all"} onValueChange={(v) => setTipo(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={t("icm.opt.all_m")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">{t("icm.opt.all_m")}</SelectItem>
                  {(filtrosDisp?.tipos ?? []).map((tp) => (
                    <SelectItem key={tp} value={tp}>
                      {tipoLabel(language, tp)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">{t("icm.filters.status")}</Label>
              <Select value={statusF || "_all"} onValueChange={(v) => setStatusF(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={t("icm.opt.all_m")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">{t("icm.opt.all_m")}</SelectItem>
                  {(filtrosDisp?.status ?? []).map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {STATUS_I18N[s.value as MasterStatusUnificado]?.[language] ?? s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">{t("icm.filters.origin")}</Label>
              <Select value={origem || "_all"} onValueChange={(v) => setOrigem(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={t("icm.opt.all_f")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">{t("icm.opt.all_f")}</SelectItem>
                  {(filtrosDisp?.origens ?? []).map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Linha 2 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">{t("icm.filters.class")}</Label>
              <Select value={classe || "_all"} onValueChange={(v) => setClasse(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={t("icm.opt.all_f")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">{t("icm.opt.all_f")}</SelectItem>
                  {(filtrosDisp?.classes ?? []).map((c) => (
                    <SelectItem key={c.codigo} value={c.codigo}>
                      <span className="font-mono mr-1.5">{c.codigo}</span>
                      <span className="text-muted-foreground">{c.nome}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">{t("icm.filters.konto")}</Label>
              <Select value={konto || "_all"} onValueChange={(v) => setKonto(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={t("icm.opt.all_m")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">{t("icm.opt.all_m")}</SelectItem>
                  {(filtrosDisp?.kontos ?? []).map((k) => (
                    <SelectItem key={k.numero} value={k.numero}>
                      <span className="font-mono mr-1.5">{k.numero}</span>
                      <span className="text-muted-foreground">{k.descricao}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">{t("icm.filters.cost_center")}</Label>
              <Popover open={ccPopoverOpen} onOpenChange={setCcPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-between h-9 text-xs font-normal">
                    {ccCode ? (
                      <span className="truncate text-left font-mono">{ccCode}</span>
                    ) : (
                      <span className="text-muted-foreground">{t("icm.opt.all_m")}</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder={t("icm.filters.search_cc")}
                      value={ccSearch}
                      onValueChange={setCcSearch}
                    />
                    <CommandList>
                      <CommandEmpty>{t("icm.filters.no_cc")}</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          onSelect={() => {
                            setCcCode("");
                            setCcPopoverOpen(false);
                            setCcSearch("");
                          }}
                        >
                          <span className="text-muted-foreground">{t("icm.opt.all_m")}</span>
                        </CommandItem>
                        {(filtrosDisp?.ccs ?? [])
                          .filter((cc) => {
                            const q = ccSearch.trim().toLowerCase();
                            if (!q) return true;
                            return cc.name.toLowerCase().includes(q) || cc.erp_code.toLowerCase().includes(q);
                          })
                          .slice(0, 50)
                          .map((cc) => (
                            <CommandItem
                              key={cc.erp_code}
                              value={cc.erp_code}
                              onSelect={() => {
                                setCcCode(cc.erp_code);
                                setCcPopoverOpen(false);
                                setCcSearch("");
                              }}
                            >
                              <div className="flex flex-col">
                                <span className="text-sm">{cc.name}</span>
                                <span className="text-xs text-muted-foreground font-mono">{cc.erp_code}</span>
                              </div>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">{t("icm.filters.search")}</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder={t("icm.filters.search_ph")}
                  className="pl-7 h-9 text-xs"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumo — EUR herói */}
      {listQuery.data?.resumo && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("icm.sum.total_eur")}
              </span>
              <span className="font-mono text-2xl font-bold leading-none tabular-nums">
                {formatEUR(listQuery.data.resumo.soma_eur)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("icm.sum.total_brl")}
              </span>
              <span className="mt-1 font-mono text-base font-semibold leading-none tabular-nums text-muted-foreground">
                {formatBRL(listQuery.data.resumo.soma_brl)}
              </span>
            </div>

            <div className="h-8 w-px bg-border" />

            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {t("icm.sum.invoices")}
              </span>
              <span className="mt-1 text-base font-bold leading-none tabular-nums">
                {listQuery.data.resumo.total_invoices}
              </span>
            </div>
            <Badge variant="outline" className="text-[10px]">
              Hub: {listQuery.data.resumo.qtd_hub}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Alvo: {listQuery.data.resumo.qtd_alvo}
            </Badge>

            <div className="h-8 w-px bg-border hidden md:block" />

            <div className="flex flex-wrap items-center gap-1.5">
              {listQuery.data.resumo.por_status.map((s) => (
                <Badge
                  key={s.status}
                  variant="outline"
                  className={`text-[10px] border ${statusColor[s.status as MasterStatusUnificado] ?? ""}`}
                >
                  {statusLabel(language, s.status as MasterStatusUnificado)}: {s.qtd}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {listQuery.isLoading && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {/* Error */}
      {listQuery.error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-destructive">{t("icm.error.title")}</p>
              <p className="text-xs text-muted-foreground mt-1 break-words">
                {(listQuery.error as Error)?.message ?? t("icm.error.unknown")}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => listQuery.refetch()}>
              {t("icm.error.retry")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!listQuery.isLoading && !listQuery.error && listQuery.data?.items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mb-2 opacity-40" />
            <p className="text-sm">{t("icm.empty.none")}</p>
            {filtrosAtivos > 0 && (
              <Button variant="link" size="sm" onClick={limparFiltros} className="mt-2">
                {t("icm.empty.clear")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabela */}
      {!listQuery.isLoading && !listQuery.error && listQuery.data?.items && listQuery.data.items.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-1 text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-3 py-3 font-bold">{t("icm.col.invoice")}</th>
                  <th className="px-3 py-3 font-bold">{t("icm.col.date")}</th>
                  <th className="px-3 py-3 font-bold">{t("icm.col.type")}</th>
                  <th className="px-3 py-3 font-bold">{t("icm.col.konto")}</th>
                  <th className="px-3 py-3 font-bold text-right">{t("icm.col.eur")}</th>
                  <th className="px-3 py-3 font-bold">{t("icm.col.classif")}</th>
                  <th className="px-3 py-3 font-bold w-8" />
                </tr>
              </thead>
              <tbody>
                {listQuery.data.items.map((item, idx) => (
                  <MasterRow
                    key={`${item.source_table}-${item.id}`}
                    item={item}
                    index={idx}
                    onOpen={() => {
                      setDetailItem(item);
                      setDetailOpen(true);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          <div className="flex items-center justify-between border-t border-border bg-surface-1 px-4 py-2.5 text-xs">
            <span className="text-muted-foreground">
              {t("icm.pag.showing")} {listQuery.data.items.length} {t("icm.pag.of")} {listQuery.data.pagination.total} ·{" "}
              {t("icm.pag.page")} {listQuery.data.pagination.page} {t("icm.pag.of")}{" "}
              {listQuery.data.pagination.total_pages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || listQuery.isFetching}
                className="h-7 text-xs"
              >
                {t("icm.pag.prev")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= listQuery.data.pagination.total_pages || listQuery.isFetching}
                className="h-7 text-xs"
              >
                {t("icm.pag.next")}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <InvoiceDetailSheet
        item={detailItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEditCambio={() => {
          if (detailItem) {
            setCambioMasterItem(detailItem);
            setCambioModalOpen(true);
          }
        }}
      />

      <MasterCambioModal
        open={cambioModalOpen}
        onOpenChange={setCambioModalOpen}
        masterId={cambioMasterItem?.id ?? null}
        numeroInvoice={cambioMasterItem?.numero_invoice ?? null}
        valorBrl={cambioMasterItem?.valor_brl ?? null}
        cambioAtual={cambioMasterItem?.cambio ?? null}
        valorEurAtual={cambioMasterItem?.valor_eur ?? null}
        onSaved={() => {
          listQuery.refetch();
        }}
      />
    </div>
  );
}

interface MasterRowProps {
  item: MasterItem;
  index: number;
  onOpen: () => void;
}

function MasterRow({ item, index, onOpen }: MasterRowProps) {
  const { t, language } = useLanguage();
  const rowBg = index % 2 === 1 ? "bg-muted/15 hover:bg-muted/30" : "hover:bg-muted/20";

  return (
    <tr className={cn("group cursor-pointer transition-colors", rowBg)} onClick={onOpen}>
      <td className="px-3 py-2.5 font-mono text-xs tabular-nums">{item.numero_invoice ?? "—"}</td>
      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{formatDate(item.data_emissao)}</td>
      <td className="px-3 py-2.5">
        <Badge variant="outline" className="text-[10px] capitalize">
          {tipoLabel(language, item.tipo)}
        </Badge>
      </td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        {item.total_blocos === 1 ? (
          <KontoInlineEditor item={item} />
        ) : item.total_blocos > 1 ? (
          <span
            className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground"
            title={t("icm.konto.multibloco")}
          >
            {item.konto_at_numero ?? "—"}
            <Lock className="h-3 w-3 opacity-40" />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">{formatEUR(item.valor_eur)}</td>
      <td className="px-3 py-2.5">
        <StatusDot
          tone={classificationTone[item.classification_status_agregado]}
          label={classifLabel(language, item.classification_status_agregado)}
        />
      </td>
      <td className="px-3 py-2.5 text-right">
        <ChevronRight className="inline-block h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
      </td>
    </tr>
  );
}

// ─── Editor inline do Konto (célula da listagem) ─────────────────────────

function KontoInlineEditor({ item }: { item: MasterItem }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const kontosQuery = useQuery({
    queryKey: ["intercompany_kontos_ativos"],
    queryFn: listarKontosAtivos,
    staleTime: 10 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: (kontoNumero: string) => atualizarKontoBlocoInline(item.id, kontoNumero),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["intercompany_master_list"] });
    },
    onError: (err: any) => {
      toast.error(`${t("icm.toast.konto_fail")}: ${err?.message ?? t("icm.toast.error_unknown")}`);
    },
  });

  // compatível com react-query v4 (isLoading) e v5 (isPending)
  const isSaving = (mutation as any).isPending ?? (mutation as any).isLoading ?? false;
  const kontos = kontosQuery.data ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isSaving}
          className={cn(
            "group -mx-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs tabular-nums",
            "hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60",
          )}
          title={t("icm.konto.edit_title")}
        >
          {isSaving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : item.konto_at_numero ? (
            <span>{item.konto_at_numero}</span>
          ) : (
            <span className="text-warning">{t("icm.konto.set")}</span>
          )}
          <ChevronsUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder={t("icm.konto.search")} />
          <CommandList>
            <CommandEmpty>{t("icm.konto.none")}</CommandEmpty>
            <CommandGroup>
              {kontos.map((k) => (
                <CommandItem
                  key={k.numero}
                  value={`${k.numero} ${k.descricao}`}
                  onSelect={() => {
                    setOpen(false);
                    if (k.numero !== item.konto_at_numero) {
                      mutation.mutate(k.numero);
                    }
                  }}
                >
                  <span className="mr-2 font-mono text-xs tabular-nums">{k.numero}</span>
                  <span className="text-xs text-muted-foreground">{k.descricao}</span>
                  {k.numero === item.konto_at_numero && <Check className="ml-auto h-3.5 w-3.5 opacity-70" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Painel lateral de detalhe da invoice ────────────────────────────────

interface InvoiceDetailSheetProps {
  item: MasterItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditCambio: () => void;
}

// origem (enum cru do master) → bucket de Storage do PDF
const ORIGEM_BUCKET: Record<string, string> = {
  criada_hub: "intercompany-reembolso-nf",
  criada_hub_manual: "intercompany-reembolso-manual",
};

function InvoiceDetailSheet({ item, open, onOpenChange, onEditCambio }: InvoiceDetailSheetProps) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();

  const blocosQuery = useQuery({
    queryKey: ["intercompany_master_blocos", item?.id],
    queryFn: () => buscarBlocosDetalhe(item!.id),
    enabled: open && !!item && item.total_blocos > 0,
  });

  const detalheQuery = useQuery({
    queryKey: ["intercompany_master_detalhe", item?.id],
    queryFn: () => buscarDetalheMaster(item!.id),
    enabled: open && !!item,
  });

  const pagoMutation = useMutation({
    mutationFn: (pago: boolean) => definirPagoMaster(item!.id, pago),
    onSuccess: (_data, pago) => {
      queryClient.invalidateQueries({ queryKey: ["intercompany_master_detalhe", item?.id] });
      toast.success(pago ? t("icm.toast.paid_yes") : t("icm.toast.paid_no"));
    },
    onError: (err: any) => {
      toast.error(`${t("icm.toast.paid_fail")}: ${err?.message ?? t("icm.toast.error_unknown")}`);
    },
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => importarPdfAnexo(item!.id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["intercompany_master_detalhe", item?.id] });
      toast.success(t("icm.toast.pdf_imported"));
    },
    onError: (err: any) => {
      toast.error(`${t("icm.toast.pdf_import_fail")}: ${err?.message ?? t("icm.toast.error_unknown")}`);
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!item) return null;

  const detalhe = detalheQuery.data;
  const pago = detalhe?.pago ?? false;
  const pagoEm = detalhe?.pago_em ?? null;
  const anexo = detalhe?.anexos?.[0];
  const bucket = anexo?.bucket ?? (detalhe ? ORIGEM_BUCKET[detalhe.origem] : undefined);
  const isSavingPago = (pagoMutation as any).isPending ?? (pagoMutation as any).isLoading ?? false;
  const isImporting = (importMutation as any).isPending ?? (importMutation as any).isLoading ?? false;

  const handleBaixarPdf = async () => {
    if (!anexo || !bucket) return;
    const ok = await downloadIntercompanyPdf(bucket, anexo.storage_path, anexo.filename);
    if (ok) toast.success(t("icm.toast.pdf_downloaded"));
    else toast.error(t("icm.toast.pdf_download_fail"));
  };

  const handlePickFile = () => fileInputRef.current?.click();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-md">
        {/* Cabeçalho herói */}
        <SheetHeader className="space-y-2 border-b border-border bg-surface-1 px-6 py-5 text-left">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="font-mono text-lg tabular-nums">{item.numero_invoice ?? "—"}</SheetTitle>
            <StatusDot
              tone={statusTone[item.status_unificado] ?? "muted"}
              label={statusLabel(language, item.status_unificado)}
            />
          </div>
          <p className="font-mono text-2xl font-bold tabular-nums">{formatEUR(item.valor_eur)}</p>
        </SheetHeader>

        <div className="space-y-5 px-6 py-5">
          {/* RESUMO */}
          <DetailSection title={t("icm.panel.summary")}>
            <DetailGrid>
              <DetailField label={t("icm.f.type")} value={tipoLabel(language, item.tipo)} />
              <DetailField label={t("icm.f.specie")} value={item.especie} />
              <DetailField label={t("icm.f.issue_date")} value={formatDate(item.data_emissao)} mono />
              <DetailField label={t("icm.f.origin")} value={item.origem} />
            </DetailGrid>
            {item.status_motivo && (
              <div className="mt-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs">
                <span className="font-medium text-warning">Status:</span>{" "}
                <span className="text-warning">{item.status_motivo}</span>
              </div>
            )}
          </DetailSection>

          {/* VALORES */}
          <DetailSection title={t("icm.panel.values")}>
            <DetailGrid>
              <DetailField label={t("icm.f.eur")} value={formatEUR(item.valor_eur)} mono />
              <DetailField label={t("icm.f.brl")} value={formatBRL(item.valor_brl)} mono />
              <DetailField
                label={t("icm.f.exchange")}
                value={item.cambio == null ? "—" : item.cambio.toLocaleString("pt-BR", { minimumFractionDigits: 4 })}
                mono
              />
            </DetailGrid>
          </DetailSection>

          {/* CLASSIFICAÇÃO */}
          <DetailSection title={t("icm.panel.classification")}>
            <DetailGrid>
              <DetailField label={t("icm.f.class_br")} value={item.classe_codigo ?? "—"} mono />
              <DetailField label={t("icm.f.class_name")} value={item.classe_nome ?? "—"} />
              <DetailField label={t("icm.f.konto")} value={item.konto_at_numero ?? "—"} mono />
              <DetailField label={t("icm.f.konto_desc")} value={item.konto_at_descricao ?? "—"} />
            </DetailGrid>
            <div className="mt-2">
              <StatusDot
                tone={classificationTone[item.classification_status_agregado]}
                label={classifLabel(language, item.classification_status_agregado)}
              />
            </div>
          </DetailSection>

          {/* DOCUMENTO (ALVO) */}
          <DetailSection title={t("icm.panel.document")}>
            <DetailGrid>
              <DetailField label={t("icm.f.doc_number")} value={item.numero_documento_alvo ?? "—"} mono />
              <DetailField
                label={t("icm.f.alvo_key")}
                value={item.chave_docfin_alvo ? String(item.chave_docfin_alvo) : "—"}
                mono
              />
              <DetailField label={t("icm.f.category")} value={item.origem_categoria ?? "—"} />
            </DetailGrid>
            {item.descricao && (
              <div className="mt-2 text-xs">
                <span className="uppercase tracking-wide text-muted-foreground">{t("icm.panel.description")}</span>
                <p className="mt-0.5 italic">{item.descricao}</p>
              </div>
            )}
          </DetailSection>

          {/* BLOCOS & RATEIOS */}
          {item.total_blocos > 0 && (
            <DetailSection title={`${t("icm.panel.blocks")} (${item.total_blocos})`}>
              {blocosQuery.isLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("icm.panel.loading_blocks")}
                </div>
              )}
              {blocosQuery.data && blocosQuery.data.length > 0 && (
                <div className="space-y-2">
                  {blocosQuery.data.map((bloco) => (
                    <BlocoCard key={bloco.id} bloco={bloco} />
                  ))}
                </div>
              )}
            </DetailSection>
          )}

          {/* AÇÕES */}
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {t("icm.panel.actions")}
            </p>

            {/* Pago — liga/desliga */}
            <div className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="text-sm">{t("icm.act.paid")}</span>
                  {pago && pagoEm && (
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {t("icm.act.paid_on")} {format(new Date(pagoEm), "dd/MM/yyyy")}
                    </span>
                  )}
                </div>
                {isSavingPago && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              <Switch
                checked={pago}
                disabled={isSavingPago || detalheQuery.isLoading}
                onCheckedChange={(v) => pagoMutation.mutate(v)}
              />
            </div>

            {/* Editar câmbio */}
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={onEditCambio}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              {t("icm.act.edit_exchange")}
            </Button>

            {/* PDF: baixar / importar / substituir */}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) importMutation.mutate(f);
              }}
            />
            {anexo ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  disabled={!bucket}
                  onClick={handleBaixarPdf}
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  {t("icm.act.download_pdf")}
                </Button>
                {anexo.origem === "importado" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-muted-foreground"
                    disabled={isImporting}
                    onClick={handlePickFile}
                  >
                    {isImporting ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-3.5 w-3.5" />
                    )}
                    {t("icm.act.replace_pdf")}
                  </Button>
                )}
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                disabled={isImporting || detalheQuery.isLoading}
                onClick={handlePickFile}
              >
                {isImporting ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-3.5 w-3.5" />
                )}
                {t("icm.act.import_pdf")}
              </Button>
            )}

            {/* Marcar reconciliado — em breve */}
            <Button variant="outline" size="sm" className="w-full justify-start" disabled title={t("icm.act.soon")}>
              <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
              {t("icm.act.mark_reconciled")}
              <Badge variant="secondary" className="ml-auto text-[9px]">
                {t("icm.act.soon")}
              </Badge>
            </Button>

            {/* Ir para classificação — em breve */}
            <Button variant="outline" size="sm" className="w-full justify-start" disabled title={t("icm.act.soon")}>
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              {t("icm.act.go_classify")}
              <Badge variant="secondary" className="ml-auto text-[9px]">
                {t("icm.act.soon")}
              </Badge>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function DetailGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">{children}</div>;
}

// ─── Card de cada bloco ──────────────────────────────────────────────────

function BlocoCard({ bloco }: { bloco: MasterBlocoDetalhe }) {
  const { t, language } = useLanguage();
  const classEmoji = classificationEmoji[bloco.classification_status];

  return (
    <div className="rounded-md border border-border bg-surface-3 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold">
              {t("icm.bloco.block")} #{bloco.ordem}
            </span>
            {bloco.tipo_bloco && (
              <Badge variant="outline" className="text-[9px]">
                {bloco.tipo_bloco}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-[9px] border ${classificationColor[bloco.classification_status]}`}
            >
              <span className="mr-1 font-bold">{classEmoji}</span>
              {classifLabel(language, bloco.classification_status)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{bloco.descricao}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-mono font-semibold tabular-nums">{formatEUR(bloco.valor_eur)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-[10px] pt-2 border-t border-border/50">
        <div>
          <span className="text-muted-foreground uppercase tracking-wide">{t("icm.bloco.class_br")}</span>
          <p className="font-mono tabular-nums">{bloco.classe_codigo ?? "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground uppercase tracking-wide">{t("icm.bloco.konto")}</span>
          <p className="font-mono tabular-nums">{bloco.konto_at_numero ?? "—"}</p>
        </div>
        {bloco.konto_at_descricao && (
          <div>
            <span className="text-muted-foreground uppercase tracking-wide">{t("icm.bloco.konto_desc")}</span>
            <p>{bloco.konto_at_descricao}</p>
          </div>
        )}
      </div>

      {/* Rateios CC */}
      {bloco.rateios.length > 0 && (
        <div className="pt-2 border-t border-border/50">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            {t("icm.bloco.cost_centers")} ({bloco.rateios.length})
          </p>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="font-medium pb-1">{t("icm.bloco.cc")}</th>
                <th className="font-medium pb-1">{t("icm.bloco.name")}</th>
                <th className="font-medium text-right pb-1">%</th>
                <th className="font-medium text-right pb-1">EUR</th>
              </tr>
            </thead>
            <tbody>
              {bloco.rateios.map((r) => (
                <tr key={r.centro_custo_erp_code}>
                  <td className="font-mono py-0.5 tabular-nums">{r.centro_custo_erp_code}</td>
                  <td>{r.centro_custo_nome ?? "—"}</td>
                  <td className="text-right font-mono tabular-nums">{r.percentual.toFixed(2)}%</td>
                  <td className="text-right font-mono tabular-nums">{formatEUR(r.valor_eur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-muted-foreground uppercase tracking-wide block">{label}</span>
      <span className={cn("text-foreground", mono && "font-mono tabular-nums")}>{value}</span>
    </div>
  );
}
