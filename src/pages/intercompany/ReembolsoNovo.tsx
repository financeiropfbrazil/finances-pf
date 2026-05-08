import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useEmitReembolso } from "@/hooks/useEmitReembolso";
import { buscarSugestaoNumero, listarClassesPorTipo } from "@/services/intercompanyMasterService";
import type { SugestaoNumeroInvoice, ClasseIntercompanyOption } from "@/types/intercompany";

/**
 * Catálogo fixo de Kontos AT (Áustria).
 * São apenas 8 e mudam raramente. Hardcoded evita query extra.
 * Atualizar aqui se PEF Áustria adicionar/remover Kontos.
 */
const KONTOS_AT_AUSTRIA: { numero: string; descricao: string }[] = [
  { numero: "57520", descricao: "CMV" },
  { numero: "57530", descricao: "CMV USA" },
  { numero: "54401", descricao: "Frete s/ Vendas" },
  { numero: "73403", descricao: "Despesas de Viagem" },
  { numero: "77601", descricao: "Namsa Serviços R&D" },
  { numero: "77603", descricao: "P&D Materiais" },
  { numero: "77608", descricao: "Estoque-Válvulas (Lab)" },
  { numero: "77930", descricao: "Outras Operacionais (Markup 25%)" },
];

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatEUR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "EUR" });

