/*
  Tabela necessária (criar manualmente no Supabase):

  cost_centers (
    id uuid primary key default gen_random_uuid(),
    erp_code text unique,
    erp_short_code text,
    name text not null,
    description text,
    parent_code text,
    group_type text,
    cost_type text,
    department_type text,
    is_active boolean default true,
    valid_from date,
    valid_until date,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  )
*/

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { authenticateAlvo, clearAlvoToken } from "@/services/alvoService";
import { Plus, Tag, MoreHorizontal, RefreshCw, Search } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

interface CostCenter {
  id: string;
  name: string;
  description: string | null;
  erp_code: string | null;
  erp_short_code: string | null;
  parent_code: string | null;
  group_type: string | null;
  cost_type: string | null;
  department_type: string | null;
  is_active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string | null;
}

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export default function CostCenters() {
  const [items, setItems] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CostCenter | null>(null);
  const [saving, setSaving] = useState(false);

  // form
  const [fName, setFName] = useState("");
  const [fErpCode, setFErpCode] = useState("");
  const [fShortCode, setFShortCode] = useState("");
  const [fParentCode, setFParentCode] = useState("");
  const [fGroupType, setFGroupType] = useState("");
  const [fDeptType, setFDeptType] = useState("");
  const [fCostType, setFCostType] = useState("");
  const [fValidFrom, setFValidFrom] = useState<Date | undefined>();
  const [fValidUntil, setFValidUntil] = useState<Date | undefined>();
  const [fIsActive, setFIsActive] = useState(true);

  // filters
  const [search, setSearch] = useState("");
  const [filterDept, setFilterDept] = useState("all");
  const [filterCost, setFilterCost] = useState("all");
  const [filterGroup, setFilterGroup] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const fetchData = async () => {
    const { data } = await supabase
      .from("cost_centers")
      .select("*")
      .order("name", { ascending: true });
    setItems((data as CostCenter[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterDept !== "all" && i.department_type !== filterDept) return false;
      if (filterCost !== "all" && i.cost_type !== filterCost) return false;
      if (filterGroup !== "all" && i.group_type !== filterGroup) return false;
      if (filterStatus === "active" && !i.is_active) return false;
      if (filterStatus === "inactive" && i.is_active) return false;
      return true;
    });
  }, [items, search, filterDept, filterCost, filterGroup, filterStatus]);

  const getLevel = (code: string | null) => {
    if (!code) return 0;
    return code.split(".").length - 1;
  };

  // ── Sync with Alvo ERP ──
  const handleSync = async () => {
    setSyncing(true);
    toast({ title: "Sincronizando centros de custo com o Alvo ERP..." });

    try {
      const auth = await authenticateAlvo();
      if (!auth.success || !auth.token) {
        throw new Error(auth.error || "Autenticação falhou");
      }
      let currentToken = auth.token;

      const MAX_RETRIES = 3;
      let resp: Response | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        resp = await fetch(
          `${ERP_BASE_URL}/CentroCtrl/RetornaListaCentroCtrl`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "riosoft-token": currentToken,
            },
            body: JSON.stringify({
              filtroListaCentroCtrl: { codigoEmpresaFilial: "1.01" },
            }),
          }
        );

        if (resp.status !== 409) break;

        console.warn(`[CostCenters] 409 session conflict (tentativa ${attempt}/${MAX_RETRIES})`);

        if (attempt === MAX_RETRIES) {
          throw new Error(
            "Conflito de sessão ERP persistente. Aguarde alguns minutos e tente novamente."
          );
        }

        clearAlvoToken();
        await delay(1000 * attempt);

        const reAuth = await authenticateAlvo();
        if (!reAuth.success || !reAuth.token) {
          throw new Error("Falha na re-autenticação após conflito de sessão");
        }
        currentToken = reAuth.token;
      }

      if (!resp || !resp.ok) {
        throw new Error(`HTTP ${resp?.status ?? "desconhecido"}`);
      }

      const data = await resp.json();

      if (!Array.isArray(data) || data.length === 0) {
        toast({
          title: "Nenhum centro de custo retornado pelo ERP.",
          variant: "destructive",
        });
        setSyncing(false);
        return;
      }

      const payload = data.map((item: any) => ({
        erp_code: item.Codigo,
        erp_short_code: item.Reduzido || null,
        name: item.Nome,
        parent_code: item.Nivel || null,
        group_type: item.Grupo || null,
        cost_type: item.Custo || null,
        department_type: item.Tipo || null,
        valid_from: item.DataValidadeInicial
          ? item.DataValidadeInicial.substring(0, 10)
          : null,
        valid_until: item.DataValidadeFinal
          ? item.DataValidadeFinal.substring(0, 10)
          : null,
        is_active:
          !item.DataValidadeFinal ||
          new Date(item.DataValidadeFinal) > new Date(),
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from("cost_centers")
        .upsert(payload, { onConflict: "erp_code" });

      if (error) {
        toast({
          title: "Erro ao salvar centros",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({ title: `${payload.length} centros sincronizados com sucesso.` });
        fetchData();
      }
    } catch (e: any) {
      toast({
        title: "Erro ao sincronizar",
        description: e.message,
        variant: "destructive",
      });
    }

    setSyncing(false);
  };

  // ── CRUD ──
  const openNew = () => {
    setEditing(null);
    setFName(""); setFErpCode(""); setFShortCode(""); setFParentCode("");
    setFGroupType(""); setFDeptType(""); setFCostType("");
    setFValidFrom(undefined); setFValidUntil(undefined); setFIsActive(true);
    setDialogOpen(true);
  };

  const openEdit = (item: CostCenter) => {
    setEditing(item);
    setFName(item.name);
    setFErpCode(item.erp_code || "");
    setFShortCode(item.erp_short_code || "");
    setFParentCode(item.parent_code || "");
    setFGroupType(item.group_type || "");
    setFDeptType(item.department_type || "");
    setFCostType(item.cost_type || "");
    setFValidFrom(item.valid_from ? new Date(item.valid_from + "T00:00:00") : undefined);
    setFValidUntil(item.valid_until ? new Date(item.valid_until + "T00:00:00") : undefined);
    setFIsActive(item.is_active);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!fName.trim()) {
      toast({ title: "Nome é obrigatório.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: any = {
      name: fName.trim(),
      erp_code: fErpCode.trim() || null,
      erp_short_code: fShortCode.trim() || null,
      parent_code: fParentCode.trim() || null,
      group_type: fGroupType || null,
      cost_type: fCostType || null,
      department_type: fDeptType || null,
      valid_from: fValidFrom ? format(fValidFrom, "yyyy-MM-dd") : null,
      valid_until: fValidUntil ? format(fValidUntil, "yyyy-MM-dd") : null,
      updated_at: new Date().toISOString(),
    };

    if (editing) {
      payload.is_active = fIsActive;
      const { error } = await supabase.from("cost_centers").update(payload).eq("id", editing.id);
      if (error) toast({ title: "Erro ao atualizar.", description: error.message, variant: "destructive" });
    } else {
      const { error } = await supabase.from("cost_centers").insert(payload);
      if (error) toast({ title: "Erro ao criar.", description: error.message, variant: "destructive" });
    }
    setSaving(false);
    setDialogOpen(false);
    fetchData();
  };

  const toggleActive = async (item: CostCenter) => {
    await supabase.from("cost_centers").update({ is_active: !item.is_active }).eq("id", item.id);
    fetchData();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await supabase.from("cost_centers").delete().eq("id", deleteId);
    setDeleteId(null);
    fetchData();
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Centros de Custo</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie os centros de custo utilizados nos módulos financeiros. Sincronize com o Alvo ERP para importar automaticamente.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sincronizar com Alvo"}
          </Button>
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" /> Novo Centro de Custo
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterDept} onValueChange={setFilterDept}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos tipos</SelectItem>
            <SelectItem value="Administrativo">Administrativo</SelectItem>
            <SelectItem value="Produtivo">Produtivo</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterCost} onValueChange={setFilterCost}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Custo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos custos</SelectItem>
            <SelectItem value="Fixo">Fixo</SelectItem>
            <SelectItem value="Variável">Variável</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterGroup} onValueChange={setFilterGroup}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Grupo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos grupos</SelectItem>
            <SelectItem value="F">Folha</SelectItem>
            <SelectItem value="T">Título</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Counter */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} centros encontrados (de {items.length} total)
      </p>

      {/* Content */}
      {!loading && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Tag className="mb-4 h-12 w-12" />
          <p className="text-center">
            Nenhum centro de custo cadastrado.
            <br />
            Clique em <strong>Sincronizar com Alvo</strong> para importar automaticamente,
            <br />
            ou em <strong>Novo Centro de Custo</strong> para cadastrar manualmente.
          </p>
        </div>
      ) : (
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Código ERP</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Custo</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => {
                const level = getLevel(item.erp_code);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {item.erp_code || "—"}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium" style={{ paddingLeft: `${Math.min(level, 2) * 16}px` }}>
                        {item.name}
                      </span>
                    </TableCell>
                    <TableCell>
                      {item.department_type ? (
                        <Badge variant="secondary">{item.department_type}</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {item.cost_type === "Fixo" ? (
                        <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Fixo</Badge>
                      ) : item.cost_type === "Variável" ? (
                        <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">Variável</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {item.group_type === "F" ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Folha</Badge>
                      ) : item.group_type === "T" ? (
                        <Badge variant="secondary">Título</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {item.is_active ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Ativo</Badge>
                      ) : (
                        <Badge variant="secondary">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(item)}>Editar</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleActive(item)}>
                            {item.is_active ? "Inativar" : "Reativar"}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(item.id)}>
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && items.length > 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nenhum centro de custo encontrado com os filtros aplicados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Centro de Custo" : "Novo Centro de Custo"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input placeholder="ex: Alimentação" value={fName} onChange={(e) => setFName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Código ERP</Label>
                <Input placeholder="ex: 00001.00001.00002" value={fErpCode} onChange={(e) => setFErpCode(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Código Reduzido</Label>
                <Input placeholder="ex: 271" value={fShortCode} onChange={(e) => setFShortCode(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Código Pai</Label>
              <Input placeholder="ex: 00001.00001" value={fParentCode} onChange={(e) => setFParentCode(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Grupo</Label>
                <Select value={fGroupType} onValueChange={setFGroupType}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="F">Folha</SelectItem>
                    <SelectItem value="T">Título</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={fDeptType} onValueChange={setFDeptType}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Administrativo">Administrativo</SelectItem>
                    <SelectItem value="Produtivo">Produtivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Custo</Label>
                <Select value={fCostType} onValueChange={setFCostType}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Fixo">Fixo</SelectItem>
                    <SelectItem value="Variável">Variável</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Válido a partir de</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      {fValidFrom ? format(fValidFrom, "dd/MM/yyyy") : "Selecionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={fValidFrom} onSelect={setFValidFrom} locale={ptBR} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>Válido até</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      {fValidUntil ? format(fValidUntil, "dd/MM/yyyy") : "Selecionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={fValidUntil} onSelect={setFValidUntil} locale={ptBR} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            {editing && (
              <div className="flex items-center gap-3">
                <Switch checked={fIsActive} onCheckedChange={setFIsActive} />
                <Label>Ativo</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir centro de custo?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
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
