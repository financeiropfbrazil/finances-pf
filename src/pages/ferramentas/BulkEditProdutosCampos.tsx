/**
 * Página orquestradora do wizard de Bulk Edit Produtos — Campos.
 *
 * Responsabilidades:
 * - Controlar a etapa atual (1-5)
 * - Manter state compartilhado entre etapas (campos escolhidos, linhas
 *   parseadas, resultado do pre-check, etc) — passado como props para cada
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
import { Etapa2Upload, type LinhaPlanilhaValida } from "@/components/ferramentas/bulk-edit/Etapa2Upload";
import { Etapa3PreCheck, type LinhaPreCheckOk } from "@/components/ferramentas/bulk-edit/Etapa3PreCheck";

/**
 * Estado completo do wizard. Cada etapa recebe e atualiza partes diferentes.
 */
interface WizardState {
  // Etapa 1 -> Etapa 2
  camposEscolhidos: string[];
  // Etapa 2 -> Etapa 3
  linhasPlanilha: LinhaPlanilhaValida[];
  nomeArquivo: string;
  // Etapa 3 -> Etapa 4
  linhasPreCheck: LinhaPreCheckOk[];
  // Etapa 4 -> Etapa 5 (job criado)
  // jobId: string;
}

const INITIAL_STATE: WizardState = {
  camposEscolhidos: [],
  linhasPlanilha: [],
  nomeArquivo: "",
  linhasPreCheck: [],
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

  const voltarEtapa2 = () => {
    setEtapa(1);
  };

  const avancarEtapa2 = (linhasPlanilha: LinhaPlanilhaValida[], nomeArquivo: string) => {
    setWizardState((prev) => ({ ...prev, linhasPlanilha, nomeArquivo }));
    setEtapa(3);
  };

  const voltarEtapa3 = () => {
    setEtapa(2);
  };

  const avancarEtapa3 = (linhasPreCheck: LinhaPreCheckOk[]) => {
    setWizardState((prev) => ({ ...prev, linhasPreCheck }));
    setEtapa(4);
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
        <Etapa2Upload
          camposEscolhidos={wizardState.camposEscolhidos}
          onVoltar={voltarEtapa2}
          onAvancar={avancarEtapa2}
        />
      )}

      {etapa === 3 && (
        <Etapa3PreCheck linhasPlanilha={wizardState.linhasPlanilha} onVoltar={voltarEtapa3} onAvancar={avancarEtapa3} />
      )}

      {etapa >= 4 && (
        <Card>
          <CardContent className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
            <Wrench className="h-12 w-12 text-muted-foreground" />
            <div className="space-y-2">
              <p className="font-medium text-foreground">Etapa {etapa} em construção</p>
              <p className="max-w-md text-sm text-muted-foreground">Esta etapa será construída no próximo prompt.</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Recebido da Etapa 3: <strong>{wizardState.linhasPreCheck.length}</strong> produto(s) confirmado(s) no
                Alvo, prontos para preview e execução.
              </p>
              {wizardState.linhasPreCheck.length > 0 && (
                <p className="text-xs text-muted-foreground/70">
                  Primeiro: {wizardState.linhasPreCheck[0].codigoAlternativo} →{" "}
                  {wizardState.linhasPreCheck[0].codigoAlvo} — {wizardState.linhasPreCheck[0].nomeAtualAlvo}
                </p>
              )}
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
