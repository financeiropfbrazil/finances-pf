// supabase/functions/notify-pedido-concluido/index.ts
//
// Envia email ao REQUISITANTE quando o Pedido de Compra é CONCLUÍDO
// (status='Encerrado' + aprovado='Total').
//
// Irmã da notify-pedido-criador (que avisa o CRIADOR na aprovação 100%).
// Substitui o gatilho antigo da notify-pedido-aprovado (que avisava o
// requisitante na APROVAÇÃO) — decisão do Pedro em 17/07/2026:
//   - CRIADOR      → avisado quando o pedido é 100% aprovado
//   - REQUISITANTE → avisado somente quando o pedido é CONCLUÍDO
//
// Arquitetura ESTADO+SCAN (P-1): o scan pergunta "existe pedido NESTE ESTADO
// que ainda não recebeu ESTE e-mail?" — não depende de detectar transição.
// Assim, não importa quem atualizou o status (cron, open-load do frontend,
// data-fix): o e-mail sai no scan seguinte, uma única vez.
//
// Dois modos:
//   - Scan  (body {} ou sem pedido_id): varre os elegíveis e dispara os pendentes.
//                                       É o modo do cron.
//   - Single(body { pedido_id }): processa 1 pedido. force_test / override_email
//                                 para teste manual.
//
// SEGURANÇA: exige x-cron-secret (header) OU cron_secret (body) == CRON_SECRET.
//   Sem match → 401, antes de qualquer modo (mesmo padrão da notify-pedido-criador,
//   L2 Entrega 1). Fecha a exposição pública do override_email.
//
// Dedup: compras_pedidos_emails_log.
//   - tipo próprio:  'pedido_concluido'
//   - regra:         por (pedido_id, tipo) — NÃO cruza endereço. Cruzar bloquearia
//                    este e-mail quando o de aprovação ao criador já tivesse ido ao
//                    MESMO endereço (criador==requisitante).
//   - backlog:       1.161 linhas 'backlog-neutralizado' (tipo 'pedido_concluido')
//                    inseridas em 19/07/2026 ANTES do go-live fazem o scan pular
//                    todos os pedidos já concluídos — zero e-mail retroativo.
//
// Cobertura esperada: dos 1.161 concluídos, apenas ~118 têm requisição vinculada.
// Os demais são compra direta (sem requisitante) e legitimamente não geram e-mail.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HUB_BASE_URL = "https://finance-pf.lovable.app";
const FROM_EMAIL = "P&F Financial Hub <noreply@notificapfbr.com.br>";
const LOGO_URL = "https://hbtggrbauguukewiknew.supabase.co/storage/v1/object/public/brand-assets/pf-logo.png";

// ⚠️ Deve bater EXATAMENTE com o tipo usado na neutralização do backlog
// (1.161 linhas inseridas em 19/07/2026). Divergir aqui = 1.161 e-mails retroativos.
const TIPO = "pedido_concluido";

