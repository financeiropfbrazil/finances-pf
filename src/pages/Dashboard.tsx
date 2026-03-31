import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/contexts/PeriodContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2, AlertTriangle, XCircle, ArrowRight, Download, Lock,
  Landmark, FileText, Package, Building2, Factory, Wallet, Receipt, ArrowLeftRight,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";

interface ReconciliationRow {
  id: string;
  module_name: string;
  accounting_account: string;
  management_balance: number;
  accounting_balance: number;
  difference: number;
  status: string;
  justification: string | null;
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
}

const MODULE_META: Record<string, { titleKey: string; route: string; icon: React.ElementType }> = {
  cash: { titleKey: "module.cash", route: "/cash", icon: Landmark },
  receivables_interno: { titleKey: "module.receivables_interno", route: "/receivables", icon: FileText },
  receivables_externo: { titleKey: "module.receivables_externo", route: "/receivables", icon: FileText },
  inventory: { titleKey: "module.inventory", route: "/inventory", icon: Package },
  fixed_assets: { titleKey: "module.fixed_assets", route: "/fixed-assets", icon: Building2 },
  suppliers: { titleKey: "module.suppliers", route: "/suppliers", icon: Factory },
  loans_cp: { titleKey: "module.loans_cp", route: "/loans", icon: Wallet },
  loans_lp: { titleKey: "module.loans_lp", route: "/loans", icon: Wallet },
  taxes_cp: { titleKey: "module.taxes_cp", route: "/taxes", icon: Receipt },
  taxes_lp: { titleKey: "module.taxes_lp", route: "/taxes", icon: Receipt },
  intercompany: { titleKey: "module.intercompany", route: "/intercompany", icon: ArrowLeftRight },
};

const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatDateBR = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString("pt-BR");
};

function StatusIcon({ status }: { status: string }) {
  if (status === "reconciled") return <CheckCircle2 className="h-7 w-7 text-success" />;
  if (status === "justified") return <AlertTriangle className="h-7 w-7 text-warning" />;
  return <XCircle className="h-7 w-7 text-danger" />;
}

