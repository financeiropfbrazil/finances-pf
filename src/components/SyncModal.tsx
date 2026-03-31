import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import {
  Loader2, RefreshCw, CheckCircle2, AlertTriangle,
  XCircle, Clock, ArrowRightLeft, FileText, Zap,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import DivergenceModal from "@/components/DivergenceModal";
import { processSyncBatch, type SyncQueueItem } from "@/services/alvoSyncProcessor";
import {
  sincronizarIntercompanyPorPeriodo,
  enriquecerNFsComDocFin,
  atualizarPagamentosDocFin,
} from "@/services/alvoDocFinService";
import { clearAlvoToken } from "@/services/alvoService";

interface SyncModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSyncComplete?: () => void;
}

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

type QueueItem = SyncQueueItem;
type ModalView = "input" | "progress";
type SyncMode = "auto" | "manual";

function cleanNumber(s: string): string {
  return s.replace(/\./g, "").replace(/\s/g, "").trim();
}

function padNumber(num: string, length: number): string {
  return cleanNumber(num).replace(/\D/g, "").padStart(length, "0");
}

function parseLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function parseAndCleanLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => cleanNumber(l))
    .filter((l) => l.length > 0);
}

function isValidInteger(s: string): boolean {
  return /^\d+$/.test(s);
}

function isValidCleanedInteger(s: string): boolean {
  const cleaned = cleanNumber(s);
  return cleaned.length > 0 && /^\d+$/.test(cleaned);
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; className: string; label: string }> = {
  pending: {
    icon: <Clock className="h-4 w-4 text-muted-foreground" />,
    className: "text-muted-foreground",
    label: "Pendente",
  },
  processing: {
    icon: <Loader2 className="h-4 w-4 text-primary animate-spin" />,
    className: "text-primary",
    label: "Processando",
  },
  success: {
    icon: <CheckCircle2 className="h-4 w-4 text-success" />,
    className: "text-success",
    label: "Sucesso",
  },
  duplicate: {
    icon: <AlertTriangle className="h-4 w-4 text-warning" />,
    className: "text-warning",
    label: "Duplicado",
  },
  divergent: {
    icon: <ArrowRightLeft className="h-4 w-4 text-orange-500" />,
    className: "text-orange-500",
    label: "Divergente",
  },
  error: {
    icon: <XCircle className="h-4 w-4 text-destructive" />,
    className: "text-destructive",
    label: "Erro",
  },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  "nf-e": "NF-e",
  "nfs-e": "NFS-e",
  inv: "INV",
};

interface AutoStep {
  label: string;
  status: "pending" | "running" | "done" | "error";
  detail: string;
}

