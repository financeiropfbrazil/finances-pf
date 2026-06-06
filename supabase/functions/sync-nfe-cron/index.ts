// =====================================================================
// Edge Function: sync-nfe-cron
// =====================================================================
// Função MAGRA (molde da sync-despesas-cron). O trabalho pesado (consultar
// SEFAZ, parsear, cadastrar) vive no erp-proxy (/nfe/sync-batch). Aqui só:
//   1. Valida CRON_SECRET (header x-cron-secret OU body.cron_secret)
//   2. Kill-switch: lê sync_settings (job_name='sync-nfe') → para se enabled=false
//   3. Abre run em sync_runs (job_type='nfe')
//   4. Chama POST /nfe/sync-batch (X-System-Secret) no proxy
//   5. Fecha a run com o summary
//
// Mapeamento sync_runs (semântica NF-e):
//   total_candidatos  = chaves solicitadas (da fila)
//   total_consultados = chaves consultadas na SEFAZ (cadastradas+canceladas+nao_loc+erros)
//   total_mudaram     = notas cadastradas
//   total_erros       = erros
//   detalhes/observacao = canceladas, não-localizadas, consumo, etc.
//
// SECRETS: CRON_SECRET, ERP_PROXY_URL, ERP_PROXY_SYSTEM_SECRET,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const JOB_NAME = "sync-nfe";
const PROXY_TIMEOUT_MS = 150_000; // > watchdog do proxy (80s) + margem

interface NfeSyncSummary {
  chaves_solicitadas: number;
  cadastradas: number;
  canceladas: number;
  nao_localizadas: number;
  duplicadas: number;
  erros: number;
  parado_por_consumo: boolean;
  parado_por_watchdog: boolean;
  elapsed_ms: number;
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
      job_type: "nfe",
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
    .insert({ triggered_by: safeTrigger, job_type: "nfe" })
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
    return new Response(JSON.stringify({ error: "Edge mal configurada" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 4. Chama o proxy /nfe/sync-batch ──
  let summary: NfeSyncSummary | null = null;
  let observacao: string | null = null;
  let erros = 0;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(`${erpUrl}/nfe/sync-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-System-Secret": systemSecret },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const body = await resp.json().catch(() => null);
    if (!resp.ok || !body?.summary) {
      erros = 1;
      observacao = `Proxy retornou HTTP ${resp.status}`;
    } else {
      summary = body.summary as NfeSyncSummary;
      // monta observação legível
      const partes: string[] = [];
      if (summary.cadastradas) partes.push(`${summary.cadastradas} cadastrada(s)`);
      if (summary.canceladas) partes.push(`${summary.canceladas} cancelada(s)`);
      if (summary.nao_localizadas) partes.push(`${summary.nao_localizadas} não localizada(s)`);
      if (summary.duplicadas) partes.push(`${summary.duplicadas} duplicada(s)`);
      if (summary.parado_por_consumo) partes.push("PAROU por consumo indevido (limite SEFAZ)");
      if (summary.parado_por_watchdog) partes.push("parou por watchdog");
      observacao = partes.length ? partes.join(", ") : "Nada a processar (fila vazia).";
      erros = summary.erros || 0;
    }
  } catch (err: any) {
    erros = 1;
    observacao = `Exception: ${err?.message || String(err)}`;
  }

  // ── 5. Fecha a run ──
  const consultados = summary
    ? summary.cadastradas + summary.canceladas + summary.nao_localizadas + summary.duplicadas + summary.erros
    : 0;

  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startTime,
      total_candidatos: summary?.chaves_solicitadas || 0,
      total_consultados: consultados,
      total_mudaram: summary?.cadastradas || 0,
      total_erros: erros,
      detalhes: summary ? [summary] : [],
      observacao,
    })
    .eq("id", runId);

  return new Response(JSON.stringify({ run_id: runId, summary, observacao }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
