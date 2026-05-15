/**
 * Página orquestradora do wizard de Bulk Edit Produtos — Campos.
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
import { Etapa4Preview, type LinhaPreviewPronta } from "@/components/ferramentas/bulk-edit/Etapa4Preview";
import { Etapa5Execucao } from "@/components/ferramentas/bulk-edit/Etapa5Execucao";

interface WizardState {
  camposEscolhidos: string[];
  linhasPlanilha: LinhaPlanilhaValida[];
  nomeArquivo: string;
  linhasPreCheck: LinhaPreCheckOk[];
  jobId: string | null;
  linhasPreview: LinhaPreviewPronta[];
}

const INITIAL_STATE: WizardState = {
  camposEscolhidos: [],
  linhasPlanilha: [],
  nomeArquivo: "",
  linhasPreCheck: [],
  jobId: null,
  linhasPreview: [],
};

export default function BulkEditProdutosCampos() {
  const podeExecutar = useHasPermission(PERMISSIONS.FERRAMENTAS_BULK_EDIT_EXECUTE);

  const [etapa, setEtapa] = useState<number>(1);
  const [wizardState, setWizardState] = useState<WizardState>(INITIAL_STATE);

  if (!podeExecutar) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <ShieldX className="h-16 w-16" />
        <h2 className="text-xl font-semibold text-foreground">Acesso Restrito</h2>
        <p>Você não tem permissão para executar edições em massa.</p>
      </div>
    );
  }

  // ─── Handlers de transição ───────────────────────────────────────

  const avancarEtapa1 = (camposEscolhidos: string[]) => {
    setWizardState((prev) => ({ ...prev, camposEscolhidos }));
    setEtapa(2);
  };

  const voltarEtapa2 = () => setEtapa(1);

  const avancarEtapa2 = (linhasPlanilha: LinhaPlanilhaValida[], nomeArquivo: string) => {
    setWizardState((prev) => ({ ...prev, linhasPlanilha, nomeArquivo }));
    setEtapa(3);
  };

  const voltarEtapa3 = () => setEtapa(2);

  const avancarEtapa3 = (linhasPreCheck: LinhaPreCheckOk[]) => {
    setWizardState((prev) => ({ ...prev, linhasPreCheck }));
    setEtapa(4);
  };

  const voltarEtapa4 = () => setEtapa(3);

  const avancarEtapa4 = (jobId: string, linhasPreview: LinhaPreviewPronta[]) => {
    setWizardState((prev) => ({ ...prev, jobId, linhasPreview }));
    setEtapa(5);
  };

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

      <Card>
        <CardContent className="p-6">
          <WizardStepper etapaAtual={etapa} />
        </CardContent>
      </Card>

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

      {etapa === 4 && (
        <Etapa4Preview
          camposEscolhidos={wizardState.camposEscolhidos}
          linhasPreCheck={wizardState.linhasPreCheck}
          onVoltar={voltarEtapa4}
          onAvancar={avancarEtapa4}
        />
      )}

      {etapa === 5 && wizardState.jobId && (
        <Etapa5Execucao
          jobId={wizardState.jobId}
          camposEscolhidos={wizardState.camposEscolhidos}
          linhasPreview={wizardState.linhasPreview}
        />
      )}
    </div>
  );
}
