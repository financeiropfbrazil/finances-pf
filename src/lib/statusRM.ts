import { LucideIcon } from "lucide-react";
import { CircleDot, PieChart, CheckCircle2, Trash2, HelpCircle } from "lucide-react";

/**
 * STATUS EFETIVO DA REQUISIÇÃO DE MATERIAL (RM) — fonte única da UI.
 *
 * Unifica DUAS dimensões num só estado, no molde do `statusPedido.ts`:
 *   · `op_reqmat.ausente_desde` — carimbo do Hub: a RM sumiu da listagem do Alvo
 *     (marcado pelo `sync-reqmat`, com cross-check — ver adiante);
 *   · `op_reqmat.status` — literal do Alvo, espelhado. Confirmados em campo sobre
 *     o universo de 2026 (n=680): "Aberta", "Atendida Parcial", "Atendida Total".
 *
 * ⚠ Os literais do Alvo chegam COM espaço e acento. Nunca normalizar para
 * maiúsculas nem snake_case: o valor exibido tem de ser rastreável até o que está
 * gravado. Status fora do conjunto cai no fallback visível — barulho de propósito,
 * para aparecer no dia em que o Alvo introduzir um quarto valor.
 *
 * REGRA: a PRIMEIRA condição que casa vence (ordem = precedência).
 *
 * ── Por que `ausente_alvo` vem PRIMEIRO ──────────────────────────────────────
 * Mesma razão do `excluido_alvo` no pedido: o registro não existe mais no ERP, e
 * qualquer status anterior é história. Uma RM excluída que exibe "Atendida Total"
 * em verde afirma algo que deixou de ser verdade — foi exatamente o que a RM
 * 0000002271 fez na fila entre 05 e 06/08/2026, com o `ausente_desde` já
 * carimbado no espelho desde 05/08 19:16.
 *
 * ⚠ Quem MARCA a ausência é o `sync-reqmat`, nunca a tela: ele só marca com a
 * listagem completa, sem erro, e com teto de 5% do universo do ano. Um 412
 * isolado não é prova — é o erro que marcou 7 pedidos vivos no módulo de
 * Suprimentos e teve de ser revertido.
 */

export type StatusRMKey = "ausente_alvo" | "Aberta" | "Atendida Parcial" | "Atendida Total";

export interface StatusRMVisual {
  /** Chave estável do estado — use no filtro, nunca a label. */
  key: StatusRMKey | "DESCONHECIDO";
  label: string;
  Icon: LucideIcon;
  className: string;
  tooltip: string;
}

const CONFIG: Record<StatusRMKey, StatusRMVisual> = {
  // Estado do HUB — precede tudo que vem do Alvo.
  ausente_alvo: {
    key: "ausente_alvo",
    label: "Excluída no ERP",
    Icon: Trash2,
    className: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40 line-through decoration-1",
    tooltip:
      "Esta requisição foi EXCLUÍDA no ERP (não existe mais lá). O Hub preserva o registro histórico, mas ele não é mais sincronizado.",
  },
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

function desconhecido(status: string | null | undefined): StatusRMVisual {
  return {
    key: "DESCONHECIDO",
    label: status || "Sem status",
    Icon: HelpCircle,
    className: "bg-slate-400/15 text-slate-600 dark:text-slate-400 border-slate-400/30",
    tooltip: `Status não mapeado no Hub: "${status}". Reportar — o Alvo só devolvia três valores até 06/08/2026.`,
  };
}

/**
 * Estado efetivo de UMA LINHA do espelho.
 *
 * Recebe a linha (não a string), como `getStatusPedido(ped)` — é o que permite a
 * ausência preceder o status. Aceita qualquer objeto com `ausente_desde` e
 * `status`, para servir tanto à fila quanto ao consolidado da OP.
 */
export function getStatusRM(rm: { ausente_desde?: string | null; status?: string | null } | null | undefined): StatusRMVisual {
  if (rm?.ausente_desde) return CONFIG.ausente_alvo;
  const s = (rm?.status || "").trim() as StatusRMKey;
  return CONFIG[s] || desconhecido(rm?.status);
}

/** Visual de uma CHAVE conhecida — para chips e dropdown, que não têm linha. */
export function getStatusRMVisual(key: StatusRMKey): StatusRMVisual {
  return CONFIG[key];
}

/**
 * Status do Alvo, em ordem operacional. NÃO inclui `ausente_alvo`: ele não é um
 * status do Alvo, é um carimbo do Hub, e tem chip próprio (que só aparece quando
 * existe pelo menos uma — chip fixo em zero é ruído permanente).
 */
export const STATUS_RM_ORDER: StatusRMKey[] = ["Aberta", "Atendida Parcial", "Atendida Total"];

/** Opções do dropdown de filtro — aqui a excluída ENTRA, como recorte explícito. */
export const STATUS_RM_FILTER_OPTIONS: { value: StatusRMKey; label: string }[] = [
  ...STATUS_RM_ORDER.map((k) => ({ value: k, label: CONFIG[k].label })),
  { value: "ausente_alvo", label: CONFIG.ausente_alvo.label },
];

// ─────────────────────────────────────────────────────────────────────────────
// FILTRO SERVER-SIDE (PostgREST) — espelho da precedência acima
// ─────────────────────────────────────────────────────────────────────────────
// A fila pagina no banco, então filtrar client-side pegaria só a página atual.
//
// ⚠️ MANTER EM SINCRONIA COM getStatusRM(). Como lá a ausência VENCE o status,
// aqui todo filtro por status do Alvo precisa EXCLUIR as ausentes — senão o
// usuário filtra "Atendida Total" e recebe linhas riscadas de "Excluída no ERP".
// É o mesmo cuidado documentado em `aplicarFiltroStatusPedido`.
//
// "todos" NÃO restringe: a fila completa mostra as ausentes junto, riscadas —
// é o retrato correto do espelho, e some da contagem dos status por causa da
// regra acima, não por estar escondida.

/**
 * Aplica o filtro de status efetivo a uma query do Supabase.
 *
 *   let query = supabase.from("op_reqmat").select("*", { count: "exact" });
 *   query = aplicarFiltroStatusRM(query, filtroStatus);
 */
export function aplicarFiltroStatusRM(query: any, filtro: string | undefined): any {
  if (!filtro || filtro === "todos" || filtro === "all") return query;

  if (filtro === "ausente_alvo") return query.not("ausente_desde", "is", null);

  // Status do Alvo: casa o literal E exclui as ausentes (precedência).
  return query.eq("status", filtro).is("ausente_desde", null);
}