const COLOR = {
  white: "#FFFFFF",
  gray: "#7E8182",
  darkGray: "#5B5E5E",
  black: "#000000",
  red: "#E52726",
  darkRed: "#991717",
  emerald: "#059669",
  emeraldDark: "#047857",
  bgSoft: "#F7F7F8",
  borderSoft: "#E4E4E7",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface PedidoData {
  id: string;
  numero: string;
  valor_total: number | null;
  nome_entidade: string | null;
  numero_req_comp: string | null;
  codigo_empresa_filial_req_comp: string | null;
  status: string | null;
  aprovado: string | null;
  data_entrega: string | null;
}

// ── Formatadores ──
function fmtBRL(v: number | null | undefined): string {
  if (v == null) return "—";
  return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "elisangela.silva" -> "Elisangela Silva"; "HUGO.MAFFEI" -> "Hugo Maffei"
function prettifyNome(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .replace(/[._]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ")
    .trim();
}

// ── Template HTML (mesma identidade visual das irmãs) ──
function buildEmailHtml(ped: PedidoData, requisitanteNome: string): string {
  const link = `${HUB_BASE_URL}/suprimentos/pedidos/${ped.id}`;
  const primeiroNome = escapeHtml((requisitanteNome || "").split(" ")[0] || "");
  const fornecedor = escapeHtml(ped.nome_entidade || "—");
  const numeroReq = ped.numero_req_comp ? escapeHtml(ped.numero_req_comp) : null;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pedido concluído</title>
</head>
<body style="margin:0;padding:0;background:${COLOR.bgSoft};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,sans-serif;color:${COLOR.black};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLOR.bgSoft};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:${COLOR.white};border-radius:8px;border:1px solid ${COLOR.borderSoft};overflow:hidden;">

          <!-- Logo header -->
          <tr>
            <td style="padding:24px 32px;border-bottom:2px solid ${COLOR.red};">
              <img src="${LOGO_URL}" alt="P&F" height="32" style="display:block;height:32px;width:auto;">
            </td>
          </tr>

          <!-- Status banner -->
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <div style="display:inline-block;background:#D1FAE5;color:${COLOR.emeraldDark};padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">
                ✓ Pedido concluído
              </div>
            </td>
          </tr>

          <!-- Saudação -->
          <tr>
            <td style="padding:8px 32px 0 32px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:${COLOR.black};line-height:1.3;">
                Olá${primeiroNome ? `, ${primeiroNome}` : ""}!
              </h1>
              <p style="margin:12px 0 0 0;font-size:15px;line-height:1.6;color:${COLOR.darkGray};">
                ${
                  numeroReq
                    ? `O pedido <strong>Nº ${escapeHtml(ped.numero)}</strong>, gerado a partir da sua requisição <strong>Nº ${numeroReq}</strong>, foi <strong>concluído</strong>.`
                    : `O pedido <strong>Nº ${escapeHtml(ped.numero)}</strong> foi <strong>concluído</strong>.`
                }
              </p>
            </td>
          </tr>

          <!-- Card de detalhes -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLOR.bgSoft};border-radius:6px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="padding-bottom:14px;">
                          <div style="font-size:11px;color:${COLOR.gray};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;">Valor total</div>
                          <div style="font-size:22px;font-weight:700;color:${COLOR.emerald};">${fmtBRL(ped.valor_total)}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:14px 0;border-top:1px solid ${COLOR.borderSoft};">
                          <div style="font-size:11px;color:${COLOR.gray};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;">Fornecedor</div>
                          <div style="font-size:15px;font-weight:600;color:${COLOR.black};">${fornecedor}</div>
                        </td>
                      </tr>
                      ${
                        numeroReq
                          ? `<tr>
                        <td style="padding:14px 0 0 0;border-top:1px solid ${COLOR.borderSoft};">
                          <div style="font-size:11px;color:${COLOR.gray};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;">Sua requisição</div>
                          <div style="font-size:15px;font-weight:600;color:${COLOR.black};">Nº ${numeroReq}</div>
                        </td>
                      </tr>`
                          : ""
                      }
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:24px 32px 0 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background:${COLOR.red};border-radius:6px;mso-padding-alt:14px 32px;">
                          <a href="${link}" target="_blank" style="display:inline-block;padding:14px 32px;color:${COLOR.white};text-decoration:none;font-size:15px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1;">
                            Ver pedido no Hub →
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Texto explicativo -->
          <tr>
            <td style="padding:20px 32px 32px 32px;">
              <p style="margin:0;font-size:13px;line-height:1.6;color:${COLOR.gray};text-align:center;">
                O processo de compra referente a esta requisição foi encerrado no ERP.
                Em caso de divergência, procure a equipe de Suprimentos.
              </p>
            </td>
          </tr>

          <!-- Rodapé -->
          <tr>
            <td style="background:${COLOR.bgSoft};padding:20px 32px;border-top:1px solid ${COLOR.borderSoft};">
              <p style="margin:0;font-size:11px;line-height:1.5;color:${COLOR.gray};text-align:center;">
                Esta é uma mensagem automática do <strong style="color:${COLOR.darkGray};">P&F Financial Hub</strong>.<br>
                Não responda este email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Buscar 1 pedido ──
async function buscarPedido(supabase: any, pedidoId: string): Promise<PedidoData | null> {
  const { data, error } = await supabase
    .from("compras_pedidos")
    .select(
      "id, numero, valor_total, nome_entidade, numero_req_comp, codigo_empresa_filial_req_comp, status, aprovado, data_entrega",
    )
    .eq("id", pedidoId)
    .single();
  if (error || !data) {
    console.error("[buscarPedido] erro:", error);
    return null;
  }
  return data as PedidoData;
}

// ── Resolver e-mail + nome do REQUISITANTE (via requisição vinculada) ──
async function resolverRequisitante(
  supabase: any,
  ped: PedidoData,
  overrideEmail: string | null,
): Promise<{ email: string; nome: string } | null> {
  if (overrideEmail) {
    return { email: overrideEmail, nome: "Teste" };
  }

  // Pedido sem requisição vinculada = compra direta → não há requisitante a avisar.
  if (!ped.numero_req_comp) {
    console.log(`[resolverRequisitante] Pedido ${ped.numero} sem req vinculada — não envia`);
    return null;
  }

  const { data: req, error: errReq } = await supabase
    .from("compras_requisicoes")
    .select("requisitante_user_id")
    .eq("numero_alvo", ped.numero_req_comp)
    .eq("codigo_empresa_filial", ped.codigo_empresa_filial_req_comp ?? "1.01")
    .maybeSingle();

  if (errReq || !req?.requisitante_user_id) {
    console.log(`[resolverRequisitante] Pedido ${ped.numero} — req ${ped.numero_req_comp} sem requisitante_user_id`);
    return null;
  }

  const { data: userInfo, error: errUser } = await supabase.auth.admin.getUserById(req.requisitante_user_id);
  if (errUser || !userInfo?.user?.email) {
    console.error("[resolverRequisitante] erro ao buscar user:", errUser);
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", req.requisitante_user_id)
    .maybeSingle();

  return {
    email: userInfo.user.email,
    nome: prettifyNome(profile?.full_name) || userInfo.user.email,
  };
}

// ── Dedup por (pedido_id, tipo) — NÃO cruza endereço: senão o e-mail de aprovação
//    ao criador bloquearia este quando criador==requisitante. ──
async function jaProcessado(supabase: any, pedidoId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("compras_pedidos_emails_log")
    .select("id")
    .eq("pedido_id", pedidoId)
    .eq("tipo", TIPO)
    .eq("sucesso", true)
    .limit(1);
  if (error) {
    console.error("[jaProcessado] erro ao consultar log:", error);
    return false; // em caso de erro, tenta enviar
  }
  return (data || []).length > 0;
}

// ── Registra envio no log ──
async function registrarLog(
  supabase: any,
  pedidoId: string,
  destinatario: string,
  emailId: string | null,
  sucesso: boolean,
  erro: string | null,
): Promise<void> {
  await supabase.from("compras_pedidos_emails_log").insert({
    pedido_id: pedidoId,
    tipo: TIPO,
    destinatario,
    resend_email_id: emailId,
    sucesso,
    erro,
  });
}

// ── Processa 1 pedido ──
async function processarPedido(
  supabase: any,
  pedidoId: string,
  opts: { forceTest?: boolean; overrideEmail?: string | null } = {},
): Promise<{ ok: boolean; skipped?: string; email_id?: string | null; to?: string; error?: string }> {
  const forceTest = opts.forceTest === true;
  const overrideEmail = opts.overrideEmail || null;

  const ped = await buscarPedido(supabase, pedidoId);
  if (!ped) return { ok: false, skipped: "pedido_nao_encontrado" };

  // Elegibilidade (P-5): Encerrado + aprovado Total.
  // O aprovado='Total' exclui as 5 anomalias legadas (Encerrado|Não|Nenhum).
  if (!forceTest && !overrideEmail) {
    const concluidoOk = ped.status === "Encerrado" && ped.aprovado === "Total";
    if (!concluidoOk) {
      return { ok: true, skipped: "nao_elegivel" };
    }
  }

  const requisitante = await resolverRequisitante(supabase, ped, overrideEmail);
  if (!requisitante) return { ok: true, skipped: "sem_destinatario" };

  if (!forceTest && !overrideEmail) {
    if (await jaProcessado(supabase, ped.id)) {
      return { ok: true, skipped: "ja_enviado" };
    }
  }

  const html = buildEmailHtml(ped, requisitante.nome);
  const subject = `[P&F Financial Hub] Pedido ${ped.numero} concluído`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [requisitante.email], subject, html }),
  });
  const resendData = await resp.json();

  if (!resp.ok) {
    const errMsg = `Resend ${resp.status}: ${resendData?.message || JSON.stringify(resendData)}`;
    console.error("[processarPedido] Resend rejeitou:", resendData);
    await registrarLog(supabase, ped.id, requisitante.email, null, false, errMsg);
    return { ok: false, error: errMsg, to: requisitante.email };
  }

  const emailId = resendData?.id || null;
  await registrarLog(supabase, ped.id, requisitante.email, emailId, true, null);
  console.log("[processarPedido] enviado", { pedido: ped.numero, to: requisitante.email, email_id: emailId });
  return { ok: true, email_id: emailId, to: requisitante.email };
}

