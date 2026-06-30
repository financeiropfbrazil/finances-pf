// =====================================================================
// Edge Function: sync-produtos-cron  (v2 — background task)
// =====================================================================
// Sincroniza o CADASTRO de produtos (stock_products) a partir do ERP Alvo,
// server-side, 1x/dia em dia útil. Replica o que o botão "Sincronizar"
// do /inventory/import faz no browser (alvoEstoqueService.ts).
//
// POR QUE BACKGROUND TASK:
//   O Alvo é lento (~27s/página). Varrer o catálogo (~2700 produtos,
//   ~6 páginas) leva mais que os 150s do limite de RESPOSTA da Edge
//   Function. Solução (padrão Supabase Pro): responder 202 na hora e
//   seguir processando em background via EdgeRuntime.waitUntil(), que
//   permite rodar até o teto de wall-clock de 400s. O cron dispara via
//   pg_net (não espera resposta), então o 202 imediato é suficiente.
//
// SEM CHECKPOINT: como roda 1x/dia, varre o catálogo inteiro numa
//   execução. Gravação é incremental (página a página via RPC), então
//   se cortar no meio, o que entrou fica (upsert idempotente) e a
//   execução do dia seguinte completa.
//
// O QUE FAZ vs NÃO FAZ:
//   - FAZ: pagina produto/GetListForComponents via /estoque/produto-sync,
//          mapeia e grava via RPC sync_stock_products_from_erp.
//   - NÃO FAZ: controla_lote — isso é do sync-lote-cron (jobid 16),
//          que roda às 06:00 e pega produtos novos (lote_verificado_em=null).
//
// PRESERVAÇÃO (dentro da RPC): codigo_alternativo e unidade_medida
//   preservados se já têm valor; controla_lote via COALESCE.
//
// SECRETS (reusados dos outros crons):
//   CRON_SECRET, ERP_PROXY_URL, ERP_PROXY_SYSTEM_SECRET,
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// DEPLOY:
//   supabase functions deploy sync-produtos-cron \
//     --no-verify-jwt --project-ref hbtggrbauguukewiknew
// =====================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ─────────────────────────────────────────────────────────────
// Configuração
// ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 500; // produtos por página (proxy aceita até 1000)
const RPC_CHUNK = 200; // produtos por chamada à RPC (igual ao browser)
const MAX_PAGINAS = 50; // teto de segurança (50 × 500 = 25k)
const DELAY_MS = 120; // pausa entre páginas (gentileza com o Alvo)
const WATCHDOG_MS = 360_000; // 360s — margem antes do teto de 400s da Edge Function

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Espelha TIPO_LABELS do alvoEstoqueService.ts.
const TIPO_LABELS: Record<string, string> = {
  "01": "Acabado",
  "02": "Semi-Acabado",
  "03": "Matéria Prima",
  "06": "Material de Embalagem",
  "44": "Insumos",
};

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────

interface ProdutoCron {
  totalERP: number;
  enviadosRPC: number;
  novos: number;
  atualizados: number;
  erros: number;
  paginas: number;
  parado_por_watchdog: boolean;
  detalhes: Array<{ etapa: string; erro?: string; info?: string }>;
}

// ─────────────────────────────────────────────────────────────
// Proxy /estoque/produto-sync com X-System-Secret
// ─────────────────────────────────────────────────────────────

async function buscarPaginaProdutos(
  erpUrl: string,
  systemSecret: string,
  pageIndex: number,
  pageSize: number,
): Promise<{ ok: boolean; status: number; items: any[]; error?: string }> {
  const url = `${erpUrl}/estoque/produto-sync`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-System-Secret": systemSecret },
      body: JSON.stringify({ pageIndex, pageSize }),
    });
  } catch (e: any) {
    return { ok: false, status: 0, items: [], error: `fetch falhou: ${e?.message || String(e)}` };
  }

  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    // sem body
  }

  if (!resp.ok) {
    const msg =
      data && typeof data === "object" && (data.error || data.Message)
        ? String(data.error || data.Message)
        : `HTTP ${resp.status}`;
    return { ok: false, status: resp.status, items: [], error: msg };
  }

  const items: any[] = Array.isArray(data) ? data : (data?.lista ?? data?.Registros ?? []);
  return { ok: true, status: resp.status, items };
}

