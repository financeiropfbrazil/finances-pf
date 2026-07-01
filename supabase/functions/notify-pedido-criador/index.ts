// supabase/functions/notify-pedido-criador/index.ts
//
// Envia email a QUEM LANÇOU o Pedido de Compra no Hub (criado_por_user_id)
// quando o pedido é 100% aprovado (aprovado='Total' + status_aprovacao='Finalizada').
//
// Irmã da notify-pedido-aprovado (que avisa o REQUISITANTE). Esta avisa o CRIADOR.
//
// Dois modos:
//   - Scan  (body {} ou sem pedido_id): varre todos os pedidos elegíveis e dispara os pendentes.
//                                       É o modo do cron.
//   - Single(body { pedido_id }): processa 1 pedido. force_test / override_email p/ teste manual.
//
// Dedup + anti-duplo: compras_pedidos_emails_log.
//   - tipo próprio:  'aprovacao_criador'
//   - anti-duplo:    se JÁ existe email de sucesso p/ esse pedido no MESMO endereço
//                    (qualquer tipo, inclui 'aprovacao_finalizada' do requisitante) → pula.
//   - backlog:       linhas 'backlog-neutralizado' (tipo 'aprovacao_criador') fazem o scan pular
//                    os pedidos já aprovados antes do go-live.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HUB_BASE_URL = "https://finance-pf.lovable.app";
const FROM_EMAIL = "P&F Financial Hub <noreply@notificapfbr.com.br>";
const LOGO_URL = "https://hbtggrbauguukewiknew.supabase.co/storage/v1/object/public/brand-assets/pf-logo.png";
const TIPO = "aprovacao_criador";

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
  cnpj_entidade: string | null;
  proximo_aprovador: string | null;
  numero_req_comp: string | null;
  status_aprovacao: string | null;
  aprovado: string | null;
  criado_no_hub: boolean | null;
  criado_por_user_id: string | null;
  criado_por_nome: string | null;
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

// "elisangela.silva" -> "Elisangela Silva"; "HUGO.MAFFEI" -> "Hugo Maffei"; "Pedro Scrignoli" -> "Pedro Scrignoli"
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

// ── Template HTML (mesma identidade visual da notify-pedido-aprovado) ──
function buildEmailHtml(ped: PedidoData, criadorNome: string): string {
  const link = `${HUB_BASE_URL}/suprimentos/pedidos/${ped.id}`;
  const primeiroNome = escapeHtml((criadorNome || "").split(" ")[0] || "");
  const fornecedor = escapeHtml(ped.nome_entidade || "—");
  const aprovador = escapeHtml(prettifyNome(ped.proximo_aprovador) || "—");
  const numeroReq = ped.numero_req_comp ? escapeHtml(ped.numero_req_comp) : null;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Seu pedido foi aprovado</title>
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
                ✓ Pedido aprovado
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
                    ? `O pedido <strong>Nº ${escapeHtml(ped.numero)}</strong> que você lançou (a partir da requisição <strong>Nº ${numeroReq}</strong>) foi aprovado.`
                    : `O pedido <strong>Nº ${escapeHtml(ped.numero)}</strong> que você lançou foi aprovado.`
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
                      <tr>
                        <td style="padding:14px 0 0 0;border-top:1px solid ${COLOR.borderSoft};">
                          <div style="font-size:11px;color:${COLOR.gray};letter-spacing:0.5px;text-transform:uppercase;margin-bottom:4px;">Aprovado por</div>
                          <div style="font-size:15px;font-weight:600;color:${COLOR.black};">${aprovador}</div>
                        </td>
                      </tr>
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
                Este pedido entrou na fila de execução de compras. Você receberá novas atualizações conforme o processo avance.
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
      "id, numero, valor_total, nome_entidade, cnpj_entidade, proximo_aprovador, numero_req_comp, status_aprovacao, aprovado, criado_no_hub, criado_por_user_id, criado_por_nome",
    )
    .eq("id", pedidoId)
    .single();
  if (error || !data) {
    console.error("[buscarPedido] erro:", error);
    return null;
  }
  return data as PedidoData;
}

