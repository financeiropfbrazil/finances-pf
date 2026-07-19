import { LucideIcon } from "lucide-react";
import {
  FileText,
  Loader2,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Flag,
  XCircle,
  Ban,
  Trash2,
  RotateCcw,
  ShoppingCart,
  HelpCircle,
  Send,
} from "lucide-react";

/**
 * STATUS EFETIVO DO PEDIDO — fonte única de verdade da UI.
 *
 * Unifica as cinco dimensões cruas (status_local do Hub + Status / Aprovado /
 * StatusAprovacao / Comprado do Alvo) em UM estado que a operação entende.
 * Badge, filtro e dashboard consomem esta MESMA função — nunca derivem status
 * por conta própria em outra tela.
 *
 * Baseado no censo de 17/07/2026 (Hub × Alvo, 16 combinações reais observadas):
 *   Status:          Aberto · Pendente · Encerrado · Cancelado · Cancelado Parcial · Reavaliar
 *   Aprovado:        Total · Não            (Parcial NUNCA ocorreu)
 *   StatusAprovacao: Nenhum · Em Andamento · Reavaliar · Finalizada
 *   Comprado:        Sim · Não
 *
 * REGRA: a PRIMEIRA condição que casar vence (ordem = precedência).
 *
 * ── Mudanças frente à versão anterior (L4, 19/07/2026) ───────────────────────
 *  1. CORREÇÃO: "Concluído" era `Encerrado OU comprado='Sim'`. O censo mostrou
 *     ~301 pedidos Aberto/Pendente + Total + Comprado='Sim' que estavam sendo
 *     exibidos como Concluído sem estarem encerrados. Agora Concluído =
 *     `status='Encerrado'` apenas; comprado='Sim' vira "Comprado — em andamento".
 *  2. NOVO: "Excluído no Alvo" (`status_local='excluido_alvo'`) — pedido que
 *     sumiu do ERP, detectado pelo cross-check do L3 (404 no Load + ausência da
 *     lista). Antes ficava preso como "Aberto" para sempre.
 *  3. NOVO: "Cancelado Parcial" (status próprio do Alvo, 6+ casos no censo).
 *  4. NOVO: `Status='Reavaliar'` do Alvo (existe como STATUS, não só como
 *     status_aprovacao — 9 casos vivos no censo).
 *  5. "Pendente" do Alvo deixou de ser estado próprio: convive com as mesmas
 *     combinações de aprovação que "Aberto" (censo), então cai nos estados de
 *     aprovação/compra e o valor cru fica visível só no detalhe.
 *     → Se a operação decidir que "Pendente" é acionável (decisão P-2), basta
 *       reativar o bloco marcado com "P-2" abaixo.
 */

export type StatusPedidoKey =
  | "rascunho"
  | "enviando"
  | "erro_envio"
  | "excluido_alvo"
  | "cancelado"
  | "cancelado_parcial"
  | "concluido"
  | "em_aprovacao"
  | "reavaliar"
  | "comprado_andamento"
  | "aprovado_aguardando_compra"
  | "enviado_aprovacao"
  | "aguardando_envio_aprovacao"
  | "desconhecido";

export interface StatusPedidoVisual {
  /** Chave estável do estado — use no filtro, nunca a label. */
  key: StatusPedidoKey;
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
  const enviouAprovacao = ped?.enviou_aprovacao as string | undefined;
  const aprovado = ped?.aprovado as string | undefined;
  const comprado = ped?.comprado as string | undefined;
  const proximoAprovador = ped?.proximo_aprovador as string | undefined;

  // ─── 1. Estados puramente do Hub (status_local) ───────────────────────────
  // Vêm primeiro: o pedido pode nem existir no Alvo ainda.

  if (statusLocal === "rascunho") {
    return {
      key: "rascunho",
      label: "Rascunho",
      Icon: FileText,
      className: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
      tooltip: "Pedido em rascunho — ainda não foi enviado ao ERP",
    };
  }

