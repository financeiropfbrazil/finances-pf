/**
 * Funil no cabeçalho da coluna — filtro no estilo do Excel (PLANO-NFE NFE-12). As regras ficam em
 * `@/lib/filtroColunas`; aqui só a caixa: lista de valores com busca, "contém" ou mínimo/máximo.
 * Reutilizável em outras tabelas (a NFS-e, por exemplo).
 */
import { useState } from "react";
import { Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { filtroAtivo, lerNumeroDigitado, type FiltroColuna, type TipoFiltroColuna } from "@/lib/filtroColunas";

export interface OpcaoFiltro {
  valor: string;
  rotulo: string;
  n: number;
}

interface Props {
  rotulo: string;
  tipo: TipoFiltroColuna;
  filtro: FiltroColuna | undefined;
  onChange: (f: FiltroColuna | undefined) => void;
  /** "valores": as opções (já em cascata com os outros filtros). */
  opcoes?: OpcaoFiltro[];
  alinhar?: "start" | "end";
  desabilitado?: boolean;
  motivoDesabilitado?: string;
}

export function FiltroCabecalho({
  rotulo,
  tipo,
  filtro,
  onChange,
  opcoes = [],
  alinhar = "start",
  desabilitado = false,
  motivoDesabilitado,
}: Props) {
  const ativo = filtroAtivo(filtro);
  // muda ao limpar, para os campos digitados (mín./máx.) voltarem vazios
  const [versao, setVersao] = useState(0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={desabilitado}
          aria-label={`Filtrar ${rotulo}`}
          title={desabilitado ? motivoDesabilitado : ativo ? `Filtro ativo em ${rotulo}` : `Filtrar ${rotulo}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted disabled:opacity-40",
            ativo ? "text-primary" : "text-muted-foreground/60",
          )}
        >
          <Filter className={cn("h-3 w-3", ativo && "fill-current")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align={alinhar} className="w-72 p-2" onClick={(e) => e.stopPropagation()}>
        <p className="mb-2 px-1 text-xs font-semibold text-foreground">Filtrar: {rotulo}</p>
        {tipo === "valores" && <ListaValores key={versao} filtro={filtro} onChange={onChange} opcoes={opcoes} />}
        {tipo === "texto" && <FiltroTexto key={versao} filtro={filtro} onChange={onChange} />}
        {tipo === "intervalo" && <FiltroIntervalo key={versao} filtro={filtro} onChange={onChange} />}
        <div className="mt-2 flex justify-end border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={!ativo}
            onClick={() => {
              onChange(undefined);
              setVersao((v) => v + 1);
            }}
          >
            Limpar filtro
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ListaValores({
  filtro,
  onChange,
  opcoes,
}: {
  filtro: FiltroColuna | undefined;
  onChange: (f: FiltroColuna | undefined) => void;
  opcoes: OpcaoFiltro[];
}) {
  const [busca, setBusca] = useState("");
  // null = sem filtro (tudo marcado)
  const aceitos = filtro?.tipo === "valores" ? new Set(filtro.aceitos) : null;
  const marcado = (v: string) => (aceitos ? aceitos.has(v) : true);
  const termo = busca.trim().toLowerCase();
  const visiveis = termo ? opcoes.filter((o) => o.rotulo.toLowerCase().includes(termo)) : opcoes;
  const todosVisiveisMarcados = visiveis.length > 0 && visiveis.every((o) => marcado(o.valor));

  /** Grava a seleção; se tudo da lista estiver marcado, o filtro some (como no Excel). */
  const gravar = (novo: Set<string>) => {
    if (opcoes.every((o) => novo.has(o.valor))) onChange(undefined);
    else onChange({ tipo: "valores", aceitos: [...novo] });
  };
  const base = () => new Set(aceitos ?? opcoes.map((o) => o.valor));
  const alternar = (v: string) => {
    const novo = base();
    if (novo.has(v)) novo.delete(v);
    else novo.add(v);
    gravar(novo);
  };
  const alternarVisiveis = () => {
    const novo = base();
    for (const o of visiveis) {
      if (todosVisiveisMarcados) novo.delete(o.valor);
      else novo.add(o.valor);
    }
    gravar(novo);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        placeholder="Buscar..."
        className="h-7 text-xs"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        autoFocus
      />
      <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs font-medium hover:bg-muted">
        <Checkbox checked={todosVisiveisMarcados} onCheckedChange={alternarVisiveis} disabled={visiveis.length === 0} />
        {termo ? "Selecionar os da busca" : "Selecionar tudo"}
      </label>
      <div className="max-h-60 overflow-auto border-t border-border pt-1">
        {visiveis.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">Nada encontrado.</p>
        ) : (
          visiveis.map((o) => (
            <label
              key={o.valor}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted"
              title={o.rotulo}
            >
              <Checkbox checked={marcado(o.valor)} onCheckedChange={() => alternar(o.valor)} />
              <span className="min-w-0 flex-1 truncate">{o.rotulo}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{o.n}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function FiltroTexto({ filtro, onChange }: { filtro: FiltroColuna | undefined; onChange: (f: FiltroColuna | undefined) => void }) {
  const valor = filtro?.tipo === "texto" ? filtro.texto : "";
  return (
    <Input
      placeholder="Contém..."
      className="h-7 text-xs"
      value={valor}
      autoFocus
      onChange={(e) => onChange(e.target.value.trim() ? { tipo: "texto", texto: e.target.value } : undefined)}
    />
  );
}

function FiltroIntervalo({ filtro, onChange }: { filtro: FiltroColuna | undefined; onChange: (f: FiltroColuna | undefined) => void }) {
  const atual = filtro?.tipo === "intervalo" ? filtro : { tipo: "intervalo" as const, min: null, max: null };
  const [min, setMin] = useState(atual.min !== null ? String(atual.min).replace(".", ",") : "");
  const [max, setMax] = useState(atual.max !== null ? String(atual.max).replace(".", ",") : "");
  const gravar = (smin: string, smax: string) => {
    const nmin = lerNumeroDigitado(smin);
    const nmax = lerNumeroDigitado(smax);
    onChange(nmin === null && nmax === null ? undefined : { tipo: "intervalo", min: nmin, max: nmax });
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Mínimo
        <Input
          inputMode="decimal"
          className="h-7 text-xs"
          value={min}
          autoFocus
          onChange={(e) => {
            setMin(e.target.value);
            gravar(e.target.value, max);
          }}
        />
      </label>
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Máximo
        <Input
          inputMode="decimal"
          className="h-7 text-xs"
          value={max}
          onChange={(e) => {
            setMax(e.target.value);
            gravar(min, e.target.value);
          }}
        />
      </label>
    </div>
  );
}
