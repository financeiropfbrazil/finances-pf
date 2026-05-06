// =====================================================================
// supabase/functions/admin-create-user-fin/index.ts
//
// Edge Function: criação de usuário do Financial Hub via senha temporária
// Padrão: equivalente ao bulk-invite-users v3 do Hub IA, mas:
// - single user (não bulk)
// - tabela profiles com user_id (não id)
// - role atribuída via RPC hub_assign_role (RBAC novo)
// - identidade visual Financial Hub (azul, não vermelho)
//
// Fluxo:
//   1. Valida JWT + admin role
//   2. Tenta createUser com senha temporária
//   3. Se já existe, faz updateUserById com senha nova (comportamento "substituir")
//   4. Upsert profile com must_change_password=true
//   5. Chama RPC hub_assign_role
//   6. Manda email via Resend com credenciais visíveis
//   7. Retorna { success, user_id } ou { error }
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// =====================================================================
// CONFIGURAÇÃO
// =====================================================================

const FROM_NAME = "Financial Hub P&F";
const FROM_EMAIL = "convites@notificapfbr.com.br";
const APP_URL = "https://finance-pf.lovable.app";
const PRIMARY_COLOR = "#1e40af"; // Azul Financial Hub (vs vermelho do Hub IA)

// =====================================================================
// HANDLER
// =====================================================================

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Validações de envvars
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return jsonResponse({ error: "Servidor mal configurado (Supabase env vars ausentes)" }, 500);
    }
    if (!resendApiKey) {
      return jsonResponse({ error: "Servidor mal configurado (RESEND_API_KEY ausente)" }, 500);
    }

    // 2. Valida JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Token de autenticação ausente" }, 401);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
      error: callerError,
    } = await callerClient.auth.getUser();
    if (callerError || !caller) {
      return jsonResponse({ error: "Token inválido ou expirado" }, 401);
    }

    // 3. Confere admin role (consultando profiles via service role)
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("is_admin, is_active")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (profileError) {
      console.error("[ADMIN_CREATE_USER_FIN] Erro ao consultar profile do caller:", profileError);
      return jsonResponse({ error: "Erro ao validar permissão do solicitante" }, 500);
    }
    if (!callerProfile?.is_admin || !callerProfile.is_active) {
      return jsonResponse({ error: "Apenas administradores podem criar usuários" }, 403);
    }

    // 4. Parse e validação do body
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "Body inválido (JSON esperado)" }, 400);
    }

    const email = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const fullName = String(body.full_name ?? "").trim();
    const roleCode = String(body.role_code ?? "").trim();

    if (!isValidEmailFormat(email)) {
      return jsonResponse({ error: "Email com formato inválido" }, 400);
    }
    if (!fullName) {
      return jsonResponse({ error: "Nome completo é obrigatório" }, 400);
    }
    if (!roleCode) {
      return jsonResponse({ error: "Papel inicial (role_code) é obrigatório" }, 400);
    }

    // 5. Confere se o role existe (segurança extra)
    const { data: roleExists } = await adminClient
      .from("hub_roles")
      .select("id, codigo")
      .eq("codigo", roleCode)
      .maybeSingle();

    if (!roleExists) {
      return jsonResponse({ error: `Papel "${roleCode}" não encontrado` }, 400);
    }

    // 6. Gera senha temporária forte e amigável
    const tempPassword = generateFriendlyPassword();

    // 7. Tenta criar user OU atualiza senha se já existir
    let userId: string | null = null;
    let userExisted = false;

    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError) {
      const msg = String(createError.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("exists") || msg.includes("registered")) {
        // User já existe — busca o user_id pra atualizar senha
        userExisted = true;
        const {
          data: { users },
        } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
        const existing = users?.find((u: any) => (u.email ?? "").toLowerCase() === email);

        if (!existing?.id) {
          return jsonResponse(
            {
              error: "Usuário existe em auth.users mas não foi possível localizar o user_id",
            },
            500,
          );
        }

        userId = existing.id;
        const { error: updatePwdError } = await adminClient.auth.admin.updateUserById(userId, {
          password: tempPassword,
          user_metadata: { full_name: fullName },
        });

        if (updatePwdError) {
          return jsonResponse(
            {
              error: `Falha ao atualizar senha do usuário existente: ${updatePwdError.message}`,
            },
            500,
          );
        }
      } else {
        return jsonResponse(
          {
            error: `Erro ao criar usuário: ${createError.message}`,
          },
          500,
        );
      }
    } else {
      userId = createData?.user?.id || null;
      if (!userId) {
        return jsonResponse(
          {
            error: "Resposta vazia da Auth API ao criar usuário",
          },
          500,
        );
      }
    }

    // 8. Upsert profile (preserva is_admin se já existir)
    const { error: profileUpsertError } = await adminClient.from("profiles").upsert(
      {
        user_id: userId,
        full_name: fullName,
        email,
        is_active: true,
        must_change_password: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (profileUpsertError) {
      console.error("[ADMIN_CREATE_USER_FIN] Erro upsert profile:", profileUpsertError);
      // Não aborta — user foi criado, profile pode ser corrigido manualmente
    }

    // 9. Atribui role via RPC
    const { error: roleError } = await adminClient.rpc("hub_assign_role", {
      p_target_user_id: userId,
      p_role_code: roleCode,
      p_motivo: userExisted
        ? "Re-convite — senha temporária gerada"
        : "Atribuído durante criação do usuário via convite",
    });

    if (roleError) {
      console.error("[ADMIN_CREATE_USER_FIN] Erro RPC hub_assign_role:", roleError);
      // Não aborta — role pode ser atribuída manualmente
    }

    // 10. Envia email com a senha
    const emailResult = await sendCredentialsEmail({
      resendApiKey,
      to: email,
      nome: fullName,
      tempPassword,
      isExistingUser: userExisted,
    });

    if (!emailResult.success) {
      // User criado mas email falhou — admin precisa saber
      return jsonResponse(
        {
          success: true,
          user_id: userId,
          email_sent: false,
          warning: `Usuário criado, mas email falhou: ${emailResult.error}. Senha temporária: ${tempPassword}`,
        },
        200,
      );
    }

    // 11. Sucesso completo
    return jsonResponse(
      {
        success: true,
        user_id: userId,
        user_existed: userExisted,
        email_sent: true,
        resend_message_id: emailResult.messageId,
      },
      200,
    );
  } catch (err) {
    console.error("[ADMIN_CREATE_USER_FIN] Erro inesperado:", err);
    return jsonResponse({ error: (err as Error).message || "Erro interno" }, 500);
  }
});

