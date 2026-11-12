// =====================================================================
// Edge Function: sync-nf-saida-cron   (VENDAS · NF de saída)   v1
// PLANO-VENDAS.md §12 (Ajuste A) e §13 — VND-4.
// =====================================================================
// Espelha no Hub as notas que a P&F EMITE no Alvo (NF-e série 1, NFS-e
// série 001; a numeração inclui NF de entrada própria — tipo_nota separa).
//
//   1. LISTA  — notaFiscal/GetListForComponents (Numero DESC, até 300 por
//               página) até a 1ª página com emissão anterior ao corte →
//               RPC nf_saida_registrar_lista (cabeçalho; nova/mudou → pendente;
//               sumiu da faixa → pendente para reconferir).
//   2. DETALHE — notaFiscal/Load (loadChild=All) das pendentes, UMA A UMA
//               (3 em paralelo) → RPC nf_saida_gravar_detalhe (versão nova só
//               se o conteúdo mudou; null = nota não existe mais).
//               Falha → nf_saida_registrar_falha (15 min / 1 h / 6 h / 24 h;
//               estaciona na 5ª).
//
// MODOS (body.modo):
//   "rotina"  (padrão, cron): lista dos últimos 45 dias + detalhe.
//   "lista"   só a lista (backfill: body.desde = 'YYYY-MM-DD').
//   "detalhe" só a fila de detalhe (backfill em lotes).
//   "notas"   notas escolhidas: body.notas = [{modelo, serie, numero}] (≤ 20).
//   "series"  só o número de série impresso (NumSerie/Load) dos controles na fila
//             (VND-8; carga dos existentes em lotes).
// Ajustes opcionais: modelos ['NF-e','NFS-e'], page_size (1–300),
//   pagina_inicial (1–1000), max_paginas (1–20), max_detalhes (0–200),
//   max_series (0–500; padrão 60 na rotina e 300 no modo "series").
// v2 (05/11/2026): pagina_inicial. Uma página de 300 leva ~30 s no Alvo; com o
//   watchdog de 110 s cabem ~3 páginas por execução — a carga histórica
//   continua de onde parou (a resposta traz proxima_pagina por modelo).
//   Lista só começa página nova com 40 s de folga até o watchdog.
// v3 (12/11/2026, VND-8): passo 3 — número de série impresso (NumSerie/Load)
//   dos controles novos, depois do detalhe; tabela nf_saida_serie_cadastro.
//
// ACESSO AO ALVO: erp-proxy /alvo/passthrough com X-System-Secret.
//   Whitelist: notaFiscal/Load e notaFiscal/GetListForComponents
//   (erp-proxy 7dfe972, 05/11/2026); NumSerie/Load (já liberado, VND-8).
// SECRETS: CRON_SECRET, ERP_PROXY_URL, ERP_PROXY_SYSTEM_SECRET,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (todos já existem no projeto)
// Kill-switch: sync_settings.job_name = 'sync-nf-saida' (sem linha = liberado).
// Deploy:  verify_jwt = false (auth real = CRON_SECRET)
// =====================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import {
  Banco,
  Deps,
  FILIAL,
  ItemFila,
  Modelo,
  MODELOS,
  novoResultado,
  Opcoes,
  passoDetalhe,
  passoLista,
  passoNotas,
  passoSeries,
  Passthrough,
  resumo,
} from "./logica.ts";

// Carimbo gravado em sync_runs.observacao: prova qual versão rodou.
const VERSAO = "v3-2026-11-12";
const JOB_NAME = "sync-nf-saida";
const JOB_TYPE = "nf_saida";
const WATCHDOG_MS = 110_000;
const JANELA_DIAS = 45;
const CONCORRENCIA = 3;
const MARGEM_LISTA_MS = 40_000; // não começa página da lista com menos de 40 s de folga

// ── Gateway erp-proxy → /alvo/passthrough (molde do sync-parcelas-pagar) ──
function criarProxy(erpUrl: string, systemSecret: string): Passthrough {
  return async (endpoint, method, payload) => {
    let resp: Response;
    try {
      resp = await fetch(`${erpUrl}/alvo/passthrough`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-System-Secret": systemSecret },
        body: JSON.stringify({ endpoint, method, payload }),
      });
    } catch (e: any) {
      return { ok: false, status: 0, data: null, erro: `fetch ao gateway falhou: ${e?.message || String(e)}` };
    }
    let body: any = null;
    try {
      body = await resp.json();
    } catch {
      // sem corpo JSON
    }
    if (!resp.ok && (body === null || body?.ok === undefined)) {
      const motivo =
        resp.status === 401
          ? "401 — X-System-Secret inválido/ausente no gateway"
          : resp.status === 403
            ? `403 — endpoint fora da whitelist do gateway (${endpoint.split("?")[0]})`
            : `HTTP ${resp.status}`;
      return { ok: false, status: resp.status, data: body, erro: `${motivo}: ${body?.error || ""}`.trim() };
    }
    const alvoStatus = Number(body?.status ?? resp.status);
    if (body?.ok === false || !resp.ok) {
      const motivo = alvoStatus === 417 ? "417 — payload rejeitado pelo Alvo" : `Alvo HTTP ${alvoStatus}`;
      return { ok: false, status: alvoStatus, data: body?.data ?? null, erro: `${motivo}: ${body?.error || ""}`.trim() };
    }
    return { ok: true, status: alvoStatus, data: body?.data ?? null };
  };
}

