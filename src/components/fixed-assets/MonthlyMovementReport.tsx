import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/contexts/PeriodContext";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, TrendingUp } from "lucide-react";

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface CategoryInfo {
  id: string;
  code: string;
  label: string;
  account_asset: string;
}

interface MovementRow {
  categoryLabel: string;
  account: string;
  priorBalance: number;
  acquisitions: number;
  disposals: number;
  depreciationMonth: number;
  finalBalance: number;
}

interface Props {
  categories: CategoryInfo[];
  periodId: string;
  periodYear: number;
  periodMonth: number;
}

export default function MonthlyMovementReport({ categories, periodId, periodYear, periodMonth }: Props) {
  const { periods } = usePeriod();
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasDepreciation, setHasDepreciation] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadMovementData();
  }, [periodId, categories]);

  const loadMovementData = async () => {
    if (!periodId || categories.length === 0) return;
    setLoading(true);

    // Find prior period
    const priorDate = new Date(periodYear, periodMonth - 2, 1); // month is 1-indexed
    const priorYear = priorDate.getFullYear();
    const priorMonth = priorDate.getMonth() + 1;
    const priorPeriod = periods.find(p => p.year === priorYear && p.month === priorMonth);

    // Fetch data in parallel
    const [currentItemsRes, depHistoryRes, priorItemsRes] = await Promise.all([
      supabase.from("fixed_assets_items").select("category_id, gross_value, accumulated_depreciation, status, acquisition_date, source")
        .eq("period_id", periodId),
      supabase.from("depreciation_history").select("category_id, depreciation_amount")
        .eq("period_id", periodId),
      priorPeriod
        ? supabase.from("fixed_assets_items").select("category_id, gross_value, accumulated_depreciation, status")
            .eq("period_id", priorPeriod.id).eq("status", "ativo")
        : Promise.resolve({ data: null }),
    ]);

    const currentItems = currentItemsRes.data ?? [];
    const depHistory = depHistoryRes.data ?? [];
    const priorItems = priorItemsRes.data ?? [];

    setHasDepreciation(depHistory.length > 0);

    // Build per-category aggregates
    const result: MovementRow[] = [];

    // Prior balances by category
    const priorByCat: Record<string, number> = {};
    for (const item of priorItems) {
      const catId = item.category_id ?? "_none";
      priorByCat[catId] = (priorByCat[catId] ?? 0) + Number(item.gross_value) - Number(item.accumulated_depreciation);
    }

    // Current period boundaries
    const periodStart = new Date(periodYear, periodMonth - 1, 1);
    const periodEnd = new Date(periodYear, periodMonth, 0); // last day

    for (const cat of categories) {
      const catItems = currentItems.filter(i => i.category_id === cat.id);
      
      // Acquisitions: items whose acquisition_date falls within this period
      const acquisitions = catItems
        .filter(i => {
          if (!i.acquisition_date) return false;
          const d = new Date(i.acquisition_date);
          return d >= periodStart && d <= periodEnd;
        })
        .reduce((s, i) => s + Number(i.gross_value), 0);

      // Disposals: items with status = 'baixado'
      const disposals = catItems
        .filter(i => i.status === "baixado")
        .reduce((s, i) => s + Number(i.gross_value), 0);

      // Depreciation from history
      const depMonth = depHistory
        .filter(d => d.category_id === cat.id)
        .reduce((s, d) => s + Number(d.depreciation_amount), 0);

      const prior = priorByCat[cat.id] ?? 0;
      
      // Final balance: net value of active items in this category
      const finalBal = catItems
        .filter(i => i.status === "ativo")
        .reduce((s, i) => s + Number(i.gross_value) - Number(i.accumulated_depreciation), 0);

      // Only show categories that have any activity
      if (prior !== 0 || acquisitions !== 0 || disposals !== 0 || depMonth !== 0 || finalBal !== 0) {
        result.push({
          categoryLabel: cat.label,
          account: cat.account_asset,
          priorBalance: prior,
          acquisitions,
          disposals,
          depreciationMonth: depMonth,
          finalBalance: finalBal,
        });
      }
    }

    setRows(result);
    setLoading(false);
  };

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        priorBalance: acc.priorBalance + r.priorBalance,
        acquisitions: acc.acquisitions + r.acquisitions,
        disposals: acc.disposals + r.disposals,
        depreciationMonth: acc.depreciationMonth + r.depreciationMonth,
        finalBalance: acc.finalBalance + r.finalBalance,
      }),
      { priorBalance: 0, acquisitions: 0, disposals: 0, depreciationMonth: 0, finalBalance: 0 }
    );
  }, [rows]);

  if (loading) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="border-border/50 bg-card/80">
        <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors rounded-t-lg">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Movimentação do Mês</span>
          </div>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-3 px-3">
            {!hasDepreciation ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Calcule a depreciação primeiro para gerar o relatório de movimentação.
              </p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhuma movimentação encontrada neste período.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border/40">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="text-xs font-semibold">Conta</TableHead>
                      <TableHead className="text-xs font-semibold text-right">Saldo Anterior</TableHead>
                      <TableHead className="text-xs font-semibold text-right">(+) Aquisições</TableHead>
                      <TableHead className="text-xs font-semibold text-right">(-) Baixas</TableHead>
                      <TableHead className="text-xs font-semibold text-right">(-) Depr. Mês</TableHead>
                      <TableHead className="text-xs font-semibold text-right">(=) Saldo Final</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, idx) => (
                      <TableRow key={idx} className="text-xs">
                        <TableCell className="font-medium">
                          <span className="text-muted-foreground">{row.account}</span>{" "}
                          {row.categoryLabel}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(row.priorBalance)}</TableCell>
                        <TableCell className="text-right tabular-nums text-success">{formatBRL(row.acquisitions)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${row.disposals > 0 ? "text-destructive" : ""}`}>
                          {formatBRL(row.disposals)}
                        </TableCell>
                        <TableCell className={`text-right tabular-nums ${row.depreciationMonth > 0 ? "text-destructive" : ""}`}>
                          {formatBRL(row.depreciationMonth)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{formatBRL(row.finalBalance)}</TableCell>
                      </TableRow>
                    ))}
                    {/* Total row */}
                    <TableRow className="bg-muted/30 font-bold text-xs border-t-2 border-border">
                      <TableCell className="font-bold">TOTAL</TableCell>
                      <TableCell className="text-right tabular-nums font-bold">{formatBRL(totals.priorBalance)}</TableCell>
                      <TableCell className="text-right tabular-nums font-bold text-success">{formatBRL(totals.acquisitions)}</TableCell>
                      <TableCell className={`text-right tabular-nums font-bold ${totals.disposals > 0 ? "text-destructive" : ""}`}>
                        {formatBRL(totals.disposals)}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-bold ${totals.depreciationMonth > 0 ? "text-destructive" : ""}`}>
                        {formatBRL(totals.depreciationMonth)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-bold">{formatBRL(totals.finalBalance)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
