/**
 * Fila de Inspeção (REC-1.1) — SOMENTE LEITURA, admin-only.
 *
 * Mostra o material que já está fisicamente na empresa mas ainda não virou
 * saldo em estoque: laudos com status "Emitido" no ERP Alvo. Esse estoque é
 * invisível em qualquer outra tela — no Alvo ele não tem saldo, e no Hub não
 * existia até aqui (ver PLANO-OP.md §6.3).
 *
 * Fonte: `rec_laudos`, espelho preenchido só pela Edge Function `sync-laudos`.
 * Nenhuma coluna é editada por esta tela. O gate real é a RLS (`_is_admin()`);
 * o `isAdmin` abaixo evita mostrar tela vazia sem explicação.
 *
 * Cor só para exceção (Bloomberg-calm): até 15 dias parado não recebe cor;
 * 16–45 é âmbar; acima de 45 é vermelho.
 */

import { Fragment, useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { usePermissions } from "@/hooks/usePermissions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ShieldX,
  Loader2,
  PackageSearch,
  Boxes,
  Clock,
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Calendar as CalendarIcon,
  Download,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  listarLaudos,
  listarStatusDisponiveis,
  calcularKpis,
  agruparPorNF,
  faixaDe,
  FAIXAS_DIAS,
  type FaixaDias,
  type LaudoFila,
} from "@/services/recebimentoService";
import { exportarFilaXLSX } from "@/services/recebimentoExport";

// ════════════════════════════════════════════════════════════
// FORMATADORES
// ════════════════════════════════════════════════════════════

/**
 * Datas para exibição (dd/MM/yyyy).
 * Colunas `date` chegam como "YYYY-MM-DD" pura: parseamos com componentes
 * LOCAIS para a data não "voltar" um dia no fuso de Brasília. Timestamps
 * completos (com fuso) vão pelo new Date() normal.
 */
function formatData(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [ano, mes, dia] = iso.split("-").map(Number);
      return format(new Date(ano, mes - 1, dia), "dd/MM/yyyy", { locale: ptBR });
    }
    return format(new Date(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return "—";
  }
}

function formatDataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  } catch {
    return "—";
  }
}

function formatQtd(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(Number(v));
}

// Datas viajam na URL como "YYYY-MM-DD" (sem fuso). Parse e serialização por
// componentes LOCAIS, para o dia não escorregar — mesmo cuidado do formatData
// e do padrão já usado em SuprimentosPedidos.
function dateToParam(d: Date | undefined): string | undefined {
  if (!d) return undefined;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function paramToDate(s: string | null): Date | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  const [, ano, mes, dia] = m;
  return new Date(Number(ano), Number(mes) - 1, Number(dia)); // local, sem UTC
}

/** Classe do badge de "dias parado". Sem cor até 15 dias — o normal não grita. */
function classeDias(dias: number | null): string {
  const f = faixaDe(dias);
  if (f === "acima45") return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
  if (f === "de16a45") return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
  return "bg-transparent text-foreground border-border";
}

// ════════════════════════════════════════════════════════════
// PÁGINA
// ════════════════════════════════════════════════════════════

type Aba = "fila" | "concluidos";

