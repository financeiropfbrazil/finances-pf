/**
 * Rastreio de Compras — SOMENTE LEITURA. Admin ou papel `visualizador_rastreio`
 * (permissão `compras.rastreio.access`).
 *
 * Requisição → Pedido → NF de entrada → Confirmação no estoque (laudo) →
 * Pagamento da 1ª parcela (DocFin). Uma linha por PEDIDO × NF.
 *
 * Fonte: RPC `rastreio_compras_listar` (ver rastreioComprasService.ts). O gate
 * real é a RPC (admin ou `compras.rastreio.access`); o `hasAccess` abaixo só
 * evita tela vazia sem explicação. Abre no mês corrente; período DE/ATÉ com atalhos; paginação no
 * servidor (50 por página); "Exportar Excel" leva TODAS as linhas do filtro.
 *
 * Pedido sem NF ligada mostra, no quadro da NF, as NFs RECEBIDAS (Compras →
 * Notas Fiscais) e ainda não lançadas no Alvo que podem ser dele — sugestão
 * calculada no banco (`rastreio_nf_candidata`), não vínculo.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { DateRange } from "react-day-picker";
import {
  endOfMonth,
  endOfYear,
  format,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subYears,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowRight,
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  ExternalLink,
  FileSearch,
  FileText,
  Loader2,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldX,
  ShoppingCart,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  CAMPOS_DATA,
  ETAPAS_ORDEM,
  FILTRO_NF_CANDIDATA,
  atualizarDados,
  dataLocal,
  isoDia,
  listarRastreio,
  listarTudo,
  type CampoData,
  type FiltroRastreio,
  type LinhaRastreio,
  type NfCandidata,
} from "@/services/rastreioComprasService";
import { exportarRastreioXLSX } from "@/services/rastreioComprasExport";

const POR_PAGINA = 50;

// ════════════════════════════════════════════════════════════
// FORMATADORES
// ════════════════════════════════════════════════════════════
function fData(iso: string | null | undefined, padrao = "dd/MM/yyyy"): string {
  const d = dataLocal(iso);
  return d ? format(d, padrao, { locale: ptBR }) : "—";
}

function fMoeda(v: number | null | undefined, moeda: string | null = "BRL"): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda || "BRL" }).format(Number(v));
  } catch {
    return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

function fDias(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v} d`;
}

function useDebounce<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const id = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(id);
  }, [valor, ms]);
  return v;
}

// ════════════════════════════════════════════════════════════
// ETAPA
// ════════════════════════════════════════════════════════════
const ESTILO_ETAPA: Record<string, string> = {
  "Requisição em aprovação":
    "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300",
  "Requisição aprovada (não enviada ao Alvo)":
    "border-violet-300 bg-white text-violet-800 dark:border-violet-800 dark:bg-transparent dark:text-violet-300",
  "Aguardando pedido":
    "border-violet-300 bg-white text-violet-700 dark:border-violet-800 dark:bg-transparent dark:text-violet-300",
  "Requisição cancelada": "border-border bg-muted text-muted-foreground line-through",
  "Requisição rejeitada": "border-border bg-muted text-muted-foreground",
  "Pedido em aprovação": "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  "Aguardando NF": "border-slate-300 bg-white text-slate-700 dark:border-slate-700 dark:bg-transparent dark:text-slate-300",
  "Em inspeção (laudo)": "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  "Aguardando pagamento": "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "Adiantamento pago (sem NF)": "border-emerald-300 bg-white text-emerald-700 dark:border-emerald-800 dark:bg-transparent dark:text-emerald-300",
  "Pago (NF não ligada)": "border-emerald-300 bg-white text-emerald-700 dark:border-emerald-800 dark:bg-transparent dark:text-emerald-300",
  "Pago (1ª parcela)": "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  "Encerrado sem NF ligada": "border-border bg-muted text-muted-foreground",
  Cancelado: "border-border bg-muted text-muted-foreground line-through",
};

function EtapaBadge({ etapa }: { etapa: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap px-1.5 text-[11px] font-medium", ESTILO_ETAPA[etapa])}>
      {etapa}
    </Badge>
  );
}

const ordemEtapa = (e: string) => {
  const i = (ETAPAS_ORDEM as readonly string[]).indexOf(e);
  return i < 0 ? 99 : i;
};

// ════════════════════════════════════════════════════════════
// PERÍODO (DE / ATÉ)
// ════════════════════════════════════════════════════════════
interface Periodo {
  de: string | null;
  ate: string | null;
}

function atalhosPeriodo(): { label: string; periodo: Periodo }[] {
  const hoje = new Date();
  const mesAnt = subMonths(hoje, 1);
  const anoAnt = subYears(hoje, 1);
  return [
    { label: "Este mês", periodo: { de: isoDia(startOfMonth(hoje)), ate: isoDia(endOfMonth(hoje)) } },
    { label: "Mês anterior", periodo: { de: isoDia(startOfMonth(mesAnt)), ate: isoDia(endOfMonth(mesAnt)) } },
    { label: "Últimos 30 dias", periodo: { de: isoDia(subDays(hoje, 29)), ate: isoDia(hoje) } },
    { label: "Últimos 90 dias", periodo: { de: isoDia(subDays(hoje, 89)), ate: isoDia(hoje) } },
    { label: "Ano atual", periodo: { de: isoDia(startOfYear(hoje)), ate: isoDia(endOfYear(hoje)) } },
    { label: "Ano anterior", periodo: { de: isoDia(startOfYear(anoAnt)), ate: isoDia(endOfYear(anoAnt)) } },
    { label: "Todo o histórico", periodo: { de: null, ate: null } },
  ];
}

function rotuloPeriodo(p: Periodo): string {
  if (!p.de && !p.ate) return "Todo o histórico";
  const atalho = atalhosPeriodo().find((a) => a.periodo.de === p.de && a.periodo.ate === p.ate);
  const faixa = `${p.de ? fData(p.de) : "início"} – ${p.ate ? fData(p.ate) : "hoje"}`;
  return atalho ? `${atalho.label} · ${faixa}` : faixa;
}

function PeriodoPicker({ valor, onChange }: { valor: Periodo; onChange: (p: Periodo) => void }) {
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<DateRange | undefined>();

  useEffect(() => {
    if (aberto) {
      setRascunho({ from: dataLocal(valor.de) ?? undefined, to: dataLocal(valor.ate) ?? undefined });
    }
  }, [aberto, valor.de, valor.ate]);

  const aplicar = (p: Periodo) => {
    onChange(p);
    setAberto(false);
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 justify-start gap-2 font-normal">
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{rotuloPeriodo(valor)}</span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-row flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
            {atalhosPeriodo().map((a) => (
              <Button
                key={a.label}
                variant="ghost"
                size="sm"
                className={cn(
                  "justify-start font-normal",
                  a.periodo.de === valor.de && a.periodo.ate === valor.ate && "bg-accent font-medium",
                )}
                onClick={() => aplicar(a.periodo)}
              >
                {a.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-col">
            <CalendarComponent
              mode="range"
              numberOfMonths={2}
              locale={ptBR}
              selected={rascunho}
              onSelect={setRascunho}
              defaultMonth={rascunho?.from ?? subMonths(new Date(), 1)}
              initialFocus
            />
            <div className="flex items-center justify-between gap-2 border-t p-3">
              <span className="text-xs text-muted-foreground">
                {rascunho?.from ? fData(isoDia(rascunho.from)) : "DE"} – {rascunho?.to ? fData(isoDia(rascunho.to)) : "ATÉ"}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={!rascunho?.from}
                  onClick={() =>
                    rascunho?.from &&
                    aplicar({ de: isoDia(rascunho.from), ate: isoDia(rascunho.to ?? rascunho.from) })
                  }
                >
                  Aplicar
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ════════════════════════════════════════════════════════════
// LINHA EXPANDIDA — linha do tempo dos cinco elos
// ════════════════════════════════════════════════════════════
type Estado = "feito" | "pendente" | "na";

function Campo({ label, valor }: { label: string; valor: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{valor ?? "—"}</span>
    </div>
  );
}

function Passo({
  titulo,
  icone,
  estado,
  resumo,
  children,
}: {
  titulo: string;
  icone: ReactNode;
  estado: Estado;
  resumo: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-md border bg-background p-3",
        estado === "feito" && "border-l-4 border-l-emerald-500",
        estado === "pendente" && "border-l-4 border-l-amber-400",
        estado === "na" && "border-l-4 border-l-border",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icone}</span>
        <span className="text-sm font-semibold">{titulo}</span>
      </div>
      <span className="text-xs text-muted-foreground">{resumo}</span>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// NF CANDIDATA — recebida em Compras → Notas Fiscais, ainda fora do Alvo
// ════════════════════════════════════════════════════════════
const ESTILO_MOTIVO: Record<string, string> = {
  "Vinculada em Compras → NF": "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300",
  "Pedido citado na NF":
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  "Mesmo fornecedor e valor":
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

const ESTILO_CANDIDATA =
  "border-dashed border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300";

/** Abre Compras → Notas Fiscais no mês da emissão, já buscando o número. */
function linkNotasFiscais(c: NfCandidata): string {
  const q = new URLSearchParams();
  const emissao = dataLocal(c.data_emissao);
  if (emissao) {
    q.set("mes", String(emissao.getMonth() + 1));
    q.set("ano", String(emissao.getFullYear()));
  }
  if (c.nf_numero) q.set("busca", c.nf_numero.replace(/^0+(?=\d)/, ""));
  return `/compras/notas-fiscais?${q.toString()}`;
}

