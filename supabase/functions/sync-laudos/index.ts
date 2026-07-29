// =====================================================================
// Edge Function: sync-laudos   (REC-1.1 · módulo Recebimento)
// =====================================================================
// Espelha a entidade LAUDO do ERP Alvo em public.rec_laudos.
//
// POR QUE EXISTE: o laudo com status "Emitido" é material que JÁ ESTÁ
// fisicamente na empresa (a NF foi lançada, o lote foi criado), mas que
// ainda não virou saldo em estoque — logo é invisível no Alvo e em
// qualquer tela do Hub. Em 28/07/2026: 120 laudos Emitido, 1.433 unidades
// de pericárdio paradas em 115 lotes, a mais antiga desde 08/05.
// Ver PLANO-OP.md §6.3 (investigação que provou o fluxo em 4 tempos).
//
// DOIS PASSOS NA MESMA EXECUÇÃO:
//   A) LISTA  — 1 chamada a `laudo/GetListForComponents` (ano corrente,
//      SEM filtro de status: "Emitido" alimenta a fila e "Concluído"
//      permite medir o tempo de inspeção realizado). Upsert por
//      (codigo_empresa_filial, numero) com os 21 campos da lista +
//      raw_lista + sincronizado_em. NÃO toca nas colunas de
//      enriquecimento nem em enriquecido_em.
//   B) ENRIQUECIMENTO — até LOAD_BATCH registros com enriquecido_em is
//      null (data_emissao desc), um `Laudo/Load` cada, gravando as 12
//      colunas de detalhe + raw_load + enriquecido_em. O teto existe para
//      não estourar o tempo da função; o cron completa nas execuções
//      seguintes (751 laudos convergem em ~8 rodadas).
//
//   C) VALOR e FORNECEDOR (REC-2.0) — varre até MOV_BATCH `chave_movestq`
//      DISTINTAS com `mov_enriquecido_em is null` e chama `MovEstq/Load`
//      uma vez por chave. O item casa com o laudo pelo par
//      (chave_movestq, Sequencia ⇄ sequencia_it_movestq); uma chamada
//      resolve todos os laudos daquela chave — 295 chaves cobrem os 751
//      laudos. Traz custo/valor unitário do item e o FORNECEDOR do
//      cabeçalho (`CodigoEntidade` é sempre null no laudo, §6.3-D).
//
// REGRA DE OURO DOS PASSOS B e C: `enriquecido_em` / `mov_enriquecido_em`
// só são carimbados em
// SUCESSO. A fila de retentativa é `enriquecido_em is null` (com índice
// parcial), então carimbar numa falha tiraria aquele laudo da fila PARA
// SEMPRE — sem erro visível em lugar nenhum. Em falha: nada é gravado, o
// número entra em `sync_runs.detalhes` (agregado, até 20 números com a
// contagem total) e a execução SEGUE com os demais laudos.
//
// ESTA FUNÇÃO SÓ LÊ O ALVO. `GetListForComponents` é leitura (POST por
// causa do corpo de filtro). Nenhuma escrita no ERP, em nenhuma hipótese.
//
// ACESSO AO ALVO: sempre via gateway erp-proxy, rota /alvo/passthrough,
// autenticado por X-System-Secret — o mesmo padrão server-to-server dos
// outros crons (sync-produtos-cron, sync-compras-status-cron). Os três
// endpoints estão na whitelist do gateway desde 28/07/2026.
//
// MAPEAMENTO sync_runs → semântica deste job (siga isto ao ler o histórico):
//   total_candidatos  = laudos que o Alvo listou
//   total_consultados = laudos gravados (insert + update) no espelho
//   total_mudaram     = laudos enriquecidos via Laudo/Load nesta execução
//   total_erros       = falhas (lista, gravação ou Load)
//
// SECRETS (reusados dos outros crons):
//   CRON_SECRET, ERP_PROXY_URL, ERP_PROXY_SYSTEM_SECRET,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// DEPLOY:
//   supabase functions deploy sync-laudos \
//     --no-verify-jwt --project-ref hbtggrbauguukewiknew
// =====================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ─────────────────────────────────────────────────────────────────────
// Configuração
// ─────────────────────────────────────────────────────────────────────

const FILIAL_PADRAO = "1.01";

// PageSize provado em 28/07/2026: 2000 devolveu os 751 laudos de 2026 sem
// truncar. Se um dia a lista atingir o teto, o job AVISA (nunca corta em
// silêncio) — ver `possivel_truncacao` no retorno e na observacao.
const LIST_PAGE_SIZE = 2000;

// Teto de Loads por execução. O Alvo responde 1–3s por Load; 100 cabem
// folgadamente no tempo da função e o cron completa o resto depois.
const LOAD_BATCH = 100;

// REC-2.0 (passo C) — teto de `MovEstq/Load` por execução. A varredura é por
// CHAVE DE MOVIMENTO, não por laudo: um movimento serve vários laudos (média
// 2,5), então 295 chaves cobrem os 751 laudos. Universo total ~295 ⇒ converge
// em ~8 rodadas com este teto.
const MOV_BATCH = 40;

// Quantas LINHAS de rec_laudos varremos para extrair as chaves distintas.
// O PostgREST não tem DISTINCT: pegamos um lote de linhas ordenado por chave
// e deduplicamos no cliente. Com média de 2,5 laudos por chave, 8× o teto dá
// folga larga para fechar MOV_BATCH chaves mesmo com movimentos grandes
// (uma NF chegou a ter 18 lotes). Se vier menos, tudo bem — a próxima
// execução continua de onde parou.
const MOV_SCAN_LINHAS = MOV_BATCH * 8;

