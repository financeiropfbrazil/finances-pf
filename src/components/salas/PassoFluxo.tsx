import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Moldura de um passo do fluxo (FS3-4).
 *
 * "Uma decisão por tela, com Voltar sempre visível" (§A.1 do FS3-TELAS). O
 * Voltar fica no topo, na mesma posição em todos os passos: de luva, procurar
 * onde fica o botão é o que faz o operador desistir e chamar o supervisor.
 *
 * A ação principal fica FIXA no rodapé (`sticky bottom-0`) com 56px de altura —
 * o piso do §A.1 — para continuar alcançável quando a lista de itens crescer e
 * a página rolar.
 */
export interface PassoFluxoProps {
  titulo: string;
  descricao?: string;
  /** Ex.: 2 de 4. Some quando o fluxo tem um passo só. */
  passoAtual?: number;
  totalPassos?: number;
  onVoltar: () => void;
  children: ReactNode;
  /** Rodapé de ação. Sem ele, o passo avança pela própria escolha (cartões). */
  acaoPrincipal?: {
    rotulo: string;
    onClick: () => void;
    desabilitada?: boolean;
    carregando?: boolean;
  };
}

export function PassoFluxo({
  titulo,
  descricao,
  passoAtual,
  totalPassos,
  onVoltar,
  children,
  acaoPrincipal,
}: PassoFluxoProps) {
  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onVoltar}
          aria-label="Voltar"
          className="h-12 w-12 shrink-0"
        >
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-foreground">{titulo}</h2>
          {descricao ? <p className="truncate text-sm text-muted-foreground">{descricao}</p> : null}
        </div>
        {passoAtual && totalPassos ? (
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {passoAtual} de {totalPassos}
          </span>
        ) : null}
      </div>

      <div className="flex-1 py-4">{children}</div>

      {acaoPrincipal ? (
        <div className="sticky bottom-0 border-t border-border bg-background py-3">
          <Button
            type="button"
            onClick={acaoPrincipal.onClick}
            disabled={acaoPrincipal.desabilitada || acaoPrincipal.carregando}
            className="h-14 w-full text-base"
          >
            {acaoPrincipal.carregando ? "Registrando…" : acaoPrincipal.rotulo}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
