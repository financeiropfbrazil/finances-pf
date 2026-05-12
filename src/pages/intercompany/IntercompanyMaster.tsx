import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  AlertCircle,
  ArrowDownToLine,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  AlertTriangle,
  CloudDownload,
  HelpCircle,
  FileText,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  buscarBlocosDetalhe,
  buscarFiltrosDisponiveis,
  buscarTudoParaExportar,
  listarMaster,
} from "@/services/intercompanyMasterListService";
import { syncIntercompanyFromAlvo, type SyncBatchResponse } from "@/services/intercompanySyncService";
import { useToast } from "@/hooks/use-toast";
import type {
  MasterBlocoDetalhe,
  MasterClassificationStatus,
  MasterFiltros,
  MasterFiltrosDisponiveis,
  MasterItem,
  MasterStatusUnificado,
} from "@/types/intercompanyMaster";

const PAGE_SIZE = 20;

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatEUR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "EUR" });
const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const statusColor: Record<MasterStatusUnificado, string> = {
  rascunho: "bg-slate-500/15 text-slate-700 border-slate-300",
  pendente_emissao: "bg-amber-500/15 text-amber-700 border-amber-300",
  emitida: "bg-emerald-500/15 text-emerald-700 border-emerald-300",
  erro: "bg-red-500/15 text-red-700 border-red-300",
  sincronizada: "bg-blue-500/15 text-blue-700 border-blue-300",
  classificada: "bg-violet-500/15 text-violet-700 border-violet-300",
  pendente_eur: "bg-orange-500/15 text-orange-700 border-orange-300",
  pendente_revisao: "bg-yellow-500/15 text-yellow-700 border-yellow-300",
  validada: "bg-teal-500/15 text-teal-700 border-teal-300",
  reconciliada: "bg-cyan-600/15 text-cyan-700 border-cyan-300",
};