// ── Modo scan: varre os elegíveis e processa os pendentes ──
async function scan(supabase: any): Promise<any> {
  // Candidatos: Encerrado + Total + COM requisição vinculada (sem req = compra
  // direta, não há requisitante a avisar — filtra no banco para não trazer os
  // ~1.043 sem destinatário a cada ciclo).
  // Paginação por .range(): o PostgREST hospedado tem max-rows=1000.
  const ids: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("compras_pedidos")
      .select("id")
      .eq("status", "Encerrado")
      .eq("aprovado", "Total")
      .not("numero_req_comp", "is", null)
      .range(from, from + PAGE - 1);

    if (error) {
      console.error("[scan] erro ao listar candidatos:", error);
      return { ok: false, error: error.message };
    }
    const lote = (data || []).map((p: any) => p.id);
    ids.push(...lote);
    if (lote.length < PAGE) break;
  }

  if (ids.length === 0) return { ok: true, candidatos: 0, enviados: 0, pulados: 0 };

  // Já feitos (tipo pedido_concluido com sucesso — inclui as linhas
  // 'backlog-neutralizado' inseridas antes do go-live).
  const feitos = new Set<string>();
  const CHUNK = 500; // evita URL gigante no .in()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data: logs, error: errLog } = await supabase
      .from("compras_pedidos_emails_log")
      .select("pedido_id")
      .eq("tipo", TIPO)
      .eq("sucesso", true)
      .in("pedido_id", chunk);
    if (errLog) {
      console.error("[scan] erro ao consultar log:", errLog);
      return { ok: false, error: errLog.message };
    }
    for (const l of logs || []) feitos.add(l.pedido_id);
  }

  let enviados = 0;
  let pulados = 0;
  for (const id of ids) {
    if (feitos.has(id)) {
      pulados++;
      continue;
    }
    const r = await processarPedido(supabase, id, {});
    if (r.ok && r.email_id) enviados++;
    else pulados++;
  }
  return { ok: true, candidatos: ids.length, enviados, pulados };
}

// ── Handler ──
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Método não permitido" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ success: false, error: "RESEND_API_KEY não configurada" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    // ── Gate CRON_SECRET — antes de QUALQUER modo (scan/single/force_test) ──
    const expectedSecret = Deno.env.get("CRON_SECRET");
    if (!expectedSecret) {
      return new Response(JSON.stringify({ success: false, error: "CRON_SECRET não configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const headerSecret = req.headers.get("x-cron-secret");
    const bodySecret = body?.cron_secret;
    if (headerSecret !== expectedSecret && bodySecret !== expectedSecret) {
      return new Response(JSON.stringify({ success: false, error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Modo single (teste / chamada por pedido)
    if (body?.pedido_id) {
      const r = await processarPedido(supabase, body.pedido_id, {
        forceTest: body?.force_test === true,
        overrideEmail: body?.override_email || null,
      });
      return new Response(JSON.stringify({ success: r.ok, ...r }), {
        status: r.ok ? 200 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Modo scan (cron)
    const s = await scan(supabase);
    return new Response(JSON.stringify({ success: s.ok, ...s }), {
      status: s.ok ? 200 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("[notify-pedido-concluido] Erro não tratado:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
