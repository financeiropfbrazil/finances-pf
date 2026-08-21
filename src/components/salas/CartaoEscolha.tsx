import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Cartão de escolha do estilo caixa (FS3-4).
 *
 * A restrição que manda no desenho é luva + sala limpa + tablet possivelmente
 * dentro de saco selado (§A.1 do FS3-TELAS). Daí:
 *  - altura mínima de 80px (o piso do §A.1 para cartão de escolha);
 *  - estado selecionado marcado por BORDA + FUNDO + ícone, nunca só por cor —
 *    através do plástico, e para quem enxerga cor de outro jeito, cor sozinha
 *    não é sinal;
 *  - sem `hover:` como informação: no toque não existe hover. Ele está aqui só
 *    como afago para quem usa a mesma tela no computador.
 */
export interface CartaoEscolhaProps {
  titulo: string;
  subtitulo?: string | null;
  detalhe?: string | null;
  selecionado?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function CartaoEscolha({
  titulo,
  subtitulo,
  detalhe,
  selecionado = false,
  onClick,
  disabled = false,
}: CartaoEscolhaProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selecionado}
      className={cn(
        "flex min-h-[80px] w-full items-center justify-between gap-3 rounded-lg border-2 p-4 text-left transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        selecionado
          ? "border-primary bg-primary/10"
          : "border-border bg-card hover:bg-accent",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate text-base font-medium text-foreground">{titulo}</span>
        {subtitulo ? (
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">{subtitulo}</span>
        ) : null}
        {detalhe ? (
          <span className="mt-0.5 block truncate text-xs tabular-nums text-muted-foreground">{detalhe}</span>
        ) : null}
      </span>
      {selecionado ? <Check className="h-6 w-6 shrink-0 text-primary" aria-hidden="true" /> : null}
    </button>
  );
}
