/**
 * Lado 2 da Frente 3 — Cesta de rascunho.
 *
 * Responsabilidades:
 *   - Lê estado da cesta via useRascunhoDetails().
 *   - Agrupa itens por classe BR (codigo_classe) com subtotal e contadores.
 *   - Permite classificar cada item escolhendo TipoBloco no dropdown.
 *   - Permite editar description_pdf por item (texto curto que vai pro PDF).
 *   - Remove item individual.
 *   - Descarta cesta inteira (com AlertDialog de confirmação).
 *   - Abre modal Emitir quando ready_to_emit = true.
 *
 * Layout: 3 áreas verticais —
 *   1. Header (título + descartar + KPIs gerais)
 *   2. Lista agrupada por classe BR (única área scrollável)
 *   3. Rodapé fixo com botão Emitir
 *
 * Cada item tem 3 linhas visuais:
 *   linha 1: badge espécie + número + fornecedor + valor
 *   linha 2: CC + dropdown Konto AT
 *   linha 3: input description_pdf (auto-populado, editável)
 *
 * Description é "debounced" — salva no banco 600ms após Sandra parar
 * de digitar, pra não disparar uma RPC por tecla.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { AlertCircle, CheckCircle2, FileText, Loader2, Send, Trash2, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  useDiscardRascunho,
  useRascunhoDetails,
  useRemoveRateioFromRascunho,
  useSetRascunhoItemDescription,
  useSetRascunhoItemKonto,
} from "@/hooks/useReembolsoNf";
import { friendlyErrorMessage } from "@/services/intercompanyReembolsoNfService";
import {
  TIPO_BLOCO_LABELS,
  TIPOS_BLOCO_ORDENADOS,
  type RascunhoItem,
  type TipoBloco,
} from "@/types/intercompanyReembolsoNf";
import { ModalEmitir } from "./ModalEmitir";

// ═════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatNumeroDoc = (n: string) => n.replace(/^0+/, "") || "0";

// ═════════════════════════════════════════════════════════════
// Agrupamento por classe BR
// ═════════════════════════════════════════════════════════════

interface GrupoClasse {
  codigo_classe: string;
  nome_classe: string | null;
  itens: RascunhoItem[];
  subtotal_brl: number;
  total_itens: number;
  total_classificados: number;
}

function agruparPorClasseBR(itens: RascunhoItem[]): GrupoClasse[] {
  const map = new Map<string, GrupoClasse>();
  for (const item of itens) {
    if (!map.has(item.codigo_classe)) {
      map.set(item.codigo_classe, {
        codigo_classe: item.codigo_classe,
        nome_classe: item.nome_classe,
        itens: [],
        subtotal_brl: 0,
        total_itens: 0,
        total_classificados: 0,
      });
    }
    const g = map.get(item.codigo_classe)!;
    g.itens.push(item);
    g.subtotal_brl += item.valor_brl;
    g.total_itens += 1;
    if (item.classification_status === "classified") g.total_classificados += 1;
  }
  return Array.from(map.values()).sort((a, b) => a.codigo_classe.localeCompare(b.codigo_classe));
}

// ═════════════════════════════════════════════════════════════
// Componente principal
// ═════════════════════════════════════════════════════════════

export function Lado2Cesta() {
  const { data: rascunho, isLoading, isError, error } = useRascunhoDetails();
  const discardMutation = useDiscardRascunho();
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [emitirOpen, setEmitirOpen] = useState(false);

  const grupos = useMemo(() => (rascunho ? agruparPorClasseBR(rascunho.items) : []), [rascunho]);

  const handleDiscard = async () => {
    try {
      await discardMutation.mutateAsync();
      toast({ title: "Cesta descartada", description: "Todos os itens voltaram a estar disponíveis." });
    } catch (err) {
      toast({
        title: "Falha ao descartar",
        description: friendlyErrorMessage(err),
        variant: "destructive",
      });
    } finally {
      setConfirmDiscardOpen(false);
    }
  };

  // ─── Loading ───
  if (isLoading) {
    return (
      <Card className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </Card>
    );
  }

  // ─── Erro ───
  if (isError) {
    return (
      <Card className="h-full border-destructive/30 bg-destructive/5">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-destructive">Erro ao carregar cesta</p>
            <p className="text-xs text-muted-foreground mt-1 break-words">{friendlyErrorMessage(error)}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!rascunho) {
    return null;
  }

  const { total_itens, total_brl, total_classified, total_needs_konto_at, ready_to_emit } = rascunho;
  const cestaVazia = total_itens === 0;

  return (
    <>
      <Card className="flex flex-col h-full min-h-0">
        {/* ─── Header: título + descartar + KPIs ─── */}
        <div className="border-b border-border p-3 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <h2 className="text-sm font-semibold whitespace-nowrap">Cesta de rascunho</h2>
              <Badge variant="outline" className="font-mono text-[10px]">
                {total_itens}
              </Badge>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDiscardOpen(true)}
              disabled={cestaVazia || discardMutation.isPending}
              className="gap-1.5 text-xs h-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
              Descartar
            </Button>
          </div>

          {!cestaVazia && (
            <div className="flex items-center gap-3 mt-2 text-[11px]">
              <span className="text-muted-foreground">
                <span className="font-semibold text-emerald-600">{total_classified}</span> classificados
              </span>
              {total_needs_konto_at > 0 && (
                <span className="text-muted-foreground">
                  <span className="font-semibold text-amber-600">{total_needs_konto_at}</span> pendentes
                </span>
              )}
              <span className="ml-auto font-mono font-semibold">{formatBRL(total_brl)}</span>
            </div>
          )}
        </div>

        {/* ─── Corpo: lista agrupada ─── */}
        <div className="flex-1 overflow-y-auto p-3 min-h-0">
          {cestaVazia ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-12">
              <FileText className="h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Cesta vazia</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Marque NFs no Lado 1 e clique em <span className="font-semibold">Adicionar selecionados</span> para
                começar.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {grupos.map((g) => (
                <GrupoClasseCard key={g.codigo_classe} grupo={g} />
              ))}
            </div>
          )}
        </div>

        {/* ─── Rodapé fixo: botão Emitir ─── */}
        <div className="border-t border-border p-3 shrink-0 flex items-center justify-between gap-2">
          <div className="text-xs">
            {ready_to_emit ? (
              <span className="text-emerald-600 font-medium flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Pronto para emitir
              </span>
            ) : cestaVazia ? (
              <span className="text-muted-foreground">Adicione itens à cesta</span>
            ) : (
              <span className="text-amber-600">
                Falta classificar {total_needs_konto_at} {total_needs_konto_at === 1 ? "item" : "itens"}
              </span>
            )}
          </div>
          <Button onClick={() => setEmitirOpen(true)} disabled={!ready_to_emit} size="sm">
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Emitir Invoice
          </Button>
        </div>
      </Card>

      {/* ─── AlertDialog: confirmar descarte ─── */}
      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar cesta?</AlertDialogTitle>
            <AlertDialogDescription>
              Os {total_itens} {total_itens === 1 ? "item" : "itens"} serão removidos. Os rateios voltarão a estar
              disponíveis no Lado 1.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discardMutation.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDiscard}
              disabled={discardMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {discardMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Descartando...
                </>
              ) : (
                <>Sim, descartar</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Modal Emitir ─── */}
      <ModalEmitir open={emitirOpen} onOpenChange={setEmitirOpen} rascunho={rascunho} />
    </>
  );
}

