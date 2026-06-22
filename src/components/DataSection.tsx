// src/components/DataSection.tsx
// Seção de dados padronizada: header destacado + borda + surface tokenizada.
// Resolve o "tudo branco / seções sem separação" — funciona igual em light/dark
// porque usa tokens (surface-2/3, border) que trocam de valor por tema.
//
// Uso:
//   <DataSection title="Dados da Nota">
//     ...conteúdo...
//   </DataSection>
//
//   <DataSection title="Itens da Nota" subtitle="2 itens" action={<Button.../>}>
//     <table>...</table>
//   </DataSection>

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DataSectionProps {
  title: string;
  subtitle?: string;
  /** ação no canto direito do header (botão, badge, etc.) */
  action?: ReactNode;
  /** ícone opcional antes do título */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  /** remove o padding do corpo (útil quando o filho é uma <table> full-bleed) */
  flush?: boolean;
}

export function DataSection({ title, subtitle, action, icon, children, className, flush = false }: DataSectionProps) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-border bg-surface-2", className)}>
      {/* Header da seção — fundo um degrau diferente + divisor */}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface-3 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground truncate">{title}</h3>
          {subtitle && <span className="text-xs text-muted-foreground truncate">· {subtitle}</span>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>

      {/* Corpo */}
      <div className={cn(!flush && "p-4")}>{children}</div>
    </section>
  );
}

// Linha rótulo→valor reutilizável (pros grids de "Fornecedor: X · CNPJ: Y")
interface FieldProps {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
}

export function Field({ label, value, mono, className }: FieldProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("block text-sm text-foreground truncate", mono && "font-mono tabular-nums")}>
        {value ?? "—"}
      </span>
    </div>
  );
}
