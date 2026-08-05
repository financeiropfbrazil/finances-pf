// =====================================================================
// Edge Function: sync-reqmat   (OP-2.3 · módulo Ordem de Produção)
// =====================================================================
// Espelha a REQUISIÇÃO DE MATERIAL do ERP Alvo em três tabelas:
//   public.op_reqmat        (cabeçalho)
//   public.op_reqmat_itens  (itens)
//   public.op_reqmat_lotes  (lotes do item — genealogia de SAÍDA)
//
// ⚠ REGRA PERMANENTE: esta função NUNCA escreve em `op_requisicoes`.
//   Aquela tabela é o LIVRO DO HUB — o vínculo OP↔RM, gravado na criação
//   da requisição. O espelho é retrato do Alvo; o livro é conhecimento
//   nosso. Misturar os dois mata o vínculo no primeiro upsert (§10.14).
//
// ESTA FUNÇÃO SÓ LÊ O ALVO. `GetListForComponents` é leitura (POST por
// causa do corpo de filtro) e `ReqMat/Load` é GET. Nenhuma escrita no
// ERP, em nenhuma hipótese.
//
// ─────────────────────────────────────────────────────────────────────
// DOIS PASSOS NA MESMA EXECUÇÃO
// ─────────────────────────────────────────────────────────────────────
//   A) LISTA — 1 chamada a `reqMat/GetListForComponents` (ano corrente).
//      Upsert por (codigo_empresa_filial, numero). A listagem devolve 55
//      campos e cobre TODO o núcleo do cabeçalho MENOS DOIS
//      (`CodigoTipoLanc` e `GeraEmpenho`, que só existem no Load) —
//      medido em campo em 05/08/2026. No fim do passo A roda a checagem
//      de ausência (ver `marcarAusencias`).
//
//   B) DETALHE — até LOAD_BATCH registros, um `ReqMat/Load` cada,
//      gravando os itens, os lotes, as duas colunas que faltavam e o
//      carimbo de estado. O teto existe para não estourar o tempo da
//      função; o cron completa nas execuções seguintes.
//
// REGRA DE OURO DO PASSO B: `detalhes_carregados_em` só é carimbado em
// SUCESSO, e o carimbo é feito DENTRO da RPC transacional, no mesmo
// commit dos filhos. Em falha: nada é gravado, o número entra em
// `sync_runs.detalhes` (agregado, até 20 números com a contagem total) e
// a execução SEGUE com as demais RMs.
//
// ─────────────────────────────────────────────────────────────────────
// POR QUE A FILA NÃO USA A ORDEM DO MOLDE (`sync-laudos`)
// ─────────────────────────────────────────────────────────────────────
// No `rec_laudos`, `precisa_releitura` ZERA depois da releitura (ela só
// compara status lido × status atual), então ordenar por
// `enriquecido_em desc` põe quem-mudou na frente e a fila drena.
//
// Aqui NÃO zera. A coluna gerada de `op_reqmat` tem a cláusula
// `status <> 'Atendida Total'`, então toda RM `Aberta` ou
// `Atendida Parcial` fica na fila PARA SEMPRE, por desenho — releitura
// por STATUS, não por data (§10.12-2: a 2187 está aberta há 30 dias e
// ainda pode ser atendida). Com a ordem do molde, as mesmas N RMs
// recém-lidas voltariam ao topo a cada execução e as antigas nunca
// seriam alcançadas.
//
// Ordem adotada (varredura circular, com prioridade de tipo):
//   1. `codigo_tipo_req_mat` asc NULLS LAST
//   2. `detalhes_carregados_em` asc NULLS FIRST   (nunca lida primeiro)
//   3. `data` desc
//
// (1) existe porque 60% do universo NÃO é material de produção e nenhuma
// tela do módulo OP o consulta. `'0000002'` (REQUISIÇÃO PRODUÇÃO) é o
// MENOR código entre os quatro tipos observados — `'0000004'`,
// `'0000005'` e `null` —, então o `asc NULLS LAST` já entrega a
// prioridade pedida SEM expressão CASE, o que mantém o índice
// `idx_op_reqmat_fila` utilizável.
// ⚠ Se um dia aparecer um tipo lexicograficamente MENOR que `'0000002'`
//   (ex.: `'0000001'`), ele passa na frente da produção. Os tipos
//   conhecidos do cadastro são 0000002/0000003/0000004/0000005, todos
//   ≥ 0000002, então hoje a coincidência é segura — mas é coincidência,
//   e está escrita aqui para não virar surpresa.
// (2) e (3) fazem a varredura circular: ninguém fica para trás.
//
// ─────────────────────────────────────────────────────────────────────
// O ESPELHO NÃO FILTRA POR TIPO — QUEM FILTRA É QUEM CONSOME
// ─────────────────────────────────────────────────────────────────────
// São QUATRO tipos de ReqMat no universo (medido em 05/08/2026, n=678):
//   '0000002' REQUISIÇÃO PRODUÇÃO (279)  ·  '0000004' SAÍDA CONSUMO
//   '0000005' (NÃO documentado — candidato a DEVOLUÇÃO, §6.1-3)
//   null      (requisição sem tipo)
//
// O espelho é RETRATO FIEL: os quatro entram, sem filtro. Mas:
//
// 🔴 O CONSOLIDADO DA OP e a MÉTRICA DE VAZAMENTO (§10.7) DEVEM filtrar
//    `codigo_tipo_req_mat = '0000002'`. Somar saída de material de
//    consumo como material de produção seria erro SILENCIOSO — infla o
//    "disponibilizado" da OP com material que nunca entrou na produção.
//    Vale para a OP-2.4 (tela) e para qualquer view futura.
//
// ⚠ E o mapper NÃO pode assumir `CodigoTipoReqMat` não-nulo em lugar
//   nenhum: `null` é um valor real e frequente neste universo.
//
// ─────────────────────────────────────────────────────────────────────
// ACESSO AO ALVO
// ─────────────────────────────────────────────────────────────────────
// Sempre via gateway erp-proxy, rota /alvo/passthrough, autenticado por
// X-System-Secret — o mesmo padrão server-to-server dos outros crons.
//
// ⚠ A whitelist do gateway é CASE-SENSITIVE e, ao contrário do laudo,
//   aqui NÃO há a variante alternativa cadastrada. As duas grafias
//   liberadas em `erp-proxy` (commit 45db047) são, LITERALMENTE:
//       "reqMat/GetListForComponents"   ← r minúsculo
//       "ReqMat/Load"                   ← R maiúsculo
//   Trocar a caixa = 403. Não "normalizar" estas strings.
//
// MAPEAMENTO sync_runs → semântica deste job (siga isto ao ler o histórico):
//   total_candidatos  = RMs que o Alvo listou
//   total_consultados = RMs gravadas (insert + update) no espelho
//   total_mudaram     = RMs detalhadas via ReqMat/Load nesta execução
//   total_erros       = falhas (lista, gravação, Load ou ausência)
//
// SECRETS (reusados dos outros crons):
//   CRON_SECRET, ERP_PROXY_URL, ERP_PROXY_SYSTEM_SECRET,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// PRÉ-REQUISITO DE BANCO (sql/OP-2.3.sql, aplicado pelo Pedro):
//   · `sync_runs_job_type_check` estendido com 'reqmat' — sem isso a
//     função morre no PASSO ZERO, ao abrir o registro de execução, sem
//     sequer chamar o ERP (regra permanente da REC-1.2, §9.4);
//   · colunas `codigo_tipo_req_mat` e `numero_ord_produc` em op_reqmat;
//   · RPC `op_reqmat_aplicar_load`.
//
// DEPLOY (Pedro, no PowerShell):
//   supabase functions deploy sync-reqmat \
//     --no-verify-jwt --project-ref hbtggrbauguukewiknew
// =====================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ─────────────────────────────────────────────────────────────────────
// Configuração
// ─────────────────────────────────────────────────────────────────────

// Filial única em TODO o universo medido (05/08/2026) — por isso o
// Filter da listagem fica no mínimo, sem `CodigoEmpresaFilial`.
// Continua sendo chave do espelho: local é dimensão, filial é constante.
const FILIAL_PADRAO = "1.01";

// ⚠ PageSize NÃO é folga aqui, é necessidade. Medido em 05/08/2026: SEM
// Filter a resposta veio com EXATAMENTE 2000 registros — o universo
// histórico estoura o teto. O recorte por ano é OBRIGATÓRIO, e a
// detecção `retornados == PageSize` ⇒ possivel_truncacao é o que impede
// o job de tratar uma lista cortada como "o ano inteiro" (o que faria a
// checagem de ausência marcar RMs vivas como sumidas).
// Volume de 2026 YTD: 678 (~97/mês ⇒ projeção ~1.160/ano). 2000 dá ~1,7×.
const LIST_PAGE_SIZE = 2000;

