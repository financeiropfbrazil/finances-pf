import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_SESSION_RETRIES = 3;
const PAGE_SIZE = 500;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SyncDocFinDespesasResult {
  inserted: number;
  updated: number;
  errors: number;
  skipped: number;
}

// Espécies que DEVEM ser importadas pelo DocFin
const ESPECIES_INCLUIDAS = new Set([
  "BOL", "CAR", "CRT", "CT-e", "DES", "DIV",
  "FAT", "FER", "FGTS", "FOL", "I.I.", "ICMS",
  "INSS", "ISS", "NF3E", "NFCom", "PENS", "RDESP",
  "REC", "SDA", "SEG", "TAXA", "TRCT"
]);

async function fetchPageComRetry(
  url: string,
  token: string
): Promise<{ data: any[]; usedToken: string }> {
  let currentToken = token;

  for (let attempt = 1; attempt <= MAX_SESSION_RETRIES; attempt++) {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "riosoft-token": currentToken,
      },
    });

    if (resp.status !== 409) {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return {
        data: Array.isArray(data) ? data : [],
        usedToken: currentToken,
      };
    }

    if (attempt === MAX_SESSION_RETRIES) {
      throw new Error(
        "Conflito de sessão ERP persistente (HTTP 409)."
      );
    }

    clearAlvoToken();
    await delay(1000 * attempt);
    const reAuth = await authenticateAlvo();
    if (!reAuth.success || !reAuth.token) {
      throw new Error("Falha na re-autenticação após conflito.");
    }
    currentToken = reAuth.token;
  }

  throw new Error("Falha inesperada no fluxo de retry");
}

