import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REQUEST_TIMEOUT_MS = 30000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate JWT - require authenticated user
  const auth = await validateAuth(req);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const makeWebhookUrl = Deno.env.get("ALVO_MAKE_WEBHOOK_URL");

    if (!makeWebhookUrl) {
      return new Response(
        JSON.stringify({ error: "ALVO_MAKE_WEBHOOK_URL não configurado." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the action from the request body
    let action = "login";
    let params: Record<string, unknown> = {};
    
    try {
      const body = await req.json();
      action = body.action || "login";
      params = body.params || {};
    } catch {
      // Default to login if no body
    }

    console.log(`Proxy Make: action=${action}, params=${JSON.stringify(params)}`);

    // Forward to Make webhook
    const response = await fetch(makeWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ action, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const responseText = await response.text();
    console.log(`Make response status: ${response.status}`);
    console.log(`Make response body: ${responseText.substring(0, 500)}`);

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: `Make retornou status ${response.status}`,
          details: responseText,
        }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Try to parse as JSON, otherwise return raw
    let responseData: unknown;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { raw: responseText };
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: responseData,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Erro no proxy Make:", error.message);
    return new Response(
      JSON.stringify({
        error: "Erro ao conectar ao Make.",
        details: error.message,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
