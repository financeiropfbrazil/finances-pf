import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

const CATEGORIES = ["materia_prima", "em_elaboracao", "produto_acabado", "embalagem", "outros"] as const;

const CAT_COLORS: Record<string, string> = {
  materia_prima: "bg-primary/20 text-primary border-primary/30",
  em_elaboracao: "bg-warning/20 text-warning border-warning/30",
  produto_acabado: "bg-success/20 text-success border-success/30",
  embalagem: "bg-accent/20 text-accent-foreground border-accent/30",
  outros: "bg-muted text-muted-foreground border-border",
};

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? <CheckCircle2 className="h-5 w-5 text-success" /> : <XCircle className="h-5 w-5 text-danger" />;
}

interface Props {
  totalInventory: number;
  accountingBalance: number;
  diff: number;
  categoryTotals: Record<string, number>;
  filterCategory: string;
  setFilterCategory: (c: string) => void;
}

export function InventorySummaryCards({ totalInventory, accountingBalance, diff, categoryTotals, filterCategory, setFilterCategory }: Props) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-5">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("inv.physical_total")}</span>
            <span className="text-lg font-semibold text-foreground">{formatBRL(totalInventory)}</span>
          </div>
          <div className="h-10 w-px bg-border" />
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("dashboard.accounting_balance")}</span>
            <span className="text-lg font-semibold text-foreground">{formatBRL(accountingBalance)}</span>
          </div>
          <div className="h-10 w-px bg-border" />
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("dashboard.difference")}</span>
            <span className={`text-lg font-semibold ${diff === 0 ? "text-success" : "text-danger"}`}>
              {formatBRL(diff)}
            </span>
          </div>
          <div className="h-10 w-px bg-border" />
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-muted-foreground">{t("cash.reconciliation_status")}</span>
            <StatusIcon ok={diff === 0} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(filterCategory === cat ? "all" : cat)}
            className={`rounded-lg border p-4 text-center transition-all ${CAT_COLORS[cat]} ${filterCategory === cat ? "ring-2 ring-ring" : ""}`}
          >
            <div className="text-xs font-medium mb-1">{t(("inv.cat." + cat) as any)}</div>
            <div className="text-lg font-bold">{formatBRL(categoryTotals[cat])}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
