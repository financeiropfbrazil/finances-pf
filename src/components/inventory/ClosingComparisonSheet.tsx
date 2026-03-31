import { useState, useMemo, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, Download, TrendingUp, TrendingDown, Minus,
  ArrowUpRight, ArrowDownRight, AlertTriangle,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

const TIPOS_LABEL: Record<string, string> = {
  "01-Acabado": "01 - Acabado",
  "02-Semi-Acabado": "02 - Semi-Acabado",
  "03-Matéria Prima": "03 - Matéria Prima",
  "06-Material de Embalagem": "06 - Material de Embalagem",
  "44-Insumos": "44 - Insumos",
};

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatQty = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

const formatPct = (v: number) =>
  `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

interface ClosedMonth {
  label: string;
  value: string; // "YYYY-MM"
  dataRef: string; // actual date used
}

interface CompRow {
  productId: string;
  codigoProduto: string;
  nomeProduto: string;
  tipoProduto: string | null;
  saldoA: number;
  saldoB: number;
  varQtde: number;
  varPct: number | null;
  valorA: number | null;
  valorB: number | null;
  varValor: number | null;
  isNew: boolean;
  isZeroed: boolean;
  isNegative: boolean;
}

function getLastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0);
  return d.toISOString().split("T")[0];
}

async function fetchAllPaginated(
  table: string,
  select: string,
  filters: Record<string, any>,
  orderBy?: string,
) {
  let all: any[] = [];
  let from = 0;
  const bs = 1000;
  while (true) {
    let q = (supabase as any).from(table).select(select);
    for (const [k, v] of Object.entries(filters)) {
      q = q.eq(k, v);
    }
    if (orderBy) q = q.order(orderBy);
    q = q.range(from, from + bs - 1);
    const { data } = await q;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < bs) break;
    from += bs;
  }
  return all;
}

export function ClosingComparisonSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [closedMonths, setClosedMonths] = useState<ClosedMonth[]>([]);
  const [loadingMonths, setLoadingMonths] = useState(false);
  const [monthsLoaded, setMonthsLoaded] = useState(false);

  const [periodoA, setPeriodoA] = useState("");
  const [periodoB, setPeriodoB] = useState("");
  const [filterTipo, setFilterTipo] = useState("all");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [compRows, setCompRows] = useState<CompRow[] | null>(null);
  const [dataRefA, setDataRefA] = useState("");
  const [dataRefB, setDataRefB] = useState("");

  // Load closed months when sheet opens
  const loadClosedMonths = useCallback(async () => {
    if (monthsLoaded) return;
    setLoadingMonths(true);

    // Get distinct periodo values with status=closed
    const { data } = await supabase
      .from("stock_balance")
      .select("periodo, data_referencia")
      .eq("status", "closed")
      .order("periodo", { ascending: false });

    if (data && data.length > 0) {
      const map = new Map<string, string>();
      for (const r of data) {
        const existing = map.get(r.periodo);
        if (!existing || r.data_referencia > existing) {
          map.set(r.periodo, r.data_referencia);
        }
      }
      const months: ClosedMonth[] = Array.from(map.entries())
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([periodo, dataRef]) => {
          const [y, m] = periodo.split("-");
          return {
            value: periodo,
            label: `${MONTH_NAMES[parseInt(m, 10) - 1]}/${y}`,
            dataRef,
          };
        });
      setClosedMonths(months);
    }
    setMonthsLoaded(true);
    setLoadingMonths(false);
  }, [monthsLoaded]);

  // Load on open
  const handleOpenChange = (v: boolean) => {
    if (v) loadClosedMonths();
    onOpenChange(v);
  };

  const closedA = closedMonths.find((m) => m.value === periodoA);
  const closedB = closedMonths.find((m) => m.value === periodoB);
  const canCompare = periodoA && periodoB && periodoA !== periodoB && closedA && closedB;

  const compare = useCallback(async () => {
    if (!closedA || !closedB) return;
    setLoading(true);
    setCompRows(null);

    const [balA, balB, products] = await Promise.all([
      fetchAllPaginated("stock_balance", "product_id, quantidade, valor_total_brl", {
        data_referencia: closedA.dataRef,
        status: "closed",
      }),
      fetchAllPaginated("stock_balance", "product_id, quantidade, valor_total_brl", {
        data_referencia: closedB.dataRef,
        status: "closed",
      }),
      fetchAllPaginated("stock_products", "id, codigo_produto, nome_produto, tipo_produto", { ativo: true }),
    ]);

    setDataRefA(closedA.dataRef);
    setDataRefB(closedB.dataRef);

    const prodMap = new Map(products.map((p: any) => [p.id, p]));
    const mapA = new Map(balA.map((b: any) => [b.product_id, b]));
    const mapB = new Map(balB.map((b: any) => [b.product_id, b]));

    const allIds = new Set([...mapA.keys(), ...mapB.keys()]);
    const rows: CompRow[] = [];

    allIds.forEach((pid) => {
      const prod = prodMap.get(pid);
      if (!prod) return;
      const a = mapA.get(pid);
      const b = mapB.get(pid);
      const sA = a ? Number(a.quantidade) : 0;
      const sB = b ? Number(b.quantidade) : 0;
      const vA = a?.valor_total_brl != null ? Number(a.valor_total_brl) : null;
      const vB = b?.valor_total_brl != null ? Number(b.valor_total_brl) : null;
      const varQ = sB - sA;
      const varPct = sA !== 0 ? ((sB - sA) / Math.abs(sA)) * 100 : sB !== 0 ? 100 : null;
      const varV = vA != null && vB != null ? vB - vA : null;

      rows.push({
        productId: pid,
        codigoProduto: prod.codigo_produto,
        nomeProduto: prod.nome_produto,
        tipoProduto: prod.tipo_produto,
        saldoA: sA,
        saldoB: sB,
        varQtde: varQ,
        varPct,
        valorA: vA,
        valorB: vB,
        varValor: varV,
        isNew: !a && !!b,
        isZeroed: sA > 0 && sB === 0,
        isNegative: sB < 0,
      });
    });

    // Sort by |Var.%| descending
    rows.sort((a, b) => {
      const absA = a.varPct != null ? Math.abs(a.varPct) : -1;
      const absB = b.varPct != null ? Math.abs(b.varPct) : -1;
      return absB - absA;
    });

    setCompRows(rows);
    setLoading(false);
  }, [closedA, closedB]);

  const filtered = useMemo(() => {
    if (!compRows) return [];
    return compRows.filter((r) => {
      if (onlyChanged && r.varQtde === 0 && (r.varValor === null || r.varValor === 0)) return false;
      if (filterTipo !== "all" && r.tipoProduto !== filterTipo) return false;
      return true;
    });
  }, [compRows, onlyChanged, filterTipo]);

  const tipoOptions = useMemo(() => {
    if (!compRows) return [];
    const s = new Set<string>();
    compRows.forEach((r) => { if (r.tipoProduto) s.add(r.tipoProduto); });
    return Array.from(s).sort();
  }, [compRows]);

  const increased = useMemo(() => filtered.filter((r) => r.varQtde > 0).length, [filtered]);
  const decreased = useMemo(() => filtered.filter((r) => r.varQtde < 0).length, [filtered]);
  const zeroed = useMemo(() => filtered.filter((r) => r.isZeroed).length, [filtered]);
  const totalVarValor = useMemo(() => {
    const valid = filtered.filter((r) => r.varValor != null);
    if (valid.length === 0) return null;
    return valid.reduce((s, r) => s + (r.varValor ?? 0), 0);
  }, [filtered]);

  const exportExcel = () => {
    if (!compRows || !closedA || !closedB) return;

    const makeRow = (r: CompRow) => ({
      "Código": r.codigoProduto,
      "Descrição": r.nomeProduto,
      "Tipo": r.tipoProduto ?? "—",
      [`Qtde ${closedA.label}`]: Number(r.saldoA.toFixed(2)),
      [`Qtde ${closedB.label}`]: Number(r.saldoB.toFixed(2)),
      "Var. Qtde": Number(r.varQtde.toFixed(2)),
      "Var. %": r.varPct != null ? Number(r.varPct.toFixed(1)) : null,
      [`Valor ${closedA.label} (BRL)`]: r.valorA != null ? Number(r.valorA.toFixed(2)) : null,
      [`Valor ${closedB.label} (BRL)`]: r.valorB != null ? Number(r.valorB.toFixed(2)) : null,
      "Var. Valor (BRL)": r.varValor != null ? Number(r.varValor.toFixed(2)) : null,
      "Status": r.isNew ? "Novo" : r.isZeroed ? "Zerado" : "",
    });

    const ws1 = XLSX.utils.json_to_sheet(compRows.map(makeRow));
    const ws3 = XLSX.utils.json_to_sheet(
      compRows.filter((r) => r.varQtde !== 0 || (r.varValor != null && r.varValor !== 0)).map(makeRow)
    );

    const totalA = compRows.filter((r) => r.valorA != null);
    const totalB = compRows.filter((r) => r.valorB != null);
    const resumo = [
      { Campo: `Período A`, Valor: `${closedA.label} — ref. ${new Date(dataRefA + "T00:00:00").toLocaleDateString("pt-BR")}` },
      { Campo: `Total SKUs A`, Valor: compRows.filter((r) => r.saldoA !== 0 || r.valorA != null).length },
      { Campo: `Valor Total A (BRL)`, Valor: totalA.length > 0 ? Number(totalA.reduce((s, r) => s + (r.valorA ?? 0), 0).toFixed(2)) : 0 },
      { Campo: `Período B`, Valor: `${closedB.label} — ref. ${new Date(dataRefB + "T00:00:00").toLocaleDateString("pt-BR")}` },
      { Campo: `Total SKUs B`, Valor: compRows.filter((r) => r.saldoB !== 0 || r.valorB != null).length },
      { Campo: `Valor Total B (BRL)`, Valor: totalB.length > 0 ? Number(totalB.reduce((s, r) => s + (r.valorB ?? 0), 0).toFixed(2)) : 0 },
      { Campo: "Produtos com aumento", Valor: compRows.filter((r) => r.varQtde > 0).length },
      { Campo: "Produtos com redução", Valor: compRows.filter((r) => r.varQtde < 0).length },
      { Campo: "Produtos zerados", Valor: compRows.filter((r) => r.isZeroed).length },
      { Campo: "Produtos novos", Valor: compRows.filter((r) => r.isNew).length },
      { Campo: "Variação total BRL", Valor: totalVarValor != null ? Number(totalVarValor.toFixed(2)) : 0 },
    ];
    const ws2 = XLSX.utils.json_to_sheet(resumo);

    // Bold headers
    [ws1, ws2, ws3].forEach((ws) => {
      if (!ws["!ref"]) return;
      const range = XLSX.utils.decode_range(ws["!ref"]);
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r: 0, c });
        if (ws[addr]) ws[addr].s = { font: { bold: true } };
      }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Comparativo");
    XLSX.utils.book_append_sheet(wb, ws2, "Resumo");
    XLSX.utils.book_append_sheet(wb, ws3, "Apenas Variações");

    const fileName = `Comparativo_Fechamentos_${periodoA}_vs_${periodoB}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast.success("Arquivo exportado com sucesso!");
  };

  const renderVar = (val: number) => {
    if (val > 0) return (
      <span className="text-green-600 dark:text-green-400 flex items-center justify-end gap-0.5">
        <ArrowUpRight className="h-3.5 w-3.5" />{formatQty(val)}
      </span>
    );
    if (val < 0) return (
      <span className="text-destructive flex items-center justify-end gap-0.5">
        <ArrowDownRight className="h-3.5 w-3.5" />{formatQty(val)}
      </span>
    );
    return <span className="text-muted-foreground">—</span>;
  };

  const renderPct = (pct: number | null) => {
    if (pct == null) return <span className="text-muted-foreground">—</span>;
    if (pct > 0) return <span className="text-green-600 dark:text-green-400">{formatPct(pct)}</span>;
    if (pct < 0) return <span className="text-destructive">{formatPct(pct)}</span>;
    return <span className="text-muted-foreground">0%</span>;
  };

  const renderValorVar = (v: number | null) => {
    if (v == null) return <span className="text-muted-foreground">—</span>;
    if (v > 0) return <span className="text-green-600 dark:text-green-400">{formatBRL(v)}</span>;
    if (v < 0) return <span className="text-destructive">{formatBRL(v)}</span>;
    return <span className="text-muted-foreground">R$ 0,00</span>;
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Comparação de Fechamentos</SheetTitle>
          <SheetDescription>Compare o estoque oficial entre dois meses fechados</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {loadingMonths && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {monthsLoaded && closedMonths.length === 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Nenhum mês com fechamento oficial encontrado. Feche períodos em Estoques &gt; Fechamentos.
              </AlertDescription>
            </Alert>
          )}

          {monthsLoaded && closedMonths.length > 0 && (
            <>
              {/* Period selectors */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Período A</Label>
                  <Select value={periodoA} onValueChange={(v) => { setPeriodoA(v); setCompRows(null); }}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {closedMonths.map((m) => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium">Período B</Label>
                  <Select value={periodoB} onValueChange={(v) => { setPeriodoB(v); setCompRows(null); }}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {closedMonths.map((m) => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-3">
                <Select value={filterTipo} onValueChange={setFilterTipo}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Tipo do Produto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os tipos</SelectItem>
                    {Object.entries(TIPOS_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Switch id="only-var" checked={onlyChanged} onCheckedChange={setOnlyChanged} />
                  <Label htmlFor="only-var" className="text-sm">Apenas com variação</Label>
                </div>
              </div>

              {periodoA === periodoB && periodoA && (
                <Alert variant="destructive">
                  <AlertDescription>Selecione períodos diferentes.</AlertDescription>
                </Alert>
              )}

              <Button onClick={compare} disabled={!canCompare || loading} className="w-full">
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Comparar
              </Button>
            </>
          )}

          {/* Results */}
          {compRows !== null && compRows.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">
              Nenhum dado encontrado para os períodos selecionados.
            </p>
          )}

          {compRows !== null && compRows.length > 0 && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-green-600 dark:text-green-400">
                      <TrendingUp className="h-4 w-4" />
                      <span className="text-xl font-bold">{increased}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Aumento</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-destructive">
                      <TrendingDown className="h-4 w-4" />
                      <span className="text-xl font-bold">{decreased}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Redução</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-muted-foreground">
                      <Minus className="h-4 w-4" />
                      <span className="text-xl font-bold">{zeroed}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Zerados B</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-3 text-center">
                    <p className="text-lg font-bold">
                      {totalVarValor != null ? renderValorVar(totalVarValor) : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">Var. BRL</p>
                  </CardContent>
                </Card>
              </div>

              {/* Table */}
              <div className="rounded-lg border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Código</TableHead>
                      <TableHead className="text-xs">Descrição</TableHead>
                      <TableHead className="text-xs">Tipo</TableHead>
                      <TableHead className="text-xs text-right">Qtde A</TableHead>
                      <TableHead className="text-xs text-right">Qtde B</TableHead>
                      <TableHead className="text-xs text-right">Var. Qtde</TableHead>
                      <TableHead className="text-xs text-right">Var. %</TableHead>
                      <TableHead className="text-xs text-right">Valor A</TableHead>
                      <TableHead className="text-xs text-right">Valor B</TableHead>
                      <TableHead className="text-xs text-right">Var. Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                          Nenhum resultado
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((r) => (
                        <TableRow key={r.productId}>
                          <TableCell className="font-mono text-xs">{r.codigoProduto}</TableCell>
                          <TableCell className="text-sm">
                            {r.isNegative && <AlertTriangle className="inline h-3.5 w-3.5 text-destructive mr-1" />}
                            <span className={r.isNegative ? "text-destructive" : ""}>{r.nomeProduto}</span>
                            {r.isNew && <Badge className="ml-2 bg-green-600 text-xs">Novo</Badge>}
                            {r.isZeroed && <Badge variant="secondary" className="ml-2 text-xs">Zerado</Badge>}
                          </TableCell>
                          <TableCell className="text-xs">{r.tipoProduto ?? "—"}</TableCell>
                          <TableCell className="text-right text-sm">{formatQty(r.saldoA)}</TableCell>
                          <TableCell className={`text-right text-sm ${r.isNegative ? "text-destructive" : ""}`}>{formatQty(r.saldoB)}</TableCell>
                          <TableCell className="text-right text-sm">{renderVar(r.varQtde)}</TableCell>
                          <TableCell className="text-right text-sm">{renderPct(r.varPct)}</TableCell>
                          <TableCell className="text-right text-sm">
                            {r.valorA != null ? formatBRL(r.valorA) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {r.valorB != null ? formatBRL(r.valorB) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-right text-sm">{renderValorVar(r.varValor)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
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