function extractDate(val: string | null | undefined): string | null {
  if (!val) return null;
  const d = val.substring(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function buildUrl(ano: number, mes: number, pageIndex: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const dataIni = `${ano}-${pad(mes)}-01`;
  const lastDay = new Date(ano, mes, 0).getDate();
  const dataFim = `${ano}-${pad(mes)}-${pad(lastDay)}`;

  const filter =
    `CodigoEmpresaFilial = '1.01' AND Tipo = 'PAG'` +
    ` AND Competencia >= '${dataIni}'` +
    ` AND Competencia <= '${dataFim}'`;

  const params = new URLSearchParams({
    filter,
    order: "Competencia",
    pageSize: String(PAGE_SIZE),
    pageIndex: String(pageIndex),
  });

  return `${ERP_BASE_URL}/DocFin/RetrievePage?${params.toString()}`;
}

export async function sincronizarDocFinDespesas(
  ano: number,
  mes: number,
  onProgress?: (current: number, total: number, message: string) => void
): Promise<SyncDocFinDespesasResult> {
  // 1. Autenticar
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    throw new Error(
      `Falha na autenticação ERP: ${auth.error || "Token não obtido"}`
    );
  }

  let currentToken = auth.token;
  const allItems: any[] = [];
  let pageIndex = 1;

  onProgress?.(0, 0, "Buscando despesas DocFin do ERP...");

  // 2. Paginar
  while (true) {
    const { data: items, usedToken } = await fetchPageComRetry(
      buildUrl(ano, mes, pageIndex),
      currentToken
    );
    currentToken = usedToken;

    if (!items.length) break;

    allItems.push(...items);
    onProgress?.(
      allItems.length,
      0,
      `Página ${pageIndex}: ${items.length} registros carregados...`
    );

    if (items.length < PAGE_SIZE) break;
    pageIndex++;
  }

  // 3. Filtrar espécies incluídas
  const filtered = allItems.filter(
    (item) => ESPECIES_INCLUIDAS.has(item.Especie ?? "")
  );

  onProgress?.(
    0,
    filtered.length,
    `${filtered.length} despesas DocFin filtradas de ${allItems.length} registros. Processando...`
  );

  const result: SyncDocFinDespesasResult = {
    inserted: 0,
    updated: 0,
    errors: 0,
    skipped: 0,
  };

  // 4. Buscar chaves existentes em lote para evitar N+1 queries
  const allChaves = filtered
    .map((item) => item.Chave)
    .filter((c): c is number => c != null);

  const existingMap = new Map<number, { id: string; origem: string | null }>();
  // Buscar em lotes de 500
  for (let b = 0; b < allChaves.length; b += 500) {
    const batch = allChaves.slice(b, b + 500);
    const { data: existingRows } = await supabase
      .from("nf_entrada")
      .select("id, erp_chave, origem")
      .in("erp_chave", batch);
    if (existingRows) {
      existingRows.forEach((row: any) => {
        existingMap.set(row.erp_chave, { id: row.id, origem: row.origem });
      });
    }
  }

  onProgress?.(
    0,
    filtered.length,
    `Processando ${filtered.length} despesas DocFin...`
  );

  // 5. Preparar lotes de insert e update
  const toInsert: any[] = [];
  const toUpdate: any[] = [];

  for (const item of filtered) {
    const chave = item.Chave;
    if (!chave) { result.skipped++; continue; }

    const basePayload = {
      erp_chave: chave,
      tipo_lancamento: "DOCFIN",
      origem: "DOCFIN",
      especie: item.Especie ?? null,
      numero: item.Numero ?? null,
      serie: item.Serie ?? null,
      data_emissao: extractDate(item.DataEmissao),
      data_movimento: extractDate(item.DataEmissao),
      data_entrada: item.DataEntrada ?? null,
      fornecedor_codigo: item.CodigoEntidade ?? null,
      fornecedor_nome: item.NomeEntidade ?? null,
      fornecedor_cnpj: null,
      valor_documento: item.ValorDocumento ?? 0,
      valor_liquido: item.ValorLiberado ?? 0,
      observacao: item.Observacao || null,
      updated_at: new Date().toISOString(),
    };

    const existingEntry = existingMap.get(chave);
    if (existingEntry) {
      if (existingEntry.origem === "MANUAL" || existingEntry.origem === "MOVESTQ") {
        result.skipped++;
      } else {
        toUpdate.push({
          id: existingEntry.id,
          ...basePayload,
        });
      }
    } else {
      toInsert.push({
        ...basePayload,
        raw_json: item,
      });
    }
  }

  // 6. Executar inserts em lotes
  const BATCH_SIZE = 50;
  for (let b = 0; b < toInsert.length; b += BATCH_SIZE) {
    const batch = toInsert.slice(b, b + BATCH_SIZE);
    const { error } = await supabase.from("nf_entrada").insert(batch);
    if (error) {
      console.error("Erro insert lote DocFin:", error.message);
      result.errors += batch.length;
    } else {
      result.inserted += batch.length;
    }
    onProgress?.(
      result.inserted + result.updated + result.errors + result.skipped,
      filtered.length,
      `Inserindo: ${result.inserted} de ${toInsert.length}...`
    );
  }

  // 7. Executar updates em lote por id para evitar 170 PATCHes individuais
  const UPDATE_BATCH_SIZE = 25;
  for (let b = 0; b < toUpdate.length; b += UPDATE_BATCH_SIZE) {
    const batch = toUpdate.slice(b, b + UPDATE_BATCH_SIZE);
    const { error, data } = await supabase
      .from("nf_entrada")
      .upsert(batch, { onConflict: "id" })
      .select("id");

    if (error) {
      console.error("Erro update lote DocFin:", error.message);
      result.errors += batch.length;
    } else {
      result.updated += data?.length ?? batch.length;
    }

    onProgress?.(
      result.inserted + result.updated + result.errors + result.skipped,
      filtered.length,
      `Atualizando: ${result.updated} de ${toUpdate.length}...`
    );

    if (b + UPDATE_BATCH_SIZE < toUpdate.length) {
      await delay(200);
    }
  }

  return result;
}