  if (statusLocal === "enviando") {
    return {
      key: "enviando",
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
      key: "erro_envio",
      label: "Erro no envio",
      Icon: AlertTriangle,
      className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
      tooltip: errMsg ? `Falhou ao enviar: ${errMsg}` : "Falhou ao enviar ao ERP — clique pra reenviar",
    };
  }

  // Pedido que existia no ERP e foi EXCLUÍDO lá (L3: 404 no Load + ausente da
  // lista de descoberta na janela = exclusão real, não soluço). Precede
  // Cancelado: o registro não existe mais, qualquer status anterior é história.
  if (statusLocal === "excluido_alvo") {
    return {
      key: "excluido_alvo",
      label: "Excluído no ERP",
      Icon: Trash2,
      className: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/40 line-through decoration-1",
      tooltip:
        "Este pedido foi EXCLUÍDO no ERP (não existe mais lá). O Hub mantém o registro histórico, mas ele não é mais sincronizado.",
    };
  }

  // ─── 2. Estados terminais do Alvo ─────────────────────────────────────────
  // Cancelamento prevalece sobre aprovação/compra: existe pedido aprovado,
  // comprado e DEPOIS cancelado (censo: Cancelado|Total|Finalizada|Sim).

  if (statusAlvo === "Cancelado") {
    return {
      key: "cancelado",
      label: "Cancelado",
      Icon: XCircle,
      className: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
      tooltip: "Pedido cancelado no ERP",
    };
  }

  if (statusAlvo === "Cancelado Parcial") {
    return {
      key: "cancelado_parcial",
      label: "Cancelado Parcial",
      Icon: Ban,
      className: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
      tooltip: "Pedido parcialmente cancelado no ERP — parte dos itens segue válida",
    };
  }

  // Concluído = ENCERRADO no ERP. Não usar comprado='Sim' aqui (ver nota 1 no
  // cabeçalho): pedido comprado mas ainda aberto NÃO está concluído.
  if (statusAlvo === "Encerrado") {
    return {
      key: "concluido",
      label: "Concluído",
      Icon: Flag,
      className: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/30",
      tooltip:
        comprado === "Sim"
          ? "Pedido encerrado no ERP — processo de compra concluído"
          : "Pedido encerrado no ERP (sem marcação de compra — serviço ou encerramento administrativo)",
    };
  }

  // ─── P-2 (decisão pendente) ───────────────────────────────────────────────
  // "Pendente" hoje NÃO é estado próprio: o censo mostra que ele convive com as
  // mesmas combinações de aprovação que "Aberto" (ex.: Pendente|Total|Finalizada|Sim
  // = 166 pedidos), então tratá-lo como estado próprio esconderia a informação
  // útil (aprovado? comprado?). Se a operação definir que "Pendente" é acionável,
  // descomente o bloco abaixo e adicione a chave em STATUS_PEDIDO_FILTER_OPTIONS.
  //
  // if (statusAlvo === "Pendente") {
  //   return {
  //     key: "pendente_erp",
  //     label: "Pendente no ERP",
  //     Icon: Pause,
  //     className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  //     tooltip: "Pedido pendente no ERP — verifique no Alvo",
  //   };
  // }

  // ─── 3. Workflow de aprovação (vale para Aberto E Pendente) ───────────────

  if (statusAprovacao === "Em Andamento") {
    return {
      key: "em_aprovacao",
      label: "Em aprovação",
      Icon: Clock,
      className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
      tooltip: proximoAprovador ? `Aguardando aprovação de ${proximoAprovador}` : "Aguardando aprovação no ERP",
    };
  }

  // Reavaliar existe nos DOIS eixos: como Status do Alvo e como StatusAprovacao.
  if (statusAlvo === "Reavaliar" || statusAprovacao === "Reavaliar") {
    return {
      key: "reavaliar",
      label: "Reavaliar",
      Icon: RotateCcw,
      className: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30",
      tooltip: proximoAprovador
        ? `Devolvido para reavaliação — com ${proximoAprovador}`
        : "Pedido devolvido para reavaliação no ERP",
    };
  }

  // ─── 4. Pós-aprovação (aprovado='Total') ──────────────────────────────────

