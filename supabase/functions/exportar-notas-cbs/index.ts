// =====================================================================
// Edge Function: exportar-notas-cbs   (VENDAS · janela de leitura)   v1
// PLANO-VENDAS.md §21 — VND-10. Ordem do Pedro em 12/11/2026.
// =====================================================================
// Janela SÓ DE LEITURA para o Cockpit CBS (projeto Supabase cbs-api) buscar
// as notas de saída do espelho (nf_saida) e conferir com a apuração da CBS
// na Receita. O Hub não envia nada: quem chama é o Cockpit, de hora em hora.
//
// POST, header x-api-key = segredo CBS_EXPORT_KEY (o mesmo guardado no Vault
// do cbs-api como cbs_hub_export_key). Sem o segredo a função fica fechada.
//   { "desde": "AAAA-MM-DD", "apos": {modelo, serie, numero} | null, "limite": 500 }
//     → { total, ultimo, restantes, alvo_lido_em, agendamento_ativo, notas: [...] }
//       Só cabeçalho e só os campos da checagem; CNPJ só de pessoa jurídica.
//       Próxima página: mandar "apos" = "ultimo" até "restantes" = 0.
// Cada chamada fica em cbs_exportacao_log.
// Kill-switch: sync_settings.job_name = 'exportar-notas-cbs' (false → 503).
// SECRETS: CBS_EXPORT_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy: verify_jwt = false (auth real = x-api-key)
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { chaveConfere, lerPedido } from "./logica.ts";

const VERSAO = "v1-2026-11-12";
const JOB_NAME = "exportar-notas-cbs";

// Brasília sem horário de verão (desde 2019): UTC−3 fixo.
function hojeBrasil(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  const t0 = Date.now();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const esperada = Deno.env.get("CBS_EXPORT_KEY");
  if (!esperada) return json({ error: "Função fechada: segredo CBS_EXPORT_KEY não configurado" }, 500);
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

  const registrar = async (notas: number | null, total: number | null, erro: string | null) => {
    await supabase.from("cbs_exportacao_log").insert({
      desde: pedido.desde,
      apos: pedido.apos ? `${pedido.apos.modelo}|${pedido.apos.serie}|${pedido.apos.numero}` : null,
      notas,
      total,
      ms: Date.now() - t0,
      erro: erro ? erro.slice(0, 500) : null,
    });
  };

  const { data, error } = await supabase.rpc("cbs_exportar_notas_saida", {
    p_desde: pedido.desde,
    p_apos_modelo: pedido.apos?.modelo ?? null,
    p_apos_serie: pedido.apos?.serie ?? null,
    p_apos_numero: pedido.apos?.numero ?? null,
    p_limite: pedido.limite,
  });
  if (error) {
    await registrar(null, null, error.message);
    return json({ error: `cbs_exportar_notas_saida: ${error.message}` }, 500);
  }
  const r = data as { total: number; notas: unknown[] };
  await registrar(r.notas.length, r.total, null);
  return json({ ...r, versao: VERSAO });
});
