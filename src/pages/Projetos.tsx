import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  Plus, Pencil, ClipboardList, User, Calendar, Wallet, Search,
  FolderKanban, Loader2, Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

interface Projeto {
  id: string;
  nome: string;
  descricao: string | null;
  orcamento: number;
  responsavel: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  status: string;
  fase_atual?: string;
  budget_aprovado_por?: string | null;
  criado_por: string | null;
  created_at: string;
}

const fmtCurrency = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

export default function Projetos() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isAdmin = profile?.is_admin === true;

  const [search, setSearch] = useState("");
  const [filterFase, setFilterFase] = useState("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Projeto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Projeto | null>(null);

  // Form state
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [orcamento, setOrcamento] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [saving, setSaving] = useState(false);

  // Fetch projects
  const { data: projetos = [], isLoading } = useQuery({
    queryKey: ["projetos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projetos")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Projeto[];
    },
  });

  // Fetch budget usage for all projects
  const { data: usageMap = {} } = useQuery({
    queryKey: ["projetos-usage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projeto_requisicoes")
        .select("projeto_id, valor_total");
      if (error) throw error;
      const map: Record<string, number> = {};
      (data || []).forEach((r: any) => {
        map[r.projeto_id] = (map[r.projeto_id] || 0) + (r.valor_total || 0);
      });
      return map;
    },
  });

  const openCreate = () => {
    setEditingProject(null);
    setNome("");
    setDescricao("");
    setOrcamento("");
    setResponsavel("");
    setDataInicio("");
    setDataFim("");
    setDialogOpen(true);
  };

  const openEdit = (p: Projeto) => {
    setEditingProject(p);
    setNome(p.nome);
    setDescricao(p.descricao || "");
    setOrcamento(String(p.orcamento || ""));
    setResponsavel(p.responsavel || "");
    setDataInicio(p.data_inicio || "");
    setDataFim(p.data_fim || "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!nome.trim() || !responsavel.trim()) {
      toast({ title: "Preencha nome e responsável", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        responsavel: responsavel.trim(),
        data_inicio: dataInicio || null,
        data_fim: dataFim || null,
        updated_at: new Date().toISOString(),
      };
      if (isAdmin) {
        payload.orcamento = parseFloat(orcamento) || 0;
      }

      if (editingProject) {
        const { error } = await supabase.from("projetos").update(payload).eq("id", editingProject.id);
        if (error) throw error;
        toast({ title: "Projeto atualizado!" });
      } else {
        payload.criado_por = user?.id || null;
        if (!isAdmin) payload.orcamento = parseFloat(orcamento) || 0;
        const { error } = await supabase.from("projetos").insert(payload);
        if (error) throw error;
        toast({ title: "Projeto criado!" });
      }
      queryClient.invalidateQueries({ queryKey: ["projetos"] });
      setDialogOpen(false);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from("projetos").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      toast({ title: "Projeto excluído!" });
      queryClient.invalidateQueries({ queryKey: ["projetos"] });
      queryClient.invalidateQueries({ queryKey: ["projetos-usage"] });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  };

  // Filtered list by fase_atual
  const filtered = projetos.filter((p) => {
    const fase = (p as any).fase_atual || "budget";
    if (filterFase !== "todos" && fase !== filterFase) return false;
    if (search && !p.nome.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Projetos</h1>
          <p className="text-sm text-muted-foreground">Gerencie projetos e pedidos de compra</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Novo Projeto
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterFase} onValueChange={setFilterFase}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="budget">Budget</SelectItem>
            <SelectItem value="actual">Actual</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Cards Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <FolderKanban className="h-12 w-12 mb-3" />
          <p>Nenhum projeto encontrado</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const utilizado = usageMap[p.id] || 0;
            const pct = p.orcamento > 0 ? Math.round((utilizado / p.orcamento) * 100) : 0;
            const progressColor = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-green-500";
            const fase = (p as any).fase_atual || "budget";

            return (
              <Card key={p.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base font-semibold truncate">{p.nome}</CardTitle>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {fase === 'budget' && <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400">Budget</Badge>}
                      {fase === 'actual' && <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400">Actual</Badge>}
                      {(p as any).budget_aprovado_por && (
                        <span className="text-[10px] text-muted-foreground">Aprovado por {(p as any).budget_aprovado_por}</span>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{p.responsavel || "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    <span>{fmtDate(p.data_inicio)} → {fmtDate(p.data_fim)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-semibold">{fmtCurrency(p.orcamento)}</span>
                  </div>
                  {/* Budget usage */}
                  <div className="space-y-1">
                    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className={`absolute left-0 top-0 h-full rounded-full transition-all ${progressColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {fmtCurrency(utilizado)} / {fmtCurrency(p.orcamento)} ({pct}%)
                    </p>
                  </div>
                </CardContent>
                <CardFooter className="border-t pt-3 gap-2">
                  <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => openEdit(p)}>
                    <Pencil className="h-3 w-3" /> Editar
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => navigate(`/projetos/${p.id}`)}>
                    <ClipboardList className="h-3 w-3" /> Pedidos de Compra
                  </Button>
                  <Button variant="ghost" size="sm" className="ml-auto h-7 w-7 p-0 text-destructive" onClick={() => setDeleteTarget(p)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProject ? "Editar Projeto" : "Novo Projeto"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome do Projeto *</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label>Orçamento (R$) *{!isAdmin && editingProject ? " — somente admin" : ""}</Label>
              <Input
                type="number"
                step="0.01"
                value={orcamento}
                onChange={(e) => setOrcamento(e.target.value)}
                disabled={!isAdmin && !!editingProject}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Responsável *</Label>
              <Input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data Início</Label>
                <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Data Fim</Label>
                <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingProject ? "Salvar" : "Criar Projeto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza? Todos os pedidos de compra deste projeto serão excluídos. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
