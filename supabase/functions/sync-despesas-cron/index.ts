// =====================================================================
// Edge Function: sync-despesas-cron
// =====================================================================
// Sincroniza o REALIZADO de despesa do MovEstq. Função MAGRA: o trabalho
// pesado (listar→Load→explodir rateio→gravar) vive no erp-proxy
// (/despesas/sync-batch). Aqui só orquestramos as fatias de dias.
//
// FLUXO:
//   1. Valida CRON_SECRET (auth de invocação)
//   2. Lê sync_settings (job_name='sync-despesas') → para se enabled=false
//   3. Pega os próximos N dias PENDENTE/EM_PROGRESSO mais antigos
//      (cursor = desp_dias_capturados; não usa sync_cursors)
//   4. Só dispara sync-batch nos dias dentro da fatia (contígua ou não)
//   5. Chama POST /despesas/sync-batch (X-System-Secret) por subfaixa contígua
//   6. Persiste resultado em sync_runs (job_type='despesas')
//
// FATIA: SLICE_DIAS=2 (com ~28s/dia medido, ~56s < watchdog 80s do proxy)
//
// SECRETS: CRON_SECRET, ERP_PROXY_URL, ERP_PROXY_SYSTEM_SECRET,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (automáticos)
// =====================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const JOB_NAME = "sync-despesas";
const SLICE_DIAS = 2; // dias processados por execução
const PROXY_TIMEOUT_MS = 120_000; // teto da chamada ao proxy (watchdog dele é 80s)

interface SyncBatchSummary {
  dias_solicitados: number;
  dias_processados: number;
  dias_ok: number;
  dias_sem_movimento: number;
  dias_falha_permanente: number;
  dia_falha_auth: string | null;
  docs_entrada_listados: number;
  docs_com_despesa: number;
  rateios_gravados: number;
  elapsed_ms: number;
  parado_por_auth: boolean;
  parado_por_watchdog: boolean;
}

// Agrupa uma lista de datas YMD ordenada em faixas contíguas [inicio,fim].
function agruparContiguos(dias: string[]): Array<{ ini: string; fim: string }> {
  if (dias.length === 0) return [];
  const ord = [...dias].sort();
  const faixas: Array<{ ini: string; fim: string }> = [];
  let ini = ord[0];
  let prev = ord[0];
  const nextDay = (ymd: string) => {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10);
  };
  for (let i = 1; i < ord.length; i++) {
    if (ord[i] === nextDay(prev)) {
      prev = ord[i];
    } else {
      faixas.push({ ini, fim: prev });
      ini = ord[i];
      prev = ord[i];
    }
  }
  faixas.push({ ini, fim: prev });
  return faixas;
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

  // ── 1. Auth de invocação ─────────────────────────────────────────
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

  // ── 2. Kill-switch ───────────────────────────────────────────────
  const { data: settings } = await supabase
    .from("sync_settings")
    .select("enabled, paused_reason")
    .eq("job_name", JOB_NAME)
    .maybeSingle();

  if (settings && settings.enabled === false) {
    await supabase.from("sync_runs").insert({
      triggered_by: safeTrigger,
      job_type: "despesas",
      duracao_ms: Date.now() - startTime,
      observacao: `Pausado: ${settings.paused_reason || "sem motivo"}`,
      finished_at: new Date().toISOString(),
    });
    return new Response(JSON.stringify({ skipped: true, reason: "enabled=false" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── 3. Próximos N dias pendentes (cursor = desp_dias_capturados) ──
  const { data: diasRows, error: errDias } = await supabase
    .from("desp_dias_capturados")
    .select("data_movimento")
    .in("status", ["PENDENTE", "EM_PROGRESSO"])
    .order("data_movimento", { ascending: true })
    .limit(SLICE_DIAS);

  if (errDias) {
    return new Response(JSON.stringify({ error: `Erro lendo dias: ${errDias.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const dias = (diasRows || []).map((r: any) => r.data_movimento as string);

  // ── 4. Abre a run ────────────────────────────────────────────────
  const { data: runRow, error: errRun } = await supabase
    .from("sync_runs")
    .insert({ triggered_by: safeTrigger, job_type: "despesas" })
    .select("id")
    .single();

  if (errRun || !runRow) {
    return new Response(JSON.stringify({ error: "Falha ao criar sync_run", details: errRun }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const runId = runRow.id;

  // Nada pendente → backfill em dia. Fecha run vazia (no-op barato).
  if (dias.length === 0) {
    await supabase
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        duracao_ms: Date.now() - startTime,
        observacao: "Sem dias pendentes — backfill em dia.",
      })
      .eq("id", runId);
    return new Response(JSON.stringify({ run_id: runId, skipped: true, reason: "sem dias pendentes" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

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

  // ── 5. Dispara sync-batch por faixa contígua ─────────────────────
  const faixas = agruparContiguos(dias);
  const acc = {
    dias_ok: 0,
    dias_sem_movimento: 0,
    dias_falha: 0,
    docs_com_despesa: 0,
    rateios_gravados: 0,
    erros: 0,
  };
  const detalhes: any[] = [];
  let observacao: string | null = null;

  try {
    for (const faixa of faixas) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
      let resp: Response;
      try {
        resp = await fetch(`${erpUrl}/despesas/sync-batch`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-System-Secret": systemSecret },
          body: JSON.stringify({ dataInicial: faixa.ini, dataFinal: faixa.fim }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const body = await resp.json().catch(() => null);
      if (!resp.ok || !body?.summary) {
        acc.erros++;
        detalhes.push({ faixa, erro: `HTTP ${resp.status}`, body });
        continue;
      }
      const s = body.summary as SyncBatchSummary;
      acc.dias_ok += s.dias_ok;
      acc.dias_sem_movimento += s.dias_sem_movimento;
      acc.dias_falha += s.dias_falha_permanente + (s.dia_falha_auth ? 1 : 0);
      acc.docs_com_despesa += s.docs_com_despesa;
      acc.rateios_gravados += s.rateios_gravados;
      detalhes.push({ faixa, summary: s });

      // Se o Alvo recusou auth, para a execução inteira (proxy já alertou via email)
      if (s.parado_por_auth) {
        observacao = `Parado por falha de autenticação no Alvo (dia ${s.dia_falha_auth}).`;
        break;
      }
    }
  } catch (err: any) {
    acc.erros++;
    observacao = `Exception: ${err?.message || String(err)}`;
  }

  // ── 6. Fecha a run ───────────────────────────────────────────────
  // Mapeamento pro esquema sync_runs (semântica de despesa):
  //   total_candidatos  = dias da fatia
  //   total_consultados = docs com despesa gravados
  //   total_mudaram     = rateios gravados
  //   total_erros       = erros de faixa/exception
  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startTime,
      total_candidatos: dias.length,
      total_consultados: acc.docs_com_despesa,
      total_mudaram: acc.rateios_gravados,
      total_erros: acc.erros,
      detalhes,
      observacao,
    })
    .eq("id", runId);

  return new Response(
    JSON.stringify({
      run_id: runId,
      dias_processados: dias,
      faixas,
      dias_ok: acc.dias_ok,
      dias_sem_movimento: acc.dias_sem_movimento,
      dias_falha: acc.dias_falha,
      docs_com_despesa: acc.docs_com_despesa,
      rateios_gravados: acc.rateios_gravados,
      erros: acc.erros,
      duracao_ms: Date.now() - startTime,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    },
  );
});
