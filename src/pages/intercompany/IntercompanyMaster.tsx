import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  AlertCircle,
  ArrowDownToLine,
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  AlertTriangle,
  HelpCircle,
  Banknote,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  atualizarKontoBlocoInline,
  buscarBlocosDetalhe,
  buscarDetalheMaster,
  buscarFiltrosDisponiveis,
  buscarTudoParaExportar,
  definirPagoMaster,
  listarKontosAtivos,
  listarMaster,
} from "@/services/intercompanyMasterListService";
import { MasterCambioModal } from "@/components/intercompany/MasterCambioModal";
import { downloadIntercompanyPdf } from "@/utils/downloadIntercompanyPdf";
import { toast } from "sonner";
import type {
  MasterBlocoDetalhe,
  MasterClassificationStatus,
  MasterFiltros,
  MasterFiltrosDisponiveis,
  MasterItem,
  MasterStatusUnificado,
} from "@/types/intercompanyMaster";

const PAGE_SIZE = 20;

const formatBRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatEUR = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "EUR" });
const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// ── Tom semântico (rotina = quieto, exceção = salta) ───────────────────────
type Tone = "danger" | "warning" | "success" | "info" | "muted";

const TONE_TEXT: Record<Tone, string> = {
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
  info: "text-info",
  muted: "text-muted-foreground",
};
const TONE_DOT: Record<Tone, string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  success: "bg-success",
  info: "bg-info",
  muted: "bg-muted-foreground",
};

// Status na LINHA: dot + texto em caixa alta (estilo ledger das imagens)
function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap text-[10px] font-bold uppercase tracking-wide",
        TONE_TEXT[tone],
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      {label}
    </span>
  );
}

// status_unificado → tom (emitida é rotina → muted; exceções saltam)
const statusTone: Record<MasterStatusUnificado, Tone> = {
  rascunho: "muted",
  pendente_emissao: "warning",
  emitida: "muted",
  erro: "danger",
  sincronizada: "info",
  classificada: "success",
  pendente_eur: "warning",
  pendente_revisao: "warning",
  validada: "success",
  reconciliada: "info",
};

// Para os badges de contagem do resumo (tokenizados)
const statusColor: Record<MasterStatusUnificado, string> = {
  rascunho: "bg-muted text-muted-foreground border-border",
  pendente_emissao: "bg-warning/12 text-warning border-warning/30",
  emitida: "bg-muted text-muted-foreground border-border",
  erro: "bg-danger/15 text-danger border-danger/40",
  sincronizada: "bg-info/12 text-info border-info/30",
  classificada: "bg-success/12 text-success border-success/30",
  pendente_eur: "bg-warning/12 text-warning border-warning/30",
  pendente_revisao: "bg-warning/12 text-warning border-warning/30",
  validada: "bg-success/12 text-success border-success/30",
  reconciliada: "bg-info/12 text-info border-info/30",
};

const classificationTone: Record<MasterClassificationStatus, Tone> = {
  classified: "success",
  needs_konto_at: "warning",
  unclassified: "danger",
};

const classificationColor: Record<MasterClassificationStatus, string> = {
  classified: "bg-success/12 text-success border-success/30",
  needs_konto_at: "bg-warning/12 text-warning border-warning/30",
  unclassified: "bg-danger/15 text-danger border-danger/40 font-medium",
};

const classificationLabel: Record<MasterClassificationStatus, string> = {
  classified: "Classified",
  needs_konto_at: "Needs Konto AT",
  unclassified: "Unclassified",
};

const classificationEmoji: Record<MasterClassificationStatus, string> = {
  classified: "✓",
  needs_konto_at: "!",
  unclassified: "?",
};

