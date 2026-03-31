import { useEffect, useState, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { format, parse } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/contexts/PeriodContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Plus, MoreHorizontal, Pencil, Trash2,
  ArrowUpRight, ArrowDownLeft, RefreshCw, Link2,
  CalendarIcon, AlertCircle, ChevronLeft, ChevronRight,
  Download, Banknote,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import SyncModal from "@/components/SyncModal";
import IntercompanyFilters from "@/components/intercompany/IntercompanyFilters";
import IntercompanySummaryCards from "@/components/intercompany/IntercompanySummaryCards";
import PaymentUpdateModal from "@/components/PaymentUpdateModal";
import MonthYearPicker from "@/components/MonthYearPicker";
import type { PaymentUpdateItem } from "@/services/paymentStatusUpdater";

interface IntercompanyRow {
  id: string;
  period_id: string;
  related_company: string;
  country: string;
  transaction_type: string;
  description: string;
  currency: string;
  original_amount: number;
  exchange_rate: number;
  amount_brl: number;
  direction: string;
  document_reference: string | null;
  due_date: string | null;
  status: string;
  notes: string | null;
  source: string;
  doc_type: string | null;
  nf_number: string | null;
  nf_series: string | null;
  nf_model: string | null;
  issue_date: string | null;
  cfop: string | null;
  invoice_reference: string | null;
  service_value: number | null;
  product_value: number | null;
  tax_total: number | null;
  freight_value: number | null;
  alvo_document_id: string | null;
  alvo_entity_code: string | null;
  competence_date: string | null;
  docfin_key: number | null;
  payment_status: string | null;
  payment_date: string | null;
  payment_exchange_rate: number | null;
  payment_amount_brl: number | null;
  fx_variation: number | null;
  payment_additions: number | null;
  payment_deductions: number | null;
}

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatCurrency = (v: number, cur: string) => {
  const symbols: Record<string, string> = { BRL: "R$", USD: "US$", EUR: "€", GBP: "£" };
  const sym = symbols[cur] ?? cur;
  return `${sym} ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const formatDualCurrency = (r: { original_amount: number; currency: string; amount_brl: number }) => {
  if (r.currency === "BRL") return formatBRL(r.original_amount);
  return `${formatBRL(Number(r.amount_brl))} | ${formatCurrency(r.original_amount, r.currency)}`;
};
const formatDate = (d: string) => { const [y, m, day] = d.split("-"); return `${day}/${m}/${y}`; };
const formatOptionalBRL = (v: number | null) => v != null ? formatBRL(v) : "—";

const DOC_TYPE_BADGE: Record<string, { label: string; className: string }> = {
  "nf-e": { label: "NF-e", className: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
  "nfs-e": { label: "NFS-e", className: "bg-primary/15 text-primary border-primary/30" },
  "inv": { label: "INV", className: "bg-amber-500/15 text-amber-700 border-amber-500/30" },
};

const EMPTY_FORM = {
  related_company: "", country: "Brasil", transaction_type: "outros",
  description: "", currency: "BRL", original_amount: "",
  exchange_rate: "1", direction: "a_pagar", document_reference: "",
  due_date: "", status: "em_aberto", notes: "",
  cfop: "", invoice_reference: "", service_value: "", product_value: "",
  tax_total: "", freight_value: "", issue_date: "", competence_date: "",
  nf_number: "", nf_series: "", nf_model: "", docfin_key: "",
};

const PAGE_SIZE = 25;

/* ─── Date Picker Field ─── */
function DatePickerField({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const dateValue = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
  const [open, setOpen] = useState(false);

  return (
    <div>
      <label className="text-xs font-medium text-foreground">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal h-9 text-sm",
              !value && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-3.5 w-3.5" />
            {dateValue ? format(dateValue, "dd/MM/yyyy") : <span className="text-muted-foreground">Selecionar data</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={dateValue}
            onSelect={(d) => {
              onChange(d ? format(d, "yyyy-MM-dd") : "");
              setOpen(false);
            }}
            locale={ptBR}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ─── Mobile Card ─── */
function MobileRowCard({ r, t, onEdit, onDelete }: {
  r: IntercompanyRow;
  t: (key: any) => string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const getDocNumber = (r: IntercompanyRow) => {
    if (r.doc_type === "inv") return r.alvo_document_id?.split("|")[1] ?? "—";
    return r.nf_number ?? "—";
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm truncate">{r.related_company}</p>
            <p className="text-xs text-muted-foreground truncate">{r.description}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}><Pencil className="mr-2 h-4 w-4" />{t("cash.edit")}</DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />{t("cash.delete")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className={r.source === "alvo" ? "bg-primary/10 text-primary border-primary/30 text-[10px]" : "bg-muted text-muted-foreground text-[10px]"}>
            {r.source === "alvo" && <Link2 className="mr-0.5 h-2.5 w-2.5" />}
            {t(("ic.source." + r.source) as any)}
          </Badge>
          {r.doc_type && DOC_TYPE_BADGE[r.doc_type] && (
            <Badge variant="outline" className={`${DOC_TYPE_BADGE[r.doc_type].className} text-[10px]`}>
              {DOC_TYPE_BADGE[r.doc_type].label}
            </Badge>
          )}
          <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            r.direction === "a_pagar" ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
          }`}>
            {r.direction === "a_pagar" ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownLeft className="h-2.5 w-2.5" />}
            {t(("ic.dir." + r.direction) as any)}
          </span>
          <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            r.status === "liquidado" ? "bg-success/20 text-success"
            : r.status === "parcial" ? "bg-warning/20 text-warning"
            : "bg-primary/20 text-primary"
          }`}>{t(("ic.st." + r.status) as any)}</span>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("recv.amount_brl")}</span>
            <span className="font-semibold">{formatDualCurrency(r)}</span>
          </div>
          {r.doc_type && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("ic.doc_number" as any)}</span>
              <span className="font-mono">{getDocNumber(r)}</span>
            </div>
          )}
          {r.issue_date && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("ic.issue_date" as any)}</span>
              <span>{formatDate(r.issue_date)}</span>
            </div>
          )}
          {r.due_date && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("recv.due_date")}</span>
              <span>{formatDate(r.due_date)}</span>
            </div>
          )}
          {r.cfop && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">CFOP</span>
              <span className="font-mono">{r.cfop}</span>
            </div>
          )}
          {r.invoice_reference && (
            <div className="flex justify-between col-span-2">
              <span className="text-muted-foreground">{t("ic.invoice_ref" as any)}</span>
              <span className="truncate ml-2">{r.invoice_reference}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Pagination Controls ─── */
function PaginationControls({ currentPage, totalPages, onPageChange }: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages: (number | "...")[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  return (
    <div className="flex items-center justify-between pt-3 px-2">
      <span className="text-xs text-muted-foreground">
        Página {currentPage} de {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">…</span>
          ) : (
            <Button
              key={p}
              variant={p === currentPage ? "default" : "outline"}
              size="icon"
              className="h-7 w-7 text-xs"
              onClick={() => onPageChange(p)}
            >
              {p}
            </Button>
          )
        )}
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function Intercompany() {
  const { periods, selectedPeriod, setSelectedPeriod } = usePeriod();
  const { t } = useLanguage();
  const { session } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const [rows, setRows] = useState<IntercompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editSource, setEditSource] = useState<string>("manual");
  const [form, setForm] = useState(EMPTY_FORM);
  const [showSync, setShowSync] = useState(false);
  const [showPaymentUpdate, setShowPaymentUpdate] = useState(false);
  const [paymentUpdateItems, setPaymentUpdateItems] = useState<PaymentUpdateItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const [sourceFilter, setSourceFilter] = useState("all");
  const [docTypeFilter, setDocTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchData = useCallback(async () => {
    if (!selectedPeriod) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from("intercompany")
        .select("*")
        .eq("period_id", selectedPeriod.id)
        .order("issue_date", { ascending: false, nullsFirst: false });
      if (fetchErr) throw fetchErr;
      if (data) setRows(data as unknown as IntercompanyRow[]);
    } catch (err: any) {
      console.error("Erro ao carregar intercompany:", err);
      setError(err.message || "Erro ao carregar dados. Verifique sua conexão e tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1); }, [sourceFilter, docTypeFilter, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    let r = rows;
    if (sourceFilter !== "all") r = r.filter(x => x.source === sourceFilter);
    if (docTypeFilter !== "all") r = r.filter(x => x.doc_type === docTypeFilter);
    if (dateFrom) r = r.filter(x => x.issue_date && x.issue_date >= dateFrom);
    if (dateTo) r = r.filter(x => x.issue_date && x.issue_date <= dateTo);
    return r;
  }, [rows, sourceFilter, docTypeFilter, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  const openAdd = () => { setEditId(null); setEditSource("manual"); setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit = (r: IntercompanyRow) => {
    setEditId(r.id);
    setEditSource(r.source);
    setForm({
      related_company: r.related_company, country: r.country,
      transaction_type: r.transaction_type, description: r.description,
      currency: r.currency, original_amount: String(r.original_amount),
      exchange_rate: String(r.exchange_rate), direction: r.direction,
      document_reference: r.document_reference ?? "", due_date: r.due_date ?? "",
      status: r.status, notes: r.notes ?? "",
      cfop: r.cfop ?? "", invoice_reference: r.invoice_reference ?? "",
      service_value: r.service_value != null ? String(r.service_value) : "",
      product_value: r.product_value != null ? String(r.product_value) : "",
      tax_total: r.tax_total != null ? String(r.tax_total) : "",
      freight_value: r.freight_value != null ? String(r.freight_value) : "",
      issue_date: r.issue_date ?? "", competence_date: r.competence_date ?? "",
      nf_number: r.nf_number ?? "", nf_series: r.nf_series ?? "", nf_model: r.nf_model ?? "",
      docfin_key: r.docfin_key != null ? String(r.docfin_key) : "",
    });
    setShowForm(true);
  };

  const computedBRL = (parseFloat(form.original_amount) || 0) * (parseFloat(form.exchange_rate) || 1);

  const saveForm = async () => {
    if (!selectedPeriod) return;
    const payload: Record<string, any> = {
      period_id: selectedPeriod.id,
      related_company: form.related_company.trim(),
      country: form.country.trim(),
      transaction_type: form.transaction_type,
      description: form.description.trim(),
      currency: form.currency,
      original_amount: parseFloat(form.original_amount) || 0,
      exchange_rate: form.currency === "BRL" ? 1 : (parseFloat(form.exchange_rate) || 1),
      direction: form.direction,
      document_reference: form.document_reference.trim() || null,
      due_date: form.due_date || null,
      status: form.status,
      notes: form.notes.trim() || null,
      responsible_user: session?.user?.id,
      cfop: form.cfop.trim() || null,
      invoice_reference: form.invoice_reference.trim() || null,
      service_value: form.service_value ? parseFloat(form.service_value) : null,
      product_value: form.product_value ? parseFloat(form.product_value) : null,
      tax_total: form.tax_total ? parseFloat(form.tax_total) : null,
      freight_value: form.freight_value ? parseFloat(form.freight_value) : null,
      issue_date: form.issue_date || null,
      competence_date: form.competence_date || null,
      nf_number: form.nf_number.trim() || null,
      nf_series: form.nf_series.trim() || null,
      nf_model: form.nf_model.trim() || null,
      docfin_key: form.docfin_key ? parseInt(form.docfin_key) : null,
    };
    try {
      if (editId) {
        const { error } = await supabase.from("intercompany").update(payload as any).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("intercompany").insert(payload as any);
        if (error) throw error;
      }
      setShowForm(false);
      toast({ title: t("cash.saved") });
      fetchData();
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    }
  };

  const deleteRow = async (r: IntercompanyRow) => {
    try {
      if (r.source === "alvo" && r.alvo_document_id) {
        await supabase.from("intercompany_alvo_docs").delete().eq("alvo_document_id", r.alvo_document_id);
      }
      const { error } = await supabase.from("intercompany").delete().eq("id", r.id);
      if (error) throw error;
      toast({ title: t("cash.deleted") });
      fetchData();
    } catch (err: any) {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const exportToExcel = () => {
    const exportRows = filtered.map(r => ({
      "Origem": r.source === "alvo" ? "Alvo" : "Manual",
      "Tipo Doc": r.doc_type ? (DOC_TYPE_BADGE[r.doc_type]?.label ?? r.doc_type) : "",
      "Empresa": r.related_company,
      "País": r.country,
      "Tipo Transação": r.transaction_type,
      "Direção": r.direction === "a_pagar" ? "A Pagar" : "A Receber",
      "Moeda": r.currency,
      "Valor Original": r.original_amount,
      "Câmbio": r.exchange_rate,
      "Valor BRL": r.amount_brl,
      "Nº Documento": r.doc_type === "inv" ? (r.alvo_document_id?.split("|")[1] ?? "") : (r.nf_number ?? ""),
      "Data Emissão": r.issue_date ? formatDate(r.issue_date) : "",
      "Data Competência": r.competence_date ? formatDate(r.competence_date) : "",
      "CFOP": r.cfop ?? "",
      "Ref. Invoice": r.invoice_reference ?? "",
      "Valor Serviço": r.service_value ?? "",
      "Valor Produto": r.product_value ?? "",
      "Frete": r.freight_value ?? "",
      "Impostos": r.tax_total ?? "",
      "Vencimento": r.due_date ? formatDate(r.due_date) : "",
      "Status": r.status,
      "Descrição": r.description,
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Intercompany");

    const periodLabel = selectedPeriod
      ? `${String(selectedPeriod.month).padStart(2, "0")}-${selectedPeriod.year}`
      : "export";
    XLSX.writeFile(wb, `intercompany_${periodLabel}.xlsx`);
  };

  const getDocNumber = (r: IntercompanyRow) => {
    if (r.doc_type === "inv") return r.alvo_document_id?.split("|")[1] ?? "—";
    return r.nf_number ?? "—";
  };

  return (
    <div className="w-full space-y-4 p-3 sm:p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl sm:text-2xl font-bold text-foreground">{t("ic.title")}</h1>
        <MonthYearPicker
          value={selectedPeriod ? `${selectedPeriod.year}-${String(selectedPeriod.month).padStart(2, "0")}` : "2026-01"}
          onChange={(val) => {
            const [y, m] = val.split("-").map(Number);
            const found = periods.find(p => p.year === y && p.month === m);
            if (found) setSelectedPeriod(found);
          }}
        />
      </div>

      {/* Error alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Erro de conexão</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{error}</span>
            <Button variant="outline" size="sm" className="w-fit" onClick={fetchData}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <IntercompanySummaryCards rows={rows as any} />

      <div className="space-y-3">
        {/* Toolbar: filters + actions */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <IntercompanyFilters
            sourceFilter={sourceFilter} onSourceChange={setSourceFilter}
            docTypeFilter={docTypeFilter} onDocTypeChange={setDocTypeFilter}
            dateFrom={dateFrom} onDateFromChange={setDateFrom}
            dateTo={dateTo} onDateToChange={setDateTo}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={exportToExcel} variant="outline" size="sm" className="text-xs">
              <Download className="mr-1.5 h-3.5 w-3.5" />Exportar Excel
            </Button>
            <Button onClick={() => setShowSync(true)} variant="outline" size="sm" className="text-xs">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Sincronizar Alvo
            </Button>
            <Button
              onClick={() => {
                const eligible = rows.filter(r => r.docfin_key != null && r.source === "alvo");
                if (eligible.length === 0) {
                  toast({ title: "Nenhum título com chave DocFin encontrado" });
                  return;
                }
                setPaymentUpdateItems(eligible.map(r => ({
                  id: r.id,
                  docfin_key: r.docfin_key!,
                  amount_brl: r.amount_brl,
                  currency: r.currency,
                })));
                setShowPaymentUpdate(true);
              }}
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={!rows.some(r => r.docfin_key != null)}
              title={!rows.some(r => r.docfin_key != null) ? "Nenhum DocFin mapeado" : undefined}
            >
              <Banknote className="mr-1.5 h-3.5 w-3.5" />Atualizar Pagamentos
            </Button>
            <Button onClick={openAdd} size="sm" className="text-xs">
              <Plus className="mr-1.5 h-3.5 w-3.5" />{t("ic.add_transaction")}
            </Button>
          </div>
        </div>

        {/* Results count */}
        {filtered.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {filtered.length} registro{filtered.length !== 1 ? "s" : ""} encontrado{filtered.length !== 1 ? "s" : ""}
            {filtered.length !== rows.length && ` (de ${rows.length} total)`}
          </div>
        )}

        {/* Mobile: Card list */}
        {isMobile ? (
          <div className="space-y-3">
            {paginatedRows.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">{t("generic.no_entries")}</CardContent></Card>
            ) : paginatedRows.map(r => (
              <MobileRowCard key={r.id} r={r} t={t} onEdit={() => openEdit(r)} onDelete={() => deleteRow(r)} />
            ))}
            <PaginationControls currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
          </div>
        ) : (
          /* Desktop: Compact table — 11 columns */
          <Card className="border-[0.5px]">
            <CardContent className="p-0">
              <TooltipProvider delayDuration={200}>
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="px-2 py-2 whitespace-nowrap">Tipo</TableHead>
                      <TableHead className="px-2 py-2 whitespace-nowrap">{t("ic.company")}</TableHead>
                      <TableHead className="px-2 py-2 whitespace-nowrap">{t("ic.doc_number" as any)}</TableHead>
                      <TableHead className="px-2 py-2 whitespace-nowrap">{t("ic.issue_date" as any)}</TableHead>
                      <TableHead className="px-2 py-2 whitespace-nowrap">{t("recv.due_date")}</TableHead>
                      <TableHead className="px-2 py-2 whitespace-nowrap text-right">{t("recv.amount_brl")}</TableHead>
                      <TableHead className="px-2 py-2 whitespace-nowrap">Pgto Status</TableHead>
                      <TableHead className="px-2 py-2 whitespace-nowrap">Data Pgto</TableHead>
                      <TableHead className="px-2 py-2 whitespace-nowrap text-right">Valor Recebido</TableHead>
                      <TableHead className="px-2 py-2 whitespace-nowrap text-right">Var. Cambial</TableHead>
                      <TableHead className="px-2 py-2 w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRows.length === 0 ? (
                      <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">{t("generic.no_entries")}</TableCell></TableRow>
                    ) : paginatedRows.map(r => {
                      const fiscalDetails = [
                        r.cfop && `CFOP: ${r.cfop}`,
                        r.invoice_reference && `Invoice: ${r.invoice_reference}`,
                        r.service_value != null && `Serviço: ${formatBRL(r.service_value)}`,
                        r.product_value != null && `Produto: ${formatBRL(r.product_value)}`,
                        r.tax_total != null && `Impostos: ${formatBRL(r.tax_total)}`,
                        r.freight_value != null && `Frete: ${formatBRL(r.freight_value)}`,
                      ].filter(Boolean);

                      const paymentTooltipDetails = [
                        r.payment_exchange_rate != null && `Câmbio baixa: ${r.payment_exchange_rate.toLocaleString("pt-BR", { minimumFractionDigits: 4 })}`,
                        r.payment_additions != null && (r.payment_additions as number) > 0 && `Acréscimos: ${formatBRL(r.payment_additions as number)}`,
                        r.payment_deductions != null && (r.payment_deductions as number) > 0 && `Descontos: ${formatBRL(r.payment_deductions as number)}`,
                      ].filter(Boolean);

                      return (
                        <TableRow key={r.id}>
                          {/* Tipo + Direção combined */}
                          <TableCell className="px-2 py-1.5">
                            <div className="flex items-center gap-1">
                              <span className={r.direction === "a_pagar" ? "text-destructive" : "text-success"}>
                                {r.direction === "a_pagar" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                              </span>
                              {r.doc_type && DOC_TYPE_BADGE[r.doc_type] ? (
                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${DOC_TYPE_BADGE[r.doc_type].className}`}>
                                  {DOC_TYPE_BADGE[r.doc_type].label}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-[10px]">{t(("ic.tt." + r.transaction_type) as any)}</span>
                              )}
                              {r.source === "alvo" && <Link2 className="h-2.5 w-2.5 text-primary" />}
                            </div>
                          </TableCell>

                          {/* Empresa */}
                          <TableCell className="px-2 py-1.5 font-medium max-w-[140px] truncate">{r.related_company}</TableCell>

                          {/* Nº Doc — with fiscal tooltip */}
                          <TableCell className="px-2 py-1.5 font-mono">
                            {fiscalDetails.length > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help underline decoration-dotted underline-offset-2">{getDocNumber(r)}</span>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs max-w-xs">
                                  <div className="space-y-0.5">
                                    {fiscalDetails.map((d, i) => <div key={i}>{d as string}</div>)}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            ) : getDocNumber(r)}
                          </TableCell>

                          {/* Emissão */}
                          <TableCell className="px-2 py-1.5">{r.issue_date ? formatDate(r.issue_date) : "—"}</TableCell>

                          {/* Vencimento */}
                          <TableCell className="px-2 py-1.5 text-muted-foreground">{r.due_date ? formatDate(r.due_date) : "—"}</TableCell>

                          {/* Valor (dual currency) */}
                          <TableCell className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">{formatDualCurrency(r)}</TableCell>

                          {/* Pgto Status */}
                          <TableCell className="px-2 py-1.5">
                            {r.payment_status && r.payment_status !== "em_aberto" ? (
                              <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                r.payment_status === "recebido" ? "bg-success/20 text-success"
                                : r.payment_status === "parcial" ? "bg-warning/20 text-warning"
                                : "bg-muted text-muted-foreground"
                              }`}>
                                {r.payment_status === "recebido" ? "Recebido" : r.payment_status === "parcial" ? "Parcial" : "Em Aberto"}
                              </span>
                            ) : r.docfin_key ? (
                              <span className="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground">Em Aberto</span>
                            ) : "—"}
                          </TableCell>

                          {/* Data Pgto */}
                          <TableCell className="px-2 py-1.5 text-muted-foreground">{r.payment_date ? formatDate(r.payment_date) : "—"}</TableCell>

                          {/* Valor Recebido — with payment details tooltip */}
                          <TableCell className="px-2 py-1.5 text-right font-semibold">
                            {r.payment_amount_brl != null ? (
                              paymentTooltipDetails.length > 0 ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help">{formatBRL(r.payment_amount_brl)}</span>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="text-xs max-w-xs">
                                    <div className="space-y-0.5">
                                      {paymentTooltipDetails.map((d, i) => <div key={i}>{d as string}</div>)}
                                    </div>
                                  </TooltipContent>
                                </Tooltip>
                              ) : formatBRL(r.payment_amount_brl)
                            ) : "—"}
                          </TableCell>

                          {/* Var. Cambial */}
                          <TableCell className={`px-2 py-1.5 text-right font-semibold ${
                            r.fx_variation != null ? (r.fx_variation > 0 ? "text-success" : r.fx_variation < 0 ? "text-destructive" : "") : ""
                          }`}>
                            {r.fx_variation != null ? formatBRL(r.fx_variation) : "—"}
                          </TableCell>

                          {/* Ações */}
                          <TableCell className="px-2 py-1.5">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEdit(r)}><Pencil className="mr-2 h-4 w-4" />{t("cash.edit")}</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => deleteRow(r)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />{t("cash.delete")}</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TooltipProvider>
              <PaginationControls currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Modal form */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? t("cash.edit") : t("ic.add_transaction")}</DialogTitle>
            {editId && (
              <Badge variant="outline" className="w-fit mt-1">
                {t(("ic.source." + editSource) as any)}
              </Badge>
            )}
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground">{t("ic.company")}</label>
                <Input value={form.related_company} onChange={e => setForm(f => ({ ...f, related_company: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">{t("ic.country")}</label>
                <Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground">{t("ic.type")}</label>
                <Select value={form.transaction_type} onValueChange={v => setForm(f => ({ ...f, transaction_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["emprestimo", "servico", "royalty", "reembolso", "exportacao", "importacao", "outros"].map(v => (
                      <SelectItem key={v} value={v}>{t(("ic.tt." + v) as any)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">{t("ic.direction_label")}</label>
                <Select value={form.direction} onValueChange={v => setForm(f => ({ ...f, direction: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="a_pagar">{t("ic.dir.a_pagar")}</SelectItem>
                    <SelectItem value="a_receber">{t("ic.dir.a_receber")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">{t("ic.description_label")}</label>
              <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground">{t("recv.currency")}</label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v, exchange_rate: v === "BRL" ? "1" : f.exchange_rate }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BRL">BRL</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">{t("recv.original_amount")}</label>
                <Input type="number" step="0.01" value={form.original_amount} onChange={e => setForm(f => ({ ...f, original_amount: e.target.value }))} />
              </div>
              {form.currency !== "BRL" && (
                <div>
                  <label className="text-xs font-medium text-foreground">{t("recv.exchange_rate")}</label>
                  <Input type="number" step="0.0001" value={form.exchange_rate} onChange={e => setForm(f => ({ ...f, exchange_rate: e.target.value }))} />
                </div>
              )}
            </div>
            {form.currency !== "BRL" && (
              <div className="text-xs text-muted-foreground">{t("recv.amount_brl")}: <strong>{formatBRL(computedBRL)}</strong></div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground">{t("ic.doc_number" as any)}</label>
                <Input value={form.nf_number} onChange={e => setForm(f => ({ ...f, nf_number: e.target.value }))} placeholder="Ex: 4259" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">Série</label>
                <Input value={form.nf_series} onChange={e => setForm(f => ({ ...f, nf_series: e.target.value }))} placeholder="Ex: 1" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">Modelo</label>
                <Input value={form.nf_model} onChange={e => setForm(f => ({ ...f, nf_model: e.target.value }))} placeholder="Ex: NF-e" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">Chave DocFin</label>
                <Input type="number" value={form.docfin_key ?? ""} onChange={e => setForm(f => ({ ...f, docfin_key: e.target.value }))} placeholder="Ex: 12345" />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <DatePickerField label={t("ic.issue_date" as any)} value={form.issue_date} onChange={v => setForm(f => ({ ...f, issue_date: v }))} />
              <DatePickerField label={t("recv.due_date")} value={form.due_date} onChange={v => setForm(f => ({ ...f, due_date: v }))} />
              <DatePickerField label="Competência" value={form.competence_date} onChange={v => setForm(f => ({ ...f, competence_date: v }))} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground">{t("ic.cfop" as any)}</label>
                <Input value={form.cfop} onChange={e => setForm(f => ({ ...f, cfop: e.target.value }))} placeholder="Ex: 7.102" />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">{t("ic.invoice_ref" as any)}</label>
                <Input value={form.invoice_reference} onChange={e => setForm(f => ({ ...f, invoice_reference: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">{t("ic.doc_reference")}</label>
                <Input value={form.document_reference} onChange={e => setForm(f => ({ ...f, document_reference: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground">{t("ic.service_value" as any)}</label>
                <Input type="number" step="0.01" value={form.service_value} onChange={e => setForm(f => ({ ...f, service_value: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">{t("ic.product_value" as any)}</label>
                <Input type="number" step="0.01" value={form.product_value} onChange={e => setForm(f => ({ ...f, product_value: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">{t("ic.taxes" as any)}</label>
                <Input type="number" step="0.01" value={form.tax_total} onChange={e => setForm(f => ({ ...f, tax_total: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground">Frete</label>
                <Input type="number" step="0.01" value={form.freight_value} onChange={e => setForm(f => ({ ...f, freight_value: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground">{t("dashboard.status")}</label>
                <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="em_aberto">{t("ic.st.em_aberto")}</SelectItem>
                    <SelectItem value="parcial">{t("ic.st.parcial")}</SelectItem>
                    <SelectItem value="liquidado">{t("ic.st.liquidado")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground">{t("recv.notes")}</label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)} className="w-full sm:w-auto">{t("cash.cancel")}</Button>
            <Button onClick={saveForm} disabled={!form.related_company.trim()} className="w-full sm:w-auto">{t("cash.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SyncModal open={showSync} onOpenChange={setShowSync} onSyncComplete={fetchData} />
      <PaymentUpdateModal
        open={showPaymentUpdate}
        onOpenChange={setShowPaymentUpdate}
        items={paymentUpdateItems}
        onComplete={fetchData}
      />
    </div>
  );
}