export default function RecebimentoFila() {
  const { isAdmin, loading: permLoading } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Estado inicializado A PARTIR DA URL (filtro sobrevive ao F5) ──
  const [aba, setAba] = useState<Aba>(() => (searchParams.get("aba") === "concluidos" ? "concluidos" : "fila"));
  const [filtroStatus, setFiltroStatus] = useState(() => searchParams.get("status") || "Emitido");
  const [filtroProduto, setFiltroProduto] = useState(() => searchParams.get("produto") || "todos");
  const [filtroNF, setFiltroNF] = useState(() => searchParams.get("nf") || "todas");
  const [filtroFaixa, setFiltroFaixa] = useState<FaixaDias>(
    () => (searchParams.get("faixa") as FaixaDias) || "todas",
  );
  // Período por data de emissão. Independentes: só De, só Até, ou os dois.
  // Sem default — a tela abre mostrando tudo.
  const [filtroDe, setFiltroDe] = useState<Date | undefined>(() => paramToDate(searchParams.get("de")));
  const [filtroAte, setFiltroAte] = useState<Date | undefined>(() => paramToDate(searchParams.get("ate")));
  const [gruposFechados, setGruposFechados] = useState<Set<string>>(new Set());
  const [exportando, setExportando] = useState(false);

  // Status efetivo da consulta: a aba "Concluídos" fixa o escopo.
  const statusConsulta = aba === "concluidos" ? "Concluído" : filtroStatus;

  useEffect(() => {
    const next: Record<string, string> = {};
    if (aba !== "fila") next.aba = aba;
    if (aba === "fila" && filtroStatus !== "Emitido") next.status = filtroStatus;
    if (filtroProduto !== "todos") next.produto = filtroProduto;
    if (filtroNF !== "todas") next.nf = filtroNF;
    if (filtroFaixa !== "todas") next.faixa = filtroFaixa;
    const de = dateToParam(filtroDe);
    const ate = dateToParam(filtroAte);
    if (de) next.de = de;
    if (ate) next.ate = ate;
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, filtroStatus, filtroProduto, filtroNF, filtroFaixa, filtroDe, filtroAte]);

  const { data: statusDisponiveis = [] } = useQuery({
    queryKey: ["rec_laudos_status"],
    queryFn: listarStatusDisponiveis,
    enabled: isAdmin,
  });

  const { data: resultado, isLoading } = useQuery({
    queryKey: ["rec_laudos_fila", statusConsulta],
    queryFn: () => listarLaudos({ status: statusConsulta }),
    enabled: isAdmin,
  });

  const todos = useMemo(() => resultado?.laudos || [], [resultado]);

  // Opções dos filtros derivadas do conjunto carregado (nunca chutadas).
  const opcoesProduto = useMemo(() => {
    const m = new Map<string, string>();
    todos.forEach((l) => {
      if (l.codigo_produto) m.set(l.codigo_produto, l.produto_nome || l.codigo_produto);
    });
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [todos]);

  const opcoesNF = useMemo(() => {
    const s = new Set<string>();
    todos.forEach((l) => {
      if (l.numero_documento) s.add(l.numero_documento);
    });
    return Array.from(s).sort();
  }, [todos]);

  // ── Filtros client-side (o conjunto inteiro já está em memória) ──
  // Período: comparamos INSTANTES — início do dia "De" e fim do dia "Até",
  // ambos no fuso local, para o limite não cortar meio dia por engano.
  const limiteDe = useMemo(
    () => (filtroDe ? new Date(filtroDe.getFullYear(), filtroDe.getMonth(), filtroDe.getDate()).getTime() : null),
    [filtroDe],
  );
  const limiteAte = useMemo(
    () =>
      filtroAte
        ? new Date(filtroAte.getFullYear(), filtroAte.getMonth(), filtroAte.getDate(), 23, 59, 59, 999).getTime()
        : null,
    [filtroAte],
  );

  const laudos = useMemo(() => {
    return todos.filter((l: LaudoFila) => {
      if (filtroProduto !== "todos" && l.codigo_produto !== filtroProduto) return false;
      if (filtroNF !== "todas" && l.numero_documento !== filtroNF) return false;
      if (filtroFaixa !== "todas" && faixaDe(l.dias_parado) !== filtroFaixa) return false;
      if (limiteDe !== null || limiteAte !== null) {
        // Sem data de emissão o laudo não pertence a período nenhum.
        if (!l.data_emissao) return false;
        const t = new Date(l.data_emissao).getTime();
        if (Number.isNaN(t)) return false;
        if (limiteDe !== null && t < limiteDe) return false;
        if (limiteAte !== null && t > limiteAte) return false;
      }
      return true;
    });
  }, [todos, filtroProduto, filtroNF, filtroFaixa, limiteDe, limiteAte]);

  const kpis = useMemo(() => calcularKpis(laudos), [laudos]);
  const grupos = useMemo(() => agruparPorNF(laudos), [laudos]);

  const temFiltroAtivo =
    filtroProduto !== "todos" ||
    filtroNF !== "todas" ||
    filtroFaixa !== "todas" ||
    !!filtroDe ||
    !!filtroAte ||
    (aba === "fila" && filtroStatus !== "Emitido");

  const limparFiltros = () => {
    setFiltroProduto("todos");
    setFiltroNF("todas");
    setFiltroFaixa("todas");
    setFiltroDe(undefined);
    setFiltroAte(undefined);
    if (aba === "fila") setFiltroStatus("Emitido");
  };

  // Exporta EXATAMENTE o que está na tela (todos os filtros já aplicados).
  // A tela não pagina no servidor: `laudos` já é o conjunto completo do filtro.
  const handleExportar = async () => {
    if (laudos.length === 0) return;
    setExportando(true);
    try {
      const { arquivo, linhas } = await exportarFilaXLSX(laudos, aba);
      toast.success(`${linhas} linha(s) exportada(s)`, { description: arquivo });
    } catch (err: any) {
      console.error("[fila-inspecao] falha ao exportar:", err);
      toast.error("Não foi possível gerar a planilha", { description: err?.message || String(err) });
    } finally {
      setExportando(false);
    }
  };

  const alternarGrupo = (nf: string) => {
    setGruposFechados((prev) => {
      const s = new Set(prev);
      if (s.has(nf)) s.delete(nf);
      else s.add(nf);
      return s;
    });
  };

  // Tempo médio de inspeção — só faz sentido na aba de concluídos.
  const tempoMedioInspecao = useMemo(() => {
    const vals = laudos.map((l) => l.dias_inspecao).filter((d): d is number => d !== null);
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }, [laudos]);

  if (permLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <ShieldX className="h-16 w-16" />
        <h2 className="text-xl font-semibold text-foreground">Acesso Restrito</h2>
        <p>Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  const colSpanTabela = aba === "fila" ? 8 : 10;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Fila de Inspeção</h1>
          <p className="text-sm text-muted-foreground">
            Material recebido que aguarda liberação da Qualidade — já está na empresa, ainda não é saldo em estoque.
          </p>
        </div>
        <Tabs value={aba} onValueChange={(v) => setAba(v as Aba)}>
          <TabsList>
            <TabsTrigger value="fila">Aguardando liberação</TabsTrigger>
            <TabsTrigger value="concluidos">Concluídos</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Boxes className="h-4 w-4" />}
          label={aba === "fila" ? "Lotes aguardando" : "Lotes concluídos"}
          valor={formatQtd(kpis.lotes)}
        />
        <KpiCard
          icon={<PackageSearch className="h-4 w-4" />}
          label="Unidades"
          valor={formatQtd(kpis.unidades)}
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          label={aba === "fila" ? "Lote mais antigo" : "Tempo médio de inspeção"}
          valor={
            aba === "fila"
              ? kpis.diasMaisAntigo !== null
                ? `${kpis.diasMaisAntigo} dias`
                : "—"
              : tempoMedioInspecao !== null
                ? `${tempoMedioInspecao} dias`
                : "—"
          }
          destaque={aba === "fila" && faixaDe(kpis.diasMaisAntigo) === "acima45"}
        />
        <KpiCard icon={<FileText className="h-4 w-4" />} label="Notas fiscais" valor={formatQtd(kpis.nfs)} />
      </div>

      {/* Avisos de integridade — nunca esconder o que ficou de fora */}
      {resultado?.truncado && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-foreground">
            A leitura atingiu o teto de segurança da tela. Alguns laudos podem não estar listados — avise o time do Hub.
          </span>
        </div>
      )}
      {kpis.semLote > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="tabular-nums text-foreground">{kpis.semLote}</span> laudo(s) ainda sem o número do lote — a
            sincronização detalha em lotes de 100 por execução e completa nas próximas rodadas.
          </span>
        </div>
      )}

      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          {aba === "fila" && (
            <div className="min-w-[170px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Emitido">Emitido</SelectItem>
                  {statusDisponiveis
                    .filter((s) => s !== "Emitido")
                    .map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  <SelectItem value="todos">Todos os status</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="min-w-[280px] flex-1 max-w-md">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Produto</label>
            <Select value={filtroProduto} onValueChange={setFiltroProduto}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {opcoesProduto.map(([codigo, nome]) => (
                  <SelectItem key={codigo} value={codigo}>
                    <span className="font-mono text-xs">{codigo}</span> · {nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Nota fiscal</label>
            <Select value={filtroNF} onValueChange={setFiltroNF}>
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                {opcoesNF.map((nf) => (
                  <SelectItem key={nf} value={nf}>
                    {nf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[170px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {aba === "fila" ? "Dias parado" : "Dias desde a emissão"}
            </label>
            <Select value={filtroFaixa} onValueChange={(v) => setFiltroFaixa(v as FaixaDias)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FAIXAS_DIAS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Período por data de emissão — De e Até independentes. */}
          <div className="min-w-[150px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Emissão de</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !filtroDe && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filtroDe ? format(filtroDe, "dd/MM/yyyy", { locale: ptBR }) : "Data inicial"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={filtroDe}
                  onSelect={setFiltroDe}
                  disabled={(d) => (filtroAte ? d > filtroAte : false)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
                {filtroDe && (
                  <div className="border-t border-border p-2">
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => setFiltroDe(undefined)}>
                      <X className="mr-1 h-3 w-3" /> Limpar
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div className="min-w-[150px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Emissão até</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !filtroAte && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {filtroAte ? format(filtroAte, "dd/MM/yyyy", { locale: ptBR }) : "Data final"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={filtroAte}
                  onSelect={setFiltroAte}
                  disabled={(d) => (filtroDe ? d < filtroDe : false)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
                {filtroAte && (
                  <div className="border-t border-border p-2">
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => setFiltroAte(undefined)}>
                      <X className="mr-1 h-3 w-3" /> Limpar
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          {temFiltroAtivo && (
            <Button variant="ghost" size="sm" onClick={limparFiltros} className="text-muted-foreground">
              <X className="mr-1 h-3 w-3" /> Limpar filtros
            </Button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {grupos.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() =>
                  setGruposFechados((prev) => (prev.size > 0 ? new Set() : new Set(grupos.map((g) => g.nf))))
                }
              >
                {gruposFechados.size > 0 ? "Expandir todas" : "Recolher todas"}
              </Button>
            )}
            {/* Exporta o conjunto filtrado inteiro — não só o que está visível. */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportar}
              disabled={exportando || laudos.length === 0}
              title="Exporta em .xlsx exatamente o conjunto filtrado, uma linha por laudo"
            >
              {exportando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
              {exportando ? "Gerando…" : "Exportar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabela agrupada por NF */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : laudos.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border">
          <Card className="max-w-md border-0 bg-transparent text-center shadow-none">
            <CardContent className="flex flex-col items-center gap-4 pt-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <PackageSearch className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {temFiltroAtivo ? "Nenhum laudo com os filtros aplicados" : "Nenhum laudo neste status"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {temFiltroAtivo
                    ? "Ajuste os filtros para ver mais resultados."
                    : "Os laudos aparecem aqui após a sincronização com o ERP."}
                </p>
              </div>
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
                    <th className="px-4 py-3 font-medium">Laudo</th>
                    <th className="px-4 py-3 font-medium">Produto</th>
                    <th className="px-4 py-3 font-medium">Lote</th>
                    <th className="px-4 py-3 text-right font-medium">Qtd</th>
                    <th className="px-4 py-3 font-medium">Un</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Emissão</th>
                    {aba === "fila" ? (
                      <>
                        <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Dias parado</th>
                        <th className="whitespace-nowrap px-4 py-3 font-medium">Validade do lote</th>
                      </>
                    ) : (
                      <>
                        <th className="px-4 py-3 font-medium">Resultado</th>
                        <th className="px-4 py-3 text-right font-medium">Aprovada</th>
                        <th className="px-4 py-3 text-right font-medium">Reprovada</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Inspeção</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((g) => {
                    const fechado = gruposFechados.has(g.nf);
                    return (
                      <Fragment key={g.nf}>
                        <tr
                          className="cursor-pointer border-b bg-muted/40 transition-colors hover:bg-muted/60"
                          onClick={() => alternarGrupo(g.nf)}
                        >
                          <td colSpan={colSpanTabela} className="px-4 py-2.5">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              {fechado ? (
                                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span className="text-xs font-medium uppercase text-muted-foreground">NF</span>
                              <span className="font-mono text-sm text-foreground">{g.nf}</span>
                              <span className="text-xs text-muted-foreground">
                                <span className="tabular-nums">{g.laudos.length}</span> lote(s) ·{" "}
                                <span className="tabular-nums">{formatQtd(g.unidades)}</span> un
                              </span>
                              {aba === "fila" && g.diasMaisAntigo !== null && (
                                <Badge variant="outline" className={`${classeDias(g.diasMaisAntigo)} tabular-nums`}>
                                  {g.diasMaisAntigo} dias
                                </Badge>
                              )}
                            </div>
                          </td>
                        </tr>

                        {!fechado &&
                          g.laudos.map((l) => (
                            <tr
                              key={`${l.codigo_empresa_filial}-${l.numero}`}
                              className="border-b last:border-b-0 transition-colors hover:bg-muted/30"
                            >
                              <td className="px-4 py-3 font-mono text-xs tabular-nums">{l.numero}</td>
                              <td className="max-w-[320px] px-4 py-3">
                                <span className="font-mono text-xs text-muted-foreground">{l.codigo_produto || "—"}</span>
                                <span className="line-clamp-1">{l.produto_nome || "—"}</span>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs">
                                {l.numero_ctrl_lote || (
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="cursor-help text-muted-foreground">—</span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-xs text-xs">
                                        O lote vem no detalhe do laudo, que a sincronização busca em lotes de 100 por
                                        execução. Ainda não chegou a este.
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                                {formatQtd(l.quantidade)}
                              </td>
                              <td className="px-4 py-3 text-xs text-muted-foreground">{l.produto_unidade || "—"}</td>
                              <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatData(l.data_emissao)}</td>

                              {aba === "fila" ? (
                                <>
                                  <td className="whitespace-nowrap px-4 py-3 text-right">
                                    {l.dias_parado === null ? (
                                      "—"
                                    ) : (
                                      <Badge variant="outline" className={`${classeDias(l.dias_parado)} tabular-nums`}>
                                        {l.dias_parado}
                                      </Badge>
                                    )}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                                    {formatData(l.data_validade_ctrl_lote)}
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="px-4 py-3">{l.resultado_analise || "—"}</td>
                                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                                    {formatQtd(l.quantidade_aprovada)}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                                    {l.quantidade_reprovada ? (
                                      <span className="text-red-700 dark:text-red-400">
                                        {formatQtd(l.quantidade_reprovada)}
                                      </span>
                                    ) : (
                                      formatQtd(l.quantidade_reprovada)
                                    )}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                                    {l.dias_inspecao === null ? "—" : `${l.dias_inspecao} d`}
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rodapé — de quando é o dado */}
      <p className="text-xs text-muted-foreground">
        {resultado?.sincronizadoEm
          ? `Atualizado em ${formatDataHora(resultado.sincronizadoEm)} · espelho do ERP Alvo (somente leitura)`
          : "Sem sincronização registrada ainda."}
      </p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// KPI
// ════════════════════════════════════════════════════════════

function KpiCard({
  icon,
  label,
  valor,
  destaque = false,
}: {
  icon: React.ReactNode;
  label: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
          {icon}
          {label}
        </div>
        <p
          className={`mt-2 text-2xl font-semibold tabular-nums ${
            destaque ? "text-red-700 dark:text-red-400" : "text-foreground"
          }`}
        >
          {valor}
        </p>
      </CardContent>
    </Card>
  );
}
