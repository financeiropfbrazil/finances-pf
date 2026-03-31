import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  ArrowUpRight, ArrowDownLeft, FileText,
  CheckCircle2, Clock, TrendingUp, TrendingDown, ArrowRightLeft,
} from "lucide-react";

interface IntercompanyRow {
  direction: string;
  original_amount: number;
  exchange_rate: number;
  status: string;
  source: string;
  doc_type: string | null;
  amount_brl: number | null;
  payment_status: string | null;
  payment_amount_brl: number | null;
  fx_variation: number | null;
  payment_additions: number | null;
  payment_deductions: number | null;
}

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function sumBRL(rows: IntercompanyRow[], filter: (r: IntercompanyRow) => boolean) {
  return rows.filter(filter).reduce((s, r) => s + (Number(r.amount_brl) || r.original_amount * r.exchange_rate), 0);
}

export default function IntercompanySummaryCards({ rows }: { rows: IntercompanyRow[] }) {
  const { t } = useLanguage();

  const totalPayable = sumBRL(rows, r => r.direction === "a_pagar" && r.status !== "liquidado");
  const totalReceivable = sumBRL(rows, r => r.direction === "a_receber" && r.status !== "liquidado");
  const totalNfe = sumBRL(rows, r => r.doc_type === "nf-e");
  const totalNfse = sumBRL(rows, r => r.doc_type === "nfs-e");
  const totalInv = sumBRL(rows, r => r.doc_type === "inv");

  const cards = [
    { label: t("ic.total_payable"), value: totalPayable, icon: ArrowUpRight, color: "text-destructive" },
    { label: t("ic.total_receivable"), value: totalReceivable, icon: ArrowDownLeft, color: "text-success" },
    { label: t("ic.total_nfe" as any), value: totalNfe, icon: FileText, color: "text-emerald-600" },
    { label: t("ic.total_nfse" as any), value: totalNfse, icon: FileText, color: "text-primary" },
    { label: t("ic.total_inv" as any), value: totalInv, icon: FileText, color: "text-amber-600" },
  ];

  // Payment summary — only show if at least one row has been updated
  const hasPaymentData = rows.some(r => r.payment_status && r.payment_status !== "em_aberto");

  const totalReceived = rows
    .filter(r => r.payment_status === "recebido" || r.payment_status === "parcial")
    .reduce((s, r) => s + (r.payment_amount_brl || 0), 0);

  const totalOpen = rows
    .filter(r => !r.payment_status || r.payment_status === "em_aberto")
    .reduce((s, r) => s + (Number(r.amount_brl) || r.original_amount * r.exchange_rate), 0);

  const totalFxVariation = rows
    .filter(r => r.fx_variation != null)
    .reduce((s, r) => s + (r.fx_variation || 0), 0);

  const totalNetAdjustments = rows
    .filter(r => r.payment_additions != null || r.payment_deductions != null)
    .reduce((s, r) => s + ((r.payment_additions || 0) - (r.payment_deductions || 0)), 0);

  const fxLabel = totalFxVariation > 0 ? "Ganho Cambial" : totalFxVariation < 0 ? "Perda Cambial" : "Sem Variação";
  const FxIcon = totalFxVariation >= 0 ? TrendingUp : TrendingDown;
  const fxColor = totalFxVariation > 0 ? "text-success" : totalFxVariation < 0 ? "text-destructive" : "text-muted-foreground";

  return (
    <div className="space-y-3">
      {/* Row 1 — Document totals */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
        {cards.map(c => (
          <Card key={c.label}>
            <CardContent className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4">
              <c.icon className={`h-5 w-5 ${c.color} shrink-0`} />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{c.label}</p>
                <p className="text-sm font-bold">{formatBRL(c.value)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Row 2 — Payment summary (only if payments have been synced) */}
      {hasPaymentData && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
          <Card className="border-success/30 bg-success/5">
            <CardContent className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4">
              <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">Total Recebido</p>
                <p className="text-sm font-bold text-success">{formatBRL(totalReceived)}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4">
              <Clock className="h-5 w-5 text-warning shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">Em Aberto</p>
                <p className="text-sm font-bold text-warning">{formatBRL(totalOpen)}</p>
              </div>
            </CardContent>
          </Card>

          <Card className={`${totalFxVariation > 0 ? "border-success/30 bg-success/5" : totalFxVariation < 0 ? "border-destructive/30 bg-destructive/5" : "border-muted bg-muted/30"}`}>
            <CardContent className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4">
              <FxIcon className={`h-5 w-5 ${fxColor} shrink-0`} />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">{fxLabel}</p>
                <p className={`text-sm font-bold ${fxColor}`}>{formatBRL(totalFxVariation)}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex items-center gap-2 sm:gap-3 p-3 sm:p-4">
              <ArrowRightLeft className="h-5 w-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground truncate">Acrésc. / Desc. Líquido</p>
                <p className={`text-sm font-bold ${totalNetAdjustments < 0 ? "text-destructive" : "text-foreground"}`}>
                  {formatBRL(totalNetAdjustments)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
