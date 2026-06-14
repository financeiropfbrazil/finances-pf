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
  numero_req_comp: string | null;
  vinculo_requisicao: string | null;
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

  const STATUS_TERMINAIS = ["convertida_pedido", "cancelada"];

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

      const chave = `${req.CodigoEmpresaFilial}|${req.Numero}`;
      const existing = existentesMap.get(chave);

      if (existing) {
        // ── Req JÁ existe no Hub: atualiza status se houver progressão ──
        // Guarda anti-rebaixamento: status terminal nunca volta a
        // 'sincronizada' pelo list (que pode estar defasado do detalhe).
        // UPDATE NÃO TOCA em requisitante_user_id, codigo_funcionario,
        // codigo_centro_ctrl etc. — campos do wizard do Hub.
        const rebaixamento = STATUS_TERMINAIS.includes(existing.status) && !STATUS_TERMINAIS.includes(statusLocal);

        if (existing.status === statusLocal || rebaixamento) {
          if (req.Numero > maiorNumeroVisto) maiorNumeroVisto = req.Numero;
          continue;
        }

        const { error: errUpd } = await supabase
          .from("compras_requisicoes")
          .update({
            status: statusLocal,
            updated_at: new Date().toISOString(),
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

        await supabase.from("compras_requisicoes_auditoria").insert({
          requisicao_id: existing.id,
          evento: eventoAudit,
          user_id: null,
          user_nome: "Job 4 — Descoberta automática",
          sucesso: true,
          resposta_alvo: req,
        });

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
        await supabase.from("compras_requisicoes_auditoria").insert({
          requisicao_id: reqRow.id,
          evento: "descoberta_alvo",
          user_id: null,
          user_nome: "Job 4 — Descoberta automática",
          sucesso: true,
          resposta_alvo: req,
        });
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

      const { novoStatus } = mapReqAlvoToHub(resp.data, notFound);

      if (novoStatus === req.status) {
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

      await supabase.from("compras_requisicoes_auditoria").insert({
        requisicao_id: req.id,
        evento: eventoAudit,
        user_id: null,
        user_nome: "Sincronização automática",
        sucesso: true,
        resposta_alvo: notFound ? { not_found: true } : resp.data,
      });

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
): Promise<JobResult> {
  const result: JobResult = {
    total_candidatos: 0,
    total_consultados: 0,
    total_mudaram: 0,
    total_erros: 0,
    detalhes: [],
  };

  const CURSOR_NAME = "ped-comp-last-numero-1.01";
  const FILIAL = "1.01";
  // Janela normal de 30 dias (alinhada ao Job 4). Override permite recuperação
  // de histórico (ex.: 180) num disparo manual, sem alterar o regime normal.
  const WINDOW_DAYS = windowDaysOverride && windowDaysOverride > 0 ? windowDaysOverride : 30;

  const { data: cursorRow, error: errCursor } = await supabase
    .from("sync_cursors")
    .select("cursor_value")
    .eq("cursor_name", CURSOR_NAME)
    .maybeSingle();

  if (errCursor) {
    console.error("[descobrir-ped] erro ao ler cursor:", errCursor);
    result.total_erros = 1;
    return result;
  }

  const lastKnownNumero = cursorRow?.cursor_value || "0000000";
  console.log(`[descobrir-ped] cursor atual: ${lastKnownNumero}`);

  const hoje = new Date();
  const inicio = new Date();
  inicio.setDate(hoje.getDate() - WINDOW_DAYS);

  const dataFim = hoje.toISOString().slice(0, 10);
  const dataInicio = inicio.toISOString().slice(0, 10);

  console.log(`[descobrir-ped] janela: ${dataInicio} → ${dataFim}`);

  const path = `/ped-comp/list?dataInicio=${dataInicio}&dataFim=${dataFim}`;
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
    return result;
  }

  const todosPedidos = (resp.data || []) as PedidoLeve[];
  result.total_consultados = todosPedidos.length;
  result.total_candidatos = todosPedidos.length;

  console.log(`[descobrir-ped] Alvo retornou ${todosPedidos.length} pedidos na janela`);

  // ── RECONCILIAÇÃO NA JANELA (correção do buraco de descoberta) ──────
  // Antes: filtrava só Numero > cursor, então pedidos que ficaram abaixo do
  // cursor mas ausentes do Hub NUNCA eram inseridos (causa do buraco de abril
  // 3733-3908). Agora processa TODOS os pedidos da janela: insere os ausentes
  // (mesmo Numero <= cursor) e pula os que já existem sem mudança relevante.
  // Espelha a correção aplicada ao Job 4 em 10/06/2026.
  const novos = todosPedidos;
  console.log(`[descobrir-ped] ${novos.length} pedidos na janela (reconciliação completa, cursor=${lastKnownNumero})`);

  if (novos.length === 0) {
    return result;
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
          tipo: ped.Tipo,
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

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// JOB 2: Sincronizar Pedidos (mudanças)
// ─────────────────────────────────────────────────────────────────────

async function syncPedidos(supabase: SupabaseClient, erpUrl: string, systemSecret: string): Promise<JobResult> {
  const result: JobResult = {
    total_candidatos: 0,
    total_consultados: 0,
    total_mudaram: 0,
    total_erros: 0,
    detalhes: [],
  };

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 180);

  const { data: candidatos, error: errSelect } = await supabase
    .from("compras_pedidos")
    .select(
      "id, numero, codigo_empresa_filial, status, aprovado, status_aprovacao, comprado, proximo_aprovador, enviou_aprovacao, data_notificacao_aprovador, valor_total, numero_req_comp, vinculo_requisicao",
    )
    .not("status", "in", '("Encerrado","Cancelado","Cancelado Parcial")')
    .or(`data_pedido.gte.${cutoffDate.toISOString().slice(0, 10)},status_aprovacao.in.(Em Andamento,Reavaliar)`)
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

  await processInChunks(peds, CHUNK_SIZE, SLEEP_BETWEEN_CHUNKS_MS, async (ped) => {
    try {
      const path = `/ped-comp/${encodeURIComponent(ped.codigo_empresa_filial)}/${encodeURIComponent(ped.numero)}`;
      const resp = await callErpProxy(erpUrl, systemSecret, path);

      result.total_consultados++;

      const notFound = resp.status === 404;

      if (!resp.ok) {
        if (notFound) {
          console.warn(`[sync-ped] ${ped.numero} retornou 404 no Alvo`);
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
      const userFields = alvo?.PedCompUserFieldsObject || {};

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

      // ⭐ NOVO: dispara email se aprovação acabou de finalizar
      // Transição: (antigo != Finalizada/Total) → (novo == Finalizada/Total)
      const aprovouAgora =
        novoStatusAprovacao === "Finalizada" &&
        novoAprovado === "Total" &&
        !(ped.status_aprovacao === "Finalizada" && ped.aprovado === "Total");

      if (aprovouAgora) {
        try {
          const emailResp = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/notify-pedido-aprovado`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
            },
            body: JSON.stringify({ pedido_id: ped.id }),
          });
          const emailData = await emailResp.json();
          if (!emailResp.ok) {
            console.error(`[cron] notify-pedido-aprovado falhou pra ${ped.numero}:`, emailData);
          } else {
            console.log(
              `[cron] Email de aprovação ${ped.numero}:`,
              emailData?.skipped ? `skipped (${emailData.reason})` : `sent → ${emailData.sent_to}`,
            );
          }
        } catch (emailErr: any) {
          // Falha de email não deve quebrar o cron — apenas log
          console.error(
            `[cron] Erro ao chamar notify-pedido-aprovado pra ${ped.numero}:`,
            emailErr?.message || emailErr,
          );
        }
      }
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
  let observacao: string | null = null;

  try {
    // Ordem:
    // 1. Job 4 — descobre reqs novas (insere cabeçalhos leves)
    // 2. Job 3 — descobre pedidos novos (e tenta vincular nas reqs do Job 4)
    // 3. Job 1 — sync mudanças em reqs já no Hub
    // 4. Job 2 — sync mudanças em pedidos já no Hub
    job4 = await syncDescobrirRequisicoes(supabase, erpUrl, systemSecret, runId);
    job3 = await syncDescobrirPedidos(supabase, erpUrl, systemSecret, runId, pedWindowDays);
    job1 = await syncRequisicoes(supabase, erpUrl, systemSecret);
    job2 = await syncPedidos(supabase, erpUrl, systemSecret);
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
