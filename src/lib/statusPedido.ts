import { LucideIcon } from "lucide-react";
import { FileText, Loader2, AlertTriangle, Clock, CheckCircle2, Flag, Pause, XCircle, HelpCircle } from "lucide-react";

/**
 * Unifica as 3 dimensões de status do pedido (status_local + status do Alvo + status_aprovacao)
 * em UM único estado conceitual que o usuário entende.
 *
 * Retorna label curta + ícone + classes Tailwind + tooltip explicativo.
 */
export interface StatusPedidoVisual {
  label: string;
  Icon: LucideIcon;
  iconAnimate?: boolean; // true pra Loader spinning
  className: string; // classes pra <Badge>
  tooltip: string;
}

export function getStatusPedido(ped: any): StatusPedidoVisual {
  const statusLocal = ped?.status_local as string | undefined;
  const statusAlvo = ped?.status as string | undefined;
  const statusAprovacao = ped?.status_aprovacao as string | undefined;
  const aprovado = ped?.aprovado as string | undefined;
  const comprado = ped?.comprado as string | undefined;
  const proximoAprovador = ped?.proximo_aprovador as string | undefined;

  // ─── 1. Estados puramente do Hub (status_local) ───────────────────────────
  if (statusLocal === "rascunho") {
    return {
      label: "Rascunho",
      Icon: FileText,
      className: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
      tooltip: "Pedido em rascunho — ainda não foi enviado ao ERP",
    };
  }

  if (statusLocal === "enviando") {
    return {
      label: "Enviando…",
      Icon: Loader2,
      iconAnimate: true,
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
      tooltip: "Enviando ao ERP — aguarde alguns segundos",
    };
  }

  if (statusLocal === "erro_envio") {
    const errMsg = ped?.erro_envio?.message;
    return {
      label: "Erro no envio",
      Icon: AlertTriangle,
      className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
      tooltip: errMsg ? `Falhou ao enviar: ${errMsg}` : "Falhou ao enviar ao ERP — clique pra reenviar",
    };
  }

  // ─── 2. Estados quando já está no Alvo (status_local em [enviado_alvo, sincronizado]) ───
  // Cancelado é terminal — vem primeiro
  if (statusAlvo === "Cancelado") {
    return {
      label: "Cancelado",
      Icon: XCircle,
      className: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
      tooltip: "Pedido cancelado no ERP",
    };
  }

  // Encerrado / comprado=Sim → concluído
  if (statusAlvo === "Encerrado" || comprado === "Sim") {
    return {
      label: "Concluído",
      Icon: Flag,
      className: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/30",
      tooltip: comprado === "Sim" ? "Pedido concluído — compra realizada" : "Pedido encerrado no ERP",
    };
  }

  // Pendente no ERP (status próprio do Alvo, raro mas existe)
  if (statusAlvo === "Pendente") {
    return {
      label: "Pendente no ERP",
      Icon: Pause,
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
      tooltip: "Pedido pendente no ERP — verifique no Alvo",
    };
  }

  // Aberto: precisa olhar o status_aprovacao pra refinar
  if (statusAlvo === "Aberto") {
    if (statusAprovacao === "Finalizada" && aprovado === "Total") {
      return {
        label: "Aprovado",
        Icon: CheckCircle2,
        className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
        tooltip: "Pedido aprovado, aguardando execução da compra",
      };
    }

    if (statusAprovacao === "Em Andamento" || statusAprovacao === "Reavaliar") {
      return {
        label: "Aguardando aprovação",
        Icon: Clock,
        className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
        tooltip: proximoAprovador ? `Aguardando aprovação de ${proximoAprovador}` : "Aguardando aprovação no ERP",
      };
    }

    // Aberto sem fluxo de aprovação definido (status_aprovacao = "Nenhum" ou null)
    return {
      label: "Em análise",
      Icon: Clock,
      className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
      tooltip: "Pedido aberto no ERP — em processamento",
    };
  }

  // ─── 3. Fallback: status_local sincronizado/enviado mas status do Alvo desconhecido ──
  if (statusLocal === "sincronizado" || statusLocal === "enviado_alvo") {
    return {
      label: statusAlvo || "Enviado ao ERP",
      Icon: HelpCircle,
      className: "bg-slate-400/15 text-slate-600 dark:text-slate-400 border-slate-400/30",
      tooltip: `Status no ERP: "${statusAlvo || "indefinido"}" (mapeamento desconhecido)`,
    };
  }

  // ─── 4. Fallback geral ────────────────────────────────────────────────────
  return {
    label: statusLocal || "Desconhecido",
    Icon: HelpCircle,
    className: "bg-slate-400/15 text-slate-600 dark:text-slate-400 border-slate-400/30",
    tooltip: `Estado desconhecido (status_local="${statusLocal}", status="${statusAlvo}")`,
  };
}
