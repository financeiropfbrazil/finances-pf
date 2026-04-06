import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-audit-api-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Validates the JWT from the Authorization header.
 * Returns the authenticated user or null if invalid.
 */
export async function validateAuth(req: Request): Promise<{ user: any; claims?: Record<string, unknown> } | null> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
  if (!claimsError && claimsData?.claims?.sub) {
    return {
      user: {
        id: claimsData.claims.sub,
        email: claimsData.claims.email ?? null,
        role: claimsData.claims.role ?? null,
      },
      claims: claimsData.claims as Record<string, unknown>,
    };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return null;
  }

  return { user: data.user };
}

/**
 * Returns a 401 response for unauthenticated requests.
 */
export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({ error: "Autenticação necessária. Faça login novamente." }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
