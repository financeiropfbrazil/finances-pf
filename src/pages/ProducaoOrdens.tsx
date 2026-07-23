import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
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
  Factory,
  Loader2,
  Search,
  X,
  Calendar as CalendarIcon,
  User as UserIcon,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { getStatusOP, STATUS_OP_ORDER } from "@/lib/statusOP";
import { listarOrdens, contarPorStatus, listarTipos } from "@/services/opService";

// ── Formatadores ─────────────────────────────────────────────────────────────

// Datas `date` do banco chegam como "YYYY-MM-DD" puro. new Date() as interpreta
// como meia-noite UTC e, em Brasília (UTC-3), "volta" um dia. Parse com
// componentes LOCAIS evita o escorregão (mesmo cuidado de SuprimentosPedidos).
function formatData(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const apenasData = iso.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(apenasData)) {
      const [ano, mes, dia] = apenasData.split("-").map(Number);
      if (ano && mes && dia) return format(new Date(ano, mes - 1, dia), "dd/MM/yyyy", { locale: ptBR });
    }
    return format(new Date(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return "—";
  }
}

const TIPO_ORDEM_LABEL: Record<string, string> = {
  FABRICACAO: "Fabricação",
  EMBALAGEM_FINAL: "Embalagem final",
};

const numeroFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

function resumoItens(op: { itens_count: number; itens_qtd_total: number }): string {
  if (!op.itens_count) return "—";
  const sku = `${op.itens_count} SKU${op.itens_count === 1 ? "" : "s"}`;
  return `${sku} · ${numeroFmt.format(op.itens_qtd_total)} un`;
}

// ── Helpers de data <-> URL (componentes locais, sem fuso) ─────────────────────

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

type SortDir = "asc" | "desc";

const PAGE_SIZE = 30;

