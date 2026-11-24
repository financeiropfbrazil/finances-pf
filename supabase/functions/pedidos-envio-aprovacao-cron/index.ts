// =====================================================================
// Edge Function: pedidos-envio-aprovacao-cron   (LP-ENV B · PLANO-PEDIDOS)  v1
// =====================================================================
// O Alvo não guarda a DATA em que o pedido foi enviado para aprovação: só o
// campo personalizado "Enviou Aprovação" (UserEnviouAprovacao = Sim/Não). O
// Hub registra o momento em que vê o envio (compras_pedidos.enviado_aprovacao_em,
// LP-ENV A). A rotina grande de compras (sync-compras-status-cron) relê cada
// pedido a cada 3–4 h; esta função relê, de hora em hora, SÓ os pedidos em
// aberto dos últimos 90 dias ainda não enviados — precisão de até 1 hora.
//
// O que grava: apenas enviado_aprovacao_em = agora e enviado_aprovacao_origem =
// 'leitura', e só se a data ainda estiver vazia. Status, aprovação e próximo
// aprovador continuam sendo gravados pela rotina de compras (que também mantém
// a auditoria de mudanças e os e-mails) — esta função não interfere nisso.
//
// Enviado = UserEnviouAprovacao 'Sim' OU comando UserEnviarAprovacao 'Sim' OU
// StatusAprovacao diferente de 'Nenhum' OU Aprovado Total/Parcial (mesma regra
// do gatilho trg_compras_pedidos_envio_aprovacao e de situacaoParaAprovacao).
//
// Auth: x-cron-secret = CRON_SECRET (chamada por call_pedidos_envio_aprovacao_cron).
// Kill-switch: sync_settings.job_name = 'pedidos-envio-aprovacao' com enabled=false.
// Log: sync_runs.job_type = 'envio_aprovacao'.
// SECRETS: CRON_SECRET, ERP_PROXY_URL, ERP_PROXY_SYSTEM_SECRET, SUPABASE_URL,
//          SUPABASE_SERVICE_ROLE_KEY. Deploy: verify_jwt = false.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const VERSAO = "v1-2026-11-24";
const JOB_NAME = "pedidos-envio-aprovacao";
const JOB_TYPE = "envio_aprovacao";
const FILIAL = "1.01";
const JANELA_DIAS = 90;
const LIMITE = 150;
const CONCORRENCIA = 4;
const WATCHDOG_MS = 110_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Mesma regra do gatilho do banco e de situacaoParaAprovacao (frontend). */
export function pedidoEnviado(ped: any): boolean {
  const uf = ped?.PedCompUserFieldsObject ?? {};
  const statusAprov = String(ped?.StatusAprovacao ?? "").trim();
  return (
    uf.UserEnviouAprovacao === "Sim" ||
    uf.UserEnviarAprovacao === "Sim" ||
    (statusAprov !== "" && statusAprov !== "Nenhum") ||
    ped?.Aprovado === "Total" ||
    ped?.Aprovado === "Parcial"
  );
}