  if (aprovado === "Total") {
    if (comprado === "Sim") {
      return {
        key: "comprado_andamento",
        label: "Comprado",
        Icon: ShoppingCart,
        className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
        tooltip: "Pedido aprovado e comprado — aguardando entrega/encerramento no ERP",
      };
    }
    return {
      key: "aprovado_aguardando_compra",
      label: "Aprovado",
      Icon: CheckCircle2,
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
      tooltip: "Pedido aprovado, aguardando execução da compra",
    };
  }

  // ─── 5. Pré-aprovação (aprovado='Não' + StatusAprovacao='Nenhum') ─────────
  // Dois casos distintos e acionáveis por pessoas diferentes.

  if (statusAprovacao === "Nenhum" && enviouAprovacao === "Sim") {
    return {
      key: "enviado_aprovacao",
      label: "Enviado para aprovação",
      Icon: Send,
      className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
      tooltip: proximoAprovador
        ? `Enviado para aprovação de ${proximoAprovador} — aguardando início do workflow`
        : "Enviado para aprovação — aguardando início do workflow",
    };
  }

  if (statusAprovacao === "Nenhum") {
    return {
      key: "aguardando_envio_aprovacao",
      label: "Aguardando envio p/ aprovação",
      Icon: FileText,
      className: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
      tooltip: "Pedido criado no ERP, mas o analista ainda não marcou 'Enviar para Aprovação = Sim'",
    };
  }

  // ─── 6. Fallback ──────────────────────────────────────────────────────────
  // Combinação fora do vocabulário do censo. Aparecer aqui = vocabulário do
  // Alvo mudou → investigar (rodar o censo de novo), não "consertar" na marra.
  return {
    key: "desconhecido",
    label: statusAlvo || statusLocal || "Desconhecido",
    Icon: HelpCircle,
    className: "bg-slate-400/15 text-slate-600 dark:text-slate-400 border-slate-400/30",
    tooltip: `Combinação não mapeada (status="${statusAlvo}", aprovado="${aprovado}", status_aprovacao="${statusAprovacao}", comprado="${comprado}", status_local="${statusLocal}")`,
  };
}

/**
 * Opções do dropdown de filtro, em ordem OPERACIONAL (do início ao fim do
 * ciclo, terminais e excepcionais no fim) — não alfabética, não a ordem de
 * precedência interna.
 *
 * NÃO inclui:
 *  - "enviando": estado transitório de segundos (spinner no card, não filtro);
 *  - "desconhecido": só aparece se o vocabulário do Alvo mudar.
 * "Enviado ao ERP"/"Sincronizado" (o antigo ciclo técnico) saíram daqui — quem
 * cobre origem Hub × Alvo é o filtro "Origem".
 */
export const STATUS_PEDIDO_FILTER_OPTIONS: { value: StatusPedidoKey; label: string }[] = [
  { value: "rascunho", label: "Rascunho" },
  { value: "aguardando_envio_aprovacao", label: "Aguardando envio p/ aprovação" },
  { value: "enviado_aprovacao", label: "Enviado para aprovação" },
  { value: "em_aprovacao", label: "Em aprovação" },
  { value: "reavaliar", label: "Reavaliar" },
  { value: "aprovado_aguardando_compra", label: "Aprovado — aguardando compra" },
  { value: "comprado_andamento", label: "Comprado — em andamento" },
  { value: "concluido", label: "Concluído" },
  { value: "cancelado", label: "Cancelado" },
  { value: "cancelado_parcial", label: "Cancelado Parcial" },
  { value: "excluido_alvo", label: "Excluído no ERP" },
  { value: "erro_envio", label: "Erro no envio" },
];

