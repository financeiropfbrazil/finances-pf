import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoreHorizontal, Pencil, Trash2, Package } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { InventoryItem } from "@/pages/Inventory";
import { useState, KeyboardEvent } from "react";
import { format } from "date-fns";

const CAT_COLORS: Record<string, string> = {
  materia_prima: "bg-primary/20 text-primary border-primary/30",
  em_elaboracao: "bg-warning/20 text-warning border-warning/30",
  produto_acabado: "bg-success/20 text-success border-success/30",
  embalagem: "bg-accent/20 text-accent-foreground border-accent/30",
  outros: "bg-muted text-muted-foreground border-border",
};

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface Props {
  items: InventoryItem[];
  openEdit: (i: InventoryItem) => void;
  deleteItem: (id: string) => void;
  onInlineUpdate: (id: string, field: 'physical_quantity' | 'unit_cost', value: number) => void;
}

export function InventoryTable({ items, openEdit, deleteItem, onInlineUpdate }: Props) {
  const { t } = useLanguage();
  const [editingCell, setEditingCell] = useState<{ id: string, field: 'physical_quantity' | 'unit_cost' } | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (item: InventoryItem, field: 'physical_quantity' | 'unit_cost') => {
    setEditingCell({ id: item.id, field });
    setEditValue(String(item[field]));
  };

  const saveEdit = () => {
    if (!editingCell) return;
    const value = parseFloat(editValue.replace(",", "."));
    if (!isNaN(value) && value >= 0) {
      onInlineUpdate(editingCell.id, editingCell.field, value);
    }
    setEditingCell(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') setEditingCell(null);
  };

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("inv.item_code")}</TableHead>
            <TableHead>{t("inv.description")}</TableHead>
            <TableHead>{t("inv.category")}</TableHead>
            <TableHead>{t("inv.unit")}</TableHead>
            <TableHead className="text-right">{t("inv.quantity")}</TableHead>
            <TableHead className="text-right">{t("inv.unit_cost")}</TableHead>
            <TableHead className="text-right">{t("inv.total_cost")}</TableHead>
            <TableHead>{t("inv.location")}</TableHead>
            <TableHead>Data Criação</TableHead>
            <TableHead className="text-center">{t("cash.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                <Package className="mx-auto h-8 w-8 mb-2 opacity-40" />
                {t("inv.add_item")}
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono text-sm">{item.item_code}</TableCell>
                <TableCell className="font-medium">{item.item_description}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${CAT_COLORS[item.category]}`}>
                    {t(("inv.cat." + item.category) as any)}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">{item.unit_of_measure}</TableCell>
                
                <TableCell className="text-right">
                  {editingCell?.id === item.id && editingCell?.field === 'physical_quantity' ? (
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        type="number"
                        step="0.0001"
                        autoFocus
                        className="w-24 h-8 text-right"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={handleKeyDown}
                      />
                    </div>
                  ) : (
                    <div 
                      className="cursor-pointer hover:bg-muted/50 px-2 py-1 rounded-md transition-colors inline-block"
                      onClick={() => startEdit(item, 'physical_quantity')}
                      title="Clique para editar"
                    >
                      {Number(item.physical_quantity).toLocaleString("pt-BR")}
                    </div>
                  )}
                </TableCell>

                <TableCell className="text-right">
                  {editingCell?.id === item.id && editingCell?.field === 'unit_cost' ? (
                    <div className="flex items-center justify-end gap-1">
                      <Input
                        type="number"
                        step="0.0001"
                        autoFocus
                        className="w-24 h-8 text-right"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={handleKeyDown}
                      />
                    </div>
                  ) : (
                    <div 
                      className="cursor-pointer hover:bg-muted/50 px-2 py-1 rounded-md transition-colors inline-block"
                      onClick={() => startEdit(item, 'unit_cost')}
                      title="Clique para editar"
                    >
                      {formatBRL(Number(item.unit_cost))}
                    </div>
                  )}
                </TableCell>

                <TableCell className="text-right font-semibold">{formatBRL(Number(item.total_cost))}</TableCell>
                <TableCell className="text-muted-foreground">{t(("inv.loc." + item.location) as any)}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {item.created_at ? format(new Date(item.created_at), "dd/MM/yyyy") : "-"}
                </TableCell>
                <TableCell className="text-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(item)}>
                        <Pencil className="mr-2 h-4 w-4" /> {t("cash.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => deleteItem(item.id)} className="text-danger">
                        <Trash2 className="mr-2 h-4 w-4" /> {t("cash.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
