import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  TrendingUp, Download, Radio, Search, Loader2, AlertTriangle, FileText, Users, DollarSign, Award,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sincronizarNotasFiscais } from "@/services/alvoSalesService";
import * as XLSX from "xlsx";

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatDate = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

interface SalesInvoice {
  id: string;
  numero_nf: string;
  serie: string | null;
  chave_acesso: string | null;
  data_emissao: string;
  data_transmissao: string | null;
  periodo: string;
  codigo_entidade: string | null;
  razao_social: string | null;
  cnpj_destinatario: string | null;
  valor_brl: number | null;
  status: string | null;
  codigo_usuario: string | null;
  numero_protocolo: string | null;
}

export default function Sales() {
  const { toast } = useToast();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");
  const [syncPercent, setSyncPercent] = useState(0);

  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);

  const periodo = `${selectedYear}-${String(selectedMonth).padStart(2, "0")}`;

  // Load invoices
  const loadInvoices = async () => {
    setLoading(true);
    try {
      const allRows: SalesInvoice[] = [];
      let from = 0;
      const batch = 1000;
      let done = false;
      while (!done) {
        const { data, error } = await supabase
          .from("sales_invoices")
          .select("*")
          .eq("periodo", periodo)
          .order("data_emissao", { ascending: false })
          .range(from, from + batch - 1);
        if (error) throw error;
        if (data && data.length > 0) {
          allRows.push(...(data as SalesInvoice[]));
          from += batch;
          if (data.length < batch) done = true;
        } else {
          done = true;
        }
      }
      setInvoices(allRows);
    } catch (e: any) {
      toast({ title: "Erro ao carregar NFs", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
    setCurrentPage(1);
  }, [periodo]);

  // Sync
  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress("");
    setSyncPercent(10);
    try {
      const res = await sincronizarNotasFiscais(periodo, (msg) => {
        setSyncProgress(msg);
        setSyncPercent((p) => Math.min(p + 5, 90));
      });
      setSyncPercent(100);
      toast({
        title: "Sincronização concluída",
        description: `Total ERP: ${res.total} | Salvas: ${res.sincronizadas} | Excluídas: ${res.excluidas}${res.erros.length > 0 ? ` | Erros: ${res.erros.length}` : ""}`,
      });
      if (res.erros.length > 0) console.warn("Erros sync NFs:", res.erros);
      await loadInvoices();
    } catch (e: any) {
      toast({ title: "Erro na sincronização", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
      setSyncPercent(0);
      setSyncProgress("");
    }
  };

  // Filtered data
  const filtered = useMemo(() => {
    if (!search.trim()) return invoices;
    const q = search.toLowerCase();
    return invoices.filter(
      (inv) =>
        inv.numero_nf.toLowerCase().includes(q) ||
        (inv.razao_social && inv.razao_social.toLowerCase().includes(q))
    );
  }, [invoices, search]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Summary cards
  const summary = useMemo(() => {
    const authorized = invoices.filter((i) => i.status === "Autorizada");
    const totalNFs = authorized.length;
    const totalValor = authorized.reduce((s, i) => s + (i.valor_brl ?? 0), 0);
    const distinctClients = new Set(authorized.map((i) => i.cnpj_destinatario).filter(Boolean)).size;
    const maxNF = authorized.reduce(
      (best, i) => ((i.valor_brl ?? 0) > (best?.valor_brl ?? 0) ? i : best),
      authorized[0] || null
    );
    return { totalNFs, totalValor, distinctClients, maxNF };
  }, [invoices]);

  // Footer total (filtered/paged)
  const footerTotal = filtered.reduce((s, i) => s + (i.valor_brl ?? 0), 0);

  // Export Excel
  const handleExport = () => {
    const rows = filtered.map((inv) => ({
      "Nº NF": inv.numero_nf,
      "Data Emissão": formatDate(inv.data_emissao),
      "Cliente": inv.razao_social || "—",
      "CNPJ": inv.cnpj_destinatario || "—",
      "Valor BRL": inv.valor_brl ?? 0,
      "Status": inv.status || "—",
      "Usuário": inv.codigo_usuario || "—",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NFs");
    XLSX.writeFile(wb, `receita-vendas-${periodo}.xlsx`);
  };

  // Year options
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Receita de Vendas</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Month selector */}
          <Select value={String(selectedMonth)} onValueChange={(v) => { setSelectedMonth(Number(v)); setCurrentPage(1); }}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((name, i) => (
                <SelectItem key={i} value={String(i + 1)}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Year selector */}
          <Select value={String(selectedYear)} onValueChange={(v) => { setSelectedYear(Number(v)); setCurrentPage(1); }}>
            <SelectTrigger className="w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={handleSync} disabled={syncing} size="sm" className="gap-2">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
            Sincronizar via API
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0} className="gap-2">
            <Download className="h-4 w-4" />
            Exportar Excel
          </Button>
        </div>
      </div>

      {/* Sync progress */}
      {syncing && (
        <Alert>
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription className="flex flex-col gap-2">
            <span>{syncProgress}</span>
            <Progress value={syncPercent} className="h-2" />
          </AlertDescription>
        </Alert>
      )}

      {/* Summary cards */}
      {!loading && invoices.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">NFs Autorizadas</p>
                <p className="text-xl font-bold text-foreground">{summary.totalNFs}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                <DollarSign className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Valor Total</p>
                <p className="text-xl font-bold text-foreground">{formatBRL(summary.totalValor)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Clientes Distintos</p>
                <p className="text-xl font-bold text-foreground">{summary.distinctClients}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                <Award className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Maior NF</p>
                {summary.maxNF ? (
                  <>
                    <p className="text-sm font-bold text-foreground">{formatBRL(summary.maxNF.valor_brl ?? 0)}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-[180px]">{summary.maxNF.razao_social || "—"}</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="bg-muted/30 border-none shadow-none">
        <CardContent className="p-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-muted-foreground mr-2">
            <Search className="h-4 w-4" />
            <span className="text-sm font-medium">Filtros</span>
          </div>

          <div className="relative flex-1 min-w-[240px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
            <Input
              placeholder="Buscar por Nº NF ou cliente..."
              className="pl-9 bg-background border-muted-foreground/20 focus-visible:ring-primary/30"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
            />
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-muted-foreground/20 bg-background">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Por página:</span>
              <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="w-[80px] h-7 border-none shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <AlertTriangle className="mb-2 h-8 w-8" />
              <p className="text-sm">Nenhuma NF encontrada para {MONTH_NAMES[selectedMonth - 1]}/{selectedYear}.</p>
              <p className="text-xs">Clique em "Sincronizar via API" para buscar do ERP.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Nº NF</TableHead>
                    <TableHead className="whitespace-nowrap">Data Emissão</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="whitespace-nowrap">CNPJ</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Valor BRL</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Usuário</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paged.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-sm">{inv.numero_nf}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(inv.data_emissao)}</TableCell>
                      <TableCell className="max-w-[250px] truncate">{inv.razao_social || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{inv.cnpj_destinatario || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium">
                        {inv.valor_brl != null ? formatBRL(inv.valor_brl) : "—"}
                      </TableCell>
                      <TableCell>
                        {inv.status ? (
                          <Badge
                            variant={inv.status === "Autorizada" ? "default" : "secondary"}
                            className={inv.status === "Autorizada" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : ""}
                          >
                            {inv.status}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{inv.codigo_usuario || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Footer total */}
              <div className="flex items-center justify-between border-t px-4 py-3">
                <span className="text-sm font-semibold text-foreground">
                  Total ({filtered.length} NFs): {formatBRL(footerTotal)}
                </span>
                {/* Pagination */}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    Anterior
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {currentPage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    Próxima
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
