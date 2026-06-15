// src/components/compras/LancarNfeItensTable.tsx
//
// Etapa B / Fatia 2b — Tabela de itens do lançamento de NF-e.
// Componente separado (filho do LancarNfeModalV2) para isolar a complexidade.
//
// SUB-FATIA 2b-i (revisada): tabela pré-populada com os itens do XML (Opção A).
// O seletor de produto usa Popover+Command (renderiza em PORTAL) — assim a
// lista de opções nunca fica atrás dos campos das linhas de baixo, problema
// que o ProductCombobox (posicionamento absoluto) tinha dentro da tabela.
// Mesmo padrão do rateio de classe/CC do SuprimentosPedidoNovo.
//
// A query já traz unidade_medida e controla_lote — sem busca complementar.
//
// AINDA NÃO TEM: dropdown de natureza (2b-ii) nem classe/CC (2b-iii).

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Trash2, Plus, AlertTriangle, ChevronsUpDown, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ItemXml {
  numero_item: number;
  codigo_produto: string; // código do FORNECEDOR
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total: number | null;
  imposto?: any; // do parseNfeXml (C1)
}

export interface ItemLancamento {
  origemXml: ItemXml;
  produtoInterno: string | null;
  produtoNome: string | null;
  unidade: string | null;
  controlaLote: boolean;
  codigoAlternativo: string | null;
  classificacaoFiscal: string | null;
  quantidade: number;
  valorUnitario: number;
  valorProduto: number;
}

interface ProdutoBusca {
  codigo_produto: string;
  nome_produto: string;
  unidade_medida: string | null;
  controla_lote: boolean | null;
  codigo_alternativo: string | null;
  classificacao_fiscal: string | null;
}

interface LancarNfeItensTableProps {
  itensXml: ItemXml[];
  onChange: (itens: ItemLancamento[]) => void;
}

const fmtMoeda = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function linhaInicial(itemXml: ItemXml): ItemLancamento {
  const qtd = itemXml.quantidade ?? 0;
  const vUnit = itemXml.valor_unitario ?? 0;
  return {
    origemXml: itemXml,
    produtoInterno: null,
    produtoNome: null,
    unidade: itemXml.unidade || null,
    controlaLote: false,
    codigoAlternativo: null,
    classificacaoFiscal: null,
    quantidade: qtd,
    valorUnitario: vUnit,
    valorProduto: Number((qtd * vUnit).toFixed(2)),
  };
}

// ── Seletor de produto (Popover + Command, em portal) ──────────────────────

