// supabase/functions/notify-aprovador-budget/index.ts
//
// Envia notificação por email ao aprovador designado de um projeto
// quando o Responsável clica "Enviar para Aprovação".
//
// V2 — Visual identidade P&F + lista de pedidos individuais (redeploy 2026-05-11)
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

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const HUB_BASE_URL = "https://finance-pf.lovable.app";
const FROM_EMAIL = "P&F Financial Hub <noreply@notificapfbr.com.br>";
const LOGO_URL = "https://hbtggrbauguukewiknew.supabase.co/storage/v1/object/public/brand-assets/pf-logo.png";

// Cores oficiais P&F
const COLOR = {
  white: "#FFFFFF",
  gray: "#7E8182",
  darkGray: "#5B5E5E",
  black: "#000000",
  red: "#E52726",
  darkRed: "#991717",
  bgSoft: "#F7F7F8", // cinza muito claro para backgrounds
  borderSoft: "#E4E4E7", // cinza para divisores
};

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

interface PedidoItem {
  sequencia: number;
  descricao: string;
  fornecedor_nome: string | null;
  valor_total: number;
}

// ── Formatadores ──
function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function escapeHtml(text: string): string {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Template HTML ──
function buildEmailHtml(p: Payload, pedidos: PedidoItem[]): string {
  const link = `${HUB_BASE_URL}/projetos/${p.projeto_id}`;
  const aprovadorPrimeiroNome = escapeHtml((p.aprovador_nome || p.aprovador_email).split(" ")[0]);
  const projetoNome = escapeHtml(p.projeto_nome);
  const responsavelEmail = escapeHtml(p.responsavel_email);

  // Saldo do orçamento após o budget
  const saldo = p.orcamento - p.total_budget;
  const pctBudget = p.orcamento > 0 ? Math.round((p.total_budget / p.orcamento) * 100) : 0;

  // Lista de pedidos
  const pedidosRows = pedidos
    .map(
      (ped, idx) => `
      <tr>
        <td style="padding:14px 12px 14px 0;border-top:${idx === 0 ? "none" : `1px solid ${COLOR.borderSoft}`};vertical-align:top;width:32px;">
          <div style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;background:${COLOR.bgSoft};border-radius:50%;font-size:12px;font-weight:600;color:${COLOR.darkGray};">${ped.sequencia}</div>
        </td>
        <td style="padding:14px 12px;border-top:${idx === 0 ? "none" : `1px solid ${COLOR.borderSoft}`};vertical-align:top;">
          <p style="margin:0;font-size:14px;font-weight:600;color:${COLOR.black};line-height:1.4;">${escapeHtml(ped.descricao)}</p>
          <p style="margin:2px 0 0;font-size:12px;color:${COLOR.gray};line-height:1.4;">${escapeHtml(ped.fornecedor_nome || "Sem fornecedor")}</p>
        </td>
        <td style="padding:14px 0 14px 12px;border-top:${idx === 0 ? "none" : `1px solid ${COLOR.borderSoft}`};vertical-align:top;text-align:right;white-space:nowrap;">
          <p style="margin:0;font-size:14px;font-weight:600;color:${COLOR.black};">${fmtBRL(ped.valor_total)}</p>
        </td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Aprovação pendente — ${projetoNome}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR.bgSoft};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${COLOR.black};">

  <!-- Preheader (preview no inbox) -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${COLOR.bgSoft};">
    ${responsavelEmail} pediu sua aprovação para o Budget de ${projetoNome} — ${fmtBRL(p.total_budget)} em ${p.count_pedidos} pedido(s).
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.bgSoft};padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background:${COLOR.white};border-radius:8px;overflow:hidden;border:1px solid ${COLOR.borderSoft};">

          <!-- Header com logo -->
          <tr>
            <td style="background:${COLOR.white};padding:32px 32px 20px;border-bottom:3px solid ${COLOR.red};text-align:center;">
              <img src="${LOGO_URL}" alt="P&amp;F Products &amp; Features" width="180" style="display:block;margin:0 auto;max-width:180px;height:auto;border:0;outline:none;" />
            </td>
          </tr>

          <!-- Título -->
          <tr>
            <td style="padding:32px 32px 8px;">
              <p style="margin:0;font-size:11px;font-weight:700;color:${COLOR.red};text-transform:uppercase;letter-spacing:0.12em;">Financial Hub · Aprovação pendente</p>
              <h1 style="margin:8px 0 0;font-size:24px;font-weight:700;color:${COLOR.black};line-height:1.25;letter-spacing:-0.01em;">
                Olá, ${aprovadorPrimeiroNome}.
              </h1>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding:12px 32px 24px;">
              <p style="margin:0;font-size:15px;line-height:1.6;color:${COLOR.darkGray};">
                <strong style="color:${COLOR.black};">${responsavelEmail}</strong> solicitou sua aprovação para o Budget do projeto <strong style="color:${COLOR.black};">${projetoNome}</strong>.
              </p>
            </td>
          </tr>

          <!-- Resumo financeiro -->
          <tr>
            <td style="padding:0 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR.bgSoft};border-radius:6px;">
                <tr>
                  <td style="padding:20px 20px 16px;">
                    <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:${COLOR.gray};text-transform:uppercase;letter-spacing:0.1em;">Resumo Financeiro</p>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:${COLOR.darkGray};">Orçamento do projeto</td>
                        <td style="padding:6px 0;font-size:14px;font-weight:600;text-align:right;color:${COLOR.black};">${fmtBRL(p.orcamento)}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;font-size:13px;color:${COLOR.darkGray};">Total do Budget</td>
                        <td style="padding:6px 0;font-size:14px;font-weight:700;text-align:right;color:${COLOR.red};">${fmtBRL(p.total_budget)}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;border-top:1px solid ${COLOR.borderSoft};font-size:13px;color:${COLOR.darkGray};">Saldo disponível</td>
                        <td style="padding:6px 0;border-top:1px solid ${COLOR.borderSoft};font-size:14px;font-weight:600;text-align:right;color:${COLOR.black};">${fmtBRL(saldo)}</td>
                      </tr>
                    </table>

                    <!-- Barra de progresso -->
                    <div style="margin-top:14px;height:6px;background:${COLOR.borderSoft};border-radius:3px;overflow:hidden;">
                      <div style="height:6px;background:${COLOR.red};width:${Math.min(pctBudget, 100)}%;"></div>
                    </div>
                    <p style="margin:6px 0 0;font-size:11px;color:${COLOR.gray};text-align:right;">
                      ${pctBudget}% do orçamento comprometido
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Lista de pedidos -->
          <tr>
            <td style="padding:0 32px 24px;">
              <p style="margin:0 0 12px;font-size:10px;font-weight:700;color:${COLOR.gray};text-transform:uppercase;letter-spacing:0.1em;">
                Pedidos de Compra (${pedidos.length})
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${COLOR.borderSoft};border-radius:6px;">
                ${pedidosRows || `<tr><td style="padding:20px;text-align:center;font-size:13px;color:${COLOR.gray};font-style:italic;">Sem pedidos.</td></tr>`}
                ${
                  pedidos.length > 0
                    ? `<tr>
                  <td colspan="2" style="padding:14px 12px 14px 0;border-top:2px solid ${COLOR.black};background:${COLOR.bgSoft};">
                    <p style="margin:0 0 0 12px;font-size:13px;font-weight:700;color:${COLOR.black};text-transform:uppercase;letter-spacing:0.05em;">Total</p>
                  </td>
                  <td style="padding:14px 12px;border-top:2px solid ${COLOR.black};background:${COLOR.bgSoft};text-align:right;white-space:nowrap;">
                    <p style="margin:0;font-size:15px;font-weight:700;color:${COLOR.red};">${fmtBRL(p.total_budget)}</p>
                  </td>
                </tr>`
                    : ""
                }
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:8px 32px 32px;text-align:center;">
              <a href="${link}" style="display:inline-block;background:${COLOR.red};color:${COLOR.white};text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:6px;letter-spacing:0.01em;">
                Revisar e Aprovar Budget
              </a>
              <p style="margin:16px 0 0;font-size:12px;color:${COLOR.gray};line-height:1.5;">
                Ou copie o link:<br/>
                <a href="${link}" style="color:${COLOR.darkGray};word-break:break-all;text-decoration:underline;">${link}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${COLOR.bgSoft};border-top:1px solid ${COLOR.borderSoft};padding:20px 32px;text-align:center;">
              <p style="margin:0;font-size:11px;color:${COLOR.gray};line-height:1.6;">
                <strong style="color:${COLOR.darkGray};">P&amp;F Brasil</strong> · Financial Hub<br/>
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

// ── Busca pedidos do projeto (service role para bypass RLS) ──
async function fetchPedidos(projetoId: string): Promise<PedidoItem[]> {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase
      .from("projeto_requisicoes")
      .select("sequencia, descricao, fornecedor_nome, valor_total")
      .eq("projeto_id", projetoId)
      .eq("fase", "budget")
      .order("sequencia", { ascending: true });

    if (error) {
      console.error("[fetchPedidos] erro:", error);
      return [];
    }

    return (data || []).map((p: any) => ({
      sequencia: Number(p.sequencia) || 0,
      descricao: String(p.descricao || ""),
      fornecedor_nome: p.fornecedor_nome,
      valor_total: Number(p.valor_total) || 0,
    }));
  } catch (err) {
    console.error("[fetchPedidos] exception:", err);
    return [];
  }
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

    // Busca lista de pedidos individuais
    const pedidos = await fetchPedidos(p.projeto_id);

    const html = buildEmailHtml(p, pedidos);
    const subject = `[P&F Financial Hub] Aprovação pendente: ${p.projeto_nome}`;

    console.log("[notify-aprovador-budget] Enviando email", {
      to: p.aprovador_email,
      projeto: p.projeto_nome,
      projeto_id: p.projeto_id,
      pedidos_count: pedidos.length,
    });

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

    return new Response(JSON.stringify({ success: true, email_id: resendData?.id, pedidos_count: pedidos.length }), {
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
