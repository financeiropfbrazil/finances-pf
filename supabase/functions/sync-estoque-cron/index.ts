// supabase/functions/sync-estoque-cron/index.ts
// =============================================================================
// Sincroniza o ESPELHO DE ESTOQUE do Alvo (movimentos) numa janela móvel.
// Molde: sync-intercompany-cron (mesma auth por x-cron-secret, mesmo kill-switch
// em sync_settings, mesma escrita em sync_runs, mesma chamada ao erp-proxy por
// X-System-Secret).
//
// Fases:
//   1. /estoque/sync-batch para a janela (padrão: hoje e os 2 dias anteriores).
//      O proxy tem watchdog de 80 s e devolve parado_por_watchdog; esta função
//      chama de novo até terminar ou estourar o orçamento de tempo.
//   2. (opcional, body.incluir_series = true) /estoque/num-serie-sync, também em
//      laço, retomando por resumo.proximo_produto.
//
// Body aceito (tudo opcional):
//   { "triggered_by": "pg_cron" | "manual_admin" | "test",
//     "dias": 3,                       // tamanho da janela para trás
//     "data_inicial": "2026-09-01",    // sobrepõe "dias"
//     "data_final":   "2026-09-06",
//     "incluir_series": false }
// =============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const JOB_NAME = "sync-estoque";
const JOB_TYPE = "estoque";
const JANELA_DIAS_PADRAO = 3; // hoje + 2 dias para trás (pega lançamento retroativo)
const PROXY_TIMEOUT_MS = 120_000; // o watchdog do proxy corta em 80 s
const ORCAMENTO_MS = 240_000; // teto desta função para os laços
const MAX_CHAMADAS = 12; // trava de segurança por fase

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function diasAtras(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return ymd(d);
}
function validaYMD(s: unknown): string | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return isNaN(d.getTime()) || ymd(d) !== s ? null : s;
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
  const bodyJson = await req.json().catch(() => ({}) as any);
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

  // ── 4. Janela ──
  const dias =
    Number.isInteger(bodyJson?.dias) && bodyJson.dias > 0 && bodyJson.dias <= 60 ? bodyJson.dias : JANELA_DIAS_PADRAO;
  const dataFinal = validaYMD(bodyJson?.data_final) ?? ymd(new Date());
  const dataInicial = validaYMD(bodyJson?.data_inicial) ?? diasAtras(dias - 1);
  const incluirSeries = bodyJson?.incluir_series === true;

  async function postProxy(rota: string, corpo: unknown): Promise<{ ok: boolean; status: number; json: any }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
    try {
      const resp = await fetch(`${erpUrl}${rota}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-System-Secret": systemSecret },
        body: JSON.stringify(corpo),
        signal: controller.signal,
      });
      const json = await resp.json().catch(() => null);
      return { ok: resp.ok, status: resp.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  const acc = {
    chamadas: 0,
    dias_ok: 0,
    dias_sem_movimento: 0,
    dias_falha: 0,
    chaves_listadas: 0,
    chaves_importadas: 0,
    chaves_falhadas: 0,
    series_gravadas: 0,
    produtos_series: 0,
    erros: 0,
    auth_falhou: false,
    incompleto: false,
  };
  let observacao: string | null = null;
  const detalhes: Record<string, unknown> = { dataInicial, dataFinal, incluirSeries };

  try {
    // ── 5. Fase 1: movimentos, com retomada do watchdog ──
    let restaInicial = dataInicial;
    for (let i = 0; i < MAX_CHAMADAS; i++) {
      if (Date.now() - startTime > ORCAMENTO_MS) {
        acc.incompleto = true;
        break;
      }
      acc.chamadas++;

      const { ok, status, json } = await postProxy("/estoque/sync-batch", {
        dataInicial: restaInicial,
        dataFinal,
      });

      if (!ok || !json?.summary) {
        acc.erros++;
        observacao = `sync-batch falhou: HTTP ${status} ${json?.error ? "— " + String(json.error).slice(0, 120) : ""}`;
        break;
      }

      const s = json.summary;
      acc.dias_ok += s.dias_ok ?? 0;
      acc.dias_sem_movimento += s.dias_sem_movimento ?? 0;
      acc.dias_falha += s.dias_falha_permanente ?? 0;
      acc.chaves_listadas += s.chaves_listadas ?? 0;
      acc.chaves_importadas += s.chaves_importadas ?? 0;
      acc.chaves_falhadas += s.chaves_falhadas ?? 0;

      if (s.parado_por_auth) {
        acc.auth_falhou = true;
        acc.erros++;
        observacao = `Senha do Alvo rejeitada no dia ${s.dia_falha_auth}. Atualizar ALVO_PASSWORD no Render.`;
        break;
      }
      if (!s.parado_por_watchdog) break;

      // retoma no primeiro dia ainda pendente da janela
      const { data: pend } = await supabase
        .from("stock_dias_capturados")
        .select("data_movimento")
        .gte("data_movimento", dataInicial)
        .lte("data_movimento", dataFinal)
        .in("status", ["PENDENTE", "EM_PROGRESSO"])
        .order("data_movimento", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (!pend?.data_movimento || (pend.data_movimento === restaInicial && acc.chamadas > 1)) {
        acc.incompleto = true;
        break;
      }
      restaInicial = pend.data_movimento;
    }

    // ── 6. Fase 2 (opcional): cadastro de séries ──
    if (incluirSeries && !acc.auth_falhou) {
      let desde: string | undefined = undefined;
      for (let i = 0; i < MAX_CHAMADAS; i++) {
        if (Date.now() - startTime > ORCAMENTO_MS) {
          acc.incompleto = true;
          break;
        }
        const { ok, status, json } = await postProxy("/estoque/num-serie-sync", desde ? { desde } : {});
        if (!ok || !json?.resumo) {
          acc.erros++;
          observacao = (observacao ? observacao + " | " : "") + `num-serie-sync falhou: HTTP ${status}`;
          break;
        }
        acc.series_gravadas += json.resumo.series_gravadas ?? 0;
        acc.produtos_series += json.resumo.produtos_processados ?? 0;
        if (!json.resumo.parado_por_watchdog || !json.resumo.proximo_produto) break;
        desde = json.resumo.proximo_produto;
      }
      detalhes.series = { gravadas: acc.series_gravadas, produtos: acc.produtos_series };
    }

    if (!observacao) {
      observacao =
        `Janela ${dataInicial}..${dataFinal}: ${acc.dias_ok} dia(s) OK, ` +
        `${acc.dias_sem_movimento} sem movimento, ${acc.chaves_importadas}/${acc.chaves_listadas} documentos importados` +
        (acc.dias_falha > 0 ? `, ${acc.dias_falha} dia(s) com falha` : "") +
        (incluirSeries ? `, ${acc.series_gravadas} séries em ${acc.produtos_series} produtos` : "") +
        (acc.incompleto ? " — INCOMPLETO (orçamento de tempo); próxima execução continua" : "");
    }
  } catch (err: any) {
    acc.erros++;
    observacao = `Exception: ${err?.message || String(err)}`;
  }

  // ── 7. Fecha a run ──
  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startTime,
      total_candidatos: acc.chaves_listadas,
      total_consultados: acc.chaves_importadas,
      total_mudaram: acc.dias_ok,
      total_erros: acc.erros,
      detalhes: { ...detalhes, acc },
      observacao,
    })
    .eq("id", runId);

  return new Response(
    JSON.stringify({
      run_id: runId,
      janela: { dataInicial, dataFinal },
      movimentos: {
        chamadas: acc.chamadas,
        dias_ok: acc.dias_ok,
        dias_sem_movimento: acc.dias_sem_movimento,
        dias_falha: acc.dias_falha,
        documentos_listados: acc.chaves_listadas,
        documentos_importados: acc.chaves_importadas,
        documentos_falhados: acc.chaves_falhadas,
      },
      series: incluirSeries ? { gravadas: acc.series_gravadas, produtos: acc.produtos_series } : null,
      erros: acc.erros,
      incompleto: acc.incompleto,
      observacao,
      duracao_ms: Date.now() - startTime,
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
  );
});
