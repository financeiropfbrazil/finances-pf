import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { listBulkJobs, type BulkJob } from "@/services/produtoBulkService";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ShieldX,
  History,
  Loader2,
  Plus,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock,
  RotateCcw,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_CONFIG: Record
  string,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  pendente: {
    label: "Pendente",
    className: "bg-slate-500/15 text-slate-600 border-slate-500/30",
    icon: Clock,
  },
  em_execucao: {
    label: "Em execução",
    className: "bg-blue-500/15 text-blue-600 border-blue-500/30",
    icon: Loader2,
  },
  concluido: {
    label: "Concluído",
    className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    icon: CheckCircle2,
  },
  concluido_com_erros: {
    label: "Concluído com erros",
    className: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    icon: AlertCircle,
  },
  falhou: {
    label: "Falhou",
    className: "bg-red-500/15 text-red-600 border-red-500/30",
    icon: XCircle,
  },
  revertido: {
    label: "Revertido",
    className: "bg-purple-500/15 text-purple-600 border-purple-500/30",
    icon: RotateCcw,
  },
};

const TIPO_LABEL: Record<string, string> = {
  produtos_campos: "Produtos — Campos",
  produtos_unidade_medida: "Produtos — Unidade de Medida",
};

export default function BulkEditHistorico() {
  const podeAcessar = useHasPermission(PERMISSIONS.FERRAMENTAS_BULK_EDIT_EXECUTE);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["bulk_edit_jobs_lista"],
    queryFn: () => listBulkJobs(50),
    enabled: podeAcessar,
  });

  if (!podeAcessar) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <ShieldX className="h-16 w-16" />
        <h2 className="text-xl font-semibold text-foreground">Acesso Restrito</h2>
        <p>Você não tem permissão para acessar o histórico de bulk edit.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
            <History className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Histórico de Bulk Edit
            </h1>
            <p className="text-sm text-muted-foreground">
              Jobs de edição em massa executados no ERP Alvo.
            </p>
          </div>
        </div>
        <Button asChild>
          <Link to="/ferramentas/bulk-edit/produtos-campos">
            <Plus className="h-4 w-4" />
            Novo Bulk Edit
          </Link>
        </Button>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border">
          <Card className="border-0 bg-transparent shadow-none text-center max-w-md">
            <CardContent className="flex flex-col items-center gap-4 pt-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <History className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  Nenhum job de bulk edit executado ainda
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Crie seu primeiro bulk clicando em "Novo Bulk Edit".
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job: BulkJob) => {
            const statusCfg = STATUS_CONFIG[job.status] || STATUS_CONFIG.pendente;
            const StatusIcon = statusCfg.icon;
            const tipoLabel = TIPO_LABEL[job.tipo] || job.tipo;
            return (
              <Card
                key={job.id}
                className="transition-colors hover:border-primary/50"
              >
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={statusCfg.className}>
                      <StatusIcon className="mr-1 h-3 w-3" />
                      {statusCfg.label}
                    </Badge>
                    <span className="text-xs font-mono text-muted-foreground">
                      {job.id.substring(0, 8)}
                    </span>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-foreground">{tipoLabel}</p>
                    {job.campos_alterados &&
                      Array.isArray(job.campos_alterados) &&
                      job.campos_alterados.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                          Campos: {job.campos_alterados.join(", ")}
                        </p>
                      )}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Total: {job.total_itens}</span>
                    <span className="text-emerald-600">✓ {job.itens_sucesso}</span>
                    {job.itens_falha > 0 && (
                      <span className="text-red-600">✗ {job.itens_falha}</span>
                    )}
                    {job.itens_pulado > 0 && <span>↷ {job.itens_pulado}</span>}
                  </div>

                  <p className="text-[11px] text-muted-foreground/60">
                    Criado em{" "}
                    {format(new Date(job.criado_em), "dd/MM/yyyy 'às' HH:mm", {
                      locale: ptBR,
                    })}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}