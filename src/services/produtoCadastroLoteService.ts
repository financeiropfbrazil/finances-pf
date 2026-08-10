import { supabase } from "@/integrations/supabase/client";
import { loadProduto } from "./produtoBulkService";
// Helpers estruturais do `_shared` — `indexar`/`pick`/`txt`/`num` são genéricos
// (leitura case-insensitive de objeto do Alvo), não têm nada de ReqMat. Importar
// daqui evita a QUARTA cópia deles no repo.
import { FILIAL_PADRAO, indexar, num, pick, txt } from "../../supabase/functions/_shared/reqmatMapper";

/**
 * CARGA DO CADASTRO DE PRODUTO PARA ATENDIMENTO DE RM  ·  AT-4.2
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTA CARGA EXISTE
 *
 * A tela de Atendimento do Alvo manda campos de CADASTRO DO PRODUTO no
 * `ClassInstance` das chamadas de lote. O `ReqMat/Load` devolve essas chaves com
 * **valor nulo** — medido em 2.563 de 2.563 `raw` do espelho: as chaves existem
 * em 100% e dez delas vêm nulas em 100%. Sem elas o Alvo responde
 * `NullReferenceException`, que não diz qual campo falta.
 *
 * Cinco não existiam em lugar nenhum do Hub — `CodigoTipoProduto`,
 * `ControlaEstoque`, `PossuiNumSerie`, `Peso`, `PesoFatorDivisor` — e o
 * `Produto/Load` os tem. A comparação campo a campo com a captura da tela fechou
 * **5/5** no espécime `001.003.00087`.
 *
 * ⇒ Carga ÚNICA dos 258 produtos com `controla_lote`, cacheada em
 *   `stock_products` + `stock_produto_unidades` (AT-4.2). Custo no atendimento:
 *   **zero chamadas**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 O QUE ESTA CARGA NÃO FAZ
 *
 *   · **Não escreve no ERP.** Só `GET /produto/load`. `Produto/SavePartial` está
 *     na whitelist do gateway sem gate de papel e com o comentário "REMOVER apos
 *     a carga" desde 30/07 — não é usado aqui nem para testar.
 *   · **Não toca em `controla_lote`**, `nome_produto` nem `unidade_medida`. O que
 *     vem do Alvo entra em `controla_lote_filial`, ao LADO, para comparar: a
 *     filial manda (§6.3-N), e divergência é achado, não conserto automático.
 *   · **Não converte quantidade.** O peso do cadastro serve ao `ClassInstance`;
 *     `Quantidade2` e companhia seguem o fator do próprio item da RM. A separação
 *     é regra (decisão do Pedro, 10/08/2026) e está no cabeçalho da AT-4.2.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ AUSÊNCIA DE DADO É NORMAL, E VIRA RELATÓRIO — NUNCA VALOR INVENTADO
 *
 * O §9.8 conta **64 produtos que exigem fator caso a caso** e **33 sem
 * unidade-base nenhuma**; a `ProdEmpresaFilialChildList` **pode vir vazia** em
 * cadastro incompleto (ex.: `001.003.00020`). Nada disso é falha da carga: cada
 * caso é contado e devolvido em `ResultadoCarga`, e o campo fica NULL.
 * Um produto sem cache BLOQUEIA o item no atendimento, com mensagem — que é o
 * comportamento correto (decisão 5 do `RETOMADA-AT-4.md`).
 */

/** O mesmo intervalo do bulk edit de produtos (`Etapa5Execucao.tsx`). */
const DELAY_MS = 750;

