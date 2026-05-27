// supabase/functions/notify-pedido-aprovado/index.ts
//
// Envia email ao REQUISITANTE quando um Pedido de Compra é aprovado
// (status_aprovacao = "Finalizada" + aprovado = "Total").
//
// Chamado pelo cron `sync-compras-status-cron` quando detecta a transição
// de aprovação finalizada. Também aceita modo de teste manual.
//
// Payload esperado (POST JSON):
// {
//   pedido_id: string (uuid),
//   force_test?: boolean   // se true, ignora dedup e envia mesmo se já enviou
// }
//
// Como funciona:
// 1. Busca o pedido completo (numero, valor, fornecedor, aprovador)
// 2. Busca a requisição origem (numero_req_comp → requisitante_user_id)
// 3. Busca email do requisitante (auth.users.email)
// 4. Se já enviou email antes pra esse pedido → skip (a menos que force_test=true)
// 5. Monta HTML com identidade visual P&F
// 6. POST pra Resend
// 7. Registra na tabela compras_pedidos_emails_log

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HUB_BASE_URL = "https://finance-pf.lovable.app";
const FROM_EMAIL = "P&F Financial Hub <noreply@notificapfbr.com.br>";
const LOGO_URL = "https://hbtggrbauguukewiknew.supabase.co/storage/v1/object/public/brand-assets/pf-logo.png";

// Cores oficiais P&F (mesmas do notify-aprovador-budget)
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
  codigo_empresa_filial_req_comp: string | null;
  status_aprovacao: string | null;
  aprovado: string | null;
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

// ── Template HTML do email ──
function buildEmailHtml(ped: PedidoData, requisitanteNome: string): string {
  const link = `${HUB_BASE_URL}/suprimentos/pedidos/${ped.id}`;
  const primeiroNome = escapeHtml((requisitanteNome || "").split(" ")[0] || "");
  const fornecedor = escapeHtml(ped.nome_entidade || "—");
  const aprovador = escapeHtml(ped.proximo_aprovador || "—");
  const numeroReq = ped.numero_req_comp ? escapeHtml(ped.numero_req_comp) : null;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pedido aprovado</title>
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
                ${numeroReq ? `O pedido <strong>Nº ${escapeHtml(ped.numero)}</strong> (gerado a partir da sua requisição <strong>Nº ${numeroReq}</strong>) foi aprovado.` : `O pedido <strong>Nº ${escapeHtml(ped.numero)}</strong> foi aprovado.`}
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

// ── Buscar dados do pedido + requisitante ──
async function buscarDadosPedido(
  supabase: any,
  pedidoId: string,
  overrideEmail: string | null = null,
): Promise<{ pedido: PedidoData; requisitanteEmail: string; requisitanteNome: string } | null> {
  const { data: ped, error: errPed } = await supabase
    .from("compras_pedidos")
    .select(
      "id, numero, valor_total, nome_entidade, cnpj_entidade, proximo_aprovador, numero_req_comp, codigo_empresa_filial_req_comp, status_aprovacao, aprovado",
    )
    .eq("id", pedidoId)
    .single();

  if (errPed || !ped) {
    console.error("[buscarDadosPedido] erro ao buscar pedido:", errPed);
    return null;
  }

  // ⭐ MODO DE TESTE: se override_email foi passado, usa ele direto
  if (overrideEmail) {
    console.log(`[buscarDadosPedido] Modo override — enviando para ${overrideEmail}`);
    return {
      pedido: ped as PedidoData,
      requisitanteEmail: overrideEmail,
      requisitanteNome: "Teste",
    };
  }

  // Pedido sem req origem → não envia email
  if (!ped.numero_req_comp) {
    console.log(`[buscarDadosPedido] Pedido ${ped.numero} sem req origem — não envia email`);
    return null;
  }

  

  // Busca requisição origem
  const { data: req, error: errReq } = await supabase
    .from("compras_requisicoes")
    .select("requisitante_user_id")
    .eq("numero_alvo", ped.numero_req_comp)
    .eq("codigo_empresa_filial", ped.codigo_empresa_filial_req_comp)
    .maybeSingle();

  if (errReq || !req?.requisitante_user_id) {
    console.log(
      `[buscarDadosPedido] Pedido ${ped.numero} — req ${ped.numero_req_comp} sem requisitante_user_id`,
    );
    return null;
  }

  // Busca email do requisitante (auth.users.email)
  const { data: userInfo, error: errUser } = await supabase.auth.admin.getUserById(req.requisitante_user_id);

  if (errUser || !userInfo?.user?.email) {
    console.error("[buscarDadosPedido] erro ao buscar user:", errUser);
    return null;
  }

  // Busca nome do requisitante via profiles
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", req.requisitante_user_id)
    .maybeSingle();

  return {
    pedido: ped as PedidoData,
    requisitanteEmail: userInfo.user.email,
    requisitanteNome: profile?.full_name || userInfo.user.email,
  };
}

// ── Verifica se email já foi enviado pra esse pedido ──
async function jaEnviou(supabase: any, pedidoId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("compras_pedidos_emails_log")
    .select("id")
    .eq("pedido_id", pedidoId)
    .eq("tipo", "aprovacao_finalizada")
    .limit(1);

  if (error) {
    console.error("[jaEnviou] erro ao consultar log:", error);
    return false; // em caso de erro, tenta enviar
  }

  return (data && data.length > 0);
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
    tipo: "aprovacao_finalizada",
    destinatario,
    resend_email_id: emailId,
    sucesso,
    erro,
  });
}

