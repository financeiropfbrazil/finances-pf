import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Package, Lock, Unlock, Loader2, AlertTriangle, Search, Layers, LayoutList,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TIPOS_VISIVEIS_ESTOQUE, TIPOS_LABEL as TIPOS_LABEL_GLOBAL } from "@/constants/stockTipos";

interface StockRow {
  balanceId: string;
  productId: string;
  codigoProduto: string;
  codigoReduzido: string | null;
  nomeProduto: string;
  tipoProduto: string | null;
  familiaCodigo: string | null;
  variacao: string | null;
  unidadeMedida: string | null;
  quantidade: number;
  valorTotalBrl: number | null;
  valorMedioUnitario: number | null;
  fonte: string;
  status: string;
  closedAt: string | null;
  closedBy: string | null;
}

interface MonthStatus {
  status: "closed" | "draft" | "empty";
  count: number;
  closedAt?: string;
  closedBy?: string;
}

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const MONTH_ABBR = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];



const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatQty = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

function getLastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0); // month is 1-indexed here, so Date(year, month, 0) gives last day
  return d.toISOString().slice(0, 10);
}

export default function InventoryClosings() {
  const { toast } = useToast();
  const { user } = useAuth();

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);

  const [monthStatuses, setMonthStatuses] = useState<Record<number, MonthStatus>>({});
  const [loadingStatuses, setLoadingStatuses] = useState(false);

  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [actualDate, setActualDate] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<"tipo" | "flat">("tipo");
  const [onlyPositive, setOnlyPositive] = useState(false);
  const [search, setSearch] = useState("");
  const [filterTipo, setFilterTipo] = useState("all");

  const [closeDialog, setCloseDialog] = useState(false);
  const [reopenDialog, setReopenDialog] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Load month statuses for selected year
  const loadMonthStatuses = useCallback(async () => {
    setLoadingStatuses(true);
    const statuses: Record<number, MonthStatus> = {};

    // For each month, check last day
    const promises = Array.from({ length: 12 }, (_, i) => i + 1).map(async (month) => {
      const lastDay = getLastDayOfMonth(selectedYear, month);

      // First try exact last day
      let { data, count } = await supabase
        .from("stock_balance")
        .select("status, closed_at, closed_by", { count: "exact" })
        .eq("data_referencia", lastDay)
        .limit(1);

      if (!data || data.length === 0) {
        // Try closest previous date within month
        const firstDay = `${selectedYear}-${String(month).padStart(2, "0")}-01`;
        const { data: fallback } = await supabase
          .from("stock_balance")
          .select("status, closed_at, closed_by, data_referencia")
          .gte("data_referencia", firstDay)
          .lte("data_referencia", lastDay)
          .order("data_referencia", { ascending: false })
          .limit(1);

        if (!fallback || fallback.length === 0) {
          statuses[month] = { status: "empty", count: 0 };
          return;
        }

        // Get count for that date
        const fallbackDate = (fallback[0] as any).data_referencia;
        const { count: fbCount } = await supabase
          .from("stock_balance")
          .select("id", { count: "exact", head: true })
          .eq("data_referencia", fallbackDate);

        statuses[month] = {
          status: (fallback[0] as any).status === "closed" ? "closed" : "draft",
          count: fbCount ?? 0,
          closedAt: (fallback[0] as any).closed_at,
          closedBy: (fallback[0] as any).closed_by,
        };
        return;
      }

      statuses[month] = {
        status: (data[0] as any).status === "closed" ? "closed" : "draft",
        count: count ?? 0,
        closedAt: (data[0] as any).closed_at,
        closedBy: (data[0] as any).closed_by,
      };
    });

    await Promise.all(promises);
    setMonthStatuses(statuses);
    setLoadingStatuses(false);
  }, [selectedYear]);

  useEffect(() => {
    loadMonthStatuses();
  }, [loadMonthStatuses]);

  // Load data for selected month
  const loadMonthData = useCallback(async (month: number) => {
    setLoading(true);
    setRows([]);
    setActualDate(null);

    const lastDay = getLastDayOfMonth(selectedYear, month);

    // Try exact last day first
    let targetDate = lastDay;
    let { data: check } = await supabase
      .from("stock_balance")
      .select("id")
      .eq("data_referencia", lastDay)
      .limit(1);

    if (!check || check.length === 0) {
      // Fallback to closest previous date
      const firstDay = `${selectedYear}-${String(month).padStart(2, "0")}-01`;
      const { data: fallback } = await supabase
        .from("stock_balance")
        .select("data_referencia")
        .gte("data_referencia", firstDay)
        .lte("data_referencia", lastDay)
        .order("data_referencia", { ascending: false })
        .limit(1);

      if (!fallback || fallback.length === 0) {
        setLoading(false);
        return;
      }
      targetDate = (fallback[0] as any).data_referencia;
    }

    setActualDate(targetDate);

    // Batch fetch
    let balances: any[] = [];
    let from = 0;
    const batchSize = 1000;
    let done = false;
    while (!done) {
      const { data } = await supabase
        .from("stock_balance")
        .select("id, product_id, quantidade, valor_total_brl, valor_medio_unitario, fonte, status, closed_at, closed_by")
        .eq("data_referencia", targetDate)
        .range(from, from + batchSize - 1);
      if (data && data.length > 0) {
        balances = balances.concat(data);
        from += batchSize;
        if (data.length < batchSize) done = true;
      } else {
        done = true;
      }
    }

    // Fetch products
    let products: any[] = [];
    from = 0;
    done = false;
    while (!done) {
      const { data } = await supabase
        .from("stock_products")
        .select("id, codigo_produto, codigo_reduzido, nome_produto, tipo_produto, familia_codigo, variacao, unidade_medida")
        .eq("ativo", true)
        .range(from, from + batchSize - 1);
      if (data && data.length > 0) {
        products = products.concat(data);
        from += batchSize;
        if (data.length < batchSize) done = true;
      } else {
        done = true;
      }
    }

    const productMap = new Map(products.map((p: any) => [p.id, p]));

    const merged: StockRow[] = balances.map((b: any) => {
      const p = productMap.get(b.product_id);
      return {
        balanceId: b.id,
        productId: b.product_id,
        codigoProduto: p?.codigo_produto ?? "—",
        codigoReduzido: p?.codigo_reduzido ?? null,
        nomeProduto: p?.nome_produto ?? "Produto desconhecido",
        tipoProduto: p?.tipo_produto ?? null,
        familiaCodigo: p?.familia_codigo ?? null,
        variacao: p?.variacao ?? null,
        unidadeMedida: p?.unidade_medida ?? null,
        quantidade: Number(b.quantidade),
        valorTotalBrl: b.valor_total_brl != null ? Number(b.valor_total_brl) : null,
        valorMedioUnitario: b.valor_medio_unitario != null ? Number(b.valor_medio_unitario) : null,
        fonte: b.fonte,
        status: b.status,
        closedAt: b.closed_at,
        closedBy: b.closed_by,
      };
    });

    setRows(merged);
    setLoading(false);
  }, [selectedYear]);

  const handleMonthClick = (month: number) => {
    setSelectedMonth(month);
    loadMonthData(month);
  };

  // Current month status
  const currentStatus = useMemo(() => {
    if (!selectedMonth) return null;
    if (rows.length === 0) return "empty";
    return rows[0]?.status === "closed" ? "closed" : "draft";
  }, [rows, selectedMonth]);

  const closedInfo = useMemo(() => {
    if (currentStatus !== "closed") return null;
    const closed = rows.find((r) => r.closedAt);
    return closed ? { at: closed.closedAt, by: closed.closedBy } : null;
  }, [rows, currentStatus]);

  // Summary
  const skusPositive = useMemo(() => rows.filter((r) => r.quantidade > 0).length, [rows]);
  const skusZeroNeg = useMemo(() => rows.filter((r) => r.quantidade <= 0).length, [rows]);
  const totalBrl = useMemo(() => rows.reduce((s, r) => s + (r.valorTotalBrl ?? 0), 0), [rows]);

  // Filtering
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (onlyPositive && r.quantidade <= 0) return false;
      if (filterTipo !== "all" && r.tipoProduto !== filterTipo) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.codigoProduto.toLowerCase().includes(q) &&
          !r.nomeProduto.toLowerCase().includes(q) &&
          !(r.codigoReduzido ?? "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [rows, onlyPositive, filterTipo, search]);

  const tipoGroups = useMemo(() => {
    const groups: Record<string, StockRow[]> = {};
    for (const r of filtered) {
      const key = r.tipoProduto ?? "Outros";
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const groupByFamilia = (items: StockRow[]) => {
    const groups: Record<string, StockRow[]> = {};
    for (const r of items) {
      const key = r.familiaCodigo ?? "Sem família";
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  };

  const tipoOptions = useMemo(() => {
    const tipos = new Set<string>();
    rows.forEach((r) => { if (r.tipoProduto) tipos.add(r.tipoProduto); });
    return Array.from(tipos).sort();
  }, [rows]);

  // Close period
  const handleClose = async () => {
    if (!actualDate || !user) return;
    setActionLoading(true);
    const { error } = await supabase
      .from("stock_balance")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closed_by: user.email ?? user.id,
      })
      .eq("data_referencia", actualDate)
      .eq("status", "draft");

    if (error) {
      toast({ title: "Erro ao fechar período", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Período fechado com sucesso" });
      setCloseDialog(false);
      if (selectedMonth) loadMonthData(selectedMonth);
      loadMonthStatuses();
    }
    setActionLoading(false);
  };

  // Reopen period
  const handleReopen = async () => {
    if (!actualDate) return;
    setActionLoading(true);
    const { error } = await supabase
      .from("stock_balance")
      .update({
        status: "draft",
        closed_at: null,
        closed_by: null,
      })
      .eq("data_referencia", actualDate)
      .eq("status", "closed");

    if (error) {
      toast({ title: "Erro ao reabrir período", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Período reaberto" });
      setReopenDialog(false);
      if (selectedMonth) loadMonthData(selectedMonth);
      loadMonthStatuses();
    }
    setActionLoading(false);
  };

  const renderQtyCell = (row: StockRow) => {
    if (row.quantidade < 0) {
      return (
        <span className="text-destructive flex items-center justify-end gap-1">
          <AlertTriangle className="h-3.5 w-3.5" />
          {formatQty(row.quantidade)}
        </span>
      );
    }
    if (row.quantidade === 0) return <span className="text-muted-foreground">{formatQty(row.quantidade)}</span>;
    return formatQty(row.quantidade);
  };

  const renderValueCell = (value: number | null) => {
    if (value == null) return <span className="text-muted-foreground">—</span>;
    return formatBRL(value);
  };

  const renderTableRows = (items: StockRow[], showSubtotal?: { label: string }) => (
    <>
      {items.map((r) => (
        <TableRow key={r.balanceId} className={r.quantidade === 0 ? "text-muted-foreground" : ""}>
          <TableCell className="font-mono text-xs">{r.codigoProduto}</TableCell>
          <TableCell className="text-sm">{r.nomeProduto}</TableCell>
          <TableCell className="text-xs">{r.variacao ?? "—"}</TableCell>
          <TableCell className="text-xs">{r.unidadeMedida ?? "—"}</TableCell>
          <TableCell className="text-right">{renderQtyCell(r)}</TableCell>
          <TableCell className="text-right text-sm">{renderValueCell(r.valorMedioUnitario)}</TableCell>
          <TableCell className="text-right text-sm font-medium">{renderValueCell(r.valorTotalBrl)}</TableCell>
        </TableRow>
      ))}
      {showSubtotal && (
        <TableRow className="bg-muted/50 font-semibold">
          <TableCell colSpan={4} className="text-xs">{showSubtotal.label}</TableCell>
          <TableCell className="text-right">{formatQty(items.reduce((s, r) => s + r.quantidade, 0))}</TableCell>
          <TableCell />
          <TableCell className="text-right">{formatBRL(items.reduce((s, r) => s + (r.valorTotalBrl ?? 0), 0))}</TableCell>
        </TableRow>
      )}
    </>
  );

  const formattedActualDate = actualDate ? actualDate.split("-").reverse().join("/") : "";
  const monthLabel = selectedMonth ? `${MONTH_NAMES[selectedMonth - 1]}/${selectedYear}` : "";

  const yearOptions = Array.from({ length: 3 }, (_, i) => currentYear - 1 + i);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fechamentos de Estoque</h1>
          <p className="text-sm text-muted-foreground">
            Fechamento oficial mensal — baseado no saldo do último dia de cada mês
          </p>
        </div>
        {selectedMonth && rows.length > 0 && (
          <div className="flex items-center gap-2">
            {currentStatus === "draft" && (
              <Button size="sm" className="gap-2" onClick={() => setCloseDialog(true)}>
                <Lock className="h-4 w-4" /> Fechar Período
              </Button>
            )}
            {currentStatus === "closed" && (
              <Button variant="outline" size="sm" className="gap-2 border-destructive text-destructive hover:bg-destructive/10" onClick={() => setReopenDialog(true)}>
                <Unlock className="h-4 w-4" /> Reabrir Período
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Year + Month grid */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Label className="text-sm font-medium">Ano:</Label>
            <Select value={String(selectedYear)} onValueChange={(v) => { setSelectedYear(Number(v)); setSelectedMonth(null); setRows([]); }}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loadingStatuses && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-2">
            {MONTH_ABBR.map((abbr, i) => {
              const month = i + 1;
              const ms = monthStatuses[month];
              const isSelected = selectedMonth === month;

              let badgeVariant: "default" | "secondary" | "outline" | "destructive" = "outline";
              let icon = null;
              let bgClass = "bg-card hover:bg-accent";

              if (ms?.status === "closed") {
                badgeVariant = "default";
                icon = <Lock className="h-3 w-3" />;
                bgClass = "bg-green-500/10 border-green-500/30 hover:bg-green-500/20";
              } else if (ms?.status === "draft") {
                badgeVariant = "secondary";
                bgClass = "bg-yellow-500/10 border-yellow-500/30 hover:bg-yellow-500/20";
              }

              return (
                <button
                  key={month}
                  onClick={() => handleMonthClick(month)}
                  className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-colors cursor-pointer ${bgClass} ${isSelected ? "ring-2 ring-primary" : ""}`}
                >
                  <span className="font-medium">{abbr}</span>
                  <div className="flex items-center gap-0.5">
                    {icon}
                    {ms?.status === "closed" && <span className="text-green-600 text-[10px]">Fechado</span>}
                    {ms?.status === "draft" && <span className="text-yellow-600 text-[10px]">Rascunho</span>}
                    {(ms?.status === "empty" || !ms) && <span className="text-muted-foreground text-[10px]">Sem dados</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Selected month content */}
      {selectedMonth && (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <Package className="h-12 w-12 text-muted-foreground/40" />
                <p className="text-lg font-medium text-foreground">
                  Nenhum saldo registrado para {monthLabel}.
                </p>
                <p className="text-sm text-muted-foreground">
                  Capture o saldo em <strong>Posição de Estoque</strong> para o último dia do mês e depois volte aqui para fechar.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Reference date info */}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Dados de referência: <strong className="text-foreground">{formattedActualDate}</strong></span>
                {actualDate !== getLastDayOfMonth(selectedYear, selectedMonth) && (
                  <Badge variant="outline" className="text-xs">(último registro do mês)</Badge>
                )}
              </div>

              {/* Status banner */}
              {currentStatus === "closed" && closedInfo && (
                <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3">
                  <Lock className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-foreground">
                    Fechado em {closedInfo.at ? new Date(closedInfo.at).toLocaleDateString("pt-BR") : "—"} por <strong>{closedInfo.by ?? "—"}</strong>
                  </span>
                </div>
              )}

              {currentStatus === "draft" && (
                <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  <span className="text-sm text-foreground">
                    Período em rascunho — aguardando fechamento oficial.
                  </span>
                </div>
              )}

              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{skusPositive}</p>
                    <p className="text-xs text-muted-foreground">SKUs com saldo &gt; 0</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{formatBRL(totalBrl)}</p>
                    <p className="text-xs text-muted-foreground">Valor total BRL</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-muted-foreground">{skusZeroNeg}</p>
                    <p className="text-xs text-muted-foreground">SKUs saldo zero / negativo</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <Badge variant={currentStatus === "closed" ? "default" : "secondary"} className="text-sm">
                      {currentStatus === "closed" ? "🔒 Fechado" : "🟡 Rascunho"}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      Ref.: {formattedActualDate}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Buscar código ou descrição..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select value={filterTipo} onValueChange={setFilterTipo}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Tipo do Produto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    {tipoOptions.map((t) => (
                      <SelectItem key={t} value={t}>{TIPOS_LABEL[t] ?? t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Switch id="only-positive-closings" checked={onlyPositive} onCheckedChange={setOnlyPositive} />
                  <Label htmlFor="only-positive-closings" className="text-sm">Apenas saldo &gt; 0</Label>
                </div>
                <div className="ml-auto flex items-center gap-1 border rounded-md">
                  <Button variant={viewMode === "tipo" ? "default" : "ghost"} size="sm" className="gap-1.5" onClick={() => setViewMode("tipo")}>
                    <Layers className="h-3.5 w-3.5" /> Por Tipo
                  </Button>
                  <Button variant={viewMode === "flat" ? "default" : "ghost"} size="sm" className="gap-1.5" onClick={() => setViewMode("flat")}>
                    <LayoutList className="h-3.5 w-3.5" /> Tabela Completa
                  </Button>
                </div>
              </div>

              {/* Accordion view */}
              {viewMode === "tipo" && (
                <Accordion type="multiple" defaultValue={tipoGroups.map(([k]) => k)} className="space-y-2">
                  {tipoGroups.map(([tipo, items]) => {
                    const tipoTotal = items.reduce((s, r) => s + (r.valorTotalBrl ?? 0), 0);
                    return (
                      <AccordionItem key={tipo} value={tipo} className="border rounded-lg">
                        <AccordionTrigger className="px-4 hover:no-underline">
                          <div className="flex items-center gap-3 text-sm">
                            <span className="font-semibold">{TIPOS_LABEL[tipo] ?? tipo}</span>
                            <Badge variant="secondary" className="text-xs">{items.length} SKUs</Badge>
                            <span className="text-muted-foreground">{formatBRL(tipoTotal)}</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-0 pb-0">
                          {groupByFamilia(items).map(([fam, famItems]) => (
                            <div key={fam} className="border-t">
                              <div className="px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/30">
                                Família: {fam}
                              </div>
                              <div className="overflow-x-auto">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="text-xs">Código</TableHead>
                                      <TableHead className="text-xs">Descrição</TableHead>
                                      <TableHead className="text-xs">Variação</TableHead>
                                      <TableHead className="text-xs">Un.</TableHead>
                                      <TableHead className="text-xs text-right">Saldo Qtde</TableHead>
                                      <TableHead className="text-xs text-right">Valor Médio</TableHead>
                                      <TableHead className="text-xs text-right">Valor Total BRL</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {renderTableRows(famItems, { label: `Subtotal ${fam}` })}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          ))}
                          <div className="border-t px-4 py-3 flex justify-between items-center bg-muted/20 text-sm font-semibold">
                            <span>Total {TIPOS_LABEL[tipo] ?? tipo}</span>
                            <div className="flex gap-8">
                              <span>{formatQty(items.reduce((s, r) => s + r.quantidade, 0))}</span>
                              <span>{formatBRL(tipoTotal)}</span>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              )}

              {/* Flat view */}
              {viewMode === "flat" && (
                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Código</TableHead>
                            <TableHead>Descrição</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>Variação</TableHead>
                            <TableHead>Un.</TableHead>
                            <TableHead className="text-right">Saldo Qtde</TableHead>
                            <TableHead className="text-right">Valor Médio</TableHead>
                            <TableHead className="text-right">Valor Total BRL</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filtered.map((r) => (
                            <TableRow key={r.balanceId} className={r.quantidade === 0 ? "text-muted-foreground" : ""}>
                              <TableCell className="font-mono text-xs">{r.codigoProduto}</TableCell>
                              <TableCell className="text-sm">{r.nomeProduto}</TableCell>
                              <TableCell className="text-xs">{r.tipoProduto ?? "—"}</TableCell>
                              <TableCell className="text-xs">{r.variacao ?? "—"}</TableCell>
                              <TableCell className="text-xs">{r.unidadeMedida ?? "—"}</TableCell>
                              <TableCell className="text-right">{renderQtyCell(r)}</TableCell>
                              <TableCell className="text-right text-sm">{renderValueCell(r.valorMedioUnitario)}</TableCell>
                              <TableCell className="text-right text-sm font-medium">{renderValueCell(r.valorTotalBrl)}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50 font-semibold">
                            <TableCell colSpan={5}>Totais gerais ({filtered.length} SKUs)</TableCell>
                            <TableCell className="text-right">{formatQty(filtered.reduce((s, r) => s + r.quantidade, 0))}</TableCell>
                            <TableCell />
                            <TableCell className="text-right">{formatBRL(filtered.reduce((s, r) => s + (r.valorTotalBrl ?? 0), 0))}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {/* Close dialog */}
      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fechar período</DialogTitle>
            <DialogDescription>
              Deseja registrar o fechamento oficial do estoque de {monthLabel}? Esta ação marca o saldo de {formattedActualDate} como definitivo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialog(false)} disabled={actionLoading}>Cancelar</Button>
            <Button onClick={handleClose} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
              Fechar Período
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reopen dialog */}
      <Dialog open={reopenDialog} onOpenChange={setReopenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reabrir período</DialogTitle>
            <DialogDescription>
              Deseja reabrir o período {monthLabel}? O saldo voltará para rascunho.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenDialog(false)} disabled={actionLoading}>Cancelar</Button>
            <Button variant="destructive" onClick={handleReopen} disabled={actionLoading}>
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Unlock className="h-4 w-4 mr-2" />}
              Reabrir Período
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