function StatusBadge({ status, t }: { status: string; t: (k: any) => string }) {
  const map: Record<string, { label: string; cls: string }> = {
    reconciled: { label: t("dashboard.reconciled"), cls: "bg-success/20 text-success" },
    justified: { label: t("dashboard.justified"), cls: "bg-warning/20 text-warning" },
    divergent: { label: t("dashboard.divergent"), cls: "bg-danger/20 text-danger" },
  };
  const { label, cls } = map[status] ?? map.divergent;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

const DONUT_COLORS = {
  reconciled: "hsl(168, 80%, 36%)",
  justified: "hsl(45, 98%, 71%)",
  divergent: "hsl(3, 80%, 50%)",
};

export default function Dashboard() {
  const { selectedPeriod } = usePeriod();
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const tableRef = useRef<HTMLDivElement>(null);
  const [closeTarget, setCloseTarget] = useState<string | "all" | null>(null);

  const fetchRows = useCallback(async () => {
    if (!selectedPeriod) return;
    setLoading(true);
    const { data } = await supabase
      .from("reconciliation_summary")
      .select("*")
      .eq("period_id", selectedPeriod.id);
    if (data) setRows(data as unknown as ReconciliationRow[]);
    setLoading(false);
  }, [selectedPeriod]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const isEligible = (row: ReconciliationRow) =>
    (row.status === "reconciled" || row.status === "justified") && !row.closed_at;

  const eligibleCount = rows.filter(isEligible).length;

  const closeModule = async (moduleId: string) => {
    const { error } = await supabase
      .from("reconciliation_summary")
      .update({ closed_at: new Date().toISOString(), closed_by: user?.id ?? null } as any)
      .eq("id", moduleId);
    if (!error) {
      toast.success(t("dashboard.close_success"));
      fetchRows();
    }
  };

  const closeAll = async () => {
    const eligible = rows.filter(isEligible);
    const ids = eligible.map(r => r.id);
    if (ids.length === 0) return;
    const { error } = await supabase
      .from("reconciliation_summary")
      .update({ closed_at: new Date().toISOString(), closed_by: user?.id ?? null } as any)
      .in("id", ids);
    if (!error) {
      toast.success(t("dashboard.close_all_success"));
      fetchRows();
    }
  };

  const handleConfirmClose = () => {
    if (!closeTarget) return;
    if (closeTarget === "all") {
      closeAll();
    } else {
      closeModule(closeTarget);
    }
    setCloseTarget(null);
  };

  const reconciled = rows.filter((r) => r.status === "reconciled").length;
  const justified = rows.filter((r) => r.status === "justified").length;
  const divergent = rows.filter((r) => r.status === "divergent").length;
  const total = rows.length;
  const pct = total > 0 ? Math.round((reconciled / total) * 100) : 0;

  const donutData = useMemo(() => [
    { name: t("dashboard.reconciled"), value: reconciled, color: DONUT_COLORS.reconciled },
    { name: t("dashboard.justified"), value: justified, color: DONUT_COLORS.justified },
    { name: t("dashboard.divergent"), value: divergent, color: DONUT_COLORS.divergent },
  ].filter(d => d.value > 0), [reconciled, justified, divergent, t]);

  const periodLabel = selectedPeriod
    ? `${t(("month." + selectedPeriod.month) as any)} / ${selectedPeriod.year}`
    : "—";

  const lastUpdate = rows.length > 0
    ? formatDateBR(rows.reduce((a, b) => (a.updated_at > b.updated_at ? a : b)).updated_at)
    : null;

  const exportReport = () => {
    // Build CSV content for export
    const header = [t("dashboard.module"), t("dashboard.account"), t("dashboard.management_balance"), t("dashboard.accounting_balance"), t("dashboard.difference"), t("dashboard.status")];
    const csvRows = rows.map(row => {
      const meta = MODULE_META[row.module_name];
      const statusLabel = row.status === "reconciled" ? t("dashboard.reconciled") : row.status === "justified" ? t("dashboard.justified") : t("dashboard.divergent");
      return [
        meta ? t(meta.titleKey as any) : row.module_name,
        row.accounting_account,
        Number(row.management_balance).toFixed(2),
        Number(row.accounting_balance).toFixed(2),
        Number(row.difference).toFixed(2),
        statusLabel,
      ].join(";");
    });
    const csv = [header.join(";"), ...csvRows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reconciliation_report_${periodLabel.replace(/\s/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!selectedPeriod) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        {t("placeholder.message")}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("dashboard.title")}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => setCloseTarget("all")}
            disabled={eligibleCount === 0}
            className="gap-2"
          >
            <Lock className="h-4 w-4" />
            {t("dashboard.close_all")} ({eligibleCount})
          </Button>
          <Button variant="outline" size="sm" onClick={exportReport}>
            <Download className="mr-2 h-4 w-4" />
            {t("dashboard.export")}
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-5">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("header.period")}</span>
            <span className="text-lg font-semibold text-foreground">{periodLabel}</span>
          </div>

          <div className="h-10 w-px bg-border" />

          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("dashboard.last_close")}</span>
            <span className="text-sm text-foreground">
              {lastUpdate ?? t("dashboard.no_close")}
            </span>
          </div>

          <div className="h-10 w-px bg-border" />

          <div className="flex min-w-[200px] flex-1 flex-col gap-1">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">
                {reconciled}/{total} {t("dashboard.modules_reconciled")}
              </span>
              <span className="text-sm font-semibold text-foreground">{pct}%</span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {rows.map((row) => {
          const meta = MODULE_META[row.module_name];
          if (!meta) return null;
          const Icon = meta.icon;
          const isClosed = !!row.closed_at;
          const canClose = isEligible(row);
          return (
            <Card
              key={row.id}
              className={`group cursor-pointer transition-all duration-300 hover:border-primary/50 hover:bg-card/80 ${
                isClosed
                  ? "border-success/40 shadow-[0_0_15px_-3px_hsl(var(--closed-glow)/0.4),0_0_30px_-5px_hsl(var(--closed-glow)/0.2)]"
                  : ""
              }`}
              onClick={() => navigate(meta.route)}
            >
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-5 w-5 ${isClosed ? "text-success" : "text-muted-foreground"}`} />
                    <span className="text-sm font-semibold text-foreground">
                      {t(meta.titleKey as any)}
                    </span>
                  </div>
                  {isClosed ? (
                    <div className="flex items-center gap-1">
                      <Lock className="h-4 w-4 text-success" />
                      <span className="text-[10px] font-semibold text-success">{t("dashboard.closed")}</span>
                    </div>
                  ) : (
                    <StatusIcon status={row.status} />
                  )}
                </div>

                <span className="text-xs text-muted-foreground">
                  {t("dashboard.account")}: {row.accounting_account}
                </span>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">{t("dashboard.management_balance")}</span>
                  <span className="text-right font-medium text-foreground">
                    {formatBRL(Number(row.management_balance))}
                  </span>
                  <span className="text-muted-foreground">{t("dashboard.accounting_balance")}</span>
                  <span className="text-right font-medium text-foreground">
                    {formatBRL(Number(row.accounting_balance))}
                  </span>
                  <span className="text-muted-foreground">{t("dashboard.difference")}</span>
                  <span className={`text-right font-semibold ${Number(row.difference) === 0 ? "text-success" : "text-danger"}`}>
                    {formatBRL(Number(row.difference))}
                  </span>
                </div>

                {isClosed ? (
                  <div className="flex items-center gap-1 text-[10px] text-success/70 mt-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {t("dashboard.closed_at")} {formatDateBR(row.closed_at!)}
                  </div>
                ) : canClose ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 w-full text-xs text-success hover:bg-success/10 hover:text-success opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); setCloseTarget(row.id); }}
                  >
                    <Lock className="mr-1 h-3 w-3" />
                    {t("dashboard.close_module")}
                  </Button>
                ) : (
                  <div className="flex items-center gap-1 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity mt-1">
                    {t("dashboard.view_details")} <ArrowRight className="h-3 w-3" />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts section */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Donut chart */}
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4">{t("dashboard.status_chart")}</h2>
            <div className="flex items-center gap-6">
              <div className="h-48 w-48 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {donutData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string) => [`${value} módulos`, name]}
                      contentStyle={{
                        backgroundColor: "hsl(225, 45%, 15%)",
                        border: "1px solid hsl(225, 20%, 22%)",
                        borderRadius: "8px",
                        color: "hsl(210, 40%, 92%)",
                        fontSize: "12px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-3">
                {[
                  { label: t("dashboard.reconciled"), count: reconciled, color: "bg-success", dot: "bg-success" },
                  { label: t("dashboard.justified"), count: justified, color: "bg-warning", dot: "bg-warning" },
                  { label: t("dashboard.divergent"), count: divergent, color: "bg-danger", dot: "bg-danger" },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2">
                    <div className={`h-3 w-3 rounded-full ${item.dot}`} />
                    <span className="text-sm text-foreground">{item.label}</span>
                    <span className="text-sm font-bold text-foreground ml-auto">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary stats */}
        <Card>
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4">{t("dashboard.summary_stats")}</h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="rounded-lg bg-success/10 p-4">
                <div className="text-3xl font-bold text-success">{reconciled}</div>
                <div className="text-xs text-muted-foreground mt-1">{t("dashboard.reconciled")}</div>
              </div>
              <div className="rounded-lg bg-warning/10 p-4">
                <div className="text-3xl font-bold text-warning">{justified}</div>
                <div className="text-xs text-muted-foreground mt-1">{t("dashboard.justified")}</div>
              </div>
              <div className="rounded-lg bg-danger/10 p-4">
                <div className="text-3xl font-bold text-danger">{divergent}</div>
                <div className="text-xs text-muted-foreground mt-1">{t("dashboard.divergent")}</div>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-border p-3">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-xs text-muted-foreground">{t("dashboard.overall_progress")}</span>
                <span className="text-sm font-bold text-foreground">{pct}%</span>
              </div>
              <Progress value={pct} className="h-3" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary table */}
      <Card ref={tableRef}>
        <CardContent className="p-0">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold text-foreground">{t("dashboard.summary_table")}</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("dashboard.module")}</TableHead>
                <TableHead>{t("dashboard.account")}</TableHead>
                <TableHead className="text-right">{t("dashboard.management_balance")}</TableHead>
                <TableHead className="text-right">{t("dashboard.accounting_balance")}</TableHead>
                <TableHead className="text-right">{t("dashboard.difference")}</TableHead>
                <TableHead className="text-center">{t("dashboard.status")}</TableHead>
                <TableHead className="text-center w-[120px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const meta = MODULE_META[row.module_name];
                if (!meta) return null;
                const isClosed = !!row.closed_at;
                const canClose = isEligible(row);
                return (
                  <TableRow
                    key={row.id}
                    className={`cursor-pointer hover:bg-muted/30 ${isClosed ? "bg-success/[0.03]" : ""}`}
                    onClick={() => navigate(meta.route)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {isClosed && <Lock className="h-3.5 w-3.5 text-success" />}
                        {t(meta.titleKey as any)}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.accounting_account}</TableCell>
                    <TableCell className="text-right">{formatBRL(Number(row.management_balance))}</TableCell>
                    <TableCell className="text-right">{formatBRL(Number(row.accounting_balance))}</TableCell>
                    <TableCell className={`text-right font-semibold ${Number(row.difference) === 0 ? "text-success" : "text-danger"}`}>
                      {formatBRL(Number(row.difference))}
                    </TableCell>
                    <TableCell className="text-center">
                      {isClosed ? (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-success/20 text-success">
                          {t("dashboard.closed")}
                        </span>
                      ) : (
                        <StatusBadge status={row.status} t={t} />
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {isClosed ? (
                        <span className="text-[10px] text-muted-foreground">{formatDateBR(row.closed_at!)}</span>
                      ) : canClose ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] text-success hover:bg-success/10 hover:text-success"
                          onClick={(e) => { e.stopPropagation(); setCloseTarget(row.id); }}
                        >
                          <Lock className="mr-1 h-3 w-3" />
                          {t("dashboard.close_module")}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Close confirmation dialog */}
      <AlertDialog open={!!closeTarget} onOpenChange={() => setCloseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dashboard.close_confirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {closeTarget === "all" ? t("dashboard.close_confirm_all") : t("dashboard.close_confirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cash.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmClose} className="bg-success hover:bg-success/90">
              <Lock className="mr-2 h-4 w-4" />
              {t("dashboard.close_module")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