// ═════════════════════════════════════════════════════════════
// Grupo de classe BR
// ═════════════════════════════════════════════════════════════

function GrupoClasseCard({ grupo }: { grupo: GrupoClasse }) {
  const pendentes = grupo.total_itens - grupo.total_classificados;
  return (
    <Card className="border-muted">
      <CardContent className="p-3 space-y-2">
        {/* Header do grupo */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold">{grupo.codigo_classe}</span>
          <span className="text-xs text-muted-foreground truncate flex-1">{grupo.nome_classe ?? "—"}</span>
          <Badge variant="outline" className="text-[10px] gap-1">
            {grupo.total_classificados > 0 && (
              <span className="text-emerald-600 font-semibold">{grupo.total_classificados}</span>
            )}
            {grupo.total_classificados > 0 && pendentes > 0 && <span className="text-muted-foreground">/</span>}
            {pendentes > 0 && <span className="text-amber-600 font-semibold">{pendentes}</span>}
            <span className="text-muted-foreground">de {grupo.total_itens}</span>
          </Badge>
          <span className="font-mono text-xs font-semibold whitespace-nowrap">{formatBRL(grupo.subtotal_brl)}</span>
        </div>

        <Separator />

        {/* Itens */}
        <div className="space-y-2">
          {grupo.itens.map((item) => (
            <ItemRow key={item.item_id} item={item} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════
// Item da cesta (linha)
// ═════════════════════════════════════════════════════════════

function ItemRow({ item }: { item: RascunhoItem }) {
  const setKontoMutation = useSetRascunhoItemKonto();
  const removeMutation = useRemoveRateioFromRascunho();
  const setDescriptionMutation = useSetRascunhoItemDescription();
  const isClassified = item.classification_status === "classified";

  // ─── Description local + debounce ───
  const [descLocal, setDescLocal] = useState<string>(item.description_pdf ?? "");
  const lastSavedRef = useRef<string>(item.description_pdf ?? "");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sincroniza quando o server retorna um valor diferente (ex: outra aba editou,
  // ou auto-populate inicial). Só sobrescreve se NÃO há edição local pendente.
  useEffect(() => {
    const serverValue = item.description_pdf ?? "";
    if (serverValue !== lastSavedRef.current) {
      setDescLocal(serverValue);
      lastSavedRef.current = serverValue;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.description_pdf]);

  const handleDescChange = (newValue: string) => {
    setDescLocal(newValue);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      // Só salva se mudou do último valor salvo
      if (newValue !== lastSavedRef.current) {
        setDescriptionMutation.mutate(
          { itemId: item.item_id, description: newValue },
          {
            onSuccess: () => {
              lastSavedRef.current = newValue;
            },
            onError: (err) => {
              toast({
                title: "Falha ao salvar descrição",
                description: friendlyErrorMessage(err),
                variant: "destructive",
              });
            },
          },
        );
      }
    }, 600);
  };

  // Cleanup do timer no unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const handleSetKonto = async (tipoBloco: TipoBloco) => {
    try {
      await setKontoMutation.mutateAsync({ itemId: item.item_id, tipoBloco });
    } catch (err) {
      toast({
        title: "Falha ao classificar",
        description: friendlyErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  const handleRemove = async () => {
    try {
      await removeMutation.mutateAsync(item.item_id);
    } catch (err) {
      toast({
        title: "Falha ao remover",
        description: friendlyErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex items-start gap-2 py-1">
      <div className="flex-1 min-w-0 space-y-1">
        {/* Linha 1: badge espécie + número + fornecedor + valor */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] shrink-0">
            {item.especie}
          </Badge>
          <span className="font-mono text-[11px] font-semibold shrink-0" title={item.numero}>
            {formatNumeroDoc(item.numero)}
          </span>
          <span className="text-[11px] text-muted-foreground truncate flex-1">{item.nome_entidade}</span>
          <span className="font-mono text-[11px] font-semibold whitespace-nowrap">{formatBRL(item.valor_brl)}</span>
        </div>

        {/* Linha 2: CC + dropdown Konto AT */}
        <div className="flex items-center gap-2 pl-1">
          <span className="text-[10px] text-muted-foreground truncate flex-1" title={item.nome_centro_ctrl ?? ""}>
            CC: {item.nome_centro_ctrl ?? item.codigo_centro_ctrl}
          </span>
          <Select
            value={item.tipo_bloco ?? ""}
            onValueChange={(v) => handleSetKonto(v as TipoBloco)}
            disabled={setKontoMutation.isPending}
          >
            <SelectTrigger
              className={`h-7 text-[11px] w-[220px] ${
                isClassified
                  ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                  : "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
              }`}
            >
              <SelectValue placeholder="▼ Selecione Konto AT" />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_BLOCO_ORDENADOS.map((tipo) => (
                <SelectItem key={tipo} value={tipo}>
                  <span className="text-xs">{TIPO_BLOCO_LABELS[tipo]}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Linha 3: description_pdf (auto-populada, editável) */}
        <div className="flex items-center gap-2 pl-1">
          <span className="text-[10px] text-muted-foreground shrink-0 w-[28px]">PDF:</span>
          <Input
            value={descLocal}
            onChange={(e) => handleDescChange(e.target.value)}
            placeholder="Descrição que vai pro PDF"
            className="h-7 text-[11px] flex-1"
            maxLength={120}
            disabled={setDescriptionMutation.isPending}
          />
          {setDescriptionMutation.isPending && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
          )}
        </div>
      </div>

      {/* Botão remover */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 mt-0.5"
        onClick={handleRemove}
        disabled={removeMutation.isPending}
        title="Remover item da cesta"
      >
        {removeMutation.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
        )}
      </Button>
    </div>
  );
}
