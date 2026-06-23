// src/components/cartao/EntidadeCombobox.tsx
import { useState, useEffect, useRef, useCallback } from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { buscarEntidades, loadEntidadePorCodigo, type EntidadeOption } from "@/services/cartaoImportService";

interface EntidadeComboboxProps {
  value: string | null; // codigo_entidade selecionado
  onChange: (codigo: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** Formata o rótulo de exibição da entidade. */
function labelEntidade(e: EntidadeOption): string {
  const nome = e.nome_fantasia || e.nome;
  const cnpjFmt = e.cnpj ? ` · ${formatCnpj(e.cnpj)}` : "";
  return `${nome}${cnpjFmt}`;
}

function formatCnpj(cnpj: string): string {
  const d = cnpj.replace(/\D/g, "").padStart(14, "0");
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function EntidadeCombobox({
  value,
  onChange,
  disabled,
  placeholder = "Selecionar fornecedor...",
}: EntidadeComboboxProps) {
  const [open, setOpen] = useState(false);
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<EntidadeOption[]>([]);
  const [loading, setLoading] = useState(false);

  // rótulo da entidade atualmente selecionada (carregado por código)
  const [selecionada, setSelecionada] = useState<EntidadeOption | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // carrega o rótulo da entidade pré-selecionada quando o value muda externamente
  useEffect(() => {
    let ativo = true;
    if (!value) {
      setSelecionada(null);
      return;
    }
    // evita refetch se já temos a entidade certa
    if (selecionada?.codigo_entidade === value) return;
    loadEntidadePorCodigo(value).then((e) => {
      if (ativo) setSelecionada(e);
    });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // busca com debounce
  const dispararBusca = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResultados([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const res = await buscarEntidades(q);
      setResultados(res);
      setLoading(false);
    }, 350);
  }, []);

  useEffect(() => {
    dispararBusca(termo);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [termo, dispararBusca]);

  const handleSelect = (e: EntidadeOption) => {
    onChange(e.codigo_entidade);
    setSelecionada(e);
    setOpen(false);
    setTermo("");
    setResultados([]);
  };

  const handleClear = () => {
    onChange(null);
    setSelecionada(null);
    setTermo("");
    setResultados([]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-8 w-full justify-between text-left font-normal", !value && "text-muted-foreground")}
        >
          <span className="truncate text-xs">
            {selecionada ? labelEntidade(selecionada) : value ? value : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] p-0" align="start">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <CommandInput
              placeholder="Buscar por nome ou CNPJ..."
              value={termo}
              onValueChange={setTermo}
              className="h-9 border-0 focus:ring-0"
            />
            {loading && <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50" />}
          </div>
          <CommandList>
            {termo.trim().length < 2 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                Digite ao menos 2 caracteres para buscar.
              </div>
            ) : !loading && resultados.length === 0 ? (
              <CommandEmpty>Nenhum fornecedor encontrado.</CommandEmpty>
            ) : (
              <CommandGroup>
                {resultados.map((e) => (
                  <CommandItem
                    key={e.codigo_entidade}
                    value={e.codigo_entidade}
                    onSelect={() => handleSelect(e)}
                    className="text-xs"
                  >
                    <Check
                      className={cn("mr-2 h-3.5 w-3.5", value === e.codigo_entidade ? "opacity-100" : "opacity-0")}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{e.nome_fantasia || e.nome}</span>
                      <span className="text-muted-foreground">
                        {e.cnpj ? formatCnpj(e.cnpj) : "sem CNPJ"} · cód {e.codigo_entidade}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          {value && (
            <div className="border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full text-xs text-muted-foreground"
                onClick={handleClear}
              >
                Limpar seleção
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
