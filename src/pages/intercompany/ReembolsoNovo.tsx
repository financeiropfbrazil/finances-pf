import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronsUpDown,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useEmitReembolsoManual } from "@/hooks/useEmitReembolsoManual";
import { buscarSugestaoNumero, listarClassesPorTipo } from "@/services/intercompanyMasterService";
import type {
  SugestaoNumeroInvoice,
  ClasseIntercompanyOption,
  BlocoManualInput,
  RateioBlocoManual,
} from "@/types/intercompany";

// ═════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════

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

const MAX_RATEIOS_POR_BLOCO = 5;
const MAX_BLOCOS = 10;
const MARKUP_DIVISOR = 0.8; // valor_total = service_fee / 0.8 (markup 25%)

// ═════════════════════════════════════════════════════════════
// Helpers de formatação e cálculo
// ═════════════════════════════════════════════════════════════

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatEUR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "EUR" });

/**
 * Recalcula valor_eur de cada rateio do bloco garantindo soma exata.
 * As N-1 primeiras linhas usam (pct/100)×total arredondado; a última absorve resto.
 */
function recalcularValoresRateio(rateios: RateioBlocoLinha[], valorTotalBloco: number): RateioBlocoLinha[] {
  if (rateios.length === 0 || valorTotalBloco <= 0) {
    return rateios.map((r) => ({ ...r, valor_eur: 0 }));
  }
  const n = rateios.length;
  let acumulado = 0;
  return rateios.map((r, idx) => {
    let valor: number;
    if (idx === n - 1) {
      valor = +(valorTotalBloco - acumulado).toFixed(2);
    } else {
      valor = +((r.percentual / 100) * valorTotalBloco).toFixed(2);
      acumulado += valor;
    }
    return { ...r, valor_eur: valor };
  });
}

// ═════════════════════════════════════════════════════════════
// Types locais (state)
// ═════════════════════════════════════════════════════════════

interface CostCenterOption {
  erp_code: string;
  name: string;
  department_type: string | null;
}

interface RateioBlocoLinha {
  tempId: string;
  centro_custo_erp_code: string;
  percentual: number;
  valor_eur: number;
}

interface BlocoLinha {
  tempId: string;
  classe_codigo: string;
  konto_austria_numero: string;
  valor_eur_str: string; // input controlado
  rateios: RateioBlocoLinha[];
}

// ═════════════════════════════════════════════════════════════
// Página principal
// ═════════════════════════════════════════════════════════════

