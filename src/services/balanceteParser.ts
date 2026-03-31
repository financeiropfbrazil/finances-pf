import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BalanceteAccount {
  account_number: number;
  account_type: "S" | "A";
  account_code: string;
  description: string;
  previous_balance: number;
  debit: number;
  credit: number;
  current_balance: number;
}

interface SaveResult {
  uploadId: string;
  totalAccounts: number;
  totalAnalytical: number;
}

interface DistributeResult {
  modulesUpdated: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Column detection helpers
// ---------------------------------------------------------------------------

const COLUMN_PATTERNS: Record<string, RegExp> = {
  account_number: /conta\s*cont[áa]bil/i,
  account_type: /^s\/?a$/i,
  account_code: /classifica[çc][ãa]o/i,
  description: /descri[çc][ãa]o/i,
  previous_balance: /saldo\s*anterior/i,
  debit: /d[ée]bito/i,
  credit: /cr[ée]dito/i,
  current_balance: /saldo\s*atual/i,
};

function detectColumns(headerRow: any[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i] ?? "").trim();
    if (!cell) continue;
    for (const [key, pattern] of Object.entries(COLUMN_PATTERNS)) {
      if (pattern.test(cell) && !(key in map)) {
        map[key] = i;
      }
    }
  }
  return map;
}

function toNumber(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

// ---------------------------------------------------------------------------
// parseBalancete — reads an Excel file and returns typed rows
// ---------------------------------------------------------------------------

export async function parseBalancete(file: File): Promise<BalanceteAccount[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  if (raw.length < 2) throw new Error("Planilha vazia ou sem dados.");

  // Find header row (first row that matches at least 4 known columns)
  let headerIdx = -1;
  let colMap: Record<string, number> = {};
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const detected = detectColumns(raw[i]);
    if (Object.keys(detected).length >= 4) {
      headerIdx = i;
      colMap = detected;
      break;
    }
  }

  if (headerIdx === -1) {
    throw new Error("Não foi possível identificar o cabeçalho do balancete.");
  }

  const requiredCols = ["account_type", "account_code", "description", "current_balance"];
  for (const col of requiredCols) {
    if (!(col in colMap)) {
      throw new Error(`Coluna obrigatória não encontrada: ${col}`);
    }
  }

  const accounts: BalanceteAccount[] = [];

  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || row.length === 0) continue;

    const accountCode = String(row[colMap.account_code] ?? "").trim();
    const accountType = String(row[colMap.account_type] ?? "").trim().toUpperCase();
    const description = String(row[colMap.description] ?? "").trim();

    // Skip empty rows
    if (!accountCode || !description) continue;
    // Validate account_type
    if (accountType !== "S" && accountType !== "A") continue;

    accounts.push({
      account_number: toNumber(row[colMap.account_number]),
      account_type: accountType as "S" | "A",
      account_code: accountCode,
      description,
      previous_balance: toNumber(row[colMap.previous_balance]),
      debit: toNumber(row[colMap.debit]),
      credit: toNumber(row[colMap.credit]),
      current_balance: toNumber(row[colMap.current_balance]),
    });
  }

  if (accounts.length === 0) {
    throw new Error("Nenhuma conta encontrada no balancete.");
  }

  return accounts;
}

// ---------------------------------------------------------------------------
// saveBalancete — persists parsed accounts to the database
// ---------------------------------------------------------------------------

export async function saveBalancete(
  periodId: string,
  fileName: string,
  accounts: BalanceteAccount[]
): Promise<SaveResult> {
  // Upsert upload record (unique on period_id)
  // First delete existing upload for this period (cascades to accounts)
  await supabase.from("balancete_uploads").delete().eq("period_id", periodId);

  const { data: upload, error: uploadErr } = await supabase
    .from("balancete_uploads")
    .insert({
      period_id: periodId,
      file_name: fileName,
      status: "processing",
      total_accounts: accounts.length,
      total_analytical: accounts.filter((a) => a.account_type === "A").length,
    })
    .select("id")
    .single();

  if (uploadErr || !upload) {
    throw new Error(uploadErr?.message || "Erro ao criar registro de upload.");
  }

  const uploadId = upload.id;

  // Batch insert accounts (chunks of 500)
  const BATCH_SIZE = 500;
  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    const batch = accounts.slice(i, i + BATCH_SIZE).map((a) => ({
      upload_id: uploadId,
      period_id: periodId,
      account_number: a.account_number,
      account_type: a.account_type,
      account_code: a.account_code,
      description: a.description,
      previous_balance: a.previous_balance,
      debit: a.debit,
      credit: a.credit,
      current_balance: a.current_balance,
    }));

    const { error } = await supabase.from("balancete_accounts").insert(batch);
    if (error) {
      // Mark upload as error
      await supabase
        .from("balancete_uploads")
        .update({ status: "error", error_message: error.message })
        .eq("id", uploadId);
      throw new Error(`Erro ao salvar contas: ${error.message}`);
    }
  }

  // Mark completed
  const totalAccounts = accounts.length;
  const totalAnalytical = accounts.filter((a) => a.account_type === "A").length;

  await supabase
    .from("balancete_uploads")
    .update({
      status: "completed",
      total_accounts: totalAccounts,
      total_analytical: totalAnalytical,
    })
    .eq("id", uploadId);

  return { uploadId, totalAccounts, totalAnalytical };
}

