/*
  Tabela Supabase: nf_entrada
  - id uuid PK
  - erp_chave integer NOT NULL UNIQUE
  - tipo_lancamento text NOT NULL
  - especie, numero, serie text
  - data_emissao date, data_movimento date, data_entrada timestamptz
  - fornecedor_codigo, fornecedor_nome, fornecedor_cnpj text
  - valor_documento, valor_liquido, valor_mercadoria numeric(15,2)
  - chave_acesso_nfe, observacao text
  - cost_center_id uuid FK cost_centers(id)
  - raw_json jsonb
  - created_at, updated_at timestamptz
*/

import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_SESSION_RETRIES = 3;
const PAGE_SIZE = 200;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SyncNfEntradaResult {
  inserted: number;
  updated: number;
  errors: number;
  skipped: number;
}

async function fetchPageComRetry(
  body: object,
  token: string
): Promise<{ data: any[]; usedToken: string }> {
  let currentToken = token;

  for (let attempt = 1; attempt <= MAX_SESSION_RETRIES; attempt++) {
    const resp = await fetch(`${ERP_BASE_URL}/movEstq/GetListForComponents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "riosoft-token": currentToken,
      },
      body: JSON.stringify(body),
    });

    if (resp.status !== 409) {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return {
        data: Array.isArray(data) ? data : [],
        usedToken: currentToken,
      };
    }

    console.warn(
      `[NfEntrada] 409 sessão conflitante (tentativa ${attempt}/${MAX_SESSION_RETRIES})`
    );

    if (attempt === MAX_SESSION_RETRIES) {
      throw new Error(
        "Conflito de sessão ERP persistente (HTTP 409). Feche outras sessões do ERP e tente novamente."
      );
    }

    clearAlvoToken();
    await delay(1000 * attempt);

    const reAuth = await authenticateAlvo();
    if (!reAuth.success || !reAuth.token) {
      throw new Error("Falha na re-autenticação após conflito de sessão (409)");
    }
    currentToken = reAuth.token;
  }

  throw new Error("Falha inesperada no fluxo de retry");
}

function buildFilter(ano: number, mes: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(ano, mes, 0).getDate();
  const dataIni = `${pad(1)}/${pad(mes)}/${ano} 00:00:00`;
  const dataFim = `${pad(lastDay)}/${pad(mes)}/${ano} 23:59:59`;
  return (
    `( DocumentoHomologado == 'Sim' && CodigoEmpresaFilial == '1.01' && ` +
    `(CodigoTipoLanc == 'E0000003' || CodigoTipoLanc == 'E0000091') && ` +
    `DataMovimento >= #${dataIni}# && DataMovimento <= #${dataFim}#)`
  );
}

export async function sincronizarNfEntradaPorPeriodo(
  ano: number,
  mes: number,
  onProgress?: (current: number, total: number, message: string) => void
): Promise<SyncNfEntradaResult> {
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    throw new Error(
      `Falha na autenticação ERP: ${auth.error || "Token não obtido"}`
    );
  }

  let currentToken = auth.token;
  const allItems: any[] = [];
  let pageIndex = 1;

  onProgress?.(0, 0, "Buscando NFs de entrada do ERP...");

  while (true) {
    const body = {
      FormName: "movEstq",
      ClassInput: "MovEstq",
      ControllerForm: "movEstq",
      TypeObject: "tabForm",
      Filter: buildFilter(ano, mes),
      Input: "gridTableMovEstq",
      IsGroupBy: false,
      Order: "Chave DESC",
      PageIndex: pageIndex,
      PageSize: PAGE_SIZE,
      Shortcut: "movestq",
      Type: "GridTable",
    };

    const { data: items, usedToken } = await fetchPageComRetry(
      body,
      currentToken
    );
    currentToken = usedToken;

    if (!items.length) break;

    allItems.push(...items);
    onProgress?.(
      allItems.length,
      0,
      `Página ${pageIndex}: ${items.length} NFs carregadas...`
    );

    if (items.length < PAGE_SIZE) break;
    pageIndex++;
  }

  onProgress?.(
    0,
    allItems.length,
    `${allItems.length} NFs encontradas. Processando upsert...`
  );

  const result: SyncNfEntradaResult = {
    inserted: 0,
    updated: 0,
    errors: 0,
    skipped: 0,
  };

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    try {
      const chave = item.Chave;
      if (!chave) {
        result.skipped++;
        continue;
      }

      const extractDate = (val: string | null): string | null => {
        if (!val) return null;
        const d = val.substring(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
      };

      const payload = {
        erp_chave: chave,
        tipo_lancamento: item.CodigoTipoLanc ?? null,
        especie: item.Especie ?? null,
        numero: item.Numero ?? null,
        serie: item.Serie ?? null,
        data_emissao: extractDate(item.DataEmissao),
        data_movimento: extractDate(item.DataMovimento),
        data_entrada: item.DataEntrada ?? null,
        fornecedor_codigo: item.CodigoEntidade ?? null,
        fornecedor_nome: item.NomeEntidade ?? null,
        fornecedor_cnpj: item.CPFCNPJEntidade ?? null,
        valor_documento: item.ValorDocumento ?? 0,
        valor_liquido: item.ValorLiquidoDocumento ?? 0,
        valor_mercadoria: item.ValorMercadoria ?? 0,
        chave_acesso_nfe: item.ChaveAcessoNFe || null,
        observacao: item.Observacao || null,
        origem: "MOVESTQ",
        raw_json: item,
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from("nf_entrada")
        .select("id")
        .eq("erp_chave", chave)
        .maybeSingle();

      if (existing) {
        // Nunca sobrescrever DOCFIN ou MANUAL com dados MOVESTQ
        const { data: existingOrigem } = await supabase
          .from("nf_entrada")
          .select("origem")
          .eq("erp_chave", chave)
          .maybeSingle();

        if (existingOrigem?.origem === "DOCFIN" || 
            existingOrigem?.origem === "MANUAL") {
          result.skipped++;
          continue;
        }

        const { error } = await supabase
          .from("nf_entrada")
          .update(payload)
          .eq("erp_chave", chave)
          .eq("origem", "MOVESTQ");
        if (error) {
          console.error(`Erro update chave ${chave}:`, error);
          result.errors++;
        } else result.updated++;
      } else {
        const { error } = await supabase
          .from("nf_entrada")
          .insert(payload);
        if (error) {
          console.error(`Erro insert chave ${chave}:`, error);
          result.errors++;
        } else result.inserted++;
      }

      onProgress?.(
        i + 1,
        allItems.length,
        `${i + 1}/${allItems.length}: ${item.Especie} ${item.Numero} — ${item.NomeEntidade}`
      );
    } catch (err: any) {
      console.error(`Erro processando chave ${item?.Chave}:`, err);
      result.errors++;
    }
  }

  return result;
}
