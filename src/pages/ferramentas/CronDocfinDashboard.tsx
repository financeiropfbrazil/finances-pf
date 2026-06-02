/**
 * Página de gerenciamento do cron sync-docfin-cron (job_type='docfin_despesas').
 *
 * Espelha CronDespesasDashboard (MovEstq), adaptada de DIA → COMPETÊNCIA:
 *  - Lê as RPCs sync_cron_docfin_* (job_type='docfin_despesas')
 *  - Labels: a execução reporta competências / docs / rateios
 *  - PROGRESSO mede a JANELA ROLANTE viva (3 meses), não o histórico inteiro.
 *    As competências CONGELADO (backfill manual) ficam num card à parte e NÃO
 *    entram no cálculo da barra — só são processadas quando reabertas à mão.
 *
 * Mapeamento sync_runs → semântica DocFin (definido na Edge Function):
 *    total_candidatos  = competências da rodada (1)
 *    total_consultados = docs com despesa gravados
 *    total_mudaram     = rateios gravados
 *
 * Mesma permissão da tela do MovEstq: ferramentas.cron.view.
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
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
  ChevronRight,
  Coins,
  Database,
  Snowflake,
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

interface JanelaProgress {
  total: number;
  pendente: number;
  ok: number;
  sem_movimento: number;
  falha_permanente: number;
  em_progresso: number;
  congelado: number;
  processados: number;
  escopo_ativo: number;
  pct_completo: number;
  fronteira_backfill: string | null;
}

interface RunDetail extends RunRow {
  detalhes:
    | {
        competencia?: string;
        motivo?: string;
        reaberturas?: string[];
        summary?: Record<string, unknown> | null;
      }
    | Array<unknown>;
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
  if (cron === "10 10,15,19 * * 1-5") {
    return "3x ao dia (7h10, 12h10, 16h10), seg-sex";
  }
  if (cron === "0 10,15,19 * * 1-5") {
    return "3x ao dia (7h, 12h, 16h), seg-sex";
  }
  return cron;
}

function formatCompetencia(comp: string | null): string {
  if (!comp) return "—";
  // comp pode vir como 'YYYY-MM-DD' (dia 1) → formata como MM/YYYY
  const d = new Date(comp.length === 10 ? comp + "T00:00:00" : comp);
  return format(d, "MM/yyyy", { locale: ptBR });
}

function describeStatusRow(run: RunRow): { variant: "ok" | "warn" | "err"; icon: typeof CheckCircle2 } {
  if (run.total_erros > 0) return { variant: "err", icon: XCircle };
  if (run.finished_at === null) return { variant: "warn", icon: Clock };
  return { variant: "ok", icon: CheckCircle2 };
}

// ─── Componente principal ─────────────────────────────────────────

export default function CronDocfinDashboard() {
  const podeAcessar = useHasPermission(PERMISSIONS.FERRAMENTAS_CRON_VIEW);

  const queryClient = useQueryClient();

  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [confirmTriggerOpen, setConfirmTriggerOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["cron_docfin_status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sync_cron_docfin_get_status" as never);
      if (error) throw error;
      return data as unknown as CronStatus;
    },
    enabled: podeAcessar,
    refetchInterval: 30_000,
  });

  const janelaQuery = useQuery({
    queryKey: ["cron_docfin_janela"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sync_cron_docfin_backfill_progress" as never);
      if (error) throw error;
      return data as unknown as JanelaProgress;
    },
    enabled: podeAcessar,
    refetchInterval: 30_000,
  });

  const runsQuery = useQuery({
    queryKey: ["cron_docfin_runs", 20],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "sync_cron_docfin_list_runs" as never,
        { p_limit: 20, p_offset: 0 } as never,
      );
      if (error) throw error;
      return (data || []) as unknown as RunRow[];
    },
    enabled: podeAcessar,
  });

  const runDetailQuery = useQuery({
    queryKey: ["cron_docfin_run_detail", selectedRunId],
    queryFn: async () => {
      if (!selectedRunId) return null;
      const { data, error } = await supabase.rpc(
        "sync_cron_docfin_get_run_detail" as never,
        { p_run_id: selectedRunId } as never,
      );
      if (error) throw error;
      return data as unknown as RunDetail;
    },
    enabled: !!selectedRunId,
  });

  const pauseMutation = useMutation({
    mutationFn: async (reason: string) => {
      const { data, error } = await supabase.rpc("sync_cron_docfin_pause" as never, { p_reason: reason } as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Cron DocFin pausado");
      setPauseDialogOpen(false);
      setPauseReason("");
      queryClient.invalidateQueries({ queryKey: ["cron_docfin_status"] });
    },
    onError: (err: any) => toast.error(`Falha ao pausar: ${err.message ?? err}`),
  });

  const resumeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("sync_cron_docfin_resume" as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Cron DocFin despausado");
      queryClient.invalidateQueries({ queryKey: ["cron_docfin_status"] });
    },
    onError: (err: any) => toast.error(`Falha ao despausar: ${err.message ?? err}`),
  });

  const triggerMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("sync_cron_docfin_trigger_now" as never);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Cron DocFin disparado. Aguarde ~15-30s.");
      setConfirmTriggerOpen(false);
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["cron_docfin_runs"] });
        queryClient.invalidateQueries({ queryKey: ["cron_docfin_status"] });
        queryClient.invalidateQueries({ queryKey: ["cron_docfin_janela"] });
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
  const jn = janelaQuery.data;

  return (
    <div className="space-y-6 p-6">
      {/* ─── Header ─── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
            <Coins className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Cron Despesas DocFin</h1>
            <p className="text-sm text-muted-foreground">
              Captura automática da despesa nativa do DocFin (folha, impostos, cartão, RDESP) com o ERP Alvo.
            </p>
          </div>
        </div>
      </div>

      {/* ─── Painel da janela rolante ─── */}
      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Janela rolante (3 meses)</h2>
          </div>

          {janelaQuery.isLoading ? (
            <div className="flex min-h-[60px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !jn ? (
            <p className="text-sm text-muted-foreground">Não foi possível carregar o progresso.</p>
          ) : (
            <>
              {/* Barra — mede a janela viva (escopo ativo), não o histórico inteiro */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {jn.processados} de {jn.escopo_ativo} competências processadas
                  </span>
                  <span className="font-semibold text-foreground">{jn.pct_completo}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(jn.pct_completo, 100)}%` }}
                  />
                </div>
              </div>

              {/* Quebra por status */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <BackfillStat label="Pendentes" value={jn.pendente} cls={jn.pendente > 0 ? "text-amber-600" : ""} />
                <BackfillStat label="OK (c/ despesa)" value={jn.ok} cls="text-emerald-600" />
                <BackfillStat label="Sem movimento" value={jn.sem_movimento} />
                <BackfillStat label="Em progresso" value={jn.em_progresso} />
                <BackfillStat
                  label="Falhas"
                  value={jn.falha_permanente}
                  cls={jn.falha_permanente > 0 ? "text-red-600" : ""}
                />
              </div>

              {/* Card separado: congeladas (backfill manual) */}
              <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 p-3">
                <div className="flex items-center gap-2">
                  <Snowflake className="h-4 w-4 text-blue-400" />
                  <span className="text-sm text-muted-foreground">Competências congeladas (backfill manual)</span>
                </div>
                <span className="text-sm font-semibold text-foreground">{jn.congelado}</span>
              </div>

              {jn.fronteira_backfill && (
                <p className="text-xs text-muted-foreground">
                  Histórico capturado desde{" "}
                  <span className="font-medium text-foreground">{formatCompetencia(jn.fronteira_backfill)}</span>
                  {jn.pendente === 0 && jn.em_progresso === 0 && (
                    <span className="ml-1 text-emerald-600">· janela em dia ✓</span>
                  )}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

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
                    {formatDuracao(status.last_run.duracao_ms)} · {status.last_run.total_candidatos} competência(s) ·{" "}
                    {status.last_run.total_mudaram} rateios
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
              queryClient.invalidateQueries({ queryKey: ["cron_docfin_runs"] });
              queryClient.invalidateQueries({ queryKey: ["cron_docfin_status"] });
              queryClient.invalidateQueries({ queryKey: ["cron_docfin_janela"] });
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
                          <span>{run.total_candidatos} competência(s)</span>
                          <span>{run.total_consultados} docs</span>
                          <span className={run.total_mudaram > 0 ? "text-emerald-600" : ""}>
                            {run.total_mudaram} rateios
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
            <DialogTitle>Pausar Cron DocFin</DialogTitle>
            <DialogDescription>
              Enquanto pausado, o pg_cron continua disparando mas a função detecta e pula sem fazer nada. Informe o
              motivo da pausa para fins de auditoria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              placeholder="Ex: investigando divergência na competência de abril"
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
            <DialogTitle>Rodar Cron DocFin Agora</DialogTitle>
            <DialogDescription>
              O cron será disparado fora do agendamento. Processa 1 competência elegível (a janela rolante é varrida ao
              longo das rodadas) e fica registrado no histórico como "Manual".
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

// ─── Subcomponentes ────────────────────────────────────────────────

function BackfillStat({ label, value, cls = "" }: { label: string; value: number; cls?: string }) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-base font-semibold ${cls}`}>{value}</p>
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

function RunDetailView({ detail }: { detail: RunDetail }) {
  const triggerCfg = TRIGGERED_BY_LABEL[detail.triggered_by] ?? TRIGGERED_BY_LABEL.test;
  // No DocFin, detalhes é um objeto { competencia, motivo, reaberturas, summary }
  const det = (detail.detalhes && !Array.isArray(detail.detalhes) ? detail.detalhes : {}) as {
    competencia?: string;
    motivo?: string;
    reaberturas?: string[];
    summary?: Record<string, unknown> | null;
  };
  const s = det.summary as Record<string, number | string | null> | undefined;

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
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Competência</p>
          <p className="font-medium">{det.competencia ?? "—"}</p>
        </div>
      </div>

      {/* Stats — semântica DocFin */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox label="Competências" value={detail.total_candidatos} />
        <StatBox label="Docs c/ despesa" value={detail.total_consultados} />
        <StatBox
          label="Rateios"
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

      {/* Detalhe da competência processada */}
      {det.competencia && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Competência processada</h3>
          <div className="rounded-md border border-border p-3 text-xs space-y-1">
            <div>
              <span className="font-mono font-medium text-foreground">{det.competencia}</span>
              {det.motivo && <span className="ml-2 text-muted-foreground">· {det.motivo}</span>}
            </div>
            {s && (
              <div className="text-muted-foreground">
                {String(s.docs_listados ?? 0)} listados · {String(s.docs_descartados_origem ?? 0)} estoque ·{" "}
                {String(s.docs_descartados_especie ?? 0)} PROV · {String(s.docs_descartados_fatura ?? 0)} FAT ·{" "}
                {String(s.docs_com_despesa ?? 0)} c/ despesa · {String(s.rateios_gravados ?? 0)} rateios
              </div>
            )}
            {det.reaberturas && det.reaberturas.length > 0 && (
              <div className="text-muted-foreground">Reaberturas: {det.reaberturas.join(", ")}</div>
            )}
            {s && Boolean(s.parado_por_watchdog) && (
              <div className="text-amber-600">Pausado por watchdog — offset salvo, retoma na próxima rodada.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
