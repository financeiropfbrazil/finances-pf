import React, { useState, useCallback } from "react";
import { invokeImportEmailNfe } from "@/services/importEmailNfeService";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface ImportItem {
  id: string;
  emitente_nome: string | null;
}

interface ImportResult {
  id: string;
  emitente_nome: string | null;
  success: boolean;
  message: string;
  destino?: string;
}

interface Props {
  open: boolean;
  items: ImportItem[];
  onClose: (imported: boolean) => void;
}

export default function MassImportDialog({ open, items, onClose }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [current, setCurrent] = useState(0);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [finished, setFinished] = useState(false);

  const startImport = useCallback(async () => {
    setIsRunning(true);
    setResults([]);
    setCurrent(0);
    setFinished(false);

    let hasImported = false;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setCurrent(i + 1);

      try {
        const { data, error } = await supabase.functions.invoke("import-email-nfe-to-compras", {
          body: { action: "import", ids: [item.id] },
        });

        if (error) {
          setResults((prev) => [...prev, { id: item.id, emitente_nome: item.emitente_nome, success: false, message: error.message || "Erro na requisição" }]);
        } else if (data?.results?.[0]) {
          const r = data.results[0];
          const success = r.success ?? !r.error;
          if (success) hasImported = true;
          setResults((prev) => [...prev, {
            id: item.id,
            emitente_nome: item.emitente_nome,
            success,
            message: r.message || r.error || (success ? "Importada" : "Erro"),
            destino: r.destino,
          }]);
        } else {
          setResults((prev) => [...prev, { id: item.id, emitente_nome: item.emitente_nome, success: false, message: "Resposta inesperada" }]);
        }
      } catch (err: any) {
        setResults((prev) => [...prev, { id: item.id, emitente_nome: item.emitente_nome, success: false, message: err?.message || "Erro" }]);
      }
    }

    setIsRunning(false);
    setFinished(true);
  }, [items]);

  // Auto-start on open
  React.useEffect(() => {
    if (open && items.length > 0 && !isRunning && !finished) {
      startImport();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const successCount = results.filter((r) => r.success).length;
  const errorCount = results.filter((r) => !r.success).length;
  const progress = items.length > 0 ? Math.round((current / items.length) * 100) : 0;

  const handleClose = () => {
    const hadImports = results.some((r) => r.success);
    setResults([]);
    setCurrent(0);
    setFinished(false);
    setIsRunning(false);
    onClose(hadImports);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && finished && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Importando notas para Compras</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Progress value={progress} className="h-2" />
          <p className="text-sm text-muted-foreground">
            {isRunning
              ? `Processando ${current} de ${items.length}...`
              : finished
                ? `Concluído — ${items.length} processada(s)`
                : "Preparando..."}
          </p>

          <div className="max-h-60 overflow-y-auto space-y-1 border rounded-md p-2">
            {results.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-sm">
                {r.success ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                )}
                <span className="truncate">{r.emitente_nome || r.id}</span>
                <span className="text-muted-foreground ml-auto shrink-0">→ {r.message}</span>
              </div>
            ))}
            {isRunning && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Processando...</span>
              </div>
            )}
          </div>

          {finished && (
            <p className="text-sm font-medium">
              ✅ {successCount} importada{successCount !== 1 ? "s" : ""}
              {errorCount > 0 && <> · ❌ {errorCount} erro{errorCount !== 1 ? "s" : ""}</>}
            </p>
          )}
        </div>

        <DialogFooter>
          {finished ? (
            <Button onClick={handleClose}>Fechar</Button>
          ) : (
            <Button disabled>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importando...
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
