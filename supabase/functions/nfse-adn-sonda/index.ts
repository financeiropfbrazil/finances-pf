// =====================================================================
// nfse-adn-sonda — NFSE-0.3 (PLANO-NFSE.md, desenho em docs/nfse/SONDA-ADN.md)
//
// Lê do ADN (Ambiente de Dados Nacional da NFS-e) os documentos em que a P&F
// aparece, pela rota /nfse-adn do erp-proxy (que faz o mTLS com o certificado),
// e grava em nfse_adn_doc. Disparo manual ou pelo pg_cron (NFSE-1.5: call_nfse_adn_cron, triggered_by "pg_cron").
//
// POST, header x-cron-secret (= CRON_SECRET), corpo JSON:
//   { "modo": "teste",   "nsu": 1, "lote": true }      → 1 chamada a /nfse-adn/teste; NÃO grava
//                                                         documento; guarda o formato em sync_runs.detalhes
//   { "modo": "drenar",  "nsu_inicial": 0, "max_lotes": 30 }
//                                                       → lê lotes a partir do NSU e grava em nfse_adn_doc
//     nsu_inicial: opcional; padrão = maior NSU já gravado, ou 0 com a tabela vazia.
//     Reexecutável: continua de onde parou. Para no 1º erro (429, rejeição, gravação), sem insistir.
//   "triggered_by": "manual_admin" (padrão), "pg_cron" (NFSE-1.4) ou "test" — os valores do CHECK de sync_runs.
//
// Cada execução abre e fecha uma linha em sync_runs (job_type 'nfse_adn', exige NFSE-0.3-sync-runs-aplicar.sql)
// com o carimbo "edge nfse-adn-sonda <VERSAO>" na observação.
// Kill-switch opcional: sync_settings.job_name = 'nfse-adn-sonda' com enabled = false.
//
// Chamada manual sem o segredo sair do banco (mesmo segredo que o job 34 usa):
//   select net.http_post(
//     url := 'https://hbtggrbauguukewiknew.supabase.co/functions/v1/nfse-adn-sonda',
//     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret',
//                  (select decrypted_secret from vault.decrypted_secrets where name = 'sync_compras_cron_secret')),
//     body := '{"modo":"teste","triggered_by":"manual_admin"}'::jsonb,
//     timeout_milliseconds := 150000);
//
// Deploy: verify_jwt = false (auth real = CRON_SECRET), declarado no supabase/config.toml.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { drenar, interpretarLote, lerSemantica, PARADAS_COM_ERRO, VERSAO } from "./logica.ts";

const JOB_NAME = "nfse-adn-sonda";
const JOB_TYPE = "nfse_adn";
const PRAZO_MS = 100_000;          // não começa lote novo depois disso (limite da Edge: 150 s)
const TIMEOUT_GATEWAY_MS = 35_000; // a rota do erp-proxy desiste do ADN em 30 s
const PAUSA_MS = 1_500;            // entre lotes — gentileza com o ADN
const MAX_LOTES_PADRAO = 30;
const MAX_LOTES_TETO = 200;
const EXECUCAO_ABERTA_MS = 150_000; // execução sem finished_at mais nova que isso = outra rodando

async function chamarGateway(url: string, secret: string): Promise<{ http: number; corpo: any }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_GATEWAY_MS);
  try {
    const resp = await fetch(url, { method: "GET", headers: { "X-System-Secret": secret }, signal: ctl.signal });
    const texto = await resp.text();
    let corpo: any = null;
    try { corpo = JSON.parse(texto); } catch { corpo = { corpo_inicio: texto.slice(0, 300) }; }
    return { http: resp.status, corpo };
  } catch (e) {
    const msg = (e as Error)?.name === "AbortError" ? `timeout de ${TIMEOUT_GATEWAY_MS / 1000}s no gateway` : (e as Error)?.message;
    return { http: 0, corpo: { etapa: "conexao_gateway", error: msg ?? String(e) } };
  } finally {
    clearTimeout(timer);
  }
}

function inteiro(v: unknown, padrao: number | null, min: number, max: number): number | null {
  if (v === undefined || v === null || v === "") return padrao;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return NaN;
  return n;
}