// ── Handler ──
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Método não permitido" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!RESEND_API_KEY) {
    console.error("[notify-pedido-aprovado] RESEND_API_KEY não configurada");
    return new Response(
      JSON.stringify({ success: false, error: "RESEND_API_KEY não configurada no Supabase Secrets" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json();
    const pedidoId: string | undefined = body?.pedido_id;
    const forceTest: boolean = body?.force_test === true;
const overrideEmail: string | null = body?.override_email || null;

    if (!pedidoId) {
      return new Response(JSON.stringify({ success: false, error: "pedido_id obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Dedup: já enviou?
    if (!forceTest && !overrideEmail) {
      const enviado = await jaEnviou(supabase, pedidoId);
      if (enviado) {
        console.log(`[notify-pedido-aprovado] Já enviou email para pedido ${pedidoId} — skip`);
        return new Response(JSON.stringify({ success: true, skipped: true, reason: "already_sent" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 2. Busca dados
    const dados = await buscarDadosPedido(supabase, pedidoId, overrideEmail);
    if (!dados) {
      // Razões: pedido sem req origem, sem requisitante, sem email
      // Não é erro fatal, registra mas não falha
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "no_recipient" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { pedido, requisitanteEmail, requisitanteNome } = dados;

    // 3. Monta HTML
    const html = buildEmailHtml(pedido, requisitanteNome);
    const subject = `[P&F Financial Hub] Pedido ${pedido.numero} aprovado`;

    console.log("[notify-pedido-aprovado] Enviando email", {
      pedido_id: pedido.id,
      pedido_numero: pedido.numero,
      to: requisitanteEmail,
      force_test: forceTest,
    });

    // 4. POST Resend
    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [requisitanteEmail],
        subject,
        html,
      }),
    });

    const resendData = await resendResp.json();

    if (!resendResp.ok) {
      const errMsg = `Resend ${resendResp.status}: ${resendData?.message || JSON.stringify(resendData)}`;
      console.error("[notify-pedido-aprovado] Resend rejeitou:", resendData);
      await registrarLog(supabase, pedido.id, requisitanteEmail, null, false, errMsg);
      return new Response(JSON.stringify({ success: false, error: errMsg }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Sucesso — registra log
    const emailId = resendData?.id || null;
    await registrarLog(supabase, pedido.id, requisitanteEmail, emailId, true, null);

    console.log("[notify-pedido-aprovado] Email enviado", { email_id: emailId });

    return new Response(
      JSON.stringify({
        success: true,
        email_id: emailId,
        sent_to: requisitanteEmail,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("[notify-pedido-aprovado] Erro não tratado:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
