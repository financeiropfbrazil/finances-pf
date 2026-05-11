// supabase/functions/notify-aprovador-budget/index.ts
//
// Envia notificação por email ao aprovador designado de um projeto
// quando o Responsável clica "Enviar para Aprovação".
//
// Chamado pelo frontend (ProjetoRequisicoes.tsx) logo após a RPC
// enviar_budget_para_aprovacao retornar com sucesso.
//
// Payload esperado (POST JSON):
// {
//   projeto_id: string,
//   projeto_nome: string,
//   aprovador_email: string,
//   aprovador_nome: string,
//   responsavel_email: string,
//   total_budget: number,
//   orcamento: number,
//   count_pedidos: number
// }
//
// Retorno:
// {
//   success: boolean,
//   email_id?: string,   // ID do email no Resend
//   error?: string
// }

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const HUB_BASE_URL = "https://finance-pf.lovable.app";
const FROM_EMAIL = "P&F Financial Hub <noreply@notificapfbr.com.br>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  projeto_id: string;
  projeto_nome: string;
  aprovador_email: string;
  aprovador_nome: string;
  responsavel_email: string;
  total_budget: number;
  orcamento: number;
  count_pedidos: number;
}

// ── Formatadores ──
function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ── Template HTML ──
function buildEmailHtml(p: Payload): string {
  const link = `${HUB_BASE_URL}/projetos/${p.projeto_id}`;
  const aprovadorPrimeiroNome = (p.aprovador_nome || p.aprovador_email).split(" ")[0];

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Aprovação pendente — ${p.projeto_nome}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e40af 0%,#2563eb 100%);padding:32px 32px 24px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;letter-spacing:-0.02em;">P&amp;F Financial Hub</h1>
              <p style="margin:4px 0 0;color:#bfdbfe;font-size:13px;">Aprovação pendente de Budget</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">
                Olá, <strong>${aprovadorPrimeiroNome}</strong>.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3f3f46;">
                <strong>${p.responsavel_email}</strong> solicitou sua aprovação para o Budget do projeto abaixo.
              </p>

              <!-- Project Card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 4px;font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Projeto</p>
                    <p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">${p.projeto_nome}</p>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding:8px 0;border-top:1px solid #e4e4e7;font-size:13px;color:#52525b;">Orçamento</td>
                        <td style="padding:8px 0;border-top:1px solid #e4e4e7;font-size:14px;font-weight:600;text-align:right;color:#18181b;">${fmtBRL(p.orcamento)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-top:1px solid #e4e4e7;font-size:13px;color:#52525b;">Total do Budget</td>
                        <td style="padding:8px 0;border-top:1px solid #e4e4e7;font-size:14px;font-weight:600;text-align:right;color:#ca8a04;">${fmtBRL(p.total_budget)}</td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-top:1px solid #e4e4e7;font-size:13px;color:#52525b;">Pedidos de compra</td>
                        <td style="padding:8px 0;border-top:1px solid #e4e4e7;font-size:14px;font-weight:600;text-align:right;color:#18181b;">${p.count_pedidos}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:8px 0 16px;">
                    <a href="${link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 32px;border-radius:8px;">Revisar e Aprovar Budget</a>
                  </td>
                </tr>
              </table>

              <p style="margin:16px 0 0;font-size:13px;color:#71717a;line-height:1.5;text-align:center;">
                Ou copie o link no navegador:<br/>
                <a href="${link}" style="color:#2563eb;word-break:break-all;">${link}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#fafafa;border-top:1px solid #e4e4e7;padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#71717a;line-height:1.5;">
                P&amp;F Brasil — Financial Hub<br/>
                Este é um email automático. Não responda esta mensagem.
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

// ── Validação de input ──
function validatePayload(body: any): { valid: true; data: Payload } | { valid: false; error: string } {
  if (!body || typeof body !== "object") return { valid: false, error: "Body inválido" };

  const required = ["projeto_id", "projeto_nome", "aprovador_email", "total_budget", "orcamento", "count_pedidos"];
  for (const f of required) {
    if (body[f] === undefined || body[f] === null) {
      return { valid: false, error: `Campo obrigatório ausente: ${f}` };
    }
  }

  if (typeof body.aprovador_email !== "string" || !body.aprovador_email.includes("@")) {
    return { valid: false, error: "aprovador_email inválido" };
  }

  return {
    valid: true,
    data: {
      projeto_id: String(body.projeto_id),
      projeto_nome: String(body.projeto_nome),
      aprovador_email: String(body.aprovador_email),
      aprovador_nome: String(body.aprovador_nome || body.aprovador_email),
      responsavel_email: String(body.responsavel_email || "Não identificado"),
      total_budget: Number(body.total_budget) || 0,
      orcamento: Number(body.orcamento) || 0,
      count_pedidos: Number(body.count_pedidos) || 0,
    },
  };
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
    console.error("[notify-aprovador-budget] RESEND_API_KEY não configurada");
    return new Response(
      JSON.stringify({ success: false, error: "RESEND_API_KEY não configurada no Supabase Secrets" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = await req.json();
    const validation = validatePayload(body);
    if (!validation.valid) {
      return new Response(JSON.stringify({ success: false, error: validation.error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const p = validation.data;
    const html = buildEmailHtml(p);
    const subject = `[P&F Financial Hub] Aprovação pendente: ${p.projeto_nome}`;

    console.log("[notify-aprovador-budget] Enviando email", {
      to: p.aprovador_email,
      projeto: p.projeto_nome,
      projeto_id: p.projeto_id,
    });

    // ── Chamada ao Resend ──
    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [p.aprovador_email],
        subject,
        html,
        reply_to: p.responsavel_email !== "Não identificado" ? p.responsavel_email : undefined,
      }),
    });

    const resendData = await resendResp.json();

    if (!resendResp.ok) {
      console.error("[notify-aprovador-budget] Resend rejeitou:", resendData);
      return new Response(
        JSON.stringify({
          success: false,
          error: `Resend ${resendResp.status}: ${resendData?.message || JSON.stringify(resendData)}`,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log("[notify-aprovador-budget] Email enviado com sucesso", { id: resendData?.id });

    return new Response(JSON.stringify({ success: true, email_id: resendData?.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("[notify-aprovador-budget] Erro não tratado:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
