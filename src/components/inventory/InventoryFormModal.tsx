import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";

const CATEGORIES = ["materia_prima", "em_elaboracao", "produto_acabado", "embalagem", "outros"] as const;
const LOCATIONS = ["almoxarifado", "producao", "expedicao"] as const;

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface InventoryFormState {
  item_code: string;
  item_description: string;
  category: string;
  unit_of_measure: string;
  physical_quantity: string;
  unit_cost: string;
  location: string;
  notes: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: InventoryFormState;
  setForm: (f: InventoryFormState) => void;
  saveForm: () => void;
  isEdit: boolean;
}

export function InventoryFormModal({ open, onOpenChange, form, setForm, saveForm, isEdit }: Props) {
  const { t } = useLanguage();
  const computedTotal = (parseFloat(form.physical_quantity.replace(",", ".")) || 0) * (parseFloat(form.unit_cost.replace(",", ".")) || 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("cash.edit") : t("inv.add_item")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">{t("inv.item_code")}</label>
              <Input value={form.item_code} onChange={(e) => setForm({ ...form, item_code: e.target.value })} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">{t("inv.unit")}</label>
              <Input value={form.unit_of_measure} onChange={(e) => setForm({ ...form, unit_of_measure: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-sm text-muted-foreground">{t("inv.description")}</label>
            <Input value={form.item_description} onChange={(e) => setForm({ ...form, item_description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">{t("inv.category")}</label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{t(("inv.cat." + c) as any)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">{t("inv.location")}</label>
              <Select value={form.location} onValueChange={(v) => setForm({ ...form, location: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LOCATIONS.map((l) => (
                    <SelectItem key={l} value={l}>{t(("inv.loc." + l) as any)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">{t("inv.quantity")}</label>
              <Input type="number" step="0.0001" value={form.physical_quantity} onChange={(e) => setForm({ ...form, physical_quantity: e.target.value })} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">{t("inv.unit_cost")}</label>
              <Input type="number" step="0.0001" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
            </div>
          </div>
          <div className="rounded-md bg-muted p-3 text-sm">
            <span className="text-muted-foreground">{t("inv.total_cost")}: </span>
            <span className="font-semibold text-foreground">{formatBRL(computedTotal)}</span>
          </div>
          <div>
            <label className="text-sm text-muted-foreground">{t("recv.notes")}</label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("cash.cancel")}</Button>
          <Button onClick={saveForm} disabled={!form.item_code.trim() || !form.item_description.trim()}>
            {t("cash.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
