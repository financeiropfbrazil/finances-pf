import { Fragment, useState, useMemo, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
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
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  Paperclip,
  FileText,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ProductCombobox } from "@/components/ProductCombobox";
import { enviarRequisicaoAlvo, fetchLinhasCondicao, validarLinhasRateio } from "@/services/alvoProjetoPedidoService";
import {
  salvarPedido,
  excluirPedido,
  marcarEmailAprovacao,
  descricaoErro,
  falhou,
  listarEtapasDoProjeto,
  type ArquivoPedidoProjeto,
  type DadosPedido,
} from "@/services/projetosService";
import {
  BASES_PARCELAS_PROJETO,
  BASE_PARCELAS_PROJETO_PADRAO,
  DIAS_ENTREGA_PADRAO,
  adicionarParcela,
  alterarDias,
  alterarValor,
  alterarVencimento,
  calcularParcelasProjeto,
  ehDataValida,
  fmtDataBR,
  hojeYMD,
  linhasDoResumo,
  normalizarBaseParcelas,
  recalcularDias,
  removerParcela,
  somaParcelas,
  somarDias,
  validarParcelas,
  type BaseParcelasProjeto,
  type ParcelaProjeto,
} from "@/services/projetoParcelas";
import {
  ACCEPT_ANEXOS,
  MAX_ANEXOS_PEDIDO,
  anexarArquivos,
  fmtTamanho,
  limparArquivosDePedidoExcluido,
  listarArquivosDoProjeto,
  removerAnexo,
  urlTemporariaAnexo,
  validarAnexos,
} from "@/services/projetoArquivosService";
import { sincronizarPedidosDoProjeto, getStatusAlvoDoPedido } from "@/services/projetoAlvoLoadService";
import { BarraConsumo, CabecalhoSecao, FaseChip, Indicador, StatusChip } from "@/components/projetos/ProjetosUI";
import { STATUS_PEDIDO, fmtData, fmtMoeda, fmtPct, tomEtapa } from "@/components/projetos/projetosFormat";

const fmtCurrency = fmtMoeda;

/**
 * Chave canônica do rateio para comparar Budget × Actual: (classe, CC, % com 2
 * casas), ordenada. Comparar o JSON cru dava falso "rateio alterado" — o jsonb
 * do banco volta com as chaves em outra ordem e o número em outra escala
 * (mesma armadilha do R-2).
 */
const chaveRateio = (linhas: any[] | null | undefined) =>
  (linhas || [])
    .map(
      (c: any) =>
        `${String(c.classe_codigo ?? "").trim()}|${String(c.centro_custo_codigo ?? "").trim()}|${(Number(c.percentual) || 0).toFixed(2)}`,
    )
    .sort()
    .join(";");

