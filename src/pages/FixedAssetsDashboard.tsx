import { useLanguage } from "@/contexts/LanguageContext";
import { useFixedAssets } from "@/hooks/useFixedAssets";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Building2, Loader2, Calculator, ClipboardCheck, Download } from "lucide-react";
import FixedAssetsSummaryCard from "@/components/fixed-assets/FixedAssetsSummaryCard";
import MonthlyMovementReport from "@/components/fixed-assets/MonthlyMovementReport";
import AssetEvolutionChart from "@/components/fixed-assets/AssetEvolutionChart";

export default function FixedAssetsDashboard() {
  const { t } = useLanguage();
  const {
    selectedPeriod, categories,
    loading, calculating, importing, importProgress,
    totals, accNum, diff, status, reconTotals, summary,
    lastAuditDate, stats,
    handleImportAudit, handleCalculateDepreciation,
  } = useFixedAssets();

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
          <h1 className="text-2xl font-bold text-foreground">Imobilizado — Dashboard</h1>
          {lastAuditDate && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <ClipboardCheck className="h-3 w-3" />
              Última auditoria: {new Date(lastAuditDate).toLocaleDateString("pt-BR")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleImportAudit} disabled={importing}>
            {importing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            Receber Dados
          </Button>
          <Button variant="outline" size="sm" onClick={handleCalculateDepreciation} disabled={calculating}>
            {calculating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Calculator className="mr-1.5 h-4 w-4" />}
            Calcular Depreciação
          </Button>
        </div>
      </div>

      {/* Summary card */}
      <FixedAssetsSummaryCard
        grossValue={totals.gross}
        depreciation={totals.dep}
        netValue={totals.net}
        accountingBalance={accNum}
        difference={diff}
        status={status}
        justification={reconTotals ? null : summary?.justification}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-foreground">{stats.total}</p>
            <p className="text-[11px] text-muted-foreground">Total de Bens</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-success">{stats.active}</p>
            <p className="text-[11px] text-muted-foreground">Ativos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-muted-foreground">{stats.disposed}</p>
            <p className="text-[11px] text-muted-foreground">Baixados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-warning">{stats.fullyDepreciated}</p>
            <p className="text-[11px] text-muted-foreground">100% Depreciados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-foreground">{stats.fromAudit}</p>
            <p className="text-[11px] text-muted-foreground">Via Auditoria</p>
          </CardContent>
        </Card>
      </div>

      {/* Asset Evolution Chart */}
      <AssetEvolutionChart />

      {/* Monthly Movement Report */}
      {selectedPeriod && (
        <MonthlyMovementReport
          categories={categories}
          periodId={selectedPeriod.id}
          periodYear={selectedPeriod.year}
          periodMonth={selectedPeriod.month}
        />
      )}

      {/* Import progress modal */}
      <Dialog open={importing} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Recebendo Dados do Audit App</DialogTitle>
            <DialogDescription>{importProgress.phase}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Progress value={importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0} className="h-2" />
            <p className="text-sm text-center text-muted-foreground">
              {importProgress.current} de {importProgress.total}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
