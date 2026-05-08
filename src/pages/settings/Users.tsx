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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { UserPlus, Shield, ShieldOff, Loader2, Pencil, UserCog, Check, ChevronsUpDown, X, Plus } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface UserRoleInfo {
  codigo: string;
  nome: string;
  modulo: string;
  atribuido_em: string;
}

interface UserWithRoles {
  user_id: string;
  full_name: string | null;
  email: string | null;
  is_admin: boolean;
  is_active: boolean;
  funcionario_alvo_codigo: string | null;
  roles: UserRoleInfo[];
  created_at: string;
}

interface AvailableRole {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  modulo: string;
  is_system: boolean;
}

interface FuncionarioAlvo {
  codigo: string;
  nome: string;
  status: string;
  codigo_centro_ctrl: string | null;
}

export default function Users() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<UserWithRoles[]>([]);
  const [availableRoles, setAvailableRoles] = useState<AvailableRole[]>([]);
  const [loading, setLoading] = useState(true);

  // Create user dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [selectedRoleCode, setSelectedRoleCode] = useState<string>("requisitante");

  // Edit user dialog (nome + funcionário alvo)
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserWithRoles | null>(null);
  const [editName, setEditName] = useState("");
  const [editFuncionarioCodigo, setEditFuncionarioCodigo] = useState<string | null>(null);
  const [funcionarios, setFuncionarios] = useState<FuncionarioAlvo[]>([]);
  const [funcSearch, setFuncSearch] = useState("");
  const [showDemitidos, setShowDemitidos] = useState(false);
  const [funcPopoverOpen, setFuncPopoverOpen] = useState(false);

  // Manage roles dialog
  const [rolesOpen, setRolesOpen] = useState(false);
  const [rolesUser, setRolesUser] = useState<UserWithRoles | null>(null);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [addRoleCode, setAddRoleCode] = useState<string>("");
  const [addMotivo, setAddMotivo] = useState("");

  const isCurrentUserAdmin = profile?.is_admin === true;

  const fetchData = async () => {
    setLoading(true);
    try {
      // Lista usuários com papéis via RPC
      const { data: usersData, error: usersError } = await (supabase as any).rpc("hub_list_users_with_roles");
      if (usersError) throw usersError;
      setUsers((usersData || []) as UserWithRoles[]);

      // Lista papéis disponíveis (catálogo)
      const { data: rolesData, error: rolesError } = await (supabase as any)
        .from("hub_roles")
        .select("id, codigo, nome, descricao, modulo, is_system")
        .order("nome");
      if (rolesError) throw rolesError;
      setAvailableRoles((rolesData || []) as AvailableRole[]);
    } catch (err: any) {
      toast({
        title: "Erro ao carregar usuários",
        description: err?.message || "Verifique suas permissões.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isCurrentUserAdmin) fetchData();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // --------------------------------------------------------------------------
  // Convidar usuário (chama Edge Function hub-invite-user)
  // --------------------------------------------------------------------------
  const handleCreate = async () => {
    if (!email) {
      toast({ title: "Email obrigatório", variant: "destructive" });
      return;
    }
    if (!selectedRoleCode) {
      toast({ title: "Selecione um papel inicial", variant: "destructive" });
      return;
    }

    setCreating(true);
    try {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();
      const accessToken = currentSession?.access_token;

      if (!accessToken) {
        throw new Error("Sessão expirada. Faça login novamente.");
      }

      const resp = await fetch("https://hbtggrbauguukewiknew.supabase.co/functions/v1/hub-invite-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          role_code: selectedRoleCode,
        }),
      });

      const result = await resp.json();

      if (!resp.ok || !result.success) {
        throw new Error(result.error || "Falha ao convidar usuário");
      }

      const msg = result.is_existing_user
        ? `Senha redefinida e enviada para ${result.email}`
        : `Convite enviado para ${result.email}`;

      toast({
        title: msg,
        description: result.email_sent
          ? "O usuário receberá um email com a senha temporária."
          : "⚠️ Email NÃO foi enviado. Verifique configuração do Resend.",
      });

      setCreateOpen(false);
      setEmail("");
      setSelectedRoleCode("requisitante");
      fetchData();
    } catch (err: any) {
      toast({
        title: "Erro ao convidar usuário",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  // --------------------------------------------------------------------------
  // Toggle ativo/inativo
  // --------------------------------------------------------------------------
  const handleToggleActive = async (u: UserWithRoles) => {
    if (u.user_id === profile?.user_id) return;
    const newActive = !u.is_active;

    // Usa upsert para evitar .update (CORS PATCH)
    const { error } = await (supabase as any).from("profiles").upsert(
      {
        user_id: u.user_id,
        full_name: u.full_name,
        email: u.email,
        is_admin: u.is_admin,
        is_active: newActive,
        funcionario_alvo_codigo: u.funcionario_alvo_codigo,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: newActive ? "Usuário ativado" : "Usuário desativado" });
      fetchData();
    }
  };

  // --------------------------------------------------------------------------
  // Editar usuário (nome + funcionário alvo)
  // --------------------------------------------------------------------------
  const openEdit = async (u: UserWithRoles) => {
    setEditUser(u);
    setEditName(u.full_name || "");
    setEditFuncionarioCodigo(u.funcionario_alvo_codigo || null);
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
    if (!editUser) return;

    const { error } = await (supabase as any).from("profiles").upsert(
      {
        user_id: editUser.user_id,
        full_name: editName,
        email: editUser.email,
        is_admin: editUser.is_admin,
        is_active: editUser.is_active,
        funcionario_alvo_codigo: editFuncionarioCodigo,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (error) {
      toast({ title: "Erro ao atualizar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Usuário atualizado com sucesso!" });
      setEditOpen(false);
      fetchData();
    }
  };

  // --------------------------------------------------------------------------
  // Gerenciar papéis
  // --------------------------------------------------------------------------
  const openRoles = (u: UserWithRoles) => {
    setRolesUser(u);
    setAddRoleCode("");
    setAddMotivo("");
    setRolesOpen(true);
  };

  const handleAddRole = async () => {
    if (!rolesUser || !addRoleCode) {
      toast({ title: "Selecione um papel para atribuir", variant: "destructive" });
      return;
    }
    setRolesLoading(true);
    try {
      const { error } = await (supabase as any).rpc("hub_assign_role", {
        p_target_user_id: rolesUser.user_id,
        p_role_code: addRoleCode,
        p_motivo: addMotivo || "Atribuído via UI de Gestão de Usuários",
      });
      if (error) throw error;
      toast({ title: "Papel atribuído com sucesso!" });
      setAddRoleCode("");
      setAddMotivo("");
      await fetchData();
      // Atualiza o rolesUser local pra refletir as novas roles
      const updated = users.find((u) => u.user_id === rolesUser.user_id);
      if (updated) setRolesUser(updated);
    } catch (err: any) {
      toast({
        title: "Erro ao atribuir papel",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setRolesLoading(false);
    }
  };

  const handleRevokeRole = async (roleCode: string) => {
    if (!rolesUser) return;
    setRolesLoading(true);
    try {
      const { error } = await (supabase as any).rpc("hub_revoke_role", {
        p_target_user_id: rolesUser.user_id,
        p_role_code: roleCode,
        p_motivo: "Revogado via UI de Gestão de Usuários",
      });
      if (error) throw error;
      toast({ title: "Papel revogado com sucesso!" });
      await fetchData();
    } catch (err: any) {
      toast({
        title: "Erro ao revogar papel",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setRolesLoading(false);
    }
  };

  // Filtra papéis disponíveis para adicionar (exclui os que o user já tem)
  const getRolesAvailableToAdd = (): AvailableRole[] => {
    if (!rolesUser) return availableRoles;
    const currentCodes = new Set(rolesUser.roles.map((r) => r.codigo));
    return availableRoles.filter((r) => !currentCodes.has(r.codigo));
  };

  const filteredFuncionarios = funcionarios
    .filter((f) => showDemitidos || f.status === "Trabalhando")
    .filter((f) => {
      const q = funcSearch.trim().toLowerCase();
      if (!q) return true;
      return f.nome.toLowerCase().includes(q) || f.codigo.includes(q);
    });

  // Cores dos badges por papel
  const getRoleBadgeClass = (codigo: string): string => {
    switch (codigo) {
      case "admin":
        return "bg-purple-500/15 text-purple-600 border-purple-500/30";
      case "analista_compras":
        return "bg-blue-500/15 text-blue-600 border-blue-500/30";
      case "requisitante":
        return "bg-slate-500/15 text-slate-600 border-slate-500/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  // Sempre que os users mudam, atualiza o rolesUser local (se o modal estiver aberto)
  useEffect(() => {
    if (rolesUser) {
      const updated = users.find((u) => u.user_id === rolesUser.user_id);
      if (updated) setRolesUser(updated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Gerenciamento de Usuários</h1>
        <p className="text-sm text-muted-foreground">Crie, edite e gerencie papéis de acesso dos usuários do Hub.</p>
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
                <DialogDescription>
                  O usuário será criado com o papel selecionado. Você pode atribuir papéis adicionais depois pelo botão
                  "Papéis".
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="usuario@empresa.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Nome Completo *</Label>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nome do usuário" />
                </div>
                <div className="space-y-1.5">
                  <Label>Senha *</Label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Papel inicial *</Label>
                  <Select value={selectedRoleCode} onValueChange={setSelectedRoleCode}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um papel" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRoles.map((r) => (
                        <SelectItem key={r.codigo} value={r.codigo}>
                          {r.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Analista de Compras recebe automaticamente também o papel Requisitante (para criar requisições
                    próprias).
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  Cancelar
                </Button>
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
                  <TableHead>Papéis</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isSelf = u.user_id === profile?.user_id;
                  return (
                    <TableRow key={u.user_id}>
                      <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                      <TableCell className="text-sm">{u.email || "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {u.roles.length === 0 ? (
                            <Badge variant="outline" className="text-muted-foreground">
                              Sem papéis
                            </Badge>
                          ) : (
                            u.roles.map((r) => (
                              <Badge key={r.codigo} variant="outline" className={getRoleBadgeClass(r.codigo)}>
                                {r.codigo === "admin" && <Shield className="mr-1 h-3 w-3" />}
                                {r.nome}
                              </Badge>
                            ))
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={u.is_active !== false}
                          onCheckedChange={() => handleToggleActive(u)}
                          disabled={isSelf}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(new Date(u.created_at), "dd/MM/yyyy")}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => openRoles(u)}>
                          <UserCog className="h-3 w-3" /> Papéis
                        </Button>
                        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => openEdit(u)}>
                          <Pencil className="h-3 w-3" /> Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialog: Editar nome + vinculação de funcionário */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
            <DialogDescription>
              Edite o nome e a vinculação ao funcionário do Alvo. Para alterar papéis, use o botão "Papéis" na listagem.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome Completo</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Funcionário no ERP Alvo</Label>
              <Popover open={funcPopoverOpen} onOpenChange={setFuncPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {editFuncionarioCodigo
                      ? (() => {
                          const f = funcionarios.find((x) => x.codigo === editFuncionarioCodigo);
                          return f ? `${f.nome} (${f.codigo})` : editFuncionarioCodigo;
                        })()
                      : "Nenhum funcionário vinculado"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Buscar por nome ou código..."
                      value={funcSearch}
                      onValueChange={setFuncSearch}
                    />

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
                          <Check
                            className={cn("mr-2 h-4 w-4", editFuncionarioCodigo === null ? "opacity-100" : "opacity-0")}
                          />
                          Nenhum (desvincular)
                        </CommandItem>
                        {filteredFuncionarios.map((f) => (
                          <CommandItem
                            key={f.codigo}
                            onSelect={() => {
                              setEditFuncionarioCodigo(f.codigo);
                              setFuncPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                editFuncionarioCodigo === f.codigo ? "opacity-100" : "opacity-0",
                              )}
                            />
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleEdit}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Gerenciar Papéis */}
      <Dialog open={rolesOpen} onOpenChange={setRolesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Papéis de {rolesUser?.full_name || "Usuário"}</DialogTitle>
            <DialogDescription>{rolesUser?.email}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Papéis atuais */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Papéis atuais</Label>
              <div className="space-y-1.5">
                {rolesUser && rolesUser.roles.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Nenhum papel atribuído.</p>
                ) : (
                  rolesUser?.roles.map((r) => (
                    <div key={r.codigo} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={getRoleBadgeClass(r.codigo)}>
                          {r.codigo === "admin" && <Shield className="mr-1 h-3 w-3" />}
                          {r.nome}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Atribuído em {format(new Date(r.atribuido_em), "dd/MM/yyyy")}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-destructive hover:text-destructive"
                        onClick={() => handleRevokeRole(r.codigo)}
                        disabled={rolesLoading}
                      >
                        <X className="h-3 w-3" /> Revogar
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Adicionar novo papel */}
            {getRolesAvailableToAdd().length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs text-muted-foreground">Adicionar papel</Label>
                <div className="flex gap-2">
                  <Select value={addRoleCode} onValueChange={setAddRoleCode}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Selecione um papel" />
                    </SelectTrigger>
                    <SelectContent>
                      {getRolesAvailableToAdd().map((r) => (
                        <SelectItem key={r.codigo} value={r.codigo}>
                          {r.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" onClick={handleAddRole} disabled={rolesLoading || !addRoleCode} className="gap-1">
                    {rolesLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Atribuir
                  </Button>
                </div>
                <Input
                  placeholder="Motivo (opcional)"
                  value={addMotivo}
                  onChange={(e) => setAddMotivo(e.target.value)}
                  className="text-xs"
                />
                {addRoleCode === "analista_compras" && (
                  <p className="text-xs text-muted-foreground italic">
                    Ao atribuir Analista de Compras, o papel Requisitante também será atribuído automaticamente.
                  </p>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRolesOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
