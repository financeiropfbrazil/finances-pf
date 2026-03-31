import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/contexts/PeriodContext";
import { useFixedAssetsCategories } from "@/hooks/useFixedAssetsCategories";
import { fetchAuditAssets, mapAuditAsset, isAuditAppConfigured, type ImportResult, type FhCategory } from "@/services/auditAppService";
import { toast } from "sonner";
import type { AssetItem } from "@/components/fixed-assets/FixedAssetsTable";
import type { ReconciliationRow } from "@/components/fixed-assets/ReconciliationByAccount";

export interface SummaryRow {
  id: string;
  period_id: string;
  gross_asset_value: number;
  accumulated_depreciation: number;
  net_asset_value: number;
  accounting_balance: number;
  difference: number;
  status: string;
  justification: string | null;
  source: string;
}

const EMPTY_ITEM = {
  asset_code: "", asset_description: "", category: "",
  location: "", acquisition_date: "", gross_value: "", accumulated_depreciation: "",
  monthly_depreciation_rate: "", useful_life_months: "",
  asset_tag: "", responsible_name: "", responsible_department: "",
  serial_number: "", brand_model: "",
};

export function useFixedAssets() {
  const { selectedPeriod, periods } = usePeriod();
  const { categories, getLabel } = useFixedAssetsCategories();

  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, phase: "" });

  const fetchData = useCallback(async () => {
    if (!selectedPeriod) return;
    setLoading(true);

    const [summaryRes, itemsRes, reconRes] = await Promise.all([
      supabase.from("fixed_assets_summary").select("*").eq("period_id", selectedPeriod.id).maybeSingle(),
      supabase.from("fixed_assets_items").select("*").eq("period_id", selectedPeriod.id).order("asset_code"),
      supabase.from("fixed_assets_reconciliation").select("*").eq("period_id", selectedPeriod.id),
    ]);

    if (summaryRes.data) {
      setSummary(summaryRes.data as unknown as SummaryRow);
    } else {
      setSummary(null);
    }

    setItems((itemsRes.data ?? []) as unknown as AssetItem[]);
    setReconciliation((reconRes.data ?? []) as unknown as ReconciliationRow[]);
    setLoading(false);
  }, [selectedPeriod]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Computed totals from items
  const totals = useMemo(() => {
    const active = items.filter(i => i.status === "ativo");
    const gross = active.reduce((s, i) => s + Number(i.gross_value), 0);
    const dep = active.reduce((s, i) => s + Number(i.accumulated_depreciation), 0);
    return { gross, dep, net: gross - dep };
  }, [items]);

  // Reconciliation-based totals
  const reconTotals = useMemo(() => {
    if (reconciliation.length === 0) return null;
    const accNet = reconciliation.reduce((s, r) => s + Number(r.accounting_net ?? 0), 0);
    const diff = reconciliation.reduce((s, r) => s + Number(r.difference ?? 0), 0);
    const allReconciled = reconciliation.every(r => r.status === "reconciled");
    const anyDivergent = reconciliation.some(r => r.status === "divergent");
    const status = allReconciled ? "reconciled" : anyDivergent ? "divergent" : "justified";
    return { accNet, diff, status };
  }, [reconciliation]);

  const accNum = reconTotals ? reconTotals.accNet : (summary ? Number(summary.accounting_balance) : 0);
  const diff = reconTotals ? reconTotals.diff : totals.net - accNum;
  const status = reconTotals ? reconTotals.status : (summary?.status ?? (diff === 0 ? "reconciled" : "divergent"));

  // Last audit date
  const lastAuditDate = useMemo(() => {
    const auditItems = items.filter(i => i.source === "auditoria");
    if (auditItems.length === 0) return null;
    return auditItems.reduce((latest, i) => {
      const d = (i as any).last_audit_date || (i as any).updated_at;
      if (!d) return latest;
      return !latest || d > latest ? d : latest;
    }, null as string | null);
  }, [items]);

  // Category label map by ID for reconciliation
  const categoryIdLabelMap = useMemo(() => {
    return new Map(categories.map(c => [c.id, c.label]));
  }, [categories]);

  // Stats
  const stats = useMemo(() => ({
    total: items.length,
    active: items.filter(i => i.status === "ativo").length,
    disposed: items.filter(i => i.status === "baixado").length,
    fullyDepreciated: items.filter(i => i.status === "ativo" && Number(i.accumulated_depreciation) >= Number(i.gross_value) && Number(i.gross_value) > 0).length,
    fromAudit: items.filter(i => i.source === "auditoria").length,
  }), [items]);

  // Inline update
  const handleInlineUpdate = async (id: string, field: string, value: number) => {
    const { error } = await supabase.from("fixed_assets_items").update({ [field]: value }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Atualizado!");
    fetchData();
  };

  // Delete
  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("fixed_assets_items").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Item excluído!");
    fetchData();
  };

  // Calculate depreciation
  const handleCalculateDepreciation = async () => {
    if (!selectedPeriod) return;
    setCalculating(true);
    try {
      const { data, error } = await supabase.rpc('calculate_monthly_depreciation', { p_period_id: selectedPeriod.id });
      if (error) { toast.error(error.message); return; }
      toast.success(`Depreciação calculada para ${data} ativo(s).`);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Erro ao calcular depreciação");
    } finally {
      setCalculating(false);
    }
  };

  // Import from Audit App
  const handleImportAudit = async () => {
    if (!selectedPeriod) return;
    if (!isAuditAppConfigured()) {
      toast.error("Audit App não configurado. Vá em Configurações → Audit App.");
      return;
    }

    setImporting(true);
    setImportProgress({ current: 0, total: 0, phase: "Buscando dados do Audit App..." });

    try {
      const result = await fetchAuditAssets();
      if (!result.success || !result.data) {
        toast.error(result.error || "Erro ao buscar dados");
        setImporting(false);
        return;
      }

      const auditAssets = result.data;
      const total = auditAssets.length;
      setImportProgress({ current: 0, total, phase: `Processando ${total} ativos...` });

      const fhCategories: FhCategory[] = categories.map(c => ({ id: c.id, code: c.code, account_asset: c.account_asset }));
      const importResult: ImportResult = { inserted: 0, updated: 0, unchanged: 0, errors: [] };

      for (let i = 0; i < auditAssets.length; i++) {
        const mapped = mapAuditAsset(auditAssets[i], fhCategories);
        const cat = categories.find(c => c.code === mapped.category);

        const { data: existing } = await supabase
          .from("fixed_assets_items")
          .select("id, asset_code, asset_description, gross_value, status, responsible_name, responsible_department, asset_tag, useful_life_months, monthly_depreciation_rate, acquisition_date, notes")
          .eq("audit_source_id", mapped.audit_source_id)
          .eq("period_id", selectedPeriod.id)
          .maybeSingle();

        const DEFAULT_USEFUL_LIFE = 120;
        let usefulLife = mapped.useful_life_months;
        let depRate = mapped.monthly_depreciation_rate;

        if (!usefulLife || usefulLife <= 0) {
          usefulLife = cat?.default_useful_life_months ?? DEFAULT_USEFUL_LIFE;
          depRate = usefulLife > 0 ? Number((100 / usefulLife).toFixed(4)) : 0;
        } else if (!depRate || depRate <= 0) {
          depRate = Number((100 / usefulLife).toFixed(4));
        }

        const record = {
          period_id: selectedPeriod.id,
          audit_source_id: mapped.audit_source_id,
          asset_tag: mapped.asset_tag,
          asset_code: mapped.asset_code,
          asset_description: mapped.asset_description,
          category: mapped.category,
          category_id: mapped.category_id,
          responsible_name: mapped.responsible_name,
          responsible_department: mapped.responsible_department,
          gross_value: mapped.gross_value,
          useful_life_months: usefulLife,
          monthly_depreciation_rate: depRate,
          acquisition_date: mapped.acquisition_date,
          notes: mapped.notes,
          status: mapped.status,
          source: "auditoria" as const,
          last_audit_date: new Date().toISOString().split("T")[0],
        };

        if (existing) {
          const changed =
            existing.asset_code !== record.asset_code ||
            existing.asset_description !== record.asset_description ||
            Number(existing.gross_value) !== record.gross_value ||
            existing.status !== record.status ||
            existing.responsible_name !== record.responsible_name ||
            existing.responsible_department !== record.responsible_department ||
            existing.asset_tag !== record.asset_tag;

          if (changed) {
            const { useful_life_months: _ul, monthly_depreciation_rate: _dr, ...updateRecord } = record;
            const { error } = await supabase.from("fixed_assets_items").update(updateRecord).eq("id", existing.id);
            if (error) { importResult.errors.push(`${mapped.asset_code}: ${error.message}`); }
            else { importResult.updated++; }
          } else {
            importResult.unchanged++;
          }
        } else {
          const { error } = await supabase.from("fixed_assets_items").insert(record);
          if (error) { importResult.errors.push(`${mapped.asset_code}: ${error.message}`); }
          else { importResult.inserted++; }
        }

        setImportProgress({ current: i + 1, total, phase: `Processando ${i + 1} de ${total}...` });
      }

      toast.success(
        `Importação concluída: ${importResult.inserted} inseridos, ${importResult.updated} atualizados, ${importResult.unchanged} sem alteração` +
        (importResult.errors.length > 0 ? `, ${importResult.errors.length} erros` : "")
      );

      if (importResult.errors.length > 0) {
        console.warn("Import errors:", importResult.errors);
      }

      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Erro na importação");
    } finally {
      setImporting(false);
    }
  };

  // Save accounting balance + justification (legacy summary)
  const handleSaveSummary = async (accBalance: string, justification: string) => {
    if (!summary) return;
    const accVal = parseFloat(accBalance) || 0;
    const newDiff = totals.net - accVal;
    const hasJust = justification.trim().length > 0;
    const newStatus = newDiff === 0 ? "reconciled" : hasJust ? "justified" : "divergent";

    const { error } = await supabase.from("fixed_assets_summary").update({
      accounting_balance: accVal,
      justification: newDiff !== 0 ? justification.trim() || null : null,
      status: newStatus,
    }).eq("id", summary.id);

    if (error) { toast.error(error.message); return false; }
    toast.success("Salvo!");
    fetchData();
    return true;
  };

  // Add item
  const handleAddItem = async (newItem: typeof EMPTY_ITEM) => {
    if (!selectedPeriod || !newItem.asset_code) return false;

    const cat = categories.find(c => c.code === newItem.category);

    const { error } = await supabase.from("fixed_assets_items").insert({
      period_id: selectedPeriod.id,
      asset_code: newItem.asset_code,
      asset_description: newItem.asset_description,
      category: newItem.category,
      category_id: cat?.id || null,
      location: newItem.location,
      acquisition_date: newItem.acquisition_date || null,
      gross_value: parseFloat(newItem.gross_value) || 0,
      accumulated_depreciation: parseFloat(newItem.accumulated_depreciation) || 0,
      monthly_depreciation_rate: parseFloat(newItem.monthly_depreciation_rate) || 0,
      useful_life_months: parseInt(newItem.useful_life_months) || 0,
      asset_tag: newItem.asset_tag || null,
      responsible_name: newItem.responsible_name || null,
      responsible_department: newItem.responsible_department || null,
      serial_number: newItem.serial_number || null,
      brand_model: newItem.brand_model || null,
      source: "manual",
    });

    if (error) { toast.error(error.message); return false; }
    toast.success("Bem adicionado!");
    fetchData();
    return true;
  };

  // Category change handler for add form
  const getCategoryDefaults = (code: string) => {
    const cat = categories.find(c => c.code === code);
    return {
      monthly_depreciation_rate: cat?.default_monthly_rate ? String(cat.default_monthly_rate) : "",
      useful_life_months: cat?.default_useful_life_months ? String(cat.default_useful_life_months) : "",
    };
  };

  return {
    selectedPeriod,
    periods,
    categories,
    getLabel,
    summary,
    items,
    reconciliation,
    loading,
    calculating,
    importing,
    importProgress,
    totals,
    reconTotals,
    accNum,
    diff,
    status,
    lastAuditDate,
    categoryIdLabelMap,
    stats,
    fetchData,
    handleInlineUpdate,
    handleDelete,
    handleCalculateDepreciation,
    handleImportAudit,
    handleSaveSummary,
    handleAddItem,
    getCategoryDefaults,
    EMPTY_ITEM,
  };
}