Deno.serve(async (req: Request) => {
  const t0 = Date.now();

  const esperado = Deno.env.get("CRON_SECRET");
  if (!esperado) return json({ error: "Edge function mal configurada (CRON_SECRET)" }, 500);
  if (req.headers.get("x-cron-secret") !== esperado) return json({ error: "Não autorizado" }, 401);
  const body = await req.json().catch(() => ({}));
  const trigger = ["pg_cron", "manual_admin", "test"].includes(body?.triggered_by) ? body.triggered_by : "pg_cron";

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: settings } = await supabase
    .from("sync_settings")
    .select("enabled, paused_reason")
    .eq("job_name", JOB_NAME)
    .maybeSingle();
  if (settings && settings.enabled === false) {
    await supabase.from("sync_runs").insert({
      triggered_by: trigger,
      job_type: JOB_TYPE,
      total_candidatos: 0,
      total_consultados: 0,
      total_mudaram: 0,
      total_erros: 0,
      duracao_ms: Date.now() - t0,
      observacao: `[envio] Pausado: ${settings.paused_reason || "sem motivo"} · edge ${VERSAO}`,
      finished_at: new Date().toISOString(),
    });
    return json({ skipped: true, reason: "sync_settings.enabled = false" });
  }

  const { data: run, error: errRun } = await supabase
    .from("sync_runs")
    .insert({ triggered_by: trigger, job_type: JOB_TYPE })
    .select("id")
    .single();
  if (errRun || !run) return json({ error: "Falha ao iniciar sync_run", details: errRun }, 500);

  const erpUrl = Deno.env.get("ERP_PROXY_URL");
  const systemSecret = Deno.env.get("ERP_PROXY_SYSTEM_SECRET");
  const detalhes: Array<Record<string, unknown>> = [];
  let candidatos = 0;
  let lidos = 0;
  let enviados = 0;
  let erros = 0;
  let paradoWatchdog = false;

  try {
    if (!erpUrl || !systemSecret) throw new Error("Sem ERP_PROXY_URL/ERP_PROXY_SYSTEM_SECRET");

    const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString().slice(0, 10);
    const { data: peds, error } = await supabase
      .from("compras_pedidos")
      .select("id, numero")
      .eq("codigo_empresa_filial", FILIAL)
      .is("enviado_aprovacao_em", null)
      .is("enviado_aprovacao_origem", null)
      .in("status", ["Aberto", "Pendente", "Reavaliar"])
      .gte("data_pedido", desde)
      .not("numero", "like", "RASCUNHO%")
      .or("status_local.is.null,status_local.neq.excluido_alvo")
      .order("data_pedido", { ascending: false })
      .limit(LIMITE);
    if (error) throw new Error(`seleção: ${error.message}`);

    const fila = (peds ?? []) as Array<{ id: string; numero: string }>;
    candidatos = fila.length;
    let proximo = 0;

    const processar = async (ped: { id: string; numero: string }) => {
      let resp: Response;
      try {
        resp = await fetch(`${erpUrl}/ped-comp/${encodeURIComponent(FILIAL)}/${encodeURIComponent(ped.numero)}`, {
          method: "GET",
          headers: { "X-System-Secret": systemSecret!, "Content-Type": "application/json" },
        });
      } catch (e: any) {
        erros++;
        if (detalhes.length < 20) detalhes.push({ numero: ped.numero, erro: `fetch: ${e?.message || String(e)}` });
        return;
      }
      const alvo: any = await resp.json().catch(() => null);
      if (!resp.ok || !alvo || typeof alvo !== "object" || !alvo.Numero) {
        // 404 (pedido excluído no Alvo) e payload vazio: a rotina de compras trata; aqui só conta.
        erros++;
        if (detalhes.length < 20) detalhes.push({ numero: ped.numero, erro: `HTTP ${resp.status}${alvo?.Numero ? "" : " sem Numero"}` });
        return;
      }
      lidos++;
      if (!pedidoEnviado(alvo)) return;

      const { data: upd, error: errUp } = await supabase
        .from("compras_pedidos")
        .update({ enviado_aprovacao_em: new Date().toISOString(), enviado_aprovacao_origem: "leitura" })
        .eq("id", ped.id)
        .is("enviado_aprovacao_em", null)
        .select("id");
      if (errUp) {
        erros++;
        if (detalhes.length < 20) detalhes.push({ numero: ped.numero, erro: `update: ${errUp.message}` });
        return;
      }
      if ((upd?.length ?? 0) > 0) {
        enviados++;
        if (detalhes.length < 40) detalhes.push({ numero: ped.numero, enviado: true, status_aprovacao: alvo.StatusAprovacao ?? null });
      }
    };

    const trabalhador = async () => {
      while (proximo < fila.length) {
        if (Date.now() - t0 > WATCHDOG_MS) {
          paradoWatchdog = true;
          return;
        }
        await processar(fila[proximo++]);
      }
    };
    await Promise.all(Array.from({ length: CONCORRENCIA }, () => trabalhador()));
  } catch (e: any) {
    erros++;
    detalhes.push({ etapa: "exception", erro: e?.message || String(e) });
  }

  const observacao = [
    "[envio]",
    `candidatos ${candidatos}`,
    `lidos ${lidos}`,
    `enviados ${enviados}`,
    erros ? `erros ${erros}` : null,
    paradoWatchdog ? "PARADO PELO WATCHDOG" : null,
    `edge ${VERSAO}`,
  ]
    .filter(Boolean)
    .join(" · ");

  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - t0,
      total_candidatos: candidatos,
      total_consultados: lidos,
      total_mudaram: enviados,
      total_erros: erros,
      detalhes,
      observacao,
    })
    .eq("id", run.id);

  return json({ ok: erros === 0, run_id: run.id, candidatos, lidos, enviados, erros, observacao });
});