export default function SyncModal({ open, onOpenChange, onSyncComplete }: SyncModalProps) {
  const { toast } = useToast();

  // Sync mode
  const [syncMode, setSyncMode] = useState<SyncMode>("auto");

  // Period state (internal)
  const now = new Date();
  const [selectedAno, setSelectedAno] = useState(now.getFullYear());
  const [selectedMes, setSelectedMes] = useState(now.getMonth() + 1);

  // Input state
  const [nfeText, setNfeText] = useState("");
  const [nfeDocfinText, setNfeDocfinText] = useState("");
  const [nfseText, setNfseText] = useState("");
  const [nfseDocfinText, setNfseDocfinText] = useState("");
  const [lastNfe, setLastNfe] = useState<string | null>(null);
  const [lastNfse, setLastNfse] = useState<string | null>(null);

  // Progress state (manual)
  const [view, setView] = useState<ModalView>("input");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showDivergence, setShowDivergence] = useState(false);

  // Progress state (auto)
  const [autoSteps, setAutoSteps] = useState<AutoStep[]>([]);
  const [autoProgress, setAutoProgress] = useState(0);
  const [autoComplete, setAutoComplete] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);

  // Fetch last synced numbers
  const fetchLastSynced = useCallback(async () => {
    const fetchLast = async (docType: string, orderCol: string) => {
      const { data } = await supabase
        .from("intercompany_alvo_docs")
        .select(orderCol)
        .eq("doc_type", docType)
        .order(orderCol, { ascending: false })
        .limit(1);
      if (data && data.length > 0) return String(data[0][orderCol as keyof typeof data[0]] ?? "");
      return null;
    };

    const [nfe, nfse] = await Promise.all([
      fetchLast("nf-e", "nf_number"),
      fetchLast("nfs-e", "nf_number"),
    ]);
    setLastNfe(nfe);
    setLastNfse(nfse);
  }, []);

  useEffect(() => {
    if (open) {
      fetchLastSynced();
      setView("input");
      setSyncMode("auto");
      setNfeText("");
      setNfeDocfinText("");
      setNfseText("");
      setNfseDocfinText("");
      setBatchId(null);
      setQueueItems([]);
      setAutoSteps([]);
      setAutoProgress(0);
      setAutoComplete(false);
      setAutoRunning(false);
      const n = new Date();
      setSelectedAno(n.getFullYear());
      setSelectedMes(n.getMonth() + 1);
    }
  }, [open, fetchLastSynced]);

  // Parse and validate
  const nfeRawLines = parseLines(nfeText);
  const nfseRawLines = parseLines(nfseText);
  const nfeDocfinRawLines = parseLines(nfeDocfinText);
  const nfseDocfinRawLines = parseLines(nfseDocfinText);

  const nfeNums = nfeRawLines.map(cleanNumber);
  const nfseNums = nfseRawLines.map(cleanNumber);
  const nfeDocfinNums = nfeDocfinRawLines.map(cleanNumber);
  const nfseDocfinNums = nfseDocfinRawLines.map(cleanNumber);

  const totalDocs = nfeNums.length + nfseNums.length;

  const nfeValid = nfeNums.length === 0 || nfeNums.every(isValidInteger);
  const nfseValid = nfseNums.length === 0 || nfseNums.every(isValidInteger);
  const nfeDocfinValid = nfeDocfinNums.length === 0 || nfeDocfinNums.every(isValidInteger);
  const nfseDocfinValid = nfseDocfinNums.length === 0 || nfseDocfinNums.every(isValidInteger);

  // DocFin lines must be <= doc lines
  const nfeDocfinCountValid = nfeDocfinNums.length <= nfeNums.length;
  const nfseDocfinCountValid = nfseDocfinNums.length <= nfseNums.length;

  const allValid =
    nfeValid && nfseValid &&
    nfeDocfinValid && nfseDocfinValid &&
    nfeDocfinCountValid && nfseDocfinCountValid &&
    totalDocs > 0;

  // Submit manual sync
  const handleSync = async () => {
    if (!allValid) return;
    setSubmitting(true);

    try {
      const newBatchId = crypto.randomUUID();
      setBatchId(newBatchId);

      await supabase.from("sync_log").insert({
        sync_nome: `intercompany-batch-${newBatchId.slice(0, 8)}`,
        status: "running",
        details: { sync_batch_id: newBatchId, total_items: totalDocs },
      } as any);

      const items: Array<{
        sync_batch_id: string;
        doc_type: string;
        doc_number: string;
        api_params: Record<string, string | number | null>;
        status: string;
      }> = [];

      for (let i = 0; i < nfeNums.length; i++) {
        const docfinKey = nfeDocfinNums[i] || null;
        items.push({
          sync_batch_id: newBatchId,
          doc_type: "nf-e",
          doc_number: nfeNums[i],
          api_params: {
            modeloCtrlDf: "NF-e",
            serieCtrlDf: "1",
            numero: padNumber(nfeNums[i], 10),
            docfin_key: docfinKey ? parseInt(docfinKey) : null,
          },
          status: "pending",
        });
      }

      for (let i = 0; i < nfseNums.length; i++) {
        const docfinKey = nfseDocfinNums[i] || null;
        items.push({
          sync_batch_id: newBatchId,
          doc_type: "nfs-e",
          doc_number: nfseNums[i],
          api_params: {
            modeloCtrlDf: "NFS-e",
            serieCtrlDf: "001",
            numero: padNumber(nfseNums[i], 10),
            docfin_key: docfinKey ? parseInt(docfinKey) : null,
          },
          status: "pending",
        });
      }



      const { data: inserted } = await supabase
        .from("sync_queue")
        .insert(items)
        .select("id, doc_type, doc_number, api_params, status, result_summary, error_message");

      if (inserted) {
        const typedItems = inserted as SyncQueueItem[];
        setQueueItems(typedItems);
        setView("progress");

        const onProgress = (updatedItem: SyncQueueItem) => {
          setQueueItems((prev) =>
            prev.map((q) =>
              q.id === updatedItem.id
                ? { ...q, status: updatedItem.status, result_summary: updatedItem.result_summary, error_message: updatedItem.error_message }
                : q
            )
          );
        };

        processSyncBatch(newBatchId, typedItems, onProgress).catch((err) => {
          console.error("Sync processor error:", err);
          toast({
            title: "Erro ao sincronizar",
            description: err.message,
            variant: "destructive",
          });
        });
      }
    } catch (err: any) {
      toast({
        title: "Erro ao preparar sincronização",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAutoSync = async () => {
    const ano = selectedAno;
    const mes = selectedMes;
    const mesFormatted = String(mes).padStart(2, "0");

    try {
      const competenceDateStr = `${ano}-${mesFormatted}-01`;
      const { data: periodId, error: periodErr } = await supabase.rpc("find_or_create_period", {
        p_competence_date: competenceDateStr,
      });

      if (periodErr || !periodId) {
        throw new Error(`Não foi possível validar o período selecionado: ${periodErr?.message || "período não encontrado"}`);
      }

      const { count: existingCount, error: existingErr } = await supabase
        .from("intercompany")
        .select("id", { count: "exact", head: true })
        .eq("period_id", periodId)
        .eq("source", "alvo");

      if (existingErr) {
        throw new Error(`Não foi possível verificar dados existentes do período: ${existingErr.message}`);
      }

      if ((existingCount ?? 0) > 0) {
        const shouldOverwrite = window.confirm(
          `Já existem ${existingCount} registro(s) do Alvo para ${mesFormatted}/${ano}.\n\nSe continuar, vamos sobrescrever os dados deste mês. Deseja continuar?`
        );

        if (!shouldOverwrite) {
          return;
        }
      }

      clearAlvoToken();

      setAutoRunning(true);
      setView("progress");
      setAutoComplete(false);
      setAutoProgress(0);

      const steps: AutoStep[] = [
        { label: `Importar INVs do DocFin (${mesFormatted}/${ano})`, status: "pending", detail: "Aguardando..." },
        { label: "Parear NF-e e NFS-e existentes com DocFin", status: "pending", detail: "Aguardando..." },
        { label: "Atualizar status de pagamentos", status: "pending", detail: "Aguardando..." },
      ];
      setAutoSteps([...steps]);

      let hasAnyError = false;

      // Step 1: Import INVs (0-40%)
      try {
        steps[0].status = "running";
        steps[0].detail = "Buscando títulos do ERP...";
        setAutoSteps([...steps]);

        const invResult = await sincronizarIntercompanyPorPeriodo(ano, mes, (current, total, message) => {
          steps[0].detail = `INVs: ${current}/${total} — ${message}`;
          setAutoSteps([...steps]);
          if (total > 0) {
            setAutoProgress(Math.round((current / total) * 40));
          }
        });

        steps[0].status = "done";
        steps[0].detail = `✓ ${invResult.inserted} inseridos, ${invResult.updated} atualizados, ${invResult.errors} erros`;
      } catch (err: any) {
        console.error("Auto sync step 1 error:", err);
        steps[0].status = "error";
        const is409 = err.message?.includes("409") || err.message?.includes("sessão");
        steps[0].detail = is409
          ? "Erro: Conflito de sessão ERP (409) persistente. Feche outras sessões e tente novamente."
          : `Erro: ${err.message}`;
        hasAnyError = true;
      }
      setAutoSteps([...steps]);
      setAutoProgress(40);

      // Step 2: Enrich NFs (40-60%)
      try {
        steps[1].status = "running";
        steps[1].detail = "Buscando chaves DocFin para NF-e/NFS-e...";
        setAutoSteps([...steps]);

        const nfResult = await enriquecerNFsComDocFin(ano, mes, (current, total, message) => {
          steps[1].detail = `NF-e match: ${current}/${total} — ${message}`;
          setAutoSteps([...steps]);
          if (total > 0) {
            setAutoProgress(40 + Math.round((current / total) * 20));
          }
        });

        steps[1].status = "done";
        steps[1].detail = `✓ ${nfResult.matched} pareadas, ${nfResult.skipped} não encontradas, ${nfResult.errors} erros`;
      } catch (err: any) {
        console.error("Auto sync step 2 error:", err);
        steps[1].status = "error";
        const is409 = err.message?.includes("409") || err.message?.includes("sessão");
        steps[1].detail = is409
          ? "Erro: Conflito de sessão ERP (409). Tente novamente."
          : `Erro: ${err.message}`;
        hasAnyError = true;
      }
      setAutoSteps([...steps]);
      setAutoProgress(60);

      // Step 3: Update payment statuses (60-100%)
      try {
        steps[2].status = "running";
        steps[2].detail = "Verificando títulos com DocFin...";
        setAutoSteps([...steps]);

        const payResult = await atualizarPagamentosDocFin(ano, mes, (current, total, message) => {
          steps[2].detail = `Pagamentos: ${current}/${total} — ${message}`;
          setAutoSteps([...steps]);
          if (total > 0) {
            setAutoProgress(60 + Math.round((current / total) * 40));
          }
        });

        if (payResult.updated === 0 && payResult.errors === 0 && payResult.unchanged === 0) {
          steps[2].status = "done";
          steps[2].detail = "Nenhum título com DocFin em aberto para atualizar";
        } else {
          steps[2].status = "done";
          steps[2].detail = `✓ ${payResult.updated} atualizados, ${payResult.unchanged} sem alteração, ${payResult.errors} erros`;
        }
      } catch (err: any) {
        console.error("Auto sync step 3 error:", err);
        steps[2].status = "error";
        const is409 = err.message?.includes("409") || err.message?.includes("sessão");
        steps[2].detail = is409
          ? "Erro: Conflito de sessão ERP (409). Tente novamente."
          : `Erro: ${err.message}`;
        hasAnyError = true;
      }
      setAutoSteps([...steps]);
      setAutoProgress(100);
      setAutoComplete(true);

      if (hasAnyError) {
        toast({
          title: "Sincronização concluída com erros",
          description: "Alguns passos falharam. Verifique os detalhes acima.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Erro ao iniciar sincronização automática",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setAutoRunning(false);
    }
  };

  // Manual progress calculations
  const processedItems = queueItems.filter((i) => !["pending", "processing"].includes(i.status));
  const processedCount = processedItems.length;
  const progressPercent = totalDocs > 0 ? Math.round((processedCount / queueItems.length) * 100) : 0;
  const isComplete = syncMode === "auto"
    ? autoComplete
    : (queueItems.length > 0 && processedCount === queueItems.length);

  const counters = {
    success: queueItems.filter((i) => i.status === "success").length,
    error: queueItems.filter((i) => i.status === "error").length,
    duplicate: queueItems.filter((i) => i.status === "duplicate").length,
    divergent: queueItems.filter((i) => i.status === "divergent").length,
  };

  useEffect(() => {
    if (syncMode === "manual" && isComplete && counters.divergent > 0 && !showDivergence) {
      setShowDivergence(true);
    }
  }, [isComplete, counters.divergent, syncMode]);

  const handleClose = () => {
    if (isComplete) onSyncComplete?.();
    onOpenChange(false);
  };

  const renderAutoInputView = () => {
    const ano = selectedAno;
    const mes = selectedMes;
    const mesFormatted = String(mes).padStart(2, "0");
    const currentYear = new Date().getFullYear();

    return (
      <div className="space-y-4">
        {/* Period selector */}
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Período:</Label>
          <select
            value={mes}
            onChange={(e) => setSelectedMes(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={i + 1} value={i + 1}>{name}</option>
            ))}
          </select>
          <select
            value={ano}
            onChange={(e) => setSelectedAno(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {Array.from({ length: 3 }, (_, i) => currentYear - 2 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="rounded-lg border bg-card p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2.5">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Sincronização Automática</h3>
              <p className="text-xs text-muted-foreground">
                Busca todos os títulos Intercompany da Áustria no período {mesFormatted}/{ano} diretamente do ERP, sem necessidade de colar números.
              </p>
            </div>
          </div>

          <div className="space-y-2 pl-12">
            <div className="flex items-center gap-2 text-sm">
              <span className="flex items-center justify-center h-5 w-5 rounded-full bg-muted text-xs font-bold">1</span>
              Importar INVs do DocFin (período {mesFormatted}/{ano})
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="flex items-center justify-center h-5 w-5 rounded-full bg-muted text-xs font-bold">2</span>
              Parear NF-e e NFS-e existentes com DocFin
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="flex items-center justify-center h-5 w-5 rounded-full bg-muted text-xs font-bold">3</span>
              Atualizar status de pagamentos
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleAutoSync} disabled={autoRunning} className="gap-2">
            <Zap className="h-4 w-4" />
            Sincronizar
          </Button>
        </DialogFooter>
      </div>
    );
  };

  const renderAutoProgressView = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Progress value={autoProgress} className="h-3" />
        <p className="text-xs text-right text-muted-foreground">{autoProgress}%</p>
      </div>

      <div className="space-y-3">
        {autoSteps.map((step, idx) => (
          <div key={idx} className="rounded-lg border p-3 space-y-1">
            <div className="flex items-center gap-2">
              {step.status === "pending" && <Clock className="h-4 w-4 text-muted-foreground" />}
              {step.status === "running" && <Loader2 className="h-4 w-4 text-primary animate-spin" />}
              {step.status === "done" && <CheckCircle2 className="h-4 w-4 text-success" />}
              {step.status === "error" && <XCircle className="h-4 w-4 text-destructive" />}
              <span className="text-sm font-medium">{step.label}</span>
            </div>
            <p className="text-xs text-muted-foreground pl-6 break-all">{step.detail}</p>
          </div>
        ))}
      </div>

      {autoComplete && (
        <DialogFooter>
          <Button variant="outline" onClick={handleAutoSync} disabled={autoRunning}>
            Tentar novamente
          </Button>
          <Button onClick={handleClose}>Fechar</Button>
        </DialogFooter>
      )}
    </div>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        {view === "input" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Sincronizar com Alvo ERP
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                Cole os números das NF-e e NFS-e. Para INVs, use a aba Automático.
              </p>
              <div className="flex gap-1 pt-2">
                <Button
                  variant={syncMode === "auto" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSyncMode("auto")}
                  className="gap-1.5"
                >
                  <Zap className="h-3.5 w-3.5" />
                  Automático
                </Button>
                <Button
                  variant={syncMode === "manual" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSyncMode("manual")}
                  className="gap-1.5"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Manual
                </Button>
              </div>
            </DialogHeader>

            {syncMode === "auto" ? (
              renderAutoInputView()
            ) : (
              <>
                <div className="space-y-6">
                  {/* NF-e */}
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">NF-e — Série 1</Label>
                    <p className="text-xs text-muted-foreground">
                      Último sincronizado: <span className="font-mono">{lastNfe ?? "—"}</span>
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Nº Documento (obrigatório)</Label>
                        <Textarea
                          value={nfeText}
                          onChange={(e) => setNfeText(e.target.value)}
                          placeholder={"4238\n4259\n4267"}
                          className="h-[130px] font-mono text-sm"
                        />
                        {nfeNums.length > 0 && !nfeValid && (
                          <p className="text-xs text-destructive">Apenas números inteiros</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Chave DocFin (opcional)</Label>
                        <Textarea
                          value={nfeDocfinText}
                          onChange={(e) => setNfeDocfinText(e.target.value)}
                          placeholder={"21.629\n21.952\n22.100"}
                          className="h-[130px] font-mono text-sm"
                        />
                        {nfeDocfinNums.length > 0 && !nfeDocfinValid && (
                          <p className="text-xs text-destructive">Apenas números inteiros (pontos serão removidos)</p>
                        )}
                        {!nfeDocfinCountValid && (
                          <p className="text-xs text-destructive">Mais chaves DocFin que documentos</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* NFS-e */}
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">NFS-e — Série 001</Label>
                    <p className="text-xs text-muted-foreground">
                      Último sincronizado: <span className="font-mono">{lastNfse ?? "—"}</span>
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Nº Documento (obrigatório)</Label>
                        <Textarea
                          value={nfseText}
                          onChange={(e) => setNfseText(e.target.value)}
                          placeholder={"379\n380\n381"}
                          className="h-[130px] font-mono text-sm"
                        />
                        {nfseNums.length > 0 && !nfseValid && (
                          <p className="text-xs text-destructive">Apenas números inteiros</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Chave DocFin (opcional)</Label>
                        <Textarea
                          value={nfseDocfinText}
                          onChange={(e) => setNfseDocfinText(e.target.value)}
                          placeholder={"22.686\n22.692\n22.700"}
                          className="h-[130px] font-mono text-sm"
                        />
                        {nfseDocfinNums.length > 0 && !nfseDocfinValid && (
                          <p className="text-xs text-destructive">Apenas números inteiros (pontos serão removidos)</p>
                        )}
                        {!nfseDocfinCountValid && (
                          <p className="text-xs text-destructive">Mais chaves DocFin que documentos</p>
                        )}
                      </div>
                    </div>
                  </div>



                </div>

                {totalDocs > 0 && (
                  <p className="text-sm text-muted-foreground mt-2">
                    <FileText className="mr-1 inline h-4 w-4" />
                    <strong>{totalDocs}</strong> documento{totalDocs !== 1 ? "s" : ""} para sincronizar
                  </p>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSync} disabled={!allValid || submitting} className="gap-2">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Sincronizar
                  </Button>
                </DialogFooter>
              </>
            )}
          </>
        ) : syncMode === "auto" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {autoComplete ? (
                  autoSteps.some((s) => s.status === "error") ? (
                    <XCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  )
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                )}
                {autoComplete
                  ? autoSteps.some((s) => s.status === "error")
                    ? "Sincronização com erros"
                    : "Sincronização concluída"
                  : "Sincronizando..."}
              </DialogTitle>
            </DialogHeader>
            {renderAutoProgressView()}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {isComplete ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                )}
                {isComplete
                  ? "Sincronização concluída"
                  : `Sincronizando... ${processedCount} de ${queueItems.length}`}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-2">
              <Progress value={progressPercent} className="h-3" />
              <p className="text-xs text-right text-muted-foreground">{progressPercent}%</p>
            </div>

            {isComplete && (
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border bg-success/10 p-3 text-center">
                  <p className="text-2xl font-bold text-success">{counters.success}</p>
                  <p className="text-xs text-muted-foreground">Sucesso</p>
                </div>
                <div className="rounded-lg border bg-destructive/10 p-3 text-center">
                  <p className="text-2xl font-bold text-destructive">{counters.error}</p>
                  <p className="text-xs text-muted-foreground">Erros</p>
                </div>
                <div className="rounded-lg border bg-warning/10 p-3 text-center">
                  <p className="text-2xl font-bold text-warning">{counters.duplicate}</p>
                  <p className="text-xs text-muted-foreground">Duplicados</p>
                </div>
                <div className="rounded-lg border bg-orange-500/10 p-3 text-center">
                  <p className="text-2xl font-bold text-orange-500">{counters.divergent}</p>
                  <p className="text-xs text-muted-foreground">Divergentes</p>
                </div>
              </div>
            )}

            <div className="max-h-[350px] overflow-y-auto rounded-lg border">
              <div className="divide-y">
                {queueItems.map((item) => {
                  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-4 py-2.5 transition-colors"
                    >
                      {cfg.icon}
                      <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-xs font-mono font-semibold">
                        {DOC_TYPE_LABELS[item.doc_type] || item.doc_type}
                      </span>
                      <span className="font-mono text-sm">{item.doc_number}</span>
                      <span className={`ml-auto text-xs ${cfg.className} max-w-[300px] truncate`}>
                        {item.status === "success" && item.result_summary}
                        {item.status === "duplicate" && "Já sincronizado"}
                        {item.status === "divergent" && "Dados alterados no Alvo"}
                        {item.status === "error" && (item.error_message || "Erro")}
                        {item.status === "processing" && "Processando..."}
                        {item.status === "pending" && "Aguardando"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter>
              <Button onClick={handleClose} disabled={!isComplete} variant={isComplete ? "default" : "outline"}>
                Fechar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>

    <DivergenceModal
      open={showDivergence}
      onOpenChange={setShowDivergence}
      syncBatchId={batchId}
    />
    </>
  );
}