// Loads em paralelo (mesmo tamanho de chunk do sync-compras-status-cron).
const LOAD_CHUNK = 5;
const SLEEP_BETWEEN_CHUNKS_MS = 200;

// Margem antes do teto de 150s de RESPOSTA da Edge Function. Ao estourar,
// paramos o enriquecimento e devolvemos o parcial (o que já foi gravado
// fica; a próxima execução continua de onde parou).
const WATCHDOG_MS = 110_000;

// O Alvo é um ERP on-premise brasileiro e devolve datas SEM offset
// ("2026-06-29T00:00:00"), que são horário de Brasília. Gravar assim numa
// coluna timestamptz faria o Postgres assumir UTC e a data "voltaria" um
// dia ao ser exibida no Brasil. Por isso anexamos o offset explícito.
// (Strings que já vêm com Z/±HH:MM passam intactas.)
const ALVO_TZ_OFFSET = "-03:00";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────

interface Detalhe {
  etapa: "lista" | "gravacao" | "load" | "movestq" | "watchdog" | "exception";
  numero?: string;
  erro?: string;
  info?: string;
}

interface ResultadoSync {
  listados: number;
  inseridos: number;
  atualizados: number;
  enriquecidos: number;
  pendentes_enriquecimento: number;
  erros: number;
  possivel_truncacao: boolean;
  parado_por_watchdog: boolean;
  detalhes: Detalhe[];
  /**
   * REC-1.4 — números dos laudos que FALHARAM no `Laudo/Load`. Nenhum deles
   * teve `enriquecido_em` carimbado, então todos voltam na próxima execução.
   * Vira UMA entrada agregada em `sync_runs.detalhes` (até 20 números + a
   * contagem total), em vez de uma linha por falha — 100 falhas não podem
   * inchar o jsonb da auditoria.
   */
  falhas_load: string[];
  /** motivo → quantas vezes ocorreu (diagnóstico barato, sem inchar). */
  falhas_motivos: Record<string, number>;

  // ── REC-2.0 · passo C (valor e fornecedor via MovEstq/Load) ──
  /** chaves de movimento lidas nesta execução (= chamadas ao Alvo). */
  chaves_lidas: number;
  chaves_ok: number;
  chaves_falha: number;
  /** laudos que receberam custo/valor/fornecedor. */
  laudos_valorizados: number;
  /** laudos cuja `sequencia_it_movestq` não achou item no movimento. */
  laudos_sem_item_casado: number;
  /** chaves que falharam (até 20 vão para os detalhes) + motivos agregados. */
  falhas_mov: string[];
  falhas_mov_motivos: Record<string, number>;
  /** números dos laudos sem item casado (até 20 vão para os detalhes). */
  sem_item_casado: string[];
}

// ─────────────────────────────────────────────────────────────────────
// Gateway erp-proxy → /alvo/passthrough
// ─────────────────────────────────────────────────────────────────────
// O passthrough devolve um ENVELOPE { ok, status, data, error } com a
// resposta crua do Alvo em `data`. Códigos a distinguir no log:
//   401 = X-System-Secret ausente/errado (auth do gateway)
//   403 = endpoint fora da whitelist do gateway
//   417 = payload malformado / regra de negócio do Alvo
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
          ? `403 — endpoint fora da whitelist do gateway (${endpoint.split("?")[0]})`
          : `HTTP ${resp.status}`;
    return { ok: false, status: resp.status, data: body, erro: `${motivo}: ${body?.error || ""}`.trim() };
  }

  const alvoStatus = Number(body?.status ?? resp.status);
  if (body?.ok === false || !resp.ok) {
    const motivo = alvoStatus === 417 ? "417 — payload rejeitado pelo Alvo" : `Alvo HTTP ${alvoStatus}`;
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
 * Data do Alvo → ISO com offset de Brasília. Descarta as "datas zero" do
 * .NET (0001-01-01 / 1900-01-01), que significam "vazio".
 * Aceita ISO ("2026-06-29T00:00:00") e dd/MM/yyyy [HH:mm:ss].
 */
function toTimestamp(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
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

/**
 * Extrai o array de registros da resposta do GetListForComponents.
 * O formato do envelope do Alvo não está documentado, então tentamos as
 * chaves conhecidas e, por último, a primeira propriedade que for um
 * array de objetos. Devolve também a chave usada, para diagnóstico.
 */
function extrairLista(data: any): { itens: any[]; origem: string } {
  if (Array.isArray(data)) return { itens: data, origem: "raiz" };
  if (!data || typeof data !== "object") return { itens: [], origem: "vazio" };

  for (const k of ["Registros", "registros", "Lista", "lista", "Items", "items", "Rows", "rows", "Data", "data", "Result", "result"]) {
    if (Array.isArray(data[k])) return { itens: data[k], origem: k };
  }
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && (v.length === 0 || typeof v[0] === "object")) return { itens: v as any[], origem: k };
  }
  return { itens: [], origem: `sem array (chaves: ${Object.keys(data).slice(0, 12).join(",")})` };
}

// ─────────────────────────────────────────────────────────────────────
// Mappers Alvo → rec_laudos
// ─────────────────────────────────────────────────────────────────────

