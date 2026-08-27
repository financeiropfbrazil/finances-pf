// =====================================================================
// MOEDA-PEDIDOS — leitura da moeda do pedido vinda do Alvo
// =====================================================================
// A moeda do pedido é atributo do CABEÇALHO, nunca do item: no
// `ItemPedCompChildList` o Alvo devolve `CodigoIndEconomico` null e
// `ValorCambio` 0 mesmo em pedido de dólar (report §29.8 item 4).
// Não procurar moeda no item.
//
// ⚠️ DIALETO: no PedComp o câmbio é `ValorCambio`. No DocFin o mesmo
// conceito se chama `CotacaoIndice`. São entidades diferentes do ERP —
// não extrapolar o nome de uma para a outra.
//
// ⚠️ SÓ O LOAD TRAZ ESTES CAMPOS. Medido em 26/08/2026 sobre as 605
// auditorias `descoberto_alvo` (que guardam o payload do list leve):
// ZERO têm as chaves `CodigoIndEconomico` / `ValorCambio`. Contra
// 3.786 de 3.786 auditorias `sync_status` (payload do Load) que têm as
// duas. Quem monta upsert a partir do LIST não pode gravar estas
// colunas — nem como null, o que apagaria o que o Load já gravou.

export const IND_ECONOMICO_BRL = "0000001";
export const IND_ECONOMICO_USD = "0000002";
export const IND_ECONOMICO_EUR = "0000003";

export interface MoedaPedidoUpsert {
  codigo_ind_economico?: string;
  valor_cambio?: number;
}

/**
 * Lê moeda + câmbio do retorno COMPLETO do `PedComp/Load`.
 *
 * Devolve um objeto para spread no upsert, com a chave OMITIDA quando o
 * Alvo não informou. A omissão é deliberada: gravar `null` sobrescreveria
 * um valor bom com nada.
 *
 * Medido em 26/08/2026: 10 pedidos tiveram `CodigoIndEconomico` null num
 * Load e preenchido no Load seguinte — SEMPRE nessa direção, nunca de uma
 * moeda para outra (caso limpo: 0004704, null → '0000002' com câmbio
 * 5,1856). Portanto null significa "o Alvo ainda não definiu", e não
 * "este pedido não tem moeda". Nunca assumir BRL a partir de null.
 */
export function extrairMoedaDoLoad(
  data: { CodigoIndEconomico?: unknown; ValorCambio?: unknown } | null | undefined,
): MoedaPedidoUpsert {
  const out: MoedaPedidoUpsert = {};

  const ind = data?.CodigoIndEconomico;
  if (ind !== null && ind !== undefined && String(ind).trim() !== "") {
    out.codigo_ind_economico = String(ind).trim();
  }

  const cambio = data?.ValorCambio;
  if (cambio !== null && cambio !== undefined && Number.isFinite(Number(cambio))) {
    out.valor_cambio = Number(cambio);
  }

  return out;
}

// =====================================================================
// FORMATAÇÃO (A4)
// =====================================================================
// REGRA DE OURO: exibir SEMPRE na moeda original. Nunca converter para
// BRL na tela — introduz um câmbio que ninguém pediu e confunde
// auditoria. `valor_cambio` é referência de registro e NÃO participa da
// formatação em nenhuma hipótese.
//
// O símbolo é decidido EXCLUSIVAMENTE por `codigo_ind_economico`.
//
// ⚠️ NUNCA inferir moeda a partir do câmbio. Medido em 26/08/2026: 9
// pedidos em moeda estrangeira têm `valor_cambio = 1` porque o ERP não
// informou a taxa (TAIWAN YUN LIN, Shanghai Eco Polymer, PCR London em
// EUR, AOKERAY, BEIJING DEMAX, FASTSPRING). `cambio === 1` não implica
// BRL.
//
// ⚠️ NULL NÃO É BRL. Decisão do Pedro em 26/08/2026: moeda não
// confirmada exibe o número SEM símbolo. Chutar `R$` repetiria o bug
// original — agora com aparência de correção — em centenas de pedidos
// (407 dos 1.247 auditados estavam com moeda null no último Load).

const SIMBOLOS: Record<string, string> = {
  [IND_ECONOMICO_BRL]: "R$",
  [IND_ECONOMICO_USD]: "US$",
  [IND_ECONOMICO_EUR]: "€",
};

/** Rótulo para tooltip/`title` quando a moeda não foi confirmada no ERP. */
export const MOEDA_NAO_CONFIRMADA = "Moeda não confirmada no ERP";

/**
 * Símbolo da moeda, ou `null` quando o ERP não confirmou.
 * `null` é resposta válida — quem exibe deve tratar, não substituir.
 */
export function simboloMoeda(codigoIndEconomico: string | null | undefined): string | null {
  if (!codigoIndEconomico) return null;
  return SIMBOLOS[String(codigoIndEconomico).trim()] ?? null;
}

/**
 * Formata um valor na moeda do pedido.
 *
 * Com moeda conhecida: `US$ 1.234,56`.
 * Sem moeda (null, ou código desconhecido): `1.234,56 —`, sem símbolo.
 * O número usa sempre agrupamento pt-BR, que é como a operação lê.
 *
 * Um código novo do Alvo cai no caminho "não confirmada" de propósito:
 * é conservador e visível, em vez de inventar um símbolo errado.
 */
export function formatarValorMoeda(
  valor: number | string | null | undefined,
  codigoIndEconomico: string | null | undefined,
): string {
  const n = Number(valor ?? 0);
  const numero = (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const simbolo = simboloMoeda(codigoIndEconomico);
  return simbolo ? `${simbolo} ${numero}` : `${numero} —`;
}

/**
 * `true` quando a exibição deve sinalizar moeda não confirmada — para o
 * consumidor pendurar o tooltip discreto (`title={MOEDA_NAO_CONFIRMADA}`).
 */
export function moedaNaoConfirmada(codigoIndEconomico: string | null | undefined): boolean {
  return simboloMoeda(codigoIndEconomico) === null;
}
