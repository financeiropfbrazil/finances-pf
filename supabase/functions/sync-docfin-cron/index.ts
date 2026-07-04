// =====================================================================
// Edge Function: sync-docfin-cron
// =====================================================================
// Sincroniza o REALIZADO de despesa NATIVA do DocFin (folha, provisões
// capturáveis, impostos, cartão, RDESP, contratos) — o que NÃO passa
// pelo MovEstq. Função MAGRA: o trabalho pesado (listar→Load→explodir
// rateio→gravar, com offset+watchdog) vive no erp-proxy
// (/docfin-despesas/sync-batch). Aqui só orquestramos as competências.
//
// DIFERENÇA vs sync-despesas-cron (MovEstq):
//   • MovEstq fatia por DIA (unidade pequena) → processa N dias contíguos.
//   • DocFin fatia por COMPETÊNCIA (mês) → processa 1 competência por rodada;
//     o fatiamento INTERNO do mês é feito pelo offset no proxy (motor v2).
//
// FLUXO:
//   1. Valida CRON_SECRET (auth de invocação)
//   2. Lê sync_settings (job_name='sync-docfin-despesas') → para se enabled=false
//   3. REABRE A JANELA ROLANTE: garante que os 3 meses recentes
//      (atual + 2 anteriores) estejam PENDENTE — cria a linha do mês novo
//      se não existir, e reabre os que já estavam OK (idempotente; o motor
//      é espelho por chave, reprocessar não duplica).
//   4. Seleciona 1 competência elegível por prioridade:
//        (a) EM_PROGRESSO mais antiga  (continuar offset pendente)
//        (b) PENDENTE mais recente     (janela rolante atual)
//        (c) PENDENTE mais antiga      (backfill, se reaberto manualmente)
//   5. Chama POST /docfin-despesas/sync-batch (X-System-Secret) c/ a competência
//   6. Persiste resultado em sync_runs (job_type='docfin_despesas')
//
// SECRETS: CRON_SECRET, ERP_PROXY_URL, ERP_PROXY_SYSTEM_SECRET,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (automáticos)
// =====================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const JOB_NAME = "sync-docfin-despesas";
const JOB_TYPE = "docfin_despesas";
const JANELA_MESES = 3; // janela rolante: atual + 2 anteriores
const PROXY_TIMEOUT_MS = 120_000; // teto da chamada ao proxy (watchdog dele é 80s)

interface DocFinSyncSummary {
  competencias_solicitadas: number;
  competencias_processadas: number;
  competencias_ok: number;
  competencias_sem_movimento: number;
  competencias_falha: number;
  competencia_falha_auth: string | null;
  faturas_agregadoras: number;
  docs_listados: number;
  docs_descartados_origem: number;
  docs_descartados_especie: number;
  docs_descartados_fatura: number;
  docs_com_despesa: number;
  rateios_gravados: number;
  elapsed_ms: number;
  parado_por_auth: boolean;
  parado_por_watchdog: boolean;
}

// Retorna 'YYYY-MM-01' (dia 1, PK do cursor) de hoje menos N meses, em UTC.
function competenciaDia1(mesesAtras: number): string {
  const now = new Date();
  // Âncora no dia 1 do mês atual (UTC) e recua N meses.
  const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - mesesAtras, 1));
  return dt.toISOString().slice(0, 10);
}