/** Os 21 campos de `laudo/GetListForComponents`. */
function mapearLista(item: any): Record<string, any> | null {
  const i = indexar(item);
  const numero = txt(pick(i, "Numero"));
  if (!numero) return null;

  return {
    codigo_empresa_filial: txt(pick(i, "CodigoEmpresaFilial")) ?? FILIAL_PADRAO,
    numero,
    data_emissao: toTimestamp(pick(i, "DataEmissao")),
    codigo_entidade: txt(pick(i, "CodigoEntidade")),
    chave_movestq: inteiro(pick(i, "ChaveMovEstq")),
    codigo_produto: txt(pick(i, "CodigoProduto")),
    quantidade2: num(pick(i, "Quantidade2")),
    codigo_prod_unid_med: txt(pick(i, "CodigoProdUnidMed")),
    posicao_prod_unid_med: inteiro(pick(i, "PosicaoProdUnidMed")),
    quantidade: num(pick(i, "QuantidadeProdUnidMedPrincipal", "Quantidade")),
    codigo_funcionario: txt(pick(i, "CodigoFuncionario")),
    status: txt(pick(i, "Status")),
    gera_rm_especifica: txt(pick(i, "GeraRmEspecifica", "GeraRMEspecifica")),
    especie_documento: txt(pick(i, "EspecieDocumento")),
    numero_documento: txt(pick(i, "NumeroDocumento")),
    texto: txt(pick(i, "Texto")),
    resultado_analise: txt(pick(i, "ResultadoAnalise")),
    data_resultado: toTimestamp(pick(i, "DataResultado")),
    codigo_loc_armaz: txt(pick(i, "CodigoLocArmaz")),
    quantidade_destruida_aprovada: num(pick(i, "QuantidadeDestruidaAprovada")),
    quantidade_destruida_reprovada: num(pick(i, "QuantidadeDestruidaReprovada")),
    raw_lista: item,
    sincronizado_em: new Date().toISOString(),
    // NÃO tocar aqui: enriquecido_em, raw_load e as 12 colunas do Load.
  };
}

// ─────────────────────────────────────────────────────────────────────
// Análise da resposta do Laudo/Load  (REC-1.4)
// ─────────────────────────────────────────────────────────────────────
// O Alvo devolve exceção de regra de negócio (BrokenRulesException) com
// **HTTP 200**, então "status 2xx" não é prova de sucesso. A detecção é por
// ESTRUTURA do corpo, nunca por substring no texto inteiro: o campo `Texto`
// do laudo é livre, vem em português e alemão e pode conter qualquer palavra
// — procurar "erro"/"exception" ali produziria falso-positivo e jogaria
// laudos bons fora da fila.
//
// Três regras, nesta ordem:
//   1. corpo que não é objeto        → falha;
//   2. corpo com CHAVE DE ENVELOPE de exceção do .NET → falha;
//   3. corpo sem ÂNCORA de laudo com valor real       → falha.
// Só passa quem tem âncora preenchida e nenhum sinal de exceção.

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

/**
 * Âncoras de um Laudo de verdade. Exigimos VALOR (não só a chave presente):
 * um envelope de erro que ecoe `"Numero": null` não pode passar por laudo —
 * era esse o caminho que carimbava `enriquecido_em` com 12 colunas nulas.
 */
function temAncoraDeLaudo(o: any): boolean {
  const i = indexar(o);
  return ["Numero", "NumeroCtrlLote", "ChaveMovEstq"].some((c) => {
    const v = pick(i, c);
    return v !== undefined && v !== null && String(v).trim() !== "";
  });
}

function chavesDeExcecaoPresentes(o: any): string[] {
  const i = indexar(o);
  return CHAVES_DE_EXCECAO.filter((c) => pick(i, c) !== undefined);
}

export interface AnaliseLaudo {
  ok: boolean;
  laudo?: any;
  motivo?: string;
}

export function analisarRespostaLaudo(data: any): AnaliseLaudo {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, motivo: `corpo não é objeto (${data === null ? "null" : typeof data})` };
  }

  const chaves = (o: any) => Object.keys(o).slice(0, 8).join(",");

  const sinais = chavesDeExcecaoPresentes(data);
  if (sinais.length > 0) {
    // Só DENTRO dos campos de mensagem procuramos texto — nunca no corpo
    // inteiro, para não encostar no `Texto` do laudo.
    const i = indexar(data);
    const msg = [pick(i, "Message"), pick(i, "MessageDetail"), pick(i, "ExceptionMessage")]
      .filter((v) => typeof v === "string")
      .join(" | ");
    const bindingErrado = /No action was found on the controller/i.test(msg);
    return {
      ok: false,
      motivo: bindingErrado
        ? `binding de parâmetro no Alvo — "No action was found on the controller" (parâmetro que não casa, NÃO action inexistente; ver §6.3-A)`
        : `envelope de exceção do Alvo (chaves: ${sinais.join(",")})`,
    };
  }

  if (temAncoraDeLaudo(data)) return { ok: true, laudo: data };

  // O Load devolve o laudo na raiz; se um dia vier embrulhado, aceitamos a
  // única propriedade-objeto — desde que ela também passe nas duas regras.
  const objetos = Object.values(data).filter((v) => v && typeof v === "object" && !Array.isArray(v));
  if (objetos.length === 1 && chavesDeExcecaoPresentes(objetos[0]).length === 0 && temAncoraDeLaudo(objetos[0])) {
    return { ok: true, laudo: objetos[0] };
  }

  return { ok: false, motivo: `sem âncora de Laudo (chaves: ${chaves(data)})` };
}

