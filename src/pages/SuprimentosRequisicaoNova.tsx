import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { enviarRequisicao } from "@/services/requisicoesService";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ArrowRight, Plus, Pencil, Trash2, Package, Wrench, Check, ChevronsUpDown, ClipboardList, Calendar as CalendarIcon, Send, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { applyCnpjMask, stripCnpjMask, isValidCnpjLength } from "@/lib/cnpj";

interface StockProduct {
  codigo_produto: string;
  nome_produto: string;
  codigo_alternativo: string | null;
  unidade_medida: string | null;
  tipo_produto_fiscal: string | null;
}

interface RateioClasseItem {
  tempRateioId: string;
  codigo_classe_rec_desp: string;
  classe_rec_desp_label: string;
  percentual: number;
}

interface ItemWizard {
  tempId: string;
  item_servico: boolean;
  codigo_produto: string;
  codigo_alternativo_produto: string | null;
  codigo_prod_unid_med: string;
  produto_nome: string;
  produto_unidade: string;
  quantidade: number;
  observacao: string;
  rateio: RateioClasseItem[];
}

interface ClasseRecDesp {
  codigo: string;
  nome: string;
}

interface FuncionarioAlvo {
  codigo: string;
  nome: string;
  status: string;
  codigo_centro_ctrl: string | null;
}

const STEPS = [
  { id: 1, label: "Itens" },
  { id: 2, label: "Finalidade" },
  { id: 3, label: "Área" },
  { id: 4, label: "Revisão" },
];

const FINALIDADES_COMPRA = [
  { codigo: "0000001", label: "ESTOQUE" },
  { codigo: "0000002", label: "REVENDA" },
  { codigo: "0000003", label: "MANUTENÇÃO" },
  { codigo: "0000004", label: "MATERIAL DE ESCRITÓRIO" },
  { codigo: "0000005", label: "MATERIAL DE HIGIENE E LIMPEZA" },
  { codigo: "0000006", label: "SERVIÇO DE ANÁLISE" },
  { codigo: "0000007", label: "PRESTAÇÃO DE SERVIÇO" },
];

