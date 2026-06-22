// ============================================================================
// src/lib/statusConfig.ts
// Fonte ÚNICA de verdade para a aparência de status de requisição/pedido.
//
// Substitui os STATUS_MAP / STATUS_CONFIG duplicados (estavam copiados em
// SuprimentosRequisicaoDetalhe.tsx, ProjetoRequisicoes.tsx e lib/statusRequisicao.ts
// com cores hardcoded emerald-600 / red-600 / blue-600 — o que impedia o re-tema).
//
// Princípio do design travado:
//   - ROTINA fica quieta (tint baixo, low chroma)
//   - EXCEÇÃO salta (cancelada / erro em danger, com peso)
// Todas as cores vêm de tokens (success/warning/danger/info), então respondem
// automaticamente a light/dark.
// ============================================================================

import { CheckCircle2, Clock, XCircle, AlertTriangle, ShoppingCart, FileText, type LucideIcon } from "lucide-react";

export type StatusTone = "routine" | "exception" | "neutral";

export interface StatusVisual {
  label: string;
  tone: StatusTone;
  /** className completo do Badge (bg + text + border via tokens) */
  className: string;
  /** cor só do "dot" — para quem quiser a versão dot + texto quieto */
  dotClass: string;
  Icon: LucideIcon;
  tooltip: string;
}

// Tints reutilizáveis (low chroma para rotina, mais peso para exceção)
const ROUTINE = (sem: string) => `bg-${sem}/10 text-${sem} border-${sem}/20`;
const EXCEPTION = (sem: string) => `bg-${sem}/15 text-${sem} border-${sem}/40 font-medium`;

export const REQUISICAO_STATUS: Record<string, StatusVisual> = {
  rascunho: {
    label: "Rascunho (erro)",
    tone: "exception",
    className: EXCEPTION("danger"),
    dotClass: "bg-danger",
    Icon: AlertTriangle,
    tooltip: "Falha ao enviar ao ERP. A requisição ficou salva como rascunho.",
  },
  pendente_envio: {
    label: "Pendente de envio",
    tone: "routine",
    className: ROUTINE("warning"),
    dotClass: "bg-warning",
    Icon: Clock,
    tooltip: "Aguardando envio ao ERP.",
  },
  sincronizada: {
    label: "Aguardando Pedido",
    tone: "routine",
    className: ROUTINE("success"),
    dotClass: "bg-success",
    Icon: CheckCircle2,
    tooltip: "Enviada ao ERP. Aguardando geração do pedido de compra.",
  },
  convertida_pedido: {
    label: "Convertida em Pedido",
    tone: "routine",
    className: ROUTINE("info"),
    dotClass: "bg-info",
    Icon: ShoppingCart,
    tooltip: "Já gerou um pedido de compra vinculado.",
  },
  cancelada: {
    label: "Cancelada",
    tone: "exception",
    className: EXCEPTION("danger"),
    dotClass: "bg-danger",
    Icon: XCircle,
    tooltip: "Cancelada (ou removida do ERP).",
  },
};

const FALLBACK: StatusVisual = {
  label: "—",
  tone: "neutral",
  className: "bg-muted text-muted-foreground border-border",
  dotClass: "bg-muted-foreground",
  Icon: FileText,
  tooltip: "Status desconhecido.",
};

/**
 * Resolve o status visual de uma requisição.
 * Mantém a regra derivada existente: se tem numero_pedido_compra_alvo,
 * o estado efetivo é "convertida_pedido", independentemente do status bruto.
 */
export function getStatusRequisicao(req: {
  status?: string | null;
  numero_pedido_compra_alvo?: string | null;
}): StatusVisual {
  if (req?.numero_pedido_compra_alvo) return REQUISICAO_STATUS.convertida_pedido;
  const key = req?.status ?? "";
  return REQUISICAO_STATUS[key] ?? FALLBACK;
}

// ── Tags de tipo de documento (NFS-e / NF-e / IA) ──────────────────────────
// Substituem os bg-purple-100 text-purple-800 hardcoded do email-nfe.
export const DOCTYPE_TAG: Record<string, string> = {
  nfse: "bg-violet/12 text-violet border-violet/25",
  nfe: "bg-info/12 text-info border-info/25",
  ai: "bg-violet/12 text-violet border-violet/25",
};
