import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
    const webhookUrl = Deno.env.get("MAKE_WEBHOOK_PROXY_URL");
    if (!webhookUrl) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "PROXY_NOT_CONFIGURED",
          error: "MAKE_WEBHOOK_PROXY_URL não configurado no servidor.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "INVALID_REQUEST_BODY",
          error: "O corpo da requisição não é um JSON válido.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body.url || !body.method) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "MISSING_PARAMS",
          error: "Parâmetros obrigatórios ausentes: 'url' e 'method' são necessários.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body.token) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "MISSING_TOKEN",
          error: "Token de autenticação do ERP não fornecido.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Proxy → Make: ${body.method} ${body.url}`);

    let response: Response;
    try {
      response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (fetchErr: any) {
      console.error("Erro de rede ao chamar Make:", fetchErr.message);
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "MAKE_NETWORK_ERROR",
          error: `Erro de conexão com o Make.com: ${fetchErr.message}`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const responseText = await response.text();
    console.log(`Make response: ${response.status} - ${responseText.substring(0, 500)}`);

    // Make scenario failure
    if (response.status === 500) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "MAKE_SCENARIO_FAILED",
          error: "O cenário do Make.com falhou. Verifique os logs do cenário no Make.",
          details: responseText.substring(0, 300),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (response.status === 429) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "MAKE_RATE_LIMITED",
          error: "Limite de requisições do Make.com atingido. Aguarde alguns minutos.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (response.status === 401 || response.status === 403) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "MAKE_AUTH_ERROR",
          error: "Erro de autenticação no Make.com. Verifique o webhook URL.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      // If Make returned HTML or non-JSON
      if (responseText.includes("<!DOCTYPE") || responseText.includes("<html")) {
        return new Response(
          JSON.stringify({
            success: false,
            error_code: "MAKE_HTML_RESPONSE",
            error: "O Make.com retornou uma página HTML ao invés de JSON. Verifique se o cenário está ativo.",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      parsed = { raw: responseText };
    }

    // Check if the ERP returned an error inside the parsed response
    if (parsed?.StatusCode && parsed.StatusCode >= 400) {
      const erpMsg = parsed.Message || parsed.ExceptionMessage || "Erro desconhecido do ERP.";
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "ERP_API_ERROR",
          error: `Erro do ERP (HTTP ${parsed.StatusCode}): ${erpMsg}`,
          erp_status: parsed.StatusCode,
          details: parsed.ExceptionMessage || null,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error_code: "MAKE_HTTP_ERROR",
          error: `O Make retornou HTTP ${response.status}.`,
          status: response.status,
          details: typeof parsed === "object" ? JSON.stringify(parsed).substring(0, 300) : responseText.substring(0, 300),
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, status: response.status, data: parsed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Erro interno no proxy:", error.message);
    return new Response(
      JSON.stringify({
        success: false,
        error_code: "PROXY_INTERNAL_ERROR",
        error: `Erro interno no servidor proxy: ${error.message}`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
