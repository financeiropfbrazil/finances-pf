// =====================================================================
// Edge Function: sync-compras-status-cron
// =====================================================================
// Sincroniza requisições e pedidos com o ERP Alvo. Cron Tricéfalo + 1
// extra: Job 4 (descoberta de reqs novas) → Job 3 (descoberta de peds
// novos) → Job 1 (mudanças em reqs) → Job 2 (mudanças em peds).
//
// FLUXO:
//   1. Valida CRON_SECRET (auth de invocação)
//   2. Lê sync_settings → para se enabled=false
//   3. Job 4: descobre requisições novas no Alvo
//   4. Job 3: descobre pedidos novos no Alvo (+ merge req↔ped)
//   5. Job 1: sincroniza mudanças de requisições candidatas
//   6. Job 2: sincroniza mudanças de pedidos candidatos
//   7. Persiste resultado em sync_runs
//
// CRITÉRIOS DE CANDIDATURA:
//   - Requisições (Job 1): status='sincronizada' + numero_alvo NOT NULL
//                  + created_at > NOW() - 180 days, LIMIT 50
//   - Pedidos (Job 2): status NOT IN ('Encerrado', 'Cancelado')
//              AND (data_pedido > NOW() - 180 days OR
//                   status_aprovacao IN ('Em Andamento', 'Reavaliar')),
//              ordenados por synced_at ASC NULLS FIRST, LIMIT 100
//   - Descoberta reqs (Job 4): Numero > cursor 'req-comp-last-numero-1.01'
//   - Descoberta peds (Job 3): Numero > cursor 'ped-comp-last-numero-1.01'
//
// BACKFILL AUTOMÁTICO (Job 4):
//   Quando cursor='0000000' (nunca rodou), janela vai pra 1095 dias
//   (3 anos) pra trazer histórico completo numa execução.
//   Próximas execuções: janela de 30 dias.
//
// PARALELISMO (Jobs 1 e 2): chunks de 5 em paralelo, sleep 200ms
//
// SECRETS NECESSÁRIOS:
//   - CRON_SECRET, ERP_PROXY_URL, ERP_PROXY_SYSTEM_SECRET
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (automáticos)
//
// ── CORREÇÃO valor_total (Job 2) ─────────────────────────────────────
//   O Job 2 passou a comparar e propagar o ValorTotal do Alvo para a
//   coluna compras_pedidos.valor_total. Antes, o upsert do Job 2 só
//   gravava campos de status, deixando o valor_total defasado em relação
//   ao que o Alvo informava (visível na auditoria sync_status). Agora:
//     - valor_total entra no SELECT de candidatos;
//     - uma divergência de valor também marca "mudou=true";
//     - valor_total/mercadoria/servico/frete/desconto vão no upsert.
//   O ERP não permite editar pedido aprovado, logo o ValorTotal do Alvo
//   é a fonte da verdade — sem necessidade de guarda no Hub.
//
// ── VÍNCULO REQ↔PED + FLAG vinculo_requisicao (10/06/2026) ───────────
//   Colunas novas em compras_pedidos: vinculo_requisicao
//   ('com_vinculo'/'sem_vinculo'/'nao_verificado'), req_comp_itens
//   (jsonb, reqs distintas no nível de item) e vinculo_verificado_em.
//   Regra de ouro: 'sem_vinculo' só pode ser afirmado por quem viu o
//   DETALHE COMPLETO (cabeçalho + ItemPedCompChildList). O list leve
//   (Job 3) só afirma presença ('com_vinculo'), nunca ausência.
//   - Job 2: extrai vínculo do detalhe (cabeçalho + itens); divergência
//     de elo/flag marca mudou=true; upsert grava flag + req_comp_itens
//     + vinculo_verificado_em + elo (só quando presente — nunca apaga
//     elo existente, preservando o saneamento de 10/06/2026). O caminho
//     "não mudou" também carimba vinculo_verificado_em — é o que drena
//     a fila de 'nao_verificado' sem depender de mudança no pedido.
//   - Job 3: checa existência ANTES do upsert; pedido já existente não
//     tem criado_no_hub/status_local/detalhes_carregados sobrescritos
//     (corrige bug de pedido criado no Hub virar criado_no_hub=false na
//     redescoberta). Vínculo do list: presente → elo + 'com_vinculo';
//     ausente → flag não é escrita.
//
// ── JOB 4 SEM apenasAbertas + RECONCILIAÇÃO NA JANELA (10/06/2026) ───
//   O list agora usa apenasAbertas=false: traz TODAS as reqs digitadas
//   na janela (abertas, convertidas em pedido, canceladas). Validado
//   empiricamente: Status='Pedido' e GerouPedComp='Total' vêm
//   preenchidos no grid. Com isso o Job 4 passou a:
//   - INSERIR reqs ausentes do Hub mesmo com Numero <= cursor
//     (reconciliação na janela — antes, req convertida entre ciclos
//     nunca era descoberta);
//   - ATUALIZAR o status de reqs existentes que converteram/cancelaram
//     (detectado pelo list), sem esperar o Job 1;
//   - Guarda anti-rebaixamento: status terminal (convertida_pedido /
//     cancelada) nunca volta a 'sincronizada' pelo list (que pode estar
//     defasado do detalhe).
//   Mapeamento ampliado: Status='Pedido' OU GerouPedComp Total/Parcial
//   → convertida_pedido. O número do pedido continua sendo gravado
//   apenas pelo merge (Job 3/2) — o list de req não o informa.
// =====================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ─────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────

interface RequisicaoHub {
  id: string;
  requisitante_user_id: string;
  status: string;
  codigo_empresa_filial: string;
  numero_alvo: string;
  numero_pedido_compra_alvo: string | null;
  codigo_funcionario: string;
  codigo_centro_ctrl: string;
  codigo_finalidade_compra: string;
  data_necessidade: string;
  total_itens: number | null;
}

interface PedidoHub {
  id: string;
  numero: string;
  codigo_empresa_filial: string;
  status: string | null;
  aprovado: string | null;
  status_aprovacao: string | null;
  comprado: string | null;
  proximo_aprovador: string | null;
  enviou_aprovacao: string | null;
  data_notificacao_aprovador: string | null;
  valor_total: number | null;
  data_pedido: string | null;
  numero_req_comp: string | null;
  vinculo_requisicao: string | null;
  detalhes_carregados: boolean | null;
  // CARD C3 — campos lidos para decidir o que está AUSENTE. Precisam vir do
  // SELECT: sem eles o bloco de completar não tem como saber o que falta.
  codigo_entidade: string | null;
  nome_entidade: string | null;
  cnpj_entidade: string | null;
  nome_cond_pag: string | null;
  centro_custo: string | null;
  classe_rec_desp: string | null;
  primeiro_vencimento: string | null;
  itens: unknown;
  parcelas: unknown;
  classe_rateio: unknown;
  // MOEDA-PEDIDOS — lidos para não regravar o que já está correto e para
  // detectar o pedido cuja única defasagem é a moeda. Precisam vir do
  // SELECT: ausentes, o gate compara contra `undefined` e reescreve sempre.
  codigo_ind_economico: string | null;
  valor_cambio: number | null;
}

interface DetalheMudanca {
  tipo: "req" | "ped";
  id: string;
  numero_alvo: string;
  status_anterior?: string;
  status_novo?: string;
  status_aprovacao_anterior?: string;
  status_aprovacao_novo?: string;
  aprovado_anterior?: string;
  aprovado_novo?: string;
  comprado_anterior?: string;
  comprado_novo?: string;
  proximo_aprovador_anterior?: string;
  proximo_aprovador_novo?: string;
  erro?: string;
}

interface JobResult {
  total_candidatos: number;
  total_consultados: number;
  total_mudaram: number;
  total_erros: number;
  detalhes: DetalheMudanca[];
  elegiveis_sem_limit?: number; // diagnóstico L1.3 (só no Job 2)
}

// Cross-check de exclusão (L3 Missão 2): o que o Job 3 exporta para o Job 2.
// numerosVistos = conjunto `${filial}|${Numero}` de TUDO que o Alvo listou na
// janela; janela[Inicio/Fim] = período efetivamente varrido (30d normal ou o
// override manual); listaOk = a lista é confiável? (false se o /list falhou OU
// se pode ter truncado — nesse caso o Job 2 faz no-op nos 404, nunca marca).
interface CrossCheckPedidos {
  listaOk: boolean;
  janelaInicio: string; // YYYY-MM-DD
  janelaFim: string; // YYYY-MM-DD
  numerosVistos: Set<string>;
}

// Cabeçalho leve do PedComp retornado por /ped-comp/list
interface PedidoLeve {
  CodigoEmpresaFilial: string;
  Numero: string;
  Status: string | null;
  Aprovado: string | null;
  StatusAprovacao: string | null;
  Comprado: string | null;
  Tipo: string | null;
  DataPedido: string | null;
  DataCadastro: string | null;
  DataEntrega: string | null;
  DataValidade: string | null;
  CodigoEntidade: string | null;
  NomeEntidade: string | null;
  CodigoCondPagAdiantamento: string | null;
  ValorMercadoria: number | null;
  ValorServico: number | null;
  ValorTotal: number | null;
  ValorFrete: number | null;
  CodigoUsuario: string | null;
  Texto: string | null;
  CodigoCentroCtrl: string | null;
  CodigoEmpresaFilialReqComp: string | null;
  NumeroReqComp: string | null;
  CondPagPedCompObject: { CodigoCondPag?: string | null } | null;
  PedCompUserFieldsObject: {
    UserProximoAprovador?: string | null;
    UserEnviouAprovacao?: string | null;
    UserDataNotificao?: string | null;
  } | null;
}

// Cabeçalho leve do ReqComp retornado por /req-comp/list
interface RequisicaoLeve {
  CodigoEmpresaFilial: string;
  Numero: string;
  Status: string | null;
  Data: string | null;
  Descricao: string | null;
  CodigoFuncionario: string | null;
  CodigoCentroCtrl: string | null;
  Aprovada: string | null;
  Reprovada: string | null;
  CodigoFinalidadeCompra: string | null;
  CodigoLocArmaz: string | null;
  CodigoEmpresaFilialEntrega: string | null;
  EspecieDocumento: string | null;
  NumeroDocumento: string | null;
  NumeroOrigem: string | null;
  ModuloOrigem: string | null;
  DataHoraDigitacao: string | null;
  CodigoEquipamento: string | null;
  CodigoEntidade: string | null;
  NumeroPedidoEntidade: string | null;
  IdGerencProj: string | null;
  IdVerbaGerencProj: string | null;
  GerouCotacComp: string | null;
  GerouPedComp: string | null;
  RequisicaoTerceiro: string | null;
  CodigoUsuario: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 5;
const SLEEP_BETWEEN_CHUNKS_MS = 200;
const REQ_BATCH_SIZE = 50;
const PED_BATCH_SIZE = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve o valor_total do pedido a partir do retorno do Alvo (detalhe completo).
 * Fonte da verdade: o ValorTotal do cabeçalho do Alvo (inclui frete/despesas/desconto).
 * Fallback: soma dos itens não cancelados — apenas quando o Alvo NÃO fornecer total
 * (null/undefined), ou quando o cabeçalho vier 0 mas houver itens com valor.
 * (Mesma regra usada em alvoPedCompService.ts / alvoPedCompLoadService.ts.)
 */
function resolverValorTotalAlvo(alvo: any): number {
  const itens = (alvo?.ItemPedCompChildList || []) as any[];
  const somaItens = itens
    .filter((it: any) => it?.Cancelado !== "Sim")
    .reduce((acc: number, it: any) => acc + (Number(it?.ValorTotal) || 0), 0);

  const cab = alvo?.ValorTotal;
  if (cab === null || cab === undefined) {
    return somaItens;
  }
  const cabNum = Number(cab) || 0;
  if (cabNum === 0 && somaItens > 0) {
    return somaItens;
  }
  return cabNum;
}

// ─────────────────────────────────────────────────────────────────────
// MOEDA-PEDIDOS — moeda e câmbio do pedido
// ─────────────────────────────────────────────────────────────────────
// A moeda é atributo do CABEÇALHO do PedComp, nunca do item (no item o
// Alvo devolve CodigoIndEconomico null e ValorCambio 0 mesmo em pedido
// de dólar). De-para: 0000001=BRL, 0000002=USD, 0000003=EUR.
//
// ⚠️ DIALETO: no PedComp o câmbio é `ValorCambio`; no DocFin o mesmo
// conceito é `CotacaoIndice`. Não extrapolar entre entidades.
//
// ⚠️ SÓ O LOAD TRAZ. Medido 26/08/2026: zero das 605 auditorias
// `descoberto_alvo` (payload do list leve) têm as chaves, contra 3.786
// de 3.786 auditorias `sync_status` (payload do Load). O Job 3, que
// monta o pedido a partir do LIST, não pode gravar estas colunas.
//
// (Espelho de src/services/moedaPedido.ts — duplicado porque a Edge roda
// em Deno e não importa de src/.)
function extrairMoedaDoLoadAlvo(alvo: any): {
  codigo_ind_economico?: string;
  valor_cambio?: number;
} {
  const out: { codigo_ind_economico?: string; valor_cambio?: number } = {};

  const ind = alvo?.CodigoIndEconomico;
  if (ind !== null && ind !== undefined && String(ind).trim() !== "") {
    out.codigo_ind_economico = String(ind).trim();
  }

  const cambio = alvo?.ValorCambio;
  if (cambio !== null && cambio !== undefined && Number.isFinite(Number(cambio))) {
    out.valor_cambio = Number(cambio);
  }

  return out;
}

/**
 * Extrai o vínculo req↔ped do retorno completo do Alvo (cabeçalho + itens).
 * Regra: 'sem_vinculo' só pode ser afirmado por quem viu o detalhe completo
 * (endpoint de detalhe, que traz ItemPedCompChildList). Listagens leves
 * nunca devem afirmar ausência.
 * (Mesmo helper usado em alvoPedCompService.ts / alvoPedCompLoadService.ts.)
 */
/**
 * Extrai a data de aprovação final do pedido a partir do detalhe completo.
 * A DataAprovacao fica no item (ItemPedCompChildList), não no cabeçalho.
 * Todos os itens aprovados juntos compartilham a mesma data (a final).
 * Pega a primeira DataAprovacao de item não-cancelado. Null se não aprovado.
 */
function extrairDataAprovacaoAlvo(alvo: any): string | null {
  const itens = (alvo?.ItemPedCompChildList || []) as any[];
  for (const it of itens) {
    if (it?.DataAprovacao && it?.Cancelado !== "Sim") {
      return it.DataAprovacao;
    }
  }
  return null;
}

function extrairVinculoRequisicao(data: any): {
  numero_req_comp: string | null;
  codigo_empresa_filial_req_comp: string | null;
  req_comp_itens: string[] | null;
  vinculo_requisicao: "com_vinculo" | "sem_vinculo";
} {
  const trim = (v: any): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.length > 0 ? s : null;
  };
  const reqCab = trim(data?.NumeroReqComp);
  const filialCab = trim(data?.CodigoEmpresaFilialReqComp);
  const setItens = new Set<string>();
  for (const it of data?.ItemPedCompChildList || []) {
    const r = trim(it?.NumeroReqComp);
    if (r) setItens.add(r);
  }
  const reqsItens = Array.from(setItens);
  const temVinculo = reqCab !== null || reqsItens.length > 0;
  return {
    numero_req_comp: reqCab,
    codigo_empresa_filial_req_comp: filialCab,
    req_comp_itens: reqsItens.length > 0 ? reqsItens : null,
    vinculo_requisicao: temVinculo ? "com_vinculo" : "sem_vinculo",
  };
}