export default function ReembolsoNovo() {
  const navigate = useNavigate();
  const { status, error: emitError, resultado, emitir, reset } = useEmitReembolso();

  // Loading state inicial
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  // Dados de apoio (sugestão + classes)
  const [sugestao, setSugestao] = useState<SugestaoNumeroInvoice | null>(null);
  const [classes, setClasses] = useState<ClasseIntercompanyOption[]>([]);

  // Form state
  const [numeroInvoice, setNumeroInvoice] = useState("");
  const [classeCodigo, setClasseCodigo] = useState("");
  const [kontoAtNumero, setKontoAtNumero] = useState("");
  const [descricaoRica, setDescricaoRica] = useState("");
  const [cambioStr, setCambioStr] = useState("");
  const [valorEurStr, setValorEurStr] = useState("");
  const [observacoes, setObservacoes] = useState("");

  // ── Carrega sugestão + classes ao montar ──
  const carregarMeta = async () => {
    setLoadingMeta(true);
    setMetaError(null);
    try {
      const [sug, cls] = await Promise.all([buscarSugestaoNumero(), listarClassesPorTipo("reembolso")]);
      setSugestao(sug);
      setClasses(cls);

      // Auto-preenche número sugerido (D1: editável)
      if (!numeroInvoice && sug?.sugestao) {
        setNumeroInvoice(sug.sugestao);
      }
    } catch (err: any) {
      setMetaError(err.message ?? "Erro ao carregar dados auxiliares");
    } finally {
      setLoadingMeta(false);
    }
  };

  useEffect(() => {
    carregarMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Quando classe muda: auto-seleciona Konto AT default ──
  useEffect(() => {
    if (!classeCodigo) return;
    const cls = classes.find((c) => c.classe_codigo === classeCodigo);
    if (cls) {
      setKontoAtNumero(cls.konto_at_default);
    }
  }, [classeCodigo, classes]);

  // ── Classe selecionada (memo) ──
  const classeSelecionada = useMemo(
    () => classes.find((c) => c.classe_codigo === classeCodigo) ?? null,
    [classeCodigo, classes],
  );

  // ── Cálculos derivados ──
  const cambioNum = parseFloat(cambioStr.replace(",", ".")) || 0;
  const valorEurNum = parseFloat(valorEurStr.replace(",", ".")) || 0;
  const valorBrlCalc = cambioNum > 0 && valorEurNum > 0 ? +(valorEurNum * cambioNum).toFixed(2) : 0;

  // ── Validação do submit ──
  const camposValidos =
    numeroInvoice.trim().length > 0 &&
    /^\d{3,4}\/\d{4}$/.test(numeroInvoice.trim()) &&
    descricaoRica.trim().length > 0 &&
    classeCodigo.length > 0 &&
    kontoAtNumero.length > 0 &&
    cambioNum > 0 &&
    valorEurNum > 0;

  const podeEmitir = camposValidos && status === "idle";

  // ── Handler do submit ──
  const handleEmitir = async () => {
    if (!podeEmitir) return;
    await emitir({
      numero_invoice: numeroInvoice.trim(),
      descricao_rica: descricaoRica.trim(),
      classe_codigo: classeCodigo,
      konto_austria_numero: kontoAtNumero,
      cambio_eur_brl: cambioNum,
      valor_eur: valorEurNum,
      observacoes: observacoes.trim() || undefined,
    });
  };

  // ── Quando emit completa com sucesso, mostra toast e redireciona ──
  useEffect(() => {
    if (status === "sucesso" && resultado) {
      toast({
        title: "Reembolso emitido com sucesso!",
        description: `Invoice ${resultado.numero_invoice} criada no Alvo (Chave ${resultado.chave_alvo}).`,
      });
      // D3: redireciona pra /master (lista geral)
      const t = setTimeout(() => navigate("/intercompany/master"), 1500);
      return () => clearTimeout(t);
    }
  }, [status, resultado, navigate]);

  // ── Render: estado de loading inicial ──
  if (loadingMeta) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Render: erro ao carregar ──
  if (metaError) {
    return (
      <div className="p-6">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <div className="flex-1">
              <p className="text-sm font-medium">Erro ao carregar dados</p>
              <p className="text-xs text-muted-foreground mt-1">{metaError}</p>
            </div>
            <Button size="sm" variant="outline" onClick={carregarMeta}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/intercompany/master")} disabled={status !== "idle"}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Voltar
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Novo Reembolso Intercompany</h1>
          <p className="text-sm text-muted-foreground">
            Cria invoice de reembolso e emite diretamente no ERP Alvo (PEF Áustria)
          </p>
        </div>
      </div>

      {/* Card sugestão de numeração */}
      {sugestao && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-center gap-3 p-4">
            <Sparkles className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                Sugestão: <span className="font-mono">{sugestao.sugestao}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Maior sequencial detectado em {sugestao.ano}: {sugestao.maior_sequencial} (
                {sugestao.total_invoices_alvo} invoices Alvo + {sugestao.total_invoices_master} no master)
                {sugestao.ultima_sincronizacao && (
                  <> · sync: {new Date(sugestao.ultima_sincronizacao).toLocaleString("pt-BR")}</>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Formulário principal */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Dados da Invoice</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Linha 1: número da invoice */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-1">
              <Label htmlFor="numero">Número da Invoice *</Label>
              <Input
                id="numero"
                value={numeroInvoice}
                onChange={(e) => setNumeroInvoice(e.target.value)}
                placeholder="Ex: 122/2026"
                className="font-mono"
                disabled={status !== "idle"}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Formato NNN/AAAA. Editável.</p>
            </div>
          </div>

          {/* Linha 2: classe */}
          <div>
            <Label htmlFor="classe">Classe Intercompany *</Label>
            <Select value={classeCodigo} onValueChange={setClasseCodigo} disabled={status !== "idle"}>
              <SelectTrigger id="classe">
                <SelectValue placeholder="Selecione a classe (07.x)" />
              </SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c.classe_codigo} value={c.classe_codigo}>
                    <span className="font-mono mr-2">{c.classe_codigo}</span>
                    <span>{c.classe_nome}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Triple Match contábil — só aparece quando há classe selecionada */}
          {classeSelecionada && (
            <Card className="border-muted bg-muted/30">
              <CardContent className="p-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  🔗 Triple Match Contábil
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Classe Alvo (BR)</p>
                    <p className="font-mono font-medium">{classeSelecionada.classe_codigo}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{classeSelecionada.classe_nome}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Conta Contábil (BR)</p>
                    <p className="font-mono font-medium">{classeSelecionada.conta_contabil_reduzida ?? "—"}</p>
                    {classeSelecionada.conta_contabil_reduzida === null && (
                      <p className="text-[10px] text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Enriquecer em Classes
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-muted-foreground">Konto Áustria</p>
                    <p className="font-mono font-medium">{kontoAtNumero || "—"}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {KONTOS_AT_AUSTRIA.find((k) => k.numero === kontoAtNumero)?.descricao}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Konto AT — editável (D3 = b: dropdown com todos) */}
          <div>
            <Label htmlFor="konto">Konto Áustria *</Label>
            <Select value={kontoAtNumero} onValueChange={setKontoAtNumero} disabled={status !== "idle"}>
              <SelectTrigger id="konto">
                <SelectValue placeholder="Selecione o Konto" />
              </SelectTrigger>
              <SelectContent>
                {KONTOS_AT_AUSTRIA.map((k) => (
                  <SelectItem key={k.numero} value={k.numero}>
                    <span className="font-mono mr-2">{k.numero}</span>
                    <span>{k.descricao}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">
              Auto-preenchido com base na classe escolhida. Pode trocar se necessário.
            </p>
          </div>

          {/* Linha valores */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="valor-eur">Valor em EUR *</Label>
              <Input
                id="valor-eur"
                type="text"
                inputMode="decimal"
                value={valorEurStr}
                onChange={(e) => setValorEurStr(e.target.value)}
                placeholder="Ex: 1500.00"
                disabled={status !== "idle"}
              />
            </div>
            <div>
              <Label htmlFor="cambio">Câmbio EUR→BRL *</Label>
              <Input
                id="cambio"
                type="text"
                inputMode="decimal"
                value={cambioStr}
                onChange={(e) => setCambioStr(e.target.value)}
                placeholder="Ex: 6.25"
                disabled={status !== "idle"}
              />
              <p className="text-[10px] text-muted-foreground mt-1">PTAX dia anterior</p>
            </div>
            <div>
              <Label>Valor em BRL (calculado)</Label>
              <div className="h-10 px-3 flex items-center rounded-md border border-input bg-muted/50 text-sm font-mono font-semibold">
                {valorBrlCalc > 0 ? formatBRL(valorBrlCalc) : "—"}
              </div>
              {valorEurNum > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {formatEUR(valorEurNum)} × {cambioNum.toLocaleString("pt-BR", { minimumFractionDigits: 4 })}
                </p>
              )}
            </div>
          </div>

          {/* Descrição rica */}
          <div>
            <Label htmlFor="descricao">Descrição (Observação) *</Label>
            <Textarea
              id="descricao"
              value={descricaoRica}
              onChange={(e) => setDescricaoRica(e.target.value)}
              placeholder="Ex: Reembolso de despesas de viagem - missão Áustria mar/2026 - João Silva"
              rows={3}
              disabled={status !== "idle"}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Vai pro campo Observação do DocFin no Alvo. Seja descritivo.
            </p>
          </div>

          {/* Observações internas (opcional) */}
          <div>
            <Label htmlFor="obs">Observações internas (opcional)</Label>
            <Textarea
              id="obs"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Notas internas (não vai pro Alvo)"
              rows={2}
              disabled={status !== "idle"}
            />
          </div>
        </CardContent>
      </Card>

      {/* Erro de emissão */}
      {status === "erro" && emitError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-destructive">Erro ao emitir</p>
              <p className="text-xs text-muted-foreground mt-1 break-words">{emitError}</p>
            </div>
            <Button size="sm" variant="outline" onClick={reset}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Sucesso */}
      {status === "sucesso" && resultado && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-600">
                Invoice {resultado.numero_invoice} emitida com sucesso!
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Chave Alvo: <span className="font-mono">{resultado.chave_alvo}</span> · Redirecionando...
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Botões de ação */}
      <div className="flex items-center justify-end gap-2 pb-6">
        <Button
          variant="outline"
          onClick={() => navigate("/intercompany/master")}
          disabled={status === "criando" || status === "emitindo"}
        >
          Cancelar
        </Button>
        <Button onClick={handleEmitir} disabled={!podeEmitir} className="min-w-[180px]">
          {status === "criando" && (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando rascunho...
            </>
          )}
          {status === "emitindo" && (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Emitindo no Alvo...
            </>
          )}
          {status === "idle" && (
            <>
              <FileText className="mr-2 h-4 w-4" />
              Emitir Invoice
            </>
          )}
          {status === "sucesso" && (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Emitida!
            </>
          )}
          {status === "erro" && (
            <>
              <AlertCircle className="mr-2 h-4 w-4" />
              Falhou
            </>
          )}
        </Button>
      </div>

      {/* Estado de progress visual durante emissão */}
      {(status === "criando" || status === "emitindo") && (
        <Card className="border-primary/20 bg-primary/5 fixed bottom-4 right-4 z-50 w-80 shadow-lg">
          <CardContent className="flex items-center gap-3 p-4">
            <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">
                {status === "criando" ? "Criando rascunho..." : "Emitindo no Alvo..."}
              </p>
              <p className="text-xs text-muted-foreground">
                {status === "criando" ? "Salvando no banco do Hub" : "Enviando ao ERP via gateway"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
