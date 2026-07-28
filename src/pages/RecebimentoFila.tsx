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
  Coins,
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
  estaConcluido,
  FAIXAS_DIAS,
  STATUS_CONCLUIDO,
  type FaixaDias,
  type LaudoFila,
} from "@/services/recebimentoService";
import { exportarFilaXLSX, type EscopoExport } from "@/services/recebimentoExport";

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

function formatBRL(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));
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

// ── Colunas congeladas (REC-1.6) ────────────────────────────────────────────
// Com "Todos" a tabela tem 14 colunas e precisa rolar. "Laudo" e "Produto"
// ficam presos à esquerda para a linha nunca perder identificação.
// Duas exigências que não dá para relaxar:
//   1. LARGURA EXPLÍCITA na 1ª coluna — o `left` da 2ª depende dela;
//   2. FUNDO OPACO nas duas — com fundo translúcido o conteúdo que rola
//      apareceria por baixo. Por isso o hover da linha usa `muted` opaco
//      (antes era `muted/30`), aplicado igual nas fixas e nas que rolam.
const L1 = "left-0 w-[116px] min-w-[116px]";
const L2 = "left-[116px] w-[240px] min-w-[240px] border-r border-border";
const TH_FIXA = "sticky z-20 bg-card";
const TD_FIXA = "sticky z-10 bg-card group-hover:bg-muted";

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

/** Valor do filtro de status que significa "sem filtrar". */
const STATUS_TODOS = "todos";