/** Tira do termo de busca o que quebra o filtro `.or()` do PostgREST (vírgula, parênteses, aspas). */
const termoBusca = (s: string) => s.replace(/[,()"\\%]/g, " ").trim();

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

  // ── Entrega e parcelas (L11 — só Actual) ──
  // `parcelasManuais` = a pessoa mexeu: o envio manda exatamente o que ficou.
  // Automáticas são recalculadas no envio, com a data do dia.
  const [dataEntrega, setDataEntrega] = useState<string>(() => somarDias(hojeYMD(), DIAS_ENTREGA_PADRAO));
  const [baseParcelas, setBaseParcelas] = useState<BaseParcelasProjeto>(BASE_PARCELAS_PROJETO_PADRAO);
  const [parcelas, setParcelas] = useState<ParcelaProjeto[]>([]);
  const [parcelasManuais, setParcelasManuais] = useState(false);
  const [erroCalculoParcelas, setErroCalculoParcelas] = useState<string | null>(null);

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
      const termo = termoBusca(fornecedorSearch);
      if (termo.length < 2) return [];
      const { data } = await supabase
        .from("compras_entidades_cache")
        .select("codigo_entidade, nome, cnpj")
        .or(`nome.ilike.%${termo}%,cnpj.ilike.%${termo}%`)
        .limit(10);
      return data || [];
    },
    enabled: fornecedorSearch.length >= 2,
  });

  // Fetch condições de pagamento
  const { data: condicoes = [] } = useQuery({
    queryKey: ["condicoes-pagamento"],
    queryFn: async () => {
      const { data } = await supabase
        .from("condicoes_pagamento")
        .select("codigo, nome, quantidade_parcelas, dias_entre_parcelas, primeiro_vencimento_apos")
        .order("nome");
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

  // ── Anexos (L9) ──
  const [arquivosNovos, setArquivosNovos] = useState<File[]>([]);
  const [removendoAnexo, setRemovendoAnexo] = useState<string | null>(null);

  const { data: arquivosProjeto = [] } = useQuery({
    queryKey: ["projeto-arquivos", projetoId],
    queryFn: () => listarArquivosDoProjeto(projetoId!),
    enabled: !!projetoId,
  });

  const arquivosPorPedido = useMemo(() => {
    const mapa: Record<string, ArquivoPedidoProjeto[]> = {};
    for (const a of arquivosProjeto) (mapa[a.requisicao_id] ||= []).push(a);
    return mapa;
  }, [arquivosProjeto]);

  // ── Parcelas (L11) ──
  const hoje = hojeYMD();
  /** Data de onde os prazos contam: o dia do envio (Data do Pedido) ou a Data da Entrega. */
  const dataBaseParcelas = baseParcelas === "Data da Entrega" && ehDataValida(dataEntrega) ? dataEntrega : hoje;
  const valorPedidoForm = Math.round(valorTotalItens * 100) / 100;

  const { data: linhasCondicao, isFetching: carregandoCondicao } = useQuery({
    queryKey: ["condicao-parcelas", condPag],
    queryFn: () => fetchLinhasCondicao(condPag),
    enabled: dialogOpen && currentFase === "actual" && !!condPag,
    staleTime: 5 * 60_000,
  });

  // Automáticas acompanham condição, valor e data base. Editadas à mão, não:
  // "Recalcular do zero" é a decisão explícita de voltar ao padrão.
  useEffect(() => {
    if (!dialogOpen || currentFase !== "actual" || parcelasManuais) return;
    if (!condPag || valorPedidoForm <= 0 || !linhasCondicao) {
      setParcelas([]);
      setErroCalculoParcelas(null);
      return;
    }
    try {
      const resumo = (condicoes as any[]).find((c) => c.codigo === condPag) ?? {};
      const linhas = linhasCondicao.length > 0 ? linhasCondicao : linhasDoResumo(resumo);
      setParcelas(calcularParcelasProjeto(linhas, valorPedidoForm, dataBaseParcelas));
      setErroCalculoParcelas(null);
    } catch (err: any) {
      setParcelas([]);
      setErroCalculoParcelas(err?.message || "Não foi possível calcular as parcelas.");
    }
  }, [dialogOpen, currentFase, parcelasManuais, condPag, valorPedidoForm, linhasCondicao, dataBaseParcelas, condicoes]);

  function editarParcelas(novas: ParcelaProjeto[]) {
    setParcelas(novas);
    setParcelasManuais(true);
  }

  function trocarDataEntrega(nova: string) {
    setDataEntrega(nova);
    // Editadas à mão contando da entrega: os vencimentos ficam, os "dias" da 1ª acompanham.
    if (parcelasManuais && baseParcelas === "Data da Entrega" && ehDataValida(nova)) {
      setParcelas((ps) => recalcularDias(ps, nova));
    }
  }

  function trocarBaseParcelas(nova: BaseParcelasProjeto) {
    if (nova === baseParcelas) return;
    setBaseParcelas(nova);
    setParcelasManuais(false); // trocar a base é decisão explícita: refaz do zero
  }

  // ── Etapa (L11 — Rastreio de Compras, só informativa) ──
  const temPedidoNoAlvo = useMemo(
    () => (requisicoes as any[]).some((r) => r.fase === "actual" && !!r.numero_pedido_alvo),
    [requisicoes],
  );
  const { data: etapas, error: erroEtapas } = useQuery({
    queryKey: ["projeto-etapas", projetoId],
    queryFn: async () => {
      const r = await listarEtapasDoProjeto(projetoId!);
      if (falhou(r)) throw new Error(descricaoErro(r));
      return r.dados;
    },
    enabled: !!projetoId && temPedidoNoAlvo,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const etapaPorNumero = useMemo(() => new Map((etapas?.pedidos ?? []).map((e) => [e.numero, e])), [etapas]);
  const etapasAtualizadoEm = etapas?.atualizado_em ? format(new Date(etapas.atualizado_em), "dd/MM 'às' HH:mm") : null;

  // ── Open-load do Alvo (L7-A) ──────────────────────────────────────────────
  // Roda UMA vez por abertura do projeto, só para linhas com numero_pedido_alvo.
  // Lê pelo erp-proxy (conta de serviço) e persiste via RPC. Um 404 aqui NÃO
  // marca exclusão — só acende o aviso na linha (ver REGRA DURA no service).
  const [syncAlvoRodando, setSyncAlvoRodando] = useState(false);
  const jaSincronizou = useRef<string | null>(null);

  useEffect(() => {
    if (!projetoId || !requisicoes) return;
    if (jaSincronizou.current === projetoId) return;

    const comPedidoAlvo = (requisicoes as Array<{ id: string; numero_pedido_alvo?: string | null }>).filter(
      (r) => !!r.numero_pedido_alvo,
    );
    if (comPedidoAlvo.length === 0) return;

    jaSincronizou.current = projetoId;
    setSyncAlvoRodando(true);

    sincronizarPedidosDoProjeto(comPedidoAlvo)
      .then((resultados) => {
        const ausentes = resultados.filter((r) => !r.encontrado);
        if (ausentes.length > 0) {
          // Aviso, não veredito: pode ser instabilidade do ERP.
          toast({
            title: `${ausentes.length} pedido(s) não encontrado(s) no ERP`,
            description: `Nº ${ausentes.map((a) => a.numero).join(", ")}. Os dados do Hub foram preservados — confira no Alvo antes de concluir que foram excluídos.`,
            variant: "destructive",
          });
        }

        // Leitura que não chegou a gravar precisa aparecer: senão a tela mostra
        // dados velhos como se fossem atuais (foi o que aconteceu na 1ª versão).
        const naoGravados = resultados.filter((r) => !r.persistido);
        if (naoGravados.length > 0) {
          toast({
            title: "Status do ERP não pôde ser atualizado",
            description: `Nº ${naoGravados.map((n) => n.numero).join(", ")}: ${naoGravados[0].erro ?? "erro desconhecido"}. Os dados exibidos podem estar desatualizados.`,
            variant: "destructive",
          });
        }

        queryClient.invalidateQueries({ queryKey: ["projeto-requisicoes", projetoId] });
      })
      .catch((err) => console.error("[open-load] falha geral na sincronização com o Alvo:", err))
      .finally(() => setSyncAlvoRodando(false));
  }, [projetoId, requisicoes, queryClient]);

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
    setArquivosNovos([]);
    setDataEntrega(somarDias(hojeYMD(), DIAS_ENTREGA_PADRAO));
    setBaseParcelas(BASE_PARCELAS_PROJETO_PADRAO);
    setParcelas([]);
    setParcelasManuais(false);
    setErroCalculoParcelas(null);
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
    // L11: pedido anterior às parcelas (sem entrega gravada) abre com o padrão.
    const entrega = ehDataValida(r.data_entrega) ? r.data_entrega : somarDias(hojeYMD(), DIAS_ENTREGA_PADRAO);
    const base = r.data_base_parcelas ? normalizarBaseParcelas(r.data_base_parcelas) : BASE_PARCELAS_PROJETO_PADRAO;
    setDataEntrega(entrega);
    setBaseParcelas(base);
    setErroCalculoParcelas(null);
    if (r.parcelas_manuais && Array.isArray(r.parcelas) && r.parcelas.length > 0) {
      // "dias" refeitos contra a data base de HOJE — os vencimentos gravados ficam.
      const baseHoje = base === "Data da Entrega" ? entrega : hojeYMD();
      setParcelas(recalcularDias(r.parcelas as ParcelaProjeto[], baseHoje));
      setParcelasManuais(true);
    } else {
      setParcelas([]);
      setParcelasManuais(false);
    }
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
    // Preenchimento e unicidade ANTES da soma: uma linha em branco a 0% mantém a
    // soma em 100 e passaria despercebida até o ERP recusar com
    // `Friendly_Message_UQ_PK`. Mesma função usada pelo último portão em
    // `alvoProjetoPedidoService.validar()` — uma regra, dois consumidores.
    if (classeRateio.length > 0) {
      const problemaRateio = validarLinhasRateio(classeRateio);
      if (problemaRateio) {
        toast({ title: "Rateio inválido", description: problemaRateio, variant: "destructive" });
        return;
      }
    }
    if (classeRateio.length > 0 && Math.abs(totalRateio - 100) > 0.01) {
      toast({ title: "Rateio deve somar 100%", variant: "destructive" });
      return;
    }

    const vt = validItens.reduce((s, i) => s + i.quantidade * i.valor_unitario, 0);

    // L11: entrega e parcelas (Actual). Sem condição escolhida não há parcelas —
    // o envio recusa depois, como já fazia.
    if (currentFase === "actual") {
      if (!ehDataValida(dataEntrega)) {
        toast({ title: "Informe a Data da Entrega", variant: "destructive" });
        return;
      }
      if (dataEntrega < hojeYMD() && dataEntrega !== editingReq?.data_entrega) {
        toast({ title: "A Data da Entrega não pode ser anterior a hoje", variant: "destructive" });
        return;
      }
      if (condPag && parcelas.length > 0) {
        const problema = validarParcelas(parcelas, Math.round(vt * 100) / 100, {
          hoje: parcelasManuais ? hojeYMD() : undefined,
        });
        if (problema) {
          toast({ title: "Parcelas inválidas", description: problema, variant: "destructive" });
          return;
        }
      }
    }

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

    // status, sequencia e criado_por são responsabilidade da RPC — não se envia daqui.
    const dados: DadosPedido = {
      descricao,
      fornecedor_codigo: fornecedor?.codigo || null,
      fornecedor_nome: fornecedor?.nome || null,
      fornecedor_cnpj: fornecedor?.cnpj || null,
      cond_pagamento_codigo: condPag || null,
      cond_pagamento_nome: condNome,
      itens: validItens,
      classe_rateio: classeRateio,
      valor_total: vt,
      fase: currentFase,
      ...(currentFase === "actual"
        ? {
            data_entrega: dataEntrega,
            data_base_parcelas: baseParcelas,
            parcelas: condPag ? parcelas : [],
            parcelas_manuais: !!condPag && parcelas.length > 0 && parcelasManuais,
          }
        : {}),
    };

    const res = await salvarPedido(projetoId!, editingReq?.id ?? null, dados);
    setSaving(false);

    // R-1: success !== true é falha. Não fecha o modal e não invalida query —
    // o usuário precisa corrigir sem perder o que digitou.
    if (falhou(res)) {
      toast({
        title: res.codigo === "teto_excedido" ? "Orçamento excedido" : "Erro ao salvar",
        description: descricaoErro(res),
        variant: "destructive",
      });
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

        if (chaveRateio(budgetOriginal.classe_rateio as any[]) !== chaveRateio(classeRateio)) {
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
          // O pedido já foi salvo pela RPC; a falha aqui não desfaz nada, mas não
          // pode ser silenciosa (R-1) — senão o relatório de desvios fica incompleto
          // sem ninguém saber.
          const { error: errAuditoria } = await supabase.from("projeto_pedido_auditoria").insert(alteracoes);
          if (errAuditoria) {
            console.error("[Auditoria] desvios Actual × Budget não registrados:", errAuditoria);
            toast({
              title: "Pedido salvo, mas os desvios em relação ao Budget não foram registrados",
              description: errAuditoria.message,
              variant: "destructive",
            });
          } else {
            console.log(`[Auditoria] ${alteracoes.length} desvio(s) registrado(s)`);
          }
        }
      }
    }

    // L9: anexos escolhidos no modal sobem depois que o pedido existe (o caminho
    // do arquivo leva o id do pedido). Falha de um anexo não desfaz o pedido salvo.
    const pedidoId: string | undefined = editingReq?.id ?? (res.dados.pedido as { id?: string })?.id;
    if (currentFase === "actual" && arquivosNovos.length > 0) {
      if (!pedidoId) {
        toast({
          title: "Pedido salvo, mas os anexos não foram incluídos",
          description: "Abra o pedido novamente e anexe os arquivos.",
          variant: "destructive",
        });
      } else {
        setSaving(true);
        const anexo = await anexarArquivos(projetoId!, pedidoId, arquivosNovos);
        setSaving(false);
        if (anexo.falhas.length > 0) {
          toast({
            title: `${anexo.anexados.length} de ${arquivosNovos.length} anexo(s) incluído(s)`,
            description: anexo.falhas.join(" · "),
            variant: "destructive",
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["projeto-arquivos", projetoId] });
    }

    setDialogOpen(false);
    resetForm();
    queryClient.invalidateQueries({ queryKey: ["projeto-requisicoes", projetoId] });
    queryClient.invalidateQueries({ queryKey: ["projetos-usage"] });
  }

  /** Arquivos escolhidos no modal: validados agora, enviados ao salvar. */
  function escolherArquivos(e: React.ChangeEvent<HTMLInputElement>, jaAnexados: number) {
    const escolhidos = Array.from(e.target.files || []);
    e.target.value = "";
    if (escolhidos.length === 0) return;
    const problema = validarAnexos(escolhidos, jaAnexados + arquivosNovos.length);
    if (problema) {
      toast({ title: "Anexo não incluído", description: problema, variant: "destructive" });
      return;
    }
    setArquivosNovos((prev) => [...prev, ...escolhidos]);
  }

  async function handleRemoverAnexo(a: ArquivoPedidoProjeto) {
    setRemovendoAnexo(a.id);
    const r = await removerAnexo(a);
    setRemovendoAnexo(null);
    if (r.ok === false) {
      toast({ title: "Erro ao remover anexo", description: r.erro, variant: "destructive" });
      return;
    }
    toast({ title: "Anexo removido" });
    queryClient.invalidateQueries({ queryKey: ["projeto-arquivos", projetoId] });
  }

  /** Abre o anexo num link temporário. A aba é aberta antes do await para o navegador não bloquear. */
  async function abrirAnexo(a: ArquivoPedidoProjeto) {
    const aba = window.open("about:blank", "_blank");
    try {
      const url = await urlTemporariaAnexo(a.storage_path);
      if (aba) aba.location.href = url;
      else window.location.assign(url);
    } catch (err: any) {
      aba?.close();
      toast({ title: "Não foi possível abrir o anexo", description: err?.message, variant: "destructive" });
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const caminhosAnexos = (arquivosPorPedido[deleteTarget.id] || []).map((a) => a.storage_path);
    const res = await excluirPedido(deleteTarget.id);
    // R-1: só invalida as queries quando o banco confirmou a exclusão.
    if (falhou(res)) {
      toast({ title: "Erro ao excluir", description: descricaoErro(res), variant: "destructive" });
    } else {
      toast({ title: "Pedido de compra excluído!" });
      // os registros dos anexos saíram junto (cascata); os arquivos saem da pasta agora
      await limparArquivosDePedidoExcluido(caminhosAnexos);
      queryClient.invalidateQueries({ queryKey: ["projeto-requisicoes", projetoId] });
      queryClient.invalidateQueries({ queryKey: ["projeto-arquivos", projetoId] });
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
    if (result.success && result.error) {
      // Pedido entrou no ERP mas o Hub não registrou o status: NÃO é sucesso limpo.
      // Era exatamente este o caso que passava batido antes (achado A-2).
      toast({
        title: "Enviado ao Alvo, mas o Hub não registrou",
        description: result.error,
        variant: "destructive",
      });
    } else if (result.success) {
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
      // 1. Muda fase no banco via RPC
      const { data, error } = await (supabase as any).rpc("enviar_budget_para_aprovacao", {
        p_projeto_id: projetoId,
      });
      if (error) throw error;

      // 2. Chama Edge Function de email (não-bloqueante para o status, mas reporta erro)
      let emailEnviado = false;
      let emailError: string | null = null;
      let avisoTimestamp: string | null = null;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        if (!accessToken) throw new Error("Sessão expirada — faça login novamente");

        const resp = await fetch("https://hbtggrbauguukewiknew.supabase.co/functions/v1/notify-aprovador-budget", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            projeto_id: data?.projeto_id,
            projeto_nome: data?.projeto_nome,
            aprovador_email: data?.aprovador_email,
            aprovador_nome: data?.aprovador_nome,
            responsavel_email: data?.responsavel_email,
            total_budget: data?.total_budget,
            orcamento: data?.orcamento,
            count_pedidos: data?.count_pedidos,
          }),
        });

        const result = await resp.json();
        if (!resp.ok || !result.success) {
          throw new Error(result?.error || `Falha no envio do email (HTTP ${resp.status})`);
        }
        emailEnviado = true;

        // 3. Registra timestamp do envio via RPC (A-7 / D-15).
        // O .upsert() anterior falhava em silêncio para não-admin: neste ponto a
        // fase já é 'budget_em_aprovacao' e a policy de UPDATE não cobre o
        // responsável. Aqui o erro é logado e vai junto no toast — o e-mail já
        // saiu, então não é motivo para alarmar como falha do envio.
        const marcado = await marcarEmailAprovacao(projetoId);
        if (falhou(marcado)) {
          console.error("[handleEnviarParaAprovacao] e-mail enviado, timestamp não registrado:", marcado);
          avisoTimestamp = descricaoErro(marcado);
        }
      } catch (emailErr: any) {
        emailError = emailErr?.message || String(emailErr);
        console.error("[handleEnviarParaAprovacao] Falha ao enviar email:", emailError);
      }

      // 4. Toast unificado
      if (emailEnviado) {
        toast({
          title: "Enviado para aprovação!",
          description:
            `Email enviado para ${data?.aprovador_nome || data?.aprovador_email || "aprovador"}.` +
            (avisoTimestamp ? ` (registro do envio não gravado: ${avisoTimestamp})` : ""),
        });
      } else {
        toast({
          title: "Status atualizado, mas falha no email",
          description: `Aprovador ${data?.aprovador_email || ""} pode não ter sido notificado: ${emailError}`,
          variant: "destructive",
        });
      }

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

  const clipeAnexos = (r: any) => {
    const n = arquivosPorPedido[r.id]?.length ?? 0;
    if (n === 0) return null;
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 text-xs font-normal text-muted-foreground"
        title={`${n} anexo(s)`}
      >
        <Paperclip className="h-3 w-3" />
        {n}
      </span>
    );
  };

  const toggleLinha = (id: string) => setExpandedRow((atual) => (atual === id ? null : id));

  // ── Ações de uma linha: enviar ao ERP / editar / excluir ──
  const acoesPedido = (r: any, canEditRow: boolean) => (
    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
      {canSendToAlvo(r) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-primary hover:text-primary"
              disabled={enviando === r.id}
              onClick={() => setEnviarTarget(r)}
            >
              {enviando === r.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : r.status === "erro" ? (
                <RefreshCw className="h-3.5 w-3.5" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span className="sr-only">{r.status === "erro" ? "Reenviar ao ERP" : "Enviar ao ERP"}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{r.status === "erro" ? "Reenviar ao ERP" : "Enviar ao ERP"}</TooltipContent>
        </Tooltip>
      )}
      {canEditRow && (r.status !== "enviado" || isAdmin) && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(r)}>
                <Pencil className="h-3.5 w-3.5" />
                <span className="sr-only">Editar pedido</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Editar pedido</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-danger"
                onClick={() => setDeleteTarget(r)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">Excluir pedido</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Excluir pedido</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );

  // ── Situação no Hub (livro): rascunho / enviado / erro ──
  const celulaSituacao = (r: any) => {
    const st = STATUS_PEDIDO[r.status] || STATUS_PEDIDO.rascunho;
    return (
      <div className="flex items-center gap-1">
        <StatusChip tom={st.tom}>{st.label}</StatusChip>
        {r.status === "erro" && r.erro_envio && (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 cursor-help text-danger" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              {r.erro_envio}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  };

  // ── Situação no ERP (espelho): vem de src/lib/statusPedido.ts, fonte única do Hub;
  //    null enquanto o open-load não trouxe dados do Alvo. ──
  const celulaErp = (r: any) => {
    const sa = getStatusAlvoDoPedido(r);
    const IconAlvo = sa?.Icon;
    if (!sa && !r.alvo_nao_encontrado_em) return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <div className="flex items-center gap-1">
        {sa && IconAlvo && (
          <Tooltip>
            {/* span: o Badge não repassa ref, e o Tooltip precisa dela para se posicionar */}
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help">
                <Badge
                  variant="outline"
                  className={`${sa.className} whitespace-nowrap rounded px-1.5 py-0 text-[11px] font-medium leading-5`}
                >
                  <IconAlvo className={`mr-1 h-3 w-3 ${sa.iconAnimate ? "animate-spin" : ""}`} />
                  {sa.label}
                </Badge>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              {sa.tooltip}
              {r.alvo_synced_at && (
                <div className="mt-1 opacity-70">
                  Lido do ERP em {format(new Date(r.alvo_synced_at), "dd/MM/yyyy HH:mm")}
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        )}
        {r.alvo_nao_encontrado_em && (
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 cursor-help text-warning" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              Não encontrado no ERP na última leitura ({format(new Date(r.alvo_nao_encontrado_em), "dd/MM/yyyy HH:mm")}
              ). Os dados do Hub foram preservados — confirme no Alvo antes de concluir que o pedido foi excluído.
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  };

  // ── Etapa (espelho do Rastreio de Compras — informativa, atualizada de hora em hora) ──
  const celulaEtapa = (r: any) => {
    if (!r.numero_pedido_alvo) return <span className="text-xs text-muted-foreground">—</span>;
    const e = etapaPorNumero.get(r.numero_pedido_alvo);
    const fonte = etapasAtualizadoEm
      ? `Rastreio de Compras · dados de ${etapasAtualizadoEm} (atualiza de hora em hora)`
      : "Rastreio de Compras (atualiza de hora em hora)";
    if (!e) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help whitespace-nowrap text-xs text-muted-foreground">
              {erroEtapas ? "—" : "Aguardando atualização"}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            {erroEtapas
              ? `Etapa indisponível: ${(erroEtapas as Error).message}`
              : `Este pedido ainda não apareceu no ${fonte}. Pedido recém-enviado entra na próxima atualização.`}
          </TooltipContent>
        </Tooltip>
      );
    }
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help">
            <StatusChip tom={tomEtapa(e.etapa)}>{e.etapa}</StatusChip>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {e.qtd_nf > 1 && <div>{e.qtd_nf} NFs ligadas — mostra a etapa menos avançada.</div>}
          {e.qtd_nf === 1 && <div>1 NF ligada.</div>}
          <div className="opacity-70">{fonte}. Só informativo.</div>
        </TooltipContent>
      </Tooltip>
    );
  };

  // ── Detalhe de um pedido (linha expandida): itens, rateio e dados do envio ──
  const detalhePedido = (r: any, fase: "budget" | "actual") => {
    const rItens = (r.itens as any[]) || [];
    const rClasse = (r.classe_rateio as any[]) || [];
    const th = "px-2 py-1.5 font-medium";
    return (
      <div className="space-y-3">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Itens</h4>
            <div className="overflow-x-auto rounded border border-border bg-card">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className={`${th} text-left`}>Produto</th>
                    <th className={`${th} text-left`}>Un.</th>
                    <th className={`${th} text-right`}>Qtd</th>
                    <th className={`${th} text-right`}>Vlr unit.</th>
                    <th className={`${th} text-right`}>Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rItens.map((it: any, idx: number) => (
                    <tr key={idx}>
                      <td className="px-2 py-1.5">
                        {it.codigoProduto || it.codigo_produto ? (
                          <>
                            <span className="font-mono text-muted-foreground">
                              {it.codigoProduto || it.codigo_produto}
                            </span>{" "}
                            {it.descricao}
                          </>
                        ) : (
                          it.descricao
                        )}
                      </td>
                      <td className="px-2 py-1.5">{it.unidade}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{it.quantidade}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {fmtMoeda(Number(it.valor_unitario) || 0)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">
                        {fmtMoeda((Number(it.quantidade) || 0) * (Number(it.valor_unitario) || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="min-w-0">
            <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Rateio — classe × centro de custo
            </h4>
            {rClasse.length === 0 ? (
              <p
                className={`rounded border border-dashed border-border px-2 py-2 text-xs ${fase === "actual" ? "text-warning" : "text-muted-foreground"}`}
              >
                Sem rateio.{fase === "actual" ? " Obrigatório para enviar ao ERP." : ""}
              </p>
            ) : (
              <div className="overflow-x-auto rounded border border-border bg-card">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className={`${th} text-left`}>Classe</th>
                      <th className={`${th} text-left`}>Centro de custo</th>
                      <th className={`${th} text-right`}>%</th>
                      <th className={`${th} text-right`}>Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rClasse.map((c: any, idx: number) => (
                      <tr key={idx}>
                        <td className="px-2 py-1.5">
                          <span className="font-mono text-muted-foreground">{c.classe_codigo}</span> {c.classe_nome}
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="font-mono text-muted-foreground">{c.centro_custo_codigo}</span>{" "}
                          {c.centro_custo_nome}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{c.percentual}%</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {fmtMoeda((Number(c.percentual) / 100) * Number(r.valor_total))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        {(arquivosPorPedido[r.id]?.length ?? 0) > 0 && (
          <div>
            <h4 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Anexos</h4>
            <div className="flex flex-wrap gap-2">
              {arquivosPorPedido[r.id].map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => abrirAnexo(a)}
                  className="inline-flex max-w-[280px] items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-xs hover:bg-muted"
                  title={
                    a.enviado_alvo_em
                      ? `Enviado ao Alvo no pedido ${a.numero_alvo_ao_enviar ?? ""}`
                      : "Ainda não enviado ao ERP"
                  }
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{a.nome_original}</span>
                  <span className="shrink-0 text-muted-foreground">{fmtTamanho(a.tamanho_bytes)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          {r.numero_pedido_alvo && (
            <span>
              Pedido no Alvo: <span className="font-mono text-foreground">{r.numero_pedido_alvo}</span>
            </span>
          )}
          {r.enviado_alvo_em && (
            <span>
              Enviado em {format(new Date(r.enviado_alvo_em), "dd/MM/yyyy HH:mm")}
              {r.enviado_alvo_por ? ` por ${r.enviado_alvo_por}` : ""}
            </span>
          )}
          {r.cond_pagamento_nome && <span>Cond. pagamento: {r.cond_pagamento_nome}</span>}
          {fase === "actual" && ehDataValida(r.data_entrega) && <span>Entrega: {fmtDataBR(r.data_entrega)}</span>}
          {fase === "actual" && r.parcelas_manuais && Array.isArray(r.parcelas) && r.parcelas.length > 0 && (
            <span>
              Parcelas (editadas):{" "}
              {(r.parcelas as ParcelaProjeto[])
                .map((pp) => `${fmtDataBR(pp.data_vencimento)} ${fmtMoeda(Number(pp.valor_parcela) || 0)}`)
                .join(" · ")}
            </span>
          )}
          {fase === "actual" && !r.parcelas_manuais && r.status !== "enviado" && r.cond_pagamento_codigo && (
            <span>Parcelas: calculadas pela condição no envio</span>
          )}
          {r.fornecedor_cnpj && <span>CNPJ: {r.fornecedor_cnpj}</span>}
          {r.alvo_synced_at && (
            <span>Status lido do ERP em {format(new Date(r.alvo_synced_at), "dd/MM/yyyy HH:mm")}</span>
          )}
        </div>
        {r.erro_envio && <p className="text-xs text-danger">Erro no último envio: {r.erro_envio}</p>}
      </div>
    );
  };

  // ── Grade de pedidos de uma fase (desktop: tabela; mobile: lista compacta) ──
  const renderPedidosTable = (pedidos: any[], fase: "budget" | "actual") => {
    if (loadingReqs) {
      return (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (pedidos.length === 0) {
      return <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum pedido de compra cadastrado.</p>;
    }

    const total = pedidos.reduce((s: number, r: any) => s + (Number(r.valor_total) || 0), 0);
    const colunas = fase === "actual" ? 8 : 5;
    const colunasRotulo = fase === "actual" ? 2 : 3;
    const podeEditar = (r: any) => (fase === "budget" ? canEditBudget : canEditActualRow(r));

    return (
      <>
        {/* Mobile */}
        <div className="divide-y divide-border md:hidden">
          {pedidos.map((r: any) => {
            const isExpanded = expandedRow === r.id;
            return (
              <div key={r.id}>
                <div
                  className="flex cursor-pointer items-start justify-between gap-2 px-3 py-2.5"
                  onClick={() => toggleLinha(r.id)}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      <span className="tabular-nums">#{r.sequencia}</span>
                      {fase === "actual" && celulaSituacao(r)}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{r.descricao}</span>
                      {clipeAnexos(r)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.fornecedor_nome || "Sem fornecedor"}
                      {r.numero_pedido_alvo ? ` · Alvo ${r.numero_pedido_alvo}` : ""}
                    </p>
                    {fase === "actual" && (r.status_alvo || r.alvo_nao_encontrado_em || r.numero_pedido_alvo) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {celulaErp(r)}
                        {r.numero_pedido_alvo && celulaEtapa(r)}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium tabular-nums">{fmtMoeda(Number(r.valor_total) || 0)}</p>
                    {acoesPedido(r, podeEditar(r))}
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-border bg-muted/30 px-3 py-3">{detalhePedido(r, fase)}</div>
                )}
              </div>
            );
          })}
          <div className="flex justify-between bg-muted/40 px-3 py-2 text-sm font-medium">
            <span>Total</span>
            <span className="tabular-nums">{fmtMoeda(total)}</span>
          </div>
        </div>

        {/* Desktop */}
        <div className="hidden md:block">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-9 w-16 px-3 text-xs">Seq.</TableHead>
                <TableHead className="h-9 px-3 text-xs">Pedido / fornecedor</TableHead>
                {fase === "budget" && <TableHead className="h-9 px-3 text-xs">Cond. pagto</TableHead>}
                <TableHead className="h-9 px-3 text-right text-xs">Valor</TableHead>
                {fase === "actual" && (
                  <>
                    <TableHead className="h-9 px-3 text-xs">Situação no Hub</TableHead>
                    <TableHead className="h-9 px-3 text-xs">Status no ERP</TableHead>
                    <TableHead className="h-9 px-3 text-xs" title="Funil do Rastreio de Compras — informativo">
                      Etapa
                    </TableHead>
                    <TableHead className="h-9 px-3 text-xs">Nº Alvo</TableHead>
                  </>
                )}
                <TableHead className="h-9 w-[104px] px-3" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pedidos.map((r: any) => {
                const isExpanded = expandedRow === r.id;
                return (
                  <Fragment key={r.id}>
                    <TableRow
                      className={`cursor-pointer ${isExpanded ? "bg-muted/40" : ""}`}
                      onClick={() => toggleLinha(r.id)}
                    >
                      <TableCell className="px-3 py-2 text-sm tabular-nums text-muted-foreground">
                        <div className="flex items-center gap-1">
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          {r.sequencia}
                        </div>
                      </TableCell>
                      <TableCell className={`${fase === "actual" ? "max-w-[260px]" : "max-w-[360px]"} px-3 py-2`}>
                        <p className="flex items-center gap-1.5 text-sm font-medium" title={r.descricao}>
                          <span className="truncate">{r.descricao}</span>
                          {clipeAnexos(r)}
                        </p>
                        <p className="truncate text-xs text-muted-foreground" title={r.fornecedor_nome || undefined}>
                          {r.fornecedor_nome || "Sem fornecedor"}
                        </p>
                      </TableCell>
                      {fase === "budget" && (
                        <TableCell className="whitespace-nowrap px-3 py-2 text-sm text-muted-foreground">
                          {r.cond_pagamento_nome || "—"}
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap px-3 py-2 text-right text-sm font-medium tabular-nums">
                        {fmtMoeda(Number(r.valor_total) || 0)}
                      </TableCell>
                      {fase === "actual" && (
                        <>
                          <TableCell className="px-3 py-2">{celulaSituacao(r)}</TableCell>
                          <TableCell className="px-3 py-2">{celulaErp(r)}</TableCell>
                          <TableCell className="px-3 py-2">{celulaEtapa(r)}</TableCell>
                          <TableCell className="whitespace-nowrap px-3 py-2 font-mono text-sm">
                            {r.numero_pedido_alvo || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                        </>
                      )}
                      <TableCell className="px-3 py-1">{acoesPedido(r, podeEditar(r))}</TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={colunas} className="bg-muted/30 px-4 py-3">
                          {detalhePedido(r, fase)}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
            <TableFooter className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={colunasRotulo} className="px-3 py-2 text-sm">
                  Total · {pedidos.length} pedido(s)
                </TableCell>
                <TableCell className="whitespace-nowrap px-3 py-2 text-right text-sm tabular-nums">
                  {fmtMoeda(total)}
                </TableCell>
                <TableCell colSpan={colunas - colunasRotulo - 1} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </>
    );
  };

  if (loadingProjeto) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!projeto) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <Package className="h-10 w-10" />
        <p className="text-sm">Projeto não encontrado.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/projetos")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar para Projetos
        </Button>
      </div>
    );
  }

  const projData = projeto as any;
  const saldoFase = orcamento - (faseAtual === "actual" ? totalActual : totalBudget);
  const enviadosActual = pedidosActual.filter((r: any) => r.status === "enviado").length;
  const podeCriarActual = faseAtual === "actual" && (isAdmin || (canPedidosCreate && isResponsavel));

  const secaoBudget = (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <CabecalhoSecao
        titulo="Budget — planejamento"
        subtitulo={
          <span className="tabular-nums">
            {pedidosBudget.length} pedido(s) · {fmtMoeda(totalBudget)} · {fmtPct(pctBudget)} do orçamento
            {faseAtual !== "budget" && " · aprovado, somente leitura"}
          </span>
        }
        acoes={
          canEditBudget && (
            <Button size="sm" className="h-8 gap-1" onClick={() => openCreate("budget")}>
              <Plus className="h-3.5 w-3.5" /> Novo pedido
            </Button>
          )
        }
      />
      {renderPedidosTable(pedidosBudget, "budget")}
    </section>
  );

  const secaoActual = (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <CabecalhoSecao
        titulo="Actual — execução"
        subtitulo={
          faseAtual === "actual" ? (
            <span className="inline-flex flex-wrap items-center gap-x-1 tabular-nums">
              {pedidosActual.length} pedido(s) · {fmtMoeda(totalActual)} · {enviadosActual} enviado(s) ao ERP
              {etapasAtualizadoEm && <span> · etapas do Rastreio de {etapasAtualizadoEm}</span>}
              {syncAlvoRodando && (
                <span className="inline-flex items-center gap-1">
                  · <Loader2 className="h-3 w-3 animate-spin" /> lendo status no ERP…
                </span>
              )}
            </span>
          ) : (
            "Liberado após a aprovação do Budget"
          )
        }
        acoes={
          podeCriarActual && (
            <Button size="sm" className="h-8 gap-1" onClick={() => openCreate("actual")}>
              <Plus className="h-3.5 w-3.5" /> Novo pedido
            </Button>
          )
        }
      />
      {faseAtual === "actual" ? (
        renderPedidosTable(pedidosActual, "actual")
      ) : (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {faseAtual === "budget_em_aprovacao"
            ? "Aguardando a aprovação do Budget para liberar o Actual."
            : "O Budget precisa ser aprovado para liberar o Actual."}
        </p>
      )}
    </section>
  );

  return (
    <TooltipProvider delayDuration={200}>
      {/* grid-cols-1 = minmax(0, 1fr): grade larga rola dentro do painel em vez de alargar a página */}
      <div className="grid grid-cols-1 gap-4 p-4 sm:p-6">
        {/* Cabeçalho */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => navigate("/projetos")}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Projetos
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-foreground">{projData.nome}</h1>
                <FaseChip fase={faseAtual} />
              </div>
              {projData.descricao && (
                <p className="mt-1 max-w-3xl whitespace-pre-line text-sm text-muted-foreground">{projData.descricao}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canSendForApproval && (
                <Button size="sm" onClick={handleEnviarParaAprovacao} disabled={enviandoAprovacao}>
                  {enviandoAprovacao ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Enviando…
                    </>
                  ) : (
                    <>
                      <Send className="mr-1.5 h-3.5 w-3.5" /> Enviar Budget para aprovação
                    </>
                  )}
                </Button>
              )}
              {canApproveBudget && (
                <Button size="sm" onClick={handleAprovarBudget} disabled={aprovandoBudget}>
                  {aprovandoBudget ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Aprovando…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Aprovar Budget
                    </>
                  )}
                </Button>
              )}
              {faseAtual === "budget_em_aprovacao" && !canApproveBudget && (
                <span className="inline-flex items-center gap-1.5 rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> Aguardando aprovação de{" "}
                  <span className="font-medium text-foreground">{aprovadorNome}</span>
                </span>
              )}
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div className="flex gap-1">
              <dt className="text-muted-foreground">Responsável:</dt>
              <dd className="font-medium">{responsavelNome}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="text-muted-foreground">Aprovador:</dt>
              <dd className="font-medium">{aprovadorNome}</dd>
            </div>
            {(projData.data_inicio || projData.data_fim) && (
              <div className="flex gap-1">
                <dt className="text-muted-foreground">Período:</dt>
                <dd className="tabular-nums">
                  {fmtData(projData.data_inicio)} – {fmtData(projData.data_fim)}
                </dd>
              </div>
            )}
            {projData.budget_aprovado_por && (
              <div className="flex gap-1">
                <dt className="text-muted-foreground">Budget aprovado:</dt>
                <dd>
                  {projData.budget_aprovado_por}
                  {projData.budget_aprovado_em &&
                    ` em ${format(new Date(projData.budget_aprovado_em as string), "dd/MM/yyyy HH:mm")}`}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {/* Resumo financeiro */}
        <div className="grid grid-cols-2 divide-border rounded-md border border-border bg-card lg:grid-cols-4 lg:divide-x">
          <Indicador rotulo="Orçamento" valor={fmtMoeda(orcamento)} apoio="teto das duas fases" />
          <Indicador
            rotulo="Budget (planejado)"
            valor={fmtMoeda(totalBudget)}
            apoio={`${fmtPct(pctBudget)} do orçamento · ${pedidosBudget.length} pedido(s)`}
          >
            <BarraConsumo pct={pctBudget} tom={pctBudget > 100 ? "perigo" : "neutro"} className="mt-2" />
          </Indicador>
          <Indicador
            rotulo="Actual (realizado)"
            valor={fmtMoeda(totalActual)}
            apoio={`${fmtPct(pctActual)} do orçamento · ${enviadosActual} de ${pedidosActual.length} no ERP`}
          >
            <BarraConsumo pct={pctActual} className="mt-2" />
          </Indicador>
          <Indicador
            rotulo={faseAtual === "actual" ? "Saldo do Actual" : "Saldo do Budget"}
            valor={fmtMoeda(saldoFase)}
            tom={saldoFase < 0 ? "perigo" : undefined}
            apoio="orçamento − fase corrente"
          />
        </div>

        {/* Fases: a corrente primeiro */}
        {faseAtual === "actual" ? (
          <>
            {secaoActual}
            {secaoBudget}
          </>
        ) : (
          <>
            {secaoBudget}
            {secaoActual}
          </>
        )}

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
              <DialogDescription asChild>
                <div className="flex items-center gap-2 text-xs sm:text-sm">
                  <span>{projData.nome}</span>
                  <FaseChip fase={currentFase} />
                </div>
              </DialogDescription>
            </DialogHeader>

            {editingReq?.status === "enviado" && !isAdmin && (
              <div className="mx-4 mt-4 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground sm:mx-6">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
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
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        <span className="truncate">
                          {fornecedor.nome}
                          {fornecedor.cnpj ? ` · CNPJ ${fornecedor.cnpj}` : ""}
                        </span>
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
                          <span className="text-sm font-semibold">
                            {fmtCurrency(it.quantidade * it.valor_unitario)}
                          </span>
                          {itens.length > 1 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-danger"
                              onClick={() => setItens((prev) => prev.filter((_, i) => i !== idx))}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span className="sr-only">Remover item</span>
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
                  <p className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                    Nenhuma classe adicionada.
                    {currentFase === "actual" && " O rateio é obrigatório para enviar o pedido ao ERP."}
                  </p>
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
                                        onChange={(e) =>
                                          setClasseSearch((prev) => ({ ...prev, [idx]: e.target.value }))
                                        }
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
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm tabular-nums ${
                        Math.abs(totalRateio - 100) <= 0.01
                          ? "border-border bg-muted/40 text-foreground"
                          : "border-warning/40 bg-warning/10 text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {Math.abs(totalRateio - 100) <= 0.01 ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                        )}
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

              {/* Section 3b: Entrega e parcelas (L11 — só Actual) */}
              {currentFase === "actual" &&
                (() => {
                  const podeMexer = editingReq
                    ? canEditActualRow(editingReq)
                    : faseAtual === "actual" && (isAdmin || (canPedidosCreate && isResponsavel));
                  const soma = somaParcelas(parcelas);
                  const fechou = Math.round(soma * 100) === Math.round(valorPedidoForm * 100);
                  const problema =
                    parcelas.length > 0
                      ? validarParcelas(parcelas, valorPedidoForm, { hoje: parcelasManuais ? hoje : undefined })
                      : null;
                  const nomeCond = (condicoes as any[]).find((c) => c.codigo === condPag)?.nome;
                  return (
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Entrega e parcelas
                          </h3>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {nomeCond ? (
                              <>
                                Calculadas a partir de <span className="font-medium text-foreground">{nomeCond}</span>.
                                Dá para editar vencimento, dias ou valor — vai assim para o ERP.
                              </>
                            ) : (
                              "Escolha a condição de pagamento para calcular as parcelas."
                            )}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 gap-1.5 text-xs"
                          onClick={() => setParcelasManuais(false)}
                          disabled={!podeMexer || !condPag || !parcelasManuais}
                          title="Volta às parcelas da condição de pagamento"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Recalcular do zero
                        </Button>
                      </div>

                      <div className="grid gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-[170px_1fr]">
                        <div>
                          <Label className="text-xs">Data da Entrega</Label>
                          <Input
                            type="date"
                            value={dataEntrega}
                            min={hoje}
                            onChange={(e) => trocarDataEntrega(e.target.value)}
                            disabled={!podeMexer}
                            className="mt-1 h-9"
                          />
                        </div>
                        <div className="min-w-0">
                          <Label className="text-xs">Prazos contam a partir de</Label>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {BASES_PARCELAS_PROJETO.map((b) => (
                              <Button
                                key={b.valor}
                                type="button"
                                size="sm"
                                variant={baseParcelas === b.valor ? "default" : "outline"}
                                onClick={() => trocarBaseParcelas(b.valor)}
                                disabled={!podeMexer}
                                className="h-9 text-xs"
                              >
                                {b.valor}
                                <span className="ml-1.5 tabular-nums opacity-80">
                                  {fmtDataBR(b.valor === "Data da Entrega" ? dataEntrega : hoje)}
                                </span>
                              </Button>
                            ))}
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {BASES_PARCELAS_PROJETO.find((b) => b.valor === baseParcelas)?.ajuda} Vai ao ERP como
                            "Data Base Parcelas".
                          </p>
                        </div>
                      </div>

                      {erroCalculoParcelas && (
                        <p className="flex items-center gap-1.5 text-xs text-danger">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {erroCalculoParcelas}
                        </p>
                      )}

                      {condPag && valorPedidoForm <= 0 && (
                        <p className="text-xs text-muted-foreground">Informe o valor dos itens para calcular as parcelas.</p>
                      )}

                      {condPag && carregandoCondicao && parcelas.length === 0 && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculando parcelas…
                        </p>
                      )}

                      {parcelas.length > 0 && (
                        <div className="overflow-x-auto rounded-md border border-border">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/40 text-muted-foreground">
                              <tr>
                                <th className="w-10 px-2 py-1.5 text-left font-medium">Nº</th>
                                <th className="px-2 py-1.5 text-left font-medium">Vencimento</th>
                                <th
                                  className="w-24 px-2 py-1.5 text-center font-medium"
                                  title="1ª parcela: dias depois da data base · demais: dias depois da parcela anterior"
                                >
                                  Dias
                                </th>
                                <th className="w-36 px-2 py-1.5 text-right font-medium">Valor (R$)</th>
                                <th className="w-10" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {parcelas.map((pp, idx) => (
                                <tr key={idx}>
                                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{pp.sequencia}</td>
                                  <td className="px-2 py-1.5">
                                    <Input
                                      type="date"
                                      value={pp.data_vencimento}
                                      min={hoje}
                                      onChange={(e) =>
                                        editarParcelas(alterarVencimento(parcelas, idx, e.target.value, dataBaseParcelas))
                                      }
                                      disabled={!podeMexer}
                                      className="h-8 w-[150px] text-xs"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <Input
                                      type="number"
                                      min={0}
                                      value={pp.dias_entre_parcelas}
                                      onChange={(e) =>
                                        editarParcelas(alterarDias(parcelas, idx, Number(e.target.value), dataBaseParcelas))
                                      }
                                      disabled={!podeMexer}
                                      className="h-8 text-center text-xs tabular-nums"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <Input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      value={pp.valor_parcela}
                                      onChange={(e) => editarParcelas(alterarValor(parcelas, idx, Number(e.target.value)))}
                                      disabled={!podeMexer}
                                      className="h-8 text-right text-xs tabular-nums"
                                    />
                                  </td>
                                  <td className="px-1 py-1.5 text-center">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-muted-foreground hover:text-danger"
                                      onClick={() => editarParcelas(removerParcela(parcelas, idx, dataBaseParcelas))}
                                      disabled={!podeMexer || parcelas.length === 1}
                                      title={parcelas.length === 1 ? "Pelo menos 1 parcela" : "Remover parcela"}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      <span className="sr-only">Remover parcela</span>
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="border-t border-border bg-muted/30">
                              <tr>
                                <td colSpan={3} className="px-2 py-1.5 text-right font-medium text-muted-foreground">
                                  Total das parcelas
                                </td>
                                <td
                                  className={`px-2 py-1.5 text-right font-semibold tabular-nums ${fechou ? "text-success" : "text-danger"}`}
                                >
                                  {fmtMoeda(soma)}
                                </td>
                                <td />
                              </tr>
                              <tr>
                                <td colSpan={3} className="px-2 pb-1.5 text-right text-muted-foreground">
                                  Valor do pedido
                                </td>
                                <td className="px-2 pb-1.5 text-right tabular-nums text-muted-foreground">
                                  {fmtMoeda(valorPedidoForm)}
                                </td>
                                <td />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}

                      {parcelas.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => editarParcelas(adicionarParcela(parcelas, dataBaseParcelas, valorPedidoForm))}
                            disabled={!podeMexer}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Adicionar parcela
                          </Button>
                          {parcelasManuais ? (
                            <span className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground">
                              Editadas à mão — vão ao ERP exatamente assim. "Recalcular do zero" volta à condição.
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              Automáticas — no envio são recalculadas com a data do dia.
                            </span>
                          )}
                        </div>
                      )}

                      {problema && (
                        <p className="flex items-center gap-1.5 text-xs text-danger">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          {problema}
                        </p>
                      )}
                    </div>
                  );
                })()}

              {/* Section 4: Anexos (L9 — só Actual) */}
              {currentFase === "actual" &&
                (() => {
                  const existentes = editingReq ? arquivosPorPedido[editingReq.id] || [] : [];
                  const podeMexer = editingReq
                    ? canEditActualRow(editingReq)
                    : faseAtual === "actual" && (isAdmin || (canPedidosCreate && isResponsavel));
                  const total = existentes.length + arquivosNovos.length;
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Anexos
                          </h3>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Até {MAX_ANEXOS_PEDIDO} arquivos PDF, JPG ou PNG de até 5 MB. Vão junto com o pedido para o
                            ERP.
                          </p>
                        </div>
                        {podeMexer && total < MAX_ANEXOS_PEDIDO && (
                          <Button variant="outline" size="sm" className="h-8 shrink-0 cursor-pointer text-xs" asChild>
                            <label>
                              <Paperclip className="mr-1 h-3 w-3" /> Anexar arquivo
                              <input
                                type="file"
                                className="sr-only"
                                accept={ACCEPT_ANEXOS}
                                multiple
                                onChange={(e) => escolherArquivos(e, existentes.length)}
                              />
                            </label>
                          </Button>
                        )}
                      </div>
                      {total === 0 ? (
                        <p className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                          Nenhum anexo.
                        </p>
                      ) : (
                        <ul className="divide-y divide-border rounded border border-border">
                          {existentes.map((a) => (
                            <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <button
                                type="button"
                                className="min-w-0 flex-1 truncate text-left hover:underline"
                                onClick={() => abrirAnexo(a)}
                              >
                                {a.nome_original}
                              </button>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {fmtTamanho(a.tamanho_bytes)}
                                {a.enviado_alvo_em ? ` · no Alvo (${a.numero_alvo_ao_enviar ?? "—"})` : ""}
                              </span>
                              {podeMexer && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-muted-foreground hover:text-danger"
                                  disabled={removendoAnexo === a.id}
                                  onClick={() => handleRemoverAnexo(a)}
                                >
                                  {removendoAnexo === a.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-3.5 w-3.5" />
                                  )}
                                  <span className="sr-only">Remover anexo</span>
                                </Button>
                              )}
                            </li>
                          ))}
                          {arquivosNovos.map((f, idx) => (
                            <li key={`novo-${idx}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate">{f.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {fmtTamanho(f.size)} · será anexado ao salvar
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-danger"
                                onClick={() => setArquivosNovos((prev) => prev.filter((_, i) => i !== idx))}
                              >
                                <X className="h-3.5 w-3.5" />
                                <span className="sr-only">Retirar arquivo</span>
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()}
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
                Criar no Alvo o pedido de compra #{enviarTarget?.sequencia} "{enviarTarget?.descricao}" (
                {fmtMoeda(Number(enviarTarget?.valor_total) || 0)})
                {(arquivosPorPedido[enviarTarget?.id]?.length ?? 0) > 0 &&
                  `, com ${arquivosPorPedido[enviarTarget.id].length} anexo(s)`}
                ? Esta ação não pode ser desfeita.
                {enviarTarget && (
                  <span className="mt-2 block text-xs">
                    {ehDataValida(enviarTarget.data_entrega) && `Entrega ${fmtDataBR(enviarTarget.data_entrega)} · `}
                    {enviarTarget.parcelas_manuais && (enviarTarget.parcelas?.length ?? 0) > 0
                      ? `Parcelas editadas: ${(enviarTarget.parcelas as ParcelaProjeto[])
                          .map((pp) => `${fmtDataBR(pp.data_vencimento)} ${fmtMoeda(Number(pp.valor_parcela) || 0)}`)
                          .join(" · ")}`
                      : `Parcelas calculadas agora pela condição (${enviarTarget.cond_pagamento_nome || "—"}), contando de ${
                          enviarTarget.data_base_parcelas === "Data da Entrega" && ehDataValida(enviarTarget.data_entrega)
                            ? `${fmtDataBR(enviarTarget.data_entrega)} (entrega)`
                            : "hoje"
                        }.`}
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleEnviarAlvo}>Enviar ao ERP</AlertDialogAction>
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
    </TooltipProvider>
  );
}
