/**
 * Seletor de período De / Até — atalhos + "Data inicial" e "Data final" digitáveis + calendário (PLANO-NFE NFE-13).
 *
 * Nasceu no Rastreio de Compras e virou componente comum (NFE-5 / NFSE-1.14) para as telas de Notas Fiscais e Notas de
 * Serviço. Em 11/11/2026 (Pedro: "quero poder selecionar a data inicial e final. Deixe profissional"):
 *   - dois campos no topo; o campo ativo fica destacado e é ele que o calendário preenche — depois da inicial, o foco
 *     passa sozinho para a final (antes, 1º clique = início, 2º = fim, e ajustar só uma ponta era confuso);
 *   - os campos aceitam digitar (dd/mm/aaaa, com máscara); o calendário vai para o mês digitado;
 *   - mês e ano por lista (sem voltar mês a mês para outro ano), prévia do intervalo ao passar o mouse,
 *     contagem de dias, final antes da inicial = troca as duas, Enter aplica, 1 mês só em tela pequena.
 * Regras puras em `@/lib/periodo` (com teste). Datas sempre "YYYY-MM-DD" no fuso local, sem hora.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DateRange } from "react-day-picker";
import { endOfMonth, endOfYear, format, startOfMonth, startOfYear, subDays, subMonths, subYears } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowRight, Calendar as CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  diasNoPeriodo,
  escolherDia,
  formatarDataBR,
  lerDataDigitada,
  mascaraData,
  periodoFinal,
  type CampoPeriodo,
  type RascunhoPeriodo,
} from "@/lib/periodo";

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

const ANO_MIN = 2023;

/** Estilo da lista de mês/ano do react-day-picker 8 (o `select` fica invisível por cima do rótulo). */
const CLASSES_LISTAS = {
  caption: "flex justify-center pt-1 relative items-center",
  caption_dropdowns: "flex items-center justify-center gap-1",
  dropdown_month: "relative inline-flex items-center",
  dropdown_year: "relative inline-flex items-center",
  dropdown: "absolute inset-0 z-10 w-full cursor-pointer opacity-0",
  caption_label: "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium capitalize hover:bg-accent",
  dropdown_icon: "h-3 w-3 opacity-60",
  vhidden: "sr-only",
};