// ── Resolver e-mail + nome do CRIADOR ──
async function resolverCriador(
  supabase: any,
  ped: PedidoData,
  overrideEmail: string | null,
): Promise<{ email: string; nome: string } | null> {
  if (overrideEmail) {
    return { email: overrideEmail, nome: prettifyNome(ped.criado_por_nome) || "Teste" };
  }
  if (!ped.criado_por_user_id) {
    console.log(`[resolverCriador] Pedido ${ped.numero} sem criado_por_user_id — não envia`);
    return null;
  }
  const { data: userInfo, error } = await supabase.auth.admin.getUserById(ped.criado_por_user_id);
  if (error || !userInfo?.user?.email) {
    console.error("[resolverCriador] erro ao buscar user:", error);
    return null;
  }
  const nome = prettifyNome(ped.criado_por_nome) || userInfo.user.email;
  return { email: userInfo.user.email, nome };
}

// ── Dedup + anti-duplo (mesmo endereço, qualquer tipo; ou já processado nesse tipo) ──
async function jaProcessado(supabase: any, pedidoId: string, email: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("compras_pedidos_emails_log")
    .select("tipo, destinatario, sucesso")
    .eq("pedido_id", pedidoId)
    .eq("sucesso", true);
  if (error) {
    console.error("[jaProcessado] erro ao consultar log:", error);
    return false; // em caso de erro, tenta enviar
  }
  return (data || []).some((l: any) => l.tipo === TIPO || l.destinatario === email);
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

  // Elegibilidade (a menos que teste)
  if (!forceTest && !overrideEmail) {
    const aprovadoOk = ped.aprovado === "Total" && ped.status_aprovacao === "Finalizada";
    if (!aprovadoOk || ped.criado_no_hub !== true) {
      return { ok: true, skipped: "nao_elegivel" };
    }
  }

  const criador = await resolverCriador(supabase, ped, overrideEmail);
  if (!criador) return { ok: true, skipped: "sem_destinatario" };

  if (!forceTest && !overrideEmail) {
    if (await jaProcessado(supabase, ped.id, criador.email)) {
      return { ok: true, skipped: "ja_enviado_ou_duplicado" };
    }
  }

  const html = buildEmailHtml(ped, criador.nome);
  const subject = `[P&F Financial Hub] Seu pedido ${ped.numero} foi aprovado`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: [criador.email], subject, html }),
  });
  const resendData = await resp.json();

  if (!resp.ok) {
    const errMsg = `Resend ${resp.status}: ${resendData?.message || JSON.stringify(resendData)}`;
    console.error("[processarPedido] Resend rejeitou:", resendData);
    await registrarLog(supabase, ped.id, criador.email, null, false, errMsg);
    return { ok: false, error: errMsg, to: criador.email };
  }

  const emailId = resendData?.id || null;
  await registrarLog(supabase, ped.id, criador.email, emailId, true, null);
  console.log("[processarPedido] enviado", { pedido: ped.numero, to: criador.email, email_id: emailId });
  return { ok: true, email_id: emailId, to: criador.email };
}

// ── Modo scan: varre todos os elegíveis e processa os pendentes ──
async function scan(supabase: any): Promise<any> {
  // candidatos (positivos). max-rows=1000: hoje bem abaixo; paginar com .range() se crescer.
  const { data: peds, error } = await supabase
    .from("compras_pedidos")
    .select("id")
    .eq("criado_no_hub", true)
    .eq("aprovado", "Total")
    .eq("status_aprovacao", "Finalizada")
    .not("criado_por_user_id", "is", null);

  if (error) {
    console.error("[scan] erro ao listar candidatos:", error);
    return { ok: false, error: error.message };
  }

  const ids: string[] = (peds || []).map((p: any) => p.id);
  if (ids.length === 0) return { ok: true, candidatos: 0, enviados: 0, pulados: 0 };

  // já feitos (tipo aprovacao_criador com sucesso, inclui backlog-neutralizado)
  const { data: logs } = await supabase
    .from("compras_pedidos_emails_log")
    .select("pedido_id")
    .eq("tipo", TIPO)
    .eq("sucesso", true)
    .in("pedido_id", ids);
  const feitos = new Set((logs || []).map((l: any) => l.pedido_id));

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
    console.error("[notify-pedido-criador] Erro não tratado:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
