import { LucideIcon } from "lucide-react";
import { FileText, Clock, CheckCircle2, XCircle, Package, HelpCircle } from "lucide-react";

/**
 * Estado visual unificado da requisição.
 * Reqs têm UMA dimensão de status (mais simples que Pedidos).
 */
export interface StatusRequisicaoVisual {
  label: string;
  Icon: LucideIcon;
  className: string;
  tooltip: string;
}

export function getStatusRequisicao(req: any): StatusRequisicaoVisual {
  const status = req?.status as string | undefined;
  const erroUltimoEnvio = req?.erro_ultimo_envio as string | undefined;

  if (status === "rascunho") {
    return {
      label: "Rascunho",
      Icon: FileText,
      className: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
      tooltip: erroUltimoEnvio
        ? `Rascunho após falha: ${erroUltimoEnvio}`
        : "Requisição em rascunho — ainda não foi enviada ao ERP",
    };
  }

  if (status === "pendente_envio") {
    return {
      label: "Pendente de envio",
      Icon: Clock,
      className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
      tooltip: "Aguardando envio ao ERP",
    };
  }

  if (status === "sincronizada") {
    return {
      label: "Enviada ao ERP",
      Icon: CheckCircle2,
      className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
      tooltip: "Requisição enviada com sucesso ao ERP — aguardando virar pedido",
    };
  }

  if (status === "cancelada") {
    return {
      label: "Cancelada",
      Icon: XCircle,
      className: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
      tooltip: "Requisição cancelada",
    };
  }

  if (status === "convertida_pedido") {
    return {
      label: "Convertida em Pedido",
      Icon: Package,
      className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
      tooltip: req?.numero_pedido_compra_alvo
        ? `Convertida no Pedido nº ${req.numero_pedido_compra_alvo}`
        : "Requisição já virou Pedido de Compra",
    };
  }

  // Fallback
  return {
    label: status || "Desconhecido",
    Icon: HelpCircle,
    className: "bg-slate-400/15 text-slate-600 dark:text-slate-400 border-slate-400/30",
    tooltip: `Status desconhecido: "${status}"`,
  };
}
