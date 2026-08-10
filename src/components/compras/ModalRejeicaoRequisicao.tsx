import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listarMotivosRejeicao, type MotivoRejeicao } from "@/services/requisicoesService";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

const OBSERVACAO_MINIMA = 5;

interface Props {
  aberto: boolean;
  onOpenChange: (aberto: boolean) => void;
  /** Recebe o código do catálogo e a observação (null quando vazia). */
  onConfirmar: (motivoCodigo: string, observacao: string | null) => void;
  rejeitando: boolean;
}

/**
 * AJUSTE 1.3 — modal de rejeição, compartilhado pela fila do líder e pelo detalhe
 * da requisição (antes eram duas cópias do mesmo diálogo, que divergiriam na
 * primeira mudança de regra).
 *
 * O motivo vem do catálogo no banco (`compras_motivos_rejeicao`), nunca de uma
 * lista hard-coded: incluir ou aposentar motivo é operação de SQL, não de deploy.
 * A observação é obrigatória apenas quando o motivo escolhido pede (`exige_observacao`,
 * hoje só "Outros") — a mesma regra é revalidada server-side pela RPC.
 */
export function ModalRejeicaoRequisicao({ aberto, onOpenChange, onConfirmar, rejeitando }: Props) {
  const [motivoCodigo, setMotivoCodigo] = useState("");
  const [observacao, setObservacao] = useState("");

  const {
    data: motivos = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["motivos_rejeicao"],
    queryFn: listarMotivosRejeicao,
    enabled: aberto,
    staleTime: 5 * 60_000,
  });

  // Cada abertura começa limpa: motivo de uma rejeição não vaza para a seguinte.
  useEffect(() => {
    if (aberto) {
      setMotivoCodigo("");
      setObservacao("");
    }
  }, [aberto]);

  const motivoSelecionado: MotivoRejeicao | undefined = useMemo(
    () => motivos.find((m) => m.codigo === motivoCodigo),
    [motivos, motivoCodigo],
  );

  const exigeObservacao = !!motivoSelecionado?.exige_observacao;
  const observacaoOk = !exigeObservacao || observacao.trim().length >= OBSERVACAO_MINIMA;
  const podeConfirmar = !!motivoSelecionado && observacaoOk && !rejeitando;

  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rejeitar requisição?</DialogTitle>
          <DialogDescription>
            A rejeição é definitiva: a requisição não vai ao ERP e não volta para pendente. O requisitante verá o motivo
            e poderá usar "Clonar" para criar uma nova.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Motivo da rejeição</label>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando motivos…
              </div>
            ) : error ? (
              <p className="text-sm text-destructive">
                Não foi possível carregar os motivos: {(error as Error).message}
              </p>
            ) : (
              <Select value={motivoCodigo} onValueChange={setMotivoCodigo}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha o motivo" />
                </SelectTrigger>
                <SelectContent>
                  {motivos.map((m) => (
                    <SelectItem key={m.codigo} value={m.codigo}>
                      {m.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Observação {exigeObservacao ? <span className="text-destructive">*</span> : "(opcional)"}
            </label>
            <Textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder={
                exigeObservacao
                  ? "Obrigatória para este motivo: descreva o que precisa mudar."
                  : "Se quiser, detalhe a decisão para o requisitante."
              }
              rows={4}
            />
            {exigeObservacao && (
              <p className={`text-xs ${observacaoOk ? "text-muted-foreground" : "text-destructive"}`}>
                {observacao.trim().length}/{OBSERVACAO_MINIMA} caracteres mínimos
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={rejeitando}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirmar(motivoCodigo, observacao.trim() || null)}
            disabled={!podeConfirmar}
          >
            {rejeitando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Rejeitar requisição
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
