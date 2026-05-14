/**
 * Modal crítico do erro tardio: invoice gravada no Alvo mas Hub falhou ao registrar.
 *
 * Acionado quando o gateway retorna `chave_docfin_alvo_orfa` no response do emit.
 * Esse estado é raro mas crítico: o DocFin existe no Alvo (gerou número),
 * mas o master no Hub não foi criado. Sandra precisa avisar TI manualmente
 * pra reconciliação.
 *
 * UX: AlertDialog vermelho bloqueante, com botão "Copiar dados pro TI"
 * que copia um JSON com chave + numero + timestamp pra Sandra colar no email.
 */

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Check, Copy } from "lucide-react";

interface ModalOrfaoProps {
  open: boolean;
  chaveOrfa: number | null;
  numeroInvoice: string;
  onClose: () => void;
}

export function ModalOrfao({ open, chaveOrfa, numeroInvoice, onClose }: ModalOrfaoProps) {
  const [copied, setCopied] = useState(false);

  if (!chaveOrfa) return null;

  const dadosOrfao = {
    tipo: "INVOICE_ORFA_REEMBOLSO_NF",
    chave_docfin_alvo: chaveOrfa,
    numero_invoice: numeroInvoice,
    timestamp: new Date().toISOString(),
    sistema: "Financial Hub - Frente Reembolso NF",
    acao_necessaria: "O DocFin existe no Alvo mas o master não foi criado no Hub. Reconciliar manualmente.",
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(dadosOrfao, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Silencioso — fallback de seleção manual via textarea
    }
  };

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-lg border-destructive/40">
        <AlertDialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <AlertDialogTitle className="text-destructive">
              Atenção: invoice criada no Alvo, mas falhou no Hub
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-3 pt-2">
            <p>
              A invoice <span className="font-mono font-semibold">{numeroInvoice}</span> foi criada no Alvo (chave{" "}
              <span className="font-mono font-semibold">{chaveOrfa}</span>), mas houve falha ao registrar no Hub.
            </p>
            <p className="text-destructive font-medium">Acione TI imediatamente para reconciliação manual.</p>
            <p>Copie os dados abaixo e envie pra equipe técnica:</p>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-md bg-muted/50 border border-border p-3 max-h-48 overflow-y-auto">
          <pre className="text-[10px] font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(dadosOrfao, null, 2)}
          </pre>
        </div>

        <AlertDialogFooter>
          <Button variant="outline" onClick={handleCopy} className="gap-2">
            {copied ? (
              <>
                <Check className="h-4 w-4 text-emerald-600" />
                Copiado!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copiar dados pro TI
              </>
            )}
          </Button>
          <AlertDialogAction
            onClick={onClose}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Entendi, vou avisar a TI
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
