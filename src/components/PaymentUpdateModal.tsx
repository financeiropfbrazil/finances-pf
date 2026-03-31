import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Loader2, CheckCircle2, XCircle, Clock, MinusCircle, Banknote,
} from "lucide-react";
import {
  updatePaymentStatuses,
  type PaymentUpdateItem,
  type PaymentUpdateProgress,
  type PaymentUpdateResult,
} from "@/services/paymentStatusUpdater";

interface PaymentUpdateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PaymentUpdateItem[];
  onComplete?: () => void;
}

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface ProgressEntry {
  item: PaymentUpdateItem;
  status: "processing" | "updated" | "unchanged" | "error";
  message?: string;
}

export default function PaymentUpdateModal({
  open, onOpenChange, items, onComplete,
}: PaymentUpdateModalProps) {
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [result, setResult] = useState<PaymentUpdateResult | null>(null);
  const [totalFxVariation, setTotalFxVariation] = useState(0);

  const processedCount = entries.filter((e) => e.status !== "processing").length;
  const progressPercent = items.length > 0 ? Math.round((processedCount / items.length) * 100) : 0;
  const isComplete = result !== null;

  const startUpdate = async () => {
    setRunning(true);
    setResult(null);
    setEntries(items.map((item) => ({ item, status: "processing" as const })));
    setTotalFxVariation(0);

    const onProgress = (progress: PaymentUpdateProgress) => {
      setEntries((prev) =>
        prev.map((e) =>
          e.item.id === progress.item.id
            ? { ...e, status: progress.status, message: progress.message }
            : e
        )
      );
    };

    const res = await updatePaymentStatuses(items, onProgress);
    setResult(res);
    setRunning(false);

    // Calculate total FX variation from updated items
    // We'll fetch updated rows to get the fx_variation totals
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const ids = items.map((i) => i.id);
      const { data } = await supabase
        .from("intercompany")
        .select("fx_variation")
        .in("id", ids);
      if (data) {
        const total = data.reduce((sum, r) => sum + (r.fx_variation || 0), 0);
        setTotalFxVariation(total);
      }
    } catch { /* ignore */ }
  };

  // Auto-start on open
  const handleOpenChange = (v: boolean) => {
    if (v && !running && !isComplete) {
      startUpdate();
    }
    if (!v) {
      if (isComplete) onComplete?.();
      onOpenChange(false);
      // Reset for next use
      setTimeout(() => {
        setEntries([]);
        setResult(null);
        setTotalFxVariation(0);
      }, 300);
    }
  };

  // Trigger start when modal opens
  if (open && !running && !isComplete && entries.length === 0) {
    setTimeout(() => startUpdate(), 100);
  }

  const STATUS_ICON: Record<string, React.ReactNode> = {
    processing: <Loader2 className="h-4 w-4 text-primary animate-spin" />,
    updated: <CheckCircle2 className="h-4 w-4 text-success" />,
    unchanged: <MinusCircle className="h-4 w-4 text-muted-foreground" />,
    error: <XCircle className="h-4 w-4 text-destructive" />,
  };

  const STATUS_CLASS: Record<string, string> = {
    processing: "text-primary",
    updated: "text-success",
    unchanged: "text-muted-foreground",
    error: "text-destructive",
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isComplete ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            )}
            {isComplete
              ? "Atualização de Pagamentos Concluída"
              : `Atualizando Pagamentos... ${processedCount} de ${items.length}`}
          </DialogTitle>
        </DialogHeader>

        {/* Progress bar */}
        <div className="space-y-2">
          <Progress value={progressPercent} className="h-3" />
          <p className="text-xs text-right text-muted-foreground">{progressPercent}%</p>
        </div>

        {/* Summary counters */}
        {isComplete && result && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-success/10 p-3 text-center">
                <p className="text-2xl font-bold text-success">{result.updated}</p>
                <p className="text-xs text-muted-foreground">Atualizados</p>
              </div>
              <div className="rounded-lg border bg-muted p-3 text-center">
                <p className="text-2xl font-bold text-muted-foreground">{result.unchanged}</p>
                <p className="text-xs text-muted-foreground">Sem alteração</p>
              </div>
              <div className="rounded-lg border bg-destructive/10 p-3 text-center">
                <p className="text-2xl font-bold text-destructive">{result.errors}</p>
                <p className="text-xs text-muted-foreground">Erros</p>
              </div>
            </div>

            {/* FX Variation total */}
            {totalFxVariation !== 0 && (
              <div className={`rounded-lg border p-3 text-center ${totalFxVariation > 0 ? "bg-success/10" : "bg-destructive/10"}`}>
                <p className={`text-lg font-bold ${totalFxVariation > 0 ? "text-success" : "text-destructive"}`}>
                  {formatBRL(totalFxVariation)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {totalFxVariation > 0 ? "Ganho Cambial" : "Perda Cambial"} (total do lote)
                </p>
              </div>
            )}
          </div>
        )}

        {/* Item list */}
        <div className="max-h-[350px] overflow-y-auto rounded-lg border">
          <div className="divide-y">
            {entries.map((entry) => (
              <div
                key={entry.item.id}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors"
              >
                {STATUS_ICON[entry.status]}
                <span className="font-mono text-sm">
                  DocFin {entry.item.docfin_key}
                </span>
                <span className={`ml-auto text-xs ${STATUS_CLASS[entry.status]} max-w-[400px] truncate`}>
                  {entry.message || (entry.status === "processing" ? "Consultando ERP..." : "")}
                </span>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => handleOpenChange(false)}
            disabled={running}
            variant={isComplete ? "default" : "outline"}
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