export function PeriodoPicker({
  valor,
  onChange,
  permitirTudo = true,
}: {
  valor: Periodo;
  onChange: (p: Periodo) => void;
  permitirTudo?: boolean;
}) {
  const pequeno = useIsMobile();
  const [aberto, setAberto] = useState(false);
  const [r, setR] = useState<RascunhoPeriodo>({ de: valor.de, ate: valor.ate, ativo: "de" });
  const [texto, setTexto] = useState<Record<CampoPeriodo, string>>({ de: "", ate: "" });
  const [mes, setMes] = useState<Date>(() => dataLocal(valor.de) ?? subMonths(new Date(), 1));
  const [hover, setHover] = useState<string | null>(null);
  const refDe = useRef<HTMLInputElement>(null);
  const refAte = useRef<HTMLInputElement>(null);
  const refCaixa = useRef<HTMLDivElement>(null);

  // Ao abrir: parte do período aplicado, com o foco na data inicial.
  useEffect(() => {
    if (!aberto) return;
    setR({ de: valor.de, ate: valor.ate, ativo: "de" });
    setTexto({ de: formatarDataBR(valor.de), ate: formatarDataBR(valor.ate) });
    setMes(dataLocal(valor.de) ?? subMonths(new Date(), 1));
    setHover(null);
  }, [aberto, valor.de, valor.ate]);

  const mudar = (novo: RascunhoPeriodo) => {
    setR(novo);
    setTexto({ de: formatarDataBR(novo.de), ate: formatarDataBR(novo.ate) });
  };

  const ativar = (campo: CampoPeriodo) => setR((x) => ({ ...x, ativo: campo }));

  const digitar = (campo: CampoPeriodo, valorDigitado: string) => {
    const m = mascaraData(valorDigitado);
    setTexto((t) => ({ ...t, [campo]: m }));
    const iso = lerDataDigitada(m);
    if (!iso) return;
    setR((x) => ({ ...x, [campo]: iso }));
    // vai para o mês digitado (na final, ela aparece no 2º mês quando há dois)
    const d = dataLocal(iso)!;
    setMes(campo === "ate" && !pequeno ? subMonths(startOfMonth(d), 1) : d);
  };

  const sairDoCampo = (campo: CampoPeriodo) => {
    // texto incompleto ou data que não existe: volta a mostrar a data que vale
    setTexto((t) => ({ ...t, [campo]: formatarDataBR(campo === "de" ? r.de : r.ate) }));
  };

  // Sem foco programático nos campos: no celular abriria o teclado. O campo ativo fica destacado.
  const clicarDia = (d: Date) => {
    mudar(escolherDia(r, isoDia(d)));
    setHover(null);
  };

  const final = periodoFinal(r);
  const aplicar = () => {
    if (!final) return;
    onChange(final);
    setAberto(false);
  };
  const aplicarAtalho = (p: Periodo) => {
    onChange(p);
    setAberto(false);
  };
  const teclar = (e: KeyboardEvent) => {
    if (e.key === "Enter" && final) {
      e.preventDefault();
      aplicar();
    }
  };

  // O que o calendário mostra: o rascunho; escolhendo a final, a prévia até o dia sob o mouse.
  const de = dataLocal(r.de) ?? undefined;
  const previa = r.ativo === "ate" && r.de && hover && hover >= r.de ? hover : null;
  const ate = dataLocal(previa ?? r.ate) ?? undefined;
  const selecionado: DateRange | undefined = de ? { from: de, to: ate } : undefined;
  const dias = diasNoPeriodo(r.de, r.ate);

  const campo = (qual: CampoPeriodo, rotulo: string, ref: typeof refDe) => (
    <label
      className={cn(
        "flex min-w-0 flex-1 cursor-text flex-col gap-0.5 rounded-md border px-2.5 py-1.5 transition-colors",
        r.ativo === qual ? "border-primary ring-2 ring-primary/30" : "border-input hover:border-foreground/30",
      )}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</span>
      <input
        ref={ref}
        value={texto[qual]}
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        aria-label={rotulo}
        className="w-full min-w-0 bg-transparent text-sm tabular-nums outline-none placeholder:text-muted-foreground/60"
        onFocus={() => ativar(qual)}
        onChange={(e) => digitar(qual, e.target.value)}
        onBlur={() => sairDoCampo(qual)}
      />
    </label>
  );

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 max-w-full justify-start gap-2 font-normal">
          <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{rotuloPeriodo(valor)}</span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="w-auto max-w-[calc(100vw-1rem)] p-0"
        onKeyDown={teclar}
        onOpenAutoFocus={(e) => {
          // Computador: já pode digitar a data inicial. Celular: foco na caixa (sem abrir o teclado), e o Enter vale.
          e.preventDefault();
          (pequeno ? refCaixa.current : refDe.current)?.focus({ preventScroll: true });
        }}
      >
        <div ref={refCaixa} tabIndex={-1} className="flex flex-col outline-none sm:flex-row">
          {/* Atalhos */}
          <div className="flex flex-row flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
            {atalhosPeriodo(permitirTudo).map((a) => (
              <Button
                key={a.label}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 justify-start px-2.5 font-normal sm:h-9 sm:px-3",
                  a.periodo.de === valor.de && a.periodo.ate === valor.ate && "bg-accent font-medium",
                )}
                onClick={() => aplicarAtalho(a.periodo)}
              >
                {a.label}
              </Button>
            ))}
          </div>

          <div className="flex min-w-0 flex-col">
            {/* Data inicial → Data final */}
            <div className="flex items-center gap-2 border-b p-3">
              {campo("de", "Data inicial", refDe)}
              <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              {campo("ate", "Data final", refAte)}
            </div>
            <p className="px-3 pt-2 text-[11px] text-muted-foreground">
              {r.ativo === "de" ? "Escolha a data inicial no calendário ou digite." : "Agora escolha a data final."}
            </p>

            <CalendarComponent
              mode="range"
              locale={ptBR}
              numberOfMonths={pequeno ? 1 : 2}
              captionLayout="dropdown-buttons"
              fromYear={ANO_MIN}
              toYear={new Date().getFullYear() + 1}
              month={mes}
              onMonthChange={setMes}
              selected={selecionado}
              onDayClick={clicarDia}
              onDayMouseEnter={(d) => setHover(isoDia(d))}
              onDayMouseLeave={() => setHover(null)}
              classNames={CLASSES_LISTAS}
              className="pt-2"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {final ? (
                  <>
                    {fData(final.de)} – {fData(final.ate)}
                    <span className="ml-2 font-medium text-foreground">
                      {dias} {dias === 1 ? "dia" : "dias"}
                    </span>
                  </>
                ) : (
                  "Nenhuma data escolhida"
                )}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
                  Cancelar
                </Button>
                <Button size="sm" disabled={!final} onClick={aplicar}>
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
