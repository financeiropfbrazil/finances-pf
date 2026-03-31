import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { TrendingUp, FileSpreadsheet, Search, Loader2, Download, PackageOpen, BarChart3 } from "lucide-react";
import { ClosingComparisonSheet } from "@/components/inventory/ClosingComparisonSheet";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
import * as XLSX from "xlsx";
import { toast } from "sonner";

interface StockProduct {
  id: string;
  codigo_produto: string;
  nome_produto: string;
  tipo_produto: string | null;
  variacao: string | null;
  codigo_reduzido: string | null;
}

interface BalanceRow {
  periodo: string;
  data_referencia: string;
  quantidade: number;
  valor_medio_unitario: number | null;
  valor_total_brl: number | null;
  fonte: string;
}

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function formatPeriodo(p: string) {
  // p = "YYYY-MM"
  const [y, m] = p.split("-");
  return `${MONTH_NAMES[parseInt(m, 10) - 1]}/${y}`;
}

function formatCurrency(v: number | null) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatNumber(v: number | null, decimals = 2) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function generatePeriodOptions() {
  const options: { label: string; value: string }[] = [];
  const now = new Date();
  for (let y = 2025; y <= now.getFullYear() + 1; y++) {
    for (let m = 1; m <= 12; m++) {
      const val = `${y}-${String(m).padStart(2, "0")}`;
      options.push({ label: `${MONTH_NAMES[m - 1]}/${y}`, value: val });
    }
  }
  return options;
}

const periodOptions = generatePeriodOptions();

export default function InventoryReports() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [compSheetOpen, setCompSheetOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Relatórios de Estoque</h1>
        <p className="text-muted-foreground">Selecione um relatório para configurar e exportar</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Extrato por Produto</CardTitle>
                <CardDescription className="text-xs">
                  Histórico de saldos mês a mês de um SKU específico com gráfico de evolução
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setSheetOpen(true)} className="w-full">
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Configurar e Exportar
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Comparação de Fechamentos</CardTitle>
                <CardDescription className="text-xs">
                  Compare o estoque oficial entre dois meses fechados — variação de quantidade e valor por produto
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setCompSheetOpen(true)} className="w-full">
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Configurar e Exportar
            </Button>
          </CardContent>
        </Card>
      </div>

      <ProductExtractSheet open={sheetOpen} onOpenChange={setSheetOpen} />
      <ClosingComparisonSheet open={compSheetOpen} onOpenChange={setCompSheetOpen} />
    </div>
  );
}

/* ─── Product Extract Sheet ─── */

function ProductExtractSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<StockProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<StockProduct | null>(null);
  const [periodoIni, setPeriodoIni] = useState("2025-12");
  const [periodoFim, setPeriodoFim] = useState("2026-03");
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [data, setData] = useState<BalanceRow[] | null>(null);

  // Autocomplete search
  useEffect(() => {
    if (search.length < 2) { setSuggestions([]); return; }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      const term = `%${search}%`;
      const { data: prods } = await supabase
        .from("stock_products")
        .select("id, codigo_produto, nome_produto, tipo_produto, variacao, codigo_reduzido")
        .or(`codigo_produto.ilike.${term},nome_produto.ilike.${term},codigo_reduzido.ilike.${term}`)
        .eq("ativo", true)
        .limit(10);
      setSuggestions(prods ?? []);
      setSearchLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const selectProduct = (p: StockProduct) => {
    setSelectedProduct(p);
    setSearch(p.codigo_produto + " — " + p.nome_produto);
    setSuggestions([]);
    setData(null);
  };

  const fetchData = useCallback(async () => {
    if (!selectedProduct) return;
    setLoading(true);
    setData(null);

    // Build period list
    const periods: string[] = [];
    let [yi, mi] = periodoIni.split("-").map(Number);
    const [yf, mf] = periodoFim.split("-").map(Number);
    while (yi * 12 + mi <= yf * 12 + mf) {
      periods.push(`${yi}-${String(mi).padStart(2, "0")}`);
      mi++;
      if (mi > 12) { mi = 1; yi++; }
    }

    const { data: balances, error } = await supabase
      .from("stock_balance")
      .select("periodo, data_referencia, quantidade, valor_medio_unitario, valor_total_brl, fonte")
      .eq("product_id", selectedProduct.id)
      .gte("periodo", periodoIni)
      .lte("periodo", periodoFim)
      .order("periodo", { ascending: true });

    if (error) {
      toast.error("Erro ao buscar dados: " + error.message);
      setLoading(false);
      return;
    }

    const balMap = new Map((balances ?? []).map((b) => [b.periodo, b]));
    const rows: BalanceRow[] = periods.map((p) => {
      const b = balMap.get(p);
      if (b) return b as BalanceRow;
      return { periodo: p, data_referencia: "", quantidade: 0, valor_medio_unitario: null, valor_total_brl: null, fonte: "" };
    });

    setData(rows);
    setLoading(false);
  }, [selectedProduct, periodoIni, periodoFim]);

  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;
    const withData = data.filter((d) => d.fonte);
    if (withData.length === 0) return null;
    const qtds = withData.map((d) => d.quantidade);
    return {
      min: Math.min(...qtds),
      max: Math.max(...qtds),
      avg: qtds.reduce((a, b) => a + b, 0) / qtds.length,
    };
  }, [data]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.map((d) => ({
      name: formatPeriodo(d.periodo),
      quantidade: d.fonte ? d.quantidade : null,
      valor: d.fonte ? d.valor_total_brl : null,
    }));
  }, [data]);

  const exportExcel = () => {
    if (!data || !selectedProduct) return;

    const wsData = data.map((d) => ({
      Período: formatPeriodo(d.periodo),
      "Data Ref.": d.data_referencia ? new Date(d.data_referencia + "T00:00:00").toLocaleDateString("pt-BR") : "—",
      Quantidade: d.fonte ? Number(d.quantidade.toFixed(2)) : null,
      "Valor Médio Unit.": d.valor_medio_unitario != null ? Number(d.valor_medio_unitario.toFixed(2)) : null,
      "Valor Total BRL": d.valor_total_brl != null ? Number(d.valor_total_brl.toFixed(2)) : null,
      Fonte: d.fonte || "—",
    }));

    const ws1 = XLSX.utils.json_to_sheet(wsData);

    const resumo = [
      { Campo: "Produto", Valor: selectedProduct.nome_produto },
      { Campo: "Código", Valor: selectedProduct.codigo_produto },
      { Campo: "Período", Valor: `${formatPeriodo(periodoIni)} a ${formatPeriodo(periodoFim)}` },
      { Campo: "Qtd Mínima", Valor: stats ? Number(stats.min.toFixed(2)) : 0 },
      { Campo: "Qtd Máxima", Valor: stats ? Number(stats.max.toFixed(2)) : 0 },
      { Campo: "Qtd Média", Valor: stats ? Number(stats.avg.toFixed(2)) : 0 },
      { Campo: "Variação Total", Valor: data.length >= 2 ? Number((data[data.length - 1].quantidade - data[0].quantidade).toFixed(2)) : 0 },
    ];
    const ws2 = XLSX.utils.json_to_sheet(resumo);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Extrato");
    XLSX.utils.book_append_sheet(wb, ws2, "Resumo");

    const fileName = `Extrato_${selectedProduct.codigo_produto}_${periodoIni}_a_${periodoFim}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast.success("Arquivo exportado com sucesso!");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Extrato por Produto</SheetTitle>
          <SheetDescription>Histórico de saldos mês a mês com gráfico de evolução</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Product search */}
          <div className="relative">
            <label className="text-sm font-medium text-foreground">Produto</label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por código ou nome..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSelectedProduct(null); setData(null); }}
                className="pl-9"
              />
              {searchLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            {suggestions.length > 0 && (
              <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                {suggestions.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectProduct(p)}
                    className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                  >
                    <span className="font-medium text-foreground">{p.codigo_produto} — {p.nome_produto}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.tipo_produto ?? "—"} {p.variacao ? `| ${p.variacao}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Period selectors */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground">Período Inicial</label>
              <Select value={periodoIni} onValueChange={setPeriodoIni}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {periodOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Período Final</label>
              <Select value={periodoFim} onValueChange={setPeriodoFim}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {periodOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={fetchData} disabled={!selectedProduct || loading} className="w-full">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Visualizar
          </Button>

          {/* Results */}
          {data !== null && data.every((d) => !d.fonte) && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
              <PackageOpen className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Nenhum saldo encontrado para este produto no período selecionado.
              </p>
            </div>
          )}

          {data !== null && data.some((d) => d.fonte) && (
            <>
              {/* Chart */}
              <div className="rounded-lg border p-4">
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(value: any, name: string) => {
                        if (name === "quantidade") return [formatNumber(value), "Quantidade"];
                        return [formatCurrency(value), "Valor BRL"];
                      }}
                    />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="quantidade" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="Quantidade" connectNulls />
                    <Line yAxisId="right" type="monotone" dataKey="valor" stroke="hsl(var(--chart-2))" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} name="Valor BRL" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Table */}
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Período</TableHead>
                      <TableHead>Data Ref.</TableHead>
                      <TableHead className="text-right">Quantidade</TableHead>
                      <TableHead className="text-right">Val. Méd. Unit.</TableHead>
                      <TableHead className="text-right">Valor Total BRL</TableHead>
                      <TableHead>Fonte</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((d) => (
                      <TableRow key={d.periodo} className={!d.fonte ? "text-muted-foreground" : ""}>
                        <TableCell className="font-medium">{formatPeriodo(d.periodo)}</TableCell>
                        <TableCell>
                          {d.data_referencia
                            ? new Date(d.data_referencia + "T00:00:00").toLocaleDateString("pt-BR")
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">{d.fonte ? formatNumber(d.quantidade) : "—"}</TableCell>
                        <TableCell className="text-right">{d.fonte ? formatNumber(d.valor_medio_unitario) : "—"}</TableCell>
                        <TableCell className="text-right">{d.fonte ? formatCurrency(d.valor_total_brl) : "—"}</TableCell>
                        <TableCell>
                          {d.fonte === "manual" && <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Manual</Badge>}
                          {d.fonte === "api" && <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">API</Badge>}
                          {!d.fonte && "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  {stats && (
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={2} className="font-medium">Resumo</TableCell>
                        <TableCell className="text-right text-xs">
                          Mín: {formatNumber(stats.min)} | Máx: {formatNumber(stats.max)} | Méd: {formatNumber(stats.avg)}
                        </TableCell>
                        <TableCell colSpan={3} />
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </div>

              {/* Export */}
              <Button onClick={exportExcel} variant="outline" className="w-full">
                <Download className="mr-2 h-4 w-4" />
                Exportar Excel (.xlsx)
              </Button>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