// ── Banco: só as 3 RPCs (service_role) e leituras da fila ─────────────
function criarBanco(supabase: SupabaseClient): Banco {
  return {
    async registrarLista(linhas) {
      const { data, error } = await supabase.rpc("nf_saida_registrar_lista", { p_linhas: linhas });
      if (error) throw new Error(`nf_saida_registrar_lista: ${error.message}`);
      return data;
    },
    async filaDetalhe(limite) {
      const { data, error } = await supabase
        .from("nf_saida")
        .select("id, modelo, serie, numero_alvo")
        .in("detalhe_status", ["pendente", "erro"])
        .or(`proxima_em.is.null,proxima_em.lte.${new Date().toISOString()}`)
        .order("data_emissao", { ascending: false, nullsFirst: false })
        .order("numero", { ascending: false })
        .limit(limite);
      if (error) throw new Error(`fila de detalhe: ${error.message}`);
      return (data ?? []) as ItemFila[];
    },
    async idDaNota(filial, modelo, serie, numeroAlvo) {
      const { data, error } = await supabase
        .from("nf_saida")
        .select("id")
        .eq("codigo_empresa_filial", filial)
        .eq("modelo", modelo)
        .eq("serie", serie)
        .eq("numero_alvo", numeroAlvo)
        .maybeSingle();
      if (error) throw new Error(`busca da nota: ${error.message}`);
      return data?.id ?? null;
    },
    async gravarDetalhe(id, payload) {
      const { data, error } = await supabase.rpc("nf_saida_gravar_detalhe", { p_id: id, p_payload: payload });
      if (error) throw new Error(`nf_saida_gravar_detalhe: ${error.message}`);
      return data;
    },
    async registrarFalha(id, erro) {
      const { data, error } = await supabase.rpc("nf_saida_registrar_falha", { p_id: id, p_erro: erro });
      if (error) throw new Error(`nf_saida_registrar_falha: ${error.message}`);
      return data;
    },
    // VND-8
    async filaSeries(limite) {
      const { data, error } = await supabase
        .from("v_nf_saida_serie_fila")
        .select("controle")
        .order("ultima_emissao", { ascending: false, nullsFirst: false })
        .order("controle", { ascending: false })
        .limit(limite);
      if (error) throw new Error(`fila de séries: ${error.message}`);
      return (data ?? []).map((l: { controle: number | string }) => Number(l.controle));
    },
    async gravarSerie(controle, payload) {
      const { data, error } = await supabase.rpc("nf_saida_serie_gravar", { p_controle: controle, p_payload: payload });
      if (error) throw new Error(`nf_saida_serie_gravar: ${error.message}`);
      return data;
    },
    async registrarFalhaSerie(controle, erro) {
      const { data, error } = await supabase.rpc("nf_saida_serie_registrar_falha", { p_controle: controle, p_erro: erro });
      if (error) throw new Error(`nf_saida_serie_registrar_falha: ${error.message}`);
      return data;
    },
  };
}

