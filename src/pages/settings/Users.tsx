import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";
import { UserPlus, Shield, ShieldOff, Loader2, Pencil, KeyRound, Check, ChevronsUpDown } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface ProfileRow {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  is_admin: boolean | null;
  is_active: boolean | null;
  created_at: string;
  funcionario_alvo_codigo: string | null;
}

interface FuncionarioAlvo {
  codigo: string;
  nome: string;
  status: string;
  codigo_centro_ctrl: string | null;
}

const MENU_MODULES = [
  { key: "dashboard", label: "Dashboard", group: "Principal" },
  { key: "cash", label: "Caixa e Bancos", group: "Principal" },
  { key: "receivables", label: "Contas a Receber", group: "Principal" },
  { key: "sales", label: "Receita de Vendas", group: "Principal" },
  { key: "inventory", label: "Estoques", group: "Principal" },
  { key: "fixed_assets", label: "Imobilizado", group: "Principal" },
  { key: "commodatum", label: "Bens em Comodato", group: "Principal" },
  { key: "nf_entrada", label: "NF Entrada", group: "Fiscal" },
  { key: "compras", label: "Compras (Pedidos, NF, NFS, Certificado)", group: "Fiscal" },
  { key: "loans", label: "Empréstimos", group: "Financeiro" },
  { key: "taxes", label: "Impostos Parcelados", group: "Fiscal" },
  { key: "intercompany", label: "Intercompany", group: "Financeiro" },
  { key: "credit_cards", label: "Cartões de Crédito", group: "Financeiro" },
  { key: "projetos", label: "Projetos", group: "Principal" },
  { key: "closing", label: "Fechamento", group: "Financeiro" },
  { key: "settings", label: "Configurações (API, CC, Classes)", group: "Sistema" },
  { key: "suprimentos_requisicoes", label: "Requisições de Compra", group: "Suprimentos" },
];

const GROUPS = [...new Set(MENU_MODULES.map(m => m.group))];

