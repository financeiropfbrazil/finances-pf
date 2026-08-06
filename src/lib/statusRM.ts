import { LucideIcon } from "lucide-react";
import { CircleDot, PieChart, CheckCircle2, HelpCircle } from "lucide-react";

/**
 * STATUS DA REQUISIÇÃO DE MATERIAL (RM) — fonte única da UI.
 *
 * Ao contrário do `statusOP.ts`, aqui o domínio NÃO é nosso: os literais vêm do
 * Alvo, espelhados em `op_reqmat.status` pelo `sync-reqmat`. Confirmados em
 * campo sobre o universo de 2026 (n=680): "Aberta", "Atendida Parcial",
 * "Atendida Total" — exatamente três, e o terminal ('Atendida Total') é o mesmo
 * literal que a coluna gerada `precisa_releitura` usa no banco (§10.15).
 *
 * ⚠ Por serem literais do ERP, chegam COM espaço e acento. Nunca normalizar
 * para maiúsculas nem para snake_case: o valor exibido tem de ser rastreável
 * até o que está gravado. Status fora do conjunto cai no fallback visível
 * "não mapeado" — barulho de propósito, para aparecer no dia em que o Alvo
 * introduzir um quarto valor (foi assim que o REC-1.5 descobriu divergência).
 */

export type StatusRMKey = "Aberta" | "Atendida Parcial" | "Atendida Total";

export interface StatusRMVisual {
  key: StatusRMKey | "DESCONHECIDO";
  label: string;
  Icon: LucideIcon;
  className: string;
  tooltip: string;
}

const CONFIG: Record<StatusRMKey, StatusRMVisual> = {
  Aberta: {
    key: "Aberta",
    label: "Aberta",
    Icon: CircleDot,
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    tooltip: "Nenhum item atendido — o material ainda não saiu do estoque.",
  },
  "Atendida Parcial": {
    key: "Atendida Parcial",
    label: "Atendida Parcial",
    Icon: PieChart,
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
    tooltip: "Parte dos itens foi atendida. A conferência é por item — o status do cabeçalho esconde as duas pontas.",
  },
  "Atendida Total": {
    key: "Atendida Total",
    label: "Atendida Total",
    Icon: CheckCircle2,
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    tooltip: "Todos os itens foram atendidos e o estoque baixou.",
  },
};

export function getStatusRM(status: string | null | undefined): StatusRMVisual {
  const s = (status || "").trim() as StatusRMKey;
  return (
    CONFIG[s] || {
      key: "DESCONHECIDO",
      label: status || "Sem status",
      Icon: HelpCircle,
      className: "bg-slate-400/15 text-slate-600 dark:text-slate-400 border-slate-400/30",
      tooltip: `Status não mapeado no Hub: "${status}". Reportar — o Alvo só devolvia três valores até 06/08/2026.`,
    }
  );
}

/** Ordem operacional (do pedido ao atendimento) — usada nos chips e no filtro. */
export const STATUS_RM_ORDER: StatusRMKey[] = ["Aberta", "Atendida Parcial", "Atendida Total"];
