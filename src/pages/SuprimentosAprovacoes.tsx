import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  listarRequisicoesPendentes,
  listarCentrosDeCustoDoLider,
  aprovarRequisicao,
  rejeitarRequisicao,
  reenviarRequisicaoAprovada,
  type RequisicaoPendente,
} from "@/services/requisicoesService";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ModalRejeicaoRequisicao } from "@/components/compras/ModalRejeicaoRequisicao";
import { Loader2, ClipboardCheck, Check, X, Package, Calendar, Building2, User as UserIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";

function formatData(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return "—";
  }
}

function formatDataCurta(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  try {
    return format(new Date(`${ymd.substring(0, 10)}T12:00:00`), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return ymd;
  }
}

/** "há quantos dias espera" — a fila é de decisão, a espera precisa ser visível. */
function diasEsperando(createdAt: string): number {
  try {
    return Math.max(0, differenceInCalendarDays(new Date(), new Date(createdAt)));
  } catch {
    return 0;
  }
}

export default function SuprimentosAprovacoes() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = profile?.is_admin === true;

  // Qual requisição está sendo decidida e em que tempo do fluxo (o envio ao ERP
  // acontece NESTA sessão, depois do aprovar — feedback em 2 tempos).
  const [decidindoId, setDecidindoId] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<"aprovando" | "enviando" | "rejeitando" | null>(null);

  const [rejeitando, setRejeitando] = useState<RequisicaoPendente | null>(null);

  const { data: centrosDoLider = [] } = useQuery({
    queryKey: ["lider_centros_custo", user?.id],
    queryFn: () => listarCentrosDeCustoDoLider(user!.id),
    enabled: !!user && !isAdmin,
  });

  const {
    data: pendentes = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["requisicoes_pendentes_aprovacao", user?.id, isAdmin],
    queryFn: () => listarRequisicoesPendentes(user!.id, isAdmin),
    enabled: !!user,
  });

  // Nome de quem criou a requisição (a tabela guarda só o user_id).
  const { data: nomePorUserId = {} } = useQuery({
    queryKey: ["perfis_requisitantes_fila", pendentes.map((r) => r.requisitante_user_id).join(",")],
    queryFn: async (): Promise<Record<string, string>> => {
      const ids = Array.from(new Set(pendentes.map((r) => r.requisitante_user_id).filter(Boolean))) as string[];
      if (ids.length === 0) return {};
      const { data } = await (supabase as any).from("profiles").select("user_id, full_name").in("user_id", ids);
      const mapa: Record<string, string> = {};
      for (const p of data || []) mapa[p.user_id] = p.full_name;
      return mapa;
    },
    enabled: pendentes.length > 0,
  });

  const recarregarTudo = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ["aprovacoes_pendentes_count"] });
  };

  const handleAprovar = async (req: RequisicaoPendente) => {
    if (!user) return;
    setDecidindoId(req.id);
    setEtapa("aprovando");
    try {
      const decisao = await aprovarRequisicao(req.id);
      if (!decisao.ok) {
        toast({ title: "Não foi possível aprovar", description: decisao.mensagem, variant: "destructive" });
        if (decisao.jaDecidida) recarregarTudo();
        return;
      }

      // 1º tempo: a decisão está gravada e é irreversível por esta tela.
      toast({ title: "Aprovada ✓", description: "Enviando ao ERP…" });
      setEtapa("enviando");

      // 2º tempo: o envio. Mesmo caminho do Reenviar pós-aprovação — desfecho
      // exclusivamente pela RPC R4 (escrita direta em req aprovada é recusada
      // pelo trigger, por design).
      try {
        const envio = await reenviarRequisicaoAprovada(req.id, user.id, profile?.full_name || "Usuário");
        if (envio.sucesso) {
          toast({
            title: `Sincronizada (nº ${envio.numero_alvo})`,
            description: "A requisição foi aprovada e criada no ERP.",
          });
        } else {
          toast({
            title: "Aprovada, mas o envio ao ERP falhou",
            description: `${envio.erro} — a aprovação foi preservada. Use "Reenviar" no detalhe da requisição.`,
            variant: "destructive",
          });
        }
      } catch (errEnvio: any) {
        toast({
          title: "Aprovada, mas o envio ao ERP falhou",
          description: `${errEnvio?.message || errEnvio} — a aprovação foi preservada. Use "Reenviar" no detalhe.`,
          variant: "destructive",
        });
      }
      recarregarTudo();
    } catch (err: any) {
      toast({ title: "Erro inesperado", description: err?.message || String(err), variant: "destructive" });
    } finally {
      setDecidindoId(null);
      setEtapa(null);
    }
  };

  const handleConfirmarRejeicao = async (motivoCodigo: string, observacao: string | null) => {
    if (!rejeitando) return;
    const req = rejeitando;
    setDecidindoId(req.id);
    setEtapa("rejeitando");
    try {
      const decisao = await rejeitarRequisicao(req.id, motivoCodigo, observacao);
      if (!decisao.ok) {
        toast({ title: "Não foi possível rejeitar", description: decisao.mensagem, variant: "destructive" });
        if (decisao.jaDecidida) recarregarTudo();
        return;
      }
      toast({
        title: "Requisição rejeitada",
        description: "O requisitante verá o motivo no detalhe. Ela não vai ao ERP.",
      });
      setRejeitando(null);
      recarregarTudo();
    } catch (err: any) {
      toast({ title: "Erro inesperado", description: err?.message || String(err), variant: "destructive" });
    } finally {
      setDecidindoId(null);
      setEtapa(null);
    }
  };

  const semEscopo = !isAdmin && centrosDoLider.length === 0;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Aprovações de Requisições</h1>
        <p className="text-sm text-muted-foreground">
          Requisições de compra aguardando sua decisão como líder do centro de custo.
          {!isAdmin && centrosDoLider.length > 0 && (
            <> Você responde por {centrosDoLider.length === 1 ? "o centro" : "os centros"} {centrosDoLider.join(", ")}.</>
          )}
          {isAdmin && <> Como administrador, você vê as pendências de todos os centros de custo.</>}
        </p>
      </div>

      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : semEscopo ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border">
          <Card className="max-w-md border-0 bg-transparent text-center shadow-none">
            <CardContent className="flex flex-col items-center gap-4 pt-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <Building2 className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">Nenhum centro de custo sob sua liderança</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Você tem permissão para aprovar, mas ainda não está mapeado como líder de nenhum centro de custo. Fale
                  com o administrador para incluir seus centros.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : pendentes.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border">
          <Card className="max-w-md border-0 bg-transparent text-center shadow-none">
            <CardContent className="flex flex-col items-center gap-4 pt-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <ClipboardCheck className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">Nenhuma requisição aguardando decisão</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Quando alguém criar uma requisição num centro de custo que você lidera, ela aparece aqui.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {pendentes.length} requisição{pendentes.length !== 1 ? "ões" : ""} aguardando decisão — mais antiga primeiro.
          </p>

          <div className="space-y-3">
            {pendentes.map((req) => {
              const dias = diasEsperando(req.created_at);
              const ocupado = decidindoId === req.id;
              return (
                <Card key={req.id} className="transition-colors hover:border-primary/40">
                  <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div
                      className="min-w-0 flex-1 cursor-pointer"
                      onClick={() => navigate(`/suprimentos/requisicoes/${req.id}`)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        >
                          Pendente aprovação
                        </Badge>
                        <Badge variant="outline" className={dias >= 3 ? "border-red-500/30 text-red-600" : ""}>
                          {dias === 0 ? "hoje" : `há ${dias} dia${dias !== 1 ? "s" : ""}`}
                        </Badge>
                      </div>

                      <p className="mt-2 truncate text-sm font-medium text-foreground">
                        {req.descricao || "(sem descrição)"}
                      </p>

                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <UserIcon className="h-3 w-3" />
                          {(req.requisitante_user_id && nomePorUserId[req.requisitante_user_id]) ||
                            req.funcionario_nome ||
                            "—"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {req.centro_ctrl_nome || req.codigo_centro_ctrl || "—"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Package className="h-3 w-3" />
                          {req.total_itens ?? 0} {(req.total_itens ?? 0) === 1 ? "item" : "itens"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Necessidade: {formatDataCurta(req.data_necessidade)}
                        </span>
                        <span>Criada em {formatData(req.created_at)}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/suprimentos/requisicoes/${req.id}`)}
                        disabled={ocupado}
                      >
                        Ver detalhe
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setRejeitando(req)}
                        disabled={ocupado}
                      >
                        <X className="mr-1 h-3 w-3" /> Rejeitar
                      </Button>
                      <Button size="sm" onClick={() => handleAprovar(req)} disabled={ocupado}>
                        {ocupado && (etapa === "aprovando" || etapa === "enviando") ? (
                          <>
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            {etapa === "enviando" ? "Enviando ao ERP…" : "Aprovando…"}
                          </>
                        ) : (
                          <>
                            <Check className="mr-1 h-3 w-3" /> Aprovar
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Rejeição — motivo do catálogo (AJUSTE 1.3), estado TERMINAL */}
      <ModalRejeicaoRequisicao
        aberto={!!rejeitando}
        onOpenChange={(aberto) => {
          if (!aberto) setRejeitando(null);
        }}
        onConfirmar={handleConfirmarRejeicao}
        rejeitando={etapa === "rejeitando"}
      />
    </div>
  );
}