export default function IntercompanyMaster() {
  const navigate = useNavigate();

  // ─── STATE: Filtros ───────────────────────────────────────────────────
  const [dataDe, setDataDe] = useState<Date | undefined>(undefined);
  const [dataAte, setDataAte] = useState<Date | undefined>(undefined);
  const [tipo, setTipo] = useState<string>("");
  const [statusF, setStatusF] = useState<string>("");
  const [origem, setOrigem] = useState<string>("");
  const [classe, setClasse] = useState<string>("");
  const [konto, setKonto] = useState<string>("");
  const [ccCode, setCcCode] = useState<string>("");
  const [ccPopoverOpen, setCcPopoverOpen] = useState(false);
  const [ccSearch, setCcSearch] = useState("");
  const [busca, setBusca] = useState<string>("");
  const [buscaDebounced, setBuscaDebounced] = useState<string>("");
  const [page, setPage] = useState(1);
  const [detailItem, setDetailItem] = useState<MasterItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [exportando, setExportando] = useState(false);

  // ─── STATE: Modal câmbio ──────────────────────────────────────────────
  const [cambioModalOpen, setCambioModalOpen] = useState(false);
  const [cambioMasterItem, setCambioMasterItem] = useState<MasterItem | null>(null);

  // Debounce busca
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 400);
    return () => clearTimeout(t);
  }, [busca]);

  // Reset page ao mudar filtros
  useEffect(() => {
    setPage(1);
  }, [dataDe, dataAte, tipo, statusF, origem, classe, konto, ccCode, buscaDebounced]);

  const filtros: MasterFiltros = useMemo(
    () => ({
      data_de: dataDe ? format(dataDe, "yyyy-MM-dd") : null,
      data_ate: dataAte ? format(dataAte, "yyyy-MM-dd") : null,
      tipo: (tipo || null) as any,
      status: (statusF || null) as any,
      origem: (origem || null) as any,
      classe_codigo: classe || null,
      konto_at_numero: konto || null,
      cc_erp_code: ccCode || null,
      busca: buscaDebounced || null,
    }),
    [dataDe, dataAte, tipo, statusF, origem, classe, konto, ccCode, buscaDebounced],
  );

  const filtrosAtivos = useMemo(() => {
    return Object.values(filtros).filter((v) => v !== null && v !== "").length;
  }, [filtros]);

  // ─── Queries ──────────────────────────────────────────────────────────
  const filtrosQuery = useQuery({
    queryKey: ["intercompany_master_filtros_disponiveis"],
    queryFn: buscarFiltrosDisponiveis,
    staleTime: 5 * 60 * 1000,
  });

  const listQuery = useQuery({
    queryKey: ["intercompany_master_list", filtros, page],
    queryFn: () => listarMaster(filtros, page, PAGE_SIZE),
  });

  const filtrosDisp: MasterFiltrosDisponiveis | undefined = filtrosQuery.data;

  // ─── Handlers ─────────────────────────────────────────────────────────
  const limparFiltros = () => {
    setDataDe(undefined);
    setDataAte(undefined);
    setTipo("");
    setStatusF("");
    setOrigem("");
    setClasse("");
    setKonto("");
    setCcCode("");
    setBusca("");
  };

  const handleExportar = async () => {
    setExportando(true);
    try {
      const todosItems = await buscarTudoParaExportar(filtros);

      // Aba 1: Invoices (headers em inglês)
      const lista = todosItems.map((i) => ({
        "Invoice No": i.numero_invoice ?? "",
        Date: i.data_emissao ?? "",
        Type: i.tipo,
        Specie: i.especie,
        "Class Code": i.classe_codigo ?? "",
        "Class Name": i.classe_nome ?? "",
        "Konto AT": i.konto_at_numero ?? "",
        "Konto Description": i.konto_at_descricao ?? "",
        "Amount EUR": i.valor_eur,
        "Amount BRL": i.valor_brl,
        "Exchange Rate": i.cambio,
        "Total Blocks": i.total_blocos,
        "Total CCs": i.total_ccs,
        "Cost Centers": i.ccs_codigos.join(" | "),
        Source: i.origem,
        Status: i.status_label,
        "Status Reason": i.status_motivo ?? "",
        Classification: classificationLabel[i.classification_status_agregado],
        "Alvo Key": i.chave_docfin_alvo ?? "",
        "Alvo Document No": i.numero_documento_alvo ?? "",
        Description: i.descricao ?? "",
        "Alvo Category": i.origem_categoria ?? "",
        "Created At": i.created_at,
        "Issued At": i.emitida_em ?? "",
      }));

      // Aba 2: Resumo
      const resumo = [
        { Metric: "Total invoices", Value: listQuery.data?.resumo.total_invoices ?? 0 },
        { Metric: "Total EUR", Value: listQuery.data?.resumo.soma_eur ?? 0 },
        { Metric: "Total BRL", Value: listQuery.data?.resumo.soma_brl ?? 0 },
        { Metric: "Hub-created", Value: listQuery.data?.resumo.qtd_hub ?? 0 },
        { Metric: "Alvo-synced", Value: listQuery.data?.resumo.qtd_alvo ?? 0 },
        { Metric: "", Value: "" },
        { Metric: "── Status Distribution ──", Value: "" },
        ...(listQuery.data?.resumo.por_status ?? []).map((s) => ({
          Metric: s.label,
          Value: s.qtd,
        })),
      ];

      // Aba 3: Filtros aplicados
      const filtrosAplicados = Object.entries(filtros)
        .filter(([_, v]) => v !== null && v !== "")
        .map(([k, v]) => ({ Filter: k, Value: String(v) }));
      if (filtrosAplicados.length === 0) {
        filtrosAplicados.push({ Filter: "(none)", Value: "All invoices" });
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lista), "Invoices");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "Summary");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filtrosAplicados), "Filters Applied");

      const dataStr = format(new Date(), "yyyy-MM-dd_HH-mm");
      XLSX.writeFile(wb, `intercompany_master_${dataStr}.xlsx`);
    } catch (err) {
      console.error("Erro ao exportar:", err);
      alert(`Erro ao exportar: ${(err as Error).message}`);
    } finally {
      setExportando(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Intercompany Master</h1>
          <p className="text-sm text-muted-foreground">Invoices intercompany P&amp;F ↔ PEF Áustria</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportar} disabled={exportando || listQuery.isLoading}>
            {exportando ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Exportando...
              </>
            ) : (
              <>
                <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
                Exportar Excel
              </>
            )}
          </Button>
          <Button size="sm" onClick={() => navigate("/intercompany/reembolsos/novo")}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Novo Reembolso
          </Button>
        </div>
      </div>

      {/* Barra de Filtros */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Filtros</span>
              {filtrosAtivos > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {filtrosAtivos} ativo{filtrosAtivos > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            {filtrosAtivos > 0 && (
              <Button variant="ghost" size="sm" onClick={limparFiltros} className="h-7 text-xs">
                <X className="mr-1 h-3 w-3" />
                Limpar
              </Button>
            )}
          </div>

          {/* Linha 1 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Data de</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-full justify-start text-left font-normal h-9 text-xs",
                      !dataDe && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {dataDe ? format(dataDe, "dd/MM/yyyy", { locale: ptBR }) : "—"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dataDe} onSelect={setDataDe} initialFocus locale={ptBR} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Data até</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-full justify-start text-left font-normal h-9 text-xs",
                      !dataAte && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {dataAte ? format(dataAte, "dd/MM/yyyy", { locale: ptBR }) : "—"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dataAte} onSelect={setDataAte} initialFocus locale={ptBR} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Tipo</Label>
              <Select value={tipo || "_all"} onValueChange={(v) => setTipo(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {(filtrosDisp?.tipos ?? []).map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Status</Label>
              <Select value={statusF || "_all"} onValueChange={(v) => setStatusF(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {(filtrosDisp?.status ?? []).map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Origem</Label>
              <Select value={origem || "_all"} onValueChange={(v) => setOrigem(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  {(filtrosDisp?.origens ?? []).map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Linha 2 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Classe</Label>
              <Select value={classe || "_all"} onValueChange={(v) => setClasse(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  {(filtrosDisp?.classes ?? []).map((c) => (
                    <SelectItem key={c.codigo} value={c.codigo}>
                      <span className="font-mono mr-1.5">{c.codigo}</span>
                      <span className="text-muted-foreground">{c.nome}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Konto AT</Label>
              <Select value={konto || "_all"} onValueChange={(v) => setKonto(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {(filtrosDisp?.kontos ?? []).map((k) => (
                    <SelectItem key={k.numero} value={k.numero}>
                      <span className="font-mono mr-1.5">{k.numero}</span>
                      <span className="text-muted-foreground">{k.descricao}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Centro de Custo</Label>
              <Popover open={ccPopoverOpen} onOpenChange={setCcPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-between h-9 text-xs font-normal">
                    {ccCode ? (
                      <span className="truncate text-left font-mono">{ccCode}</span>
                    ) : (
                      <span className="text-muted-foreground">Todos</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput placeholder="Buscar CC..." value={ccSearch} onValueChange={setCcSearch} />
                    <CommandList>
                      <CommandEmpty>Nenhum CC encontrado.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          onSelect={() => {
                            setCcCode("");
                            setCcPopoverOpen(false);
                            setCcSearch("");
                          }}
                        >
                          <span className="text-muted-foreground">Todos</span>
                        </CommandItem>
                        {(filtrosDisp?.ccs ?? [])
                          .filter((cc) => {
                            const q = ccSearch.trim().toLowerCase();
                            if (!q) return true;
                            return cc.name.toLowerCase().includes(q) || cc.erp_code.toLowerCase().includes(q);
                          })
                          .slice(0, 50)
                          .map((cc) => (
                            <CommandItem
                              key={cc.erp_code}
                              value={cc.erp_code}
                              onSelect={() => {
                                setCcCode(cc.erp_code);
                                setCcPopoverOpen(false);
                                setCcSearch("");
                              }}
                            >
                              <div className="flex flex-col">
                                <span className="text-sm">{cc.name}</span>
                                <span className="text-xs text-muted-foreground font-mono">{cc.erp_code}</span>
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
              <Label className="text-[10px] uppercase text-muted-foreground">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Nº invoice ou descrição..."
                  className="pl-7 h-9 text-xs"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumo — EUR herói */}
      {listQuery.data?.resumo && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-4">
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total EUR</span>
              <span className="font-mono text-2xl font-bold leading-none tabular-nums">
                {formatEUR(listQuery.data.resumo.soma_eur)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total BRL</span>
              <span className="mt-1 font-mono text-base font-semibold leading-none tabular-nums text-muted-foreground">
                {formatBRL(listQuery.data.resumo.soma_brl)}
              </span>
            </div>

            <div className="h-8 w-px bg-border" />

            <div className="flex flex-col">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Invoices</span>
              <span className="mt-1 text-base font-bold leading-none tabular-nums">
                {listQuery.data.resumo.total_invoices}
              </span>
            </div>
            <Badge variant="outline" className="text-[10px]">
              Hub: {listQuery.data.resumo.qtd_hub}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Alvo: {listQuery.data.resumo.qtd_alvo}
            </Badge>

            <div className="h-8 w-px bg-border hidden md:block" />

            <div className="flex flex-wrap items-center gap-1.5">
              {listQuery.data.resumo.por_status.map((s) => (
                <Badge
                  key={s.status}
                  variant="outline"
                  className={`text-[10px] border ${statusColor[s.status as MasterStatusUnificado] ?? ""}`}
                >
                  {s.label}: {s.qtd}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {listQuery.isLoading && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {/* Error */}
      {listQuery.error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-destructive">Erro ao carregar invoices</p>
              <p className="text-xs text-muted-foreground mt-1 break-words">
                {(listQuery.error as Error)?.message ?? "Erro desconhecido"}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => listQuery.refetch()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!listQuery.isLoading && !listQuery.error && listQuery.data?.items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mb-2 opacity-40" />
            <p className="text-sm">Nenhum invoice encontrado com os filtros atuais.</p>
            {filtrosAtivos > 0 && (
              <Button variant="link" size="sm" onClick={limparFiltros} className="mt-2">
                Limpar filtros
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabela */}
      {!listQuery.isLoading && !listQuery.error && listQuery.data?.items && listQuery.data.items.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-1 text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-3 py-3 font-bold">Nº Invoice</th>
                  <th className="px-3 py-3 font-bold">Data</th>
                  <th className="px-3 py-3 font-bold">Tipo</th>
                  <th className="px-3 py-3 font-bold">Konto AT</th>
                  <th className="px-3 py-3 font-bold text-right">EUR</th>
                  <th className="px-3 py-3 font-bold">Classific.</th>
                  <th className="px-3 py-3 font-bold w-8" />
                </tr>
              </thead>
              <tbody>
                {listQuery.data.items.map((item, idx) => (
                  <MasterRow
                    key={`${item.source_table}-${item.id}`}
                    item={item}
                    index={idx}
                    onOpen={() => {
                      setDetailItem(item);
                      setDetailOpen(true);
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          <div className="flex items-center justify-between border-t border-border bg-surface-1 px-4 py-2.5 text-xs">
            <span className="text-muted-foreground">
              Mostrando {listQuery.data.items.length} de {listQuery.data.pagination.total} · Página{" "}
              {listQuery.data.pagination.page} de {listQuery.data.pagination.total_pages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || listQuery.isFetching}
                className="h-7 text-xs"
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= listQuery.data.pagination.total_pages || listQuery.isFetching}
                className="h-7 text-xs"
              >
                Próximo
              </Button>
            </div>
          </div>
        </Card>
      )}

      <InvoiceDetailSheet
        item={detailItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEditCambio={() => {
          if (detailItem) {
            setCambioMasterItem(detailItem);
            setCambioModalOpen(true);
          }
        }}
      />

      <MasterCambioModal
        open={cambioModalOpen}
        onOpenChange={setCambioModalOpen}
        masterId={cambioMasterItem?.id ?? null}
        numeroInvoice={cambioMasterItem?.numero_invoice ?? null}
        valorBrl={cambioMasterItem?.valor_brl ?? null}
        cambioAtual={cambioMasterItem?.cambio ?? null}
        valorEurAtual={cambioMasterItem?.valor_eur ?? null}
        onSaved={() => {
          listQuery.refetch();
        }}
      />
    </div>
  );
}

interface MasterRowProps {
  item: MasterItem;
  index: number;
  onOpen: () => void;
}

function MasterRow({ item, index, onOpen }: MasterRowProps) {
  const rowBg = index % 2 === 1 ? "bg-muted/15 hover:bg-muted/30" : "hover:bg-muted/20";

  return (
    <tr className={cn("group cursor-pointer transition-colors", rowBg)} onClick={onOpen}>
      <td className="px-3 py-2.5 font-mono text-xs tabular-nums">{item.numero_invoice ?? "—"}</td>
      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{formatDate(item.data_emissao)}</td>
      <td className="px-3 py-2.5">
        <Badge variant="outline" className="text-[10px] capitalize">
          {item.tipo}
        </Badge>
      </td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        {item.total_blocos === 1 ? (
          <KontoInlineEditor item={item} />
        ) : item.total_blocos > 1 ? (
          <span
            className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground"
            title="Invoice com vários blocos — classifique pela tela de blocos (abra a invoice)"
          >
            {item.konto_at_numero ?? "—"}
            <Lock className="h-3 w-3 opacity-40" />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums">{formatEUR(item.valor_eur)}</td>
      <td className="px-3 py-2.5">
        <StatusDot
          tone={classificationTone[item.classification_status_agregado]}
          label={classificationLabel[item.classification_status_agregado]}
        />
      </td>
      <td className="px-3 py-2.5 text-right">
        <ChevronRight className="inline-block h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
      </td>
    </tr>
  );
}

// ─── Editor inline do Konto (célula da listagem) ─────────────────────────

function KontoInlineEditor({ item }: { item: MasterItem }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const kontosQuery = useQuery({
    queryKey: ["intercompany_kontos_ativos"],
    queryFn: listarKontosAtivos,
    staleTime: 10 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: (kontoNumero: string) => atualizarKontoBlocoInline(item.id, kontoNumero),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["intercompany_master_list"] });
    },
    onError: (err: any) => {
      alert(`Não foi possível alterar o Konto: ${err?.message ?? "erro desconhecido"}`);
    },
  });

  // compatível com react-query v4 (isLoading) e v5 (isPending)
  const isSaving = (mutation as any).isPending ?? (mutation as any).isLoading ?? false;
  const kontos = kontosQuery.data ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isSaving}
          className={cn(
            "group -mx-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-xs tabular-nums",
            "hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60",
          )}
          title="Clique para alterar o Konto"
        >
          {isSaving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : item.konto_at_numero ? (
            <span>{item.konto_at_numero}</span>
          ) : (
            <span className="text-warning">definir</span>
          )}
          <ChevronsUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar Konto..." />
          <CommandList>
            <CommandEmpty>Nenhum Konto encontrado.</CommandEmpty>
            <CommandGroup>
              {kontos.map((k) => (
                <CommandItem
                  key={k.numero}
                  value={`${k.numero} ${k.descricao}`}
                  onSelect={() => {
                    setOpen(false);
                    if (k.numero !== item.konto_at_numero) {
                      mutation.mutate(k.numero);
                    }
                  }}
                >
                  <span className="mr-2 font-mono text-xs tabular-nums">{k.numero}</span>
                  <span className="text-xs text-muted-foreground">{k.descricao}</span>
                  {k.numero === item.konto_at_numero && <Check className="ml-auto h-3.5 w-3.5 opacity-70" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Painel lateral de detalhe da invoice ────────────────────────────────

interface InvoiceDetailSheetProps {
  item: MasterItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEditCambio: () => void;
}

// origem (enum cru do master) → bucket de Storage do PDF
const ORIGEM_BUCKET: Record<string, string> = {
  criada_hub: "intercompany-reembolso-nf",
  criada_hub_manual: "intercompany-reembolso-manual",
};

function InvoiceDetailSheet({ item, open, onOpenChange, onEditCambio }: InvoiceDetailSheetProps) {
  const queryClient = useQueryClient();

  const blocosQuery = useQuery({
    queryKey: ["intercompany_master_blocos", item?.id],
    queryFn: () => buscarBlocosDetalhe(item!.id),
    enabled: open && !!item && item.total_blocos > 0,
  });

  const detalheQuery = useQuery({
    queryKey: ["intercompany_master_detalhe", item?.id],
    queryFn: () => buscarDetalheMaster(item!.id),
    enabled: open && !!item,
  });

  const pagoMutation = useMutation({
    mutationFn: (pago: boolean) => definirPagoMaster(item!.id, pago),
    onSuccess: (_data, pago) => {
      queryClient.invalidateQueries({ queryKey: ["intercompany_master_detalhe", item?.id] });
      toast.success(pago ? "Marcada como paga" : "Marcada como não paga");
    },
    onError: (err: any) => {
      toast.error(`Não foi possível alterar Pago: ${err?.message ?? "erro desconhecido"}`);
    },
  });

  if (!item) return null;

  const detalhe = detalheQuery.data;
  const pago = detalhe?.pago ?? false;
  const anexo = detalhe?.anexos?.[0];
  const bucket = detalhe ? ORIGEM_BUCKET[detalhe.origem] : undefined;
  const podeBaixarPdf = !!anexo && !!bucket;
  const isSavingPago = (pagoMutation as any).isPending ?? (pagoMutation as any).isLoading ?? false;

  const handleBaixarPdf = async () => {
    if (!anexo || !bucket) return;
    const ok = await downloadIntercompanyPdf(bucket, anexo.storage_path, anexo.filename);
    if (ok) toast.success("PDF baixado");
    else toast.error("Não foi possível baixar o PDF");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-md">
        {/* Cabeçalho herói */}
        <SheetHeader className="space-y-2 border-b border-border bg-surface-1 px-6 py-5 text-left">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="font-mono text-lg tabular-nums">{item.numero_invoice ?? "—"}</SheetTitle>
            <StatusDot tone={statusTone[item.status_unificado] ?? "muted"} label={item.status_label} />
          </div>
          <p className="font-mono text-2xl font-bold tabular-nums">{formatEUR(item.valor_eur)}</p>
        </SheetHeader>

        <div className="space-y-5 px-6 py-5">
          {/* RESUMO */}
          <DetailSection title="Resumo">
            <DetailGrid>
              <DetailField label="Tipo" value={item.tipo} />
              <DetailField label="Espécie" value={item.especie} />
              <DetailField label="Data emissão" value={formatDate(item.data_emissao)} mono />
              <DetailField label="Origem" value={item.origem} />
            </DetailGrid>
            {item.status_motivo && (
              <div className="mt-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs">
                <span className="font-medium text-warning">Status:</span>{" "}
                <span className="text-warning">{item.status_motivo}</span>
              </div>
            )}
          </DetailSection>

          {/* VALORES */}
          <DetailSection title="Valores">
            <DetailGrid>
              <DetailField label="EUR" value={formatEUR(item.valor_eur)} mono />
              <DetailField label="BRL" value={formatBRL(item.valor_brl)} mono />
              <DetailField
                label="Câmbio"
                value={item.cambio == null ? "—" : item.cambio.toLocaleString("pt-BR", { minimumFractionDigits: 4 })}
                mono
              />
            </DetailGrid>
          </DetailSection>

          {/* CLASSIFICAÇÃO */}
          <DetailSection title="Classificação">
            <DetailGrid>
              <DetailField label="Classe BR" value={item.classe_codigo ?? "—"} mono />
              <DetailField label="Classe nome" value={item.classe_nome ?? "—"} />
              <DetailField label="Konto AT" value={item.konto_at_numero ?? "—"} mono />
              <DetailField label="Konto desc." value={item.konto_at_descricao ?? "—"} />
            </DetailGrid>
            <div className="mt-2">
              <StatusDot
                tone={classificationTone[item.classification_status_agregado]}
                label={classificationLabel[item.classification_status_agregado]}
              />
            </div>
          </DetailSection>

          {/* DOCUMENTO (ALVO) */}
          <DetailSection title="Documento (Alvo)">
            <DetailGrid>
              <DetailField label="Nº NF/Doc" value={item.numero_documento_alvo ?? "—"} mono />
              <DetailField
                label="Chave Alvo"
                value={item.chave_docfin_alvo ? String(item.chave_docfin_alvo) : "—"}
                mono
              />
              <DetailField label="Categoria" value={item.origem_categoria ?? "—"} />
            </DetailGrid>
            {item.descricao && (
              <div className="mt-2 text-xs">
                <span className="uppercase tracking-wide text-muted-foreground">Descrição</span>
                <p className="mt-0.5 italic">{item.descricao}</p>
              </div>
            )}
          </DetailSection>

          {/* BLOCOS & RATEIOS */}
          {item.total_blocos > 0 && (
            <DetailSection title={`Blocos & Rateios (${item.total_blocos})`}>
              {blocosQuery.isLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Carregando blocos...
                </div>
              )}
              {blocosQuery.data && blocosQuery.data.length > 0 && (
                <div className="space-y-2">
                  {blocosQuery.data.map((bloco) => (
                    <BlocoCard key={bloco.id} bloco={bloco} />
                  ))}
                </div>
              )}
            </DetailSection>
          )}

          {/* AÇÕES */}
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ações</p>

            {/* Pago — liga/desliga */}
            <div className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Pago</span>
                {isSavingPago && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
              </div>
              <Switch
                checked={pago}
                disabled={isSavingPago || detalheQuery.isLoading}
                onCheckedChange={(v) => pagoMutation.mutate(v)}
              />
            </div>

            {/* Editar câmbio */}
            <Button variant="outline" size="sm" className="w-full justify-start" onClick={onEditCambio}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Editar câmbio
            </Button>

            {/* Baixar PDF */}
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              disabled={!podeBaixarPdf}
              onClick={handleBaixarPdf}
              title={podeBaixarPdf ? undefined : "Esta invoice não tem PDF próprio no Hub"}
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              Baixar PDF
            </Button>

            {/* Marcar reconciliado — em breve */}
            <Button variant="outline" size="sm" className="w-full justify-start" disabled title="Em breve">
              <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
              Marcar reconciliado
              <Badge variant="secondary" className="ml-auto text-[9px]">
                em breve
              </Badge>
            </Button>

            {/* Ir para classificação — em breve */}
            <Button variant="outline" size="sm" className="w-full justify-start" disabled title="Em breve">
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Ir para classificação
              <Badge variant="secondary" className="ml-auto text-[9px]">
                em breve
              </Badge>
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function DetailGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">{children}</div>;
}

// ─── Card de cada bloco ──────────────────────────────────────────────────

function BlocoCard({ bloco }: { bloco: MasterBlocoDetalhe }) {
  const classEmoji = classificationEmoji[bloco.classification_status];

  return (
    <div className="rounded-md border border-border bg-surface-3 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold">Bloco #{bloco.ordem}</span>
            {bloco.tipo_bloco && (
              <Badge variant="outline" className="text-[9px]">
                {bloco.tipo_bloco}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-[9px] border ${classificationColor[bloco.classification_status]}`}
            >
              <span className="mr-1 font-bold">{classEmoji}</span>
              {classificationLabel[bloco.classification_status]}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{bloco.descricao}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-mono font-semibold tabular-nums">{formatEUR(bloco.valor_eur)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-[10px] pt-2 border-t border-border/50">
        <div>
          <span className="text-muted-foreground uppercase tracking-wide">Classe BR</span>
          <p className="font-mono tabular-nums">{bloco.classe_codigo ?? "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground uppercase tracking-wide">Konto AT</span>
          <p className="font-mono tabular-nums">{bloco.konto_at_numero ?? "—"}</p>
        </div>
        {bloco.konto_at_descricao && (
          <div>
            <span className="text-muted-foreground uppercase tracking-wide">Konto Desc.</span>
            <p>{bloco.konto_at_descricao}</p>
          </div>
        )}
      </div>

      {/* Rateios CC */}
      {bloco.rateios.length > 0 && (
        <div className="pt-2 border-t border-border/50">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Centros de Custo ({bloco.rateios.length})
          </p>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="font-medium pb-1">CC</th>
                <th className="font-medium pb-1">Nome</th>
                <th className="font-medium text-right pb-1">%</th>
                <th className="font-medium text-right pb-1">EUR</th>
              </tr>
            </thead>
            <tbody>
              {bloco.rateios.map((r) => (
                <tr key={r.centro_custo_erp_code}>
                  <td className="font-mono py-0.5 tabular-nums">{r.centro_custo_erp_code}</td>
                  <td>{r.centro_custo_nome ?? "—"}</td>
                  <td className="text-right font-mono tabular-nums">{r.percentual.toFixed(2)}%</td>
                  <td className="text-right font-mono tabular-nums">{formatEUR(r.valor_eur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-muted-foreground uppercase tracking-wide block">{label}</span>
      <span className={cn("text-foreground", mono && "font-mono tabular-nums")}>{value}</span>
    </div>
  );
}
