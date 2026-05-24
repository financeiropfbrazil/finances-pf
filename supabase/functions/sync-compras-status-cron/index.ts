// =====================================================================
// Edge Function: sync-compras-status-cron
// =====================================================================
// Sincroniza status de Requisições de Compra e Pedidos de Compra com o
// ERP Alvo. Chamado por pg_cron a cada hora em horário comercial.
//
// FLUXO:
//   1. Valida CRON_SECRET (auth de invocação)
//   2. Lê sync_settings → para se enabled=false
//   3. Job 1: sincroniza requisições candidatas
//   4. Job 2: sincroniza pedidos candidatos + vincula req↔pedido
//   5. Persiste resultado em sync_runs
//
// CRITÉRIOS DE CANDIDATURA:
//   - Requisições: status='sincronizada' + numero_alvo NOT NULL
//                  + created_at > NOW() - 180 days, LIMIT 50
//   - Pedidos: status NOT IN ('Encerrado', 'Cancelado')
//              AND (data_pedido > NOW() - 180 days OR
//                   status_aprovacao IN ('Em Andamento', 'Reavaliar')),
//              ordenados por synced_at ASC NULLS FIRST, LIMIT 100
//
// PARALELISMO: chunks de 5 em paralelo, sleep 200ms entre chunks
//
// SECRETS NECESSÁRIOS (já configurados):
//   - CRON_SECRET          (auth da invocação)
//   - ERP_PROXY_URL        (https://erp-proxy.onrender.com)
//   - ERP_PROXY_SYSTEM_SECRET  (header X-System-Secret pra erp-proxy)
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

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 5;
const SLEEP_BETWEEN_CHUNKS_MS = 200;
const REQ_BATCH_SIZE = 50;
const PED_BATCH_SIZE = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Processa array em chunks paralelos com sleep entre eles
async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  sleepMs: number,
  fn: (item: T) => Promise<R>
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

