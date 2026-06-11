// =====================================================================
// Edge Function: sync-lote-cron
// =====================================================================
// Enriquece a flag de controle de lote dos produtos (stock_products),
// lendo do ProdEmpresaFilialChildList (filial 1.01) do ERP Alvo via proxy.
//
// REGRA DE LOTE (filial 1.01):
//   Um produto controla lote ⟺ existe entrada em ProdEmpresaFilialChildList
//   com CodigoEmpresaFilial="1.01" E ControlaLote="Sim".
//   Sem entrada 1.01 → controla_lote=false.
//   Mapa: ControlaLote→controla_lote(bool), CodigoGeraNumLote→gera_num_lote(text),
//         PermiteLoteVencido→permite_lote_vencido(bool).
//
// FLUXO:
//   1. Valida CRON_SECRET (auth de invocação)
//   2. Lê sync_settings (job_name='sync-lote-cron') → para se enabled=false
//   3. Busca até BATCH_SIZE produtos ativos não verificados
//      (ativo=true AND lote_verificado_em IS NULL)
//   4. Para cada um: chama o proxy /estoque/produto-load/{codigo} (X-System-Secret),
//      extrai a filial 1.01, aplica a regra, grava + carimba lote_verificado_em.
//   5. 404 ("Registro não encontrado"): produto existe no Hub mas não no Alvo
//      (deletado lá) → carimba mesmo assim pra sair da fila (não reprocessa eternamente).
//   6. Persiste resultado em sync_runs.
//
// ESTRATÉGIA DE FILA:
//   Processa BATCH_SIZE (200) por execução. Pós-passivo, a fila diária é
//   pequena (produtos novos). Se um dia houver >200 novos, a próxima execução
//   pega o resto. Roda 1x/dia (3h BRT = 6h UTC), janela morta sem concorrência
//   com os crons pesados do Alvo.
//
// SECRETS NECESSÁRIOS (já existem, reusados do sync-compras):
//   - CRON_SECRET, ERP_PROXY_URL, ERP_PROXY_SYSTEM_SECRET
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (automáticos)
//
// MOLDE: sync-compras-status-cron (mesmo padrão de auth/settings/runs).
// =====================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// ─────────────────────────────────────────────────────────────────────
// Configuração
// ─────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 200; // produtos processados por execução
const FILIAL_ALVO = "1.01"; // filial cujo controle de lote interessa
const DELAY_MS = 150; // pausa entre chamadas ao Alvo (gentileza)
const WATCHDOG_MS = 110_000; // aborta antes do timeout da Edge Function

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────

interface ProdutoFila {
  id: string;
  codigo_produto: string;
  nome_produto: string | null;
}

interface LoteResult {
  total_candidatos: number; // quantos estavam na fila (até BATCH_SIZE)
  total_consultados: number; // quantos chegaram a ser consultados no Alvo
  total_mudaram: number; // quantos tiveram controla_lote efetivamente alterado
  total_erros: number;
  com_lote: number; // quantos ficaram controla_lote=true
  sem_lote: number; // quantos ficaram controla_lote=false
  fantasmas: number; // 404 (não existem no Alvo) — carimbados
  detalhes: Array<{
    codigo: string;
    controla_lote?: boolean;
    gera_num_lote?: string | null;
    erro?: string;
    fantasma?: boolean;
  }>;
  fila_restante_estimada: boolean; // true se a fila pode ter mais que BATCH_SIZE
}

// ─────────────────────────────────────────────────────────────────────
// Chamada ao proxy (produto-load) com X-System-Secret
// ─────────────────────────────────────────────────────────────────────

interface LoadResult {
  ok: boolean;
  status: number;
  data: any;
  notFound: boolean;
  error?: string;
}