// 'YYYY-MM-01' → 'YYYY-MM' (formato que o proxy espera no body).
function dia1ToCompetencia(dia1: string): string {
  return dia1.slice(0, 7);
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

  // ── 3. Reabre a janela rolante (atual + 2 anteriores) ────────────
  // Estratégia (a): cada mês da janela é reprocessado ~1x/DIA.
  // Reabre uma competência (OK/SEM_MOVIMENTO → PENDENTE) SOMENTE se ela ainda
  // não foi tocada HOJE (updated_at < início de hoje, UTC). Assim, depois de
  // processada no dia, ela fica OK e não é reaberta de novo até amanhã — o que
  // evita o loop "reabre→processa→reabre" no mês mais recente.
  // NÃO reabre CONGELADO (backfill controlado) nem EM_PROGRESSO (preserva offset)
  // nem FALHA_AUTH (precisa de intervenção). Idempotente.
  const janela: string[] = [];
  for (let i = 0; i < JANELA_MESES; i++) janela.push(competenciaDia1(i));

  // Início de hoje em UTC ('YYYY-MM-DDT00:00:00.000Z') para comparar com updated_at.
  const hojeInicioUTC = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";

  const reaberturas: string[] = [];
  for (const dia1 of janela) {
    const { data: existente } = await supabase
      .from("desp_docfin_competencias")
      .select("competencia, status, updated_at")
      .eq("competencia", dia1)
      .maybeSingle();

    if (!existente) {
      // Mês novo: cria PENDENTE.
      await supabase.from("desp_docfin_competencias").insert({
        competencia: dia1, status: "PENDENTE", offset_processado: 0, tentativas: 0,
      });
      reaberturas.push(`${dia1}:novo`);
    } else if (existente.status === "OK" || existente.status === "SEM_MOVIMENTO") {
      // Só reabre se NÃO foi processada hoje (evita loop no mês recente).
      const tocadaHoje = existente.updated_at && existente.updated_at >= hojeInicioUTC;
      if (!tocadaHoje) {
        await supabase.from("desp_docfin_competencias").update({
          status: "PENDENTE", offset_processado: 0, updated_at: new Date().toISOString(),
        }).eq("competencia", dia1);
        reaberturas.push(`${dia1}:reaberto`);
      }
      // Já processada hoje → deixa OK (será reaberta amanhã).
    }
    // CONGELADO / EM_PROGRESSO / FALHA_* → não mexe.
  }

  // ── 4. Seleciona 1 competência elegível ──────────────────────────
  // Prioridade:
  //   (a) EM_PROGRESSO mais antiga  → continuar offset pendente
  //   (b) PENDENTE mais ANTIGA      → varre a janela de trás pra frente
  //                                   (abril→maio→junho); sem prender no recente.
  let competenciaAlvo: string | null = null;
  let motivoSelecao = "";

  const { data: emProgresso } = await supabase
    .from("desp_docfin_competencias")
    .select("competencia")
    .eq("status", "EM_PROGRESSO")
    .order("competencia", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (emProgresso) {
    competenciaAlvo = emProgresso.competencia;
    motivoSelecao = "EM_PROGRESSO (continuar offset)";
  } else {
    // Não há offset pendente. Pega PENDENTE mais ANTIGA (varre a janela em ordem).
    const { data: pendente } = await supabase
      .from("desp_docfin_competencias")
      .select("competencia")
      .eq("status", "PENDENTE")
      .order("competencia", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (pendente) {
      competenciaAlvo = pendente.competencia;
      motivoSelecao = "PENDENTE mais antiga";
    }
  }

  // ── 5. Abre a run ────────────────────────────────────────────────
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

  // Nada elegível → janela em dia e sem backfill. Fecha run vazia (no-op barato).
  if (!competenciaAlvo) {
    await supabase
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        duracao_ms: Date.now() - startTime,
        observacao: `Sem competência elegível. Reaberturas: ${reaberturas.join(", ") || "nenhuma"}.`,
        detalhes: { reaberturas },
      })
      .eq("id", runId);
    return new Response(
      JSON.stringify({ run_id: runId, skipped: true, reason: "sem competência elegível", reaberturas }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
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

  // ── 6. Dispara sync-batch para a competência selecionada ─────────
  const competenciaStr = dia1ToCompetencia(competenciaAlvo); // 'YYYY-MM'
  const acc = {
    competencias_ok: 0,
    competencias_sem_movimento: 0,
    competencias_falha: 0,
    docs_com_despesa: 0,
    rateios_gravados: 0,
    erros: 0,
  };
  let observacao: string | null = null;
  let summary: DocFinSyncSummary | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(`${erpUrl}/docfin-despesas/sync-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-System-Secret": systemSecret },
        body: JSON.stringify({ competencia: competenciaStr }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const body = await resp.json().catch(() => null);
    if (!resp.ok || !body?.summary) {
      acc.erros++;
      observacao = `HTTP ${resp.status} ao processar ${competenciaStr}`;
    } else {
      summary = body.summary as DocFinSyncSummary;
      acc.competencias_ok += summary.competencias_ok;
      acc.competencias_sem_movimento += summary.competencias_sem_movimento;
      acc.competencias_falha += summary.competencias_falha + (summary.competencia_falha_auth ? 1 : 0);
      acc.docs_com_despesa += summary.docs_com_despesa;
      acc.rateios_gravados += summary.rateios_gravados;

      if (summary.parado_por_auth) {
        observacao = `Parado por falha de autenticação no Alvo (competência ${summary.competencia_falha_auth}).`;
      } else if (summary.parado_por_watchdog) {
        observacao = `Competência ${competenciaStr} pausada por watchdog (offset salvo) — retoma na próxima rodada.`;
      } else {
        observacao = `Competência ${competenciaStr} concluída (${motivoSelecao}).`;
      }
    }
  } catch (err: any) {
    acc.erros++;
    observacao = `Exception: ${err?.message || String(err)}`;
  }

  // ── 7. Fecha a run ───────────────────────────────────────────────
  // Mapeamento pro esquema sync_runs (semântica de despesa DocFin):
  //   total_candidatos  = 1 (competência da rodada)
  //   total_consultados = docs com despesa gravados
  //   total_mudaram     = rateios gravados
  //   total_erros       = erros/exception
  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startTime,
      total_candidatos: 1,
      total_consultados: acc.docs_com_despesa,
      total_mudaram: acc.rateios_gravados,
      total_erros: acc.erros,
      detalhes: { competencia: competenciaStr, motivo: motivoSelecao, reaberturas, summary },
      observacao,
    })
    .eq("id", runId);

  return new Response(
    JSON.stringify({
      run_id: runId,
      competencia: competenciaStr,
      motivo: motivoSelecao,
      reaberturas,
      competencias_ok: acc.competencias_ok,
      competencias_sem_movimento: acc.competencias_sem_movimento,
      competencias_falha: acc.competencias_falha,
      docs_com_despesa: acc.docs_com_despesa,
      rateios_gravados: acc.rateios_gravados,
      parado_por_watchdog: summary?.parado_por_watchdog ?? false,
      parado_por_auth: summary?.parado_por_auth ?? false,
      erros: acc.erros,
      duracao_ms: Date.now() - startTime,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    },
  );
});