function ProdutoSelector({
  value,
  displayValue,
  onSelect,
}: {
  value: string | null;
  displayValue: string;
  onSelect: (p: ProdutoBusca) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ProdutoBusca[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (search.length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("stock_products")
        .select("codigo_produto, nome_produto, unidade_medida, controla_lote, codigo_alternativo, classificacao_fiscal")
        .or(`nome_produto.ilike.%${search}%,codigo_produto.ilike.%${search}%`)
        .eq("ativo", true)
        .limit(20)
        .order("nome_produto");
      setResults((data as ProdutoBusca[] | null) || []);
      setLoading(false);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-9 text-xs">
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? displayValue : "Buscar produto..."}
          </span>
          <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[280px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Digite 2+ letras..." value={search} onValueChange={setSearch} />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && search.length < 2 && <CommandEmpty>Digite 2+ caracteres para buscar.</CommandEmpty>}
            {!loading && search.length >= 2 && results.length === 0 && (
              <CommandEmpty>Nenhum produto encontrado.</CommandEmpty>
            )}
            <CommandGroup>
              {results.map((p) => (
                <CommandItem
                  key={p.codigo_produto}
                  value={p.codigo_produto}
                  onSelect={() => {
                    onSelect(p);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="text-xs"
                >
                  <Check className={cn("mr-2 h-3 w-3", value === p.codigo_produto ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono mr-2">{p.codigo_produto}</span>
                  <span className="truncate text-muted-foreground">{p.nome_produto}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Tabela ─────────────────────────────────────────────────────────────────

export function LancarNfeItensTable({ itensXml, onChange }: LancarNfeItensTableProps) {
  const [itens, setItens] = useState<ItemLancamento[]>([]);

  useEffect(() => {
    setItens((itensXml || []).map(linhaInicial));
  }, [itensXml]);

  useEffect(() => {
    onChange(itens);
  }, [itens, onChange]);

  const atualizarLinha = useCallback((idx: number, patch: Partial<ItemLancamento>) => {
    setItens((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const merged = { ...it, ...patch };
        merged.valorProduto = Number((merged.quantidade * merged.valorUnitario).toFixed(2));
        return merged;
      }),
    );
  }, []);

  const onSelecionarProduto = useCallback(
    (idx: number, p: ProdutoBusca) => {
      atualizarLinha(idx, {
        produtoInterno: p.codigo_produto,
        produtoNome: p.nome_produto,
        unidade: p.unidade_medida || null,
        controlaLote: !!p.controla_lote,
        codigoAlternativo: p.codigo_alternativo || null,
        classificacaoFiscal: p.classificacao_fiscal || null,
      });
    },
    [atualizarLinha],
  );

  const removerLinha = (idx: number) => setItens((prev) => prev.filter((_, i) => i !== idx));

  const adicionarLinha = () =>
    setItens((prev) => [
      ...prev,
      linhaInicial({
        numero_item: prev.length + 1,
        codigo_produto: "",
        descricao: "(item manual)",
        ncm: null,
        cfop: null,
        unidade: null,
        quantidade: 0,
        valor_unitario: 0,
        valor_total: 0,
      }),
    ]);

  const totalGeral = itens.reduce((s, it) => s + it.valorProduto, 0);
  const algumSemProduto = itens.some((it) => !it.produtoInterno);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Itens do lançamento</h4>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={adicionarLinha}>
          <Plus className="h-3 w-3" /> Adicionar item
        </Button>
      </div>

      <div className="rounded-md border">
        <table className="w-full table-fixed text-xs">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2 font-medium w-[28%]">Item da NF (fornecedor)</th>
              <th className="p-2 font-medium w-[34%]">Produto interno</th>
              <th className="p-2 font-medium text-right w-[11%]">Qtd.</th>
              <th className="p-2 font-medium text-right w-[13%]">V. unit.</th>
              <th className="p-2 font-medium text-right w-[14%]">Total</th>
              <th className="p-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {itens.map((it, idx) => (
              <tr key={idx} className="border-t align-top">
                <td className="p-2">
                  <p className="truncate" title={it.origemXml.descricao}>
                    {it.origemXml.descricao || "—"}
                  </p>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
                    {it.origemXml.codigo_produto && <span>cód. forn.: {it.origemXml.codigo_produto}</span>}
                    {it.origemXml.ncm && <span>NCM {it.origemXml.ncm}</span>}
                    {it.origemXml.cfop && <span>CFOP {it.origemXml.cfop}</span>}
                  </div>
                </td>

                <td className="p-2">
                  <ProdutoSelector
                    value={it.produtoInterno}
                    displayValue={it.produtoInterno ? `${it.produtoInterno} — ${it.produtoNome || ""}` : ""}
                    onSelect={(p) => onSelecionarProduto(idx, p)}
                  />
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {it.produtoInterno ? (
                      <>
                        <span>un.: {it.unidade || "—"}</span>
                        {it.controlaLote && (
                          <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                            lote
                          </Badge>
                        )}
                      </>
                    ) : (
                      <span className="flex items-center gap-1 text-amber-600">
                        <AlertTriangle className="h-3 w-3" /> escolha o produto
                      </span>
                    )}
                  </div>
                </td>

                <td className="p-2 text-right">
                  <Input
                    type="number"
                    value={it.quantidade}
                    onChange={(e) => atualizarLinha(idx, { quantidade: Number(e.target.value) || 0 })}
                    className="h-8 text-right text-xs"
                  />
                </td>

                <td className="p-2 text-right">
                  <Input
                    type="number"
                    step="0.01"
                    value={it.valorUnitario}
                    onChange={(e) => atualizarLinha(idx, { valorUnitario: Number(e.target.value) || 0 })}
                    className="h-8 text-right text-xs"
                  />
                </td>

                <td className="p-2 text-right whitespace-nowrap font-medium">{fmtMoeda(it.valorProduto)}</td>

                <td className="p-2">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => removerLinha(idx)}>
                    <Trash2 className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </td>
              </tr>
            ))}

            {itens.length === 0 && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-muted-foreground">
                  Nenhum item. Use "Adicionar item" para incluir manualmente.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30">
              <td colSpan={4} className="p-2 text-right text-muted-foreground">
                Total dos itens
              </td>
              <td className="p-2 text-right font-semibold">{fmtMoeda(totalGeral)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {algumSemProduto && (
        <p className="flex items-center gap-1 text-[11px] text-amber-600">
          <AlertTriangle className="h-3 w-3" />
          Todos os itens precisam de um produto interno antes de lançar.
        </p>
      )}
    </div>
  );
}
