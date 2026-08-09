import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { NovaRMModal } from "@/components/producao/NovaRMModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ClipboardList,
  Loader2,
  Search,
  X,
  Calendar as CalendarIcon,
  User as UserIcon,
  Building2,
  Package,
  AlertTriangle,
  Trash2,
  LayoutGrid,
  List,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Plus,
  CloudUpload,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getStatusRM, getStatusRMVisual, STATUS_RM_ORDER, STATUS_RM_FILTER_OPTIONS } from "@/lib/statusRM";
import { listarRMs, contarPorStatus, listarRequisitantes, listarEnviosIncompletos } from "@/services/reqMatService";

// ── Formatadores ─────────────────────────────────────────────────────────────

const numeroFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/** `op_reqmat.data` é timestamptz vindo do Alvo — formata só o dia. */
function formatData(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return "—";
  }
}

function dateToParam(d: Date | undefined): string | undefined {
  if (!d) return undefined;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function paramToDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Sinal "criada agora" (OP-2.8) — discreto de propósito.
 *
 * A RM semeada pela criação nasce com `detalhes_carregados_em` preenchido e
 * atendimento zerado: a olho, é indistinguível de uma RM do Hub sincronizada há
 * dias, porque `Origem = Importação` e `status = Aberta` valem nos dois casos. O
 * que ela tem de particular é que o sync **ainda não passou por ela** — e é isso
 * que o ícone diz.
 *
 * Some sozinho no primeiro sync (ver `criada_agora` em `reqMatService`): nada a
 * limpar, nada a expirar. Um aviso que não se apaga vira ruído, e ruído deixa de
 * ser lido — foi o critério que matou a versão "sempre avisar" da §10.26-1.
 */
function SinalCriadaAgora() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <CloudUpload className="ml-1.5 inline h-3 w-3 shrink-0 cursor-help align-text-top text-blue-600" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          Criada no Hub agora. O atendimento é atualizado na próxima sincronização.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type ViewMode = "lista" | "cards";
type SortDir = "asc" | "desc";

const VIEW_STORAGE_KEY = "producao_rm_view";
const PAGE_SIZE = 30;

export default function ProducaoRM() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const podeCriar = useHasPermission(PERMISSIONS.PRODUCAO_RM_CREATE);
  const [modalOpen, setModalOpen] = useState(false);

  // ── Estado (inicializado pela URL, para sobreviver ao F5 e à volta do detalhe) ──
  const [buscaInput, setBuscaInput] = useState(() => searchParams.get("busca") || "");
  const [buscaDebounced, setBuscaDebounced] = useState(() => searchParams.get("busca") || "");
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(buscaInput.trim()), 300);
    return () => clearTimeout(t);
  }, [buscaInput]);

  const [filtroStatus, setFiltroStatus] = useState(() => searchParams.get("status") || "todos");
  const [filtroUsuario, setFiltroUsuario] = useState(() => searchParams.get("usuario") || "todos");
  const [dataDe, setDataDe] = useState<Date | undefined>(() => paramToDate(searchParams.get("dataDe")));
  const [dataAte, setDataAte] = useState<Date | undefined>(() => paramToDate(searchParams.get("dataAte")));
  const [comSaldo, setComSaldo] = useState(() => searchParams.get("saldo") === "1");
  const [semOp, setSemOp] = useState(() => searchParams.get("semop") === "1");
  const [orderBy, setOrderBy] = useState<{ field: string; dir: SortDir } | null>(() => {
    const field = searchParams.get("ordCampo");
    const dir = searchParams.get("ordDir");
    if (field && (dir === "asc" || dir === "desc")) return { field, dir };
    return null;
  });
  const [pagina, setPagina] = useState(() => {
    const p = Number(searchParams.get("pagina"));
    return Number.isFinite(p) && p > 0 ? p : 1;
  });

  // Preferência de visualização é do usuário, não do link — fica no localStorage
  // (mesmo approach de Suprimentos > Requisições). Default LISTA: RM é
  // conferência de números, não leitura de cartão.
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "lista";
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "cards" ? "cards" : "lista";
  });
  const trocarView = (novo: ViewMode) => {
    setView(novo);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, novo);
    } catch {
      /* localStorage indisponível — a preferência só não persiste */
    }
  };

  // ── Estado → URL ───────────────────────────────────────────────────────────
  useEffect(() => {
    const next: Record<string, string> = {};
    if (buscaDebounced) next.busca = buscaDebounced;
    if (filtroStatus !== "todos") next.status = filtroStatus;
    if (filtroUsuario !== "todos") next.usuario = filtroUsuario;
    const di = dateToParam(dataDe);
    const df = dateToParam(dataAte);
    if (di) next.dataDe = di;
    if (df) next.dataAte = df;
    if (comSaldo) next.saldo = "1";
    if (semOp) next.semop = "1";
    if (orderBy) {
      next.ordCampo = orderBy.field;
      next.ordDir = orderBy.dir;
    }
    if (pagina > 1) next.pagina = String(pagina);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaDebounced, filtroStatus, filtroUsuario, dataDe, dataAte, comSaldo, semOp, orderBy, pagina]);

  useEffect(() => {
    setPagina(1);
  }, [buscaDebounced, filtroStatus, filtroUsuario, dataDe, dataAte, comSaldo, semOp, orderBy]);

  const filtrosComuns = {
    dataDe: dateToParam(dataDe),
    dataAte: dateToParam(dataAte),
    busca: buscaDebounced,
    usuario: filtroUsuario,
    comSaldo,
    semOp,
  };

  const { data: requisitantes = [] } = useQuery({
    queryKey: ["rm_requisitantes"],
    queryFn: listarRequisitantes,
  });

  // Divergência livro × espelho: existe no ERP e o Hub não enxerga.
  //
  // Desde a OP-2.8 a criação grava o espelho no ato, então em regime normal isto
  // vem VAZIO e o bloco nem renderiza. O que sobra é exceção — sobretudo a RM
  // `enviado` não confirmada, que existe no ERP em atendimento `Automático` (ou
  // seja, morta) e exige o passo 2.
  const { data: enviosIncompletos = [] } = useQuery({
    queryKey: ["rm_envios_incompletos"],
    queryFn: () => listarEnviosIncompletos(),
  });

  const aoCriar = () => {
    queryClient.invalidateQueries({ queryKey: ["rm_lista"] });
    queryClient.invalidateQueries({ queryKey: ["rm_counts"] });
    queryClient.invalidateQueries({ queryKey: ["rm_requisitantes"] });
    queryClient.invalidateQueries({ queryKey: ["rm_envios_incompletos"] });
    queryClient.invalidateQueries({ queryKey: ["rm_pendente_conclusao"] });
    // O consolidado da OP soma as RMs do livro — precisa acompanhar.
    queryClient.invalidateQueries({ queryKey: ["op_consolidado"] });
  };

  const { data: contagem } = useQuery({
    queryKey: ["rm_counts", filtrosComuns],
    queryFn: () => contarPorStatus(filtrosComuns),
  });

  const { data: result, isLoading, isError, error } = useQuery({
    queryKey: ["rm_lista", filtroStatus, filtrosComuns, orderBy?.field, orderBy?.dir, pagina],
    queryFn: () =>
      listarRMs({ status: filtroStatus, ...filtrosComuns, orderBy, pagina, pageSize: PAGE_SIZE }),
  });

  const rms = result?.rms || [];
  const total = result?.total || 0;
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const paginaCorrigida = Math.min(pagina, totalPaginas);

  const temFiltroAtivo =
    filtroStatus !== "todos" ||
    filtroUsuario !== "todos" ||
    !!dataDe ||
    !!dataAte ||
    comSaldo ||
    semOp ||
    !!buscaDebounced ||
    !!orderBy;

  const limparFiltros = () => {
    setFiltroStatus("todos");
    setFiltroUsuario("todos");
    setDataDe(undefined);
    setDataAte(undefined);
    setComSaldo(false);
    setSemOp(false);
    setBuscaInput("");
    setOrderBy(null);
  };

  const handleSort = (field: string) => {
    setOrderBy((prev) => {
      if (!prev || prev.field !== field) return { field, dir: "asc" };
      if (prev.dir === "asc") return { field, dir: "desc" };
      return null; // terceiro clique volta à ordenação padrão (data desc)
    });
  };

  const renderSortIcon = (field: string) => {
    if (!orderBy || orderBy.field !== field) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />;
    return orderBy.dir === "asc" ? (
      <ArrowUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" />
    );
  };

  const abrir = (numero: string) => navigate(`/producao/rm/${numero}`);

  return (
    // `grid grid-cols-1` na raiz (minmax(0,1fr)) impede que a tabela larga
    // infle a coluna do layout e faça a PÁGINA rolar — lição medida em
    // navegador na REC-1.7, e o padrão a copiar enquanto o BL-4 não sai.
    <div className="grid grid-cols-1 gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Requisições de Material</h1>
          <p className="text-sm text-muted-foreground">
            Requisições de produção espelhadas do Alvo. Criação vinculada a uma Ordem de Produção.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {podeCriar && (
            <Button onClick={() => setModalOpen(true)}>
              <Plus className="h-4 w-4" /> Nova RM
            </Button>
          )}
        <div className="flex items-center rounded-md border border-border p-0.5">
          <Button
            variant={view === "lista" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-2"
            onClick={() => trocarView("lista")}
            title="Visualização em lista"
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={view === "cards" ? "secondary" : "ghost"}
            size="sm"
            className="h-8 px-2"
            onClick={() => trocarView("cards")}
            title="Visualização em cards"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
        </div>
      </div>

      {/* ENVIOS INCOMPLETOS — divergência entre o livro e o espelho.
          🔴 O eixo deste bloco é "existe no ERP e o Hub não enxerga", NÃO
             "qual o status do envio" — foi a troca de eixo que fez a primeira
             RM do caminho feliz (0000002286) sumir das duas vistas. Ver o
             comentário de `listarEnviosIncompletos`.
          Desde a OP-2.8 a criação grava o espelho no ato ⇒ em regime normal
          este bloco fica VAZIO e invisível, e essa é a diferença que importa:
          o que aparecer aqui é exceção, e pede ação. */}
      {enviosIncompletos.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-semibold text-foreground">
                Envios incompletos ({enviosIncompletos.length})
              </span>
              <span className="text-xs text-muted-foreground">
                criadas no ERP e ainda ausentes da lista abaixo
              </span>
            </div>
            <div className="space-y-1.5">
              {enviosIncompletos.map((p) => {
                // O estado perigoso: a RM EXISTE no ERP e nasceu em atendimento
                // `Automático` — ou seja, nunca será atendida. É o único caso
                // deste bloco que exige ação humana, e por isso é o único em
                // vermelho.
                const morta = p.status_envio === "enviado" && !!p.numero_reqmat;
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-2 text-xs",
                      morta ? "border-destructive/40 bg-destructive/5" : "border-border bg-background",
                    )}
                  >
                    <Badge variant="outline" className="text-[11px]">
                      {p.status_envio === "pendente"
                        ? "Enviando…"
                        : p.status_envio === "enviado"
                          ? "Envio interrompido"
                          : "Aguardando sincronização"}
                    </Badge>
                    <span className="font-mono font-medium">{p.numero_reqmat || "—"}</span>
                    {p.op_numero && <span className="text-muted-foreground">OP {p.op_numero}</span>}
                    {p.descricao && <span className="truncate text-muted-foreground">{p.descricao}</span>}
                    <span className="ml-auto text-muted-foreground">
                      {format(new Date(p.criado_em), "dd/MM 'às' HH:mm", { locale: ptBR })}
                    </span>
                    {morta && (
                      <p className="w-full text-destructive">
                        A RM foi criada no ERP mas o envio não terminou: ela está em atendimento Automático e{" "}
                        <strong>não será atendida</strong>. Abra "Nova RM" nesta OP para concluir o passo 2 — não crie
                        outra, seria RM duplicada.
                      </p>
                    )}
                    {p.status_envio === "confirmado" && (
                      <p className="w-full text-muted-foreground">
                        A RM está correta no ERP; só o registro no Hub não foi gravado. Ela entra na lista na próxima
                        sincronização (09h25, 12h25, 15h25 e 18h25, dias úteis).
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chips de contagem (clicáveis como filtro) + chip de exceção */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFiltroStatus("todos")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            filtroStatus === "todos"
              ? "border-primary bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted/60",
          )}
        >
          Todas <span className="tabular-nums">{contagem?.total ?? 0}</span>
        </button>
        {STATUS_RM_ORDER.map((key) => {
          const cfg = getStatusRMVisual(key);
          const n = contagem?.porStatus[key] || 0;
          const ativo = filtroStatus === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFiltroStatus(ativo ? "todos" : key)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                ativo ? cfg.className : "border-border text-muted-foreground hover:bg-muted/60",
              )}
              title={cfg.tooltip}
            >
              <cfg.Icon className="h-3 w-3" />
              {cfg.label} <span className="tabular-nums">{n}</span>
            </button>
          );
        })}
        {/* Excluídas no ERP — chip PRÓPRIO, e só quando existe pelo menos uma.
            Não é status do Alvo (é carimbo do Hub) e por isso não entra na
            contagem dos três acima. Chip fixo em zero seria ruído permanente:
            hoje é 1 em 280, e no dia em que for 0 ele some sozinho. */}
        {(contagem?.ausentes ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setFiltroStatus(filtroStatus === "ausente_alvo" ? "todos" : "ausente_alvo")}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filtroStatus === "ausente_alvo"
                ? getStatusRMVisual("ausente_alvo").className
                : "border-border text-muted-foreground hover:bg-muted/60",
            )}
            title={getStatusRMVisual("ausente_alvo").tooltip}
          >
            <Trash2 className="h-3 w-3" />
            Excluídas no ERP <span className="tabular-nums">{contagem?.ausentes}</span>
          </button>
        )}

        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        {/* Exceção, não status: material requisitado que ainda não saiu do
            estoque. Medido nos ITENS (`quantidade_saldo > 0`), não deduzido do
            status do cabeçalho. */}
        <button
          type="button"
          onClick={() => setComSaldo((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            comSaldo
              ? "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400"
              : "border-border text-muted-foreground hover:bg-muted/60",
          )}
          title="Requisições com pelo menos um item ainda em aberto"
        >
          <Package className="h-3 w-3" />
          Com saldo em aberto <span className="tabular-nums">{contagem?.comSaldo ?? 0}</span>
        </button>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="grid grid-cols-1 items-end gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <div className="relative min-w-0">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Buscar</label>
            <Search className="pointer-events-none absolute left-2.5 top-[34px] h-4 w-4 text-muted-foreground" />
            <Input
              value={buscaInput}
              onChange={(e) => setBuscaInput(e.target.value)}
              placeholder="Número ou descrição…"
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

          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {STATUS_RM_FILTER_OPTIONS.map((op) => (
                  <SelectItem key={op.value} value={op.value}>
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Requisitante</label>
            <Select value={filtroUsuario} onValueChange={setFiltroUsuario}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {requisitantes.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Datas independentes (só De, só Até ou as duas) — molde da Fila de
              Inspeção, que é onde esse comportamento foi validado. */}
          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Data de</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !dataDe && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">{dataDe ? format(dataDe, "dd/MM/yyyy", { locale: ptBR }) : "Início"}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={dataDe}
                  onSelect={setDataDe}
                  disabled={(d) => (dataAte ? d > dataAte : false)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="min-w-0">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Data até</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !dataAte && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">{dataAte ? format(dataAte, "dd/MM/yyyy", { locale: ptBR }) : "Fim"}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={dataAte}
                  onSelect={setDataAte}
                  disabled={(d) => (dataDe ? d < dataDe : false)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>

        <CardContent className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
          <Button
            variant={comSaldo ? "secondary" : "outline"}
            size="sm"
            onClick={() => setComSaldo((v) => !v)}
            className="h-8"
          >
            <Package className="mr-1 h-3.5 w-3.5" /> Só com saldo em aberto
          </Button>
          <Button variant={semOp ? "secondary" : "outline"} size="sm" onClick={() => setSemOp((v) => !v)} className="h-8">
            <ClipboardList className="mr-1 h-3.5 w-3.5" /> Só sem OP
          </Button>
          {temFiltroAtivo && (
            <Button variant="ghost" size="sm" onClick={limparFiltros} className="h-8 text-muted-foreground">
              <X className="mr-1 h-3 w-3" /> Limpar filtros
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Contagem */}
      {!isLoading && !isError && total > 0 && (
        <p className="text-sm text-muted-foreground">
          {total === 1
            ? "1 requisição encontrada"
            : totalPaginas > 1
              ? `Mostrando ${(paginaCorrigida - 1) * PAGE_SIZE + 1}–${Math.min(paginaCorrigida * PAGE_SIZE, total)} de ${total} requisições`
              : `${total} requisições encontradas`}
        </p>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-destructive/40">
          <div className="max-w-md text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
            <p className="mt-3 font-medium text-foreground">Não foi possível carregar as requisições</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Erro desconhecido."}
            </p>
          </div>
        </div>
      ) : total === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border">
          <Card className="max-w-md border-0 bg-transparent text-center shadow-none">
            <CardContent className="flex flex-col items-center gap-4 pt-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <ClipboardList className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {temFiltroAtivo
                    ? "Nenhuma requisição encontrada com os filtros aplicados"
                    : "Nenhuma requisição de produção espelhada"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {temFiltroAtivo
                    ? "Tente ajustar os filtros para ver mais resultados."
                    : "As requisições de produção do Alvo aparecem aqui após a sincronização."}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : view === "lista" ? (
        <Card>
          <CardContent className="p-0">
            {/* `w-0 min-w-full` prende a rolagem HORIZONTAL neste container em
                vez de deixá-la subir para a página (REC-1.7). */}
            <div className="w-0 min-w-full overflow-x-auto">
              <table className="w-max min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th
                      className="cursor-pointer select-none px-4 py-3 font-medium hover:text-foreground"
                      onClick={() => handleSort("numero")}
                    >
                      Nº {renderSortIcon("numero")}
                    </th>
                    <th
                      className="cursor-pointer select-none whitespace-nowrap px-4 py-3 font-medium hover:text-foreground"
                      onClick={() => handleSort("data")}
                    >
                      Data {renderSortIcon("data")}
                    </th>
                    <th className="px-4 py-3 font-medium">Descrição</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Itens</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Atendido / Pedido</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Saldo</th>
                    <th className="px-4 py-3 font-medium">Requisitante</th>
                    <th className="px-4 py-3 font-medium">Funcionário</th>
                    <th className="px-4 py-3 font-medium">Centro</th>
                    <th className="px-4 py-3 font-medium">OP</th>
                    <th className="px-4 py-3 font-medium">Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {rms.map((r) => {
                    const sv = getStatusRM(r);
                    return (
                      <tr
                        key={r.numero}
                        className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/40"
                        onClick={() => abrir(r.numero)}
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs tabular-nums">
                          {r.numero}
                          {r.criada_agora && <SinalCriadaAgora />}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatData(r.data)}</td>
                        <td className="max-w-[280px] px-4 py-3">
                          <span className="line-clamp-1">{r.descricao || "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cn(sv.className, "flex w-fit items-center gap-1.5")}>
                            <sv.Icon className="h-3 w-3" />
                            {sv.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.itens_count}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                          {numeroFmt.format(r.qtd_atendida)}
                          <span className="text-muted-foreground"> / {numeroFmt.format(r.qtd_pedida)}</span>
                          {r.qtd_excedente > 0 && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="ml-1.5 cursor-help rounded border border-amber-500/30 bg-amber-500/15 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                    +{numeroFmt.format(r.qtd_excedente)}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs text-xs">
                                  Excedente carimbado pelo Alvo: no atendimento a quantidade é digitada, e foi entregue
                                  mais do que o pedido. Não é cálculo do Hub.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-4 py-3 text-right tabular-nums",
                            r.qtd_saldo > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
                          )}
                        >
                          {numeroFmt.format(r.qtd_saldo)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{r.codigo_usuario || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3">{r.funcionario_nome || r.codigo_funcionario || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {r.centro_nome || r.codigo_centro_ctrl || "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{r.op_numero || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {r.origem || "—"}
                          </span>
                        </td>
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
          {rms.map((r) => {
            const sv = getStatusRM(r);
            return (
              <Card
                key={r.numero}
                className="cursor-pointer transition-colors hover:border-primary/50"
                onClick={() => abrir(r.numero)}
              >
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className={cn(sv.className, "flex cursor-help items-center gap-1.5")}>
                            <sv.Icon className="h-3 w-3" />
                            {sv.label}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          {sv.tooltip}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      Nº {r.numero}
                      {r.criada_agora && <SinalCriadaAgora />}
                    </span>
                  </div>

                  <div>
                    <p className="line-clamp-2 text-sm font-medium text-foreground">{r.descricao || "(sem descrição)"}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        {r.itens_count} {r.itens_count === 1 ? "item" : "itens"}
                      </span>
                      <span className="flex items-center gap-1 tabular-nums">
                        <CalendarIcon className="h-3 w-3" />
                        {formatData(r.data)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="tabular-nums text-muted-foreground">
                      Atendido {numeroFmt.format(r.qtd_atendida)} / {numeroFmt.format(r.qtd_pedida)}
                    </span>
                    {r.qtd_saldo > 0 && (
                      <span className="tabular-nums text-amber-700 dark:text-amber-400">
                        Saldo {numeroFmt.format(r.qtd_saldo)}
                      </span>
                    )}
                    {r.qtd_excedente > 0 && (
                      <span className="tabular-nums text-amber-700 dark:text-amber-400">
                        Excedente +{numeroFmt.format(r.qtd_excedente)}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {r.codigo_usuario && (
                      <span className="flex items-center gap-1">
                        <UserIcon className="h-3 w-3" />
                        {r.codigo_usuario}
                      </span>
                    )}
                    {(r.centro_nome || r.codigo_centro_ctrl) && (
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {r.centro_nome || r.codigo_centro_ctrl}
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground/60">
                    OP: {r.op_numero || "—"} · Origem: {r.origem || "—"}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Paginação */}
      {!isLoading && !isError && total > 0 && totalPaginas > 1 && (
        <div className="flex items-center justify-between gap-4 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            Página {paginaCorrigida} de {totalPaginas}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina(1)}
              disabled={paginaCorrigida === 1}
              title="Primeira página"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={paginaCorrigida === 1}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={paginaCorrigida === totalPaginas}
            >
              Próxima
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPagina(totalPaginas)}
              disabled={paginaCorrigida === totalPaginas}
              title="Última página"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {podeCriar && <NovaRMModal open={modalOpen} onOpenChange={setModalOpen} onCreated={aoCriar} />}
    </div>
  );
}
