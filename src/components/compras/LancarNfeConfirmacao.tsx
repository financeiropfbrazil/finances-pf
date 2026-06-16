// src/components/compras/LancarNfeConfirmacao.tsx
//
// Etapa B / Fatia 6 — Revisão do payload + disparo do lançamento.
//
// Recebe o MovEstq montado (montarPayloadDoModal), mostra um RESUMO em
// português para o controller conferir, permite ver o JSON cru, e só dispara
// para a rota /mov-estq/save quando o usuário confirma explicitamente.
//
// IMPORTANTE: este é o ponto de FIRE — cria o lançamento de verdade no Alvo.
// Por isso a confirmação é explícita (revisar → confirmar → lançar).

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertTriangle, CheckCircle2, Code } from "lucide-react";

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";

interface LancarNfeConfirmacaoProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: any | null; // MovEstq montado
  onSucesso: (chave: string | number) => void; // callback p/ gravar status no Hub
}

const fmtMoeda = (v: number) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function getJwt(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export function LancarNfeConfirmacao({ open, onOpenChange, payload, onSucesso }: LancarNfeConfirmacaoProps) {
  const [enviando, setEnviando] = useState(false);
  const [verJson, setVerJson] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | number | null>(null);

  if (!payload) return null;

  const itens = payload.ItemMovEstqChildList || [];
  const parcelas = payload.ParcPagMovEstqChildList || [];
  const somaItens = itens.reduce((s: number, it: any) => s + (Number(it.ValorProduto) || 0), 0);
  const somaParcelas = parcelas.reduce((s: number, p: any) => s + (Number(p.ValorParcela) || 0), 0);
  const difItensParcelas = Number((somaParcelas - somaItens).toFixed(2));
  const fecha = Math.abs(difItensParcelas) < 0.01;

  const disparar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      const jwt = await getJwt();
      const fd = new FormData();
      fd.append("obj", JSON.stringify(payload));
      const r = await fetch(`${ERP_PROXY_URL}/mov-estq/save`, {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) {
        setErro(data?.error || `Erro ${r.status} ao lançar.`);
      } else {
        const chave = data?.Chave || data?.chave || "?";
        setSucesso(chave);
        onSucesso(chave);
      }
    } catch (e: any) {
      setErro(e?.message || "Falha de conexão ao lançar.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!enviando) onOpenChange(v);
      }}
    >
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{sucesso ? "Lançamento concluído" : "Revisar e lançar no Alvo"}</AlertDialogTitle>
        </AlertDialogHeader>

        {/* SUCESSO */}
        {sucesso ? (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
            <div>
              <p className="font-medium">MovEstq criado no Alvo.</p>
              <p className="text-muted-foreground">
                Chave gerada: <span className="font-mono">{String(sucesso)}</span>
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* RESUMO p/ conferência */}
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                <div>
                  <span className="text-muted-foreground">Tipo: </span>
                  <span className="font-mono">{payload.CodigoTipoLanc}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">NF: </span>
                  {payload.Numero}-{payload.Serie}
                </div>
                <div>
                  <span className="text-muted-foreground">Entidade: </span>
                  <span className="font-mono">{payload.CodigoEntidade}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Pedido: </span>
                  <span className="font-mono">{payload.NumeroPedComp || "—"}</span>
                </div>
              </div>

              <div className="rounded-md border divide-y">
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-muted-foreground">Itens ({itens.length})</span>
                  <span className="font-semibold">{fmtMoeda(somaItens)}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-muted-foreground">Documento (Alvo)</span>
                  <span className="font-semibold">{fmtMoeda(Number(payload.ValorDocumento) || 0)}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span className="text-muted-foreground">Parcelas ({parcelas.length})</span>
                  <span className="font-semibold">{fmtMoeda(somaParcelas)}</span>
                </div>
              </div>

              {!fecha && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Parcelas não fecham com os itens (dif. {fmtMoeda(difItensParcelas)}). Revise antes de lançar.
                </div>
              )}

              <button
                type="button"
                onClick={() => setVerJson((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Code className="h-3 w-3" /> {verJson ? "Ocultar" : "Ver"} JSON do payload
              </button>
              {verJson && (
                <pre className="max-h-60 overflow-auto rounded-md bg-muted p-3 text-[10px] font-mono">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              )}

              {erro && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">O Alvo recusou o lançamento:</p>
                    <p>{erro}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Esta ação cria o lançamento de verdade no Alvo (estoque + financeiro). Não é reversível por aqui.
              </div>
            </div>
          </>
        )}

        <AlertDialogFooter>
          {sucesso ? (
            <AlertDialogAction onClick={() => onOpenChange(false)}>Fechar</AlertDialogAction>
          ) : (
            <>
              <AlertDialogCancel disabled={enviando}>Cancelar</AlertDialogCancel>
              <Button onClick={disparar} disabled={enviando || !fecha}>
                {enviando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lançando...
                  </>
                ) : (
                  "Confirmar e lançar"
                )}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
