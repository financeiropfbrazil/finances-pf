import { useState, useEffect, useRef } from "react";
import { Search, Link2, Unlink, FileText, Loader2, User as UserIcon, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { useToast } from "@/hooks/use-toast";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { supabase } from "@/integrations/supabase/client";

// ════════════════════════════════════════════════════════════
// Tipos
// ════════════════════════════════════════════════════════════

interface RequisicaoSemVinculo {
  id: string;
  numero_alvo: string;
  funcionario_nome: string | null;
  descricao: string | null;
  data_necessidade: string | null;
  total_itens: number | null;
  produtos_preview: string | null;
}

interface VincularRequisicaoCardProps {
  pedidoId: string;
  numeroReqVinculada: string | null; // numero_req_comp do pedido (null = sem vínculo)
  onChange: () => void; // refetch do detalhe após vincular/desvincular
}

// ════════════════════════════════════════════════════════════
// Componente
// ════════════════════════════════════════════════════════════

export default function VincularRequisicaoCard({
  pedidoId,
  numeroReqVinculada,
  onChange,
}: VincularRequisicaoCardProps) {
  const { toast } = useToast();
  const podeVincular = useHasPermission(PERMISSIONS.COMPRAS_PEDIDOS_CREATE);

  const [buscaAberta, setBuscaAberta] = useState(false);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<RequisicaoSemVinculo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [vinculandoId, setVinculandoId] = useState<string | null>(null);
  const [showDesvincular, setShowDesvincular] = useState(false);
  const [desvinculando, setDesvinculando] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Busca debounced (300ms) ──────────────────────────────
  useEffect(() => {
    if (!buscaAberta) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setBuscando(true);
      try {
        const { data, error } = await (supabase as any).rpc("buscar_requisicoes_sem_vinculo", {
          p_termo: termo,
        });
        if (error) throw error;
        setResultados((data as RequisicaoSemVinculo[]) || []);
      } catch (e: any) {
        toast({
          title: "Não foi possível buscar requisições",
          description: e.message || "Tente novamente.",
          variant: "destructive",
        });
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [termo, buscaAberta, toast]);

  // Ao abrir a busca, dispara uma busca inicial (lista as mais recentes)
  function abrirBusca() {
    setBuscaAberta(true);
    setTermo("");
    setResultados([]);
  }

  function fecharBusca() {
    setBuscaAberta(false);
    setTermo("");
    setResultados([]);
  }

  // ── Vincular ─────────────────────────────────────────────
  async function vincular(req: RequisicaoSemVinculo) {
    setVinculandoId(req.id);
    try {
      const { error } = await (supabase as any).rpc("vincular_pedido_requisicao", {
        p_pedido_id: pedidoId,
        p_requisicao_id: req.id,
      });
      if (error) throw error;
      toast({
        title: "Requisição vinculada",
        description: `Pedido ligado à requisição ${req.numero_alvo}.`,
      });
      fecharBusca();
      onChange();
    } catch (e: any) {
      toast({
        title: "Não foi possível vincular",
        description: e.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setVinculandoId(null);
    }
  }

  // ── Desvincular ──────────────────────────────────────────
  async function desvincular() {
    setDesvinculando(true);
    try {
      const { error } = await (supabase as any).rpc("desvincular_pedido_requisicao", {
        p_pedido_id: pedidoId,
      });
      if (error) throw error;
      toast({
        title: "Requisição desvinculada",
        description: "O vínculo foi removido.",
      });
      setShowDesvincular(false);
      onChange();
    } catch (e: any) {
      toast({
        title: "Não foi possível desvincular",
        description: e.message || "Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setDesvinculando(false);
    }
  }

  // ════════════════════════════════════════════════════════
  // ESTADO 1 — Pedido JÁ vinculado
  // ════════════════════════════════════════════════════════
  if (numeroReqVinculada) {
    return (
      <>
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              Requisição de origem
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-muted-foreground">Vinculado à requisição</span>
                <span className="font-mono font-medium text-foreground">{numeroReqVinculada}</span>
              </div>
              {podeVincular && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDesvincular(true)}
                  className="gap-1.5 text-muted-foreground"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  Desvincular
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <AlertDialog open={showDesvincular} onOpenChange={setShowDesvincular}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Desvincular requisição?</AlertDialogTitle>
              <AlertDialogDescription>
                O vínculo entre este pedido e a requisição {numeroReqVinculada} será removido. Você pode vincular
                novamente depois.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={desvinculando}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  desvincular();
                }}
                disabled={desvinculando}
              >
                {desvinculando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Desvinculando...
                  </>
                ) : (
                  "Desvincular"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  // ════════════════════════════════════════════════════════
  // ESTADO 2 — Pedido SEM vínculo
  // ════════════════════════════════════════════════════════
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          Requisição de origem
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!buscaAberta ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">Este pedido não está vinculado a nenhuma requisição.</p>
            {podeVincular && (
              <Button variant="outline" size="sm" onClick={abrirBusca} className="gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                Vincular requisição
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Campo de busca */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Buscar por número, requisitante, descrição ou item..."
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button variant="ghost" size="sm" onClick={fecharBusca} className="gap-1.5">
                <X className="h-4 w-4" />
                Cancelar
              </Button>
            </div>

            {/* Resultados */}
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {buscando ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Buscando...
                </div>
              ) : resultados.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {termo
                    ? "Nenhuma requisição sem vínculo encontrada para essa busca."
                    : "Nenhuma requisição disponível para vincular."}
                </p>
              ) : (
                resultados.map((req) => (
                  <button
                    key={req.id}
                    onClick={() => vincular(req)}
                    disabled={vinculandoId !== null}
                    className="flex w-full items-start justify-between gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent disabled:opacity-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium text-foreground">{req.numero_alvo}</span>
                        {req.total_itens != null && (
                          <span className="text-xs text-muted-foreground">
                            {req.total_itens} {req.total_itens === 1 ? "item" : "itens"}
                          </span>
                        )}
                      </div>
                      {req.descricao && <p className="mt-0.5 truncate text-sm text-foreground">{req.descricao}</p>}
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <UserIcon className="h-3 w-3 shrink-0" />
                        <span className="truncate">{req.funcionario_nome || "Requisitante não informado"}</span>
                      </div>
                      {req.produtos_preview && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{req.produtos_preview}</p>
                      )}
                    </div>
                    {vinculandoId === req.id ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                    ) : (
                      <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