/**
 * Gargalo compartilhado: o gateway serve Suprimentos (100+ usuários), Despesas,
 * Intercompany e NF-e. A carga é SEQUENCIAL de propósito — 258 chamadas a 750 ms
 * levam ~3,5 min e não disputam fila com quem está trabalhando.
 */
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ResultadoCarga {
  total: number;
  sucesso: number;
  falha: number;
  /** `ProdUnidMedChildList` ausente ou vazia — cadastro incompleto no ERP. */
  semEscalaDeUnidades: number;
  /** `ProdEmpresaFilialChildList` ausente, vazia ou sem a filial 1.01. */
  semFilial: number;
  /** `ControlaLote` da filial diverge do `controla_lote` do Hub. 🔴 Achado. */
  divergenciaControlaLote: Array<{ codigo: string; hub: boolean; alvoFilial: string | null }>;
  /** Sem `QuantidadeDiasValidadeLote` — sem régua de vencimento por produto. */
  semReguaDeVencimento: number;
  /** Campo "dias" que não era inteiro: gravado NULL, registrado aqui. */
  camposNaoNumericos: Array<{ codigo: string; campo: string; valor: string }>;
  /** `PesoFatorDivisor = "Divisor"` — a regra ERRADA. 🔴 Achado de cadastro. */
  unidadesComDivisor: Array<{ codigo: string; posicao: number; unidade: string | null; peso: number | null }>;
  /**
   * 🔴 A MESMA `Posicao` repetida na `ProdUnidMedChildList` do produto. A RPC
   * deduplica (primeira ocorrência vence) e devolve a contagem — o Hub não
   * conserta cadastro do ERP, mas também não engole a duplicata em silêncio.
   */
  posicoesDuplicadas: Array<{ codigo: string; recebidas: number; duplicadas: number }>;
  erros: Array<{ codigo: string; erro: string }>;
}

interface LinhaUnidade {
  posicao: number;
  codigo_unid_med: string | null;
  peso: number | null;
  peso_fator_divisor: string | null;
}

/**
 * Inteiro ou nada. 🔴 O domínio destes campos NÃO foi medido — coerção
 * silenciosa esconderia um formato que o Alvo mudou. Valor não inteiro vira NULL
 * e entra em `camposNaoNumericos`.
 */
function paraInteiro(v: unknown): { valor: number | null; bruto: string | null } {
  const n = num(v);
  if (n === null || !Number.isFinite(n) || !Number.isInteger(n)) {
    const bruto = v === null || v === undefined ? null : String(v);
    return { valor: null, bruto: bruto && bruto !== "null" ? bruto : null };
  }
  return { valor: n, bruto: null };
}

/**
 * A escala do produto, da `ProdUnidMedChildList`.
 *
 * ⚠ NÃO deduplicamos por unidade: o `001.003.00029` tem **`CX` nas posições 2 e
 *   3, com pesos 70 e 72**. São duas linhas legítimas do cadastro (ainda que
 *   provavelmente erradas), e a PK é (produto, posição) exatamente para que o
 *   defeito apareça em vez de sumir.
 */
function extrairEscala(produto: unknown): LinhaUnidade[] {
  const lista = pick(indexar(produto), "ProdUnidMedChildList");
  if (!Array.isArray(lista)) return [];
  return lista
    .map((u: unknown) => {
      const i = indexar(u);
      const posicao = num(pick(i, "Posicao"));
      if (posicao === null || !Number.isFinite(posicao)) return null;
      return {
        posicao: Math.trunc(posicao),
        codigo_unid_med: txt(pick(i, "CodigoUnidMedida", "CodigoUnidMed")),
        peso: num(pick(i, "Peso")),
        peso_fator_divisor: txt(pick(i, "PesoFatorDivisor")),
      } as LinhaUnidade;
    })
    .filter(Boolean) as LinhaUnidade[];
}

/**
 * `ControlaLote` da filial. Mora na `ProdEmpresaFilialChildList`, por filial —
 * e é o que MANDA quando diverge da raiz (§6.3-N).
 *
 * ⚠ Child list vazia devolve `null`, **nunca `"Não"`**: cadastro incompleto não
 *   é "não controla lote". Foi assim que o `ControlaLote` do MovEstq enganou
 *   todo mundo por 756 itens.
 */
function controlaLoteDaFilial(produto: unknown): { valor: string | null; temFilial: boolean } {
  const lista = pick(indexar(produto), "ProdEmpresaFilialChildList");
  if (!Array.isArray(lista) || lista.length === 0) return { valor: null, temFilial: false };
  const daFilial =
    lista.find((f: unknown) => txt(pick(indexar(f), "CodigoEmpresaFilial")) === FILIAL_PADRAO) ?? null;
  if (!daFilial) return { valor: null, temFilial: false };
  return { valor: txt(pick(indexar(daFilial), "ControlaLote")), temFilial: true };
}

