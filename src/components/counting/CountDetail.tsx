import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Search, Loader2, CheckCircle2, XCircle, Download,
  AlertTriangle, Lock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  StockCount, StockCountItem,
  fetchCountItems, approveItems, rejectItems, revertToPending,
  exportCountToExcel, isMonthClosed,
} from "@/services/stockCountService";

interface Props {
  count: StockCount;
  onBack: () => void;
  userEmail: string | null;
}

export function CountDetail({ count, onBack, userEmail }: Props) {
  const { toast } = useToast();
  const [items, setItems] = useState<StockCountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    type: "approve" | "reject" | "approve_all";
    ids: string[];
  } | null>(null);
  const [monthClosed, setMonthClosed] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCountItems(count.id);
      setItems(data);
      const closed = await isMonthClosed(count.data_referencia);
      setMonthClosed(closed);
    } catch (err: any) {
      toast({ title: "Erro ao carregar itens", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }, [count.id, count.data_referencia]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const hasValueColumn = useMemo(() => items.some(i => i.valor_total_contagem != null), [items]);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (filter === "divergentes" && item.diferenca === 0) return false;
      if (filter === "pendentes" && item.status !== "pendente") return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !(item.codigo_enviado ?? "").toLowerCase().includes(q) &&
          !(item.codigo_produto ?? "").toLowerCase().includes(q) &&
          !(item.codigo_reduzido ?? "").toLowerCase().includes(q) &&
          !(item.nome_produto ?? "").toLowerCase().includes(q)
        ) return false;
      }
      return true;
    });
  }, [items, search, filter]);

  const stats = useMemo(() => {
    const total = items.length;
    const divergentes = items.filter((i) => i.diferenca !== 0).length;
    const aprovados = items.filter((i) => i.status === "aprovado").length;
    const rejeitados = items.filter((i) => i.status === "rejeitado").length;
    const pendentes = items.filter((i) => i.status === "pendente").length;
    return { total, divergentes, aprovados, rejeitados, pendentes };
  }, [items]);

  const handleApprove = async (ids: string[]) => {
    if (monthClosed) return;
    setProcessing(true);
    try {
      const count_approved = await approveItems({
        countId: count.id,
        itemIds: ids,
        dataReferencia: count.data_referencia,
        userEmail: userEmail ?? "unknown",
      });
      toast({ title: `✅ ${count_approved} item(ns) aprovado(s)` });
      setSelected(new Set());
      await loadItems();
    } catch (err: any) {
      toast({ title: "Erro ao aprovar", description: err.message, variant: "destructive" });
    }
    setProcessing(false);
    setConfirmDialog(null);
  };

  const handleReject = async (ids: string[]) => {
    setProcessing(true);
    try {
      await rejectItems(count.id, ids);
      toast({ title: `❌ ${ids.length} item(ns) rejeitado(s)` });
      setSelected(new Set());
      await loadItems();
    } catch (err: any) {
      toast({ title: "Erro ao rejeitar", description: err.message, variant: "destructive" });
    }
    setProcessing(false);
    setConfirmDialog(null);
  };

  const handleRevert = async (id: string) => {
    setProcessing(true);
    try {
      await revertToPending(count.id, [id]);
      toast({ title: "Item revertido para pendente" });
      await loadItems();
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
    setProcessing(false);
  };

  const pendingDivergentIds = items
    .filter((i) => i.status === "pendente" && i.diferenca !== 0)
    .map((i) => i.id);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const pendingIds = filtered.filter((i) => i.status === "pendente" && i.diferenca !== 0).map((i) => i.id);
    if (pendingIds.every((id) => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(pendingIds));
    }
  };

  const statusBadge = (status: string) => {
    if (status === "pendente") return <Badge variant="outline" className="text-warning border-warning/40 text-xs">🟡 Pendente</Badge>;
    if (status === "aprovado") return <Badge variant="outline" className="text-success border-success/40 text-xs">✅ Aprovado</Badge>;
    return <Badge variant="outline" className="text-destructive border-destructive/40 text-xs">❌ Rejeitado</Badge>;
  };

  const dataRef = new Date(count.data_referencia + "T00:00:00").toLocaleDateString("pt-BR");
  const monthLabel = (() => {
    const d = new Date(count.data_referencia + "T00:00:00");
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  })();

  const colSpan = 9 + (hasValueColumn ? 1 : 0) + 1; // +1 for Cód. Externo

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold truncate">{count.descricao}</h2>
          <span className="text-sm text-muted-foreground">Data ref.: {dataRef}</span>
        </div>
        {statusBadge(count.status)}
      </div>

      {monthClosed && (
        <Alert variant="destructive">
          <Lock className="h-4 w-4" />
          <AlertDescription>
            O mês {monthLabel} está fechado. Para aprovar ajustes, primeiro reabra o período em Fechamentos.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total", value: stats.total, color: "text-foreground" },
          { label: "Divergentes", value: stats.divergentes, color: "text-warning" },
          { label: "Aprovados", value: stats.aprovados, color: "text-success" },
          { label: "Rejeitados", value: stats.rejeitados, color: "text-destructive" },
          { label: "Pendentes", value: stats.pendentes, color: "text-warning" },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-3 text-center">
              <div className={`text-xl font-bold ${c.color}`}>{c.value}</div>
              <div className="text-xs text-muted-foreground">{c.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar código ou descrição..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="divergentes">Apenas divergentes</SelectItem>
            <SelectItem value="pendentes">Apenas pendentes</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex gap-2 ml-auto">
          {selected.size > 0 && !monthClosed && (
            <Button
              size="sm"
              onClick={() => setConfirmDialog({ type: "approve", ids: Array.from(selected) })}
              disabled={processing}
            >
              Aprovar {selected.size} selecionados
            </Button>
          )}
          {pendingDivergentIds.length > 0 && !monthClosed && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmDialog({ type: "approve_all", ids: pendingDivergentIds })}
              disabled={processing}
            >
              Aprovar Todos os Divergentes
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportCountToExcel(items, count.descricao, count.data_referencia)}
          >
            <Download className="h-4 w-4 mr-1" /> Exportar Excel
          </Button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      filtered.filter((i) => i.status === "pendente" && i.diferenca !== 0).length > 0 &&
                      filtered.filter((i) => i.status === "pendente" && i.diferenca !== 0).every((i) => selected.has(i.id))
                    }
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Cód. Externo</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-[80px]">Tipo</TableHead>
                <TableHead className="text-right w-[100px]">Qtde Sistema</TableHead>
                <TableHead className="text-right w-[100px]">Qtde Contagem</TableHead>
                <TableHead className="text-right w-[100px]">Diferença</TableHead>
                {hasValueColumn && <TableHead className="text-right w-[120px]">Valor Contagem</TableHead>}
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[140px]">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => {
                const isZero = item.diferenca === 0;
                const isPositive = item.diferenca > 0;
                const rowClass = isZero
                  ? "text-muted-foreground"
                  : isPositive
                  ? "bg-success/5"
                  : "bg-destructive/5";

                return (
                  <TableRow key={item.id} className={rowClass}>
                    <TableCell>
                      {item.status === "pendente" && item.diferenca !== 0 && (
                        <Checkbox
                          checked={selected.has(item.id)}
                          onCheckedChange={() => toggleSelect(item.id)}
                        />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.codigo_produto ?? item.codigo_enviado}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{item.codigo_alternativo ?? "—"}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{item.nome_produto}</TableCell>
                    <TableCell className="text-xs">{item.tipo_produto ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{item.quantidade_sistema}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{item.quantidade_contagem}</TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium">
                      {!isZero && (
                        <span className={isPositive ? "text-success" : "text-destructive"}>
                          {isPositive ? "▲" : "▼"} {Math.abs(item.diferenca)}
                        </span>
                      )}
                      {isZero && <span>0</span>}
                    </TableCell>
                    {hasValueColumn && (
                      <TableCell className="text-right font-mono text-xs">
                        {item.valor_total_contagem != null
                          ? item.valor_total_contagem.toLocaleString("pt-BR", { minimumFractionDigits: 2 })
                          : "—"}
                      </TableCell>
                    )}
                    <TableCell>{statusBadge(item.status)}</TableCell>
                    <TableCell>
                      {item.status === "pendente" && item.diferenca !== 0 && !monthClosed && (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-success hover:text-success/80"
                            disabled={processing}
                            onClick={() => setConfirmDialog({ type: "approve", ids: [item.id] })}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-destructive hover:text-destructive/80"
                            disabled={processing}
                            onClick={() => setConfirmDialog({ type: "reject", ids: [item.id] })}
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                      {item.status === "rejeitado" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          disabled={processing}
                          onClick={() => handleRevert(item.id)}
                        >
                          Reverter
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={colSpan} className="text-center py-8 text-muted-foreground">
                    Nenhum item encontrado
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Confirmation dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={(v) => !v && setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmDialog?.type === "reject" ? "Rejeitar itens" : "Confirmar ajuste"}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog?.type === "reject"
                ? `${confirmDialog.ids.length} item(ns) serão marcados como rejeitados. Nenhuma alteração no saldo.`
                : confirmDialog?.type === "approve_all"
                ? `${confirmDialog.ids.length} itens divergentes serão ajustados. O saldo do sistema será sobrescrito com os valores da contagem.`
                : confirmDialog?.ids.length === 1
                ? (() => {
                    const item = items.find((i) => i.id === confirmDialog.ids[0]);
                    return item
                      ? `Ajustar ${item.codigo_produto ?? item.codigo_enviado}: ${item.quantidade_sistema} → ${item.quantidade_contagem}?`
                      : "Confirmar ajuste?";
                  })()
                : `${confirmDialog?.ids.length} itens selecionados serão ajustados.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDialog(null)} disabled={processing}>
              Cancelar
            </Button>
            <Button
              variant={confirmDialog?.type === "reject" ? "destructive" : "default"}
              disabled={processing}
              onClick={() => {
                if (!confirmDialog) return;
                if (confirmDialog.type === "reject") {
                  handleReject(confirmDialog.ids);
                } else {
                  handleApprove(confirmDialog.ids);
                }
              }}
            >
              {processing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {confirmDialog?.type === "reject" ? "Rejeitar" : "Aprovar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
