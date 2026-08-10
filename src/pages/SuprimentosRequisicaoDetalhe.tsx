import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { applyCnpjMask } from "@/lib/cnpj";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import {
  reenviarRequisicao,
  reenviarRequisicaoAprovada,
  excluirRequisicao,
  sincronizarStatusRequisicao,
  listarArquivosDaRequisicao,
  getUrlAssinadaArquivo,
  removerArquivo,
  aprovarRequisicao,
  rejeitarRequisicao,
  type ArquivoRequisicao,
  type EnvioResult,
  type RotaSubmissao,
} from "@/services/requisicoesService";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  ArrowLeft,
  RefreshCw,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  AlertTriangle,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Download,
  X,
  ShoppingCart,
  UserCheck,
  Ban,
  Copy,
  Check,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const MOTIVO_MINIMO = 5;

/**
 * Status em que a requisição REALMENTE existe no ERP — logo, os únicos em que faz
 * sentido consultar o Alvo. Lista positiva (Fase 3): rascunho, pendente de envio e
 * os estados do gate de aprovação nunca chegaram lá.
 */
const STATUS_QUE_EXISTEM_NO_ERP = ["sincronizada", "cancelada", "convertida_pedido"];

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  rascunho: { label: "Rascunho (erro)", className: "bg-slate-500/15 text-slate-600 border-slate-500/30" },
  // Gate de aprovação do líder (Fases 1–3). "Aprovada — erro no envio" é a única
  // exceção que ganha cor forte; o resto é neutro de propósito.
  pendente_aprovacao: {
    label: "Pendente aprovação",
    className: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  },
  aprovada: { label: "Aprovada — enviando", className: "bg-slate-500/15 text-slate-600 border-slate-500/30" },
  rejeitada: { label: "Rejeitada", className: "bg-slate-500/15 text-slate-600 border-slate-500/30" },
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
  // Eventos do gate (gravados pelas RPCs R1–R4 via `_req_evento`).
  submetida_sem_gate: Send,
  enviada_aprovacao: UserCheck,
  aprovada_lider: UserCheck,
  rejeitada_lider: Ban,
  envio_pos_aprovacao_ok: CheckCircle2,
  envio_pos_aprovacao_erro: XCircle,
  vinculado_pedido: ShoppingCart,
  desvinculado_pedido: AlertTriangle,
};

