// =============================================================================
// MAPPER Alvo → espelho da RM  ·  FONTE ÚNICA  ·  OP-2.8
// =============================================================================
// 🔴 ESTE ARQUIVO É IMPORTADO POR DOIS MUNDOS, E ESSA É A RAZÃO DE ELE EXISTIR:
//
//   · `supabase/functions/sync-reqmat/index.ts`      (Deno · Edge Function)
//   · `src/services/reqMatEspelhoService.ts`         (Vite · navegador)
//
// O sync escreve o espelho 4×/dia a partir do `ReqMat/Load`. Desde a OP-2.8 a
// CRIAÇÃO de RM pelo Hub também escreve o espelho, a partir do MESMO
// `ReqMat/Load` (o passo 3 do ciclo de três passos). Se os dois caminhos
// tivessem mappers próprios, a linha nasceria num formato e o primeiro sync a
// reescreveria noutro — a linha "pisca" na tela e ninguém descobre por quê,
// porque nada erra: os dois lados estão certos, e diferentes.
//
// ⚠ MANTER ESTE ARQUIVO LIVRE DE DEPENDÊNCIAS. Nada de `Deno.*`, nada de
//   `import` de URL (esm.sh), nada de `@/…`. São funções puras sobre JSON — é o
//   que permite que Deno e Vite o compilem sem cerimônia. Um único import de
//   runtime aqui quebra um dos dois lados, e o outro não percebe.
//
// ⚠ E MANTER OS NOMES LITERAIS. Os nomes de campo do Alvo foram confirmados no
//   JSON real da RM 0000002251 (05/08/2026) e reconfirmados na 0000002286
//   (08/08/2026). Não são inferência: não "melhorar" nenhum deles.
//
// ⚠ CAMPOS "2" (`Quantidade2`, `QuantidadeAtendida2`, `QuantidadeSaldo2`,
//   `QuantidadeDevolvida2`…) NÃO são duplicatas nem redundância: são a
//   quantidade na SEGUNDA UNIDADE DE MEDIDA do produto. Ficam no `raw`, FORA do
//   núcleo tipado, de propósito. A família 001.003 tem divergência de unidade
//   documentada (§9.8: 23 produtos com múltiplas unidades, 10 com divergência)
//   ⇒ esses campos VÃO divergir do núcleo em algum produto, e quem somar os dois
//   eixos junto infla a quantidade. Se um dia forem necessários, entram como
//   colunas próprias com a unidade ao lado — nunca misturados com o núcleo.
//
// 🟢 O CONTRATO DAS DUAS ROTAS É O MESMO — MEDIDO, NÃO SUPOSTO (08/08/2026).
//   O `ReqMat/Load` chamado pelo sync (passthrough com `X-System-Secret`) e o
//   chamado pelo navegador (passthrough com o JWT do usuário) foram comparados
//   chave a chave: 103 chaves no corpo do navegador contra 97 no `raw` gravado
//   pelo sync, e as 6 de diferença são EXATAMENTE os 6 arrays que o sync remove
//   ao montar o `raw` (`ItemReqMatChildList`, `ReqMatArqAnexoChildList`,
//   `ReqMatClasseRecDespChildList`, `ReqMatHistDistrSeparadorChildList`,
//   `InformationResult`, `ListaMensagens`). Zero chave escalar divergente, nos
//   dois sentidos. A credencial não muda o corpo.
// =============================================================================

// Filial única em TODO o universo medido (05/08/2026). Continua sendo chave do
// espelho: local é dimensão, filial é constante.
export const FILIAL_PADRAO = "1.01";

// O Alvo é um ERP on-premise brasileiro e devolve datas SEM offset
// ("2026-06-29T00:00:00"), que são horário de Brasília. Gravar assim numa coluna
// timestamptz faria o Postgres assumir UTC e a data "voltaria" um dia ao ser
// exibida no Brasil. Por isso anexamos o offset explícito. (Strings que já vêm
// com Z/±HH:MM passam intactas.)
export const ALVO_TZ_OFFSET = "-03:00";

// ─────────────────────────────────────────────────────────────────────
// Normalizadores (o retorno do Alvo não é tipado — nunca confiar na forma)
// ─────────────────────────────────────────────────────────────────────

