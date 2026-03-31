import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ERP_BASE = "https://pef.it4you.inf.br";
const TIMEOUT_MS = 15000;

interface TestResult {
  test: string;
  success: boolean;
  duration_ms: number;
  status?: number;
  error?: string;
  details?: string;
}

async function testDns(): Promise<TestResult> {
  const start = Date.now();
  try {
    const url = new URL(ERP_BASE);
    // Simple DNS resolution check via fetch with short timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${ERP_BASE}/`, {
      method: "HEAD",
      signal: controller.signal,
    }).catch((e) => e);
    clearTimeout(timer);

    if (res instanceof Error) {
      return {
        test: "DNS / Conectividade básica",
        success: false,
        duration_ms: Date.now() - start,
        error: res.message,
        details: res.name === "AbortError" ? "Timeout após 5s — host pode estar bloqueado" : undefined,
      };
    }

    return {
      test: "DNS / Conectividade básica",
      success: true,
      duration_ms: Date.now() - start,
      status: res.status,
      details: `Host respondeu com status ${res.status}`,
    };
  } catch (err: any) {
    return {
      test: "DNS / Conectividade básica",
      success: false,
      duration_ms: Date.now() - start,
      error: err.message,
    };
  }
}

async function testApiEndpoint(): Promise<TestResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${ERP_BASE}/api/FaturaFin/GetRegistros`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filtro: "1=0", propriedades: "Id" }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const body = await res.text();

    return {
      test: "API Endpoint (sem token)",
      success: true,
      duration_ms: Date.now() - start,
      status: res.status,
      details: `Resposta: ${res.status} ${res.statusText} — ${body.substring(0, 200)}`,
    };
  } catch (err: any) {
    return {
      test: "API Endpoint (sem token)",
      success: false,
      duration_ms: Date.now() - start,
      error: err.message,
      details: err.name === "AbortError"
        ? `Timeout após ${TIMEOUT_MS / 1000}s — conexão provavelmente bloqueada por firewall`
        : "Conexão recusada ou erro de rede",
    };
  }
}

async function testWithAuth(): Promise<TestResult> {
  const start = Date.now();
  const username = Deno.env.get("ALVO_USERNAME");
  const password = Deno.env.get("ALVO_PASSWORD");
  const apiUrl = Deno.env.get("ALVO_API_URL") || ERP_BASE;

  if (!username || !password) {
    return {
      test: "API com autenticação",
      success: false,
      duration_ms: Date.now() - start,
      error: "Credenciais não configuradas (ALVO_USERNAME / ALVO_PASSWORD)",
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    // Try login
    const loginRes = await fetch(`${apiUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const loginBody = await loginRes.text();

    if (!loginRes.ok) {
      return {
        test: "API com autenticação",
        success: false,
        duration_ms: Date.now() - start,
        status: loginRes.status,
        details: `Login falhou: ${loginRes.status} — ${loginBody.substring(0, 200)}`,
      };
    }

    return {
      test: "API com autenticação",
      success: true,
      duration_ms: Date.now() - start,
      status: loginRes.status,
      details: `Login direto OK — conexão direta funciona!`,
    };
  } catch (err: any) {
    return {
      test: "API com autenticação",
      success: false,
      duration_ms: Date.now() - start,
      error: err.message,
      details: err.name === "AbortError"
        ? `Timeout após ${TIMEOUT_MS / 1000}s — firewall bloqueando`
        : "Conexão recusada",
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate JWT - require authenticated user
  const authResult = await validateAuth(req);
  if (!authResult) {
    return unauthorizedResponse();
  }

  const results: TestResult[] = [];
  const overallStart = Date.now();

  // Run tests sequentially
  results.push(await testDns());
  results.push(await testApiEndpoint());
  results.push(await testWithAuth());

  const allPassed = results.every((r) => r.success);
  const anyTimeout = results.some((r) => r.details?.includes("Timeout") || r.details?.includes("firewall"));

  const report = {
    timestamp: new Date().toISOString(),
    server_region: "Lovable Cloud (AWS)",
    target: ERP_BASE,
    total_duration_ms: Date.now() - overallStart,
    overall: allPassed ? "✅ CONEXÃO DIRETA OK" : "❌ CONEXÃO BLOQUEADA",
    diagnosis: anyTimeout
      ? "Firewall do ERP está bloqueando conexões deste servidor. Necessária liberação de IP ou remoção da restrição."
      : allPassed
        ? "Conexão direta funcionando — pode remover o Make.com como proxy."
        : "Erro na conexão — verificar detalhes abaixo.",
    tests: results,
  };

  console.log("Health-check result:", JSON.stringify(report, null, 2));

  return new Response(JSON.stringify(report, null, 2), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
