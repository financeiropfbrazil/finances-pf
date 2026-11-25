// LP-ENV (PLANO-PEDIDOS): data em que o pedido foi enviado para aprovação.
//
// O Alvo só diz "Enviou Aprovação = Sim/Não", sem data. Quem guarda a data é o Hub, em
// compras_pedidos.enviado_aprovacao_em; enviado_aprovacao_origem diz a precisão:
//   botao_hub    = hora exata (botão "Enviar para aprovação" do Hub);
//   leitura      = hora em que o Hub viu o pedido já enviado (até 1 h depois, pela Edge de hora em hora);
//   aproximado   = passado reconstituído pela auditoria do Hub, ou pedido que já chegou enviado ao Hub;
//   desconhecido = enviado sem que o Hub visse a passagem (antes de 23/05/2026, ou enviado e aprovado entre
//                  duas leituras) — fica sem data.
// Sem data e sem origem = ainda não enviado.

export type OrigemEnvioAprovacao = "botao_hub" | "leitura" | "aproximado" | "desconhecido";

export interface EnvioAprovacaoInfo {
  enviado_aprovacao_em?: string | null;
  enviado_aprovacao_origem?: string | null;
}

/** Frase curta sobre a precisão da data (para mostrar abaixo dela). */
export function rotuloOrigemEnvio(origem: string | null | undefined): string | null {
  switch (origem) {
    case "botao_hub":
      return "hora exata (enviado pelo Hub)";
    case "leitura":
      return "visto pelo Hub até 1 h depois do envio no Alvo";
    case "aproximado":
      return "aproximada (reconstituída pelo Hub)";
    case "desconhecido":
      return "o Hub não registrou a data deste envio";
    default:
      return null;
  }
}

/** Texto da origem para planilhas. */
export function origemEnvioTexto(origem: string | null | undefined): string {
  switch (origem) {
    case "botao_hub":
      return "Exata (botão do Hub)";
    case "leitura":
      return "Leitura do Hub (até 1 h)";
    case "aproximado":
      return "Aproximada";
    case "desconhecido":
      return "Sem data";
    default:
      return "";
  }
}

const RE_DATA_PURA = /^\d{4}-\d{2}-\d{2}$/;

/** Dia (AAAA-MM-DD) no horário de Brasília. Data pura passa como está (não vira o dia anterior). */
export function diaBrasilia(valor: string | null | undefined): string | null {
  if (!valor) return null;
  if (RE_DATA_PURA.test(valor)) return valor;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Dias de calendário entre dois dias AAAA-MM-DD (ate − de). */
export function diasEntre(de: string | null | undefined, ate: string | null | undefined): number | null {
  const a = diaBrasilia(de);
  const b = diaBrasilia(ate);
  if (!a || !b) return null;
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** Dias entre a data do pedido e o envio para aprovação. */
export function diasAteEnviar(dataPedido: string | null | undefined, enviadoEm: string | null | undefined): number | null {
  return diasEntre(dataPedido, enviadoEm);
}

/** Dias entre o envio para aprovação e a aprovação final no Alvo. */
export function diasAteAprovar(
  enviadoEm: string | null | undefined,
  dataAprovacao: string | null | undefined,
): number | null {
  return diasEntre(enviadoEm, dataAprovacao);
}

/**
 * Data da aprovação FINAL do pedido, ou null enquanto ele ainda está em aprovação.
 *
 * compras_pedidos.data_aprovacao_alvo vem do item do Alvo (ItemPedCompChildList.DataAprovacao), que é preenchido
 * já na PRIMEIRA etapa aprovada e atualizado a cada etapa — vale como aprovação final só com o pedido finalizado
 * (conferido em 25/11/2026: em 393 de 393 pedidos a data mudou quando a aprovação foi finalizada; 22 pedidos
 * "Em Andamento" tinham a data da etapa intermediária). Achado no pedido 0005317.
 */
export function dataAprovacaoFinal(p: {
  data_aprovacao_alvo?: string | null;
  status_aprovacao?: string | null;
  aprovado?: string | null;
}): string | null {
  if (!p.data_aprovacao_alvo) return null;
  const finalizada = p.status_aprovacao === "Finalizada" || p.aprovado === "Total" || p.aprovado === "Parcial";
  return finalizada ? p.data_aprovacao_alvo : null;
}

/** "no mesmo dia", "1 dia", "5 dias". */
export function textoDias(n: number | null): string | null {
  if (n === null) return null;
  if (n === 0) return "no mesmo dia";
  return `${n} ${Math.abs(n) === 1 ? "dia" : "dias"}`;
}

/** Situação do envio: data (com ou sem precisão exata), sem data, ou não enviado. */
export function situacaoEnvio(p: EnvioAprovacaoInfo): "com_data" | "sem_data" | "nao_enviado" {
  if (p.enviado_aprovacao_em) return "com_data";
  if (p.enviado_aprovacao_origem === "desconhecido") return "sem_data";
  return "nao_enviado";
}