/** Índice case-insensitive das chaves do objeto (o Alvo alterna maiúsculas). */
export function indexar(obj: any): Map<string, any> {
  const m = new Map<string, any>();
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) m.set(k.toLowerCase(), v);
  }
  return m;
}

export function pick(idx: Map<string, any>, ...nomes: string[]): any {
  for (const n of nomes) {
    const v = idx.get(n.toLowerCase());
    if (v !== undefined) return v;
  }
  return undefined;
}

export function txt(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

export function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function inteiro(v: any): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

/**
 * Data do Alvo → ISO com offset de Brasília.
 *
 * 🔴 SENTINELA DE DATA DO .NET (medida em 05/08/2026). O cabeçalho da RM traz
 * `DataRecebimento: "0001-01-01T00:00:00-02:00"` — isso é `DateTime.MinValue`,
 * o "vazio" do .NET, NÃO uma data. Note que o sentinela chega COM offset
 * (-02:00, horário de verão histórico de Brasília), então quem testasse só a
 * forma da string o aceitaria: vira uma data real absurda que polui todo filtro
 * por período e ordenação. A guarda é por PREFIXO da data e vale para TODOS os
 * campos de data, cabeçalho e filhos, sem exceção.
 *
 * Aceita ISO ("2026-06-29T00:00:00") e dd/MM/yyyy [HH:mm:ss].
 */
export function toTimestamp(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  // ⚠ Ordem importa: o teste de sentinela vem ANTES de qualquer parsing.
  if (s.startsWith("0001-01-01") || s.startsWith("1900-01-01") || s.startsWith("01/01/0001")) return null;

  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (br) {
    const [, d, mo, y, hh, mi, ss] = br;
    return `${y}-${mo}-${d}T${hh ?? "00"}:${mi ?? "00"}:${ss ?? "00"}${ALVO_TZ_OFFSET}`;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    // Já tem fuso (Z ou ±HH:MM)? Passa intacto.
    if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) return s;
    // Sem hora ("2026-06-29") o offset colaria direto na data e geraria um
    // timestamp inválido — completa a hora antes de carimbar Brasília.
    const base = /\d{2}:\d{2}/.test(s) ? s : `${s}T00:00:00`;
    return `${base}${ALVO_TZ_OFFSET}`;
  }
  return null;
}

/** Mesma normalização, mas para coluna `date` (só YYYY-MM-DD). */
export function toDate(v: any): string | null {
  const ts = toTimestamp(v);
  return ts ? ts.slice(0, 10) : null;
}

// ── Variantes "Opt": distinguem CAMPO AUSENTE de CAMPO VAZIO ──────────
// `undefined` = a chave não veio na resposta ⇒ a coluna NÃO é tocada.
// `null`      = a chave veio vazia/zerada    ⇒ a coluna vira null.
//
// Essa distinção é a razão de existirem. No `rec_laudos` os dois passos escrevem
// colunas DISJUNTAS (21 da lista, 12 do Load), então gravar null por ausência
// nunca fazia mal. Aqui os dois passos escrevem O MESMO conjunto de colunas de
// cabeçalho — sem esta distinção, o passo B zeraria no update um campo que só a
// listagem trouxe.
export function txtOpt(i: Map<string, any>, ...nomes: string[]): string | null | undefined {
  const v = pick(i, ...nomes);
  return v === undefined ? undefined : txt(v);
}
export function numOpt(i: Map<string, any>, ...nomes: string[]): number | null | undefined {
  const v = pick(i, ...nomes);
  return v === undefined ? undefined : num(v);
}
export function inteiroOpt(i: Map<string, any>, ...nomes: string[]): number | null | undefined {
  const v = pick(i, ...nomes);
  return v === undefined ? undefined : inteiro(v);
}
export function tsOpt(i: Map<string, any>, ...nomes: string[]): string | null | undefined {
  const v = pick(i, ...nomes);
  return v === undefined ? undefined : toTimestamp(v);
}
export function dateOpt(i: Map<string, any>, ...nomes: string[]): string | null | undefined {
  const v = pick(i, ...nomes);
  return v === undefined ? undefined : toDate(v);
}

/** Grava a chave só se o valor não for `undefined`. */
export function put(destino: Record<string, any>, coluna: string, valor: any): void {
  if (valor !== undefined) destino[coluna] = valor;
}

