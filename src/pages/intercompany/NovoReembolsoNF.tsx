/**
 * Página orquestradora da Frente 3 — Intercompany / Reembolso NF.
 *
 * Responsabilidades:
 *   1. Inicializa o rascunho da Sandra na montagem (init_or_resume_rascunho).
 *   2. Mantém state global da seleção de checkboxes (selectedIds: Set<string>).
 *   3. Layout split 50/50: Lado 1 (NFs disponíveis) e Lado 2 (cesta).
 *   4. Loading global enquanto rascunho inicializa.
 *   5. Tratamento de erro de init com retry.
 *
 * Componentes filhos:
 *   - Lado1Disponiveis      → implementado em 3.5.a.2
 *   - Lado2Cesta            → 3.5.b (placeholder por enquanto)
 *
 * O state selectedIds:
 *   - É efêmero: zera ao sair da página (não persiste).
 *   - Granularidade canônica: cada ID é um rateio_id da view v_movestq_disponivel.
 *   - A "verdade" do que está na cesta vive no banco (rascunho).
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, Construction, Loader2, RefreshCw } from "lucide-react";
import { useInitOrResumeRascunho } from "@/hooks/useReembolsoNf";
import { friendlyErrorMessage } from "@/services/intercompanyReembolsoNfService";
import { Lado1Disponiveis } from "@/components/intercompany/reembolso-nf/Lado1Disponiveis";

export default function NovoReembolsoNF() {
  const navigate = useNavigate();
  const initMutation = useInitOrResumeRascunho();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    initMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (initMutation.isPending || initMutation.isIdle) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Preparando sua cesta de reembolso...</p>
        </div>
      </div>
    );
  }

  if (initMutation.isError) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-destructive">Não foi possível abrir a cesta</p>
              <p className="text-xs text-muted-foreground mt-1 break-words">
                {friendlyErrorMessage(initMutation.error)}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => initMutation.mutate()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate("/intercompany/master")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Voltar
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-foreground">Novo Reembolso NF</h1>
          <p className="text-xs text-muted-foreground">
            Selecione NFs do MovEstq Alvo e converta em INV de reembolso intercompany para PEF Áustria.
          </p>
        </div>
      </div>

      {/* Split 50/50 */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 overflow-hidden min-h-0">
        <Lado1Disponiveis selectedIds={selectedIds} setSelectedIds={setSelectedIds} />

        {/* Lado 2 — placeholder até 3.5.b */}
        <Card className="h-full">
          <CardContent className="p-6 flex flex-col items-center justify-center text-center min-h-[300px]">
            <Construction className="h-10 w-10 text-muted-foreground mb-3" />
            <h2 className="text-base font-semibold mb-1">Lado 2 — Cesta de rascunho</h2>
            <p className="text-xs text-muted-foreground max-w-sm">
              Itens adicionados, classificação Konto AT, totais BRL e botão Emitir. Disponível em 3.5.b.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
