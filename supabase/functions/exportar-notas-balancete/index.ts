// =====================================================================
// Edge Function: exportar-notas-balancete   (VENDAS · janela de leitura)   v1
// PLANO-VENDAS.md §20 — VND-9. Ordem do Pedro em 12/11/2026.
// =====================================================================
// Janela SÓ DE LEITURA para o Balancete P&F buscar as notas de saída do
// espelho (nf_saida*), sem carga manual. O Hub não envia nada: quem chama é
// o Balancete, a cada 30 minutos (desenho em balancete-starter,
// docs/DESENHO-ENVIO-AUTOMATICO-NOTAS.md).
//
// POST, header x-api-key = segredo BALANCETE_EXPORT_KEY (o mesmo guardado no
// Balancete). Sem o segredo configurado a função fica fechada (500).
//   { "acao": "resumo", "meses": 13 }
//       → por mês: notas, canceladas, pendentes de detalhe, séries sem número
//         e a impressão digital; e as últimas rodadas completas da leitura.
//   { "acao": "mes", "mes": "AAAA-MM", "pagina": 1, "por_pagina": 20 }
//       → a página do mês no formato dos arquivos dos scripts:
//         { gerado_em, loads: {chave: nota}, series: {controle: {s,l,p}}, erros: {} }
// Cada chamada fica em nf_saida_exportacao_log.
// Kill-switch: sync_settings.job_name = 'exportar-notas-balancete' (false → 503).
// SECRETS: BALANCETE_EXPORT_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy: verify_jwt = false (auth real = x-api-key)
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { chaveConfere, lerPedido, respostaMes } from "./logica.ts";

const VERSAO = "v1-2026-11-12";
const JOB_NAME = "exportar-notas-balancete";

// Brasília sem horário de verão (desde 2019): UTC−3 fixo.
function hojeBrasil(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  const t0 = Date.now();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const esperada = Deno.env.get("BALANCETE_EXPORT_KEY");
  if (!esperada) return json({ error: "Função fechada: segredo BALANCETE_EXPORT_KEY não configurado" }, 500);
  if (!chaveConfere(req.headers.get("x-api-key"), esperada)) return json({ error: "Não autorizado" }, 401);

  const body = await req.json().catch(() => null);
  const pedido = lerPedido(body, hojeBrasil());
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

  const registrar = async (mes: string | null, pagina: number | null, notas: number | null, erro: string | null) => {
    await supabase.from("nf_saida_exportacao_log").insert({
      acao: pedido.acao,
      mes: mes ? `${mes}-01` : null,
      pagina,
      notas,
      ms: Date.now() - t0,
      erro: erro ? erro.slice(0, 500) : null,
    });
  };

  if (pedido.acao === "resumo") {
    const { data, error } = await supabase.rpc("balancete_exportar_resumo", { p_meses: pedido.meses });
    if (error) {
      await registrar(null, null, null, error.message);
      return json({ error: `balancete_exportar_resumo: ${error.message}` }, 500);
    }
    await registrar(null, null, null, null);
    return json({ ...(data as object), versao: VERSAO });
  }

  const { data, error } = await supabase.rpc("balancete_exportar_mes", {
    p_mes: `${pedido.mes}-01`,
    p_offset: (pedido.pagina - 1) * pedido.porPagina,
    p_limite: pedido.porPagina,
  });
  if (error) {
    await registrar(pedido.mes, pedido.pagina, null, error.message);
    return json({ error: `balancete_exportar_mes: ${error.message}` }, 500);
  }
  const resposta = respostaMes(data as any, pedido.pagina, pedido.porPagina, new Date().toISOString());
  await registrar(pedido.mes, pedido.pagina, resposta.na_pagina, null);
  return json({ ...resposta, versao: VERSAO });
});