// ─────────────────────────────────────────────────────────────────────
// Mappers Alvo → espelho
// ─────────────────────────────────────────────────────────────────────

/**
 * Cabeçalho da RM. Serve AOS TRÊS CAMINHOS: a listagem, o `ReqMat/Load` do sync
 * e o `ReqMat/Load` da criação usam os MESMOS nomes de campo (verificado em
 * campo), então um mapper só elimina a chance de eles divergirem com o tempo.
 *
 * Devolve apenas as chaves presentes na resposta (ver `txtOpt` & cia.).
 */
export function mapearCabecalho(obj: any): Record<string, any> {
  const i = indexar(obj);
  const r: Record<string, any> = {};

  put(r, "data", tsOpt(i, "Data"));
  put(r, "descricao", txtOpt(i, "Descricao"));
  // ⚠ Espelhar o que VOLTOU, nunca o que foi enviado: o CodigoCentroControle
  // mandado no insert é IGNORADO pelo Alvo, que grava o centro derivado do
  // funcionário (§6.2, descoberta 1).
  put(r, "codigo_centro_ctrl", txtOpt(i, "CodigoCentroCtrl"));
  put(r, "codigo_funcionario", txtOpt(i, "CodigoFuncionario"));
  put(r, "especie_documento", txtOpt(i, "EspecieDocumento"));
  put(r, "status", txtOpt(i, "Status"));
  put(r, "baixou_estoque", txtOpt(i, "BaixouEstoque"));
  put(r, "codigo_tipo_lanc", txtOpt(i, "CodigoTipoLanc")); // só no Load
  put(r, "data_entrega", tsOpt(i, "DataEntrega"));
  put(r, "codigo_funcionario_entregou", txtOpt(i, "CodigoFuncionarioEntregou"));
  put(r, "codigo_funcionario_retirou", txtOpt(i, "CodigoFuncionarioRetirou"));
  put(r, "codigo_usuario", txtOpt(i, "CodigoUsuario"));
  put(r, "operacao", txtOpt(i, "Operacao"));
  // "Automático" é o default de nascimento via API e NUNCA atende
  // (n=71, correlação perfeita) — é o único detector de RM nascida morta.
  put(r, "tipo_atendimento", txtOpt(i, "TipoAtendimento"));
  put(r, "data_validade", dateOpt(i, "DataValidade"));
  put(r, "codigo_loc_armaz", txtOpt(i, "CodigoLocArmaz"));
  put(r, "gera_empenho", txtOpt(i, "GeraEmpenho")); // só no Load
  // Régua de vazamento da §10.7: Importação = criada por API (Hub),
  // ManualAlvo = criada na tela do Alvo.
  put(r, "origem", txtOpt(i, "Origem"));
  // ⚠ Pode ser null legitimamente (há RM sem tipo no universo).
  put(r, "codigo_tipo_req_mat", txtOpt(i, "CodigoTipoReqMat"));
  // ⚠ É campo de CABEÇALHO, não de item (retificado em 05/08/2026).
  // Null nos 678, mas espelhado: se um dia for gravável (BL-9), o vínculo OP↔RM
  // pode virar estruturado do lado do ERP.
  put(r, "numero_ord_produc", txtOpt(i, "NumeroOrdProduc"));

  return r;
}

/**
 * Colunas que o PASSO A escreve. É um conjunto FIXO, e isso é deliberado — não é
 * o mesmo critério do passo B.
 *
 * POR QUÊ: o passo A faz upsert EM MASSA. Se as linhas de um mesmo lote tiverem
 * conjuntos de chaves diferentes, o PostgREST resolve a divergência sozinho e o
 * resultado é imprevisível — uma RM à qual faltasse um campo poderia zerar a
 * coluna de outra. Shape fixo elimina a classe inteira de problema.
 *
 * E POR QUE ESTAS: são exatamente as colunas que a LISTAGEM fornece.
 * `codigo_tipo_lanc` e `gera_empenho` ficam de fora porque só existem no
 * `ReqMat/Load` — incluí-las aqui faria o passo A APAGAR, a cada execução, o que
 * o passo B acabou de gravar.
 */
