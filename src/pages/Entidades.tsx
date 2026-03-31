import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { iniciarSyncLog, finalizarSyncLog } from "@/services/syncLogService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, RefreshCw, Download, Users, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

const formatCNPJ = (cnpj: string | null) => {
  if (!cnpj) return "—";
  const cleaned = cnpj.replace(/\D/g, "");
  if (cleaned.length === 14) {
    return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  if (cleaned.length === 11) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return cnpj;
};


const Entidades = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [syncProgress, setSyncProgress] = useState<{ step: string; pct: number } | null>(null);
  const [selectedUF, setSelectedUF] = useState<string>("all");
  const [selectedMunicipio, setSelectedMunicipio] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 100; // Reduzido para melhorar performance de renderização

  const { toast } = useToast();

  const fetchEntidades = async () => {
    setLoading(true);
    let allData: any[] = [];
    let from = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from("compras_entidades_cache")
        .select("*")
        .order("nome")
        .range(from, from + batchSize - 1);

      if (error) {
        toast({ title: "❌ Erro ao buscar entidades", description: error.message, variant: "destructive" });
        break;
      }
      allData = allData.concat(data || []);
      if (!data || data.length < batchSize) hasMore = false;
      else from += batchSize;
    }
    setRows(allData);
    setLoading(false);
  };

  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    fetchEntidades();
  }, []);

  useEffect(() => {
    if (searchParams.get("autoSync") === "true") {
      setSearchParams({});
      setTimeout(() => syncEntidades(), 500);
    }
  }, []);

  const syncEntidades = async () => {
    setSyncing(true);
    setSyncProgress({ step: "Buscando entidades do Alvo...", pct: 10 });
    let logId: string | null = null;
    try {
      const { authenticateAlvo, clearAlvoToken } = await import("@/services/alvoService");
      logId = await iniciarSyncLog("entidades");
      clearAlvoToken();
      const auth = await authenticateAlvo();
      if (!auth.success || !auth.token) throw new Error(auth.error || "Falha na autenticação");

      const ERP = "https://pef.it4you.inf.br/api";
      let page = 1;
      let allEntidades: any[] = [];
      let hasMore = true;

      while (hasMore) {
        setSyncProgress({ step: `Buscando entidades... página ${page}`, pct: Math.min(10 + page * 5, 40) });
        const resp = await fetch(`${ERP}/Entidade/GetListForComponents`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "riosoft-token": auth.token },
          body: JSON.stringify({
            FormName: "entidade",
            ClassInput: "Entidade",
            ControllerForm: "entidade",
            TypeObject: "tabForm",
            Filter: "",
            Input: "gridTableEntidade",
            IsGroupBy: false,
            Order: "Codigo ASC",
            PageIndex: page,
            PageSize: 500,
            Shortcut: "entidade",
            Type: "GridTable",
          }),
        });
        
        if (!resp.ok) {
          throw new Error(`Erro na API do ERP: ${resp.status}`);
        }
        
        const data = await resp.json();
        if (!Array.isArray(data) || data.length === 0) {
          hasMore = false;
          break;
        }
        
        allEntidades = allEntidades.concat(data);
        if (data.length < 500) hasMore = false;
        else page++;
      }

      setSyncProgress({ step: `${allEntidades.length} entidades encontradas. Buscando cidades...`, pct: 50 });

      // Buscar TODAS as cidades do Alvo (são poucas centenas)
      const cidadeMap: Record<string, { nome: string; uf: string }> = {};
      let cidPage = 1;
      let cidHasMore = true;
      while (cidHasMore) {
        const cidResp = await fetch(`${ERP}/Cidade/GetListForComponents`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "riosoft-token": auth.token },
          body: JSON.stringify({
            FormName: "cidade", ClassInput: "Cidade",
            ControllerForm: "cidade", TypeObject: "tabForm",
            Filter: "", Input: "gridTableCidade",
            IsGroupBy: false, Order: "Codigo ASC",
            PageIndex: cidPage, PageSize: 500,
            Shortcut: "cidade", Type: "GridTable",
          }),
        });
        const cidData = await cidResp.json();
        if (!Array.isArray(cidData) || cidData.length === 0) { cidHasMore = false; break; }
        cidData.forEach((c: any) => {
          cidadeMap[c.Codigo] = {
            nome: c.NomeCompleto || c.Nome || "",
            uf: c.SiglaUnidFederacao || "",
          };
        });
        if (cidData.length < 500) cidHasMore = false;
        else cidPage++;
      }

      setSyncProgress({ step: `${Object.keys(cidadeMap).length} cidades mapeadas. Salvando...`, pct: 70 });

      // Upsert no Supabase
      const upsertBatch = allEntidades.map(e => {
        const cidInfo = cidadeMap[e.CodigoCidade] || null;
        return {
          codigo_entidade: String(e.Codigo),
          cnpj: (e.CPFCNPJ || "").replace(/\D/g, "") || null,
          nome: e.Nome || null,
          ie: e.RGIE || null,
          uf: cidInfo?.uf || null,
          municipio: cidInfo?.nome || null,
          codigo_alternativo: e.CodigoAlternativo || null,
          updated_at: new Date().toISOString(),
        };
      });

      for (let i = 0; i < upsertBatch.length; i += 200) {
        setSyncProgress({ step: `Salvando lote ${Math.floor(i / 200) + 1}...`, pct: 70 + Math.min((i / upsertBatch.length) * 25, 25) });
        const batch = upsertBatch.slice(i, i + 200);
        const { error: upsertError } = await supabase
          .from("compras_entidades_cache")
          .upsert(batch, { onConflict: "codigo_entidade" });
          
        if (upsertError) throw upsertError;
      }

      await finalizarSyncLog(logId, "entidades", { status: "success", records_processed: allEntidades.length });
      toast({ title: `✅ ${allEntidades.length} entidades sincronizadas` });
      fetchEntidades();
    } catch (err: any) {
      await finalizarSyncLog(logId, "entidades", { status: "error", error_message: err.message });
      toast({ title: "❌ Erro", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const availableUFs = useMemo(() => {
    const ufs = new Set(rows.map(r => r.uf).filter(Boolean));
    return Array.from(ufs).sort();
  }, [rows]);

  const availableMunicipios = useMemo(() => {
    const filteredRows = selectedUF !== "all" ? rows.filter(r => r.uf === selectedUF) : rows;
    const municipios = new Set(filteredRows.map(r => r.municipio).filter(Boolean));
    return Array.from(municipios).sort();
  }, [rows, selectedUF]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      // Filtro de termo de pesquisa
      const s = searchTerm.trim().toLowerCase();
      const sNumbers = s.replace(/\D/g, "");
      
      const matchSearch = !s || 
        (r.nome || "").toLowerCase().includes(s) ||
        (r.codigo_entidade || "").toLowerCase().includes(s) ||
        (r.codigo_alternativo || "").toLowerCase().includes(s) ||
        (sNumbers !== "" && (r.cnpj || "").replace(/\D/g, "").includes(sNumbers));

      // Filtro de UF
      const matchUF = selectedUF === "all" || r.uf === selectedUF;

      // Filtro de Município
      const matchMunicipio = selectedMunicipio === "all" || r.municipio === selectedMunicipio;

      return matchSearch && matchUF && matchMunicipio;
    });
  }, [rows, searchTerm, selectedUF, selectedMunicipio]);

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedUF("all");
    setSelectedMunicipio("all");
    setCurrentPage(1);
  };

  const totalFiltered = filtered.length;
  const totalPages = Math.ceil(totalFiltered / PAGE_SIZE);
  const paginatedRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleExportExcel = () => {
    const dataToExport = filtered.map((row) => ({
      "Código": row.codigo_entidade,
      "Cód. Alternativo": row.codigo_alternativo || "—",
      "Nome": row.nome || "—",
      "CNPJ": formatCNPJ(row.cnpj),
      "IE": row.ie || "—",
      "UF": row.uf || "—",
      "Município": row.municipio || "—",
    }));
    
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Entidades");
    XLSX.writeFile(wb, "entidades.xlsx");
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Entidades</h1>
            <p className="text-muted-foreground">Listagem de fornecedores e clientes sincronizados do ERP Alvo.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExportExcel} disabled={loading || rows.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Exportar Excel
          </Button>
          <Button onClick={syncEntidades} disabled={syncing} className="gap-2">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? "Sincronizando..." : "Sincronizar Alvo"}
          </Button>
        </div>
      </div>

      {syncProgress && (
        <div className="space-y-2 px-4 pb-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{syncProgress.step}</span>
            <span>{Math.round(syncProgress.pct)}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${syncProgress.pct}%` }}
            />
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4 lg:grid-cols-5 items-end">
            <div className="relative col-span-1 md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Pesquisa</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Nome, CNPJ ou Código..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground block">Estado (UF)</label>
              <Select value={selectedUF} onValueChange={(val) => {
                setSelectedUF(val);
                setSelectedMunicipio("all");
                setCurrentPage(1);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas UFs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas UFs</SelectItem>
                  {availableUFs.map(uf => (
                    <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground block">Município</label>
              <Select value={selectedMunicipio} onValueChange={(val) => {
                setSelectedMunicipio(val);
                setCurrentPage(1);
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos Municípios" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value="all">Todos Municípios</SelectItem>
                  {availableMunicipios.map(m => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              {(searchTerm || selectedUF !== "all" || selectedMunicipio !== "all") && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={clearFilters}
                  className="h-10 text-xs text-muted-foreground hover:text-foreground"
                >
                  <X className="mr-1 h-3 w-3" />
                  Limpar
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Código</TableHead>
                  <TableHead className="w-[150px]">Cód. Alternativo</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>IE</TableHead>
                  <TableHead>UF</TableHead>
                  <TableHead>Município</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        <span className="text-muted-foreground">Carregando entidades...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : paginatedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      Nenhuma entidade encontrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.codigo_entidade}</TableCell>
                      <TableCell className="font-mono text-xs">{row.codigo_alternativo || "—"}</TableCell>
                      <TableCell className="max-w-[300px] truncate font-medium">{row.nome}</TableCell>
                      <TableCell className="font-mono text-xs">{formatCNPJ(row.cnpj)}</TableCell>
                      <TableCell className="font-mono text-xs">{row.ie || "—"}</TableCell>
                      <TableCell className="text-center">{row.uf || "—"}</TableCell>
                      <TableCell>{row.municipio || "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-xs text-muted-foreground">
                Total: {rows.length} entidades
                {searchTerm && ` · ${totalFiltered} filtrada(s)`}
                {` · Mostrando ${((currentPage - 1) * PAGE_SIZE) + 1}–${Math.min(currentPage * PAGE_SIZE, totalFiltered)} de ${totalFiltered}`}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage(p => p - 1)}>
                  Anterior
                </Button>
                <span className="text-xs text-muted-foreground">
                  Página {currentPage} de {totalPages || 1}
                </span>
                <Button variant="outline" size="sm" className="h-7 text-xs"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage(p => p + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Entidades;
