import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { ArrowLeft, ArrowRight, Plus, Pencil, Trash2, Package, Wrench, Check, ChevronsUpDown, ClipboardList } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface StockProduct {
  codigo: string;
  nome: string;
  codigo_alternativo: string | null;
  unidade_medida: string | null;
  tipo_produto_fiscal: string | null;
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
}

const STEPS = [
  { id: 1, label: "Itens" },
  { id: 2, label: "Finalidade" },
  { id: 3, label: "Área" },
  { id: 4, label: "Revisão" },
];

export default function SuprimentosRequisicaoNova() {
  const navigate = useNavigate();
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

  // Buscar produtos do cache
  const { data: produtos = [] } = useQuery({
    queryKey: ["stock_products_wizard"],
    queryFn: async (): Promise<StockProduct[]> => {
      const { data, error } = await (supabase as any)
        .from("stock_products")
        .select("codigo, nome, codigo_alternativo, unidade_medida, tipo_produto_fiscal")
        .order("nome", { ascending: true });
      if (error) throw error;
      return (data || []) as StockProduct[];
    },
  });

  // Filtrar produtos conforme tipo e busca
  const produtosFiltrados = useMemo(() => {
    const q = produtoSearch.trim().toLowerCase();
    return produtos.filter(p => {
      const isServico = p.tipo_produto_fiscal === "Serviço";
      if (itemTipo === "servico" && !isServico) return false;
      if (itemTipo === "produto" && isServico) return false;
      if (!q) return true;
      return (
        p.nome.toLowerCase().includes(q) ||
        p.codigo.toLowerCase().includes(q) ||
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
  };

  const openNewItemDialog = () => {
    resetItemForm();
    setItemDialogOpen(true);
  };

  const openEditItemDialog = (item: ItemWizard) => {
    setEditingItemId(item.tempId);
    setItemTipo(item.item_servico ? "servico" : "produto");
    setProdutoSelecionado({
      codigo: item.codigo_produto,
      nome: item.produto_nome,
      codigo_alternativo: item.codigo_alternativo_produto,
      unidade_medida: item.produto_unidade,
      tipo_produto_fiscal: item.item_servico ? "Serviço" : "Produto",
    });
    setItemQtd(String(item.quantidade));
    setItemObs(item.observacao || "");
    setItemDialogOpen(true);
  };

  const handleSaveItem = () => {
    if (!produtoSelecionado) {
      toast({ title: "Selecione um produto ou serviço", variant: "destructive" });
      return;
    }
    const qtdNum = parseFloat(itemQtd.replace(",", "."));
    if (!qtdNum || qtdNum <= 0) {
      toast({ title: "Quantidade deve ser maior que zero", variant: "destructive" });
      return;
    }

    const novoItem: ItemWizard = {
      tempId: editingItemId || `tmp-${Date.now()}-${Math.random()}`,
      item_servico: itemTipo === "servico",
      codigo_produto: produtoSelecionado.codigo,
      codigo_alternativo_produto: produtoSelecionado.codigo_alternativo,
      codigo_prod_unid_med: produtoSelecionado.unidade_medida || "UNID",
      produto_nome: produtoSelecionado.nome,
      produto_unidade: produtoSelecionado.unidade_medida || "UNID",
      quantidade: qtdNum,
      observacao: itemObs.trim(),
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

  const canAdvance = currentStep === 1 ? itens.length > 0 : true;

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

      {/* Etapas 2, 3, 4 placeholder */}
      {currentStep > 1 && (
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <p className="text-muted-foreground">Etapa {currentStep} — Em construção</p>
          </CardContent>
        </Card>
      )}

      {/* Footer nav */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => currentStep > 1 ? setCurrentStep(currentStep - 1) : navigate("/suprimentos/requisicoes")}>
          {currentStep > 1 ? "Voltar" : "Cancelar"}
        </Button>
        {currentStep < STEPS.length && (
          <Button onClick={() => setCurrentStep(currentStep + 1)} disabled={!canAdvance}>
            Próximo <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>

      {/* Modal de Item */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItemId ? "Editar item" : "Adicionar item"}</DialogTitle>
          </DialogHeader>
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
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-auto min-h-10 text-left">
                    <span className="truncate">
                      {produtoSelecionado ? `${produtoSelecionado.nome} (${produtoSelecionado.codigo})` : `Buscar ${itemTipo === "servico" ? "serviço" : "produto"}...`}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput placeholder="Digite para buscar..." value={produtoSearch} onValueChange={setProdutoSearch} />
                    <CommandList>
                      <CommandEmpty>Nenhum resultado.</CommandEmpty>
                      <CommandGroup>
                        {produtosFiltrados.map(p => (
                          <CommandItem key={p.codigo} value={p.codigo} onSelect={() => { setProdutoSelecionado(p); setProdutoPopoverOpen(false); }}>
                            <div className="flex flex-col">
                              <span className="text-sm">{p.nome}</span>
                              <span className="text-xs text-muted-foreground">{p.codigo}</span>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveItem}>{editingItemId ? "Salvar" : "Adicionar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