export default function SuprimentosRequisicaoNova() {
  const navigate = useNavigate();
  const { profile, user } = useAuth();
  const isAdmin = profile?.is_admin === true;
  const [currentStep, setCurrentStep] = useState(1);
  const [itens, setItens] = useState<ItemWizard[]>([]);

  // Modal de adicionar/editar item
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemTipo, setItemTipo] = useState<"produto" | "servico">("produto");
  const [produtoSelecionado, setProdutoSelecionado] = useState<StockProduct | null>(null);
  const [itemQtd, setItemQtd] = useState("1");
  const [itemObs, setItemObs] = useState("");
  const [produtoPopoverOpen, setProdutoPopoverOpen] = useState(false);
  const [produtoSearch, setProdutoSearch] = useState("");

  // Rateio states
  const [itemStep, setItemStep] = useState<1 | 2>(1);
  const [itemRateio, setItemRateio] = useState<RateioClasseItem[]>([]);
  const [classePopoverOpen, setClassePopoverOpen] = useState<string | null>(null);

  // Etapa 2
  const [dataNecessidade, setDataNecessidade] = useState<Date | undefined>(undefined);
  const [codigoFinalidadeCompra, setCodigoFinalidadeCompra] = useState("");
  const [descricao, setDescricao] = useState("");
  const [cnpjSugestao, setCnpjSugestao] = useState("");

  // Etapa 3
  const [codigoFuncionario, setCodigoFuncionario] = useState("");
  const [funcionarioNome, setFuncionarioNome] = useState("");
  const [codigoCentroCtrl, setCodigoCentroCtrl] = useState("");
  const [funcionarioPopoverOpen, setFuncionarioPopoverOpen] = useState(false);
  const [funcionarioSearch, setFuncionarioSearch] = useState("");

  // Etapa 4
  const [observacaoLivre, setObservacaoLivre] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Buscar produtos do cache
  const { data: produtos = [] } = useQuery({
    queryKey: ["stock_products_wizard"],
    queryFn: async (): Promise<StockProduct[]> => {
      const { data, error } = await (supabase as any)
        .from("stock_products")
        .select("codigo_produto, nome_produto, codigo_alternativo, unidade_medida, tipo_produto_fiscal")
        .eq("ativo", true)
        .order("nome_produto", { ascending: true });
      if (error) throw error;
      return (data || []) as StockProduct[];
    },
  });

  // Buscar classes rec/desp
  const { data: classes = [] } = useQuery({
    queryKey: ["classes_rec_desp_wizard"],
    queryFn: async (): Promise<ClasseRecDesp[]> => {
      const { data, error } = await (supabase as any)
        .from("classes_rec_desp")
        .select("codigo, nome")
        .eq("grupo", "F")
        .eq("natureza", "Débito")
        .eq("is_active", true)
        .order("codigo", { ascending: true });
      if (error) throw error;
      return (data || []) as ClasseRecDesp[];
    },
  });

  // Buscar funcionários (somente admin)
  const { data: funcionarios = [] } = useQuery({
    queryKey: ["funcionarios_alvo_cache_wizard"],
    queryFn: async (): Promise<FuncionarioAlvo[]> => {
      const { data, error } = await (supabase as any)
        .from("funcionarios_alvo_cache")
        .select("codigo, nome, status, codigo_centro_ctrl")
        .eq("status", "Trabalhando")
        .order("nome", { ascending: true });
      if (error) throw error;
      return (data || []) as FuncionarioAlvo[];
    },
    enabled: isAdmin,
  });

  // Auto-preenchimento do funcionário e CC ao montar
  useEffect(() => {
    const carregarFuncionarioPadrao = async () => {
      if (!profile?.id) return;
      // Buscar funcionario_alvo_codigo do profile
      const { data: profileData } = await (supabase as any)
        .from("profiles")
        .select("funcionario_alvo_codigo")
        .eq("id", profile.id)
        .maybeSingle();
      if (!profileData?.funcionario_alvo_codigo) return;

      const { data } = await (supabase as any)
        .from("funcionarios_alvo_cache")
        .select("codigo, nome, codigo_centro_ctrl")
        .eq("codigo", profileData.funcionario_alvo_codigo)
        .maybeSingle();
      if (data) {
        setCodigoFuncionario(data.codigo);
        setFuncionarioNome(data.nome);
        setCodigoCentroCtrl(data.codigo_centro_ctrl || "");
      }
    };
    carregarFuncionarioPadrao();
  }, [profile?.id]);

  const handleSelectFuncionario = (f: FuncionarioAlvo) => {
    setCodigoFuncionario(f.codigo);
    setFuncionarioNome(f.nome);
    setCodigoCentroCtrl(f.codigo_centro_ctrl || "");
    setFuncionarioPopoverOpen(false);
  };

  const getFinalidadeLabel = (codigo: string) => {
    return FINALIDADES_COMPRA.find(f => f.codigo === codigo)?.label || codigo;
  };

  const handleEnviar = async () => {
    if (!user) {
      toast({ title: "Sessão inválida", description: "Faça login novamente.", variant: "destructive" });
      return;
    }
    if (!dataNecessidade) {
      toast({ title: "Data de necessidade obrigatória", variant: "destructive" });
      return;
    }
    if (!descricao.trim()) {
      toast({ title: "Descrição obrigatória", variant: "destructive" });
      return;
    }
    if (!isValidCnpjLength(cnpjSugestao)) {
      toast({ title: "CNPJ deve ter 14 dígitos", variant: "destructive" });
      return;
    }
    if (!codigoFuncionario || !codigoCentroCtrl) {
      toast({ title: "Funcionário e Centro de Custo são obrigatórios", variant: "destructive" });
      return;
    }
    if (!codigoFinalidadeCompra) {
      toast({ title: "Finalidade de Compra obrigatória", variant: "destructive" });
      return;
    }
    if (itens.length === 0) {
      toast({ title: "Adicione ao menos um item", variant: "destructive" });
      return;
    }

    setEnviando(true);
    try {
      const result = await enviarRequisicao({
        user_id: user.id,
        requisitante_nome: profile?.full_name || user.email || "Usuário",
        codigo_funcionario: codigoFuncionario,
        funcionario_nome: funcionarioNome,
        codigo_centro_ctrl: codigoCentroCtrl,
        codigo_finalidade_compra: codigoFinalidadeCompra,
        finalidade_compra_label: getFinalidadeLabel(codigoFinalidadeCompra),
        descricao,
        cnpj_sugestao_requisicao: stripCnpjMask(cnpjSugestao) || undefined,
        data_necessidade: format(dataNecessidade, "yyyy-MM-dd"),
        observacao_livre: observacaoLivre,
        itens: itens.map((item) => ({
          item_servico: item.item_servico,
          codigo_produto: item.codigo_produto,
          codigo_alternativo_produto: item.codigo_alternativo_produto,
          codigo_prod_unid_med: item.codigo_prod_unid_med,
          produto_nome: item.produto_nome,
          produto_unidade: item.produto_unidade,
          quantidade: item.quantidade,
          observacao: item.observacao,
          rateio: item.rateio.map((r) => ({
            codigo_classe_rec_desp: r.codigo_classe_rec_desp,
            classe_rec_desp_label: r.classe_rec_desp_label,
            percentual: r.percentual,
          })),
        })),
      });

      if (result.sucesso) {
        toast({
          title: "Requisição enviada com sucesso!",
          description: result.numero_alvo
            ? `Número no ERP: ${result.numero_alvo}`
            : "Requisição sincronizada com o ERP.",
        });
        navigate("/suprimentos/requisicoes");
      } else {
        toast({
          title: "Falha ao enviar ao ERP",
          description: `A requisição foi salva como rascunho. Erro: ${result.erro}`,
          variant: "destructive",
        });
      }
    } catch (err: any) {
      toast({
        title: "Erro inesperado",
        description: err?.message || "Não foi possível enviar a requisição.",
        variant: "destructive",
      });
    } finally {
      setEnviando(false);
    }
  };
  const produtosFiltrados = useMemo(() => {
    const q = produtoSearch.trim().toLowerCase();
    return produtos.filter(p => {
      const isServico = p.tipo_produto_fiscal === "09";
      if (itemTipo === "servico" && !isServico) return false;
      if (itemTipo === "produto" && isServico) return false;
      if (!q) return true;
      return (
        p.nome_produto.toLowerCase().includes(q) ||
        p.codigo_produto.toLowerCase().includes(q) ||
        (p.codigo_alternativo || "").toLowerCase().includes(q)
      );
    }).slice(0, 100);
  }, [produtos, itemTipo, produtoSearch]);

  const resetItemForm = () => {
    setEditingItemId(null);
    setItemTipo("produto");
    setProdutoSelecionado(null);
    setItemQtd("1");
    setItemObs("");
    setProdutoSearch("");
    setItemStep(1);
    setItemRateio([]);
    setClassePopoverOpen(null);
  };

  const openNewItemDialog = () => {
    resetItemForm();
    setItemRateio([
      {
        tempRateioId: `rat-${Date.now()}`,
        codigo_classe_rec_desp: "",
        classe_rec_desp_label: "",
        percentual: 100,
      },
    ]);
    setItemDialogOpen(true);
  };

  const openEditItemDialog = (item: ItemWizard) => {
    setEditingItemId(item.tempId);
    setItemTipo(item.item_servico ? "servico" : "produto");
    setProdutoSelecionado({
      codigo_produto: item.codigo_produto,
      nome_produto: item.produto_nome,
      codigo_alternativo: item.codigo_alternativo_produto,
      unidade_medida: item.produto_unidade,
      tipo_produto_fiscal: item.item_servico ? "09" : null,
    });
    setItemQtd(String(item.quantidade));
    setItemObs(item.observacao || "");
    setItemRateio(item.rateio || []);
    setItemStep(1);
    setItemDialogOpen(true);
  };

  const handleNextToRateio = () => {
    if (!produtoSelecionado) {
      toast({ title: "Selecione um produto ou serviço", variant: "destructive" });
      return;
    }
    const qtdNum = parseFloat(itemQtd.replace(",", "."));
    if (!qtdNum || qtdNum <= 0) {
      toast({ title: "Quantidade deve ser maior que zero", variant: "destructive" });
      return;
    }
    setItemStep(2);
  };

  const handleSaveItem = () => {
    if (itemRateio.length === 0) {
      toast({ title: "Adicione ao menos uma classe ao rateio", variant: "destructive" });
      return;
    }
    if (itemRateio.some(r => !r.codigo_classe_rec_desp)) {
      toast({ title: "Todas as linhas do rateio precisam ter uma classe selecionada", variant: "destructive" });
      return;
    }
    const soma = itemRateio.reduce((s, r) => s + r.percentual, 0);
    if (Math.abs(soma - 100) > 0.01) {
      toast({ title: `A soma dos percentuais deve ser 100% (atual: ${soma.toFixed(2)}%)`, variant: "destructive" });
      return;
    }

    const qtdNum = parseFloat(itemQtd.replace(",", "."));
    const novoItem: ItemWizard = {
      tempId: editingItemId || `tmp-${Date.now()}-${Math.random()}`,
      item_servico: itemTipo === "servico",
      codigo_produto: produtoSelecionado!.codigo_produto,
      codigo_alternativo_produto: produtoSelecionado!.codigo_alternativo,
      codigo_prod_unid_med: produtoSelecionado!.unidade_medida || "UNID",
      produto_nome: produtoSelecionado!.nome_produto,
      produto_unidade: produtoSelecionado!.unidade_medida || "UNID",
      quantidade: qtdNum,
      observacao: itemObs.trim(),
      rateio: itemRateio,
    };

    if (editingItemId) {
      setItens(prev => prev.map(i => i.tempId === editingItemId ? novoItem : i));
    } else {
      setItens(prev => [...prev, novoItem]);
    }
    setItemDialogOpen(false);
    resetItemForm();
  };

  const handleRemoveItem = (tempId: string) => {
    setItens(prev => prev.filter(i => i.tempId !== tempId));
  };

  const addRateioLinha = () => {
    setItemRateio(prev => [...prev, {
      tempRateioId: `rat-${Date.now()}-${Math.random()}`,
      codigo_classe_rec_desp: "",
      classe_rec_desp_label: "",
      percentual: 0,
    }]);
  };

  const removeRateioLinha = (tempRateioId: string) => {
    setItemRateio(prev => prev.filter(r => r.tempRateioId !== tempRateioId));
  };

  const updateRateioLinha = (tempRateioId: string, patch: Partial<RateioClasseItem>) => {
    setItemRateio(prev => prev.map(r => r.tempRateioId === tempRateioId ? { ...r, ...patch } : r));
  };

  const dividirIgualmente = () => {
    if (itemRateio.length === 0) return;
    const n = itemRateio.length;
    const base = Math.floor((100 / n) * 100) / 100;
    const resto = Math.round((100 - base * n) * 100) / 100;
    setItemRateio(prev => prev.map((r, idx) => ({
      ...r,
      percentual: idx === n - 1 ? Math.round((base + resto) * 100) / 100 : base,
    })));
  };

  const somaRateio = useMemo(() => itemRateio.reduce((s, r) => s + r.percentual, 0), [itemRateio]);

  const canAdvance = (() => {
    if (currentStep === 1) return itens.length > 0;
    if (currentStep === 2) return !!dataNecessidade && !!codigoFinalidadeCompra && !!descricao.trim() && isValidCnpjLength(cnpjSugestao);
    if (currentStep === 3) return !!codigoFuncionario && !!codigoCentroCtrl;
    return true;
  })();

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/suprimentos/requisicoes")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Nova Requisição de Compra</h1>
          <p className="text-sm text-muted-foreground">Siga as etapas para criar sua requisição.</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {STEPS.map((step, idx) => (
          <div key={step.id} className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${currentStep === step.id ? "bg-primary text-primary-foreground" : currentStep > step.id ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
              {currentStep > step.id ? <Check className="h-4 w-4" /> : step.id}
            </div>
            <span className={`text-sm hidden sm:inline ${currentStep === step.id ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{step.label}</span>
            {idx < STEPS.length - 1 && <div className={`h-px w-6 sm:w-10 ${currentStep > step.id ? "bg-emerald-500" : "bg-muted"}`} />}
          </div>
        ))}
      </div>

      {/* Etapa 1: Itens */}
      {currentStep === 1 && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">O que você precisa?</h2>
                  <p className="text-sm text-muted-foreground">Adicione os produtos ou serviços que você quer solicitar.</p>
                </div>
                <Button size="sm" onClick={openNewItemDialog}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar item
                </Button>
              </div>

              {itens.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <ClipboardList className="h-12 w-12 mb-2 opacity-40" />
                  <p className="text-sm">Nenhum item adicionado ainda.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {itens.map(item => (
                    <div key={item.tempId} className="flex items-start gap-3 rounded-lg border p-3">
                      <div className="mt-0.5 rounded-md bg-muted p-2">
                        {item.item_servico ? <Wrench className="h-4 w-4 text-muted-foreground" /> : <Package className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm text-foreground truncate">{item.produto_nome}</p>
                          <Badge variant="outline" className="text-[10px] shrink-0">{item.item_servico ? "Serviço" : "Produto"}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{item.quantidade} {item.produto_unidade} · {item.codigo_produto}</p>
                        {item.observacao && <p className="text-xs text-muted-foreground italic mt-1">"{item.observacao}"</p>}
                        {item.rateio.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {item.rateio.map(r => (
                              <Badge key={r.tempRateioId} variant="secondary" className="text-[10px] font-normal">
                                {r.codigo_classe_rec_desp} ({r.percentual}%)
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => openEditItemDialog(item)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive" onClick={() => handleRemoveItem(item.tempId)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Etapa 2: Finalidade */}
      {currentStep === 2 && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Quando e para qual finalidade?</h2>
              <p className="text-sm text-muted-foreground">Defina o prazo e o tipo de compra.</p>
            </div>

            <div className="space-y-2">
              <Label>Data de Necessidade *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !dataNecessidade && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dataNecessidade ? format(dataNecessidade, "dd/MM/yyyy", { locale: ptBR }) : "Selecione a data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dataNecessidade}
                    onSelect={setDataNecessidade}
                    disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">Quando você precisa receber este pedido?</p>
            </div>

            <div className="space-y-2">
              <Label>Finalidade de Compra *</Label>
              <Select value={codigoFinalidadeCompra} onValueChange={setCodigoFinalidadeCompra}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a finalidade" />
                </SelectTrigger>
                <SelectContent>
                  {FINALIDADES_COMPRA.map(f => (
                    <SelectItem key={f.codigo} value={f.codigo}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Descrição *</Label>
              <Textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Ex: Compra mensal de material de escritório" />
            </div>

            <div className="space-y-2">
              <Label>CNPJ de referência (opcional)</Label>
              <Input
                type="text"
                placeholder="00.000.000/0000-00"
                maxLength={18}
                value={cnpjSugestao}
                onChange={e => setCnpjSugestao(applyCnpjMask(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">CNPJ do fornecedor sugerido, se aplicável. Serve apenas como orientação.</p>
              {cnpjSugestao && !isValidCnpjLength(cnpjSugestao) && (
                <p className="text-xs text-destructive">CNPJ deve ter 14 dígitos</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Etapa 3: Área */}
      {currentStep === 3 && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Para qual área?</h2>
              <p className="text-sm text-muted-foreground">Funcionário responsável e centro de custo.</p>
            </div>

            <div className="space-y-2">
              <Label>Funcionário *</Label>
              {isAdmin ? (
                <Popover open={funcionarioPopoverOpen} onOpenChange={setFuncionarioPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                      {funcionarioNome ? `${funcionarioNome} (${codigoFuncionario})` : "Selecione um funcionário"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput placeholder="Buscar funcionário..." value={funcionarioSearch} onValueChange={setFuncionarioSearch} />
                      <CommandList>
                        <CommandEmpty>Nenhum funcionário encontrado.</CommandEmpty>
                        <CommandGroup>
                          {funcionarios.filter(f => {
                            const q = funcionarioSearch.trim().toLowerCase();
                            if (!q) return true;
                            return f.nome.toLowerCase().includes(q) || f.codigo.includes(q);
                          }).slice(0, 50).map(f => (
                            <CommandItem key={f.codigo} value={f.codigo} onSelect={() => handleSelectFuncionario(f)}>
                              <div className="flex flex-col">
                                <span className="font-medium">{f.nome}</span>
                                <span className="text-xs text-muted-foreground">{f.codigo}</span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              ) : (
                <div className="rounded-md border bg-muted/30 px-3 py-2.5">
                  {funcionarioNome ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground">{funcionarioNome} ({codigoFuncionario})</span>
                      <Badge variant="secondary" className="text-[10px]">automático</Badge>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Nenhum funcionário vinculado ao seu usuário. Contate o administrador.</span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Centro de Custo *</Label>
              <div className="rounded-md border bg-muted/30 px-3 py-2.5">
                {codigoCentroCtrl ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground">{codigoCentroCtrl}</span>
                    <Badge variant="secondary" className="text-[10px]">automático do funcionário</Badge>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Funcionário não tem CC cadastrado.</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Etapa 4 placeholder */}
      {currentStep === 4 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Revisão e envio</h2>
            <p className="text-sm text-muted-foreground">
              Confira todas as informações antes de enviar sua requisição.
            </p>
          </div>

          {/* Card 1 — Itens */}
          <Card>
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Itens ({itens.length})</h3>
                <Button variant="ghost" size="sm" onClick={() => setCurrentStep(1)}>
                  Editar
                </Button>
              </div>
              <div className="space-y-2">
                {itens.map((item) => (
                  <div key={item.tempId} className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.produto_nome}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {item.item_servico ? "Serviço" : "Produto"}
                          </Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {item.quantidade} {item.produto_unidade} · {item.codigo_produto}
                        </div>
                        {item.observacao && (
                          <div className="mt-1 text-xs italic text-muted-foreground">
                            "{item.observacao}"
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {item.rateio.map((r) => (
                            <Badge key={r.tempRateioId} variant="secondary" className="text-[10px]">
                              {r.codigo_classe_rec_desp} ({r.percentual}%)
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Card 2 — Detalhes */}
          <Card>
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Detalhes</h3>
                <Button variant="ghost" size="sm" onClick={() => setCurrentStep(2)}>
                  Editar
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                <div>
                  <div className="text-xs text-muted-foreground">Data de necessidade</div>
                  <div className="font-medium">
                    {dataNecessidade ? format(dataNecessidade, "dd/MM/yyyy", { locale: ptBR }) : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Finalidade</div>
                  <div className="font-medium">{getFinalidadeLabel(codigoFinalidadeCompra)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Descrição</div>
                  <div className="font-medium">{descricao || "—"}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 3 — Área */}
          <Card>
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Área</h3>
                <Button variant="ghost" size="sm" onClick={() => setCurrentStep(3)}>
                  Editar
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">Funcionário</div>
                  <div className="font-medium">
                    {funcionarioNome}{" "}
                    <span className="text-xs text-muted-foreground">({codigoFuncionario})</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Centro de Custo</div>
                  <div className="font-mono text-xs font-medium">{codigoCentroCtrl}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 4 — Observação livre */}
          <Card>
            <CardContent className="space-y-3 p-6">
              <div>
                <h3 className="font-semibold">Observação adicional (opcional)</h3>
                <p className="text-xs text-muted-foreground">
                  Informação extra que será enviada junto ao ERP.
                </p>
              </div>
              <Textarea
                value={observacaoLivre}
                onChange={(e) => setObservacaoLivre(e.target.value)}
                placeholder="Ex: urgência, justificativa, link de referência..."
                rows={3}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-between">
        {currentStep === 1 ? (
          <Button variant="outline" onClick={() => navigate("/suprimentos/requisicoes")}>
            Cancelar
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setCurrentStep((s) => s - 1)} disabled={enviando}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
        )}
        {currentStep < 4 ? (
          <Button onClick={() => setCurrentStep((s) => s + 1)} disabled={!canAdvance}>
            Próximo <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleEnviar} disabled={enviando}>
            {enviando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                Enviar Requisição <Send className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        )}
      </div>

      {/* Modal de Item */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>
              {editingItemId ? "Editar item" : "Adicionar item"}
              {itemStep === 2 && " — Rateio de classes"}
            </DialogTitle>
          </DialogHeader>

          {itemStep === 1 && (
            <div className="space-y-4 py-2">
              <Tabs value={itemTipo} onValueChange={(v) => { setItemTipo(v as any); setProdutoSelecionado(null); }}>
                <TabsList className="w-full">
                  <TabsTrigger value="produto" className="flex-1"><Package className="h-4 w-4 mr-1" /> Produto</TabsTrigger>
                  <TabsTrigger value="servico" className="flex-1"><Wrench className="h-4 w-4 mr-1" /> Serviço</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="space-y-2">
                <Label>{itemTipo === "servico" ? "Serviço" : "Produto"}</Label>
                <Popover open={produtoPopoverOpen} onOpenChange={setProdutoPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                      {produtoSelecionado ? `${produtoSelecionado.nome_produto} (${produtoSelecionado.codigo_produto})` : `Buscar ${itemTipo === "servico" ? "serviço" : "produto"}...`}
                      <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput placeholder="Digite para buscar..." value={produtoSearch} onValueChange={setProdutoSearch} />
                      <CommandList>
                        <CommandEmpty>Nenhum resultado.</CommandEmpty>
                        <CommandGroup>
                          {produtosFiltrados.map(p => (
                            <CommandItem key={p.codigo_produto} value={p.codigo_produto} onSelect={() => { setProdutoSelecionado(p); setProdutoPopoverOpen(false); }}>
                              <div className="flex flex-col">
                                <span className="font-medium">{p.nome_produto}</span>
                                <span className="text-xs text-muted-foreground">
                                  {p.codigo_produto}{p.unidade_medida ? ` · ${p.unidade_medida}` : ""}
                                </span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Quantidade</Label>
                <Input type="text" inputMode="decimal" value={itemQtd} onChange={e => setItemQtd(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label>Observação (opcional)</Label>
                <Textarea value={itemObs} onChange={e => setItemObs(e.target.value)} placeholder="Ex: link do produto, fornecedor preferido, urgência..." />
              </div>
            </div>
          )}

          {itemStep === 2 && (
            <div className="space-y-4 py-2">
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                Defina como o custo deste item será rateado entre classes contábeis.
                A soma deve totalizar 100%.
              </div>
              <div className="space-y-2">
                {itemRateio.map((r) => {
                  const classe = classes.find(c => c.codigo === r.codigo_classe_rec_desp);
                  return (
                    <div key={r.tempRateioId} className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <Popover
                          open={classePopoverOpen === r.tempRateioId}
                          onOpenChange={(v) => setClassePopoverOpen(v ? r.tempRateioId : null)}
                        >
                          <PopoverTrigger asChild>
                            <Button variant="outline" role="combobox" className="w-full justify-between font-normal text-xs h-9">
                              <span className="truncate">
                                {classe ? `${classe.codigo} — ${classe.nome}` : "Selecione uma classe..."}
                              </span>
                              <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50 shrink-0" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[400px] p-0" align="start">
                            <Command>
                              <CommandInput placeholder="Buscar classe..." />
                              <CommandList>
                                <CommandEmpty>Nenhuma classe encontrada.</CommandEmpty>
                                <CommandGroup>
                                  {classes.map(c => (
                                    <CommandItem
                                      key={c.codigo}
                                      value={`${c.codigo} ${c.nome}`}
                                      onSelect={() => {
                                        updateRateioLinha(r.tempRateioId, {
                                          codigo_classe_rec_desp: c.codigo,
                                          classe_rec_desp_label: c.nome,
                                        });
                                        setClassePopoverOpen(null);
                                      }}
                                    >
                                      <div className="flex flex-col">
                                        <span className="font-mono text-xs">{c.codigo}</span>
                                        <span className="text-xs">{c.nome}</span>
                                      </div>
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={r.percentual}
                        onChange={(e) => updateRateioLinha(r.tempRateioId, { percentual: parseFloat(e.target.value) || 0 })}
                        className="w-20 h-9 text-right text-xs"
                        placeholder="%"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        onClick={() => removeRateioLinha(r.tempRateioId)}
                        disabled={itemRateio.length === 1}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={addRateioLinha} className="gap-1.5 text-xs">
                  <Plus className="h-3 w-3" /> Adicionar classe
                </Button>
                <Button variant="outline" size="sm" onClick={dividirIgualmente} className="gap-1.5 text-xs" disabled={itemRateio.length < 2}>
                  Dividir igualmente
                </Button>
                <div className={`ml-auto text-sm font-semibold ${Math.abs(somaRateio - 100) <= 0.01 ? "text-emerald-600" : "text-destructive"}`}>
                  Total: {somaRateio.toFixed(2)}%
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {itemStep === 1 ? (
              <>
                <Button variant="outline" onClick={() => setItemDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleNextToRateio}>Próximo <ArrowRight className="ml-2 h-4 w-4" /></Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setItemStep(1)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
                </Button>
                <Button onClick={handleSaveItem}>{editingItemId ? "Salvar" : "Adicionar"}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
