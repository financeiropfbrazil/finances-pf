import { Card, CardContent } from "@/components/ui/card";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { ShieldX, Wrench, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function BulkEditProdutosCampos() {
  const podeExecutar = useHasPermission(PERMISSIONS.FERRAMENTAS_BULK_EDIT_EXECUTE);

  if (!podeExecutar) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <ShieldX className="h-16 w-16" />
        <h2 className="text-xl font-semibold text-foreground">Acesso Restrito</h2>
        <p>Você não tem permissão para executar edições em massa.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
            <Wrench className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Bulk Edit Produtos — Campos</h1>
            <p className="text-sm text-muted-foreground">Edite múltiplos produtos do ERP Alvo em massa via planilha.</p>
          </div>
        </div>
      </div>

      {/* Aviso de operação destrutiva */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">Operação destrutiva</p>
            <p className="text-muted-foreground">
              Esta ferramenta altera dados em produção no ERP Alvo. Todos os jobs ficam registrados no histórico com
              snapshot completo antes de cada save — permitindo reverter caso necessário.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Placeholder do wizard */}
      <Card>
        <CardContent className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
          <Wrench className="h-12 w-12 text-muted-foreground" />
          <div className="space-y-2">
            <p className="font-medium text-foreground">Wizard em construção</p>
            <p className="max-w-md text-sm text-muted-foreground">
              O wizard de edição em massa será construído nos próximos passos: configuração de colunas, download de
              planilha modelo, upload, pre-check no Alvo, preview antes/depois e execução.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/ferramentas/bulk-edit/historico">Ver histórico de jobs</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
