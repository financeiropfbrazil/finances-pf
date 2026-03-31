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

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const baseUrl = Deno.env.get("ALVO_API_URL");
    const username = Deno.env.get("ALVO_USERNAME");
    const password = Deno.env.get("ALVO_PASSWORD");
    const makeWebhookUrl = Deno.env.get("MAKE_WEBHOOK_PROXY_URL");

    if (!baseUrl || !username || !password) {
      return json({ success: false, error_code: "PROXY_NOT_CONFIGURED", error: "Credenciais do ERP não configuradas no servidor." });
    }

    let body: { action: string; endpoint?: string; method?: string; payload?: unknown; token?: string };
    try {
      body = await req.json();
    } catch {
      return json({ success: false, error_code: "INVALID_REQUEST_BODY", error: "JSON inválido." });
    }

    const action = body.action || "call";

    // ── Decide: direct or via Make.com ──
    // Try direct first; if it fails with connection error, fall back to Make
    const useMake = !!makeWebhookUrl;

    // ── LOGIN ──
    if (action === "login") {
      console.log(`alvo-proxy: login attempt (mode: ${useMake ? "make" : "direct"})`);

      if (useMake) {
        // Login via Make.com (alvo-auth webhook)
        const alvoMakeUrl = Deno.env.get("ALVO_MAKE_WEBHOOK_URL");
        if (!alvoMakeUrl) {
          return json({ success: false, error_code: "PROXY_NOT_CONFIGURED", error: "ALVO_MAKE_WEBHOOK_URL não configurado." });
        }

        try {
          const res = await fetch(alvoMakeUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "login", params: {} }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });

          const text = await res.text();
          console.log(`Make login response: ${res.status} - ${text.substring(0, 300)}`);

          if (!res.ok) {
            return json({ success: false, error_code: "AUTH_FAILED", error: `Make retornou HTTP ${res.status} no login.`, details: text.substring(0, 300) });
          }

          let data: any;
          try { data = JSON.parse(text); } catch { data = { raw: text }; }

          // Make scenario returns the token in various shapes
          const token = data?.token || data?.Token || data?.access_token || data?.data?.token || (typeof data === "string" ? data : null);
          if (!token) {
            return json({ success: false, error_code: "TOKEN_NOT_RECEIVED", error: "Login via Make OK mas token não encontrado.", details: text.substring(0, 300) });
          }

          return json({ success: true, data: { token } });
        } catch (err: any) {
          return json({ success: false, error_code: "AUTH_NETWORK_ERROR", error: `Erro de rede (Make login): ${err.message}` });
        }
      }

      // Direct login
      try {
        const loginRes = await fetch(`${baseUrl}/Login/Autenticar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Login: username, Senha: password }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        const loginText = await loginRes.text();
        console.log(`Direct login response: ${loginRes.status} - ${loginText.substring(0, 200)}`);

        if (!loginRes.ok) {
          return json({ success: false, error_code: "AUTH_FAILED", error: `ERP retornou HTTP ${loginRes.status}.`, details: loginText.substring(0, 300) });
        }

        let loginData: any;
        try { loginData = JSON.parse(loginText); } catch { loginData = { token: loginText.replace(/"/g, "") }; }
        const token = loginData?.token || loginData?.Token || loginData?.access_token || (typeof loginData === "string" ? loginData : null);
        if (!token) {
          return json({ success: false, error_code: "TOKEN_NOT_RECEIVED", error: "Login OK mas token não encontrado.", details: loginText.substring(0, 300) });
        }

        return json({ success: true, data: { token } });
      } catch (err: any) {
        return json({ success: false, error_code: "AUTH_NETWORK_ERROR", error: `Erro de rede ao autenticar: ${err.message}` });
      }
    }

    // ── API CALL ──
    const endpoint = body.endpoint;
    const method = (body.method || "POST").toUpperCase();
    const token = body.token;
    const payload = body.payload;

    if (!endpoint) return json({ success: false, error_code: "MISSING_ENDPOINT", error: "Parâmetro 'endpoint' é obrigatório." });
    if (!token) return json({ success: false, error_code: "MISSING_TOKEN", error: "Token de autenticação não fornecido." });

    const fullUrl = `${baseUrl}/${endpoint.replace(/^\//, "")}`;
    console.log(`alvo-proxy: ${method} ${fullUrl} (mode: ${useMake ? "make" : "direct"})`);

    if (useMake) {
      // Route API call through Make.com proxy webhook
      const makePayload = {
        url: fullUrl,
        method,
        token,
        body: payload !== undefined ? (typeof payload === "string" ? payload : JSON.stringify(payload)) : undefined,
      };

      try {
        const res = await fetch(makeWebhookUrl!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(makePayload),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        const text = await res.text();
        console.log(`Make API response: ${res.status} - ${text.substring(0, 500)}`);

        if (res.status === 401 || res.status === 403) {
          return json({ success: false, error_code: "ERP_AUTH_ERROR", error: `Token expirado ou inválido (HTTP ${res.status}).` });
        }

        if (!res.ok) {
          return json({ success: false, error_code: "ERP_API_ERROR", error: `Make retornou HTTP ${res.status}.`, details: text.substring(0, 500) });
        }

        let parsed: any;
        try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

        // Check if Make wrapped it or if it's the ERP response directly
        if (parsed?.StatusCode && parsed.StatusCode >= 400) {
          return json({ success: false, error_code: "ERP_API_ERROR", error: `Erro do ERP (HTTP ${parsed.StatusCode}): ${parsed.Message || "Erro desconhecido."}` });
        }

        return json({ success: true, status: res.status, data: parsed });
      } catch (err: any) {
        return json({ success: false, error_code: "ERP_NETWORK_ERROR", error: `Erro de rede (Make): ${err.message}` });
      }
    }

    // Direct API call
    const fetchOptions: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (method === "POST" && payload !== undefined) {
      fetchOptions.body = typeof payload === "string" ? payload : JSON.stringify(payload);
    }

    try {
      const response = await fetch(fullUrl, fetchOptions);
      const responseText = await response.text();
      console.log(`Direct API response: ${response.status} - ${responseText.substring(0, 500)}`);

      if (response.status === 401 || response.status === 403) {
        return json({ success: false, error_code: "ERP_AUTH_ERROR", error: `Token expirado ou inválido (HTTP ${response.status}).` });
      }
      if (!response.ok) {
        return json({ success: false, error_code: "ERP_API_ERROR", error: `ERP retornou HTTP ${response.status}.`, details: responseText.substring(0, 500) });
      }

      let parsed: any;
      try { parsed = JSON.parse(responseText); } catch { parsed = { raw: responseText }; }
      return json({ success: true, status: response.status, data: parsed });
    } catch (err: any) {
      return json({ success: false, error_code: "ERP_NETWORK_ERROR", error: `Erro de conexão com o ERP: ${err.message}` });
    }
  } catch (error: any) {
    console.error("Internal proxy error:", error.message);
    return json({ success: false, error_code: "PROXY_INTERNAL_ERROR", error: `Erro interno: ${error.message}` });
  }
});