// Teto de Loads por execução. ⚠ NÃO MEDIDO ainda para esta entidade: o
// `Laudo/Load` levava 1–3 s e o `MovEstq/Load` ~370 ms, mas o
// `ReqMat/Load` traz 22 itens + lotes por RM e deve ser mais pesado.
// 60 é conservador de propósito — o gateway é compartilhado com
// Suprimentos (100+ usuários), Despesas, Intercompany e NF-e, e a §9.7
// registra que ESPAÇAR É PREFERÍVEL A ACELERAR. Calibrar depois do 1º
// disparo, olhando `duracao_ms` em sync_runs.
const LOAD_BATCH = 60;

const LOAD_CHUNK = 4;
const SLEEP_BETWEEN_CHUNKS_MS = 250;

// Margem antes do teto de 150s de RESPOSTA da Edge Function. Ao estourar,
// paramos o passo B e devolvemos o parcial (o que já foi gravado fica; a
// próxima execução continua de onde parou).
const WATCHDOG_MS = 110_000;

// Tamanho da PÁGINA nas leituras que varrem o espelho (universo do ano na
// checagem de ausência).
// ⚠ NÃO trocar por um `.limit()` grande: o PostgREST corta a resposta em
// `db-max-rows` (1.000 por padrão no Supabase) SEM erro e SEM aviso.
// Paginamos por `.range()` e avançamos pelo que efetivamente voltou.
const PAGINA_LEITURA = 1000;

// Trava de sanidade da paginação (nunca deve ser alcançada). Existe para
// um bug de paginação não virar loop infinito dentro da Edge Function.
const MAX_PAGINAS = 50;

// O Alvo é um ERP on-premise brasileiro e devolve datas SEM offset
// ("2026-06-29T00:00:00"), que são horário de Brasília. Gravar assim numa
// coluna timestamptz faria o Postgres assumir UTC e a data "voltaria" um
// dia ao ser exibida no Brasil. Por isso anexamos o offset explícito.
// (Strings que já vêm com Z/±HH:MM passam intactas.)
const ALVO_TZ_OFFSET = "-03:00";

// Teto da marcação de ausência: acima disso trata-se como falha de
// listagem, não como exclusão real. Ver `marcarAusencias`.
const LIMITE_AUSENCIA_PCT = 0.05;

// REQUISIÇÃO PRODUÇÃO. É o único tipo que o consolidado da OP soma.
const TIPO_PRODUCAO = "0000002";

// Status observados em campo (n=678, 05/08/2026). O literal terminal
// 'Atendida Total' da coluna gerada `precisa_releitura` está CONFIRMADO.
// Qualquer valor fora deste conjunto vira ERRO em sync_runs.detalhes —
// não altera comportamento nenhum (a falha seria reler demais, que é
// segura), mas não pode passar despercebido.
const STATUS_CONHECIDOS = new Set(["Aberta", "Atendida Parcial", "Atendida Total"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────

interface Detalhe {
  etapa: "lista" | "gravacao" | "load" | "ausencia" | "watchdog" | "exception";
  numero?: string;
  erro?: string;
  info?: string;
}

interface ResultadoSync {
  listados: number;
  inseridos: number;
  atualizados: number;
  detalhados: number;
  itens_gravados: number;
  lotes_gravados: number;
  pendentes_detalhe: number;
  erros: number;
  possivel_truncacao: boolean;
  parado_por_watchdog: boolean;
  detalhes: Detalhe[];

  /** Números das RMs que FALHARAM no `ReqMat/Load`. Nenhuma teve
   *  `detalhes_carregados_em` carimbado, então todas voltam na próxima
   *  execução. Vira UMA entrada agregada em `sync_runs.detalhes`. */
  falhas_load: string[];
  /** motivo → quantas vezes ocorreu (diagnóstico barato, sem inchar). */
  falhas_motivos: Record<string, number>;

  /** Flag de ausência (molde do REC-3.0-B). */
  marcados_ausentes: number;
  ausentes_limpos: number;
  ausentes_numeros: string[];
  reaparecidos_numeros: string[];

  /** RMs no espelho com `data` NULL — ficam FORA do recorte da checagem
   *  de ausência e nunca são avaliadas. É o ponto cego do recorte, e
   *  precisa ser contado para não virar silêncio. */
  espelho_sem_data: number;

  /** Agregações de status. As duas fontes são medidas SEPARADAMENTE de
   *  propósito: divergência entre elas é exatamente o que causa
   *  releitura eterna (`load_status_lido` que nunca alcança `status`). */
  status_lista: Record<string, number>;
  status_load: Record<string, number>;
  status_desconhecidos: string[];

  /** Chaves do 1º registro da listagem. Só é reportado quando o espelho
   *  estava vazio (1ª execução) — é a forma barata de documentar quais
   *  campos a listagem realmente devolve, sem uma segunda sessão de
   *  console. */
  campos_lista: string[];

  /** Distribuição por tipo de ReqMat, para acompanhar o universo (o
   *  espelho não filtra, mas o consolidado da OP filtra '0000002'). */
  tipos_lista: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────
// Gateway erp-proxy → /alvo/passthrough
// ─────────────────────────────────────────────────────────────────────
// O passthrough devolve um ENVELOPE { ok, status, data, error } com a
// resposta crua do Alvo em `data`. Taxonomia de falha (§6.3-N, quatro
// causas — a diferença está em QUEM respondeu):
//   401 = proxy   · X-System-Secret ausente/errado
//   403 = proxy   · endpoint fora da whitelist (corpo traz o nome)
//   404 + corpo ASP.NET = ALVO · action inexistente OU parâmetro
//         obrigatório faltando. NÃO é sintoma de whitelist.
//   200 + corpo de exceção = ALVO · regra de negócio
async function callPassthrough(
  erpUrl: string,
  systemSecret: string,
  endpoint: string,
  method: "GET" | "POST",
  payload?: unknown,
): Promise<{ ok: boolean; status: number; data: any; erro?: string }> {
  let resp: Response;
  try {
    resp = await fetch(`${erpUrl}/alvo/passthrough`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-System-Secret": systemSecret },
      body: JSON.stringify({ endpoint, method, payload }),
    });
  } catch (e: any) {
    return { ok: false, status: 0, data: null, erro: `fetch ao gateway falhou: ${e?.message || String(e)}` };
  }

  let body: any = null;
  try {
    body = await resp.json();
  } catch {
    // sem corpo JSON
  }

  // Erro do próprio gateway (401 auth / 403 whitelist) — sem envelope.
  if (!resp.ok && (body === null || body?.ok === undefined)) {
    const motivo =
      resp.status === 401
        ? "401 — X-System-Secret inválido/ausente no gateway"
        : resp.status === 403
          ? `403 — endpoint fora da whitelist do gateway (${endpoint.split("?")[0]}) — a whitelist é CASE-SENSITIVE`
          : `HTTP ${resp.status}`;
    return { ok: false, status: resp.status, data: body, erro: `${motivo}: ${body?.error || ""}`.trim() };
  }

  const alvoStatus = Number(body?.status ?? resp.status);
  if (body?.ok === false || !resp.ok) {
    const motivo =
      alvoStatus === 417
        ? "417 — payload rejeitado pelo Alvo"
        : alvoStatus === 404
          ? "404 — resposta do ALVO (action inexistente ou parâmetro obrigatório faltando), NÃO whitelist"
          : `Alvo HTTP ${alvoStatus}`;
    return { ok: false, status: alvoStatus, data: body?.data ?? null, erro: `${motivo}: ${body?.error || ""}`.trim() };
  }

  return { ok: true, status: alvoStatus, data: body?.data ?? null };
}

// ─────────────────────────────────────────────────────────────────────
// Normalizadores (o retorno do Alvo não é tipado — nunca confiar na forma)
// ─────────────────────────────────────────────────────────────────────

/** Índice case-insensitive das chaves do objeto (o Alvo alterna maiúsculas). */
function indexar(obj: any): Map<string, any> {
  const m = new Map<string, any>();
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) m.set(k.toLowerCase(), v);
  }
  return m;
}

function pick(idx: Map<string, any>, ...nomes: string[]): any {
  for (const n of nomes) {
    const v = idx.get(n.toLowerCase());
    if (v !== undefined) return v;
  }
  return undefined;
}

