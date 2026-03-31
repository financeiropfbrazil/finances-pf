import { useEffect, useState, useCallback, useMemo } from "react";
import { format, subDays, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";

// Legacy export for backward compatibility with old inventory components
export interface InventoryItem {
  id: string;
  period_id: string;
  item_code: string;
  item_description: string;
  category: string;
  unit_of_measure: string;
  physical_quantity: number;
  unit_cost: number;
  total_cost: number;
  location: string;
  notes: string | null;
  created_at?: string;
}
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Package, Download, Radio, Search, Loader2, AlertTriangle, Info, LayoutList, Layers,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { capturarSaldoMensal, sincronizarProdutosDoERP } from "@/services/alvoEstoqueService";
import { InventoryComparative } from "@/components/inventory/InventoryComparative";
import { ProductMovementModal } from "@/components/inventory/ProductMovementModal";
import * as XLSX from "xlsx";

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
}

const TIPOS_LABEL: Record<string, string> = {
  "01-Acabado": "01 - Acabado",
  "02-Semi-Acabado": "02 - Semi-Acabado",
  "03-Matéria Prima": "03 - Matéria Prima",
  "06-Material de Embalagem": "06 - Material de Embalagem",
  "44-Insumos": "44 - Insumos",
};

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatQty = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

export default function Inventory() {
  const { toast } = useToast();

  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [capturing, setCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState("");
  const [capturePercent, setCapturePercent] = useState(0);

  const [viewMode, setViewMode] = useState<"tipo" | "flat">("tipo");
  const [filterTipo, setFilterTipo] = useState("all");
  const [onlyPositive, setOnlyPositive] = useState(true);
  const [search, setSearch] = useState("");

  // Movement modal state
  const [movementModal, setMovementModal] = useState<{
    open: boolean;
    row: StockRow | null;
  }>({ open: false, row: null });

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; count: number }>({ open: false, count: 0 });
  // Closed period alert
  const [closedAlert, setClosedAlert] = useState(false);

  // Data de referência default = yesterday
  const [selectedDate, setSelectedDate] = useState<Date>(() => subDays(new Date(), 1));

  const dataReferencia = useMemo(() => format(selectedDate, "yyyy-MM-dd"), [selectedDate]);
  const periodo = useMemo(() => dataReferencia.slice(0, 7), [dataReferencia]);
  const periodoLabel = useMemo(() => {
    const [y, m] = periodo.split("-");
    return `${MONTH_NAMES[parseInt(m, 10) - 1]}/${y}`;
  }, [periodo]);

  const yesterday = useMemo(() => subDays(new Date(), 1), []);

  // Track which dates in the visible calendar month have draft data
  const [draftDates, setDraftDates] = useState<Date[]>([]);
  const [calendarMonth, setCalendarMonth] = useState<Date>(selectedDate);

  const fetchDraftDates = useCallback(async (month: Date) => {
    const monthStart = format(startOfMonth(month), "yyyy-MM-dd");
    const monthEnd = format(endOfMonth(month), "yyyy-MM-dd");
    const { data } = await supabase
      .from("stock_balance")
      .select("data_referencia")
      .gte("data_referencia", monthStart)
      .lte("data_referencia", monthEnd);
    if (data) {
      const unique = [...new Set(data.map((r: any) => r.data_referencia))];
      setDraftDates(unique.map((d: string) => parseISO(d)));
    }
  }, []);

  useEffect(() => {
    fetchDraftDates(calendarMonth);
  }, [calendarMonth, fetchDraftDates]);

  const fetchData = useCallback(async () => {
    if (!dataReferencia) return;
    setLoading(true);

    // Batch fetch stock_balance for this data_referencia
    let balances: any[] = [];
    let from = 0;
    const batchSize = 1000;
    let done = false;
    while (!done) {
      const { data } = await supabase
        .from("stock_balance")
        .select("id, product_id, quantidade, valor_total_brl, valor_medio_unitario, fonte")
        .eq("data_referencia", dataReferencia)
        .range(from, from + batchSize - 1);
      if (data && data.length > 0) {
        balances = balances.concat(data);
        from += batchSize;
        if (data.length < batchSize) done = true;
      } else {
        done = true;
      }
    }

    if (balances.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    // Fetch all products
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
      };
    });

    setRows(merged);
    setLoading(false);
  }, [dataReferencia]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filtered rows
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
        )
          return false;
      }
      return true;
    });
  }, [rows, onlyPositive, filterTipo, search]);

  // Summary stats
  const skusWithBalance = useMemo(() => rows.filter((r) => r.quantidade > 0).length, [rows]);
  const skusZero = useMemo(() => rows.filter((r) => r.quantidade === 0).length, [rows]);
  const totalBrl = useMemo(() => rows.reduce((s, r) => s + (r.valorTotalBrl ?? 0), 0), [rows]);
  const dataSource = useMemo(() => {
    const sources = new Set(rows.map((r) => r.fonte));
    if (sources.has("api") && sources.has("manual")) return "mixed";
    if (sources.has("api")) return "api";
    return "manual";
  }, [rows]);

  // Group by tipo
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
    rows.forEach((r) => {
      if (r.tipoProduto) tipos.add(r.tipoProduto);
    });
    return Array.from(tipos).sort();
  }, [rows]);

  // Check if period is closed
  const checkPeriodClosed = async (): Promise<boolean> => {
    const [y, m] = periodo.split("-");
    const { data } = await supabase
      .from("reconciliation_summary")
      .select("id")
      .eq("module_name", "inventory")
      .eq("status", "closed")
      .limit(1);

    // Also check via periods table
    const { data: periodData } = await supabase
      .from("periods")
      .select("id, status")
      .eq("year", parseInt(y))
      .eq("month", parseInt(m))
      .eq("status", "closed")
      .limit(1);

    return (periodData && periodData.length > 0) || false;
  };

  // Check existing data for confirmation
  const checkExistingData = async (): Promise<number> => {
    const { count } = await supabase
      .from("stock_balance")
      .select("id", { count: "exact", head: true })
      .eq("data_referencia", dataReferencia);
    return count ?? 0;
  };

  // API capture with checks
  const handleCaptureClick = async () => {
    // 1. Check closed period
    const isClosed = await checkPeriodClosed();
    if (isClosed) {
      setClosedAlert(true);
      return;
    }

    // 2. Check existing data
    const existingCount = await checkExistingData();
    if (existingCount > 0) {
      setConfirmDialog({ open: true, count: existingCount });
      return;
    }

    // 3. Run capture directly
    runCapture();
  };

  const runCapture = async () => {
    setConfirmDialog({ open: false, count: 0 });
    setCapturing(true);
    setCapturePercent(0);
    setCaptureProgress("Iniciando captura...");

    try {
      // 1. Sincronizar catálogo de produtos do ERP
      setCaptureProgress("Sincronizando catálogo de produtos do ERP...");
      const syncRes = await sincronizarProdutosDoERP((msg) => setCaptureProgress(msg));
      if (syncRes.erros.length > 0) {
        console.warn("Erros na sincronização de produtos:", syncRes.erros);
      }

      // 2. Capturar saldos
      const res = await capturarSaldoMensal(dataReferencia, (msg) => {
        setCaptureProgress(msg);
        const match = msg.match(/Produto (\d+)\/(\d+)/);
        if (match) {
          setCapturePercent(Math.min(Math.round((parseInt(match[1]) / parseInt(match[2])) * 95), 95));
        }
      });

      setCapturePercent(100);
      if (res.erros.length > 0) {
        console.error("Erros na captura de estoque:", res.erros);
      }
      const descParts: string[] = [];
      if (syncRes.novos > 0) descParts.push(`${syncRes.novos} produtos novos sincronizados do ERP`);
      if (res.erros.length > 0) descParts.push(`${res.erros.length} erros. Primeiros: ${res.erros.slice(0, 3).join(" | ")}`);
      toast({
        title: `Captura concluída: ${res.salvos} produtos salvos`,
        description: descParts.length > 0 ? descParts.join(". ") : undefined,
        variant: res.erros.length > 0 && res.salvos === 0 ? "destructive" : "default",
      });
      fetchData();
      fetchDraftDates(calendarMonth);
    } catch (e: any) {
      toast({ title: "Erro na captura", description: e.message, variant: "destructive" });
    } finally {
      setCapturing(false);
    }
  };

  // Export
  const handleExport = () => {
    const data = filtered.map((r) => ({
      Código: r.codigoProduto,
      "Red.": r.codigoReduzido ?? "",
      Descrição: r.nomeProduto,
      Tipo: r.tipoProduto ?? "",
      Família: r.familiaCodigo ?? "",
      Variação: r.variacao ?? "",
      Unidade: r.unidadeMedida ?? "",
      Quantidade: r.quantidade,
      "Valor Médio": r.valorMedioUnitario ?? "",
      "Valor Total BRL": r.valorTotalBrl ?? "",
      Fonte: r.fonte,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Estoque");
    XLSX.writeFile(wb, `estoque_${dataReferencia}.xlsx`);
  };

  const renderValueCell = (_row: StockRow, value: number | null) => {
    if (value == null) {
      return <span className="text-muted-foreground">—</span>;
    }
    return formatBRL(value);
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
    if (row.quantidade === 0) {
      return <span className="text-muted-foreground">{formatQty(row.quantidade)}</span>;
    }
    return formatQty(row.quantidade);
  };

  const renderTableRows = (items: StockRow[], showSubtotal?: { label: string }) => (
    <>
      {items.map((r) => (
        <TableRow
          key={r.balanceId}
          className={cn("cursor-pointer", r.quantidade === 0 ? "text-muted-foreground" : "")}
          onClick={() => setMovementModal({ open: true, row: r })}
        >
          <TableCell className="font-mono text-xs">{r.codigoProduto}</TableCell>
          <TableCell className="text-sm">{r.nomeProduto}</TableCell>
          <TableCell className="text-xs">{r.variacao ?? "—"}</TableCell>
          <TableCell className="text-xs">{r.unidadeMedida ?? "—"}</TableCell>
          <TableCell className="text-right">{renderQtyCell(r)}</TableCell>
          <TableCell className="text-right text-sm">{renderValueCell(r, r.valorMedioUnitario)}</TableCell>
          <TableCell className="text-right text-sm font-medium">{renderValueCell(r, r.valorTotalBrl)}</TableCell>
        </TableRow>
      ))}
      {showSubtotal && (
        <TableRow className="bg-muted/50 font-semibold">
          <TableCell colSpan={4} className="text-xs">{showSubtotal.label}</TableCell>
          <TableCell className="text-right">{formatQty(items.reduce((s, r) => s + r.quantidade, 0))}</TableCell>
          <TableCell />
          <TableCell className="text-right">
            {formatBRL(items.reduce((s, r) => s + (r.valorTotalBrl ?? 0), 0))}
          </TableCell>
        </TableRow>
      )}
    </>
  );

  const formattedDateBR = dataReferencia.split("-").reverse().join("/");

  if (loading && rows.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-foreground">Posição de Estoque</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date picker */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[200px] justify-start text-left font-normal",
                  !selectedDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(selectedDate, "dd/MM/yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(d) => d && setSelectedDate(d)}
                disabled={(date) => date > yesterday || date < new Date("2020-01-01")}
                month={calendarMonth}
                onMonthChange={setCalendarMonth}
                modifiers={{ hasDraft: draftDates }}
                modifiersClassNames={{ hasDraft: "inventory-draft-dot" }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          <Badge variant="outline" className="text-sm h-9 px-3 flex items-center">
            {periodoLabel}
          </Badge>

          <Button variant="outline" size="sm" className="gap-2" onClick={handleExport} disabled={filtered.length === 0}>
            <Download className="h-4 w-4" /> Exportar Excel
          </Button>
          <Button size="sm" className="gap-2" onClick={handleCaptureClick} disabled={capturing}>
            {capturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
            {capturing ? "Capturando..." : "Capturar Saldo via API"}
          </Button>
        </div>
      </div>

      {/* Closed period alert */}
      {closedAlert && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            O mês {periodoLabel} já possui fechamento oficial. Para atualizar, primeiro reabra o período em Estoques &gt; Fechamentos.
            <Button variant="ghost" size="sm" className="ml-2" onClick={() => setClosedAlert(false)}>Fechar</Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Confirmation dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog({ ...confirmDialog, open })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dados já existentes</DialogTitle>
            <DialogDescription>
              A data {formattedDateBR} já foi consultada com {confirmDialog.count} produtos registrados. Deseja atualizar os dados?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog({ open: false, count: 0 })}>Cancelar</Button>
            <Button onClick={runCapture}>Atualizar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* API capture progress */}
      {capturing && (
        <Alert className="border-primary/20 bg-primary/5">
          <Info className="h-4 w-4 text-primary" />
          <AlertDescription className="text-foreground space-y-2">
            <p className="text-sm">{captureProgress}</p>
            <Progress value={capturePercent} className="h-2" />
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="posicao" className="space-y-6">
        <TabsList>
          <TabsTrigger value="posicao">Posição</TabsTrigger>
          <TabsTrigger value="comparativo">Comparativo</TabsTrigger>
        </TabsList>

        <TabsContent value="posicao" className="space-y-6 mt-0">
          {/* Summary cards */}
          {rows.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-foreground">{skusWithBalance}</p>
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
                  <p className="text-2xl font-bold text-muted-foreground">{skusZero}</p>
                  <p className="text-xs text-muted-foreground">SKUs saldo zero</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <Badge variant={dataSource === "api" ? "default" : "secondary"} className="text-sm">
                    {dataSource === "api" ? "API" : dataSource === "manual" ? "Manual" : "Manual + API"}
                  </Badge>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ref.: {formattedDateBR}
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : !loading ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                <Package className="h-12 w-12 text-muted-foreground/40" />
                <p className="text-lg font-medium text-foreground">
                  Nenhum saldo registrado para {formattedDateBR}
                </p>
                <p className="text-sm text-muted-foreground">
                  Clique em <strong>Capturar Saldo via API</strong> para consultar.
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* Filters */}
          {rows.length > 0 && (
            <Card className="bg-muted/30 border-none shadow-none">
              <CardContent className="p-3 flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2 text-muted-foreground mr-2">
                  <Search className="h-4 w-4" />
                  <span className="text-sm font-medium">Filtros</span>
                </div>
                
                <div className="relative flex-1 min-w-[240px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
                  <Input
                    placeholder="Buscar código ou descrição..."
                    className="pl-9 bg-background border-muted-foreground/20 focus-visible:ring-primary/30"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <Select value={filterTipo} onValueChange={setFilterTipo}>
                    <SelectTrigger className="w-[200px] bg-background border-muted-foreground/20">
                      <SelectValue placeholder="Tipo do Produto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os tipos</SelectItem>
                      {tipoOptions.map((t) => (
                        <SelectItem key={t} value={t}>{TIPOS_LABEL[t] ?? t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-muted-foreground/20 bg-background">
                    <Switch id="only-positive" checked={onlyPositive} onCheckedChange={setOnlyPositive} />
                    <Label htmlFor="only-positive" className="text-sm cursor-pointer whitespace-nowrap">Saldo &gt; 0</Label>
                  </div>

                  <div className="ml-auto flex items-center gap-1 p-1 bg-background border border-muted-foreground/20 rounded-lg">
                    <Button
                      variant={viewMode === "tipo" ? "secondary" : "ghost"}
                      size="sm"
                      className={cn("h-8 gap-1.5 px-3", viewMode === "tipo" && "bg-secondary shadow-sm")}
                      onClick={() => setViewMode("tipo")}
                    >
                      <Layers className="h-3.5 w-3.5" /> Por Tipo
                    </Button>
                    <Button
                      variant={viewMode === "flat" ? "secondary" : "ghost"}
                      size="sm"
                      className={cn("h-8 gap-1.5 px-3", viewMode === "flat" && "bg-secondary shadow-sm")}
                      onClick={() => setViewMode("flat")}
                    >
                      <LayoutList className="h-3.5 w-3.5" /> Tabela
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Accordion view by tipo */}
          {rows.length > 0 && viewMode === "tipo" && (
            <Accordion type="multiple" className="space-y-2">
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

          {/* Flat table view */}
          {rows.length > 0 && viewMode === "flat" && (
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
                        <TableRow
                          key={r.balanceId}
                          className={cn("cursor-pointer", r.quantidade === 0 ? "text-muted-foreground" : "")}
                          onClick={() => setMovementModal({ open: true, row: r })}
                        >
                          <TableCell className="font-mono text-xs">{r.codigoProduto}</TableCell>
                          <TableCell className="text-sm">{r.nomeProduto}</TableCell>
                          <TableCell className="text-xs">{r.tipoProduto ?? "—"}</TableCell>
                          <TableCell className="text-xs">{r.variacao ?? "—"}</TableCell>
                          <TableCell className="text-xs">{r.unidadeMedida ?? "—"}</TableCell>
                          <TableCell className="text-right">{renderQtyCell(r)}</TableCell>
                          <TableCell className="text-right text-sm">{renderValueCell(r, r.valorMedioUnitario)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{renderValueCell(r, r.valorTotalBrl)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-semibold">
                        <TableCell colSpan={5}>Totais gerais ({filtered.length} SKUs)</TableCell>
                        <TableCell className="text-right">
                          {formatQty(filtered.reduce((s, r) => s + r.quantidade, 0))}
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-right">
                          {formatBRL(filtered.reduce((s, r) => s + (r.valorTotalBrl ?? 0), 0))}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="comparativo" className="mt-0">
          <InventoryComparative />
        </TabsContent>
      </Tabs>

      {/* Product movement modal */}
      {movementModal.row && (
        <ProductMovementModal
          open={movementModal.open}
          onOpenChange={(open) => setMovementModal({ ...movementModal, open })}
          codigoProduto={movementModal.row.codigoProduto}
          nomeProduto={movementModal.row.nomeProduto}
          dataReferencia={dataReferencia}
          unidadeMedida={movementModal.row.unidadeMedida}
        />
      )}
    </div>
  );
}
