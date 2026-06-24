// src/pages/CartaoLancamentos.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CreditCard,
  Upload,
  ArrowLeft,
  RefreshCw,
  Trash2,
  Ban,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Send,
  FileSpreadsheet,
  Loader2,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import MonthYearPicker from "@/components/MonthYearPicker";
import { EntidadeCombobox } from "@/components/cartao/EntidadeCombobox";
import {
  loadLotes,
  criarLoteComLinhas,
  excluirLote,
  loadItens,
  atualizarLinha,
  ignorarLinha,
  reativarLinha,
  loadClasses,
  loadCentrosCusto,
  parsePlanilhaCartao,
  type CartaoLote,
  type CartaoItem,
  type ClasseOption,
  type CentroCustoOption,
  type ParseResult,
} from "@/services/cartaoImportService";

const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = (iso: string | null) => (iso ? format(new Date(iso + "T00:00:00"), "dd/MM/yyyy") : "—");

const statusLinhaBadge = (s: string) => {
  switch (s) {
    case "pronto":
      return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Pronto</Badge>;
    case "emitido":
      return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Emitido</Badge>;
    case "ignorado":
      return <Badge variant="secondary">Ignorado</Badge>;
    default:
      return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">Pendente</Badge>;
  }
};

export default function CartaoLancamentos() {
  const { user } = useAuth();
  const [competencia, setCompetencia] = useState(() => format(new Date(), "yyyy-MM"));
  const [lotes, setLotes] = useState<CartaoLote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loteAberto, setLoteAberto] = useState<CartaoLote | null>(null);
  const [classes, setClasses] = useState<ClasseOption[]>([]);
  const [centros, setCentros] = useState<CentroCustoOption[]>([]);

  useEffect(() => {
    loadClasses()
      .then(setClasses)
      .catch((e) => console.warn(e));
    loadCentrosCusto()
      .then(setCentros)
      .catch((e) => console.warn(e));
  }, []);

  const fetchLotes = useCallback(async () => {
    setLoading(true);
    try {
      setLotes(await loadLotes(competencia));
    } catch (e: any) {
      toast({ title: "Erro ao carregar lotes", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  }, [competencia]);

  useEffect(() => {
    if (!loteAberto) fetchLotes();
  }, [fetchLotes, loteAberto]);

  if (loteAberto) {
    return <DetalheLote lote={loteAberto} classes={classes} centros={centros} onVoltar={() => setLoteAberto(null)} />;
  }

  return (
    <ListaLotes
      competencia={competencia}
      setCompetencia={setCompetencia}
      lotes={lotes}
      loading={loading}
      onRefresh={fetchLotes}
      onAbrir={setLoteAberto}
      userId={user?.id ?? null}
    />
  );
}

/* ════════ LISTA DE LOTES ════════ */

function ListaLotes({
  competencia,
  setCompetencia,
  lotes,
  loading,
  onRefresh,
  onAbrir,
  userId,
}: {
  competencia: string;
  setCompetencia: (v: string) => void;
  lotes: CartaoLote[];
  loading: boolean;
  onRefresh: () => void;
  onAbrir: (l: CartaoLote) => void;
  userId: string | null;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await excluirLote(deleteId);
      toast({ title: "Lote excluído." });
      onRefresh();
    } catch (e: any) {
      toast({ title: "Não foi possível excluir", description: e.message, variant: "destructive" });
    }
    setDeleteId(null);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <CreditCard className="h-6 w-6" /> Lançamento de Cartão
          </h1>
          <p className="text-sm text-muted-foreground">
            Importe a fatura do cartão e lance as despesas como RDESP no Alvo.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> Importar fatura
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground">Competência:</Label>
        <MonthYearPicker value={competencia} onChange={setCompetencia} />
      </div>

      {!loading && lotes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <FileSpreadsheet className="mb-4 h-12 w-12" />
          <p className="text-center">
            Nenhuma fatura importada nesta competência.
            <br />
            Clique em <strong>Importar fatura</strong> para começar.
          </p>
        </div>
      ) : (
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titular</TableHead>
                <TableHead>Cartão</TableHead>
                <TableHead>Nº Lote</TableHead>
                <TableHead>Competência</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Linhas</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lotes.map((l) => (
                <TableRow key={l.id} className="cursor-pointer hover:bg-muted/40" onClick={() => onAbrir(l)}>
                  <TableCell className="font-medium">{l.titular}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {l.final_cartao ? `•••• ${l.final_cartao}` : "—"}
                    <span className="ml-1 text-muted-foreground">({l.codigo_tipo_pag_rec})</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{l.numero_onfly ?? "—"}</TableCell>
                  <TableCell>{format(new Date(l.competencia + "T00:00:00"), "MMM/yyyy", { locale: ptBR })}</TableCell>
                  <TableCell>{format(new Date(l.competencia + "T00:00:00"), "MMM/yyyy", { locale: ptBR })}</TableCell>
                  <TableCell>{fmtData(l.data_vencimento)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 text-xs">
                      <span className="text-muted-foreground">{l.total_linhas ?? 0} total</span>
                      {(l.total_prontas ?? 0) > 0 && (
                        <span className="text-emerald-600">· {l.total_prontas} prontas</span>
                      )}
                      {(l.total_pendentes ?? 0) > 0 && (
                        <span className="text-amber-600">· {l.total_pendentes} pend.</span>
                      )}
                      {(l.total_emitidas ?? 0) > 0 && <span className="text-blue-600">· {l.total_emitidas} emit.</span>}
                      {(l.total_ignoradas ?? 0) > 0 && (
                        <span className="text-muted-foreground">· {l.total_ignoradas} ign.</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {l.status === "emitido" ? (
                      <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Emitido</Badge>
                    ) : l.status === "parcial" ? (
                      <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">Parcial</Badge>
                    ) : (
                      <Badge variant="secondary">Rascunho</Badge>
                    )}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    {(l.total_emitidas ?? 0) === 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => setDeleteId(l.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        userId={userId}
        onImported={() => {
          setImportOpen(false);
          onRefresh();
        }}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lote?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove a fatura importada e todas as suas linhas. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ════════ DIALOG DE IMPORTAÇÃO ════════ */

function ImportDialog({
  open,
  onOpenChange,
  userId,
  onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string | null;
  onImported: () => void;
}) {
  const [titular, setTitular] = useState("");
  const [finalCartao, setFinalCartao] = useState("");
  const [numeroOnfly, setNumeroOnfly] = useState("");
  const [tipoPagRec, setTipoPagRec] = useState("0000013");
  const [vencimento, setVencimento] = useState("");
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitular("");
    setFinalCartao("");
    setNumeroOnfly("");
    setTipoPagRec("0000013");
    setVencimento("");
    setPreview(null);
  };

  const handleFile = async (f: File | null) => {
    setPreview(null);
    if (!f) return;
    setParsing(true);
    try {
      const result = await parsePlanilhaCartao(f);
      setPreview(result);
      if (result.totalLinhas === 0) toast({ title: "Nenhuma linha encontrada na planilha.", variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Erro ao ler planilha", description: e.message, variant: "destructive" });
    }
    setParsing(false);
  };

  const podeSalvar =
    titular.trim() && numeroOnfly.trim() && tipoPagRec.trim() && vencimento && preview && preview.totalLinhas > 0;

  const handleSalvar = async () => {
    if (!podeSalvar || !preview) return;
    setSaving(true);
    try {
      const competenciaDerivada = `${vencimento.slice(0, 7)}-01`; // 1º dia do mês do vencimento
      await criarLoteComLinhas({
        titular: titular.trim(),
        final_cartao: finalCartao.trim() || null,
        numero_onfly: numeroOnfly.trim(),
        codigo_tipo_pag_rec: tipoPagRec.trim(),
        competencia: competenciaDerivada,
        data_vencimento: vencimento,
        linhas: preview.linhas,
        created_by: userId,
      });
      toast({ title: `Fatura importada: ${preview.totalLinhas} linhas.` });
      reset();
      onImported();
    } catch (e: any) {
      toast({ title: "Erro ao importar", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!saving) {
          onOpenChange(v);
          if (!v) reset();
        }
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar fatura de cartão</DialogTitle>
          <DialogDescription>
            {vencimento
              ? `Competência ${format(new Date(vencimento.slice(0, 7) + "-01T00:00:00"), "MMMM 'de' yyyy", { locale: ptBR })} (derivada do vencimento). `
              : "Informe o vencimento para definir a competência. "}
            A planilha deve seguir o layout padrão (aba "RELAÇÃO CNPJ").
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Titular *</Label>
              <Input placeholder="ex: JAMILE M B SANTOS" value={titular} onChange={(e) => setTitular(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Final do cartão</Label>
              <Input placeholder="ex: 2462" value={finalCartao} onChange={(e) => setFinalCartao(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Número do lote (Onfly) *</Label>
            <Input
              placeholder="ex: 20262185859"
              value={numeroOnfly}
              onChange={(e) => setNumeroOnfly(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo Conta Pag/Rec (Alvo) *</Label>
              <Input placeholder="ex: 0000013" value={tipoPagRec} onChange={(e) => setTipoPagRec(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Vencimento da fatura *</Label>
              <Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Planilha (.xlsx) *</Label>
            <Input type="file" accept=".xlsx,.xls" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
          </div>

          {parsing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Lendo planilha...
            </div>
          )}

          {preview && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Prévia</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <p>{preview.totalLinhas} linhas detectadas.</p>
                <p className="text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {preview.totalComEntidade} com fornecedor resolvido por CNPJ
                </p>
                {preview.totalSemEntidade > 0 && (
                  <p className="text-amber-600 flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" /> {preview.totalSemEntidade} sem fornecedor (resolver na
                    edição)
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              reset();
            }}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={handleSalvar} disabled={!podeSalvar || saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importando...
              </>
            ) : (
              "Importar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ════════ DETALHE DO LOTE ════════ */

function DetalheLote({
  lote,
  classes,
  centros,
  onVoltar,
}: {
  lote: CartaoLote;
  classes: ClasseOption[];
  centros: CentroCustoOption[];
  onVoltar: () => void;
}) {
  const [itens, setItens] = useState<CartaoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [ignorarItem, setIgnorarItem] = useState<CartaoItem | null>(null);
  const [motivo, setMotivo] = useState("");
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [massaClasse, setMassaClasse] = useState("");
  const [massaCentro, setMassaCentro] = useState("");
  const [aplicando, setAplicando] = useState(false);

  const fetchItens = useCallback(async () => {
    setLoading(true);
    try {
      setItens(await loadItens(lote.id));
    } catch (e: any) {
      toast({ title: "Erro ao carregar linhas", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  }, [lote.id]);

  useEffect(() => {
    fetchItens();
  }, [fetchItens]);

  const totalValor = useMemo(() => itens.reduce((s, i) => s + i.valor, 0), [itens]);

  // editáveis = não emitidas e não ignoradas
  const editaveis = itens.filter((i) => i.status_linha !== "emitido" && i.status_linha !== "ignorado");

  // substitui apenas a linha alterada (sem reload da tabela inteira)
  const aplicarLinhaLocal = (linha: CartaoItem) => {
    setItens((prev) => prev.map((i) => (i.id === linha.id ? linha : i)));
  };

  const patchCampo = async (
    item: CartaoItem,
    campo: "codigo_entidade" | "codigo_classe_rec_desp" | "codigo_centro_ctrl",
    valor: string | null,
  ) => {
    // otimista
    const otim = { ...item, [campo]: valor };
    aplicarLinhaLocal(otim);
    try {
      const atualizada = await atualizarLinha(item.id, {
        codigo_entidade: campo === "codigo_entidade" ? valor : item.codigo_entidade,
        codigo_classe_rec_desp: campo === "codigo_classe_rec_desp" ? valor : item.codigo_classe_rec_desp,
        codigo_centro_ctrl: campo === "codigo_centro_ctrl" ? valor : item.codigo_centro_ctrl,
      });
      aplicarLinhaLocal(atualizada); // pega o status_linha recalculado pela trigger
    } catch (e: any) {
      toast({ title: "Erro ao salvar", description: e.message, variant: "destructive" });
      aplicarLinhaLocal(item); // reverte
    }
  };

  // ── seleção em massa ──
  const toggleMarcada = (id: string) => {
    setMarcadas((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const todasMarcadas = editaveis.length > 0 && editaveis.every((i) => marcadas.has(i.id));
  const toggleTodas = () => {
    setMarcadas(todasMarcadas ? new Set() : new Set(editaveis.map((i) => i.id)));
  };

  const aplicarEmMassa = async (campo: "codigo_classe_rec_desp" | "codigo_centro_ctrl", valor: string) => {
    if (!valor || marcadas.size === 0) return;
    setAplicando(true);
    const alvos = itens.filter(
      (i) => marcadas.has(i.id) && i.status_linha !== "emitido" && i.status_linha !== "ignorado",
    );
    try {
      for (const item of alvos) {
        const atualizada = await atualizarLinha(item.id, {
          codigo_entidade: item.codigo_entidade,
          codigo_classe_rec_desp: campo === "codigo_classe_rec_desp" ? valor : item.codigo_classe_rec_desp,
          codigo_centro_ctrl: campo === "codigo_centro_ctrl" ? valor : item.codigo_centro_ctrl,
        });
        aplicarLinhaLocal(atualizada);
      }
      toast({ title: `Aplicado a ${alvos.length} linha(s).` });
    } catch (e: any) {
      toast({ title: "Erro ao aplicar em massa", description: e.message, variant: "destructive" });
    }
    setAplicando(false);
  };

  const handleIgnorar = async () => {
    if (!ignorarItem) return;
    try {
      await ignorarLinha(ignorarItem.id, motivo.trim() || "Sem motivo informado");
      toast({ title: "Linha ignorada." });
      setIgnorarItem(null);
      setMotivo("");
      fetchItens();
    } catch (e: any) {
      toast({ title: "Erro ao ignorar", description: e.message, variant: "destructive" });
    }
  };

  const handleReativar = async (item: CartaoItem) => {
    try {
      await reativarLinha(item.id);
      toast({ title: "Linha reativada." });
      fetchItens();
    } catch (e: any) {
      toast({ title: "Erro ao reativar", description: e.message, variant: "destructive" });
    }
  };

  const prontas = itens.filter((i) => i.status_linha === "pronto").length;

  return (
    <TooltipProvider>
      <div className="space-y-4 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onVoltar}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">{lote.titular}</h1>
              <p className="text-sm text-muted-foreground">
                {lote.final_cartao ? `•••• ${lote.final_cartao} · ` : ""}
                Venc. {fmtData(lote.data_vencimento)} · {itens.length} linhas · {fmtBRL(totalValor)}
              </p>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button disabled className="opacity-60">
                  <Send className="mr-2 h-4 w-4" /> Emitir prontas ({prontas})
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Emissão no Alvo — Frente C (em construção)</TooltipContent>
          </Tooltip>
        </div>

        {/* Barra de ações em massa — aparece quando há linhas marcadas */}
        {marcadas.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Layers className="h-4 w-4" /> {marcadas.size} selecionada(s)
            </span>
            <div className="flex items-center gap-2">
              <Select value={massaClasse} onValueChange={setMassaClasse}>
                <SelectTrigger className="h-8 w-[200px] text-xs">
                  <SelectValue placeholder="Classe..." />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.codigo} value={c.codigo} className="text-xs">
                      {c.codigo} — {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="secondary"
                disabled={!massaClasse || aplicando}
                onClick={() => aplicarEmMassa("codigo_classe_rec_desp", massaClasse)}
              >
                Aplicar classe
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Select value={massaCentro} onValueChange={setMassaCentro}>
                <SelectTrigger className="h-8 w-[200px] text-xs">
                  <SelectValue placeholder="Centro..." />
                </SelectTrigger>
                <SelectContent>
                  {centros.map((c) => (
                    <SelectItem key={c.erp_code} value={c.erp_code} className="text-xs">
                      {c.name} ({c.erp_code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="secondary"
                disabled={!massaCentro || aplicando}
                onClick={() => aplicarEmMassa("codigo_centro_ctrl", massaCentro)}
              >
                Aplicar centro
              </Button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setMarcadas(new Set())}>
              Limpar seleção
            </Button>
            {aplicando && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
        )}

        <div className="rounded-md border overflow-x-auto">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[36px]">
                  <Checkbox checked={todasMarcadas} onCheckedChange={toggleTodas} aria-label="Selecionar todas" />
                </TableHead>
                <TableHead className="w-[78px]">Data</TableHead>
                <TableHead className="min-w-[160px]">Estabelecimento</TableHead>
                <TableHead className="w-[90px] text-right">Valor</TableHead>
                <TableHead className="w-[230px]">Fornecedor</TableHead>
                <TableHead className="w-[170px]">Classe</TableHead>
                <TableHead className="w-[170px]">Centro Ctrl</TableHead>
                <TableHead className="w-[84px]">Status</TableHead>
                <TableHead className="w-[44px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : itens.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    Lote sem linhas.
                  </TableCell>
                </TableRow>
              ) : (
                itens.map((item) => {
                  const bloqueado = item.status_linha === "emitido";
                  const ignorado = item.status_linha === "ignorado";
                  const editavel = !bloqueado && !ignorado;
                  return (
                    <TableRow key={item.id} className={ignorado ? "opacity-50" : ""}>
                      <TableCell>
                        {editavel && (
                          <Checkbox
                            checked={marcadas.has(item.id)}
                            onCheckedChange={() => toggleMarcada(item.id)}
                            aria-label="Selecionar linha"
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{fmtData(item.data_transacao)}</TableCell>
                      <TableCell>
                        <div className="text-sm font-medium leading-tight">{item.descricao_estabelecimento}</div>
                        {item.justificativa && (
                          <div className="text-xs text-muted-foreground">{item.justificativa}</div>
                        )}
                        {item.cnpj_bruto && !item.cnpj_normalizado && (
                          <div className="text-xs text-amber-600">CNPJ inválido: {item.cnpj_bruto}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmtBRL(item.valor)}</TableCell>
                      <TableCell>
                        <EntidadeCombobox
                          value={item.codigo_entidade}
                          onChange={(cod) => patchCampo(item, "codigo_entidade", cod)}
                          disabled={!editavel}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={item.codigo_classe_rec_desp ?? ""}
                          onValueChange={(v) => patchCampo(item, "codigo_classe_rec_desp", v || null)}
                          disabled={!editavel}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Classe..." />
                          </SelectTrigger>
                          <SelectContent>
                            {classes.map((c) => (
                              <SelectItem key={c.codigo} value={c.codigo} className="text-xs">
                                {c.codigo} — {c.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={item.codigo_centro_ctrl ?? ""}
                          onValueChange={(v) => patchCampo(item, "codigo_centro_ctrl", v || null)}
                          disabled={!editavel}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Centro..." />
                          </SelectTrigger>
                          <SelectContent>
                            {centros.map((c) => (
                              <SelectItem key={c.erp_code} value={c.erp_code} className="text-xs">
                                {c.name} ({c.erp_code})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>{statusLinhaBadge(item.status_linha)}</TableCell>
                      <TableCell>
                        {bloqueado ? (
                          <span className="text-xs text-muted-foreground" title={`DocFin ${item.docfin_chave ?? ""}`}>
                            {item.docfin_numero ?? "—"}
                          </span>
                        ) : ignorado ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Reativar"
                            onClick={() => handleReativar(item)}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            title="Ignorar"
                            onClick={() => setIgnorarItem(item)}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <Dialog
          open={!!ignorarItem}
          onOpenChange={(o) => {
            if (!o) {
              setIgnorarItem(null);
              setMotivo("");
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ignorar linha</DialogTitle>
              <DialogDescription>
                {ignorarItem?.descricao_estabelecimento} · {ignorarItem ? fmtBRL(ignorarItem.valor) : ""}. A linha sai
                da fila de emissão, mas fica registrada para consulta.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label>Motivo</Label>
              <Textarea
                placeholder="ex: gasto pessoal / não reembolsável"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIgnorarItem(null);
                  setMotivo("");
                }}
              >
                Cancelar
              </Button>
              <Button onClick={handleIgnorar}>Ignorar linha</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
