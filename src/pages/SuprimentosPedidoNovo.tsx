import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  enviarPedido,
  clonarDeRequisicao,
  type NovoPedidoInput,
  type ItemPedidoInput,
  type RateioClasseInput,
  type RateioCcInput,
} from "@/services/pedidosService";
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
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Pencil,
  Trash2,
  Package,
  Wrench,
  Check,
  ChevronsUpDown,
  ClipboardList,
  Loader2,
  X,
  Construction,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ════════════════════════════════════════════════════════════
// TIPOS LOCAIS (estado do wizard)
// ════════════════════════════════════════════════════════════

interface StockProduct {
  codigo_produto: string;
  nome_produto: string;
  codigo_alternativo: string | null;
  unidade_medida: string | null;
  tipo_produto_fiscal: string | null;
}

interface ClasseRecDesp {
  codigo: string;
  nome: string;
}

interface CostCenter {
  erp_code: string;
  name: string;
  department_type: string | null;
}

interface RateioCcWizard {
  tempCcId: string;
  codigo_centro_ctrl: string;
  centro_ctrl_label?: string;
  percentual: number; // % DENTRO da classe (soma=100% por classe)
}

interface RateioClasseWizard {
  tempClasseId: string;
  codigo_classe_rec_desp: string;
  classe_rec_desp_label: string;
  percentual: number; // % do valor TOTAL do item (soma=100% entre classes)
  ccs: RateioCcWizard[];
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
  valor_unitario: number;
  observacao: string;
  rateio: RateioClasseWizard[]; // hierarquia: classes → ccs
}

// ════════════════════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════════════════════

const STEPS = [
  { id: 1, label: "Itens" },
  { id: 2, label: "Fornecedor" },
  { id: 3, label: "Datas" },
  { id: 4, label: "Parcelas" },
  { id: 5, label: "Revisão" },
];

// ════════════════════════════════════════════════════════════
// FORMATADORES
// ════════════════════════════════════════════════════════════

function formatBRL(valor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);
}