export const COLUNAS_LISTA = [
  "data",
  "descricao",
  "codigo_centro_ctrl",
  "codigo_funcionario",
  "especie_documento",
  "status",
  "baixou_estoque",
  "data_entrega",
  "codigo_funcionario_entregou",
  "codigo_funcionario_retirou",
  "codigo_usuario",
  "operacao",
  "tipo_atendimento",
  "data_validade",
  "codigo_loc_armaz",
  "origem",
  "codigo_tipo_req_mat",
  "numero_ord_produc",
] as const;

export function mapearLista(item: any): Record<string, any> | null {
  const i = indexar(item);
  const numero = txt(pick(i, "Numero"));
  if (!numero) return null;

  const cab = mapearCabecalho(item);
  const linha: Record<string, any> = {
    codigo_empresa_filial: txt(pick(i, "CodigoEmpresaFilial")) ?? FILIAL_PADRAO,
    numero,
    sincronizado_em: new Date().toISOString(),
  };
  // Shape fixo: o que não veio entra como null EXPLÍCITO nesta lista, e só nela.
  // Fora dela, nada é tocado.
  for (const col of COLUNAS_LISTA) linha[col] = cab[col] ?? null;

  // NÃO tocar aqui: codigo_tipo_lanc, gera_empenho, raw, detalhes_carregados_em,
  // load_status_lido, ausente_desde.
  return linha;
}

/**
 * Um item da `ItemReqMatChildList`. Shape fixo (é INSERT).
 *
 * 🔴 A `Sequencia` VEM DO ALVO, NUNCA DO QUE O HUB ENVIOU. Medido na RM
 *    0000002286 (08/08/2026): o Hub mandou `Sequencia: 1` no Insert e o
 *    `ReqMat/Load` devolveu `Sequencia: 2` — o Alvo RENUMERA. Como a sequência é
 *    parte da PK do item e é o que os lotes referenciam
 *    (`op_reqmat_lotes.sequencia_item`), mapear a partir do payload enviado
 *    produziria PK errada hoje e lotes órfãos da FK amanhã, no atendimento.
 */
export function mapearItem(item: any, filial: string, numeroRM: string): Record<string, any> | null {
  const i = indexar(item);
  const sequencia = inteiro(pick(i, "Sequencia"));
  // `sequencia` é NOT NULL e parte da PK — sem ela o insert falharia e derrubaria
  // a transação inteira da RM. Melhor falhar cedo e claro.
  if (sequencia === null) return null;

  return {
    codigo_empresa_filial: filial,
    // O número vem da RM (autoridade), não do `NumeroReqMat` do filho: é ele que
    // fecha a FK com o cabeçalho.
    numero_reqmat: numeroRM,
    sequencia,
    codigo_produto: txt(pick(i, "CodigoProduto")),
    codigo_alternativo_produto: txt(pick(i, "CodigoAlternativoProduto")),
    codigo_prod_unid_med: txt(pick(i, "CodigoProdUnidMed")),
    posicao_prod_unid_med: inteiro(pick(i, "PosicaoProdUnidMed")),
    codigo_loc_armaz: txt(pick(i, "CodigoLocArmaz")),
    quantidade: num(pick(i, "QuantidadeProdUnidMedPrincipal")),
    // O que efetivamente SAIU do estoque. O ledger e o consolidado da OP somam
    // ESTA coluna, nunca `quantidade` (§10.4 e §6.1-1).
    quantidade_atendida: num(pick(i, "QuantidadeAtendidaProdUnidMedPrincipal")),
    // ⚠ JÁ VEM CALCULADO pelo Alvo. Espelhar, NUNCA recalcular: saldo NÃO é
    // quantidade − atendida (o excedente vai para quantidade_atendida_maior e o
    // saldo não fica negativo).
    quantidade_saldo: num(pick(i, "QuantidadeSaldoProdUnidMedPrincipal")),
    // Excedente CARIMBADO pelo Alvo (2251: seq 18 = +47, seq 19 = +121).
    // Não inferir por atendido − pedido.
    quantidade_atendida_maior: num(pick(i, "QuantidadeAtendidaMaior")),
    quantidade_devolvida: num(pick(i, "QuantidadeDevolvidaProdUnidMedPrincipal")),
    quantidade_perdida: num(pick(i, "QuantidadePerdidaProdUnidMedPrincipal")),
    quantidade_separada: num(pick(i, "QuantidadeSeparadaProdUnidMedPrincipal")),
    data_atendimento: toTimestamp(pick(i, "DataAtendimento")),
    data_hora_atendimento: toTimestamp(pick(i, "DataHoraAtendimento")),
    codigo_funcionario_atendente: txt(pick(i, "CodigoFuncionarioAtendente")),
    gera_pendencia: txt(pick(i, "GeraPendencia")),
    gera_empenho: txt(pick(i, "GeraEmpenho")),
    baixa_estoque: txt(pick(i, "BaixaEstoque")),
    cancelado: txt(pick(i, "Cancelado")),
    estornado: txt(pick(i, "Estornado")),
    finalizou_op: txt(pick(i, "FinalizouOP")),
    // ⚠ `numero_ord_produc` NÃO é preenchido aqui: o campo NÃO EXISTE no item —
    // é de cabeçalho (retificado em 05/08/2026). A coluna homônima em
    // op_reqmat_itens veio da OP-2.2 e fica sempre null; está marcada como
    // obsoleta por `comment on` em sql/OP-2.3.sql.
    raw: item,
  };
}

