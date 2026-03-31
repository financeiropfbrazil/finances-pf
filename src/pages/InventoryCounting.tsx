import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Loader2, Trash2, Eye, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import {
  StockCount,
  fetchStockCounts,
  deleteStockCount,
} from "@/services/stockCountService";
import { NewCountDialog } from "@/components/counting/NewCountDialog";
import { CountDetail } from "@/components/counting/CountDetail";

export default function InventoryCounting() {
  const { toast } = useToast();
  const { user } = useAuth();
  const userEmail = user?.email ?? null;

  const [counts, setCounts] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [selectedCount, setSelectedCount] = useState<StockCount | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StockCount | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadCounts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchStockCounts();
      setCounts(data);
    } catch (err: any) {
      toast({ title: "Erro ao carregar contagens", description: err.message, variant: "destructive" });
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadCounts(); }, [loadCounts]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteStockCount(deleteTarget.id);
      toast({ title: "Contagem excluída" });
      setCounts((prev) => prev.filter((c) => c.id !== deleteTarget.id));
    } catch (err: any) {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    }
    setDeleting(false);
    setDeleteTarget(null);
  };

  const statusBadge = (status: string) => {
    if (status === "pendente") return <Badge variant="outline" className="text-yellow-600 border-yellow-300 text-xs">🟡 Pendente</Badge>;
    if (status === "parcial") return <Badge variant="outline" className="text-blue-600 border-blue-300 text-xs">🔵 Parcial</Badge>;
    return <Badge variant="outline" className="text-green-600 border-green-300 text-xs">✅ Concluída</Badge>;
  };

  // Detail view
  if (selectedCount) {
    return (
      <div className="p-6">
        <CountDetail
          count={selectedCount}
          onBack={() => {
            setSelectedCount(null);
            loadCounts();
          }}
          userEmail={userEmail}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Contagem de Estoque
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Compare contagens físicas com o saldo do sistema e aprove ajustes
          </p>
        </div>
        <Button onClick={() => setNewDialogOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Nova Contagem
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contagens Realizadas</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : counts.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              Nenhuma contagem registrada. Clique em "+ Nova Contagem" para começar.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data Ref.</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-[120px]">Tipo Chave</TableHead>
                    <TableHead className="text-right w-[70px]">Itens</TableHead>
                    <TableHead className="text-right w-[90px]">Divergentes</TableHead>
                    <TableHead className="text-right w-[80px]">Aprovados</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[120px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {counts.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">
                        {new Date(c.data_referencia + "T00:00:00").toLocaleDateString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-sm max-w-[250px] truncate">{c.descricao}</TableCell>
                      <TableCell className="text-xs">
                        {c.tipo_chave === "codigo_produto" ? "Cód. Completo"
                          : c.tipo_chave === "codigo_reduzido" ? "Cód. Reduzido"
                          : "Cód. Alternativo"}
                      </TableCell>
                      <TableCell className="text-right">{c.total_itens}</TableCell>
                      <TableCell className="text-right">{c.itens_divergentes}</TableCell>
                      <TableCell className="text-right">{c.itens_aprovados}</TableCell>
                      <TableCell>{statusBadge(c.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => setSelectedCount(c)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" /> Abrir
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-red-600 hover:text-red-700"
                            onClick={() => setDeleteTarget(c)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* New count dialog */}
      <NewCountDialog
        open={newDialogOpen}
        onClose={() => setNewDialogOpen(false)}
        onCreated={loadCounts}
        userEmail={userEmail}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir contagem</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir "{deleteTarget?.descricao}"? Todos os itens e ajustes vinculados serão removidos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
