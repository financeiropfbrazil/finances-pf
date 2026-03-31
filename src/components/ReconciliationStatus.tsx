import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface ReconciliationStatusProps {
  /** Module label displayed at top left */
  label: string;
  /** Accounting account code displayed next to label */
  accountCode: string;
  /** Management (operational) balance */
  managementBalance: number;
  /** Accounting (ledger) balance */
  accountingBalance: number;
  /** reconciled | justified | divergent */
  status: string;
  /** Optional: override computed difference */
  difference?: number;
  /** Compact mode — smaller card */
  compact?: boolean;
}

function StatusIcon({ status, size = "md" }: { status: string; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "lg" ? "h-10 w-10" : size === "sm" ? "h-4 w-4" : "h-5 w-5";
  if (status === "reconciled") return <CheckCircle2 className={`${sizeClass} text-success`} />;
  if (status === "justified") return <AlertTriangle className={`${sizeClass} text-warning`} />;
  return <XCircle className={`${sizeClass} text-danger`} />;
}

export { StatusIcon };

export function ReconciliationStatus({
  label,
  accountCode,
  managementBalance,
  accountingBalance,
  status,
  difference,
  compact = false,
}: ReconciliationStatusProps) {
  const { t } = useLanguage();
  const diff = difference ?? managementBalance - accountingBalance;

  return (
    <Card>
      <CardContent className={compact ? "p-3" : "p-5"}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className={`font-semibold text-foreground ${compact ? "text-xs" : "text-sm"}`}>
              {label}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">{accountCode}</span>
          </div>
          <StatusIcon status={status} size={compact ? "sm" : "md"} />
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xs text-muted-foreground">
              {t("dashboard.management_balance")}
            </div>
            <div className={`font-bold text-foreground ${compact ? "text-sm" : "text-lg"}`}>
              {formatBRL(managementBalance)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("dashboard.accounting_balance")}
            </div>
            <div className={`font-bold text-foreground ${compact ? "text-sm" : "text-lg"}`}>
              {formatBRL(accountingBalance)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("dashboard.difference")}
            </div>
            <div
              className={`font-bold ${compact ? "text-sm" : "text-lg"} ${
                diff === 0 ? "text-success" : "text-danger"
              }`}
            >
              {formatBRL(diff)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
