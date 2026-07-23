import { LucideIcon } from "lucide-react";
import { FileText, CircleDot, Loader2, PackageCheck, CheckCircle2, XCircle, HelpCircle } from "lucide-react";

/**
 * STATUS DA ORDEM DE PRODUÇÃO — fonte única da UI (badge + filtro + chips).
 *
 * `op_ordens.status` é um enum de texto com 6 estados (CHECK no banco). Aqui
 * mapeamos cada um para rótulo + ícone + classes de badge, no padrão sóbrio do
 * Hub (paleta dessaturada, light+dark, sem gradiente/glow). Espelha o formato
 * de `statusPedido.ts`. Nunca derive status por conta própria em outra tela —
 * consuma esta função.
 */

export type StatusOPKey = "RASCUNHO" | "ABERTA" | "EM_ANDAMENTO" | "EM_FECHAMENTO" | "FECHADA" | "CANCELADA";

export interface StatusOPVisual {
  key: StatusOPKey | "DESCONHECIDO";
  label: string;
  Icon: LucideIcon;
  iconAnimate?: boolean;
  className: string;
  tooltip: string;
}

const CONFIG: Record<StatusOPKey, StatusOPVisual> = {
  RASCUNHO: {
    key: "RASCUNHO",
    label: "Rascunho",
    Icon: FileText,
    className: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
    tooltip: "OP em rascunho — ainda não foi aberta.",
  },
  ABERTA: {
    key: "ABERTA",
    label: "Aberta",
    Icon: CircleDot,
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
    tooltip: "OP aberta, aguardando início da produção.",
  },
  EM_ANDAMENTO: {
    key: "EM_ANDAMENTO",
    label: "Em andamento",
    Icon: Loader2,
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    tooltip: "Produção em andamento.",
  },
  EM_FECHAMENTO: {
    key: "EM_FECHAMENTO",
    label: "Em fechamento",
    Icon: PackageCheck,
    className: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30",
    tooltip: "OP em processo de fechamento.",
  },
  FECHADA: {
    key: "FECHADA",
    label: "Fechada",
    Icon: CheckCircle2,
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    tooltip: "OP fechada.",
  },
  CANCELADA: {
    key: "CANCELADA",
    label: "Cancelada",
    Icon: XCircle,
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
    tooltip: "OP cancelada.",
  },
};

export function getStatusOP(status: string | null | undefined): StatusOPVisual {
  const s = (status || "").toUpperCase() as StatusOPKey;
  return (
    CONFIG[s] || {
      key: "DESCONHECIDO",
      label: status || "Desconhecido",
      Icon: HelpCircle,
      className: "bg-slate-400/15 text-slate-600 dark:text-slate-400 border-slate-400/30",
      tooltip: `Status não mapeado: "${status}".`,
    }
  );
}

/** Ordem operacional (do início ao fim do ciclo) — usada nos chips e no filtro. */
export const STATUS_OP_ORDER: StatusOPKey[] = [
  "RASCUNHO",
  "ABERTA",
  "EM_ANDAMENTO",
  "EM_FECHAMENTO",
  "FECHADA",
  "CANCELADA",
];

export const STATUS_OP_FILTER_OPTIONS: { value: StatusOPKey; label: string }[] = STATUS_OP_ORDER.map((k) => ({
  value: k,
  label: CONFIG[k].label,
}));
