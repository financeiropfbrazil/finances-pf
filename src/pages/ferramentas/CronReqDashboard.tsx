/**
 * Página de gerenciamento do cron sync-compras-status-cron.
 *
 * Permite ao admin:
 *  - Visualizar estado atual (ativo/pausado, agendamento, última execução)
 *  - Pausar / Despausar o cron (kill switch via sync_settings)
 *  - Disparar execução manual (com confirmação)
 *  - Ver histórico das últimas 20 execuções
 *  - Drill-down nos detalhes de uma execução específica (Dialog)
 *
 * Auto-refresh do status a cada 30s. Histórico atualiza manualmente
 * (botão Atualizar) e sob demanda após ações que mudam estado.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ShieldX,
  RefreshCw,
  Loader2,
  Play,
  Pause,
  PlayCircle,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

// ─── Tipos ─────────────────────────────────────────────────────────

interface CronStatus {
  enabled: boolean;
  schedule_cron: string;
  paused_at: string | null;
  paused_by_email: string | null;
  paused_reason: string | null;
  settings_updated_at: string;
  last_run: {
    id: string;
    triggered_by: string;
    started_at: string;
    finished_at: string | null;
    duracao_ms: number | null;
    total_candidatos: number;
    total_consultados: number;
    total_mudaram: number;
    total_erros: number;
    observacao: string | null;
  } | null;
}

interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  duracao_ms: number | null;
  triggered_by: string;
  job_type: string;
  total_candidatos: number;
  total_consultados: number;
  total_mudaram: number;
  total_erros: number;
  observacao: string | null;
}

interface RunDetail extends RunRow {
  detalhes: Array<{
    tipo: "req" | "ped";
    id: string;
    numero_alvo: string;
    status_anterior?: string;
    status_novo?: string;
    status_aprovacao_anterior?: string;
    status_aprovacao_novo?: string;
    aprovado_anterior?: string;
    aprovado_novo?: string;
    comprado_anterior?: string;
    comprado_novo?: string;
    proximo_aprovador_anterior?: string;
    proximo_aprovador_novo?: string;
    erro?: string;
  }>;
}

// ─── Helpers ───────────────────────────────────────────────────────

const TRIGGERED_BY_LABEL: Record<string, { label: string; cls: string }> = {
  pg_cron: { label: "Automático", cls: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  manual_admin: { label: "Manual", cls: "bg-purple-500/15 text-purple-600 border-purple-500/30" },
  test: { label: "Teste", cls: "bg-slate-500/15 text-slate-600 border-slate-500/30" },
};

function formatDuracao(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}

function describeSchedule(cron: string): string {
  // '0 11-20 * * 1-5' → "A cada hora cheia, 8h-17h Brasília, seg-sex"
  // Hardcoded pro nosso caso por enquanto; quando tivermos múltiplos crons,
  // gerar via biblioteca cronstrue ou similar.
  if (cron === "0 11-20 * * 1-5") {
    return "A cada hora cheia, das 8h às 17h (seg-sex)";
  }
  return cron;
}

function describeStatusRow(run: RunRow): { variant: "ok" | "warn" | "err"; icon: typeof CheckCircle2 } {
  if (run.total_erros > 0) return { variant: "err", icon: XCircle };
  if (run.finished_at === null) return { variant: "warn", icon: Clock };
  return { variant: "ok", icon: CheckCircle2 };
}

// ─── Componente principal ─────────────────────────────────────────

export default function CronReqDashboard() {
  const podeAcessar = useHasPermission(PERMISSIONS.FERRAMENTAS_CRON_VIEW);

  const queryClient = useQueryClient();

  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [confirmTriggerOpen, setConfirmTriggerOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Status (refetch automático a cada 30s)
  const statusQuery = useQuery({
    queryKey: ["cron_status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sync_cron_get_status" as never);
      if (error) throw error;
      return data as unknown as CronStatus;
    },
    enabled: podeAcessar,
    refetchInterval: 30_000,
  });

  // Lista de execuções
  const runsQuery = useQuery({
    queryKey: ["cron_runs", 20],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sync_cron_list_runs" as never, {
        p_limit: 20,
        p_offset: 0,
      } as never);
      if (error) throw error;
      return (data || []) as unknown as RunRow[];
    },
    enabled: podeAcessar,
  });

  // Detalhe de 1 execução (carregado sob demanda)
  const runDetailQuery = useQuery({
    queryKey: ["cron_run_detail", selectedRunId],
    queryFn: async () => {
      if (!selectedRunId) return null;
      const { data, error } = await supabase.rpc("sync_cron_get_run_detail" as never, {
        p_run_id: selectedRunId,
      } as never);
      if (error) throw error;
      return data as unknown as RunDetail;
    },
    enabled: !!selectedRunId,
  });

  // Mutations
  const pauseMutation = useMutation({
    mutationFn: async (reason: string) => {
      const { data, error } = await supabase.rpc("sync_cron_pause" as never, { p_reason: reason } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Cron pausado");
      setPauseDialogOpen(false);
      setPauseReason("");
      queryClient.invalidateQueries({ queryKey: ["cron_status"] });
    },
    onError: (err: any) => toast.error(`Falha ao pausar: ${err.message ?? err}`),
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("sync_cron_resume" as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Cron despausado");
      queryClient.invalidateQueries({ queryKey: ["cron_status"] });
    },
    onError: (err: any) => toast.error(`Falha ao despausar: ${err.message ?? err}`),
  });

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("sync_cron_trigger_now" as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Cron disparado. Aguarde ~30-60s para completar.");
      setConfirmTriggerOpen(false);
      // Refresh otimista após 5s pra ver linha "iniciada"
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["cron_runs"] });
        queryClient.invalidateQueries({ queryKey: ["cron_status"] });
      }, 5000);
    },
    onError: (err: any) => {
      toast.error(`Falha ao disparar: ${err.message ?? err}`);
      setConfirmTriggerOpen(false);
    },
  });

  if (!podeAcessar) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <ShieldX className="h-16 w-16" />
        <h2 className="text-xl font-semibold text-foreground">Acesso Restrito</h2>
        <p>Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  const status = statusQuery.data;
  const isPaused = status ? !status.enabled : false;
  const runs = runsQuery.data || [];

  return (
    <div className="space-y-6 p-6">
      {/* ─── Header ─── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
            <RefreshCw className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Cron Requisições</h1>
            <p className="text-sm text-muted-foreground">
              Sincronização automática de status de requisições e pedidos com o ERP Alvo.
            </p>
          </div>
        </div>
      </div>

      {/* ─── Status atual ─── */}
      {statusQuery.isLoading ? (
        <Card>
          <CardContent className="flex min-h-[120px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : !status ? (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-4 text-sm text-red-700">Não foi possível carregar o status do cron.</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              {/* Estado */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex h-2.5 w-2.5 rounded-full ${isPaused ? "bg-amber-500" : "bg-emerald-500"}`}
                  />
                  <span className="text-base font-semibold text-foreground">{isPaused ? "Pausado" : "Ativo"}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{describeSchedule(status.schedule_cron)}</span>
                </div>
                {isPaused && status.paused_at && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                    <p className="text-foreground">
                      Pausado{" "}
                      <span className="text-muted-foreground">
                        ({formatDistanceToNow(new Date(status.paused_at), { locale: ptBR, addSuffix: true })})
                      </span>
                    </p>
                    {status.paused_by_email && (
                      <p className="mt-0.5 text-xs text-muted-foreground">Por: {status.paused_by_email}</p>
                    )}
                    {status.paused_reason && (
                      <p className="mt-0.5 text-xs text-muted-foreground">Motivo: {status.paused_reason}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Botões */}
              <div className="flex flex-wrap gap-2">
                {isPaused ? (
                  <Button variant="default" onClick={() => resumeMutation.mutate()} disabled={resumeMutation.isPending}>
                    {resumeMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Despausar
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setPauseDialogOpen(true)}>
                    <Pause className="h-4 w-4" />
                    Pausar
                  </Button>
                )}
                <Button
                  variant="default"
                  onClick={() => setConfirmTriggerOpen(true)}
                  disabled={isPaused || triggerMutation.isPending}
                  title={isPaused ? "Despause o cron antes de rodar manualmente" : ""}
                >
                  {triggerMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlayCircle className="h-4 w-4" />
                  )}
                  Rodar Agora
                </Button>
              </div>
            </div>

            {/* Última execução */}
            {status.last_run && (
              <div className="border-t border-border pt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Última execução
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="text-foreground">
                    {format(new Date(status.last_run.started_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                  </span>
                  <Badge
                    variant="outline"
                    className={TRIGGERED_BY_LABEL[status.last_run.triggered_by]?.cls ?? "bg-slate-500/10"}
                  >
                    {TRIGGERED_BY_LABEL[status.last_run.triggered_by]?.label ?? status.last_run.triggered_by}
                  </Badge>
                  <span className="text-muted-foreground">
                    {formatDuracao(status.last_run.duracao_ms)} · {status.last_run.total_candidatos} candidatos ·{" "}
                    {status.last_run.total_mudaram} mudaram
                  </span>
                  {status.last_run.total_erros > 0 && (
                    <span className="text-red-600">{status.last_run.total_erros} erro(s)</span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Histórico ─── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Histórico de execuções</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["cron_runs"] });
              queryClient.invalidateQueries({ queryKey: ["cron_status"] });
            }}
            disabled={runsQuery.isFetching}
          >
            {runsQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>

        {runsQuery.isLoading ? (
          <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-border">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : runs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <Clock className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium text-foreground">Nenhuma execução registrada ainda</p>
              <p className="text-sm text-muted-foreground">
                A primeira execução automática rodará no próximo horário agendado.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {runs.map((run) => {
                  const meta = describeStatusRow(run);
                  const StatusIcon = meta.icon;
                  const iconCls =
                    meta.variant === "ok"
                      ? "text-emerald-600"
                      : meta.variant === "warn"
                        ? "text-amber-600"
                        : "text-red-600";
                  const triggerCfg = TRIGGERED_BY_LABEL[run.triggered_by] ?? TRIGGERED_BY_LABEL.test;

                  return (
                    <button
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent"
                    >
                      <StatusIcon className={`h-5 w-5 shrink-0 ${iconCls}`} />
                      <div className="flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-sm font-medium text-foreground">
                            {format(new Date(run.started_at), "dd/MM 'às' HH:mm:ss", { locale: ptBR })}
                          </span>
                          <Badge variant="outline" className={`text-xs ${triggerCfg.cls}`}>
                            {triggerCfg.label}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{formatDuracao(run.duracao_ms)}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          <span>{run.total_candidatos} candidatos</span>
                          <span>{run.total_consultados} consultados</span>
                          <span className={run.total_mudaram > 0 ? "text-emerald-600" : ""}>
                            {run.total_mudaram} mudaram
                          </span>
                          {run.total_erros > 0 && <span className="text-red-600">{run.total_erros} erro(s)</span>}
                          {run.observacao && <span className="italic">· {run.observacao}</span>}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ─── Dialog: Pausar ─── */}
      <Dialog open={pauseDialogOpen} onOpenChange={setPauseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pausar Cron</DialogTitle>
            <DialogDescription>
              Enquanto pausado, o pg_cron continua disparando mas a função detecta e pula sem fazer nada. Informe o
              motivo da pausa para fins de auditoria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              placeholder="Ex: investigando problema no endpoint do Alvo"
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">{pauseReason.length}/500 caracteres</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPauseDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => pauseMutation.mutate(pauseReason.trim())}
              disabled={pauseReason.trim().length === 0 || pauseMutation.isPending}
            >
              {pauseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirmar Pausa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Dialog: Confirmar Rodar Agora ─── */}
      <Dialog open={confirmTriggerOpen} onOpenChange={setConfirmTriggerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rodar Cron Agora</DialogTitle>
            <DialogDescription>
              O cron será disparado fora do agendamento. A execução leva ~30-60 segundos e fica registrada no histórico
              marcada como "Manual".
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTriggerOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
              {triggerMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Disparar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Dialog: Detalhe de execução ─── */}
      <Dialog
        open={!!selectedRunId}
        onOpenChange={(open) => {
          if (!open) setSelectedRunId(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes da Execução</DialogTitle>
            <DialogDescription>
              {selectedRunId ? <span className="font-mono text-xs">{selectedRunId}</span> : null}
            </DialogDescription>
          </DialogHeader>

          {runDetailQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : runDetailQuery.data ? (
            <RunDetailView detail={runDetailQuery.data} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Subcomponente: detalhe da execução ────────────────────────────

function RunDetailView({ detail }: { detail: RunDetail }) {
  const triggerCfg = TRIGGERED_BY_LABEL[detail.triggered_by] ?? TRIGGERED_BY_LABEL.test;
  const mudancas = (detail.detalhes || []).filter((d) => !d.erro);
  const erros = (detail.detalhes || []).filter((d) => d.erro);

  return (
    <div className="space-y-4">
      {/* Metadados */}
      <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Início</p>
          <p className="font-medium">{format(new Date(detail.started_at), "dd/MM HH:mm:ss", { locale: ptBR })}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Duração</p>
          <p className="font-medium">{formatDuracao(detail.duracao_ms)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Origem</p>
          <Badge variant="outline" className={`text-xs ${triggerCfg.cls}`}>
            {triggerCfg.label}
          </Badge>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Tipo</p>
          <p className="font-medium">{detail.job_type}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox label="Candidatos" value={detail.total_candidatos} />
        <StatBox label="Consultados" value={detail.total_consultados} />
        <StatBox
          label="Mudaram"
          value={detail.total_mudaram}
          className={detail.total_mudaram > 0 ? "text-emerald-600" : ""}
        />
        <StatBox label="Erros" value={detail.total_erros} className={detail.total_erros > 0 ? "text-red-600" : ""} />
      </div>

      {detail.observacao && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <p className="text-foreground">{detail.observacao}</p>
        </div>
      )}

      {/* Erros */}
      {erros.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-600">
            <AlertCircle className="h-4 w-4" />
            Erros ({erros.length})
          </h3>
          <div className="space-y-1.5">
            {erros.map((e, idx) => (
              <div key={`err-${idx}`} className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs">
                <span className="font-mono font-medium">
                  {e.tipo === "req" ? "Req" : "Ped"} {e.numero_alvo}
                </span>{" "}
                — <span className="text-red-700">{e.erro}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mudanças */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Mudanças ({mudancas.length})</h3>
        {mudancas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma mudança detectada nesta execução.</p>
        ) : (
          <div className="space-y-1.5">
            {mudancas.map((m, idx) => (
              <MudancaRow key={`mud-${idx}`} mudanca={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, className = "" }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${className}`}>{value}</p>
    </div>
  );
}

