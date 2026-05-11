import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Package,
  Send,
  RefreshCw,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { format } from "date-fns";
import { ProductCombobox } from "@/components/ProductCombobox";
import { enviarRequisicaoAlvo } from "@/services/alvoProjetoPedidoService";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pendente: {
    label: "Pendente",
    className: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  pendente_aprovacao: {
    label: "Pendente de Aprovação",
    className: "bg-orange-100 text-orange-800 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400",
  },
  aprovado: {
    label: "Aprovado",
    className: "bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400",
  },
  concluido: {
    label: "Concluído",
    className: "bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400",
  },
  cancelado: { label: "Cancelado", className: "bg-muted text-muted-foreground" },
};

const REQ_STATUS: Record<string, { label: string; className: string }> = {
  rascunho: { label: "Rascunho", className: "bg-muted text-muted-foreground" },
  enviado: { label: "Enviado", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  erro: { label: "Erro", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
};

const fmtCurrency = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface ReqItem {
  codigoProduto: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  valor_unitario: number;
  codigoClasFiscal: string;
  codigoTipoProdFisc: string;
}

interface ClasseRateio {
  classe_codigo: string;
  classe_nome: string;
  centro_custo_codigo: string;
  centro_custo_nome: string;
  percentual: number;
}

export default function ProjetoRequisicoes() {
  const { id: projetoId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = profile?.is_admin === true;

  // Permissions
  const canPedidosCreate = useHasPermission(PERMISSIONS.PROJETOS_PEDIDOS_CREATE);
  const canReenviar = useHasPermission(PERMISSIONS.PROJETOS_PEDIDOS_REENVIAR);
  const canApprove = useHasPermission(PERMISSIONS.PROJETOS_APPROVE);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingReq, setEditingReq] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [enviarTarget, setEnviarTarget] = useState<any>(null);
  const [currentFase, setCurrentFase] = useState<"budget" | "actual">("budget");
  const [enviandoAprovacao, setEnviandoAprovacao] = useState(false);
  const [aprovandoBudget, setAprovandoBudget] = useState(false);

  // Form state
  const [descricao, setDescricao] = useState("");
  const [fornecedorSearch, setFornecedorSearch] = useState("");
  const [fornecedor, setFornecedor] = useState<{ codigo: string; nome: string; cnpj: string } | null>(null);
  const [condPag, setCondPag] = useState("");
  const [itens, setItens] = useState<ReqItem[]>([
    {
      codigoProduto: "",
      descricao: "",
      unidade: "UNID",
      quantidade: 1,
      valor_unitario: 0,
      codigoClasFiscal: "",
      codigoTipoProdFisc: "",
    },
  ]);
  const [classeRateio, setClasseRateio] = useState<ClasseRateio[]>([]);

  // Fetch project
  const { data: projeto, isLoading: loadingProjeto } = useQuery({
    queryKey: ["projeto", projetoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("projetos").select("*").eq("id", projetoId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!projetoId,
  });

  // Fetch responsável e aprovador (para mostrar nomes)
  const { data: pessoasMap = {} } = useQuery({
    queryKey: ["projeto-pessoas", (projeto as any)?.responsavel_id, (projeto as any)?.aprovador_id],
    queryFn: async () => {
      const ids: string[] = [];
      const p = projeto as any;
      if (p?.responsavel_id) ids.push(p.responsavel_id);
      if (p?.aprovador_id) ids.push(p.aprovador_id);
      if (ids.length === 0) return {};
      const { data } = await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids);
      const map: Record<string, { nome: string; email: string }> = {};
      (data || []).forEach((p: any) => {
        map[p.user_id] = { nome: p.full_name || p.email, email: p.email };
      });
      return map;
    },
    enabled: !!projeto,
  });

  // Fetch requisitions
  const { data: requisicoes = [], isLoading: loadingReqs } = useQuery({
    queryKey: ["projeto-requisicoes", projetoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projeto_requisicoes")
        .select("*")
        .eq("projeto_id", projetoId!)
        .order("sequencia", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!projetoId,
  });

  // Fetch fornecedores
  const { data: fornecedores = [] } = useQuery({
    queryKey: ["entidades-cache", fornecedorSearch],
    queryFn: async () => {
      if (fornecedorSearch.length < 2) return [];
      const { data } = await supabase
        .from("compras_entidades_cache")
        .select("codigo_entidade, nome, cnpj")
        .or(`nome.ilike.%${fornecedorSearch}%,cnpj.ilike.%${fornecedorSearch}%`)
        .limit(10);
      return data || [];
    },
    enabled: fornecedorSearch.length >= 2,
  });

  // Fetch condições de pagamento
  const { data: condicoes = [] } = useQuery({
    queryKey: ["condicoes-pagamento"],
    queryFn: async () => {
      const { data } = await supabase.from("condicoes_pagamento").select("codigo, nome").order("nome");
      return data || [];
    },
  });

  // Fetch classes rec desp
  const { data: classes = [] } = useQuery({
    queryKey: ["classes-rec-desp-select"],
    queryFn: async () => {
      const { data } = await supabase
        .from("classes_rec_desp")
        .select("codigo, nome")
        .eq("is_active", true)
        .order("codigo");
      return data || [];
    },
  });

  // Fetch cost centers
  const { data: costCenters = [] } = useQuery({
    queryKey: ["cost-centers-select"],
    queryFn: async () => {
      const { data } = await supabase.from("cost_centers").select("erp_code, name").eq("is_active", true).order("name");
      return data || [];
    },
  });

  // Search filters for classification selects
  const [classeSearch, setClasseSearch] = useState<Record<number, string>>({});
  const [ccSearch, setCcSearch] = useState<Record<number, string>>({});

  // Split by fase
  const pedidosBudget = useMemo(() => requisicoes.filter((r: any) => r.fase === "budget"), [requisicoes]);
  const pedidosActual = useMemo(() => requisicoes.filter((r: any) => r.fase === "actual"), [requisicoes]);

  const totalBudget = useMemo(
    () => pedidosBudget.reduce((s, r) => s + (Number(r.valor_total) || 0), 0),
    [pedidosBudget],
  );
  const totalActual = useMemo(
    () => pedidosActual.reduce((s, r) => s + (Number(r.valor_total) || 0), 0),
    [pedidosActual],
  );

  const orcamento = Number((projeto as any)?.orcamento) || 0;
  const faseAtual = ((projeto as any)?.fase_atual as string) || "budget";

  const pctBudget = orcamento > 0 ? Math.round((totalBudget / orcamento) * 100) : 0;
  const pctActual = orcamento > 0 ? Math.round((totalActual / orcamento) * 100) : 0;

  const valorTotalItens = useMemo(() => itens.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0), [itens]);

  const totalRateio = useMemo(() => classeRateio.reduce((s, c) => s + c.percentual, 0), [classeRateio]);

  // ── Helpers de autorização específicos deste projeto ──
  const projetoAny = projeto as any;
  const isResponsavel = !!user && projetoAny?.responsavel_id === user.id;
  const isAprovador = !!user && projetoAny?.aprovador_id === user.id;

  // Pode criar/editar/excluir pedidos em Budget
  const canEditBudget = (isAdmin || (canPedidosCreate && isResponsavel)) && faseAtual === "budget";
  // Pode editar pedidos em Actual (rascunho/erro)
  const canEditActualRow = (r: any) =>
    faseAtual === "actual" &&
    (isAdmin || (canPedidosCreate && isResponsavel)) &&
    (r.status === "rascunho" || r.status === "erro") &&
    !r.bloqueado;
  // Pode enviar pedido ao Alvo
  const canSendToAlvo = (r: any) =>
    faseAtual === "actual" &&
    r.fase === "actual" &&
    (isAdmin || (canReenviar && isResponsavel)) &&
    (r.status === "rascunho" || r.status === "erro");
  // Pode enviar Budget para aprovação
  const canSendForApproval = (isAdmin || isResponsavel) && faseAtual === "budget" && pedidosBudget.length > 0;
  // Pode aprovar Budget
  const canApproveBudget = (isAdmin || (canApprove && isAprovador)) && faseAtual === "budget_em_aprovacao";

  const aprovadorNome = projetoAny?.aprovador_id ? (pessoasMap as any)[projetoAny.aprovador_id]?.nome || "..." : "—";
  const responsavelNome = projetoAny?.responsavel_id
    ? (pessoasMap as any)[projetoAny.responsavel_id]?.nome || "..."
    : "—";

  function resetForm() {
    setDescricao("");
    setFornecedorSearch("");
    setFornecedor(null);
    setCondPag("");
    setItens([
      {
        codigoProduto: "",
        descricao: "",
        unidade: "UNID",
        quantidade: 1,
        valor_unitario: 0,
        codigoClasFiscal: "",
        codigoTipoProdFisc: "",
      },
    ]);
    setClasseRateio([]);
    setEditingReq(null);
  }

  function openCreate(fase: "budget" | "actual") {
    resetForm();
    setCurrentFase(fase);
    setDialogOpen(true);
  }

  function openEdit(r: any) {
    setEditingReq(r);
    setCurrentFase(r.fase || "budget");
    setDescricao(r.descricao);
    setFornecedor(
      r.fornecedor_nome
        ? { codigo: r.fornecedor_codigo || "", nome: r.fornecedor_nome, cnpj: r.fornecedor_cnpj || "" }
        : null,
    );
    setFornecedorSearch(r.fornecedor_nome || "");
    setCondPag(r.cond_pagamento_codigo || "");
    const ri = (r.itens as any[]) || [];
    setItens(
      ri.length > 0
        ? ri.map((i: any) => ({
            codigoProduto: i.codigoProduto || i.codigo_produto || "",
            descricao: i.descricao || "",
            unidade: i.unidade || "UNID",
            quantidade: Number(i.quantidade) || 1,
            valor_unitario: Number(i.valor_unitario) || 0,
            codigoClasFiscal: i.codigoClasFiscal || "",
            codigoTipoProdFisc: i.codigoTipoProdFisc || "",
          }))
        : [
            {
              codigoProduto: "",
              descricao: "",
              unidade: "UNID",
              quantidade: 1,
              valor_unitario: 0,
              codigoClasFiscal: "",
              codigoTipoProdFisc: "",
            },
          ],
    );
    const rc = (r.classe_rateio as any[]) || [];
    setClasseRateio(
      rc.map((c: any) => ({
        classe_codigo: c.classe_codigo || "",
        classe_nome: c.classe_nome || "",
        centro_custo_codigo: c.centro_custo_codigo || "",
        centro_custo_nome: c.centro_custo_nome || "",
        percentual: Number(c.percentual) || 0,
      })),
    );
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!descricao.trim()) {
      toast({ title: "Preencha a descrição", variant: "destructive" });
      return;
    }
    const validItens = itens.filter((i) => i.codigoProduto.trim() || i.descricao.trim());
    if (validItens.length === 0) {
      toast({ title: "Adicione pelo menos 1 item", variant: "destructive" });
      return;
    }
    if (classeRateio.length > 0 && Math.abs(totalRateio - 100) > 0.01) {
      toast({ title: "Rateio deve somar 100%", variant: "destructive" });
      return;
    }

    const vt = validItens.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0);

    // Budget check per fase
    const totalFase = currentFase === "budget" ? totalBudget : totalActual;
    const outrasReqs = editingReq ? totalFase - (Number(editingReq.valor_total) || 0) : totalFase;
    if (outrasReqs + vt > orcamento && orcamento > 0) {
      toast({
        title: "Orçamento excedido",
        description: `Valor excede o orçamento disponível do projeto (saldo: ${fmtCurrency(orcamento - outrasReqs)}).`,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const condNome = condicoes.find((c) => c.codigo === condPag)?.nome || null;

    const payload: any = {
      projeto_id: projetoId,
      descricao,
      fornecedor_codigo: fornecedor?.codigo || null,
      fornecedor_nome: fornecedor?.nome || null,
      fornecedor_cnpj: fornecedor?.cnpj || null,
      cond_pagamento_codigo: condPag || null,
      cond_pagamento_nome: condNome,
      itens: validItens,
      classe_rateio: classeRateio,
      valor_total: vt,
      status: editingReq?.status || "rascunho",
      fase: currentFase,
      criado_por: user?.id || null,
      updated_at: new Date().toISOString(),
    };

    if (editingReq) payload.id = editingReq.id;

    const { error } = await supabase.from("projeto_requisicoes").upsert(payload);
    setSaving(false);

    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }

    toast({ title: editingReq ? "Pedido de compra atualizado!" : "Pedido de compra criado!" });

    // Auditoria: registrar desvios Actual vs Budget
    if (currentFase === "actual" && editingReq?.budget_origem_id) {
      const { data: budgetOriginal } = await supabase
        .from("projeto_requisicoes")
        .select("valor_total, fornecedor_nome, fornecedor_codigo, cond_pagamento_codigo, classe_rateio")
        .eq("id", editingReq.budget_origem_id)
        .single();

      if (budgetOriginal) {
        const alteracoes: any[] = [];
        const userEmail = user?.email || "desconhecido";
        const base = {
          projeto_id: projetoId,
          requisicao_id: editingReq.id,
          budget_origem_id: editingReq.budget_origem_id,
          usuario: userEmail,
        };

        const bv = Number(budgetOriginal.valor_total) || 0;
        if (Math.abs(vt - bv) > 0.01) {
          alteracoes.push({
            ...base,
            campo: "valor_total",
            valor_budget: String(bv),
            valor_actual: String(vt),
            desvio_valor: vt - bv,
            desvio_percentual: bv > 0 ? Math.round(((vt - bv) / bv) * 10000) / 100 : null,
          });
        }

        if ((fornecedor?.codigo || null) !== budgetOriginal.fornecedor_codigo) {
          alteracoes.push({
            ...base,
            campo: "fornecedor",
            valor_budget: budgetOriginal.fornecedor_nome || "",
            valor_actual: fornecedor?.nome || "",
            desvio_valor: null,
            desvio_percentual: null,
          });
        }

        if ((condPag || null) !== budgetOriginal.cond_pagamento_codigo) {
          alteracoes.push({
            ...base,
            campo: "cond_pagamento",
            valor_budget: budgetOriginal.cond_pagamento_codigo || "",
            valor_actual: condPag || "",
            desvio_valor: null,
            desvio_percentual: null,
          });
        }

        const budgetCR = JSON.stringify((budgetOriginal.classe_rateio as any[]) || []);
        const actualCR = JSON.stringify(classeRateio);
        if (budgetCR !== actualCR) {
          alteracoes.push({
            ...base,
            campo: "classe_rateio",
            valor_budget: ((budgetOriginal.classe_rateio as any[]) || [])
              .map((c: any) => `${c.classe_codigo} ${c.percentual}%`)
              .join("; "),
            valor_actual: classeRateio.map((c) => `${c.classe_codigo} ${c.percentual}%`).join("; "),
            desvio_valor: null,
            desvio_percentual: null,
          });
        }

        if (alteracoes.length > 0) {
          await supabase.from("projeto_pedido_auditoria").insert(alteracoes);
          console.log(`[Auditoria] ${alteracoes.length} desvio(s) registrado(s)`);
        }
      }
    }

    setDialogOpen(false);
    resetForm();
    queryClient.invalidateQueries({ queryKey: ["projeto-requisicoes", projetoId] });
    queryClient.invalidateQueries({ queryKey: ["projetos-usage"] });
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.from("projeto_requisicoes").delete().eq("id", deleteTarget.id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Pedido de compra excluído!" });
      queryClient.invalidateQueries({ queryKey: ["projeto-requisicoes", projetoId] });
      queryClient.invalidateQueries({ queryKey: ["projetos-usage"] });
    }
    setDeleteTarget(null);
  }

  async function handleEnviarAlvo() {
    if (!enviarTarget || !projeto) return;
    const targetId = enviarTarget.id;
    setEnviando(targetId);
    setEnviarTarget(null);
    const result = await enviarRequisicaoAlvo(targetId, (projeto as any).nome);
    if (result.success) {
      toast({ title: `Pedido ${result.numeroPedido || ""} criado no ERP Alvo` });
    } else {
      toast({ title: "Erro ao enviar", description: result.error, variant: "destructive" });
    }
    setEnviando(null);
    await queryClient.invalidateQueries({ queryKey: ["projeto-requisicoes", projetoId] });
  }

  // ── Novo: Enviar Budget para Aprovação (RPC) ──
  async function handleEnviarParaAprovacao() {
    if (!projetoId) return;
    setEnviandoAprovacao(true);
    try {
      const { data, error } = await (supabase as any).rpc("enviar_budget_para_aprovacao", {
        p_projeto_id: projetoId,
      });
      if (error) throw error;
      toast({
        title: "Enviado para aprovação!",
        description: `Aprovador ${data?.aprovador_nome || data?.aprovador_email || ""} será notificado.`,
      });
      // TODO P3: chamar Edge Function notify-aprovador-budget via fetch
      queryClient.invalidateQueries({ queryKey: ["projeto", projetoId] });
    } catch (err: any) {
      console.error("Erro ao enviar para aprovação:", err);
      toast({
        title: "Erro ao enviar para aprovação",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setEnviandoAprovacao(false);
    }
  }

  // ── Novo: Aprovar Budget (RPC) ──
  async function handleAprovarBudget() {
    if (!projetoId) return;
    setAprovandoBudget(true);
    try {
      const { data, error } = await (supabase as any).rpc("aprovar_budget_projeto", {
        p_projeto_id: projetoId,
      });
      if (error) throw error;
      toast({
        title: "Budget aprovado!",
        description: `${data?.copiados || 0} pedido(s) copiado(s) para o Actual.`,
      });
      queryClient.invalidateQueries({ queryKey: ["projeto", projetoId] });
      queryClient.invalidateQueries({ queryKey: ["projeto-requisicoes", projetoId] });
    } catch (err: any) {
      console.error("Erro ao aprovar budget:", err);
      toast({
        title: "Erro ao aprovar",
        description: err.message || String(err),
        variant: "destructive",
      });
    } finally {
      setAprovandoBudget(false);
    }
  }

  function updateItem(idx: number, field: keyof ReqItem, value: any) {
    setItens((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  }

  // ── Render mobile card for a pedido ──
  const renderPedidoCard = (r: any, fase: "budget" | "actual", canEditRow: boolean) => {
    const rs = REQ_STATUS[r.status] || REQ_STATUS.rascunho;
    const isExpanded = expandedRow === r.id;
    const rItens = (r.itens as any[]) || [];
    const rClasse = (r.classe_rateio as any[]) || [];

    return (
      <div key={r.id} className="rounded-lg border border-border bg-card/50">
        <div
          className={`flex items-start justify-between gap-2 p-3 cursor-pointer ${fase === "budget" ? "hover:bg-yellow-100/50 dark:hover:bg-yellow-900/30" : "hover:bg-green-100/50 dark:hover:bg-green-900/30"}`}
          onClick={() => setExpandedRow(isExpanded ? null : r.id)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0" />
              )}
              <span className="text-xs text-muted-foreground">#{r.sequencia}</span>
              {fase === "actual" && <Badge className={`${rs.className} text-[10px] px-1.5 py-0`}>{rs.label}</Badge>}
            </div>
            <p className="mt-1 text-sm font-medium truncate">{r.descricao}</p>
            <p className="text-xs text-muted-foreground truncate">{r.fornecedor_nome || "Sem fornecedor"}</p>
          </div>
          <div className="text-right shrink-0" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold">{fmtCurrency(Number(r.valor_total) || 0)}</p>
            <div className="flex gap-1 mt-1 justify-end">
              {canSendToAlvo(r) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-blue-600"
                  disabled={enviando === r.id}
                  onClick={() => setEnviarTarget(r)}
                >
                  {enviando === r.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : r.status === "erro" ? (
                    <RefreshCw className="h-3 w-3" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                </Button>
              )}
              {canEditRow && (r.status !== "enviado" || isAdmin) && (
                <>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(r)}>
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive"
                    onClick={() => setDeleteTarget(r)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
        {r.status === "enviado" && r.numero_pedido_alvo && (
          <p className="px-3 pb-1 text-xs font-medium text-green-600 dark:text-green-400">
            Pedido #{r.numero_pedido_alvo}
          </p>
        )}
        {isExpanded && (
          <div className="border-t border-border p-3 space-y-3">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Itens</h4>
              <div className="space-y-2">
                {rItens.map((it: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {it.codigoProduto || it.codigo_produto
                          ? `${it.codigoProduto || it.codigo_produto} — ${it.descricao}`
                          : it.descricao}
                      </p>
                      <p className="text-muted-foreground">
                        {it.quantidade} {it.unidade} × {fmtCurrency(Number(it.valor_unitario) || 0)}
                      </p>
                    </div>
                    <span className="font-semibold shrink-0">
                      {fmtCurrency((Number(it.quantidade) || 0) * (Number(it.valor_unitario) || 0))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {rClasse.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Classificação / Rateio</h4>
                <div className="space-y-1.5">
                  {rClasse.map((c: any, idx: number) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {c.classe_codigo} — {c.classe_nome}
                        </p>
                        <p className="text-muted-foreground truncate">
                          {c.centro_custo_codigo} — {c.centro_custo_nome}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p>{c.percentual}%</p>
                        <p className="font-semibold">
                          {fmtCurrency((Number(c.percentual) / 100) * Number(r.valor_total))}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {r.numero_pedido_alvo && (
                <span>
                  Pedido Alvo: <strong>#{r.numero_pedido_alvo}</strong>
                </span>
              )}
              {r.cond_pagamento_nome && <span>Cond. Pagamento: {r.cond_pagamento_nome}</span>}
              {r.fornecedor_cnpj && <span>CNPJ: {r.fornecedor_cnpj}</span>}
            </div>
            {r.erro_envio && <p className="text-xs text-destructive">Erro: {r.erro_envio}</p>}
          </div>
        )}
      </div>
    );
  };

  // ── Render pedidos table ──
  const renderPedidosTable = (pedidos: any[], fase: "budget" | "actual") => {
    if (loadingReqs) {
      return (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (pedidos.length === 0) {
      return (
        <p
          className={`py-8 text-center text-sm italic ${fase === "budget" ? "text-yellow-600 dark:text-yellow-500" : "text-green-600 dark:text-green-500"}`}
        >
          Nenhum pedido de compra cadastrado.
        </p>
      );
    }

    return (
      <>
        {/* Mobile cards */}
        <div className="space-y-2 md:hidden">
          {pedidos.map((r: any) => {
            const rowCanEdit = fase === "budget" ? canEditBudget : canEditActualRow(r);
            return renderPedidoCard(r, fase, rowCanEdit);
          })}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-right">Valor Total</TableHead>
                {fase === "actual" && <TableHead>Status</TableHead>}
                <TableHead className="w-24">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidos.map((r: any) => {
                const rs = REQ_STATUS[r.status] || REQ_STATUS.rascunho;
                const isExpanded = expandedRow === r.id;
                const rItens = (r.itens as any[]) || [];
                const rClasse = (r.classe_rateio as any[]) || [];
                const rowCanEdit = fase === "budget" ? canEditBudget : canEditActualRow(r);
                return (
                  <>
                    <TableRow
                      key={r.id}
                      className={`cursor-pointer ${r.bloqueado ? "opacity-75" : ""} ${fase === "budget" ? "hover:bg-yellow-100/50 dark:hover:bg-yellow-900/30" : "hover:bg-green-100/50 dark:hover:bg-green-900/30"}`}
                      onClick={() => setExpandedRow(isExpanded ? null : r.id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          {r.sequencia}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate font-medium text-sm">{r.descricao}</TableCell>
                      <TableCell className="max-w-[120px] truncate text-sm text-muted-foreground">
                        {r.fornecedor_nome || "—"}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {fmtCurrency(Number(r.valor_total) || 0)}
                      </TableCell>
                      {fase === "actual" && (
                        <TableCell>
                          <TooltipProvider>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge className={rs.className}>{rs.label}</Badge>
                              {r.status === "enviado" && r.numero_pedido_alvo && (
                                <span className="text-xs font-medium text-green-600 dark:text-green-400">
                                  Pedido #{r.numero_pedido_alvo}
                                </span>
                              )}
                              {r.status === "erro" && r.erro_envio && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertTriangle className="h-3.5 w-3.5 text-destructive cursor-help" />
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs text-xs">
                                    {r.erro_envio}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TooltipProvider>
                        </TableCell>
                      )}
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          {canSendToAlvo(r) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-7 w-7 p-0 ${r.status === "erro" ? "text-yellow-600 hover:text-yellow-700" : "text-blue-600 hover:text-blue-700"}`}
                              disabled={enviando === r.id}
                              onClick={() => setEnviarTarget(r)}
                            >
                              {enviando === r.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : r.status === "erro" ? (
                                <RefreshCw className="h-3 w-3" />
                              ) : (
                                <Send className="h-3 w-3" />
                              )}
                            </Button>
                          )}
                          {rowCanEdit && (r.status !== "enviado" || isAdmin) && (
                            <>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(r)}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onClick={() => setDeleteTarget(r)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow key={`${r.id}-detail`}>
                        <TableCell colSpan={fase === "actual" ? 6 : 5} className="bg-muted/30 p-4">
                          <div className="space-y-4">
                            <div>
                              <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Itens</h4>
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Produto</TableHead>
                                    <TableHead>Unidade</TableHead>
                                    <TableHead className="text-right">Qtd</TableHead>
                                    <TableHead className="text-right">Vlr Unit.</TableHead>
                                    <TableHead className="text-right">Vlr Total</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {rItens.map((it: any, idx: number) => (
                                    <TableRow key={idx}>
                                      <TableCell>
                                        {it.codigoProduto || it.codigo_produto
                                          ? `${it.codigoProduto || it.codigo_produto} — ${it.descricao}`
                                          : it.descricao}
                                      </TableCell>
                                      <TableCell>{it.unidade}</TableCell>
                                      <TableCell className="text-right">{it.quantidade}</TableCell>
                                      <TableCell className="text-right">
                                        {fmtCurrency(Number(it.valor_unitario) || 0)}
                                      </TableCell>
                                      <TableCell className="text-right font-medium">
                                        {fmtCurrency((Number(it.quantidade) || 0) * (Number(it.valor_unitario) || 0))}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                            {rClasse.length > 0 && (
                              <div>
                                <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                                  Classificação / Rateio
                                </h4>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Classe</TableHead>
                                      <TableHead>Centro de Custo</TableHead>
                                      <TableHead className="text-right">%</TableHead>
                                      <TableHead className="text-right">Valor</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {rClasse.map((c: any, idx: number) => (
                                      <TableRow key={idx}>
                                        <TableCell>
                                          {c.classe_codigo} — {c.classe_nome}
                                        </TableCell>
                                        <TableCell>
                                          {c.centro_custo_codigo} — {c.centro_custo_nome}
                                        </TableCell>
                                        <TableCell className="text-right">{c.percentual}%</TableCell>
                                        <TableCell className="text-right">
                                          {fmtCurrency((Number(c.percentual) / 100) * Number(r.valor_total))}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                              {r.numero_pedido_alvo && (
                                <span>
                                  Pedido Alvo: <strong className="font-mono">#{r.numero_pedido_alvo}</strong>
                                </span>
                              )}
                              {r.enviado_alvo_em && (
                                <span>Enviado em {new Date(r.enviado_alvo_em).toLocaleString("pt-BR")}</span>
                              )}
                              {r.cond_pagamento_nome && <span>Cond. Pagamento: {r.cond_pagamento_nome}</span>}
                              {r.fornecedor_cnpj && <span>CNPJ: {r.fornecedor_cnpj}</span>}
                            </div>
                            {r.erro_envio && <p className="text-xs text-destructive">Erro: {r.erro_envio}</p>}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </>
    );
  };

  if (loadingProjeto) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!projeto) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <Package className="h-16 w-16" />
        <p>Projeto não encontrado.</p>
        <Button variant="outline" onClick={() => navigate("/projetos")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
        </Button>
      </div>
    );
  }

  const projData = projeto as any;
  const statusCfg = STATUS_CONFIG[projData.status] || STATUS_CONFIG.pendente;

  return (
    <div className="space-y-6 p-4 sm:p-6 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/projetos")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold">{projData.nome}</h1>
              {/* Badge de status: esconde quando fase=budget_em_aprovacao para evitar duplicação com badge de fase */}
              {faseAtual !== "budget_em_aprovacao" && <Badge className={statusCfg.className}>{statusCfg.label}</Badge>}
              {faseAtual === "budget" && (
                <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400">
                  Budget
                </Badge>
              )}
              {faseAtual === "budget_em_aprovacao" && (
                <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-400">
                  Pendente de Aprovação
                </Badge>
              )}
              {faseAtual === "actual" && (
                <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400">
                  Actual
                </Badge>
              )}

              {/* Botão 1: Enviar para Aprovação (fase=budget) */}
              {canSendForApproval && (
                <Button
                  size="sm"
                  className="bg-yellow-600 hover:bg-yellow-700 text-white"
                  onClick={handleEnviarParaAprovacao}
                  disabled={enviandoAprovacao}
                >
                  {enviandoAprovacao ? (
                    <>
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Enviando...
                    </>
                  ) : (
                    <>
                      <Send className="mr-1 h-3 w-3" /> Enviar para Aprovação
                    </>
                  )}
                </Button>
              )}

              {/* Botão 2: Aprovar Budget (fase=budget_em_aprovacao + é aprovador) */}
              {canApproveBudget && (
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={handleAprovarBudget}
                  disabled={aprovandoBudget}
                >
                  {aprovandoBudget ? (
                    <>
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Aprovando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Aprovar Budget
                    </>
                  )}
                </Button>
              )}

              {/* Texto: Aguardando aprovação (responsável vê durante em_aprovacao) */}
              {faseAtual === "budget_em_aprovacao" && !canApproveBudget && (
                <div className="flex items-center gap-1.5 rounded-md bg-orange-50 dark:bg-orange-900/20 px-2.5 py-1 text-xs text-orange-700 dark:text-orange-400">
                  <Clock className="h-3 w-3" />
                  <span>
                    Aguardando aprovação de <strong>{aprovadorNome}</strong>
                  </span>
                </div>
              )}
            </div>
            {projData.descricao && <p className="mt-1 text-sm text-muted-foreground">{projData.descricao}</p>}
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>
                Responsável: <strong>{responsavelNome}</strong>
              </span>
              <span>
                Aprovador: <strong>{aprovadorNome}</strong>
              </span>
            </div>
            {projData.budget_aprovado_por && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Aprovado por {projData.budget_aprovado_por} em{" "}
                {projData.budget_aprovado_em
                  ? format(new Date(projData.budget_aprovado_em as string), "dd/MM/yyyy HH:mm")
                  : "—"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Global budget bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>
              Orçamento: <strong>{fmtCurrency(orcamento)}</strong>
            </span>
            <span className="text-yellow-700 dark:text-yellow-400">
              Budget: <strong>{fmtCurrency(totalBudget)}</strong> ({pctBudget}%)
            </span>
            <span className="text-green-700 dark:text-green-400">
              Actual: <strong>{fmtCurrency(totalActual)}</strong> ({pctActual}%)
            </span>
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
              <span>Budget</span>
            </div>
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-yellow-500 transition-all"
                style={{ width: `${Math.min(pctBudget, 100)}%` }}
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
              <span>Actual</span>
            </div>
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${Math.min(pctActual, 100)}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Split view: Budget | Actual */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4 min-w-0">
        {/* BUDGET — Left */}
        <Card className="overflow-hidden min-w-0 shadow-[0_0_12px_-3px_rgba(234,179,8,0.3)] dark:shadow-[0_0_12px_-3px_rgba(234,179,8,0.2)]">
          <div className="p-3 sm:p-4 border-b border-border">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-sm sm:text-base">Budget (Orçamento)</h3>
                <p className="text-xs text-muted-foreground">Planejamento de pedidos de compra</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {canEditBudget && (
                  <Button size="sm" className="h-8 text-xs sm:text-sm" onClick={() => openCreate("budget")}>
                    <Plus className="mr-1 h-3 w-3" /> Novo
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground">
              <span>
                Total: <strong className="text-foreground">{fmtCurrency(totalBudget)}</strong>
              </span>
              <span>
                Orçamento: <strong className="text-foreground">{fmtCurrency(orcamento)}</strong>
              </span>
              <span>
                Saldo:{" "}
                <strong className={orcamento - totalBudget < 0 ? "text-destructive" : "text-foreground"}>
                  {fmtCurrency(orcamento - totalBudget)}
                </strong>
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-yellow-500 dark:bg-yellow-400 transition-all"
                style={{ width: `${Math.min(orcamento > 0 ? (totalBudget / orcamento) * 100 : 0, 100)}%` }}
              />
            </div>
          </div>
          <CardContent className="p-2 sm:p-3">{renderPedidosTable(pedidosBudget, "budget")}</CardContent>
        </Card>

        {/* ACTUAL — Right */}
        <Card className="overflow-hidden min-w-0 shadow-[0_0_12px_-3px_rgba(34,197,94,0.3)] dark:shadow-[0_0_12px_-3px_rgba(34,197,94,0.2)]">
          <div className="p-3 sm:p-4 border-b border-border">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-sm sm:text-base">Actual (Realizado)</h3>
                <p className="text-xs text-muted-foreground">Pedidos de compra em execução</p>
              </div>
              {faseAtual === "actual" && isAdmin && (
                <Button size="sm" className="h-8 text-xs sm:text-sm w-fit" onClick={() => openCreate("actual")}>
                  <Plus className="mr-1 h-3 w-3" /> Novo
                </Button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground">
              <span>
                Total: <strong className="text-foreground">{fmtCurrency(totalActual)}</strong>
              </span>
              <span>
                Orçamento: <strong className="text-foreground">{fmtCurrency(orcamento)}</strong>
              </span>
              <span>
                Saldo:{" "}
                <strong className={orcamento - totalActual < 0 ? "text-destructive" : "text-foreground"}>
                  {fmtCurrency(orcamento - totalActual)}
                </strong>
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-green-500 dark:bg-green-400 transition-all"
                style={{ width: `${Math.min(orcamento > 0 ? (totalActual / orcamento) * 100 : 0, 100)}%` }}
              />
            </div>
          </div>
          <CardContent className="p-2 sm:p-3">
            {faseAtual === "actual" ? (
              renderPedidosTable(pedidosActual, "actual")
            ) : faseAtual === "budget_em_aprovacao" ? (
              <div className="py-12 text-center text-sm italic text-muted-foreground">
                Aguardando aprovação do Budget para liberar o Actual.
              </div>
            ) : (
              <div className="py-12 text-center text-sm italic text-muted-foreground">
                O Budget precisa ser aprovado para liberar o Actual.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(v) => {
          if (!v) resetForm();
          setDialogOpen(v);
        }}
      >
        <DialogContent
          className="w-[95vw] max-w-3xl p-0 gap-0 max-h-[90vh] flex flex-col"
          onPointerDownOutside={(e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('[data-product-combobox-dropdown="true"]')) return;
            e.preventDefault();
          }}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6 border-b border-border shrink-0">
            <DialogTitle className="text-base sm:text-lg">
              {editingReq ? "Editar Pedido de Compra" : "Novo Pedido de Compra"}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Preencha os dados do pedido de compra.
              <Badge variant="outline" className="ml-2 text-xs">
                {currentFase === "budget" ? "Budget" : "Actual"}
              </Badge>
            </DialogDescription>
          </DialogHeader>

          {editingReq?.status === "enviado" && !isAdmin && (
            <div className="mx-4 mt-4 sm:mx-6 flex items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Este pedido de compra já gerou o pedido #{editingReq.numero_pedido_alvo} no ERP. Apenas administradores
              podem editar.
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-6">
            {/* Section 1: General */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dados Gerais</h3>
              <div>
                <Label className="text-xs sm:text-sm">Descrição *</Label>
                <Input
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Descrição do pedido de compra"
                  className="mt-1"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs sm:text-sm">Fornecedor</Label>
                  <Input
                    value={fornecedorSearch}
                    onChange={(e) => {
                      setFornecedorSearch(e.target.value);
                      setFornecedor(null);
                    }}
                    placeholder="Buscar por nome ou CNPJ..."
                    className="mt-1"
                  />
                  {fornecedores.length > 0 && !fornecedor && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded border bg-popover text-sm">
                      {fornecedores.map((f: any) => (
                        <div
                          key={f.codigo_entidade}
                          className="cursor-pointer px-3 py-2 hover:bg-accent"
                          onClick={() => {
                            setFornecedor({ codigo: f.codigo_entidade, nome: f.nome || "", cnpj: f.cnpj || "" });
                            setFornecedorSearch(f.nome || f.cnpj || "");
                          }}
                        >
                          <span className="font-medium">{f.nome}</span>
                          {f.cnpj && <span className="ml-2 text-xs text-muted-foreground">{f.cnpj}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {fornecedor && (
                    <p className="mt-1 text-xs text-green-600">
                      ✓ {fornecedor.nome} ({fornecedor.cnpj})
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-xs sm:text-sm">Condição de Pagamento</Label>
                  {condicoes.length > 0 ? (
                    <Select value={condPag} onValueChange={setCondPag}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {condicoes.map((c: any) => (
                          <SelectItem key={c.codigo} value={c.codigo}>
                            {c.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input disabled placeholder="Sincronize as condições em Configurações" className="mt-1" />
                  )}
                </div>
              </div>
            </div>

            {/* Section 2: Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Itens</h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() =>
                    setItens((prev) => [
                      ...prev,
                      {
                        codigoProduto: "",
                        descricao: "",
                        unidade: "UNID",
                        quantidade: 1,
                        valor_unitario: 0,
                        codigoClasFiscal: "",
                        codigoTipoProdFisc: "",
                      },
                    ])
                  }
                >
                  <Plus className="mr-1 h-3 w-3" /> Adicionar Item
                </Button>
              </div>

              <div className="space-y-3">
                {itens.map((it, idx) => (
                  <div key={idx} className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Item {idx + 1}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{fmtCurrency(it.quantidade * it.valor_unitario)}</span>
                        {itens.length > 1 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            onClick={() => setItens((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            ×
                          </Button>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Produto</Label>
                      <ProductCombobox
                        value={it.codigoProduto}
                        displayValue={it.codigoProduto ? `${it.codigoProduto} — ${it.descricao}` : ""}
                        onSelect={(p) => {
                          setItens((prev) =>
                            prev.map((x, i) =>
                              i === idx
                                ? {
                                    ...x,
                                    codigoProduto: p.codigo,
                                    descricao: p.nome,
                                    codigoClasFiscal: p.codigo_clas_fiscal || "",
                                    codigoTipoProdFisc: p.codigo_tipo_prod_fisc || "",
                                  }
                                : x,
                            ),
                          );
                        }}
                        className="mt-1"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-xs">Unidade</Label>
                        <Input
                          value={it.unidade}
                          onChange={(e) => updateItem(idx, "unidade", e.target.value)}
                          className="h-9 text-sm mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Qtd</Label>
                        <Input
                          type="number"
                          min={0}
                          value={it.quantidade}
                          onChange={(e) => updateItem(idx, "quantidade", Number(e.target.value))}
                          className="h-9 text-sm mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Vlr Unitário</Label>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={it.valor_unitario}
                          onChange={(e) => updateItem(idx, "valor_unitario", Number(e.target.value))}
                          className="h-9 text-sm mt-1"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1 text-sm">
                <span className="text-muted-foreground">Valor Total:</span>
                <strong className="text-base">{fmtCurrency(valorTotalItens)}</strong>
              </div>
            </div>

            {/* Section 3: Classification */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Classificação (Rateio)
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Distribua o valor total entre classes e centros de custo. O total deve somar 100%.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs shrink-0"
                  onClick={() =>
                    setClasseRateio((prev) => [
                      ...prev,
                      {
                        classe_codigo: "",
                        classe_nome: "",
                        centro_custo_codigo: "",
                        centro_custo_nome: "",
                        percentual: 100 - totalRateio > 0 ? Math.round(100 - totalRateio) : 0,
                      },
                    ])
                  }
                >
                  <Plus className="mr-1 h-3 w-3" /> Adicionar Classe
                </Button>
              </div>
              {classeRateio.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">Nenhuma classificação adicionada (opcional).</p>
              ) : (
                <>
                  <div className="space-y-3">
                    {classeRateio.map((c, idx) => {
                      const filteredClasses = classes.filter((cl: any) => {
                        const search = (classeSearch[idx] || "").toLowerCase();
                        if (!search) return true;
                        return cl.codigo.toLowerCase().includes(search) || cl.nome.toLowerCase().includes(search);
                      });
                      const filteredCCs = costCenters.filter((cc: any) => {
                        const search = (ccSearch[idx] || "").toLowerCase();
                        if (!search) return true;
                        return (
                          (cc.erp_code || "").toLowerCase().includes(search) || cc.name.toLowerCase().includes(search)
                        );
                      });
                      const rateioValor = (c.percentual / 100) * valorTotalItens;

                      return (
                        <div key={idx} className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">Linha {idx + 1}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                              onClick={() => setClasseRateio((prev) => prev.filter((_, i) => i !== idx))}
                            >
                              ×
                            </Button>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <Label className="text-xs">Classe Rec/Desp</Label>
                              <Select
                                value={c.classe_codigo}
                                onValueChange={(v) => {
                                  const cl = classes.find((x: any) => x.codigo === v);
                                  setClasseRateio((prev) =>
                                    prev.map((x, i) =>
                                      i === idx ? { ...x, classe_codigo: v, classe_nome: cl?.nome || "" } : x,
                                    ),
                                  );
                                }}
                              >
                                <SelectTrigger className="h-9 text-xs mt-1">
                                  <SelectValue placeholder="Selecione a classe..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <div className="px-2 pb-2">
                                    <Input
                                      placeholder="Filtrar por código ou nome..."
                                      value={classeSearch[idx] || ""}
                                      onChange={(e) => setClasseSearch((prev) => ({ ...prev, [idx]: e.target.value }))}
                                      className="h-8 text-xs"
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                  {filteredClasses.length === 0 ? (
                                    <p className="py-2 text-center text-xs text-muted-foreground">
                                      Nenhuma classe encontrada
                                    </p>
                                  ) : (
                                    filteredClasses.slice(0, 50).map((cl: any) => (
                                      <SelectItem key={cl.codigo} value={cl.codigo} className="text-xs">
                                        {cl.codigo} — {cl.nome}
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs">Centro de Custo</Label>
                              <Select
                                value={c.centro_custo_codigo}
                                onValueChange={(v) => {
                                  const cc = costCenters.find((x: any) => x.erp_code === v);
                                  setClasseRateio((prev) =>
                                    prev.map((x, i) =>
                                      i === idx
                                        ? { ...x, centro_custo_codigo: v, centro_custo_nome: cc?.name || "" }
                                        : x,
                                    ),
                                  );
                                }}
                              >
                                <SelectTrigger className="h-9 text-xs mt-1">
                                  <SelectValue placeholder="Selecione o CC..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <div className="px-2 pb-2">
                                    <Input
                                      placeholder="Filtrar por código ou nome..."
                                      value={ccSearch[idx] || ""}
                                      onChange={(e) => setCcSearch((prev) => ({ ...prev, [idx]: e.target.value }))}
                                      className="h-8 text-xs"
                                      onClick={(e) => e.stopPropagation()}
                                      onKeyDown={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                  {filteredCCs.length === 0 ? (
                                    <p className="py-2 text-center text-xs text-muted-foreground">
                                      Nenhum centro de custo encontrado
                                    </p>
                                  ) : (
                                    filteredCCs.slice(0, 50).map((cc: any) => (
                                      <SelectItem key={cc.erp_code} value={cc.erp_code || ""} className="text-xs">
                                        {cc.erp_code} — {cc.name}
                                      </SelectItem>
                                    ))
                                  )}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="flex-1">
                              <Label className="text-xs">Percentual (%)</Label>
                              <div className="flex items-center gap-3 mt-1">
                                <input
                                  type="range"
                                  min={0}
                                  max={100}
                                  value={c.percentual}
                                  onChange={(e) =>
                                    setClasseRateio((prev) =>
                                      prev.map((x, i) =>
                                        i === idx ? { ...x, percentual: Number(e.target.value) } : x,
                                      ),
                                    )
                                  }
                                  className="flex-1 h-2 accent-primary cursor-pointer"
                                />
                                <div className="flex items-center gap-1">
                                  <Input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={c.percentual}
                                    onChange={(e) =>
                                      setClasseRateio((prev) =>
                                        prev.map((x, i) =>
                                          i === idx ? { ...x, percentual: Number(e.target.value) } : x,
                                        ),
                                      )
                                    }
                                    className="h-8 w-20 text-sm text-center"
                                  />
                                  <span className="text-sm text-muted-foreground">%</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right min-w-[80px]">
                              <Label className="text-xs">Valor</Label>
                              <p className="text-sm font-semibold mt-1">{fmtCurrency(rateioValor)}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div
                    className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                      Math.abs(totalRateio - 100) <= 0.01
                        ? "bg-green-500/10 text-green-600 dark:text-green-400"
                        : "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {Math.abs(totalRateio - 100) > 0.01 && <AlertTriangle className="h-3.5 w-3.5" />}
                      <span>
                        Total do rateio: <strong>{totalRateio}%</strong>
                      </span>
                      {Math.abs(totalRateio - 100) > 0.01 && <span className="text-xs">(deve ser 100%)</span>}
                    </div>
                    <span className="font-semibold">{fmtCurrency((totalRateio / 100) * valorTotalItens)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <DialogFooter className="px-4 py-3 sm:px-6 border-t border-border shrink-0">
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                setDialogOpen(false);
              }}
              className="w-full sm:w-auto"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || (editingReq?.status === "enviado" && !isAdmin)}
              className="w-full sm:w-auto"
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingReq ? "Salvar Alterações" : "Criar Pedido de Compra"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send to Alvo confirmation */}
      <AlertDialog
        open={!!enviarTarget}
        onOpenChange={(v) => {
          if (!v) setEnviarTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar ao ERP Alvo</AlertDialogTitle>
            <AlertDialogDescription>
              Criar pedido de compra no ERP Alvo para o pedido de compra "{enviarTarget?.descricao}"? Esta ação não pode
              ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleEnviarAlvo} className="bg-blue-600 hover:bg-blue-700">
              Enviar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Pedido de Compra</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o pedido de compra "{deleteTarget?.descricao}"?
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
  );
}