// ---------------------------------------------------------------------------
// distributeToModules — applies balancete values to module tables
// ---------------------------------------------------------------------------

export async function distributeToModules(
  periodId: string,
  _uploadId: string
): Promise<DistributeResult> {
  const result: DistributeResult = { modulesUpdated: [], errors: [] };

  // 1. Fetch active mappings
  const { data: mappings } = await supabase
    .from("balancete_module_mapping")
    .select("*")
    .eq("is_active", true);

  if (!mappings || mappings.length === 0) {
    result.errors.push("Nenhum mapeamento ativo encontrado.");
    return result;
  }

  // 2. Fetch all analytical accounts for this period
  const { data: allAccounts } = await supabase
    .from("balancete_accounts")
    .select("account_code, description, current_balance")
    .eq("period_id", periodId)
    .eq("account_type", "A");

  if (!allAccounts || allAccounts.length === 0) {
    result.errors.push("Nenhuma conta analítica encontrada para este período.");
    return result;
  }

  // Build lookup: account_code → array of balances (handles duplicates like 1.2.05.003.008)
  const accountMap = new Map<string, number[]>();
  for (const acc of allAccounts) {
    const existing = accountMap.get(acc.account_code) || [];
    existing.push(Number(acc.current_balance));
    accountMap.set(acc.account_code, existing);
  }

  // Helper to get summed balance for an account code
  const getBalance = (code: string): number => {
    const values = accountMap.get(code);
    if (!values) return 0;
    return values.reduce((sum, v) => sum + v, 0);
  };

  // 3. Group mappings by module
  const fixedAssetsMappings = mappings.filter((m) => m.module_name === "fixed_assets");

  // --- FIXED ASSETS MODULE ---
  if (fixedAssetsMappings.length > 0) {
    // Fetch reconciliation rows for this period
    const { data: reconRows } = await supabase
      .from("fixed_assets_reconciliation")
      .select("id, account_asset, account_depreciation, gross_value, accumulated_depreciation, net_value")
      .eq("period_id", periodId);

    if (reconRows && reconRows.length > 0) {
      for (const row of reconRows) {
        // Find asset balance mapping
        const assetBalance = getBalance(row.account_asset);

        // Find depreciation balance mapping
        let depBalance = 0;
        if (row.account_depreciation) {
          // For account_asset 1.2.05.003.008, depreciation comes from TWO accounts:
          // 1.2.05.007.010 (Instalações) + 1.2.05.007.011 (Máquinas)
          // The mapping table handles this — find all depreciation mappings that target this category
          const depMappings = fixedAssetsMappings.filter(
            (m) => m.target_field === "accounting_balance_depreciation"
          );

          // Check if multiple depreciation accounts map to the same reconciliation row
          // by checking which depreciation account_code_patterns correspond to this row's account_depreciation
          // For single-account categories, just use the direct lookup
          if (row.account_depreciation === "1.2.05.007.010") {
            // This is the Instalações + Máquinas combined category
            // Sum both 1.2.05.007.010 and 1.2.05.007.011
            depBalance = getBalance("1.2.05.007.010") + getBalance("1.2.05.007.011");
          } else {
            depBalance = getBalance(row.account_depreciation);
          }
        }

        // Depreciation values come as negative from the balancete
        const accountingNet = assetBalance + depBalance; // depBalance is already negative
        const netValue = Number(row.net_value ?? 0);
        const difference = netValue - accountingNet;
        const newStatus = difference === 0 ? "reconciled" : "divergent";

        const { error } = await supabase
          .from("fixed_assets_reconciliation")
          .update({
            accounting_balance_asset: assetBalance,
            accounting_balance_depreciation: Math.abs(depBalance), // store as positive
            accounting_net: accountingNet,
            difference,
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);

        if (error) {
          result.errors.push(`Erro ao atualizar reconciliação ${row.account_asset}: ${error.message}`);
        }
      }

      // Update fixed_assets_summary with consolidated accounting balance
      const totalAccountingNet = reconRows.reduce((sum, row) => {
        const assetBal = getBalance(row.account_asset);
        let depBal = 0;
        if (row.account_depreciation) {
          if (row.account_depreciation === "1.2.05.007.010") {
            depBal = getBalance("1.2.05.007.010") + getBalance("1.2.05.007.011");
          } else {
            depBal = getBalance(row.account_depreciation);
          }
        }
        return sum + assetBal + depBal;
      }, 0);

      await supabase
        .from("fixed_assets_summary")
        .update({
          accounting_balance: totalAccountingNet,
          updated_at: new Date().toISOString(),
        })
        .eq("period_id", periodId);

      result.modulesUpdated.push("fixed_assets");
    } else {
      result.errors.push("Nenhuma linha de conciliação encontrada. Calcule a depreciação primeiro.");
    }
  }

  // Future modules (cash, receivables, suppliers, etc.) can be added here
  // following the same pattern with their respective mappings

  return result;
}
