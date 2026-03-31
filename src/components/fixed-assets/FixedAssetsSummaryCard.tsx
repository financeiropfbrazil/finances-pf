import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, XCircle, AlertTriangle, Building2 } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  grossValue: number;
  depreciation: number;
  netValue: number;
  accountingBalance: number;
  difference: number;
  status: string;
  justification?: string | null;
}

export default function FixedAssetsSummaryCard({
  grossValue, depreciation, netValue, accountingBalance, difference, status, justification,
}: Props) {
  const { t } = useLanguage();

  const StatusIcon = () => {
    if (status === "reconciled") return <CheckCircle2 className="h-8 w-8 text-success" />;
    if (status === "justified") return <AlertTriangle className="h-8 w-8 text-warning" />;
    return <XCircle className="h-8 w-8 text-danger" />;
  };

  const statusLabel = status === "reconciled" ? t("dashboard.reconciled")
    : status === "justified" ? t("dashboard.justified")
    : t("dashboard.divergent");

  return (
    <Card>
      <CardContent className="p-5">
        <div className="grid gap-6 md:grid-cols-[1fr_auto_1fr_auto_auto]">
          {/* Asset values */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t("fa.asset_values")}
            </h2>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("fa.gross_value")}</span>
              <p className="text-base font-semibold text-foreground">{formatBRL(grossValue)}</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">(-) {t("fa.depreciation")}</span>
              <p className="text-base font-semibold text-danger">
                {depreciation > 0 ? `- ${formatBRL(depreciation)}` : formatBRL(0)}
              </p>
            </div>
            <div className="border-t border-border pt-2 space-y-1">
              <span className="text-xs text-muted-foreground">(=) {t("fa.net_value")}</span>
              <p className="text-lg font-bold text-foreground">{formatBRL(netValue)}</p>
            </div>
          </div>

          <div className="hidden md:block w-px bg-border" />

          {/* Accounting */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t("fa.accounting")}
            </h2>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground">{t("dashboard.accounting_balance")} (1.2.05)</span>
              <p className="text-base font-semibold text-foreground">{formatBRL(accountingBalance)}</p>
            </div>
            <div className="border-t border-border pt-2 space-y-1">
              <span className="text-xs text-muted-foreground">{t("dashboard.difference")}</span>
              <p className={`text-lg font-bold ${difference === 0 ? "text-success" : "text-danger"}`}>
                {formatBRL(difference)}
              </p>
            </div>
            {justification && (
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">{t("cash.justification")}</span>
                <p className="text-sm text-foreground">{justification}</p>
              </div>
            )}
          </div>

          <div className="hidden md:block w-px bg-border" />

          {/* Status */}
          <div className="flex flex-col items-center justify-center gap-2 min-w-[120px]">
            <StatusIcon />
            <span className="text-sm font-semibold text-foreground">{statusLabel}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
