import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, Pencil, Search, FolderKanban, Loader2, Trash2, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { BarraConsumo, FaseChip, Indicador } from "@/components/projetos/ProjetosUI";
import { fmtData, fmtMoeda, fmtPct, pct, tomConsumo } from "@/components/projetos/projetosFormat";

interface Projeto {
  id: string;
  nome: string;
  descricao: string | null;
  orcamento: number;
  responsavel_id: string | null;
  aprovador_id: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  status: string;
  fase_atual?: string;
  budget_aprovado_por?: string | null;
  criado_por: string | null;
  created_at: string;
  // joined (denormalized via separate query)
  responsavel_nome?: string | null;
  responsavel_email?: string | null;
  aprovador_nome?: string | null;
  aprovador_email?: string | null;
}

interface UserOption {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

/** Uso do orçamento por projeto, separado por fase. */
interface UsoProjeto {
  budget: number;
  actual: number;
  /** pedidos com número no Alvo — o projeto não pode ser excluído pelo Hub */
  enviadosErp: number;
}

const USO_VAZIO: UsoProjeto = { budget: 0, actual: 0, enviadosErp: 0 };

const userLabel = (u: UserOption) => u.full_name || u.email || "Sem nome";

/** Data de `<input type="date">` com ano de 4 dígitos (o campo aceita "82026"). */
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * O valor comprometido é o da FASE CORRENTE. Na aprovação o Budget é copiado
 * para o Actual, então somar as duas fases conta o mesmo pedido duas vezes —
 * era o que fazia todo projeto em Actual aparecer com ~200% na lista.
 */
const comprometido = (p: Projeto, uso: UsoProjeto) =>
  (p.fase_atual || "budget") === "actual" ? uso.actual : uso.budget;

export default function Projetos() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isAdmin = profile?.is_admin === true;

  // Permissions (admins têm bypass automático nos hooks)
  const canCreate = useHasPermission(PERMISSIONS.PROJETOS_CREATE);
  const canViewAll = useHasPermission(PERMISSIONS.PROJETOS_VIEW_ALL);
  const canEditOwn = useHasPermission(PERMISSIONS.PROJETOS_EDIT_OWN);
  const canDeleteOwn = useHasPermission(PERMISSIONS.PROJETOS_DELETE_OWN);

  const [search, setSearch] = useState("");
  const [filterFase, setFilterFase] = useState("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Projeto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Projeto | null>(null);

  // Form state
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [orcamento, setOrcamento] = useState("");
  const [responsavelId, setResponsavelId] = useState<string>("");
  const [aprovadorId, setAprovadorId] = useState<string>("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [saving, setSaving] = useState(false);

  // Fetch responsáveis disponíveis (users com role responsavel_projeto)
  const { data: responsaveis = [] } = useQuery({
    queryKey: ["projetos-responsaveis"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_responsaveis_disponiveis");
      if (error) throw error;
      return (data || []) as UserOption[];
    },
    enabled: dialogOpen, // só busca quando abrir o modal
  });

  // Fetch aprovadores disponíveis (users com role aprovador_projetos)
  const { data: aprovadores = [] } = useQuery({
    queryKey: ["projetos-aprovadores"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_aprovadores_disponiveis");
      if (error) throw error;
      return (data || []) as UserOption[];
    },
    enabled: dialogOpen,
  });

  // Fetch projects (RLS filtra automaticamente conforme escopo)
  const { data: projetos = [], isLoading } = useQuery({
    queryKey: ["projetos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projetos").select("*").order("created_at", { ascending: false });
      if (error) throw error;

      // Hidrata nomes do responsável e aprovador
      const userIds = new Set<string>();
      (data || []).forEach((p: any) => {
        if (p.responsavel_id) userIds.add(p.responsavel_id);
        if (p.aprovador_id) userIds.add(p.aprovador_id);
      });

      if (userIds.size === 0) return (data || []) as unknown as Projeto[];

      const { data: profilesData } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", Array.from(userIds));

      const profMap: Record<string, { nome: string | null; email: string | null }> = {};
      (profilesData || []).forEach((p: any) => {
        profMap[p.user_id] = { nome: p.full_name, email: p.email };
      });

      return (data || []).map((p: any) => ({
        ...p,
        responsavel_nome: p.responsavel_id ? profMap[p.responsavel_id]?.nome : null,
        responsavel_email: p.responsavel_id ? profMap[p.responsavel_id]?.email : null,
        aprovador_nome: p.aprovador_id ? profMap[p.aprovador_id]?.nome : null,
        aprovador_email: p.aprovador_id ? profMap[p.aprovador_id]?.email : null,
      })) as unknown as Projeto[];
    },
  });

  // Uso do orçamento por projeto e fase
  const { data: usageMap = {} } = useQuery({
    queryKey: ["projetos-usage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projeto_requisicoes")
        .select("projeto_id, valor_total, fase, numero_pedido_alvo");
      if (error) throw error;
      const map: Record<string, UsoProjeto> = {};
      (data || []).forEach((r: any) => {
        const uso = (map[r.projeto_id] ||= { ...USO_VAZIO });
        const v = Number(r.valor_total) || 0;
        if (r.fase === "actual") uso.actual += v;
        else uso.budget += v;
        if (r.numero_pedido_alvo) uso.enviadosErp += 1;
      });
      return map;
    },
  });