/**
 * REC-2.0 — mesma régua estrutural do `analisarRespostaLaudo`, agora para o
 * `MovEstq/Load`. Âncoras do movimento: `Chave` com valor E
 * `ItemMovEstqChildList` como array. Continua valendo a regra de nunca casar
 * texto no corpo inteiro (campos livres existem aqui também).
 *
 * Lista vazia é falha DA CHAVE: sem itens não há como casar sequência
 * nenhuma, e carimbar os laudos deixaria todos com valor nulo para sempre.
 */
export interface AnaliseMovEstq {
  ok: boolean;
  cabecalho?: any;
  itens?: any[];
  motivo?: string;
}

export function analisarRespostaMovEstq(data: any): AnaliseMovEstq {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, motivo: `corpo não é objeto (${data === null ? "null" : typeof data})` };
  }

  const sinais = chavesDeExcecaoPresentes(data);
  if (sinais.length > 0) {
    const i = indexar(data);
    const msg = [pick(i, "Message"), pick(i, "MessageDetail"), pick(i, "ExceptionMessage")]
      .filter((v) => typeof v === "string")
      .join(" | ");
    return {
      ok: false,
      motivo: /No action was found on the controller/i.test(msg)
        ? `binding de parâmetro no Alvo — "No action was found on the controller" (ver §6.3-A)`
        : `envelope de exceção do Alvo (chaves: ${sinais.join(",")})`,
    };
  }

  const i = indexar(data);
  const chave = pick(i, "Chave");
  const itens = pick(i, "ItemMovEstqChildList");

  if (chave === undefined || chave === null || String(chave).trim() === "") {
    return { ok: false, motivo: `sem âncora de MovEstq (chaves: ${Object.keys(data).slice(0, 8).join(",")})` };
  }
  if (!Array.isArray(itens)) {
    return { ok: false, motivo: "ItemMovEstqChildList ausente ou não é lista" };
  }
  if (itens.length === 0) {
    return { ok: false, motivo: "ItemMovEstqChildList vazio — nada a casar" };
  }

  return { ok: true, cabecalho: data, itens };
}

/** As 12 colunas de detalhe de `Laudo/Load` (o lote mora aqui). */
function mapearLoad(detalhe: any): Record<string, any> {
  const i = indexar(detalhe);
  return {
    sequencia_it_movestq: inteiro(pick(i, "SequenciaItMovEstq")),
    numero_ctrl_lote: txt(pick(i, "NumeroCtrlLote")),
    data_validade_ctrl_lote: toDate(pick(i, "DataValidadeCtrlLote")),
    data_recepcao: toTimestamp(pick(i, "DataRecepcao")),
    quantidade_aprovada: num(pick(i, "QuantidadeAprovada")),
    quantidade_reprovada: num(pick(i, "QuantidadeReprovada")),
    quantidade_devolvida: num(pick(i, "QuantidadeDevolvida")),
    data_devolvida: toTimestamp(pick(i, "DataDevolvida")),
    valor_reprovado: num(pick(i, "ValorReprovado")),
    texto_resultado: txt(pick(i, "TextoResultado")),
    codigo_centro_ctrl: txt(pick(i, "CodigoCentroCtrl")),
    codigo_funcionario_responsavel: txt(pick(i, "CodigoFuncionarioResponsavel")),
    raw_load: detalhe,
    enriquecido_em: new Date().toISOString(),
  };
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
  // Payload EXATO capturado do Alvo. TODOS os campos são obrigatórios —
  // faltando qualquer um, o Alvo devolve 417.
  // ⚠ Janela = ano corrente. Na virada de ano, laudos de dezembro ainda
  // "Emitido" saem da janela: passar {"ano": 2026} no body do disparo
  // manual traz o ano anterior de volta (o upsert é idempotente).
  const payload = {
    FormName: "laudo",
    ClassInput: "Laudo",
    ControllerForm: "laudo",
    ClassVinculo: "laudo",
    Input: "gridTableLaudo",
    Shortcut: "laudo",
    Type: "GridTable",
    TypeObject: "tabForm",
    BindingName: "",
    OrderUser: "",
    IsGroupBy: false,
    DisabledCache: false,
    // Sintaxe C#-like: ==, &&, datas entre #dd/MM/yyyy HH:mm:ss#.
    // SEM filtro de status: "Emitido" é a fila, "Concluído" mede o tempo
    // de inspeção realizado.
    Filter: `( DataEmissao >= #01/01/${ano} 00:00:00# )`,
    Order: "Numero DESC",
    PageIndex: 1,
    PageSize: LIST_PAGE_SIZE,
  };

  const resp = await callPassthrough(erpUrl, systemSecret, "laudo/GetListForComponents", "POST", payload);

  if (!resp.ok) {
    result.erros++;
    result.detalhes.push({ etapa: "lista", erro: resp.erro || `HTTP ${resp.status}` });
    console.error(`[sync-laudos] lista falhou: ${resp.erro}`);
    return;
  }

  const { itens, origem } = extrairLista(resp.data);
  result.listados = itens.length;
  console.log(`[sync-laudos] Alvo devolveu ${itens.length} laudos (array em "${origem}")`);

  if (itens.length === 0) {
    result.detalhes.push({ etapa: "lista", info: `0 laudos em ${ano}; forma da resposta: ${origem}` });
    return;
  }

  if (itens.length >= LIST_PAGE_SIZE) {
    result.possivel_truncacao = true;
    result.detalhes.push({
      etapa: "lista",
      info: `POSSÍVEL TRUNCAÇÃO: ${itens.length} >= PageSize ${LIST_PAGE_SIZE}. Aumentar o PageSize ou paginar.`,
    });
    console.warn(`[sync-laudos] possível truncação: ${itens.length} >= ${LIST_PAGE_SIZE}`);
  }

  const linhas: Record<string, any>[] = [];
  for (const item of itens) {
    const row = mapearLista(item);
    if (row) linhas.push(row);
    else result.detalhes.push({ etapa: "lista", info: "registro sem Numero — ignorado" });
  }

  // inseridos vs atualizados: contamos a tabela antes e depois. Só este job
  // escreve em rec_laudos, então a diferença é exatamente o que entrou novo.
  const antes = await contarLaudos(supabase);

  const CHUNK = 200;
  let gravados = 0;
  for (let k = 0; k < linhas.length; k += CHUNK) {
    const chunk = linhas.slice(k, k + CHUNK);
    const { error } = await supabase
      .from("rec_laudos")
      .upsert(chunk, { onConflict: "codigo_empresa_filial,numero" });

    if (error) {
      result.erros += chunk.length;
      result.detalhes.push({ etapa: "gravacao", erro: `upsert (${chunk.length} linhas): ${error.message}` });
      console.error(`[sync-laudos] upsert falhou:`, error);
      continue;
    }
    gravados += chunk.length;
  }

  const depois = await contarLaudos(supabase);
  result.inseridos = Math.max(0, depois - antes);
  result.atualizados = Math.max(0, gravados - result.inseridos);
  console.log(`[sync-laudos] gravados=${gravados} (novos=${result.inseridos} atualizados=${result.atualizados})`);
}