/**
 * Um lote da `CtrlLoteItemReqMatChildList` — a genealogia de SAÍDA nativa do
 * Alvo. O almoxarifado aloca por FEFO e a soma dos lotes bate com o ATENDIDO
 * (5/5 itens multi-lote).
 *
 * `sequenciaPai` é a `Sequencia` do item em que o lote veio aninhado; serve de
 * fallback quando o lote não traz `SequenciaItemReqMat`.
 */
export function mapearLote(
  lote: any,
  filial: string,
  numeroRM: string,
  sequenciaPai: number | null,
): Record<string, any> | null {
  const i = indexar(lote);
  const seqItem = inteiro(pick(i, "SequenciaItemReqMat")) ?? sequenciaPai;
  if (seqItem === null) return null;

  return {
    codigo_empresa_filial: filial,
    numero_reqmat: numeroRM,
    sequencia_item: seqItem,
    codigo_produto: txt(pick(i, "CodigoProduto")),
    codigo_loc_armaz: txt(pick(i, "CodigoLocArmaz")),
    numero_ctrl_lote: txt(pick(i, "NumeroCtrlLote")),
    data_validade_ctrl_lote: toDate(pick(i, "DataValidadeCtrlLote")),
    // O que saiu DESTE lote. `quantidade_bruta` é o tamanho do lote — não
    // confundir.
    quantidade: num(pick(i, "QuantidadeProdUnidMedPrincipal")),
    quantidade_bruta: num(pick(i, "QuantidadeBruta")),
    quantidade_unidade_item: num(pick(i, "QuantidadeUnidadeItem")),
    operacao: txt(pick(i, "Operacao")),
    codigo_prod_unid_med: txt(pick(i, "CodigoProdUnidMed")),
    posicao_prod_unid_med: inteiro(pick(i, "PosicaoProdUnidMed")),
    // `DataFabricacaoLote` e `NumeroLoteFabricante` não têm coluna no espelho
    // (OP-2.2) e ficam no `raw`. ⚠ `NumeroLoteFabricante` é sempre null no Alvo
    // — o lote do fornecedor não entra no ERP (§6.3-I); a coluna existir na
    // resposta não significa que carrega informação.
    raw: lote,
  };
}

/**
 * Coleta os lotes de AMBOS os lugares possíveis, deduplicando.
 *
 * A `CtrlLoteItemReqMatChildList` foi observada aninhada dentro do item, mas os
 * campos do lote incluem `NumeroReqMat` e `SequenciaItemReqMat` — o que sugere
 * que a mesma lista pode aparecer autocontida na raiz do cabeçalho. Ler os dois
 * lugares cobre as duas formas sem adivinhar qual delas o Alvo usa hoje; a dedup
 * impede contagem dobrada se ele usar as duas.
 */
