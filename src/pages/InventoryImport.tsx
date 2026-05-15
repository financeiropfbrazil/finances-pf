import { useState, useRef, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  Loader2,
  Search,
  Package,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Info,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { seedStockProductsFromBuffer } from "@/services/stockProductsSeed";
import {
  sincronizarProdutosDoERP,
  enriquecerUnidadesMedida,
  type EnrichUnidadesResult,
} from "@/services/alvoEstoqueService";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

interface StockProduct {
  id: string;
  codigo_produto: string;
  codigo_reduzido: string | null;
  codigo_alternativo: string | null;
  nome_produto: string;
  tipo_produto: string | null;
  familia_codigo: string | null;
  variacao: string | null;
  unidade_medida: string | null;
  ativo: boolean;
  codigo_barras: string | null;
  controla_lote: boolean;
  classificacao_fiscal: string | null;
  tipo_produto_fiscal: string | null;
}

interface ExternalCodePreview {
  codigoPrincipal: string;
  alternativo: string;
  nomeProduto: string | null;
  found: boolean;
}

const PAGE_SIZES = [25, 50, 100] as const;

export default function InventoryImport() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extFileRef = useRef<HTMLInputElement>(null);
  const cancelEnrichRef = useRef<boolean>(false);
  const [importing, setImporting] = useState(false);
  const [products, setProducts] = useState<StockProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [filterTipo, setFilterTipo] = useState("all");
  const [syncingERP, setSyncingERP] = useState(false);

  // Unit enrichment state
  const [unitEnrichOpen, setUnitEnrichOpen] = useState(false);
  const [unitEnriching, setUnitEnriching] = useState(false);
  const [unitEnrichProgress, setUnitEnrichProgress] = useState(0);
  const [unitEnrichMessage, setUnitEnrichMessage] = useState("");
  const [unitEnrichResult, setUnitEnrichResult] = useState<EnrichUnidadesResult | null>(null);

  // External code dialog state
  const [extDialogOpen, setExtDialogOpen] = useState(false);
  const [extParsing, setExtParsing] = useState(false);
  const [extImporting, setExtImporting] = useState(false);
  const [extPreview, setExtPreview] = useState<ExternalCodePreview[] | null>(null);
  const [extAllRows, setExtAllRows] = useState<{ codigoPrincipal: string; alternativo: string }[]>([]);
  const [extIgnoredCount, setExtIgnoredCount] = useState(0);
  const [extResult, setExtResult] = useState<{
    updated: number;
    notFound: string[];
    ignored: number;
    errors: number;
    debug?: string;
  } | null>(null);

  const fetchProducts = async () => {
    setLoading(true);
    let all: StockProduct[] = [];
    let from = 0;
    const batchSize = 1000;
    let done = false;
    while (!done) {
      const { data } = await supabase
        .from("stock_products")
        .select("*")
        .eq("ativo", true)
        .order("codigo_produto")
        .range(from, from + batchSize - 1);
      if (data && data.length > 0) {
        all = all.concat(
          data.map(
            (d: any) =>
              ({
                id: d.id,
                codigo_produto: d.codigo_produto,
                codigo_reduzido: d.codigo_reduzido ?? null,
                codigo_alternativo: d.codigo_alternativo ?? null,
                nome_produto: d.nome_produto,
                tipo_produto: d.tipo_produto ?? null,
                familia_codigo: d.familia_codigo ?? null,
                variacao: d.variacao ?? null,
                unidade_medida: d.unidade_medida ?? null,
                ativo: d.ativo,
                codigo_barras: d.codigo_barras ?? null,
                controla_lote: d.controla_lote ?? false,
                classificacao_fiscal: d.classificacao_fiscal ?? null,
                tipo_produto_fiscal: d.tipo_produto_fiscal ?? null,
              }) as StockProduct,
          ),
        );
        from += batchSize;
        if (data.length < batchSize) done = true;
      } else {
        done = true;
      }
    }
    setProducts(all);
    setLoading(false);
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const tipoOptions = useMemo(() => {
    const tipos = new Set<string>();
    products.forEach((p) => {
      if (p.tipo_produto) tipos.add(p.tipo_produto);
    });
    return Array.from(tipos).sort();
  }, [products]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (filterTipo !== "all" && p.tipo_produto !== filterTipo) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !p.codigo_produto.toLowerCase().includes(q) &&
          !p.nome_produto.toLowerCase().includes(q) &&
          !(p.codigo_reduzido ?? "").toLowerCase().includes(q) &&
          !(p.codigo_alternativo ?? "").toLowerCase().includes(q) &&
          !(p.familia_codigo ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [products, search, filterTipo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize, filterTipo]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    toast({ title: `Importando "${file.name}"...` });
    const buffer = await file.arrayBuffer();
    const result = await seedStockProductsFromBuffer(buffer);
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (result.success) {
      toast({ title: `✅ Importação concluída: ${result.inserted} produtos importados, ${result.skipped} ignorados.` });
      fetchProducts();
    } else {
      toast({ title: "❌ Erro na importação", description: result.error, variant: "destructive" });
    }
  };

  const handleSyncERP = async () => {
    setSyncingERP(true);
    toast({ title: "Sincronizando produtos do ERP..." });
    try {
      const result = await sincronizarProdutosDoERP((msg) => {
        toast({ title: msg });
      });
      toast({
        title: `✅ Sincronização concluída: ${result.novos} novos, ${result.ignorados} atualizados.`,
        description:
          result.erros.length > 0 ? `${result.erros.length} erros — primeiro: ${result.erros[0]}` : undefined,
      });
      console.log("=== SYNC RESULT ===", result);
      fetchProducts();
    } catch (err: any) {
      toast({ title: "❌ Erro na sincronização", description: err.message, variant: "destructive" });
    } finally {
      setSyncingERP(false);
    }
  };

  // Unit enrichment handler
  const handleEnrichUnidades = async () => {
    cancelEnrichRef.current = false;
    setUnitEnriching(true);
    setUnitEnrichResult(null);
    setUnitEnrichProgress(0);
    setUnitEnrichMessage("Iniciando...");
    try {
      const result = await enriquecerUnidadesMedida(
        (current, total, message) => {
          setUnitEnrichMessage(message);
          if (total > 0) setUnitEnrichProgress(Math.round((current / total) * 100));
        },
        () => cancelEnrichRef.current,
      );
      setUnitEnrichResult(result);
      const wasCancelled = cancelEnrichRef.current;
      toast({
        title: wasCancelled ? "Enriquecimento cancelado" : "Enriquecimento concluído",
        description: `${result.enriched} produtos com unidade, ${result.skipped} sem dados, ${result.errors} erros`,
      });
      fetchProducts();
    } catch (err: any) {
      toast({ title: "Erro no enriquecimento", description: err.message, variant: "destructive" });
    } finally {
      setUnitEnriching(false);
      cancelEnrichRef.current = false;
    }
  };

  // --- External Code Import Logic ---
  const resetExtDialog = () => {
    setExtPreview(null);
    setExtAllRows([]);
    setExtIgnoredCount(0);
    setExtResult(null);
    setExtParsing(false);
    setExtImporting(false);
  };

  const handleExtFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtParsing(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      // Headers: Código Principal(A) | Grupo(B) | Reduzido(C) | Alternativo(D) | Alternativo 1(E) | Código de Barras(F)
      const validRows: { codigoPrincipal: string; alternativo: string }[] = [];
      let ignored = 0;

      // Detect header row to find "Alternativo" column dynamically
      const headerRow = rows[0] as string[];
      let colCodigo = 0;
      let colAlternativo = 3; // default Col D

      if (headerRow) {
        for (let i = 0; i < headerRow.length; i++) {
          const h = String(headerRow[i]).trim().toLowerCase();
          if (h === "código principal" || h === "codigo principal") colCodigo = i;
          if (h === "alternativo" && colAlternativo === 3) colAlternativo = i;
        }
      }

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < colAlternativo + 1) continue;
        const codigoPrincipal = String(row[colCodigo] ?? "").trim();
        const alternativo = String(row[colAlternativo] ?? "").trim();

        if (!codigoPrincipal) {
          ignored++;
          continue;
        }
        if (!alternativo) {
          ignored++;
          continue;
        }

        validRows.push({ codigoPrincipal, alternativo });
      }

      setExtIgnoredCount(ignored);
      setExtAllRows(validRows);

      // Build preview (first 5 matched against catalog)
      const productMap = new Map<string, string>();
      products.forEach((p) => productMap.set(p.codigo_produto.trim().toLowerCase(), p.nome_produto));

      const preview: ExternalCodePreview[] = validRows.slice(0, 5).map((r) => {
        const nome = productMap.get(r.codigoPrincipal.toLowerCase()) ?? null;
        return {
          codigoPrincipal: r.codigoPrincipal,
          alternativo: r.alternativo,
          nomeProduto: nome,
          found: nome !== null,
        };
      });

      // Debug: log first 10 codes from spreadsheet vs DB
      const dbCodes = Array.from(productMap.keys()).slice(0, 10);
      const sheetCodes = validRows.slice(0, 10).map((r) => r.codigoPrincipal);
      console.log("=== DEBUG Código Alternativo Import ===");
      console.log("Sheet codes (first 10):", sheetCodes);
      console.log("DB codes (first 10):", dbCodes);
      console.log("Total valid rows:", validRows.length);
      console.log("Total products in DB:", products.length);
      console.log(
        "Match test:",
        sheetCodes.map((c) => ({ code: c, found: productMap.has(c.toLowerCase()) })),
      );

      setExtPreview(preview);
    } catch (err: any) {
      toast({ title: "Erro ao ler planilha", description: err.message, variant: "destructive" });
    } finally {
      setExtParsing(false);
      if (extFileRef.current) extFileRef.current.value = "";
    }
  };

  // Normalize code for matching: trim, lowercase, remove invisible chars
  const normalizeCode = (code: string) =>
    code
      .trim()
      .toLowerCase()
      .normalize("NFC")
      .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "");

  const handleExtConfirm = async () => {
    setExtImporting(true);
    try {
      // Build product lookup with normalized keys
      const productMap = new Map<string, StockProduct>();
      products.forEach((p) => productMap.set(normalizeCode(p.codigo_produto), p));

      let updated = 0;
      let errors = 0;
      const notFound: string[] = [];
      let firstError = "";

      // Debug: sample comparison
      const sampleSheet = extAllRows.slice(0, 3).map((r) => normalizeCode(r.codigoPrincipal));
      const sampleDb = Array.from(productMap.keys()).slice(0, 3);

      // Build deduplicated upsert payload (last occurrence wins)
      const updatesById = new Map<
        string,
        {
          id: string;
          codigo_produto: string;
          codigo_reduzido: string | null;
          codigo_alternativo: string | null;
          nome_produto: string;
          tipo_produto: string | null;
          familia_codigo: string | null;
          variacao: string | null;
          unidade_medida: string | null;
          ativo: boolean;
        }
      >();

      for (const row of extAllRows) {
        const normalizedCode = normalizeCode(row.codigoPrincipal);
        const product = productMap.get(normalizedCode);

        if (!product) {
          notFound.push(row.codigoPrincipal);
          continue;
        }

        updatesById.set(product.id, {
          id: product.id,
          codigo_produto: product.codigo_produto,
          codigo_reduzido: product.codigo_reduzido,
          codigo_alternativo: row.alternativo,
          nome_produto: product.nome_produto,
          tipo_produto: product.tipo_produto,
          familia_codigo: product.familia_codigo,
          variacao: product.variacao,
          unidade_medida: product.unidade_medida,
          ativo: product.ativo,
        });
      }

      const updates = Array.from(updatesById.values());

      // Upsert in chunks using POST (more stable than many PATCH calls)
      const BATCH = 100;
      for (let i = 0; i < updates.length; i += BATCH) {
        const batch = updates.slice(i, i + BATCH);

        const { error } = await supabase
          .from("stock_products")
          .upsert(batch, { onConflict: "id", ignoreDuplicates: false });

        if (!error) {
          updated += batch.length;
          continue;
        }

        // Fallback to isolate failures when a full batch fails
        console.error("Batch upsert failed:", error);
        for (const item of batch) {
          const { error: itemError } = await supabase
            .from("stock_products")
            .upsert([item], { onConflict: "id", ignoreDuplicates: false });

          if (itemError) {
            errors++;
            if (!firstError) {
              firstError = `${item.codigo_produto}: ${itemError.message} (code: ${itemError.code ?? ""})`;
            }
            console.error("Update failed:", item.codigo_produto, itemError);
          } else {
            updated++;
          }
        }
      }

      const debugInfo = `Sheet(norm): [${sampleSheet.join(", ")}] | DB(norm): [${sampleDb.join(", ")}] | Map size: ${productMap.size} | Matched: ${updates.length}${firstError ? ` | 1st err: ${firstError}` : ""}`;

      setExtResult({ updated, notFound, ignored: extIgnoredCount, errors, debug: debugInfo });
      toast({ title: `✅ ${updated} produtos atualizados com código alternativo.` });
      fetchProducts();
    } catch (err: any) {
      toast({ title: "Erro na importação", description: err.message, variant: "destructive" });
    } finally {
      setExtImporting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-foreground">Importação de Produtos</h1>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="gap-1.5 text-sm">
            <Package className="h-3.5 w-3.5" />
            {products.length} produtos
          </Badge>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          <Button onClick={() => fileInputRef.current?.click()} disabled={importing} size="sm" className="gap-2">
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {importing ? "Importando..." : "Importar XLSX"}
          </Button>
          <Button onClick={handleSyncERP} disabled={syncingERP} variant="outline" size="sm" className="gap-2">
            {syncingERP ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncingERP ? "Sincronizando..." : "Sincronizar do ERP"}
          </Button>
          <Button
            onClick={() => {
              setUnitEnrichResult(null);
              setUnitEnrichMessage("");
              setUnitEnrichProgress(0);
              setUnitEnrichOpen(true);
            }}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Sparkles className="h-4 w-4" />
            Enriquecer Unidades
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => {
              resetExtDialog();
              setExtDialogOpen(true);
            }}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Importar Código Alternativo (.xlsx)
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Catálogo de Produtos</CardTitle>
          <CardDescription>
            Produtos importados da planilha oficial. Duplicatas são ignoradas automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por código ou nome..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterTipo} onValueChange={setFilterTipo}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Tipo do Produto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {tipoOptions.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              {products.length === 0
                ? "Nenhum produto importado ainda. Faça upload de uma planilha XLSX."
                : "Nenhum resultado encontrado para a busca."}
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Código</TableHead>
                      <TableHead className="w-[80px]">Red.</TableHead>
                      <TableHead className="w-[100px]">Cód. Alt.</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead className="w-[140px]">Tipo</TableHead>
                      <TableHead className="w-[100px]">Variação</TableHead>
                      <TableHead className="w-[60px]">Unid.</TableHead>
                      <TableHead className="w-[120px]">Cód. Barras</TableHead>
                      <TableHead className="w-[60px]">Lote</TableHead>
                      <TableHead className="w-[100px]">Clas. Fiscal</TableHead>
                      <TableHead className="w-[80px]">Tp Fiscal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.codigo_produto}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.codigo_reduzido ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.codigo_alternativo ?? "—"}</TableCell>
                        <TableCell className="text-sm">{p.nome_produto}</TableCell>
                        <TableCell className="text-xs">{p.tipo_produto ?? "—"}</TableCell>
                        <TableCell className="text-xs">{p.variacao ?? "—"}</TableCell>
                        <TableCell className="text-xs">{p.unidade_medida ?? "—"}</TableCell>
                        <TableCell className="text-xs font-mono">{p.codigo_barras ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          <Badge variant={p.controla_lote ? "default" : "secondary"} className="text-xs">
                            {p.controla_lote ? "Sim" : "Não"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{p.classificacao_fiscal ?? "—"}</TableCell>
                        <TableCell className="text-xs">{p.tipo_produto_fiscal ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between flex-wrap gap-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span>
                    Exibindo {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, filtered.length)} de{" "}
                    {filtered.length}
                  </span>
                  <span>·</span>
                  <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                    <SelectTrigger className="h-8 w-[80px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZES.map((s) => (
                        <SelectItem key={s} value={String(s)}>
                          {s} / pág
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={safePage <= 1}
                    onClick={() => setPage(1)}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-3 text-muted-foreground">
                    {safePage} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(totalPages)}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* External Code Import Dialog */}
      <Dialog
        open={extDialogOpen}
        onOpenChange={(v) => {
          if (!v) {
            setExtDialogOpen(false);
            resetExtDialog();
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importar Código Alternativo</DialogTitle>
            <DialogDescription>
              Vincule o código alternativo aos produtos do catálogo. Usa a coluna 'Alternativo' (Col D) da exportação do
              ERP.
            </DialogDescription>
          </DialogHeader>

          {extResult ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>
                    <strong>{extResult.updated}</strong> produtos atualizados com código externo
                  </span>
                </div>
                {extResult.notFound.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="h-4 w-4 text-yellow-600" />
                      <span>
                        <strong>{extResult.notFound.length}</strong> não encontrados no catálogo
                      </span>
                    </div>
                    <div className="max-h-32 overflow-y-auto rounded border p-2 text-xs font-mono text-muted-foreground">
                      {extResult.notFound.join(", ")}
                    </div>
                  </div>
                )}
                {extResult.errors > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span>
                      <strong>{extResult.errors}</strong> erros ao atualizar
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <Info className="h-4 w-4 text-blue-600" />
                  <span>
                    <strong>{extResult.ignored}</strong> ignorados (grupos/estruturados)
                  </span>
                </div>
                {extResult.debug && (
                  <div className="rounded border p-2 text-xs font-mono text-muted-foreground bg-muted/50">
                    <strong>Debug:</strong> {extResult.debug}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setExtDialogOpen(false);
                    resetExtDialog();
                  }}
                >
                  Fechar
                </Button>
              </DialogFooter>
            </div>
          ) : extPreview ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  <strong>{extAllRows.length}</strong> produtos folha encontrados na planilha.
                  {extIgnoredCount > 0 && (
                    <>
                      {" "}
                      <strong>{extIgnoredCount}</strong> grupos ignorados.
                    </>
                  )}
                </AlertDescription>
              </Alert>

              <div className="text-sm font-medium">Preview (primeiras 5 linhas):</div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código Principal</TableHead>
                      <TableHead>Alternativo → codigo_alternativo</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead className="w-[120px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {extPreview.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{row.codigoPrincipal}</TableCell>
                        <TableCell className="font-mono text-xs">{row.alternativo}</TableCell>
                        <TableCell className="text-sm">{row.nomeProduto ?? "—"}</TableCell>
                        <TableCell>
                          {row.found ? (
                            <Badge variant="default" className="gap-1 bg-green-600 text-xs">
                              <CheckCircle2 className="h-3 w-3" /> Encontrado
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1 text-xs">
                              <AlertTriangle className="h-3 w-3" /> Não encontrado
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setExtPreview(null);
                    setExtAllRows([]);
                  }}
                >
                  Voltar
                </Button>
                <Button onClick={handleExtConfirm} disabled={extImporting} className="gap-2">
                  {extImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {extImporting ? "Importando..." : "Confirmar Importação"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground space-y-1">
                <p>Suba a planilha de exportação de produtos do ERP. O sistema irá:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>
                    Ler a coluna <strong>'Código Principal'</strong> (A) como chave de busca
                  </li>
                  <li>
                    Ler a coluna <strong>'Alternativo'</strong> (D) como código externo
                  </li>
                  <li>
                    Preencher o campo <code className="bg-muted px-1 rounded">codigo_alternativo</code> em cada produto
                    encontrado
                  </li>
                </ol>
              </div>

              <input ref={extFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExtFile} />
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => extFileRef.current?.click()}
              >
                {extParsing ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Lendo planilha...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Clique ou arraste o arquivo .xlsx aqui</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Unit Enrichment Dialog */}
      <Dialog open={unitEnrichOpen} onOpenChange={(v) => !unitEnriching && setUnitEnrichOpen(v)}>
        <DialogContent className="max-w-lg w-[calc(100vw-2rem)] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Enriquecer Unidades de Medida
            </DialogTitle>
            <DialogDescription>
              Busca a unidade de medida principal de cada produto ativo no ERP Alvo. Apenas produtos sem unidade
              cadastrada serão processados.
            </DialogDescription>
          </DialogHeader>

          {!unitEnriching && !unitEnrichResult && (
            <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>
                    A operação faz uma chamada individual por produto ao ERP, respeitando um intervalo de 200ms entre
                    cada.
                  </p>
                  <p>
                    Para <strong>2.000+ produtos</strong>, o processo pode levar <strong>10–15 minutos</strong>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {unitEnriching && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground font-medium">Progresso</span>
                  <span className="font-mono text-foreground font-semibold">{unitEnrichProgress}%</span>
                </div>
                <Progress value={unitEnrichProgress} className="h-2.5" />
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 min-w-0 overflow-hidden">
                <p className="text-xs text-muted-foreground truncate font-mono">{unitEnrichMessage}</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  {unitEnrichResult ? unitEnrichResult.enriched : "–"} enriquecidos
                </span>
                <span className="flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5" />
                  {unitEnrichResult ? unitEnrichResult.skipped : "–"} sem dados
                </span>
              </div>
            </div>
          )}

          {unitEnrichResult && !unitEnriching && (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-500">{unitEnrichResult.enriched}</p>
                  <p className="text-xs text-muted-foreground mt-1">Enriquecidos</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <p className="text-2xl font-bold text-muted-foreground">{unitEnrichResult.skipped}</p>
                  <p className="text-xs text-muted-foreground mt-1">Sem dados</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <p
                    className={`text-2xl font-bold ${unitEnrichResult.errors > 0 ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {unitEnrichResult.errors}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Erros</p>
                </div>
              </div>
              {unitEnrichResult.enriched > 0 && (
                <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-500">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {unitEnrichResult.enriched} produto{unitEnrichResult.enriched !== 1 ? "s" : ""} atualizado
                  {unitEnrichResult.enriched !== 1 ? "s" : ""} com sucesso.
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {unitEnriching ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  cancelEnrichRef.current = true;
                }}
                className="gap-2"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Cancelar
              </Button>
            ) : !unitEnrichResult ? (
              <Button onClick={handleEnrichUnidades} className="gap-2">
                <Sparkles className="h-4 w-4" />
                Iniciar Enriquecimento
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setUnitEnrichOpen(false)}>
                Fechar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
