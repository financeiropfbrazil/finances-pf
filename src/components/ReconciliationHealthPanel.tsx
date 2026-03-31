import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertTriangle, FileText, ArrowLeftRight } from "lucide-react";

interface Props {
  ofxCount: number;
  erpCount: number;
  matchedCount: number;
  processedCount: number;
  pendingOfx: number;
  pendingErp: number;
}

export default function ReconciliationHealthPanel({
  ofxCount, erpCount, matchedCount, processedCount, pendingOfx, pendingErp,
}: Props) {
  const totalItems = Math.max(ofxCount, 1);
  const reconciledPct = Math.round(((matchedCount + processedCount) / totalItems) * 100);
  const isFullyReconciled = pendingOfx === 0 && pendingErp === 0 && ofxCount > 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground flex items-center gap-2">
              <ArrowLeftRight className="h-4 w-4 text-primary" />
              Progresso da Conciliação
            </span>
            <span className={`text-sm font-bold ${isFullyReconciled ? "text-success" : "text-foreground"}`}>
              {reconciledPct}%
            </span>
          </div>
          <Progress value={reconciledPct} className="h-2.5" />
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-card p-3 text-center">
            <FileText className="mx-auto mb-1 h-4 w-4 text-muted-foreground" />
            <p className="text-xl font-bold text-foreground">{ofxCount}</p>
            <p className="text-[11px] text-muted-foreground">OFX (Banco)</p>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <FileText className="mx-auto mb-1 h-4 w-4 text-muted-foreground" />
            <p className="text-xl font-bold text-foreground">{erpCount}</p>
            <p className="text-[11px] text-muted-foreground">ERP (Faturas)</p>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <CheckCircle2 className="mx-auto mb-1 h-4 w-4 text-success" />
            <p className="text-xl font-bold text-success">{matchedCount + processedCount}</p>
            <p className="text-[11px] text-muted-foreground">Conciliados</p>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <AlertTriangle className={`mx-auto mb-1 h-4 w-4 ${pendingOfx + pendingErp > 0 ? "text-warning" : "text-success"}`} />
            <p className={`text-xl font-bold ${pendingOfx + pendingErp > 0 ? "text-warning" : "text-success"}`}>
              {pendingOfx + pendingErp}
            </p>
            <p className="text-[11px] text-muted-foreground">Pendentes</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