export default function ReembolsoNovo() {
  const navigate = useNavigate();
  const { status, error: emitError, resultado, emitir, reset } = useEmitReembolsoManual();

  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [sugestao, setSugestao] = useState<SugestaoNumeroInvoice | null>(null);
  const [classes, setClasses] = useState<ClasseIntercompanyOption[]>([]);

  // ─── Centros de custo (compartilhados entre todos os blocos) ───
  const { data: costCenters = [] } = useQuery({
    queryKey: ["cost_centers_reembolso_manual"],
    queryFn: async (): Promise<CostCenterOption[]> => {
      const { data, error } = await (supabase as any)
        .from("cost_centers")
        .select("erp_code, name, department_type")
        .eq("is_active", true)
        .eq("group_type", "F")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as CostCenterOption[];
    },
  });

  // ─── Form state — Dados básicos ───
  const [numeroInvoice, setNumeroInvoice] = useState("");
  const [descricaoObservacao, setDescricaoObservacao] = useState("");
  const [descriptionPdf, setDescriptionPdf] = useState("");
  const [observacoesInternas, setObservacoesInternas] = useState("");
  const [cambioStr, setCambioStr] = useState("");

  // ─── Form state — Markup ───
  const [markupAplicado, setMarkupAplicado] = useState(false);
  const [valorEurServiceFeeStr, setValorEurServiceFeeStr] = useState("");

  // ─── Form state — Blocos ───
  const [blocos, setBlocos] = useState<BlocoLinha[]>([
    {
      tempId: `bl-${Date.now()}-0`,
      classe_codigo: "",
      konto_austria_numero: "",
      valor_eur_str: "",
      rateios: [
        {
          tempId: `rt-${Date.now()}-0`,
          centro_custo_erp_code: "",
          percentual: 100,
          valor_eur: 0,
        },
      ],
    },
  ]);

  // ─── Popover de busca de CC ───
  const [ccPopoverOpenKey, setCcPopoverOpenKey] = useState<string | null>(null);
  const [ccSearch, setCcSearch] = useState("");

  // ═════════════════════════════════════════════════════════════
  // Loaders iniciais
  // ═════════════════════════════════════════════════════════════

  const carregarMeta = async () => {
    setLoadingMeta(true);
    setMetaError(null);
    try {
      const [sug, cls] = await Promise.all([buscarSugestaoNumero(), listarClassesPorTipo("reembolso")]);
      setSugestao(sug);
      setClasses(cls);

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

  // ═════════════════════════════════════════════════════════════
  // Cálculos derivados
  // ═════════════════════════════════════════════════════════════

  const cambioNum = parseFloat(cambioStr.replace(",", ".")) || 0;
  const valorEurServiceFeeNum = parseFloat(valorEurServiceFeeStr.replace(",", ".")) || 0;

  // Valor total (com markup se aplicado) — esse vai pro Alvo
  const valorEurTotal = useMemo(() => {
    if (valorEurServiceFeeNum <= 0) return 0;
    if (markupAplicado) {
      return +(valorEurServiceFeeNum / MARKUP_DIVISOR).toFixed(2);
    }
    return valorEurServiceFeeNum;
  }, [valorEurServiceFeeNum, markupAplicado]);

  const valorEurOtherExpenses = useMemo(() => {
    if (!markupAplicado) return 0;
    return +(valorEurTotal - valorEurServiceFeeNum).toFixed(2);
  }, [valorEurTotal, valorEurServiceFeeNum, markupAplicado]);

  const valorBrlTotal = useMemo(() => +(valorEurTotal * cambioNum).toFixed(2), [valorEurTotal, cambioNum]);

  // Soma dos blocos digitados
  const somaBlocosEur = useMemo(() => {
    return blocos.reduce((sum, b) => {
      const v = parseFloat(b.valor_eur_str.replace(",", ".")) || 0;
      return sum + v;
    }, 0);
  }, [blocos]);

  const diferencaBlocosVsTotal = +(somaBlocosEur - valorEurTotal).toFixed(2);
  const blocosBatem = Math.abs(diferencaBlocosVsTotal) < 0.01;

  // ═════════════════════════════════════════════════════════════
  // Manipulação de Blocos
  // ═════════════════════════════════════════════════════════════

  const adicionarBloco = () => {
    if (blocos.length >= MAX_BLOCOS) return;
    setBlocos((prev) => [
      ...prev,
      {
        tempId: `bl-${Date.now()}-${Math.random()}`,
        classe_codigo: "",
        konto_austria_numero: "",
        valor_eur_str: "",
        rateios: [
          {
            tempId: `rt-${Date.now()}-${Math.random()}`,
            centro_custo_erp_code: "",
            percentual: 100,
            valor_eur: 0,
          },
        ],
      },
    ]);
  };

  const removerBloco = (blocoTempId: string) => {
    if (blocos.length === 1) return; // ao menos 1
    setBlocos((prev) => prev.filter((b) => b.tempId !== blocoTempId));
  };

  const atualizarBloco = (blocoTempId: string, patch: Partial<BlocoLinha>) => {
    setBlocos((prev) =>
      prev.map((b) => {
        if (b.tempId !== blocoTempId) return b;
        const novo = { ...b, ...patch };
        // Se mudou valor_eur_str, recalcula rateios
        if ("valor_eur_str" in patch) {
          const novoValor = parseFloat(novo.valor_eur_str.replace(",", ".")) || 0;
          novo.rateios = recalcularValoresRateio(novo.rateios, novoValor);
        }
        return novo;
      }),
    );
  };

  // ═════════════════════════════════════════════════════════════
  // Manipulação de Rateios
  // ═════════════════════════════════════════════════════════════

  const adicionarRateio = (blocoTempId: string) => {
    setBlocos((prev) =>
      prev.map((b) => {
        if (b.tempId !== blocoTempId) return b;
        if (b.rateios.length >= MAX_RATEIOS_POR_BLOCO) return b;
        return {
          ...b,
          rateios: [
            ...b.rateios,
            {
              tempId: `rt-${Date.now()}-${Math.random()}`,
              centro_custo_erp_code: "",
              percentual: 0,
              valor_eur: 0,
            },
          ],
        };
      }),
    );
  };

  const removerRateio = (blocoTempId: string, rateioTempId: string) => {
    setBlocos((prev) =>
      prev.map((b) => {
        if (b.tempId !== blocoTempId) return b;
        if (b.rateios.length === 1) return b; // ao menos 1
        return {
          ...b,
          rateios: b.rateios.filter((r) => r.tempId !== rateioTempId),
        };
      }),
    );
  };

  const atualizarRateio = (blocoTempId: string, rateioTempId: string, patch: Partial<RateioBlocoLinha>) => {
    setBlocos((prev) =>
      prev.map((b) => {
        if (b.tempId !== blocoTempId) return b;
        const novosRateios = b.rateios.map((r) => (r.tempId === rateioTempId ? { ...r, ...patch } : r));
        // Se mudou percentual, recalcula valores do bloco
        if ("percentual" in patch) {
          const valorBloco = parseFloat(b.valor_eur_str.replace(",", ".")) || 0;
          return {
            ...b,
            rateios: recalcularValoresRateio(novosRateios, valorBloco),
          };
        }
        return { ...b, rateios: novosRateios };
      }),
    );
  };

  const dividirIgualmente = (blocoTempId: string) => {
    setBlocos((prev) =>
      prev.map((b) => {
        if (b.tempId !== blocoTempId) return b;
        const n = b.rateios.length;
        if (n === 0) return b;
        const base = Math.floor((100 / n) * 100) / 100;
        const resto = +(100 - base * n).toFixed(2);
        const valorBloco = parseFloat(b.valor_eur_str.replace(",", ".")) || 0;
        const comPercentuais = b.rateios.map((r, idx) => ({
          ...r,
          percentual: idx === n - 1 ? +(base + resto).toFixed(2) : base,
        }));
        return {
          ...b,
          rateios: recalcularValoresRateio(comPercentuais, valorBloco),
        };
      }),
    );
  };

  // ═════════════════════════════════════════════════════════════
  // CCs disponíveis (filtra duplicados dentro do mesmo bloco)
  // ═════════════════════════════════════════════════════════════

  const getCcsDisponiveis = (blocoTempId: string, currentRateioTempId: string) => {
    const bloco = blocos.find((b) => b.tempId === blocoTempId);
    if (!bloco) return [];
    const ccsJaSelecionados = new Set(
      bloco.rateios
        .filter((r) => r.tempId !== currentRateioTempId && r.centro_custo_erp_code)
        .map((r) => r.centro_custo_erp_code),
    );
    const q = ccSearch.trim().toLowerCase();
    return costCenters
      .filter((cc) => !ccsJaSelecionados.has(cc.erp_code))
      .filter((cc) => {
        if (!q) return true;
        return cc.name.toLowerCase().includes(q) || cc.erp_code.toLowerCase().includes(q);
      })
      .slice(0, 50);
  };

  // ═════════════════════════════════════════════════════════════
  // Validação geral
  // ═════════════════════════════════════════════════════════════

  const camposBasicosValidos =
    numeroInvoice.trim().length > 0 &&
    /^\d{3,4}\/\d{4}$/.test(numeroInvoice.trim()) &&
    descricaoObservacao.trim().length > 0 &&
    descriptionPdf.trim().length > 0 &&
    cambioNum > 0 &&
    valorEurServiceFeeNum > 0;

  const blocosValidos = useMemo(() => {
    if (blocos.length === 0) return false;
    if (!blocosBatem) return false;
    for (const b of blocos) {
      if (!b.classe_codigo) return false;
      if (!b.konto_austria_numero) return false;
      const valor = parseFloat(b.valor_eur_str.replace(",", ".")) || 0;
      if (valor <= 0) return false;
      if (b.rateios.length === 0 || b.rateios.length > MAX_RATEIOS_POR_BLOCO) return false;
      const somaPct = b.rateios.reduce((s, r) => s + (r.percentual || 0), 0);
      if (Math.abs(somaPct - 100) > 0.01) return false;
      for (const r of b.rateios) {
        if (!r.centro_custo_erp_code) return false;
        if (r.percentual <= 0 || r.percentual > 100) return false;
      }
    }
    return true;
  }, [blocos, blocosBatem]);

  const podeEmitir = camposBasicosValidos && blocosValidos && status === "idle";

  // ═════════════════════════════════════════════════════════════
  // Submit
  // ═════════════════════════════════════════════════════════════

  const handleEmitir = async () => {
    if (!podeEmitir) return;
    const blocosInput: BlocoManualInput[] = blocos.map((b) => ({
      classe_codigo: b.classe_codigo,
      konto_austria_numero: b.konto_austria_numero,
      valor_eur: parseFloat(b.valor_eur_str.replace(",", ".")) || 0,
      rateios: b.rateios.map(
        (r): RateioBlocoManual => ({
          centro_custo_erp_code: r.centro_custo_erp_code,
          percentual: r.percentual,
          valor_eur: r.valor_eur,
        }),
      ),
    }));

    await emitir({
      numero_invoice: numeroInvoice.trim(),
      descricao_observacao: descricaoObservacao.trim(),
      description_pdf: descriptionPdf.trim(),
      cambio_eur_brl: cambioNum,
      markup_aplicado: markupAplicado,
      valor_eur_service_fee: valorEurServiceFeeNum,
      valor_eur_total: valorEurTotal,
      observacoes_internas: observacoesInternas.trim() || undefined,
      blocos: blocosInput,
    });
  };

  useEffect(() => {
    if (status === "sucesso" && resultado) {
      toast({
        title: "Reembolso Manual emitido com sucesso!",
        description: `Invoice ${resultado.numero_invoice} (Chave Alvo ${resultado.chave_alvo}). PDF: ${resultado.pdf_status?.anexado_alvo ? "anexado ✓" : "falhou ✗"}`,
      });
      const t = setTimeout(() => navigate("/intercompany/master"), 1800);
      return () => clearTimeout(t);
    }
  }, [status, resultado, navigate]);

  // ═════════════════════════════════════════════════════════════
  // Renders auxiliares
  // ═════════════════════════════════════════════════════════════

  if (loadingMeta) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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

  // ═════════════════════════════════════════════════════════════
  // Render principal
  // ═════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/intercompany/master")} disabled={status !== "idle"}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Voltar
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Novo Reembolso Manual</h1>
          <p className="text-sm text-muted-foreground">
            Cria invoice manual (sem NF de origem), gera PDF e emite no ERP Alvo
          </p>
        </div>
      </div>

      {/* Sugestão de número */}
      {sugestao && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex items-center gap-3 p-4">
            <Sparkles className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">
                Sugestão: <span className="font-mono">{sugestao.sugestao}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Maior sequencial em {sugestao.ano}: {sugestao.maior_sequencial} ({sugestao.total_invoices_alvo} Alvo +{" "}
                {sugestao.total_invoices_master} master)
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Seção 1: Dados básicos ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Dados da Invoice</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="numero">Número da Invoice *</Label>
              <Input
                id="numero"
                value={numeroInvoice}
                onChange={(e) => setNumeroInvoice(e.target.value)}
                placeholder="Ex: 137/2026"
                className="font-mono"
                disabled={status !== "idle"}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Formato NNN/AAAA. Editável.</p>
            </div>
            <div>
              <Label htmlFor="cambio">Câmbio EUR→BRL *</Label>
              <Input
                id="cambio"
                type="text"
                inputMode="decimal"
                value={cambioStr}
                onChange={(e) => setCambioStr(e.target.value)}
                placeholder="Ex: 6.10"
                disabled={status !== "idle"}
              />
              <p className="text-[10px] text-muted-foreground mt-1">PTAX dia anterior</p>
            </div>
          </div>

          <div>
            <Label htmlFor="obs-alvo">Descrição (Observação) — vai pro Alvo *</Label>
            <Textarea
              id="obs-alvo"
              value={descricaoObservacao}
              onChange={(e) => setDescricaoObservacao(e.target.value)}
              placeholder="Ex: Reembolso - PO's 2915/3505/3507"
              rows={2}
              disabled={status !== "idle"}
            />
          </div>

          <div>
            <Label htmlFor="obs-internas">Observações internas (opcional)</Label>
            <Textarea
              id="obs-internas"
              value={observacoesInternas}
              onChange={(e) => setObservacoesInternas(e.target.value)}
              placeholder="Notas internas (não vai pro Alvo)"
              rows={2}
              disabled={status !== "idle"}
            />
          </div>
        </CardContent>
      </Card>

      {/* ─── Seção 2: Description of services (vai no PDF) ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Description of services <span className="text-xs text-muted-foreground font-normal">(aparece no PDF)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={descriptionPdf}
            onChange={(e) => setDescriptionPdf(e.target.value)}
            placeholder={`Ex:
Service fee delivered to Relisys Medical - India.

Delivery Invoice 055/2026:
- 2 units Aortosave = 7.290 EUR (2 x 3.645)
- Freight Cost = 850 EUR

TOTAL = 8.140,00 EUR`}
            rows={12}
            disabled={status !== "idle"}
            className="font-mono text-xs"
          />
          <p className="text-[10px] text-muted-foreground mt-2">
            Texto livre multi-linha. Preserva quebras de linha. Renderiza tal qual no PDF.
          </p>
        </CardContent>
      </Card>

      {/* ─── Seção 3: Markup ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Valores e Markup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="service-fee">Service fee (EUR) *</Label>
              <Input
                id="service-fee"
                type="text"
                inputMode="decimal"
                value={valorEurServiceFeeStr}
                onChange={(e) => setValorEurServiceFeeStr(e.target.value)}
                placeholder="Ex: 8140.00"
                disabled={status !== "idle"}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Valor base antes de markup</p>
            </div>

            <div className="flex flex-col">
              <Label className="mb-1">Markup 25% (Other expenses)</Label>
              <div className="h-10 px-3 flex items-center gap-2 rounded-md border border-input">
                <Switch checked={markupAplicado} onCheckedChange={setMarkupAplicado} disabled={status !== "idle"} />
                <span className="text-xs text-muted-foreground">
                  {markupAplicado ? "Aplicado (Grand Total = service fee / 0.8)" : "Desativado"}
                </span>
              </div>
            </div>

            <div>
              <Label>Grand Total (vai pro Alvo)</Label>
              <div className="h-10 px-3 flex items-center rounded-md border border-input bg-muted/50 text-sm font-mono font-semibold">
                {valorEurTotal > 0 ? formatEUR(valorEurTotal) : "—"}
              </div>
              {valorBrlTotal > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1">≈ {formatBRL(valorBrlTotal)}</p>
              )}
            </div>
          </div>

          {/* Breakdown do markup */}
          {markupAplicado && valorEurServiceFeeNum > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="p-3 space-y-1 text-xs font-mono">
                <div className="flex justify-between">
                  <span>Service fee:</span>
                  <span>{formatEUR(valorEurServiceFeeNum)}</span>
                </div>
                <div className="flex justify-between text-amber-700">
                  <span>+ Other expenses (markup 25%):</span>
                  <span>{formatEUR(valorEurOtherExpenses)}</span>
                </div>
                <div className="flex justify-between font-bold border-t border-amber-500/30 pt-1 mt-1">
                  <span>= Grand Total:</span>
                  <span>{formatEUR(valorEurTotal)}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* ─── Seção 4: Blocos Contábeis ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">
            Blocos Contábeis{" "}
            <span className="text-xs text-muted-foreground font-normal">
              ({blocos.length}/{MAX_BLOCOS})
            </span>
          </CardTitle>
          <span className={`text-sm font-semibold ${blocosBatem ? "text-emerald-600" : "text-destructive"}`}>
            Total blocos: {formatEUR(somaBlocosEur)}
            {!blocosBatem && valorEurTotal > 0 && (
              <span className="ml-2 text-xs">
                (esperado {formatEUR(valorEurTotal)}, diff {formatEUR(diferencaBlocosVsTotal)})
              </span>
            )}
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          {blocos.map((b, idx) => {
            const valorBloco = parseFloat(b.valor_eur_str.replace(",", ".")) || 0;
            const somaPct = b.rateios.reduce((s, r) => s + (r.percentual || 0), 0);
            const pctValido = Math.abs(somaPct - 100) < 0.01;

            return (
              <Card key={b.tempId} className="border-muted">
                <CardContent className="pt-4 space-y-3">
                  {/* Header do bloco */}
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Bloco #{idx + 1}</h4>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => removerBloco(b.tempId)}
                      disabled={blocos.length === 1 || status !== "idle"}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>

                  {/* Classe + Konto + Valor */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Classe Intercompany *</Label>
                      <Select
                        value={b.classe_codigo}
                        onValueChange={(v) => atualizarBloco(b.tempId, { classe_codigo: v })}
                        disabled={status !== "idle"}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Selecione (07.x)" />
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

                    <div>
                      <Label className="text-xs">Konto Áustria *</Label>
                      <Select
                        value={b.konto_austria_numero}
                        onValueChange={(v) => atualizarBloco(b.tempId, { konto_austria_numero: v })}
                        disabled={status !== "idle"}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Selecione" />
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
                    </div>

                    <div>
                      <Label className="text-xs">Valor (EUR) *</Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={b.valor_eur_str}
                        onChange={(e) => atualizarBloco(b.tempId, { valor_eur_str: e.target.value })}
                        placeholder="0.00"
                        className="h-9 text-xs"
                        disabled={status !== "idle"}
                      />
                    </div>
                  </div>

                  {/* Rateios */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold">
                        Rateios CC ({b.rateios.length}/{MAX_RATEIOS_POR_BLOCO})
                      </Label>
                      <span className={`text-xs font-semibold ${pctValido ? "text-emerald-600" : "text-destructive"}`}>
                        Total: {somaPct.toFixed(2)}%
                      </span>
                    </div>

                    {b.rateios.map((r) => {
                      const popoverKey = `${b.tempId}-${r.tempId}`;
                      const ccSelecionado = costCenters.find((cc) => cc.erp_code === r.centro_custo_erp_code) ?? null;
                      return (
                        <div key={r.tempId} className="flex items-start gap-2">
                          {/* Dropdown CC */}
                          <div className="flex-1 min-w-0">
                            <Popover
                              open={ccPopoverOpenKey === popoverKey}
                              onOpenChange={(v) => {
                                setCcPopoverOpenKey(v ? popoverKey : null);
                                if (!v) setCcSearch("");
                              }}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className="w-full justify-between font-normal h-8 text-[11px]"
                                  disabled={status !== "idle"}
                                >
                                  {ccSelecionado ? (
                                    <span className="truncate text-left">
                                      <span className="font-mono mr-1.5">{ccSelecionado.erp_code}</span>
                                      {ccSelecionado.name}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">Selecione um CC</span>
                                  )}
                                  <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50 shrink-0" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                <Command shouldFilter={false}>
                                  <CommandInput placeholder="Buscar..." value={ccSearch} onValueChange={setCcSearch} />
                                  <CommandList>
                                    <CommandEmpty>Nenhum CC disponível.</CommandEmpty>
                                    <CommandGroup>
                                      {getCcsDisponiveis(b.tempId, r.tempId).map((cc) => (
                                        <CommandItem
                                          key={cc.erp_code}
                                          value={cc.erp_code}
                                          onSelect={() => {
                                            atualizarRateio(b.tempId, r.tempId, {
                                              centro_custo_erp_code: cc.erp_code,
                                            });
                                            setCcPopoverOpenKey(null);
                                            setCcSearch("");
                                          }}
                                        >
                                          <div className="flex flex-col">
                                            <span className="font-medium text-sm">{cc.name}</span>
                                            <span className="text-xs text-muted-foreground font-mono">
                                              {cc.erp_code}
                                              {cc.department_type && ` · ${cc.department_type}`}
                                            </span>
                                          </div>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </div>

                          {/* % */}
                          <div className="w-20">
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={r.percentual}
                              onChange={(e) =>
                                atualizarRateio(b.tempId, r.tempId, {
                                  percentual: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="h-8 text-right text-xs"
                              placeholder="%"
                              disabled={status !== "idle"}
                            />
                          </div>

                          {/* Valor EUR calculado */}
                          <div className="w-24 h-8 px-2 flex items-center justify-end rounded-md border border-input bg-muted/30 text-[11px] font-mono">
                            {r.valor_eur > 0 ? formatEUR(r.valor_eur) : "—"}
                          </div>

                          {/* Remover */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => removerRateio(b.tempId, r.tempId)}
                            disabled={b.rateios.length === 1 || status !== "idle"}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      );
                    })}

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => adicionarRateio(b.tempId)}
                        disabled={b.rateios.length >= MAX_RATEIOS_POR_BLOCO || status !== "idle"}
                        className="gap-1.5 text-xs h-7"
                      >
                        <Plus className="h-3 w-3" /> CC
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => dividirIgualmente(b.tempId)}
                        disabled={b.rateios.length < 2 || status !== "idle"}
                        className="gap-1.5 text-xs h-7"
                      >
                        Dividir igual
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <Button
            variant="outline"
            size="sm"
            onClick={adicionarBloco}
            disabled={blocos.length >= MAX_BLOCOS || status !== "idle"}
            className="w-full gap-1.5"
          >
            <Plus className="h-4 w-4" /> Adicionar Bloco
          </Button>
        </CardContent>
      </Card>

      {/* Erro */}
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
                Chave Alvo: <span className="font-mono">{resultado.chave_alvo}</span>
                {resultado.pdf_status && (
                  <>
                    {" · PDF: "}
                    {resultado.pdf_status.anexado_alvo ? "anexado ✓" : "falhou ✗"}
                  </>
                )}
                {" · Redirecionando..."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Botões */}
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

      {/* Progress flutuante */}
      {(status === "criando" || status === "emitindo") && (
        <Card className="border-primary/20 bg-primary/5 fixed bottom-4 right-4 z-50 w-80 shadow-lg">
          <CardContent className="flex items-center gap-3 p-4">
            <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">
                {status === "criando" ? "Criando rascunho..." : "Emitindo no Alvo + PDF..."}
              </p>
              <p className="text-xs text-muted-foreground">
                {status === "criando" ? "Salvando no banco do Hub" : "Pode levar até 10 segundos"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