export function coletarLotes(
  cabecalho: any,
  itens: any[],
  filial: string,
  numeroRM: string,
): { lotes: Record<string, any>[]; descartados: number } {
  const brutos: Array<{ lote: any; seqPai: number | null }> = [];

  for (const item of itens) {
    const seqPai = inteiro(pick(indexar(item), "Sequencia"));
    const lista = pick(indexar(item), "CtrlLoteItemReqMatChildList");
    if (Array.isArray(lista)) for (const l of lista) brutos.push({ lote: l, seqPai });
  }

  const naRaiz = pick(indexar(cabecalho), "CtrlLoteItemReqMatChildList");
  if (Array.isArray(naRaiz)) for (const l of naRaiz) brutos.push({ lote: l, seqPai: null });

  const vistos = new Set<string>();
  const saida: Record<string, any>[] = [];
  let descartados = 0;
  for (const { lote, seqPai } of brutos) {
    const assinatura = JSON.stringify(lote);
    if (vistos.has(assinatura)) continue;
    vistos.add(assinatura);
    const linha = mapearLote(lote, filial, numeroRM, seqPai);
    // Lote sem `SequenciaItemReqMat` E sem item pai não tem como ser amarrado —
    // descartar em silêncio perderia genealogia de saída sem deixar rastro. É
    // contado e vira falha da RM em `detalharUma`.
    if (linha) saida.push(linha);
    else descartados++;
  }
  return { lotes: saida, descartados };
}

/**
 * O `raw` do CABEÇALHO: o objeto do Load sem as child lists.
 *
 * Itens e lotes têm o próprio `raw`, e duplicá-los aqui triplicaria o
 * armazenamento do espelho sem acrescentar informação. O critério é
 * estrutural (`Array.isArray`), não uma lista de nomes — assim uma child list
 * nova do Alvo já entra excluída, sem ninguém precisar lembrar dela.
 */
export function rawSemChildLists(cabecalho: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries((cabecalho || {}) as Record<string, any>)) {
    if (Array.isArray(v)) continue;
    out[k] = v;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Análise da resposta do ReqMat/Load
// ─────────────────────────────────────────────────────────────────────
// O Alvo devolve exceção de regra de negócio (BrokenRulesException) com
// **HTTP 200**, então "status 2xx" não é prova de sucesso. A detecção é por
// ESTRUTURA do corpo, nunca por substring no texto inteiro: os campos
// `Descricao`/`Texto`/`Observacao` da RM são livres e podem conter qualquer
// palavra — procurar "erro"/"exception" ali produziria falso-positivo e jogaria
// RMs boas fora da fila.

/** Chaves que só aparecem em envelope de erro do .NET / ASP.NET Web API. */
export const CHAVES_DE_EXCECAO = [
  "ExceptionType",
  "ExceptionMessage",
  "ClassName",
  "StackTrace",
  "StackTraceString",
  "InnerException",
  "BrokenRules",
  "BrokenRulesCollection",
  "Message",
  "MessageDetail",
  "ModelState",
];

function chavesDeExcecaoPresentes(o: any): string[] {
  const i = indexar(o);
  return CHAVES_DE_EXCECAO.filter((c) => pick(i, c) !== undefined);
}

/**
 * Âncora de uma RM de verdade. Exigimos VALOR (não só a chave presente): um
 * envelope de erro que ecoe `"Numero": null` não pode passar por RM.
 */
function temAncoraDeReqMat(o: any): boolean {
  const i = indexar(o);
  const v = pick(i, "Numero");
  return v !== undefined && v !== null && String(v).trim() !== "";
}

export interface AnaliseReqMat {
  ok: boolean;
  cabecalho?: any;
  itens?: any[];
  motivo?: string;
}

export function analisarRespostaReqMat(data: any): AnaliseReqMat {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, motivo: `corpo não é objeto (${data === null ? "null" : typeof data})` };
  }

  const sinais = chavesDeExcecaoPresentes(data);
  if (sinais.length > 0) {
    // Só DENTRO dos campos de mensagem procuramos texto — nunca no corpo
    // inteiro, para não encostar nos campos livres da RM.
    const i = indexar(data);
    const msg = [pick(i, "Message"), pick(i, "MessageDetail"), pick(i, "ExceptionMessage")]
      .filter((v) => typeof v === "string")
      .join(" | ");
    const bindingErrado = /No action was found on the controller/i.test(msg);
    return {
      ok: false,
      motivo: bindingErrado
        ? `binding de parâmetro no Alvo — "No action was found on the controller" (parâmetro que não casa, NÃO action inexistente; §6.3-A)`
        : `envelope de exceção do Alvo (chaves: ${sinais.join(",")})`,
    };
  }

  if (!temAncoraDeReqMat(data)) {
    return { ok: false, motivo: `sem âncora de ReqMat (chaves: ${Object.keys(data).slice(0, 8).join(",")})` };
  }

  const itens = pick(indexar(data), "ItemReqMatChildList");
  if (!Array.isArray(itens)) {
    return { ok: false, motivo: "ItemReqMatChildList ausente ou não é lista" };
  }

  // 🔴 LISTA VAZIA É FALHA, NÃO "RM SEM ITENS".
  // Sem `loadChild=All` as child lists vêm VAZIAS, não ausentes — um cabeçalho
  // com `ItemReqMatChildList: []` é indistinguível de uma RM sem itens. Como NÃO
  // EXISTE RM sem item (não é possível criá-la), a única leitura segura é tratar
  // vazio como falha. Do contrário, um Load degradado apagaria os filhos bons de
  // uma RM inteira via DELETE+INSERT. Mesmo julgamento do REC-2.0 com
  // `ItemMovEstqChildList` vazio.
  if (itens.length === 0) {
    return {
      ok: false,
      motivo: "ItemReqMatChildList VAZIO — não existe RM sem item; sintoma de loadChild ausente/degradado",
    };
  }

  return { ok: true, cabecalho: data, itens };
}

