import { supabase } from "@/integrations/supabase/client";
// 🔴 AS GUARDAS ESTRUTURAIS VÊM DO `_shared`, NÃO DE CÓPIA LOCAL.
//    `analisarRespostaReqMat` existe em duas versões no repo: a canônica aqui
//    importada e uma réplica em `alvoReqMatLoadService.ts` (l. 123), com listas
//    de chaves ligeiramente diferentes. A réplica nasceu quando a original ainda
//    morava dentro do `sync-reqmat/index.ts` e não dava para importar do front;
//    a OP-2.8 extraiu o mapper para `_shared` e essa restrição caiu. Este
//    arquivo importa a canônica — uma terceira cópia é que não entra.
import {
  FILIAL_PADRAO,
  analisarRespostaReqMat,
  indexar,
  montarBlocosDoLoad,
  num,
  pick,
  txt,
} from "../../supabase/functions/_shared/reqmatMapper";

/**
 * ATENDIMENTO DE RM NO ALVO — abertura e envio.  ·  AT-4 (Fase 4 do módulo OP)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DUAS METADES, E A DIVISÃO É REGRA, NÃO ARRUMAÇÃO
 *
 *   `abrirAtendimento`  → Load + lotes + Relacionar.  **NÃO ESCREVE NADA.**
 *   `enviarAtendimento` → livro + releitura + Validar + Finalizar + semeadura.
 *
 * Abrir o modal é leitura, e leitura não escreve (regra 1 da §4 do
 * `PLANO-RM-ATENDIMENTO.md`). O livro nasce no ENVIO.
 *
 * ⚠ Consequência aceita e registrada: a trava Hub-vs-Hub (índice único parcial
 *   `ux_op_rm_atend_em_voo`) só engata no confirmar. Duas pessoas podem abrir o
 *   mesmo modal; quem chegar em segundo leva recusa de releitura, não aviso
 *   antecipado. Trocar isso exigiria escrever na abertura — e aí um modal
 *   aberto e esquecido travaria a RM por 15 minutos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 O PASSO QUE IMPEDE BAIXA EM DOBRO
 *
 * O almoxarifado pode atender no Hub OU no Alvo — decisão de processo do Pedro
 * (§1.1). O Hub monta o objeto a partir de uma leitura de segundos atrás; se
 * alguém atendeu no Alvo nesse meio-tempo, o Hub mandaria quantidade já
 * consumida. **E o Alvo ACEITA atendimento acima do pedido** (é assim que
 * `QuantidadeAtendidaMaior` nasce) ⇒ não haveria erro, haveria baixa em dobro.
 *
 * Por isso a RELEITURA é obrigatória imediatamente antes do Validar, e qualquer
 * divergência RECUSA o envio. Sem ela a tela é insegura.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O CICLO DO ENVIO, NA ORDEM, SEM PULAR
 *
 *   1. op_rm_atender_iniciar    → id do livro (recusa se já houver um em voo)
 *   2. RELEITURA (ReqMat/Load)  🔴 divergiu → recusado_releitura, nada é enviado
 *   3. ReqMat/ValidarAtendimento    → objeto INTEIRO, SEM envelope Action/ClassObject
 *   4. ReqMat/FinalizarAtendimento  → O MESMO objeto que o Validar devolveu
 *   5. Load de confirmação → montarBlocosDoLoad → op_rm_atender_concluir
 *
 * ⚠ No passo 4 não se "corrige" `Status`, `BaixouEstoque`, `TipoFormulario` nem
 *   `TipoAtendimento` do payload: eles ainda vêm com o valor antigo e **quem
 *   muda é o servidor** (§10.19). Mexer neles é como se perdem tentativas.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 DEPOIS DO PASSO 4, A `concluir` É SEMPRE CHAMADA — mesmo sem blocos.
 *
 * A AT-3.1 fez as duas guardas da `op_rm_atender_concluir` (`sem_itens` e
 * `nao_no_espelho`) carimbarem `finalizado` em vez de recusar. ⇒ Depois de um
 * Finalizar bem-sucedido NÃO existe caminho em que ela devolva `success:false`.
 * Deixar de chamá-la é que seria o defeito: o expurgo de 15 min da
 * `op_rm_atender_iniciar` marcaria `abandonado` um atendimento que baixou
 * material. Daí a cascata de três degraus em `semear()`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";

/**
 * SAÍDA BAIXA REQUISIÇÃO DE MATERIAL. O dropdown do Alvo tem **244 opções** e a
 * tela do Hub não oferece escolha (§2.4).
 */
const CODIGO_TIPO_LANC = "E0000023";

/**
 * ⚠ NÃO É QUEM ATENDEU. Vem `0000165` (Maria Alves) em todos os atendimentos
 * medidos, inclusive os feitos pelo Pedro — é o padrão do local `001` e não é
 * editável no Alvo. A rastreabilidade REAL de pessoas está nos campos de
 * Entrega (§6.3-N).
 */
const CODIGO_FUNCIONARIO_ATENDENTE = "0000165";

/**
 * 🔴 PARAMETRIZADO DE PROPÓSITO — a semântica deste campo NÃO está fechada.
 *
 * Medido em 09/08/2026 no espelho inteiro (2.422 itens com `raw`):
 *
 *   · `"Não"` → 2.356 itens · `"Sim"` → 66 itens
 *   · Entre os 56 itens atendidos PARCIALMENTE sem excedente, o saldo
 *     remanescente ficou de pé em **100% dos casos nos DOIS valores**
 *     (`Sim` 22/22, `Não` 34/34) ⇒ **o campo não decide o saldo.**
 *   · E há uma implicação estrita: **`GeraPendencia = "Sim"` NUNCA aparece sem
 *     `GeraEmpenho = "Sim"`** (66/66). O contrário não vale — 174 itens têm
 *     empenho sem pendência. ⇒ o "Sim" não parece vir da resposta ao diálogo do
 *     atendimento, e sim acompanhar a configuração de empenho da RM.
 *
 * ⇒ Enquanto não fechar, usamos `"Não"`: é o comportamento medido em massa, e a
 *   combinação `pendência Não + empenho Sim` já existe no histórico (174 itens),
 *   então é segura também nas RMs com empenho.
 *
 * ⚠ E a TELA NÃO PERGUNTA sobre pendência (decisão do Pedro, 09/08). Ela
 *   INFORMA o que sobra — ver `resumoDoSaldoRemanescente`. Perguntar algo cuja
 *   resposta não muda nada ensina a clicar sem ler, e o próximo diálogo (o que
 *   importa) leva o mesmo clique automático.
 */
const GERA_PENDENCIA = "Não";

/**
 * ⚠ Constante mágica do Alvo no envelope de lote. Não se sabe o que significa,
 * mas sem ela a chamada não resolve (§2.2). Capturada do Network, não deduzida.
 */
const ORIGEM_CTRL_LOTE = 7;

const ESPECIE_DOCUMENTO = "RM";
const SERIE_DOCUMENTO = "0";
const OPERACAO_LOTE = "Saída";
const OPERACAO_RM = "Retirada";

/** Quantas chamadas de lote correm em paralelo na abertura. Ver `mapearComLimite`. */
const CONCORRENCIA_LOTES = 4;

// ─────────────────────────────────────────────────────────────────────────────
// Erro
// ─────────────────────────────────────────────────────────────────────────────

/** Erro com o status HTTP preservado — a tela distingue 401 de 412 e de rede. */
export class ReqMatAtendimentoError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ReqMatAtendimentoError";
    this.status = status;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export interface LoteDisponivel {
  numeroCtrlLote: string;
  /** Sentinela `.NET` (`0001-01-01`) já normalizado para null pelo mapper. */
  dataValidade: string | null;
  dataFabricacao: string | null;
  /**
   * ⚠ SALDO BRUTO, não "disponível". `QuantidadeReservaLote` e
   * `QuantidadeEmpenhoLote` vêm NULOS do Alvo (§2.2) — este número não desconta
   * reserva nem empenho. E empenho existe: **66 dos 411 itens atendíveis hoje
   * têm `GeraEmpenho = "Sim"`** (medido em 09/08/2026), o que retifica a leitura
   * de que "GeraEmpenho é sempre Não aqui, então não morde".
   */
  saldo: number;
  /**
   * Quantidade ORIGINAL do lote — não o total do atendimento. Serve para a tela
   * mostrar "154 de 350", informação que o Alvo não exibe. **Nunca somar** (§2.3).
   */
  quantidadeBruta: number | null;
  codigoLocArmaz: string | null;
  /** O objeto cru: volta inteiro no `Relacionar`, que espera a lista como veio. */
  raw: unknown;
}