// ─────────────────────────────────────────────────────────────
// Mapeia item do Alvo → linha de stock_products (espelha o browser)
// ─────────────────────────────────────────────────────────────

function mapearProduto(item: any): any | null {
  const codigo = item.Codigo ?? "";
  const nivel = item.Nivel ?? "";

  if (!nivel || nivel === "" || codigo === nivel || item.Grupo === "T") return null;

  const tipoCodigo = item.CodigoTipoProduto ?? "";

  return {
    codigo_produto: codigo,
    codigo_reduzido: item.Reduzido ?? null,
    codigo_alternativo: item.Alternativo ?? null,
    nome_produto: item.Nome ?? "",
    tipo_produto: TIPO_LABELS[tipoCodigo] ?? (tipoCodigo || "Outros"),
    familia_codigo: nivel,
    variacao: item.NomeAlternativo3 ?? null,
    unidade_medida: null,
    ativo: true,
    codigo_barras: item.CodigoBarras ?? null,
    classificacao_fiscal: item.CodigoClasFiscal ?? null,
    tipo_produto_fiscal: item.CodigoTipoProdFisc ?? null,
    data_cadastro: item.DataCadastro ? item.DataCadastro.split("T")[0] : null,
  };
}

// ─────────────────────────────────────────────────────────────
// Envia um conjunto de produtos pra RPC em sub-lotes de RPC_CHUNK
// ─────────────────────────────────────────────────────────────

