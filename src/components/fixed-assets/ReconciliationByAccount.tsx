import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, XCircle, Save } from "lucide-react";
import { toast } from "sonner";

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface ReconciliationRow {
  id: string;
  period_id: string;
  category_id: string;
  account_asset: string;
  account_depreciation: string | null;
  gross_value: number;
  accumulated_depreciation: number;
  net_value: number | null;
  accounting_balance_asset: number | null;
  accounting_balance_depreciation: number | null;
  accounting_net: number | null;
  difference: number | null;
  status: string;
  justification: string | null;
}

interface Props {
  rows: ReconciliationRow[];
  categoryLabels: Map<string, string>;
  onRefresh: () => void;
  hasBalancete?: boolean;
}

export default function ReconciliationByAccount({ rows, categoryLabels, onRefresh, hasBalancete = false }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBalAsset, setEditBalAsset] = useState("");
  const [editBalDep, setEditBalDep] = useState("");
  const [editJust, setEditJust] = useState("");

  const startEdit = (row: ReconciliationRow) => {
    setEditingId(row.id);
    setEditBalAsset(String(row.accounting_balance_asset ?? 0));
    setEditBalDep(String(row.accounting_balance_depreciation ?? 0));
    setEditJust(row.justification ?? "");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (row: ReconciliationRow) => {
    const balAsset = parseFloat(editBalAsset) || 0;
    const balDep = parseFloat(editBalDep) || 0;
    const accNet = balAsset - balDep;
    const netVal = Number(row.net_value ?? 0);
    const diff = netVal - accNet;
    const hasJust = editJust.trim().length > 0;
    const newStatus = diff === 0 ? "reconciled" : hasJust ? "justified" : "divergent";

    const { error } = await supabase
      .from("fixed_assets_reconciliation")
      .update({
        accounting_balance_asset: balAsset,
        accounting_balance_depreciation: balDep,
        accounting_net: accNet,
        difference: diff,
        justification: diff !== 0 ? editJust.trim() || null : null,
        status: newStatus,
      })
      .eq("id", row.id);

    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saldo contábil atualizado!");
    setEditingId(null);
    onRefresh();
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === "reconciled") return <CheckCircle2 className="h-4 w-4 text-success" />;
    if (status === "justified") return <AlertTriangle className="h-4 w-4 text-warning" />;
    return <XCircle className="h-4 w-4 text-destructive" />;
  };

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        Nenhuma conciliação por conta disponível. Calcule a depreciação primeiro.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">Conciliação por Conta Contábil</h2>
      <div className="rounded-md border bg-muted/30 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Categoria</TableHead>
              <TableHead className="text-xs">Conta Ativo</TableHead>
              <TableHead className="text-xs text-right">Valor Bruto</TableHead>
              <TableHead className="text-xs text-right">Depr. Acum.</TableHead>
              <TableHead className="text-xs text-right">Valor Líquido</TableHead>
              <TableHead className="text-xs text-right">Saldo Contábil</TableHead>
              <TableHead className="text-xs text-center">Origem</TableHead>
              <TableHead className="text-xs text-right">Diferença</TableHead>
              <TableHead className="text-xs text-center">Status</TableHead>
              <TableHead className="text-xs w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isEditing = editingId === row.id;
              const netVal = Number(row.net_value ?? 0);
              const accNet = Number(row.accounting_net ?? 0);
              const diff = Number(row.difference ?? netVal - accNet);
              const catLabel = categoryLabels.get(row.category_id) ?? "—";

              return (
                <TableRow key={row.id} className={isEditing ? "bg-accent/20" : ""}>
                  <TableCell className="text-xs font-medium">{catLabel}</TableCell>
                  <TableCell className="text-xs font-mono">{row.account_asset}</TableCell>
                  <TableCell className="text-xs text-right">{formatBRL(row.gross_value)}</TableCell>
                  <TableCell className="text-xs text-right text-destructive">
                    {formatBRL(row.accumulated_depreciation)}
                  </TableCell>
                  <TableCell className="text-xs text-right font-semibold">{formatBRL(netVal)}</TableCell>
                  <TableCell className="text-xs text-right">
                    {isEditing ? (
                      <div className="space-y-1">
                        <Input
                          autoFocus
                          type="number"
                          step="0.01"
                          value={editBalAsset}
                          onChange={(e) => setEditBalAsset(e.target.value)}
                          className="h-7 w-28 text-xs ml-auto"
                          placeholder="Conta ativo"
                        />
                        {row.account_depreciation && (
                          <Input
                            type="number"
                            step="0.01"
                            value={editBalDep}
                            onChange={(e) => setEditBalDep(e.target.value)}
                            className="h-7 w-28 text-xs ml-auto"
                            placeholder="Conta depr."
                          />
                        )}
                      </div>
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-accent/50 rounded px-1.5 py-0.5 transition-colors"
                        onClick={() => startEdit(row)}
                        title="Clique para editar saldo contábil"
                      >
                        {formatBRL(accNet)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {(() => {
                      const hasAccData = accNet !== 0;
                      if (!hasAccData) return <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-muted/50 text-muted-foreground">—</Badge>;
                      if (hasBalancete) return <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20">Balancete</Badge>;
                      return <Badge variant="outline" className="text-[9px] px-1.5 py-0 bg-muted/50 text-muted-foreground">Manual</Badge>;
                    })()}
                  </TableCell>
                  <TableCell className={`text-xs text-right font-semibold ${diff === 0 ? "text-success" : "text-destructive"}`}>
                    {formatBRL(diff)}
                  </TableCell>
                  <TableCell className="text-center">
                    <StatusIcon status={isEditing ? "pending" : row.status} />
                  </TableCell>
                  <TableCell>
                    {isEditing ? (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => saveEdit(row)}>
                          <Save className="h-3.5 w-3.5 text-primary" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={cancelEdit}>
                          <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => startEdit(row)}>
                        Editar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {/* Totals row */}
            {rows.length > 0 && (() => {
              const totGross = rows.reduce((s, r) => s + r.gross_value, 0);
              const totDep = rows.reduce((s, r) => s + r.accumulated_depreciation, 0);
              const totNet = rows.reduce((s, r) => s + Number(r.net_value ?? 0), 0);
              const totAccNet = rows.reduce((s, r) => s + Number(r.accounting_net ?? 0), 0);
              const totDiff = rows.reduce((s, r) => s + Number(r.difference ?? 0), 0);
              return (
                <TableRow className="bg-muted/50 font-semibold">
                  <TableCell className="text-xs" colSpan={2}>TOTAL</TableCell>
                  <TableCell className="text-xs text-right">{formatBRL(totGross)}</TableCell>
                  <TableCell className="text-xs text-right text-destructive">{formatBRL(totDep)}</TableCell>
                  <TableCell className="text-xs text-right">{formatBRL(totNet)}</TableCell>
                  <TableCell className="text-xs text-right">{formatBRL(totAccNet)}</TableCell>
                  <TableCell />
                  <TableCell className={`text-xs text-right ${totDiff === 0 ? "text-success" : "text-destructive"}`}>{formatBRL(totDiff)}</TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              );
            })()}
          </TableBody>
        </Table>
      </div>
      {/* Show justification input for the currently editing row */}
      {editingId && (() => {
        const row = rows.find(r => r.id === editingId);
        if (!row) return null;
        const balAsset = parseFloat(editBalAsset) || 0;
        const balDep = parseFloat(editBalDep) || 0;
        const netVal = Number(row.net_value ?? 0);
        const previewDiff = netVal - (balAsset - balDep);
        if (previewDiff === 0) return null;
        return (
          <div className="rounded-md border bg-accent/10 p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Diferença de <span className="font-semibold text-destructive">{formatBRL(previewDiff)}</span> — adicione uma justificativa:
            </p>
            <Textarea
              value={editJust}
              onChange={(e) => setEditJust(e.target.value)}
              rows={2}
              placeholder="Justifique a diferença..."
              className="text-xs"
            />
          </div>
        );
      })()}
    </div>
  );
}
