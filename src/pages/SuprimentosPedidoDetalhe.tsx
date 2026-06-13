import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  Building2,
  Package,
  Calendar,
  CreditCard,
  Paperclip,
  FileText,
  History,
  Download,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Truck,
  User as UserIcon,
  ShoppingCart,
  Home,
  Receipt,
  Link2,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { supabase } from "@/integrations/supabase/client";
import { carregarPedidoParaDetalhe, excluirPedido, getUrlAssinadaArquivoPedido } from "@/services/pedidosService";
import VincularRequisicaoCard from "@/components/VincularRequisicaoCard";
import { getStatusPedido } from "@/lib/statusPedido";
import { carregarDetalhesPedido } from "@/services/alvoPedCompLoadService";

// ════════════════════════════════════════════════════════════
// CONFIG DE EVENTOS DA AUDITORIA (mantido — usado no histórico)
// ════════════════════════════════════════════════════════════

const EVENTO_CONFIG: Record<string, { label: string; icon: any; className: string }> = {
  criado_hub: { label: "Criado no Hub", icon: ShoppingCart, className: "text-slate-600 dark:text-slate-400" },
  editado_hub: { label: "Editado no Hub", icon: Pencil, className: "text-blue-600 dark:text-blue-400" },
  envio_tentado: { label: "Envio tentado", icon: Loader2, className: "text-amber-600 dark:text-amber-400" },
  envio_sucesso: { label: "Enviado ao ERP", icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  envio_falha: { label: "Falha no envio", icon: XCircle, className: "text-red-600 dark:text-red-400" },
  excluido_hub: { label: "Excluído", icon: Trash2, className: "text-red-600 dark:text-red-400" },
  vinculado_requisicao: {
    label: "Vinculado à requisição",
    icon: Link2,
    className: "text-indigo-600 dark:text-indigo-400",
  },
  desvinculado_requisicao: {
    label: "Desvinculado da requisição",
    icon: Unlink,
    className: "text-slate-600 dark:text-slate-400",
  },
  vinculado_pedido: { label: "Vinculado ao pedido", icon: Link2, className: "text-indigo-600 dark:text-indigo-400" },
  desvinculado_pedido: {
    label: "Desvinculado do pedido",
    icon: Unlink,
    className: "text-slate-600 dark:text-slate-400",
  },
};

// ════════════════════════════════════════════════════════════
// FORMATADORES
// ════════════════════════════════════════════════════════════

function formatBRL(valor: number | null | undefined): string {
  if (valor == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);
}

function formatTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatData(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return "—";
  }
}

function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm:ss", { locale: ptBR });
  } catch {
    return "—";
  }
}

// ════════════════════════════════════════════════════════════
// COMPONENTE
// ════════════════════════════════════════════════════════════