async function gravarViaRPC(supabase: SupabaseClient, produtos: any[], result: ProdutoCron): Promise<void> {
  for (let i = 0; i < produtos.length; i += RPC_CHUNK) {
    const chunk = produtos.slice(i, i + RPC_CHUNK);

    const { data, error } = await (supabase as any).rpc("sync_stock_products_from_erp", {
      produtos: chunk,
    });

    if (error) {
      result.erros += chunk.length;
      result.detalhes.push({ etapa: "rpc", erro: error.message });
      continue;
    }

    result.enviadosRPC += chunk.length;
    if (data && typeof data === "object") {
      result.novos += Number(data.novos ?? 0);
      result.atualizados += Number(data.atualizados ?? 0);
      result.erros += Number(data.erros ?? 0);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Job principal — GRAVAÇÃO INCREMENTAL (página a página)
// ─────────────────────────────────────────────────────────────

async function syncProdutos(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string,
  t0: number,
): Promise<ProdutoCron> {
  const result: ProdutoCron = {
    totalERP: 0,
    enviadosRPC: 0,
    novos: 0,
    atualizados: 0,
    erros: 0,
    paginas: 0,
    parado_por_watchdog: false,
    detalhes: [],
  };

  let pageIndex = 1;
  let hasMore = true;

  while (hasMore && pageIndex <= MAX_PAGINAS) {
    if (Date.now() - t0 > WATCHDOG_MS) {
      result.parado_por_watchdog = true;
      result.detalhes.push({ etapa: "watchdog", erro: `Parou na página ${pageIndex} após ${Date.now() - t0}ms` });
      break;
    }

    const page = await buscarPaginaProdutos(erpUrl, systemSecret, pageIndex, PAGE_SIZE);

    if (!page.ok) {
      result.erros++;
      result.detalhes.push({ etapa: "listagem", erro: `Página ${pageIndex}: ${page.error}` });
      break;
    }

    result.paginas++;

    if (page.items.length === 0) {
      hasMore = false;
      break;
    }

    // Mapeia esta página
    const mapeados: any[] = [];
    for (const item of page.items) {
      const row = mapearProduto(item);
      if (row) mapeados.push(row);
    }
    result.totalERP += mapeados.length;

    // GRAVA JÁ — não acumula pro fim. Se cortar depois, isto fica.
    if (mapeados.length > 0) {
      await gravarViaRPC(supabase, mapeados, result);
    }

    if (page.items.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      pageIndex++;
      await sleep(DELAY_MS);
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// Executa o job e persiste auditoria (roda em background)
// ─────────────────────────────────────────────────────────────

async function executarEPersistir(
  supabase: SupabaseClient,
  runId: string,
  erpUrl: string,
  systemSecret: string,
  startTime: number,
): Promise<void> {
  let result: ProdutoCron;
  let observacao: string | null = null;

  try {
    result = await syncProdutos(supabase, erpUrl, systemSecret, startTime);
  } catch (err: any) {
    console.error("[produtos-cron] exception:", err);
    result = {
      totalERP: 0,
      enviadosRPC: 0,
      novos: 0,
      atualizados: 0,
      erros: 1,
      paginas: 0,
      parado_por_watchdog: false,
      detalhes: [{ etapa: "exception", erro: err?.message || String(err) }],
    };
    observacao = `Exception inesperada: ${err?.message || String(err)}`;
  }

  if (!observacao) {
    observacao =
      `novos=${result.novos} atualizados=${result.atualizados} ` +
      `erros=${result.erros} paginas=${result.paginas}` +
      (result.parado_por_watchdog ? " | PAROU POR WATCHDOG: completa amanhã" : " | catálogo completo");
  }

  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startTime,
      total_candidatos: result.totalERP,
      total_consultados: result.enviadosRPC,
      total_mudaram: result.novos + result.atualizados,
      total_erros: result.erros,
      detalhes: result.detalhes,
      observacao,
    })
    .eq("id", runId);

  console.log(`[produtos-cron] fim: ${observacao} duracao=${Date.now() - startTime}ms`);
}

// ─────────────────────────────────────────────────────────────
// Handler — responde rápido, processa em background
// ─────────────────────────────────────────────────────────────

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
    console.error("[produtos-cron] CRON_SECRET não configurado");
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
    console.warn("[produtos-cron] CRON_SECRET inválido");
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

  // ── Liga/desliga via sync_settings ──
  const { data: settings } = await supabase
    .from("sync_settings")
    .select("enabled, paused_reason")
    .eq("job_name", "sync-produtos-cron")
    .maybeSingle();

  if (settings && settings.enabled === false) {
    console.log("[produtos-cron] pausado:", settings.paused_reason);
    await supabase.from("sync_runs").insert({
      triggered_by: safeTrigger,
      job_type: "produtos",
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

  // ── Cria a linha de auditoria (started) ──
  const { data: runRow, error: errRun } = await supabase
    .from("sync_runs")
    .insert({ triggered_by: safeTrigger, job_type: "produtos" })
    .select("id")
    .single();

  if (errRun || !runRow) {
    console.error("[produtos-cron] falha ao criar sync_run:", errRun);
    return new Response(JSON.stringify({ error: "Falha ao iniciar sync_run", details: errRun }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const runId = runRow.id;

  // ── Secrets do proxy ──
  const erpUrl = Deno.env.get("ERP_PROXY_URL")!;
  const systemSecret = Deno.env.get("ERP_PROXY_SYSTEM_SECRET")!;

  if (!erpUrl || !systemSecret) {
    console.error("[produtos-cron] ERP_PROXY_URL ou ERP_PROXY_SYSTEM_SECRET ausentes");
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

  // ── Dispara o processamento em BACKGROUND e responde já ──
  // EdgeRuntime.waitUntil mantém o worker vivo até a tarefa terminar
  // (até o teto de 400s), mesmo depois de retornarmos a resposta.
  // @ts-ignore — EdgeRuntime é global no runtime do Supabase
  EdgeRuntime.waitUntil(executarEPersistir(supabase, runId, erpUrl, systemSecret, startTime));

  // Resposta imediata pro pg_net (que não espera o fim de qualquer forma).
  return new Response(
    JSON.stringify({
      accepted: true,
      run_id: runId,
      message: "Sync de produtos iniciado em background. Acompanhe em sync_runs (job_type='produtos').",
    }),
    { status: 202, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
});