function rotuloBase(base: string | null): string {
  if (!base || base === "total") return "total da NF";
  if (base === "faturado") return "faturado (sem itens de retorno)";
  return base.replace(/^item: /, "item ");
}

function CandidataNf({ c, podeAbrirNf }: { c: NfCandidata; podeAbrirNf: boolean }) {
  const parcial = !!c.base && c.base !== "total";
  return (
    <div className="flex flex-col gap-1 rounded-md border border-dashed border-amber-300 bg-amber-50/50 p-2 dark:border-amber-800 dark:bg-amber-950/20">
      <span className="font-mono text-xs font-semibold">
        NF {c.nf_numero ?? "?"}
        {c.nf_serie ? <span className="font-normal text-muted-foreground"> · série {c.nf_serie}</span> : null}
      </span>
      <Badge
        variant="outline"
        className={cn("w-fit whitespace-nowrap px-1.5 py-0 text-[10px] font-medium", ESTILO_MOTIVO[c.motivo])}
      >
        {c.motivo}
      </Badge>
      <span className="truncate text-[11px] text-muted-foreground" title={c.emitente_nome ?? ""}>
        {c.emitente_nome ?? "—"}
      </span>
      <Campo label="Emissão" valor={fData(c.data_emissao)} />
      <Campo label="Recebida em" valor={fData(c.recebida_em)} />
      <Campo label="Valor da NF" valor={fMoeda(c.valor_total)} />
      {parcial && <Campo label="Valor que bateu" valor={fMoeda(c.valor_comparado)} />}
      {(c.diferenca_pct ?? 0) > 0 && (
        <Campo label="Diferença" valor={`${fMoeda(c.diferenca)} (${Number(c.diferenca_pct).toLocaleString("pt-BR")}%)`} />
      )}
      {parcial && (
        <span className="line-clamp-2 text-[11px] text-muted-foreground" title={c.base ?? ""}>
          Comparado com: {rotuloBase(c.base)}
        </span>
      )}
      {c.natureza && (
        <span className="truncate text-[11px] text-muted-foreground" title={c.natureza}>
          {c.natureza}
        </span>
      )}
      {c.outros_pedidos && c.outros_pedidos.length > 0 && (
        <span className="text-[11px] text-amber-800 dark:text-amber-300">
          Também sugerida para o{c.outros_pedidos.length > 1 ? "s pedidos" : " pedido"} {c.outros_pedidos.join(", ")}
        </span>
      )}
      {/* A tela de Notas Fiscais tem gate próprio (menu "compras"): sem ele, o
          link levaria a "Acesso Restrito". */}
      {podeAbrirNf && (
        <Link
          to={linkNotasFiscais(c)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          Abrir em Notas Fiscais
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

function Detalhe({ l, podeAbrirNf }: { l: LinhaRastreio; podeAbrirNf: boolean }) {
  const candidatas = l.nf_numero ? [] : (l.nf_candidatas ?? []);
  const estoqueEstado: Estado =
    l.laudo_qtd && l.laudo_qtd > 0
      ? (l.laudo_concluidos ?? 0) >= l.laudo_qtd
        ? "feito"
        : "pendente"
      : "na";
  const estoqueResumo =
    l.laudo_qtd && l.laudo_qtd > 0
      ? `${l.laudo_concluidos ?? 0} de ${l.laudo_qtd} laudo(s) concluído(s)`
      : l.pedido_natureza === "Serviço"
        ? "Não se aplica (serviço)"
        : l.nf_numero
          ? "Sem laudo para esta NF"
          : "Aguardando NF";

  const prazos: [string, number | null][] = [
    ["Req → Pedido", l.dias_req_pedido],
    ["Pedido → Aprovação", l.dias_pedido_aprovacao],
    ["Aprovação → NF", l.dias_aprovacao_nf],
    ["NF → Estoque", l.dias_nf_estoque],
    ["NF → Pagamento", l.dias_nf_pagamento],
    ["Ciclo total", l.dias_ciclo_total],
  ];

  return (
    <div className="flex flex-col gap-3 bg-muted/40 p-4">
      <div
        className={cn(
          "grid grid-cols-1 gap-3 md:grid-cols-2",
          // Com NF candidata o quadro da NF precisa de mais espaço (Estoque/Pagamento estão vazios)
          candidatas.length > 0
            ? "xl:grid-cols-[0.9fr_1fr_1.7fr_0.8fr_1fr]"
            : "xl:grid-cols-[1fr_1fr_1fr_0.85fr_1.3fr]",
        )}
      >
        <Passo
          titulo="Requisição"
          icone={<ClipboardList className="h-4 w-4" />}
          estado={l.req_numeros || !l.pedido_numero ? "feito" : "na"}
          resumo={
            l.req_numeros
              ? `Nº ${l.req_numeros}${l.req_status_alvo ? ` · ${l.req_status_alvo}` : ""}`
              : l.pedido_numero
                ? "Pedido sem requisição"
                : "Ainda sem número no Alvo"
          }
        >
          {l.req_descricao && (
            <span className="line-clamp-3 text-xs text-foreground" title={l.req_descricao}>
              {l.req_descricao}
            </span>
          )}
          <Campo label="Abertura" valor={fData(l.req_abertura)} />
          <Campo label="Requisitante" valor={l.req_requisitante} />
          <Campo label="CC" valor={l.req_cc_nome ?? l.req_cc_codigo} />
          <Campo label="Aprovação do líder" valor={fData(l.req_aprovacao_lider)} />
        </Passo>

        <Passo
          titulo="Pedido"
          icone={<ShoppingCart className="h-4 w-4" />}
          estado={l.pedido_aprovacao ? "feito" : "pendente"}
          resumo={l.pedido_numero ? `Nº ${l.pedido_numero} · ${l.pedido_status ?? "—"}` : "Nenhum pedido gerado"}
        >
          {l.pedido_numero ? (
            <>
              <Campo label="Data" valor={fData(l.pedido_data)} />
              <Campo label="Aprovação (Alvo)" valor={fData(l.pedido_aprovacao)} />
              <Campo label="Valor" valor={fMoeda(l.pedido_valor, l.pedido_moeda)} />
              <Campo label="Condição" valor={l.pedido_cond_pagamento} />
              <Campo label="CC" valor={l.pedido_cc_nome ?? l.pedido_cc} />
              <Campo label="Comprador" valor={l.pedido_comprador} />
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              {l.etapa === "Aguardando pedido"
                ? "Requisição no Alvo, aguardando o comprador gerar o pedido."
                : l.etapa === "Requisição cancelada" || l.etapa === "Requisição rejeitada"
                  ? "Requisição encerrada sem pedido."
                  : "A requisição ainda não chegou ao Alvo."}
            </span>
          )}
        </Passo>

        <Passo
          titulo="Nota fiscal"
          icone={<FileText className="h-4 w-4" />}
          estado={l.nf_numero ? "feito" : "pendente"}
          resumo={
            l.nf_numero
              ? `${l.nf_especie ?? "NF"} ${l.nf_numero}${(l.pedido_qtd_nfs ?? 0) > 1 ? ` · pedido tem ${l.pedido_qtd_nfs} NFs` : ""}`
              : "Nenhuma NF ligada ao pedido"
          }
        >
          {l.nf_numero ? (
            <>
              <Campo label="Emissão" valor={fData(l.nf_emissao)} />
              <Campo label="Entrada" valor={fData(l.nf_entrada)} />
              <Campo label="Valor da NF" valor={fMoeda(l.nf_valor_total)} />
              <Campo label="Deste pedido" valor={fMoeda(l.valor_pedido_na_nf)} />
              <Campo label="Fonte do vínculo" valor={l.fontes_vinculo} />
            </>
          ) : candidatas.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300">
                {candidatas.length === 1
                  ? "NF recebida e ainda não lançada no Alvo que pode ser deste pedido:"
                  : `${candidatas.length} NFs recebidas e ainda não lançadas no Alvo que podem ser deste pedido:`}
              </span>
              {candidatas.map((c) => (
                <CandidataNf key={c.nfe_id} c={c} podeAbrirNf={podeAbrirNf} />
              ))}
              <span className="text-[11px] leading-snug text-muted-foreground">
                Sugestão automática. Quando a NF for lançada no Alvo citando o pedido, o vínculo aparece aqui na próxima
                atualização.
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              {!l.pedido_numero
                ? "Sem pedido ainda."
                : l.etapa === "Cancelado"
                  ? "Pedido cancelado."
                  : "Nenhuma NF recebida em Compras → Notas Fiscais com o mesmo fornecedor e valor parecido."}
            </span>
          )}
        </Passo>

        <Passo titulo="Estoque" icone={<PackageCheck className="h-4 w-4" />} estado={estoqueEstado} resumo={estoqueResumo}>
          <Campo label="Laudo(s)" valor={l.laudo_numeros} />
          <Campo label="Confirmação" valor={fData(l.laudo_conclusao)} />
          <Campo label="Resultado" valor={l.laudo_resultado} />
        </Passo>

        <Passo
          titulo="Pagamento"
          icone={<Wallet className="h-4 w-4" />}
          estado={l.primeiro_pagamento ? "feito" : "pendente"}
          resumo={
            l.primeiro_pagamento
              ? `1º pagamento ${fData(l.primeiro_pagamento)} · ${l.primeiro_pagamento_origem}`
              : "Nenhum pagamento identificado"
          }
        >
          {l.tit_numero && (
            <>
              <Campo label="Título da NF" valor={`${l.tit_numero} (${l.tit_qtd_pagas ?? 0}/${l.tit_qtd_parcelas ?? 0} pagas)`} />
              <Campo label="Parc. 1 · vencimento" valor={fData(l.tit_p1_prorrogacao ?? l.tit_p1_vencimento)} />
              <Campo label="Parc. 1 · pago em" valor={fData(l.tit_p1_pagamento)} />
              <Campo label="Parc. 1 · valor pago" valor={fMoeda(l.tit_p1_valor_pago)} />
            </>
          )}
          {l.proj_p1_vencimento && (
            <>
              <Campo label="Projeção · vencimento" valor={fData(l.proj_p1_vencimento)} />
              <Campo label="Projeção · realizada" valor={fData(l.proj_p1_pagamento)} />
            </>
          )}
          {l.adto_situacao && (
            <Campo
              label="Adiantamento"
              valor={`${fMoeda(l.adto_valor)} · ${l.adto_pagamento ? `pago ${fData(l.adto_pagamento)}` : l.adto_situacao}`}
            />
          )}
          {!l.tit_numero && !l.proj_p1_vencimento && !l.adto_situacao && (
            <span className="text-xs text-muted-foreground">Sem título, projeção ou adiantamento no DocFin.</span>
          )}
        </Passo>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Prazos</span>
        {prazos.map(([rotulo, dias]) => (
          <Badge key={rotulo} variant="secondary" className="gap-1 font-normal">
            {rotulo}
            <span className="font-semibold">{fDias(dias)}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// PÁGINA
// ════════════════════════════════════════════════════════════
export default function SuprimentosRastreio() {
  const { hasAccess, loading: permLoading } = usePermissions();
  const podeVer = hasAccess("compras.rastreio.access");
  const podeAbrirNf = hasAccess("compras");
  const queryClient = useQueryClient();

  const [periodo, setPeriodo] = useState<Periodo>(() => atalhosPeriodo()[0].periodo);
  const [campoData, setCampoData] = useState<CampoData>("pedido");
  const [buscaDigitada, setBuscaDigitada] = useState("");
  const busca = useDebounce(buscaDigitada, 400);
  const [etapas, setEtapas] = useState<string[]>([]);
  const [pagina, setPagina] = useState(0);
  const [aberta, setAberta] = useState<string | null>(null);
  const [exportando, setExportando] = useState<{ carregadas: number; total: number } | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  // Largura visível da área de rolagem da tabela: o painel da linha aberta
  // usa essa largura (sticky) para não sair da tela quando a tabela rola.
  const [rolagemEl, setRolagemEl] = useState<HTMLDivElement | null>(null);
  const [larguraVisivel, setLarguraVisivel] = useState<number | null>(null);
  useEffect(() => {
    if (!rolagemEl) return;
    const medir = () => setLarguraVisivel(rolagemEl.clientWidth);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(rolagemEl);
    return () => ro.disconnect();
  }, [rolagemEl]);

  const filtro: FiltroRastreio = useMemo(
    () => ({ de: periodo.de, ate: periodo.ate, campoData, busca, etapas }),
    [periodo.de, periodo.ate, campoData, busca, etapas],
  );
  const chaveFiltro = JSON.stringify(filtro);

  // Filtro mudou → volta para a página 1 e recolhe a linha aberta.
  useEffect(() => {
    setPagina(0);
    setAberta(null);
  }, [chaveFiltro]);

  const consulta = useQuery({
    queryKey: ["rastreio-compras", chaveFiltro, pagina],
    queryFn: () => listarRastreio(filtro, POR_PAGINA, pagina * POR_PAGINA),
    enabled: podeVer,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const total = consulta.data?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const linhas = consulta.data?.linhas ?? [];
  const resumoEtapas = useMemo(
    () => [...(consulta.data?.etapas ?? [])].sort((a, b) => ordemEtapa(a.etapa) - ordemEtapa(b.etapa)),
    [consulta.data?.etapas],
  );
  const totalSemEtapa = resumoEtapas.reduce((s, e) => s + e.qtd, 0);
  const comNfCandidata = consulta.data?.com_nf_candidata ?? 0;
  const filtrandoCandidata = etapas.includes(FILTRO_NF_CANDIDATA);

  const alternarEtapa = (e: string) =>
    setEtapas((atual) => (atual.includes(e) ? atual.filter((x) => x !== e) : [...atual, e]));

  const handleAtualizar = async () => {
    setAtualizando(true);
    try {
      const quando = await atualizarDados();
      await queryClient.invalidateQueries({ queryKey: ["rastreio-compras"] });
      toast.success("Dados atualizados", {
        description: quando ? `Base recalculada às ${format(new Date(quando), "HH:mm")}` : undefined,
      });
    } catch (err: any) {
      toast.error("Não foi possível atualizar", { description: err?.message || String(err) });
    } finally {
      setAtualizando(false);
    }
  };

  const handleExportar = async () => {
    if (total === 0) {
      toast.info("Nada para exportar neste filtro");
      return;
    }
    setExportando({ carregadas: 0, total });
    try {
      const todas = await listarTudo(filtro, (carregadas, t) => setExportando({ carregadas, total: t }));
      const r = await exportarRastreioXLSX(todas, {
        de: filtro.de,
        ate: filtro.ate,
        campoData: filtro.campoData,
        busca: filtro.busca,
        etapas: filtro.etapas,
        atualizadoEm: consulta.data?.atualizado_em ?? null,
      });
      toast.success(`${r.linhas.toLocaleString("pt-BR")} linhas exportadas`, { description: r.arquivo });
    } catch (err: any) {
      console.error("[rastreio-compras] falha ao exportar:", err);
      toast.error("Não foi possível gerar a planilha", { description: err?.message || String(err) });
    } finally {
      setExportando(null);
    }
  };

  if (permLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!podeVer) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <ShieldX className="h-16 w-16" />
        <h2 className="text-xl font-semibold text-foreground">Acesso Restrito</h2>
        <p>Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  const de = total === 0 ? 0 : pagina * POR_PAGINA + 1;
  const ate = Math.min(total, (pagina + 1) * POR_PAGINA);

  return (
    // `grid grid-cols-1` impede a tabela larga de esticar a página (ver RecebimentoFila).
    <div className="grid grid-cols-1 gap-6 p-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Rastreio de Compras</h1>
          <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            Requisição <ArrowRight className="h-3 w-3" /> Pedido <ArrowRight className="h-3 w-3" /> NF{" "}
            <ArrowRight className="h-3 w-3" /> Estoque <ArrowRight className="h-3 w-3" /> Pagamento · uma linha por
            pedido × NF
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {consulta.data?.atualizado_em && (
            <span className="text-xs text-muted-foreground">
              Dados de {format(new Date(consulta.data.atualizado_em), "dd/MM 'às' HH:mm", { locale: ptBR })}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={handleAtualizar} disabled={atualizando || !!exportando}>
            <RefreshCw className={cn("mr-2 h-4 w-4", atualizando && "animate-spin")} />
            Atualizar dados
          </Button>
          <Button size="sm" onClick={handleExportar} disabled={!!exportando || consulta.isLoading || total === 0}>
            {exportando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {exportando.carregadas.toLocaleString("pt-BR")} / {exportando.total.toLocaleString("pt-BR")}
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Exportar Excel
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <PeriodoPicker valor={periodo} onChange={setPeriodo} />
            <Select value={campoData} onValueChange={(v) => setCampoData(v as CampoData)}>
              <SelectTrigger className="h-9 md:w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMPOS_DATA.map((c) => (
                  <SelectItem key={c.valor} value={c.valor}>
                    Por {c.label.toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={buscaDigitada}
                onChange={(e) => setBuscaDigitada(e.target.value)}
                placeholder="Pedido, NF, requisição (nº ou descrição), fornecedor ou requisitante"
                className="h-9 pl-8 pr-8"
              />
              {buscaDigitada && (
                <button
                  type="button"
                  aria-label="Limpar busca"
                  onClick={() => setBuscaDigitada("")}
                  className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Etapas (contagem ignora o próprio filtro de etapa) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant={etapas.length === 0 ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setEtapas([])}
            >
              Todas <span className="ml-1.5 tabular-nums text-muted-foreground">{totalSemEtapa.toLocaleString("pt-BR")}</span>
            </Button>
            {resumoEtapas.map((e) => {
              const ativa = etapas.includes(e.etapa);
              return (
                <button
                  key={e.etapa}
                  type="button"
                  onClick={() => alternarEtapa(e.etapa)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                    ativa ? ESTILO_ETAPA[e.etapa] : "border-transparent text-muted-foreground hover:bg-accent",
                    ativa && "ring-1 ring-offset-1 ring-ring/40",
                  )}
                >
                  {e.etapa}
                  <span className="tabular-nums font-semibold">{e.qtd.toLocaleString("pt-BR")}</span>
                </button>
              );
            })}
            {(comNfCandidata > 0 || filtrandoCandidata) && (
              <>
                <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                <button
                  type="button"
                  onClick={() => alternarEtapa(FILTRO_NF_CANDIDATA)}
                  title="Pedidos sem NF ligada que têm NF recebida em Compras → Notas Fiscais, ainda não lançada no Alvo"
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                    filtrandoCandidata
                      ? cn(ESTILO_CANDIDATA, "ring-1 ring-ring/40 ring-offset-1")
                      : "border-dashed border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40",
                  )}
                >
                  <FileSearch className="h-3 w-3" />
                  Com NF recebida não lançada
                  <span className="tabular-nums font-semibold">{comNfCandidata.toLocaleString("pt-BR")}</span>
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card className="overflow-hidden">
        {consulta.isError ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <AlertTriangle className="h-6 w-6 text-amber-500" />
            <span>Não foi possível carregar o relatório.</span>
            <span className="text-xs">{(consulta.error as Error)?.message}</span>
            <Button variant="outline" size="sm" onClick={() => consulta.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : (
          <TooltipProvider delayDuration={200}>
            <div ref={setRolagemEl} className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-7 px-2 py-2" />
                    <th className="px-2.5 py-2 text-left font-medium">Etapa</th>
                    <th className="px-2.5 py-2 text-left font-medium">Pedido · fornecedor</th>
                    <th className="px-2.5 py-2 text-left font-medium">Requisição</th>
                    <th className="px-2.5 py-2 text-left font-medium">NF</th>
                    <th className="px-2.5 py-2 text-left font-medium">Estoque</th>
                    <th className="px-2.5 py-2 text-left font-medium">1º pagamento</th>
                    <th className="px-2.5 py-2 text-right font-medium">Ciclo</th>
                  </tr>
                </thead>
                <tbody className={cn(consulta.isFetching && "opacity-60 transition-opacity")}>
                  {consulta.isLoading ? (
                    <tr>
                      <td colSpan={8} className="p-10 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                      </td>
                    </tr>
                  ) : linhas.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-10 text-center text-sm text-muted-foreground">
                        Nenhum pedido neste filtro.
                      </td>
                    </tr>
                  ) : (
                    linhas.map((l) => {
                      const id = l.linha_id ?? `${l.pedido_numero}-${l.chave_movestq ?? 0}`;
                      const expandida = aberta === id;
                      return (
                        <Fragment key={id}>
                          <tr
                            className={cn("cursor-pointer border-b align-top hover:bg-muted/40", expandida && "bg-muted/40")}
                            onClick={() => setAberta(expandida ? null : id)}
                          >
                            <td className="px-2 py-2.5 text-muted-foreground">
                              {expandida ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </td>
                            <td className="px-2.5 py-2">
                              <EtapaBadge etapa={l.etapa} />
                            </td>
                            <td className="px-2.5 py-2">
                              {l.pedido_numero ? (
                                <>
                                  <div className="flex min-w-0 items-baseline gap-2">
                                    <span className="font-mono font-medium">{l.pedido_numero}</span>
                                    <span className="max-w-[180px] truncate" title={l.pedido_fornecedor ?? ""}>
                                      {l.pedido_fornecedor ?? "—"}
                                    </span>
                                  </div>
                                  <div className="whitespace-nowrap text-xs text-muted-foreground">
                                    {fData(l.pedido_data, "dd/MM/yy")} · {fMoeda(l.pedido_valor, l.pedido_moeda)}
                                    {l.pedido_natureza ? ` · ${l.pedido_natureza}` : ""}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="text-xs italic text-muted-foreground">Sem pedido</div>
                                  <div
                                    className="max-w-[240px] truncate text-xs text-foreground"
                                    title={l.req_descricao ?? ""}
                                  >
                                    {l.req_descricao ?? "—"}
                                  </div>
                                </>
                              )}
                            </td>
                            <td className="px-2.5 py-2">
                              {l.req_numeros || l.req_abertura ? (
                                <>
                                  <div className={cn(l.req_numeros ? "font-mono" : "text-xs italic text-muted-foreground")}>
                                    {l.req_numeros ?? "sem nº (Hub)"}
                                  </div>
                                  <div
                                    className="max-w-[130px] truncate text-xs text-muted-foreground"
                                    title={l.req_requisitante ?? ""}
                                  >
                                    {fData(l.req_abertura, "dd/MM/yy")} · {l.req_requisitante ?? "—"}
                                  </div>
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-2.5 py-2">
                              {l.nf_numero ? (
                                <>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono">{l.nf_numero}</span>
                                    {(l.pedido_qtd_nfs ?? 0) > 1 && (
                                      <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">
                                        {l.pedido_qtd_nfs} NFs
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="whitespace-nowrap text-xs text-muted-foreground">
                                    {fData(l.nf_entrada, "dd/MM/yy")} · {fMoeda(l.valor_pedido_na_nf)}
                                  </div>
                                </>
                              ) : l.nf_candidatas && l.nf_candidatas.length > 0 ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex flex-col items-start gap-0.5">
                                      <span
                                        className={cn(
                                          "inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium",
                                          ESTILO_CANDIDATA,
                                        )}
                                      >
                                        <FileSearch className="h-3 w-3" />
                                        Recebida? {l.nf_candidatas[0].nf_numero}
                                        {l.nf_candidatas.length > 1 && (
                                          <span className="font-normal">+{l.nf_candidatas.length - 1}</span>
                                        )}
                                      </span>
                                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                                        {fData(l.nf_candidatas[0].data_emissao, "dd/MM/yy")} ·{" "}
                                        {fMoeda(l.nf_candidatas[0].valor_total)}
                                      </span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs text-xs">
                                    <div className="mb-1 font-medium">
                                      Recebida em Compras → Notas Fiscais, ainda não lançada no Alvo
                                    </div>
                                    {l.nf_candidatas.map((c) => (
                                      <div key={c.nfe_id}>
                                        NF {c.nf_numero} · {fMoeda(c.valor_total)} · {c.motivo}
                                      </div>
                                    ))}
                                    <div className="mt-1 text-muted-foreground">Abra a linha para ver os detalhes.</div>
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-2.5 py-2 text-xs">
                              {l.laudo_qtd && l.laudo_qtd > 0 ? (
                                (l.laudo_concluidos ?? 0) >= l.laudo_qtd ? (
                                  <>
                                    <div className="whitespace-nowrap text-sm">{fData(l.laudo_conclusao, "dd/MM/yy")}</div>
                                    <div className="text-muted-foreground">{l.laudo_resultado ?? "Concluído"}</div>
                                  </>
                                ) : (
                                  <span className="whitespace-nowrap text-sky-700 dark:text-sky-300">
                                    Em inspeção ({l.laudo_concluidos ?? 0}/{l.laudo_qtd})
                                  </span>
                                )
                              ) : (
                                <span className="text-muted-foreground">
                                  {l.pedido_natureza === "Serviço" ? "n/a" : "—"}
                                </span>
                              )}
                            </td>
                            <td className="px-2.5 py-2">
                              {l.primeiro_pagamento ? (
                                <>
                                  <div className="whitespace-nowrap">{fData(l.primeiro_pagamento, "dd/MM/yy")}</div>
                                  <div className="whitespace-nowrap text-xs text-muted-foreground">
                                    {l.primeiro_pagamento_origem}
                                  </div>
                                </>
                              ) : l.tit_p1_vencimento ? (
                                <div className="whitespace-nowrap text-xs text-muted-foreground">
                                  vence {fData(l.tit_p1_prorrogacao ?? l.tit_p1_vencimento, "dd/MM/yy")}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-2.5 py-2 text-right tabular-nums">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="whitespace-nowrap">{fDias(l.dias_ciclo_total)}</span>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="text-xs">
                                  <div>Req → Pedido: {fDias(l.dias_req_pedido)}</div>
                                  <div>Pedido → Aprovação: {fDias(l.dias_pedido_aprovacao)}</div>
                                  <div>Aprovação → NF: {fDias(l.dias_aprovacao_nf)}</div>
                                  <div>NF → Estoque: {fDias(l.dias_nf_estoque)}</div>
                                  <div>NF → Pagamento: {fDias(l.dias_nf_pagamento)}</div>
                                </TooltipContent>
                              </Tooltip>
                            </td>
                          </tr>
                          {expandida && (
                            <tr className="border-b">
                              <td colSpan={8} className="p-0">
                                {/* Preso à área visível: a tabela pode rolar na horizontal,
                                    o painel não — fica do tamanho da janela de rolagem. */}
                                <div
                                  className="sticky left-0"
                                  style={larguraVisivel ? { width: larguraVisivel } : undefined}
                                >
                                  <Detalhe l={l} podeAbrirNf={podeAbrirNf} />
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </TooltipProvider>
        )}

        {/* Paginação */}
        <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 text-sm sm:flex-row">
          <span className="text-muted-foreground">
            {total === 0
              ? "0 linhas"
              : `${de.toLocaleString("pt-BR")}–${ate.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} linhas`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagina === 0 || consulta.isFetching}
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <span className="tabular-nums text-muted-foreground">
              Página {pagina + 1} de {totalPaginas}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagina + 1 >= totalPaginas || consulta.isFetching}
              onClick={() => setPagina((p) => p + 1)}
            >
              Próxima
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
