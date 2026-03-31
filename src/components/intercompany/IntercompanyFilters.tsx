import { useState } from "react";
import { format, parse } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

interface Props {
  sourceFilter: string;
  onSourceChange: (v: string) => void;
  docTypeFilter: string;
  onDocTypeChange: (v: string) => void;
  dateFrom: string;
  onDateFromChange: (v: string) => void;
  dateTo: string;
  onDateToChange: (v: string) => void;
}

function DateFilterPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const dateValue = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;

  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "h-9 w-[140px] justify-start text-left font-normal text-xs sm:text-sm",
              !value && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
            {dateValue ? format(dateValue, "dd/MM/yyyy") : "dd/mm/aaaa"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={dateValue}
            onSelect={(d) => {
              onChange(d ? format(d, "yyyy-MM-dd") : "");
              setOpen(false);
            }}
            locale={ptBR}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default function IntercompanyFilters({ sourceFilter, onSourceChange, docTypeFilter, onDocTypeChange, dateFrom, onDateFromChange, dateTo, onDateToChange }: Props) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-wrap gap-2 items-end">
      <Select value={sourceFilter} onValueChange={onSourceChange}>
        <SelectTrigger className="w-[120px] sm:w-[140px] text-xs sm:text-sm">
          <SelectValue placeholder={t("ic.source" as any)} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("ic.filter_all" as any)}</SelectItem>
          <SelectItem value="manual">{t("ic.source.manual" as any)}</SelectItem>
          <SelectItem value="alvo">{t("ic.source.alvo" as any)}</SelectItem>
        </SelectContent>
      </Select>
      <Select value={docTypeFilter} onValueChange={onDocTypeChange}>
        <SelectTrigger className="w-[120px] sm:w-[140px] text-xs sm:text-sm">
          <SelectValue placeholder={t("ic.doc_type_label" as any)} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("ic.filter_all" as any)}</SelectItem>
          <SelectItem value="nf-e">NF-e</SelectItem>
          <SelectItem value="nfs-e">NFS-e</SelectItem>
          <SelectItem value="inv">INV</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex items-end gap-1.5">
        <DateFilterPicker label="De" value={dateFrom} onChange={onDateFromChange} />
        <DateFilterPicker label="Até" value={dateTo} onChange={onDateToChange} />
      </div>
    </div>
  );
}
