import { supabase } from "@/integrations/supabase/client";
// 🔴 O MAPPER É O MESMO DO `sync-reqmat`, POR IMPORTAÇÃO — não por cópia.
//    Um arquivo, dois consumidores (Deno e Vite). Ver o cabeçalho dele para o
//    porquê; o resumo é: se a criação mapeasse por conta própria, a linha
//    nasceria num formato e o primeiro sync a reescreveria noutro. A linha
//    "pisca" na tela e ninguém descobre a causa, porque nada erra — os dois
//    lados estão certos, e diferentes.
import { montarBlocosDoLoad, FILIAL_PADRAO } from "../../supabase/functions/_shared/reqmatMapper";

/**
 * SEMEADURA DO ESPELHO NA CRIAÇÃO DA RM  ·  OP-2.8
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PROBLEMA QUE ISTO RESOLVE (medido em 08/08/2026, RM 0000002286)
 *
 * O ciclo de três passos da OP-2.7 funcionou: `status_envio = 'confirmado'` em
 * 10 s, `Origem = "Importação"`, `TipoAtendimento = "Manual"`. E a RM **não
 * apareceu em lugar nenhum da fila** — porque a fila lê `op_reqmat`, o espelho,
 * e o espelho só anda 4×/dia. Como era sábado e o cron roda `* * 1-5`, ela
 * ficaria invisível até segunda-feira.
 *
 * ⇒ A RM criada pelo Hub passa a ser gravada no espelho NA HORA DA CRIAÇÃO. Uma
 *   tabela só, sem merge em memória, sem view, sem bloco separado na tela. O
 *   sync assume na próxima passada e atualiza o que só ele sabe: atendimento,
 *   lote, saldo, status.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 SEMEAR DO **LOAD**, NUNCA DO PAYLOAD QUE O HUB MONTOU
 *
 * É o passo 3 (o `ReqMat/Load` de confirmação) que traz o objeto REAL do Alvo,
 * com o que o servidor preencheu: `Data`, `Status`, `Operacao`, `DataValidade`,
 * `EspecieDocumento`. Assim a linha nasce IDÊNTICA à que o sync gravaria.
 *
 * E há uma razão mais dura que a estética: **o Alvo RENUMERA a sequência do
 * item**. Na 0000002286 o Hub enviou `Sequencia: 1` e o Load devolveu
 * `Sequencia: 2`. Como a sequência é parte da PK do item e é o que os lotes
 * referenciam (`op_reqmat_lotes.sequencia_item`), semear do payload gravaria PK
 * errada hoje e produziria lotes órfãos da FK amanhã, no atendimento.
 *
 * ⚠ Se o passo 3 falhar, NÃO se semeia — sem o Load não há o que gravar, e o
 *   sync traz em ≤3 h. Isso é automático: o corpo do Load é a única entrada
 *   desta função.
 *
 * ⚠ E se a semeadura falhar com o passo 3 OK, o fluxo NÃO cai: a RM está certa
 *   no ERP e o livro é confirmado assim mesmo. Só o espelho ficou para trás, e é
 *   exatamente o que o sync conserta sozinho. Mesmo julgamento já aplicado ao
 *   `marcarRMConfirmada` que falha (alvoReqMatSaveService).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ResultadoSemeadura {
  ok: boolean;
  /** Motivo legível — para a nota da tela, nunca para bloquear o fluxo. */
  motivo?: string;
  itens?: number;
  lotes?: number;
}

/**
 * Grava no espelho a RM que o Alvo acabou de confirmar.
 *
 * A escrita passa pela RPC `op_reqmat_semear_criacao` (`sql/OP-2.9.sql`), que é
 * `SECURITY DEFINER`, gateada por `producao.rm.create` e exige que exista linha
 * em `op_requisicoes` com aquele número em `enviado` — ou seja, ela só semeia o
 * que o Hub acabou de criar, não é RPC genérica de escrita no espelho.
 *
 * ⚠ NÃO existe policy de INSERT em `op_reqmat` e não deve passar a existir:
 *   abrir a tabela a `authenticated` é a classe do BL-5 — gate bonito no
 *   frontend e tabela aberta no servidor, gravável pelo console do navegador por
 *   qualquer um dos 100+ usuários.
 */
export async function semearEspelhoDaCriacao(numero: string, corpoDoLoad: unknown): Promise<ResultadoSemeadura> {
  const blocos = montarBlocosDoLoad(corpoDoLoad, FILIAL_PADRAO, numero);
  if (!blocos.ok) {
    // As guardas estruturais são as MESMAS do sync (item sem `Sequencia`, lote
    // órfão, child list vazia): quem não entraria no espelho pelo sync também
    // não entra por aqui.
    return { ok: false, motivo: blocos.motivo };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("op_reqmat_semear_criacao", {
    p_numero: numero,
    p_cabecalho: blocos.cabecalho,
    p_itens: blocos.itens,
    p_lotes: blocos.lotes,
    p_raw: blocos.raw,
  });

  if (error) {
    console.error("[reqMatEspelhoService] op_reqmat_semear_criacao — erro", {
      code: error.code,
      message: error.message,
      numero,
    });
    return { ok: false, motivo: error.message || "Falha ao gravar a requisição no espelho." };
  }
  if (data && typeof data === "object" && data.success === false) {
    return { ok: false, motivo: data.mensagem || "Falha ao gravar a requisição no espelho." };
  }

  return { ok: true, itens: data?.itens_inseridos ?? 0, lotes: data?.lotes_inseridos ?? 0 };
}