Deno.serve(async (req: Request) => {
  const t0 = Date.now();
  // 1ª linha do handler: o probe sem segredo (401) já prova, em function_logs, qual build está no ar.
  console.log(`[${JOB_NAME}] build=edge nfse-adn-sonda ${VERSAO}`);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ error: "Edge function mal configurada (CRON_SECRET)" }, 500);
  const body = await req.json().catch(() => ({}));
  if (req.headers.get("x-cron-secret") !== expected && body?.cron_secret !== expected) {
    return json({ error: "Não autorizado" }, 401);
  }

  const modo = body?.modo === "teste" || body?.modo === "drenar" ? body.modo as "teste" | "drenar" : null;
  if (!modo) return json({ error: 'Informe "modo": "teste" ou "drenar".' }, 400);
  const trigger = ["manual_admin", "pg_cron", "test"].includes(body?.triggered_by) ? body.triggered_by : "manual_admin";

  const nsuTeste = inteiro(body?.nsu, 1, 0, 1e15);
  const nsuInicialPedido = inteiro(body?.nsu_inicial, null, 0, 1e15);
  const maxLotes = inteiro(body?.max_lotes, MAX_LOTES_PADRAO, 1, MAX_LOTES_TETO);
  if (Number.isNaN(nsuTeste) || Number.isNaN(nsuInicialPedido) || Number.isNaN(maxLotes)) {
    return json({ error: `Parâmetro inválido: nsu/nsu_inicial inteiros >= 0; max_lotes de 1 a ${MAX_LOTES_TETO}.` }, 400);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  console.log(`[${JOB_NAME}] modo=${modo} trigger=${trigger}`);

  const { data: settings } = await supabase
    .from("sync_settings").select("enabled, paused_reason").eq("job_name", JOB_NAME).maybeSingle();
  if (settings && settings.enabled === false) {
    await supabase.from("sync_runs").insert({
      triggered_by: trigger, job_type: JOB_TYPE, duracao_ms: Date.now() - t0, finished_at: new Date().toISOString(),
      observacao: `[${modo}] Pausado: ${settings.paused_reason || "sem motivo"} · edge nfse-adn-sonda ${VERSAO}`,
    });
    return json({ skipped: true, reason: "sync_settings.enabled = false" });
  }

  const { data: aberta } = await supabase
    .from("sync_runs").select("id, started_at").eq("job_type", JOB_TYPE).is("finished_at", null)
    .gt("started_at", new Date(Date.now() - EXECUCAO_ABERTA_MS).toISOString()).limit(1);
  if (aberta && aberta.length > 0) {
    return json({ skipped: true, reason: "outra execução da sonda em andamento", run_id: aberta[0].id }, 409);
  }

  const { data: run, error: errRun } = await supabase
    .from("sync_runs").insert({ triggered_by: trigger, job_type: JOB_TYPE }).select("id").single();
  if (errRun || !run) return json({ error: "Falha ao abrir sync_run", details: errRun }, 500);

  const erpUrl = Deno.env.get("ERP_PROXY_URL");
  const secret = Deno.env.get("ERP_PROXY_SYSTEM_SECRET");
  if (!erpUrl || !secret) {
    await supabase.from("sync_runs").update({
      finished_at: new Date().toISOString(), duracao_ms: Date.now() - t0, total_erros: 1,
      observacao: `Sem ERP_PROXY_URL/ERP_PROXY_SYSTEM_SECRET · edge nfse-adn-sonda ${VERSAO}`,
    }).eq("id", run.id);
    return json({ error: "Edge function mal configurada (proxy)" }, 500);
  }

  let detalhes: Record<string, unknown> = { modo, versao: VERSAO };
  let resumo = "";
  let consultados = 0;
  let gravados = 0;
  let erros = 0;

  try {
    if (modo === "teste") {
      const lote = body?.lote !== false;
      const r = await chamarGateway(`${erpUrl}/nfse-adn/teste?nsu=${nsuTeste}&lote=${lote ? 1 : 0}`, secret);
      consultados = 1;
      const c = r.corpo ?? {};
      const semantica = lerSemantica(nsuTeste as number, c?.primeira_entrada?.nsu);
      const ok = r.http === 200 && c?.ok === true && c?.http_status === 200;
      if (!ok) erros = 1;
      // sync_runs é lida pelo app: nada de conteúdo de nota de terceiro aqui. A chave da NFS-e embute o
      // CNPJ/CPF do prestador e o começo do XML pode trazer o mesmo — fica só o tamanho de cada um.
      const pe = c?.primeira_entrada;
      const primeira = pe && typeof pe === "object"
        ? { ...pe, chave: undefined, xml_inicio: undefined, chave_chars: typeof pe.chave === "string" ? pe.chave.length : null }
        : pe ?? null;
      detalhes = {
        ...detalhes, nsu_pedido: nsuTeste, lote, http_gateway: r.http, semantica_nsu: semantica,
        resposta: { ...c, primeira_entrada: primeira },
      };
      resumo = [
        `gateway HTTP ${r.http}`,
        `ADN HTTP ${c?.http_status ?? "?"}`,
        c?.status_processamento ?? null,
        `docs no lote ${c?.documentos_no_lote ?? "?"}`,
        `1º NSU ${c?.primeira_entrada?.nsu ?? "?"} (pedido ${nsuTeste}) → ${semantica}`,
        c?.etapa ? `falhou em ${c.etapa}: ${c.error ?? ""}` : null,
      ].filter(Boolean).join(" · ");
    } else {
      const { data: ultimo, error: errMax } = await supabase
        .from("nfse_adn_doc").select("nsu").order("nsu", { ascending: false }).limit(1);
      if (errMax) throw new Error(`ler maior NSU: ${errMax.message}`);
      const maiorGravado = ultimo && ultimo.length > 0 ? Number(ultimo[0].nsu) : null;
      const nsuInicial = nsuInicialPedido ?? maiorGravado ?? 0;

      const res = await drenar(
        {
          buscarLote: async (nsu) => {
            const r = await chamarGateway(`${erpUrl}/nfse-adn/dfe/${nsu}`, secret);
            return interpretarLote(r.http, r.corpo);
          },
          gravar: async (linhas) => {
            const { error } = await supabase.from("nfse_adn_doc").upsert(linhas, { onConflict: "nsu" });
            if (error) throw new Error(error.message);
          },
          agora: () => Date.now(),
          pausa: (ms) => new Promise((ok) => setTimeout(ok, ms)),
        },
        { nsuInicial, maxLotes: maxLotes as number, prazoMs: PRAZO_MS, pausaMs: PAUSA_MS, t0 },
      );

      const { count: naTabela } = await supabase.from("nfse_adn_doc").select("nsu", { count: "exact", head: true });
      consultados = res.lotes;
      gravados = res.documentos;
      if (res.parado_por && PARADAS_COM_ERRO.includes(res.parado_por)) erros = 1;
      detalhes = { ...detalhes, maior_nsu_antes: maiorGravado, nsu_inicial_pedido: nsuInicialPedido, na_tabela: naTabela, ...res };
      const tipos = Object.entries(res.por_tipo).map(([t, n]) => `${t} ${n}`).join(", ");
      resumo = [
        `NSU ${res.nsu_inicial}→${res.nsu_final ?? "-"}`,
        `lotes ${res.lotes}`,
        `docs ${res.documentos}${tipos ? ` (${tipos})` : ""}`,
        res.sem_xml ? `sem XML ${res.sem_xml}` : null,
        res.gerado_em.sem_fuso ? `gerado_em sem fuso ${res.gerado_em.sem_fuso} (supôs -03:00)` : null,
        res.gerado_em.ilegivel ? `gerado_em ilegível ${res.gerado_em.ilegivel}` : null,
        res.campos_desconhecidos.length ? `campos novos: ${res.campos_desconhecidos.join(",")}` : null,
        `parou: ${res.parado_por}`,
        res.erro ? `ERRO ${res.erro}` : null,
        `na tabela ${naTabela ?? "?"}`,
      ].filter(Boolean).join(" · ");
    }
  } catch (e) {
    erros = 1;
    resumo = `Exception: ${(e as Error)?.message ?? String(e)}`;
    detalhes = { ...detalhes, exception: resumo };
  }

  const { count: fingerprint } = await supabase.from("compras_pedidos").select("id", { count: "exact", head: true });
  const observacao = `[${modo}] ${resumo} · fingerprint pedidos=${fingerprint ?? "?"} · edge nfse-adn-sonda ${VERSAO}`.slice(0, 2000);

  await supabase.from("sync_runs").update({
    finished_at: new Date().toISOString(),
    duracao_ms: Date.now() - t0,
    total_candidatos: modo === "teste" ? 1 : (maxLotes as number),
    total_consultados: consultados,
    total_mudaram: gravados,
    total_erros: erros,
    detalhes,
    observacao,
  }).eq("id", run.id);

  return json({ ok: erros === 0, run_id: run.id, observacao });
});
