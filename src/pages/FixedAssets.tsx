import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/contexts/PeriodContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useFixedAssetsCategories } from "@/hooks/useFixedAssetsCategories";
import { fetchAuditAssets, mapAuditAsset, isAuditAppConfigured, type ImportResult, type FhCategory } from "@/services/auditAppService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Building2, Pencil, Plus, Loader2, Calculator, ClipboardCheck, Download, FileSpreadsheet, FileText, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import FixedAssetsSummaryCard from "@/components/fixed-assets/FixedAssetsSummaryCard";
import FixedAssetsFilters from "@/components/fixed-assets/FixedAssetsFilters";
import FixedAssetsTable, { type AssetItem } from "@/components/fixed-assets/FixedAssetsTable";
import ReconciliationByAccount, { type ReconciliationRow } from "@/components/fixed-assets/ReconciliationByAccount";
import MonthlyMovementReport from "@/components/fixed-assets/MonthlyMovementReport";
import { exportFixedAssetsExcel } from "@/services/fixedAssetsExport";

interface SummaryRow {
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

interface BalanceteUpload {
  id: string;
  file_name: string;
  created_at: string;
  status: string;
}

export default function FixedAssets() {
  const navigate = useNavigate();
  const { selectedPeriod, periods } = usePeriod();
  const { t } = useLanguage();
  const { categories, getLabel } = useFixedAssetsCategories();

  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, phase: "" });
  const [balanceteUpload, setBalanceteUpload] = useState<BalanceteUpload | null>(null);
  // Filters
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [fullyDepreciatedOnly, setFullyDepreciatedOnly] = useState(false);

  // Edit summary modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [accBalance, setAccBalance] = useState("");
  const [justification, setJustification] = useState("");

  // Add item modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newItem, setNewItem] = useState({ ...EMPTY_ITEM });

  const fetchData = useCallback(async () => {
    if (!selectedPeriod) return;
    setLoading(true);

    const [summaryRes, itemsRes, reconRes, uploadRes] = await Promise.all([
      supabase.from("fixed_assets_summary").select("*").eq("period_id", selectedPeriod.id).maybeSingle(),
      supabase.from("fixed_assets_items").select("*").eq("period_id", selectedPeriod.id).order("asset_code"),
      supabase.from("fixed_assets_reconciliation").select("*").eq("period_id", selectedPeriod.id),
      supabase.from("balancete_uploads").select("id, file_name, created_at, status").eq("period_id", selectedPeriod.id).maybeSingle(),
    ]);

    setBalanceteUpload(uploadRes.data as BalanceteUpload | null);

    if (summaryRes.data) {
      const s = summaryRes.data as unknown as SummaryRow;
      setSummary(s);
      setAccBalance(String(s.accounting_balance));
      setJustification(s.justification ?? "");
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

  // Use reconciliation-based totals when available
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
    // Find most recent updated_at or last_audit_date from audit items
    return auditItems.reduce((latest, i) => {
      const d = (i as any).last_audit_date || (i as any).updated_at;
      if (!d) return latest;
      return !latest || d > latest ? d : latest;
    }, null as string | null);
  }, [items]);

  // Filtered items
  const filtered = useMemo(() => {
    let result = items;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(i =>
        i.asset_code.toLowerCase().includes(q) ||
        i.asset_description.toLowerCase().includes(q) ||
        (i.asset_tag && i.asset_tag.toLowerCase().includes(q)) ||
        (i.responsible_name && i.responsible_name.toLowerCase().includes(q))
      );
    }
    if (category !== "all") {
      result = result.filter(i => i.category === category);
    }
    if (fullyDepreciatedOnly) {
      result = result.filter(i => i.status === "ativo" && Number(i.accumulated_depreciation) >= Number(i.gross_value) && Number(i.gross_value) > 0);
    }
    return result;
  }, [items, search, category, fullyDepreciatedOnly]);

  // Category label map by ID for reconciliation
  const categoryIdLabelMap = useMemo(() => {
    return new Map(categories.map(c => [c.id, c.label]));
  }, [categories]);

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

  // Save accounting balance + justification (legacy summary)
  const handleSaveSummary = async () => {
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

    if (error) { toast.error(error.message); return; }
    toast.success(t("cash.saved"));
    setEditModalOpen(false);
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

      // Build FH categories list for account_code mapping
      const fhCategories: FhCategory[] = categories.map(c => ({ id: c.id, code: c.code, account_asset: c.account_asset }));

      const importResult: ImportResult = { inserted: 0, updated: 0, unchanged: 0, errors: [] };

      for (let i = 0; i < auditAssets.length; i++) {
        const mapped = mapAuditAsset(auditAssets[i], fhCategories);

        // Find category for defaults
        const cat = categories.find(c => c.code === mapped.category);

        // Check if exists
        const { data: existing } = await supabase
          .from("fixed_assets_items")
          .select("id, asset_code, asset_description, gross_value, status, responsible_name, responsible_department, asset_tag, useful_life_months, monthly_depreciation_rate, acquisition_date, notes")
          .eq("audit_source_id", mapped.audit_source_id)
          .eq("period_id", selectedPeriod.id)
          .maybeSingle();

        // Apply category defaults for useful_life and depreciation rate
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
          // Check if anything changed
          const changed =
            existing.asset_code !== record.asset_code ||
            existing.asset_description !== record.asset_description ||
            Number(existing.gross_value) !== record.gross_value ||
            existing.status !== record.status ||
            existing.responsible_name !== record.responsible_name ||
            existing.responsible_department !== record.responsible_department ||
            existing.asset_tag !== record.asset_tag;

          if (changed) {
            // Don't overwrite useful_life/depreciation if manually edited
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

  // Handle category change in add form — auto-fill defaults
  const handleCategoryChange = (code: string) => {
    const cat = categories.find(c => c.code === code);
    setNewItem(prev => ({
      ...prev,
      category: code,
      monthly_depreciation_rate: cat?.default_monthly_rate ? String(cat.default_monthly_rate) : prev.monthly_depreciation_rate,
      useful_life_months: cat?.default_useful_life_months ? String(cat.default_useful_life_months) : prev.useful_life_months,
    }));
  };

  const handleAddItem = async () => {
    if (!selectedPeriod || !newItem.asset_code) return;

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

    if (error) { toast.error(error.message); return; }
    toast.success("Bem adicionado!");
    setAddModalOpen(false);
    setNewItem({ ...EMPTY_ITEM });
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Building2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">{t("fa.title")}</h1>
          {lastAuditDate && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <ClipboardCheck className="h-3 w-3" />
              Última auditoria: {new Date(lastAuditDate).toLocaleDateString("pt-BR")}
            </Badge>
          )}
          {balanceteUpload ? (
            <Badge variant="outline" className="text-[10px] gap-1 border-primary/30 bg-primary/5 text-primary">
              <FileText className="h-3 w-3" />
              Balancete: {new Date(balanceteUpload.created_at).toLocaleDateString("pt-BR")} ✅
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-warning/30 bg-warning/5 text-warning cursor-pointer"
              onClick={() => navigate("/closing")}
            >
              <AlertTriangle className="h-3 w-3" />
              Balancete: Não importado ⚠️
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleImportAudit} disabled={importing}>
            {importing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            Receber Dados
          </Button>
          <Button variant="outline" size="sm" onClick={handleCalculateDepreciation} disabled={calculating}>
            {calculating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Calculator className="mr-1.5 h-4 w-4" />}
            Calcular Depreciação
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAddModalOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Adicionar Bem
          </Button>
          <Button variant="outline" size="sm" onClick={() => {
            if (!selectedPeriod) return;
            exportFixedAssetsExcel({
              periodId: selectedPeriod.id, periodYear: selectedPeriod.year, periodMonth: selectedPeriod.month,
              categories, items, reconciliation, categoryIdLabelMap, periods,
            });
          }}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            Exportar Excel
          </Button>
          {summary && reconciliation.length === 0 && (
            <Button variant="outline" size="sm" onClick={() => setEditModalOpen(true)}>
              <Pencil className="mr-1.5 h-4 w-4" />
              Saldo Contábil
            </Button>
          )}
        </div>
      </div>

      {/* Summary card */}
      <FixedAssetsSummaryCard
        grossValue={totals.gross}
        depreciation={totals.dep}
        netValue={totals.net}
        accountingBalance={accNum}
        difference={diff}
        status={status}
        justification={reconTotals ? null : summary?.justification}
      />

      {/* Monthly Movement Report */}
      {selectedPeriod && (
        <MonthlyMovementReport
          categories={categories}
          periodId={selectedPeriod.id}
          periodYear={selectedPeriod.year}
          periodMonth={selectedPeriod.month}
        />
      )}

      {/* Reconciliation by account */}
      <ReconciliationByAccount
        rows={reconciliation}
        categoryLabels={categoryIdLabelMap}
        onRefresh={fetchData}
        hasBalancete={!!balanceteUpload}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-foreground">{items.length}</p>
            <p className="text-[11px] text-muted-foreground">Total de Bens</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-success">{items.filter(i => i.status === "ativo").length}</p>
            <p className="text-[11px] text-muted-foreground">Ativos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-muted-foreground">{items.filter(i => i.status === "baixado").length}</p>
            <p className="text-[11px] text-muted-foreground">Baixados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-warning">{items.filter(i => i.status === "ativo" && Number(i.accumulated_depreciation) >= Number(i.gross_value) && Number(i.gross_value) > 0).length}</p>
            <p className="text-[11px] text-muted-foreground">100% Depreciados</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xl font-bold text-foreground">{items.filter(i => i.source === "auditoria").length}</p>
            <p className="text-[11px] text-muted-foreground">Via Auditoria</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <FixedAssetsFilters
        search={search}
        onSearchChange={setSearch}
        category={category}
        onCategoryChange={setCategory}
        categories={categories}
        fullyDepreciatedOnly={fullyDepreciatedOnly}
        onFullyDepreciatedChange={setFullyDepreciatedOnly}
      />

      {/* Table */}
      <FixedAssetsTable
        items={filtered}
        onInlineUpdate={handleInlineUpdate}
        onDelete={handleDelete}
        getCategoryLabel={getLabel}
      />

      {/* Edit accounting balance modal (legacy — shown only when no reconciliation rows) */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar Saldo Contábil</DialogTitle>
            <DialogDescription>
              Atualize o saldo contábil do balancete e adicione justificativa se houver diferença.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">{t("dashboard.accounting_balance")} (1.2.05)</Label>
              <Input type="number" step="0.01" value={accBalance} onChange={(e) => setAccBalance(e.target.value)} />
            </div>
            {(parseFloat(accBalance) || 0) !== totals.net && (
              <div className="space-y-1">
                <Label className="text-xs">{t("cash.justification")}</Label>
                <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} placeholder="Justifique a diferença..." />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditModalOpen(false)}>{t("cash.cancel")}</Button>
              <Button onClick={handleSaveSummary}>{t("cash.save")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add item modal */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Adicionar Bem Patrimonial</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Código *</Label>
              <Input value={newItem.asset_code} onChange={(e) => setNewItem({ ...newItem, asset_code: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Descrição</Label>
              <Input value={newItem.asset_description} onChange={(e) => setNewItem({ ...newItem, asset_description: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Categoria</Label>
              <Select value={newItem.category} onValueChange={handleCategoryChange}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nº Patrimônio</Label>
              <Input value={newItem.asset_tag} onChange={(e) => setNewItem({ ...newItem, asset_tag: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Localização</Label>
              <Input value={newItem.location} onChange={(e) => setNewItem({ ...newItem, location: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Responsável</Label>
              <Input value={newItem.responsible_name} onChange={(e) => setNewItem({ ...newItem, responsible_name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Departamento</Label>
              <Input value={newItem.responsible_department} onChange={(e) => setNewItem({ ...newItem, responsible_department: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Nº Série</Label>
              <Input value={newItem.serial_number} onChange={(e) => setNewItem({ ...newItem, serial_number: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Marca/Modelo</Label>
              <Input value={newItem.brand_model} onChange={(e) => setNewItem({ ...newItem, brand_model: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Data Aquisição</Label>
              <Input type="date" value={newItem.acquisition_date} onChange={(e) => setNewItem({ ...newItem, acquisition_date: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Valor Bruto (R$)</Label>
              <Input type="number" step="0.01" value={newItem.gross_value} onChange={(e) => setNewItem({ ...newItem, gross_value: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Depr. Acumulada (R$)</Label>
              <Input type="number" step="0.01" value={newItem.accumulated_depreciation} onChange={(e) => setNewItem({ ...newItem, accumulated_depreciation: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Taxa Depr. Mensal (%)</Label>
              <Input type="number" step="0.01" value={newItem.monthly_depreciation_rate} onChange={(e) => setNewItem({ ...newItem, monthly_depreciation_rate: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Vida Útil (meses)</Label>
              <Input type="number" value={newItem.useful_life_months} onChange={(e) => setNewItem({ ...newItem, useful_life_months: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setAddModalOpen(false)}>{t("cash.cancel")}</Button>
            <Button onClick={handleAddItem} disabled={!newItem.asset_code}>Adicionar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import progress modal */}
      <Dialog open={importing} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Recebendo Dados do Audit App</DialogTitle>
            <DialogDescription>{importProgress.phase}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Progress value={importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0} className="h-2" />
            <p className="text-sm text-center text-muted-foreground">
              {importProgress.current} de {importProgress.total}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
