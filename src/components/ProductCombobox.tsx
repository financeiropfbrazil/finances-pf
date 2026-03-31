import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface Product {
  codigo: string;
  nome: string;
  codigo_clas_fiscal: string | null;
  codigo_tipo_prod_fisc: string | null;
}

interface ProductComboboxProps {
  value: string;
  displayValue: string;
  onSelect: (product: Product) => void;
  className?: string;
}

export function ProductCombobox({ value, displayValue, onSelect, className }: ProductComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (search.length < 2) {
      setResults([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase
        .from("produtos_cache")
        .select("codigo, nome, codigo_clas_fiscal, codigo_tipo_prod_fisc")
        .or(`nome.ilike.%${search}%,codigo.ilike.%${search}%`)
        .eq("status", "Ativado")
        .limit(20)
        .order("nome");
      setResults(data || []);
      setLoading(false);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} className="relative z-20">
      <Input
        value={open ? search : displayValue}
        onChange={e => {
          setSearch(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setSearch(value ? displayValue : "");
        }}
        placeholder="Buscar produto..."
        className={cn("h-9 text-sm", className)}
      />

      {open && (
        <div className="absolute left-0 top-full z-[80] mt-1 max-h-60 w-full min-w-[280px] overflow-y-auto rounded-md border bg-popover text-sm shadow-lg">
          {loading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && search.length < 2 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Digite 2+ caracteres para buscar...</p>
          )}

          {!loading && search.length >= 2 && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Nenhum produto encontrado. Sincronize o catálogo em Configurações.
            </p>
          )}

          {!loading && results.map((product) => (
            <button
              key={product.codigo}
              type="button"
              className="flex w-full items-start gap-1 px-3 py-2 text-left hover:bg-accent"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(product);
                setOpen(false);
                setSearch("");
              }}
            >
              <span className="font-medium">{product.codigo}</span>
              <span className="text-muted-foreground">— {product.nome}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
