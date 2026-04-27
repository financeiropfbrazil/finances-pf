import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/contexts/PeriodContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Search, TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { TIPOS_VISIVEIS_ESTOQUE, TIPOS_LABEL as TIPOS_LABEL_GLOBAL } from "@/constants/stockTipos";


const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatQty = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

const formatPct = (v: number) =>
  `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

interface BalanceRow {
  productId: string;
  quantidade: number;
  valorTotalBrl: number | null;
  fonte: string;
}

interface ProductInfo {
  id: string;
  codigoProduto: string;
  nomeProduto: string;
  tipoProduto: string | null;
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
}

async function fetchBalances(periodo: string): Promise<BalanceRow[]> {
  let all: any[] = [];
  let from = 0;
  const bs = 1000;
  let done = false;
  while (!done) {
    const { data } = await supabase
      .from("stock_balance")
      .select("product_id, quantidade, valor_total_brl, fonte")
      .eq("periodo", periodo)
      .range(from, from + bs - 1);
    if (data && data.length > 0) {
      all = all.concat(data);
      from += bs;
      if (data.length < bs) done = true;
    } else done = true;
  }
  return all.map((b) => ({
    productId: b.product_id,
    quantidade: Number(b.quantidade),
    valorTotalBrl: b.valor_total_brl != null ? Number(b.valor_total_brl) : null,
    fonte: b.fonte,
  }));
}

async function fetchProducts(): Promise<ProductInfo[]> {
  let all: any[] = [];
  let from = 0;
  const bs = 1000;
  let done = false;
  while (!done) {
    const { data } = await supabase
      .from("stock_products")
      .select("id, codigo_produto, nome_produto, tipo_produto")
      .eq("ativo", true)
      .range(from, from + bs - 1);
    if (data && data.length > 0) {
      all = all.concat(data);
      from += bs;
      if (data.length < bs) done = true;
    } else done = true;
  }
  return all.map((p) => ({
    id: p.id,
    codigoProduto: p.codigo_produto,
    nomeProduto: p.nome_produto,
    tipoProduto: p.tipo_produto,
  }));
}

export function InventoryComparative() {
  const { periods } = usePeriod();

  const periodOptions = useMemo(() => {
    return periods.map((p) => ({
      value: `${p.year}-${String(p.month).padStart(2, "0")}`,
      label: `${String(p.month).padStart(2, "0")}/${p.year}`,
    }));
  }, [periods]);

  const [periodoA, setPeriodoA] = useState<string>("");
  const [periodoB, setPeriodoB] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [compRows, setCompRows] = useState<CompRow[]>([]);
  const [filterTipo, setFilterTipo] = useState("all");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [search, setSearch] = useState("");

  // Auto-select last two periods
  useEffect(() => {
    if (periodOptions.length >= 2 && !periodoA && !periodoB) {
      setPeriodoA(periodOptions[1].value);
      setPeriodoB(periodOptions[0].value);
    } else if (periodOptions.length === 1 && !periodoA) {
      setPeriodoA(periodOptions[0].value);
    }
  }, [periodOptions, periodoA, periodoB]);

  const loadComparison = useCallback(async () => {
    if (!periodoA || !periodoB || periodoA === periodoB) return;
    setLoading(true);

    const [balA, balB, products] = await Promise.all([
      fetchBalances(periodoA),
      fetchBalances(periodoB),
      fetchProducts(),
    ]);

    const prodMap = new Map(products.map((p) => [p.id, p]));
    const mapA = new Map(balA.map((b) => [b.productId, b]));
    const mapB = new Map(balB.map((b) => [b.productId, b]));

    const allIds = new Set([...mapA.keys(), ...mapB.keys()]);
    const rows: CompRow[] = [];

    allIds.forEach((pid) => {
      const prod = prodMap.get(pid);
      if (!prod) return;
      const a = mapA.get(pid);
      const b = mapB.get(pid);
      const sA = a?.quantidade ?? 0;
      const sB = b?.quantidade ?? 0;
      const vA = a?.valorTotalBrl ?? null;
      const vB = b?.valorTotalBrl ?? null;
      const varQ = sB - sA;
      const varPct = sA !== 0 ? ((sB - sA) / Math.abs(sA)) * 100 : sB !== 0 ? 100 : null;
      const varV = vA != null && vB != null ? vB - vA : null;

      rows.push({
        productId: pid,
        codigoProduto: prod.codigoProduto,
        nomeProduto: prod.nomeProduto,
        tipoProduto: prod.tipoProduto,
        saldoA: sA,
        saldoB: sB,
        varQtde: varQ,
        varPct: varPct,
        valorA: vA,
        valorB: vB,
        varValor: varV,
        isNew: !a && !!b,
        isZeroed: sA > 0 && sB === 0,
      });
    });

    rows.sort((a, b) => a.codigoProduto.localeCompare(b.codigoProduto));
    setCompRows(rows);
    setLoading(false);
  }, [periodoA, periodoB]);

  useEffect(() => {
    loadComparison();
  }, [loadComparison]);

  const filtered = useMemo(() => {
    return compRows.filter((r) => {
      if (onlyChanged && r.varQtde === 0 && r.varValor === null) return false;
      if (onlyChanged && r.varQtde === 0 && r.varValor === 0) return false;
      if (filterTipo !== "all" && r.tipoProduto !== filterTipo) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!r.codigoProduto.toLowerCase().includes(q) && !r.nomeProduto.toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [compRows, onlyChanged, filterTipo, search]);

  const tipoOptions = useMemo(() => {
    const s = new Set<string>();
    compRows.forEach((r) => { if (r.tipoProduto) s.add(r.tipoProduto); });
    return Array.from(s).sort();
  }, [compRows]);

  // Summary
  const increased = useMemo(() => filtered.filter((r) => r.varQtde > 0).length, [filtered]);
  const decreased = useMemo(() => filtered.filter((r) => r.varQtde < 0).length, [filtered]);
  const zeroed = useMemo(() => filtered.filter((r) => r.isZeroed).length, [filtered]);
  const totalVarValor = useMemo(() => {
    const valid = filtered.filter((r) => r.varValor != null);
    if (valid.length === 0) return null;
    return valid.reduce((s, r) => s + (r.varValor ?? 0), 0);
  }, [filtered]);

  const renderVar = (val: number, pct: number | null) => {
    if (val > 0) return (
      <span className="text-green-600 dark:text-green-400 flex items-center justify-end gap-0.5">
        <ArrowUpRight className="h-3.5 w-3.5" />
        {formatQty(val)}
      </span>
    );
    if (val < 0) return (
      <span className="text-destructive flex items-center justify-end gap-0.5">
        <ArrowDownRight className="h-3.5 w-3.5" />
        {formatQty(val)}
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

  const labelA = periodOptions.find((p) => p.value === periodoA)?.label ?? periodoA;
  const labelB = periodOptions.find((p) => p.value === periodoB)?.label ?? periodoB;

  return (
    <div className="space-y-6">
      {/* Period selectors */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium whitespace-nowrap">Período A:</Label>
          <Select value={periodoA} onValueChange={setPeriodoA}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium whitespace-nowrap">Período B:</Label>
          <Select value={periodoB} onValueChange={setPeriodoB}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {periodoA === periodoB && periodoA && (
          <span className="text-sm text-destructive">Selecione períodos diferentes</span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && compRows.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="flex items-center justify-center gap-1.5 text-green-600 dark:text-green-400">
                  <TrendingUp className="h-5 w-5" />
                  <span className="text-2xl font-bold">{increased}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Aumento de saldo</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="flex items-center justify-center gap-1.5 text-destructive">
                  <TrendingDown className="h-5 w-5" />
                  <span className="text-2xl font-bold">{decreased}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Redução de saldo</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                  <Minus className="h-5 w-5" />
                  <span className="text-2xl font-bold">{zeroed}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Zerados no período B</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">
                  {totalVarValor != null ? renderValorVar(totalVarValor) : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">Variação total BRL</p>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
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
                      <SelectItem key={t} value={t}>{TIPOS_LABEL_GLOBAL[t] ?? t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-muted-foreground/20 bg-background">
                  <Switch id="only-changed" checked={onlyChanged} onCheckedChange={setOnlyChanged} />
                  <Label htmlFor="only-changed" className="text-sm cursor-pointer whitespace-nowrap">Com variação</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Código</TableHead>
                      <TableHead className="text-xs">Descrição</TableHead>
                      <TableHead className="text-xs">Tipo</TableHead>
                      <TableHead className="text-xs text-right">Saldo {labelA}</TableHead>
                      <TableHead className="text-xs text-right">Saldo {labelB}</TableHead>
                      <TableHead className="text-xs text-right">Var. Qtde</TableHead>
                      <TableHead className="text-xs text-right">Var. %</TableHead>
                      <TableHead className="text-xs text-right">Valor {labelA}</TableHead>
                      <TableHead className="text-xs text-right">Valor {labelB}</TableHead>
                      <TableHead className="text-xs text-right">Var. Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                          Nenhum resultado encontrado
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((r) => (
                        <TableRow key={r.productId}>
                          <TableCell className="font-mono text-xs">{r.codigoProduto}</TableCell>
                          <TableCell className="text-sm">
                            {r.nomeProduto}
                            {r.isNew && (
                              <Badge className="ml-2 bg-green-600 text-xs">Novo</Badge>
                            )}
                            {r.isZeroed && (
                              <Badge variant="secondary" className="ml-2 text-xs">Zerado</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs">{r.tipoProduto ?? "—"}</TableCell>
                          <TableCell className="text-right text-sm">{formatQty(r.saldoA)}</TableCell>
                          <TableCell className="text-right text-sm">{formatQty(r.saldoB)}</TableCell>
                          <TableCell className="text-right text-sm">{renderVar(r.varQtde, r.varPct)}</TableCell>
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
            </CardContent>
          </Card>
        </>
      )}

      {!loading && compRows.length === 0 && periodoA && periodoB && periodoA !== periodoB && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-2 text-center">
            <p className="text-muted-foreground">Nenhum dado de saldo encontrado para os períodos selecionados.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
