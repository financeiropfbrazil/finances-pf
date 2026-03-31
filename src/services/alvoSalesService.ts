import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";

interface SyncResult {
  total: number;
  sincronizadas: number;
  excluidas: number;
  erros: string[];
}

async function fetchWithRetryAuth(
  url: string,
  body: any,
  token: string
): Promise<{ data: any; newToken?: string }> {
  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Riosoft-Token": token },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 409) {
    clearAlvoToken();
    await new Promise((r) => setTimeout(r, 2000));
    const auth = await authenticateAlvo();
    if (!auth.success || !auth.token) throw new Error("Falha ao re-autenticar no ERP Alvo");
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Riosoft-Token": auth.token },
      body: JSON.stringify(body),
    });
    return { data: await res.json(), newToken: auth.token };
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return { data: await res.json() };
}

function lastDayOfMonth(periodo: string): string {
  const [y, m] = periodo.split("-").map(Number);
  const d = new Date(y, m, 0); // day 0 of next month = last day of current month
  return `${y}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function sincronizarNotasFiscais(
  periodo: string,
  onProgress?: (msg: string) => void
): Promise<SyncResult> {
  const result: SyncResult = { total: 0, sincronizadas: 0, excluidas: 0, erros: [] };

  // 1. Auth
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    result.erros.push("Falha na autenticação ERP: " + (auth.error || "token ausente"));
    return result;
  }
  let token = auth.token;

  // 2. Fetch excluded CNPJs
  onProgress?.("Carregando CNPJs excluídos...");
  const { data: excludedRows } = await supabase
    .from("sales_excluded_cnpj")
    .select("cnpj");
  const excludedSet = new Set((excludedRows || []).map((r: any) => r.cnpj));

  // 3. Derive dates
  const dataInicio = `${periodo}-01T03:00:00.000Z`;
  const lastDay = lastDayOfMonth(periodo);
  const dataFim = `${lastDay}T03:00:00.000Z`;

  // 4. Paginate ERP endpoint
  const allNFs: any[] = [];
  let pageIndex = 1;
  let hasMore = true;

  while (hasMore) {
    onProgress?.(`Buscando NFs página ${pageIndex}...`);
    try {
      console.log(`[Sales Sync] Fetching page ${pageIndex}, filter dates: ${dataInicio} → ${dataFim}`);
      const { data, newToken } = await fetchWithRetryAuth(
        `${ERP_BASE_URL}/notaFiscalEletronicaTrans/GetListForComponents`,
        {
          FormName: "notaFiscalEletronicaTrans",
          ClassInput: "NotaFiscalEletronicaTrans",
          ControllerForm: "notaFiscalEletronicaTrans",
          TypeObject: "tabForm",
          BindingName: "",
          ClassVinculo: "notaFiscalEletronicaTrans",
          DisabledCache: false,
          Filter: `(CodigoEmpresaFilial == '1.01' AND (DataTransmissao >= #${dataInicio}# AND DataTransmissao <= #${dataFim}#) AND (ModeloCtrlDf == 'NF-e') AND (Tipo == 'Federal'))`,
          Input: "gridTableNotaFiscalEletronicaTrans",
          IsGroupBy: false,
          Order: "",
          OrderUser: "",
          PageIndex: pageIndex,
          PageSize: 500,
          Shortcut: "nfetrans",
          Type: "GridTable",
        },
        token
      );
      if (newToken) token = newToken;

      console.log(`[Sales Sync] Page ${pageIndex} response:`, typeof data, Array.isArray(data) ? `array(${data.length})` : JSON.stringify(data)?.substring(0, 300));

      const items: any[] = Array.isArray(data) ? data : (data?.lista ?? data?.Registros ?? []);
      if (items.length === 0) {
        hasMore = false;
      } else {
        allNFs.push(...items);
        if (items.length < 500) {
          hasMore = false;
        } else {
          pageIndex++;
        }
      }
    } catch (e: any) {
      console.error(`[Sales Sync] Error on page ${pageIndex}:`, e);
      result.erros.push(`Página ${pageIndex}: ${e.message}`);
      hasMore = false;
    }
  }

  result.total = allNFs.length;

  // 5. Filter and map
  const toUpsert: any[] = [];
  for (const nf of allNFs) {
    // Exclude cancelled
    if (nf.Status === "Cancelada") {
      result.excluidas++;
      continue;
    }
    // Exclude by CNPJ
    if (nf.CNPJDestinatario && excludedSet.has(nf.CNPJDestinatario)) {
      result.excluidas++;
      continue;
    }

    toUpsert.push({
      numero_nf: nf.NumeroNotaFiscal || "",
      serie: nf.SerieCtrlDf || null,
      chave_acesso: nf.ChaveAcesso || null,
      data_emissao: nf.DataEmissao ? nf.DataEmissao.split("T")[0] : null,
      data_transmissao: nf.DataTransmissao ? nf.DataTransmissao.split("T")[0] : null,
      periodo,
      codigo_entidade: nf.CodigoEntidade || null,
      razao_social: nf.RazaoSocialEntidade || null,
      cnpj_destinatario: nf.CNPJDestinatario || null,
      valor_brl: nf.Valor ?? null,
      status: nf.Status || null,
      codigo_usuario: nf.CodigoUsuario || null,
      numero_protocolo: nf.NumeroProtocolo || null,
      updated_at: new Date().toISOString(),
    });
  }

  // 6. Upsert in batches
  if (toUpsert.length > 0) {
    onProgress?.(`Salvando ${toUpsert.length} NFs...`);
    const chunkSize = 100;
    for (let i = 0; i < toUpsert.length; i += chunkSize) {
      const chunk = toUpsert.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("sales_invoices")
        .upsert(chunk, { onConflict: "chave_acesso" });
      if (error) {
        result.erros.push(`Lote ${Math.floor(i / chunkSize) + 1}: ${error.message}`);
      } else {
        result.sincronizadas += chunk.length;
      }
    }
  }

  onProgress?.("Sincronização concluída.");
  return result;
}
