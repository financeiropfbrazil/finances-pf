/**
 * Peças visuais do módulo de Projetos — padrão "ERP sóbrio".
 *
 * Tudo aqui usa os tokens do tema (src/index.css): `primary`, `success`,
 * `warning`, `danger`, `info`, `muted`. Nada de cor Tailwind crua
 * (yellow-500, green-600…) nem sombra colorida: cor forte só para exceção, e o
 * mesmo componente funciona igual no claro e no escuro.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FASES, tomConsumo, type Tom } from "./projetosFormat";

const PONTO: Record<Tom, string> = {
  neutro: "bg-muted-foreground/60",
  info: "bg-info",
  sucesso: "bg-success",
  atencao: "bg-warning",
  perigo: "bg-danger",
};

const TEXTO: Record<Tom, string> = {
  neutro: "text-foreground",
  info: "text-info",
  sucesso: "text-success",
  atencao: "text-warning",
  perigo: "text-danger",
};

/** Selo de status: ponto colorido + rótulo em texto neutro, borda fina. */
export function StatusChip({ tom, children, className }: { tom: Tom; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium leading-4 text-foreground",
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PONTO[tom])} />
      {children}
    </span>
  );
}

export function FaseChip({ fase }: { fase: string | null | undefined }) {
  const f = FASES[fase || "budget"] ?? FASES.budget;
  return <StatusChip tom={f.tom}>{f.label}</StatusChip>;
}

const BARRA: Record<Tom, string> = {
  neutro: "bg-muted-foreground/50",
  info: "bg-primary",
  sucesso: "bg-success",
  atencao: "bg-warning",
  perigo: "bg-danger",
};

/** Barra fina de consumo. `pct` acima de 100 enche a barra e pinta de perigo. */
export function BarraConsumo({ pct, tom, className }: { pct: number; tom?: Tom; className?: string }) {
  const t = tom ?? tomConsumo(pct);
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-sm bg-muted", className)}>
      <div className={cn("h-full", BARRA[t])} style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} />
    </div>
  );
}

/** Indicador de um painel de resumo: rótulo pequeno em caixa alta, valor tabular, linha de apoio. */
export function Indicador({
  rotulo,
  valor,
  apoio,
  tom,
  children,
}: {
  rotulo: string;
  valor: ReactNode;
  apoio?: ReactNode;
  tom?: Tom;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-1 truncate text-lg font-semibold tabular-nums", tom ? TEXTO[tom] : "text-foreground")}>
        {valor}
      </p>
      {apoio && <p className="mt-0.5 truncate text-xs text-muted-foreground">{apoio}</p>}
      {children}
    </div>
  );
}

/** Cabeçalho de seção dentro de um painel (ERP: faixa discreta com título e ações). */
export function CabecalhoSecao({
  titulo,
  subtitulo,
  acoes,
}: {
  titulo: ReactNode;
  subtitulo?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>
        {subtitulo && <div className="text-xs text-muted-foreground">{subtitulo}</div>}
      </div>
      {acoes && <div className="flex items-center gap-2">{acoes}</div>}
    </div>
  );
}
