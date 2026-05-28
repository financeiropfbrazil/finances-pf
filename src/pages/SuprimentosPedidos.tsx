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
import {
  Plus,
  ShoppingCart,
  Loader2,
  User as UserIcon,
  Building2,
  Calendar,
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
} from "lucide-react";
import { getStatusPedido } from "@/lib/statusPedido";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Home } from "lucide-react";
import { format, subDays, startOfWeek, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

// ════════════════════════════════════════════════════════════
// STATUS CONFIG
// ════════════════════════════════════════════════════════════
// Pedido tem 2 dimensões de status:
//  - status_local (ciclo do Hub): rascunho, enviando, enviado_alvo, erro_envio, sincronizado
//  - status (Alvo): Aberto, Pendente, Cancelado, Encerrado, etc
// Para a tela de lista, exibimos um BADGE COMBINADO inteligente
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

// Para pedidos sincronizados, mostramos também o status do Alvo
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
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(valor));
}

function formatData(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
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

// Colunas ordenáveis da lista. `accessor` extrai o valor comparável de cada pedido.
const COLUNAS_PEDIDOS: Array<{
  key: string;
  label: string;
  className?: string;
  accessor: (p: any) => any;
}> = [
  { key: "numero", label: "Nº", accessor: (p) => p.numero || "" },
  { key: "data_pedido", label: "Data", accessor: (p) => p.data_pedido || "" },
  { key: "status", label: "Status", accessor: (p) => getStatusPedido(p).label },
  { key: "nome_entidade", label: "Fornecedor", accessor: (p) => (p.nome_entidade || "").toLowerCase() },
  { key: "valor_total", label: "Valor total", className: "text-right", accessor: (p) => Number(p.valor_total) || 0 },
  { key: "codigo_usuario", label: "Comprador", accessor: (p) => (p.codigo_usuario || "").toLowerCase() },
  { key: "proximo_aprovador", label: "Próximo aprovador", accessor: (p) => (p.proximo_aprovador || "").toLowerCase() },
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
  const [filtroPreset, setFiltroPreset] = useState("todos");

  // ── Modo de visualização (persistido em localStorage) ───
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

  // ── Ordenação da lista (só na sessão, não persiste) ─────
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const handleSort = (colKey: string) => {
    if (sortCol === colKey) {
      // Mesmo campo: alterna asc → desc → sem ordenação
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortCol(null);
        setSortDir("asc");
      }
    } else {
      setSortCol(colKey);
      setSortDir("asc");
    }
  };

  // Paginação no frontend (filtros buscam tudo do banco)
  const PAGE_SIZE = 30;
  const [paginaAtual, setPaginaAtual] = useState(1);

  // ── Lista de funcionários (compradores) pra filtro ──────
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

  // ── Lista de pedidos (paginação no servidor) ────────────
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
      paginaAtual, // refaz query quando troca de página
    ],
    queryFn: async () => {
      // Range do PostgREST é INCLUSIVO em ambos os lados.
      // Pra pedir registros 0..29 (primeiros 30): .range(0, 29)
      const inicio = (paginaAtual - 1) * PAGE_SIZE;
      const fim = inicio + PAGE_SIZE - 1;

      let query = (supabase as any)
        .from("compras_pedidos")
        .select("*", { count: "exact" }) // count exato pro total
        .order("updated_at", { ascending: false })
        .range(inicio, fim);

      // Filtragem por papel: requisitante só vê pedidos derivados de SUAS reqs
      if (!podeVerTodos && user) {
        // Busca os numero_alvo das requisições deste usuário
        const { data: minhasReqs } = await (supabase as any)
          .from("compras_requisicoes")
          .select("numero_alvo")
          .eq("requisitante_user_id", user.id);

        const numerosReqs = (minhasReqs || []).map((r: any) => r.numero_alvo).filter((n: string | null) => n !== null);

        if (numerosReqs.length === 0) {
          // Usuário sem reqs → sem pedidos derivados → retorna vazio
          return { pedidos: [], total: 0 };
        }

        query = query.in("numero_req_comp", numerosReqs);
      }

      // Filtros UI
      if (filtroStatusLocal && filtroStatusLocal !== "todos") {
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

      if (filtroDataInicio) {
        const inicioData = new Date(filtroDataInicio);
        inicioData.setHours(0, 0, 0, 0);
        query = query.gte("data_pedido", inicioData.toISOString().slice(0, 10));
      }
      if (filtroDataFim) {
        const fimData = new Date(filtroDataFim);
        fimData.setHours(23, 59, 59, 999);
        query = query.lte("data_pedido", fimData.toISOString().slice(0, 10));
      }

      const { data, count, error } = await query;
      if (error) throw error;
      return { pedidos: data || [], total: count || 0 };
    },
    enabled: !!user,
  });

  const pedidos = pedidosResult?.pedidos || [];
  const totalPedidos = pedidosResult?.total || 0;

  // ── Ordenação no frontend (aplicada à página atual) ─────
  // A query já ordena por updated_at desc no servidor. Quando o usuário
  // clica num cabeçalho de coluna na visão Lista, reordenamos os registros
  // já carregados da página atual.
  const pedidosOrdenados = (() => {
    if (!sortCol) return pedidos;
    const coluna = COLUNAS_PEDIDOS.find((c) => c.key === sortCol);
    if (!coluna) return pedidos;
    const copia = [...pedidos];
    copia.sort((a, b) => {
      const va = coluna.accessor(a);
      const vb = coluna.accessor(b);
      let cmp = 0;
      if (typeof va === "number" && typeof vb === "number") {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), "pt-BR");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copia;
  })();

  // ── Paginação no servidor ───────────────────────────────
  // `pedidos` já vem só com a página atual (PAGE_SIZE registros máx).
  // `totalPedidos` é o count exato no banco.
  const totalPaginas = Math.max(1, Math.ceil(totalPedidos / PAGE_SIZE));
  const paginaCorrigida = Math.min(paginaAtual, totalPaginas);

  // Resetar pra página 1 quando os filtros mudarem
  useEffect(() => {
    setPaginaAtual(1);
  }, [filtroStatusLocal, filtroOrigem, filtroDataInicio, filtroDataFim, filtroComprador, filtroPreset]);

  const handlePresetData = (preset: string) => {
    setFiltroPreset(preset);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const fimHoje = new Date();
    fimHoje.setHours(23, 59, 59, 999);
    if (preset === "todos") {
      setFiltroDataInicio(undefined);
      setFiltroDataFim(undefined);
    } else if (preset === "hoje") {
      setFiltroDataInicio(hoje);
      setFiltroDataFim(fimHoje);
    } else if (preset === "semana") {
      setFiltroDataInicio(startOfWeek(hoje, { weekStartsOn: 1 }));
      setFiltroDataFim(fimHoje);
    } else if (preset === "mes") {
      setFiltroDataInicio(startOfMonth(hoje));
      setFiltroDataFim(fimHoje);
    } else if (preset === "30dias") {
      setFiltroDataInicio(subDays(hoje, 30));
      setFiltroDataFim(fimHoje);
    }
  };

  const limparFiltros = () => {
    setFiltroStatusLocal("todos");
    setFiltroOrigem("todos");
    setFiltroDataInicio(undefined);
    setFiltroDataFim(undefined);
    setFiltroComprador("todos");
    setFiltroPreset("todos");
  };

  const temFiltroAtivo =
    filtroStatusLocal !== "todos" ||
    filtroOrigem !== "todos" ||
    filtroComprador !== "todos" ||
    !!filtroDataInicio ||
    !!filtroDataFim;

  const firstName = profile?.full_name?.split(" ")[0] || "";

  // ── Navegação ao clicar num pedido (card ou linha) ──────
  const irParaPedido = (ped: any) => {
    const isEditavel = ped.status_local === "rascunho" || ped.status_local === "erro_envio";
    if (isEditavel) {
      navigate(`/suprimentos/pedidos/novo?pedidoId=${ped.id}`);
    } else {
      navigate(`/suprimentos/pedidos/${ped.id}`);
    }
  };

  // ── Ícone de ordenação por coluna ───────────────────────
  const renderSortIcon = (colKey: string) => {
    if (sortCol !== colKey) {
      return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    }
    return sortDir === "asc" ? (
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
          {/* Toggle Cards/Lista */}
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
          {/* Status local */}
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
            <Select value={filtroStatusLocal} onValueChange={setFiltroStatusLocal}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="rascunho">Rascunho</SelectItem>
                <SelectItem value="enviando">Enviando</SelectItem>
                <SelectItem value="enviado_alvo">Enviado ao ERP</SelectItem>
                <SelectItem value="erro_envio">Erro no envio</SelectItem>
                <SelectItem value="sincronizado">Sincronizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Origem (Hub ou Alvo) */}
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

          {/* Período */}
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Período</label>
            <Select value={filtroPreset} onValueChange={handlePresetData}>
              <SelectTrigger>
                <SelectValue placeholder="Todo período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todo período</SelectItem>
                <SelectItem value="hoje">Hoje</SelectItem>
                <SelectItem value="semana">Esta semana</SelectItem>
                <SelectItem value="mes">Este mês</SelectItem>
                <SelectItem value="30dias">Últimos 30 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Comprador (quem pode ver todos) */}
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

          {/* Limpar */}
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
        /* ─────────── VISUALIZAÇÃO EM LISTA ─────────── */
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    {COLUNAS_PEDIDOS.map((col) => (
                      <th
                        key={col.key}
                        className={`cursor-pointer select-none px-4 py-3 font-medium hover:text-foreground ${col.className || ""}`}
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}
                        {renderSortIcon(col.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pedidosOrdenados.map((ped: any) => {
                    const statusVisual = getStatusPedido(ped);
                    const isEditavel = ped.status_local === "rascunho" || ped.status_local === "erro_envio";
                    const numeroVisivel = ped.numero?.startsWith("RASCUNHO-") ? "(rascunho)" : ped.numero || "(sem nº)";
                    return (
                      <tr
                        key={ped.id}
                        className="cursor-pointer border-b last:border-b-0 transition-colors hover:bg-muted/40"
                        onClick={() => irParaPedido(ped)}
                      >
                        {/* Nº */}
                        <td className="px-4 py-3 font-mono text-xs">
                          <div className="flex items-center gap-1.5">
                            {ped.criado_no_hub === true && (
                              <Home className="h-3 w-3 text-purple-600 dark:text-purple-400 shrink-0" />
                            )}
                            {numeroVisivel}
                          </div>
                        </td>
                        {/* Data */}
                        <td className="px-4 py-3 whitespace-nowrap">{formatData(ped.data_pedido)}</td>
                        {/* Status */}
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
                        {/* Fornecedor */}
                        <td className="px-4 py-3 max-w-[220px]">
                          <span className="line-clamp-1">{ped.nome_entidade || "—"}</span>
                        </td>
                        {/* Valor total */}
                        <td className="px-4 py-3 text-right font-mono text-emerald-600 whitespace-nowrap">
                          {formatBRL(ped.valor_total)}
                        </td>
                        {/* Comprador */}
                        <td className="px-4 py-3 whitespace-nowrap">{ped.codigo_usuario || "—"}</td>
                        {/* Próximo aprovador */}
                        <td className="px-4 py-3 whitespace-nowrap">{ped.proximo_aprovador || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* ─────────── VISUALIZAÇÃO EM CARDS ─────────── */
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
                  {/* Status unificado + Nº pedido + indicador Hub */}
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

                  {/* Fornecedor + valor */}
                  <div>
                    <p className="text-sm font-medium text-foreground line-clamp-2">
                      {ped.nome_entidade || "(sem fornecedor)"}
                    </p>
                    <p className="mt-1 text-sm font-mono text-emerald-600">{formatBRL(ped.valor_total)}</p>
                  </div>

                  {/* Metadados */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {ped.data_pedido && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(ped.data_pedido), "dd/MM/yyyy", { locale: ptBR })}
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

                  {/* Banner de erro / aviso de rascunho */}
                  {ped.status_local === "erro_envio" && ped.erro_envio?.message && (
                    <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                      <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                      <p className="text-[11px] text-destructive line-clamp-2">{ped.erro_envio.message}</p>
                    </div>
                  )}

                  {/* Footer: data + botão editar (se editável) */}
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
