import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2, AlertTriangle } from "lucide-react";

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

// Shape interno da tabela stock_products (fonte de verdade)
interface StockProductRow {
  codigo_produto: string;
  nome_produto: string;
  codigo_reduzido: string | null;
  codigo_alternativo: string | null;
  classificacao_fiscal: string | null;
  tipo_produto_fiscal: string | null;
}

/** Quantos resultados trazer por busca. Acima disso, avisamos para refinar. */
const MAX_RESULTADOS = 30;

export function ProductCombobox({ value, displayValue, onSelect, className }: ProductComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [truncado, setTruncado] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);
  // Guarda contra corrida: só a resposta da busca MAIS RECENTE pode escrever no
  // estado. Sem isso, uma consulta lenta pode sobrescrever o resultado de uma
  // digitação posterior (o usuário vê resultado que não corresponde ao que digitou).
  const buscaIdRef = useRef(0);

  useEffect(() => {
    if (search.length < 2) {
      setResults([]);
      setErro(null);
      setTruncado(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const buscaId = ++buscaIdRef.current;
      setLoading(true);
      setErro(null);

      // ⚠️ ESCAPE OBRIGATÓRIO: vírgula e parênteses são separadores do `or()` do
      // PostgREST — sem tratar, um termo como "ÁCIDO (P.A.), 500ml" quebra a
      // query e o usuário via "nenhum produto encontrado" (mensagem enganosa,
      // que sugeria sincronizar o catálogo quando o problema era a busca).
      // Mesmo tratamento usado em SuprimentosPedidos.tsx.
      const termo = search.replace(/[,()]/g, " ").trim();
      if (termo.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      const padrao = `%${termo}%`;

      // (supabase as any) pra contornar tipos desatualizados — padrão do projeto
      const { data, error } = await (supabase as any)
        .from("stock_products")
        .select(
          "codigo_produto, nome_produto, codigo_reduzido, codigo_alternativo, classificacao_fiscal, tipo_produto_fiscal",
        )
        // Busca também por código REDUZIDO e ALTERNATIVO: a operadora costuma
        // conhecer o produto pelo código da planilha do fornecedor, não pelo
        // código principal do Alvo.
        .or(
          [
            `nome_produto.ilike.${padrao}`,
            `codigo_produto.ilike.${padrao}`,
            `codigo_reduzido.ilike.${padrao}`,
            `codigo_alternativo.ilike.${padrao}`,
          ].join(","),
        )
        .eq("ativo", true)
        .order("nome_produto")
        .limit(MAX_RESULTADOS);

      // Resposta de uma busca antiga chegou depois — descarta.
      if (buscaId !== buscaIdRef.current) return;

      if (error) {
        // Falha GRITA em vez de virar "nenhum produto encontrado": a mensagem
        // antiga mandava sincronizar o catálogo mesmo quando o erro era outro.
        console.error("[ProductCombobox] erro na busca:", error);
        setErro(error.message || "Falha ao consultar o catálogo");
        setResults([]);
        setTruncado(false);
        setLoading(false);
        return;
      }

      const rows = (data as StockProductRow[] | null) || [];

      // Mapeia o shape do stock_products pro shape Product (mantém compatibilidade com consumers)
      const mapped: Product[] = rows.map((row) => ({
        codigo: row.codigo_produto,
        nome: row.nome_produto,
        codigo_clas_fiscal: row.classificacao_fiscal,
        codigo_tipo_prod_fisc: row.tipo_produto_fiscal,
      }));

      setResults(mapped);
      setTruncado(rows.length === MAX_RESULTADOS);
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
    <div ref={containerRef} className="relative z-20" data-product-combobox-dropdown="true">
      <Input
        value={open ? search : displayValue}
        onChange={(e) => {
          setSearch(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setSearch(value ? displayValue : "");
        }}
        placeholder="Buscar produto (nome ou código)..."
        className={cn("h-9 text-sm", className)}
      />

      {open && (
        <div
          className="absolute left-0 top-full z-[80] mt-1 max-h-60 w-full min-w-[280px] overflow-y-auto rounded-md border bg-popover text-sm shadow-lg"
          data-product-combobox-dropdown="true"
        >
          {loading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && erro && (
            <div className="flex items-start gap-2 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Erro ao buscar produtos: {erro}. Tente de novo ou avise o suporte.</span>
            </div>
          )}

          {!loading && !erro && search.length < 2 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Digite 2+ caracteres para buscar...</p>
          )}

          {!loading && !erro && search.length >= 2 && results.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Nenhum produto encontrado. Se o produto foi cadastrado agora no ERP, sincronize o catálogo em Importação
              de Produtos.
            </p>
          )}

          {!loading &&
            !erro &&
            results.map((product) => (
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

          {/* Truncamento visível: sem isso o usuário não sabe que existem mais
              resultados além dos exibidos e conclui que o produto "não existe". */}
          {!loading && !erro && truncado && (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Mostrando os {MAX_RESULTADOS} primeiros — refine a busca para ver outros.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
