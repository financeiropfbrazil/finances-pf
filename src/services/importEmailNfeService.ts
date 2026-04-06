import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = "https://hbtggrbauguukewiknew.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhidGdncmJhdWd1dWtld2lrbmV3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTk5NTMsImV4cCI6MjA5MDQ3NTk1M30.zC8QizNyFYndr7wLObdcAR_OkYJkkbVVCPfJunnEvrY";

export async function invokeImportEmailNfe(action: "check" | "import", ids: string[]) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  if (!accessToken) {
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/import-email-nfe-to-compras`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ action, ids }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody?.message || errorBody?.error || `Erro ${response.status}`);
  }

  return response.json();
}