function MudancaRow({ mudanca }: { mudanca: RunDetail["detalhes"][number] }) {
  const tipoLabel = mudanca.tipo === "req" ? "Req" : "Ped";
  const tipoCls =
    mudanca.tipo === "req"
      ? "bg-blue-500/10 text-blue-700 border-blue-500/30"
      : "bg-purple-500/10 text-purple-700 border-purple-500/30";

  const campos: Array<{ label: string; antes?: string; depois?: string }> = [];
  if (mudanca.status_anterior !== undefined || mudanca.status_novo !== undefined) {
    campos.push({ label: "Status", antes: mudanca.status_anterior, depois: mudanca.status_novo });
  }
  if (mudanca.status_aprovacao_anterior !== undefined || mudanca.status_aprovacao_novo !== undefined) {
    campos.push({
      label: "Aprovação",
      antes: mudanca.status_aprovacao_anterior,
      depois: mudanca.status_aprovacao_novo,
    });
  }
  if (mudanca.aprovado_anterior !== undefined || mudanca.aprovado_novo !== undefined) {
    campos.push({
      label: "Aprovado",
      antes: mudanca.aprovado_anterior,
      depois: mudanca.aprovado_novo,
    });
  }
  if (mudanca.comprado_anterior !== undefined || mudanca.comprado_novo !== undefined) {
    campos.push({
      label: "Comprado",
      antes: mudanca.comprado_anterior,
      depois: mudanca.comprado_novo,
    });
  }
  if (mudanca.proximo_aprovador_anterior !== undefined || mudanca.proximo_aprovador_novo !== undefined) {
    campos.push({
      label: "Próx. Aprovador",
      antes: mudanca.proximo_aprovador_anterior,
      depois: mudanca.proximo_aprovador_novo,
    });
  }

  const camposReaisQueMudaram = campos.filter((c) => c.antes !== c.depois);

  return (
    <div className="rounded-md border border-border p-2 text-xs">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={`text-[10px] ${tipoCls}`}>
          {tipoLabel}
        </Badge>
        <span className="font-mono font-medium">{mudanca.numero_alvo}</span>
      </div>
      {camposReaisQueMudaram.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {camposReaisQueMudaram.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 text-muted-foreground">
              <span className="text-foreground">{c.label}:</span>
              <span className="font-mono">{c.antes ?? "—"}</span>
              <ArrowRight className="h-3 w-3" />
              <span className="font-mono text-emerald-700">{c.depois ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