export default function ProducaoOrdens() {
  const [searchParams, setSearchParams] = useSearchParams();
  const podeCriar = useHasPermission(PERMISSIONS.PRODUCAO_ORDENS_CREATE);

  // ── Estado (inicializado a partir da URL, para persistir na volta do detalhe) ──
  const [buscaInput, setBuscaInput] = useState(() => searchParams.get("busca") || "");
  const [buscaDebounced, setBuscaDebounced] = useState(() => searchParams.get("busca") || "");
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(buscaInput.trim()), 300);
    return () => clearTimeout(t);
  }, [buscaInput]);

  const [filtroStatus, setFiltroStatus] = useState(() => searchParams.get("status") || "todos");
  const [filtroTipo, setFiltroTipo] = useState(() => searchParams.get("tipo") || "todos");
  const [dataDe, setDataDe] = useState<Date | undefined>(() => paramToDate(searchParams.get("dataDe")));
  const [dataAte, setDataAte] = useState<Date | undefined>(() => paramToDate(searchParams.get("dataAte")));
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

  // ── Estado -> URL ──────────────────────────────────────────────────────────
  useEffect(() => {
    const next: Record<string, string> = {};
    if (buscaDebounced) next.busca = buscaDebounced;
    if (filtroStatus !== "todos") next.status = filtroStatus;
    if (filtroTipo !== "todos") next.tipo = filtroTipo;
    const di = dateToParam(dataDe);
    const df = dateToParam(dataAte);
    if (di) next.dataDe = di;
    if (df) next.dataAte = df;
    if (orderBy) {
      next.ordCampo = orderBy.field;
      next.ordDir = orderBy.dir;
    }
    if (pagina > 1) next.pagina = String(pagina);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaDebounced, filtroStatus, filtroTipo, dataDe, dataAte, orderBy, pagina]);

  // Reset de página quando filtros/ordenação mudam
  useEffect(() => {
    setPagina(1);
  }, [buscaDebounced, filtroStatus, filtroTipo, dataDe, dataAte, orderBy]);

  const filtrosComuns = {
    tipoId: filtroTipo,
    dataInicioDe: dateToParam(dataDe),
    dataInicioAte: dateToParam(dataAte),
    busca: buscaDebounced,
  };

  const { data: tipos = [] } = useQuery({
    queryKey: ["op_tipos"],
    queryFn: listarTipos,
  });

  const { data: counts = {} } = useQuery({
    queryKey: ["op_counts", filtrosComuns.tipoId, filtrosComuns.dataInicioDe, filtrosComuns.dataInicioAte, filtrosComuns.busca],
    queryFn: () => contarPorStatus(filtrosComuns),
  });

  const { data: result, isLoading } = useQuery({
    queryKey: [
      "op_lista",
      filtroStatus,
      filtroTipo,
      filtrosComuns.dataInicioDe,
      filtrosComuns.dataInicioAte,
      buscaDebounced,
      orderBy?.field,
      orderBy?.dir,
      pagina,
    ],
    queryFn: () =>
      listarOrdens({
        status: filtroStatus,
        ...filtrosComuns,
        orderBy,
        pagina,
        pageSize: PAGE_SIZE,
      }),
  });

  const ordens = result?.ordens || [];
  const total = result?.total || 0;
  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const paginaCorrigida = Math.min(pagina, totalPaginas);
  const totalGeral = Object.values(counts).reduce((s, n) => s + n, 0);

  const temFiltroAtivo =
    filtroStatus !== "todos" || filtroTipo !== "todos" || (!!dataDe && !!dataAte) || !!buscaDebounced || !!orderBy;

  const limparFiltros = () => {
    setFiltroStatus("todos");
    setFiltroTipo("todos");
    setDataDe(undefined);
    setDataAte(undefined);
    setBuscaInput("");
    setOrderBy(null);
  };

  const handleSort = (field: string) => {
    setOrderBy((prev) => {
      if (!prev || prev.field !== field) return { field, dir: "asc" };
      if (prev.dir === "asc") return { field, dir: "desc" };
      return null;
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

  const abrirNovaOP = () => toast.info("O modal de abertura da OP chega na OP-1.4.");
  const abrirDetalhe = () => toast.info("O detalhe da OP chega na OP-1.5.");

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Ordens de Produção</h1>
          <p className="text-sm text-muted-foreground">Acompanhe e emita as Ordens de Produção da P&amp;F.</p>
        </div>
        {podeCriar && (
          <Button onClick={abrirNovaOP}>
            <Plus className="h-4 w-4" />
            Nova OP
          </Button>
        )}
      </div>

      {/* Chips de contagem por status (clicáveis como filtro) */}
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
          Todas <span className="tabular-nums">{totalGeral}</span>
        </button>
        {STATUS_OP_ORDER.map((key) => {
          const cfg = getStatusOP(key);
          const n = counts[key] || 0;
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
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <div className="relative min-w-[240px] flex-1 max-w-sm">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Buscar</label>
            <Search className="pointer-events-none absolute left-2.5 top-[34px] h-4 w-4 text-muted-foreground" />
            <Input
              value={buscaInput}
              onChange={(e) => setBuscaInput(e.target.value)}
              placeholder="Número da OP (ex.: 2026-0501)"
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

          <div className="min-w-[170px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {STATUS_OP_ORDER.map((key) => (
                  <SelectItem key={key} value={key}>
                    {getStatusOP(key).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[170px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Tipo</label>
            <Select value={filtroTipo} onValueChange={setFiltroTipo}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {tipos.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[150px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Início de</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !dataDe && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dataDe ? format(dataDe, "dd/MM/yyyy", { locale: ptBR }) : "Data inicial"}
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

          <div className="min-w-[150px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Início até</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !dataAte && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dataAte ? format(dataAte, "dd/MM/yyyy", { locale: ptBR }) : "Data final"}
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

          {temFiltroAtivo && (
            <Button variant="ghost" size="sm" onClick={limparFiltros} className="text-muted-foreground">
              <X className="mr-1 h-3 w-3" /> Limpar filtros
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Contagem */}
      {!isLoading && total > 0 && (
        <p className="text-sm text-muted-foreground">
          {total === 1
            ? "1 OP encontrada"
            : totalPaginas > 1
              ? `Mostrando ${(paginaCorrigida - 1) * PAGE_SIZE + 1}–${Math.min(paginaCorrigida * PAGE_SIZE, total)} de ${total} OPs`
              : `${total} OPs encontradas`}
        </p>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : total === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border">
          <Card className="border-0 bg-transparent shadow-none text-center max-w-md">
            <CardContent className="flex flex-col items-center gap-4 pt-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <Factory className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {temFiltroAtivo ? "Nenhuma OP encontrada com os filtros aplicados" : "Nenhuma Ordem de Produção ainda"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {temFiltroAtivo
                    ? "Tente ajustar os filtros para ver mais resultados."
                    : "As OPs emitidas no Hub aparecerão aqui."}
                </p>
              </div>
              {podeCriar && !temFiltroAtivo && (
                <Button onClick={abrirNovaOP}>
                  <Plus className="h-4 w-4" />
                  Nova OP
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th
                      className="cursor-pointer select-none px-4 py-3 font-medium hover:text-foreground"
                      onClick={() => handleSort("numero")}
                    >
                      Nº {renderSortIcon("numero")}
                    </th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium">Tipo de ordem</th>
                    <th className="px-4 py-3 font-medium">Itens</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th
                      className="cursor-pointer select-none whitespace-nowrap px-4 py-3 font-medium hover:text-foreground"
                      onClick={() => handleSort("data_inicio")}
                    >
                      Início {renderSortIcon("data_inicio")}
                    </th>
                    <th className="px-4 py-3 font-medium">Emitido por</th>
                  </tr>
                </thead>
                <tbody>
                  {ordens.map((op) => {
                    const sv = getStatusOP(op.status);
                    return (
                      <tr
                        key={op.id}
                        className="cursor-pointer border-b last:border-b-0 transition-colors hover:bg-muted/40"
                        onClick={abrirDetalhe}
                      >
                        <td className="px-4 py-3 font-mono text-xs tabular-nums whitespace-nowrap">{op.numero}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{op.tipo_nome || "—"}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {TIPO_ORDEM_LABEL[op.tipo_ordem] || op.tipo_ordem}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap tabular-nums text-muted-foreground">
                          {resumoItens(op)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={cn(sv.className, "flex w-fit items-center gap-1.5")}>
                            <sv.Icon className={cn("h-3 w-3", sv.iconAnimate && "animate-spin")} />
                            {sv.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap tabular-nums">{formatData(op.data_inicio)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <UserIcon className="h-3 w-3 text-muted-foreground" />
                            {op.emitido_por_nome || op.emitido_depto || "—"}
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
      )}

      {/* Paginação */}
      {!isLoading && total > 0 && totalPaginas > 1 && (
        <div className="mt-6 flex items-center justify-between gap-4 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            Página {paginaCorrigida} de {totalPaginas}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setPagina(1)} disabled={paginaCorrigida === 1} title="Primeira página">
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
    </div>
  );
}