/** Helper de filtro client-side: `pedidos.filter(p => matchStatusPedido(p, filtro))`. */
export function matchStatusPedido(ped: any, filtro: string): boolean {
  if (!filtro || filtro === "all" || filtro === "todos") return true;
  return getStatusPedido(ped).key === filtro;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTRO SERVER-SIDE (PostgREST) — espelho da precedência acima
// ─────────────────────────────────────────────────────────────────────────────
// A listagem pagina no banco, então filtrar client-side pegaria só a página
// atual. Aqui cada estado vira condições PostgREST equivalentes.
//
// ⚠️ MANTER EM SINCRONIA COM getStatusPedido(). Como lá vale "a primeira regra
// que casa vence", aqui cada estado precisa casar a SUA regra E excluir as
// ANTERIORES — senão filtro e badge divergem (o usuário filtra "Aprovado" e vê
// card "Cancelado"). Mudou a precedência lá em cima? Mude aqui também.
//
// Armadilhas do PostgREST já pagas neste projeto:
//  · `in`/`not.in` com valor que tem ESPAÇO exige aspas duplas: '("Cancelado Parcial")'
//  · `neq`/`not.in` EXCLUEM linhas NULL → onde o campo pode ser nulo
//    (enviou_aprovacao), usa-se `.or("campo.is.null,campo.neq.X")`
//  · dois `.or()` na mesma query são combinados com AND (validado no L1)

/** status_local dos pedidos que existem no Alvo (os demais são estados só do Hub). */
const STATUS_LOCAL_NO_ALVO = ["enviado_alvo", "sincronizado"];

/** Terminais do Alvo, que precedem qualquer estado de aprovação/compra. */
const STATUS_ALVO_TERMINAIS = '("Cancelado","Cancelado Parcial","Encerrado")';

/**
 * Aplica o filtro de status efetivo a uma query do Supabase.
 *
 *   let query = supabase.from("compras_pedidos").select("*", { count: "exact" });
 *   query = aplicarFiltroStatusPedido(query, filtroStatus);
 *
 * `filtro` vazio / "todos" / "all" → query inalterada.
 */
export function aplicarFiltroStatusPedido(query: any, filtro: string): any {
  if (!filtro || filtro === "todos" || filtro === "all") return query;

  // ── Estados só do Hub: status_local é exclusivo, basta a igualdade ───────
  if (["rascunho", "enviando", "erro_envio", "excluido_alvo"].includes(filtro)) {
    return query.eq("status_local", filtro);
  }

  // ── Daqui pra baixo: pedido vivo no Alvo (exclui rascunho/enviando/erro/excluído)
  let q = query.in("status_local", STATUS_LOCAL_NO_ALVO);

  // Terminais do Alvo (precedem tudo que vem depois)
  if (filtro === "cancelado") return q.eq("status", "Cancelado");
  if (filtro === "cancelado_parcial") return q.eq("status", "Cancelado Parcial");
  if (filtro === "concluido") return q.eq("status", "Encerrado");

  // Não-terminal a partir daqui
  q = q.not("status", "in", STATUS_ALVO_TERMINAIS);

  if (filtro === "em_aprovacao") return q.eq("status_aprovacao", "Em Andamento");

  if (filtro === "reavaliar") {
    return q
      .neq("status_aprovacao", "Em Andamento") // em_aprovacao vence
      .or("status.eq.Reavaliar,status_aprovacao.eq.Reavaliar");
  }

  // Não está em aprovação nem em reavaliação
  q = q.neq("status", "Reavaliar").not("status_aprovacao", "in", '("Em Andamento","Reavaliar")');

  if (filtro === "comprado_andamento") return q.eq("aprovado", "Total").eq("comprado", "Sim");
  if (filtro === "aprovado_aguardando_compra") return q.eq("aprovado", "Total").neq("comprado", "Sim");

  // Pré-aprovação
  q = q.neq("aprovado", "Total").eq("status_aprovacao", "Nenhum");

  if (filtro === "enviado_aprovacao") return q.eq("enviou_aprovacao", "Sim");
  if (filtro === "aguardando_envio_aprovacao") {
    // enviou_aprovacao é nulo na maioria dos pedidos → `.neq` sozinho perderia
    // essas linhas (NULL some em comparação).
    return q.or("enviou_aprovacao.is.null,enviou_aprovacao.neq.Sim");
  }

  // Chave desconhecida: não filtra (melhor mostrar tudo do que lista vazia sem explicação)
  console.warn(`[aplicarFiltroStatusPedido] chave não mapeada: "${filtro}" — filtro ignorado`);
  return query;
}
