/**
 * Stepper visual para o wizard de Bulk Edit (5 etapas).
 *
 * Mostra qual etapa está ativa, quais já foram concluídas e quais estão à frente.
 * Não permite clique para voltar — para voltar, usar o botão "Voltar" da etapa.
 */

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface WizardStepperProps {
  etapaAtual: number; // 1-5
  totalEtapas?: number;
  labels?: string[];
}

const DEFAULT_LABELS = [
  "Configurar colunas",
  "Upload planilha",
  "Pre-check no Alvo",
  "Preview antes/depois",
  "Executar",
];

export function WizardStepper({ etapaAtual, totalEtapas = 5, labels = DEFAULT_LABELS }: WizardStepperProps) {
  const steps = Array.from({ length: totalEtapas }, (_, i) => i + 1);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between">
        {steps.map((step, idx) => {
          const isCompleted = step < etapaAtual;
          const isActive = step === etapaAtual;
          const label = labels[idx] || `Etapa ${step}`;
          const isLast = idx === steps.length - 1;

          return (
            <div key={step} className="flex flex-1 items-center">
              {/* Círculo + label */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors",
                    isCompleted && "border-emerald-500 bg-emerald-500 text-white",
                    isActive && "border-primary bg-primary text-primary-foreground",
                    !isCompleted && !isActive && "border-border bg-background text-muted-foreground",
                  )}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : step}
                </div>
                <span
                  className={cn(
                    "max-w-[100px] text-center text-xs",
                    isActive
                      ? "font-medium text-foreground"
                      : isCompleted
                        ? "text-foreground/80"
                        : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </div>

              {/* Linha conectora (não no último) */}
              {!isLast && (
                <div
                  className={cn("mx-2 h-0.5 flex-1 transition-colors", isCompleted ? "bg-emerald-500" : "bg-border")}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