const classificationColor: Record<MasterClassificationStatus, string> = {
  classified: "bg-emerald-500/15 text-emerald-700 border-emerald-300",
  needs_konto_at: "bg-amber-500/15 text-amber-700 border-amber-300",
  unclassified: "bg-red-500/15 text-red-700 border-red-300",
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
  const { toast } = useToast();

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  // ─── STATE: Sync modal ────────────────────────────────────────────────
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncDataDe, setSyncDataDe] = useState<Date | undefined>(undefined);
  const [syncDataAte, setSyncDataAte] = useState<Date | undefined>(undefined);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncBatchResponse | null>(null);

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

  // ─── Sync do Alvo ─────────────────────────────────────────────────────
  const handleSync = async () => {
    if (!syncDataDe) {
      toast({
        title: "Data inicial obrigatória",
        description: "Selecione a data de início da janela de sincronização.",
        variant: "destructive",
      });
      return;
    }

    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncIntercompanyFromAlvo({
        dataInicial: format(syncDataDe, "yyyy-MM-dd"),
        dataFinal: syncDataAte ? format(syncDataAte, "yyyy-MM-dd") : undefined,
      });

      setSyncResult(result);

      const { summary, persistence } = result;
      const persistOk = persistence?.success ?? false;
      const persisted = persistence ? persistence.inserted + persistence.updated : 0;

      // Caso 1: nada encontrado no Alvo (não é erro, é resultado válido)
      if (summary.total_mapped === 0 && summary.total_failed === 0) {
        toast({
          title: "Nenhum documento encontrado",
          description: "O Alvo não retornou DocFins intercompany nessa janela de datas.",
        });
      }
      // Caso 2: tudo OK
      else if (persistOk && summary.total_failed === 0) {
        toast({
          title: "Sincronização concluída",
          description: `${persisted} invoice(s) atualizadas (${persistence!.inserted} novas, ${persistence!.updated} atualizadas).`,
        });
      }
      // Caso 3: parcial — Alvo OK mas algumas falhas
      else if (persistOk && summary.total_failed > 0) {
        toast({
          title: "Sincronização parcial",
          description: `${persisted} persistidas. ${summary.total_failed} falharam no Alvo.`,
          variant: "destructive",
        });
      }
      // Caso 4: falha real na persistência
      else {
        toast({
          title: "Falha na persistência",
          description: persistence?.fatal_error ?? "Erro desconhecido ao gravar no banco.",
          variant: "destructive",
        });
      }

      // Refetch o Master pra mostrar invoices que tenham virado master
      listQuery.refetch();
    } catch (err) {
      toast({
        title: "Erro ao sincronizar",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSyncDataDe(undefined);
              setSyncDataAte(undefined);
              setSyncResult(null);
              setSyncModalOpen(true);
            }}
          >
            <CloudDownload className="mr-1.5 h-3.5 w-3.5" />
            Sincronizar do Alvo
          </Button>
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

      {/* ─── Modal: Sincronizar do Alvo ─── */}
      <Dialog open={syncModalOpen} onOpenChange={(open) => !syncing && setSyncModalOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CloudDownload className="h-5 w-5" />
              Sincronizar do Alvo
            </DialogTitle>
            <DialogDescription>
              Busca DocFins intercompany (NF-e, NFS-e, INV) da PEF Áustria no Alvo e atualiza o Hub. Operação
              idempotente — rodar duas vezes não duplica.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">Data inicial *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "w-full justify-start text-left font-normal h-9 text-xs",
                        !syncDataDe && "text-muted-foreground",
                      )}
                      disabled={syncing}
                    >
                      <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                      {syncDataDe ? format(syncDataDe, "dd/MM/yyyy", { locale: ptBR }) : "Selecione..."}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={syncDataDe} onSelect={setSyncDataDe} initialFocus locale={ptBR} />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-1">
                <Label className="text-xs uppercase text-muted-foreground">Data final (opcional)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "w-full justify-start text-left font-normal h-9 text-xs",
                        !syncDataAte && "text-muted-foreground",
                      )}
                      disabled={syncing}
                    >
                      <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                      {syncDataAte ? format(syncDataAte, "dd/MM/yyyy", { locale: ptBR }) : "Hoje"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={syncDataAte} onSelect={setSyncDataAte} locale={ptBR} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <p className="text-xs text-muted-foreground italic">
              Janelas pequenas (~1 semana) levam ~5s. Janelas grandes (~3 meses) podem levar até 30s.
            </p>

            {/* Resultado da sincronização */}
            {syncResult && (
              <Card className="border-muted bg-muted/20">
                <CardContent className="space-y-2 p-3 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold">
                    {syncResult.summary.total_mapped === 0 && syncResult.summary.total_failed === 0 ? (
                      <CheckCircle2 className="h-4 w-4 text-slate-500" />
                    ) : syncResult.persistence?.success ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    )}
                    Última execução
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 pl-5">
                    <span className="text-muted-foreground">Listados no Alvo:</span>
                    <span className="font-mono">{syncResult.summary.total_listed}</span>
                    <span className="text-muted-foreground">Mapeados:</span>
                    <span className="font-mono">{syncResult.summary.total_mapped}</span>
                    {syncResult.persistence && (
                      <>
                        <span className="text-muted-foreground">Inseridos:</span>
                        <span className="font-mono text-emerald-700">{syncResult.persistence.inserted}</span>
                        <span className="text-muted-foreground">Atualizados:</span>
                        <span className="font-mono text-blue-700">{syncResult.persistence.updated}</span>
                      </>
                    )}
                    {syncResult.summary.total_failed > 0 && (
                      <>
                        <span className="text-muted-foreground">Falhas:</span>
                        <span className="font-mono text-destructive">{syncResult.summary.total_failed}</span>
                      </>
                    )}
                    <span className="text-muted-foreground">Tempo:</span>
                    <span className="font-mono">{(syncResult.summary.elapsed_ms / 1000).toFixed(1)}s</span>
                  </div>
                  {syncResult.persistence?.fatal_error && (
                    <p className="text-destructive pl-5 pt-1 break-words">
                      <strong>Erro:</strong> {syncResult.persistence.fatal_error}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSyncModalOpen(false)} disabled={syncing}>
              {syncResult ? "Fechar" : "Cancelar"}
            </Button>
            <Button onClick={handleSync} disabled={syncing || !syncDataDe}>
              {syncing ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <CloudDownload className="mr-1.5 h-3.5 w-3.5" />
                  Sincronizar
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

      {/* Resumo */}
      {listQuery.data?.resumo && (
        <Card className="border-muted">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Total: </span>
              <span className="font-semibold">{listQuery.data.resumo.total_invoices} invoices</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div>
              <span className="text-xs text-muted-foreground">EUR: </span>
              <span className="font-mono font-semibold">{formatEUR(listQuery.data.resumo.soma_eur)}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">BRL: </span>
              <span className="font-mono font-semibold">{formatBRL(listQuery.data.resumo.soma_brl)}</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <Badge variant="outline" className="text-[10px]">
              Hub: {listQuery.data.resumo.qtd_hub}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Alvo: {listQuery.data.resumo.qtd_alvo}
            </Badge>
            <div className="h-4 w-px bg-border hidden md:block" />
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
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-3 font-medium w-8" />
                  <th className="px-3 py-3 font-medium">Nº Invoice</th>
                  <th className="px-3 py-3 font-medium">Data</th>
                  <th className="px-3 py-3 font-medium">Tipo</th>
                  <th className="px-3 py-3 font-medium">Classe</th>
                  <th className="px-3 py-3 font-medium">Konto AT</th>
                  <th className="px-3 py-3 font-medium text-right">EUR</th>
                  <th className="px-3 py-3 font-medium text-right">BRL</th>
                  <th className="px-3 py-3 font-medium">Blocos</th>
                  <th className="px-3 py-3 font-medium">CCs</th>
                  <th className="px-3 py-3 font-medium">Origem</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Classific.</th>
                </tr>
              </thead>
              <tbody>
                {listQuery.data.items.map((item) => (
                  <MasterRow
                    key={`${item.source_table}-${item.id}`}
                    item={item}
                    expanded={expandedId === `${item.source_table}-${item.id}`}
                    onToggle={() =>
                      setExpandedId((prev) =>
                        prev === `${item.source_table}-${item.id}` ? null : `${item.source_table}-${item.id}`,
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2.5 text-xs">
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
    </div>
  );
}

// ─── Linha da tabela ────────────────────────────────────────────────────

interface MasterRowProps {
  item: MasterItem;
  expanded: boolean;
  onToggle: () => void;
}

function MasterRow({ item, expanded, onToggle }: MasterRowProps) {
  const classEmoji = classificationEmoji[item.classification_status_agregado];

  return (
    <>
      <tr className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-2.5">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </td>
        <td className="px-3 py-2.5 font-mono text-xs">{item.numero_invoice ?? "—"}</td>
        <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(item.data_emissao)}</td>
        <td className="px-3 py-2.5">
          <Badge variant="outline" className="text-[10px] capitalize">
            {item.tipo}
          </Badge>
        </td>
        <td className="px-3 py-2.5">
          {item.classe_codigo ? (
            <span className="font-mono text-xs">{item.classe_codigo}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          {item.konto_at_numero ? (
            <span className="font-mono text-xs">{item.konto_at_numero}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right font-mono">{formatEUR(item.valor_eur)}</td>
        <td className="px-3 py-2.5 text-right font-mono">{formatBRL(item.valor_brl)}</td>
        <td className="px-3 py-2.5">
          {item.total_blocos > 0 ? (
            <Badge variant="secondary" className="text-[10px]">
              {item.total_blocos}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          {item.total_ccs > 0 ? (
            <Badge variant="secondary" className="text-[10px]">
              {item.total_ccs}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <Badge variant="outline" className="text-[10px]">
            {item.origem}
          </Badge>
        </td>
        <td className="px-3 py-2.5">
          <Badge variant="outline" className={`text-[10px] border ${statusColor[item.status_unificado] ?? ""}`}>
            {item.status_label}
          </Badge>
        </td>
        <td className="px-3 py-2.5">
          <Badge
            variant="outline"
            className={`text-[10px] border ${classificationColor[item.classification_status_agregado]}`}
          >
            <span className="mr-1 font-bold">{classEmoji}</span>
            {classificationLabel[item.classification_status_agregado]}
          </Badge>
        </td>
      </tr>
      {expanded && <MasterRowDetails item={item} />}
    </>
  );
}

// ─── Detalhes expandidos ────────────────────────────────────────────────

function MasterRowDetails({ item }: { item: MasterItem }) {
  const blocosQuery = useQuery({
    queryKey: ["intercompany_master_blocos", item.id],
    queryFn: () => buscarBlocosDetalhe(item.id),
    enabled: item.total_blocos > 0,
  });

  return (
    <tr className="bg-muted/10">
      <td colSpan={13} className="px-6 py-4">
        <div className="space-y-3">
          {/* Header da invoice */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
            <DetailField label="Espécie" value={item.especie} />
            <DetailField label="Câmbio" value={item.cambio.toLocaleString("pt-BR", { minimumFractionDigits: 4 })} />
            {item.chave_docfin_alvo && <DetailField label="Chave Alvo" value={String(item.chave_docfin_alvo)} mono />}
            {item.numero_documento_alvo && <DetailField label="Nº Doc Alvo" value={item.numero_documento_alvo} mono />}
            {item.origem_categoria && <DetailField label="Categoria" value={item.origem_categoria} />}
            {item.emitida_em && (
              <DetailField label="Emitida em" value={format(new Date(item.emitida_em), "dd/MM/yyyy HH:mm")} />
            )}
          </div>

          {item.descricao && (
            <div className="text-xs">
              <span className="text-muted-foreground uppercase tracking-wide">Descrição</span>
              <p className="mt-0.5 italic">{item.descricao}</p>
            </div>
          )}

          {item.status_motivo && (
            <div className="text-xs rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
              <span className="text-amber-700 font-medium">Status:</span>{" "}
              <span className="text-amber-700">{item.status_motivo}</span>
            </div>
          )}

          {/* Blocos */}
          {item.total_blocos > 0 && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                Blocos ({item.total_blocos})
              </p>
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
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Card de cada bloco ──────────────────────────────────────────────────

function BlocoCard({ bloco }: { bloco: MasterBlocoDetalhe }) {
  const classEmoji = classificationEmoji[bloco.classification_status];

  return (
    <div className="rounded-md border border-border bg-background p-3 space-y-2">
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
          <p className="text-sm font-mono font-semibold">{formatEUR(bloco.valor_eur)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-[10px] pt-2 border-t border-border/50">
        <div>
          <span className="text-muted-foreground uppercase tracking-wide">Classe BR</span>
          <p className="font-mono">{bloco.classe_codigo ?? "—"}</p>
        </div>
        <div>
          <span className="text-muted-foreground uppercase tracking-wide">Konto AT</span>
          <p className="font-mono">{bloco.konto_at_numero ?? "—"}</p>
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
                  <td className="font-mono py-0.5">{r.centro_custo_erp_code}</td>
                  <td>{r.centro_custo_nome ?? "—"}</td>
                  <td className="text-right font-mono">{r.percentual.toFixed(2)}%</td>
                  <td className="text-right font-mono">{formatEUR(r.valor_eur)}</td>
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
      <span className={cn("text-foreground", mono && "font-mono")}>{value}</span>
    </div>
  );
}
