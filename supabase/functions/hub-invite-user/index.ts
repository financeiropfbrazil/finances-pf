// supabase/functions/hub-invite-user/index.ts
// redeploy trigger
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HUB_APP_URL = "https://finance-pf.lovable.app";
const RESEND_FROM = "P&F Financial Hub <noreply@notificapfbr.com.br>";

function generatePassword(length = 12): string {
  // 12 chars, mix maiúsculas + minúsculas + dígitos. Sem caracteres especiais
  // pra reduzir confusão visual quando ANA copia a senha do email.
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => chars[b % chars.length]).join("");
}

async function sendInviteEmail(
  resendApiKey: string,
  email: string,
  tempPassword: string,
  isExistingUser: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const subject = isExistingUser ? "Sua senha do P&F Financial Hub foi redefinida" : "Bem-vindo ao P&F Financial Hub";

  const greeting = isExistingUser
    ? "Sua senha foi redefinida pelo administrador."
    : "Sua conta foi criada pelo administrador.";

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1a1a1a;">
      <div style="background:#0f172a;color:#fff;padding:24px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:20px;">P&amp;F Financial Hub</h1>
      </div>
      <div style="background:#f8fafc;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:0;">
        <p>${greeting}</p>
        <p>Use as credenciais abaixo para acessar:</p>
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:16px;margin:16px 0;font-family:'SF Mono',Monaco,Consolas,monospace;">
          <div style="font-size:12px;color:#64748b;margin-bottom:4px;">EMAIL</div>
          <div style="font-size:14px;margin-bottom:12px;">${email}</div>
          <div style="font-size:12px;color:#64748b;margin-bottom:4px;">SENHA TEMPORÁRIA</div>
          <div style="font-size:18px;font-weight:600;letter-spacing:1px;">${tempPassword}</div>
        </div>
        <p style="background:#fef3c7;border-left:3px solid #f59e0b;padding:12px;font-size:13px;">
          Por segurança, você será solicitado a definir uma nova senha no primeiro acesso.
        </p>
        <a href="${HUB_APP_URL}" style="display:inline-block;background:#0f172a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">Acessar o Hub</a>
        <p style="font-size:12px;color:#64748b;margin-top:24px;">
          Se você não esperava este email, pode ignorá-lo com segurança.
        </p>
      </div>
    </div>
  `;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [email],
      subject,
      html,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    return { ok: false, error: `Resend ${resp.status}: ${errBody.slice(0, 300)}` };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SB_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY não configurada nas Secrets" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Validar caller é admin do Hub financeiro
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: caller },
      error: authError,
    } = await callerClient.auth.getUser();

    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (!callerProfile?.is_admin) {
      return new Response(JSON.stringify({ error: "Apenas admins podem convidar usuários" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Parse body
    const body = await req.json();
    const email = String(body?.email ?? "")
      .toLowerCase()
      .trim();
    const roleCode = String(body?.role_code ?? "").trim();

    if (!email || !email.includes("@")) {
      return new Response(JSON.stringify({ error: "Email inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!roleCode) {
      return new Response(JSON.stringify({ error: "Papel é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Confere que role existe
    const { data: roleRow } = await adminClient
      .from("hub_roles")
      .select("id, codigo")
      .eq("codigo", roleCode)
      .maybeSingle();

    if (!roleRow) {
      return new Response(JSON.stringify({ error: `Papel "${roleCode}" não encontrado` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Gerar senha temporária
    const tempPassword = generatePassword();

    // 4. Detectar se user já existe
    const {
      data: { users: existingUsers },
    } = await adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const existingAuthUser = existingUsers?.find((u: any) => (u.email ?? "").toLowerCase() === email);

    let userId: string;
    let isExistingUser = false;

    if (existingAuthUser) {
      // User existe — reseta senha + força troca
      isExistingUser = true;
      userId = existingAuthUser.id;
      const { error: updateErr } = await adminClient.auth.admin.updateUserById(userId, {
        password: tempPassword,
        email_confirm: true,
      });
      if (updateErr) {
        return new Response(JSON.stringify({ error: `Falha ao resetar senha: ${updateErr.message}` }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      // User não existe — cria
      const { data: newUserData, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: email.split("@")[0] },
      });

      if (createErr || !newUserData?.user?.id) {
        return new Response(
          JSON.stringify({
            error: `Falha ao criar usuário: ${createErr?.message ?? "resposta vazia"}`,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      userId = newUserData.user.id;
    }

    // 5. Upsert profile com must_change_password = true
    await adminClient.from("profiles").upsert(
      {
        user_id: userId,
        email,
        full_name: email.split("@")[0],
        is_admin: roleCode === "admin",
        is_active: true,
        must_change_password: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    // 6. Atribuir role via RPC
    const { error: roleErr } = await adminClient.rpc("hub_assign_role", {
      p_target_user_id: userId,
      p_role_code: roleCode,
      p_motivo: isExistingUser ? "Reenvio de convite" : "Criação inicial via convite",
    });

    if (roleErr) {
      console.warn("[hub-invite-user] hub_assign_role falhou:", roleErr.message);
      // Não fazemos rollback do user — admin pode atribuir role manual depois
    }

    // 7. Enviar email Resend
    const emailResult = await sendInviteEmail(resendApiKey, email, tempPassword, isExistingUser);

    if (!emailResult.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          user_id: userId,
          email,
          email_sent: false,
          error: emailResult.error,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        email,
        is_existing_user: isExistingUser,
        role_assigned: !roleErr,
        email_sent: true,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[hub-invite-user] erro:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