export interface AlocacaoLote {
  numeroCtrlLote: string;
  dataValidade: string | null;
  /** A parte DESTE lote. É esta que soma — `quantidadeBruta` NÃO. */
  quantidade: number;
  /** A linha crua do `Relacionar`, quando a alocação veio dele. */
  linhaRelacionar?: unknown;
}

export interface ItemAtendimento {
  /** 🔴 Do Alvo, nunca do Hub — é parte da PK e o que os lotes referenciam. */
  sequencia: number;
  codigoProduto: string;
  produtoNome: string | null;
  /** A unidade DO ITEM (`CodigoProdUnidMed`), não a do catálogo. */
  unidade: string | null;
  posicaoUnidade: number | null;
  quantidadePedida: number;
  quantidadeJaAtendida: number;
  /** Espelhado do Alvo, NUNCA recalculado (regra 3 da §4). */
  quantidadeSaldo: number;
  /**
   * 🔴 VEM DO HUB (`stock_products.controla_lote`), NUNCA DO ERP.
   *
   * O `ReqMat/Load` não traz `ControlaLote` — ele só aparece na resposta do
   * atendimento e do `Relacionar` (§6.3-N). E **não se infere de "lista de lotes
   * vazia"**: vazio é ambíguo entre "não controla" e "controla e está sem
   * saldo". Medido: 258 produtos `true`, 2.568 `false`, conferido contra quatro
   * espécimes de campo.
   */
  controlaLote: boolean;
  lotesDisponiveis: LoteDisponivel[];
  /** Proposta FEFO **do servidor** (`Relacionar`). O Hub não implementa FEFO. */
  alocacaoSugerida: AlocacaoLote[];
  /** O item cru da leitura. Base do objeto enviado. */
  itemLoad: unknown;
  /** Falha isolada de lote — não derruba a abertura da RM inteira. */
  avisoLotes?: string;
}

export interface AtendimentoAberto {
  numero: string;
  filial: string;
  /** O corpo cru do Load, com as child lists. Metade da comparação da releitura. */
  cabecalhoLoad: unknown;
  status: string | null;
  baixouEstoque: string | null;
  itens: ItemAtendimento[];
  lidoEm: Date;
  avisos: string[];
}

export interface EntradaItemAtendimento {
  sequencia: number;
  /** Quantidade a atender AGORA (não o acumulado). */
  quantidadeAtender: number;
  lotes: Array<{ numeroCtrlLote: string; quantidade: number }>;
}

export interface EntradaEntrega {
  /** Obrigatório — quem veio buscar o material. */
  retirou: string;
  /** Pré-preenchido pelo de-para do usuário logado, editável. */
  entregou: string | null;
  /** Opcional. A operação preenche com o mesmo valor do `entregou` (§F3). */
  conferiu: string | null;
}

export interface EntradaAtendimento {
  itens: EntradaItemAtendimento[];
  entrega: EntradaEntrega;
}

export interface ProblemaValidacao {
  sequencia: number | null;
  campo: string;
  mensagem: string;
}

export interface DivergenciaReleitura {
  campo: string;
  naAbertura: string;
  agora: string;
}

/**
 * O que o ERP diz DEPOIS de um Finalizar que falhou. 🔴 Erro no Finalizar **não
 * é prova de que nada aconteceu** — a tela não pode oferecer nova tentativa sem
 * isto.
 */
export interface EstadoAposFalha {
  consultaOk: boolean;
  baixouEstoque: string | null;
  status: string | null;
  /** Texto pronto para a tela. Diz explicitamente se pode ou não repetir. */
  mensagem: string;
  podeRepetir: boolean;
}

/** Onde o ciclo parou. A tela decide o que oferecer a partir daqui. */
export type FaseAtendimento =
  | "validacao"
  | "livro"
  | "releitura"
  | "validar"
  | "finalizar"
  | "confirmacao"
  | "completo";

export interface ResultadoAtendimento {
  ok: boolean;
  /** Id da linha em `op_rm_atendimentos`. Null quando nem o livro nasceu. */
  livroId: string | null;
  numero: string;
  fase: FaseAtendimento;
  erro?: string;
  /** `atendimento_em_voo`, `rm_ja_atendida`, `sem_permissao`… */
  erroCodigo?: string;
  /** Preenchido quando `fase === "releitura"`. */
  divergencias?: DivergenciaReleitura[];
  /** Preenchido quando `fase === "finalizar"`. 🔴 A tela consulta antes de repetir. */
  estadoIncerto?: EstadoAposFalha;
  /** Problemas das sete validações, quando `fase === "validacao"`. */
  problemas?: ProblemaValidacao[];
  /**
   * O ERP está certo; só o espelho ficou para trás. **Aviso, nunca erro** — o
   * sync conserta em ≤3 h e a RPC `concluir` já carimbou `finalizado`.
   */
  avisoEspelho?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Infra
// ─────────────────────────────────────────────────────────────────────────────

async function jwt(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ReqMatAtendimentoError("Sessão expirada. Faça login novamente.", 401);
  return session.access_token;
}

/**
 * Chamada ao Alvo pelo passthrough. Mesma forma do `alvoReqMatSaveService` —
 * envelope `{ ok, status, data, error }`, status do Alvo preservado.
 *
 * ⚠ Terceira cópia deste helper no repo (as outras estão em
 *   `alvoReqMatSaveService.ts` e `alvoReqMatLoadService.ts`). Não foi extraído
 *   para um módulo comum porque isso mexeria em dois arquivos em produção fora
 *   do escopo da AT-4 — fica como dívida declarada, não como descuido.
 */
async function chamarAlvo(endpoint: string, method: "GET" | "POST", payload?: unknown): Promise<any> {
  const token = await jwt();

  let resp: Response;
  try {
    resp = await fetch(`${ERP_PROXY_URL}/alvo/passthrough`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload === undefined ? { endpoint, method } : { endpoint, method, payload }),
    });
  } catch (e: any) {
    throw new ReqMatAtendimentoError(`Falha de rede ao falar com o gateway: ${e?.message || String(e)}`, 0);
  }

  let envelope: any = null;
  try {
    envelope = await resp.json();
  } catch {
    /* resposta sem corpo JSON */
  }

  const statusAlvo = Number(envelope?.status ?? resp.status);

  if (!resp.ok || envelope?.ok === false) {
    // 🔴 O CORPO ENTRA NA MENSAGEM, nunca só o status. Um 417 sem corpo não
    //    distingue BrokenRulesException (regra de negócio, com nome) de
    //    NullReferenceException (payload incompleto) — e o diagnóstico inteiro
    //    depende dessa distinção (§4.1 do guia operacional).
    const detalhe =
      envelope?.error ||
      envelope?.data?.Message ||
      envelope?.data?.ExceptionMessage ||
      envelope?.data?.MessageDetail;
    throw new ReqMatAtendimentoError(`ERP respondeu ${statusAlvo}${detalhe ? `: ${detalhe}` : ""}`, statusAlvo);
  }

  return envelope?.data ?? null;
}

/**
 * Agora, em horário de Brasília, no formato que o Alvo devolve.
 *
 * 🔴 NÃO derivar do fuso do navegador: o Hub é usado no Brasil **e na Áustria**,
 *    e um `DataEntrega` com offset `+02:00` seria interpretado errado pelo ERP.
 *    Também não passa por `toISOString().split("T")[0] + "T00:00:00-03:00"` (o
 *    padrão de `buildMovEstqPayloadService.ts:468`), que **erra o dia** entre
 *    21h e meia-noite BRT — ali a data UTC já virou.
 *
 * O cálculo é sobre o instante absoluto: desloca o epoch em −3 h e formata as
 * partes em UTC, carimbando o offset à mão. Independe de onde o browser está.
 */
