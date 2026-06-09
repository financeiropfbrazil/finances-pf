// supabase/functions/sync-intercompany-cron/index.ts
// Sincroniza intercompany (PEF Áustria 0000017): Fase 1 (bruta via erp-proxy)
// + Fase 3 (auto_create_masters_from_invoices). O passo de criação de master
// nunca existiu no fluxo manual (handleSync só dá refetch) — este cron o adiciona.
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const JOB_NAME = "sync-intercompany";
const JOB_TYPE = "intercompany";
const JANELA_MESES = 2; // mês atual + anterior (pega atrasos/edição de câmbio)
const PROXY_TIMEOUT_MS = 120_000; // sync-batch do Render tem teto 100s

// 1º dia do mês, hoje menos N meses, em UTC → 'YYYY-MM-DD'
function primeiroDiaMesesAtras(n: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1)).toISOString().slice(0, 10);
}

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

  // ── 1. Auth ──
  const expectedSecret = Deno.env.get("CRON_SECRET");
  if (!expectedSecret) {
    return new Response(JSON.stringify({ error: "CRON_SECRET ausente" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const headerSecret = req.headers.get("x-cron-secret");
  const bodyJson = await req.json().catch(() => ({}));
  const bodySecret = bodyJson?.cron_secret;
  const triggeredBy = bodyJson?.triggered_by || "pg_cron";
  if (headerSecret !== expectedSecret && bodySecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const validTriggers = ["pg_cron", "manual_admin", "test"];
  const safeTrigger = validTriggers.includes(triggeredBy) ? triggeredBy : "pg_cron";

  const supabase: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── 2. Kill-switch ──
  const { data: settings } = await supabase
    .from("sync_settings")
    .select("enabled, paused_reason")
    .eq("job_name", JOB_NAME)
    .maybeSingle();

  if (settings && settings.enabled === false) {
    await supabase.from("sync_runs").insert({
      triggered_by: safeTrigger,
      job_type: JOB_TYPE,
      duracao_ms: Date.now() - startTime,
      observacao: `Pausado: ${settings.paused_reason || "sem motivo"}`,
      finished_at: new Date().toISOString(),
    });
    return new Response(JSON.stringify({ skipped: true, reason: "enabled=false" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 3. Abre a run ──
  const { data: runRow, error: errRun } = await supabase
    .from("sync_runs")
    .insert({ triggered_by: safeTrigger, job_type: JOB_TYPE })
    .select("id")
    .single();
  if (errRun || !runRow) {
    return new Response(JSON.stringify({ error: "Falha ao criar sync_run", details: errRun }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const runId = runRow.id;

  const erpUrl = Deno.env.get("ERP_PROXY_URL")!;
  const systemSecret = Deno.env.get("ERP_PROXY_SYSTEM_SECRET")!;
  if (!erpUrl || !systemSecret) {
    await supabase
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        duracao_ms: Date.now() - startTime,
        total_erros: 1,
        observacao: "Sem ERP_PROXY_URL ou ERP_PROXY_SYSTEM_SECRET",
      })
      .eq("id", runId);
    return new Response(JSON.stringify({ error: "Edge function mal configurada" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const dataInicial = primeiroDiaMesesAtras(JANELA_MESES - 1); // 2 meses = atual + anterior
  const dataFinal = new Date().toISOString().slice(0, 10);

  const acc = {
    listed: 0,
    mapped: 0,
    failed: 0,
    inserted: 0,
    updated: 0,
    masters_created: 0,
    masters_skipped: 0,
    erros: 0,
  };
  let observacao: string | null = null;
  let syncBody: any = null;
  let autoCreateResult: any = null;

  try {
    // ── 4. Fase 1: sync-batch (popula intercompany_invoices) ──
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(`${erpUrl}/intercompany/sync-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-System-Secret": systemSecret },
        body: JSON.stringify({ dataInicial, dataFinal }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    syncBody = await resp.json().catch(() => null);
    if (!resp.ok || !syncBody?.summary) {
      acc.erros++;
      observacao = `Fase 1 falhou: HTTP ${resp.status}`;
    } else {
      acc.listed = syncBody.summary.total_listed ?? 0;
      acc.mapped = syncBody.summary.total_mapped ?? 0;
      acc.failed = syncBody.summary.total_failed ?? 0;
      acc.inserted = syncBody.persistence?.inserted ?? 0;
      acc.updated = syncBody.persistence?.updated ?? 0;

      // ── 5. Fase 3: cria masters dos novos órfãos ──
      const { data: ac, error: acErr } = await supabase.rpc("auto_create_masters_from_invoices");
      if (acErr) {
        acc.erros++;
        observacao = `Fase 3 (auto_create) falhou: ${acErr.message}`;
      } else {
        autoCreateResult = ac;
        acc.masters_created = ac?.created_count ?? 0;
        acc.masters_skipped = ac?.skipped_count ?? 0;
        observacao = `Janela ${dataInicial}..${dataFinal}: ${acc.inserted} novas/${acc.updated} atualizadas na bruta, ${acc.masters_created} masters criadas.`;
      }
    }
  } catch (err: any) {
    acc.erros++;
    observacao = `Exception: ${err?.message || String(err)}`;
  }

  // ── 6. Fecha a run ──
  // total_candidatos = docs listados no Alvo; total_consultados = persistidos na bruta;
  // total_mudaram = masters criadas; total_erros = falhas de fase/exception.
  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startTime,
      total_candidatos: acc.listed,
      total_consultados: acc.inserted + acc.updated,
      total_mudaram: acc.masters_created,
      total_erros: acc.erros,
      detalhes: { dataInicial, dataFinal, sync: syncBody?.summary ?? null, auto_create: autoCreateResult },
      observacao,
    })
    .eq("id", runId);

  return new Response(
    JSON.stringify({
      run_id: runId,
      janela: { dataInicial, dataFinal },
      bruta: {
        listados: acc.listed,
        mapeados: acc.mapped,
        falhas: acc.failed,
        inseridos: acc.inserted,
        atualizados: acc.updated,
      },
      masters: { criadas: acc.masters_created, puladas: acc.masters_skipped },
      erros: acc.erros,
      duracao_ms: Date.now() - startTime,
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
});