// ─────────────────────────────────────────────────────────────────────
// Montagem completa dos três blocos, a partir de UM `ReqMat/Load`
// ─────────────────────────────────────────────────────────────────────

export interface BlocosEspelho {
  ok: boolean;
  motivo?: string;
  cabecalho?: Record<string, any>;
  itens?: Record<string, any>[];
  lotes?: Record<string, any>[];
  raw?: Record<string, any>;
  statusLido?: string | null;
}

/**
 * Do corpo cru do `ReqMat/Load` aos quatro argumentos da RPC
 * `op_reqmat_aplicar_load` — com TODAS as guardas estruturais no caminho.
 *
 * É o que o sync e a criação têm em comum, e por isso vive aqui: os dois
 * precisam exatamente das mesmas verificações, na mesma ordem, com as mesmas
 * mensagens. Quem chama decide o que fazer com a falha (o sync deixa a RM na
 * fila; a criação avisa a tela) — a decisão de SE falhou é uma só.
 */
export function montarBlocosDoLoad(data: any, filial: string, numeroRM: string): BlocosEspelho {
  const analise = analisarRespostaReqMat(data);
  if (!analise.ok) return { ok: false, motivo: analise.motivo || "resposta inesperada do ReqMat/Load" };

  const cabecalhoBruto = analise.cabecalho;
  const itensBrutos = analise.itens || [];

  const itens: Record<string, any>[] = [];
  for (const bruto of itensBrutos) {
    const linha = mapearItem(bruto, filial, numeroRM);
    // Item sem `Sequencia` derrubaria o insert (NOT NULL + PK) e com ele a
    // transação inteira. Falha da RM, cedo e com motivo claro.
    if (!linha) return { ok: false, motivo: "item sem Sequencia numérica — Load inconsistente" };
    itens.push(linha);
  }

  const { lotes, descartados } = coletarLotes(cabecalhoBruto, itensBrutos, filial, numeroRM);
  if (descartados > 0) {
    return { ok: false, motivo: `${descartados} lote(s) sem sequência de item identificável — Load inconsistente` };
  }

  // Um lote cuja `sequencia_item` não existe entre os itens violaria a FK e
  // derrubaria a transação com um erro opaco. Detectar aqui dá motivo legível e
  // mantém a RM íntegra no espelho.
  const sequencias = new Set(itens.map((it) => it.sequencia));
  const orfaos = lotes.filter((l) => !sequencias.has(l.sequencia_item));
  if (orfaos.length > 0) {
    return {
      ok: false,
      motivo:
        `${orfaos.length} lote(s) com sequencia_item sem item correspondente ` +
        `(itens: ${Array.from(sequencias).join(",")}) — Load inconsistente`,
    };
  }

  return {
    ok: true,
    // Omissão fina: um campo ausente na resposta não pode zerar o que a listagem
    // trouxe. Ver `txtOpt` & cia.
    cabecalho: mapearCabecalho(cabecalhoBruto),
    itens,
    lotes,
    raw: rawSemChildLists(cabecalhoBruto),
    statusLido: txt(pick(indexar(cabecalhoBruto), "Status")),
  };
}