async function contarLaudos(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase.from("rec_laudos").select("numero", { count: "exact", head: true });
  return count ?? 0;
}

// ─────────────────────────────────────────────────────────────────────
// PASSO B — ENRIQUECIMENTO (Laudo/Load)
// ─────────────────────────────────────────────────────────────────────

async function passoEnriquecimento(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string,
  t0: number,
  result: ResultadoSync,
): Promise<void> {
  const { data: pendentes, error } = await supabase
    .from("rec_laudos")
    .select("codigo_empresa_filial, numero")
    .is("enriquecido_em", null)
    .order("data_emissao", { ascending: false, nullsFirst: false })
    .limit(LOAD_BATCH);

  if (error) {
    result.erros++;
    result.detalhes.push({ etapa: "load", erro: `select de pendentes: ${error.message}` });
    return;
  }

  const fila = pendentes || [];
  console.log(`[sync-laudos] enriquecendo ${fila.length} laudos (teto ${LOAD_BATCH})`);

  for (let k = 0; k < fila.length; k += LOAD_CHUNK) {
    if (Date.now() - t0 > WATCHDOG_MS) {
      result.parado_por_watchdog = true;
      result.detalhes.push({
        etapa: "watchdog",
        info: `parou no laudo ${k + 1}/${fila.length} após ${Date.now() - t0}ms; a próxima execução continua`,
      });
      console.warn(`[sync-laudos] watchdog: parou em ${k}/${fila.length}`);
      break;
    }

    const chunk = fila.slice(k, k + LOAD_CHUNK);
    await Promise.all(chunk.map((laudo: any) => enriquecerUm(supabase, erpUrl, systemSecret, laudo, result)));

    if (k + LOAD_CHUNK < fila.length) await sleep(SLEEP_BETWEEN_CHUNKS_MS);
  }
}

