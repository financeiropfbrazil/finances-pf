// supabase/functions/hub-reset-user-password/index.ts
//
// Permite que um admin gere uma nova senha temporária para um user existente
// do Hub Financial. Útil para casos onde o email de convite/reset não chegou
// (ex: quarentena MS365) e o admin precisa enviar manualmente via Teams/Slack.
//
// A senha gerada:
//  - Nunca é persistida no banco
//  - Trafega apenas em memória (Edge → Frontend → clipboard)
//  - Força must_change_password=true (user troca no primeiro login)
//  - Registra entrada na hub_user_roles_audit por motivo de auditoria
//
// Payload (POST JSON):
//   { target_user_id: string }
//
// Retorno:
//   { success: true, email: string, temp_password: string, target_user_id: string }
//
// Segurança:
//   - JWT obrigatório (caller precisa ser admin)
//   - Caller validado via profiles.is_admin === true
//   - Não permite admin resetar a própria senha (use o fluxo /reset-password)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generatePassword(length = 12): string {
  // 12 chars, alphanumeric only — mesma estratégia do hub-invite-user
  // pra reduzir confusão visual quando o admin envia via Teams/Slack
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => chars[b % chars.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── 1. Auth header ──
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

    // ── 2. Valida caller é admin ──
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
      return new Response(JSON.stringify({ error: "Apenas administradores podem resetar senhas de outros usuários" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 3. Parse body ──
    const body = await req.json();
    const targetUserId = String(body?.target_user_id ?? "").trim();

    if (!targetUserId) {
      return new Response(JSON.stringify({ error: "target_user_id é obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 4. Bloqueia self-reset (admin deve usar /reset-password) ──
    if (targetUserId === caller.id) {
      return new Response(
        JSON.stringify({
          error: "Você não pode resetar a própria senha por aqui. Use a opção 'Esqueci minha senha' na tela de login.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 5. Busca user-alvo ──
    const { data: targetProfile, error: targetErr } = await adminClient
      .from("profiles")
      .select("user_id, email, full_name, is_active, must_change_password")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (targetErr || !targetProfile) {
      return new Response(JSON.stringify({ error: "Usuário não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!targetProfile.email) {
      return new Response(JSON.stringify({ error: "Usuário sem email cadastrado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!targetProfile.is_active) {
      return new Response(
        JSON.stringify({
          error: "Usuário está inativo. Reative-o antes de resetar a senha.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── 6. Gera senha temporária ──
    const tempPassword = generatePassword();

    // ── 7. Atualiza no auth.users ──
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(targetUserId, {
      password: tempPassword,
      email_confirm: true,
    });

    if (updateErr) {
      console.error("[hub-reset-user-password] updateUserById falhou:", updateErr);
      return new Response(JSON.stringify({ error: `Falha ao atualizar senha: ${updateErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── 8. Força must_change_password=true no profile ──
    await adminClient.from("profiles").upsert(
      {
        ...targetProfile,
        must_change_password: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    // ── 9. Log de auditoria ──
    // Insere registro pra rastreabilidade (quem resetou senha de quem e quando)
    // Reusa a tabela hub_user_roles_audit como log genérico de ações admin
    try {
      await adminClient.from("hub_user_roles_audit").insert({
        user_id: targetUserId,
        action: "password_reset_by_admin",
        performed_by: caller.id,
        motivo: `Senha temporária gerada por ${caller.email || caller.id}`,
      });
    } catch (auditErr) {
      // Audit log falha não-bloqueante
      console.warn("[hub-reset-user-password] audit log falhou:", auditErr);
    }

    console.log(`[hub-reset-user-password] OK — caller=${caller.email} target=${targetProfile.email}`);

    return new Response(
      JSON.stringify({
        success: true,
        email: targetProfile.email,
        full_name: targetProfile.full_name,
        target_user_id: targetUserId,
        temp_password: tempPassword,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[hub-reset-user-password] erro não tratado:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
