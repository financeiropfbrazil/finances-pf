import { useState, useMemo } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useFixedAssets } from "@/hooks/useFixedAssets";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Plus } from "lucide-react";
import FixedAssetsFilters from "@/components/fixed-assets/FixedAssetsFilters";
import FixedAssetsTable from "@/components/fixed-assets/FixedAssetsTable";

export default function FixedAssetsItems() {
  const { t } = useLanguage();
  const {
    categories, getLabel, items, loading,
    handleInlineUpdate, handleDelete, handleAddItem,
    getCategoryDefaults, EMPTY_ITEM,
  } = useFixedAssets();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [fullyDepreciatedOnly, setFullyDepreciatedOnly] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newItem, setNewItem] = useState({ ...EMPTY_ITEM });

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

  const handleCategoryChange = (code: string) => {
    const defaults = getCategoryDefaults(code);
    setNewItem(prev => ({
      ...prev,
      category: code,
      monthly_depreciation_rate: defaults.monthly_depreciation_rate || prev.monthly_depreciation_rate,
      useful_life_months: defaults.useful_life_months || prev.useful_life_months,
    }));
  };

  const onAddItem = async () => {
    const ok = await handleAddItem(newItem);
    if (ok) {
      setAddModalOpen(false);
      setNewItem({ ...EMPTY_ITEM });
    }
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
          <h1 className="text-2xl font-bold text-foreground">Imobilizado — Ativos</h1>
          <Badge variant="secondary" className="text-xs">{items.length} ativos</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAddModalOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Adicionar Bem
        </Button>
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
            <Button onClick={onAddItem} disabled={!newItem.asset_code}>Adicionar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