export default function SuprimentosRequisicaoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const podeVerTodas = useHasPermission(PERMISSIONS.COMPRAS_REQUISICOES_VIEW_ALL);
  // AJUSTE 1.2 — o botão Reenviar não tinha gate de permissão nenhum: quem enxergava
  // a requisição (inclusive quem tem view_all) enxergava o botão.
  const podeReenviarOwn = useHasPermission(PERMISSIONS.COMPRAS_REQUISICOES_REENVIAR_OWN);
  // FASE 3 (C5.1) — estes três hooks vinham DEPOIS dos `return` condicionais de
  // loading/not-found (herdado de a973f1c). Chamada condicional de hook viola as
  // Rules of Hooks: a contagem muda entre renders. Lugar certo é aqui, no topo.
  const podeCriarPedido = useHasPermission(PERMISSIONS.COMPRAS_PEDIDOS_CREATE);
  const podeCriarRequisicao = useHasPermission(PERMISSIONS.COMPRAS_REQUISICOES_CREATE);
  const podeAprovar = useHasPermission(PERMISSIONS.COMPRAS_REQUISICOES_APROVAR);
  const isAdmin = profile?.is_admin === true;
  const [isReenviando, setIsReenviando] = useState(false);
  const [isExcluindo, setIsExcluindo] = useState(false);
  const [isSyncingStatus, setIsSyncingStatus] = useState(false);
  const [arquivoRemovendoId, setArquivoRemovendoId] = useState<string | null>(null);
  const [decisaoEmCurso, setDecisaoEmCurso] = useState<"aprovando" | "enviando" | "rejeitando" | null>(null);
  const [modalRejeicaoAberto, setModalRejeicaoAberto] = useState(false);
  const [motivoRejeicao, setMotivoRejeicao] = useState("");

  const {
    data: req,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["requisicao_detalhe", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("compras_requisicoes")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      if (!podeVerTodas) {
        const isOwner = data.requisitante_user_id === user?.id;
        const isFuncionario =
          (profile as any)?.funcionario_alvo_codigo &&
          data.codigo_funcionario === (profile as any).funcionario_alvo_codigo;
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
      for (const item of data || []) {
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

  const { data: arquivos = [], refetch: refetchArquivos } = useQuery({
    queryKey: ["requisicao_arquivos", id],
    queryFn: async (): Promise<ArquivoRequisicao[]> => {
      if (!id) return [];
      return await listarArquivosDaRequisicao(id);
    },
    enabled: !!id && !!req,
  });

  // FASE 3 — nome de quem decidiu (a requisição guarda só o user_id).
  const { data: nomeDecisor = {} } = useQuery({
    queryKey: ["requisicao_decisores", req?.aprovada_por_user_id, req?.rejeitada_por_user_id],
    queryFn: async (): Promise<Record<string, string>> => {
      const ids = [req?.aprovada_por_user_id, req?.rejeitada_por_user_id].filter(Boolean) as string[];
      if (ids.length === 0) return {};
      const { data } = await (supabase as any).from("profiles").select("user_id, full_name").in("user_id", ids);
      const mapa: Record<string, string> = {};
      for (const p of data || []) mapa[p.user_id] = p.full_name;
      return mapa;
    },
    enabled: !!(req?.aprovada_por_user_id || req?.rejeitada_por_user_id),
  });

  // AJUSTE 1.2 — o reenvio PÓS-APROVAÇÃO é liberado também ao líder do CC da req
  // (a RPC R4 `registrar_envio_requisicao` autoriza requisitante, líder do CC e
  // admin). Sem isto, um líder sem `is_admin` não veria o botão da própria fila.
  // FASE 3 — a mesma resposta decide se as ações APROVAR/REJEITAR aparecem aqui,
  // então a consulta passa a valer também em 'pendente_aprovacao'. Lista positiva:
  // fora desses dois estados a resposta é irrelevante e o banco não é consultado.
  const { data: isLiderDoCC = false } = useQuery({
    queryKey: ["requisicao_lider_cc", req?.codigo_centro_ctrl, user?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("compras_lideres_cc")
        .select("id")
        .eq("codigo_centro_ctrl", req.codigo_centro_ctrl)
        .eq("lider_user_id", user!.id)
        .eq("ativo", true)
        .maybeSingle();
      return !!data;
    },
    enabled:
      !!user && !!req?.codigo_centro_ctrl && ["aprovada", "pendente_aprovacao"].includes(req?.status as string),
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
      // Itens podem ter sido persistidos AGORA: requisição descoberta no Alvo
      // (Job 4) vinha só com o cabeçalho, e o sync passou a gravar o
      // ItemReqCompChildList que já vinha no mesmo Load. Recarrega a lista para
      // os itens aparecerem sem precisar de F5.
      queryClient.invalidateQueries({ queryKey: ["requisicao_itens", id] });
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

  // ── OPEN-LOAD (L4/requisições) ──────────────────────────────────────────
  // Sincroniza ao ABRIR o card, para qualquer requisição que exista no ERP —
  // não só as 'sincronizada' (antes era essa a única condição, então requisição
  // JÁ CONVERTIDA em pedido nunca era carregada, e é justamente onde faltavam
  // itens).
  //
  // FASE 3 — a condição era uma NEGAÇÃO (`!== 'rascunho' && !== 'pendente_envio'`),
  // que admitia por omissão todo status novo. Os estados do gate
  // (pendente_aprovacao/aprovada/rejeitada) não existem no Alvo e não podem ser
  // consultados lá; só não quebravam por acidente, porque não têm `numero_alvo`.
  // Agora a lista é positiva: consulta o ERP apenas quem realmente vive lá.
  useEffect(() => {
    if (req?.numero_alvo && STATUS_QUE_EXISTEM_NO_ERP.includes(req.status)) {
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
    } catch {
      return d;
    }
  };

  const formatDateShort = (d: string | null | undefined) => {
    if (!d) return "—";
    try {
      const date = new Date(d + (d.length === 10 ? "T12:00:00" : ""));
      if (isNaN(date.getTime())) return d;
      return format(date, "dd/MM/yyyy", { locale: ptBR });
    } catch {
      return d;
    }
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
  // Requisição aprovada cujo envio ao Alvo falhou também pode ser reenviada — por um
  // caminho próprio (registrar_envio_requisicao), que não rebaixa a req a rascunho.
  const aguardandoReenvioPosAprovacao = req.status === "aprovada" && !!req.erro_ultimo_envio;

  // Condição de STATUS do bloco Editar / Reenviar / Excluir — a de sempre.
  // O gate de permissão do AJUSTE 1.2 vale só para o botão Reenviar: Editar e
  // Excluir seguem como estavam (Excluir tem permissão própria, fora deste escopo).
  const statusPermiteAcoesDeRascunho =
    req.status === "rascunho" || req.status === "pendente_envio" || aguardandoReenvioPosAprovacao;

  // AJUSTE 1.2 §4 — quem pode reenviar ESTA requisição (decisão B1: cada um cuida da
  // própria; sem ramo de exceção para view_all). Botão escondido, nunca desabilitado.
  const isRequisitante = !!user && req.requisitante_user_id === user.id;
  const podeReenviar = aguardandoReenvioPosAprovacao
    ? // Pós-aprovação: mesma autorização que a RPC R4 aplica no servidor.
      isAdmin || isRequisitante || isLiderDoCC
    : // Rascunho / pendente de envio: dono da req + permissão de reenvio.
      statusPermiteAcoesDeRascunho && (isAdmin || (isRequisitante && podeReenviarOwn));

  // ── E.9: Gerar Pedido a partir desta requisição ──────────
  // Aparece se: requisição foi enviada com sucesso ao Alvo (sincronizada),
  // e ainda NÃO tem pedido vinculado (numero_pedido_compra_alvo é null).
  // (o hook `podeCriarPedido` vive no topo do componente — ver C5.1)
  const podeGerarPedido = podeCriarPedido && req.status === "sincronizada" && !req.numero_pedido_compra_alvo;

  // ── FASE 3: decisão do líder ──────────────────────────────
  // Mesma autorização da fila: a RPC valida de novo no servidor (permissão +
  // escopo do CC), então isto é gate de UI, não a trava.
  const aguardandoDecisao = req.status === "pendente_aprovacao";
  const podeDecidir = aguardandoDecisao && podeAprovar && (isAdmin || isLiderDoCC);

  const handleGerarPedido = () => {
    navigate(`/suprimentos/pedidos/novo?reqId=${req.id}`);
  };

  const handleVerPedidoVinculado = async () => {
    if (!req.numero_pedido_compra_alvo) return;
    // Busca o id do pedido vinculado pelo numero_alvo
    const { data: ped } = await (supabase as any)
      .from("compras_pedidos")
      .select("id")
      .eq("numero", req.numero_pedido_compra_alvo)
      .maybeSingle();
    if (ped?.id) {
      navigate(`/suprimentos/pedidos/${ped.id}`);
    } else {
      // Pedido pode ainda não ter sido sincronizado pelo cron
      toast({
        title: "Pedido ainda não disponível",
        description: `Pedido ${req.numero_pedido_compra_alvo} ainda não foi sincronizado para o Hub. Aguarde o próximo ciclo do cron.`,
      });
    }
  };

  const handleReenviar = async () => {
    if (!user) return;
    setIsReenviando(true);
    try {
      // Requisição em rascunho volta a passar pelo gate (AJUSTE 1.2): o reenvio pode
      // agora terminar SEM envio ao ERP — daí as quatro saídas tratadas abaixo.
      const result: EnvioResult & { rota?: RotaSubmissao | null } = aguardandoReenvioPosAprovacao
        ? await reenviarRequisicaoAprovada(req.id, user.id, profile?.full_name || "Usuário")
        : await reenviarRequisicao(req.id, user.id, profile?.full_name || "Usuário");

      if (result.rota === "PENDENTE") {
        // Sucesso, mas nada foi ao ERP. Sem esta mensagem, a req "some" da lista de
        // rascunhos e parece perdida.
        toast({
          title: "Enviada para aprovação do líder",
          description:
            "O centro de custo desta requisição exige aprovação. Nada foi enviado ao ERP — a requisição aguarda a decisão do líder.",
        });
      } else if (result.sucesso) {
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

  const invalidarFilaDeAprovacoes = () => {
    queryClient.invalidateQueries({ queryKey: ["aprovacoes_pendentes_count"] });
    queryClient.invalidateQueries({ queryKey: ["requisicoes_pendentes_aprovacao"] });
  };

  /**
   * APROVAR em 2 tempos: a decisão é gravada pela RPC e, só então, o envio ao ERP
   * acontece nesta sessão (a do líder). Se o envio falhar, a aprovação permanece —
   * o conserto é o botão Reenviar, sem nova decisão.
   */
  const handleAprovar = async () => {
    if (!user) return;
    setDecisaoEmCurso("aprovando");
    try {
      const decisao = await aprovarRequisicao(req.id);
      if (!decisao.ok) {
        toast({ title: "Não foi possível aprovar", description: decisao.mensagem, variant: "destructive" });
        if (decisao.jaDecidida) {
          refetch();
          invalidarFilaDeAprovacoes();
        }
        return;
      }

      toast({ title: "Aprovada ✓", description: "Enviando ao ERP…" });
      setDecisaoEmCurso("enviando");

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
            description: `${envio.erro} — a aprovação foi preservada. Use "Reenviar" abaixo.`,
            variant: "destructive",
          });
        }
      } catch (errEnvio: any) {
        toast({
          title: "Aprovada, mas o envio ao ERP falhou",
          description: `${errEnvio?.message || errEnvio} — a aprovação foi preservada. Use "Reenviar" abaixo.`,
          variant: "destructive",
        });
      }
      refetch();
      invalidarFilaDeAprovacoes();
    } catch (err: any) {
      toast({ title: "Erro inesperado", description: err?.message || String(err), variant: "destructive" });
    } finally {
      setDecisaoEmCurso(null);
    }
  };

  const handleRejeitar = async () => {
    setDecisaoEmCurso("rejeitando");
    try {
      const decisao = await rejeitarRequisicao(req.id, motivoRejeicao.trim());
      if (!decisao.ok) {
        toast({ title: "Não foi possível rejeitar", description: decisao.mensagem, variant: "destructive" });
        if (decisao.jaDecidida) {
          refetch();
          invalidarFilaDeAprovacoes();
        }
        return;
      }
      toast({
        title: "Requisição rejeitada",
        description: "O requisitante verá o motivo. Ela não vai ao ERP.",
      });
      setModalRejeicaoAberto(false);
      setMotivoRejeicao("");
      refetch();
      invalidarFilaDeAprovacoes();
    } catch (err: any) {
      toast({ title: "Erro inesperado", description: err?.message || String(err), variant: "destructive" });
    } finally {
      setDecisaoEmCurso(null);
    }
  };

  /**
   * Clonar: abre o wizard PRÉ-PREENCHIDO com esta requisição. Nada é gravado aqui —
   * o rascunho novo nasce quando o usuário submeter, já como requisição dele.
   * É o caminho de reaproveitamento de uma rejeitada (estado terminal).
   */
  const handleClonar = () => {
    navigate(`/suprimentos/requisicoes/nova?clonarDe=${req.id}`);
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

  const handleBaixarArquivo = async (arq: ArquivoRequisicao) => {
    try {
      const url = await getUrlAssinadaArquivo(arq.storage_path);
      window.open(url, "_blank");
    } catch (err: any) {
      toast({
        title: "Erro ao baixar arquivo",
        description: err?.message || "Não foi possível gerar o link de download.",
        variant: "destructive",
      });
    }
  };

  const handleRemoverArquivo = async (arquivoId: string) => {
    setArquivoRemovendoId(arquivoId);
    try {
      await removerArquivo(arquivoId);
      toast({ title: "Arquivo removido" });
      refetchArquivos();
    } catch (err: any) {
      toast({
        title: "Erro ao remover arquivo",
        description: err?.message || "Não foi possível remover o arquivo.",
        variant: "destructive",
      });
    } finally {
      setArquivoRemovendoId(null);
    }
  };

  const formatarTamanhoArquivo = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getIconeMimeType = (mimeType: string) => {
    if (mimeType.startsWith("image/")) return ImageIcon;
    return FileText;
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
              {/* Badge informativo: já gerou pedido */}
              {req.numero_pedido_compra_alvo && (
                <Badge
                  variant="outline"
                  className="bg-purple-500/15 text-purple-600 border-purple-500/30 cursor-pointer hover:bg-purple-500/25"
                  onClick={handleVerPedidoVinculado}
                  title="Clique para ver o pedido"
                >
                  <ShoppingCart className="mr-1 h-3 w-3" />
                  Pedido {req.numero_pedido_compra_alvo}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Criada em {formatDate(req.created_at)} · Atualizada em {formatDate(req.updated_at)}
            </p>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap justify-end">
          {/* FASE 3: decisão do líder — ações primárias enquanto pendente */}
          {podeDecidir && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive shrink-0"
                onClick={() => {
                  setMotivoRejeicao("");
                  setModalRejeicaoAberto(true);
                }}
                disabled={!!decisaoEmCurso}
              >
                <Ban className="mr-1 h-3 w-3" /> Rejeitar
              </Button>
              <Button size="sm" className="shrink-0" onClick={handleAprovar} disabled={!!decisaoEmCurso}>
                {decisaoEmCurso === "aprovando" || decisaoEmCurso === "enviando" ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    {decisaoEmCurso === "enviando" ? "Enviando ao ERP…" : "Aprovando…"}
                  </>
                ) : (
                  <>
                    <Check className="mr-1 h-3 w-3" /> Aprovar
                  </>
                )}
              </Button>
            </>
          )}

          {/* FASE 3: Clonar — qualquer status, inclusive rejeitada (terminal) */}
          {podeCriarRequisicao && (
            <Button variant="outline" size="sm" onClick={handleClonar} className="shrink-0">
              <Copy className="mr-1 h-3 w-3" /> Clonar
            </Button>
          )}

          {/* E.9: Botão Gerar Pedido (destaque) */}
          {podeGerarPedido && (
            <Button size="sm" onClick={handleGerarPedido} className="bg-blue-600 hover:bg-blue-700 text-white shrink-0">
              <ShoppingCart className="mr-1 h-3 w-3" />
              Gerar Pedido
            </Button>
          )}

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

          {statusPermiteAcoesDeRascunho && (
            <>
              <Button variant="outline" size="sm" disabled>
                <Pencil className="mr-1 h-3 w-3" /> Editar
              </Button>
              {podeReenviar && (
                <Button variant="outline" size="sm" disabled={isReenviando} onClick={handleReenviar}>
                  {isReenviando ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-3 w-3" />
                  )}
                  {isReenviando ? "Reenviando..." : "Reenviar"}
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={isExcluindo}>
                    {isExcluindo ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="mr-1 h-3 w-3" />
                    )}
                    Excluir
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir requisição?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta ação é permanente. A requisição e todos os seus itens serão excluídos do Hub. Ela não será
                      excluída do ERP se já foi enviada.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleExcluir}>Excluir permanentemente</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}

          {req.status === "cancelada" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isExcluindo}>
                  {isExcluindo ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1 h-3 w-3" />
                  )}
                  Excluir
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir requisição cancelada?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta requisição está cancelada (ou foi deletada do ERP). A exclusão é permanente e remove todo o
                    histórico do Hub.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleExcluir}>Excluir permanentemente</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* ── FASE 3: estado do gate de aprovação ────────────────────────────── */}

      {/* Rejeitada — motivo em destaque, para todos que enxergam a req */}
      {req.status === "rejeitada" && (
        <Card className={isRequisitante ? "border-destructive/50 bg-destructive/5" : "border-border"}>
          <CardContent className="flex items-start gap-3 p-4">
            <Ban className={`mt-0.5 h-5 w-5 ${isRequisitante ? "text-destructive" : "text-muted-foreground"}`} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Requisição rejeitada pelo líder</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {req.motivo_rejeicao || "(sem motivo registrado)"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {(req.rejeitada_por_user_id && nomeDecisor[req.rejeitada_por_user_id]) || "Líder do centro de custo"}
                {req.rejeitada_em ? ` · ${formatDate(req.rejeitada_em)}` : ""}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                A rejeição é definitiva e esta requisição nunca foi enviada ao ERP. Para reaproveitar os itens, use
                <strong> Clonar</strong> — nasce uma requisição nova, sua.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Aprovada — quem decidiu e quando; automática é rotulada como tal */}
      {req.status === "aprovada" && (
        <Card className="border-border">
          <CardContent className="flex items-start gap-3 p-4">
            <UserCheck className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {req.aprovacao_automatica ? "Aprovação automática (líder do centro de custo)" : "Aprovada pelo líder"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {(req.aprovada_por_user_id && nomeDecisor[req.aprovada_por_user_id]) || "Líder do centro de custo"}
                {req.aprovada_em ? ` · ${formatDate(req.aprovada_em)}` : ""}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {req.aprovacao_automatica
                  ? "Quem criou a requisição lidera este centro de custo, então ela foi aprovada na própria submissão — o registro fica para auditoria."
                  : "A decisão está registrada e não se repete: se o envio ao ERP falhar, o reenvio não pede nova aprovação."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pendente — sem prometer notificação (não há e-mail nesta missão) */}
      {req.status === "pendente_aprovacao" && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <Clock className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Aguardando aprovação do líder</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Esta requisição <strong>ainda não foi enviada ao ERP</strong>. Ela depende da decisão do líder do centro
                de custo <strong>{req.centro_ctrl_nome || req.codigo_centro_ctrl || "—"}</strong> — quem responde pela
                aprovação é o centro de custo onerado, não a área de quem digitou.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                O sistema não envia aviso por e-mail: o líder vê a pendência na fila de Aprovações dele.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

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
              <p className="text-sm font-medium text-foreground">{formatDateShort(req.data_necessidade)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Finalidade</p>
              <p className="text-sm font-medium text-foreground">
                {req.finalidade_compra_label || req.codigo_finalidade_compra || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Descrição</p>
              <p className="text-sm font-medium text-foreground">{req.descricao || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">CNPJ de referência</p>
              <p
                className={`text-sm font-medium ${req.cnpj_sugestao_requisicao ? "text-foreground" : "text-muted-foreground"}`}
              >
                {req.cnpj_sugestao_requisicao ? applyCnpjMask(req.cnpj_sugestao_requisicao) : "Não informado"}
              </p>
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
              <p className="text-sm font-medium text-foreground">
                {req.funcionario_nome || "—"} ({req.codigo_funcionario})
              </p>
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
                {item.observacao && <p className="mt-2 text-xs italic text-muted-foreground">"{item.observacao}"</p>}
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

      {/* Anexos */}
      {arquivos.length > 0 && (
        <Card>
          <CardContent className="p-5">
            <p className="mb-3 text-sm font-semibold text-foreground flex items-center gap-2">
              <Paperclip className="h-4 w-4" />
              Anexos ({arquivos.length})
            </p>
            <div className="space-y-2">
              {arquivos.map((arq) => {
                const Icon = getIconeMimeType(arq.mime_type);
                const podeRemoverArq = req.status === "rascunho" || req.status === "pendente_envio";
                const removendo = arquivoRemovendoId === arq.id;
                return (
                  <div key={arq.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="rounded-md bg-muted p-2 shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{arq.nome_original}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatarTamanhoArquivo(arq.tamanho_bytes)}
                        {arq.numero_alvo_ao_enviar && <span className="ml-2 text-emerald-600">· Enviado ao ERP</span>}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => handleBaixarArquivo(arq)}
                      title="Baixar arquivo"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                    {podeRemoverArq && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => handleRemoverArquivo(arq.id)}
                        disabled={removendo}
                        title="Remover arquivo"
                      >
                        {removendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
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
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full ${evt.sucesso ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"}`}
                    >
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
                    {evt.mensagem_erro && <p className="mt-1 text-xs text-destructive">{evt.mensagem_erro}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* FASE 3 — rejeição: motivo obrigatório, decisão terminal */}
      <Dialog
        open={modalRejeicaoAberto}
        onOpenChange={(aberto) => {
          setModalRejeicaoAberto(aberto);
          if (!aberto) setMotivoRejeicao("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rejeitar requisição?</DialogTitle>
            <DialogDescription>
              A rejeição é definitiva: a requisição não vai ao ERP e não volta para pendente. O requisitante verá o
              motivo e poderá usar "Clonar" para criar uma nova.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Motivo da rejeição</label>
            <Textarea
              value={motivoRejeicao}
              onChange={(e) => setMotivoRejeicao(e.target.value)}
              placeholder="Explique o que precisa mudar para uma próxima requisição ser aprovada."
              rows={4}
            />
            <p
              className={`text-xs ${
                motivoRejeicao.trim().length >= MOTIVO_MINIMO ? "text-muted-foreground" : "text-destructive"
              }`}
            >
              {motivoRejeicao.trim().length}/{MOTIVO_MINIMO} caracteres mínimos
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalRejeicaoAberto(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejeitar}
              disabled={motivoRejeicao.trim().length < MOTIVO_MINIMO || decisaoEmCurso === "rejeitando"}
            >
              {decisaoEmCurso === "rejeitando" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Rejeitar requisição
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
