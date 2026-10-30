/**
 * Seletor de período De / Até — atalhos (este mês, mês anterior, 30/90 dias, ano) + calendário de 2 meses.
 *
 * Nasceu no Rastreio de Compras e virou componente comum (PLANO-NFE NFE-5 / PLANO-NFSE NFSE-1.14) para as telas de
 * Notas Fiscais e Notas de Serviço usarem o mesmo padrão. Datas sempre "YYYY-MM-DD" no fuso local, sem hora.
 */
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { endOfMonth, endOfYear, format, startOfMonth, startOfYear, subDays, subMonths, subYears } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface Periodo {
  de: string | null;
  ate: string | null;
}

/** "YYYY-MM-DD" → Date local (sem cair no dia anterior em UTC-3). */
function dataLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function isoDia(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const fData = (iso: string | null | undefined) => {
  const d = dataLocal(iso);
  return d ? format(d, "dd/MM/yyyy", { locale: ptBR }) : "—";
};

/** `permitirTudo = false` tira "Todo o histórico" (telas que precisam de De e Até definidos). */
export function atalhosPeriodo(permitirTudo = true): { label: string; periodo: Periodo }[] {
  const hoje = new Date();
  const mesAnt = subMonths(hoje, 1);
  const anoAnt = subYears(hoje, 1);
  const lista = [
    { label: "Este mês", periodo: { de: isoDia(startOfMonth(hoje)), ate: isoDia(endOfMonth(hoje)) } },
    { label: "Mês anterior", periodo: { de: isoDia(startOfMonth(mesAnt)), ate: isoDia(endOfMonth(mesAnt)) } },
    { label: "Últimos 30 dias", periodo: { de: isoDia(subDays(hoje, 29)), ate: isoDia(hoje) } },
    { label: "Últimos 90 dias", periodo: { de: isoDia(subDays(hoje, 89)), ate: isoDia(hoje) } },
    { label: "Ano atual", periodo: { de: isoDia(startOfYear(hoje)), ate: isoDia(endOfYear(hoje)) } },
    { label: "Ano anterior", periodo: { de: isoDia(startOfYear(anoAnt)), ate: isoDia(endOfYear(anoAnt)) } },
  ];
  return permitirTudo ? [...lista, { label: "Todo o histórico", periodo: { de: null, ate: null } }] : lista;
}

export function rotuloPeriodo(p: Periodo): string {
  if (!p.de && !p.ate) return "Todo o histórico";
  const atalho = atalhosPeriodo().find((a) => a.periodo.de === p.de && a.periodo.ate === p.ate);
  const faixa = `${p.de ? fData(p.de) : "início"} – ${p.ate ? fData(p.ate) : "hoje"}`;
  return atalho ? `${atalho.label} · ${faixa}` : faixa;
}

export function PeriodoPicker({
  valor,
  onChange,
  permitirTudo = true,
}: {
  valor: Periodo;
  onChange: (p: Periodo) => void;
  permitirTudo?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [rascunho, setRascunho] = useState<DateRange | undefined>();

  useEffect(() => {
    if (aberto) {
      setRascunho({ from: dataLocal(valor.de) ?? undefined, to: dataLocal(valor.ate) ?? undefined });
    }
  }, [aberto, valor.de, valor.ate]);

  const aplicar = (p: Periodo) => {
    onChange(p);
    setAberto(false);
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 justify-start gap-2 font-normal">
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{rotuloPeriodo(valor)}</span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-row flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
            {atalhosPeriodo(permitirTudo).map((a) => (
              <Button
                key={a.label}
                variant="ghost"
                size="sm"
                className={cn(
                  "justify-start font-normal",
                  a.periodo.de === valor.de && a.periodo.ate === valor.ate && "bg-accent font-medium",
                )}
                onClick={() => aplicar(a.periodo)}
              >
                {a.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-col">
            <CalendarComponent
              mode="range"
              numberOfMonths={2}
              locale={ptBR}
              selected={rascunho}
              onSelect={setRascunho}
              defaultMonth={rascunho?.from ?? subMonths(new Date(), 1)}
              initialFocus
            />
            <div className="flex items-center justify-between gap-2 border-t p-3">
              <span className="text-xs text-muted-foreground">
                {rascunho?.from ? fData(isoDia(rascunho.from)) : "DE"} – {rascunho?.to ? fData(isoDia(rascunho.to)) : "ATÉ"}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={!rascunho?.from}
                  onClick={() =>
                    rascunho?.from &&
                    aplicar({ de: isoDia(rascunho.from), ate: isoDia(rascunho.to ?? rascunho.from) })
                  }
                >
                  Aplicar
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
