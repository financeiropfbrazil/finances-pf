// =====================================================================
// Edge Function: exportar-notas-recebidas-cbs   (COMPRAS · janela de leitura)   v1
// PLANO-NFE.md — NFE-22. Pedido do Pedro em 16/11/2026 ("arrume todos": no Cockpit CBS, a compra que está no
// Hub com CBS destacada e sem crédito na Receita tem de aparecer como "Sem crédito").
// =====================================================================
// Janela SÓ DE LEITURA para o Cockpit CBS (projeto cbs-api) buscar as NOTAS RECEBIDAS:
//   - NF-e de produto (compras_nfe, entrada pela Riosoft/Arqimport);
//   - NFS-e (v_nfse_recebida + XML de nfse_adn_doc, ambiente nacional).
// Só o cabeçalho e os valores de CBS/IBS lidos do XML (sem o XML: o Cockpit não precisa dele). Só CNPJ: documento
// que não tem 14 dígitos sai sem número e sem nome (LGPD). Não grava nada nas tabelas de notas; registra cada
// chamada em cbs_exportacao_log (o mesmo registro da VND-10, com apos = 'recebidas:<tipo>:<chave>').
//
// POST, header x-api-key = segredo CBS_EXPORT_KEY (o mesmo da exportar-notas-cbs/VND-10: um segredo por consumidor,
// e o consumidor é o mesmo Cockpit). Sem o segredo configurado a função fica fechada (500).
//   { "tipo": "nfe" | "nfse", "desde": "2026-01-01", "apos": "<chave>" | null, "limite": 100 (máx. 300) }
//       → notas emitidas desde a data, ordenadas pela chave de acesso, a partir da chave seguinte a "apos";
//         { gerado_em, tipo, desde, notas[], na_pagina, restantes, ultimo, fontes, versao }.
// Kill-switch: sync_settings.job_name = 'exportar-notas-cbs' (o mesmo da VND-10; false → 503 nas duas janelas).
// SECRETS: CBS_EXPORT_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy: verify_jwt = false (auth real = x-api-key). Nenhuma mudança de banco: só lê tabelas e views que existem.
// Não toca na receber-nfe (PLANO-NFE, regra 1).
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { chaveConfere, lerPedido, montarNfe, montarNfse } from "./logica.ts";

const VERSAO = "v1-2026-11-26";
const JOB_NAME = "exportar-notas-cbs";

const COLS_NFE =
  "chave_acesso, serie, numero, data_emissao, emitente_cnpj, emitente_nome, emitente_uf, valor_total, imported_at, raw_xml";
const COLS_NFSE =
  "nsu, chave_acesso, numero, data_emissao, prestador_doc, prestador_nome, municipio_emissor, valor_servico, situacao_fisco, situacao_alvo, alvo_data_entrada";

// Brasília sem horário de verão (desde 2019): UTC−3 fixo.
function hojeBrasil(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const esperada = Deno.env.get("CBS_EXPORT_KEY");
  if (!esperada) return json({ error: "Função fechada: segredo CBS_EXPORT_KEY não configurado" }, 500);
  if (!chaveConfere(req.headers.get("x-api-key"), esperada)) return json({ error: "Não autorizado" }, 401);

  const pedido = lerPedido(await req.json().catch(() => null), hojeBrasil());
  if ("erro" in pedido) return json({ error: pedido.erro }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: settings } = await supabase
    .from("sync_settings")
    .select("enabled, paused_reason")
    .eq("job_name", JOB_NAME)
    .maybeSingle();
  if (settings && settings.enabled === false) {
    return json({ error: `Janela desligada no Hub: ${settings.paused_reason || "sem motivo"}` }, 503);
  }

  const inicio = Date.now();
  const registrar = (notas: number | null, total: number | null, erro: string | null) =>
    supabase.from("cbs_exportacao_log").insert({
      desde: pedido.desde,
      apos: `recebidas:${pedido.tipo}:${pedido.apos ?? ""}`,
      notas,
      total,
      ms: Date.now() - inicio,
      erro,
    });

  try {
    const tabela = pedido.tipo === "nfe" ? "compras_nfe" : "v_nfse_recebida";
    let q = supabase
      .from(tabela)
      .select(pedido.tipo === "nfe" ? COLS_NFE : COLS_NFSE, { count: "exact" })
      .gte("data_emissao", pedido.desde)
      .not("chave_acesso", "is", null);
    if (pedido.apos) q = q.gt("chave_acesso", pedido.apos);
    const { data, count, error } = await q.order("chave_acesso").limit(pedido.limite);
    if (error) throw new Error(error.message);
    const linhas = (data ?? []) as Record<string, any>[];
    // Confere a página: a API corta linhas em silêncio, então falha em vez de devolver página incompleta.
    const esperadas = Math.min(pedido.limite, count ?? 0);
    if (linhas.length !== esperadas) throw new Error(`página incompleta: ${linhas.length} notas, esperadas ${esperadas}`);

    let notas: unknown[];
    if (pedido.tipo === "nfe") {
      notas = linhas.map(montarNfe);
    } else {
      const nsus = linhas.map((n) => n.nsu);
      const { data: docs, error: e2 } = nsus.length
        ? await supabase.from("nfse_adn_doc").select("nsu, xml").in("nsu", nsus)
        : { data: [], error: null };
      if (e2) throw new Error(e2.message);
      const xmlPorNsu = new Map<string, string | null>((docs ?? []).map((d: any) => [String(d.nsu), d.xml ?? null]));
      const semXml = nsus.filter((x) => !xmlPorNsu.get(String(x)));
      if (semXml.length) throw new Error(`NFS-e sem XML no espelho do ambiente nacional: NSU ${semXml.join(", ")}`);
      notas = linhas.map((n) => montarNfse(n, xmlPorNsu.get(String(n.nsu)) ?? null));
    }

    // Situação das fontes: quando chegou a última NF-e da Riosoft e a última leitura do ambiente nacional.
    const [{ data: ultNfe }, { data: ultAdn }] = await Promise.all([
      supabase.from("compras_nfe").select("imported_at").order("imported_at", { ascending: false }).limit(1),
      supabase.from("nfse_adn_doc").select("lido_em").order("lido_em", { ascending: false }).limit(1),
    ]);

    await registrar(notas.length, count ?? null, null);
    return json({
      gerado_em: new Date().toISOString(),
      tipo: pedido.tipo,
      desde: pedido.desde,
      notas,
      na_pagina: notas.length,
      restantes: Math.max(0, (count ?? 0) - notas.length),
      ultimo: linhas.length ? linhas[linhas.length - 1].chave_acesso : null,
      fontes: {
        nfe_ultima_chegada: ultNfe?.[0]?.imported_at ?? null,
        nfse_ultima_leitura: ultAdn?.[0]?.lido_em ?? null,
      },
      versao: VERSAO,
    });
  } catch (e) {
    const msg = `Falha na leitura: ${(e as Error).message}`.slice(0, 500);
    console.error(`[exportar-notas-recebidas-cbs] ${msg}`);
    await registrar(null, null, msg);
    return json({ error: msg }, 500);
  }
});
