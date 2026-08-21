import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { estornarMovimento, formatarNumero, type MovimentoLog } from "@/services/salasService";

/**
 * Estorno de um movimento (FS3-9, §E.5).
 *
 * Não existe edição no módulo: erro se corrige por estorno, que é soft — o
 * registro continua no livro, tachado, com o motivo (§0.7 do plano).
 *
 * O motivo é obrigatório aqui E na RPC. A checagem da UI não substitui a do
 * banco: ela existe para o operador não descobrir o problema depois de
 * confirmar, com a mensagem de erro na cara.
 */
export interface DialogoEstornoProps {
  movimento: MovimentoLog | null;
  onFechar: () => void;
  onEstornado: () => void;
}

const ROTULO: Record<string, string> = {
  ENTRADA: "entrada",
  REFUGO: "refugo",
  SAIDA: "saída",
};

export function DialogoEstorno({ movimento, onFechar, onEstornado }: DialogoEstornoProps) {
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  const fechar = () => {
    setMotivo("");
    onFechar();
  };

  const confirmar = async () => {
    if (!movimento || motivo.trim() === "") return;
    setEnviando(true);
    try {
      await estornarMovimento(movimento.tipo, movimento.id, motivo.trim());
      toast.success("Movimento estornado.");
      setMotivo("");
      onEstornado();
    } catch (e: any) {
      // A RPC explica por que recusou — inclusive a janela de 60 minutos
      // expirada, que é a recusa mais provável aqui.
      toast.error(e?.message || "Não foi possível estornar.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={movimento !== null} onOpenChange={(aberto) => (!aberto ? fechar() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Estornar {movimento ? ROTULO[movimento.tipo] : ""}</DialogTitle>
          <DialogDescription>
            O registro continua no histórico, marcado como estornado. Nada é apagado.
          </DialogDescription>
        </DialogHeader>

        {movimento ? (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <div className="font-medium text-foreground">{movimento.produto_nome}</div>
            <div className="mt-0.5 tabular-nums text-muted-foreground">
              {formatarNumero(movimento.quantidade)} {movimento.unidade}
              {movimento.lote ? ` · lote ${movimento.lote}` : ""}
            </div>
          </div>
        ) : null}

        <label className="block">
          <span className="text-sm font-medium text-foreground">Motivo do estorno</span>
          <Textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="O que aconteceu?"
            className="mt-1 min-h-[88px] text-base"
          />
        </label>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={fechar} className="h-12">
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={motivo.trim() === "" || enviando}
            className="h-12"
          >
            {enviando ? "Estornando…" : "Confirmar estorno"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O botão `[↩]` deve aparecer para este movimento?
 *
 * Espelha o que a RPC concede: quem tem `salas.estornar` sempre; o autor, só
 * dentro de 60 minutos. A conta dos 60 minutos aqui usa o relógio do
 * NAVEGADOR, e a da RPC usa o do banco — podem divergir se o tablet estiver com
 * a hora errada. Isso é aceitável **porque esconder o botão é só conveniência**:
 * se a UI mostrar a mais, a RPC recusa e o operador lê o porquê; se mostrar a
 * menos, ninguém perde nada além de um clique. O que não pode é a UI *decidir*.
 */
export function podeMostrarEstorno(
  movimento: MovimentoLog,
  userId: string | null,
  temPermissaoEstornar: boolean,
): boolean {
  if (movimento.estornada_em !== null) return false;
  if (temPermissaoEstornar) return true;
  if (!userId || movimento.registrado_por !== userId) return false;
  const minutos = (Date.now() - new Date(movimento.registrado_em).getTime()) / 60000;
  return minutos < 60;
}