function agoraNoAlvo(): string {
  const OFFSET_BRT_MIN = -180; // sem horário de verão desde 2019
  const d = new Date(Date.now() + OFFSET_BRT_MIN * 60_000);
  const p = (n: number, largura = 2) => String(n).padStart(largura, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}-03:00`
  );
}

/**
 * Executa `fn` sobre `itens` com no máximo `limite` em voo.
 *
 * Motivo medido: uma RM pode ter **até 14 itens com controle de lote** (média
 * 1,7). Sequencial deixaria a abertura lenta; sem limite, 28 chamadas ao
 * gateway de uma vez — que é compartilhado com Suprimentos (100+ usuários),
 * Despesas, Intercompany e NF-e.
 */
async function mapearComLimite<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    for (;;) {
      const i = proximo++;
      if (i >= itens.length) return;
      saida[i] = await fn(itens[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return saida;
}

function n0(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Fator entre a segunda unidade e a principal, derivado DO PRÓPRIO ITEM.
 *
 * 🔴 Os campos "2" NÃO são duplicatas: são a quantidade na unidade escolhida no
 *    item, e a "Principal" é na unidade-base do produto. Medido em 09/08/2026
 *    sobre 2.422 itens do espelho: **53 têm `Quantidade2` diferente de
 *    `QuantidadeProdUnidMedPrincipal`** — produtos `001.003.00015/00016` em
 *    MILHEI (posições 2 e 3), com fator constante **0,001** (mil unidades = 1
 *    milheiro). E o fator se conserva em `QuantidadeAtendida2` e
 *    `QuantidadeSaldo2` em 52 dos 53.
 *
 * ⚠ A única exceção (RM `0000001886`, item 5, `001.007.00020`) é lixo de dado,
 *   não regra: unidade `UNID` posição 1, `Quantidade2 = 126` contra pedido 100,
 *   com 99 atendidos + 27 de saldo = 126. É resíduo de uma edição do item, não
 *   segunda unidade.
 *
 * ⇒ Quando o fator não for finito (pedido zero, campo ausente), devolvemos 1:
 *   espelhar 1:1 é o comportamento dos outros 2.369 itens.
 */
function fatorSegundaUnidade(itemLoad: any): number {
  const i = indexar(itemLoad);
  const principal = num(pick(i, "QuantidadeProdUnidMedPrincipal"));
  const segunda = num(pick(i, "Quantidade2"));
  if (!principal || segunda === null || !Number.isFinite(segunda)) return 1;
  const f = segunda / principal;
  return Number.isFinite(f) && f > 0 ? f : 1;
}

/** Aplica o fator e apara o ruído de ponto flutuante (0,1 + 0,2 e afins). */
function emSegundaUnidade(valor: number, fator: number): number {
  return Number((valor * fator).toFixed(6));
}

// ─────────────────────────────────────────────────────────────────────────────
// ABERTURA — leitura pura
// ─────────────────────────────────────────────────────────────────────────────

/** Envelope comum de `ListaCtrlLoteLocArmaz` e `RelacionarCtrlLoteLocArmaz` (§2.2). */
function envelopeLote(numero: string, itemLoad: unknown, extra?: Record<string, unknown>) {
  const agora = agoraNoAlvo();
  return {
    Origem: ORIGEM_CTRL_LOTE,
    Data: agora,
    DataMovimentacao: agora,
    EspecieDocumento: ESPECIE_DOCUMENTO,
    NumeroDocumento: numero,
    SerieDocumento: SERIE_DOCUMENTO,
    SequenciaDocumento: null,
    OperacaoLote: OPERACAO_LOTE,
    OperacaoRM: OPERACAO_RM,
    CodigoTipoLanc: "",
    ClassInstance: itemLoad,
    ...(extra || {}),
  };
}

function mapearLoteDisponivel(bruto: any): LoteDisponivel | null {
  const i = indexar(bruto);
  const numero = txt(pick(i, "NumeroCtrlLote"));
  if (!numero) return null;
  return {
    numeroCtrlLote: numero,
    // `toTimestamp` do mapper já mata o sentinela `DateTime.MinValue`.
    dataValidade: normalizarData(pick(i, "DataValidadeCtrlLote")),
    dataFabricacao: normalizarData(pick(i, "DataFabricacao")),
    saldo: n0(pick(i, "QuantidadeSaldoProdUnidMedPrincipal")),
    quantidadeBruta: num(pick(i, "QuantidadeBruta")),
    codigoLocArmaz: txt(pick(i, "CodigoLocArmaz")),
    raw: bruto,
  };
}

/**
 * Normalização de data **para EXIBIÇÃO**.
 *
 * ⚠ Só aqui. O que volta ao Alvo no payload do Validar é o que o Alvo mandou,
 *   sentinela e tudo: a regra "normalizar `0001-01-01` para null" é da LEITURA
 *   (decisão 7), e reescrever campos que não pedimos para mexer é exatamente o
 *   que faz o Alvo estourar `NullReferenceException` sem dizer onde.
 */
function normalizarData(v: unknown): string | null {
  const s = txt(v);
  if (!s) return null;
  if (s.startsWith("0001-01-01") || s.startsWith("1900-01-01") || s.startsWith("01/01/0001")) return null;
  return s;
}

/** Lê `controla_lote`, nome e unidade do catálogo do Hub, em lote (nunca N+1). */
async function catalogoDeProdutos(codigos: string[]) {
  const mapa = new Map<string, { nome: string | null; unidade: string | null; controlaLote: boolean }>();
  if (codigos.length === 0) return mapa;
  const { data, error } = await (supabase as any)
    .from("stock_products")
    .select("codigo_produto, nome_produto, unidade_medida, controla_lote")
    .in("codigo_produto", codigos);
  if (error) throw new ReqMatAtendimentoError(`Falha ao ler o catálogo de produtos: ${error.message}`, 500);
  (data || []).forEach((p: any) =>
    mapa.set(p.codigo_produto, {
      nome: p.nome_produto ?? null,
      unidade: p.unidade_medida ?? null,
      controlaLote: p.controla_lote === true,
    }),
  );
  return mapa;
}

/**
 * Lê a RM no Alvo e monta tudo o que a tela precisa para atender. NÃO ESCREVE.
 *
 * Para cada item com saldo e com controle de lote:
 *   `ListaCtrlLoteLocArmaz` → os lotes com validade e saldo (já vêm em FEFO)
 *   `RelacionarCtrlLoteLocArmaz` → 🟢 **o Alvo aloca**; o Hub não implementa FEFO
 *
 * ⚠ Item SEM controle de lote não passa pelo `Relacionar`: não há lote a alocar,
 *   e a classificação contábil (`ItemReqMatClasseRecdespChildList`) **já vem no
 *   próprio item do Load** — medido em 09/08/2026 na RM `0000002277`, o que
 *   retifica o BL-30. Preservá-la é só não montar o item do zero.
 */
export async function abrirAtendimento(numero: string): Promise<AtendimentoAberto> {
  const data = await chamarAlvo(`ReqMat/Load?numero=${encodeURIComponent(numero)}&loadChild=All`, "GET");

  const analise = analisarRespostaReqMat(data);
  if (!analise.ok) {
    throw new ReqMatAtendimentoError(`O ERP devolveu resposta inesperada: ${analise.motivo}`, 502);
  }

  const cabIdx = indexar(analise.cabecalho);
  const status = txt(pick(cabIdx, "Status"));
  const baixouEstoque = txt(pick(cabIdx, "BaixouEstoque"));
  const avisos: string[] = [];

  const itensBrutos = analise.itens || [];
  const codigos = Array.from(
    new Set(itensBrutos.map((it: any) => txt(pick(indexar(it), "CodigoProduto"))).filter(Boolean) as string[]),
  );
  const catalogo = await catalogoDeProdutos(codigos);

  const itens = await mapearComLimite(itensBrutos, CONCORRENCIA_LOTES, async (bruto: any) => {
    const i = indexar(bruto);
    const sequencia = n0(pick(i, "Sequencia"));
    const codigoProduto = txt(pick(i, "CodigoProduto")) || "";
    const saldo = n0(pick(i, "QuantidadeSaldoProdUnidMedPrincipal"));
    const info = catalogo.get(codigoProduto);

    const item: ItemAtendimento = {
      sequencia,
      codigoProduto,
      produtoNome: info?.nome ?? null,
      unidade: txt(pick(i, "CodigoProdUnidMed")),
      posicaoUnidade: num(pick(i, "PosicaoProdUnidMed")),
      quantidadePedida: n0(pick(i, "QuantidadeProdUnidMedPrincipal")),
      quantidadeJaAtendida: n0(pick(i, "QuantidadeAtendidaProdUnidMedPrincipal")),
      quantidadeSaldo: saldo,
      controlaLote: info?.controlaLote ?? false,
      lotesDisponiveis: [],
      alocacaoSugerida: [],
      itemLoad: bruto,
    };

    // 🔴 Produto fora do catálogo do Hub NÃO vira "não controla lote".
    //    Assumir `false` num produto que controla manda o atendimento sem lote,
    //    e o Alvo responde `NullReferenceException` sem dizer qual campo falta.
    //    Hoje a cobertura é total (0 de 411 itens atendíveis fora do catálogo),
    //    mas a falha tem de ser explícita quando aparecer.
    if (!info) {
      item.avisoLotes = `O produto ${codigoProduto} não está no catálogo do Hub — não dá para saber se controla lote. Atualize o cadastro antes de atender este item.`;
      return item;
    }

    if (!item.controlaLote || saldo <= 0) return item;

    try {
      const lista = await chamarAlvo("CtrlLoteLocArmaz/ListaCtrlLoteLocArmaz", "POST", envelopeLote(numero, bruto));
      const brutos = pick(indexar(lista), "ListaCtrlLoteLocArmaz");
      item.lotesDisponiveis = (Array.isArray(brutos) ? brutos : [])
        .map(mapearLoteDisponivel)
        .filter(Boolean) as LoteDisponivel[];

      if (item.lotesDisponiveis.length === 0) {
        // ⚠ Lista vazia NÃO significa "não controla lote" — significa "controla e
        //   não tem saldo neste local". A ambiguidade é a razão de o
        //   `controlaLote` vir do Hub.
        item.avisoLotes = `Nenhum lote com saldo para ${codigoProduto} no local ${txt(pick(i, "CodigoLocArmaz")) || "—"}.`;
        return item;
      }

      // Abre propondo atender TUDO o que resta (§F5). Se o usuário mudar a
      // quantidade, a tela chama `realocarLotesDoItem`.
      item.alocacaoSugerida = await alocarNoServidor(numero, bruto, item.lotesDisponiveis, saldo);
    } catch (e: any) {
      // Falha de lote é POR ITEM: a RM inteira não cai por causa de um produto.
      item.avisoLotes = `Não foi possível carregar os lotes de ${codigoProduto}: ${e?.message || String(e)}`;
    }
    return item;
  });

  itens.forEach((it) => {
    if (it.avisoLotes) avisos.push(`Item ${it.sequencia}: ${it.avisoLotes}`);
  });

  return {
    numero,
    filial: txt(pick(cabIdx, "CodigoEmpresaFilial")) || FILIAL_PADRAO,
    cabecalhoLoad: analise.cabecalho,
    status,
    baixouEstoque,
    itens,
    lidoEm: new Date(),
    avisos,
  };
}

/**
 * Pede ao Alvo a alocação FEFO de `quantidade` sobre os lotes de um item.
 *
 * 🟢 `RelacionarCtrlLoteLocArmaz` **não é conveniência de tela: é o Alvo
 *    alocando** (AT-2). Devolve o item com a `CtrlLoteItemReqMatChildList` já
 *    montada, escolhendo o de validade mais próxima.
 *
 * ⚠ Qual campo do `ClassInstance` carrega "a quantidade a atender" NÃO foi
 *   capturado do Network — o espécime da AT-2 tinha zero atendido, então
 *   acumulado e diferença coincidiam. Preenchemos
 *   `QuantidadeAtendidaProdUnidMedPrincipal` com o ACUMULADO (já atendido + a
 *   atender), que é o valor que o item terá no Validar. O risco é contido: a
 *   proposta é sugestão, e a validação nº 1 (soma dos lotes = quantidade
 *   atendida agora) roda localmente antes de qualquer POST — uma proposta
 *   errada é barrada no Hub, não no ERP.
 */
async function alocarNoServidor(
  numero: string,
  itemLoad: any,
  lotes: LoteDisponivel[],
  quantidadeAtenderAgora: number,
): Promise<AlocacaoLote[]> {
  const i = indexar(itemLoad);
  const jaAtendida = n0(pick(i, "QuantidadeAtendidaProdUnidMedPrincipal"));
  const fator = fatorSegundaUnidade(itemLoad);
  const acumulado = jaAtendida + quantidadeAtenderAgora;

  const classInstance = {
    ...itemLoad,
    QuantidadeAtendidaProdUnidMedPrincipal: acumulado,
    QuantidadeAtendida2: emSegundaUnidade(acumulado, fator),
  };

  const resposta = await chamarAlvo(
    "CtrlLoteLocArmaz/RelacionarCtrlLoteLocArmaz",
    "POST",
    envelopeLote(numero, classInstance, { Lista: lotes.map((l) => l.raw) }),
  );

  const linhas = pick(indexar(resposta), "CtrlLoteItemReqMatChildList");
  if (!Array.isArray(linhas)) return [];

  return linhas
    .map((linha: any) => {
      const li = indexar(linha);
      const numeroLote = txt(pick(li, "NumeroCtrlLote"));
      if (!numeroLote) return null;
      return {
        numeroCtrlLote: numeroLote,
        dataValidade: normalizarData(pick(li, "DataValidadeCtrlLote")),
        // 🔴 `QuantidadeProdUnidMedPrincipal`, NUNCA `QuantidadeBruta` — esta é
        //    o tamanho original do lote (350 num lote de saldo 154).
        quantidade: n0(pick(li, "QuantidadeProdUnidMedPrincipal")),
        linhaRelacionar: linha,
      } as AlocacaoLote;
    })
    .filter(Boolean) as AlocacaoLote[];
}

/**
 * Refaz a proposta FEFO de um item quando o usuário muda a quantidade.
 *
 * Continua sendo LEITURA — o `Relacionar` não escreve no Alvo (foi assim que a
 * AT-2 o capturou, fechando no X sem finalizar).
 */
export async function realocarLotesDoItem(
  aberto: AtendimentoAberto,
  sequencia: number,
  quantidade: number,
): Promise<AlocacaoLote[]> {
  const item = aberto.itens.find((it) => it.sequencia === sequencia);
  if (!item) throw new ReqMatAtendimentoError(`Item ${sequencia} não existe nesta requisição.`, 400);
  if (!item.controlaLote) return [];
  if (!(quantidade > 0)) return [];
  if (item.lotesDisponiveis.length === 0) return [];
  return alocarNoServidor(aberto.numero, item.itemLoad, item.lotesDisponiveis, quantidade);
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO LOCAL — as sete, antes de qualquer POST
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 ERRO DE USUÁRIO NÃO PODE VIRAR EXCEÇÃO DE ERP.
 *
 * O Alvo responde `NullReferenceException` **sem dizer qual campo falta** —
 * quatro tentativas foram perdidas assim em 05/08/2026. As sete verificações
 * abaixo são a §3/AT-4 do plano da fase, na ordem em que estão lá.
 *
 * ⚠ O que NÃO validamos de propósito: atender ACIMA do pedido. O Alvo aceita, e
 *   é assim que `QuantidadeAtendidaMaior` nasce (RM `0000002251`: 100 pedidos,
 *   147 atendidos, excedente 47 carimbado). Bloquear aqui recusaria uma operação
 *   legítima que o ERP permite. A tela avisa; o serviço não impede.
 */
export function validarAtendimento(aberto: AtendimentoAberto, entrada: EntradaAtendimento): ProblemaValidacao[] {
  const problemas: ProblemaValidacao[] = [];

  // (7) A RM está atendível? Cinto e suspensório: a `op_rm_atender_iniciar`
  //     refaz esta checagem no banco, mas a mensagem daqui chega antes e é melhor.
  if ((aberto.status || "") === "Atendida Total") {
    problemas.push({ sequencia: null, campo: "status", mensagem: "Esta requisição já está Atendida Total." });
  }

  let algumComQuantidade = false;

  for (const linha of entrada.itens) {
    const item = aberto.itens.find((it) => it.sequencia === linha.sequencia);
    if (!item) {
      problemas.push({
        sequencia: linha.sequencia,
        campo: "sequencia",
        mensagem: `O item ${linha.sequencia} não existe nesta requisição.`,
      });
      continue;
    }

    const qtd = Number(linha.quantidadeAtender);

    // (6) quantidades numéricas
    if (!Number.isFinite(qtd) || qtd < 0) {
      problemas.push({
        sequencia: item.sequencia,
        campo: "quantidade",
        mensagem: `Quantidade inválida em ${item.codigoProduto}.`,
      });
      continue;
    }
    if (qtd === 0) {
      // Item não atendido nesta rodada — não é erro, só não conta.
      if (linha.lotes.length > 0) {
        problemas.push({
          sequencia: item.sequencia,
          campo: "lotes",
          mensagem: `${item.codigoProduto} tem lote alocado mas quantidade zero.`,
        });
      }
      continue;
    }
    algumComQuantidade = true;

    // (5) produto sem controle de lote NÃO pode ter lote
    if (!item.controlaLote && linha.lotes.length > 0) {
      problemas.push({
        sequencia: item.sequencia,
        campo: "lotes",
        mensagem: `${item.codigoProduto} não controla lote — remova a alocação.`,
      });
      continue;
    }

    if (!item.controlaLote) continue;

    // Produto no catálogo é pré-requisito para saber se controla lote.
    if (item.avisoLotes && item.lotesDisponiveis.length === 0) {
      problemas.push({ sequencia: item.sequencia, campo: "lotes", mensagem: item.avisoLotes });
      continue;
    }

    // (4) produto com controle de lote EXIGE ao menos um
    if (linha.lotes.length === 0) {
      problemas.push({
        sequencia: item.sequencia,
        campo: "lotes",
        mensagem: `${item.codigoProduto} controla lote — informe de qual lote sai a quantidade.`,
      });
      continue;
    }

    let soma = 0;
    const vistos = new Set<string>();
    for (const alocado of linha.lotes) {
      const q = Number(alocado.quantidade);
      if (!Number.isFinite(q) || q <= 0) {
        problemas.push({
          sequencia: item.sequencia,
          campo: "lotes",
          mensagem: `Quantidade inválida no lote ${alocado.numeroCtrlLote} (${item.codigoProduto}).`,
        });
        continue;
      }
      if (vistos.has(alocado.numeroCtrlLote)) {
        problemas.push({
          sequencia: item.sequencia,
          campo: "lotes",
          mensagem: `O lote ${alocado.numeroCtrlLote} aparece duas vezes em ${item.codigoProduto}.`,
        });
        continue;
      }
      vistos.add(alocado.numeroCtrlLote);
      soma += q;

      const disponivel = item.lotesDisponiveis.find((l) => l.numeroCtrlLote === alocado.numeroCtrlLote);
      if (!disponivel) {
        problemas.push({
          sequencia: item.sequencia,
          campo: "lotes",
          mensagem: `O lote ${alocado.numeroCtrlLote} não está entre os disponíveis de ${item.codigoProduto}.`,
        });
        continue;
      }
      // (2) quantidade de cada lote ≤ saldo daquele lote
      // ⚠ Saldo BRUTO: o Alvo não desconta reserva nem empenho (§2.2).
      if (q > disponivel.saldo) {
        problemas.push({
          sequencia: item.sequencia,
          campo: "lotes",
          mensagem: `O lote ${alocado.numeroCtrlLote} tem saldo ${disponivel.saldo} e foram alocados ${q}.`,
        });
      }
    }

    // (1) soma dos lotes = quantidade atendida do item.
    // 🔴 A regra de fechamento do Alvo: a tela dele não deixa salvar com
    //    diferença ≠ 0, e o mesmo vale aqui.
    if (Number(soma.toFixed(6)) !== Number(qtd.toFixed(6))) {
      problemas.push({
        sequencia: item.sequencia,
        campo: "lotes",
        mensagem: `${item.codigoProduto}: alocado ${soma} nos lotes contra ${qtd} a atender — diferença de ${Number(
          (qtd - soma).toFixed(6),
        )}.`,
      });
    }
  }

  // (3) quantidade atendida > 0 em ao menos um item
  if (!algumComQuantidade) {
    problemas.push({ sequencia: null, campo: "itens", mensagem: "Informe a quantidade de ao menos um item." });
  }

  if (!entrada.entrega?.retirou) {
    problemas.push({ sequencia: null, campo: "retirou", mensagem: "Informe quem retirou o material." });
  }

  return problemas;
}

/**
 * O que sobra em aberto depois deste atendimento — para a tela **INFORMAR**, não
 * perguntar (decisão do Pedro, 09/08).
 *
 * O saldo fica na própria RM, no Alvo: ela vai a `Atendida Parcial`, o item
 * guarda `QuantidadeSaldo` e volta a ser atendível quando o material chegar. Não
 * vira outro documento — e a `op_rm_atender_iniciar` só recusa `Atendida Total`.
 */
export function resumoDoSaldoRemanescente(
  aberto: AtendimentoAberto,
  entrada: EntradaAtendimento,
): Array<{ sequencia: number; codigoProduto: string; produtoNome: string | null; restam: number; de: number }> {
  return aberto.itens
    .map((item) => {
      const linha = entrada.itens.find((l) => l.sequencia === item.sequencia);
      const atender = Number(linha?.quantidadeAtender) || 0;
      const restam = Number(Math.max(0, item.quantidadeSaldo - atender).toFixed(6));
      return {
        sequencia: item.sequencia,
        codigoProduto: item.codigoProduto,
        produtoNome: item.produtoNome,
        restam,
        de: item.quantidadeSaldo,
      };
    })
    .filter((r) => r.restam > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// RELEITURA
// ─────────────────────────────────────────────────────────────────────────────

const fmtNum = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });

/**
 * Compara o que a tela abriu com o que o ERP diz AGORA.
 *
 * Compara por SEQUÊNCIA: `QuantidadeAtendidaProdUnidMedPrincipal` e
 * `QuantidadeSaldoProdUnidMedPrincipal` de cada item, mais `Status`,
 * `BaixouEstoque` e a contagem de itens.
 *
 * ⚠ Sem fallback para os campos "2", de propósito: eles são outra unidade, e um
 *   fallback frouxo compararia eixos diferentes.
 */
function compararReleitura(aberto: AtendimentoAberto, cabecalhoAgora: any, itensAgora: any[]): DivergenciaReleitura[] {
  const divs: DivergenciaReleitura[] = [];
  const idx = indexar(cabecalhoAgora);

  const cmp = (campo: string, antes: unknown, agora: unknown) => {
    const a = antes === null || antes === undefined || antes === "" ? "—" : String(antes);
    const b = agora === null || agora === undefined || agora === "" ? "—" : String(agora);
    if (a !== b) divs.push({ campo, naAbertura: a, agora: b });
  };

  cmp("Status", aberto.status, txt(pick(idx, "Status")));
  cmp("Baixou estoque", aberto.baixouEstoque, txt(pick(idx, "BaixouEstoque")));

  if (itensAgora.length !== aberto.itens.length) {
    divs.push({
      campo: "Quantidade de itens",
      naAbertura: String(aberto.itens.length),
      agora: String(itensAgora.length),
    });
  }

  const porSequencia = new Map<number, any>();
  for (const it of itensAgora) {
    const seq = n0(pick(indexar(it), "Sequencia"));
    porSequencia.set(seq, it);
  }

  for (const item of aberto.itens) {
    const agora = porSequencia.get(item.sequencia);
    if (!agora) {
      divs.push({
        campo: `Item ${item.sequencia} (${item.codigoProduto})`,
        naAbertura: "presente",
        agora: "ausente (cancelado ou removido)",
      });
      continue;
    }
    const ai = indexar(agora);
    const atendida = n0(pick(ai, "QuantidadeAtendidaProdUnidMedPrincipal"));
    const saldo = n0(pick(ai, "QuantidadeSaldoProdUnidMedPrincipal"));
    if (atendida !== item.quantidadeJaAtendida) {
      divs.push({
        campo: `Item ${item.sequencia} · atendido`,
        naAbertura: fmtNum.format(item.quantidadeJaAtendida),
        agora: fmtNum.format(atendida),
      });
    }
    if (saldo !== item.quantidadeSaldo) {
      divs.push({
        campo: `Item ${item.sequencia} · saldo`,
        naAbertura: fmtNum.format(item.quantidadeSaldo),
        agora: fmtNum.format(saldo),
      });
    }
  }

  return divs;
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTAGEM DO OBJETO QUE VAI AO VALIDAR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Uma linha de `CtrlLoteItemReqMatChildList`, a genealogia de saída.
 *
 * Partimos da linha que o `Relacionar` devolveu quando ela existe — ela traz os
 * campos resolvidos que o Load não tem. Para lote que o usuário acrescentou por
 * fora da proposta, montamos pelo molde da §2.3.
 *
 * ⚠ `QuantidadeBruta` é COPIADA, nunca calculada: é o tamanho ORIGINAL do lote
 *   (350 num lote com saldo 154), não a parte que sai agora.
 */
function montarLinhaDeLote(
  item: ItemAtendimento,
  itemAgora: any,
  numero: string,
  filial: string,
  alocado: { numeroCtrlLote: string; quantidade: number },
): Record<string, unknown> {
  const proposta = item.alocacaoSugerida.find((a) => a.numeroCtrlLote === alocado.numeroCtrlLote);
  const disponivel = item.lotesDisponiveis.find((l) => l.numeroCtrlLote === alocado.numeroCtrlLote);
  const ii = indexar(itemAgora);
  const fator = fatorSegundaUnidade(itemAgora);
  const di = disponivel ? indexar(disponivel.raw) : null;

  const base: Record<string, unknown> = proposta?.linhaRelacionar
    ? { ...(proposta.linhaRelacionar as Record<string, unknown>) }
    : {
        CodigoEmpresaFilial: filial,
        CodigoProduto: item.codigoProduto,
        NumeroReqMat: numero,
        SequenciaItemReqMat: item.sequencia,
        CodigoLocArmaz: di ? txt(pick(di, "CodigoLocArmaz")) : txt(pick(ii, "CodigoLocArmaz")),
        NumeroCtrlLote: alocado.numeroCtrlLote,
        DataValidadeCtrlLote: di ? pick(di, "DataValidadeCtrlLote") : null,
        Operacao: OPERACAO_LOTE,
        CodigoProdUnidMed: txt(pick(ii, "CodigoProdUnidMed")),
        PosicaoProdUnidMed: num(pick(ii, "PosicaoProdUnidMed")),
        QuantidadeUnidadeItem: alocado.quantidade,
        // Tamanho original do lote — copiado da lista, não inventado.
        QuantidadeBruta: di ? num(pick(di, "QuantidadeBruta")) : null,
        // ⚠ A atendida da LINHA DE LOTE vem zero: a atendida vive no item (§2.3).
        QuantidadeAtendidaProdUnidMedPrincipal: 0,
        QuantidadeAtendida2: 0,
      };

  base.QuantidadeProdUnidMedPrincipal = alocado.quantidade;
  base.Quantidade2 = emSegundaUnidade(alocado.quantidade, fator);
  return base;
}

/**
 * O objeto ReqMat **inteiro**, do jeito que o `ValidarAtendimento` espera —
 * **SEM** o envelope `Action`/`ClassObject` (isso é do `SaveReqMat`, §10.16).
 *
 * TRÊS FONTES, e confundi-las é o BL-30:
 *   · cabeçalho → da **releitura** (o estado mais fresco), mais tipo de
 *     lançamento, atendente, datas e os campos de Entrega;
 *   · itens → da **releitura**, com as quantidades digitadas e `GeraPendencia`;
 *   · `ItemReqMatClasseRecdespChildList` → **preservada do próprio item**, que
 *     já a traz (medido em 09/08, retificando o BL-30). Ausência é NORMAL: só
 *     36 de 232 produtos têm classificação — nunca virar erro de validação.
 *
 * ⚠ Tudo o que não tocamos vai como veio, sentinela de data inclusive. O Alvo
 *   estoura sem dizer onde quando o payload é remexido.
 */
function montarObjetoDeAtendimento(
  aberto: AtendimentoAberto,
  entrada: EntradaAtendimento,
  cabecalhoAgora: any,
  itensAgora: any[],
): Record<string, unknown> {
  const agora = agoraNoAlvo();

  // Iteramos a lista DO ERP (a releitura), não a da abertura: assim um item que
  // esta rodada não atende sai intacto, na ordem e na forma em que o Alvo o
  // mandou.
  const itensMontados = itensAgora.map((itemAgora: any) => {
    const ii = indexar(itemAgora);
    const sequencia = n0(pick(ii, "Sequencia"));
    const item = aberto.itens.find((x) => x.sequencia === sequencia);
    const linha = entrada.itens.find((l) => l.sequencia === sequencia);
    const atender = Number(linha?.quantidadeAtender) || 0;

    // Item que esta rodada não atende sai INTACTO — não é "atendido zero".
    if (!item || atender <= 0) return itemAgora;

    const jaAtendida = n0(pick(ii, "QuantidadeAtendidaProdUnidMedPrincipal"));
    const saldoAgora = n0(pick(ii, "QuantidadeSaldoProdUnidMedPrincipal"));
    const fator = fatorSegundaUnidade(itemAgora);

    // 🔴 ACUMULADA, não "a desta vez". Medido: em 56 de 56 itens parcialmente
    //    atendidos, `atendida + saldo = pedida`.
    const atendida = Number((jaAtendida + atender).toFixed(6));
    // ⚠ AQUI o saldo é CALCULADO — e isso não contradiz a regra "saldo é
    //   espelhado, nunca recalculado". São dois eixos com o mesmo nome: na
    //   LEITURA o saldo se copia do Alvo (ele carimba, e o excedente vai para
    //   `QuantidadeAtendidaMaior` em vez de deixar o saldo negativo); no PAYLOAD
    //   de ENVIO é o Hub que declara quanto sobra (§2.1). Quem "consertar" esta
    //   linha achando que aplica a regra da leitura quebra o envio.
    const saldo = Number(Math.max(0, saldoAgora - atender).toFixed(6));

    return {
      ...itemAgora,
      QuantidadeAtendidaProdUnidMedPrincipal: atendida,
      QuantidadeAtendida2: emSegundaUnidade(atendida, fator),
      QuantidadeSaldoProdUnidMedPrincipal: saldo,
      QuantidadeSaldo2: emSegundaUnidade(saldo, fator),
      DataAtendimento: agora,
      GeraPendencia: GERA_PENDENCIA,
      CtrlLoteItemReqMatChildList: item.controlaLote
        ? (linha?.lotes || []).map((l) => montarLinhaDeLote(item, itemAgora, aberto.numero, aberto.filial, l))
        : [],
    };
  });

  return {
    ...cabecalhoAgora,
    CodigoTipoLanc: CODIGO_TIPO_LANC,
    CodigoFuncionarioAtendente: CODIGO_FUNCIONARIO_ATENDENTE,
    DataEntrega: agora,
    DataConferencia: agora,
    DataRecebimento: agora,
    CodigoFuncionarioEntregou: entrada.entrega.entregou || null,
    CodigoFuncionarioRetirou: entrada.entrega.retirou,
    CodigoFuncionarioConferiu: entrada.entrega.conferiu || null,
    ItemReqMatChildList: itensMontados,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardas do Finalizar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 ÂNCORA DUPLA. `FinalizarAtendimento` com payload ruim responde **200 com um
 * objeto ReqMat em branco** (`Numero: ""`, `Status: "Aberta"`), não erro —
 * medido na AT-1. Aceitar 200 como sucesso é aceitar o fracasso silencioso.
 *
 * Exigimos `AtendimentoRealizado === true` **e** a âncora `Numero`, preenchida e
 * **igual à RM que enviamos**.
 *
 * ⚠ Por que NÃO usamos `analisarRespostaReqMat` inteiro aqui: ele também exige
 *   `ItemReqMatChildList` não-vazio, que é requisito de SEMEADURA e não de
 *   sucesso. Se o Finalizar devolvesse o ReqMat sem child list, um atendimento
 *   BEM-SUCEDIDO seria lido como falho, a tela ofereceria nova tentativa e o
 *   material baixaria duas vezes. A âncora do sucesso é o `Numero` (é o que o
 *   próprio requisito descreve); a análise completa fica para decidir se dá para
 *   semear daquele corpo.
 */
function ancoraDoFinalizar(resposta: any, numeroEsperado: string): { ok: boolean; motivo?: string; reqMat?: any } {
  if (!resposta || typeof resposta !== "object" || Array.isArray(resposta)) {
    return { ok: false, motivo: "o ERP respondeu com corpo que não é objeto" };
  }
  const i = indexar(resposta);
  const realizado = pick(i, "AtendimentoRealizado");
  const reqMat = pick(i, "ReqMat");

  if (realizado !== true) {
    const msgs = pick(i, "Messages");
    const detalhe = Array.isArray(msgs) && msgs.length > 0 ? ` (${msgs.map((m: any) => String(m)).join(" | ")})` : "";
    return { ok: false, motivo: `o ERP devolveu AtendimentoRealizado = ${JSON.stringify(realizado)}${detalhe}` };
  }
  if (!reqMat || typeof reqMat !== "object") {
    return { ok: false, motivo: "resposta sem o objeto ReqMat" };
  }
  const numero = txt(pick(indexar(reqMat), "Numero"));
  if (!numero) {
    return { ok: false, motivo: "resposta com ReqMat em branco (sem âncora Numero) — payload recusado" };
  }
  if (numero !== numeroEsperado) {
    return { ok: false, motivo: `o ERP devolveu a RM ${numero}, e enviamos a ${numeroEsperado}` };
  }
  return { ok: true, reqMat };
}

/**
 * 🔴 ERRO NO FINALIZAR NÃO É PROVA DE QUE NADA ACONTECEU.
 *
 * Antes de a tela oferecer qualquer nova tentativa, perguntamos ao ERP o que ele
 * acha: `BaixouEstoque` e `Status` do cabeçalho. É o mesmo julgamento do
 * "200-sem-Numero" da criação.
 *
 * ⚠ O gateway deixou de repetir chamadas de escrita em 401/403/409 (`NAO_REPETIR`
 *   no `alvo-client.ts`, 09/08/2026). Isso NÃO dispensa esta consulta: o gateway
 *   não repetir não prova que a escrita não chegou.
 */
async function consultarEstadoAposFalha(numero: string): Promise<EstadoAposFalha> {
  try {
    const data = await chamarAlvo(`ReqMat/Load?numero=${encodeURIComponent(numero)}&loadChild=All`, "GET");
    const i = indexar(data);
    const baixou = txt(pick(i, "BaixouEstoque"));
    const status = txt(pick(i, "Status"));
    if (baixou === "Sim") {
      return {
        consultaOk: true,
        baixouEstoque: baixou,
        status,
        podeRepetir: false,
        mensagem:
          `🔴 O ERP registra que a requisição ${numero} JÁ BAIXOU O ESTOQUE (status "${status ?? "—"}"). ` +
          `O material saiu. NÃO tente atender de novo — confira no Alvo antes de qualquer ação.`,
      };
    }
    return {
      consultaOk: true,
      baixouEstoque: baixou,
      status,
      podeRepetir: true,
      mensagem:
        `O ERP não registra baixa de estoque nesta requisição (BaixouEstoque = "${baixou ?? "—"}", ` +
        `status "${status ?? "—"}"). Uma nova tentativa parece segura, mas confira no Alvo antes.`,
    };
  } catch (e: any) {
    return {
      consultaOk: false,
      baixouEstoque: null,
      status: null,
      podeRepetir: false,
      mensagem:
        `🔴 Não foi possível confirmar no ERP se a requisição ${numero} baixou estoque ` +
        `(${e?.message || String(e)}). NÃO repita o atendimento sem conferir no Alvo.`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RPCs do livro
// ─────────────────────────────────────────────────────────────────────────────

/** Normaliza os dois modos de falha: erro do PostgREST e envelope `success:false`. */
async function rpcLivro(nome: string, params: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(nome, params);
  if (error) {
    console.error(`[alvoReqMatAtendimentoService] ${nome} — erro`, {
      code: error.code,
      message: error.message,
      params,
    });
    return { ok: false, mensagem: error.message || `Falha em ${nome}`, codigo: error.code as string | undefined, data: null };
  }
  if (data && typeof data === "object" && data.success === false) {
    return { ok: false, mensagem: data.mensagem || `Falha em ${nome}`, codigo: data.erro_codigo as string | undefined, data };
  }
  return { ok: true, mensagem: undefined as string | undefined, codigo: undefined as string | undefined, data };
}

/**
 * Semeia o espelho e carimba `finalizado`. **Sempre chamada após um Finalizar
 * bem-sucedido**, em três degraus:
 *
 *   1. `ReqMat/Load` de confirmação — a verdade do servidor, com child lists;
 *   2. o `ReqMat` que o **próprio Finalizar** devolveu — também objeto do
 *      servidor, não payload do Hub. (A renumeração de `Sequencia` que obriga a
 *      semear do Load na CRIAÇÃO não se aplica: a RM já existe com sequências
 *      fixas.)
 *   3. os dois falharam → `concluir` com `p_itens = []`. A AT-3.1 fez essa
 *      chamada carimbar `finalizado` com o motivo em vez de recusar.
 *
 * 🔴 Nenhum degrau pode ser pulado: não chamar a `concluir` deixaria o expurgo
 *    de 15 min marcar `abandonado` um atendimento consumado.
 */
async function semear(
  livroId: string,
  numero: string,
  filial: string,
  respostaFinalizar: any,
  reqMatDoFinalizar: any,
): Promise<{ avisoEspelho?: string; erro?: string }> {
  let blocos = null as ReturnType<typeof montarBlocosDoLoad> | null;
  let origem = "nenhuma (degrau 3 — sem blocos)";

  // Degrau 1 — Load de confirmação.
  try {
    const data = await chamarAlvo(`ReqMat/Load?numero=${encodeURIComponent(numero)}&loadChild=All`, "GET");
    const candidato = montarBlocosDoLoad(data, filial, numero);
    if (candidato.ok) {
      blocos = candidato;
      origem = "Load de confirmação";
    }
  } catch {
    /* cai para o degrau 2 */
  }

  // Degrau 2 — o corpo que o Finalizar devolveu.
  if (!blocos && reqMatDoFinalizar) {
    const candidato = montarBlocosDoLoad(reqMatDoFinalizar, filial, numero);
    if (candidato.ok) {
      blocos = candidato;
      origem = "resposta do Finalizar";
    }
  }

  // Qual degrau alimentou a semeadura é a primeira pergunta quando uma RM
  // aparecer estranha na fila. Fica no console, não na tela.
  console.info("[alvoReqMatAtendimentoService] semeadura", { numero, origem });

  const { ok, mensagem, data } = await rpcLivro("op_rm_atender_concluir", {
    p_id: livroId,
    p_numero: numero,
    p_cabecalho: blocos?.cabecalho ?? {},
    // Degrau 3: lista vazia é sinal explícito de "não tenho blocos" — a AT-3.1
    // carimba `finalizado` e registra o motivo.
    p_itens: blocos?.itens ?? [],
    p_lotes: blocos?.lotes ?? [],
    p_raw: blocos?.raw ?? null,
    p_resposta: respostaFinalizar ?? null,
  });

  if (!ok) {
    // Depois do Finalizar a AT-3.1 não devolve mais `success:false`; se acontecer,
    // é falha de infraestrutura (rede, PostgREST) e o livro pode ter ficado sem
    // carimbo. Vira aviso forte, nunca falha do atendimento.
    return {
      erro: mensagem,
      avisoEspelho:
        `O atendimento foi concluído no ERP, mas o Hub não conseguiu registrar o desfecho ` +
        `(${mensagem}). O material JÁ SAIU — não repita. O sync atualiza a lista em até 3 h.`,
    };
  }

  if (data && data.semeado === false) {
    return {
      avisoEspelho:
        `Atendimento concluído no ERP. A lista do Hub ainda não pôde ser atualizada` +
        `${data.mensagem ? ` (${data.mensagem})` : ""} — o sync corrige em até 3 h.`,
    };
  }

  return {};
}

// ─────────────────────────────────────────────────────────────────────────────
// ENVIO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O ciclo completo do envio. Ver o cabeçalho do arquivo para a ordem e o porquê.
 */
export async function enviarAtendimento(
  aberto: AtendimentoAberto,
  entrada: EntradaAtendimento,
): Promise<ResultadoAtendimento> {
  const numero = aberto.numero;
  const filial = aberto.filial || FILIAL_PADRAO;

  // ── Passo 0 — as sete validações, ANTES de tocar em qualquer coisa ──
  const problemas = validarAtendimento(aberto, entrada);
  if (problemas.length > 0) {
    return {
      ok: false,
      livroId: null,
      numero,
      fase: "validacao",
      problemas,
      erro: problemas[0].mensagem,
    };
  }

  // ── Passo 1 — o livro ──
  const inicio = await rpcLivro("op_rm_atender_iniciar", {
    p_numero: numero,
    p_payload: { itens: entrada.itens, entrega: entrada.entrega, aberto_em: aberto.lidoEm.toISOString() },
    // Explícito, sem depender do default da função.
    p_filial: filial,
  });
  if (!inicio.ok) {
    return { ok: false, livroId: null, numero, fase: "livro", erro: inicio.mensagem, erroCodigo: inicio.codigo };
  }
  const livroId = (inicio.data?.id as string) || "";

  // ── Passo 2 — RELEITURA. 🔴 É o que impede baixa em dobro ──
  let cabecalhoAgora: any;
  let itensAgora: any[];
  try {
    const data = await chamarAlvo(`ReqMat/Load?numero=${encodeURIComponent(numero)}&loadChild=All`, "GET");
    const analise = analisarRespostaReqMat(data);
    if (!analise.ok) {
      const motivo = `Não foi possível reler a requisição no ERP antes de enviar: ${analise.motivo}`;
      await rpcLivro("op_rm_atender_marcar", {
        p_id: livroId,
        p_status: "recusado_releitura",
        p_erro: motivo,
        p_releitura: null,
      });
      return { ok: false, livroId, numero, fase: "releitura", erro: motivo };
    }
    cabecalhoAgora = analise.cabecalho;
    itensAgora = analise.itens || [];
  } catch (e: any) {
    const motivo = `Não foi possível reler a requisição no ERP antes de enviar: ${e?.message || String(e)}`;
    await rpcLivro("op_rm_atender_marcar", {
      p_id: livroId,
      p_status: "recusado_releitura",
      p_erro: motivo,
      p_releitura: null,
    });
    return { ok: false, livroId, numero, fase: "releitura", erro: motivo };
  }

  const divergencias = compararReleitura(aberto, cabecalhoAgora, itensAgora);
  if (divergencias.length > 0) {
    const motivo =
      `A requisição mudou no ERP entre a abertura desta tela e o envio ` +
      `(${divergencias.map((d) => `${d.campo}: ${d.naAbertura} → ${d.agora}`).join("; ")}). ` +
      `Nada foi enviado — feche e abra de novo para atender sobre o estado atual.`;
    await rpcLivro("op_rm_atender_marcar", {
      p_id: livroId,
      p_status: "recusado_releitura",
      p_erro: motivo,
      p_releitura: { divergencias, relido_em: new Date().toISOString() },
    });
    return { ok: false, livroId, numero, fase: "releitura", erro: motivo, divergencias };
  }

  // ── Passo 3 — Validar ──
  const objeto = montarObjetoDeAtendimento(aberto, entrada, cabecalhoAgora, itensAgora);

  let objetoCarimbado: any;
  try {
    // ⚠ Objeto INTEIRO, SEM envelope `Action`/`ClassObject`.
    objetoCarimbado = await chamarAlvo("ReqMat/ValidarAtendimento", "POST", objeto);
    const analise = analisarRespostaReqMat(objetoCarimbado);
    if (!analise.ok) {
      const motivo = `O ERP não validou o atendimento: ${analise.motivo}`;
      await rpcLivro("op_rm_atender_marcar", {
        p_id: livroId,
        p_status: "erro",
        p_resposta: objetoCarimbado ?? null,
        p_erro: motivo,
      });
      return { ok: false, livroId, numero, fase: "validar", erro: motivo };
    }
  } catch (e: any) {
    const erro = e?.message || String(e);
    await rpcLivro("op_rm_atender_marcar", { p_id: livroId, p_status: "erro", p_erro: `Validar falhou: ${erro}` });
    return { ok: false, livroId, numero, fase: "validar", erro };
  }

  const marcado = await rpcLivro("op_rm_atender_marcar", {
    p_id: livroId,
    p_status: "validado",
    p_resposta: objetoCarimbado ?? null,
  });
  if (!marcado.ok) {
    // 🔴 Não seguimos para o Finalizar sem rastro no livro: se ele passar e a
    //    rede cair, a linha pré-gravada é o único caminho de reconciliação — e a
    //    `concluir` exige a tentativa em `validado`.
    return {
      ok: false,
      livroId,
      numero,
      fase: "validar",
      erro: `O ERP validou o atendimento, mas o Hub não conseguiu registrar (${marcado.mensagem}). Nada foi finalizado.`,
      erroCodigo: marcado.codigo,
    };
  }

  // ── Passo 4 — Finalizar. Daqui em diante o material pode ter saído ──
  let respostaFinalizar: any = null;
  try {
    // ⚠ O MESMO objeto que o Validar devolveu, sem alteração. Não "corrigir"
    //   Status, BaixouEstoque, TipoFormulario nem TipoAtendimento.
    respostaFinalizar = await chamarAlvo("ReqMat/FinalizarAtendimento", "POST", objetoCarimbado);
  } catch (e: any) {
    const erro = e?.message || String(e);
    const estadoIncerto = await consultarEstadoAposFalha(numero);
    await rpcLivro("op_rm_atender_marcar", {
      p_id: livroId,
      p_status: "erro",
      p_resposta: { erro, estado: estadoIncerto },
      p_erro: `Finalizar falhou: ${erro} — ${estadoIncerto.mensagem}`,
    });
    return { ok: false, livroId, numero, fase: "finalizar", erro, estadoIncerto };
  }

  const ancora = ancoraDoFinalizar(respostaFinalizar, numero);
  if (!ancora.ok) {
    const estadoIncerto = await consultarEstadoAposFalha(numero);
    const motivo = `O ERP respondeu sem confirmar o atendimento: ${ancora.motivo}. ${estadoIncerto.mensagem}`;
    await rpcLivro("op_rm_atender_marcar", {
      p_id: livroId,
      p_status: "erro",
      p_resposta: respostaFinalizar ?? null,
      p_erro: motivo,
    });
    return { ok: false, livroId, numero, fase: "finalizar", erro: motivo, estadoIncerto };
  }

  // ── Passo 5 — semeadura + carimbo. Nunca pulado ──
  const { avisoEspelho, erro } = await semear(livroId, numero, filial, respostaFinalizar, ancora.reqMat);

  // 🔴 O atendimento ACONTECEU. Falha de semeadura é aviso, nunca erro: o ERP é
  //    a verdade, a `concluir` já carimbou e o sync conserta o espelho em ≤3 h.
  return { ok: true, livroId, numero, fase: "completo", avisoEspelho, erro };
}