  const openCreate = () => {
    setEditingProject(null);
    setNome("");
    setDescricao("");
    setOrcamento("");
    setResponsavelId(user?.id || ""); // default: o próprio criador
    setAprovadorId("");
    setDataInicio("");
    setDataFim("");
    setDialogOpen(true);
  };

  const openEdit = (p: Projeto) => {
    setEditingProject(p);
    setNome(p.nome);
    setDescricao(p.descricao || "");
    setOrcamento(String(p.orcamento || ""));
    setResponsavelId(p.responsavel_id || "");
    setAprovadorId(p.aprovador_id || "");
    setDataInicio(p.data_inicio || "");
    setDataFim(p.data_fim || "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!nome.trim()) {
      toast({ title: "Preencha o nome do projeto", variant: "destructive" });
      return;
    }
    if (!responsavelId) {
      toast({ title: "Selecione o responsável do projeto", variant: "destructive" });
      return;
    }
    if (!aprovadorId) {
      toast({ title: "Selecione o aprovador do projeto", variant: "destructive" });
      return;
    }
    if (responsavelId === aprovadorId && !isAdmin) {
      toast({
        title: "Responsável e Aprovador não podem ser a mesma pessoa",
        description: "O fluxo de aprovação exige que sejam pessoas diferentes.",
        variant: "destructive",
      });
      return;
    }
    // A-11: o campo de data aceita ano com 5 dígitos ("82026") e fim antes do início.
    if ((dataInicio && !DATA_VALIDA.test(dataInicio)) || (dataFim && !DATA_VALIDA.test(dataFim))) {
      toast({
        title: "Data inválida",
        description: "Confira o ano das datas de início e fim.",
        variant: "destructive",
      });
      return;
    }
    if (dataInicio && dataFim && dataFim < dataInicio) {
      toast({ title: "A data de fim é anterior à data de início", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        nome: nome.trim(),
        descricao: descricao.trim() || null,
        responsavel_id: responsavelId,
        aprovador_id: aprovadorId,
        data_inicio: dataInicio || null,
        data_fim: dataFim || null,
        updated_at: new Date().toISOString(),
      };
      if (isAdmin) {
        payload.orcamento = parseFloat(orcamento) || 0;
      }

      if (editingProject) {
        // Upsert para evitar CORS PATCH. Só colunas REAIS da tabela: o objeto da
        // lista carrega nomes/e-mails hidratados (responsavel_nome…), que o
        // PostgREST recusa por não existirem em `projetos`. E nada de fase/status:
        // reenviar o valor lido poderia desfazer uma aprovação feita no meio-tempo.
        // `criado_por` vai porque o upsert avalia a policy de INSERT (P-6).
        const { error } = await supabase
          .from("projetos")
          .upsert({ ...payload, id: editingProject.id, criado_por: editingProject.criado_por }, { onConflict: "id" });
        if (error) throw error;
        toast({ title: "Projeto atualizado" });
      } else {
        payload.criado_por = user?.id || null;
        if (!isAdmin) payload.orcamento = parseFloat(orcamento) || 0;
        const { error } = await supabase.from("projetos").insert(payload);
        if (error) throw error;
        toast({ title: "Projeto criado" });
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
      // `.select()` devolve as linhas apagadas: sem isso, um DELETE barrado pela
      // RLS volta sem erro e a tela dizia "excluído" sem ter apagado nada.
      const { data, error } = await supabase.from("projetos").delete().eq("id", deleteTarget.id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Nenhum projeto foi excluído — verifique se você tem permissão para excluí-lo.");
      }
      toast({ title: "Projeto excluído" });
      queryClient.invalidateQueries({ queryKey: ["projetos"] });
      queryClient.invalidateQueries({ queryKey: ["projetos-usage"] });
    } catch (err: any) {
      toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  };

  // Filtered list by fase_atual
  const filtered = projetos.filter((p) => {
    const fase = p.fase_atual || "budget";
    if (filterFase !== "todos" && fase !== filterFase) return false;
    if (search && !p.nome.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Titularidade é do RESPONSÁVEL (é o que as policies de UPDATE/DELETE checam),
  // não de quem criou o registro.
  const canEditThis = (p: Projeto) =>
    isAdmin || (canEditOwn && p.responsavel_id === user?.id && p.fase_atual === "budget");

  const canDeleteThis = (p: Projeto) =>
    isAdmin || (canDeleteOwn && p.responsavel_id === user?.id && p.fase_atual === "budget");

  /**
   * Excluir o projeto apaga em cascata os pedidos E a trilha de auditoria. Com
   * pedido já no ERP isso deixaria o Alvo com um documento que o Hub esqueceu —
   * vale também para o admin (mesmo princípio da D-3).
   */
  const bloqueioExclusao = (p: Projeto) => {
    const enviados = (usageMap[p.id] || USO_VAZIO).enviadosErp;
    return enviados > 0
      ? `Este projeto tem ${enviados} pedido(s) já enviado(s) ao ERP e não pode ser excluído pelo Hub.`
      : null;
  };

  const totais = filtered.reduce(
    (acc, p) => {
      acc.orcamento += Number(p.orcamento) || 0;
      acc.comprometido += comprometido(p, usageMap[p.id] || USO_VAZIO);
      return acc;
    },
    { orcamento: 0, comprometido: 0 },
  );
  const pctTotal = pct(totais.comprometido, totais.orcamento);

  const acoesProjeto = (p: Projeto) => {
    const bloqueio = bloqueioExclusao(p);
    return (
      <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        {canEditThis(p) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                <Pencil className="h-3.5 w-3.5" />
                <span className="sr-only">Editar projeto</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Editar projeto</TooltipContent>
          </Tooltip>
        )}
        {canDeleteThis(p) && (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* span: botão desabilitado não dispara o tooltip */}
              <span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-danger"
                  disabled={!!bloqueio}
                  onClick={() => setDeleteTarget(p)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="sr-only">Excluir projeto</span>
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{bloqueio || "Excluir projeto"}</TooltipContent>
          </Tooltip>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(`/projetos/${p.id}`)}>
          <ChevronRight className="h-4 w-4" />
          <span className="sr-only">Abrir pedidos de compra</span>
        </Button>
      </div>
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      {/* grid-cols-1 = minmax(0, 1fr): a grade larga rola dentro do painel em vez de alargar a página */}
      <div className="grid grid-cols-1 gap-4 p-4 sm:p-6">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Projetos</h1>
            <p className="text-sm text-muted-foreground">
              Orçamento e pedidos de compra por projeto
              {!canViewAll && !isAdmin && <span> · exibindo os projetos em que você é responsável ou aprovador</span>}
            </p>
          </div>
          {canCreate && (
            <Button onClick={openCreate} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> Novo projeto
            </Button>
          )}
        </div>

        {/* Resumo */}
        <div className="grid grid-cols-2 divide-border rounded-md border border-border bg-card sm:grid-cols-4 sm:divide-x">
          <Indicador
            rotulo="Projetos"
            valor={filtered.length}
            apoio={filterFase === "todos" ? "todas as fases" : "no filtro"}
          />
          <Indicador rotulo="Orçamento" valor={fmtMoeda(totais.orcamento)} apoio="soma dos projetos listados" />
          <Indicador
            rotulo="Comprometido"
            valor={fmtMoeda(totais.comprometido)}
            apoio={`${fmtPct(pctTotal)} do orçamento · fase corrente`}
          />
          <Indicador
            rotulo="Saldo"
            valor={fmtMoeda(totais.orcamento - totais.comprometido)}
            tom={totais.orcamento - totais.comprometido < 0 ? "perigo" : undefined}
            apoio="orçamento − comprometido"
          />
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar projeto"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8"
            />
          </div>
          <Select value={filterFase} onValueChange={setFilterFase}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas as fases</SelectItem>
              <SelectItem value="budget">Budget</SelectItem>
              <SelectItem value="budget_em_aprovacao">Em aprovação</SelectItem>
              <SelectItem value="actual">Actual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Lista */}
        {isLoading ? (
          <div className="flex items-center justify-center rounded-md border border-border bg-card py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-md border border-border bg-card py-16 text-muted-foreground">
            <FolderKanban className="mb-2 h-8 w-8" />
            <p className="text-sm">Nenhum projeto encontrado</p>
          </div>
        ) : (
          <>
            {/* Desktop: grade */}
            <div className="hidden overflow-hidden rounded-md border border-border bg-card md:block">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 px-3 text-xs">Projeto</TableHead>
                    <TableHead className="h-9 px-3 text-xs">Fase</TableHead>
                    <TableHead className="h-9 px-3 text-xs">Responsável / aprovador</TableHead>
                    <TableHead className="h-9 px-3 text-right text-xs">Orçamento</TableHead>
                    <TableHead className="h-9 w-[180px] px-3 text-xs">Comprometido</TableHead>
                    <TableHead className="h-9 px-3 text-right text-xs">Saldo</TableHead>
                    <TableHead className="h-9 w-[104px] px-3" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => {
                    const uso = usageMap[p.id] || USO_VAZIO;
                    const valor = comprometido(p, uso);
                    const orc = Number(p.orcamento) || 0;
                    const pc = pct(valor, orc);
                    const saldo = orc - valor;
                    const periodo =
                      p.data_inicio || p.data_fim ? `${fmtData(p.data_inicio)} – ${fmtData(p.data_fim)}` : null;
                    const apoio = [periodo, p.descricao].filter(Boolean).join(" · ");
                    return (
                      <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/projetos/${p.id}`)}>
                        <TableCell className="max-w-[300px] px-3 py-2">
                          <p className="truncate font-medium text-foreground">{p.nome}</p>
                          {apoio && <p className="truncate text-xs tabular-nums text-muted-foreground">{apoio}</p>}
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <FaseChip fase={p.fase_atual} />
                        </TableCell>
                        <TableCell className="max-w-[180px] px-3 py-2">
                          <p className="truncate text-sm">{p.responsavel_nome || p.responsavel_email || "—"}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            aprov. {p.aprovador_nome || p.aprovador_email || "—"}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-3 py-2 text-right text-sm tabular-nums">
                          {fmtMoeda(orc)}
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="flex items-baseline justify-between gap-2 whitespace-nowrap text-sm tabular-nums">
                            <span>{fmtMoeda(valor)}</span>
                            <span className="text-xs text-muted-foreground">{fmtPct(pc)}</span>
                          </div>
                          <BarraConsumo pct={pc} className="mt-1" />
                        </TableCell>
                        <TableCell
                          className={`whitespace-nowrap px-3 py-2 text-right text-sm tabular-nums ${saldo < 0 ? "text-danger" : ""}`}
                        >
                          {fmtMoeda(saldo)}
                        </TableCell>
                        <TableCell className="px-3 py-1.5">{acoesProjeto(p)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: lista compacta */}
            <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card md:hidden">
              {filtered.map((p) => {
                const uso = usageMap[p.id] || USO_VAZIO;
                const valor = comprometido(p, uso);
                const orc = Number(p.orcamento) || 0;
                const pc = pct(valor, orc);
                return (
                  <div key={p.id} className="cursor-pointer px-3 py-3" onClick={() => navigate(`/projetos/${p.id}`)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.nome}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {p.responsavel_nome || p.responsavel_email || "—"} · aprov.{" "}
                          {p.aprovador_nome || p.aprovador_email || "—"}
                        </p>
                      </div>
                      <FaseChip fase={p.fase_atual} />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between text-xs tabular-nums">
                      <span>
                        {fmtMoeda(valor)} <span className="text-muted-foreground">de {fmtMoeda(orc)}</span>
                      </span>
                      <span className={tomConsumo(pc) === "perigo" ? "text-danger" : "text-muted-foreground"}>
                        {fmtPct(pc)}
                      </span>
                    </div>
                    <BarraConsumo pct={pc} className="mt-1" />
                    <div className="mt-1">{acoesProjeto(p)}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingProject ? "Editar projeto" : "Novo projeto"}</DialogTitle>
              <DialogDescription>
                O responsável cria os pedidos de compra; o aprovador aprova o Budget e libera o Actual.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <Label>Nome do projeto *</Label>
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
                  className="tabular-nums"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Responsável *</Label>
                  <Select value={responsavelId} onValueChange={setResponsavelId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {responsaveis.length === 0 ? (
                        <p className="px-2 py-2 text-xs text-muted-foreground">
                          Nenhum usuário com papel "Responsável de Projeto" cadastrado.
                        </p>
                      ) : (
                        responsaveis.map((u) => (
                          <SelectItem key={u.user_id} value={u.user_id}>
                            {userLabel(u)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Cria os pedidos de compra.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Aprovador *</Label>
                  <Select value={aprovadorId} onValueChange={setAprovadorId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {aprovadores.length === 0 ? (
                        <p className="px-2 py-2 text-xs text-muted-foreground">
                          Nenhum usuário com papel "Aprovador de Projetos" cadastrado.
                        </p>
                      ) : (
                        aprovadores.map((u) => (
                          <SelectItem key={u.user_id} value={u.user_id}>
                            {userLabel(u)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Aprova o Budget e libera o Actual.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Data de início</Label>
                  <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Data de fim</Label>
                  <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingProject ? "Salvar" : "Criar projeto"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir o projeto "{deleteTarget?.nome}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Os pedidos de compra do projeto e o histórico de eventos dele também serão apagados. Esta ação não pode
                ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