// ── Utilidades ───────────────────────────────────────────────────────
// Brasília sem horário de verão (desde 2019): UTC−3 fixo.
function hojeBrasil(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const inteiro = (v: unknown, padrao: number, min: number, max: number) => {
  const n = typeof v === "number" ? Math.floor(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

// ─────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const t0 = Date.now();

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
      },
    });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ error: "Edge function mal configurada (CRON_SECRET)" }, 500);
  const body = await req.json().catch(() => ({}));
  if (req.headers.get("x-cron-secret") !== expected) {
    return json({ error: "Não autorizado" }, 401);
  }

  const trigger = ["pg_cron", "manual_admin", "test"].includes(body?.triggered_by) ? body.triggered_by : "pg_cron";
  const modo = ["lista", "detalhe", "notas", "series"].includes(body?.modo) ? body.modo : "rotina";

  const reData = /^\d{4}-\d{2}-\d{2}$/;
  const modelos: Modelo[] = Array.isArray(body?.modelos)
    ? (body.modelos as unknown[]).filter((m): m is Modelo => (MODELOS as readonly string[]).includes(String(m)))
    : [...MODELOS];
  const op: Opcoes = {
    modelos: modelos.length ? modelos : [...MODELOS],
    desde: typeof body?.desde === "string" && reData.test(body.desde) ? body.desde : somarDias(hojeBrasil(), -JANELA_DIAS),
    pageSize: inteiro(body?.page_size, 300, 1, 300),
    paginaInicial: inteiro(body?.pagina_inicial, 1, 1, 1000),
    maxPaginas: inteiro(body?.max_paginas, modo === "lista" ? 10 : 3, 1, 20),
    maxDetalhes: inteiro(body?.max_detalhes, modo === "lista" ? 0 : 60, 0, 200),
    maxSeries: inteiro(body?.max_series, modo === "series" ? 300 : modo === "rotina" ? 60 : 0, 0, 500),
    concorrencia: CONCORRENCIA,
    inicio: t0,
    watchdogMs: WATCHDOG_MS,
    margemListaMs: MARGEM_LISTA_MS,
  };
  const notas: Array<{ modelo: string; serie: string; numero: string }> = Array.isArray(body?.notas)
    ? (body.notas as any[])
        .filter((n) => n && (MODELOS as readonly string[]).includes(n.modelo) && typeof n.serie === "string" && n.numero !== undefined)
        .slice(0, 20)
        .map((n) => ({ modelo: String(n.modelo), serie: String(n.serie), numero: String(n.numero) }))
    : [];
  if (modo === "notas" && notas.length === 0) {
    return json({ error: "modo notas exige body.notas = [{modelo, serie, numero}] (até 20)" }, 400);
  }

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
      observacao: `[${modo}] Pausado: ${settings.paused_reason || "sem motivo"} · edge ${VERSAO}`,
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
  const secret = Deno.env.get("ERP_PROXY_SYSTEM_SECRET");
  if (!erpUrl || !secret) {
    await supabase
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        duracao_ms: Date.now() - t0,
        total_erros: 1,
        observacao: `Sem ERP_PROXY_URL/ERP_PROXY_SYSTEM_SECRET · edge ${VERSAO}`,
      })
      .eq("id", run.id);
    return json({ error: "Edge function mal configurada (proxy)" }, 500);
  }

  const deps: Deps = { proxy: criarProxy(erpUrl, secret), banco: criarBanco(supabase), agora: () => Date.now() };
  const res = novoResultado();
  let excecao: string | null = null;

  try {
    if (modo === "notas") {
      await passoNotas(deps, op, notas, res);
    } else if (modo === "series") {
      await passoSeries(deps, op, res);
    } else {
      if (modo !== "detalhe") await passoLista(deps, op, res);
      if (modo !== "lista" && !res.parado_por_watchdog) await passoDetalhe(deps, op, res);
      // VND-8: depois do detalhe (as séries das notas recém-lidas já estão na fila)
      if (modo === "rotina" && !res.parado_por_watchdog) await passoSeries(deps, op, res);
    }
  } catch (e: any) {
    res.erros++;
    excecao = `Exception: ${e?.message || String(e)}`;
    res.detalhes.push({ etapa: "exception", erro: excecao });
  }

  const [{ count: fingerprint }, { count: pendentes }, { count: estacionadas }, { count: seriesNaFila }] = await Promise.all([
    supabase.from("compras_pedidos").select("id", { count: "exact", head: true }),
    supabase.from("nf_saida").select("id", { count: "exact", head: true }).in("detalhe_status", ["pendente", "erro"]),
    supabase.from("nf_saida").select("id", { count: "exact", head: true }).eq("detalhe_status", "estacionado"),
    supabase.from("v_nf_saida_serie_fila").select("controle", { count: "exact", head: true }),
  ]);

  const observacao =
    excecao ??
    resumo(modo, op, res, VERSAO, [
      `fila ${pendentes ?? "?"}`,
      estacionadas ? `ESTACIONADAS ${estacionadas}` : "",
      `séries na fila ${seriesNaFila ?? "?"}`,
      `fingerprint pedidos=${fingerprint ?? "?"}`,
    ]);

  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - t0,
      total_candidatos: res.linhas_lidas,
      total_consultados: res.paginas + res.detalhes_tentados + res.series_tentadas,
      total_mudaram: res.novas + res.mudaram + res.nova_versao + res.ausentes + res.series_gravadas + res.series_ausentes,
      total_erros: res.erros,
      detalhes: { filial: FILIAL, opcoes: { ...op, inicio: undefined }, notas: res.notas, erros: res.detalhes },
      observacao,
    })
    .eq("id", run.id);

  return json({ ok: res.erros === 0, run_id: run.id, modo, ...res, detalhes: undefined, observacao });
});
