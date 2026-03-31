import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface AssetItem {
  id: string;
  asset_code: string;
  asset_description: string;
  category: string;
  location: string;
  acquisition_date: string | null;
  gross_value: number;
  accumulated_depreciation: number;
  net_value: number;
  monthly_depreciation_rate: number;
  useful_life_months: number;
  status: string;
  source: string;
  asset_tag: string | null;
  responsible_name: string | null;
  responsible_department: string | null;
  serial_number: string | null;
  brand_model: string | null;
}

const SOURCE_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  manual: { label: "Manual", variant: "outline" },
  auditoria: { label: "Auditoria", variant: "default" },
  alvo: { label: "ERP", variant: "secondary" },
};

interface Props {
  items: AssetItem[];
  onInlineUpdate: (id: string, field: string, value: number) => void;
  onDelete: (id: string) => void;
  getCategoryLabel: (code: string) => string;
}

export default function FixedAssetsTable({ items, onInlineUpdate, onDelete, getCategoryLabel }: Props) {
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (id: string, field: string, currentValue: number) => {
    setEditingCell({ id, field });
    setEditValue(String(currentValue));
  };

  const saveEdit = () => {
    if (!editingCell) return;
    const value = parseFloat(editValue.replace(",", "."));
    if (!isNaN(value) && value >= 0) {
      onInlineUpdate(editingCell.id, editingCell.field, value);
    }
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") saveEdit();
    if (e.key === "Escape") setEditingCell(null);
  };

  const renderEditableCell = (item: AssetItem, field: "gross_value" | "accumulated_depreciation", value: number) => {
    const isEditing = editingCell?.id === item.id && editingCell?.field === field;
    if (isEditing) {
      return (
        <Input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={handleKeyDown}
          className="h-7 w-28 text-xs"
        />
      );
    }
    return (
      <span
        className="cursor-pointer hover:bg-accent/50 rounded px-1.5 py-0.5 transition-colors"
        onClick={() => startEdit(item.id, field, value)}
        title="Clique para editar"
      >
        {formatBRL(value)}
      </span>
    );
  };

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Nenhum bem cadastrado para este período
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table className="table-fixed w-full">
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-[7%]">Código</TableHead>
            <TableHead className="text-xs w-[18%]">Descrição</TableHead>
            <TableHead className="text-xs w-[10%]">Categoria</TableHead>
            <TableHead className="text-xs w-[8%]">Patrimônio</TableHead>
            <TableHead className="text-xs w-[9%]">Localização</TableHead>
            <TableHead className="text-xs w-[7%]">Aquisição</TableHead>
            <TableHead className="text-xs text-right w-[10%]">Valor Bruto</TableHead>
            <TableHead className="text-xs text-right w-[10%]">Depr. Acum.</TableHead>
            <TableHead className="text-xs text-right w-[10%]">Valor Líquido</TableHead>
            <TableHead className="text-xs text-center w-[7%]">Status</TableHead>
            <TableHead className="text-xs w-[4%]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const src = SOURCE_LABELS[item.source] ?? SOURCE_LABELS.manual;
            return (
              <TableRow key={item.id} title={item.responsible_name ? `Responsável: ${item.responsible_name}` : undefined}>
                <TableCell className="text-xs font-mono truncate">{item.asset_code}</TableCell>
                <TableCell className="text-xs truncate" title={item.asset_description}>{item.asset_description}</TableCell>
                <TableCell className="text-xs truncate">
                  <Badge variant="outline" className="text-[10px] truncate max-w-full">
                    {getCategoryLabel(item.category)}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs truncate">{item.asset_tag || "—"}</TableCell>
                <TableCell className="text-xs truncate">{item.location || "—"}</TableCell>
                <TableCell className="text-xs">
                  {item.acquisition_date ? new Date(item.acquisition_date).toLocaleDateString("pt-BR") : "—"}
                </TableCell>
                <TableCell className="text-xs text-right">
                  {renderEditableCell(item, "gross_value", item.gross_value)}
                </TableCell>
                <TableCell className="text-xs text-right text-destructive">
                  {renderEditableCell(item, "accumulated_depreciation", item.accumulated_depreciation)}
                </TableCell>
                <TableCell className="text-xs text-right font-semibold">
                  {formatBRL(item.net_value)}
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-1 flex-wrap">
                    <Badge
                      variant={item.status === "ativo" ? "default" : "secondary"}
                      className={`text-[10px] ${item.status === "ativo" ? "bg-success/20 text-success" : ""}`}
                    >
                      {item.status === "ativo" ? "Ativo" : item.status === "baixado" ? "Baixado" : item.status}
                    </Badge>
                    {item.status === "ativo" && Number(item.accumulated_depreciation) >= Number(item.gross_value) && Number(item.gross_value) > 0 && (
                      <Badge variant="outline" className="text-[9px] border-warning text-warning">
                        100%
                      </Badge>
                    )}
                    <Badge variant={src.variant} className="text-[9px]">
                      {src.label}
                    </Badge>
                  </div>
                </TableCell>
                <TableCell className="px-1">
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => onDelete(item.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
