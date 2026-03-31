import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRightLeft } from "lucide-react";

interface DivergenceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  syncBatchId: string | null;
}

interface DivergentDoc {
  id: string;
  alvo_document_id: string;
  doc_type: string;
  nf_number: string | null;
  entity_name: string | null;
  raw_json: Record<string, any> | null;
  raw_json_new: Record<string, any> | null;
}

const COMPARE_FIELDS: { key: string; label: string }[] = [
  { key: "ValorTotal", label: "Valor Total" },
  { key: "ValorOriginal", label: "Valor Original" },
  { key: "CambioOriginal", label: "Câmbio Original" },
  { key: "Cancelada", label: "Cancelada" },
  { key: "DadosAdicionais", label: "Dados Adicionais" },
  { key: "DataEmissao", label: "Data Emissão" },
  { key: "CodigoEntidade", label: "Código Entidade" },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  "nf-e": "NF-e",
  "nfs-e": "NFS-e",
  inv: "INV",
};

function getDiffs(oldJson: Record<string, any> | null, newJson: Record<string, any> | null) {
  if (!oldJson || !newJson) return [];
  return COMPARE_FIELDS.filter((f) => {
    const oldVal = JSON.stringify(oldJson[f.key] ?? null);
    const newVal = JSON.stringify(newJson[f.key] ?? null);
    return oldVal !== newVal;
  }).map((f) => ({
    field: f.label,
    oldValue: formatValue(oldJson[f.key]),
    newValue: formatValue(newJson[f.key]),
  }));
}

function formatValue(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return String(v).slice(0, 120);
}

export default function DivergenceModal({ open, onOpenChange, syncBatchId }: DivergenceModalProps) {
  const [docs, setDocs] = useState<DivergentDoc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !syncBatchId) return;
    setLoading(true);

    (async () => {
      // Get divergent doc_numbers from sync_queue for this batch
      const { data: queueItems } = await supabase
        .from("sync_queue")
        .select("doc_number, doc_type")
        .eq("sync_batch_id", syncBatchId)
        .eq("status", "divergent");

      if (!queueItems || queueItems.length === 0) {
        setDocs([]);
        setLoading(false);
        return;
      }

      // Build alvo_document_ids from queue items
      const docIds = queueItems.map((q) => {
        if (q.doc_type === "inv") return `INV|${q.doc_number}`;
        const model = q.doc_type === "nf-e" ? "NF-e" : "NFS-e";
        const serie = q.doc_type === "nf-e" ? "1" : "001";
        return `${model}|${serie}|${q.doc_number.replace(/\D/g, "").padStart(10, "0")}`;
      });

      const { data: alvoDocs } = await supabase
        .from("intercompany_alvo_docs")
        .select("id, alvo_document_id, doc_type, nf_number, entity_name, raw_json, raw_json_new")
        .in("alvo_document_id", docIds)
        .eq("sync_status", "divergent");

      setDocs((alvoDocs as unknown as DivergentDoc[]) ?? []);
      setLoading(false);
    })();
  }, [open, syncBatchId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-orange-500" />
            Documentos com Alterações Detectadas
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Os seguintes documentos foram alterados no Alvo desde a última sincronização
          </p>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : docs.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">Nenhuma divergência encontrada.</p>
        ) : (
          <div className="space-y-4">
            {docs.map((doc) => {
              const diffs = getDiffs(doc.raw_json as Record<string, any>, doc.raw_json_new as Record<string, any>);
              return (
                <div key={doc.id} className="rounded-lg border-2 border-orange-400/50 bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">
                        {DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type}
                      </span>
                      <span className="font-mono text-sm">{doc.nf_number ?? doc.alvo_document_id}</span>
                      {doc.entity_name && (
                        <span className="text-sm text-muted-foreground">— {doc.entity_name}</span>
                      )}
                    </div>
                    <Badge className="bg-orange-500/15 text-orange-600 border-orange-400/30 hover:bg-orange-500/20">
                      Alterado no Alvo
                    </Badge>
                  </div>

                  {diffs.length > 0 ? (
                    <div className="overflow-hidden rounded border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Campo</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Valor Anterior</th>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Valor Novo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {diffs.map((d, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2 font-medium">{d.field}</td>
                              <td className="px-3 py-2">
                                <span className="inline-block rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">
                                  {d.oldValue}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className="inline-block rounded bg-success/10 px-1.5 py-0.5 text-success">
                                  {d.newValue}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Diferenças detectadas no JSON completo.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>OK, Entendido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
