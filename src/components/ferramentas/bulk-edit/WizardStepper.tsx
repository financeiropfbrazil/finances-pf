import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WizardStep {
  id: string;
  label: string;
}

interface WizardStepperProps {
  steps: WizardStep[];
  currentStep: number;
  className?: string;
}

export function WizardStepper({ steps, currentStep, className }: WizardStepperProps) {
  return (
    <nav aria-label="Progresso do wizard" className={cn("w-full", className)}>
      <ol className="flex items-center gap-2">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isActive = index === currentStep;
          return (
            <li key={step.id} className="flex flex-1 items-center gap-2">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors",
                    isCompleted && "border-primary bg-primary text-primary-foreground",
                    isActive && "border-primary bg-background text-primary",
                    !isCompleted && !isActive && "border-border bg-background text-muted-foreground",
                  )}
                  aria-current={isActive ? "step" : undefined}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <span
                  className={cn(
                    "hidden text-sm font-medium sm:inline",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "h-px flex-1 transition-colors",
                    isCompleted ? "bg-primary" : "bg-border",
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default WizardStepper;