async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  sleepMs: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
    if (i + chunkSize < items.length) {
      await sleep(sleepMs);
    }
  }
  return results;
}

async function callErpProxy(
  url: string,
  systemSecret: string,
  path: string,
): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const resp = await fetch(`${url}${path}`, {
      method: "GET",
      headers: {
        "X-System-Secret": systemSecret,
        "Content-Type": "application/json",
      },
    });
    let data: any = null;
    try {
      data = await resp.json();
    } catch {
      // Body vazio ou não-JSON
    }
    return { ok: resp.ok, status: resp.status, data };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      data: { error: `Fetch failed: ${err?.message || String(err)}` },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// NATUREZA da compra (Produto / Serviço / Misto) — derivada dos valores
// ─────────────────────────────────────────────────────────────────────
//
// O Alvo NÃO tem esse dado: o campo `Tipo` dele é o tipo de ENTREGA
// ("Total"/"Programado"). A natureza sai de ValorMercadoria × ValorServico.
//
// `null` = pedido sem valor lançado — natureza indeterminável. NÃO é "Misto":
// a tela exibe "—" nesse caso (ComprasPedidosCompra.tsx). Misto é só quando os
// DOIS valores são positivos, o que hoje ocorre em 1 pedido de 1.977.
//
// ⚠️ REGRA DUPLICADA DE PROPÓSITO — gêmeo em `mapPedido` de
// `src/services/alvoPedCompService.ts`. Ver comentário no call site.
function derivarNaturezaPedido(
  valorMercadoria: unknown,
  valorServico: unknown,
): string | null {
  const merc = Number(valorMercadoria) || 0;
  const serv = Number(valorServico) || 0;
  if (merc > 0 && serv > 0) return "Misto";
  if (merc > 0) return "Produto";
  if (serv > 0) return "Serviço";
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Mapper: ReqComp do Alvo → status Hub
// ─────────────────────────────────────────────────────────────────────

function mapReqAlvoToHub(
  respData: any,
  notFound: boolean,
): {
  novoStatus: string;
  numeroPedidoCompraAlvo: string | null;
} {
  if (notFound) {
    return { novoStatus: "cancelada", numeroPedidoCompraAlvo: null };
  }

  const statusAlvo = String(respData?.Status || "").toLowerCase();
  const gerouPedComp = String(respData?.GerouPedComp || "").toLowerCase();

  if (statusAlvo === "pedido" || gerouPedComp === "total" || gerouPedComp === "parcial") {
    return { novoStatus: "convertida_pedido", numeroPedidoCompraAlvo: null };
  }

  if (statusAlvo === "cancelado" || statusAlvo === "cancelada") {
    return { novoStatus: "cancelada", numeroPedidoCompraAlvo: null };
  }

  return { novoStatus: "sincronizada", numeroPedidoCompraAlvo: null };
}

// ─────────────────────────────────────────────────────────────────────
// JOB 4: Descobrir Requisições NOVAS no Alvo (NOVO)
// ─────────────────────────────────────────────────────────────────────

async function syncDescobrirRequisicoes(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string,
  runId: string,
): Promise<JobResult> {
  const result: JobResult = {
    total_candidatos: 0,
    total_consultados: 0,
    total_mudaram: 0,
    total_erros: 0,
    detalhes: [],
  };

  const CURSOR_NAME = "req-comp-last-numero-1.01";
  const WINDOW_DAYS_NORMAL = 30;
  const WINDOW_DAYS_BACKFILL = 1095; // 3 anos no primeiro disparo

  // ── 1. Lê cursor ────────────────────────────────────────────────────
  const { data: cursorRow, error: errCursor } = await supabase
    .from("sync_cursors")
    .select("cursor_value")
    .eq("cursor_name", CURSOR_NAME)
    .maybeSingle();

  if (errCursor) {
    console.error("[descobrir-req] erro ao ler cursor:", errCursor);
    result.total_erros = 1;
    return result;
  }

  // Auto-cria cursor se não existir
  if (!cursorRow) {
    console.log("[descobrir-req] cursor não existe, criando...");
    await supabase.from("sync_cursors").insert({
      cursor_name: CURSOR_NAME,
      cursor_value: "0000000",
      updated_by_run_id: runId,
    });
  }

  const lastKnownNumero = cursorRow?.cursor_value || "0000000";
  const isBackfill = lastKnownNumero === "0000000";
  const windowDays = isBackfill ? WINDOW_DAYS_BACKFILL : WINDOW_DAYS_NORMAL;

  console.log(`[descobrir-req] cursor: ${lastKnownNumero} (${isBackfill ? "BACKFILL 3 anos" : "normal 30d"})`);

  // ── 2. Janela de datas ──────────────────────────────────────────────
  const hoje = new Date();
  const inicio = new Date();
  inicio.setDate(hoje.getDate() - windowDays);

  const dataFim = hoje.toISOString().slice(0, 10);
  const dataInicio = inicio.toISOString().slice(0, 10);

  // ── 3. /req-comp/list ───────────────────────────────────────────────
  // apenasAbertas=false (10/06/2026): traz também reqs convertidas e
  // canceladas — essencial para descobrir reqs que fecharam entre ciclos.
  const reqListPath = `/req-comp/list?dataInicio=${dataInicio}&dataFim=${dataFim}&apenasAbertas=false`;
  const resp = await callErpProxy(erpUrl, systemSecret, reqListPath);

  if (!resp.ok) {
    console.error(`[descobrir-req] /list falhou: status=${resp.status}`);
    result.total_erros = 1;
    result.detalhes.push({
      tipo: "req",
      id: "",
      numero_alvo: "",
      erro: `GET /req-comp/list falhou: HTTP ${resp.status} - ${resp.data?.error || "desconhecido"}`,
    });
    return result;
  }

  const todasReqs = (resp.data || []) as RequisicaoLeve[];
  result.total_consultados = todasReqs.length;
  result.total_candidatos = todasReqs.length;

  console.log(`[descobrir-req] Alvo retornou ${todasReqs.length} reqs na janela`);

  // ── 4. Separa novas (inserir) de existentes (atualizar status) ──────
  // Com apenasAbertas=false, reqs ausentes do Hub são inseridas mesmo com
  // Numero <= cursor (reconciliação na janela); reqs existentes têm o
  // status atualizado quando o list indicar conversão/cancelamento.
  const numerosJanela = todasReqs.map((r) => r.Numero).filter(Boolean);

  const existentesMap = new Map<string, { id: string; status: string }>();
  if (numerosJanela.length > 0) {
    const { data: existentes, error: errExist } = await supabase
      .from("compras_requisicoes")
      .select("id, numero_alvo, codigo_empresa_filial, status")
      .in("numero_alvo", numerosJanela);

    if (errExist) {
      console.error("[descobrir-req] erro ao buscar existentes:", errExist);
      result.total_erros = 1;
      return result;
    }
    for (const e of existentes || []) {
      existentesMap.set(`${e.codigo_empresa_filial}|${e.numero_alvo}`, { id: e.id, status: e.status });
    }
  }

  // CARD B2 — `rejeitada` é terminal do Hub tanto quanto as outras duas. Hoje ela
  // nunca casa com o list (estado exclusivo do Hub, sem `numero_alvo`), então isto
  // é defesa em profundidade: se uma rejeitada ganhar número, o list não pode
  // rebaixá-la para `sincronizada` e devolvê-la ao fluxo de compra.
  const STATUS_TERMINAIS = ["convertida_pedido", "cancelada", "rejeitada"];

  // ── 5. Processa cada req da janela ──────────────────────────────────
  let maiorNumeroVisto = lastKnownNumero;

  for (const req of todasReqs) {
    try {
      if (!req.Numero) {
        console.warn(`[descobrir-req] req sem Numero, ignorada`);
        continue;
      }

      const dateOnly = (s: string | null) => (s ? s.slice(0, 10) : null);

      // Mapeia status local (Status='Pedido' OU GerouPedComp Total/Parcial
      // indicam conversão — validado empiricamente no grid em 10/06/2026)
      let statusLocal = "sincronizada";
      if (req.GerouPedComp === "Total" || req.GerouPedComp === "Parcial" || req.Status === "Pedido") {
        statusLocal = "convertida_pedido";
      }
      if (req.Status === "Cancelado" || req.Status === "Cancelada") {
        statusLocal = "cancelada";
      }

      // ── REABERTURA CONFIRMADA (correção 22/06/2026) ──────────────────
      // Quando um pedido é EXCLUÍDO no Alvo, a requisição volta a ficar
      // "Aberto"/GerouPedComp="Não" lá. Sem tratamento, a guarda anti-
      // rebaixamento abaixo deixa o status preso em 'convertida_pedido'
      // para sempre (req órfã apontando para pedido inexistente).
      // Só consideramos reabertura quando o list AFIRMA POSITIVAMENTE que
      // a req está aberta e sem pedido — strings explícitas do Alvo, nunca
      // o default por omissão. Isso preserva a proteção contra list
      // defasado (que viria com campos vazios/null, não "Não"/"Aberto").
      const reaberturaConfirmada = String(req.GerouPedComp) === "Não" && String(req.Status) === "Aberto";

      const chave = `${req.CodigoEmpresaFilial}|${req.Numero}`;
      const existing = existentesMap.get(chave);

      if (existing) {
        // ── Req JÁ existe no Hub: atualiza status se houver progressão ──
        // Guarda anti-rebaixamento: status terminal nunca volta a
        // 'sincronizada' pelo list (que pode estar defasado do detalhe).
        // EXCEÇÃO: reabertura confirmada (pedido excluído no Alvo) libera
        // o rebaixamento convertida_pedido → sincronizada.
        // UPDATE NÃO TOCA em requisitante_user_id, codigo_funcionario,
        // codigo_centro_ctrl etc. — campos do wizard do Hub.
        const rebaixamento = STATUS_TERMINAIS.includes(existing.status) && !STATUS_TERMINAIS.includes(statusLocal);
        const rebaixamentoBloqueado = rebaixamento && !reaberturaConfirmada;

        if (existing.status === statusLocal || rebaixamentoBloqueado) {
          if (req.Numero > maiorNumeroVisto) maiorNumeroVisto = req.Numero;
          continue;
        }

        const { error: errUpd } = await supabase
          .from("compras_requisicoes")
          .update({
            status: statusLocal,
            updated_at: new Date().toISOString(),
            // Reabertura confirmada (pedido excluído no Alvo): limpa o elo
            // órfão junto com o rebaixamento do status.
            ...(reaberturaConfirmada ? { numero_pedido_compra_alvo: null } : {}),
          })
          .eq("id", existing.id);

        if (errUpd) {
          result.total_erros++;
          result.detalhes.push({
            tipo: "req",
            id: existing.id,
            numero_alvo: req.Numero,
            erro: `UPDATE status falhou: ${errUpd.message}`,
          });
          console.error(`[descobrir-req] ${req.Numero} UPDATE falhou:`, errUpd);
          continue;
        }

        const eventoAudit =
          statusLocal === "convertida_pedido"
            ? "convertida_pedido"
            : statusLocal === "cancelada"
              ? "cancelada_alvo"
              : "sync_status";

        // 🔴 ESTE é o ramo que já disparou — não o do Job 1. `sync_status` NÃO está
        // no CHECK `compras_requisicoes_auditoria_evento_check` (15 valores,
        // conferido em 28/08/2026), e aqui ele é ALCANÇÁVEL: `reaberturaConfirmada`
        // libera o rebaixamento `convertida_pedido` → `sincronizada`, o UPDATE acima
        // grava o status E zera `numero_pedido_compra_alvo`, e sem esta checagem o
        // insert era rejeitado em silêncio (o supabase-js devolve `{data, error}`)
        // com o `total_mudaram++` reportando sucesso por cima.
        // É a assinatura exata das 6 requisições do §14.2 — 5 sem vínculo (zerado
        // aqui) e a 0001215 com vínculo, porque o Job 2 e o Job 3 re-vinculam quando
        // o campo está null. A tabela "Escritores eliminados" daquele card olhou só o
        // filtro do Job 1 (`:995`) e nunca examinou este job.
        const { error: errAudit } = await supabase.from("compras_requisicoes_auditoria").insert({
          requisicao_id: existing.id,
          evento: eventoAudit,
          user_id: null,
          user_nome: "Job 4 — Descoberta automática",
          sucesso: true,
          resposta_alvo: req,
        });

        if (errAudit) {
          result.total_erros++;
          result.detalhes.push({
            tipo: "req",
            id: existing.id,
            numero_alvo: req.Numero,
            erro:
              `auditoria NÃO gravada (evento '${eventoAudit}'): ${errAudit.message}. ` +
              `O status já foi gravado como '${statusLocal}' (era '${existing.status}')` +
              `${reaberturaConfirmada ? " e o vínculo com o pedido foi zerado" : ""} — ` +
              `escrita sem rastro. Este ciclo NÃO conta como mudança.`,
          });
          console.error(
            `[descobrir-req] ${req.Numero}: status ${existing.status} → ${statusLocal} gravado, ` +
              `mas a auditoria '${eventoAudit}' foi rejeitada:`,
            errAudit,
          );
          if (req.Numero > maiorNumeroVisto) maiorNumeroVisto = req.Numero;
          continue;
        }

        result.total_mudaram++;
        result.detalhes.push({
          tipo: "req",
          id: existing.id,
          numero_alvo: req.Numero,
          status_anterior: existing.status,
          status_novo: statusLocal,
        });

        console.log(`[descobrir-req] ${req.Numero}: ${existing.status} → ${statusLocal} (via list)`);

        if (req.Numero > maiorNumeroVisto) maiorNumeroVisto = req.Numero;
        continue;
      }

      // ── Req NÃO existe no Hub: INSERT (descoberta / reconciliação) ────
      const { error: errIns } = await supabase.from("compras_requisicoes").insert({
        codigo_empresa_filial: req.CodigoEmpresaFilial,
        numero_alvo: req.Numero,
        status: statusLocal,
        codigo_funcionario: req.CodigoFuncionario,
        codigo_centro_ctrl: req.CodigoCentroCtrl,
        codigo_finalidade_compra: req.CodigoFinalidadeCompra,
        descricao: req.Descricao,
        data_necessidade: dateOnly(req.Data),
        requisitante_user_id: null,
        total_itens: null,
        updated_at: new Date().toISOString(),
      });

      if (errIns) {
        result.total_erros++;
        result.detalhes.push({
          tipo: "req",
          id: "",
          numero_alvo: req.Numero,
          erro: `INSERT falhou: ${errIns.message}`,
        });
        console.error(`[descobrir-req] ${req.Numero} INSERT falhou:`, errIns);
        continue;
      }

      // Busca id pra audit
      const { data: reqRow } = await supabase
        .from("compras_requisicoes")
        .select("id")
        .eq("codigo_empresa_filial", req.CodigoEmpresaFilial)
        .eq("numero_alvo", req.Numero)
        .single();

      if (reqRow?.id) {
        // 🔴 `descoberta_alvo` também NÃO está no CHECK — este insert falha em
        // 100% das vezes desde que nasceu (26/05/2026, `0081425`). Medido em
        // 28/08/2026: ZERO linhas com esse evento, e 69 requisições sem NENHUMA
        // auditoria, todas com `requisitante_user_id` null, isto é, todas nascidas
        // aqui. Toda requisição nova descoberta no Alvo entrava no Hub sem linha de
        // origem, e o ciclo contava como sucesso.
        // ⚠️ Ao contrário do ramo de UPDATE acima, aqui o `total_mudaram++` É
        // mantido: a linha nova em `compras_requisicoes` é, ela própria, o rastro da
        // descoberta. O que se perde é a resposta do Alvo, não o fato.
        const { error: errAuditIns } = await supabase.from("compras_requisicoes_auditoria").insert({
          requisicao_id: reqRow.id,
          evento: "descoberta_alvo",
          user_id: null,
          user_nome: "Job 4 — Descoberta automática",
          sucesso: true,
          resposta_alvo: req,
        });

        if (errAuditIns) {
          result.total_erros++;
          result.detalhes.push({
            tipo: "req",
            id: reqRow.id,
            numero_alvo: req.Numero,
            erro:
              `auditoria de descoberta NÃO gravada (evento 'descoberta_alvo'): ${errAuditIns.message}. ` +
              `A requisição FOI criada no Hub; o que se perdeu foi a resposta do Alvo.`,
          });
          console.error(`[descobrir-req] ${req.Numero}: auditoria 'descoberta_alvo' rejeitada:`, errAuditIns);
        }
      }

      if (req.Numero > maiorNumeroVisto) {
        maiorNumeroVisto = req.Numero;
      }

      result.total_mudaram++;
      result.detalhes.push({
        tipo: "req",
        id: reqRow?.id || "",
        numero_alvo: req.Numero,
        status_anterior: "novo",
        status_novo: statusLocal,
      });

      console.log(`[descobrir-req] inserida ${req.Numero} (status=${statusLocal})`);
    } catch (err: any) {
      result.total_erros++;
      result.detalhes.push({
        tipo: "req",
        id: "",
        numero_alvo: req.Numero,
        erro: `Exception: ${err?.message || String(err)}`,
      });
      console.error(`[descobrir-req] erro ${req.Numero}:`, err);
    }
  }

  // ── 6. Atualiza cursor ──────────────────────────────────────────────
  if (maiorNumeroVisto > lastKnownNumero) {
    const { error: errCursorUpdate } = await supabase.from("sync_cursors").upsert(
      {
        cursor_name: CURSOR_NAME,
        cursor_value: maiorNumeroVisto,
        updated_at: new Date().toISOString(),
        updated_by_run_id: runId,
      },
      { onConflict: "cursor_name" },
    );

    if (errCursorUpdate) {
      console.error("[descobrir-req] falhou atualizando cursor:", errCursorUpdate);
    } else {
      console.log(`[descobrir-req] cursor: ${lastKnownNumero} → ${maiorNumeroVisto}`);
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// CARD R1.2 — espelhamento do detalhe completo de requisições
// ─────────────────────────────────────────────────────────────────────

interface ItemRequisicaoAlvoNormalizado {
  sequencia: number;
  item_servico: boolean;
  codigo_produto: string;
  codigo_alternativo_produto: string | null;
  codigo_prod_unid_med: string;
  quantidade: number;
  data_necessidade: string;
  codigo_centro_ctrl: string;
  observacao: string | null;
  produto_nome: string | null;
  produto_unidade: string | null;
}

interface ResultadoEspelhoRequisicao {
  itens_inseridos: number;
  itens_cc_atualizados: number;
  classes_rateio: number;
  ccs_rateio: number;
}

function textoObrigatorioAlvo(valor: unknown, campo: string): string {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (!texto) throw new Error(`${campo}_AUSENTE`);
  return texto;
}

/** Preserva null no percentual de classe: a RPC normaliza somente quando há
 * uma única classe. Converter omissão para zero aqui esconderia a diferença
 * entre "não veio" e "veio zero" antes da validação autoritativa. */
function percentualRequisicaoAlvo(valor: unknown, campo: string): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) throw new Error(`${campo}_INVALIDO: ${String(valor)}`);
  return numero;
}

function extrairRateioRequisicaoAlvo(alvo: any, catalogos: CatalogosLabels): any[] {
  const classes = alvo?.ReqCompClasseRecDespChildList;
  if (!Array.isArray(classes)) {
    throw new Error("REQ_RATEIO_AUSENTE_NO_LOAD");
  }

  return classes.map((classe: any, indiceClasse: number) => {
    const codigoClasse = textoObrigatorioAlvo(
      classe?.CodigoClasseRecDesp,
      `REQ_CLASSE_${indiceClasse + 1}_CODIGO`,
    );
    const ccs = classe?.RateioReqCompChildList;
    if (!Array.isArray(ccs)) {
      throw new Error(`REQ_CLASSE_${indiceClasse + 1}_CCS_AUSENTES_NO_LOAD`);
    }

    return {
      codigo_classe_rec_desp: codigoClasse,
      classe_rec_desp_label: catalogos.classes.get(codigoClasse) ?? null,
      percentual: percentualRequisicaoAlvo(
        classe?.Percentual,
        `REQ_CLASSE_${indiceClasse + 1}_PERCENTUAL`,
      ),
      ccs: ccs.map((cc: any, indiceCc: number) => {
        const codigoCc = textoObrigatorioAlvo(
          cc?.CodigoCentroCtrl,
          `REQ_CLASSE_${indiceClasse + 1}_CC_${indiceCc + 1}_CODIGO`,
        );
        return {
          codigo_centro_ctrl: codigoCc,
          centro_ctrl_label: catalogos.centros.get(codigoCc) ?? null,
          percentual: percentualRequisicaoAlvo(
            cc?.Percentual,
            `REQ_CLASSE_${indiceClasse + 1}_CC_${indiceCc + 1}_PERCENTUAL`,
          ),
        };
      }),
    };
  });
}

function extrairItensRequisicaoAlvo(alvo: any, req: RequisicaoHub): ItemRequisicaoAlvoNormalizado[] {
  const itens = alvo?.ItemReqCompChildList;
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new Error("REQ_ITENS_AUSENTES_NO_LOAD");
  }

  const sequencias = new Set<number>();
  return itens.map((item: any, indice: number) => {
    const sequencia = Number(item?.Sequencia);
    if (!Number.isInteger(sequencia) || sequencia <= 0) {
      throw new Error(`REQ_ITEM_${indice + 1}_SEQUENCIA_INVALIDA: ${String(item?.Sequencia)}`);
    }
    if (sequencias.has(sequencia)) {
      throw new Error(`REQ_ITEM_SEQUENCIA_DUPLICADA_NO_LOAD: ${sequencia}`);
    }
    sequencias.add(sequencia);

    const quantidade = Number(item?.QuantidadeProdUnidMedPrincipal);
    if (!Number.isFinite(quantidade) || quantidade <= 0) {
      throw new Error(`REQ_ITEM_${sequencia}_QUANTIDADE_INVALIDA: ${String(item?.QuantidadeProdUnidMedPrincipal)}`);
    }

    const dataNecessidade = textoObrigatorioAlvo(
      item?.DataNecessidade ?? req.data_necessidade,
      `REQ_ITEM_${sequencia}_DATA_NECESSIDADE`,
    );

    return {
      sequencia,
      item_servico: item?.ItemServico === "Sim",
      codigo_produto: textoObrigatorioAlvo(item?.CodigoProduto, `REQ_ITEM_${sequencia}_PRODUTO`),
      codigo_alternativo_produto: item?.CodigoAlternativoProduto ?? null,
      codigo_prod_unid_med: textoObrigatorioAlvo(item?.CodigoProdUnidMed, `REQ_ITEM_${sequencia}_UNIDADE`),
      quantidade,
      data_necessidade: dataNecessidade,
      // Fonte canônica é o ITEM. Ausência é erro: nunca cai para o CC do
      // cabeçalho, pois isso apagaria justamente a divergência que o R1 mede.
      codigo_centro_ctrl: textoObrigatorioAlvo(item?.CodigoCentroCtrl, `REQ_ITEM_${sequencia}_CC`),
      observacao: item?.Observacao ?? null,
      produto_nome: item?.NomeProduto ?? item?.DescricaoAlternativaProduto ?? null,
      produto_unidade: item?.CodigoProdUnidMed ?? null,
    };
  });
}

async function espelharDetalheRequisicao(
  supabase: SupabaseClient,
  req: RequisicaoHub,
  alvo: any,
  catalogos: CatalogosLabels,
): Promise<ResultadoEspelhoRequisicao> {
  // Toda a entrada é extraída e validada antes da primeira escrita.
  const rateio = extrairRateioRequisicaoAlvo(alvo, catalogos);
  const itensAlvo = extrairItensRequisicaoAlvo(alvo, req);

  const { data: itensHub, error: errItensHub } = await supabase
    .from("compras_requisicoes_itens")
    .select("id, sequencia, codigo_centro_ctrl")
    .eq("requisicao_id", req.id);
  if (errItensHub) throw new Error(`REQ_ITENS_HUB_SELECT: ${errItensHub.message}`);

  const itensPorSequencia = new Map<number, { id: string; codigo_centro_ctrl: string }>();
  for (const item of itensHub || []) {
    const sequencia = Number(item.sequencia);
    if (itensPorSequencia.has(sequencia)) {
      throw new Error(`REQ_ITEM_SEQUENCIA_DUPLICADA_NO_HUB: ${sequencia}`);
    }
    itensPorSequencia.set(sequencia, {
      id: item.id,
      codigo_centro_ctrl: item.codigo_centro_ctrl,
    });
  }

  // Sempre chama, inclusive com []: o Load é autoritativo e [] precisa apagar
  // qualquer espelho anterior. A RPC valida e substitui os dois níveis em uma
  // transação; se falhar, nenhum item é tocado e a requisição não é rotacionada.
  const { data: rpcResult, error: errRpc } = await supabase.rpc("req_replace_rateio", {
    p_requisicao_id: req.id,
    p_rateio: rateio,
    p_origem: "alvo",
  });
  if (errRpc) throw new Error(`req_replace_rateio: ${errRpc.message}`);

  let itensCcAtualizados = 0;
  const itensNovos: Record<string, unknown>[] = [];
  for (const item of itensAlvo) {
    const existente = itensPorSequencia.get(item.sequencia);
    if (!existente) {
      itensNovos.push({ requisicao_id: req.id, ...item });
      continue;
    }
    if (existente.codigo_centro_ctrl === item.codigo_centro_ctrl) continue;

    const { error: errUpdateCc } = await supabase
      .from("compras_requisicoes_itens")
      .update({ codigo_centro_ctrl: item.codigo_centro_ctrl })
      .eq("id", existente.id);
    if (errUpdateCc) {
      throw new Error(`REQ_ITEM_${item.sequencia}_UPDATE_CC: ${errUpdateCc.message}`);
    }
    itensCcAtualizados++;
  }

  if (itensNovos.length > 0) {
    const { error: errInsertItens } = await supabase.from("compras_requisicoes_itens").insert(itensNovos);
    if (errInsertItens) throw new Error(`REQ_ITENS_INSERT: ${errInsertItens.message}`);
  }

  return {
    itens_inseridos: itensNovos.length,
    itens_cc_atualizados: itensCcAtualizados,
    classes_rateio: Number((rpcResult as any)?.classes_inseridas) || 0,
    ccs_rateio: Number((rpcResult as any)?.ccs_inseridos) || 0,
  };
}

// ─────────────────────────────────────────────────────────────────────
// JOB 1: Sincronizar Requisições (mudanças)
// ─────────────────────────────────────────────────────────────────────

async function syncRequisicoes(supabase: SupabaseClient, erpUrl: string, systemSecret: string): Promise<JobResult> {
  const result: JobResult = {
    total_candidatos: 0,
    total_consultados: 0,
    total_mudaram: 0,
    total_erros: 0,
    detalhes: [],
  };

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 180);

  const { data: candidatas, error: errSelect } = await supabase
    .from("compras_requisicoes")
    .select(
      "id, requisitante_user_id, status, codigo_empresa_filial, numero_alvo, numero_pedido_compra_alvo, codigo_funcionario, codigo_centro_ctrl, codigo_finalidade_compra, data_necessidade, total_itens",
    )
    .eq("status", "sincronizada")
    .not("numero_alvo", "is", null)
    .gte("created_at", cutoffDate.toISOString())
    .order("updated_at", { ascending: true, nullsFirst: true })
    .limit(REQ_BATCH_SIZE);

  if (errSelect) {
    console.error("[sync-req] erro ao buscar candidatas:", errSelect);
    result.total_erros = 1;
    return result;
  }

  const reqs = (candidatas || []) as RequisicaoHub[];
  result.total_candidatos = reqs.length;

  if (reqs.length === 0) {
    console.log("[sync-req] zero candidatas");
    return result;
  }

  console.log(`[sync-req] ${reqs.length} candidatas`);

  // Labels são enriquecimento local; duas leituras por ciclo, não por req.
  const catalogos = await carregarCatalogosLabels(supabase);

  await processInChunks(reqs, CHUNK_SIZE, SLEEP_BETWEEN_CHUNKS_MS, async (req) => {
    try {
      const path = `/req-comp/${encodeURIComponent(req.codigo_empresa_filial)}/${encodeURIComponent(req.numero_alvo)}`;
      const resp = await callErpProxy(erpUrl, systemSecret, path);

      result.total_consultados++;

      const notFound = resp.status === 404;

      if (!resp.ok && !notFound) {
        result.total_erros++;
        result.detalhes.push({
          tipo: "req",
          id: req.id,
          numero_alvo: req.numero_alvo,
          erro: `HTTP ${resp.status}: ${resp.data?.error || "erro desconhecido"}`,
        });
        return;
      }

      if (!notFound) {
        try {
          const espelho = await espelharDetalheRequisicao(supabase, req, resp.data, catalogos);
          console.log(
            `[sync-req][R1.2] ${req.numero_alvo}: ` +
              `${espelho.itens_inseridos} itens inseridos, ` +
              `${espelho.itens_cc_atualizados} CCs de item atualizados, ` +
              `${espelho.classes_rateio} classes e ${espelho.ccs_rateio} CCs de rateio`,
          );
        } catch (detalheErr: any) {
          result.total_erros++;
          result.detalhes.push({
            tipo: "req",
            id: req.id,
            numero_alvo: req.numero_alvo,
            erro: `r1_2_detalhe: ${detalheErr?.message || String(detalheErr)}`,
          });
          console.error(`[sync-req][R1.2] ${req.numero_alvo}: espelhar detalhe falhou:`, detalheErr);
          // Não atualiza status nem updated_at: continua elegível e volta no
          // próximo ciclo. Em especial, falha da RPC nunca parece sucesso.
          return;
        }
      }

      const { novoStatus } = mapReqAlvoToHub(resp.data, notFound);

      if (novoStatus === req.status) {
        // Rotaciona apenas depois do sucesso TOTAL do detalhe. Sem isto, as 50
        // candidatas mais antigas monopolizam o lote e o restante nunca chega.
        const { error: errTouch } = await supabase
          .from("compras_requisicoes")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", req.id);
        if (errTouch) {
          result.total_erros++;
          result.detalhes.push({
            tipo: "req",
            id: req.id,
            numero_alvo: req.numero_alvo,
            erro: `R1.2 rotação da fila falhou: ${errTouch.message}`,
          });
        }
        return;
      }

      const { error: errUpsert } = await supabase.from("compras_requisicoes").upsert(
        {
          id: req.id,
          requisitante_user_id: req.requisitante_user_id,
          status: novoStatus,
          codigo_empresa_filial: req.codigo_empresa_filial,
          codigo_funcionario: req.codigo_funcionario,
          codigo_centro_ctrl: req.codigo_centro_ctrl,
          codigo_finalidade_compra: req.codigo_finalidade_compra,
          data_necessidade: req.data_necessidade,
          total_itens: req.total_itens,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      if (errUpsert) {
        result.total_erros++;
        result.detalhes.push({
          tipo: "req",
          id: req.id,
          numero_alvo: req.numero_alvo,
          erro: `UPSERT falhou: ${errUpsert.message}`,
        });
        return;
      }

      const eventoAudit =
        novoStatus === "convertida_pedido"
          ? "convertida_pedido"
          : novoStatus === "cancelada"
            ? "cancelada_alvo"
            : "sync_status";

      // 🔴 O `error` DEVE ser conferido: o supabase-js devolve `{data, error}` em vez
      // de lançar, então um insert rejeitado passa despercebido. E o status já foi
      // gravado no `upsert` logo acima — descartar a rejeição aqui produz exatamente
      // o padrão do §14.2: mudança de status SEM linha de auditoria, com o
      // `total_mudaram++` da linha seguinte reportando sucesso ao `sync_runs`.
      //
      // A armadilha tem nome: `eventoAudit` vale `"sync_status"` no ramo
      // `sincronizada`, e `sync_status` NÃO está no CHECK
      // `compras_requisicoes_auditoria_evento_check` (15 valores, nenhum é esse —
      // conferido em 28/08/2026).
      //
      // ⚠️ NESTE job (Job 1) o ramo é inalcançável: a fila é
      // `.eq("status", "sincronizada")` e o mapper (`mapReqAlvoToHub`) só devolve
      // `convertida_pedido`, `cancelada` ou `sincronizada` — a última cai no
      // `if (novoStatus === req.status)` acima, e as outras duas SÃO válidas no
      // CHECK. Aqui a checagem só dispara por falha de infra (RLS, rede, FK).
      // 🔴 **O gêmeo que JÁ disparou está no Job 4** (`syncDescobrirRequisicoes`,
      // ramo de reabertura), e é ele que explica as 6 requisições do §14.2. Se
      // mexer nesta checagem, mexa lá também.
      //
      // Esta é a defesa (b) do §14.2-A; a defesa (a) — pôr `sync_status` e
      // `descoberta_alvo` no CHECK — é DDL e vive em
      // `docs/SQL-14.2A-check-sync-status.sql`. São complementares.
      //
      // ⚠️ O `continue` abaixo tira a requisição do ciclo, mas o status já gravado
      // NÃO satisfaz mais o filtro da fila — ela não volta sozinha. A auditoria
      // perdida só se recupera à mão.
      const { error: errAudit } = await supabase.from("compras_requisicoes_auditoria").insert({
        requisicao_id: req.id,
        evento: eventoAudit,
        user_id: null,
        user_nome: "Sincronização automática",
        sucesso: true,
        resposta_alvo: notFound ? { not_found: true } : resp.data,
      });

      if (errAudit) {
        result.total_erros++;
        result.detalhes.push({
          tipo: "req",
          id: req.id,
          numero_alvo: req.numero_alvo,
          erro:
            `auditoria NÃO gravada (evento '${eventoAudit}'): ${errAudit.message}. ` +
            `O status já foi gravado como '${novoStatus}' (era '${req.status}') — ` +
            `escrita sem rastro. Este ciclo NÃO conta como mudança, e a requisição ` +
            `sai da fila deste job — a auditoria perdida NÃO volta sozinha.`,
        });
        console.error(
          `[sync-req] ${req.numero_alvo}: status ${req.status} → ${novoStatus} gravado, ` +
            `mas a auditoria '${eventoAudit}' foi rejeitada:`,
          errAudit,
        );
        // Não incrementa `total_mudaram`: o ciclo não pode reportar sucesso numa
        // transição que ficou sem rastro.
        return;
      }

      result.total_mudaram++;
      result.detalhes.push({
        tipo: "req",
        id: req.id,
        numero_alvo: req.numero_alvo,
        status_anterior: req.status,
        status_novo: novoStatus,
      });

      console.log(`[sync-req] ${req.numero_alvo}: ${req.status} → ${novoStatus}`);
    } catch (err: any) {
      result.total_erros++;
      result.detalhes.push({
        tipo: "req",
        id: req.id,
        numero_alvo: req.numero_alvo,
        erro: `Exception: ${err?.message || String(err)}`,
      });
      console.error(`[sync-req] erro ${req.numero_alvo}:`, err);
    }
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// JOB 3: Descobrir Pedidos NOVOS no Alvo
// ─────────────────────────────────────────────────────────────────────

async function syncDescobrirPedidos(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string,
  runId: string,
  windowDaysOverride?: number,
): Promise<{ result: JobResult; crossCheck: CrossCheckPedidos }> {
  const result: JobResult = {
    total_candidatos: 0,
    total_consultados: 0,
    total_mudaram: 0,
    total_erros: 0,
    detalhes: [],
  };

  // Cross-check para o Job 2 (L3 Missão 2). Default = listaOk:false: se qualquer
  // coisa aqui falhar/truncar, o Job 2 faz no-op nos 404 e NÃO marca exclusão.
  const crossCheck: CrossCheckPedidos = {
    listaOk: false,
    janelaInicio: "",
    janelaFim: "",
    numerosVistos: new Set<string>(),
  };

  const CURSOR_NAME = "ped-comp-last-numero-1.01";
  const FILIAL = "1.01";
  // Janela normal de 30 dias (alinhada ao Job 4). Override permite recuperação
  // de histórico (ex.: 180) num disparo manual, sem alterar o regime normal.
  const WINDOW_DAYS = windowDaysOverride && windowDaysOverride > 0 ? windowDaysOverride : 30;
  // Paginação da /ped-comp/list. LIST_MAX_PAGES ESPELHA o MAX_PAGES do erp-proxy
  // (rota /ped-comp/list) — manter em sync. Se a lista atingir o teto
  // (pageSize × MAX_PAGES) pode ter truncado silenciosamente → set incompleto →
  // desligamos o cross-check (listaOk=false) para NUNCA marcar pedido vivo como
  // excluído. Perder um ciclo de marcação é aceitável; falso-positivo não.
  const LIST_PAGE_SIZE = 200; // máx aceito pelo proxy
  const LIST_MAX_PAGES = 50; // ESPELHA erp-proxy /ped-comp/list MAX_PAGES
  const LIST_CAP = LIST_PAGE_SIZE * LIST_MAX_PAGES;

  const { data: cursorRow, error: errCursor } = await supabase
    .from("sync_cursors")
    .select("cursor_value")
    .eq("cursor_name", CURSOR_NAME)
    .maybeSingle();

  if (errCursor) {
    console.error("[descobrir-ped] erro ao ler cursor:", errCursor);
    result.total_erros = 1;
    return { result, crossCheck };
  }

  const lastKnownNumero = cursorRow?.cursor_value || "0000000";
  console.log(`[descobrir-ped] cursor atual: ${lastKnownNumero}`);

  const hoje = new Date();
  const inicio = new Date();
  inicio.setDate(hoje.getDate() - WINDOW_DAYS);

  const dataFim = hoje.toISOString().slice(0, 10);
  const dataInicio = inicio.toISOString().slice(0, 10);

  // Registra a janela efetivamente varrida — é o alcance do cross-check do Job 2.
  crossCheck.janelaInicio = dataInicio;
  crossCheck.janelaFim = dataFim;

  console.log(`[descobrir-ped] janela: ${dataInicio} → ${dataFim}`);

  const path = `/ped-comp/list?dataInicio=${dataInicio}&dataFim=${dataFim}&pageSize=${LIST_PAGE_SIZE}`;
  const resp = await callErpProxy(erpUrl, systemSecret, path);

  if (!resp.ok) {
    console.error(`[descobrir-ped] /list falhou: status=${resp.status}`);
    result.total_erros = 1;
    result.detalhes.push({
      tipo: "ped",
      id: "",
      numero_alvo: "",
      erro: `GET /ped-comp/list falhou: HTTP ${resp.status} - ${resp.data?.error || "desconhecido"}`,
    });
    return { result, crossCheck };
  }

  const todosPedidos = (resp.data || []) as PedidoLeve[];
  result.total_consultados = todosPedidos.length;
  result.total_candidatos = todosPedidos.length;

  console.log(`[descobrir-ped] Alvo retornou ${todosPedidos.length} pedidos na janela`);

  // ── CROSS-CHECK (L3 Missão 2): monta o conjunto do que o Alvo lista + trava
  // de truncação. Se a lista atingiu o teto de paginação, pode estar truncada
  // → set incompleto → desliga o cross-check (listaOk=false) para não marcar
  // pedido vivo como excluído.
  const possibleTruncation = todosPedidos.length >= LIST_CAP;
  if (possibleTruncation) {
    console.warn(
      `[descobrir-ped] POSSÍVEL TRUNCAÇÃO: /list retornou ${todosPedidos.length} >= teto ${LIST_CAP} ` +
        `(pageSize ${LIST_PAGE_SIZE} × MAX_PAGES ${LIST_MAX_PAGES}). Cross-check DESLIGADO neste ciclo (listaOk=false).`,
    );
  }
  crossCheck.listaOk = !possibleTruncation;
  crossCheck.numerosVistos = new Set(
    todosPedidos.filter((p) => p.Numero).map((p) => `${p.CodigoEmpresaFilial}|${p.Numero}`),
  );

  // ── RECONCILIAÇÃO NA JANELA (correção do buraco de descoberta) ──────
  // Antes: filtrava só Numero > cursor, então pedidos que ficaram abaixo do
  // cursor mas ausentes do Hub NUNCA eram inseridos (causa do buraco de abril
  // 3733-3908). Agora processa TODOS os pedidos da janela: insere os ausentes
  // (mesmo Numero <= cursor) e pula os que já existem sem mudança relevante.
  // Espelha a correção aplicada ao Job 4 em 10/06/2026.
  const novos = todosPedidos;
  console.log(`[descobrir-ped] ${novos.length} pedidos na janela (reconciliação completa, cursor=${lastKnownNumero})`);

  if (novos.length === 0) {
    return { result, crossCheck };
  }

  let maiorNumeroVisto = lastKnownNumero;

  for (const ped of novos) {
    try {
      if (!ped.Numero) {
        console.warn(`[descobrir-ped] pedido sem Numero, ignorado:`, ped);
        continue;
      }

      const dateOnly = (s: string | null) => (s ? s.slice(0, 10) : null);

      // Checa existência ANTES do upsert: pedido criado no Hub e redescoberto
      // aqui NÃO deve ter criado_no_hub/status_local/detalhes_carregados
      // sobrescritos (bug corrigido em 10/06/2026).
      const { data: existingPed } = await supabase
        .from("compras_pedidos")
        .select("id, criado_no_hub")
        .eq("codigo_empresa_filial", ped.CodigoEmpresaFilial)
        .eq("numero", ped.Numero)
        .maybeSingle();

      // RECONCILIAÇÃO: na janela processamos todos, mas o Job 3 só INSERE os
      // ausentes. Pedidos já existentes ficam a cargo do Job 2 (mudanças) —
      // não os reprocessamos aqui para evitar upserts redundantes. Ainda assim
      // atualizamos o "maior número visto" para o cursor avançar corretamente.
      if (existingPed) {
        if (ped.Numero > maiorNumeroVisto) {
          maiorNumeroVisto = ped.Numero;
        }
        continue;
      }

      const temVinculoNoList = !!(ped.NumeroReqComp && String(ped.NumeroReqComp).trim());

      const { error: errIns } = await supabase.from("compras_pedidos").upsert(
        {
          codigo_empresa_filial: ped.CodigoEmpresaFilial,
          numero: ped.Numero,
          status: ped.Status,
          aprovado: ped.Aprovado,
          status_aprovacao: ped.StatusAprovacao,
          comprado: ped.Comprado,
          // 🔴 NÃO usar `ped.Tipo` aqui. O `Tipo` do Alvo é o tipo de ENTREGA
          // ("Total" em 4.746 leituras, "Programado" em 2) — nunca a NATUREZA da
          // compra. Copiá-lo gravou 916 pedidos como "Total" e zerou o filtro de
          // natureza da tela de jun/jul/ago de 2026 (0 de 661). A natureza se
          // DERIVA dos valores, que já vêm no list e são gravados logo abaixo.
          // ⚠️ REGRA DUPLICADA DE PROPÓSITO — o gêmeo é `mapPedido` em
          // `src/services/alvoPedCompService.ts`. Frontend e Edge Function têm
          // caminhos de deploy diferentes (Lovable × supabase functions deploy);
          // compartilhar código aqui dessincronizaria em silêncio. Se mudar aqui,
          // mude lá — e vice-versa.
          tipo: derivarNaturezaPedido(ped.ValorMercadoria, ped.ValorServico),
          data_pedido: dateOnly(ped.DataPedido),
          data_cadastro: dateOnly(ped.DataCadastro),
          data_entrega: dateOnly(ped.DataEntrega),
          data_validade: dateOnly(ped.DataValidade),
          // Data de digitação real do Alvo (o list leve traz DataHoraDigitacao).
          data_digitacao_alvo: ped.DataHoraDigitacao ?? null,
          codigo_entidade: ped.CodigoEntidade,
          nome_entidade: ped.NomeEntidade,
          valor_mercadoria: ped.ValorMercadoria ?? 0,
          valor_servico: ped.ValorServico ?? 0,
          valor_total: ped.ValorTotal ?? 0,
          valor_frete: ped.ValorFrete ?? 0,
          codigo_cond_pag: ped.CondPagPedCompObject?.CodigoCondPag ?? null,
          // ⚠️ ANTI-WIPE (MOEDA-PEDIDOS): `codigo_ind_economico` e
          // `valor_cambio` estão AUSENTES daqui de propósito. Este objeto
          // vem do LIST leve, que não traz moeda (zero das 605 auditorias
          // `descoberto_alvo` têm as chaves, medido 26/08/2026). Incluir a
          // chave — mesmo como null — apagaria o que o Load gravou. Quem
          // grava moeda é o Job 2 / o Load; a descoberta, nunca.
          centro_custo: ped.CodigoCentroCtrl,
          codigo_usuario: ped.CodigoUsuario,
          texto: ped.Texto,
          proximo_aprovador: ped.PedCompUserFieldsObject?.UserProximoAprovador ?? null,
          enviou_aprovacao: ped.PedCompUserFieldsObject?.UserEnviouAprovacao ?? null,
          data_notificacao_aprovador: ped.PedCompUserFieldsObject?.UserDataNotificao ?? null,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // Campos de origem: só na PRIMEIRA descoberta (pedido novo no Hub).
          // Pedido já existente (ex.: criado no Hub) preserva os valores atuais.
          ...(existingPed
            ? {}
            : {
                criado_no_hub: false,
                status_local: "sincronizado",
                detalhes_carregados: false,
              }),
          // Vínculo do list leve: presente → elo + 'com_vinculo'.
          // Ausente → NÃO grava flag (list leve não pode afirmar ausência;
          // o Job 2 / Load completo decidirá 'sem_vinculo').
          ...(temVinculoNoList
            ? {
                numero_req_comp: ped.NumeroReqComp,
                codigo_empresa_filial_req_comp: ped.CodigoEmpresaFilialReqComp,
                vinculo_requisicao: "com_vinculo",
              }
            : {}),
        },
        { onConflict: "codigo_empresa_filial,numero" },
      );

      if (errIns) {
        result.total_erros++;
        result.detalhes.push({
          tipo: "ped",
          id: "",
          numero_alvo: ped.Numero,
          erro: `INSERT falhou: ${errIns.message}`,
        });
        console.error(`[descobrir-ped] ${ped.Numero} INSERT falhou:`, errIns);
        continue;
      }

      const { data: pedRow } = await supabase
        .from("compras_pedidos")
        .select("id")
        .eq("codigo_empresa_filial", ped.CodigoEmpresaFilial)
        .eq("numero", ped.Numero)
        .single();

      if (pedRow?.id) {
        await supabase.from("compras_pedidos_auditoria").insert({
          pedido_id: pedRow.id,
          evento: "descoberto_alvo",
          user_id: null,
          user_nome: "Job 3 — Descoberta automática",
          sucesso: true,
          resposta_alvo: ped,
        });
      }

      if (ped.NumeroReqComp && ped.CodigoEmpresaFilialReqComp) {
        const { data: reqRow } = await supabase
          .from("compras_requisicoes")
          .select(
            "id, requisitante_user_id, status, codigo_funcionario, codigo_centro_ctrl, codigo_finalidade_compra, data_necessidade, total_itens, numero_pedido_compra_alvo",
          )
          .eq("codigo_empresa_filial", ped.CodigoEmpresaFilialReqComp)
          .eq("numero_alvo", ped.NumeroReqComp)
          .maybeSingle();

        if (reqRow) {
          if (reqRow.numero_pedido_compra_alvo === null || reqRow.numero_pedido_compra_alvo === ped.Numero) {
            await supabase.from("compras_requisicoes").upsert(
              {
                id: reqRow.id,
                requisitante_user_id: reqRow.requisitante_user_id,
                status: reqRow.status,
                codigo_empresa_filial: ped.CodigoEmpresaFilialReqComp,
                codigo_funcionario: reqRow.codigo_funcionario,
                codigo_centro_ctrl: reqRow.codigo_centro_ctrl,
                codigo_finalidade_compra: reqRow.codigo_finalidade_compra,
                data_necessidade: reqRow.data_necessidade,
                total_itens: reqRow.total_itens,
                numero_pedido_compra_alvo: ped.Numero,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "id" },
            );

            console.log(`[descobrir-ped] vinculou req ${ped.NumeroReqComp} → ped ${ped.Numero}`);
          } else {
            console.warn(
              `[descobrir-ped] req ${ped.NumeroReqComp} já vinculada a ped ${reqRow.numero_pedido_compra_alvo}, NÃO sobrescreve com ${ped.Numero}`,
            );
          }
        }
      }

      if (ped.Numero > maiorNumeroVisto) {
        maiorNumeroVisto = ped.Numero;
      }

      result.total_mudaram++;
      result.detalhes.push({
        tipo: "ped",
        id: pedRow?.id || "",
        numero_alvo: ped.Numero,
        status_anterior: "novo",
        status_novo: ped.Status || "novo",
      });

      console.log(`[descobrir-ped] inserido ${ped.Numero} (req: ${ped.NumeroReqComp || "—"})`);
    } catch (err: any) {
      result.total_erros++;
      result.detalhes.push({
        tipo: "ped",
        id: "",
        numero_alvo: ped.Numero,
        erro: `Exception: ${err?.message || String(err)}`,
      });
      console.error(`[descobrir-ped] erro ${ped.Numero}:`, err);
    }
  }

  if (maiorNumeroVisto > lastKnownNumero) {
    const { error: errCursorUpdate } = await supabase
      .from("sync_cursors")
      .update({
        cursor_value: maiorNumeroVisto,
        updated_at: new Date().toISOString(),
        updated_by_run_id: runId,
      })
      .eq("cursor_name", CURSOR_NAME);

    if (errCursorUpdate) {
      console.error("[descobrir-ped] falhou atualizando cursor:", errCursorUpdate);
    } else {
      console.log(`[descobrir-ped] cursor atualizado: ${lastKnownNumero} → ${maiorNumeroVisto}`);
    }
  }

  return { result, crossCheck };
}

// ─────────────────────────────────────────────────────────────────────
// CARD C3 — extração de rateio, parcelas e cabeçalho do Load
// ─────────────────────────────────────────────────────────────────────
// Fonte canônica do rateio é o ITEM (AJUSTE-RS-C3, decisão C3-A):
//   ItemPedCompChildList[].ItemPedCompClasseRecdespChildList[].RateioItemPedCompChildList[]
// ⚠️ A caixa difere entre os dois níveis do Alvo: "Recdesp" no item,
// "RecDesp" no cabeçalho. Errar a caixa devolve undefined em silêncio.
// O rateio de CABEÇALHO é ignorado para a tabela relacional; sobrevive apenas
// dentro do jsonb de transição, para não criar um terceiro formato diferente
// do que o open-load já grava (ver montarClasseRateioJsonb).

/** "Ausente" inclui ARRAY VAZIO (AJUSTE-RS-C3.1, regra A): os jsonb da geração
 *  nova estão como `[]`, não como NULL. Testar só `is null` faz o C3 rodar,
 *  não acusar erro e não corrigir nada. */
function jsonbAusente(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function escalarAusente(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

interface CatalogosLabels {
  classes: Map<string, string | null>;
  centros: Map<string, string | null>;
}

/** Catálogos locais para enriquecer os labels — uma leitura por CICLO, não por
 *  pedido. O Alvo não devolve nome de classe nem de centro de custo. */
async function carregarCatalogosLabels(supabase: SupabaseClient): Promise<CatalogosLabels> {
  const classes = new Map<string, string | null>();
  const centros = new Map<string, string | null>();
  try {
    const { data: cls } = await supabase.from("classes_rec_desp").select("codigo, nome");
    for (const c of cls || []) if (c?.codigo) classes.set(String(c.codigo), c.nome ?? null);
  } catch (e) {
    console.warn("[sync-ped][C3] catálogo de classes indisponível:", e);
  }
  try {
    const { data: ccs } = await supabase.from("cost_centers").select("erp_code, name");
    for (const c of ccs || []) if (c?.erp_code) centros.set(String(c.erp_code), c.name ?? null);
  } catch (e) {
    console.warn("[sync-ped][C3] catálogo de centros de custo indisponível:", e);
  }
  return { classes, centros };
}

/** Uma linha por (item, classe, CC) com o percentual DO PRÓPRIO NÍVEL (C3-C):
 *  o do CC dentro da classe, nunca o produto dos dois — o produto arredondado
 *  é a origem do 100,02% medido no 0003625.
 *  `total_item` inclui impostos (C3-D): medido no 0004640, o rateio do item
 *  vale ValorTotal + ValorIPI. */
function extrairRateiosDoItem(
  alvo: any,
  cat: CatalogosLabels,
): { linhas: any[]; avisos: string[] } {
  const itens = (alvo?.ItemPedCompChildList || []) as any[];
  const out: any[] = [];
  const avisos: string[] = [];
  for (const it of itens) {
    if (it?.Cancelado === "Total") continue;
    const sequencia = Number(it?.Sequencia);
    if (!Number.isFinite(sequencia)) continue;
    const totalItem = round2((Number(it?.ValorTotal) || 0) + (Number(it?.ValorIPI) || 0));
    const classes = ((it?.ItemPedCompClasseRecdespChildList || []) as any[]).filter(
      (c) => !!c?.CodigoClasseRecDesp,
    );
    for (const cls of classes) {
      const codClasse = String(cls.CodigoClasseRecDesp);

      // CARD C3.2 — o Alvo às vezes OMITE `Percentual` e `Valor` no nível da
      // CLASSE do item, mandando os CCs abaixo completos (medido no 0004602:
      // classe 16.17 com Percentual null e CCs somando 33.34+33.33+33.33).
      // O dado não está errado; a leitura é que assumia um campo que o Alvo
      // não garante — e o `|| 0` transformava a omissão num 0 que reprovava
      // na guarda "classes do item somam 100,0000".
      //   • Classe ÚNICA no item: 100 é aritmeticamente necessário — com uma
      //     classe só não há o que dividir. Assume.
      //   • MÚLTIPLAS classes: não há como inferir a divisão. NÃO adivinha;
      //     preserva null para a RPC distinguir omissão de zero explícito.
      const pctBruto = escalarAusente(cls?.Percentual) ? null : Number(cls.Percentual);
      let pctClasse: number | null;
      if (classes.length === 1 && (pctBruto === null || pctBruto === 0)) {
        pctClasse = 100;
      } else if (pctBruto !== null && Number.isFinite(pctBruto)) {
        pctClasse = pctBruto;
      } else {
        pctClasse = null;
        avisos.push(
          `PERCENTUAL_CLASSE_OMITIDO: item ${sequencia}, classe ${codClasse}, ` +
            `${classes.length} classes no item — divisão não inferível`,
        );
      }

      const centros = (cls?.RateioItemPedCompChildList || []) as any[];
      for (const cc of centros) {
        const codCc = cc?.CodigoCentroCtrl;
        if (!codCc) continue;
        const pctCcBruto = escalarAusente(cc?.Percentual) ? null : Number(cc.Percentual);
        const pctCc =
          centros.length === 1 && (pctCcBruto === null || pctCcBruto === 0)
            ? 100
            : pctCcBruto !== null && Number.isFinite(pctCcBruto)
              ? pctCcBruto
              : null;
        // `Valor` do CC pode vir null OU 0 (medido no 0003575). Nos dois casos
        // a RPC deriva pelo percentual e marca `valor_derivado`. Aqui o null é
        // preservado como null para a RPC distinguir "não veio" de "veio zero".
        out.push({
          sequencia,
          classe: codClasse,
          classe_label: cat.classes.get(codClasse) ?? null,
          percentual_classe: pctClasse,
          cc: String(codCc),
          cc_label: cat.centros.get(String(codCc)) ?? null,
          percentual: pctCc,
          valor: cc?.Valor === null || cc?.Valor === undefined ? null : Number(cc.Valor),
          total_item: totalItem,
        });
      }
    }
  }
  return { linhas: out, avisos };
}

/** Nomes conferidos contra o parser autoritativo do open-load
 *  (`alvoPedCompLoadService.extrairParcelas`). `data_vencimento` é NOT NULL na
 *  tabela: parcela sem vencimento é descartada pela RPC, com aviso. */
function extrairParcelasAlvo(alvo: any): any[] {
  const list = (alvo?.ParcPagPedCompChildList || []) as any[];
  return list.map((p: any) => ({
    sequencia: Number(p?.Sequencia) || 0,
    numero_duplicata: p?.NumeroDuplicata ?? null,
    dias_entre_parcelas: Number(p?.DiasEntreParcelas) || 0,
    percentual_fracao: Number(p?.PercentualFracao) || 0,
    valor_parcela: Number(p?.ValorParcela) || 0,
    data_vencimento: typeof p?.DataVencimento === "string" ? p.DataVencimento.split("T")[0] : null,
  }));
}

/** jsonb `itens` — MESMO formato do open-load, de propósito. Dois escritores
 *  produzindo formatos diferentes para a mesma coluna seria pior do que a
 *  duplicação que a transição já aceita. */
function montarItensJsonb(alvo: any): any[] {
  const list = (alvo?.ItemPedCompChildList || []) as any[];
  return list.map((item: any) => ({
    sequencia: item?.Sequencia,
    codigoProduto: item?.CodigoProduto,
    nomeProduto: item?.NomeProduto || item?.DescricaoAlternativaProduto,
    unidade: item?.CodigoProdUnidMed,
    quantidade: item?.QuantidadeProdUnidMedPrincipal,
    valorUnitario: item?.ValorUnitario,
    valorTotal: item?.ValorTotal,
    itemServico: item?.ItemServico,
    cancelado: item?.Cancelado,
    classe: item?.ItemPedCompClasseRecdespChildList?.[0]?.CodigoClasseRecDesp ?? null,
    centroCusto:
      item?.ItemPedCompClasseRecdespChildList?.[0]?.RateioItemPedCompChildList?.[0]?.CodigoCentroCtrl ?? null,
    classeRateio: ((item?.ItemPedCompClasseRecdespChildList || []) as any[]).map((c: any) => ({
      classe: c?.CodigoClasseRecDesp,
      valor: c?.Valor,
      percentual: c?.Percentual,
      centrosCusto: ((c?.RateioItemPedCompChildList || []) as any[]).map((r: any) => ({
        codigo: r?.CodigoCentroCtrl,
        valor: r?.Valor,
        percentual: r?.Percentual,
      })),
    })),
  }));
}

function montarParcelasJsonb(alvo: any): any[] {
  const list = (alvo?.ParcPagPedCompChildList || []) as any[];
  return list.map((p: any) => ({
    sequencia: p?.Sequencia,
    duplicata: p?.NumeroDuplicata,
    diasEntreParcelas: p?.DiasEntreParcelas,
    percentual: p?.PercentualFracao,
    valor: p?.ValorParcela,
    vencimento: typeof p?.DataVencimento === "string" ? p.DataVencimento.split("T")[0] : null,
  }));
}

/** Cabeçalho primeiro, item como fallback — idêntico ao open-load. É jsonb de
 *  COMPATIBILIDADE (duas telas o leem), não fonte de verdade; a fonte é a
 *  tabela relacional, que vem só do item (C3-A). */
function montarClasseRateioJsonb(alvo: any): any[] {
  let list = (alvo?.PedCompClasseRecDespChildList || []) as any[];
  if (list.length === 0) {
    list = [];
    for (const item of (alvo?.ItemPedCompChildList || []) as any[]) {
      list.push(...((item?.ItemPedCompClasseRecdespChildList || []) as any[]));
    }
  }
  return list.map((c: any) => ({
    classe: c?.CodigoClasseRecDesp,
    valor: c?.Valor,
    percentual: c?.Percentual,
    centrosCusto: ((c?.RateioPedCompChildList || c?.RateioItemPedCompChildList || []) as any[]).map((r: any) => ({
      codigo: r?.CodigoCentroCtrl,
      valor: r?.Valor,
      percentual: r?.Percentual,
    })),
  }));
}

function primeiroVencimentoDe(parcelas: any[]): string | null {
  const vencs = (parcelas || [])
    .map((p) => p?.data_vencimento)
    .filter((v: unknown): v is string => typeof v === "string" && v.length > 0);
  if (vencs.length === 0) return null;
  return vencs.reduce((menor, atual) => (atual < menor ? atual : menor));
}

// ─────────────────────────────────────────────────────────────────────
// Persistência de itens (correção L1.4)
// ─────────────────────────────────────────────────────────────────────
// Grava ItemPedCompChildList do detalhe completo em compras_pedidos_itens
// na 1ª vez que o Job 2 carrega o pedido (detalhes_carregados != true).
// Upsert idempotente por (pedido_id, sequencia). Domínio real de Cancelado
// = {Não, Parcial, Total} ('Sim' não existe): PULA 'Total' (cancelado
// integral = item-fantasma), grava 'Não' (ativo) e 'Parcial' (remanescente
// vivo). NÃO reconcilia valor_total do cabeçalho (a soma dos itens pode
// divergir por cancelamento parcial; o cabeçalho é a fonte da verdade).
async function persistirItensPedido(
  supabase: SupabaseClient,
  pedidoId: string,
  alvo: any,
  cat: CatalogosLabels,
): Promise<{ itens: number; rateios: number; parcelas: number; avisos: string[] }> {
  const itensAlvo = (alvo?.ItemPedCompChildList || []) as any[];
  const rows = itensAlvo
    .filter((it) => it?.Cancelado !== "Total")
    .map((it) => ({
      pedido_id: pedidoId,
      sequencia: Number(it?.Sequencia),
      item_servico: it?.ItemServico === "Sim",
      codigo_produto: it?.CodigoProduto,
      codigo_alternativo_produto: it?.CodigoAlternativoProduto ?? null,
      codigo_prod_unid_med: it?.CodigoProdUnidMed,
      produto_nome: it?.NomeProduto ?? it?.DescricaoAlternativaProduto ?? null,
      produto_unidade: it?.CodigoProdUnidMed ?? null,
      quantidade: Number(it?.QuantidadeProdUnidMedPrincipal) || 0,
      valor_unitario: Number(it?.ValorUnitario) || 0,
      valor_total_item: Number(it?.ValorTotal) || 0,
      observacao: it?.Observacao ?? null,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length > 0) {
    const { error: errItens } = await supabase
      .from("compras_pedidos_itens")
      .upsert(rows, { onConflict: "pedido_id,sequencia" });
    if (errItens) throw new Error(`upsert itens: ${errItens.message}`);
  }

  // CARD C3 — rateio e parcelas numa transação só, pela RPC restrita a
  // service_role. Sem UNIQUE e sem upsert: repetição de (item, classe, CC) é
  // legítima (decisão D2), então o padrão é apagar os filhos e reinserir,
  // como o `limparFilhosDoPedido` do wizard já faz.
  const extracao = extrairRateiosDoItem(alvo, cat);
  const rateios = extracao.linhas;
  const parcelas = extrairParcelasAlvo(alvo);
  const avisos: string[] = [...extracao.avisos];
  let nRateios = 0;
  let nParcelas = 0;

  if (rateios.length > 0 || parcelas.length > 0) {
    const { data: res, error: errRpc } = await supabase.rpc("sync_replace_filhos_pedido", {
      p_pedido_id: pedidoId,
      p_rateios: rateios,
      p_parcelas: parcelas,
    });
    if (errRpc) throw new Error(`sync_replace_filhos_pedido: ${errRpc.message}`);
    nRateios = Number((res as any)?.rateios_inseridos) || 0;
    nParcelas = Number((res as any)?.parcelas_inseridas) || 0;
    for (const a of ((res as any)?.avisos || []) as string[]) avisos.push(String(a));
  }

  // Dual-write dos jsonb da transição (duas telas ainda os leem). Cada um só é
  // gravado quando o Load trouxe conteúdo: sobrescrever um jsonb populado com
  // `[]` seria perder o dado da geração antiga, que é a única cópia que existe.
  const patch: Record<string, unknown> = {
    detalhes_carregados: true,
    detalhes_carregados_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const itensJsonb = montarItensJsonb(alvo);
  const parcelasJsonb = montarParcelasJsonb(alvo);
  const classeRateioJsonb = montarClasseRateioJsonb(alvo);
  if (itensJsonb.length > 0) patch.itens = itensJsonb;
  if (parcelasJsonb.length > 0) patch.parcelas = parcelasJsonb;
  if (classeRateioJsonb.length > 0) patch.classe_rateio = classeRateioJsonb;
  const pv = primeiroVencimentoDe(parcelas);
  if (pv) patch.primeiro_vencimento = pv;

  // `detalhes_carregados` entra NESTE update, o último: se a RPC falhou acima,
  // o throw já saiu e a flag continua false — o pedido volta no próximo ciclo.
  const { error: errFlag } = await supabase.from("compras_pedidos").update(patch).eq("id", pedidoId);
  if (errFlag) throw new Error(`update detalhe/flag: ${errFlag.message}`);

  return { itens: rows.length, rateios: nRateios, parcelas: nParcelas, avisos };
}

// ─────────────────────────────────────────────────────────────────────
// CARD C3 — completar campos ausentes do cabeçalho
// ─────────────────────────────────────────────────────────────────────
// Preenche SÓ o que está vazio; jamais sobrescreve. "Vazio" inclui `[]`
// (AJUSTE-RS-C3.1-A) — com `is null` puro este bloco rodaria, não acusaria
// erro e não corrigiria nenhum pedido da geração nova, que é exatamente a que
// motivou a missão. NÃO toca status, workflow nem os 7 campos de valor.
async function completarCamposAusentes(
  supabase: SupabaseClient,
  ped: PedidoHub,
  alvo: any,
  cat: CatalogosLabels,
  filhosOk: boolean,
): Promise<string[]> {
  const patch: Record<string, unknown> = {};

  const itensJsonb = montarItensJsonb(alvo);
  const parcelasPayload = extrairParcelasAlvo(alvo);
  const parcelasJsonb = montarParcelasJsonb(alvo);
  const classeRateioJsonb = montarClasseRateioJsonb(alvo);
  const rateios = extrairRateiosDoItem(alvo, cat).linhas;

  // CARD C3.2 — os três jsonb são o PROXY que o gate usa para decidir se os
  // filhos relacionais estão faltando. Preenchê-los depois de a RPC falhar
  // cega o gate: o pedido passa a "parecer" completo e nunca mais é
  // reprocessado. Foi o que aconteceu com o 0004602 — jsonb populado, zero
  // linhas de rateio. Quando os filhos falham, o proxy fica como está.
  if (filhosOk) {
    if (jsonbAusente(ped.itens) && itensJsonb.length > 0) patch.itens = itensJsonb;
    if (jsonbAusente(ped.parcelas) && parcelasJsonb.length > 0) patch.parcelas = parcelasJsonb;
    if (jsonbAusente(ped.classe_rateio) && classeRateioJsonb.length > 0) {
      patch.classe_rateio = classeRateioJsonb;
    }
  }

  if (escalarAusente(ped.primeiro_vencimento)) {
    const pv = primeiroVencimentoDe(parcelasPayload);
    if (pv) patch.primeiro_vencimento = pv;
  }
  if (escalarAusente(ped.classe_rec_desp) && rateios[0]?.classe) {
    patch.classe_rec_desp = rateios[0].classe;
  }
  // C3-E: pode preencher quando nula, por compatibilidade de tela — mas esta
  // coluna guarda a PRIMEIRA fatia do rateio, nunca o CC do pedido. Nenhuma
  // visão de gasto por centro de custo pode ler daqui.
  if (escalarAusente(ped.centro_custo) && rateios[0]?.cc) {
    patch.centro_custo = rateios[0].cc;
  }

  const nomeCondPag = alvo?.CondPagPedCompObject?.Nome ?? null;
  if (escalarAusente(ped.nome_cond_pag) && nomeCondPag) patch.nome_cond_pag = nomeCondPag;

  // ── MOEDA (MOEDA-PEDIDOS) ────────────────────────────────────────────
  // Backfill incremental dos pedidos vivos: preenche só quando o Hub não
  // tem e o Alvo informou. Nunca sobrescreve valor já gravado.
  //
  // ⚠️ Moeda ausente NÃO entra no gate de completude, de propósito. Um
  // `CodigoIndEconomico` null é resposta legítima e frequente do Alvo
  // (407 dos 1.247 pedidos auditados em 26/08/2026 estavam assim no
  // último Load) — significa "ainda não definiu", não "faltou dado".
  // Fazer disso pendência colocaria centenas de pedidos reentrando todo
  // ciclo, que é a pendência §7.2. O que a armadilha 9 exige é não MENTIR
  // sobre completude: aqui, se o Alvo informou a moeda e o UPDATE abaixo
  // falhar, a função retorna [] sem marcar nada como preenchido — o
  // pedido volta no próximo ciclo. Nenhuma flag é ligada por engano.
  const moedaAlvo = extrairMoedaDoLoadAlvo(alvo);
  if (escalarAusente(ped.codigo_ind_economico) && moedaAlvo.codigo_ind_economico !== undefined) {
    patch.codigo_ind_economico = moedaAlvo.codigo_ind_economico;
  }
  if (escalarAusente(ped.valor_cambio) && moedaAlvo.valor_cambio !== undefined) {
    patch.valor_cambio = moedaAlvo.valor_cambio;
  }

  // Entidade: Load primeiro, cache local como fallback — é o caso 0004664
  // (R$ 110 mil sem fornecedor), em que o list veio sem `NomeEntidade` e o
  // Job 1 nunca revisita. O cache é leitura local, não chama o Alvo.
  const precisaNome = escalarAusente(ped.nome_entidade);
  const precisaCnpj = escalarAusente(ped.cnpj_entidade);
  if (precisaNome || precisaCnpj) {
    let nome: string | null = alvo?.NomeEntidade ?? null;
    let cnpj: string | null = alvo?.CPFCNPJ ?? null;
    if (((precisaNome && !nome) || (precisaCnpj && !cnpj)) && ped.codigo_entidade) {
      try {
        const { data: ent } = await supabase
          .from("compras_entidades_cache")
          .select("nome, cnpj")
          .eq("codigo_entidade", ped.codigo_entidade)
          .maybeSingle();
        nome = nome || (ent as any)?.nome || null;
        cnpj = cnpj || (ent as any)?.cnpj || null;
      } catch (e) {
        console.warn(`[sync-ped][C3] cache de entidade indisponível para ${ped.numero}:`, e);
      }
    }
    if (precisaNome && nome) patch.nome_entidade = nome;
    if (precisaCnpj && cnpj) patch.cnpj_entidade = cnpj;
  }

  const campos = Object.keys(patch);
  if (campos.length === 0) return [];

  patch.updated_at = new Date().toISOString();
  const { error } = await supabase.from("compras_pedidos").update(patch).eq("id", ped.id);
  if (error) {
    console.error(`[sync-ped][C3] completar ausentes falhou em ${ped.numero}:`, error.message);
    return [];
  }
  return campos;
}

// ─────────────────────────────────────────────────────────────────────
// Cross-check de exclusão (L3 Missão 2)
// ─────────────────────────────────────────────────────────────────────
// Decide se um 404 no Load significa exclusão REAL no Alvo. Marca
// status_local='excluido_alvo' SÓ quando: (a) o Job 3 produziu uma lista
// confiável neste ciclo (listaOk); (b) a data_pedido está DENTRO da janela
// que o Job 3 varreu — fora dela o silêncio da lista não prova nada; e (c) o
// número está AUSENTE do conjunto que o Alvo listou. 404 + presença na lista =
// soluço/estrutural → no-op (re-tenta). Ação de marcação idêntica ao spec:
// só status_local + synced_at (+ updated_at, metadado) + auditoria — preserva
// status/aprovado/etc. (o último estado de negócio).
async function avaliarExclusaoPedido(
  supabase: SupabaseClient,
  ped: PedidoHub,
  crossCheck: CrossCheckPedidos,
  result: JobResult,
): Promise<void> {
  // (a) sem lista confiável (falha do Job 3 OU possível truncação) → no-op
  if (!crossCheck.listaOk) {
    console.warn(`[sync-ped] ${ped.numero}: 404, mas cross-check indisponível (listaOk=false) — no-op`);
    return;
  }

  // (b) guarda de janela: só conclui exclusão se a data_pedido cair na janela varrida
  const dp = ped.data_pedido; // 'YYYY-MM-DD'
  const dentroDaJanela = !!dp && dp >= crossCheck.janelaInicio && dp <= crossCheck.janelaFim;
  if (!dentroDaJanela) {
    console.warn(
      `[sync-ped] ${ped.numero}: 404, mas data_pedido=${dp ?? "null"} fora da janela varrida ` +
        `[${crossCheck.janelaInicio}..${crossCheck.janelaFim}] — inconclusivo, no-op`,
    );
    return;
  }

  // (c) presente na lista apesar do 404 = soluço/estrutural → no-op
  const chave = `${ped.codigo_empresa_filial}|${ped.numero}`;
  if (crossCheck.numerosVistos.has(chave)) {
    console.warn(`[sync-ped] ${ped.numero}: 404 no Load mas PRESENTE na lista da janela — soluço, no-op`);
    return;
  }

  // ★ 404 real + ausente da lista na MESMA janela = exclusão real.
  const { error: errMark } = await supabase
    .from("compras_pedidos")
    .update({
      status_local: "excluido_alvo",
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", ped.id);

  if (errMark) {
    result.total_erros++;
    result.detalhes.push({
      tipo: "ped",
      id: ped.id,
      numero_alvo: ped.numero,
      erro: `UPDATE excluido_alvo falhou: ${errMark.message}`,
    });
    console.error(`[sync-ped] ${ped.numero}: marcar excluido_alvo falhou:`, errMark);
    return;
  }

  await supabase.from("compras_pedidos_auditoria").insert({
    pedido_id: ped.id,
    evento: "excluido_alvo",
    user_id: null,
    user_nome: "Job 2 — cross-check exclusão",
    sucesso: true,
    resposta_alvo: {
      not_found: true,
      cross_check: {
        janela_inicio: crossCheck.janelaInicio,
        janela_fim: crossCheck.janelaFim,
        ausente_da_lista: true,
      },
    },
  });

  result.total_mudaram++;
  result.detalhes.push({
    tipo: "ped",
    id: ped.id,
    numero_alvo: ped.numero,
    status_anterior: ped.status || undefined,
    status_novo: "excluido_alvo",
  });
  console.log(
    `[sync-ped] ${ped.numero}: MARCADO excluido_alvo (404 real + ausente da lista [${crossCheck.janelaInicio}..${crossCheck.janelaFim}])`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// JOB 2: Sincronizar Pedidos (mudanças)
// ─────────────────────────────────────────────────────────────────────

async function syncPedidos(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string,
  crossCheck: CrossCheckPedidos,
): Promise<JobResult> {
  const result: JobResult = {
    total_candidatos: 0,
    total_consultados: 0,
    total_mudaram: 0,
    total_erros: 0,
    detalhes: [],
  };

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 180);

  // ── DIAGNÓSTICO (correção L1.3): total de elegíveis SEM limit ─────
  // Query separada, head:true, MESMA regra do SELECT de candidatos.
  // Não altera comportamento — instrumenta o veredito do corte de 180d:
  //   379 = ramo data+aprovação ativo (aspas duplas OK);
  //   377 = ramo status_aprovacao.in inerte (só data importa).
  const { count: elegiveisSemLimit } = await supabase
    .from("compras_pedidos")
    .select("id", { count: "exact", head: true })
    // Terminais normalmente não mudam mais e ficam fora do rodízio. EXCEÇÃO:
    // se ainda não têm o detalhe carregado, precisam de UMA visita para baixá-lo
    // — depois a flag vira true e eles saem da fila de novo.
    // CARD C2 — `not.is.true` em vez de `is.false`: a coluna é nullable e no
    // PostgREST `is.false` NÃO casa com NULL, então um pedido com a flag nula
    // ficaria invisível aqui e no SELECT. `not.is.true` cobre false E null, e é
    // exatamente o mesmo teste que o processamento faz (`!== true`, abaixo).
    .or('and(status.not.in.("Encerrado","Cancelado","Cancelado Parcial")),and(detalhes_carregados.not.is.true)')
    .or("status_local.is.null,status_local.neq.excluido_alvo")
    .or(`data_pedido.gte.${cutoffDate.toISOString().slice(0, 10)},status_aprovacao.in.("Em Andamento","Reavaliar")`);
  result.elegiveis_sem_limit = elegiveisSemLimit ?? 0;
  console.log(`[sync-ped] elegíveis SEM limit: ${elegiveisSemLimit} (limit aplicado: ${PED_BATCH_SIZE})`);

  const { data: candidatos, error: errSelect } = await supabase
    .from("compras_pedidos")
    .select(
      "id, numero, codigo_empresa_filial, status, aprovado, status_aprovacao, comprado, proximo_aprovador, enviou_aprovacao, data_notificacao_aprovador, valor_total, data_pedido, numero_req_comp, vinculo_requisicao, detalhes_carregados, codigo_entidade, nome_entidade, cnpj_entidade, nome_cond_pag, centro_custo, classe_rec_desp, primeiro_vencimento, itens, parcelas, classe_rateio, codigo_ind_economico, valor_cambio",
    )
    // CARD C2 — este SELECT excluía TODOS os terminais, enquanto a contagem de
    // elegíveis acima já abria a exceção do detalhe faltante (d8edf1c, 21/07,
    // mudou só a contagem). A métrica prometia uma visita que nunca acontecia:
    // terminal sem detalhe entrava no número e jamais era processado. Agora as
    // duas expressões são a MESMA — se divergirem de novo, a métrica volta a mentir.
    .or('and(status.not.in.("Encerrado","Cancelado","Cancelado Parcial")),and(detalhes_carregados.not.is.true)')
    .or("status_local.is.null,status_local.neq.excluido_alvo")
    .or(`data_pedido.gte.${cutoffDate.toISOString().slice(0, 10)},status_aprovacao.in.("Em Andamento","Reavaliar")`)
    .order("synced_at", { ascending: true, nullsFirst: true })
    .limit(PED_BATCH_SIZE);

  if (errSelect) {
    console.error("[sync-ped] erro ao buscar candidatos:", errSelect);
    result.total_erros = 1;
    return result;
  }

  const peds = (candidatos || []) as PedidoHub[];
  result.total_candidatos = peds.length;

  if (peds.length === 0) {
    console.log("[sync-ped] zero candidatos");
    return result;
  }

  console.log(`[sync-ped] ${peds.length} candidatos`);

  // CARD C3 — catálogos de label lidos UMA vez por ciclo (o Alvo não devolve
  // nome de classe nem de centro de custo). Duas leituras, não duas por pedido.
  const catalogos = await carregarCatalogosLabels(supabase);

  await processInChunks(peds, CHUNK_SIZE, SLEEP_BETWEEN_CHUNKS_MS, async (ped) => {
    try {
      const path = `/ped-comp/${encodeURIComponent(ped.codigo_empresa_filial)}/${encodeURIComponent(ped.numero)}`;
      const resp = await callErpProxy(erpUrl, systemSecret, path);

      result.total_consultados++;

      const notFound = resp.status === 404;

      if (!resp.ok) {
        if (notFound) {
          // 404 real (pós-L3.1: o proxy já não devolve 200-null mascarado).
          // Marca excluido_alvo SÓ com cross-check contra o que o Job 3 viu,
          // e apenas dentro da janela varrida. Toda a regra vive no helper.
          await avaliarExclusaoPedido(supabase, ped, crossCheck, result);
          return;
        }
        result.total_erros++;
        result.detalhes.push({
          tipo: "ped",
          id: ped.id,
          numero_alvo: ped.numero,
          erro: `HTTP ${resp.status}: ${resp.data?.error || "erro"}`,
        });
        return;
      }

      const alvo = resp.data;

      // ── ANTI-WIPE (correção L1.1) ──────────────────────────────────
      // Load 200 mas payload vazio / não-objeto / sem Numero: NÃO fazer
      // upsert — gravaria status/aprovado/etc. como null e apagaria o
      // estado do pedido. Pula, registra payload_invalido e conta erro.
      if (!alvo || typeof alvo !== "object" || !alvo.Numero) {
        result.total_erros++;
        result.detalhes.push({
          tipo: "ped",
          id: ped.id,
          numero_alvo: ped.numero,
          erro: "payload_invalido",
        });
        console.warn(`[sync-ped] ${ped.numero}: payload inválido (Load 200 sem Numero) — pulado`);
        return;
      }

      const userFields = alvo?.PedCompUserFieldsObject || {};

      // ── Persistir itens na 1ª carga do detalhe (correção L1.4) ─────
      // Roda ANTES de decidir "mudou" — é o que drena a fila de
      // detalhes_carregados=false mesmo em pedido sem mudança de status.
      // Falha em itens NÃO aborta o sync de status (itens são secundários):
      // loga, flag fica false, retenta no próximo ciclo.
      // ── CARD C3 — carga dos filhos + completar cabeçalho ───────────
      // A carga deixa de depender só da flag. O 0004640 tem
      // `detalhes_carregados = true` e MESMO ASSIM está sem rateio, sem
      // parcelas e com os três jsonb em `[]`: a flag sempre significou
      // "itens persistidos", nunca "detalhe completo". Reprocessa quando a
      // flag é falsa OU quando falta qualquer um dos jsonb da transição.
      // Falha aqui NÃO aborta o sync de status: loga, a flag fica como está
      // e o pedido volta no próximo ciclo.
      const filhosAusentes =
        jsonbAusente(ped.classe_rateio) || jsonbAusente(ped.parcelas) || jsonbAusente(ped.itens);
      let filhosOk = true;
      if (ped.detalhes_carregados !== true || filhosAusentes) {
        try {
          const r = await persistirItensPedido(supabase, ped.id, alvo, catalogos);
          console.log(
            `[sync-ped] ${ped.numero}: ${r.itens} itens, ${r.rateios} rateios, ${r.parcelas} parcelas persistidos`,
          );
          for (const aviso of r.avisos) {
            console.warn(`[sync-ped][C3] ${ped.numero}: ${aviso}`);
            result.detalhes.push({
              tipo: "ped",
              id: ped.id,
              numero_alvo: ped.numero,
              erro: `aviso_c3: ${aviso}`,
            });
          }
        } catch (itErr: any) {
          filhosOk = false;
          console.error(`[sync-ped] ${ped.numero}: persistir filhos falhou:`, itErr?.message || itErr);
          result.detalhes.push({
            tipo: "ped",
            id: ped.id,
            numero_alvo: ped.numero,
            erro: `c3_filhos: ${itErr?.message || itErr}`,
          });
          // CARD C3.2 — devolve o pedido à fila explicitamente. Sem isto, um
          // pedido que já tinha a flag `true` (todos os da geração nova têm)
          // continuaria "carregado" apesar de os filhos não terem entrado, e
          // dependeria só do proxy dos jsonb para voltar. A flag passa a dizer
          // a verdade: o detalhe NÃO está completo.
          try {
            await supabase
              .from("compras_pedidos")
              .update({ detalhes_carregados: false })
              .eq("id", ped.id);
          } catch (flagErr: any) {
            console.error(`[sync-ped][C3.2] ${ped.numero}: reabrir flag falhou:`, flagErr?.message || flagErr);
          }
        }
      }

      // Completar ausentes roda SEMPRE e ANTES do `if (!mudou)` — pedido sem
      // mudança de status é exatamente o que nunca era revisitado.
      try {
        const preenchidos = await completarCamposAusentes(supabase, ped, alvo, catalogos, filhosOk);
        if (preenchidos.length > 0) {
          console.log(`[sync-ped][C3] ${ped.numero}: completados ${preenchidos.join(", ")}`);
        }
      } catch (cErr: any) {
        console.error(`[sync-ped][C3] ${ped.numero}: completar ausentes falhou:`, cErr?.message || cErr);
      }

      const tsToMs = (v: string | null | undefined): number | null => {
        if (!v) return null;
        const t = new Date(v).getTime();
        return isNaN(t) ? null : t;
      };

      const sameStr = (a: any, b: any): boolean => {
        const na = a === "" || a === undefined ? null : a;
        const nb = b === "" || b === undefined ? null : b;
        return na === nb;
      };

      const novoStatus = alvo?.Status ?? null;
      const novoAprovado = alvo?.Aprovado ?? null;
      const novoStatusAprovacao = alvo?.StatusAprovacao ?? null;
      const novoComprado = alvo?.Comprado ?? null;
      const novoProximoAprovador = userFields?.UserProximoAprovador ?? null;
      const novoEnviouAprovacao = userFields?.UserEnviouAprovacao ?? null;
      const novoDataNotif = userFields?.UserDataNotificao ?? null;

      // ── Valores do Alvo (detalhe completo) ──────────────────────────
      // O ValorTotal do Alvo é a fonte da verdade (inclui frete/despesas/desconto).
      // resolverValorTotalAlvo aplica fallback para soma de itens quando necessário.
      const novoValorTotal = resolverValorTotalAlvo(alvo);
      const novoValorMercadoria = alvo?.ValorMercadoria ?? null;
      const novoValorServico = alvo?.ValorServico ?? null;
      const novoValorFrete = alvo?.ValorFrete ?? null;
      const novoValorDesconto = alvo?.ValorDescontoGeral ?? null;
      const novoValorOutrasDespesas = alvo?.ValorOutrasDespesas ?? null;
      const novoValorIpi = alvo?.GeralValorIPI ?? null;

      // ── MOEDA (MOEDA-PEDIDOS) ───────────────────────────────────────
      // Fonte Load. Chave omitida quando o Alvo não informou — nunca
      // grava null por cima de valor bom (null no Alvo é "ainda não
      // definiu": 10 pedidos já foram null→moeda, nenhum o contrário).
      const moedaNova = extrairMoedaDoLoadAlvo(alvo);
      // Só conta como mudança quando há valor novo E ele difere do
      // gravado. Sem isto, um pedido cuja única defasagem é a moeda
      // nunca entraria no upsert e ficaria sem a coluna para sempre.
      const moedaMudou =
        (moedaNova.codigo_ind_economico !== undefined &&
          moedaNova.codigo_ind_economico !== (ped.codigo_ind_economico ?? null)) ||
        (moedaNova.valor_cambio !== undefined &&
          Number(moedaNova.valor_cambio) !== Number(ped.valor_cambio ?? NaN));

      // Comparação numérica do total (tolerância de 0,005 p/ float)
      const valorMudou = Math.abs((Number(novoValorTotal) || 0) - (Number(ped.valor_total) || 0)) > 0.005;

      // ── Vínculo req↔ped (cabeçalho + itens do detalhe completo) ─────
      const vinculo = extrairVinculoRequisicao(alvo);
      // Datas reais do Alvo (detalhe completo): digitação (cabeçalho) e
      // aprovação final (item). Preenchem as colunas do dashboard de lead time.
      const novaDataDigitacao = alvo?.DataHoraDigitacao ?? null;
      const novaDataAprovacao = extrairDataAprovacaoAlvo(alvo);
      // Elo só "muda" quando o Alvo informa um elo (não-nulo) diferente do
      // gravado — elo nulo no Alvo NÃO apaga elo existente (saneamento).
      const eloMudou = vinculo.numero_req_comp !== null && vinculo.numero_req_comp !== (ped.numero_req_comp || null);
      const flagMudou = vinculo.vinculo_requisicao !== (ped.vinculo_requisicao || null);
      const vinculoMudou = eloMudou || flagMudou;

      const mudou =
        !sameStr(novoStatus, ped.status) ||
        !sameStr(novoAprovado, ped.aprovado) ||
        !sameStr(novoStatusAprovacao, ped.status_aprovacao) ||
        !sameStr(novoComprado, ped.comprado) ||
        !sameStr(novoProximoAprovador, ped.proximo_aprovador) ||
        !sameStr(novoEnviouAprovacao, ped.enviou_aprovacao) ||
        tsToMs(novoDataNotif) !== tsToMs(ped.data_notificacao_aprovador) ||
        valorMudou ||
        moedaMudou ||
        vinculoMudou;

      if (!mudou) {
        // Carimba a verificação de vínculo mesmo sem mudança — é o que
        // drena a fila de 'nao_verificado' a cada ciclo do cron.
        // Também preenche as datas do Alvo (digitação/aprovação) caso ainda
        // estejam nulas — backfill incremental dos ativos via cron.
        await supabase
          .from("compras_pedidos")
          .update({
            synced_at: new Date().toISOString(),
            vinculo_verificado_em: new Date().toISOString(),
            data_digitacao_alvo: novaDataDigitacao,
            data_aprovacao_alvo: novaDataAprovacao,
          })
          .eq("id", ped.id);
        return;
      }

      const { error: errUpsert } = await supabase.from("compras_pedidos").upsert(
        {
          id: ped.id,
          numero: ped.numero,
          codigo_empresa_filial: ped.codigo_empresa_filial,
          status: novoStatus,
          aprovado: novoAprovado,
          status_aprovacao: novoStatusAprovacao,
          comprado: novoComprado,
          proximo_aprovador: novoProximoAprovador,
          enviou_aprovacao: novoEnviouAprovacao,
          data_notificacao_aprovador: novoDataNotif,
          // ── Datas reais do Alvo (dashboard de lead time) ───────────────
          data_digitacao_alvo: novaDataDigitacao,
          data_aprovacao_alvo: novaDataAprovacao,
          // ── Propaga valores do Alvo (corrige listagem defasada) ─────
          valor_total: novoValorTotal,
          valor_mercadoria: novoValorMercadoria,
          valor_servico: novoValorServico,
          valor_frete: novoValorFrete,
          valor_desconto: novoValorDesconto,
          valor_outras_despesas: novoValorOutrasDespesas,
          valor_ipi: novoValorIpi,
          // ── Moeda do Alvo (MOEDA-PEDIDOS) ──────────────────────────
          ...moedaNova,
          // ── Vínculo com requisição (cabeçalho + itens) ──────────────
          // Detalhe completo é fonte autorizada: afirma presença E ausência.
          vinculo_requisicao: vinculo.vinculo_requisicao,
          req_comp_itens: vinculo.req_comp_itens,
          vinculo_verificado_em: new Date().toISOString(),
          // Elo de cabeçalho: só grava quando presente (nunca apaga elo
          // existente, preservando o saneamento retroativo via auditoria).
          ...(vinculo.numero_req_comp
            ? {
                numero_req_comp: vinculo.numero_req_comp,
                codigo_empresa_filial_req_comp: vinculo.codigo_empresa_filial_req_comp ?? "1.01",
              }
            : {}),
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      if (errUpsert) {
        result.total_erros++;
        result.detalhes.push({
          tipo: "ped",
          id: ped.id,
          numero_alvo: ped.numero,
          erro: `UPSERT falhou: ${errUpsert.message}`,
        });
        return;
      }

      await supabase.from("compras_pedidos_auditoria").insert({
        pedido_id: ped.id,
        evento: "sync_status",
        user_id: null,
        user_nome: "Sincronização automática",
        sucesso: true,
        resposta_alvo: alvo,
        status_anterior: ped.status,
        status_novo: novoStatus,
        status_aprovacao_anterior: ped.status_aprovacao,
        status_aprovacao_novo: novoStatusAprovacao,
        aprovado_anterior: ped.aprovado,
        aprovado_novo: novoAprovado,
        comprado_anterior: ped.comprado,
        comprado_novo: novoComprado,
        proximo_aprovador_anterior: ped.proximo_aprovador,
        proximo_aprovador_novo: novoProximoAprovador,
      });

      // ── E-MAILS (L2, 19/07/2026): SEM disparo inline aqui ──────────
      // O gatilho inline que avisava o REQUISITANTE na aprovação foi
      // removido. Arquitetura estado+scan: cada e-mail tem sua própria
      // Edge Function com cron de 15 min, que varre por ESTADO e usa
      // compras_pedidos_emails_log como dedup:
      //   - notify-pedido-criador   (jobid 21): CRIADOR, na aprovação 100%
      //     (aprovado='Total' + status_aprovacao='Finalizada')
      //   - notify-pedido-concluido (jobid 22): REQUISITANTE, na CONCLUSÃO
      //     (status='Encerrado' + aprovado='Total')
      // Assim não importa QUEM atualizou o status (este cron, o open-load
      // do frontend, um data-fix): o e-mail sai no scan seguinte, uma vez.
      // notify-pedido-aprovado ficou dormente (sem cron, sem caller).
      const numeroReqComp = alvo?.NumeroReqComp;
      const codigoFilialReqComp = alvo?.CodigoEmpresaFilialReqComp;
      if (numeroReqComp && codigoFilialReqComp) {
        const { data: reqRow } = await supabase
          .from("compras_requisicoes")
          .select(
            "id, numero_pedido_compra_alvo, requisitante_user_id, status, codigo_funcionario, codigo_centro_ctrl, codigo_finalidade_compra, data_necessidade, total_itens",
          )
          .eq("codigo_empresa_filial", codigoFilialReqComp)
          .eq("numero_alvo", numeroReqComp)
          .maybeSingle();

        if (reqRow && reqRow.numero_pedido_compra_alvo !== ped.numero) {
          await supabase.from("compras_requisicoes").upsert(
            {
              id: reqRow.id,
              requisitante_user_id: reqRow.requisitante_user_id,
              status: reqRow.status,
              codigo_empresa_filial: codigoFilialReqComp,
              codigo_funcionario: reqRow.codigo_funcionario,
              codigo_centro_ctrl: reqRow.codigo_centro_ctrl,
              codigo_finalidade_compra: reqRow.codigo_finalidade_compra,
              data_necessidade: reqRow.data_necessidade,
              total_itens: reqRow.total_itens,
              numero_pedido_compra_alvo: ped.numero,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );
          console.log(`[sync-ped] vinculou req ${numeroReqComp} → ped ${ped.numero}`);
        }
      }

      result.total_mudaram++;
      result.detalhes.push({
        tipo: "ped",
        id: ped.id,
        numero_alvo: ped.numero,
        status_anterior: ped.status || undefined,
        status_novo: novoStatus || undefined,
        status_aprovacao_anterior: ped.status_aprovacao || undefined,
        status_aprovacao_novo: novoStatusAprovacao || undefined,
        aprovado_anterior: ped.aprovado || undefined,
        aprovado_novo: novoAprovado || undefined,
        comprado_anterior: ped.comprado || undefined,
        comprado_novo: novoComprado || undefined,
        proximo_aprovador_anterior: ped.proximo_aprovador || undefined,
        proximo_aprovador_novo: novoProximoAprovador || undefined,
      });

      console.log(`[sync-ped] ${ped.numero} mudou`);
    } catch (err: any) {
      result.total_erros++;
      result.detalhes.push({
        tipo: "ped",
        id: ped.id,
        numero_alvo: ped.numero,
        erro: `Exception: ${err?.message || String(err)}`,
      });
      console.error(`[sync-ped] erro ${ped.numero}:`, err);
    }
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Handler principal
// ─────────────────────────────────────────────────────────────────────

// Marcador de versão — anti deploy-fantasma. Aparece no log de CADA
// invocação. Se após o deploy o log não mostrar esta string, a versão
// nova NÃO está no ar (o deploy silenciosamente não subiu).
const BUILD_TAG = "REQ-AUDITORIA-CHECA-ERRO-v2-JOB4 (2026-08-28)";

Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  console.log(`[cron] build=${BUILD_TAG}`);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
      },
    });
  }

  const expectedSecret = Deno.env.get("CRON_SECRET");
  if (!expectedSecret) {
    console.error("[cron] CRON_SECRET não configurado nos secrets");
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
    console.warn("[cron] CRON_SECRET inválido");
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const validTriggers = ["pg_cron", "manual_admin", "test"];
  const safeTrigger = validTriggers.includes(triggeredBy) ? triggeredBy : "pg_cron";

  // Override opcional da janela do Job 3 (descoberta de pedidos) para
  // recuperação de histórico num disparo manual. Ex.: {"ped_window_days": 180}
  // recupera buracos antigos. Sem o param, usa a janela normal (30 dias).
  const pedWindowDaysRaw = Number(bodyJson?.ped_window_days);
  const pedWindowDays = Number.isFinite(pedWindowDaysRaw) && pedWindowDaysRaw > 0 ? pedWindowDaysRaw : undefined;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceRole);

  const { data: settings } = await supabase
    .from("sync_settings")
    .select("enabled, paused_reason")
    .eq("job_name", "sync-compras-status-cron")
    .maybeSingle();

  if (settings && settings.enabled === false) {
    console.log("[cron] sync pausado:", settings.paused_reason);

    await supabase.from("sync_runs").insert({
      triggered_by: safeTrigger,
      job_type: "bicephalous",
      total_candidatos: 0,
      total_consultados: 0,
      total_mudaram: 0,
      total_erros: 0,
      duracao_ms: Date.now() - startTime,
      observacao: `Sync pausado: ${settings.paused_reason || "sem motivo"}`,
      finished_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ skipped: true, reason: "sync_settings.enabled = false" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: runRow, error: errRun } = await supabase
    .from("sync_runs")
    .insert({
      triggered_by: safeTrigger,
      job_type: "bicephalous",
    })
    .select("id")
    .single();

  if (errRun || !runRow) {
    console.error("[cron] falha ao criar sync_run:", errRun);
    return new Response(JSON.stringify({ error: "Falha ao iniciar sync_run", details: errRun }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const runId = runRow.id;

  const erpUrl = Deno.env.get("ERP_PROXY_URL")!;
  const systemSecret = Deno.env.get("ERP_PROXY_SYSTEM_SECRET")!;

  if (!erpUrl || !systemSecret) {
    console.error("[cron] ERP_PROXY_URL ou ERP_PROXY_SYSTEM_SECRET não configurados");
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

  // ── Roda os 4 jobs em sequência ──────────────────────────────────────
  let job1: JobResult = { total_candidatos: 0, total_consultados: 0, total_mudaram: 0, total_erros: 0, detalhes: [] };
  let job2: JobResult = { total_candidatos: 0, total_consultados: 0, total_mudaram: 0, total_erros: 0, detalhes: [] };
  let job3: JobResult = { total_candidatos: 0, total_consultados: 0, total_mudaram: 0, total_erros: 0, detalhes: [] };
  let job4: JobResult = { total_candidatos: 0, total_consultados: 0, total_mudaram: 0, total_erros: 0, detalhes: [] };
  // Cross-check do Job 3 → Job 2 (L3 Missão 2). Default seguro: listaOk:false →
  // se o Job 3 não rodar/preencher (ex.: exceção antes do Job 2), o Job 2 faz
  // no-op nos 404 e não marca nada.
  let crossCheck: CrossCheckPedidos = {
    listaOk: false,
    janelaInicio: "",
    janelaFim: "",
    numerosVistos: new Set<string>(),
  };
  let observacao: string | null = null;

  try {
    // Ordem:
    // 1. Job 4 — descobre reqs novas (insere cabeçalhos leves)
    // 2. Job 3 — descobre pedidos novos (e tenta vincular nas reqs do Job 4)
    // 3. Job 1 — sync mudanças em reqs já no Hub
    // 4. Job 2 — sync mudanças em pedidos já no Hub
    job4 = await syncDescobrirRequisicoes(supabase, erpUrl, systemSecret, runId);
    const job3out = await syncDescobrirPedidos(supabase, erpUrl, systemSecret, runId, pedWindowDays);
    job3 = job3out.result;
    crossCheck = job3out.crossCheck;
    job1 = await syncRequisicoes(supabase, erpUrl, systemSecret);
    job2 = await syncPedidos(supabase, erpUrl, systemSecret, crossCheck);
  } catch (err: any) {
    console.error("[cron] exception:", err);
    observacao = `Exception inesperada: ${err?.message || String(err)}`;
  }

  const totals = {
    total_candidatos: job1.total_candidatos + job2.total_candidatos + job3.total_candidatos + job4.total_candidatos,
    total_consultados:
      job1.total_consultados + job2.total_consultados + job3.total_consultados + job4.total_consultados,
    total_mudaram: job1.total_mudaram + job2.total_mudaram + job3.total_mudaram + job4.total_mudaram,
    total_erros: job1.total_erros + job2.total_erros + job3.total_erros + job4.total_erros,
  };

  const todosDetalhes = [...job4.detalhes, ...job3.detalhes, ...job1.detalhes, ...job2.detalhes];

  // Diagnóstico L1.3 no sync_runs (preserva msg de exceção se houver).
  if (typeof job2.elegiveis_sem_limit === "number") {
    const diagPed = `Job2 elegíveis(sem limit)=${job2.elegiveis_sem_limit}, limit=${PED_BATCH_SIZE}`;
    observacao = observacao ? `${observacao} | ${diagPed}` : diagPed;
  }

  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startTime,
      ...totals,
      detalhes: todosDetalhes,
      observacao,
    })
    .eq("id", runId);

  return new Response(
    JSON.stringify({
      run_id: runId,
      duracao_ms: Date.now() - startTime,
      descoberta_requisicoes: {
        candidatos: job4.total_candidatos,
        consultados: job4.total_consultados,
        mudaram: job4.total_mudaram,
        erros: job4.total_erros,
      },
      descoberta_pedidos: {
        candidatos: job3.total_candidatos,
        consultados: job3.total_consultados,
        mudaram: job3.total_mudaram,
        erros: job3.total_erros,
      },
      requisicoes: {
        candidatos: job1.total_candidatos,
        consultados: job1.total_consultados,
        mudaram: job1.total_mudaram,
        erros: job1.total_erros,
      },
      pedidos: {
        candidatos: job2.total_candidatos,
        consultados: job2.total_consultados,
        mudaram: job2.total_mudaram,
        erros: job2.total_erros,
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
});
