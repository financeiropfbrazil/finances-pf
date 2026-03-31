import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const PAGE_SIZE = 500;
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function syncEntidades(
  onProgress?: (msg: string) => void
): Promise<number> {
  clearAlvoToken();
  let auth = await authenticateAlvo();
  if (!auth.token) throw new Error("Falha na autenticação ERP");
  let token = auth.token;

  let page = 1;
  let totalSaved = 0;
  let hasMore = true;

  while (hasMore) {
    onProgress?.(`Buscando fornecedores... página ${page}`);

    let resp: Response | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      resp = await fetch(`${ERP_BASE_URL}/Entidade/GetListForComponents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "riosoft-token": token,
        },
        body: JSON.stringify({
          FormName: "entidade",
          ClassInput: "Entidade",
          ControllerForm: "entidade",
          TypeObject: "tabForm",
          Filter: "",
          Input: "gridTableEntidade",
          IsGroupBy: false,
          Order: "Nome ASC",
          PageIndex: page,
          PageSize: PAGE_SIZE,
          Shortcut: "entidade",
          Type: "GridTable",
        }),
      });

      if (resp && resp.status === 409) {
        clearAlvoToken();
        await delay(1000 * attempt);
        auth = await authenticateAlvo();
        if (auth.token) token = auth.token;
        continue;
      }
      break;
    }

    if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);

    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) {
      hasMore = false;
      break;
    }

    const records = data
      .filter((e: any) => e.Codigo && e.CPFCNPJ)
      .map((e: any) => ({
        codigo_entidade: e.Codigo,
        cnpj: e.CPFCNPJ,
        nome: e.Nome || e.NomeFantasia || "",
        updated_at: new Date().toISOString(),
      }));

    if (records.length > 0) {
      const { error } = await supabase
        .from("compras_entidades_cache")
        .upsert(records, { onConflict: "codigo_entidade" });

      if (error) console.warn(`[Entidade] Erro page ${page}:`, error.message);
      else totalSaved += records.length;
    }

    onProgress?.(`${totalSaved} fornecedores sincronizados...`);

    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
      await delay(300);
    }
  }

  // Save sync metadata
  await supabase.from("compras_config").upsert({
    chave: "sync_entidades_ts",
    valor: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "chave" });
  await supabase.from("compras_config").upsert({
    chave: "sync_entidades_count",
    valor: String(totalSaved),
    updated_at: new Date().toISOString(),
  }, { onConflict: "chave" });

  return totalSaved;
}
