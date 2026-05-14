/**
 * Lado 1 da Frente 3 — Lista de NFs disponíveis do MovEstq Alvo.
 *
 * Responsabilidades:
 *   - Filtros (data emissão server-side; espécie/status/busca server-side; classe/CC client-side).
 *   - Botão "Sincronizar do Alvo" com modal de período.
 *   - Renderiza NFs nos 4 modos (flat / single-classe / multi-classe / aguardando).
 *   - Tri-state checkbox em cada nível (NF, classe, sub-linha).
 *   - "Adicionar selecionados" com Promise.allSettled e toast de falhas parciais.
 *
 * Granularidade canônica: rateio_id (sub-linha da view).
 * Agrupamento por chave_movestq é puramente visual.
 *
 * Layout: 3 áreas verticais dentro do Card —
 *   1. Header de filtros (shrink-0, fixo no topo)
 *   2. Lista scrollável (flex-1, única área que scrolla)
 *   3. Rodapé com botão Adicionar (shrink-0, fixo no fundo)
 */

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, Loader2, Lock, RefreshCw, Search, X as XIcon, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useMovEstqDisponivel, useSyncMovEstq } from "@/hooks/useReembolsoNf";
import { addRateioToRascunho, friendlyErrorMessage } from "@/services/intercompanyReembolsoNfService";
import type { Especie, MovEstqDisponivel, MovEstqFiltros, StatusClassificacao } from "@/types/intercompanyReembolsoNf";
import { ESPECIES_DISPONIVEIS } from "@/types/intercompanyReembolsoNf";
import { useQueryClient } from "@tanstack/react-query";

