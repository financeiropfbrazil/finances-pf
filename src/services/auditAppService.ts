import { createClient } from "@supabase/supabase-js";

export interface AuditAsset {
  id: string;
  numero_bem: number;
  adicao: number | null;
  plaqueta: string | null;
  descricao: string;
  valor_original: number;
  valor_residual: number | null;
  vida_util_meses: number | null;
  data_compra: string | null;
  numero_nf: string | null;
  fornecedor: string | null;
  status: string;
  categorias: { id: string; nome: string; account_code: string | null } | null;
  colaboradores: { id: string; nome: string; cargo: string | null; email: string | null } | null;
  setores: { id: string; nome: string } | null;
}

export interface ImportResult {
  inserted: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

export interface FhCategory {
  id: string;
  code: string;
  account_asset: string;
}

function getAuditConfig(): { url: string; anonKey: string } | null {
  const url = localStorage.getItem("audit_app_supabase_url");
  const anonKey = localStorage.getItem("audit_app_supabase_anon_key");
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isAuditAppConfigured(): boolean {
  return getAuditConfig() !== null;
}

export async function fetchAuditAssets(): Promise<{ success: boolean; data?: AuditAsset[]; error?: string }> {
  const config = getAuditConfig();
  if (!config) {
    return { success: false, error: "Audit App não configurado. Vá em Configurações → Audit App." };
  }

  try {
    const auditClient = createClient(config.url, config.anonKey);

    const { data, error } = await auditClient
      .from("ativos")
      .select(`
        *,
        categorias:categoria_id(id, nome, account_code),
        colaboradores:responsavel_id(id, nome, cargo, email),
        setores:setor_responsavel_id(id, nome)
      `)
      .order("numero_bem");

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data ?? []) as unknown as AuditAsset[] };
  } catch (err: any) {
    return { success: false, error: err.message || "Erro de conexão com o Audit App" };
  }
}

/**
 * Maps an audit asset's account_code to FH category using account_asset match.
 * Falls back to 'maquinas_equipamentos' if no match found.
 */
export function resolveCategory(
  accountCode: string | null | undefined,
  fhCategories: FhCategory[]
): { code: string; id: string | null } {
  if (accountCode) {
    const match = fhCategories.find(c => c.account_asset === accountCode);
    if (match) return { code: match.code, id: match.id };
  }
  // Fallback
  const fallback = fhCategories.find(c => c.code === "maquinas_equipamentos");
  return { code: "maquinas_equipamentos", id: fallback?.id || null };
}

export interface MappedAsset {
  audit_source_id: string;
  asset_tag: string | null;
  asset_code: string;
  asset_description: string;
  category: string;
  category_id: string | null;
  responsible_name: string | null;
  responsible_department: string | null;
  gross_value: number;
  useful_life_months: number | null;
  monthly_depreciation_rate: number | null;
  acquisition_date: string | null;
  notes: string | null;
  status: string;
  source: "auditoria";
}

export function mapAuditAsset(asset: AuditAsset, fhCategories: FhCategory[]): MappedAsset {
  const adicao = asset.adicao ? `-${asset.adicao}` : "";
  const assetCode = `${asset.numero_bem}${adicao}`;

  const notesParts: string[] = [];
  if (asset.numero_nf) notesParts.push(`NF: ${asset.numero_nf}`);
  if (asset.fornecedor) notesParts.push(`Fornecedor: ${asset.fornecedor}`);

  const monthlyRate = asset.vida_util_meses && asset.vida_util_meses > 0
    ? Number((100 / asset.vida_util_meses).toFixed(4))
    : null;

  const statusMap: Record<string, string> = {
    ativo: "ativo",
    baixado: "baixado",
    em_uso: "ativo",
  };

  const resolved = resolveCategory(asset.categorias?.account_code, fhCategories);

  return {
    audit_source_id: asset.id,
    asset_tag: asset.plaqueta || null,
    asset_code: assetCode,
    asset_description: asset.descricao || "",
    category: resolved.code,
    category_id: resolved.id,
    responsible_name: asset.colaboradores?.nome || null,
    responsible_department: asset.setores?.nome || null,
    gross_value: asset.valor_original || 0,
    useful_life_months: asset.vida_util_meses || null,
    monthly_depreciation_rate: monthlyRate,
    acquisition_date: asset.data_compra || null,
    notes: notesParts.length > 0 ? notesParts.join(" | ") : null,
    status: statusMap[asset.status?.toLowerCase()] ?? "ativo",
    source: "auditoria",
  };
}