async function enriquecerUm(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string,
  laudo: { codigo_empresa_filial: string; numero: string },
  result: ResultadoSync,
): Promise<void> {
  const filial = laudo.codigo_empresa_filial || FILIAL_PADRAO;

  // ⚠ REC-1.4: o `Laudo/Load` NÃO tem `codigoEmpresaFilial`. A assinatura real,
  // vista no stack trace do próprio Alvo, é:
  //     LaudoController.Load(String numero, List loadParent, List loadChild, List loadOneToOne)
  // Enviar o parâmetro extra fazia o binding do ASP.NET falhar de forma
  // INTERMITENTE. A filial continua sendo usada abaixo, no WHERE do UPDATE —
  // ela é chave do espelho, só não é parâmetro do endpoint.
  // A whitelist do gateway casa o endpoint SEM query string, então `Laudo/Load`
  // segue liberado sem tocar no erp-proxy.
  const endpoint =
    `Laudo/Load?numero=${encodeURIComponent(laudo.numero)}` + `&loadParent=All&loadChild=All&loadOneToOne=All`;

  // Toda saída por falha passa por aqui: registra o número, NÃO grava coluna
  // nenhuma e NÃO carimba `enriquecido_em` — o laudo continua com
  // `enriquecido_em is null` e volta na fila da próxima execução.
  const falhar = (motivo: string) => {
    result.erros++;
    result.falhas_load.push(laudo.numero);
    result.falhas_motivos[motivo] = (result.falhas_motivos[motivo] || 0) + 1;
    console.warn(`[sync-laudos] laudo ${laudo.numero} NÃO enriquecido: ${motivo}`);
  };

  try {
    const resp = await callPassthrough(erpUrl, systemSecret, endpoint, "GET");

    if (!resp.ok) {
      falhar(resp.erro || `HTTP ${resp.status}`);
      return;
    }

    // HTTP 200 não é prova de sucesso: o Alvo devolve BrokenRulesException
    // com 200. A análise é estrutural — ver `analisarRespostaLaudo`.
    const analise = analisarRespostaLaudo(resp.data);
    if (!analise.ok) {
      falhar(analise.motivo || "resposta inesperada do Laudo/Load");
      return;
    }

    const { error } = await supabase
      .from("rec_laudos")
      .update(mapearLoad(analise.laudo))
      .eq("codigo_empresa_filial", filial)
      .eq("numero", laudo.numero);

    if (error) {
      falhar(`update: ${error.message}`);
      return;
    }

    result.enriquecidos++;
  } catch (err: any) {
    // Falha individual NÃO aborta o lote: o erro morre aqui e os demais
    // laudos do chunk e da execução seguem.
    falhar(`exception: ${err?.message || String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// PASSO C — VALOR e FORNECEDOR (MovEstq/Load)          [REC-2.0]
// ─────────────────────────────────────────────────────────────────────
// A varredura é por CHAVE DE MOVIMENTO, não por laudo: uma chamada resolve
// todos os laudos daquela chave (média 2,5), então 295 chamadas cobrem os
// 751 laudos. A ligação item ⇄ laudo é o par (chave_movestq, Sequencia),
// onde `Sequencia` do item casa com `rec_laudos.sequencia_it_movestq`.
//
// O que NÃO assumir (medido contra a chave 15869 em 28/07/2026):
//   · `ControlaLote` pode ser "Não" e o laudo existir mesmo assim
//     (importação) ⇒ não condicionar nada a controle de lote;
//   · `CodigoTipoLanc` varia (E0000158 nacional, E0000160 importação)
//     ⇒ NÃO filtrar por código de lançamento em lugar nenhum;
//   · `MovEstqPedCompChildList` vem vazio em importação ⇒ não amarrar a
//     compras_pedidos;
//   · uma chave pode ter 6 itens e só 2 laudos — normal.

async function passoMovEstq(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string,
  t0: number,
  result: ResultadoSync,
): Promise<void> {
  // O PostgREST não faz DISTINCT: lemos um lote de linhas por chave desc e
  // deduplicamos aqui. Chaves maiores = movimentos mais recentes, que é onde
  // está a fila pendente.
  const { data: linhas, error } = await supabase
    .from("rec_laudos")
    .select("chave_movestq")
    .not("chave_movestq", "is", null)
    .is("mov_enriquecido_em", null)
    .order("chave_movestq", { ascending: false })
    .limit(MOV_SCAN_LINHAS);

  if (error) {
    result.erros++;
    result.detalhes.push({ etapa: "movestq", erro: `select de chaves pendentes: ${error.message}` });
    return;
  }

  const chaves: number[] = [];
  const vistas = new Set<number>();
  for (const l of linhas || []) {
    const c = Number((l as any).chave_movestq);
    if (!Number.isFinite(c) || vistas.has(c)) continue;
    vistas.add(c);
    chaves.push(c);
    if (chaves.length >= MOV_BATCH) break;
  }

  console.log(`[sync-laudos] passo C: ${chaves.length} chave(s) de movimento (teto ${MOV_BATCH})`);
  if (chaves.length === 0) return;

  for (let k = 0; k < chaves.length; k += LOAD_CHUNK) {
    if (Date.now() - t0 > WATCHDOG_MS) {
      result.parado_por_watchdog = true;
      result.detalhes.push({
        etapa: "watchdog",
        info: `passo C parou na chave ${k + 1}/${chaves.length} após ${Date.now() - t0}ms; a próxima execução continua`,
      });
      console.warn(`[sync-laudos] watchdog no passo C: parou em ${k}/${chaves.length}`);
      break;
    }

    const chunk = chaves.slice(k, k + LOAD_CHUNK);
    await Promise.all(chunk.map((c) => enriquecerChave(supabase, erpUrl, systemSecret, c, result)));

    if (k + LOAD_CHUNK < chaves.length) await sleep(SLEEP_BETWEEN_CHUNKS_MS);
  }
}

// `export` para permitir teste isolado do casamento por sequência e do
// cálculo de `valor_custo_lote` — é o ponto onde confundir a quantidade do
// item com a do lote multiplicaria o valor.
export async function enriquecerChave(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string,
  chave: number,
  result: ResultadoSync,
): Promise<void> {
  result.chaves_lidas++;

  // Falha da CHAVE: nenhum laudo dela é carimbado, todos voltam na próxima
  // execução (o índice parcial é `mov_enriquecido_em is null`).
  const falharChave = (motivo: string) => {
    result.erros++;
    result.chaves_falha++;
    result.falhas_mov.push(String(chave));
    result.falhas_mov_motivos[motivo] = (result.falhas_mov_motivos[motivo] || 0) + 1;
    console.warn(`[sync-laudos] chave ${chave} NÃO valorizada: ${motivo}`);
  };

  const endpoint =
    `MovEstq/Load?codigoEmpresaFilial=${encodeURIComponent(FILIAL_PADRAO)}` +
    `&chave=${encodeURIComponent(String(chave))}` +
    `&loadParent=All&loadChild=All&loadOneToOne=All`;

  try {
    const resp = await callPassthrough(erpUrl, systemSecret, endpoint, "GET");
    if (!resp.ok) {
      falharChave(resp.erro || `HTTP ${resp.status}`);
      return;
    }

    const analise = analisarRespostaMovEstq(resp.data);
    if (!analise.ok) {
      falharChave(analise.motivo || "resposta inesperada do MovEstq/Load");
      return;
    }

    // Cabeçalho: fornecedor. `CodigoEntidade` é null no laudo (§6.3-D) — é
    // aqui que ele existe.
    const cab = indexar(analise.cabecalho);
    const codigoEntidade = txt(pick(cab, "CodigoEntidade"));
    const nomeEntidade = txt(pick(cab, "NomeEntidade"));

    // Itens indexados por Sequencia. Um item pode servir mais de um laudo,
    // então guardamos o item, não consumimos.
    const porSequencia = new Map<number, any>();
    for (const item of analise.itens || []) {
      const seq = inteiro(pick(indexar(item), "Sequencia"));
      if (seq !== null && !porSequencia.has(seq)) porSequencia.set(seq, item);
    }

    const { data: laudos, error: errSel } = await supabase
      .from("rec_laudos")
      .select("codigo_empresa_filial, numero, sequencia_it_movestq, quantidade")
      .eq("chave_movestq", chave)
      .is("mov_enriquecido_em", null);

    if (errSel) {
      falharChave(`select dos laudos da chave: ${errSel.message}`);
      return;
    }
    if (!laudos || laudos.length === 0) {
      // Nada a fazer (outra execução paralela já cobriu). Não é falha.
      result.chaves_ok++;
      return;
    }

    result.chaves_ok++;

    for (const laudo of laudos as any[]) {
      const seq = inteiro(laudo.sequencia_it_movestq);
      const item = seq === null ? undefined : porSequencia.get(seq);

      if (!item) {
        // Falha DESTE laudo, não da chave: não carimba, registra e segue.
        result.laudos_sem_item_casado++;
        result.sem_item_casado.push(laudo.numero);
        console.warn(
          `[sync-laudos] laudo ${laudo.numero}: sequência ${seq ?? "null"} sem item na chave ${chave} ` +
            `(itens: ${Array.from(porSequencia.keys()).join(",")})`,
        );
        continue;
      }

      const i = indexar(item);
      const custoUnitario = num(pick(i, "CustoUnitario"));
      // ⚠ A quantidade vem do ESPELHO (quantidade do lote daquele laudo).
      // O item traz a quantidade CHEIA do movimento — usar a do item
      // multiplicaria o valor.
      const qtdLaudo = num(laudo.quantidade);

      const { error: errUpd } = await supabase
        .from("rec_laudos")
        .update({
          custo_unitario: custoUnitario,
          valor_unitario: num(pick(i, "ValorUnitario")),
          valor_custo_lote: custoUnitario !== null && qtdLaudo !== null ? custoUnitario * qtdLaudo : null,
          codigo_entidade_mov: codigoEntidade,
          nome_entidade_mov: nomeEntidade,
          controla_lote_item: txt(pick(i, "ControlaLote")),
          codigo_tipo_lanc_item: txt(pick(i, "CodigoTipoLanc")),
          raw_movestq_item: item,
          mov_enriquecido_em: new Date().toISOString(),
        })
        .eq("codigo_empresa_filial", laudo.codigo_empresa_filial)
        .eq("numero", laudo.numero);

      if (errUpd) {
        // Falha de gravação deste laudo: sem carimbo, volta na próxima.
        result.erros++;
        result.laudos_sem_item_casado++;
        result.sem_item_casado.push(laudo.numero);
        console.error(`[sync-laudos] update do laudo ${laudo.numero} falhou: ${errUpd.message}`);
        continue;
      }

      result.laudos_valorizados++;
    }
  } catch (err: any) {
    // Falha de uma chave não aborta o lote.
    falharChave(`exception: ${err?.message || String(err)}`);
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
    console.error("[sync-laudos] CRON_SECRET não configurado");
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
    console.warn("[sync-laudos] CRON_SECRET inválido");
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

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
    .eq("job_name", "sync-laudos")
    .maybeSingle();

  if (settings && settings.enabled === false) {
    console.log("[sync-laudos] pausado:", settings.paused_reason);
    await supabase.from("sync_runs").insert({
      triggered_by: safeTrigger,
      job_type: "laudos",
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
  const { data: runRow, error: errRun } = await supabase
    .from("sync_runs")
    .insert({ triggered_by: safeTrigger, job_type: "laudos" })
    .select("id")
    .single();

  if (errRun || !runRow) {
    console.error("[sync-laudos] falha ao criar sync_run:", errRun);
    return new Response(JSON.stringify({ error: "Falha ao iniciar sync_run", details: errRun }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const runId = runRow.id;

  // ── Secrets do gateway ──
  const erpUrl = Deno.env.get("ERP_PROXY_URL")!;
  const systemSecret = Deno.env.get("ERP_PROXY_SYSTEM_SECRET")!;

  if (!erpUrl || !systemSecret) {
    console.error("[sync-laudos] ERP_PROXY_URL ou ERP_PROXY_SYSTEM_SECRET ausentes");
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
    enriquecidos: 0,
    pendentes_enriquecimento: 0,
    erros: 0,
    possivel_truncacao: false,
    parado_por_watchdog: false,
    detalhes: [],
    falhas_load: [],
    falhas_motivos: {},
    chaves_lidas: 0,
    chaves_ok: 0,
    chaves_falha: 0,
    laudos_valorizados: 0,
    laudos_sem_item_casado: 0,
    falhas_mov: [],
    falhas_mov_motivos: {},
    sem_item_casado: [],
  };

  let observacao: string | null = null;

  try {
    await passoLista(supabase, erpUrl, systemSecret, ano, result);
    await passoEnriquecimento(supabase, erpUrl, systemSecret, startTime, result);
    await passoMovEstq(supabase, erpUrl, systemSecret, startTime, result);
  } catch (err: any) {
    console.error("[sync-laudos] exception:", err);
    result.erros++;
    result.detalhes.push({ etapa: "exception", erro: err?.message || String(err) });
    observacao = `Exception inesperada: ${err?.message || String(err)}`;
  }

  // Quanto ainda falta enriquecer (depois de tudo).
  const { count: pendentes } = await supabase
    .from("rec_laudos")
    .select("numero", { count: "exact", head: true })
    .is("enriquecido_em", null);
  result.pendentes_enriquecimento = pendentes ?? 0;

  // Fingerprint do projeto: prova, no próprio histórico, que a execução
  // caiu no Supabase certo (hbtggrbauguukewiknew ≈ 1.720 pedidos).
  const { count: fingerprint } = await supabase
    .from("compras_pedidos")
    .select("id", { count: "exact", head: true });

  // REC-1.4 — UMA entrada agregada com os laudos que falharam no Load. Todos
  // seguem com `enriquecido_em is null`, então voltam na próxima execução; o
  // registro existe para a falha não ficar invisível.
  if (result.falhas_load.length > 0) {
    const AMOSTRA = 20;
    const mostrados = result.falhas_load.slice(0, AMOSTRA);
    const resto = result.falhas_load.length - mostrados.length;
    result.detalhes.push({
      etapa: "load",
      erro:
        `${result.falhas_load.length} laudo(s) falharam no Laudo/Load — NÃO carimbados, ` +
        `voltam na próxima execução`,
      info:
        `números (até ${AMOSTRA}): ${mostrados.join(", ")}${resto > 0 ? ` … +${resto}` : ""}` +
        ` | motivos: ${Object.entries(result.falhas_motivos)
          .map(([m, n]) => `${n}× ${m}`)
          .join(" ; ")}`,
    });
  }

  // REC-2.0 — chaves de movimento que falharam: nenhum laudo delas foi
  // carimbado, todas voltam na próxima execução.
  if (result.falhas_mov.length > 0) {
    const mostradas = result.falhas_mov.slice(0, 20);
    const resto = result.falhas_mov.length - mostradas.length;
    result.detalhes.push({
      etapa: "movestq",
      erro: `${result.falhas_mov.length} chave(s) de MovEstq falharam — nenhum laudo delas foi carimbado`,
      info:
        `chaves (até 20): ${mostradas.join(", ")}${resto > 0 ? ` … +${resto}` : ""}` +
        ` | motivos: ${Object.entries(result.falhas_mov_motivos)
          .map(([m, n]) => `${n}× ${m}`)
          .join(" ; ")}`,
    });
  }

  // REC-2.0 — laudos cuja sequência não achou item no movimento. É falha do
  // LAUDO, não da chave: ele segue sem carimbo e será tentado de novo.
  if (result.sem_item_casado.length > 0) {
    const mostrados = result.sem_item_casado.slice(0, 20);
    const resto = result.sem_item_casado.length - mostrados.length;
    result.detalhes.push({
      etapa: "movestq",
      erro: `${result.sem_item_casado.length} laudo(s) sem item casado pela sequência — não carimbados`,
      info: `números (até 20): ${mostrados.join(", ")}${resto > 0 ? ` … +${resto}` : ""}`,
    });
  }

  const resumo =
    `ano=${ano} listados=${result.listados} novos=${result.inseridos} atualizados=${result.atualizados} ` +
    `enriquecidos=${result.enriquecidos} pendentes=${result.pendentes_enriquecimento} erros=${result.erros}` +
    ` | mov: chaves=${result.chaves_lidas} ok=${result.chaves_ok} falha=${result.chaves_falha} ` +
    `valorizados=${result.laudos_valorizados} sem_item=${result.laudos_sem_item_casado}` +
    (result.falhas_load.length > 0 ? ` | ${result.falhas_load.length} laudo(s) falharam no Load (voltam depois)` : "") +
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
      total_mudaram: result.enriquecidos,
      total_erros: result.erros,
      detalhes: result.detalhes.slice(0, 200),
      observacao,
    })
    .eq("id", runId);

  console.log(`[sync-laudos] fim: ${resumo} duracao=${Date.now() - startTime}ms`);

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
      enriquecidos: result.enriquecidos,
      pendentes_enriquecimento: result.pendentes_enriquecimento,
      erros: result.erros,
      // REC-1.4 — quem falhou no Load continua na fila (sem carimbo).
      falhas_load: {
        total: result.falhas_load.length,
        numeros: result.falhas_load.slice(0, 20),
        motivos: result.falhas_motivos,
      },
      // REC-2.0 (passo C) — valor e fornecedor via MovEstq/Load.
      movestq: {
        chaves_lidas: result.chaves_lidas,
        chaves_ok: result.chaves_ok,
        chaves_falha: result.chaves_falha,
        laudos_valorizados: result.laudos_valorizados,
        laudos_sem_item_casado: result.laudos_sem_item_casado,
        chaves_com_falha: result.falhas_mov.slice(0, 20),
        motivos: result.falhas_mov_motivos,
        laudos_sem_item: result.sem_item_casado.slice(0, 20),
      },
      possivel_truncacao: result.possivel_truncacao,
      parado_por_watchdog: result.parado_por_watchdog,
      detalhes: result.detalhes.slice(0, 50),
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
});