export default function Users() {
  const { profile } = useAuth();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<ProfileRow | null>(null);
  const [creating, setCreating] = useState(false);

  // Create form
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  // Edit form
  const [editName, setEditName] = useState("");
  const [editAdmin, setEditAdmin] = useState(false);
  const [editFuncionarioCodigo, setEditFuncionarioCodigo] = useState<string | null>(null);
  const [funcionarios, setFuncionarios] = useState<FuncionarioAlvo[]>([]);
  const [funcSearch, setFuncSearch] = useState("");
  const [showDemitidos, setShowDemitidos] = useState(false);
  const [funcPopoverOpen, setFuncPopoverOpen] = useState(false);

  // Permissions dialog
  const [permOpen, setPermOpen] = useState(false);
  const [permProfile, setPermProfile] = useState<ProfileRow | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [permLoading, setPermLoading] = useState(false);
  const [permSaving, setPermSaving] = useState(false);

  const isCurrentUserAdmin = profile?.is_admin === true;

  const fetchProfiles = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at");
    if (data) setProfiles(data as unknown as ProfileRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (isCurrentUserAdmin) fetchProfiles();
    else setLoading(false);
  }, [isCurrentUserAdmin]);

  if (!isCurrentUserAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Acesso restrito a administradores.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!email || !fullName || !password) {
      toast({ title: "Preencha todos os campos obrigatórios", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "A senha deve ter no mínimo 6 caracteres", variant: "destructive" });
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });

      if (error) throw error;

      if (data.user) {
        await supabase.from("profiles").upsert(
          {
            user_id: data.user.id,
            full_name: fullName,
            email,
            is_admin: isAdmin,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );
      }

      toast({ title: "Usuário criado com sucesso!" });
      setCreateOpen(false);
      setEmail("");
      setFullName("");
      setPassword("");
      setIsAdmin(false);
      fetchProfiles();
    } catch (err: any) {
      toast({ title: "Erro ao criar usuário", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (p: ProfileRow) => {
    if (p.user_id === profile?.user_id) return;
    const newActive = !p.is_active;
    const { error } = await supabase
      .from("profiles")
      .update({ is_active: newActive, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: newActive ? "Usuário ativado" : "Usuário desativado" });
      fetchProfiles();
    }
  };

  const openEdit = async (p: ProfileRow) => {
    setEditProfile(p);
    setEditName(p.full_name || "");
    setEditAdmin(p.is_admin === true);
    setEditFuncionarioCodigo(p.funcionario_alvo_codigo || null);
    setFuncSearch("");
    setShowDemitidos(false);
    setEditOpen(true);

    const { data } = await (supabase as any)
      .from("funcionarios_alvo_cache")
      .select("codigo, nome, status, codigo_centro_ctrl")
      .order("nome", { ascending: true });
    if (data) setFuncionarios(data as FuncionarioAlvo[]);
  };

  const handleEdit = async () => {
    if (!editProfile) return;
    const { error } = await (supabase as any)
      .from("profiles")
      .update({
        full_name: editName,
        is_admin: editAdmin,
        funcionario_alvo_codigo: editFuncionarioCodigo,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editProfile.id);
    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Usuário atualizado com sucesso!" });
      setEditOpen(false);
      fetchProfiles();
    }
  };

  // Permissions
  const openPermissions = async (p: ProfileRow) => {
    setPermProfile(p);
    setPermOpen(true);
    setPermLoading(true);
    setCheckedKeys([]);

    const { data } = await supabase
      .from("user_permissions")
      .select("menu_key, allowed")
      .eq("user_id", p.user_id);

    if (data) {
      setCheckedKeys(data.filter(d => d.allowed).map(d => d.menu_key));
    }
    setPermLoading(false);
  };

  const toggleKey = (key: string) => {
    setCheckedKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSavePermissions = async () => {
    if (!permProfile) return;
    setPermSaving(true);

    const permissions = MENU_MODULES.map(m => ({
      user_id: permProfile.user_id,
      menu_key: m.key,
      allowed: checkedKeys.includes(m.key),
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("user_permissions")
      .upsert(permissions, { onConflict: "user_id,menu_key" });

    if (error) {
      toast({ title: "Erro ao salvar permissões", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Permissões salvas com sucesso!" });
      setPermOpen(false);
    }
    setPermSaving(false);
  };

  const filteredFuncionarios = funcionarios
    .filter(f => showDemitidos || f.status === "Trabalhando")
    .filter(f => {
      const q = funcSearch.trim().toLowerCase();
      if (!q) return true;
      return f.nome.toLowerCase().includes(q) || f.codigo.includes(q);
    });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Gerenciamento de Usuários</h1>
        <p className="text-sm text-muted-foreground">Crie, edite e gerencie permissões de acesso dos usuários.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-base">Usuários</CardTitle>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <UserPlus className="h-4 w-4" /> Novo Usuário
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Criar Usuário</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label>Email *</Label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="usuario@empresa.com" />
                </div>
                <div className="space-y-1.5">
                  <Label>Nome Completo *</Label>
                  <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Nome do usuário" />
                </div>
                <div className="space-y-1.5">
                  <Label>Senha *</Label>
                  <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={isAdmin} onCheckedChange={setIsAdmin} />
                  <Label>Administrador</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Criar Usuário
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map(p => {
                  const isSelf = p.user_id === profile?.user_id;
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.full_name || "—"}</TableCell>
                      <TableCell className="text-sm">{p.email || "—"}</TableCell>
                      <TableCell>
                        {p.is_admin ? (
                          <Badge variant="default" className="gap-1">
                            <Shield className="h-3 w-3" /> Admin
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <ShieldOff className="h-3 w-3" /> Usuário
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={p.is_active !== false}
                          onCheckedChange={() => handleToggleActive(p)}
                          disabled={isSelf}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(p.created_at), "dd/MM/yyyy")}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {!isSelf && (
                          <>
                            <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => openPermissions(p)}>
                              <KeyRound className="h-3 w-3" /> Permissões
                            </Button>
                            <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => openEdit(p)}>
                              <Pencil className="h-3 w-3" /> Editar
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome Completo</Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Funcionário no ERP Alvo</Label>
              <Popover open={funcPopoverOpen} onOpenChange={setFuncPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {editFuncionarioCodigo
                      ? (() => {
                          const f = funcionarios.find(x => x.codigo === editFuncionarioCodigo);
                          return f ? `${f.nome} (${f.codigo})` : editFuncionarioCodigo;
                        })()
                      : "Nenhum funcionário vinculado"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput placeholder="Buscar por nome ou código..." value={funcSearch} onValueChange={setFuncSearch} />

                    <div className="flex items-center gap-2 px-3 py-2 border-b">
                      <Checkbox
                        id="show-demitidos"
                        checked={showDemitidos}
                        onCheckedChange={(v) => setShowDemitidos(v === true)}
                      />
                      <Label htmlFor="show-demitidos" className="text-xs font-normal cursor-pointer">
                        Mostrar demitidos
                      </Label>
                    </div>

                    <CommandList>
                      <CommandEmpty>Nenhum funcionário encontrado.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          onSelect={() => {
                            setEditFuncionarioCodigo(null);
                            setFuncPopoverOpen(false);
                          }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", editFuncionarioCodigo === null ? "opacity-100" : "opacity-0")} />
                          Nenhum (desvincular)
                        </CommandItem>
                        {filteredFuncionarios.map(f => (
                          <CommandItem
                            key={f.codigo}
                            onSelect={() => {
                              setEditFuncionarioCodigo(f.codigo);
                              setFuncPopoverOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", editFuncionarioCodigo === f.codigo ? "opacity-100" : "opacity-0")} />
                            <div className="flex flex-col">
                              <span className="text-sm">{f.nome}</span>
                              <span className="text-xs text-muted-foreground">
                                {f.codigo} {f.status === "Demitido" && "· Demitido"}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                Vincular a um funcionário do Alvo é necessário para criar Requisições de Compra.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Switch checked={editAdmin} onCheckedChange={setEditAdmin} />
              <Label>Administrador</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={handleEdit}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permissions Dialog */}
      <Dialog open={permOpen} onOpenChange={setPermOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Permissões de {permProfile?.full_name || "Usuário"}</DialogTitle>
            <p className="text-sm text-muted-foreground">{permProfile?.email}</p>
          </DialogHeader>

          {permProfile?.is_admin ? (
            <div className="flex-1 flex items-center justify-center py-8">
              <Badge variant="default" className="gap-1.5 text-sm px-4 py-2">
                <Shield className="h-4 w-4" /> Administrador — acesso total a todos os módulos
              </Badge>
            </div>
          ) : permLoading ? (
            <div className="flex-1 flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-4 py-2">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setCheckedKeys(MENU_MODULES.map(m => m.key))}
                >
                  Marcar Todos
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setCheckedKeys([])}
                >
                  Desmarcar Todos
                </Button>
              </div>

              {GROUPS.map(group => (
                <div key={group}>
                  <h4 className="text-sm font-semibold mb-2">{group}</h4>
                  <div className="space-y-2 pl-1">
                    {MENU_MODULES.filter(m => m.group === group).map(m => (
                      <div key={m.key} className="flex items-center gap-2.5">
                        <Checkbox
                          id={`perm-${m.key}`}
                          checked={checkedKeys.includes(m.key)}
                          onCheckedChange={() => toggleKey(m.key)}
                        />
                        <Label htmlFor={`perm-${m.key}`} className="text-sm font-normal cursor-pointer">
                          {m.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                  <Separator className="mt-3" />
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPermOpen(false)}>Cancelar</Button>
            {!permProfile?.is_admin && (
              <Button onClick={handleSavePermissions} disabled={permSaving}>
                {permSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar Permissões
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