export default function RecebimentoFila() {
  const { isAdmin, loading: permLoading } = usePermissions();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Estado inicializado A PARTIR DA URL (filtro sobrevive ao F5) ──
  // O status é o ÚNICO controle de recorte (REC-1.5 removeu o toggle do topo,
  // que podia divergir deste dropdown). `?aba=concluidos` de links antigos
  // continua funcionando: cai em "Concluído".
  const [filtroStatus, setFiltroStatus] = useState(() => {
    const daUrl = searchParams.get("status");
    if (daUrl) return daUrl;
    return searchParams.get("aba") === "concluidos" ? STATUS_CONCLUIDO : "Emitido";
  });
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

  // ── O status escolhido comanda a tela inteira ──
  // Quais blocos de coluna/KPI fazem sentido no recorte atual:
  //   "Dias parado" só para quem AINDA espera;
  //   resultado/aprovada/reprovada/valor só para quem já foi inspecionado.
  const mostraPendentes = filtroStatus !== STATUS_CONCLUIDO;
  const mostraConcluidos = filtroStatus === STATUS_CONCLUIDO || filtroStatus === STATUS_TODOS;
  const mostraColunaStatus = filtroStatus === STATUS_TODOS;

  useEffect(() => {
    const next: Record<string, string> = {};
    if (filtroStatus !== "Emitido") next.status = filtroStatus;
    if (filtroProduto !== "todos") next.produto = filtroProduto;
    if (filtroNF !== "todas") next.nf = filtroNF;
    if (filtroFaixa !== "todas") next.faixa = filtroFaixa;
    const de = dateToParam(filtroDe);
    const ate = dateToParam(filtroAte);
    if (de) next.de = de;
    if (ate) next.ate = ate;
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroStatus, filtroProduto, filtroNF, filtroFaixa, filtroDe, filtroAte]);

  const { data: statusDisponiveis = [] } = useQuery({
    queryKey: ["rec_laudos_status"],
    queryFn: listarStatusDisponiveis,
    enabled: isAdmin,
  });

  const { data: resultado, isLoading } = useQuery({
    queryKey: ["rec_laudos_fila", filtroStatus],
    queryFn: () => listarLaudos({ status: filtroStatus }),
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
    filtroStatus !== "Emitido";

  const limparFiltros = () => {
    setFiltroProduto("todos");
    setFiltroNF("todas");
    setFiltroFaixa("todas");
    setFiltroDe(undefined);
    setFiltroAte(undefined);
    setFiltroStatus("Emitido");
  };

  // Exporta EXATAMENTE o que está na tela (todos os filtros já aplicados).
  // A tela não pagina no servidor: `laudos` já é o conjunto completo do filtro.
  const handleExportar = async () => {
    if (laudos.length === 0) return;
    const escopo: EscopoExport =
      filtroStatus === STATUS_CONCLUIDO ? "concluido" : filtroStatus === "Emitido" ? "emitido" : "todos";
    setExportando(true);
    try {
      const { arquivo, linhas } = await exportarFilaXLSX(laudos, escopo);
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

  // Colunas visíveis dependem do status escolhido (7 fixas + condicionais).
  const colSpanTabela =
    7 + (mostraPendentes ? 1 : 0) + (mostraColunaStatus ? 1 : 0) + (mostraConcluidos ? 5 : 0);

  const rotuloLotes =
    filtroStatus === STATUS_CONCLUIDO ? "Lotes concluídos" : filtroStatus === STATUS_TODOS ? "Lotes" : "Lotes aguardando";

  return (
    // ⚠ `grid grid-cols-1` NÃO é decoração: a coluna é `minmax(0, 1fr)`, o que
    // impede o conteúdo largo (a tabela) de inflar a página. Sem isso a largura
    // da tabela sobe a cadeia, estica o <main> do AppLayout além da viewport e
    // a barra de rolagem passa a ser DA PÁGINA — arrastando KPIs e filtros para
    // fora da tela (era exatamente o defeito da REC-1.6, medido em navegador).
    // `gap-6` reproduz o espaçamento do antigo `space-y-6`.
    <div className="grid grid-cols-1 gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Fila de Inspeção</h1>
        <p className="text-sm text-muted-foreground">
          Recebimento por lote: o que aguarda liberação da Qualidade — material já na empresa e ainda fora do estoque — e
          o que já foi inspecionado.
        </p>
      </div>

      {/* KPIs — refletem o status escolhido no filtro. Uma grade só para os
          três recortes (4, 5 ou 6 cards): no máximo 4 por linha, quebrando o
          resto. Duas linhas de cards legíveis valem mais que seis espremidos. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <KpiCard
          icon={<Boxes className="h-4 w-4" />}
          label={rotuloLotes}
          valor={formatQtd(kpis.lotes)}
          sub={
            filtroStatus === STATUS_TODOS
              ? `${formatQtd(kpis.pendentes)} aguardando · ${formatQtd(kpis.concluidos)} concluídos`
              : undefined
          }
        />
        <KpiCard icon={<PackageSearch className="h-4 w-4" />} label="Unidades" valor={formatQtd(kpis.unidades)} />
        {mostraPendentes && (
          <KpiCard
            icon={<Clock className="h-4 w-4" />}
            label="Lote mais antigo"
            valor={kpis.diasMaisAntigo !== null ? `${kpis.diasMaisAntigo} dias` : "—"}
            destaque={faixaDe(kpis.diasMaisAntigo) === "acima45"}
          />
        )}
        {mostraConcluidos && (
          <KpiCard
            icon={<Clock className="h-4 w-4" />}
            label="Tempo médio"
            title="Tempo médio de inspeção: data do resultado − data de emissão"
            valor={kpis.tempoMedioInspecao !== null ? `${kpis.tempoMedioInspecao} dias` : "—"}
          />
        )}
        <KpiCard icon={<FileText className="h-4 w-4" />} label="Notas fiscais" valor={formatQtd(kpis.nfs)} />
        {mostraConcluidos && (
          <KpiCard
            icon={<Coins className="h-4 w-4" />}
            label="Valor reprovado"
            valor={formatBRL(kpis.valorReprovado)}
            destaque={kpis.valorReprovado > 0}
          />
        )}
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

      {/* Filtros — grade que QUEBRA EM LINHAS (antes era flex e o último
          controle vazava do card). Em 2 e em 3 colunas os dois date pickers
          caem juntos na mesma linha; em 6, tudo cabe numa fileira só. */}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Único controle de recorte da tela (REC-1.5). Opções vêm do que
                existe no espelho — "Todos" permite ver fila e concluídos juntos. */}
            <div className="min-w-0">
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
                  <SelectItem value={STATUS_TODOS}>Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0">
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

            <div className="min-w-0">
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

            <div className="min-w-0">
              <label className="mb-1 block truncate text-xs font-medium text-muted-foreground">
                {mostraPendentes ? "Dias parado" : "Dias desde a emissão"}
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

            {/* Período por data de emissão — De e Até independentes. Ficam
                lado a lado em 2, 3 e 6 colunas (só se separam no layout de
                1 coluna, onde nada cabe lado a lado). */}
            <div className="min-w-0">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Emissão de</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start overflow-hidden text-left font-normal",
                      !filtroDe && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {filtroDe ? format(filtroDe, "dd/MM/yyyy", { locale: ptBR }) : "Data inicial"}
                    </span>
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

            <div className="min-w-0">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Emissão até</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start overflow-hidden text-left font-normal",
                      !filtroAte && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="truncate">
                      {filtroAte ? format(filtroAte, "dd/MM/yyyy", { locale: ptBR }) : "Data final"}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
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
          </div>

          {/* Ações em linha própria — não disputam espaço com os filtros. */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {temFiltroAtivo && (
              <Button
                variant="ghost"
                size="sm"
                onClick={limparFiltros}
                className="mr-auto text-muted-foreground"
              >
                <X className="mr-1 h-3 w-3" /> Limpar filtros
              </Button>
            )}
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
            {/* `w-0 min-w-full` no CONTAINER DE ROLAGEM é o que prende a
                rolagem aqui dentro: a largura intrínseca vira 0 e deixa de
                subir a cadeia até o <main>, mas o `min-w-full` mantém o
                container ocupando 100% da largura disponível. Medido em
                navegador: sem isso, este container era esticado até caber a
                tabela inteira e quem rolava era a página. */}
            <div className="w-0 min-w-full overflow-x-auto">
              {/* w-max + min-w-full: a tabela ocupa a largura toda quando cabe
                  e CRESCE quando não cabe (rolando), em vez de espremer as 14
                  colunas até ficarem ilegíveis. */}
              <table className="w-max min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className={`${TH_FIXA} ${L1} px-4 py-3 font-medium`}>Laudo</th>
                    <th className={`${TH_FIXA} ${L2} px-4 py-3 font-medium`}>Produto</th>
                    <th className="px-4 py-3 font-medium">Lote</th>
                    <th className="px-4 py-3 text-right font-medium">Qtd</th>
                    <th className="px-4 py-3 font-medium">Un</th>
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Emissão</th>
                    {mostraPendentes && (
                      <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Dias parado</th>
                    )}
                    <th className="whitespace-nowrap px-4 py-3 font-medium">Validade do lote</th>
                    {mostraColunaStatus && <th className="px-4 py-3 font-medium">Status</th>}
                    {mostraConcluidos && (
                      <>
                        <th className="px-4 py-3 font-medium">Resultado</th>
                        <th className="px-4 py-3 text-right font-medium">Aprovada</th>
                        <th className="px-4 py-3 text-right font-medium">Reprovada</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right font-medium">Valor reprovado</th>
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
                          <td colSpan={colSpanTabela} className="p-0">
                            {/* O cabeçalho do grupo também acompanha a rolagem:
                                o conteúdo é sticky dentro da célula larga. Aqui
                                não há transparência a resolver — o fundo da
                                linha é uniforme em toda a largura. */}
                            <div className="sticky left-0 flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
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
                              {mostraPendentes && g.diasMaisAntigo !== null && (
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
                              className="group border-b last:border-b-0 transition-colors hover:bg-muted"
                            >
                              <td className={`${TD_FIXA} ${L1} px-4 py-3 font-mono text-xs tabular-nums`}>
                                {l.numero}
                              </td>
                              <td className={`${TD_FIXA} ${L2} px-4 py-3`}>
                                <span className="block truncate font-mono text-xs text-muted-foreground">
                                  {l.codigo_produto || "—"}
                                </span>
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

                              {/* Dias parado: só mede quem AINDA espera. Um laudo
                                  concluído aparece vazio quando o recorte é "Todos". */}
                              {mostraPendentes && (
                                <td className="whitespace-nowrap px-4 py-3 text-right">
                                  {estaConcluido(l) || l.dias_parado === null ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <Badge variant="outline" className={`${classeDias(l.dias_parado)} tabular-nums`}>
                                      {l.dias_parado}
                                    </Badge>
                                  )}
                                </td>
                              )}

                              <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                                {formatData(l.data_validade_ctrl_lote)}
                              </td>

                              {mostraColunaStatus && (
                                <td className="whitespace-nowrap px-4 py-3">
                                  <Badge variant="outline" className="border-border bg-transparent text-foreground">
                                    {l.status || "—"}
                                  </Badge>
                                </td>
                              )}

                              {/* Desfecho da inspeção: vazio enquanto o laudo não
                                  foi concluído (não há resultado a mostrar). */}
                              {mostraConcluidos &&
                                (estaConcluido(l) ? (
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
                                      {l.valor_reprovado ? (
                                        <span className="text-red-700 dark:text-red-400">
                                          {formatBRL(l.valor_reprovado)}
                                        </span>
                                      ) : (
                                        formatBRL(l.valor_reprovado)
                                      )}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                                      {l.dias_inspecao === null ? "—" : `${l.dias_inspecao} d`}
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    <td className="px-4 py-3 text-muted-foreground">—</td>
                                    <td className="px-4 py-3 text-right text-muted-foreground">—</td>
                                    <td className="px-4 py-3 text-right text-muted-foreground">—</td>
                                    <td className="px-4 py-3 text-right text-muted-foreground">—</td>
                                    <td className="px-4 py-3 text-right text-muted-foreground">—</td>
                                  </>
                                ))}
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
  sub,
  title,
  destaque = false,
}: {
  icon: React.ReactNode;
  label: string;
  valor: string;
  sub?: string;
  /** Texto completo quando o rótulo é abreviado (ex.: "Tempo médio"). */
  title?: string;
  destaque?: boolean;
}) {
  return (
    // min-w-0 em toda a cadeia: sem isso o item de grid assume a largura do
    // conteúdo (min-width:auto) e um rótulo longo empurra o card para fora
    // da viewport em vez de quebrar linha.
    <Card className="min-w-0" title={title}>
      <CardContent className="min-w-0 p-4">
        <div className="flex min-w-0 items-start gap-2 text-xs font-medium uppercase text-muted-foreground">
          <span className="mt-0.5 shrink-0">{icon}</span>
          <span className="min-w-0 break-words">{label}</span>
        </div>
        <p
          className={`mt-2 break-words text-2xl font-semibold tabular-nums ${
            destaque ? "text-red-700 dark:text-red-400" : "text-foreground"
          }`}
        >
          {valor}
        </p>
        {sub && <p className="mt-1 break-words text-xs tabular-nums text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