// =====================================================================
// ENVIO DE EMAIL VIA RESEND
// =====================================================================

async function sendCredentialsEmail(args: {
  resendApiKey: string;
  to: string;
  nome: string;
  tempPassword: string;
  isExistingUser: boolean;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { resendApiKey, to, nome, tempPassword, isExistingUser } = args;

  const subject = isExistingUser
    ? "[Financial Hub] Sua nova senha temporária de acesso"
    : "[Financial Hub] Suas credenciais de acesso à plataforma";

  const html = buildEmailHtml({ nome, email: to, tempPassword, isExistingUser });

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [to],
        reply_to: FROM_EMAIL,
        subject,
        html,
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      return { success: true, messageId: data.id };
    }

    const errorBody = await resp.text();
    return {
      success: false,
      error: `Resend ${resp.status}: ${errorBody.slice(0, 300)}`,
    };
  } catch (err) {
    return {
      success: false,
      error: `Erro de rede: ${(err as Error).message}`,
    };
  }
}

// =====================================================================
// TEMPLATE HTML — Tema Azul Financial Hub
// =====================================================================

function buildEmailHtml(args: { nome: string; email: string; tempPassword: string; isExistingUser: boolean }): string {
  const { nome, email, tempPassword, isExistingUser } = args;

  const greeting = isExistingUser
    ? "Foi gerada uma nova senha temporária para sua conta no Financial Hub."
    : "Você foi convidado para acessar o <strong>Financial Hub</strong> — a plataforma corporativa de gestão financeira da P&F Brasil.";

  const featuresBlock = !isExistingUser
    ? `
      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#333;">
        Com o Financial Hub você pode:
      </p>
      <ul style="margin:0 0 24px 0;padding-left:20px;font-size:15px;line-height:1.8;color:#333;">
        <li>Criar e acompanhar Requisições de Compra</li>
        <li>Consultar pedidos, notas fiscais e fornecedores</li>
        <li>Acessar relatórios de estoque e ativos imobilizados</li>
        <li>Gerenciar contas a pagar e contas a receber</li>
      </ul>
    `
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Financial Hub — P&F Brasil</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:Calibri,Arial,Helvetica,sans-serif;color:#333;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f5f5f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <tr>
            <td style="background-color:${PRIMARY_COLOR};padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:bold;letter-spacing:1px;">
                Financial Hub
              </h1>
              <p style="margin:6px 0 0 0;color:#ffffff;font-size:14px;opacity:0.95;">
                P&amp;F Brasil — Gestão Financeira Corporativa
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:40px 40px 20px 40px;">
              <p style="margin:0 0 16px 0;font-size:18px;color:#333;">
                Olá, <strong>${escapeHtml(nome)}</strong>
              </p>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#333;">
                ${greeting}
              </p>

              ${featuresBlock}

              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#333;">
                <strong>Suas credenciais de acesso:</strong>
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;margin:0 0 24px 0;">
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 8px 0;font-size:13px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">📧 E-mail</p>
                    <p style="margin:0 0 16px 0;font-size:16px;color:#333;font-family:'Courier New',monospace;background-color:#fff;padding:8px 12px;border-radius:4px;border:1px solid #e0e0e0;">
                      ${escapeHtml(email)}
                    </p>
                    <p style="margin:0 0 8px 0;font-size:13px;color:#666;text-transform:uppercase;letter-spacing:0.5px;">🔑 Senha temporária</p>
                    <p style="margin:0;font-size:18px;color:${PRIMARY_COLOR};font-family:'Courier New',monospace;background-color:#fff;padding:10px 12px;border-radius:4px;border:2px solid ${PRIMARY_COLOR};font-weight:bold;letter-spacing:1px;">
                      ${escapeHtml(tempPassword)}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#333;">
                Para acessar:
              </p>
              <ol style="margin:0 0 24px 0;padding-left:20px;font-size:15px;line-height:1.8;color:#333;">
                <li>Acesse <a href="${APP_URL}" style="color:${PRIMARY_COLOR};text-decoration:none;font-weight:bold;">${APP_URL.replace("https://", "")}</a></li>
                <li>Faça login com o e-mail e senha temporária acima</li>
                <li>No primeiro acesso, você definirá sua senha definitiva</li>
              </ol>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td align="center">
                    <a href="${APP_URL}/login"
                       style="display:inline-block;background-color:${PRIMARY_COLOR};color:#ffffff;padding:16px 40px;text-decoration:none;font-weight:bold;font-size:16px;border-radius:6px;letter-spacing:0.5px;">
                      ACESSAR FINANCIAL HUB
                    </a>
                  </td>
                </tr>
              </table>

              <div style="background-color:#fff8e6;border-left:4px solid #f5a623;padding:12px 16px;margin:0 0 24px 0;border-radius:4px;">
                <p style="margin:0;font-size:13px;color:#7a5a00;line-height:1.5;">
                  <strong>⚠️ Importante:</strong> Esta senha é <strong>temporária</strong>. Por segurança, você será obrigado a defini-la no primeiro acesso. Não compartilhe estas credenciais.
                </p>
              </div>

              <hr style="border:none;border-top:1px solid #e8e8e8;margin:24px 0;">

              <p style="margin:0 0 8px 0;font-size:13px;color:#7E8182;line-height:1.5;">
                <strong>Dúvidas técnicas (acesso, senha, erros):</strong><br>
                Guilherme Oliveira — TI: <a href="mailto:guilherme.oliveira@pfbrazil.com" style="color:#5B5E5E;">guilherme.oliveira@pfbrazil.com</a>
              </p>
              <p style="margin:0 0 8px 0;font-size:13px;color:#7E8182;line-height:1.5;">
                <strong>Dúvidas de uso:</strong><br>
                Pedro Scrignoli — Controladoria: <a href="mailto:pedro.scrignoli@pfbrazil.com" style="color:#5B5E5E;">pedro.scrignoli@pfbrazil.com</a>
              </p>
            </td>
          </tr>

          <tr>
            <td style="background-color:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #e8e8e8;">
              <p style="margin:0 0 4px 0;font-size:12px;color:#7E8182;">
                Este é um email automático. Respostas a este endereço não serão lidas.
              </p>
              <p style="margin:0;font-size:11px;color:#a0a0a0;">
                Financial Hub — P&amp;F Brasil | Desenvolvido pela Controladoria
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

// =====================================================================
// UTILITÁRIOS
// =====================================================================

/**
 * Gera senha temporária forte e amigável.
 * Formato: FinHub-X9k2-mP4z (15 chars: prefixo + 4 alphanum + 4 alphanum)
 */
function generateFriendlyPassword(): string {
  const upperChars = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem I e O
  const lowerChars = "abcdefghjkmnpqrstuvwxyz"; // sem i, l, o
  const digits = "23456789"; // sem 0 e 1

  function pickN(chars: string, n: number): string {
    let out = "";
    const arr = new Uint8Array(n);
    crypto.getRandomValues(arr);
    for (let i = 0; i < n; i++) {
      out += chars[arr[i] % chars.length];
    }
    return out;
  }

  const block1 = pickN(upperChars, 1) + pickN(digits, 1) + pickN(lowerChars, 1) + pickN(digits, 1);
  const block2 = pickN(lowerChars, 1) + pickN(upperChars, 1) + pickN(digits, 1) + pickN(lowerChars, 1);

  return `FinHub-${block1}-${block2}`;
}

function isValidEmailFormat(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return regex.test(email);
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
