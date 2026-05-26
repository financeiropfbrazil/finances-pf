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

  console.log(
    `[descobrir-req] cursor: ${lastKnownNumero} (${isBackfill ? "BACKFILL 3 anos" : "normal 30d"})`
  );

  // ── 2. Janela de datas ──────────────────────────────────────────────
  const hoje = new Date();
  const inicio = new Date();
  inicio.setDate(hoje.getDate() - windowDays);

  const dataFim = hoje.toISOString().slice(0, 10);
  const dataInicio = inicio.toISOString().slice(0, 10);

  // ── 3. /req-comp/list ───────────────────────────────────────────────
  const path = `/req-comp/list?dataInicio=${dataInicio}&dataFim=${dataFim}&apenasAbertas=true`;
  const resp = await callErpProxy(erpUrl, systemSecret, path);

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

  // ── 4. Filtra: Numero > cursor ──────────────────────────────────────
  const novas = todasReqs.filter((r) => r.Numero > lastKnownNumero);
  console.log(`[descobrir-req] ${novas.length} reqs novas (> ${lastKnownNumero})`);

  if (novas.length === 0) {
    return result;
  }

  // ── 5. Insere cada req nova ─────────────────────────────────────────
  let maiorNumeroVisto = lastKnownNumero;

  for (const req of novas) {
    try {
      if (!req.Numero) {
        console.warn(`[descobrir-req] req sem Numero, ignorada`);
        continue;
      }

      const dateOnly = (s: string | null) => (s ? s.slice(0, 10) : null);

      // Mapeia status local
      let statusLocal = "sincronizada";
      if (req.GerouPedComp === "Total" || req.GerouPedComp === "Parcial") {
        statusLocal = "convertida_pedido";
      }
      if (req.Status === "Cancelado" || req.Status === "Cancelada") {
        statusLocal = "cancelada";
      }

      // Verifica se já existe pra decidir entre INSERT (novo) ou UPDATE seletivo (existente).
      // UPDATE NÃO TOCA em requisitante_user_id, codigo_funcionario, codigo_centro_ctrl,
      // codigo_finalidade_compra, data_necessidade — esses são preenchidos pelo wizard do Hub
      // e NÃO devem ser sobrescritos por descoberta do Alvo.
      const { data: existing } = await supabase
        .from("compras_requisicoes")
        .select("id")
        .eq("codigo_empresa_filial", req.CodigoEmpresaFilial)
        .eq("numero_alvo", req.Numero)
        .maybeSingle();

      let errUpsert: any = null;
      if (existing) {
        // Já existe → UPDATE só do status (campo do Alvo que pode mudar)
        const { error } = await supabase
          .from("compras_requisicoes")
          .update({
            status: statusLocal,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        errUpsert = error;
      } else {
        // Nova descoberta via Alvo → INSERT completo com requisitante_user_id null
        const { error } = await supabase.from("compras_requisicoes").insert({
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
        errUpsert = error;
      }

      if (errUpsert) {
        result.total_erros++;
        result.detalhes.push({
          tipo: "req",
          id: "",
          numero_alvo: req.Numero,
          erro: `UPSERT falhou: ${errUpsert.message}`,
        });
        console.error(`[descobrir-req] ${req.Numero} UPSERT falhou:`, errUpsert);
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
    const { error: errCursorUpdate } = await supabase
      .from("sync_cursors")
      .upsert(
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
  const WINDOW_DAYS = 7;

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

  const novos = todosPedidos.filter((p) => p.Numero > lastKnownNumero);
  console.log(`[descobrir-ped] ${novos.length} pedidos novos (> ${lastKnownNumero})`);

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
          criado_no_hub: false,
          status_local: "sincronizado",
          numero_req_comp: ped.NumeroReqComp,
          codigo_empresa_filial_req_comp: ped.CodigoEmpresaFilialReqComp,
          detalhes_carregados: false,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
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
      "id, numero, codigo_empresa_filial, status, aprovado, status_aprovacao, comprado, proximo_aprovador, enviou_aprovacao, data_notificacao_aprovador",
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

      const mudou =
        !sameStr(novoStatus, ped.status) ||
        !sameStr(novoAprovado, ped.aprovado) ||
        !sameStr(novoStatusAprovacao, ped.status_aprovacao) ||
        !sameStr(novoComprado, ped.comprado) ||
        !sameStr(novoProximoAprovador, ped.proximo_aprovador) ||
        !sameStr(novoEnviouAprovacao, ped.enviou_aprovacao) ||
        tsToMs(novoDataNotif) !== tsToMs(ped.data_notificacao_aprovador);

      if (!mudou) {
        await supabase.from("compras_pedidos").update({ synced_at: new Date().toISOString() }).eq("id", ped.id);
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
    job3 = await syncDescobrirPedidos(supabase, erpUrl, systemSecret, runId);
    job1 = await syncRequisicoes(supabase, erpUrl, systemSecret);
    job2 = await syncPedidos(supabase, erpUrl, systemSecret);
  } catch (err: any) {
    console.error("[cron] exception:", err);
    observacao = `Exception inesperada: ${err?.message || String(err)}`;
  }

  const totals = {
    total_candidatos:
      job1.total_candidatos + job2.total_candidatos + job3.total_candidatos + job4.total_candidatos,
    total_consultados:
      job1.total_consultados + job2.total_consultados + job3.total_consultados + job4.total_consultados,
    total_mudaram:
      job1.total_mudaram + job2.total_mudaram + job3.total_mudaram + job4.total_mudaram,
    total_erros:
      job1.total_erros + job2.total_erros + job3.total_erros + job4.total_erros,
  };

  const todosDetalhes = [
    ...job4.detalhes,
    ...job3.detalhes,
    ...job1.detalhes,
    ...job2.detalhes,
  ];

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