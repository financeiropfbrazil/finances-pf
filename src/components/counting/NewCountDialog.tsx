import { useState, useRef, useEffect } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, Loader2, AlertTriangle, CheckCircle2, FileSpreadsheet, ArrowRight, Hash, FileText, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  readExcelColumns,
  extractItemsFromRows,
  detectNumericColumns,
  matchItemsToProducts,
  getSystemBalances,
  createStockCount,
  fetchAvailableDates,
  CountPreviewItem,
} from "@/services/stockCountService";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  userEmail: string | null;
}

type Step = "config" | "mapping" | "preview";

const STEP_META: Record<Step, { label: string; number: number; description: string }> = {
  config: { label: "Configuração", number: 1, description: "Preencha os dados e faça upload da planilha" },
  mapping: { label: "Mapeamento", number: 2, description: "Mapeie as colunas do Excel aos campos do sistema" },
  preview: { label: "Confirmação", number: 3, description: "Revise os dados antes de salvar a contagem" },
};

function StepIndicator({ current }: { current: Step }) {
  const steps: Step[] = ["config", "mapping", "preview"];
  return (
    <div className="flex items-center gap-1 mb-6">
      {steps.map((s, i) => {
        const meta = STEP_META[s];
        const isActive = s === current;
        const isPast = steps.indexOf(current) > i;
        return (
          <div key={s} className="flex items-center gap-1 flex-1">
            <div className="flex items-center gap-2 flex-1">
              <div
                className={`
                  flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold shrink-0 transition-all
                  ${isActive ? "bg-primary text-primary-foreground shadow-[0_0_12px_hsl(var(--primary)/0.4)]" : ""}
                  ${isPast ? "bg-primary/20 text-primary border border-primary/30" : ""}
                  ${!isActive && !isPast ? "bg-muted text-muted-foreground border border-border" : ""}
                `}
              >
                {isPast ? "✓" : meta.number}
              </div>
              <span className={`text-xs font-medium hidden sm:inline ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
                {meta.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-px flex-1 min-w-4 mx-1 ${isPast ? "bg-primary/40" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function NewCountDialog({ open, onClose, onCreated, userEmail }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("config");
  const [descricao, setDescricao] = useState("");
  const [dataReferencia, setDataReferencia] = useState("");
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);

  // Mapping state
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<any[][]>([]);
  const [numericCols, setNumericCols] = useState<number[]>([]);
  const [codeColIdx, setCodeColIdx] = useState<number>(0);
  const [qtyColIdx, setQtyColIdx] = useState<number>(-1);
  const [valueColIdx, setValueColIdx] = useState<number | null>(null);
  const [tipoChave, setTipoChave] = useState<"codigo_produto" | "codigo_reduzido" | "codigo_alternativo">("codigo_produto");

  // Preview state
  const [previewItems, setPreviewItems] = useState<CountPreviewItem[]>([]);
  const [matching, setMatching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [systemBalances, setSystemBalances] = useState<Map<string, any>>(new Map());

  useEffect(() => {
    if (open) {
      setStep("config");
      setDescricao("");
      setDataReferencia("");
      setTipoChave("codigo_produto");
      setHeaders([]);
      setRows([]);
      setPreviewItems([]);
      setCodeColIdx(0);
      setQtyColIdx(-1);
      setValueColIdx(null);
      loadDates();
    }
  }, [open]);

  const loadDates = async () => {
    setLoadingDates(true);
    try {
      const dates = await fetchAvailableDates();
      setAvailableDates(dates);
    } catch { /* ignore */ }
    setLoadingDates(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileRef.current) fileRef.current.value = "";

    if (!descricao.trim() || !dataReferencia) {
      toast({ title: "Preencha a descrição e a data de referência antes do upload", variant: "destructive" });
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const result = readExcelColumns(buffer);
      if (result.headers.length === 0 || result.rows.length === 0) {
        toast({ title: "Planilha vazia ou sem dados válidos", variant: "destructive" });
        return;
      }
      setHeaders(result.headers);
      setRows(result.rows);
      const numCols = detectNumericColumns(result.headers, result.rows);
      setNumericCols(numCols);
      setCodeColIdx(0);
      setQtyColIdx(numCols.length > 0 ? numCols[0] : -1);
      setValueColIdx(null);
      setStep("mapping");
    } catch (err: any) {
      toast({ title: "Erro ao ler arquivo", description: err.message, variant: "destructive" });
    }
  };

  const handleMapping = async () => {
    if (qtyColIdx < 0) {
      toast({ title: "Selecione a coluna de quantidade", variant: "destructive" });
      return;
    }
    setMatching(true);
    try {
      const extracted = extractItemsFromRows(rows, codeColIdx, qtyColIdx, valueColIdx ?? null);
      if (extracted.length === 0) {
        toast({ title: "Nenhum item válido encontrado", variant: "destructive" });
        setMatching(false);
        return;
      }
      const matched = await matchItemsToProducts(extracted, tipoChave);
      setPreviewItems(matched);

      const matchedIds = matched.filter((m) => m.found && m.productId).map((m) => m.productId!);
      const balances = await getSystemBalances(matchedIds, dataReferencia);
      setSystemBalances(balances);
      setStep("preview");
    } catch (err: any) {
      toast({ title: "Erro ao processar", description: err.message, variant: "destructive" });
    }
    setMatching(false);
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await createStockCount({
        descricao,
        dataReferencia,
        tipoChave,
        uploadedBy: userEmail,
        items: previewItems,
        systemBalances,
      });
      toast({ title: "✅ Contagem criada com sucesso!" });
      onCreated();
      onClose();
    } catch (err: any) {
      toast({ title: "Erro ao salvar contagem", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const foundCount = previewItems.filter((i) => i.found).length;
  const notFoundCount = previewItems.filter((i) => !i.found).length;
  const notFoundItems = previewItems.filter((i) => !i.found);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-0">
        {/* Header with gradient accent */}
        <div className="px-6 pt-6 pb-4 border-b border-border bg-gradient-to-r from-card to-secondary/30">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-primary/15">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
              </div>
              Nova Contagem de Estoque
            </DialogTitle>
            <DialogDescription className="text-xs">
              {STEP_META[step].description}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 pt-4 pb-6">
          <StepIndicator current={step} />

          {/* ── Step 1: Config ── */}
          {step === "config" && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs font-medium flex items-center gap-1.5">
                    <FileText className="h-3 w-3 text-muted-foreground" />
                    Descrição
                  </Label>
                  <Input
                    placeholder="Ex: Contagem Física Mar/2026 - Depósito 1"
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    className="h-9"
                  />
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs font-medium flex items-center gap-1.5">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    Data de Referência
                  </Label>
                  {loadingDates ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Carregando datas...
                    </div>
                  ) : availableDates.length === 0 ? (
                    <Alert className="border-warning/30 bg-warning/5">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      <AlertDescription className="text-xs">
                        Nenhuma data disponível. Capture saldos na "Posição de Estoque" primeiro.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Select value={dataReferencia} onValueChange={setDataReferencia}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Selecione a data" />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {availableDates.map((d) => (
                          <SelectItem key={d} value={d}>
                            {new Date(d + "T00:00:00").toLocaleDateString("pt-BR")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium flex items-center gap-1.5">
                  <Upload className="h-3 w-3 text-muted-foreground" />
                  Planilha de Contagem
                </Label>
                <div
                  className="group border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer
                    hover:border-primary/50 hover:bg-primary/5 transition-all duration-200"
                  onClick={() => fileRef.current?.click()}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <div className="flex flex-col items-center gap-2">
                    <div className="p-3 rounded-full bg-muted group-hover:bg-primary/10 transition-colors">
                      <FileSpreadsheet className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-foreground">
                        Clique para selecionar
                      </span>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        Formatos aceitos: .xlsx, .xls
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
              </DialogFooter>
            </div>
          )}

          {/* ── Step 2: Column Mapping ── */}
          {step === "mapping" && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Coluna de Código <span className="text-destructive">*</span>
                  </Label>
                  <Select value={String(codeColIdx)} onValueChange={(v) => setCodeColIdx(Number(v))}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {headers.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>{h || `Coluna ${i + 1}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Tipo de Chave <span className="text-destructive">*</span>
                  </Label>
                  <Select value={tipoChave} onValueChange={(v: any) => setTipoChave(v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="codigo_produto">Código Completo</SelectItem>
                      <SelectItem value="codigo_reduzido">Código Reduzido</SelectItem>
                      <SelectItem value="codigo_alternativo">Código Alternativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Coluna de Quantidade <span className="text-destructive">*</span>
                  </Label>
                  <Select value={String(qtyColIdx)} onValueChange={(v) => setQtyColIdx(Number(v))}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {numericCols.map((i) => (
                        <SelectItem key={i} value={String(i)}>{headers[i] || `Coluna ${i + 1}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Coluna de Valor Total <span className="text-muted-foreground">(opcional)</span>
                  </Label>
                  <Select value={valueColIdx !== null ? String(valueColIdx) : "none"} onValueChange={(v) => setValueColIdx(v === "none" ? null : Number(v))}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma</SelectItem>
                      {numericCols.map((i) => (
                        <SelectItem key={i} value={String(i)}>{headers[i] || `Coluna ${i + 1}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Preview table */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Preview das primeiras 5 linhas</Label>
                <div className="rounded-md border overflow-x-auto max-h-48">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        {headers.map((h, i) => {
                          const isSelected = i === codeColIdx || i === qtyColIdx || (valueColIdx !== null && i === valueColIdx);
                          return (
                            <TableHead
                              key={i}
                              className={`text-[11px] whitespace-nowrap ${isSelected ? "bg-primary/10 text-primary font-semibold" : ""}`}
                            >
                              {h || `Col ${i + 1}`}
                              {i === codeColIdx && <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 leading-tight">CÓD</Badge>}
                              {i === qtyColIdx && <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 leading-tight">QTD</Badge>}
                              {valueColIdx !== null && i === valueColIdx && <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 leading-tight">VAL</Badge>}
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.slice(0, 5).map((row, ri) => (
                        <TableRow key={ri}>
                          {headers.map((_, ci) => {
                            const isSelected = ci === codeColIdx || ci === qtyColIdx || (valueColIdx !== null && ci === valueColIdx);
                            return (
                              <TableCell
                                key={ci}
                                className={`text-[11px] py-1.5 whitespace-nowrap ${isSelected ? "bg-primary/5 font-medium" : ""}`}
                              >
                                {String(row[ci] ?? "")}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={() => setStep("config")}>Voltar</Button>
                <Button size="sm" onClick={handleMapping} disabled={matching || qtyColIdx < 0} className="gap-1.5">
                  {matching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                  Mapear e Resolver
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* ── Step 3: Preview ── */}
          {step === "preview" && (
            <div className="space-y-5">
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <div className="text-lg font-bold text-foreground">{previewItems.length}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Total Excel</div>
                </div>
                <div className="rounded-lg border border-success/20 bg-success/5 p-3 text-center">
                  <div className="text-lg font-bold" style={{ color: "hsl(var(--success))" }}>{foundCount}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Identificados</div>
                </div>
                <div className={`rounded-lg border p-3 text-center ${notFoundCount > 0 ? "border-destructive/20 bg-destructive/5" : "border-border bg-muted/30"}`}>
                  <div className={`text-lg font-bold ${notFoundCount > 0 ? "text-destructive" : "text-foreground"}`}>{notFoundCount}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Não Encontrados</div>
                </div>
              </div>

              {/* Preview table */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Preview dos itens mapeados</Label>
                <div className="rounded-md border max-h-52 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/40">
                        <TableHead className="text-[11px]">Código</TableHead>
                        <TableHead className="text-[11px] text-right">Qtde</TableHead>
                        {previewItems.some(i => i.valorTotal != null) && <TableHead className="text-[11px] text-right">Valor Total</TableHead>}
                        <TableHead className="text-[11px]">Produto</TableHead>
                        <TableHead className="text-[11px] w-[80px]">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewItems.slice(0, 8).map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-[11px] py-1.5">{item.codigo}</TableCell>
                          <TableCell className="text-[11px] text-right py-1.5 tabular-nums">{item.quantidade}</TableCell>
                          {previewItems.some(i => i.valorTotal != null) && (
                            <TableCell className="text-[11px] text-right py-1.5 tabular-nums">
                              {item.valorTotal != null ? item.valorTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "—"}
                            </TableCell>
                          )}
                          <TableCell className="text-[11px] py-1.5 max-w-[180px] truncate">{item.nomeProduto ?? "—"}</TableCell>
                          <TableCell className="py-1.5">
                            {item.found ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-success/30" style={{ color: "hsl(var(--success))" }}>
                                <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> OK
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Erro</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {previewItems.length > 8 && (
                  <p className="text-[10px] text-muted-foreground text-right">
                    Mostrando 8 de {previewItems.length} itens
                  </p>
                )}
              </div>

              {notFoundItems.length > 0 && (
                <Alert variant="destructive" className="py-2.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <AlertDescription className="text-xs">
                    <span className="font-medium">{notFoundCount} códigos não encontrados:</span>
                    <span className="block mt-0.5 text-[11px] font-mono opacity-80">
                      {notFoundItems.slice(0, 10).map((i) => i.codigo).join(", ")}
                      {notFoundItems.length > 10 && ` … +${notFoundItems.length - 10}`}
                    </span>
                    <span className="block mt-0.5 text-[10px] opacity-60">Esses itens serão ignorados.</span>
                  </AlertDescription>
                </Alert>
              )}

              <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={() => setStep("mapping")}>Voltar</Button>
                <Button size="sm" onClick={handleConfirm} disabled={saving || foundCount === 0} className="gap-1.5">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Salvar Contagem ({foundCount} itens)
                </Button>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
