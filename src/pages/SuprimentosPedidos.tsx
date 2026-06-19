import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  Plus,
  ShoppingCart,
  Loader2,
  User as UserIcon,
  Building2,
  Calendar as CalendarIcon,
  Package,
  X,
  FileText,
  Pencil,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  LayoutGrid,
  List,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
} from "lucide-react";
import { getStatusPedido } from "@/lib/statusPedido";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Home } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// ════════════════════════════════════════════════════════════
// STATUS CONFIG
// ════════════════════════════════════════════════════════════

const STATUS_LOCAL_CONFIG: Record<string, { label: string; className: string }> = {
  rascunho: { label: "Rascunho", className: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30" },
  enviando: { label: "Enviando…", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  enviado_alvo: {
    label: "Enviado ao ERP",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  },
  erro_envio: { label: "Erro no envio", className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
  sincronizado: {
    label: "Sincronizado",
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  },
};

const STATUS_ALVO_CONFIG: Record<string, string> = {
  Aberto: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  Pendente: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  Cancelado: "bg-red-500/10 text-red-700 border-red-500/20",
  Encerrado: "bg-slate-500/10 text-slate-700 border-slate-500/20",
};

// ════════════════════════════════════════════════════════════
// FORMATADORES
// ════════════════════════════════════════════════════════════

function formatBRL(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor));
}

// Formata datas para exibição (dd/MM/yyyy).
//
// CUIDADO COM FUSO HORÁRIO: campos do tipo `date` no banco chegam como
// string pura "YYYY-MM-DD" (sem hora). Se passados direto por new Date(),
// o JS interpreta como MEIA-NOITE UTC e, no fuso de Brasília (UTC−3), a
// data "volta" para o dia anterior (ex.: 17/06 vira 16/06). Para evitar
// isso, quando a entrada é uma data pura nós a parseamos com componentes
// LOCAIS (new Date(ano, mes-1, dia)), sem nenhuma conversão de fuso.
// Timestamps completos com offset (ex.: updated_at "2026-06-17T14:00:00+00")
// continuam indo pelo new Date() normal, que os interpreta corretamente.
function formatData(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const apenasData = iso.slice(0, 10); // "2026-06-17" (ignora hora, se houver)
    // Detecta data pura no formato YYYY-MM-DD (10 chars, dois hífens).
    if (/^\d{4}-\d{2}-\d{2}$/.test(apenasData)) {
      const [ano, mes, dia] = apenasData.split("-").map(Number);
      if (ano && mes && dia) {
        const d = new Date(ano, mes - 1, dia); // construtor LOCAL — sem UTC
        return format(d, "dd/MM/yyyy", { locale: ptBR });
      }
    }
    // Fallback para timestamps completos com fuso (ex.: updated_at/created_at).
    return format(new Date(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return "—";
  }
}

// ════════════════════════════════════════════════════════════
// CONFIG DE VISUALIZAÇÃO (Cards/Lista) + ORDENAÇÃO
// ════════════════════════════════════════════════════════════

const VIEW_STORAGE_KEY = "suprimentos_pedidos_view";

type ViewMode = "cards" | "lista";
type SortDir = "asc" | "desc";

// Colunas da tabela. `sortField` = coluna real no banco para ordenação
// SERVER-SIDE (varre todos os registros, coerente em toda a paginação).
// `sortable: false` → cabeçalho não clicável (ex.: Status, que é calculado
// pelo getStatusPedido a partir de vários campos e não tem coluna única).
const COLUNAS_PEDIDOS: Array<{
  key: string;
  label: string;
  className?: string;
  sortable: boolean;
  sortField?: string;
  render: (p: any) => any;
}> = [
  { key: "numero", label: "Nº", sortable: true, sortField: "numero", render: (p) => p.numero },
  { key: "data_pedido", label: "Data", sortable: true, sortField: "data_pedido", render: (p) => p.data_pedido },
  { key: "status", label: "Status", sortable: false, render: (p) => getStatusPedido(p).label },
  {
    key: "nome_entidade",
    label: "Fornecedor",
    sortable: true,
    sortField: "nome_entidade",
    render: (p) => p.nome_entidade,
  },
  {
    key: "valor_total",
    label: "Valor total",
    className: "text-right",
    sortable: true,
    sortField: "valor_total",
    render: (p) => p.valor_total,
  },
  {
    key: "codigo_usuario",
    label: "Comprador",
    sortable: true,
    sortField: "codigo_usuario",
    render: (p) => p.codigo_usuario,
  },
  {
    key: "proximo_aprovador",
    label: "Próximo aprovador",
    sortable: true,
    sortField: "proximo_aprovador",
    render: (p) => p.proximo_aprovador,
  },
  {
    key: "primeiro_vencimento",
    label: "Primeiro Vcto",
    sortable: true,
    sortField: "primeiro_vencimento",
    render: (p) => p.primeiro_vencimento,
  },
];

export default function SuprimentosPedidos() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const podeVerTodos = useHasPermission(PERMISSIONS.COMPRAS_PEDIDOS_VIEW_ALL);
  const podeCriar = useHasPermission(PERMISSIONS.COMPRAS_PEDIDOS_CREATE);

  // Busca textual com debounce de 300ms (server-side via ilike)
  const [buscaInput, setBuscaInput] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(buscaInput.trim()), 300);
    return () => clearTimeout(t);
  }, [buscaInput]);

  const [filtroStatusLocal, setFiltroStatusLocal] = useState("todos");
  const [filtroOrigem, setFiltroOrigem] = useState("todos");
  const [filtroDataInicio, setFiltroDataInicio] = useState<Date | undefined>(undefined);
  const [filtroDataFim, setFiltroDataFim] = useState<Date | undefined>(undefined);
  const [filtroComprador, setFiltroComprador] = useState("todos");

  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "cards";
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return saved === "lista" ? "lista" : "cards";
  });

  const trocarView = (novo: ViewMode) => {
    setView(novo);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, novo);
    } catch {
      /* ignora se localStorage indisponível */
    }
  };

  // ── Ordenação SERVER-SIDE unificada ─────────────────────────────────
  // Um único estado: qual campo do banco ordenar e a direção. null = padrão
  // (updated_at desc). Toda ordenação varre TODOS os registros no servidor,
  // então a sequência é coerente em qualquer página.
  const [orderBy, setOrderBy] = useState<{ field: string; dir: SortDir } | null>(null);

  // Clique no cabeçalho: asc → desc → desligado. Clicar em outra coluna
  // troca para asc nela (só uma ordenação ativa por vez).
  const handleSort = (sortField: string) => {
    setOrderBy((prev) => {
      if (!prev || prev.field !== sortField) return { field: sortField, dir: "asc" };
      if (prev.dir === "asc") return { field: sortField, dir: "desc" };
      return null; // terceiro clique desliga
    });
  };

  const PAGE_SIZE = 30;
  const [paginaAtual, setPaginaAtual] = useState(1);

  const { data: funcionarios = [] } = useQuery({
    queryKey: ["funcionarios_filtro_pedidos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("funcionarios_alvo_cache")
        .select("codigo, nome")
        .eq("status", "Trabalhando")
        .order("nome", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: podeVerTodos,
  });

  const { data: pedidosResult, isLoading } = useQuery({
    queryKey: [
      "pedidos_lista",
      user?.id,
      (profile as any)?.funcionario_alvo_codigo,
      podeVerTodos,
      filtroStatusLocal,
      filtroOrigem,
      filtroDataInicio?.toISOString(),
      filtroDataFim?.toISOString(),
      filtroComprador,
      buscaDebounced,
      orderBy?.field,
      orderBy?.dir,
      paginaAtual,
    ],
    queryFn: async () => {
      const inicio = (paginaAtual - 1) * PAGE_SIZE;
      const fim = inicio + PAGE_SIZE - 1;

      let query = (supabase as any).from("compras_pedidos").select("*", { count: "exact" });

      // ── Ordenação SERVER-SIDE ─────────────────────────────────────────
      // Ordena pelo campo escolhido no banco (varre TODOS os registros antes
      // de paginar → sequência coerente em qualquer página). nullsFirst:false
      // joga nulos pro fim. Sem ordenação ativa → padrão updated_at desc.
      if (orderBy) {
        query = query.order(orderBy.field, { ascending: orderBy.dir === "asc", nullsFirst: false });
      } else {
        query = query.order("updated_at", { ascending: false });
      }

      query = query.range(inicio, fim);

      if (!podeVerTodos && user) {
        const { data: minhasReqs } = await (supabase as any)
          .from("compras_requisicoes")
          .select("numero_alvo")
          .eq("requisitante_user_id", user.id);

        const numerosReqs = (minhasReqs || []).map((r: any) => r.numero_alvo).filter((n: string | null) => n !== null);

        if (numerosReqs.length === 0) {
          return { pedidos: [], total: 0 };
        }

        query = query.in("numero_req_comp", numerosReqs);
      }

      // ── Filtro de Status ──────────────────────────────────────────────
      // "aprovados" replica EXATAMENTE a regra do badge "Aprovado" verdinho
      // do getStatusPedido: status='Aberto' + status_aprovacao='Finalizada'
      // + aprovado='Total' + comprado != 'Sim'. As condições de status e
      // comprado são essenciais: sem elas, entram os "Concluído"
      // (Encerrado ou comprado='Sim') e "Pendente no ERP" (status='Pendente'),
      // que também têm Finalizada+Total mas NÃO são "Aprovado".
      if (filtroStatusLocal === "aprovados") {
        query = query
          .eq("status", "Aberto")
          .eq("status_aprovacao", "Finalizada")
          .eq("aprovado", "Total")
          .neq("comprado", "Sim");
      } else if (filtroStatusLocal && filtroStatusLocal !== "todos") {
        query = query.eq("status_local", filtroStatusLocal);
      }

      if (filtroOrigem === "hub") {
        query = query.eq("criado_no_hub", true);
      } else if (filtroOrigem === "alvo") {
        query = query.eq("criado_no_hub", false);
      }

      if (filtroComprador && filtroComprador !== "todos") {
        query = query.eq("codigo_usuario", filtroComprador);
      }

      // Busca textual: ilike case-insensitive em vários campos via OR
      if (buscaDebounced) {
        // Escapa caracteres especiais do PostgREST (vírgula e parênteses quebram o or())
        const termo = buscaDebounced.replace(/[,()]/g, " ");
        const padrao = `%${termo}%`;
        query = query.or(
          [
            `numero.ilike.${padrao}`,
            `nome_entidade.ilike.${padrao}`,
            `codigo_usuario.ilike.${padrao}`,
            `proximo_aprovador.ilike.${padrao}`,
            `numero_req_comp.ilike.${padrao}`,
            `texto.ilike.${padrao}`,
            `texto_historico.ilike.${padrao}`,
            `criado_por_nome.ilike.${padrao}`,
          ].join(","),
        );
      }

      // Filtro por data de competência (data_pedido): só aplica quando AMBOS
      // (De e Até) estão preenchidos. Um sozinho não filtra.
      if (filtroDataInicio && filtroDataFim) {
        const inicioData = new Date(filtroDataInicio);
        inicioData.setHours(0, 0, 0, 0);
        const fimData = new Date(filtroDataFim);
        fimData.setHours(23, 59, 59, 999);
        query = query
          .gte("data_pedido", inicioData.toISOString().slice(0, 10))
          .lte("data_pedido", fimData.toISOString().slice(0, 10));
      }

      const { data, count, error } = await query;
      if (error) throw error;
      return { pedidos: data || [], total: count || 0 };
    },
    enabled: !!user,
  });

  const pedidos = pedidosResult?.pedidos || [];
  const totalPedidos = pedidosResult?.total || 0;

  const totalPaginas = Math.max(1, Math.ceil(totalPedidos / PAGE_SIZE));
  const paginaCorrigida = Math.min(paginaAtual, totalPaginas);

  // Reset pra página 1 quando filtros, busca ou ordenação mudam
  useEffect(() => {
    setPaginaAtual(1);
  }, [filtroStatusLocal, filtroOrigem, filtroDataInicio, filtroDataFim, filtroComprador, buscaDebounced, orderBy]);

  const limparFiltros = () => {
    setFiltroStatusLocal("todos");
    setFiltroOrigem("todos");
    setFiltroDataInicio(undefined);
    setFiltroDataFim(undefined);
    setFiltroComprador("todos");
    setBuscaInput("");
    setOrderBy(null);
  };

  const temFiltroAtivo =
    filtroStatusLocal !== "todos" ||
    filtroOrigem !== "todos" ||
    filtroComprador !== "todos" ||
    (!!filtroDataInicio && !!filtroDataFim) ||
    !!buscaDebounced ||
    !!orderBy;

  const firstName = profile?.full_name?.split(" ")[0] || "";

  const irParaPedido = (ped: any) => {
    const isEditavel = ped.status_local === "rascunho" || ped.status_local === "erro_envio";
    if (isEditavel) {
      navigate(`/suprimentos/pedidos/novo?pedidoId=${ped.id}`);
    } else {
      navigate(`/suprimentos/pedidos/${ped.id}`);
    }
  };

  const renderSortIcon = (sortField?: string) => {
    if (!sortField || !orderBy || orderBy.field !== sortField) {
      return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    }
    return orderBy.dir === "asc" ? (
      <ArrowUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" />
    );
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {firstName ? `Olá, ${firstName}!` : "Pedidos de Compra"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {podeVerTodos
              ? "Gerencie todos os pedidos de compra do sistema."
              : "Acompanhe os pedidos derivados das suas requisições."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border p-0.5">
            <Button
              variant={view === "cards" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => trocarView("cards")}
              title="Visualização em cards"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={view === "lista" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => trocarView("lista")}
              title="Visualização em lista"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
          {podeCriar && (
            <Button onClick={() => navigate("/suprimentos/pedidos/novo")}>
              <Plus className="h-4 w-4" />
              Novo Pedido
            </Button>
          )}
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          {/* Busca textual */}
          <div className="relative min-w-[260px] flex-1 max-w-md">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Buscar</label>
            <Search className="pointer-events-none absolute left-2.5 top-[34px] h-4 w-4 text-muted-foreground" />
            <Input
              value={buscaInput}
              onChange={(e) => setBuscaInput(e.target.value)}
              placeholder="Nº, fornecedor, comprador, aprovador…"
              className="pl-8 pr-8"
            />
            {buscaInput && (
              <button
                type="button"
                onClick={() => setBuscaInput("")}
                className="absolute right-2.5 top-[34px] text-muted-foreground hover:text-foreground"
                title="Limpar busca"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
            <Select value={filtroStatusLocal} onValueChange={setFiltroStatusLocal}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="aprovados">Aprovados</SelectItem>
                <SelectItem value="rascunho">Rascunho</SelectItem>
                <SelectItem value="enviando">Enviando</SelectItem>
                <SelectItem value="enviado_alvo">Enviado ao ERP</SelectItem>
                <SelectItem value="erro_envio">Erro no envio</SelectItem>
                <SelectItem value="sincronizado">Sincronizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Origem</label>
            <Select value={filtroOrigem} onValueChange={setFiltroOrigem}>
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas</SelectItem>
                <SelectItem value="hub">Criado no Hub</SelectItem>
                <SelectItem value="alvo">Criado no ERP</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Período por data de competência (data_pedido) — De/Até.
              Só filtra quando AMBOS estão preenchidos. */}
          <div className="min-w-[150px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Competência de</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !filtroDataInicio && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filtroDataInicio ? format(filtroDataInicio, "dd/MM/yyyy", { locale: ptBR }) : "Data inicial"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={filtroDataInicio}
                  onSelect={setFiltroDataInicio}
                  disabled={(d) => (filtroDataFim ? d > filtroDataFim : false)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="min-w-[150px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Competência até</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !filtroDataFim && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filtroDataFim ? format(filtroDataFim, "dd/MM/yyyy", { locale: ptBR }) : "Data final"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={filtroDataFim}
                  onSelect={setFiltroDataFim}
                  disabled={(d) => (filtroDataInicio ? d < filtroDataInicio : false)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          {podeVerTodos && (
            <div className="min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Comprador</label>
              <Select value={filtroComprador} onValueChange={setFiltroComprador}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {funcionarios.map((f: any) => (
                    <SelectItem key={f.codigo} value={f.codigo}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {temFiltroAtivo && (
            <Button variant="ghost" size="sm" onClick={limparFiltros} className="text-muted-foreground">
              <X className="mr-1 h-3 w-3" /> Limpar filtros
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Contagem */}
      {!isLoading && totalPedidos > 0 && (
        <p className="text-sm text-muted-foreground">
          {totalPedidos === 1
            ? "1 pedido encontrado"
            : totalPaginas > 1
              ? `Mostrando ${(paginaCorrigida - 1) * PAGE_SIZE + 1}–${Math.min(
                  paginaCorrigida * PAGE_SIZE,
                  totalPedidos,
                )} de ${totalPedidos} pedidos`
              : `${totalPedidos} pedidos encontrados`}
        </p>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : totalPedidos === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border">
          <Card className="border-0 bg-transparent shadow-none text-center max-w-md">
            <CardContent className="flex flex-col items-center gap-4 pt-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <ShoppingCart className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {temFiltroAtivo
                    ? "Nenhum pedido encontrado com os filtros aplicados"
                    : podeVerTodos
                      ? "Nenhum pedido cadastrado"
                      : "Você ainda não tem pedidos vinculados"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {temFiltroAtivo
                    ? "Tente ajustar os filtros para ver mais resultados."
                    : podeVerTodos
                      ? "Os pedidos aparecerão aqui quando criados no Hub ou descobertos no ERP."
                      : "Os pedidos derivados das suas requisições aparecerão aqui."}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : view === "lista" ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    {COLUNAS_PEDIDOS.map((col) => (
                      <th
                        key={col.key}
                        className={`select-none px-4 py-3 font-medium ${col.sortable ? "cursor-pointer hover:text-foreground" : ""} ${col.className || ""} ${col.key === "primeiro_vencimento" ? "whitespace-nowrap" : ""}`}
                        onClick={() => col.sortable && col.sortField && handleSort(col.sortField)}
                        title={col.sortable ? "Ordena por esta coluna entre todos os pedidos" : undefined}
                      >
                        {col.label}
                        {col.sortable && renderSortIcon(col.sortField)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pedidos.map((ped: any) => {
                    const statusVisual = getStatusPedido(ped);
                    const numeroVisivel = ped.numero?.startsWith("RASCUNHO-") ? "(rascunho)" : ped.numero || "(sem nº)";
                    return (
                      <tr
                        key={ped.id}
                        className="cursor-pointer border-b last:border-b-0 transition-colors hover:bg-muted/40"
                        onClick={() => irParaPedido(ped)}
                      >
                        <td className="px-4 py-3 font-mono text-xs">
                          <div className="flex items-center gap-1.5">
                            {ped.criado_no_hub === true && (
                              <Home className="h-3 w-3 text-purple-600 dark:text-purple-400 shrink-0" />
                            )}
                            {numeroVisivel}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatData(ped.data_pedido)}</td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={`${statusVisual.className} flex w-fit items-center gap-1.5`}
                          >
                            <statusVisual.Icon
                              className={`h-3 w-3 ${statusVisual.iconAnimate ? "animate-spin" : ""}`}
                            />
                            {statusVisual.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 max-w-[220px]">
                          <span className="line-clamp-1">{ped.nome_entidade || "—"}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-600 whitespace-nowrap">
                          {formatBRL(ped.valor_total)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{ped.codigo_usuario || "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{ped.proximo_aprovador || "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap font-mono">{formatData(ped.primeiro_vencimento)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pedidos.map((ped: any) => {
            const statusVisual = getStatusPedido(ped);
            const isEditavel = ped.status_local === "rascunho" || ped.status_local === "erro_envio";
            const numeroVisivel = ped.numero?.startsWith("RASCUNHO-") ? "(rascunho)" : ped.numero || "(sem nº)";

            return (
              <Card
                key={ped.id}
                className={
                  "cursor-pointer transition-colors hover:border-primary/50" +
                  (isEditavel ? " bg-muted/40 border-dashed opacity-70 hover:opacity-100 hover:bg-muted/60" : "")
                }
                onClick={() => {
                  if (isEditavel) {
                    navigate(`/suprimentos/pedidos/novo?pedidoId=${ped.id}`);
                  } else {
                    navigate(`/suprimentos/pedidos/${ped.id}`);
                  }
                }}
              >
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className={`${statusVisual.className} flex items-center gap-1.5 cursor-help`}
                          >
                            <statusVisual.Icon
                              className={`h-3 w-3 ${statusVisual.iconAnimate ? "animate-spin" : ""}`}
                            />
                            {statusVisual.label}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          {statusVisual.tooltip}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <div className="flex items-center gap-1.5">
                      {ped.criado_no_hub === true && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Home className="h-3 w-3 text-purple-600 dark:text-purple-400 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              Criado no Hub
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      <span className="text-xs font-mono text-muted-foreground">Nº {numeroVisivel}</span>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-foreground line-clamp-2">
                      {ped.nome_entidade || "(sem fornecedor)"}
                    </p>
                    <p className="mt-1 text-sm font-mono text-emerald-600">{formatBRL(ped.valor_total)}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {ped.data_pedido && (
                      <span className="flex items-center gap-1">
                        <CalendarIcon className="h-3 w-3" />
                        {formatData(ped.data_pedido)}
                      </span>
                    )}
                    {ped.primeiro_vencimento && (
                      <span className="flex items-center gap-1">
                        <CalendarIcon className="h-3 w-3" />
                        Vcto {formatData(ped.primeiro_vencimento)}
                      </span>
                    )}
                    {ped.numero_req_comp && (
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        Req {ped.numero_req_comp}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {ped.codigo_usuario && (
                      <span className="flex items-center gap-1">
                        <UserIcon className="h-3 w-3" />
                        {ped.codigo_usuario}
                      </span>
                    )}
                  </div>

                  {ped.status_local === "erro_envio" && ped.erro_envio?.message && (
                    <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                      <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                      <p className="text-[11px] text-destructive line-clamp-2">{ped.erro_envio.message}</p>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <p className="text-[11px] text-muted-foreground/60">
                      Atualizado em {format(new Date(ped.updated_at || ped.created_at), "dd/MM/yyyy", { locale: ptBR })}
                    </p>
                    {isEditavel && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Pencil className="h-2.5 w-2.5" />
                        Clique para editar
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Paginação */}
      {!isLoading && totalPedidos > 0 && totalPaginas > 1 && (
        <div className="mt-6 flex items-center justify-between gap-4 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            Página {paginaCorrigida} de {totalPaginas}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPaginaAtual(1)}
              disabled={paginaCorrigida === 1}
              title="Primeira página"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPaginaAtual((p) => Math.max(1, p - 1))}
              disabled={paginaCorrigida === 1}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPaginaAtual((p) => Math.min(totalPaginas, p + 1))}
              disabled={paginaCorrigida === totalPaginas}
            >
              Próxima
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPaginaAtual(totalPaginas)}
              disabled={paginaCorrigida === totalPaginas}
              title="Última página"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