// Chama erp-proxy com header X-System-Secret. Retorna {ok, status, data}.
async function callErpProxy(
  url: string,
  systemSecret: string,
  path: string
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

function mapReqAlvoToHub(respData: any, notFound: boolean): {
  novoStatus: string;
  numeroPedidoCompraAlvo: string | null;
} {
  // Caso 1: req deletada fisicamente no Alvo → cancelada
  if (notFound) {
    return { novoStatus: "cancelada", numeroPedidoCompraAlvo: null };
  }

  const statusAlvo = String(respData?.Status || "").toLowerCase();
  const gerouPedComp = String(respData?.GerouPedComp || "").toLowerCase();

  // Caso 2: virou pedido (Status="Pedido" OR GerouPedComp in ['Total','Parcial'])
  if (
    statusAlvo === "pedido" ||
    gerouPedComp === "total" ||
    gerouPedComp === "parcial"
  ) {
    return { novoStatus: "convertida_pedido", numeroPedidoCompraAlvo: null };
  }

  // Caso 3: cancelada no Alvo (sem deletar)
  if (statusAlvo === "cancelado" || statusAlvo === "cancelada") {
    return { novoStatus: "cancelada", numeroPedidoCompraAlvo: null };
  }

  // Caso 4: nenhuma mudança → mantém sincronizada
  return { novoStatus: "sincronizada", numeroPedidoCompraAlvo: null };
}

// ─────────────────────────────────────────────────────────────────────
// JOB 1: Sincronizar Requisições
// ─────────────────────────────────────────────────────────────────────

async function syncRequisicoes(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string
): Promise<JobResult> {
  const result: JobResult = {
    total_candidatos: 0,
    total_consultados: 0,
    total_mudaram: 0,
    total_erros: 0,
    detalhes: [],
  };

  // 1. Busca candidatas
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 180);

  const { data: candidatas, error: errSelect } = await supabase
    .from("compras_requisicoes")
    .select(
      "id, requisitante_user_id, status, codigo_empresa_filial, numero_alvo, numero_pedido_compra_alvo, codigo_funcionario, codigo_centro_ctrl, codigo_finalidade_compra, data_necessidade, total_itens"
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

  // 2. Processa em chunks paralelos
  await processInChunks(reqs, CHUNK_SIZE, SLEEP_BETWEEN_CHUNKS_MS, async (req) => {
    try {
      const path = `/req-comp/${encodeURIComponent(req.codigo_empresa_filial)}/${encodeURIComponent(req.numero_alvo)}`;
      const resp = await callErpProxy(erpUrl, systemSecret, path);

      result.total_consultados++;

      const notFound = resp.status === 404;

      if (!resp.ok && !notFound) {
        // Erro de comunicação (não é 404 "not found")
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
        // Sem mudança — apenas atualiza updated_at via toque vazio (opcional)
        return;
      }

      // 3. Aplica UPSERT (CORS-safe pattern)
      const { error: errUpsert } = await supabase
        .from("compras_requisicoes")
        .upsert(
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
          { onConflict: "id" }
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

      // 4. Audit
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
// JOB 2: Sincronizar Pedidos
// ─────────────────────────────────────────────────────────────────────

async function syncPedidos(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string
): Promise<JobResult> {
  const result: JobResult = {
    total_candidatos: 0,
    total_consultados: 0,
    total_mudaram: 0,
    total_erros: 0,
    detalhes: [],
  };

  // 1. Busca candidatos
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 180);

  // Critério: NÃO terminais + (recentes OU aprovação ativa)
  // SQL equivalente:
  //   status NOT IN ('Encerrado','Cancelado','Cancelado Parcial')
  //   AND (data_pedido > cutoff OR status_aprovacao IN ('Em Andamento','Reavaliar'))
  const { data: candidatos, error: errSelect } = await supabase
    .from("compras_pedidos")
    .select(
      "id, numero, codigo_empresa_filial, status, aprovado, status_aprovacao, comprado, proximo_aprovador, enviou_aprovacao, data_notificacao_aprovador"
    )
    .not("status", "in", '("Encerrado","Cancelado","Cancelado Parcial")')
    .or(
      `data_pedido.gte.${cutoffDate.toISOString().slice(0, 10)},status_aprovacao.in.(Em Andamento,Reavaliar)`
    )
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

  // 2. Processa em chunks paralelos
  await processInChunks(peds, CHUNK_SIZE, SLEEP_BETWEEN_CHUNKS_MS, async (ped) => {
    try {
      const path = `/ped-comp/${encodeURIComponent(ped.codigo_empresa_filial)}/${encodeURIComponent(ped.numero)}`;
      const resp = await callErpProxy(erpUrl, systemSecret, path);

      result.total_consultados++;

      const notFound = resp.status === 404;

      if (!resp.ok) {
        // Pedido pode ter sido deletado no Alvo, ou erro de comunicação
        if (notFound) {
          // Não muda nada (pedidos deletados são raros, não tratamos automaticamente)
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

      // 3. Compara campos
      const novoStatus = alvo?.Status ?? null;
      const novoAprovado = alvo?.Aprovado ?? null;
      const novoStatusAprovacao = alvo?.StatusAprovacao ?? null;
      const novoComprado = alvo?.Comprado ?? null;
      const novoProximoAprovador = userFields?.UserProximoAprovador ?? null;
      const novoEnviouAprovacao = userFields?.UserEnviouAprovacao ?? null;
      const novoDataNotif = userFields?.UserDataNotificao ?? null;

      const mudou =
        novoStatus !== ped.status ||
        novoAprovado !== ped.aprovado ||
        novoStatusAprovacao !== ped.status_aprovacao ||
        novoComprado !== ped.comprado ||
        novoProximoAprovador !== ped.proximo_aprovador ||
        novoEnviouAprovacao !== ped.enviou_aprovacao ||
        novoDataNotif !== ped.data_notificacao_aprovador;

      // Sempre atualiza synced_at, mas só UPSERT completo se mudou
      if (!mudou) {
        // Touch synced_at pra entrar no fim da fila
        await supabase
          .from("compras_pedidos")
          .update({ synced_at: new Date().toISOString() })
          .eq("id", ped.id);
        return;
      }

      // 4. UPSERT (CORS-safe)
      const { error: errUpsert } = await supabase
        .from("compras_pedidos")
        .upsert(
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
          { onConflict: "id" }
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

      // 5. Audit
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

      // 6. Vinculação req↔pedido (Plano B)
      // Se este pedido tem NumeroReqComp, atualiza compras_requisicoes
      // com numero_pedido_compra_alvo = numero do pedido
      const numeroReqComp = alvo?.NumeroReqComp;
      const codigoFilialReqComp = alvo?.CodigoEmpresaFilialReqComp;
      if (numeroReqComp && codigoFilialReqComp) {
        const { data: reqRow } = await supabase
          .from("compras_requisicoes")
          .select("id, numero_pedido_compra_alvo, requisitante_user_id, status, codigo_funcionario, codigo_centro_ctrl, codigo_finalidade_compra, data_necessidade, total_itens")
          .eq("codigo_empresa_filial", codigoFilialReqComp)
          .eq("numero_alvo", numeroReqComp)
          .maybeSingle();

        if (reqRow && reqRow.numero_pedido_compra_alvo !== ped.numero) {
          await supabase
            .from("compras_requisicoes")
            .upsert(
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
              { onConflict: "id" }
            );
          console.log(
            `[sync-ped] vinculou req ${numeroReqComp} → ped ${ped.numero}`
          );
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

  // CORS pra eventual chamada via fetch admin (opcional)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
      },
    });
  }

  // ── 1. Autenticação via CRON_SECRET ─────────────────────────────────
  const expectedSecret = Deno.env.get("CRON_SECRET");
  if (!expectedSecret) {
    console.error("[cron] CRON_SECRET não configurado nos secrets");
    return new Response(
      JSON.stringify({ error: "Edge function mal configurada" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const headerSecret = req.headers.get("x-cron-secret");
  const bodyJson = await req.json().catch(() => ({}));
  const bodySecret = bodyJson?.cron_secret;
  const triggeredBy = bodyJson?.triggered_by || "pg_cron";

  if (headerSecret !== expectedSecret && bodySecret !== expectedSecret) {
    console.warn("[cron] CRON_SECRET inválido");
    return new Response(
      JSON.stringify({ error: "Não autorizado" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Valida triggered_by
  const validTriggers = ["pg_cron", "manual_admin", "test"];
  const safeTrigger = validTriggers.includes(triggeredBy) ? triggeredBy : "pg_cron";

  // ── 2. Inicializa Supabase client ───────────────────────────────────
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceRole);

  // ── 3. Verifica kill switch ─────────────────────────────────────────
  const { data: settings } = await supabase
    .from("sync_settings")
    .select("enabled, paused_reason")
    .eq("job_name", "sync-compras-status-cron")
    .maybeSingle();

  if (settings && settings.enabled === false) {
    console.log("[cron] sync pausado:", settings.paused_reason);

    // Loga em sync_runs como execução pulada
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

    return new Response(
      JSON.stringify({ skipped: true, reason: "sync_settings.enabled = false" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── 4. Cria linha em sync_runs (status iniciado) ────────────────────
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
    return new Response(
      JSON.stringify({ error: "Falha ao iniciar sync_run", details: errRun }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const runId = runRow.id;

  // ── 5. Roda os jobs ─────────────────────────────────────────────────
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

    return new Response(
      JSON.stringify({ error: "Edge function mal configurada" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let job1: JobResult = { total_candidatos: 0, total_consultados: 0, total_mudaram: 0, total_erros: 0, detalhes: [] };
  let job2: JobResult = { total_candidatos: 0, total_consultados: 0, total_mudaram: 0, total_erros: 0, detalhes: [] };
  let observacao: string | null = null;

  try {
    job1 = await syncRequisicoes(supabase, erpUrl, systemSecret);
    job2 = await syncPedidos(supabase, erpUrl, systemSecret);
  } catch (err: any) {
    console.error("[cron] exception:", err);
    observacao = `Exception inesperada: ${err?.message || String(err)}`;
  }

  // ── 6. Fecha linha em sync_runs ─────────────────────────────────────
  const totals = {
    total_candidatos: job1.total_candidatos + job2.total_candidatos,
    total_consultados: job1.total_consultados + job2.total_consultados,
    total_mudaram: job1.total_mudaram + job2.total_mudaram,
    total_erros: job1.total_erros + job2.total_erros,
  };

  const todosDetalhes = [...job1.detalhes, ...job2.detalhes];

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

  // ── 7. Resposta ─────────────────────────────────────────────────────
  return new Response(
    JSON.stringify({
      run_id: runId,
      duracao_ms: Date.now() - startTime,
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
    }
  );
});