function parseDecimal(s: string): number {
  // Aceita "1234,56" ou "1234.56"
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════

export default function SuprimentosPedidoNovo() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reqIdFromQuery = searchParams.get("reqId");
  const { profile, user } = useAuth();

  // ── Estado do wizard ─────────────────────────────────────
  const [currentStep, setCurrentStep] = useState(1);
  const [itens, setItens] = useState<ItemWizard[]>([]);

  // Origem (caminho 1a — vindo de requisição)
  const [origemReqId, setOrigemReqId] = useState<string | undefined>(undefined);
  const [origemNumeroReqAlvo, setOrigemNumeroReqAlvo] = useState<string | undefined>(undefined);
  const [origemCodigoEmpresaFilial, setOrigemCodigoEmpresaFilial] = useState<string | undefined>(undefined);
  const [cnpjSugeridoDaReq, setCnpjSugeridoDaReq] = useState<string | null>(null);
  const [carregandoClone, setCarregandoClone] = useState(!!reqIdFromQuery);

  // Submit
  const [enviando, setEnviando] = useState(false);

  // ── Modal de item ────────────────────────────────────────
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemTipo, setItemTipo] = useState<"produto" | "servico">("produto");
  const [produtoSelecionado, setProdutoSelecionado] = useState<StockProduct | null>(null);
  const [itemQtd, setItemQtd] = useState("1");
  const [itemValorUnit, setItemValorUnit] = useState("0");
  const [itemObs, setItemObs] = useState("");
  const [produtoPopoverOpen, setProdutoPopoverOpen] = useState(false);
  const [produtoSearch, setProdutoSearch] = useState("");

  // Etapas do modal de item
  const [itemStep, setItemStep] = useState<1 | 2>(1);
  const [itemRateio, setItemRateio] = useState<RateioClasseWizard[]>([]);

  // Popovers de classes e CCs dentro do rateio
  const [classePopoverOpen, setClassePopoverOpen] = useState<string | null>(null);
  const [ccPopoverOpen, setCcPopoverOpen] = useState<string | null>(null);

  // ════════════════════════════════════════════════════════
  // QUERIES (caches do Supabase)
  // ════════════════════════════════════════════════════════

  const { data: produtos = [] } = useQuery({
    queryKey: ["stock_products_pedido_wizard"],
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

  const { data: classes = [] } = useQuery({
    queryKey: ["classes_rec_desp_pedido_wizard"],
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

  const { data: costCenters = [] } = useQuery({
    queryKey: ["cost_centers_pedido_wizard"],
    queryFn: async (): Promise<CostCenter[]> => {
      const { data, error } = await (supabase as any)
        .from("cost_centers")
        .select("erp_code, name, department_type")
        .eq("is_active", true)
        .eq("group_type", "F")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as CostCenter[];
    },
  });

  // ════════════════════════════════════════════════════════
  // CLONE DE REQUISIÇÃO (caminho 1a)
  // ════════════════════════════════════════════════════════

  useEffect(() => {
    if (!reqIdFromQuery) return;
    const carregar = async () => {
      setCarregandoClone(true);
      try {
        const cloneResult = await clonarDeRequisicao(reqIdFromQuery);

        setOrigemReqId(cloneResult.origem_requisicao_id);
        setOrigemNumeroReqAlvo(cloneResult.origem_numero_req_alvo);
        setOrigemCodigoEmpresaFilial(cloneResult.origem_codigo_empresa_filial);
        setCnpjSugeridoDaReq(cloneResult.cnpj_sugerido);

        const itensClonados: ItemWizard[] = cloneResult.itens_clonados.map((ic, idx) => {
          // rateio_sugerido já vem hierárquico do service:
          // [{ codigo_classe_rec_desp, percentual, ccs: [{ codigo_centro_ctrl, percentual }] }]
          // Só precisamos adicionar os tempIds pra controle do estado React.
          const rateioComIds: RateioClasseWizard[] = ic.rateio_sugerido.map((cls, clsIdx) => ({
            tempClasseId: `cls-${Date.now()}-${Math.random()}-${idx}-${clsIdx}`,
            codigo_classe_rec_desp: cls.codigo_classe_rec_desp,
            classe_rec_desp_label: cls.classe_rec_desp_label,
            percentual: cls.percentual,
            ccs: cls.ccs.map((cc, ccIdx) => ({
              tempCcId: `cc-${Date.now()}-${Math.random()}-${idx}-${clsIdx}-${ccIdx}`,
              codigo_centro_ctrl: cc.codigo_centro_ctrl,
              centro_ctrl_label: cc.centro_ctrl_label,
              percentual: cc.percentual,
            })),
          }));

          return {
            tempId: `tmp-${Date.now()}-${Math.random()}-${idx}`,
            item_servico: ic.item_servico,
            codigo_produto: ic.codigo_produto,
            codigo_alternativo_produto: ic.codigo_alternativo_produto,
            codigo_prod_unid_med: ic.codigo_prod_unid_med,
            produto_nome: ic.produto_nome,
            produto_unidade: ic.produto_unidade,
            quantidade: ic.quantidade,
            valor_unitario: 0, // ⚠️ valor unitário precisa ser preenchido pelo analista
            observacao: ic.observacao,
            rateio: rateioComIds,
          };
        });

        setItens(itensClonados);
        toast({
          title: `Pedido clonado da Req ${cloneResult.origem_numero_req_alvo}`,
          description: "Revise os itens e preencha os valores unitários antes de continuar.",
        });
      } catch (err: any) {
        toast({
          title: "Erro ao clonar requisição",
          description: err?.message || "Não foi possível carregar a requisição de origem.",
          variant: "destructive",
        });
        navigate("/suprimentos/pedidos");
      } finally {
        setCarregandoClone(false);
      }
    };
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqIdFromQuery]);

  // ════════════════════════════════════════════════════════
  // CÁLCULOS DERIVADOS
  // ════════════════════════════════════════════════════════

  const valorTotalPedido = useMemo(() => {
    return round2(itens.reduce((acc, it) => acc + it.quantidade * it.valor_unitario, 0));
  }, [itens]);

  // ════════════════════════════════════════════════════════
  // MODAL DE ITEM — Handlers
  // ════════════════════════════════════════════════════════

  const resetItemForm = () => {
    setEditingItemId(null);
    setItemTipo("produto");
    setProdutoSelecionado(null);
    setItemQtd("1");
    setItemValorUnit("0");
    setItemObs("");
    setProdutoSearch("");
    setItemStep(1);
    setItemRateio([]);
    setClassePopoverOpen(null);
    setCcPopoverOpen(null);
  };

  const openNewItemDialog = () => {
    resetItemForm();
    setItemRateio([
      {
        tempClasseId: `cls-${Date.now()}`,
        codigo_classe_rec_desp: "",
        classe_rec_desp_label: "",
        percentual: 100,
        ccs: [
          {
            tempCcId: `cc-${Date.now()}`,
            codigo_centro_ctrl: "",
            centro_ctrl_label: undefined,
            percentual: 100,
          },
        ],
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
    setItemValorUnit(String(item.valor_unitario));
    setItemObs(item.observacao || "");
    setItemRateio(item.rateio);
    setItemStep(1);
    setItemDialogOpen(true);
  };

  const handleNextToRateio = () => {
    if (!produtoSelecionado) {
      toast({ title: "Selecione um produto ou serviço", variant: "destructive" });
      return;
    }
    const qtdNum = parseDecimal(itemQtd);
    if (!qtdNum || qtdNum <= 0) {
      toast({ title: "Quantidade deve ser maior que zero", variant: "destructive" });
      return;
    }
    const valorNum = parseDecimal(itemValorUnit);
    if (valorNum < 0) {
      toast({ title: "Valor unitário não pode ser negativo", variant: "destructive" });
      return;
    }
    setItemStep(2);
  };

  const validarRateio = (): { ok: boolean; erro?: string } => {
    if (itemRateio.length === 0) {
      return { ok: false, erro: "Adicione ao menos uma classe ao rateio" };
    }
    if (itemRateio.some((c) => !c.codigo_classe_rec_desp)) {
      return { ok: false, erro: "Todas as classes precisam ser preenchidas" };
    }
    if (itemRateio.some((c) => c.percentual <= 0)) {
      return {
        ok: false,
        erro: "Toda classe precisa ter percentual maior que zero. Remova classes não usadas.",
      };
    }
    const somaClasses = itemRateio.reduce((s, c) => s + c.percentual, 0);
    if (Math.abs(somaClasses - 100) > 0.01) {
      return { ok: false, erro: `Soma das classes = ${somaClasses.toFixed(2)}% (deve ser 100%)` };
    }
    for (const c of itemRateio) {
      if (c.ccs.length === 0) {
        return { ok: false, erro: `Classe ${c.codigo_classe_rec_desp} sem Centro de Custo` };
      }
      if (c.ccs.some((cc) => !cc.codigo_centro_ctrl)) {
        return { ok: false, erro: `Classe ${c.codigo_classe_rec_desp}: todos os CCs precisam ser selecionados` };
      }
      if (c.ccs.some((cc) => cc.percentual <= 0)) {
        return {
          ok: false,
          erro: `Classe ${c.codigo_classe_rec_desp}: todo CC precisa ter percentual maior que zero. Remova CCs não usados.`,
        };
      }
      const somaCcs = c.ccs.reduce((s, cc) => s + cc.percentual, 0);
      if (Math.abs(somaCcs - 100) > 0.01) {
        return {
          ok: false,
          erro: `Classe ${c.codigo_classe_rec_desp}: soma dos CCs = ${somaCcs.toFixed(2)}% (deve ser 100%)`,
        };
      }
    }
    return { ok: true };
  };

  const handleSaveItem = () => {
    const val = validarRateio();
    if (!val.ok) {
      toast({ title: "Rateio inválido", description: val.erro, variant: "destructive" });
      return;
    }

    const qtdNum = parseDecimal(itemQtd);
    const valorNum = parseDecimal(itemValorUnit);

    const novoItem: ItemWizard = {
      tempId: editingItemId || `tmp-${Date.now()}-${Math.random()}`,
      item_servico: itemTipo === "servico",
      codigo_produto: produtoSelecionado!.codigo_produto,
      codigo_alternativo_produto: produtoSelecionado!.codigo_alternativo,
      codigo_prod_unid_med: produtoSelecionado!.unidade_medida || "UNID",
      produto_nome: produtoSelecionado!.nome_produto,
      produto_unidade: produtoSelecionado!.unidade_medida || "UNID",
      quantidade: qtdNum,
      valor_unitario: valorNum,
      observacao: itemObs.trim(),
      rateio: itemRateio,
    };

    if (editingItemId) {
      setItens((prev) => prev.map((i) => (i.tempId === editingItemId ? novoItem : i)));
    } else {
      setItens((prev) => [...prev, novoItem]);
    }
    setItemDialogOpen(false);
    resetItemForm();
  };

  const handleRemoveItem = (tempId: string) => {
    setItens((prev) => prev.filter((i) => i.tempId !== tempId));
  };

  // ── Handlers do rateio Classe ──────────────────────────

  const addClasseLinha = () => {
    setItemRateio((prev) => [
      ...prev,
      {
        tempClasseId: `cls-${Date.now()}-${Math.random()}`,
        codigo_classe_rec_desp: "",
        classe_rec_desp_label: "",
        percentual: 0,
        ccs: [
          {
            tempCcId: `cc-${Date.now()}-${Math.random()}`,
            codigo_centro_ctrl: "",
            centro_ctrl_label: undefined,
            percentual: 100,
          },
        ],
      },
    ]);
  };

  const removeClasseLinha = (tempClasseId: string) => {
    setItemRateio((prev) => prev.filter((c) => c.tempClasseId !== tempClasseId));
  };

  const updateClasse = (tempClasseId: string, patch: Partial<RateioClasseWizard>) => {
    setItemRateio((prev) => prev.map((c) => (c.tempClasseId === tempClasseId ? { ...c, ...patch } : c)));
  };

  const dividirClassesIgualmente = () => {
    if (itemRateio.length === 0) return;
    const n = itemRateio.length;
    const base = Math.floor((100 / n) * 100) / 100;
    const ult = round2(100 - base * (n - 1));
    setItemRateio((prev) =>
      prev.map((c, idx) => ({
        ...c,
        percentual: idx === n - 1 ? ult : base,
      })),
    );
  };

  // ── Handlers dos CCs dentro de uma classe ──────────────

  const addCcLinha = (tempClasseId: string) => {
    setItemRateio((prev) =>
      prev.map((c) =>
        c.tempClasseId === tempClasseId
          ? {
              ...c,
              ccs: [
                ...c.ccs,
                {
                  tempCcId: `cc-${Date.now()}-${Math.random()}`,
                  codigo_centro_ctrl: "",
                  centro_ctrl_label: undefined,
                  percentual: 0,
                },
              ],
            }
          : c,
      ),
    );
  };

  const removeCcLinha = (tempClasseId: string, tempCcId: string) => {
    setItemRateio((prev) =>
      prev.map((c) =>
        c.tempClasseId === tempClasseId ? { ...c, ccs: c.ccs.filter((cc) => cc.tempCcId !== tempCcId) } : c,
      ),
    );
  };

  const updateCc = (tempClasseId: string, tempCcId: string, patch: Partial<RateioCcWizard>) => {
    setItemRateio((prev) =>
      prev.map((c) =>
        c.tempClasseId === tempClasseId
          ? {
              ...c,
              ccs: c.ccs.map((cc) => (cc.tempCcId === tempCcId ? { ...cc, ...patch } : cc)),
            }
          : c,
      ),
    );
  };

  const dividirCcsIgualmente = (tempClasseId: string) => {
    setItemRateio((prev) =>
      prev.map((c) => {
        if (c.tempClasseId !== tempClasseId) return c;
        const n = c.ccs.length;
        if (n === 0) return c;
        const base = Math.floor((100 / n) * 100) / 100;
        const ult = round2(100 - base * (n - 1));
        return {
          ...c,
          ccs: c.ccs.map((cc, idx) => ({
            ...cc,
            percentual: idx === n - 1 ? ult : base,
          })),
        };
      }),
    );
  };

  // ════════════════════════════════════════════════════════
  // FILTROS DE COMBOBOX
  // ════════════════════════════════════════════════════════

  const produtosFiltrados = useMemo(() => {
    const q = produtoSearch.trim().toLowerCase();
    return produtos
      .filter((p) => {
        const isServico = p.tipo_produto_fiscal === "09";
        if (itemTipo === "servico" && !isServico) return false;
        if (itemTipo === "produto" && isServico) return false;
        if (!q) return true;
        return (
          p.nome_produto.toLowerCase().includes(q) ||
          p.codigo_produto.toLowerCase().includes(q) ||
          (p.codigo_alternativo || "").toLowerCase().includes(q)
        );
      })
      .slice(0, 100);
  }, [produtos, itemTipo, produtoSearch]);

  // ════════════════════════════════════════════════════════
  // RENDER — Stepper + Etapas
  // ════════════════════════════════════════════════════════

  // Pode avançar Etapa 1?
  const canAdvanceFromEtapa1 = itens.length > 0;

  const valorTotalItemModal = useMemo(() => {
    const q = parseDecimal(itemQtd);
    const v = parseDecimal(itemValorUnit);
    return q * v;
  }, [itemQtd, itemValorUnit]);

  const somaPercClasses = useMemo(() => itemRateio.reduce((s, c) => s + c.percentual, 0), [itemRateio]);

  if (carregandoClone) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/suprimentos/pedidos")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-foreground">Novo Pedido de Compra</h1>
          <p className="text-sm text-muted-foreground">
            {origemNumeroReqAlvo
              ? `Pedido derivado da Requisição ${origemNumeroReqAlvo}`
              : "Siga as etapas para criar seu pedido."}
          </p>
        </div>
        {valorTotalPedido > 0 && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total do pedido</p>
            <p className="text-lg font-mono font-bold text-emerald-600">{formatBRL(valorTotalPedido)}</p>
          </div>
        )}
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 overflow-x-auto">
        {STEPS.map((step, idx) => (
          <div key={step.id} className="flex items-center gap-2 shrink-0">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                currentStep === step.id
                  ? "bg-primary text-primary-foreground"
                  : currentStep > step.id
                    ? "bg-emerald-500 text-white"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {currentStep > step.id ? <Check className="h-4 w-4" /> : step.id}
            </div>
            <span
              className={`text-sm hidden sm:inline ${
                currentStep === step.id ? "font-semibold text-foreground" : "text-muted-foreground"
              }`}
            >
              {step.label}
            </span>
            {idx < STEPS.length - 1 && (
              <div className={`h-px w-6 sm:w-10 ${currentStep > step.id ? "bg-emerald-500" : "bg-muted"}`} />
            )}
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
                  <h2 className="text-lg font-semibold text-foreground">O que será comprado?</h2>
                  <p className="text-sm text-muted-foreground">
                    Adicione os produtos ou serviços, com quantidade, valor unitário e rateio Classe + CC.
                  </p>
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
                  {itens.map((item) => {
                    const totalItem = round2(item.quantidade * item.valor_unitario);
                    return (
                      <div key={item.tempId} className="flex items-start gap-3 rounded-lg border p-3">
                        <div className="mt-0.5 rounded-md bg-muted p-2">
                          {item.item_servico ? (
                            <Wrench className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Package className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-sm text-foreground truncate">{item.produto_nome}</p>
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {item.item_servico ? "Serviço" : "Produto"}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {item.quantidade} {item.produto_unidade} × {formatBRL(item.valor_unitario)} ={" "}
                            <span className="font-mono text-emerald-600">{formatBRL(totalItem)}</span>
                          </p>
                          {item.observacao && (
                            <p className="text-xs text-muted-foreground italic mt-1">"{item.observacao}"</p>
                          )}
                          {item.rateio.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {item.rateio.map((cls) => (
                                <Badge key={cls.tempClasseId} variant="secondary" className="text-[10px] font-normal">
                                  {cls.codigo_classe_rec_desp} ({cls.percentual}%) — {cls.ccs.length} CC
                                  {cls.ccs.length !== 1 ? "s" : ""}
                                </Badge>
                              ))}
                            </div>
                          )}
                          {item.valor_unitario === 0 && (
                            <p className="text-xs text-amber-600 mt-1">
                              ⚠ Valor unitário ainda não definido — clique em editar
                            </p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => openEditItemDialog(item)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveItem(item.tempId)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Etapas 2-5: placeholder */}
      {currentStep >= 2 && currentStep <= 5 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Construction className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-sm font-medium">
              Etapa {currentStep}: {STEPS[currentStep - 1].label}
            </p>
            <p className="text-xs mt-1">Em construção — será implementada na próxima sessão.</p>
          </CardContent>
        </Card>
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-between">
        {currentStep === 1 ? (
          <Button variant="outline" onClick={() => navigate("/suprimentos/pedidos")}>
            Cancelar
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setCurrentStep((s) => s - 1)} disabled={enviando}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
        )}
        {currentStep < 5 ? (
          <Button
            onClick={() => setCurrentStep((s) => s + 1)}
            disabled={currentStep === 1 ? !canAdvanceFromEtapa1 : true}
            title={
              currentStep === 1 && !canAdvanceFromEtapa1
                ? "Adicione ao menos um item"
                : currentStep >= 2
                  ? "Próxima etapa em construção"
                  : undefined
            }
          >
            Próximo <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button disabled>Enviar Pedido</Button>
        )}
      </div>

      {/* ════════════════════════════════════════════════════ */}
      {/* MODAL DE ITEM (2 sub-etapas: Dados + Rateio)       */}
      {/* ════════════════════════════════════════════════════ */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>
              {editingItemId ? "Editar item" : "Adicionar item"}
              {itemStep === 2 && " — Rateio Classe + CC"}
            </DialogTitle>
          </DialogHeader>

          {/* Sub-etapa 1: Dados básicos do item */}
          {itemStep === 1 && (
            <div className="space-y-4 py-2">
              <Tabs
                value={itemTipo}
                onValueChange={(v) => {
                  setItemTipo(v as any);
                  setProdutoSelecionado(null);
                }}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="produto" className="flex-1">
                    <Package className="h-4 w-4 mr-1" /> Produto
                  </TabsTrigger>
                  <TabsTrigger value="servico" className="flex-1">
                    <Wrench className="h-4 w-4 mr-1" /> Serviço
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="space-y-2">
                <Label>{itemTipo === "servico" ? "Serviço" : "Produto"}</Label>
                <Popover open={produtoPopoverOpen} onOpenChange={setProdutoPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                      {produtoSelecionado
                        ? `${produtoSelecionado.nome_produto} (${produtoSelecionado.codigo_produto})`
                        : `Buscar ${itemTipo === "servico" ? "serviço" : "produto"}...`}
                      <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Digite para buscar..."
                        value={produtoSearch}
                        onValueChange={setProdutoSearch}
                      />
                      <CommandList>
                        <CommandEmpty>Nenhum resultado.</CommandEmpty>
                        <CommandGroup>
                          {produtosFiltrados.map((p) => (
                            <CommandItem
                              key={p.codigo_produto}
                              value={p.codigo_produto}
                              onSelect={() => {
                                setProdutoSelecionado(p);
                                setProdutoPopoverOpen(false);
                              }}
                            >
                              <div className="flex flex-col">
                                <span className="font-medium">{p.nome_produto}</span>
                                <span className="text-xs text-muted-foreground">
                                  {p.codigo_produto}
                                  {p.unidade_medida ? ` · ${p.unidade_medida}` : ""}
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Quantidade</Label>
                  <Input type="text" inputMode="decimal" value={itemQtd} onChange={(e) => setItemQtd(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Valor Unitário (R$)</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={itemValorUnit}
                    onChange={(e) => setItemValorUnit(e.target.value)}
                    placeholder="0,00"
                  />
                </div>
              </div>

              {valorTotalItemModal > 0 && (
                <div className="rounded-md border bg-muted/30 p-3 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total do item</span>
                  <span className="font-mono font-bold text-emerald-600">{formatBRL(valorTotalItemModal)}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label>Observação (opcional)</Label>
                <Textarea
                  value={itemObs}
                  onChange={(e) => setItemObs(e.target.value)}
                  placeholder="Ex: marca preferida, especificação técnica..."
                />
              </div>
            </div>
          )}

          {/* Sub-etapa 2: Rateio Classe + CC */}
          {itemStep === 2 && (
            <div className="space-y-4 py-2">
              <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                Defina como o custo deste item será rateado entre <strong>Classes contábeis</strong>. Dentro de cada
                classe, defina o <strong>rateio por Centro de Custo</strong>. A soma das classes deve ser 100% e a soma
                dos CCs dentro de cada classe também deve ser 100%.
              </div>

              <div className="space-y-3">
                {itemRateio.map((cls, idxClasse) => {
                  const classe = classes.find((c) => c.codigo === cls.codigo_classe_rec_desp);
                  const somaCcs = cls.ccs.reduce((s, cc) => s + cc.percentual, 0);

                  return (
                    <div key={cls.tempClasseId} className="rounded-lg border p-3 space-y-3">
                      {/* Linha da classe */}
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <Label className="text-xs text-muted-foreground mb-1 block">Classe #{idxClasse + 1}</Label>
                          <Popover
                            open={classePopoverOpen === cls.tempClasseId}
                            onOpenChange={(v) => setClassePopoverOpen(v ? cls.tempClasseId : null)}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                className="w-full justify-between font-normal text-xs h-9"
                              >
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
                                    {classes.map((c) => (
                                      <CommandItem
                                        key={c.codigo}
                                        value={`${c.codigo} ${c.nome}`}
                                        onSelect={() => {
                                          updateClasse(cls.tempClasseId, {
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
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">% do item</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={cls.percentual}
                            onChange={(e) =>
                              updateClasse(cls.tempClasseId, { percentual: parseFloat(e.target.value) || 0 })
                            }
                            className="w-20 h-9 text-right text-xs"
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 mt-5"
                          onClick={() => removeClasseLinha(cls.tempClasseId)}
                          disabled={itemRateio.length === 1}
                          title={itemRateio.length === 1 ? "Não pode remover a única classe" : "Remover classe"}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>

                      {/* Bloco dos CCs dentro da classe */}
                      <div className="ml-4 pl-3 border-l-2 border-muted space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-muted-foreground">Centros de Custo desta classe</Label>
                          <span
                            className={cn(
                              "text-xs font-semibold",
                              Math.abs(somaCcs - 100) <= 0.01 ? "text-emerald-600" : "text-destructive",
                            )}
                          >
                            Soma CCs: {somaCcs.toFixed(2)}%
                          </span>
                        </div>

                        {cls.ccs.map((cc) => {
                          const cc_found = costCenters.find((x) => x.erp_code === cc.codigo_centro_ctrl);
                          const popoverId = `${cls.tempClasseId}-${cc.tempCcId}`;
                          return (
                            <div key={cc.tempCcId} className="flex items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <Popover
                                  open={ccPopoverOpen === popoverId}
                                  onOpenChange={(v) => setCcPopoverOpen(v ? popoverId : null)}
                                >
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      role="combobox"
                                      className="w-full justify-between font-normal text-xs h-8"
                                    >
                                      <span className="truncate">
                                        {cc_found
                                          ? `${cc_found.erp_code} — ${cc_found.name}`
                                          : "Selecione um Centro de Custo..."}
                                      </span>
                                      <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50 shrink-0" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-[400px] p-0" align="start">
                                    <Command>
                                      <CommandInput placeholder="Buscar CC..." />
                                      <CommandList>
                                        <CommandEmpty>Nenhum CC encontrado.</CommandEmpty>
                                        <CommandGroup>
                                          {costCenters.map((c) => (
                                            <CommandItem
                                              key={c.erp_code}
                                              value={`${c.erp_code} ${c.name}`}
                                              onSelect={() => {
                                                updateCc(cls.tempClasseId, cc.tempCcId, {
                                                  codigo_centro_ctrl: c.erp_code,
                                                  centro_ctrl_label: c.name,
                                                });
                                                setCcPopoverOpen(null);
                                              }}
                                            >
                                              <div className="flex flex-col">
                                                <span className="font-medium text-sm">{c.name}</span>
                                                <span className="text-xs text-muted-foreground font-mono">
                                                  {c.erp_code}
                                                  {c.department_type && ` · ${c.department_type}`}
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
                              <Input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={cc.percentual}
                                onChange={(e) =>
                                  updateCc(cls.tempClasseId, cc.tempCcId, {
                                    percentual: parseFloat(e.target.value) || 0,
                                  })
                                }
                                className="w-20 h-8 text-right text-xs"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                onClick={() => removeCcLinha(cls.tempClasseId, cc.tempCcId)}
                                disabled={cls.ccs.length === 1}
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </div>
                          );
                        })}

                        <div className="flex items-center gap-2 mt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => addCcLinha(cls.tempClasseId)}
                            className="gap-1.5 text-xs h-7"
                          >
                            <Plus className="h-3 w-3" /> Adicionar CC
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => dividirCcsIgualmente(cls.tempClasseId)}
                            className="gap-1.5 text-xs h-7"
                            disabled={cls.ccs.length < 2}
                          >
                            Dividir CCs igualmente
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer do rateio: ações + soma total */}
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={addClasseLinha} className="gap-1.5 text-xs">
                  <Plus className="h-3 w-3" /> Adicionar classe
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={dividirClassesIgualmente}
                  className="gap-1.5 text-xs"
                  disabled={itemRateio.length < 2}
                >
                  Dividir classes igualmente
                </Button>
                <div
                  className={cn(
                    "ml-auto text-sm font-semibold",
                    Math.abs(somaPercClasses - 100) <= 0.01 ? "text-emerald-600" : "text-destructive",
                  )}
                >
                  Total classes: {somaPercClasses.toFixed(2)}%
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {itemStep === 1 ? (
              <>
                <Button variant="outline" onClick={() => setItemDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleNextToRateio}>
                  Próximo <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
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
