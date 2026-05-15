/**
 * Página orquestradora do wizard de Bulk Edit Produtos — Campos.
 *
 * Responsabilidades:
 * - Controlar a etapa atual (1-5)
 * - Manter state compartilhado entre etapas (campos escolhidos, planilha
 *   parseada, resultado do pre-check, etc) — passado como props para cada
 *   componente de etapa
 * - Renderizar o componente da etapa atual
 * - Renderizar header + stepper sempre visíveis
 *
 * Cada etapa é um componente em src/components/ferramentas/bulk-edit/.
 * O orquestrador NÃO contém lógica de negócio nem chamadas ao Alvo/Supabase —
 * essas ficam dentro de cada componente de etapa ou no produtoBulkService.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldX, Wrench, AlertTriangle, History } from "lucide-react";
import { WizardStepper } from "@/components/ferramentas/bulk-edit/WizardStepper";
import { Etapa1ConfigurarColunas } from "@/components/ferramentas/bulk-edit/Etapa1ConfigurarColunas";

/**
 * Estado completo do wizard. Cada etapa recebe e atualiza partes diferentes.
 */
interface WizardState {
  // Etapa 1 -> Etapa 2
  camposEscolhidos: string[];
  // Etapa 2 -> Etapa 3 (planilha parseada)
  // linhasPlanilha: ProdutoBulkRow[];  // será populado na Etapa 2
  // Etapa 3 -> Etapa 4 (resultado do pre-check)
  // produtosEncontrados, produtosNaoEncontrados...
  // Etapa 4 -> Etapa 5 (job criado)
  // jobId: string;
}

const INITIAL_STATE: WizardState = {
  camposEscolhidos: [],
};

export default function BulkEditProdutosCampos() {
  const podeExecutar = useHasPermission(PERMISSIONS.FERRAMENTAS_BULK_EDIT_EXECUTE);

  // Etapa atual do wizard (1-5)
  const [etapa, setEtapa] = useState<number>(1);

  // State compartilhado entre etapas
  const [wizardState, setWizardState] = useState<WizardState>(INITIAL_STATE);

  // ─── Gate de permissão ─────────────────────────────────────────────
  if (!podeExecutar) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <ShieldX className="h-16 w-16" />
        <h2 className="text-xl font-semibold text-foreground">Acesso Restrito</h2>
        <p>Você não tem permissão para executar edições em massa.</p>
      </div>
    );
  }

  // ─── Handlers de transição entre etapas ───────────────────────────

  const avancarEtapa1 = (camposEscolhidos: string[]) => {
    setWizardState((prev) => ({ ...prev, camposEscolhidos }));
    setEtapa(2);
  };

  // (handlers das outras etapas virão nos próximos prompts)

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
            <Wrench className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Bulk Edit Produtos — Campos</h1>
            <p className="text-sm text-muted-foreground">
              Etapa {etapa} de 5 — edição em massa de cadastros de produtos no ERP Alvo.
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/ferramentas/bulk-edit/historico">
            <History className="h-4 w-4" />
            Histórico
          </Link>
        </Button>
      </div>

      {/* Stepper */}
      <Card>
        <CardContent className="p-6">
          <WizardStepper etapaAtual={etapa} />
        </CardContent>
      </Card>

      {/* Aviso de operação destrutiva (sempre visível) */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">Operação destrutiva</p>
            <p className="text-muted-foreground">
              Esta ferramenta altera dados em produção no ERP Alvo. Todo job fica registrado no histórico com snapshot
              completo antes de cada save — permitindo reverter caso necessário.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Renderiza a etapa atual */}
      {etapa === 1 && (
        <Etapa1ConfigurarColunas camposEscolhidos={wizardState.camposEscolhidos} onAvancar={avancarEtapa1} />
      )}

      {etapa === 2 && (
        <Card>
          <CardContent className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
            <Wrench className="h-12 w-12 text-muted-foreground" />
            <div className="space-y-2">
              <p className="font-medium text-foreground">Etapa 2 em construção</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Próximo passo: upload da planilha preenchida e validação inicial.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Campos configurados: {wizardState.camposEscolhidos.join(", ") || "(nenhum)"}
              </p>
            </div>
            <Button variant="outline" onClick={() => setEtapa(1)}>
              ← Voltar para Etapa 1
            </Button>
          </CardContent>
        </Card>
      )}

      {etapa >= 3 && (
        <Card>
          <CardContent className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
            <Wrench className="h-12 w-12 text-muted-foreground" />
            <div className="space-y-2">
              <p className="font-medium text-foreground">Etapa {etapa} em construção</p>
              <p className="max-w-md text-sm text-muted-foreground">Esta etapa será construída no próximo prompt.</p>
            </div>
            <Button variant="outline" onClick={() => setEtapa(1)}>
              ← Voltar ao início
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
