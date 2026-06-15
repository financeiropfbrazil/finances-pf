// src/components/compras/LancarNfeItensTable.tsx
//
// Etapa B / Fatia 2b — Tabela de itens do lançamento de NF-e.
// Componente separado (filho do LancarNfeModalV2) para isolar a complexidade.
//
// SUB-FATIA 2b-i: tabela pré-populada com os itens do XML (Opção A).
// Cada linha mostra o que veio na NF (descrição do fornecedor, qtd, valor) e,
// ao lado, a operadora escolhe o PRODUTO INTERNO (ProductCombobox) e ajusta
// quantidade/valor. A unidade e o controla_lote vêm de uma busca complementar
// em stock_products (o ProductCombobox não devolve esses campos).
//
// AINDA NÃO TEM: dropdown de natureza (2b-ii) nem classe/CC (2b-iii).
//
// O componente sobe o estado dos itens para o pai via onChange, para o modal
// poder montar o payload depois.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ProductCombobox } from "@/components/ProductCombobox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Loader2, AlertTriangle } from "lucide-react";

// ── Tipos ──────────────────────────────────────────────────────────────────

/** Item do XML (de dados_extraidos.itens). */
export interface ItemXml {
  numero_item: number;
  codigo_produto: string; // código do FORNECEDOR (não serve p/ Alvo)
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total: number | null;
  imposto?: any; // do parseNfeXml (C1) — usado na fatia de impostos
}

/** Linha de lançamento: o item do XML + o de-para que a operadora montou. */
export interface ItemLancamento {
  // referência ao XML (origem)
  origemXml: ItemXml;
  // de-para interno (escolhido pela operadora)
  produtoInterno: string | null; // codigo_produto do stock_products
  produtoNome: string | null;
  unidade: string | null; // do cadastro, editável
  controlaLote: boolean;
  codigoAlternativo: string | null;
  classificacaoFiscal: string | null;
  // valores (operadora ajusta)
  quantidade: number;
  valorUnitario: number;
  valorProduto: number;
}

interface LancarNfeItensTableProps {
  itensXml: ItemXml[];
  onChange: (itens: ItemLancamento[]) => void;
}

const fmtMoeda = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Cria uma linha de lançamento inicial a partir de um item do XML (sem de-para).
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

export function LancarNfeItensTable({ itensXml, onChange }: LancarNfeItensTableProps) {
  const [itens, setItens] = useState<ItemLancamento[]>([]);
  const [buscandoProduto, setBuscandoProduto] = useState<number | null>(null);

  // Pré-popula a tabela com os itens do XML (Opção A) ao montar/trocar de nota.
  useEffect(() => {
    setItens((itensXml || []).map(linhaInicial));
  }, [itensXml]);

  // Sempre que itens muda, avisa o pai.
  useEffect(() => {
    onChange(itens);
  }, [itens, onChange]);

  // Atualiza uma linha por índice.
  const atualizarLinha = useCallback((idx: number, patch: Partial<ItemLancamento>) => {
    setItens((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const merged = { ...it, ...patch };
        // recalcula o total se qtd ou valor unitário mudaram
        merged.valorProduto = Number((merged.quantidade * merged.valorUnitario).toFixed(2));
        return merged;
      }),
    );
  }, []);

  // Busca complementar em stock_products (o ProductCombobox não traz unidade/lote).
  const onSelecionarProduto = useCallback(
    async (idx: number, codigo: string, nome: string) => {
      setBuscandoProduto(idx);
      try {
        const { data } = await (supabase as any)
          .from("stock_products")
          .select(
            "codigo_produto, nome_produto, unidade_medida, controla_lote, codigo_alternativo, classificacao_fiscal",
          )
          .eq("codigo_produto", codigo)
          .maybeSingle();

        atualizarLinha(idx, {
          produtoInterno: codigo,
          produtoNome: data?.nome_produto || nome,
          unidade: data?.unidade_medida || null,
          controlaLote: !!data?.controla_lote,
          codigoAlternativo: data?.codigo_alternativo || null,
          classificacaoFiscal: data?.classificacao_fiscal || null,
        });
      } catch {
        // Sem dados complementares: registra ao menos código/nome do combobox.
        atualizarLinha(idx, { produtoInterno: codigo, produtoNome: nome });
      } finally {
        setBuscandoProduto(null);
      }
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
              <th className="p-2 font-medium">Item da NF (fornecedor)</th>
              <th className="p-2 font-medium min-w-[220px]">Produto interno</th>
              <th className="p-2 font-medium text-right">Qtd.</th>
              <th className="p-2 font-medium text-right">V. unit.</th>
              <th className="p-2 font-medium text-right">Total</th>
              <th className="p-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {itens.map((it, idx) => (
              <tr key={idx} className="border-t align-top">
                {/* Origem (XML do fornecedor) */}
                <td className="p-2 max-w-[200px]">
                  <p className="truncate" title={it.origemXml.descricao}>
                    {it.origemXml.descricao || "—"}
                  </p>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                    {it.origemXml.codigo_produto && <span>cód. forn.: {it.origemXml.codigo_produto}</span>}
                    {it.origemXml.ncm && <span>NCM {it.origemXml.ncm}</span>}
                    {it.origemXml.cfop && <span>CFOP {it.origemXml.cfop}</span>}
                  </div>
                </td>

                {/* De-para: produto interno */}
                <td className="p-2">
                  <ProductCombobox
                    value={it.produtoInterno || ""}
                    displayValue={it.produtoInterno ? `${it.produtoInterno} — ${it.produtoNome || ""}` : ""}
                    onSelect={(p) => onSelecionarProduto(idx, p.codigo, p.nome)}
                  />
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    {buscandoProduto === idx ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> carregando dados...
                      </span>
                    ) : it.produtoInterno ? (
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

                {/* Quantidade */}
                <td className="p-2 text-right">
                  <Input
                    type="number"
                    value={it.quantidade}
                    onChange={(e) => atualizarLinha(idx, { quantidade: Number(e.target.value) || 0 })}
                    className="h-8 w-20 text-right text-xs"
                  />
                </td>

                {/* Valor unitário */}
                <td className="p-2 text-right">
                  <Input
                    type="number"
                    step="0.01"
                    value={it.valorUnitario}
                    onChange={(e) => atualizarLinha(idx, { valorUnitario: Number(e.target.value) || 0 })}
                    className="h-8 w-24 text-right text-xs"
                  />
                </td>

                {/* Total da linha */}
                <td className="p-2 text-right whitespace-nowrap font-medium">{fmtMoeda(it.valorProduto)}</td>

                {/* Remover */}
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
