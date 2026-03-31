import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { Search, CalendarIcon, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const LOCATIONS = ["almoxarifado", "producao", "expedicao"] as const;

interface Props {
  filterLocation: string;
  setFilterLocation: (l: string) => void;
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  dateFilter: Date | undefined;
  setDateFilter: (d: Date | undefined) => void;
}

export function InventoryFilters({ filterLocation, setFilterLocation, searchQuery, setSearchQuery, dateFilter, setDateFilter }: Props) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full sm:w-64">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={"Buscar..."}
          className="pl-9"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      
      <Select value={filterLocation} onValueChange={setFilterLocation}>
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder={`${t("inv.filter_all")} ${t("inv.location")}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("inv.filter_all")} {t("inv.location")}</SelectItem>
          {LOCATIONS.map((l) => (
            <SelectItem key={l} value={l}>{t(("inv.loc." + l) as any)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={`w-[200px] justify-start text-left font-normal ${!dateFilter && "text-muted-foreground"}`}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateFilter ? format(dateFilter, "dd/MM/yyyy") : "Filtrar por data"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateFilter}
              onSelect={setDateFilter}
              initialFocus
              locale={ptBR}
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
        {dateFilter && (
          <Button variant="ghost" size="icon" onClick={() => setDateFilter(undefined)}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