async function carregarProdutoNoAlvo(erpUrl: string, systemSecret: string, codigo: string): Promise<LoadResult> {
  const url = `${erpUrl}/estoque/produto-load/${encodeURIComponent(codigo)}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "GET",
      headers: { "X-System-Secret": systemSecret },
    });
  } catch (e: any) {
    return { ok: false, status: 0, data: null, notFound: false, error: `fetch falhou: ${e?.message || String(e)}` };
  }

  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    // sem body
  }

  // O proxy retorna 404 quando o Alvo diz "Registro não encontrado"
  // (produto deletado no Alvo). Tratamos como fantasma.
  const msg =
    data && typeof data === "object" && (data.error || data.Message) ? String(data.error || data.Message) : "";
  const notFound = resp.status === 404 || /não encontrad|not found|does not exist|registro não/i.test(msg);

  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      data,
      notFound,
      error: msg || `HTTP ${resp.status}`,
    };
  }

  return { ok: true, status: resp.status, data, notFound: false };
}

// ─────────────────────────────────────────────────────────────────────
// Extração da regra de lote (filial 1.01)
// ─────────────────────────────────────────────────────────────────────

function extrairLote(detail: any): {
  controla_lote: boolean;
  gera_num_lote: string | null;
  permite_lote_vencido: boolean | null;
} {
  const filialList = Array.isArray(detail?.ProdEmpresaFilialChildList) ? detail.ProdEmpresaFilialChildList : [];
  const filial = filialList.find((f: any) => f.CodigoEmpresaFilial === FILIAL_ALVO);

  const controlaLote = filial?.ControlaLote === "Sim";
  const geraNumLote = controlaLote ? (filial?.CodigoGeraNumLote ?? null) : null;
  const permiteLoteVencido = controlaLote ? filial?.PermiteLoteVencido === "Sim" : null;

  return {
    controla_lote: controlaLote,
    gera_num_lote: geraNumLote,
    permite_lote_vencido: permiteLoteVencido,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Job principal: enriquece o lote de um lote de produtos
// ─────────────────────────────────────────────────────────────────────

async function syncLote(
  supabase: SupabaseClient,
  erpUrl: string,
  systemSecret: string,
  t0: number,
): Promise<LoteResult> {
  const result: LoteResult = {
    total_candidatos: 0,
    total_consultados: 0,
    total_mudaram: 0,
    total_erros: 0,
    com_lote: 0,
    sem_lote: 0,
    fantasmas: 0,
    detalhes: [],
    fila_restante_estimada: false,
  };

  // 1. Busca a fila: ativos não verificados (até BATCH_SIZE + 1 pra detectar sobra)
  const { data: produtos, error } = await supabase
    .from("stock_products")
    .select("id, codigo_produto, nome_produto, controla_lote")
    .eq("ativo", true)
    .is("lote_verificado_em", null)
    .limit(BATCH_SIZE + 1);

  if (error) {
    result.total_erros++;
    result.detalhes.push({ codigo: "(fila)", erro: `Erro ao buscar fila: ${error.message}` });
    return result;
  }

  const fila = (produtos || []) as Array<ProdutoFila & { controla_lote: boolean | null }>;

  // Se veio BATCH_SIZE+1, há mais na fila do que processaremos nesta run.
  if (fila.length > BATCH_SIZE) {
    result.fila_restante_estimada = true;
    fila.length = BATCH_SIZE; // processa só os primeiros BATCH_SIZE
  }

  result.total_candidatos = fila.length;

  if (fila.length === 0) {
    return result; // fila vazia — nada a fazer
  }

  // 2. Processa um a um
  for (const p of fila) {
    // Watchdog: para antes do timeout da Edge Function. O que não processou
    // fica com lote_verificado_em=null e entra na próxima execução.
    if (Date.now() - t0 > WATCHDOG_MS) {
      result.detalhes.push({ codigo: "(watchdog)", erro: `Abortado por watchdog após ${Date.now() - t0}ms` });
      result.fila_restante_estimada = true;
      break;
    }

    const load = await carregarProdutoNoAlvo(erpUrl, systemSecret, p.codigo_produto);

    // 2a. Produto não existe no Alvo (fantasma): carimba pra sair da fila.
    if (!load.ok && load.notFound) {
      const { error: upErr } = await supabase
        .from("stock_products")
        .update({ lote_verificado_em: new Date().toISOString() })
        .eq("id", p.id);
      if (upErr) {
        result.total_erros++;
        result.detalhes.push({ codigo: p.codigo_produto, erro: `carimbo fantasma falhou: ${upErr.message}` });
      } else {
        result.fantasmas++;
        result.detalhes.push({ codigo: p.codigo_produto, fantasma: true });
      }
      await sleep(DELAY_MS);
      continue;
    }

    // 2b. Erro real (não-404): conta erro, NÃO carimba (tenta de novo na próxima run).
    if (!load.ok) {
      result.total_erros++;
      result.detalhes.push({ codigo: p.codigo_produto, erro: load.error || `HTTP ${load.status}` });
      await sleep(DELAY_MS);
      continue;
    }

    // 2c. Sucesso: extrai a regra e grava.
    result.total_consultados++;
    const lote = extrairLote(load.data);

    const { error: upErr } = await supabase
      .from("stock_products")
      .update({
        controla_lote: lote.controla_lote,
        gera_num_lote: lote.gera_num_lote,
        permite_lote_vencido: lote.permite_lote_vencido,
        lote_verificado_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", p.id);

    if (upErr) {
      result.total_erros++;
      result.detalhes.push({ codigo: p.codigo_produto, erro: `update falhou: ${upErr.message}` });
      await sleep(DELAY_MS);
      continue;
    }

    // Estatísticas
    if (lote.controla_lote) result.com_lote++;
    else result.sem_lote++;

    if (p.controla_lote !== lote.controla_lote) {
      result.total_mudaram++;
    }

    // Só registra detalhe dos que controlam lote (pra não inflar o jsonb com milhares de false)
    if (lote.controla_lote) {
      result.detalhes.push({
        codigo: p.codigo_produto,
        controla_lote: true,
        gera_num_lote: lote.gera_num_lote,
      });
    }

    await sleep(DELAY_MS);
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Handler principal
// ─────────────────────────────────────────────────────────────────────

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

  // ── Auth do cron (CRON_SECRET) ──────────────────────────────────────
  const expectedSecret = Deno.env.get("CRON_SECRET");
  if (!expectedSecret) {
    console.error("[lote-cron] CRON_SECRET não configurado");
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
    console.warn("[lote-cron] CRON_SECRET inválido");
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

  // ── Liga/desliga via sync_settings ──────────────────────────────────
  const { data: settings } = await supabase
    .from("sync_settings")
    .select("enabled, paused_reason")
    .eq("job_name", "sync-lote-cron")
    .maybeSingle();

  if (settings && settings.enabled === false) {
    console.log("[lote-cron] pausado:", settings.paused_reason);
    await supabase.from("sync_runs").insert({
      triggered_by: safeTrigger,
      job_type: "lote",
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

  // ── Cria a linha de auditoria (started) ─────────────────────────────
  const { data: runRow, error: errRun } = await supabase
    .from("sync_runs")
    .insert({ triggered_by: safeTrigger, job_type: "lote" })
    .select("id")
    .single();

  if (errRun || !runRow) {
    console.error("[lote-cron] falha ao criar sync_run:", errRun);
    return new Response(JSON.stringify({ error: "Falha ao iniciar sync_run", details: errRun }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const runId = runRow.id;

  // ── Secrets do proxy ────────────────────────────────────────────────
  const erpUrl = Deno.env.get("ERP_PROXY_URL")!;
  const systemSecret = Deno.env.get("ERP_PROXY_SYSTEM_SECRET")!;

  if (!erpUrl || !systemSecret) {
    console.error("[lote-cron] ERP_PROXY_URL ou ERP_PROXY_SYSTEM_SECRET ausentes");
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

  // ── Roda o job ──────────────────────────────────────────────────────
  let result: LoteResult;
  let observacao: string | null = null;

  try {
    result = await syncLote(supabase, erpUrl, systemSecret, startTime);
  } catch (err: any) {
    console.error("[lote-cron] exception:", err);
    result = {
      total_candidatos: 0,
      total_consultados: 0,
      total_mudaram: 0,
      total_erros: 1,
      com_lote: 0,
      sem_lote: 0,
      fantasmas: 0,
      detalhes: [{ codigo: "(exception)", erro: err?.message || String(err) }],
      fila_restante_estimada: false,
    };
    observacao = `Exception inesperada: ${err?.message || String(err)}`;
  }

  if (!observacao) {
    observacao =
      `com_lote=${result.com_lote} sem_lote=${result.sem_lote} ` +
      `fantasmas=${result.fantasmas}` +
      (result.fila_restante_estimada
        ? " | FILA RESTANTE: rode de novo ou aguarde próxima execução"
        : " | fila esvaziada");
  }

  // ── Persiste auditoria ──────────────────────────────────────────────
  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - startTime,
      total_candidatos: result.total_candidatos,
      total_consultados: result.total_consultados,
      total_mudaram: result.total_mudaram,
      total_erros: result.total_erros,
      detalhes: result.detalhes,
      observacao,
    })
    .eq("id", runId);

  return new Response(
    JSON.stringify({
      run_id: runId,
      duracao_ms: Date.now() - startTime,
      candidatos: result.total_candidatos,
      consultados: result.total_consultados,
      mudaram: result.total_mudaram,
      erros: result.total_erros,
      com_lote: result.com_lote,
      sem_lote: result.sem_lote,
      fantasmas: result.fantasmas,
      fila_restante_estimada: result.fila_restante_estimada,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
});
