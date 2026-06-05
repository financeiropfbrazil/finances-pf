// supabase/functions/receber-chaves-nfe/index.ts
// Endpoint receptor: o Alvo (ou processo externo) posta a lista de chaves NF-e aqui.
// O Hub valida, faz dedup e enfileira para o cron buscar o XML na SEFAZ depois.
//
// Segurança: exige header "x-webhook-token" igual ao secret RECEBER_CHAVES_TOKEN.
// Sem o token correto, retorna 401. Isso impede que qualquer um poste chaves.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST" }, 405);
  }

  // ── Autenticação por token ──
  const expectedToken = Deno.env.get("RECEBER_CHAVES_TOKEN");
  if (!expectedToken) {
    return json({ ok: false, error: "Servidor sem token configurado" }, 500);
  }
  const gotToken = req.headers.get("x-webhook-token");
  if (gotToken !== expectedToken) {
    return json({ ok: false, error: "Token inválido" }, 401);
  }

  // ── Parse do corpo ──
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Corpo não é JSON válido" }, 400);
  }

  // Aceita { chaves: [...] } ou { chaves: "uma_chave" }
  let chaves: string[] = [];
  if (Array.isArray(body?.chaves)) {
    chaves = body.chaves.map((c: any) => String(c).replace(/\D/g, ""));
  } else if (typeof body?.chaves === "string") {
    chaves = [body.chaves.replace(/\D/g, "")];
  } else {
    return json({ ok: false, error: "Campo 'chaves' ausente ou inválido (esperado array de strings)" }, 400);
  }

  if (chaves.length === 0) {
    return json({ ok: false, error: "Lista de chaves vazia" }, 400);
  }
  if (chaves.length > 1000) {
    return json({ ok: false, error: "Máximo 1000 chaves por requisição" }, 400);
  }

  const origem = typeof body?.origem === "string" ? body.origem : "alvo";

  // ── Enfileira via RPC ──
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data, error } = await supabase.rpc("enfileirar_chaves_nfe", {
    p_chaves: chaves,
    p_origem: origem,
  });

  if (error) {
    return json({ ok: false, error: "Erro ao enfileirar: " + error.message }, 500);
  }

  return json(data, 200);
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