/**
 * A raiz do `Produto/Load` **sem** as child lists — vai para `cadastro_alvo_raw`.
 *
 * Existe para não custar uma segunda carga de 258 chamadas no dia em que
 * descobrirmos que falta um campo. Mesmo princípio do `raw` das tabelas de
 * espelho; as listas ficam de fora porque já viram tabela e colunas.
 */
function raizSemChildLists(produto: unknown): Record<string, unknown> {
  if (!produto || typeof produto !== "object") return {};
  const fora = new Set(["produnidmedchildlist", "prodempresafilialchildlist", "produto1object"]);
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(produto)) {
    if (fora.has(k.toLowerCase())) continue;
    if (Array.isArray(v)) continue; // qualquer outra child list também fica fora
    saida[k] = v;
  }
  return saida;
}

/**
 * Carrega o cadastro dos produtos com controle de lote e grava o cache.
 *
 * Escopo: **todos os 258 com `controla_lote = true`**, ativos e inativos. Os 13
 * inativos entram de propósito — produto inativado hoje ainda aparece em RM
 * antiga em aberto, e sem cache o item seria bloqueado no atendimento.
 *
 * @param onProgress chamado a cada produto, para a tela mostrar o andamento
 */
export async function carregarCadastroDeLote(onProgress?: (msg: string) => void): Promise<ResultadoCarga> {
  const { data, error } = await (supabase as any)
    .from("stock_products")
    .select("codigo_produto, controla_lote")
    .eq("controla_lote", true)
    .order("codigo_produto");

  if (error) throw new Error(`Falha ao listar os produtos com controle de lote: ${error.message}`);

  const produtos = (data || []) as Array<{ codigo_produto: string; controla_lote: boolean }>;

  const r: ResultadoCarga = {
    total: produtos.length,
    sucesso: 0,
    falha: 0,
    semEscalaDeUnidades: 0,
    semFilial: 0,
    divergenciaControlaLote: [],
    semReguaDeVencimento: 0,
    camposNaoNumericos: [],
    unidadesComDivisor: [],
    posicoesDuplicadas: [],
    erros: [],
  };

  for (let idx = 0; idx < produtos.length; idx++) {
    const { codigo_produto: codigo, controla_lote: loteNoHub } = produtos[idx];
    onProgress?.(`Carregando ${idx + 1}/${produtos.length} — ${codigo}…`);

    try {
      const produto = await loadProduto(codigo);
      const i = indexar(produto);

      const dias = paraInteiro(pick(i, "QuantidadeDiasValidadeLote"));
      const prazoDias = paraInteiro(pick(i, "PrazoValidadeDias"));
      if (dias.bruto) r.camposNaoNumericos.push({ codigo, campo: "QuantidadeDiasValidadeLote", valor: dias.bruto });
      if (prazoDias.bruto) r.camposNaoNumericos.push({ codigo, campo: "PrazoValidadeDias", valor: prazoDias.bruto });
      if (dias.valor === null) r.semReguaDeVencimento++;

      const filial = controlaLoteDaFilial(produto);
      if (!filial.temFilial) r.semFilial++;

      // 🔴 A filial manda, mas o Hub NÃO se corrige sozinho — a divergência é
      //    ACHADO e sai no relatório. Corrigir em silêncio um flag que a tela de
      //    atendimento usa para decidir se pede lote seria trocar um erro
      //    visível por um invisível.
      const esperado = loteNoHub ? "Sim" : "Não";
      if (filial.valor !== null && filial.valor !== esperado) {
        r.divergenciaControlaLote.push({ codigo, hub: loteNoHub, alvoFilial: filial.valor });
      }

      const escala = extrairEscala(produto);
      if (escala.length === 0) r.semEscalaDeUnidades++;
      escala
        .filter((u) => u.peso_fator_divisor === "Divisor")
        .forEach((u) =>
          r.unidadesComDivisor.push({ codigo, posicao: u.posicao, unidade: u.codigo_unid_med, peso: u.peso }),
        );

      const cabecalho: Record<string, unknown> = {
        codigo_tipo_produto: txt(pick(i, "CodigoTipoProduto")),
        controla_estoque: txt(pick(i, "ControlaEstoque")),
        possui_num_serie: txt(pick(i, "PossuiNumSerie")),
        controla_lote_filial: filial.valor,
        quantidade_dias_validade_lote: dias.valor,
        prazo_validade: txt(pick(i, "PrazoValidade")),
        prazo_validade_dias: prazoDias.valor,
        numero_lote_automatico: txt(pick(i, "NumeroLoteAutomatico")),
        base_geracao_automatica_lote: txt(pick(i, "BaseGeracaoAutomaticaLote")),
        utiliza_dimensoes_lote: txt(pick(i, "UtilizaDimensoesLote")),
        raw: raizSemChildLists(produto),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: resp, error: rpcErro } = await (supabase as any).rpc("stock_produto_cadastro_aplicar", {
        p_codigo: codigo,
        p_cabecalho: cabecalho,
        p_unidades: escala,
      });

      if (rpcErro) throw new Error(rpcErro.message);
      if (resp && typeof resp === "object" && resp.success === false) {
        throw new Error(`${resp.erro_codigo || "erro"}: ${resp.mensagem || "falha na RPC"}`);
      }

      // A deduplicação acontece na RPC (a PK recusaria a segunda linha, e o
      // `on conflict` recusaria a instrução inteira). Aqui só se REGISTRA o que
      // ela contou — quem decide o que fazer com cadastro repetido é o Pedro.
      const duplicadas = Number(resp?.posicoes_duplicadas ?? 0);
      if (Number.isFinite(duplicadas) && duplicadas > 0) {
        r.posicoesDuplicadas.push({
          codigo,
          recebidas: Number(resp?.unidades_recebidas ?? 0),
          duplicadas,
        });
      }

      r.sucesso++;
    } catch (e: unknown) {
      r.falha++;
      const msg = e instanceof Error ? e.message : String(e);
      r.erros.push({ codigo, erro: msg });
      // 🔴 Uma falha NÃO derruba a carga: 257 produtos cacheados valem mais que
      //    zero, e o produto que faltou aparece no relatório e bloqueia só o
      //    próprio item no atendimento.
      console.warn(`[produtoCadastroLote] ${codigo} falhou:`, msg);
    }

    if (idx < produtos.length - 1) await delay(DELAY_MS);
  }

  onProgress?.(
    `Concluído: ${r.sucesso} de ${r.total} · ${r.falha} falha(s) · ${r.semEscalaDeUnidades} sem escala · ${r.semFilial} sem filial`,
  );
  console.info("[produtoCadastroLote] resultado", r);
  return r;
}

/** Resumo de uma linha para o toast; o detalhe fica no console e no objeto. */
export function resumirCarga(r: ResultadoCarga): string {
  const partes = [`${r.sucesso}/${r.total} carregados`];
  if (r.falha > 0) partes.push(`${r.falha} falha(s)`);
  if (r.semEscalaDeUnidades > 0) partes.push(`${r.semEscalaDeUnidades} sem escala de unidades`);
  if (r.semFilial > 0) partes.push(`${r.semFilial} sem filial ${FILIAL_PADRAO}`);
  if (r.divergenciaControlaLote.length > 0) partes.push(`⚠ ${r.divergenciaControlaLote.length} divergência(s) de ControlaLote`);
  if (r.unidadesComDivisor.length > 0) partes.push(`⚠ ${r.unidadesComDivisor.length} unidade(s) com regra "Divisor"`);
  if (r.posicoesDuplicadas.length > 0) partes.push(`⚠ ${r.posicoesDuplicadas.length} produto(s) com posição repetida`);
  if (r.semReguaDeVencimento > 0) partes.push(`${r.semReguaDeVencimento} sem dias de validade`);
  return partes.join(" · ");
}
