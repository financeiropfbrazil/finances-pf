import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw, Play, FileText, AlertTriangle, Loader2, CheckCircle, Clock, Activity } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

type SyncJob = {
  id: string;
  nome: string;
  descricao: string | null;
  frequencia: string;
  horario_preferido: string | null;
  ultimo_status: string | null;
  ultima_execucao: string | null;
  registros_ultima_sync: number | null;
  ultimo_erro: string | null;
  ativo: boolean | null;
  endpoint_tipo: string;
};

type SyncLogEntry = {
  id: string;
  sync_nome: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_processed: number | null;
  records_errors: number | null;
  error_message: string | null;
};

// Map job names to pages that handle syncing
const syncRouteMap: Record<string, string> = {
  entidades: "/entidades?autoSync=true",
  produtos: "/configuracoes/conexao-api?autoSync=true",
  classes_rec_desp: "/configuracoes/classes?autoSync=true",
  condicoes_pagamento: "/configuracoes/conexao-api?autoSync=true",
  pedidos_compra: "/compras/pedidos-compra?autoSync=true",
  contas_pagar: "/contas-a-pagar?autoSync=true",
  nfse_sefaz: "/compras/notas-servico?autoSync=true",
  nfe_sefaz: "/compras/notas-fiscais?autoSync=true",
};

export default function ConfigSyncJobs() {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<SyncJob | null>(null);
  const [logEntries, setLogEntries] = useState<SyncLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const navigate = useNavigate();

  const loadJobs = useCallback(async () => {
    const { data } = await supabase
      .from("sync_jobs")
      .select("*")
      .order("horario_preferido", { ascending: true });
    setJobs((data as SyncJob[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const toggleAtivo = async (job: SyncJob) => {
    const newVal = !job.ativo;
    await supabase.from("sync_jobs").upsert({ id: job.id, ativo: newVal } as any);
    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, ativo: newVal } : j));
    toast({ title: newVal ? "Job ativado" : "Job desativado" });
  };

  const handleExecute = (job: SyncJob) => {
    const route = syncRouteMap[job.nome];
    if (route) {
      navigate(route);
    } else {
      toast({ title: "Handler não configurado", description: `Não há rota mapeada para "${job.nome}".`, variant: "destructive" });
    }
  };

  const openLog = async (job: SyncJob) => {
    setSelectedJob(job);
    setLogDialogOpen(true);
    setLogLoading(true);
    const { data } = await supabase
      .from("sync_log")
      .select("*")
      .eq("sync_job_id", job.id)
      .order("started_at", { ascending: false })
      .limit(10);
    setLogEntries((data as SyncLogEntry[]) || []);
    setLogLoading(false);
  };

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return "—";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  const statusBadge = (status: string | null) => {
    switch (status) {
      case "success":
        return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/15">✅ Sucesso</Badge>;
      case "partial":
        return <Badge className="bg-yellow-500/15 text-yellow-600 border-yellow-500/30 hover:bg-yellow-500/15">⚠️ Parcial</Badge>;
      case "error":
        return <Badge className="bg-red-500/15 text-red-600 border-red-500/30 hover:bg-red-500/15">❌ Erro</Badge>;
      case "running":
        return <Badge className="bg-blue-500/15 text-blue-600 border-blue-500/30 hover:bg-blue-500/15"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Executando...</Badge>;
      default:
        return <Badge variant="secondary">Nunca executado</Badge>;
    }
  };

  // Summary cards
  const totalAtivos = jobs.filter(j => j.ativo).length;
  const lastSuccess = jobs
    .filter(j => j.ultimo_status === "success" && j.ultima_execucao)
    .sort((a, b) => new Date(b.ultima_execucao!).getTime() - new Date(a.ultima_execucao!).getTime())[0];

  const nextScheduled = jobs
    .filter(j => j.ativo && j.horario_preferido)
    .sort((a, b) => (a.horario_preferido || "").localeCompare(b.horario_preferido || ""))[0];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Sincronizações com ERP</h1>
        <p className="text-sm text-muted-foreground">Gerencie os jobs de sincronização automática com o Alvo ERP e SEFAZ</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Jobs Ativos</p>
              <p className="text-xl font-bold text-foreground">{totalAtivos} <span className="text-sm font-normal text-muted-foreground">de {jobs.length}</span></p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Último Sync OK</p>
              <p className="text-sm font-semibold text-foreground">
                {lastSuccess?.ultima_execucao ? format(new Date(lastSuccess.ultima_execucao), "dd/MM/yy HH:mm") : "—"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Clock className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Próximo Agendado</p>
              <p className="text-sm font-semibold text-foreground">
                {nextScheduled ? `${nextScheduled.nome} às ${nextScheduled.horario_preferido}` : "—"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Jobs Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Jobs de Sincronização</CardTitle>
          <Button variant="outline" size="sm" onClick={loadJobs}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Atualizar
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Nenhum job configurado.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Ativo</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead className="hidden md:table-cell">Descrição</TableHead>
                  <TableHead className="hidden sm:table-cell">Frequência</TableHead>
                  <TableHead className="hidden sm:table-cell">Horário</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Última Execução</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Registros</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map(job => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Switch checked={!!job.ativo} onCheckedChange={() => toggleAtivo(job)} />
                    </TableCell>
                    <TableCell className="font-medium">{job.nome}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[200px] truncate">{job.descricao || "—"}</TableCell>
                    <TableCell className="hidden sm:table-cell text-xs capitalize">{job.frequencia}</TableCell>
                    <TableCell className="hidden sm:table-cell text-xs">{job.horario_preferido || "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {statusBadge(job.ultimo_status)}
                        {job.ultimo_erro && (
                          <Tooltip>
                            <TooltipTrigger>
                              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs">
                              {job.ultimo_erro}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs">
                      {job.ultima_execucao ? format(new Date(job.ultima_execucao), "dd/MM/yy HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-right text-xs">
                      {job.registros_ultima_sync ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => handleExecute(job)} title="Executar Agora">
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openLog(job)} title="Ver Log">
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Log Dialog */}
      <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Log — {selectedJob?.nome}</DialogTitle>
          </DialogHeader>
          {logLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : logEntries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum registro de execução encontrado.</p>
          ) : (
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data/Hora</TableHead>
                    <TableHead>Duração</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Registros</TableHead>
                    <TableHead className="text-right">Erros</TableHead>
                    <TableHead>Mensagem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logEntries.map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {format(new Date(entry.started_at), "dd/MM/yy HH:mm:ss")}
                      </TableCell>
                      <TableCell className="text-xs">{formatDuration(entry.started_at, entry.finished_at)}</TableCell>
                      <TableCell>{statusBadge(entry.status)}</TableCell>
                      <TableCell className="text-right text-xs">{entry.records_processed ?? "—"}</TableCell>
                      <TableCell className="text-right text-xs">{entry.records_errors ?? 0}</TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate text-muted-foreground">
                        {entry.error_message || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
