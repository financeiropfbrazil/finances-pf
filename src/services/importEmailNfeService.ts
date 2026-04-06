import { supabase } from "@/integrations/supabase/client";

const { supabaseUrl: SUPABASE_URL, supabaseKey: SUPABASE_ANON_KEY } = supabase as unknown as {
  supabaseUrl: string;
  supabaseKey: string;
};

export async function invokeImportEmailNfe(action: "check" | "import", ids: string[]) {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/import-email-nfe-to-compras`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
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
