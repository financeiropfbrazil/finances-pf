import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useFixedAssets } from "@/hooks/useFixedAssets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Building2, Pencil, FileSpreadsheet } from "lucide-react";
import FixedAssetsSummaryCard from "@/components/fixed-assets/FixedAssetsSummaryCard";
import ReconciliationByAccount from "@/components/fixed-assets/ReconciliationByAccount";
import { exportFixedAssetsExcel } from "@/services/fixedAssetsExport";

export default function FixedAssetsReconciliation() {
  const { t } = useLanguage();
  const {
    selectedPeriod, periods, categories, items,
    summary, reconciliation, loading,
    totals, reconTotals, accNum, diff, status,
    categoryIdLabelMap, fetchData, handleSaveSummary,
  } = useFixedAssets();

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [accBalance, setAccBalance] = useState(String(summary?.accounting_balance ?? 0));
  const [justification, setJustification] = useState(summary?.justification ?? "");

  // Sync modal fields when summary changes
  const openEditModal = () => {
    setAccBalance(String(summary?.accounting_balance ?? 0));
    setJustification(summary?.justification ?? "");
    setEditModalOpen(true);
  };

  const onSave = async () => {
    const ok = await handleSaveSummary(accBalance, justification);
    if (ok) setEditModalOpen(false);
  };

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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Imobilizado — Conciliação Contábil</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            if (!selectedPeriod) return;
            exportFixedAssetsExcel({
              periodId: selectedPeriod.id, periodYear: selectedPeriod.year, periodMonth: selectedPeriod.month,
              categories, items, reconciliation, categoryIdLabelMap, periods,
            });
          }}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            Exportar Excel
          </Button>
          {summary && reconciliation.length === 0 && (
            <Button variant="outline" size="sm" onClick={openEditModal}>
              <Pencil className="mr-1.5 h-4 w-4" />
              Saldo Contábil
            </Button>
          )}
        </div>
      </div>

      {/* Summary */}
      <FixedAssetsSummaryCard
        grossValue={totals.gross}
        depreciation={totals.dep}
        netValue={totals.net}
        accountingBalance={accNum}
        difference={diff}
        status={status}
        justification={reconTotals ? null : summary?.justification}
      />

      {/* Reconciliation by account */}
      <ReconciliationByAccount
        rows={reconciliation}
        categoryLabels={categoryIdLabelMap}
        onRefresh={fetchData}
      />

      {/* Edit accounting balance modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar Saldo Contábil</DialogTitle>
            <DialogDescription>
              Atualize o saldo contábil do balancete e adicione justificativa se houver diferença.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">{t("dashboard.accounting_balance")} (1.2.05)</Label>
              <Input type="number" step="0.01" value={accBalance} onChange={(e) => setAccBalance(e.target.value)} />
            </div>
            {(parseFloat(accBalance) || 0) !== totals.net && (
              <div className="space-y-1">
                <Label className="text-xs">{t("cash.justification")}</Label>
                <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} placeholder="Justifique a diferença..." />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditModalOpen(false)}>{t("cash.cancel")}</Button>
              <Button onClick={onSave}>{t("cash.save")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
