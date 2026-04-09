import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const PAGE_SIZE = 500;
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function syncFuncionarios(
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
    onProgress?.(`Buscando funcionários... página ${page}`);
    let resp: Response | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      resp = await fetch(`${ERP_BASE_URL}/funcionario/GetListForComponents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "riosoft-token": token,
        },
        body: JSON.stringify({
          FormName: "funcionario",
          ClassInput: "funcionario",
          ClassVinculo: "funcionario",
          ControllerForm: "funcionario",
          BindingName: "",
          DisabledCache: false,
          Filter: "",
          Input: "defaultSearch",
          IsGroupBy: false,
          Order: "",
          OrderUser: "",
          PageIndex: page,
          PageSize: PAGE_SIZE,
          Shortcut: "func",
          Type: "GridTable",
          TypeObject: "rsSearch",
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
      .filter((f: any) => f.Codigo && f.Nome)
      .map((f: any) => ({
        codigo: f.Codigo,
        nome: f.Nome,
        status: f.Status || "Desconhecido",
        codigo_centro_ctrl: f.CodigoCentroCtrl || null,
        codigo_usuario: f.CodigoUsuario || null,
        synced_at: new Date().toISOString(),
      }));

    if (records.length > 0) {
      const { error } = await (supabase as any)
        .from("funcionarios_alvo_cache")
        .upsert(records, { onConflict: "codigo" });
      if (error) console.warn(`[Funcionario] Erro page ${page}:`, error.message);
      else totalSaved += records.length;
    }

    onProgress?.(`${totalSaved} funcionários sincronizados...`);

    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
      await delay(300);
    }
  }

  await (supabase as any).from("compras_config").upsert({
    chave: "sync_funcionarios_ts",
    valor: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "chave" });

  await (supabase as any).from("compras_config").upsert({
    chave: "sync_funcionarios_count",
    valor: String(totalSaved),
    updated_at: new Date().toISOString(),
  }, { onConflict: "chave" });

  return totalSaved;
}