function txt(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function inteiro(v: any): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

/**
 * Data do Alvo → ISO com offset de Brasília.
 *
 * 🔴 SENTINELA DE DATA DO .NET (medida em 05/08/2026). O cabeçalho da RM
 * traz `DataRecebimento: "0001-01-01T00:00:00-02:00"` — isso é
 * `DateTime.MinValue`, o "vazio" do .NET, NÃO uma data. Note que o
 * sentinela chega COM offset (-02:00, horário de verão histórico de
 * Brasília), então quem testasse só a forma da string o aceitaria: vira
 * uma data real absurda que polui todo filtro por período e ordenação.
 * A guarda é por PREFIXO da data e vale para TODOS os campos de data,
 * cabeçalho e filhos, sem exceção.
 *
 * Aceita ISO ("2026-06-29T00:00:00") e dd/MM/yyyy [HH:mm:ss].
 */
function toTimestamp(v: any): string | null {
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
function toDate(v: any): string | null {
  const ts = toTimestamp(v);
  return ts ? ts.slice(0, 10) : null;
}

// ── Variantes "Opt": distinguem CAMPO AUSENTE de CAMPO VAZIO ──────────
// `undefined` = a chave não veio na resposta ⇒ a coluna NÃO é tocada.
// `null`      = a chave veio vazia/zerada    ⇒ a coluna vira null.
//
// Essa distinção é a razão de existirem. No `rec_laudos` os dois passos
// escrevem colunas DISJUNTAS (21 da lista, 12 do Load), então gravar null
// por ausência nunca fazia mal. Aqui os dois passos escrevem O MESMO
// conjunto de colunas de cabeçalho — sem esta distinção, o passo B
// zeraria no update um campo que só a listagem trouxe.
function txtOpt(i: Map<string, any>, ...nomes: string[]): string | null | undefined {
  const v = pick(i, ...nomes);
  return v === undefined ? undefined : txt(v);
}
function numOpt(i: Map<string, any>, ...nomes: string[]): number | null | undefined {
  const v = pick(i, ...nomes);
  return v === undefined ? undefined : num(v);
}
function inteiroOpt(i: Map<string, any>, ...nomes: string[]): number | null | undefined {
  const v = pick(i, ...nomes);
  return v === undefined ? undefined : inteiro(v);
}
function tsOpt(i: Map<string, any>, ...nomes: string[]): string | null | undefined {
  const v = pick(i, ...nomes);
  return v === undefined ? undefined : toTimestamp(v);
}
function dateOpt(i: Map<string, any>, ...nomes: string[]): string | null | undefined {
  const v = pick(i, ...nomes);
  return v === undefined ? undefined : toDate(v);
}

/** Grava a chave só se o valor não for `undefined`. */
function put(destino: Record<string, any>, coluna: string, valor: any): void {
  if (valor !== undefined) destino[coluna] = valor;
}

/** Conta ocorrências num agregador simples. */
function contar(mapa: Record<string, number>, chave: string): void {
  mapa[chave] = (mapa[chave] || 0) + 1;
}

/**
 * Extrai o array de registros da resposta do `reqMat/GetListForComponents`.
 *
 * ⚠ Medido em 05/08/2026: `data` é ARRAY PURO, sem chave de wrapper.
 * NÃO existe `Registros`/`Items`/`Result` aqui — o molde do `sync-laudos`
 * tem um extrator que tenta essas chaves porque o envelope dele nunca
 * tinha sido visto de dentro de código. O nosso foi. Procurar wrapper
 * seria inventar um caminho não observado; se a forma mudar, queremos
 * FALHA VISÍVEL, não um fallback silencioso que encontre "algum array".
 */
function extrairLista(data: any): { itens: any[]; motivo?: string } {
  if (Array.isArray(data)) return { itens: data };
  const desc =
    data === null
      ? "null"
      : typeof data === "object"
        ? `objeto (chaves: ${Object.keys(data).slice(0, 12).join(",")})`
        : typeof data;
  return { itens: [], motivo: `resposta do GetListForComponents não é array — veio ${desc}` };
}

// ─────────────────────────────────────────────────────────────────────
// Mappers Alvo → espelho
// ─────────────────────────────────────────────────────────────────────
// NOMES LITERAIS confirmados no JSON real da RM 0000002251 (05/08/2026).
// Não são inferência: não "melhorar" nenhum destes nomes.
//
// ⚠ CAMPOS "2" (`Quantidade2`, `QuantidadeAtendida2`, `QuantidadeSaldo2`,
//   `QuantidadeDevolvida2`…) NÃO são duplicatas nem redundância: são a
//   quantidade na SEGUNDA UNIDADE DE MEDIDA do produto. Ficam no `raw`,
//   FORA do núcleo tipado, de propósito. A família 001.003 tem
//   divergência de unidade documentada (§9.8: 23 produtos com múltiplas
//   unidades, 10 com divergência) ⇒ esses campos VÃO divergir do núcleo
//   em algum produto, e quem somar os dois eixos junto infla a
//   quantidade. Se um dia forem necessários, entram como colunas
//   próprias com a unidade ao lado — nunca misturados com o núcleo.

/**
 * Cabeçalho da RM. Serve AOS DOIS PASSOS: a listagem e o `ReqMat/Load`
 * usam os MESMOS nomes de campo (verificado em campo), então um mapper
 * só elimina a chance de os dois divergirem com o tempo.
 *
 * Devolve apenas as chaves presentes na resposta (ver `txtOpt` & cia.).
 */
function mapearCabecalho(obj: any): Record<string, any> {
  const i = indexar(obj);
  const r: Record<string, any> = {};

  put(r, "data", tsOpt(i, "Data"));
  put(r, "descricao", txtOpt(i, "Descricao"));
  // ⚠ Espelhar o que VOLTOU, nunca o que foi enviado: o
  // CodigoCentroControle mandado no insert é IGNORADO pelo Alvo, que
  // grava o centro derivado do funcionário (§6.2, descoberta 1).
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
  // Null nos 678, mas espelhado: se um dia for gravável (BL-9), o
  // vínculo OP↔RM pode virar estruturado do lado do ERP.
  put(r, "numero_ord_produc", txtOpt(i, "NumeroOrdProduc"));

  return r;
}

/**
 * Colunas que o PASSO A escreve. É um conjunto FIXO, e isso é
 * deliberado — não é o mesmo critério do passo B.
 *
 * POR QUÊ: o passo A faz upsert EM MASSA. Se as linhas de um mesmo lote
 * tiverem conjuntos de chaves diferentes, o PostgREST resolve a
 * divergência sozinho e o resultado é imprevisível — uma RM à qual
 * faltasse um campo poderia zerar a coluna de outra. Shape fixo elimina
 * a classe inteira de problema.
 *
 * E POR QUE ESTAS: são exatamente as colunas que a LISTAGEM fornece.
 * `codigo_tipo_lanc` e `gera_empenho` ficam de fora porque só existem no
 * `ReqMat/Load` — incluí-las aqui faria o passo A APAGAR, a cada
 * execução, o que o passo B acabou de gravar.
 */
const COLUNAS_LISTA = [
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

function mapearLista(item: any): Record<string, any> | null {
  const i = indexar(item);
  const numero = txt(pick(i, "Numero"));
  if (!numero) return null;

  const cab = mapearCabecalho(item);
  const linha: Record<string, any> = {
    codigo_empresa_filial: txt(pick(i, "CodigoEmpresaFilial")) ?? FILIAL_PADRAO,
    numero,
    sincronizado_em: new Date().toISOString(),
  };
  // Shape fixo: o que não veio entra como null EXPLÍCITO nesta lista, e
  // só nela. Fora dela, nada é tocado.
  for (const col of COLUNAS_LISTA) linha[col] = cab[col] ?? null;

  // NÃO tocar aqui: codigo_tipo_lanc, gera_empenho, raw,
  // detalhes_carregados_em, load_status_lido, ausente_desde.
  return linha;
}

/** Um item da `ItemReqMatChildList`. Shape fixo (é INSERT). */
function mapearItem(item: any, filial: string, numeroRM: string): Record<string, any> | null {
  const i = indexar(item);
  const sequencia = inteiro(pick(i, "Sequencia"));
  // `sequencia` é NOT NULL e parte da PK — sem ela o insert falharia e
  // derrubaria a transação inteira da RM. Melhor falhar cedo e claro.
  if (sequencia === null) return null;

  return {
    codigo_empresa_filial: filial,
    // O número vem da RM (autoridade), não do `NumeroReqMat` do filho:
    // é ele que fecha a FK com o cabeçalho.
    numero_reqmat: numeroRM,
    sequencia,
    codigo_produto: txt(pick(i, "CodigoProduto")),
    codigo_alternativo_produto: txt(pick(i, "CodigoAlternativoProduto")),
    codigo_prod_unid_med: txt(pick(i, "CodigoProdUnidMed")),
    posicao_prod_unid_med: inteiro(pick(i, "PosicaoProdUnidMed")),
    codigo_loc_armaz: txt(pick(i, "CodigoLocArmaz")),
    quantidade: num(pick(i, "QuantidadeProdUnidMedPrincipal")),
    // O que efetivamente SAIU do estoque. O ledger e o consolidado da OP
    // somam ESTA coluna, nunca `quantidade` (§10.4 e §6.1-1).
    quantidade_atendida: num(pick(i, "QuantidadeAtendidaProdUnidMedPrincipal")),
    // ⚠ JÁ VEM CALCULADO pelo Alvo. Espelhar, NUNCA recalcular: saldo
    // NÃO é quantidade − atendida (o excedente vai para
    // quantidade_atendida_maior e o saldo não fica negativo).
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
    // ⚠ `numero_ord_produc` NÃO é preenchido aqui: o campo NÃO EXISTE no
    // item — é de cabeçalho (retificado em 05/08/2026). A coluna
    // homônima em op_reqmat_itens veio da OP-2.2 e fica sempre null;
    // está marcada como obsoleta por `comment on` em sql/OP-2.3.sql.
    raw: item,
  };
}

/**
 * Um lote da `CtrlLoteItemReqMatChildList` — a genealogia de SAÍDA
 * nativa do Alvo. O almoxarifado aloca por FEFO e a soma dos lotes bate
 * com o ATENDIDO (5/5 itens multi-lote).
 *
 * `sequenciaPai` é a `Sequencia` do item em que o lote veio aninhado;
 * serve de fallback quando o lote não traz `SequenciaItemReqMat`.
 */
function mapearLote(
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
    // O que saiu DESTE lote. `quantidade_bruta` é o tamanho do lote —
    // não confundir.
    quantidade: num(pick(i, "QuantidadeProdUnidMedPrincipal")),
    quantidade_bruta: num(pick(i, "QuantidadeBruta")),
    quantidade_unidade_item: num(pick(i, "QuantidadeUnidadeItem")),
    operacao: txt(pick(i, "Operacao")),
    codigo_prod_unid_med: txt(pick(i, "CodigoProdUnidMed")),
    posicao_prod_unid_med: inteiro(pick(i, "PosicaoProdUnidMed")),
    // `DataFabricacaoLote` e `NumeroLoteFabricante` não têm coluna no
    // espelho (OP-2.2) e ficam no `raw`. ⚠ `NumeroLoteFabricante` é
    // sempre null no Alvo — o lote do fornecedor não entra no ERP
    // (§6.3-I); a coluna existir na resposta não significa que carrega
    // informação.
    raw: lote,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Análise da resposta do ReqMat/Load
// ─────────────────────────────────────────────────────────────────────
// O Alvo devolve exceção de regra de negócio (BrokenRulesException) com
// **HTTP 200**, então "status 2xx" não é prova de sucesso. A detecção é
// por ESTRUTURA do corpo, nunca por substring no texto inteiro: os
// campos `Descricao`/`Texto`/`Observacao` da RM são livres e podem
// conter qualquer palavra — procurar "erro"/"exception" ali produziria
// falso-positivo e jogaria RMs boas fora da fila.

/** Chaves que só aparecem em envelope de erro do .NET / ASP.NET Web API. */
const CHAVES_DE_EXCECAO = [
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
 * Âncora de uma RM de verdade. Exigimos VALOR (não só a chave presente):
 * um envelope de erro que ecoe `"Numero": null` não pode passar por RM.
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
  // Sem `loadChild=All` as child lists vêm VAZIAS, não ausentes — um
  // cabeçalho com `ItemReqMatChildList: []` é indistinguível de uma RM
  // sem itens. Como NÃO EXISTE RM sem item (não é possível criá-la), a
  // única leitura segura é tratar vazio como falha. Do contrário, um
  // Load degradado apagaria os filhos bons de uma RM inteira via
  // DELETE+INSERT. Mesmo julgamento do REC-2.0 com
  // `ItemMovEstqChildList` vazio.
  if (itens.length === 0) {
    return {
      ok: false,
      motivo: "ItemReqMatChildList VAZIO — não existe RM sem item; sintoma de loadChild ausente/degradado",
    };
  }

  return { ok: true, cabecalho: data, itens };
}

/**
 * Coleta os lotes de AMBOS os lugares possíveis, deduplicando.
 *
 * A `CtrlLoteItemReqMatChildList` foi observada aninhada dentro do item,
 * mas os campos do lote incluem `NumeroReqMat` e `SequenciaItemReqMat` —
 * o que sugere que a mesma lista pode aparecer autocontida na raiz do
 * cabeçalho. Ler os dois lugares cobre as duas formas sem adivinhar
 * qual delas o Alvo usa hoje; a dedup impede contagem dobrada se ele
 * usar as duas.
 */
function coletarLotes(
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
    // Lote sem `SequenciaItemReqMat` E sem item pai não tem como ser
    // amarrado — descartar em silêncio perderia genealogia de saída sem
    // deixar rastro. É contado e vira falha da RM em `detalharUma`.
    if (linha) saida.push(linha);
    else descartados++;
  }
  return { lotes: saida, descartados };
}

// ─────────────────────────────────────────────────────────────────────
// PASSO A — LISTA
// ─────────────────────────────────────────────────────────────────────

async function passoLista(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string,
  ano: number,
  result: ResultadoSync,
): Promise<void> {
  // Payload VALIDADO EM CAMPO (05/08/2026): 200, 678 registros para 2026.
  // ⚠ `Input: "defaultSearch"` — NÃO "gridTableReqMat". O envelope segue
  //   o molde documentado (Endpoints_Alvo.md §2) com "reqMat" nos quatro
  //   nomes; a inferência por analogia com `gridTableLaudo` estava
  //   errada. Não "corrigir" este valor.
  // ⚠ Filter no mínimo, SEM `CodigoEmpresaFilial`: a filial é única em
  //   todo o universo, e cada termo a mais é superfície de 417.
  // ⚠ Janela = ano corrente. Na virada de ano, RMs de dezembro ainda
  //   Abertas saem da janela: passar {"ano": 2026} no body do disparo
  //   manual traz o ano anterior de volta (o upsert é idempotente).
  const payload = {
    FormName: "reqMat",
    ClassInput: "reqMat",
    ControllerForm: "reqMat",
    ClassVinculo: "reqMat",
    Input: "defaultSearch",
    Shortcut: "reqMat",
    Type: "GridTable",
    TypeObject: "tabForm",
    BindingName: "",
    OrderUser: "",
    IsGroupBy: false,
    DisabledCache: false,
    // Sintaxe C#-like: ==, &&, datas entre #dd/MM/yyyy HH:mm:ss#.
    // `Data` é o campo de data do cabeçalho — confirmado em campo.
    Filter: `( Data >= #01/01/${ano} 00:00:00# )`,
    Order: "Numero DESC",
    PageIndex: 1,
    PageSize: LIST_PAGE_SIZE,
  };

  const resp = await callPassthrough(erpUrl, systemSecret, "reqMat/GetListForComponents", "POST", payload);

  if (!resp.ok) {
    result.erros++;
    result.detalhes.push({ etapa: "lista", erro: resp.erro || `HTTP ${resp.status}` });
    console.error(`[sync-reqmat] lista falhou: ${resp.erro}`);
    return;
  }

  const { itens, motivo } = extrairLista(resp.data);
  result.listados = itens.length;
  console.log(`[sync-reqmat] Alvo devolveu ${itens.length} requisições de ${ano}`);

  if (motivo) {
    result.erros++;
    result.detalhes.push({ etapa: "lista", erro: motivo });
    console.error(`[sync-reqmat] ${motivo}`);
    return;
  }

  if (itens.length === 0) {
    result.detalhes.push({ etapa: "lista", info: `0 requisições em ${ano}` });
    return;
  }

  // ⚠ Truncação NÃO é hipotética aqui: sem Filter a resposta veio com
  // exatamente 2000 (= PageSize). Uma lista cortada tratada como "o ano
  // inteiro" faria a checagem de ausência marcar RMs vivas como sumidas.
  if (itens.length >= LIST_PAGE_SIZE) {
    result.possivel_truncacao = true;
    result.detalhes.push({
      etapa: "lista",
      erro: `POSSÍVEL TRUNCAÇÃO: ${itens.length} >= PageSize ${LIST_PAGE_SIZE}. Aumentar o PageSize ou paginar. A checagem de ausência foi PULADA por segurança.`,
    });
    console.warn(`[sync-reqmat] possível truncação: ${itens.length} >= ${LIST_PAGE_SIZE}`);
  }

  // Chaves do 1º registro — documenta o que a listagem devolve de fato.
  result.campos_lista = Object.keys(itens[0] ?? {});

  const linhas: Record<string, any>[] = [];
  for (const item of itens) {
    const row = mapearLista(item);
    if (!row) {
      result.detalhes.push({ etapa: "lista", info: "registro sem Numero — ignorado" });
      continue;
    }
    linhas.push(row);
    contar(result.status_lista, row.status ?? "(null)");
    contar(result.tipos_lista, row.codigo_tipo_req_mat ?? "(null)");
    if (row.status && !STATUS_CONHECIDOS.has(row.status)) result.status_desconhecidos.push(row.status);
  }

  // inseridos vs atualizados: contamos a tabela antes e depois. Só este
  // job escreve em op_reqmat, então a diferença é o que entrou novo.
  const antes = await contarReqMat(supabase);

  const CHUNK = 200;
  let gravados = 0;
  for (let k = 0; k < linhas.length; k += CHUNK) {
    const chunk = linhas.slice(k, k + CHUNK);
    const { error } = await supabase
      .from("op_reqmat")
      .upsert(chunk, { onConflict: "codigo_empresa_filial,numero" });

    if (error) {
      result.erros += chunk.length;
      result.detalhes.push({ etapa: "gravacao", erro: `upsert (${chunk.length} linhas): ${error.message}` });
      console.error(`[sync-reqmat] upsert falhou:`, error);
      continue;
    }
    gravados += chunk.length;
  }

  const depois = await contarReqMat(supabase);
  result.inseridos = Math.max(0, depois - antes);
  result.atualizados = Math.max(0, gravados - result.inseridos);
  console.log(`[sync-reqmat] gravados=${gravados} (novos=${result.inseridos} atualizados=${result.atualizados})`);

  // Só na 1ª execução (espelho vazio): registra o contrato da listagem.
  if (antes === 0 && result.campos_lista.length > 0) {
    result.detalhes.push({
      etapa: "lista",
      info: `1ª execução — a listagem devolveu ${result.campos_lista.length} campos: ${result.campos_lista.join(", ")}`,
    });
  }

  reportarStatus(result);

  // ⚠ A ORDEM AQUI IMPORTA, e é a razão de `reportarStatus` NÃO contar erro.
  // A pré-condição de `marcarAusencias` é `result.erros === 0` — ela quer dizer
  // "a LISTAGEM veio íntegra". Um status desconhecido não torna a listagem
  // furada, mas se ele incrementasse `erros` aqui, desligaria a checagem de
  // ausência PARA SEMPRE a partir do dia em que o Alvo estreasse um status
  // novo. O status desconhecido é reportado como erro no handler, depois dos
  // dois passos — onde não contamina nada.
  //
  // A listagem em mãos é o retrato do ano no Alvo — dá para saber quem
  // sumiu.
  //
  // `confiavel` é a pré-condição da checagem, e é deliberadamente
  // pessimista:
  //   · nenhum erro até aqui (lista ou upsert) — erro parcial = retrato furado;
  //   · nada foi descartado no mapeamento. Um item sem `Numero` não entra
  //     em `linhas`, logo não entraria no conjunto dos listados, logo
  //     seria lido como "sumiu do Alvo" — marcaria ausência numa RM que
  //     ESTÁ lá.
  const descartados = itens.length - linhas.length;
  const confiavel = result.erros === 0 && descartados === 0;
  await marcarAusencias(supabase, ano, linhas, confiavel, descartados, result);
}

async function contarReqMat(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase.from("op_reqmat").select("numero", { count: "exact", head: true });
  return count ?? 0;
}

/**
 * Agregação de status — permanente, não só na 1ª execução.
 *
 * Custa zero chamada e zero query: o array da listagem já está em
 * memória. As duas fontes (lista e Load) são reportadas SEPARADAMENTE
 * porque divergência entre elas é a causa de releitura eterna — um
 * `Status` que o Load devolve e a listagem não usa faria
 * `load_status_lido` nunca alcançar `status`.
 *
 * ⚠ Esta função NÃO conta erro e NÃO reporta status desconhecido — quem faz
 * isso é `reportarStatusDesconhecidos`, chamada no handler depois dos dois
 * passos. Ver o comentário na chamada, em `passoLista`.
 */
function reportarStatus(result: ResultadoSync): void {
  const fmt = (m: Record<string, number>) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`)
      .join(", ");

  if (Object.keys(result.status_lista).length > 0) {
    const linha = fmt(result.status_lista);
    result.detalhes.push({ etapa: "lista", info: `status distintos (listagem): ${linha}` });
    console.log(`[sync-reqmat] status distintos (listagem): ${linha}`);
  }
  if (Object.keys(result.tipos_lista).length > 0) {
    result.detalhes.push({
      etapa: "lista",
      info:
        `tipos de ReqMat (listagem): ${fmt(result.tipos_lista)} ` +
        `— o espelho não filtra; o consolidado da OP filtra '${TIPO_PRODUCAO}'`,
    });
  }

}

/**
 * Status fora do conjunto confirmado em campo. Entra como ERRO, não info — não
 * muda comportamento nenhum (a consequência de um terminal errado é reler
 * demais, que é segura), mas não pode ficar invisível.
 *
 * Roda no handler, DEPOIS dos dois passos: cobre as duas fontes (listagem e
 * `ReqMat/Load`) numa entrada só e não contamina a pré-condição da checagem de
 * ausência, que já terminou.
 */
function reportarStatusDesconhecidos(result: ResultadoSync): void {
  const novos = Array.from(new Set(result.status_desconhecidos));
  if (novos.length === 0) return;

  result.erros++;
  result.detalhes.push({
    etapa: "lista",
    erro:
      `STATUS DESCONHECIDO: ${novos.join(", ")} — fora do conjunto confirmado em campo ` +
      `(${Array.from(STATUS_CONHECIDOS).join(", ")}). Se algum destes for TERMINAL, a expressão da coluna gerada ` +
      `precisa_releitura precisa incluí-lo — o que exige DROP + ADD da coluna (o Postgres não permite ALTER de ` +
      `expressão gerada) e recriar os índices parciais que dependem dela. ` +
      `Comportamento até lá: essas RMs releem para sempre — custo, não corrupção.`,
  });
  console.error(`[sync-reqmat] status desconhecido: ${novos.join(", ")}`);
}

// ─────────────────────────────────────────────────────────────────────
// Flag de ausência (molde do REC-3.0-B)
// ─────────────────────────────────────────────────────────────────────
// O sync faz upsert e NUNCA delete: uma RM excluída no Alvo sumiria da
// listagem e ficaria no espelho como fantasma, sem sinal nenhum. Aqui
// ela ganha `ausente_desde`.
//
// Não é hipótese: CINCO RMs foram apagadas em 71 no período de julho —
// todas ainda `Aberta`, nenhuma tinha movimentado estoque (§6.2).
//
// NADA é apagado — a flag é para auditoria, e some sozinha se a RM
// reaparecer numa listagem posterior. `ausente_desde` preenchido também
// tira a RM da fila do passo B (guard embutido na coluna gerada).
//
// ⚠ AS GUARDAS SÃO O CORAÇÃO DESTA FUNÇÃO. Marcar ausência em massa por
// causa de uma listagem truncada ou parcial esvaziaria o consolidado das
// OPs — destrutivo em significado, ainda que nenhuma linha seja apagada.

/**
 * Lê TODAS as linhas do espelho de um ano, paginando por `.range()`.
 *
 * Devolve `completo: false` se a varredura não pôde ser provada íntegra —
 * e quem chama TEM de tratar isso como "não sei quem está no espelho",
 * nunca como "o espelho é isto".
 *
 * A prova é o `count: exact` do próprio banco: paginamos até juntar essa
 * quantidade (ou até uma página vir vazia) e, no fim, os dois números
 * têm de fechar. O count vem pelo header `Content-Range` e NÃO passa por
 * `db-max-rows`, então serve de testemunha independente do tamanho real.
 *
 * Devolve também quantas linhas do espelho têm `data` NULL — elas ficam
 * FORA do recorte e nunca são avaliadas para ausência. É o ponto cego, e
 * é reportado em vez de ficar em silêncio.
 */
async function lerEspelhoDoAno(
  supabase: SupabaseClient,
  ano: number,
): Promise<{ linhas: any[]; completo: boolean; semData: number; motivo?: string }> {
  const inicio = `${ano}-01-01T00:00:00${ALVO_TZ_OFFSET}`;
  const fim = `${ano + 1}-01-01T00:00:00${ALVO_TZ_OFFSET}`;

  const base = () =>
    supabase
      .from("op_reqmat")
      .select("codigo_empresa_filial, numero, ausente_desde")
      .gte("data", inicio)
      .lt("data", fim);

  const { count: esperado, error: errCount } = await supabase
    .from("op_reqmat")
    .select("numero", { count: "exact", head: true })
    .gte("data", inicio)
    .lt("data", fim);

  if (errCount || esperado === null) {
    return { linhas: [], completo: false, semData: 0, motivo: `count do espelho falhou: ${errCount?.message ?? "count nulo"}` };
  }

  const { count: semData } = await supabase
    .from("op_reqmat")
    .select("numero", { count: "exact", head: true })
    .is("data", null);

  const linhas: any[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const de = linhas.length;
    if (de >= esperado) break; // já temos o ano inteiro

    // Ordem estável (a PK) — sem ela, duas páginas podem repetir ou pular
    // linhas quando o Postgres muda o plano no meio da varredura.
    const { data, error } = await base()
      .order("codigo_empresa_filial", { ascending: true })
      .order("numero", { ascending: true })
      .range(de, de + PAGINA_LEITURA - 1);

    if (error) return { linhas: [], completo: false, semData: semData ?? 0, motivo: `select do espelho do ano: ${error.message}` };
    if (!data || data.length === 0) break;

    // ⚠ NÃO paramos ao ver uma página menor que PAGINA_LEITURA. Se o
    // `db-max-rows` do PostgREST for menor que a nossa página, TODA
    // página vem curta — tratar isso como fim da lista desligaria a
    // checagem de ausência para sempre (o total nunca fecharia com o
    // count). Avançamos pelo que efetivamente voltou.
    linhas.push(...data);
  }

  if (linhas.length !== esperado) {
    return {
      linhas,
      completo: false,
      semData: semData ?? 0,
      motivo: `varredura incompleta: leu ${linhas.length} de ${esperado} requisições de ${ano}`,
    };
  }
  return { linhas, completo: true, semData: semData ?? 0 };
}

// `export` para permitir teste isolado das GUARDAS — marcar ausência em
// massa por listagem incompleta é o risco mais caro desta função.
export async function marcarAusencias(
  supabase: SupabaseClient,
  ano: number,
  linhasListadas: Record<string, any>[],
  listagemConfiavel: boolean,
  descartados: number,
  result: ResultadoSync,
): Promise<void> {
  if (!listagemConfiavel || result.possivel_truncacao || linhasListadas.length === 0) {
    result.detalhes.push({
      etapa: "ausencia",
      info:
        `marcação de ausência PULADA (listagem não confiável): ` +
        `erros=${result.erros} descartados=${descartados} ` +
        `truncada=${result.possivel_truncacao} listados=${linhasListadas.length}`,
    });
    console.warn("[sync-reqmat] ausência pulada: listagem não confiável");
    return;
  }

  const { linhas: espelho, completo, semData, motivo } = await lerEspelhoDoAno(supabase, ano);
  result.espelho_sem_data = semData;

  if (semData > 0) {
    // Ponto cego declarado: RM com `data` NULL não entra no recorte, logo
    // nunca é avaliada para ausência. Conservador e correto — mas tem de
    // ser VISÍVEL.
    result.detalhes.push({
      etapa: "ausencia",
      info: `${semData} requisição(ões) no espelho com data NULL — fora do recorte do ano, nunca avaliadas para ausência`,
    });
  }

  if (!completo) {
    // Espelho lido pela metade: quem não foi lido apareceria como "sumiu".
    // Não marca NADA — a leitura falha FECHADA, de propósito.
    result.erros++;
    result.detalhes.push({
      etapa: "ausencia",
      erro: `NÃO marcado: não foi possível ler o espelho de ${ano} por inteiro — ${motivo}`,
    });
    console.error(`[sync-reqmat] ausência ABORTADA (espelho incompleto): ${motivo}`);
    return;
  }

  const chave = (filial: string, numero: string) => `${filial || FILIAL_PADRAO}|${numero}`;
  const listados = new Set(linhasListadas.map((l) => chave(l.codigo_empresa_filial, l.numero)));

  const ausentes: any[] = []; // no espelho, fora da listagem, ainda sem flag
  const reapareceram: any[] = []; // na listagem, com flag antiga a limpar
  for (const l of espelho) {
    const k = chave(l.codigo_empresa_filial, l.numero);
    if (!listados.has(k)) {
      if (!l.ausente_desde) ausentes.push(l);
    } else if (l.ausente_desde) {
      reapareceram.push(l);
    }
  }

  const totalAno = espelho.length;
  const limite = Math.max(1, Math.floor(totalAno * LIMITE_AUSENCIA_PCT));

  if (ausentes.length > limite) {
    // Sinal de listagem incompleta, não de exclusão real. Não marca NADA.
    result.detalhes.push({
      etapa: "ausencia",
      erro:
        `NÃO marcado: ${ausentes.length} ausentes excedem ${Math.round(LIMITE_AUSENCIA_PCT * 100)}% ` +
        `do espelho de ${ano} (${totalAno} requisições, limite ${limite}) — trata-se como falha de listagem`,
      info: `números (até 20): ${ausentes.slice(0, 20).map((l) => l.numero).join(", ")}`,
    });
    console.error(`[sync-reqmat] ausência ABORTADA: ${ausentes.length} > limite ${limite}`);
    return;
  }

  const agora = new Date().toISOString();

  for (const l of ausentes) {
    const { error: errUpd } = await supabase
      .from("op_reqmat")
      .update({ ausente_desde: agora })
      .eq("codigo_empresa_filial", l.codigo_empresa_filial)
      .eq("numero", l.numero);
    if (errUpd) {
      result.erros++;
      console.error(`[sync-reqmat] marcar ausente ${l.numero}: ${errUpd.message}`);
      continue;
    }
    result.marcados_ausentes++;
    result.ausentes_numeros.push(l.numero);
  }

  for (const l of reapareceram) {
    const { error: errUpd } = await supabase
      .from("op_reqmat")
      .update({ ausente_desde: null })
      .eq("codigo_empresa_filial", l.codigo_empresa_filial)
      .eq("numero", l.numero);
    if (errUpd) {
      result.erros++;
      console.error(`[sync-reqmat] limpar ausência ${l.numero}: ${errUpd.message}`);
      continue;
    }
    result.ausentes_limpos++;
    result.reaparecidos_numeros.push(l.numero);
  }

  if (result.marcados_ausentes > 0) {
    result.detalhes.push({
      etapa: "ausencia",
      erro: `${result.marcados_ausentes} requisição(ões) sumiram da listagem do Alvo — marcadas com ausente_desde (nada foi apagado)`,
      info: `números (até 20): ${result.ausentes_numeros.slice(0, 20).join(", ")}`,
    });
  }
  if (result.ausentes_limpos > 0) {
    result.detalhes.push({
      etapa: "ausencia",
      info:
        `${result.ausentes_limpos} requisição(ões) reapareceram na listagem — ausente_desde limpo ` +
        `(até 20): ${result.reaparecidos_numeros.slice(0, 20).join(", ")}`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// PASSO B — DETALHE (ReqMat/Load)
// ─────────────────────────────────────────────────────────────────────

async function passoDetalhe(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string,
  t0: number,
  result: ResultadoSync,
): Promise<void> {
  // A fila é `precisa_releitura` e SÓ ISSO — a coluna gerada já embute
  // "nunca lida" (`detalhes_carregados_em is null`), "ainda pode mudar"
  // (`status <> 'Atendida Total'`), "mudou desde o último Load" e o
  // guard de `ausente_desde`. Não precisa do `.or(...)` do molde.
  //
  // A coluna existe porque o PostgREST NÃO compara duas colunas entre si
  // (todo filtro é coluna×literal). Sem ela o predicado só poderia ser
  // avaliado no client — o que obrigaria a LER O ESPELHO INTEIRO a cada
  // execução e ficaria à mercê do `db-max-rows` (1.000 por padrão), que
  // cortaria a fila em silêncio. Com a coluna gerada, o filtro E o teto
  // LOAD_BATCH ficam no Postgres: lemos LOAD_BATCH linhas.
  //
  // ORDEM — ver o cabeçalho do arquivo para o raciocínio completo.
  const { data: filaRaw, error } = await supabase
    .from("op_reqmat")
    .select("codigo_empresa_filial, numero, codigo_tipo_req_mat, detalhes_carregados_em")
    .is("precisa_releitura", true)
    .order("codigo_tipo_req_mat", { ascending: true, nullsFirst: false })
    .order("detalhes_carregados_em", { ascending: true, nullsFirst: true })
    .order("data", { ascending: false, nullsFirst: false })
    .limit(LOAD_BATCH);

  if (error) {
    result.erros++;
    result.detalhes.push({ etapa: "load", erro: `select da fila: ${error.message}` });
    return;
  }

  const fila = (filaRaw || []) as any[];
  const primeiraLeitura = fila.filter((r) => !r.detalhes_carregados_em).length;
  const producao = fila.filter((r) => r.codigo_tipo_req_mat === TIPO_PRODUCAO).length;

  console.log(
    `[sync-reqmat] fila do passo B: ${fila.length} (1ª leitura=${primeiraLeitura}, ` +
      `releitura=${fila.length - primeiraLeitura}, produção=${producao}, teto ${LOAD_BATCH})`,
  );

  if (fila.length > 0) {
    result.detalhes.push({
      etapa: "load",
      info:
        `fila: ${fila.length} (teto ${LOAD_BATCH}) — 1ª leitura=${primeiraLeitura}, ` +
        `releitura=${fila.length - primeiraLeitura}, tipo '${TIPO_PRODUCAO}'=${producao}`,
    });
  }

  for (let k = 0; k < fila.length; k += LOAD_CHUNK) {
    if (Date.now() - t0 > WATCHDOG_MS) {
      result.parado_por_watchdog = true;
      result.detalhes.push({
        etapa: "watchdog",
        info: `parou na requisição ${k + 1}/${fila.length} após ${Date.now() - t0}ms; a próxima execução continua`,
      });
      console.warn(`[sync-reqmat] watchdog: parou em ${k}/${fila.length}`);
      break;
    }

    const chunk = fila.slice(k, k + LOAD_CHUNK);
    await Promise.all(chunk.map((rm: any) => detalharUma(supabase, erpUrl, systemSecret, rm, result)));

    if (k + LOAD_CHUNK < fila.length) await sleep(SLEEP_BETWEEN_CHUNKS_MS);
  }
}

// `export` para permitir teste isolado do caminho que apaga e reinsere
// os filhos — é o ponto onde um Load degradado poderia esvaziar uma RM.
export async function detalharUma(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string,
  rm: { codigo_empresa_filial: string; numero: string },
  result: ResultadoSync,
): Promise<void> {
  const filial = rm.codigo_empresa_filial || FILIAL_PADRAO;

  // ASSINATURA CONFIRMADA EM CAMPO (04/08/2026): `ReqMat/Load?numero=…&loadChild=All` → 200.
  //
  // ⚠ NÃO enviar `codigoEmpresaFilial`. Lição REC-1.4: parâmetro que não
  //   casa quebra o binding do ASP.NET de forma INTERMITENTE, e o erro
  //   chega como "No action was found on the controller" — que significa
  //   PARÂMETRO ERRADO, não action inexistente. A filial continua sendo
  //   usada no WHERE da gravação; é chave do espelho, não parâmetro.
  //
  // ⚠ NÃO acrescentar `loadParent`/`loadOneToOne`. O que está provado é
  //   `numero` + `loadChild`. `loadParent` traria `OrdProducObject`, que
  //   a §6.1-2 já provou vazio em 46 requisições + 3 Loads — risco de
  //   binding sem contrapartida nenhuma.
  //
  // ⚠ `loadChild=All` NÃO É OPCIONAL. Sem ele as child lists vêm VAZIAS,
  //   não ausentes — e cabeçalho sem filhos é indistinguível de RM sem
  //   itens. A guarda estrutural está em `analisarRespostaReqMat`.
  //
  // A whitelist do gateway casa por `endpoint.split("?")[0]`, então a
  // query string não interfere.
  const endpoint = `ReqMat/Load?numero=${encodeURIComponent(rm.numero)}&loadChild=All`;

  // Toda saída por falha passa por aqui: registra o número, NÃO grava
  // coluna nenhuma, NÃO apaga filho nenhum e NÃO carimba
  // `detalhes_carregados_em` — a RM continua na fila e volta na próxima.
  const falhar = (motivo: string) => {
    result.erros++;
    result.falhas_load.push(rm.numero);
    result.falhas_motivos[motivo] = (result.falhas_motivos[motivo] || 0) + 1;
    console.warn(`[sync-reqmat] RM ${rm.numero} NÃO detalhada: ${motivo}`);
  };

  try {
    const resp = await callPassthrough(erpUrl, systemSecret, endpoint, "GET");

    if (!resp.ok) {
      falhar(resp.erro || `HTTP ${resp.status}`);
      return;
    }

    // HTTP 200 não é prova de sucesso: o Alvo devolve BrokenRulesException
    // com 200. A análise é estrutural — ver `analisarRespostaReqMat`.
    const analise = analisarRespostaReqMat(resp.data);
    if (!analise.ok) {
      falhar(analise.motivo || "resposta inesperada do ReqMat/Load");
      return;
    }

    const cabecalho = analise.cabecalho;
    const itensBrutos = analise.itens || [];

    // Status que ESTE Load enxergou — a outra metade da comparação que
    // governa a releitura. Medido em separado do da listagem de propósito.
    const statusLido = txt(pick(indexar(cabecalho), "Status"));
    if (statusLido) {
      contar(result.status_load, statusLido);
      if (!STATUS_CONHECIDOS.has(statusLido)) result.status_desconhecidos.push(statusLido);
    }

    // ── Itens ──
    const itens: Record<string, any>[] = [];
    for (const bruto of itensBrutos) {
      const linha = mapearItem(bruto, filial, rm.numero);
      if (!linha) {
        // Item sem `Sequencia` derrubaria o insert (NOT NULL + PK) e com
        // ele a transação inteira. Falha da RM, cedo e com motivo claro.
        falhar("item sem Sequencia numérica — Load inconsistente");
        return;
      }
      itens.push(linha);
    }

    // ── Lotes ──
    const { lotes, descartados } = coletarLotes(cabecalho, itensBrutos, filial, rm.numero);
    if (descartados > 0) {
      falhar(`${descartados} lote(s) sem sequência de item identificável — Load inconsistente`);
      return;
    }

    // Um lote cuja `sequencia_item` não existe entre os itens violaria a
    // FK e derrubaria a transação com um erro opaco. Detectar aqui dá
    // motivo legível e mantém a RM íntegra no espelho.
    const sequencias = new Set(itens.map((it) => it.sequencia));
    const orfaos = lotes.filter((l) => !sequencias.has(l.sequencia_item));
    if (orfaos.length > 0) {
      falhar(
        `${orfaos.length} lote(s) com sequencia_item sem item correspondente ` +
          `(itens: ${Array.from(sequencias).join(",")}) — Load inconsistente`,
      );
      return;
    }

    // ── Cabeçalho: só as chaves que vieram ──
    // Aqui vale a omissão fina (diferente do passo A): é UPDATE de uma
    // linha só, então não há shape a alinhar, e um campo ausente na
    // resposta não pode zerar o que a listagem trouxe.
    const cab = mapearCabecalho(cabecalho);
    // `raw` guarda o cabeçalho SEM as child lists: itens e lotes têm o
    // próprio `raw`, e duplicá-los aqui triplicaria o armazenamento do
    // espelho sem acrescentar informação.
    const rawCabecalho: Record<string, any> = {};
    for (const [k, v] of Object.entries(cabecalho as Record<string, any>)) {
      if (Array.isArray(v)) continue;
      rawCabecalho[k] = v;
    }

    // ── Gravação: DELETE + INSERT + carimbo, num único commit ──
    // A substituição por inteiro é exigência do modelo (§ do OP-2.2.sql):
    // item cancelado SOME da resposta do Alvo e um upsert incremental
    // deixaria lixo somando no consolidado da OP. `op_reqmat_lotes` sequer
    // tem chave natural única — não haveria `onConflict` possível.
    //
    // 🔴 POR QUE UMA RPC E NÃO TRÊS CHAMADAS PostgREST: entre o DELETE e o
    // INSERT existiria uma janela em que a RM fica SEM FILHOS. O
    // consolidado da OP leria "atendido 0 / tudo em aberto" — numa tela
    // que decide requisição de material, isso é errado do jeito ruim. A
    // RPC roda tudo numa transação: ou o espelho tem os filhos antigos,
    // ou tem os novos, nunca nenhum.
    const { data: aplicado, error: errRpc } = await supabase.rpc("op_reqmat_aplicar_load", {
      p_filial: filial,
      p_numero: rm.numero,
      p_cabecalho: cab,
      p_itens: itens,
      p_lotes: lotes,
      p_raw: rawCabecalho,
    });

    if (errRpc) {
      falhar(`op_reqmat_aplicar_load: ${errRpc.message}`);
      return;
    }

    result.detalhados++;
    result.itens_gravados += Number((aplicado as any)?.itens_inseridos ?? itens.length);
    result.lotes_gravados += Number((aplicado as any)?.lotes_inseridos ?? lotes.length);
  } catch (err: any) {
    // Falha individual NÃO aborta o lote: o erro morre aqui e as demais
    // RMs do chunk e da execução seguem.
    falhar(`exception: ${err?.message || String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const startTime = Date.now();

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
      },
    });
  }

  // ── Auth do cron (CRON_SECRET) ──
  const expectedSecret = Deno.env.get("CRON_SECRET");
  if (!expectedSecret) {
    console.error("[sync-reqmat] CRON_SECRET não configurado");
    return new Response(JSON.stringify({ error: "Edge function mal configurada" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headerSecret = req.headers.get("x-cron-secret");
  const bodyJson = await req.json().catch(() => ({}));
  const bodySecret = bodyJson?.cron_secret;
  const triggeredBy = bodyJson?.triggered_by || "pg_cron";

  if (headerSecret !== expectedSecret && bodySecret !== expectedSecret) {
    console.warn("[sync-reqmat] CRON_SECRET inválido");
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // `sync_runs_triggered_by_check` só aceita estes três.
  const validTriggers = ["pg_cron", "manual_admin", "test"];
  const safeTrigger = validTriggers.includes(triggeredBy) ? triggeredBy : "pg_cron";

  // Override opcional da janela (ver comentário em passoLista).
  const anoRaw = Number(bodyJson?.ano);
  const ano = Number.isFinite(anoRaw) && anoRaw >= 2000 && anoRaw <= 2999 ? anoRaw : new Date().getFullYear();

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceRole);

  // ── Kill-switch (sync_settings) ──
  const { data: settings } = await supabase
    .from("sync_settings")
    .select("enabled, paused_reason")
    .eq("job_name", "sync-reqmat")
    .maybeSingle();

  if (settings && settings.enabled === false) {
    console.log("[sync-reqmat] pausado:", settings.paused_reason);
    await supabase.from("sync_runs").insert({
      triggered_by: safeTrigger,
      job_type: "reqmat",
      total_candidatos: 0,
      total_consultados: 0,
      total_mudaram: 0,
      total_erros: 0,
      duracao_ms: Date.now() - startTime,
      observacao: `Pausado: ${settings.paused_reason || "sem motivo"}`,
      finished_at: new Date().toISOString(),
    });
    return new Response(JSON.stringify({ skipped: true, reason: "sync_settings.enabled = false" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Linha de auditoria (started) ──
  // ⚠ Se `sql/OP-2.3.sql` não tiver sido aplicado, ESTE insert falha com
  //   23514 (sync_runs_job_type_check) e a função morre aqui, sem sequer
  //   chamar o ERP. É a regra permanente da REC-1.2 (§9.4).
  const { data: runRow, error: errRun } = await supabase
    .from("sync_runs")
    .insert({ triggered_by: safeTrigger, job_type: "reqmat" })
    .select("id")
    .single();

  if (errRun || !runRow) {
    console.error("[sync-reqmat] falha ao criar sync_run:", errRun);
    return new Response(
      JSON.stringify({
        error: "Falha ao iniciar sync_run",
        details: errRun,
        dica: "Se o código for 23514, aplique sql/OP-2.3.sql: o CHECK de sync_runs.job_type precisa incluir 'reqmat'.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  const runId = runRow.id;

  // ── Secrets do gateway ──
  const erpUrl = Deno.env.get("ERP_PROXY_URL")!;
  const systemSecret = Deno.env.get("ERP_PROXY_SYSTEM_SECRET")!;

  if (!erpUrl || !systemSecret) {
    console.error("[sync-reqmat] ERP_PROXY_URL ou ERP_PROXY_SYSTEM_SECRET ausentes");
    await supabase
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        duracao_ms: Date.now() - startTime,
        total_erros: 1,
        observacao: "Edge function sem ERP_PROXY_URL ou ERP_PROXY_SYSTEM_SECRET",
      })
      .eq("id", runId);
    return new Response(JSON.stringify({ error: "Edge function mal configurada" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Execução ──
  const result: ResultadoSync = {
    listados: 0,
    inseridos: 0,
    atualizados: 0,
    detalhados: 0,
    itens_gravados: 0,
    lotes_gravados: 0,
    pendentes_detalhe: 0,
    erros: 0,
    possivel_truncacao: false,
    parado_por_watchdog: false,
    detalhes: [],
    falhas_load: [],
    falhas_motivos: {},
    marcados_ausentes: 0,
    ausentes_limpos: 0,
    ausentes_numeros: [],
    reaparecidos_numeros: [],
    espelho_sem_data: 0,
    status_lista: {},
    status_load: {},
    status_desconhecidos: [],
    campos_lista: [],
    tipos_lista: {},
  };

  let observacao: string | null = null;

  try {
    await passoLista(supabase, erpUrl, systemSecret, ano, result);
    await passoDetalhe(supabase, erpUrl, systemSecret, startTime, result);
  } catch (err: any) {
    console.error("[sync-reqmat] exception:", err);
    result.erros++;
    result.detalhes.push({ etapa: "exception", erro: err?.message || String(err) });
    observacao = `Exception inesperada: ${err?.message || String(err)}`;
  }

  // Status fora do conjunto conhecido — as duas fontes, numa entrada só.
  reportarStatusDesconhecidos(result);

  // Status vistos no Load — reportado à parte do da listagem.
  if (Object.keys(result.status_load).length > 0) {
    const linha = Object.entries(result.status_load)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`)
      .join(", ");
    result.detalhes.push({ etapa: "load", info: `status distintos (ReqMat/Load): ${linha}` });
    console.log(`[sync-reqmat] status distintos (Load): ${linha}`);
  }

  // Quanto ainda falta detalhar (depois de tudo). Como `precisa_releitura`
  // NÃO zera para RM não-terminal, este número tende a um platô — ele é a
  // fila permanente de releitura, não uma dívida que some.
  const { count: pendentes } = await supabase
    .from("op_reqmat")
    .select("numero", { count: "exact", head: true })
    .is("precisa_releitura", true);
  result.pendentes_detalhe = pendentes ?? 0;

  // Fingerprint do projeto: prova, no próprio histórico, que a execução
  // caiu no Supabase certo (hbtggrbauguukewiknew).
  const { count: fingerprint } = await supabase
    .from("compras_pedidos")
    .select("id", { count: "exact", head: true });

  // UMA entrada agregada com as RMs que falharam no Load. Todas seguem
  // com `detalhes_carregados_em` intacto, então voltam na próxima
  // execução; o registro existe para a falha não ficar invisível.
  if (result.falhas_load.length > 0) {
    const AMOSTRA = 20;
    const mostrados = result.falhas_load.slice(0, AMOSTRA);
    const resto = result.falhas_load.length - mostrados.length;
    result.detalhes.push({
      etapa: "load",
      erro:
        `${result.falhas_load.length} requisição(ões) falharam no ReqMat/Load — NÃO carimbadas, ` +
        `filhos preservados, voltam na próxima execução`,
      info:
        `números (até ${AMOSTRA}): ${mostrados.join(", ")}${resto > 0 ? ` … +${resto}` : ""}` +
        ` | motivos: ${Object.entries(result.falhas_motivos)
          .map(([m, n]) => `${n}× ${m}`)
          .join(" ; ")}`,
    });
  }

  const resumo =
    `ano=${ano} listados=${result.listados} novos=${result.inseridos} atualizados=${result.atualizados} ` +
    `detalhados=${result.detalhados} itens=${result.itens_gravados} lotes=${result.lotes_gravados} ` +
    `fila_restante=${result.pendentes_detalhe} erros=${result.erros}` +
    ` | ausentes=${result.marcados_ausentes} ausentes_limpos=${result.ausentes_limpos}` +
    (result.espelho_sem_data > 0 ? ` sem_data=${result.espelho_sem_data}` : "") +
    (result.falhas_load.length > 0 ? ` | ${result.falhas_load.length} RM(s) falharam no Load (voltam depois)` : "") +
    (result.status_desconhecidos.length > 0
      ? ` | ⚠ STATUS DESCONHECIDO: ${Array.from(new Set(result.status_desconhecidos)).join(", ")}`
      : "") +
    (result.possivel_truncacao ? " | ⚠ POSSÍVEL TRUNCAÇÃO DA LISTA" : "") +
    (result.parado_por_watchdog ? " | parou por watchdog (completa na próxima)" : "");

  observacao = observacao ? `${observacao} | ${resumo}` : resumo;

  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startTime,
      total_candidatos: result.listados,
      total_consultados: result.inseridos + result.atualizados,
      total_mudaram: result.detalhados,
      total_erros: result.erros,
      detalhes: result.detalhes.slice(0, 200),
      observacao,
    })
    .eq("id", runId);

  console.log(`[sync-reqmat] fim: ${resumo} duracao=${Date.now() - startTime}ms`);

  return new Response(
    JSON.stringify({
      fingerprint: {
        projeto: "hbtggrbauguukewiknew",
        compras_pedidos: fingerprint ?? null,
        run_id: runId,
        triggered_by: safeTrigger,
        iniciado_em: new Date(startTime).toISOString(),
        duracao_ms: Date.now() - startTime,
      },
      ano,
      listados: result.listados,
      inseridos: result.inseridos,
      atualizados: result.atualizados,
      detalhados: result.detalhados,
      itens_gravados: result.itens_gravados,
      lotes_gravados: result.lotes_gravados,
      fila_restante: result.pendentes_detalhe,
      erros: result.erros,
      falhas_load: {
        total: result.falhas_load.length,
        numeros: result.falhas_load.slice(0, 20),
        motivos: result.falhas_motivos,
      },
      ausencia: {
        marcados: result.marcados_ausentes,
        limpos: result.ausentes_limpos,
        numeros: result.ausentes_numeros.slice(0, 20),
        reaparecidos: result.reaparecidos_numeros.slice(0, 20),
        espelho_sem_data: result.espelho_sem_data,
      },
      // Tarefa permanente: as duas fontes de status, medidas em separado.
      status_lista: result.status_lista,
      status_load: result.status_load,
      status_desconhecidos: Array.from(new Set(result.status_desconhecidos)),
      tipos_lista: result.tipos_lista,
      campos_lista: result.campos_lista,
      possivel_truncacao: result.possivel_truncacao,
      parado_por_watchdog: result.parado_por_watchdog,
      detalhes: result.detalhes.slice(0, 50),
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
});
