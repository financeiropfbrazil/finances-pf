import { cn } from "@/lib/utils";
import type { ProdutoSala } from "@/services/salasService";

/**
 * Campos compartilhados pelos três fluxos de evento (FS3-7).
 *
 * Nasceram dentro do `FluxoEntrada` e foram extraídos quando o Refugo passou a
 * precisar dos mesmos: Entrada, Refugo e Saída fazem a mesma pergunta de
 * quantidade e a mesma conferência final, e a sala tem de ver os três iguais —
 * dois seletores de unidade com comportamento diferente seria erro de operação
 * esperando acontecer.
 */

/** Unidades da escala como botões. Some quando o produto só tem a base. */
export function SeletorUnidade({
  produto,
  unidade,
  onEscolher,
}: {
  produto: ProdutoSala;
  unidade: string;
  onEscolher: (u: string) => void;
}) {
  if (produto.escala_unidades.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {produto.escala_unidades
        .slice()
        .sort((a, b) => a.posicao - b.posicao)
        .map((u) => (
          <button
            key={u.unidade}
            type="button"
            onClick={() => onEscolher(u.unidade)}
            className={cn(
              "h-14 min-w-[88px] rounded-lg border-2 px-4 text-base font-medium transition-colors",
              u.unidade === unidade
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            {u.unidade}
          </button>
        ))}
    </div>
  );
}

export function LinhaConferencia({
  rotulo,
  valor,
  destaque = false,
}: {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 p-4">
      <dt className="shrink-0 text-sm text-muted-foreground">{rotulo}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right text-foreground",
          destaque ? "text-lg font-semibold tabular-nums" : "text-sm",
        )}
      >
        {valor}
      </dd>
    </div>
  );
}

/** Painel de quantidade: valor grande, unidade e a conversão ao vivo (só texto). */
export function VisorQuantidade({
  quantidade,
  unidade,
  conversao,
}: {
  quantidade: string;
  unidade: string;
  conversao: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-right">
      <span className="text-3xl font-semibold tabular-nums text-foreground">{quantidade || "0"}</span>
      <span className="ml-2 text-lg text-muted-foreground">{unidade}</span>
      {conversao ? <p className="mt-1 text-sm text-muted-foreground">{conversao}</p> : null}
    </div>
  );
}
