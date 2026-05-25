import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  enviarPedido,
  clonarDeRequisicao,
  calcularParcelas,
  carregarPedidoParaEdicao,
  type NovoPedidoInput,
  type ParcelaInput,
  type ArquivoInput,
  type CarregarPedidoResult,
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
import { Calendar } from "@/components/ui/calendar";
import { format, addDays, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
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
  Calendar as CalendarIcon,
  RotateCcw,
  Paperclip,
  FileText,
  Image as ImageIcon,
  RefreshCw,
  AlertCircle,
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

interface Fornecedor {
  codigo_entidade: string;
  cnpj: string | null;
  nome: string;
  nome_fantasia: string | null;
  municipio: string | null;
  uf: string | null;
}

interface CondPag {
  codigo: string;
  nome: string;
  quantidade_parcelas: number;
  dias_entre_parcelas: number;
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
  const pedidoIdFromQuery = searchParams.get("pedidoId");
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

  // ── Modo edição de rascunho/erro_envio ──────────────────
  const [pedidoIdEmEdicao, setPedidoIdEmEdicao] = useState<string | null>(null);
  const [numeroDoRascunho, setNumeroDoRascunho] = useState<string | null>(null);
  const [statusLocalAnterior, setStatusLocalAnterior] = useState<string | null>(null);
  const [erroEnvioAnterior, setErroEnvioAnterior] = useState<{ message?: string } | null>(null);
  const [carregandoEdicao, setCarregandoEdicao] = useState(!!pedidoIdFromQuery);
  // Arquivos já salvos no banco (para edição). Conta no limite de 3, mas o usuário pode remover.
  const [arquivosExistentes, setArquivosExistentes] = useState<
    Array<{
      id: string;
      upload_identify_guid: string;
      nome_original: string;
      mime_type: string;
      tamanho_bytes: number;
      storage_path: string;
    }>
  >([]);

  // Submit
  const [enviando, setEnviando] = useState(false);

  // ── Etapa 2: Fornecedor + CondPag + TipoEntrega ────────
  const [codigoEntidade, setCodigoEntidade] = useState("");
  const [nomeEntidade, setNomeEntidade] = useState("");
  const [cnpjEntidade, setCnpjEntidade] = useState("");
  const [fornecedorPopoverOpen, setFornecedorPopoverOpen] = useState(false);
  const [fornecedorSearch, setFornecedorSearch] = useState("");
  const [fornecedorAutoSelected, setFornecedorAutoSelected] = useState(false);

  const [codigoCondPag, setCodigoCondPag] = useState("");
  const [nomeCondPag, setNomeCondPag] = useState("");
  const [condPagPopoverOpen, setCondPagPopoverOpen] = useState(false);
  const [condPagSearch, setCondPagSearch] = useState("");

  const [tipoEntrega, setTipoEntrega] = useState<"Parcial" | "Total">("Total");

  // ── Etapa 3: Datas ──────────────────────────────────────
  // Default: DataPedido = hoje
  // DataEntrega = hoje + 30 dias
  // DataValidade = hoje + 60 dias
  // DataCompetencia = primeiro dia do mês de DataPedido (derivado, não editável)
  const hoje = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [dataPedido, setDataPedido] = useState<Date>(hoje);
  const [dataEntrega, setDataEntrega] = useState<Date>(addDays(hoje, 30));
  const [dataValidade, setDataValidade] = useState<Date>(addDays(hoje, 60));

  // Popovers dos calendários
  const [dataPedidoPopoverOpen, setDataPedidoPopoverOpen] = useState(false);
  const [dataEntregaPopoverOpen, setDataEntregaPopoverOpen] = useState(false);
  const [dataValidadePopoverOpen, setDataValidadePopoverOpen] = useState(false);

  // ── Etapa 4: Parcelas + Anexos ──────────────────────────
  // Parcelas: calculadas automaticamente ao entrar na etapa
  // Usuário pode editar valor, data, dias entre parcelas (Abordagem B)
  const [parcelas, setParcelas] = useState<ParcelaInput[]>([]);
  const [calculandoParcelas, setCalculandoParcelas] = useState(false);
  const [erroCalculoParcelas, setErroCalculoParcelas] = useState<string | null>(null);
  const [parcelasEditadasManualmente, setParcelasEditadasManualmente] = useState(false);

  // Popovers de data dentro da tabela de parcelas
  const [parcelaDatePopoverOpen, setParcelaDatePopoverOpen] = useState<number | null>(null);

  // Anexos: até 3 PDF/JPG/PNG, max 5MB cada
  const [arquivos, setArquivos] = useState<ArquivoInput[]>([]);
  const MAX_ARQUIVOS = 3;
  const MAX_TAMANHO_MB = 5;
  const MAX_TAMANHO_BYTES = MAX_TAMANHO_MB * 1024 * 1024;
  const MIME_TYPES_ACEITOS = ["application/pdf", "image/jpeg", "image/png"];

  // ── Etapa 5: Revisão + Envio ────────────────────────────
  const [textoLivre, setTextoLivre] = useState("");
  const [textoHistoricoNovo, setTextoHistoricoNovo] = useState("");
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

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

  const { data: fornecedores = [] } = useQuery({
    queryKey: ["compras_entidades_cache_pedido_wizard"],
    queryFn: async (): Promise<Fornecedor[]> => {
      const { data, error } = await (supabase as any)
        .from("compras_entidades_cache")
        .select("codigo_entidade, cnpj, nome, nome_fantasia, municipio, uf")
        .eq("e_fornecedor", true)
        .order("nome", { ascending: true });
      if (error) throw error;
      return (data || []) as Fornecedor[];
    },
  });

  const { data: condPags = [] } = useQuery({
    queryKey: ["condicoes_pagamento_pedido_wizard"],
    queryFn: async (): Promise<CondPag[]> => {
      const { data, error } = await (supabase as any)
        .from("condicoes_pagamento")
        .select("codigo, nome, quantidade_parcelas, dias_entre_parcelas")
        .order("codigo", { ascending: true });
      if (error) throw error;
      return (data || []) as CondPag[];
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

  // ── useEffect: Carregar pedido para edição ──────────────
  // Disparado se ?pedidoId=<uuid> estiver na URL.
  // Popula TODOS os estados do wizard com os dados salvos no banco.
  useEffect(() => {
    if (!pedidoIdFromQuery) return;
    if (reqIdFromQuery) return; // se vier ambos, prioriza reqId (não deveria acontecer)

    const carregar = async () => {
      try {
        const dados: CarregarPedidoResult = await carregarPedidoParaEdicao(pedidoIdFromQuery);

        // Marca modo edição
        setPedidoIdEmEdicao(dados.pedido_id);
        setNumeroDoRascunho(dados.numero);
        setStatusLocalAnterior(dados.status_local);
        setErroEnvioAnterior(dados.erro_envio);

        // Cabeçalho — fornecedor + cond pag
        setCodigoEntidade(dados.codigo_entidade);
        setNomeEntidade(dados.nome_entidade);
        setCnpjEntidade(dados.cnpj_entidade || "");
        setCodigoCondPag(dados.codigo_cond_pag);
        setNomeCondPag(dados.nome_cond_pag);
        setTipoEntrega(dados.tipo_entrega);

        // Datas (convertendo YYYY-MM-DD para Date local)
        const parseLocalDate = (ymd: string): Date => {
          const [y, m, d] = ymd.split("-").map(Number);
          const dt = new Date(y, m - 1, d);
          dt.setHours(0, 0, 0, 0);
          return dt;
        };
        setDataPedido(parseLocalDate(dados.data_pedido));
        setDataEntrega(parseLocalDate(dados.data_entrega));
        setDataValidade(parseLocalDate(dados.data_validade));

        // Origem (se veio de Req)
        if (dados.origem_numero_req_alvo) {
          setOrigemNumeroReqAlvo(dados.origem_numero_req_alvo);
          setOrigemCodigoEmpresaFilial(dados.origem_codigo_empresa_filial_req_comp || undefined);
        }

        // Itens (recria os tempIds locais; rateio já vem hierárquico)
        const itensComIds: ItemWizard[] = dados.itens.map((it, idx) => ({
          tempId: `tmp-${Date.now()}-${Math.random()}-${idx}`,
          item_servico: it.item_servico,
          codigo_produto: it.codigo_produto,
          codigo_alternativo_produto: it.codigo_alternativo_produto,
          codigo_prod_unid_med: it.codigo_prod_unid_med,
          produto_nome: it.produto_nome,
          produto_unidade: it.produto_unidade,
          quantidade: it.quantidade,
          valor_unitario: it.valor_unitario,
          observacao: it.observacao,
          rateio: it.rateio.map((cls, clsIdx) => ({
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
          })),
        }));
        setItens(itensComIds);

        // Parcelas: preserva exatamente como estavam (já editadas)
        setParcelas(dados.parcelas);
        setParcelasEditadasManualmente(true); // não recalcula automático

        // Arquivos existentes: guardamos a metadata pra mostrar na UI
        // Note: o `File` não pode ser reconstruído (browser bloqueia), então
        // tratamos como "anexos previamente salvos" — usuário pode remover.
        setArquivosExistentes(dados.arquivos_existentes);

        // Textos (sem o stamp — foi removido pelo service)
        setTextoLivre(dados.texto_livre_existente);
        setTextoHistoricoNovo(dados.texto_historico_existente);

        toast({
          title: `Editando ${dados.numero}`,
          description:
            dados.status_local === "erro_envio"
              ? "Pedido retomado após erro de envio. Revise e tente novamente."
              : "Rascunho carregado para edição.",
        });
      } catch (err: any) {
        toast({
          title: "Erro ao carregar pedido",
          description: err?.message || "Não foi possível carregar o pedido.",
          variant: "destructive",
        });
        navigate("/suprimentos/pedidos");
      } finally {
        setCarregandoEdicao(false);
      }
    };
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoIdFromQuery]);

  // Auto-select de fornecedor pelo CNPJ sugerido da Req (caminho 1a).
  // Tenta achar match exato no cache. Se houver 1 único match → seleciona automaticamente.
  // Se houver múltiplos → abre o combobox já filtrado (sem seleção automática).
  // Se houver 0 → não faz nada (analista escolhe normalmente).
  useEffect(() => {
    if (!cnpjSugeridoDaReq || fornecedores.length === 0) return;
    if (codigoEntidade) return; // já tem fornecedor escolhido — não sobrescreve

    const cnpjLimpo = cnpjSugeridoDaReq.replace(/\D/g, "");
    if (!cnpjLimpo) return;

    const matches = fornecedores.filter((f) => (f.cnpj || "").replace(/\D/g, "") === cnpjLimpo);

    if (matches.length === 1) {
      const f = matches[0];
      setCodigoEntidade(f.codigo_entidade);
      setNomeEntidade(f.nome);
      setCnpjEntidade(f.cnpj || "");
      setFornecedorAutoSelected(true);
    } else if (matches.length > 1) {
      // Múltiplos matches — apenas pre-filtra a busca
      setFornecedorSearch(cnpjLimpo);
    }
  }, [cnpjSugeridoDaReq, fornecedores, codigoEntidade]);

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

  const fornecedoresFiltrados = useMemo(() => {
    const q = fornecedorSearch.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    if (!q) return fornecedores.slice(0, 100);
    return fornecedores
      .filter((f) => {
        const nome = f.nome.toLowerCase();
        const fantasia = (f.nome_fantasia || "").toLowerCase();
        const codigo = f.codigo_entidade.toLowerCase();
        const cnpjDigits = (f.cnpj || "").replace(/\D/g, "");
        return (
          nome.includes(q) ||
          fantasia.includes(q) ||
          codigo.includes(q) ||
          (qDigits.length >= 3 && cnpjDigits.includes(qDigits))
        );
      })
      .slice(0, 100);
  }, [fornecedores, fornecedorSearch]);

  const condPagsFiltrados = useMemo(() => {
    const q = condPagSearch.trim().toLowerCase();
    if (!q) return condPags;
    return condPags.filter((cp) => cp.codigo.toLowerCase().includes(q) || cp.nome.toLowerCase().includes(q));
  }, [condPags, condPagSearch]);

  const handleSelectFornecedor = (f: Fornecedor) => {
    setCodigoEntidade(f.codigo_entidade);
    setNomeEntidade(f.nome);
    setCnpjEntidade(f.cnpj || "");
    setFornecedorAutoSelected(false); // selecionado manualmente
    setFornecedorPopoverOpen(false);
    setFornecedorSearch("");
  };

  const handleSelectCondPag = (cp: CondPag) => {
    setCodigoCondPag(cp.codigo);
    setNomeCondPag(cp.nome);
    setCondPagPopoverOpen(false);
    setCondPagSearch("");
  };

  const fornecedorSelecionado = fornecedores.find((f) => f.codigo_entidade === codigoEntidade);
  const condPagSelecionada = condPags.find((cp) => cp.codigo === codigoCondPag);

  // ════════════════════════════════════════════════════════
  // RENDER — Stepper + Etapas
  // ════════════════════════════════════════════════════════

  // Pode avançar Etapa 1?
  const canAdvanceFromEtapa1 = itens.length > 0;

  // Pode avançar Etapa 2?
  const canAdvanceFromEtapa2 = !!codigoEntidade && !!codigoCondPag && !!tipoEntrega;

  // ── Etapa 3: derivações + validações ───────────────────
  // DataCompetência = primeiro dia do mês da DataPedido (regra fixa, não editável)
  const dataCompetencia = useMemo(() => startOfMonth(dataPedido), [dataPedido]);

  const validarDatas = (): string | null => {
    if (dataEntrega < dataPedido) {
      return "Data da Entrega não pode ser anterior à Data do Pedido";
    }
    if (dataValidade < dataPedido) {
      return "Data da Validade não pode ser anterior à Data do Pedido";
    }
    if (dataValidade < dataEntrega) {
      return "Data da Validade não pode ser anterior à Data da Entrega";
    }
    return null;
  };

  const erroDatas = useMemo(() => validarDatas(), [dataPedido, dataEntrega, dataValidade]);
  const canAdvanceFromEtapa3 = !erroDatas;

  // Detecta se as datas atuais correspondem ao "padrão sugerido" (hoje / +30 / +60)
  const datasNoPadrao = useMemo(() => {
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    return (
      sameDay(dataPedido, hoje) && sameDay(dataEntrega, addDays(hoje, 30)) && sameDay(dataValidade, addDays(hoje, 60))
    );
  }, [dataPedido, dataEntrega, dataValidade, hoje]);

  const resetarDatasParaPadrao = () => {
    setDataPedido(hoje);
    setDataEntrega(addDays(hoje, 30));
    setDataValidade(addDays(hoje, 60));
  };

  // ════════════════════════════════════════════════════════
  // ETAPA 4: Parcelas + Anexos — Handlers
  // ════════════════════════════════════════════════════════

  // Recalcula parcelas do zero (chama service)
  const recalcularParcelas = async () => {
    if (!codigoCondPag) {
      setErroCalculoParcelas("Condição de pagamento não selecionada (volte à Etapa 2).");
      return;
    }
    if (valorTotalPedido <= 0) {
      setErroCalculoParcelas("Valor total do pedido é zero. Defina valores unitários dos itens.");
      return;
    }
    setCalculandoParcelas(true);
    setErroCalculoParcelas(null);
    try {
      const dataBaseYMD = format(dataPedido, "yyyy-MM-dd");
      const parcelasCalculadas = await calcularParcelas(codigoCondPag, valorTotalPedido, dataBaseYMD);
      setParcelas(parcelasCalculadas);
      setParcelasEditadasManualmente(false);
    } catch (err: any) {
      setErroCalculoParcelas(err?.message || "Erro ao calcular parcelas.");
      setParcelas([]);
    } finally {
      setCalculandoParcelas(false);
    }
  };

  // Dispara o cálculo automático ao entrar na Etapa 4 pela primeira vez
  // (ou se mudou CondPag/valor após já ter calculado)
  useEffect(() => {
    if (currentStep !== 4) return;
    if (parcelasEditadasManualmente) return; // não sobrescreve edições manuais
    if (!codigoCondPag || valorTotalPedido <= 0) return;
    // Recalcula se ainda não tem parcelas OU se valor/condpag/data mudou
    recalcularParcelas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, codigoCondPag, valorTotalPedido, dataPedido]);

  const atualizarParcela = (idx: number, patch: Partial<ParcelaInput>) => {
    setParcelas((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
    setParcelasEditadasManualmente(true);
  };

  const removerParcela = (idx: number) => {
    setParcelas((prev) => prev.filter((_, i) => i !== idx));
    setParcelasEditadasManualmente(true);
  };

  const adicionarParcelaManual = () => {
    const ultima = parcelas[parcelas.length - 1];
    const novaSeq = parcelas.length + 1;
    const novaData = ultima
      ? format(addDays(new Date(`${ultima.data_vencimento}T03:00:00.000Z`), 30), "yyyy-MM-dd")
      : format(addDays(dataPedido, 30), "yyyy-MM-dd");
    setParcelas((prev) => [
      ...prev,
      {
        sequencia: novaSeq,
        dias_entre_parcelas: 30,
        percentual_fracao: prev.length + 1,
        valor_parcela: 0,
        data_vencimento: novaData,
      },
    ]);
    setParcelasEditadasManualmente(true);
  };

  const somaParcelas = useMemo(() => round2(parcelas.reduce((s, p) => s + p.valor_parcela, 0)), [parcelas]);

  const parcelasValorOk = parcelas.length > 0 && Math.abs(somaParcelas - valorTotalPedido) <= 0.01;

  // ── Handlers de anexos (espelho da Req) ─────────────────

  const handleSelecionarArquivos = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const disponiveis = MAX_ARQUIVOS - arquivos.length - arquivosExistentes.length;
    if (files.length > disponiveis) {
      toast({
        title: "Limite excedido",
        description: `Você pode anexar no máximo ${MAX_ARQUIVOS} arquivos. Restam ${disponiveis}.`,
        variant: "destructive",
      });
      event.target.value = "";
      return;
    }

    const novos: ArquivoInput[] = [];
    for (const file of files) {
      if (!MIME_TYPES_ACEITOS.includes(file.type)) {
        toast({
          title: "Tipo de arquivo não permitido",
          description: `"${file.name}" não é PDF, JPG ou PNG.`,
          variant: "destructive",
        });
        continue;
      }
      if (file.size > MAX_TAMANHO_BYTES) {
        toast({
          title: "Arquivo muito grande",
          description: `"${file.name}" excede ${MAX_TAMANHO_MB}MB.`,
          variant: "destructive",
        });
        continue;
      }
      novos.push({ file, upload_identify_guid: crypto.randomUUID() });
    }

    if (novos.length > 0) {
      setArquivos((prev) => [...prev, ...novos]);
    }
    event.target.value = "";
  };

  const handleRemoverArquivo = (guid: string) => {
    setArquivos((prev) => prev.filter((a) => a.upload_identify_guid !== guid));
  };

  const formatarTamanho = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getIconeArquivo = (mimeType: string) => {
    if (mimeType.startsWith("image/")) return ImageIcon;
    return FileText;
  };

  // Pode avançar Etapa 4?
  // Precisa: pelo menos 1 parcela, soma OK, todas parcelas com valor > 0 e data válida
  const canAdvanceFromEtapa4 =
    parcelas.length > 0 && parcelasValorOk && parcelas.every((p) => p.valor_parcela > 0 && !!p.data_vencimento);

  // ════════════════════════════════════════════════════════
  // ETAPA 5: Stamp preview + Envio
  // ════════════════════════════════════════════════════════

  // Preview do stamp (idêntico ao service, mas calculado em tempo real pra UI)
  const stampPreview = useMemo(() => {
    const userId = user?.id || "";
    const nome = profile?.full_name || user?.email || "Analista";
    const idCurto = userId.substring(0, 8);
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    return `[Hub] Analista: ${nome} | ${dd}/${mm}/${yyyy} ${hh}:${mi} | ID: ${idCurto}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, profile?.full_name, user?.email, currentStep]);

  const handleEnviarPedido = async () => {
    if (!user?.id) {
      toast({
        title: "Sessão expirada",
        description: "Faça login novamente para enviar o pedido.",
        variant: "destructive",
      });
      return;
    }

    setEnviando(true);
    setErroEnvio(null);

    try {
      // Monta payload com os ItensPedidoInput (convertendo do estado local)
      const itensInput = itens.map((it) => ({
        item_servico: it.item_servico,
        codigo_produto: it.codigo_produto,
        codigo_alternativo_produto: it.codigo_alternativo_produto,
        codigo_prod_unid_med: it.codigo_prod_unid_med,
        produto_nome: it.produto_nome,
        produto_unidade: it.produto_unidade,
        quantidade: it.quantidade,
        valor_unitario: it.valor_unitario,
        observacao: it.observacao,
        rateio: it.rateio.map((c) => ({
          codigo_classe_rec_desp: c.codigo_classe_rec_desp,
          classe_rec_desp_label: c.classe_rec_desp_label,
          percentual: c.percentual,
          ccs: c.ccs.map((cc) => ({
            codigo_centro_ctrl: cc.codigo_centro_ctrl,
            centro_ctrl_label: cc.centro_ctrl_label,
            percentual: cc.percentual,
          })),
        })),
      }));

      const input: NovoPedidoInput = {
        user_id: user.id,
        analista_nome: profile?.full_name || user.email || "Analista",
        analista_email: user.email || "",

        origem_requisicao_id: origemReqId,
        origem_numero_req_alvo: origemNumeroReqAlvo,
        origem_codigo_empresa_filial: origemCodigoEmpresaFilial,

        itens: itensInput,

        codigo_entidade: codigoEntidade,
        nome_entidade: nomeEntidade,
        cnpj_entidade: cnpjEntidade,
        codigo_cond_pag: codigoCondPag,
        nome_cond_pag: nomeCondPag,
        tipo_entrega: tipoEntrega,

        data_pedido: format(dataPedido, "yyyy-MM-dd"),
        data_entrega: format(dataEntrega, "yyyy-MM-dd"),
        data_validade: format(dataValidade, "yyyy-MM-dd"),
        data_competencia: format(dataCompetencia, "yyyy-MM-dd"),

        parcelas,
        arquivos,

        texto_livre: textoLivre,
        texto_historico_novo: textoHistoricoNovo,
      };

      const result = await enviarPedido(input, pedidoIdEmEdicao || undefined);

      if (result.sucesso) {
        toast({
          title: "Pedido criado com sucesso",
          description: result.numero_alvo
            ? `Pedido nº ${result.numero_alvo} enviado ao ERP.`
            : "Pedido registrado no Hub.",
        });
        navigate("/suprimentos/pedidos");
      } else {
        // Falha no envio: guarda o pedido_id retornado para o próximo clique reutilizar
        // o mesmo rascunho (evita duplicação).
        if (result.pedido_id && !pedidoIdEmEdicao) {
          setPedidoIdEmEdicao(result.pedido_id);
        }
        setErroEnvio(result.erro || "Falha desconhecida ao enviar pedido.");
        toast({
          title: "Erro ao enviar pedido",
          description: result.erro || "Verifique os detalhes e tente novamente.",
          variant: "destructive",
        });
      }
    } catch (err: any) {
      const msg = err?.message || "Erro inesperado ao enviar pedido.";
      setErroEnvio(msg);
      toast({
        title: "Erro ao enviar pedido",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setEnviando(false);
    }
  };

  const valorTotalItemModal = useMemo(() => {
    const q = parseDecimal(itemQtd);
    const v = parseDecimal(itemValorUnit);
    return q * v;
  }, [itemQtd, itemValorUnit]);

  const somaPercClasses = useMemo(() => itemRateio.reduce((s, c) => s + c.percentual, 0), [itemRateio]);

  if (carregandoClone || carregandoEdicao) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {carregandoEdicao ? "Carregando pedido para edição..." : "Carregando dados da requisição..."}
        </p>
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
          <h1 className="text-2xl font-bold text-foreground">
            {pedidoIdEmEdicao ? "Editar Pedido" : "Novo Pedido de Compra"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {pedidoIdEmEdicao
              ? `Editando rascunho ${numeroDoRascunho}${
                  statusLocalAnterior === "erro_envio" ? " (com erro de envio anterior)" : ""
                }`
              : origemNumeroReqAlvo
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

      {/* Banner de erro de envio anterior (modo edição) */}
      {pedidoIdEmEdicao && erroEnvioAnterior && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-amber-700 dark:text-amber-400 text-sm">Tentativa anterior falhou</p>
                <p className="text-sm text-foreground mt-1 break-words">
                  {erroEnvioAnterior.message || "Erro desconhecido"}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Faça os ajustes necessários e clique em "Enviar Pedido" novamente. Este mesmo rascunho será
                  reutilizado.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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

      {/* Etapa 2: Fornecedor + CondPag + TipoEntrega */}
      {currentStep === 2 && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Fornecedor e Pagamento</h2>
              <p className="text-sm text-muted-foreground">
                Defina o fornecedor, a condição de pagamento e o tipo de entrega.
              </p>
            </div>

            {/* Fornecedor */}
            <div className="space-y-2">
              <Label>Fornecedor *</Label>
              <Popover open={fornecedorPopoverOpen} onOpenChange={setFornecedorPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-auto py-2">
                    {fornecedorSelecionado ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0 text-left">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{fornecedorSelecionado.nome}</span>
                            {fornecedorAutoSelected && (
                              <Badge variant="secondary" className="text-[10px] shrink-0">
                                auto-selecionado pelo CNPJ
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs font-mono text-muted-foreground">
                            {fornecedorSelecionado.cnpj || "(sem CNPJ)"}
                            {fornecedorSelecionado.municipio &&
                              ` · ${fornecedorSelecionado.municipio}/${fornecedorSelecionado.uf}`}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Buscar fornecedor por nome, código ou CNPJ...</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Digite nome, código ou CNPJ..."
                      value={fornecedorSearch}
                      onValueChange={setFornecedorSearch}
                    />
                    <CommandList>
                      <CommandEmpty>Nenhum fornecedor encontrado.</CommandEmpty>
                      <CommandGroup>
                        {fornecedoresFiltrados.map((f) => (
                          <CommandItem
                            key={f.codigo_entidade}
                            value={f.codigo_entidade}
                            onSelect={() => handleSelectFornecedor(f)}
                          >
                            <div className="flex flex-col w-full">
                              <span className="font-medium">{f.nome}</span>
                              {f.nome_fantasia && (
                                <span className="text-xs text-muted-foreground">{f.nome_fantasia}</span>
                              )}
                              <span className="text-xs font-mono text-muted-foreground">
                                {f.cnpj || "(sem CNPJ)"}
                                {f.municipio && ` · ${f.municipio}/${f.uf}`}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {cnpjSugeridoDaReq && !fornecedorSelecionado && (
                <p className="text-xs text-amber-600">
                  ⚠ A Requisição sugeriu o CNPJ {cnpjSugeridoDaReq}, mas nenhum fornecedor encontrado no cadastro.
                  Escolha um fornecedor manualmente.
                </p>
              )}
              {cnpjSugeridoDaReq && fornecedorSelecionado && fornecedorAutoSelected && (
                <p className="text-xs text-muted-foreground">
                  Selecionado automaticamente pelo CNPJ sugerido na Req. Você pode trocar se necessário.
                </p>
              )}
            </div>

            {/* Condição de Pagamento */}
            <div className="space-y-2">
              <Label>Condição de Pagamento *</Label>
              <Popover open={condPagPopoverOpen} onOpenChange={setCondPagPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-auto py-2">
                    {condPagSelecionada ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0 text-left">
                        <span className="font-mono text-xs text-muted-foreground">{condPagSelecionada.codigo}</span>
                        <span className="font-medium truncate">{condPagSelecionada.nome}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {condPagSelecionada.quantidade_parcelas}x
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Selecionar condição de pagamento...</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Buscar por código ou nome..."
                      value={condPagSearch}
                      onValueChange={setCondPagSearch}
                    />
                    <CommandList>
                      <CommandEmpty>Nenhuma condição encontrada.</CommandEmpty>
                      <CommandGroup>
                        {condPagsFiltrados.map((cp) => (
                          <CommandItem key={cp.codigo} value={cp.codigo} onSelect={() => handleSelectCondPag(cp)}>
                            <div className="flex items-center gap-2 w-full">
                              <span className="font-mono text-xs text-muted-foreground shrink-0">{cp.codigo}</span>
                              <span className="font-medium flex-1 truncate">{cp.nome}</span>
                              <Badge variant="outline" className="text-[10px] shrink-0">
                                {cp.quantidade_parcelas}x
                              </Badge>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {condPagSelecionada && (
                <p className="text-xs text-muted-foreground">
                  Esta condição gerará {condPagSelecionada.quantidade_parcelas} parcela
                  {condPagSelecionada.quantidade_parcelas !== 1 ? "s" : ""}
                  {condPagSelecionada.dias_entre_parcelas > 0
                    ? ` com ${condPagSelecionada.dias_entre_parcelas} dias entre cada uma`
                    : ""}
                  . O cálculo final será exibido na Etapa 4.
                </p>
              )}
            </div>

            {/* Tipo de Entrega */}
            <div className="space-y-2">
              <Label>Tipo de Entrega *</Label>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant={tipoEntrega === "Total" ? "default" : "outline"}
                  onClick={() => setTipoEntrega("Total")}
                  className="flex-1"
                >
                  Total
                </Button>
                <Button
                  type="button"
                  variant={tipoEntrega === "Parcial" ? "default" : "outline"}
                  onClick={() => setTipoEntrega("Parcial")}
                  className="flex-1"
                >
                  Parcial
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {tipoEntrega === "Total"
                  ? "Entrega única: tudo será entregue de uma vez."
                  : "Entrega parcelada: pedido pode ser entregue em múltiplas remessas."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Etapa 3: Datas */}
      {currentStep === 3 && (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Datas do Pedido</h2>
                <p className="text-sm text-muted-foreground">
                  Datas sugeridas automaticamente. Você pode editar conforme necessário.
                </p>
              </div>
              {!datasNoPadrao && (
                <Button variant="outline" size="sm" onClick={resetarDatasParaPadrao} className="gap-1.5 shrink-0">
                  <RotateCcw className="h-3.5 w-3.5" />
                  Voltar aos valores sugeridos
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Data do Pedido */}
              <div className="space-y-2">
                <Label>Data do Pedido *</Label>
                <Popover open={dataPedidoPopoverOpen} onOpenChange={setDataPedidoPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(dataPedido, "dd/MM/yyyy", { locale: ptBR })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dataPedido}
                      onSelect={(d) => {
                        if (d) {
                          setDataPedido(d);
                          setDataPedidoPopoverOpen(false);
                        }
                      }}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
                <p className="text-[11px] text-muted-foreground">Data oficial de emissão do pedido. Default: hoje.</p>
              </div>

              {/* Data da Competência (derivada) */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  Data da Competência
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    automática
                  </Badge>
                </Label>
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 h-10">
                  <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{format(dataCompetencia, "dd/MM/yyyy", { locale: ptBR })}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Primeiro dia do mês da Data do Pedido. Não editável.
                </p>
              </div>

              {/* Data da Entrega */}
              <div className="space-y-2">
                <Label>Data da Entrega *</Label>
                <Popover open={dataEntregaPopoverOpen} onOpenChange={setDataEntregaPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(dataEntrega, "dd/MM/yyyy", { locale: ptBR })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dataEntrega}
                      onSelect={(d) => {
                        if (d) {
                          setDataEntrega(d);
                          setDataEntregaPopoverOpen(false);
                        }
                      }}
                      disabled={(d) => d < dataPedido}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
                <p className="text-[11px] text-muted-foreground">
                  Quando o fornecedor deve entregar. Default: pedido + 30 dias.
                </p>
              </div>

              {/* Data da Validade */}
              <div className="space-y-2">
                <Label>Data da Validade *</Label>
                <Popover open={dataValidadePopoverOpen} onOpenChange={setDataValidadePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(dataValidade, "dd/MM/yyyy", { locale: ptBR })}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dataValidade}
                      onSelect={(d) => {
                        if (d) {
                          setDataValidade(d);
                          setDataValidadePopoverOpen(false);
                        }
                      }}
                      disabled={(d) => d < dataPedido || d < dataEntrega}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                      locale={ptBR}
                    />
                  </PopoverContent>
                </Popover>
                <p className="text-[11px] text-muted-foreground">
                  Até quando o preço é válido. Default: pedido + 60 dias.
                </p>
              </div>
            </div>

            {/* Mensagem de validação */}
            {erroDatas && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm text-destructive flex items-center gap-2">
                  <X className="h-4 w-4 shrink-0" />
                  {erroDatas}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Etapa 4: Parcelas + Anexos */}
      {currentStep === 4 && (
        <div className="space-y-4">
          {/* Card de Parcelas */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Parcelas de pagamento</h2>
                  <p className="text-sm text-muted-foreground">
                    Calculadas automaticamente a partir de{" "}
                    <span className="font-medium">{nomeCondPag || "(condição não selecionada)"}</span>. Você pode editar
                    valor, vencimento ou dias entre parcelas.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={recalcularParcelas}
                  disabled={calculandoParcelas || !codigoCondPag}
                  className="gap-1.5 shrink-0"
                >
                  {calculandoParcelas ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Recalcular do zero
                </Button>
              </div>

              {/* Erro de cálculo */}
              {erroCalculoParcelas && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-sm text-destructive flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {erroCalculoParcelas}
                  </p>
                </div>
              )}

              {/* Loading inicial */}
              {calculandoParcelas && parcelas.length === 0 && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Calculando parcelas...</span>
                </div>
              )}

              {/* Tabela de parcelas */}
              {parcelas.length > 0 && (
                <>
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2 font-medium text-xs text-muted-foreground w-12">Nº</th>
                          <th className="text-left p-2 font-medium text-xs text-muted-foreground">Vencimento</th>
                          <th className="text-right p-2 font-medium text-xs text-muted-foreground w-32">Valor (R$)</th>
                          <th className="text-center p-2 font-medium text-xs text-muted-foreground w-24">Dias entre</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {parcelas.map((p, idx) => {
                          const dataVencDate = new Date(`${p.data_vencimento}T03:00:00.000Z`);
                          return (
                            <tr key={idx} className="border-t">
                              <td className="p-2 text-center font-mono text-xs">{p.sequencia}</td>
                              <td className="p-2">
                                <Popover
                                  open={parcelaDatePopoverOpen === idx}
                                  onOpenChange={(v) => setParcelaDatePopoverOpen(v ? idx : null)}
                                >
                                  <PopoverTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 justify-start text-left font-normal text-xs"
                                    >
                                      <CalendarIcon className="mr-1.5 h-3 w-3" />
                                      {format(dataVencDate, "dd/MM/yyyy", { locale: ptBR })}
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                      mode="single"
                                      selected={dataVencDate}
                                      onSelect={(d) => {
                                        if (d) {
                                          atualizarParcela(idx, {
                                            data_vencimento: format(d, "yyyy-MM-dd"),
                                          });
                                          setParcelaDatePopoverOpen(null);
                                        }
                                      }}
                                      disabled={(d) => d < dataPedido}
                                      initialFocus
                                      className={cn("p-3 pointer-events-auto")}
                                      locale={ptBR}
                                    />
                                  </PopoverContent>
                                </Popover>
                              </td>
                              <td className="p-2">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={p.valor_parcela}
                                  onChange={(e) =>
                                    atualizarParcela(idx, {
                                      valor_parcela: parseFloat(e.target.value) || 0,
                                    })
                                  }
                                  className="h-8 text-right text-xs"
                                />
                              </td>
                              <td className="p-2">
                                <Input
                                  type="number"
                                  min="0"
                                  value={p.dias_entre_parcelas}
                                  onChange={(e) =>
                                    atualizarParcela(idx, {
                                      dias_entre_parcelas: parseInt(e.target.value) || 0,
                                    })
                                  }
                                  className="h-8 text-center text-xs"
                                />
                              </td>
                              <td className="p-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive"
                                  onClick={() => removerParcela(idx)}
                                  disabled={parcelas.length === 1}
                                  title={parcelas.length === 1 ? "Pelo menos 1 parcela" : "Remover"}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-muted/30 border-t-2">
                        <tr>
                          <td colSpan={2} className="p-2 text-right text-xs font-semibold text-muted-foreground">
                            Total parcelas:
                          </td>
                          <td className="p-2 text-right font-mono font-bold text-xs">
                            <span className={parcelasValorOk ? "text-emerald-600" : "text-destructive"}>
                              {formatBRL(somaParcelas)}
                            </span>
                          </td>
                          <td colSpan={2} className="p-2 text-left text-xs text-muted-foreground">
                            de {formatBRL(valorTotalPedido)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Botão adicionar parcela manual */}
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={adicionarParcelaManual} className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" /> Adicionar parcela
                    </Button>
                    {parcelasEditadasManualmente && (
                      <Badge variant="outline" className="text-[10px]">
                        Edição manual ativa — "Recalcular" volta ao padrão da CondPag
                      </Badge>
                    )}
                  </div>

                  {/* Aviso se soma não bate */}
                  {!parcelasValorOk && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                      <p className="text-sm text-destructive flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        Soma das parcelas ({formatBRL(somaParcelas)}) difere do total do pedido (
                        {formatBRL(valorTotalPedido)}). Diferença:{" "}
                        {formatBRL(Math.abs(somaParcelas - valorTotalPedido))}
                      </p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Card de Anexos */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <div className="flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold">Anexos (opcional)</h3>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Anexe até {MAX_ARQUIVOS} arquivos (PDF, JPG ou PNG — máx {MAX_TAMANHO_MB}MB cada). Serão enviados ao
                  ERP junto com o pedido.
                </p>
              </div>

              {/* Arquivos já salvos (modo edição) */}
              {arquivosExistentes.length > 0 && (
                <div className="space-y-2">
                  {arquivosExistentes.map((arq) => {
                    const IconeArq = getIconeArquivo(arq.mime_type);
                    return (
                      <div
                        key={arq.id}
                        className="flex items-center gap-3 rounded-md border border-dashed border-blue-500/30 bg-blue-500/5 p-3"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                          <IconeArq className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{arq.nome_original}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            <span>{formatarTamanho(arq.tamanho_bytes)}</span>
                            <Badge variant="outline" className="text-[10px]">
                              Salvo anteriormente
                            </Badge>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => setArquivosExistentes((prev) => prev.filter((a) => a.id !== arq.id))}
                          disabled={enviando}
                          title="Remover anexo"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Arquivos novos (in-memory) */}
              {arquivos.length > 0 && (
                <div className="space-y-2">
                  {arquivos.map((arq) => {
                    const IconeArq = getIconeArquivo(arq.file.type);
                    return (
                      <div key={arq.upload_identify_guid} className="flex items-center gap-3 rounded-md border p-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
                          <IconeArq className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{arq.file.name}</div>
                          <div className="text-xs text-muted-foreground">{formatarTamanho(arq.file.size)}</div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => handleRemoverArquivo(arq.upload_identify_guid)}
                          disabled={enviando}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {arquivos.length + arquivosExistentes.length < MAX_ARQUIVOS && (
                <div className="flex items-center gap-3">
                  <input
                    id="arquivo-pedido-upload"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    multiple
                    className="hidden"
                    onChange={handleSelecionarArquivos}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById("arquivo-pedido-upload")?.click()}
                    disabled={enviando}
                    className="gap-1.5"
                  >
                    <Paperclip className="h-4 w-4" />
                    Adicionar arquivo
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {arquivos.length + arquivosExistentes.length} de {MAX_ARQUIVOS}
                  </span>
                </div>
              )}

              {arquivos.length + arquivosExistentes.length >= MAX_ARQUIVOS && (
                <p className="text-xs text-muted-foreground">Limite máximo de {MAX_ARQUIVOS} arquivos atingido.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Etapa 5: Revisão + Envio */}
      {currentStep === 5 && (
        <div className="space-y-4">
          {/* Aviso de envio */}
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardContent className="pt-6">
              <p className="text-sm text-foreground">
                Revise todas as informações antes de enviar. Após o envio, o pedido será criado no Alvo ERP e aparecerá
                na lista de pedidos. Use os botões <span className="font-medium">Editar</span> de cada seção para voltar
                à etapa correspondente.
              </p>
            </CardContent>
          </Card>

          {/* Erro de envio (se houver) */}
          {erroEnvio && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold text-destructive text-sm">Erro ao enviar o pedido</p>
                    <p className="text-sm text-foreground mt-1">{erroEnvio}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      O pedido foi salvo como rascunho. Você pode revisar e tentar novamente.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Seção 1: Itens */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold text-sm">
                    Itens ({itens.length}) — Total: {formatBRL(valorTotalPedido)}
                  </h3>
                </div>
                <Button variant="outline" size="sm" onClick={() => setCurrentStep(1)}>
                  <Pencil className="h-3 w-3 mr-1.5" /> Editar
                </Button>
              </div>
              <div className="space-y-2">
                {itens.map((it) => (
                  <div key={it.tempId} className="rounded-md border p-3 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {it.item_servico ? (
                          <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="font-medium truncate">{it.produto_nome}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {it.item_servico ? "Serviço" : "Produto"}
                        </Badge>
                      </div>
                      <span className="font-mono text-xs text-emerald-600 shrink-0">
                        {formatBRL(it.quantidade * it.valor_unitario)}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {it.quantidade} {it.produto_unidade || "UNID"} × {formatBRL(it.valor_unitario)}
                    </div>
                    {it.observacao && (
                      <div className="text-xs italic text-muted-foreground mt-1">"{it.observacao}"</div>
                    )}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {it.rateio.map((c) => (
                        <Badge key={c.tempClasseId} variant="secondary" className="text-[10px]">
                          {c.codigo_classe_rec_desp} ({c.percentual.toFixed(2)}%) — {c.ccs.length} CC
                          {c.ccs.length !== 1 ? "s" : ""}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Seção 2: Fornecedor + CondPag + Entrega */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Fornecedor e Pagamento</h3>
                <Button variant="outline" size="sm" onClick={() => setCurrentStep(2)}>
                  <Pencil className="h-3 w-3 mr-1.5" /> Editar
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Fornecedor</p>
                  <p className="font-medium">{nomeEntidade}</p>
                  <p className="text-xs font-mono text-muted-foreground">{cnpjEntidade || "(sem CNPJ)"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Condição de Pagamento</p>
                  <p className="font-medium">{nomeCondPag}</p>
                  <p className="text-xs font-mono text-muted-foreground">{codigoCondPag}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tipo de Entrega</p>
                  <p className="font-medium">{tipoEntrega}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Seção 3: Datas */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Datas</h3>
                <Button variant="outline" size="sm" onClick={() => setCurrentStep(3)}>
                  <Pencil className="h-3 w-3 mr-1.5" /> Editar
                </Button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Pedido</p>
                  <p className="font-medium">{format(dataPedido, "dd/MM/yyyy", { locale: ptBR })}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Competência</p>
                  <p className="font-medium">{format(dataCompetencia, "dd/MM/yyyy", { locale: ptBR })}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Entrega</p>
                  <p className="font-medium">{format(dataEntrega, "dd/MM/yyyy", { locale: ptBR })}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Validade</p>
                  <p className="font-medium">{format(dataValidade, "dd/MM/yyyy", { locale: ptBR })}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Seção 4: Parcelas */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">
                  Parcelas ({parcelas.length}) — Total: {formatBRL(somaParcelas)}
                </h3>
                <Button variant="outline" size="sm" onClick={() => setCurrentStep(4)}>
                  <Pencil className="h-3 w-3 mr-1.5" /> Editar
                </Button>
              </div>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 font-medium text-xs text-muted-foreground w-12">Nº</th>
                      <th className="text-left p-2 font-medium text-xs text-muted-foreground">Vencimento</th>
                      <th className="text-right p-2 font-medium text-xs text-muted-foreground">Valor</th>
                      <th className="text-center p-2 font-medium text-xs text-muted-foreground">Dias entre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parcelas.map((p, idx) => {
                      const dataVencDate = new Date(`${p.data_vencimento}T03:00:00.000Z`);
                      return (
                        <tr key={idx} className="border-t">
                          <td className="p-2 text-center font-mono text-xs">{p.sequencia}</td>
                          <td className="p-2 text-xs">{format(dataVencDate, "dd/MM/yyyy", { locale: ptBR })}</td>
                          <td className="p-2 text-right font-mono text-xs">{formatBRL(p.valor_parcela)}</td>
                          <td className="p-2 text-center font-mono text-xs">{p.dias_entre_parcelas}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Seção 5: Anexos */}
          {arquivos.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-semibold text-sm">Anexos ({arquivos.length})</h3>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setCurrentStep(4)}>
                    <Pencil className="h-3 w-3 mr-1.5" /> Editar
                  </Button>
                </div>
                <div className="space-y-2">
                  {arquivos.map((arq) => {
                    const IconeArq = getIconeArquivo(arq.file.type);
                    return (
                      <div
                        key={arq.upload_identify_guid}
                        className="flex items-center gap-3 rounded-md border p-2 text-sm"
                      >
                        <IconeArq className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{arq.file.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">{formatarTamanho(arq.file.size)}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Seção 6: Textos + Stamp */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <h3 className="font-semibold text-sm mb-1">Observações</h3>
                <p className="text-xs text-muted-foreground">
                  Opcional. Será anexado aos campos{" "}
                  <code className="text-[10px] bg-muted px-1 py-0.5 rounded">Texto</code> e{" "}
                  <code className="text-[10px] bg-muted px-1 py-0.5 rounded">TextoHistoricoNovo</code> do Alvo, junto
                  com o carimbo de auditoria abaixo.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="texto-livre">
                  Texto / observação livre
                  <span className="text-xs text-muted-foreground ml-2">(visível no campo Texto do pedido no Alvo)</span>
                </Label>
                <Textarea
                  id="texto-livre"
                  value={textoLivre}
                  onChange={(e) => setTextoLivre(e.target.value)}
                  placeholder="Ex: pedido referente à manutenção do mês de maio..."
                  rows={3}
                  disabled={enviando}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="texto-historico">
                  Texto histórico / observação interna
                  <span className="text-xs text-muted-foreground ml-2">
                    (visível no campo Histórico do pedido no Alvo)
                  </span>
                </Label>
                <Textarea
                  id="texto-historico"
                  value={textoHistoricoNovo}
                  onChange={(e) => setTextoHistoricoNovo(e.target.value)}
                  placeholder="Ex: aprovado pela diretoria em reunião de 15/05..."
                  rows={2}
                  disabled={enviando}
                />
              </div>

              {/* Stamp automático */}
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-1">
                  Carimbo automático (adicionado ao final dos textos acima)
                </p>
                <p className="font-mono text-xs text-foreground break-all">{stampPreview}</p>
              </div>
            </CardContent>
          </Card>
        </div>
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
            disabled={
              (currentStep === 1 && !canAdvanceFromEtapa1) ||
              (currentStep === 2 && !canAdvanceFromEtapa2) ||
              (currentStep === 3 && !canAdvanceFromEtapa3) ||
              (currentStep === 4 && !canAdvanceFromEtapa4) ||
              currentStep >= 5
            }
            title={
              currentStep === 1 && !canAdvanceFromEtapa1
                ? "Adicione ao menos um item"
                : currentStep === 2 && !canAdvanceFromEtapa2
                  ? "Selecione fornecedor e condição de pagamento"
                  : currentStep === 3 && !canAdvanceFromEtapa3
                    ? erroDatas || "Corrija as datas"
                    : currentStep === 4 && !canAdvanceFromEtapa4
                      ? "Verifique as parcelas (soma deve bater com o total e cada uma deve ter valor e data)"
                      : currentStep >= 5
                        ? "Próxima etapa em construção"
                        : undefined
            }
          >
            Próximo <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleEnviarPedido}
            disabled={enviando || !canAdvanceFromEtapa4}
            title={!canAdvanceFromEtapa4 ? "Volte às etapas anteriores e corrija os erros" : undefined}
          >
            {enviando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                Enviar Pedido <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
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