// ═════════════════════════════════════════════════════════════
// Helpers de formatação
// ═════════════════════════════════════════════════════════════

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(2).replace(".", ",")}%`);

const formatDateBR = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

const formatDateTimeBR = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

/** Remove zeros à esquerda do número da NF pra exibição. "0000012677" → "12677". */
const formatNumeroDoc = (n: string) => n.replace(/^0+/, "") || "0";

const trintaDiasAtras = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
};

// ═════════════════════════════════════════════════════════════
// Lógica de agrupamento e modo de render
// ═════════════════════════════════════════════════════════════

type RenderMode = "flat" | "single-classe" | "multi-classe" | "aguardando";

interface GrupoNF {
  chave_movestq: number;
  itens: MovEstqDisponivel[];
  mode: RenderMode;
  todosRateioIds: string[];
}

function decideRenderMode(item: MovEstqDisponivel): RenderMode {
  if (item.status_classificacao === "aguardando_classificacao") return "aguardando";
  if (item.total_rateios_na_nf === 1) return "flat";
  if (item.total_classes_na_nf === 1) return "single-classe";
  return "multi-classe";
}

function agruparPorNF(itens: MovEstqDisponivel[]): GrupoNF[] {
  const map = new Map<number, MovEstqDisponivel[]>();
  for (const item of itens) {
    if (!map.has(item.chave_movestq)) map.set(item.chave_movestq, []);
    map.get(item.chave_movestq)!.push(item);
  }
  const grupos: GrupoNF[] = [];
  for (const [chave, items] of map.entries()) {
    const mode = decideRenderMode(items[0]);
    grupos.push({
      chave_movestq: chave,
      itens: items,
      mode,
      todosRateioIds: items.map((i) => i.rateio_id).filter((id): id is string => id !== null),
    });
  }
  const ordem = new Map<number, number>();
  itens.forEach((it, idx) => {
    if (!ordem.has(it.chave_movestq)) ordem.set(it.chave_movestq, idx);
  });
  grupos.sort((a, b) => ordem.get(a.chave_movestq)! - ordem.get(b.chave_movestq)!);
  return grupos;
}

function agruparPorClasse(itens: MovEstqDisponivel[]) {
  const map = new Map<string, MovEstqDisponivel[]>();
  for (const item of itens) {
    if (!item.codigo_classe) continue;
    if (!map.has(item.codigo_classe)) map.set(item.codigo_classe, []);
    map.get(item.codigo_classe)!.push(item);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([codigo, items]) => ({
      codigo_classe: codigo,
      nome_classe: items[0].nome_classe,
      subtotal: items.reduce((sum, i) => sum + (i.valor_rateio ?? 0), 0),
      rateios: items,
      ids: items.map((i) => i.rateio_id).filter((id): id is string => id !== null),
    }));
}

// ═════════════════════════════════════════════════════════════
// Tri-state helpers
// ═════════════════════════════════════════════════════════════

type CheckState = boolean | "indeterminate";

function getHeaderState(selected: Set<string>, ids: string[]): CheckState {
  if (ids.length === 0) return false;
  const count = ids.filter((id) => selected.has(id)).length;
  if (count === 0) return false;
  if (count === ids.length) return true;
  return "indeterminate";
}

function toggleAll(selected: Set<string>, ids: string[], shouldCheck: boolean): Set<string> {
  const next = new Set(selected);
  if (shouldCheck) ids.forEach((id) => next.add(id));
  else ids.forEach((id) => next.delete(id));
  return next;
}

// ═════════════════════════════════════════════════════════════
// Componente principal
// ═════════════════════════════════════════════════════════════

interface Lado1Props {
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function Lado1Disponiveis({ selectedIds, setSelectedIds }: Lado1Props) {
  const qc = useQueryClient();

  // ─── State dos filtros ───
  const [dataDe, setDataDe] = useState<string>(trintaDiasAtras());
  const [dataAte, setDataAte] = useState<string>("");
  const [busca, setBusca] = useState<string>("");
  const [especie, setEspecie] = useState<Especie | "_all">("_all");
  const [status, setStatus] = useState<StatusClassificacao | "_all">("classificado");
  const [classeFilter, setClasseFilter] = useState<string>("_all");
  const [ccFilter, setCcFilter] = useState<string>("_all");

  // ─── Sincronizar modal ───
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncDataIni, setSyncDataIni] = useState(trintaDiasAtras());
  const [syncDataFim, setSyncDataFim] = useState(new Date().toISOString().slice(0, 10));
  const [ultimaSync, setUltimaSync] = useState<string | null>(null);
  const syncMutation = useSyncMovEstq();

  // ─── Adicionar em lote ───
  const [isAdding, setIsAdding] = useState(false);

  // ─── Build filtros server-side ───
  const filtrosServer: MovEstqFiltros = useMemo(
    () => ({
      data_emissao_de: dataDe || null,
      data_emissao_ate: dataAte || null,
      busca: busca.trim() || null,
      especie: especie === "_all" ? null : especie,
      status_classificacao: status === "_all" ? null : status,
    }),
    [dataDe, dataAte, busca, especie, status],
  );

  const { data: itensRaw = [], isLoading, isError, error, refetch } = useMovEstqDisponivel(filtrosServer);

  // ─── Filtro client-side ───
  const itensFiltrados = useMemo(() => {
    return itensRaw.filter((item) => {
      if (classeFilter !== "_all" && item.codigo_classe !== classeFilter) return false;
      if (ccFilter !== "_all" && item.codigo_centro_ctrl !== ccFilter) return false;
      return true;
    });
  }, [itensRaw, classeFilter, ccFilter]);

  const classesDisponiveis = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of itensRaw) {
      if (item.codigo_classe && !seen.has(item.codigo_classe)) {
        seen.set(item.codigo_classe, item.nome_classe ?? item.codigo_classe);
      }
    }
    return Array.from(seen.entries())
      .map(([codigo, nome]) => ({ codigo, nome }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [itensRaw]);

  const ccsDisponiveis = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of itensRaw) {
      if (item.codigo_centro_ctrl && !seen.has(item.codigo_centro_ctrl)) {
        seen.set(item.codigo_centro_ctrl, item.nome_centro_ctrl ?? item.codigo_centro_ctrl);
      }
    }
    return Array.from(seen.entries())
      .map(([codigo, nome]) => ({ codigo, nome }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
  }, [itensRaw]);

  const grupos = useMemo(() => agruparPorNF(itensFiltrados), [itensFiltrados]);

  // ─── Sincronizar handler ───
  const handleSync = async () => {
    try {
      const result = await syncMutation.mutateAsync({
        dataInicial: syncDataIni,
        dataFinal: syncDataFim,
      });
      setUltimaSync(new Date().toISOString());
      setSyncOpen(false);
      toast({
        title: "Sincronização concluída",
        description: result.summary
          ? `${result.summary.nfs_processadas} NFs processadas, ${result.summary.rateios_distribuidos} rateios distribuídos.`
          : "MovEstq sincronizado com sucesso.",
      });
    } catch (err) {
      toast({
        title: "Falha na sincronização",
        description: friendlyErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  // ─── Adicionar selecionados ───
  const handleAdicionar = async () => {
    if (selectedIds.size === 0) return;
    setIsAdding(true);

    const idsArray = Array.from(selectedIds);
    const infoById = new Map<string, { especie: string; numero: string; chave: number }>();
    for (const item of itensRaw) {
      if (item.rateio_id) {
        infoById.set(item.rateio_id, {
          especie: item.especie,
          numero: item.numero,
          chave: item.chave_movestq,
        });
      }
    }

    const results = await Promise.allSettled(idsArray.map((id) => addRateioToRascunho(id)));

    const sucessos: string[] = [];
    const falhas: { id: string; motivo: string }[] = [];
    results.forEach((r, idx) => {
      const id = idsArray[idx];
      if (r.status === "fulfilled") {
        sucessos.push(id);
      } else {
        falhas.push({ id, motivo: friendlyErrorMessage(r.reason) });
      }
    });

    setIsAdding(false);

    setSelectedIds((prev) => {
      const next = new Set(prev);
      sucessos.forEach((id) => next.delete(id));
      return next;
    });

    qc.invalidateQueries({ queryKey: ["reembolso-nf"] });

    if (falhas.length === 0) {
      toast({
        title: `${sucessos.length} ${sucessos.length === 1 ? "item adicionado" : "itens adicionados"}`,
        description: "Verifique sua cesta ao lado.",
      });
    } else if (sucessos.length === 0) {
      toast({
        title: "Nenhum item foi adicionado",
        description: falhas[0].motivo,
        variant: "destructive",
      });
    } else {
      const nfsFalha = falhas
        .map((f) => infoById.get(f.id))
        .filter((info): info is { especie: string; numero: string; chave: number } => !!info)
        .slice(0, 3)
        .map((info) => `${info.especie} ${formatNumeroDoc(info.numero)}`)
        .join(", ");
      const sufixo = falhas.length > 3 ? ` e mais ${falhas.length - 3}` : "";
      toast({
        title: `${sucessos.length} adicionados, ${falhas.length} falharam`,
        description: `Não adicionados: ${nfsFalha}${sufixo}. Provavelmente já estão em outro rascunho.`,
        variant: "destructive",
      });
    }
  };

  const handleLimparFiltros = () => {
    setDataDe(trintaDiasAtras());
    setDataAte("");
    setBusca("");
    setEspecie("_all");
    setStatus("classificado");
    setClasseFilter("_all");
    setCcFilter("_all");
  };

  const filtrosClientAtivos = classeFilter !== "_all" || ccFilter !== "_all";
  const algumFiltroAtivo =
    dataDe !== trintaDiasAtras() ||
    dataAte !== "" ||
    busca !== "" ||
    especie !== "_all" ||
    status !== "classificado" ||
    filtrosClientAtivos;

  return (
    <>
      <Card className="flex flex-col h-full min-h-0">
        {/* ─── Header com filtros e botão sync ─── */}
        <div className="border-b border-border p-3 space-y-3 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h2 className="text-sm font-semibold whitespace-nowrap">NFs disponíveis</h2>
              <Badge variant="outline" className="font-mono text-[10px]">
                {itensFiltrados.length}
              </Badge>
            </div>
            <TooltipProvider>
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={() => setSyncOpen(true)} className="gap-1.5 text-xs h-8">
                    <RefreshCw className="h-3 w-3" />
                    Sincronizar do Alvo
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">
                    {ultimaSync ? `Última sincronização: ${formatDateTimeBR(ultimaSync)}` : "Sincronize para atualizar"}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-3">
              <Label className="text-[10px] text-muted-foreground">Emissão de</Label>
              <Input type="date" value={dataDe} onChange={(e) => setDataDe(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="col-span-3">
              <Label className="text-[10px] text-muted-foreground">Emissão até</Label>
              <Input type="date" value={dataAte} onChange={(e) => setDataAte(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="col-span-6">
              <Label className="text-[10px] text-muted-foreground">Busca (fornecedor ou número)</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="BioCollagen, 30597..."
                  className="h-8 text-xs pl-7"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-3">
              <Label className="text-[10px] text-muted-foreground">Espécie</Label>
              <Select value={especie} onValueChange={(v) => setEspecie(v as Especie | "_all")}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  {ESPECIES_DISPONIVEIS.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3">
              <Label className="text-[10px] text-muted-foreground">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusClassificacao | "_all")}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="classificado">Classificadas (default)</SelectItem>
                  <SelectItem value="aguardando_classificacao">Aguardando classificação</SelectItem>
                  <SelectItem value="_all">Todas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3">
              <Label className="text-[10px] text-muted-foreground">Classe BR</Label>
              <Select value={classeFilter} onValueChange={setClasseFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  {classesDisponiveis.map((c) => (
                    <SelectItem key={c.codigo} value={c.codigo}>
                      <span className="font-mono mr-1.5">{c.codigo}</span>
                      <span className="text-xs">{c.nome}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3">
              <Label className="text-[10px] text-muted-foreground">CC</Label>
              <Select value={ccFilter} onValueChange={setCcFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todos</SelectItem>
                  {ccsDisponiveis.map((c) => (
                    <SelectItem key={c.codigo} value={c.codigo}>
                      <span className="text-xs">{c.nome}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {algumFiltroAtivo && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={handleLimparFiltros} className="h-7 text-[10px] gap-1">
                <XIcon className="h-3 w-3" />
                Limpar filtros
              </Button>
            </div>
          )}
        </div>

        {/* ─── Corpo: lista (única área scrollável) ─── */}
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {isLoading && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {isError && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="flex items-start gap-3 p-4">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-destructive">Erro ao carregar NFs</p>
                  <p className="text-xs text-muted-foreground mt-1 break-words">{friendlyErrorMessage(error)}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => refetch()}>
                  Tentar novamente
                </Button>
              </CardContent>
            </Card>
          )}

          {!isLoading && !isError && grupos.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-sm text-muted-foreground gap-2 py-12">
              <p>Nenhuma NF disponível neste filtro.</p>
              <p className="text-xs">Tente ampliar o período ou clique em Sincronizar do Alvo.</p>
            </div>
          )}

          {!isLoading && !isError && grupos.length > 0 && (
            <div className="space-y-2">
              {grupos.map((grupo) => (
                <NFCard
                  key={grupo.chave_movestq}
                  grupo={grupo}
                  selectedIds={selectedIds}
                  setSelectedIds={setSelectedIds}
                />
              ))}
            </div>
          )}
        </div>

        {/* ─── Rodapé fixo: botão Adicionar ─── */}
        <div className="border-t border-border p-3 shrink-0 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{selectedIds.size}</span>{" "}
            {selectedIds.size === 1 ? "rateio selecionado" : "rateios selecionados"}
          </p>
          <Button onClick={handleAdicionar} disabled={selectedIds.size === 0 || isAdding} size="sm">
            {isAdding ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Adicionando...
              </>
            ) : (
              <>Adicionar selecionados</>
            )}
          </Button>
        </div>
      </Card>

      {/* ─── Modal Sincronizar ─── */}
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sincronizar MovEstq do Alvo</DialogTitle>
            <DialogDescription>
              Busca NFs novas e atualiza rateios do MovEstq no período selecionado. Pode levar até 1 minuto.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Data inicial</Label>
              <Input
                type="date"
                value={syncDataIni}
                onChange={(e) => setSyncDataIni(e.target.value)}
                disabled={syncMutation.isPending}
              />
            </div>
            <div>
              <Label className="text-xs">Data final</Label>
              <Input
                type="date"
                value={syncDataFim}
                onChange={(e) => setSyncDataFim(e.target.value)}
                disabled={syncMutation.isPending}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncOpen(false)} disabled={syncMutation.isPending}>
              Cancelar
            </Button>
            <Button onClick={handleSync} disabled={syncMutation.isPending || !syncDataIni || !syncDataFim}>
              {syncMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  Sincronizar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ═════════════════════════════════════════════════════════════
// Subcomponentes: cards de NF
// ═════════════════════════════════════════════════════════════

interface NFCardProps {
  grupo: GrupoNF;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

function NFCard({ grupo, selectedIds, setSelectedIds }: NFCardProps) {
  if (grupo.mode === "aguardando") return <NFAguardando grupo={grupo} />;
  if (grupo.mode === "flat") return <NFFlat grupo={grupo} selectedIds={selectedIds} setSelectedIds={setSelectedIds} />;
  if (grupo.mode === "single-classe")
    return <NFSingleClasse grupo={grupo} selectedIds={selectedIds} setSelectedIds={setSelectedIds} />;
  return <NFMultiClasse grupo={grupo} selectedIds={selectedIds} setSelectedIds={setSelectedIds} />;
}

function NFAguardando({ grupo }: { grupo: GrupoNF }) {
  const item = grupo.itens[0];
  return (
    <Card className="border-dashed opacity-60">
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <Lock className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px]">
                {item.especie}
              </Badge>
              <span className="font-mono text-xs font-semibold" title={item.numero}>
                {formatNumeroDoc(item.numero)}
              </span>
              <span className="text-xs text-muted-foreground truncate">{item.nome_entidade}</span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-[10px] text-muted-foreground">{formatDateBR(item.data_emissao)}</span>
              <span className="text-xs font-mono font-semibold">{formatBRL(item.valor_doc_total)}</span>
            </div>
            <p className="text-[10px] text-amber-600 mt-1.5">
              ⚠️ Aguardando classificação contábil — disponível após a contabilidade preencher classe e CC.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NFFlat({ grupo, selectedIds, setSelectedIds }: NFCardProps) {
  const item = grupo.itens[0];
  if (!item.rateio_id) return null;
  const isChecked = selectedIds.has(item.rateio_id);

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start gap-3">
          <Checkbox
            checked={isChecked}
            onCheckedChange={(v) => {
              setSelectedIds((prev) => {
                const next = new Set(prev);
                if (v === true) next.add(item.rateio_id!);
                else next.delete(item.rateio_id!);
                return next;
              });
            }}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px]">
                {item.especie}
              </Badge>
              <span className="font-mono text-xs font-semibold" title={item.numero}>
                {formatNumeroDoc(item.numero)}
              </span>
              <span className="text-xs text-muted-foreground truncate flex-1">{item.nome_entidade}</span>
              <span className="font-mono text-xs font-semibold whitespace-nowrap">
                {formatBRL(item.valor_rateio ?? item.valor_doc_total)}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
              <span>{formatDateBR(item.data_emissao)}</span>
              <span>
                <span className="font-mono">{item.codigo_classe}</span> {item.nome_classe}
              </span>
              <span className="truncate">CC: {item.nome_centro_ctrl}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function NFSingleClasse({ grupo, selectedIds, setSelectedIds }: NFCardProps) {
  const item = grupo.itens[0];
  const [open, setOpen] = useState(true);
  const headerState = getHeaderState(selectedIds, grupo.todosRateioIds);

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px]">
                {item.especie}
              </Badge>
              <span className="font-mono text-xs font-semibold" title={item.numero}>
                {formatNumeroDoc(item.numero)}
              </span>
              <span className="text-xs text-muted-foreground truncate flex-1">{item.nome_entidade}</span>
              <span className="font-mono text-xs font-semibold whitespace-nowrap">
                Total NF: {formatBRL(item.valor_doc_total)}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
              <span>{formatDateBR(item.data_emissao)}</span>
              <span>
                <span className="font-mono">{item.codigo_classe}</span> {item.nome_classe}
              </span>
            </div>
          </div>
        </div>

        {open && (
          <>
            <Separator className="my-2" />
            <div className="flex items-center gap-3 pl-6 mb-2">
              <Checkbox
                checked={headerState}
                onCheckedChange={(v) => setSelectedIds((prev) => toggleAll(prev, grupo.todosRateioIds, v === true))}
              />
              <span className="text-[10px] text-muted-foreground">
                Selecionar todos os {grupo.todosRateioIds.length} rateios
              </span>
            </div>
            <div className="pl-6 space-y-1.5">
              {grupo.itens.map((it) =>
                it.rateio_id ? (
                  <SubLinha key={it.rateio_id} item={it} selectedIds={selectedIds} setSelectedIds={setSelectedIds} />
                ) : null,
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NFMultiClasse({ grupo, selectedIds, setSelectedIds }: NFCardProps) {
  const item = grupo.itens[0];
  const [open, setOpen] = useState(true);
  const classes = useMemo(() => agruparPorClasse(grupo.itens), [grupo.itens]);
  const nfHeaderState = getHeaderState(selectedIds, grupo.todosRateioIds);

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-start gap-2">
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px]">
                {item.especie}
              </Badge>
              <span className="font-mono text-xs font-semibold" title={item.numero}>
                {formatNumeroDoc(item.numero)}
              </span>
              <span className="text-xs text-muted-foreground truncate flex-1">{item.nome_entidade}</span>
              <span className="font-mono text-xs font-semibold whitespace-nowrap">
                Total NF: {formatBRL(item.valor_doc_total)}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
              <span>{formatDateBR(item.data_emissao)}</span>
              <span>
                {grupo.itens.length} rateios em {classes.length} classes contábeis
              </span>
            </div>
          </div>
        </div>

        {open && (
          <>
            <Separator className="my-2" />
            <div className="flex items-center gap-3 pl-6 mb-2">
              <Checkbox
                checked={nfHeaderState}
                onCheckedChange={(v) => setSelectedIds((prev) => toggleAll(prev, grupo.todosRateioIds, v === true))}
              />
              <span className="text-[10px] text-muted-foreground">
                Selecionar todos os {grupo.todosRateioIds.length} rateios
              </span>
            </div>

            <div className="pl-6 space-y-3">
              {classes.map((c) => {
                const classeHeaderState = getHeaderState(selectedIds, c.ids);
                return (
                  <div key={c.codigo_classe} className="space-y-1.5">
                    <div className="flex items-center gap-2 bg-muted/30 rounded px-2 py-1">
                      <Checkbox
                        checked={classeHeaderState}
                        onCheckedChange={(v) => setSelectedIds((prev) => toggleAll(prev, c.ids, v === true))}
                      />
                      <span className="font-mono text-[11px] font-semibold">{c.codigo_classe}</span>
                      <span className="text-[11px] text-muted-foreground truncate flex-1">{c.nome_classe ?? "—"}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {c.rateios.length} {c.rateios.length === 1 ? "rateio" : "rateios"}
                      </span>
                      <span className="font-mono text-[11px] font-semibold">{formatBRL(c.subtotal)}</span>
                    </div>
                    <div className="pl-4 space-y-1">
                      {c.rateios.map((it) =>
                        it.rateio_id ? (
                          <SubLinha
                            key={it.rateio_id}
                            item={it}
                            selectedIds={selectedIds}
                            setSelectedIds={setSelectedIds}
                            hideClasse
                          />
                        ) : null,
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface SubLinhaProps {
  item: MovEstqDisponivel;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  hideClasse?: boolean;
}

function SubLinha({ item, selectedIds, setSelectedIds, hideClasse }: SubLinhaProps) {
  if (!item.rateio_id) return null;
  const isChecked = selectedIds.has(item.rateio_id);

  return (
    <div className="flex items-center gap-2 py-1">
      <Checkbox
        checked={isChecked}
        onCheckedChange={(v) => {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (v === true) next.add(item.rateio_id!);
            else next.delete(item.rateio_id!);
            return next;
          });
        }}
      />
      {!hideClasse && item.codigo_classe && (
        <span className="font-mono text-[10px] text-muted-foreground">{item.codigo_classe}</span>
      )}
      <span className="text-[11px] text-muted-foreground truncate flex-1" title={item.nome_centro_ctrl ?? ""}>
        CC: {item.nome_centro_ctrl ?? item.codigo_centro_ctrl}
      </span>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatPct(item.percentual)}</span>
      <span className="font-mono text-[11px] font-semibold whitespace-nowrap">{formatBRL(item.valor_rateio ?? 0)}</span>
    </div>
  );
}
