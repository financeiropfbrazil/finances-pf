import { LucideIcon } from "lucide-react";
import { FileText, Clock, CheckCircle2, XCircle, Package, HelpCircle, UserCheck, Ban } from "lucide-react";

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

/**
 * FASE 3 — status em que "já virou pedido" pode ter prioridade sobre o próprio
 * status. Lista POSITIVA de propósito: a versão anterior perguntava
 * `status !== 'cancelada'`, e uma negação deixa passar todo status novo — os
 * estados do gate de aprovação cairiam aqui se um dia tivessem
 * `numero_pedido_compra_alvo`, e a requisição apareceria como "Convertida em
 * Pedido" sem nunca ter ido ao ERP.
 */
const STATUS_QUE_ACEITAM_PEDIDO: string[] = ["sincronizada", "convertida_pedido"];

export function getStatusRequisicao(req: any): StatusRequisicaoVisual {
  const status = req?.status as string | undefined;
  const erroUltimoEnvio = req?.erro_ultimo_envio as string | undefined;
  // ⭐ Convertida em pedido tem prioridade sobre "sincronizada":
  // se a req tem numero_pedido_compra_alvo, ela já virou pedido.
  if (req?.numero_pedido_compra_alvo && status && STATUS_QUE_ACEITAM_PEDIDO.includes(status)) {
    return {
      label: "Convertida em Pedido",
      Icon: Package,
      className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
      tooltip: `Convertida no Pedido nº ${req.numero_pedido_compra_alvo}`,
    };
  }

  // ── Estados do gate de aprovação do líder (Fases 1–3) ──────────────────
  // ⚠️ "aprovação do líder (requisição)" ≠ "aprovação do pedido (Alvo)".
  if (status === "pendente_aprovacao") {
    return {
      label: "Pendente aprovação",
      Icon: Clock,
      className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
      tooltip: "Aguardando a decisão do líder do centro de custo — ainda não foi ao ERP",
    };
  }

  if (status === "aprovada") {
    // A exceção é o erro de envio: aprovada e presa fora do ERP pede cor forte.
    if (erroUltimoEnvio) {
      return {
        label: "Aprovada — erro no envio",
        Icon: XCircle,
        className: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
        tooltip: `Aprovada pelo líder, mas o envio ao ERP falhou: ${erroUltimoEnvio}`,
      };
    }
    return {
      label: "Aprovada — enviando",
      Icon: UserCheck,
      className: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
      tooltip: "Aprovada pelo líder do centro de custo, a caminho do ERP",
    };
  }

  if (status === "rejeitada") {
    return {
      label: "Rejeitada",
      Icon: Ban,
      className: "bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30",
      tooltip: req?.motivo_rejeicao
        ? `Rejeitada pelo líder: ${req.motivo_rejeicao}`
        : "Rejeitada pelo líder do centro de custo — nunca foi ao ERP",
    };
  }

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
      label: "Aguardando Pedido",
      Icon: CheckCircle2,
      className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
      tooltip: "Requisição no ERP, aguardando ser convertida em pedido de compra",
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
