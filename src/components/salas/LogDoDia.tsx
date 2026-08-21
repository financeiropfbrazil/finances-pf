import { cn } from "@/lib/utils";
import { formatarNumero, type MovimentoLog, type TipoMovimento } from "@/services/salasService";

/**
 * Log do dia da sala (FS3-5).
 *
 * É a confirmação visual de que o registro entrou — o operador toca em
 * "Registrar" e precisa ver a linha aparecer. Mostra os movimentos de hoje das
 * três tabelas, mais recente primeiro.
 *
 * Estornado aparece **tachado, com o motivo**, e não some: o livro é
 * append-only por decisão de projeto (§0.7), e esconder o erro tiraria da sala
 * justamente a informação de que alguém já corrigiu aquilo.
 */
const ROTULO_TIPO: Record<TipoMovimento, string> = {
  ENTRADA: "Entrada",
  REFUGO: "Refugo",
  SAIDA: "Saída",
};

const COR_TIPO: Record<TipoMovimento, string> = {
  ENTRADA: "bg-success/15 text-success",
  REFUGO: "bg-warning/15 text-warning",
  SAIDA: "bg-info/15 text-info",
};

function horaDe(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export interface LogDoDiaProps {
  movimentos: MovimentoLog[];
  carregando?: boolean;
  /** Renderizado à direita de cada linha (o botão de estorno entra aqui na FS3-9). */
  acaoDaLinha?: (movimento: MovimentoLog) => React.ReactNode;
}

export function LogDoDia({ movimentos, carregando = false, acaoDaLinha }: LogDoDiaProps) {
  if (carregando) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Carregando movimentos…</p>;
  }

  if (movimentos.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nenhum movimento hoje. Toque em Entrada para registrar o primeiro.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {movimentos.map((mov) => {
        const estornado = mov.estornada_em !== null;
        return (
          <li key={`${mov.tipo}-${mov.id}`} className="flex items-center gap-3 py-3">
            <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">
              {horaDe(mov.data_movimento)}
            </span>

            <span
              className={cn(
                "w-20 shrink-0 rounded px-2 py-0.5 text-center text-xs font-medium",
                COR_TIPO[mov.tipo],
              )}
            >
              {ROTULO_TIPO[mov.tipo]}
            </span>

            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-sm text-foreground", estornado && "line-through")}>
                {mov.produto_nome}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {mov.registrado_por_nome}
                {mov.lote ? ` · lote ${mov.lote}` : ""}
                {mov.motivo_nome ? ` · ${mov.motivo_nome}` : ""}
              </span>
              {estornado ? (
                <span className="block truncate text-xs text-destructive">
                  Estornado{mov.motivo_estorno ? `: ${mov.motivo_estorno}` : ""}
                </span>
              ) : null}
            </span>

            <span
              className={cn(
                "shrink-0 text-sm font-medium tabular-nums text-foreground",
                estornado && "line-through",
              )}
            >
              {formatarNumero(mov.quantidade)} {mov.unidade}
            </span>

            {acaoDaLinha ? <span className="shrink-0">{acaoDaLinha(mov)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