export default function SuprimentosPedidoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  // RBAC: quem pode ver todos os pedidos × quem só vê os próprios (derivados das suas reqs)
  const podeVerTodos = useHasPermission(PERMISSIONS.COMPRAS_PEDIDOS_VIEW_ALL);

  const [showExcluirDialog, setShowExcluirDialog] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  // ── Query principal: detalhes do pedido ────────────────────
  const {
    data: pedido,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["pedido-detalhe", id, podeVerTodos, user?.id],
    queryFn: async () => {
      if (!id) throw new Error("ID do pedido não informado.");

      // Carga inicial — pega o pedido como está no banco
      let result = await carregarPedidoParaDetalhe(id);

      // Defesa em profundidade: se NÃO pode ver todos, valida que este pedido
      // é derivado de uma req criada pelo usuário atual.
      if (!podeVerTodos && user) {
        const { data: pedMeta } = await (supabase as any)
          .from("compras_pedidos")
          .select("numero_req_comp, codigo_empresa_filial_req_comp")
          .eq("id", id)
          .single();

        if (!pedMeta?.numero_req_comp) {
          throw new Error("Você não tem permissão para ver este pedido.");
        }

        const { data: req } = await (supabase as any)
          .from("compras_requisicoes")
          .select("requisitante_user_id")
          .eq("numero_alvo", pedMeta.numero_req_comp)
          .eq("codigo_empresa_filial", pedMeta.codigo_empresa_filial_req_comp)
          .maybeSingle();

        if (!req || req.requisitante_user_id !== user.id) {
          throw new Error("Você não tem permissão para ver este pedido.");
        }
      }

      // ⭐ NOVO: se pedido veio do Alvo sem detalhes carregados,
      // faz Load no Alvo agora e recarrega
      const { data: pedRaw } = await (supabase as any)
        .from("compras_pedidos")
        .select("detalhes_carregados, numero")
        .eq("id", id)
        .single();

      if (pedRaw && pedRaw.detalhes_carregados === false && pedRaw.numero) {
        try {
          await carregarDetalhesPedido(pedRaw.numero);
          // Recarrega pedido com os detalhes agora populados
          result = await carregarPedidoParaDetalhe(id);
        } catch (err: any) {
          // Não fatal — mostra o que tem (cabeçalho + valor_total) e segue
          console.error("[pedido-detalhe] Falha ao carregar detalhes do Alvo:", err);
        }
      }
      return result;
    },

    enabled: !!id,
    retry: false,
  });

  // ── Query secundária: auditoria ────────────────────────────
  const { data: auditoria } = useQuery({
    queryKey: ["pedido-auditoria", id],
    queryFn: async () => {
      if (!id) return [];
      const { data, error } = await (supabase as any)
        .from("compras_pedidos_auditoria")
        .select("evento, sucesso, mensagem_erro, user_nome, created_at")
        .eq("pedido_id", id)
        .order("created_at", { ascending: true });
      if (error) {
        console.error("Erro ao buscar auditoria:", error);
        return [];
      }
      return data || [];
    },
    enabled: !!id,
  });

  // ── Query terciária: dados extras do cabeçalho (status Alvo, criado_no_hub, status_aprovacao, etc) ──
  const { data: pedidoMeta } = useQuery({
    queryKey: ["pedido-meta", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await (supabase as any)
        .from("compras_pedidos")
        .select(
          "numero, status, status_local, status_aprovacao, enviou_aprovacao, aprovado, comprado, proximo_aprovador, criado_no_hub, codigo_usuario, numero_req_comp, valor_total, valor_mercadoria, valor_servico, valor_frete, valor_desconto, valor_outras_despesas, valor_ipi, data_cadastro, enviado_em, criado_por_nome, created_at, updated_at",
        )
        .eq("id", id)
        .single();
      if (error) {
        console.error("Erro ao buscar meta:", error);
        return null;
      }
      return data;
    },
    enabled: !!id,
  });

  // ── Handler de download de anexo ───────────────────────────
  async function handleDownloadAnexo(storagePath: string, nomeOriginal: string) {
    try {
      const url = await getUrlAssinadaArquivoPedido(storagePath);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeOriginal;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: any) {
      toast({
        title: "Erro ao baixar anexo",
        description: err?.message || "Tente novamente.",
        variant: "destructive",
      });
    }
  }

  // ── Handler de exclusão ────────────────────────────────────
  async function handleExcluir() {
    if (!id) return;
    setExcluindo(true);
    try {
      await excluirPedido(id);
      toast({
        title: "Pedido excluído",
        description: "O rascunho foi removido com sucesso.",
      });
      navigate("/suprimentos/pedidos");
    } catch (err: any) {
      toast({
        title: "Erro ao excluir pedido",
        description: err?.message || "Tente novamente.",
        variant: "destructive",
      });
      setExcluindo(false);
      setShowExcluirDialog(false);
    }
  }

  // ── Loading ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">Carregando pedido…</p>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────
  if (error || !pedido) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Button variant="ghost" onClick={() => navigate("/suprimentos/pedidos")} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="text-lg font-medium">Erro ao carregar pedido</p>
            <p className="text-sm text-muted-foreground">{(error as any)?.message || "Pedido não encontrado."}</p>
            <Button onClick={() => refetch()} variant="outline">
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Derivados ──────────────────────────────────────────────
  const isEditavel = pedido.status_local === "rascunho" || pedido.status_local === "erro_envio";
  const isExcluivel = pedido.status_local === "rascunho" || pedido.status_local === "erro_envio";

  // Status unificado: combina pedido + pedidoMeta pra captar todos os campos relevantes
  const pedidoComMeta = { ...pedido, ...(pedidoMeta || {}) };
  const statusVisual = getStatusPedido(pedidoComMeta);

  const numeroVisivel = pedido.numero?.startsWith("RASCUNHO-") ? `(rascunho)` : pedido.numero || "(rascunho)";

  // Valor total: usa valor_total do banco (que vem do Alvo via cron) como prioridade.
  // Pedidos de serviço criados no Alvo podem ter valor_total preenchido mas itens vazios — o reduce daria 0 incorretamente.
  // Fallback: cálculo a partir dos itens (pra pedidos criados no Hub que ainda não sincronizaram).
  const valorTotalCalculadoDosItens = pedido.itens?.reduce((s, it) => s + it.quantidade * it.valor_unitario, 0) || 0;
  const valorTotal = Number(pedidoMeta?.valor_total) || valorTotalCalculadoDosItens;

  // ── Composição do valor (mercadoria + serviço + frete + outras + IPI − desconto = total) ──
  // Mostra só componentes != 0. Linha "Outros ajustes" cobre qualquer diferença residual
  // (ex.: descontos de item não refletidos em ValorDescontoGeral), garantindo que a soma
  // exibida SEMPRE fecha no valor total.
  const num = (v: any): number => Number(v) || 0;
  const compMercadoria = num(pedidoMeta?.valor_mercadoria);
  const compServico = num(pedidoMeta?.valor_servico);
  const compFrete = num(pedidoMeta?.valor_frete);
  const compOutras = num(pedidoMeta?.valor_outras_despesas);
  const compIpi = num(pedidoMeta?.valor_ipi);
  const compDesconto = num(pedidoMeta?.valor_desconto);

  const somaComponentes = compMercadoria + compServico + compFrete + compOutras + compIpi - compDesconto;
  const ajusteResidual = valorTotal - somaComponentes;

  // Componentes "extras" além da mercadoria — definem se o card de composição é relevante
  const temComponentesExtras =
    compServico !== 0 ||
    compFrete !== 0 ||
    compOutras !== 0 ||
    compIpi !== 0 ||
    compDesconto !== 0 ||
    Math.abs(ajusteResidual) > 0.01;

  // Só exibe o card se houver valor_total e algum componente extra (senão é redundante com o resumo)
  const mostrarComposicao = valorTotal > 0 && temComponentesExtras;

  const linhasComposicao: { label: string; valor: number; sinal: "+" | "-" }[] = [];
  if (compMercadoria !== 0) linhasComposicao.push({ label: "Mercadoria", valor: compMercadoria, sinal: "+" });
  if (compServico !== 0) linhasComposicao.push({ label: "Serviço", valor: compServico, sinal: "+" });
  if (compFrete !== 0) linhasComposicao.push({ label: "Frete", valor: compFrete, sinal: "+" });
  if (compIpi !== 0) linhasComposicao.push({ label: "IPI", valor: compIpi, sinal: "+" });
  if (compOutras !== 0) linhasComposicao.push({ label: "Outras despesas", valor: compOutras, sinal: "+" });
  if (compDesconto !== 0) linhasComposicao.push({ label: "Desconto", valor: compDesconto, sinal: "-" });
  if (Math.abs(ajusteResidual) > 0.01)
    linhasComposicao.push({
      label: "Outros ajustes",
      valor: Math.abs(ajusteResidual),
      sinal: ajusteResidual >= 0 ? "+" : "-",
    });

  // Mostrar linha "Próximo aprovador" no detalhe quando o pedido tem aprovador definido
  // E está em estado relevante (em workflow OU já enviado pra aprovação OU pendente de envio).
  const mostrarProximoAprovador =
    !!pedidoComMeta.proximo_aprovador &&
    (pedidoComMeta.status_aprovacao === "Em Andamento" ||
      pedidoComMeta.status_aprovacao === "Reavaliar" ||
      (pedidoComMeta.status_aprovacao === "Nenhum" && pedidoComMeta.status === "Aberto"));

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="container mx-auto max-w-5xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <Button variant="ghost" onClick={() => navigate("/suprimentos/pedidos")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        <div className="flex items-center gap-2">
          {isEditavel && (
            <Button variant="outline" onClick={() => navigate(`/suprimentos/pedidos/novo?pedidoId=${id}`)}>
              <Pencil className="mr-2 h-4 w-4" />
              {pedido.status_local === "erro_envio" ? "Editar e reenviar" : "Editar"}
            </Button>
          )}
          {isExcluivel && (
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setShowExcluirDialog(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Excluir
            </Button>
          )}
        </div>
      </div>

      {/* Título e status */}
      <div className="mb-6 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-foreground">Pedido {numeroVisivel}</h1>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className={`${statusVisual.className} flex items-center gap-1.5 cursor-help`}>
                  <statusVisual.Icon className={`h-3.5 w-3.5 ${statusVisual.iconAnimate ? "animate-spin" : ""}`} />
                  {statusVisual.label}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                {statusVisual.tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {pedidoComMeta.criado_no_hub && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Home className="h-4 w-4 text-purple-600 dark:text-purple-400 cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Criado no Hub
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Próximo aprovador — visível em estados relevantes (sem precisar de hover) */}
        {mostrarProximoAprovador && (
          <p className="text-sm text-muted-foreground">
            Próximo aprovador: <span className="font-medium text-foreground">{pedidoComMeta.proximo_aprovador}</span>
          </p>
        )}

        {/* Banner de erro */}
        {pedido.status_local === "erro_envio" && pedido.erro_envio?.message && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Erro no último envio</p>
              <p className="mt-1 text-sm text-destructive/90">{pedido.erro_envio.message}</p>
              {pedido.erro_envio.timestamp && (
                <p className="mt-1 text-xs text-destructive/70">{formatDataHora(pedido.erro_envio.timestamp)}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Requisição de origem — vincular/desvincular */}
      <VincularRequisicaoCard pedidoId={id!} numeroReqVinculada={pedido.origem_numero_req_alvo} onChange={refetch} />

      {/* Resumo financeiro */}
      <Card className="mb-6 border-2">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Valor total do pedido</p>
              <p className="mt-1 text-3xl font-bold text-emerald-600 dark:text-emerald-400">{formatBRL(valorTotal)}</p>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              {pedidoMeta?.codigo_usuario && (
                <p className="flex items-center justify-end gap-1">
                  <UserIcon className="h-3 w-3" />
                  {pedidoMeta.codigo_usuario}
                </p>
              )}
              {pedidoMeta?.created_at && <p className="mt-1">Criado em {formatData(pedidoMeta.created_at)}</p>}
              {pedidoMeta?.enviado_em && <p className="mt-1">Enviado em {formatData(pedidoMeta.enviado_em)}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card: Composição do valor (só quando há componentes além da mercadoria) */}
      {mostrarComposicao && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-4 w-4" />
              Composição do valor
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {linhasComposicao.map((linha, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{linha.label}</span>
                  <span className="font-mono">
                    {linha.sinal === "-" ? "− " : ""}
                    {formatBRL(linha.valor)}
                  </span>
                </div>
              ))}
              <Separator className="my-2" />
              <div className="flex items-center justify-between font-semibold">
                <span>Total</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400">{formatBRL(valorTotal)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Card: Fornecedor e Pagamento */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            Fornecedor e Pagamento
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Fornecedor</p>
            <p className="mt-1 text-sm font-medium">{pedido.nome_entidade}</p>
            <p className="font-mono text-xs text-muted-foreground">{pedido.codigo_entidade}</p>
            {pedido.cnpj_entidade && (
              <p className="font-mono text-xs text-muted-foreground">CNPJ: {pedido.cnpj_entidade}</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Condição de pagamento</p>
            <p className="mt-1 text-sm font-medium">{pedido.nome_cond_pag}</p>
            <p className="font-mono text-xs text-muted-foreground">{pedido.codigo_cond_pag}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tipo de entrega</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
              <Truck className="h-3.5 w-3.5" />
              {pedido.tipo_entrega}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Card: Datas */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" />
            Datas
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Pedido</p>
            <p className="mt-1 text-sm font-medium">{formatData(pedido.data_pedido)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Entrega</p>
            <p className="mt-1 text-sm font-medium">{formatData(pedido.data_entrega)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Validade</p>
            <p className="mt-1 text-sm font-medium">{formatData(pedido.data_validade)}</p>
          </div>
        </CardContent>
      </Card>

      {/* Card: Itens */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4" />
            Itens ({pedido.itens.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pedido.itens.map((item, idx) => {
            const valorTotalItem = item.quantidade * item.valor_unitario;
            return (
              <div key={idx} className="rounded-lg border bg-muted/20 p-4">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {item.item_servico ? "Serviço" : "Produto"}
                      </Badge>
                      <span className="font-mono text-xs text-muted-foreground">{item.codigo_produto}</span>
                    </div>
                    <p className="mt-1 font-medium">{item.produto_nome}</p>
                    {item.observacao && (
                      <p className="mt-1 text-xs italic text-muted-foreground">"{item.observacao}"</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">
                      {item.quantidade} {item.codigo_prod_unid_med} × {formatBRL(item.valor_unitario)}
                    </p>
                    <p className="mt-1 text-base font-bold text-emerald-600 dark:text-emerald-400">
                      {formatBRL(valorTotalItem)}
                    </p>
                  </div>
                </div>

                {/* Rateio */}
                {item.rateio.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Rateio do item</p>
                    {item.rateio.map((cls, clsIdx) => {
                      const valorClasse = (valorTotalItem * cls.percentual) / 100;
                      return (
                        <div key={clsIdx} className="rounded border bg-background p-2.5 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-medium">
                              {cls.codigo_classe_rec_desp}
                              {cls.classe_rec_desp_label && (
                                <span className="ml-1 font-sans font-normal text-muted-foreground">
                                  — {cls.classe_rec_desp_label}
                                </span>
                              )}
                            </span>
                            <span className="font-medium">
                              {cls.percentual.toFixed(2)}% ({formatBRL(valorClasse)})
                            </span>
                          </div>
                          {cls.ccs.length > 0 && (
                            <div className="mt-1.5 space-y-1 border-l-2 border-muted pl-3">
                              {cls.ccs.map((cc, ccIdx) => {
                                const valorCC = (valorClasse * cc.percentual) / 100;
                                return (
                                  <div key={ccIdx} className="flex items-center justify-between text-muted-foreground">
                                    <span className="font-mono">
                                      {cc.codigo_centro_ctrl}
                                      {cc.centro_ctrl_label && (
                                        <span className="ml-1 font-sans">— {cc.centro_ctrl_label}</span>
                                      )}
                                    </span>
                                    <span>
                                      {cc.percentual.toFixed(2)}% ({formatBRL(valorCC)})
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Card: Parcelas */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4" />
            Parcelas ({pedido.parcelas.length}) — Total: {formatBRL(valorTotal)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-4">Nº</th>
                  <th className="py-2 pr-4">Vencimento</th>
                  <th className="py-2 pr-4 text-right">Valor</th>
                  <th className="py-2 text-right">Dias entre</th>
                </tr>
              </thead>
              <tbody>
                {pedido.parcelas.map((p, idx) => (
                  <tr key={idx} className="border-b last:border-b-0">
                    <td className="py-2 pr-4 font-mono">{p.sequencia}</td>
                    <td className="py-2 pr-4">{formatData(p.data_vencimento)}</td>
                    <td className="py-2 pr-4 text-right font-mono">{formatBRL(p.valor_parcela)}</td>
                    <td className="py-2 text-right font-mono">{p.dias_entre_parcelas || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Card: Anexos */}
      {pedido.arquivos_existentes.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Paperclip className="h-4 w-4" />
              Anexos ({pedido.arquivos_existentes.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pedido.arquivos_existentes.map((arq) => (
              <div key={arq.id} className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{arq.nome_original}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTamanho(arq.tamanho_bytes)} · {arq.mime_type}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDownloadAnexo(arq.storage_path, arq.nome_original)}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Baixar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Card: Observações */}
      {(pedido.texto_livre_existente || pedido.texto_historico_existente) && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Observações
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {pedido.texto_livre_existente && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Texto / observação livre</p>
                <p className="whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-sm">{pedido.texto_livre_existente}</p>
              </div>
            )}
            {pedido.texto_historico_existente && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Texto histórico / observação interna</p>
                <p className="whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-sm">
                  {pedido.texto_historico_existente}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Card: Histórico / Auditoria */}
      {auditoria && auditoria.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              Histórico de eventos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-3 border-l border-muted pl-6">
              {auditoria.map((ev: any, idx: number) => {
                const cfg = EVENTO_CONFIG[ev.evento] || {
                  label: ev.evento,
                  icon: AlertCircle,
                  className: "text-muted-foreground",
                };
                const Icon = cfg.icon;
                return (
                  <li key={idx} className="relative">
                    <span
                      className={`absolute -left-[1.85rem] flex h-5 w-5 items-center justify-center rounded-full border bg-background ${cfg.className}`}
                    >
                      <Icon className="h-3 w-3" />
                    </span>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className={`text-sm font-medium ${cfg.className}`}>{cfg.label}</span>
                      <span className="text-xs text-muted-foreground">{formatDataHora(ev.created_at)}</span>
                    </div>
                    {ev.user_nome && <p className="text-xs text-muted-foreground">por {ev.user_nome}</p>}
                    {ev.mensagem_erro && <p className="mt-1 text-xs text-destructive">{ev.mensagem_erro}</p>}
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Dialog de confirmação de exclusão */}
      <AlertDialog open={showExcluirDialog} onOpenChange={setShowExcluirDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O pedido <strong>{numeroVisivel}</strong> (rascunho) e todos os seus
              itens, parcelas, anexos e histórico serão permanentemente removidos.
              <br />
              <br />
              <strong>Esta exclusão acontece apenas no Hub.</strong> Como esse pedido nunca foi enviado ao ERP, não há
              nada para reverter lá.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleExcluir}
              disabled={excluindo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {excluindo ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Excluindo…
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Sim, excluir
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Separator className="my-8" />

      <div className="flex justify-start">
        <Button variant="ghost" onClick={() => navigate("/suprimentos/pedidos")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar para lista
        </Button>
      </div>
    </div>
  );
}
