import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTHS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

interface MonthYearPickerProps {
  value: string; // "YYYY-MM"
  onChange: (value: string) => void;
  minYear?: number;
  maxYear?: number;
}

export default function MonthYearPicker({ value, onChange, minYear = 2025, maxYear = 2027 }: MonthYearPickerProps) {
  const [selectedYear, selectedMonth] = value.split("-").map(Number);
  const [viewYear, setViewYear] = useState(selectedYear);
  const [open, setOpen] = useState(false);

  const handleSelect = (monthIndex: number) => {
    const val = `${viewYear}-${String(monthIndex + 1).padStart(2, "0")}`;
    onChange(val);
    setOpen(false);
  };

  const label = new Date(selectedYear, selectedMonth - 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-[180px] justify-start gap-2 font-normal capitalize">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-3 pointer-events-auto" align="start">
        {/* Year navigation */}
        <div className="mb-3 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={viewYear <= minYear}
            onClick={() => setViewYear((y) => y - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold text-foreground">{viewYear}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={viewYear >= maxYear}
            onClick={() => setViewYear((y) => y + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Month grid */}
        <div className="grid grid-cols-3 gap-1.5">
          {MONTHS.map((m, i) => {
            const isSelected = viewYear === selectedYear && i + 1 === selectedMonth;
            const isCurrent =
              viewYear === new Date().getFullYear() && i === new Date().getMonth();
            return (
              <Button
                key={m}
                variant={isSelected ? "default" : "ghost"}
                size="sm"
                className={cn(
                  "h-9 text-xs font-medium",
                  isCurrent && !isSelected && "ring-1 ring-primary/40"
                )}
                onClick={() => handleSelect(i)}
              >
                {m}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
