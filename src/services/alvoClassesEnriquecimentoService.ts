import { supabase } from "@/integrations/supabase/client";

const GATEWAY_URL = "https://erp-proxy.onrender.com";
const DELAY_MS = 200;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EnrichClassesResult {
  enriched: number;
  skipped: number;
  errors: number;
}

/**
 * Pega o access_token do Supabase do localStorage.
 */
function getSupabaseAccessToken(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        return parsed?.access_token ?? null;
      }
    }
  } catch (e) {
    console.error("Erro lendo access token", e);
  }
  return null;
}

/**
 * Chama uma classe via gateway passthrough. Retorna o objeto detalhado.
 */
async function loadClasseViaGateway(codigo: string, token: string): Promise<any> {
  const endpoint = `ClasseRecDesp/Load?codigoEmpresaFilial=1.01&codigo=${encodeURIComponent(codigo)}`;

  const resp = await fetch(`${GATEWAY_URL}/alvo/passthrough`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      endpoint,
      method: "GET",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gateway HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const json = await resp.json();
  if (!json.ok) {
    throw new Error(json.error || `Alvo retornou status ${json.status}`);
  }

  return json.data;
}

export async function enriquecerClassesComContaContabil(
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<EnrichClassesResult> {
  // 1. Buscar apenas classes Folha sem conta contábil ainda
  const { data: classes, error } = await (supabase as any)
    .from("classes_rec_desp")
    .select("id, codigo, nome")
    .eq("grupo", "F")
    .is("conta_contabil_reduzida", null);

  if (error) throw new Error(`Erro ao buscar classes: ${error.message}`);
  if (!classes || classes.length === 0) {
    return { enriched: 0, skipped: 0, errors: 0 };
  }

  onProgress?.(0, classes.length, `${classes.length} classes para enriquecer. Iniciando...`);

  // 2. Pega token do Supabase (pra autenticar no gateway)
  const supabaseToken = getSupabaseAccessToken();
  if (!supabaseToken) {
    throw new Error("Token Supabase não encontrado — faça login novamente.");
  }

  const result: EnrichClassesResult = {
    enriched: 0,
    skipped: 0,
    errors: 0,
  };

  for (let i = 0; i < classes.length; i++) {
    const cls = classes[i];

    try {
      onProgress?.(i + 1, classes.length, `${i + 1}/${classes.length}: ${cls.codigo} — ${cls.nome}...`);

      const detail = await loadClasseViaGateway(cls.codigo, supabaseToken);

      const contaReduzida: number | null = detail?.ClasseRecDespUserFieldsObject?.UserConta_Contab ?? null;

      if (!contaReduzida) {
        result.skipped++;
        await delay(DELAY_MS);
        continue;
      }

      // ⚠️ Usa RPC em vez de .update() — evita CORS issue do PATCH no Supabase hospedado
      const { error: rpcErr } = await (supabase as any).rpc("enriquecer_classe_conta_contabil", {
        p_codigo: cls.codigo,
        p_conta_contabil_reduzida: contaReduzida,
      });

      if (rpcErr) {
        console.error(`Erro RPC ${cls.codigo}:`, rpcErr.message);
        result.errors++;
      } else {
        result.enriched++;
      }
    } catch (err: any) {
      console.error(`Erro na classe ${cls.codigo}:`, err);
      result.errors++;
    }

    await delay(DELAY_MS);
  }

  return result;
}
