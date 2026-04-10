import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { reenviarRequisicao, excluirRequisicao, sincronizarStatusRequisicao } from "@/services/requisicoesService";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Loader2, ArrowLeft, RefreshCw, Pencil, Trash2, CheckCircle2, XCircle, Clock, Send, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  rascunho: { label: "Rascunho (erro)", className: "bg-slate-500/15 text-slate-600 border-slate-500/30" },
  pendente_envio: { label: "Pendente de envio", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  sincronizada: { label: "Enviada ao ERP", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  cancelada: { label: "Cancelada", className: "bg-red-500/15 text-red-600 border-red-500/30" },
  convertida_pedido: { label: "Convertida em Pedido", className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
};

const EVENTO_ICON: Record<string, typeof Clock> = {
  criada: Clock,
  envio_tentado: Send,
  envio_sucesso: CheckCircle2,
  envio_falha: XCircle,
  cancelada_alvo: AlertTriangle,
  convertida_pedido: CheckCircle2,
};

export default function SuprimentosRequisicaoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const isAdmin = profile?.is_admin === true;
  const [isReenviando, setIsReenviando] = useState(false);
  const [isExcluindo, setIsExcluindo] = useState(false);
  const [isSyncingStatus, setIsSyncingStatus] = useState(false);

  const { data: req, isLoading, refetch } = useQuery({
    queryKey: ["requisicao_detalhe", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("compras_requisicoes")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      if (!isAdmin) {
        const isOwner = data.requisitante_user_id === user?.id;
        const isFuncionario = (profile as any)?.funcionario_alvo_codigo && data.codigo_funcionario === (profile as any).funcionario_alvo_codigo;
        if (!isOwner && !isFuncionario) return null;
      }

      return data;
    },
    enabled: !!id && !!user,
  });

  const { data: itens = [] } = useQuery({
    queryKey: ["requisicao_itens", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("compras_requisicoes_itens")
        .select("*")
        .eq("requisicao_id", id)
        .order("sequencia", { ascending: true });
      if (error) throw error;

      const itensComRateio = [];
      for (const item of (data || [])) {
        const { data: rateio } = await (supabase as any)
          .from("compras_requisicoes_itens_classe_rec_desp")
          .select("*")
          .eq("item_id", item.id);
        itensComRateio.push({ ...item, rateio: rateio || [] });
      }
      return itensComRateio;
    },
    enabled: !!id && !!req,
  });

  const { data: auditoria = [] } = useQuery({
    queryKey: ["requisicao_auditoria", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("compras_requisicoes_auditoria")
        .select("*")
        .eq("requisicao_id", id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!id && !!req,
  });

  const handleSyncStatus = async (silencioso: boolean = false) => {
    if (!user || !req) return;
    if (!silencioso) setIsSyncingStatus(true);
    try {
      const result = await sincronizarStatusRequisicao(req.id, user.id, profile?.full_name || "Usuário");
      if (result.mudou) {
        toast({
          title: "Status atualizado",
          description: `${result.statusAnterior} → ${result.statusNovo}. ${result.motivo}`,
        });
        refetch();
      } else if (!silencioso) {
        toast({ title: "Nenhuma mudança", description: "Status já estava atualizado." });
      }
    } catch (err: any) {
      if (!silencioso) {
        toast({ title: "Erro ao sincronizar status", description: err.message, variant: "destructive" });
      } else {
        console.error("Sync silencioso falhou:", err.message);
      }
    } finally {
      if (!silencioso) setIsSyncingStatus(false);
    }
  };

  useEffect(() => {
    if (req && req.status === "sincronizada") {
      handleSyncStatus(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.id]);

  const formatDate = (d: string | null | undefined) => {
    if (!d) return "—";
    try {
      const date = new Date(d);
      if (isNaN(date.getTime())) return d;
      return format(date, "dd/MM/yyyy HH:mm", { locale: ptBR });
    } catch { return d; }
  };

  const formatDateShort = (d: string | null | undefined) => {
    if (!d) return "—";
    try {
      const date = new Date(d + (d.length === 10 ? "T12:00:00" : ""));
      if (isNaN(date.getTime())) return d;
      return format(date, "dd/MM/yyyy", { locale: ptBR });
    } catch { return d; }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!req) {
    return (
      <div className="space-y-4 p-6">
        <Button variant="ghost" onClick={() => navigate("/suprimentos/requisicoes")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
        </Button>
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-muted-foreground">
          <AlertTriangle className="h-10 w-10" />
          <p className="text-lg font-medium text-foreground">Requisição não encontrada</p>
        </div>
      </div>
    );
  }

  const statusInfo = STATUS_MAP[req.status] || { label: req.status, className: "bg-muted text-muted-foreground" };
  const isRascunho = req.status === "rascunho";

  const handleReenviar = async () => {
    if (!user) return;
    setIsReenviando(true);
    try {
      const result = await reenviarRequisicao(req.id, user.id, profile?.full_name || "Usuário");
      if (result.sucesso) {
        toast({ title: "Requisição reenviada com sucesso!", description: `Número no ERP: ${result.numero_alvo}` });
      } else {
        toast({ title: "Erro ao reenviar", description: result.erro, variant: "destructive" });
      }
      refetch();
    } catch (err: any) {
      toast({ title: "Erro inesperado", description: err.message, variant: "destructive" });
    } finally {
      setIsReenviando(false);
    }
  };

  const handleExcluir = async () => {
    setIsExcluindo(true);
    try {
      await excluirRequisicao(req.id);
      toast({ title: "Requisição excluída" });
      navigate("/suprimentos/requisicoes");
    } catch (err: any) {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    } finally {
      setIsExcluindo(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/suprimentos/requisicoes")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {req.numero_alvo ? `Requisição Nº ${req.numero_alvo}` : "Requisição (sem número)"}
              </h1>
              <Badge variant="outline" className={statusInfo.className}>
                {statusInfo.label}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Criada em {formatDate(req.created_at)} · Atualizada em {formatDate(req.updated_at)}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          {(req.status === "sincronizada" || req.status === "cancelada") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSyncStatus(false)}
              disabled={isSyncingStatus}
              className="shrink-0"
            >
              {isSyncingStatus ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3 w-3" />
              )}
              Atualizar status
            </Button>
          )}

          {isRascunho && (
            <>
              <Button variant="outline" size="sm" disabled>
                <Pencil className="mr-1 h-3 w-3" /> Editar
              </Button>
              <Button variant="outline" size="sm" disabled={isReenviando} onClick={handleReenviar}>
                {isReenviando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                {isReenviando ? "Reenviando..." : "Reenviar"}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={isExcluindo}>
                    {isExcluindo ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1 h-3 w-3" />}
                    Excluir
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir requisição?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação é permanente. A requisição e todos os seus itens serão excluídos do Hub. Ela não será excluída do ERP se já foi enviada.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleExcluir}>
                      Excluir permanentemente
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}

          {req.status === "cancelada" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isExcluindo}>
                  {isExcluindo ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1 h-3 w-3" />}
                  Excluir
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir requisição cancelada?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta requisição está cancelada (ou foi deletada do ERP). A exclusão é permanente e remove todo o histórico do Hub.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleExcluir}>
                    Excluir permanentemente
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* Erro do último envio */}
      {req.erro_ultimo_envio && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <p className="text-sm font-medium text-foreground">Erro no último envio</p>
              <p className="text-sm text-muted-foreground">{req.erro_ultimo_envio}</p>
              {req.tentativa_envio_em && (
                <p className="mt-1 text-xs text-muted-foreground">Tentativa em {formatDate(req.tentativa_envio_em)}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Detalhes */}
      <Card>
        <CardContent className="p-5">
          <p className="mb-3 text-sm font-semibold text-foreground">Detalhes</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Data de necessidade</p>
              <p className="text-sm font-medium text-foreground">
                {formatDateShort(req.data_necessidade)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Finalidade</p>
              <p className="text-sm font-medium text-foreground">{req.finalidade_compra_label || req.codigo_finalidade_compra || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Descrição</p>
              <p className="text-sm font-medium text-foreground">{req.descricao || "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Área */}
      <Card>
        <CardContent className="p-5">
          <p className="mb-3 text-sm font-semibold text-foreground">Área</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Funcionário</p>
              <p className="text-sm font-medium text-foreground">{req.funcionario_nome || "—"} ({req.codigo_funcionario})</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Centro de Custo</p>
              <p className="text-sm font-medium text-foreground">{req.codigo_centro_ctrl || "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Itens */}
      <Card>
        <CardContent className="p-5">
          <p className="mb-3 text-sm font-semibold text-foreground">Itens ({itens.length})</p>
          <div className="space-y-4">
            {itens.map((item: any) => (
              <div key={item.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{item.produto_nome}</span>
                  <Badge variant="outline" className="text-xs">
                    {item.item_servico ? "Serviço" : "Produto"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.quantidade} {item.produto_unidade} · {item.codigo_produto}
                </p>
                {item.observacao && (
                  <p className="mt-2 text-xs italic text-muted-foreground">"{item.observacao}"</p>
                )}
                {item.rateio?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.rateio.map((r: any) => (
                      <Badge key={r.id} variant="secondary" className="text-[10px]">
                        {r.codigo_classe_rec_desp} ({r.percentual}%)
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Observação */}
      {req.texto && (
        <Card>
          <CardContent className="p-5">
            <p className="mb-2 text-sm font-semibold text-foreground">Observação / Texto</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{req.texto}</p>
          </CardContent>
        </Card>
      )}

      {/* Timeline de auditoria */}
      <Card>
        <CardContent className="p-5">
          <p className="mb-4 text-sm font-semibold text-foreground">Histórico</p>
          <div className="space-y-0">
            {auditoria.map((evt: any, idx: number) => {
              const Icon = EVENTO_ICON[evt.evento] || Clock;
              const isLast = idx === auditoria.length - 1;
              return (
                <div key={evt.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-full ${evt.sucesso ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    {!isLast && <div className="w-px flex-1 bg-border" />}
                  </div>
                  <div className="pb-5">
                    <p className="text-sm font-medium text-foreground">
                      {evt.evento.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(evt.created_at)} — {evt.user_nome || "Sistema"}
                    </p>
                    {evt.mensagem_erro && (
                      <p className="mt-1 text-xs text-destructive">{evt.mensagem_erro}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
