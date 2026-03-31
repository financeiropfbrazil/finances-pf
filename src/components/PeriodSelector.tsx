import { Calendar, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePeriod } from "@/contexts/PeriodContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

interface PeriodSelectorProps {
  /** Size variant */
  size?: "sm" | "default";
  /** Show lock icon for closed periods */
  showLock?: boolean;
  className?: string;
}

/**
 * Reusable period (month/year) selector dropdown.
 * Wraps PeriodContext for consistent usage across the app.
 */
export function PeriodSelector({ size = "sm", showLock = true, className }: PeriodSelectorProps) {
  const { periods, selectedPeriod, setSelectedPeriod } = usePeriod();
  const { t } = useLanguage();

  const formatPeriod = (month: number, year: number) =>
    `${t(`month.${month}` as any)}/${year}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          size={size} 
          className={cn(
            "gap-2 bg-background border-muted-foreground/20 hover:bg-muted/50 hover:border-primary/30 transition-all",
            size === "sm" ? "h-8 text-[11px] px-3" : "h-10 text-sm px-4",
            className
          )}
        >
          <Calendar className={cn("text-primary/70", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")} />
          <span className="font-medium">
            {selectedPeriod
              ? formatPeriod(selectedPeriod.month, selectedPeriod.year)
              : t("header.period")}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground/50 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {periods.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onClick={() => setSelectedPeriod(p)}
            className={selectedPeriod?.id === p.id ? "bg-accent" : ""}
          >
            {formatPeriod(p.month, p.year)}
            {showLock && p.status === "closed" && (
              <span className="ml-2 text-xs text-muted-foreground">🔒</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
