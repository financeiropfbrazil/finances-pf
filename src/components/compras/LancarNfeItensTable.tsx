// src/components/compras/LancarNfeItensTable.tsx
//
// Etapa B / Fatia 2b — Tabela de itens do lançamento de NF-e.
// Componente separado (filho do LancarNfeModalV2) para isolar a complexidade.
//
// 2b-i: tabela pré-populada do XML; seletor de produto Popover+Command (portal).
// 2b-ii: natureza de operação por item (busca no proxy /mov-estq/nat-operacao).
// 2b-iii: CLASSE e CENTRO DE CUSTO por item (abaixo da natureza, Opção B).
//   - Classe: classes_rec_desp (grupo=F, natureza=Débito)
//   - CC: cost_centers (is_active, group_type=F)
//   - Pré-preenchidos do pedido (props classePedido / ccPedido) quando existirem.
//   - 1 CC a 100% por item (estrutura interna pronta p/ multi-CC no futuro).

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Trash2, Plus, AlertTriangle, ChevronsUpDown, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ItemXml {
  numero_item: number;
  codigo_produto: string;
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total: number | null;
  imposto?: any;
}

export interface ItemLancamento {
  origemXml: ItemXml;
  produtoInterno: string | null;
  produtoNome: string | null;
  unidade: string | null;
  controlaLote: boolean;
  codigoAlternativo: string | null;
  classificacaoFiscal: string | null;
  natureza: string | null;
  naturezaNome: string | null;
  classe: string | null; // codigo da classe (2b-iii)
  classeNome: string | null;
  centroCusto: string | null; // erp_code do CC (2b-iii)
  centroCustoNome: string | null;
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

interface NaturezaOpcao {
  Codigo: string;
  Nome: string;
}
interface ClasseOpcao {
  codigo: string;
  nome: string;
}
interface CcOpcao {
  erp_code: string;
  name: string;
  department_type: string | null;
}

interface LancarNfeItensTableProps {
  itensXml: ItemXml[];
  classePedido?: string | null; // pedido_compra_classe (pré-preenche)
  ccPedido?: string | null; // pedido_compra_centro_custo (pré-preenche)
  onChange: (itens: ItemLancamento[]) => void;
}

const fmtMoeda = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function linhaInicial(itemXml: ItemXml, classePedido?: string | null, ccPedido?: string | null): ItemLancamento {
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
    natureza: null,
    naturezaNome: null,
    classe: classePedido || null, // pré-preenche do pedido
    classeNome: null,
    centroCusto: ccPedido || null, // pré-preenche do pedido
    centroCustoNome: null,
    quantidade: qtd,
    valorUnitario: vUnit,
    valorProduto: Number((qtd * vUnit).toFixed(2)),
  };
}

async function getJwt(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

// ── Seletor de produto ─────────────────────────────────────────────────────

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

// ── Seletor de natureza (busca no proxy) ───────────────────────────────────

function NaturezaSelector({
  value,
  displayValue,
  onSelect,
}: {
  value: string | null;
  displayValue: string;
  onSelect: (n: NaturezaOpcao) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<NaturezaOpcao[]>([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (search.length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setErro(null);
      try {
        const jwt = await getJwt();
        const r = await fetch(`${ERP_PROXY_URL}/mov-estq/nat-operacao`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
          body: JSON.stringify({ search, pageSize: 20 }),
        });
        if (!r.ok) {
          setErro("Erro ao buscar naturezas.");
          setResults([]);
        } else {
          const lista = await r.json();
          setResults(Array.isArray(lista) ? lista : []);
        }
      } catch {
        setErro("Falha de conexão.");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-8 text-[11px]">
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? displayValue : "Natureza de operação..."}
          </span>
          <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar natureza (2+ letras)..." value={search} onValueChange={setSearch} />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && erro && <CommandEmpty>{erro}</CommandEmpty>}
            {!loading && !erro && search.length < 2 && <CommandEmpty>Digite 2+ caracteres.</CommandEmpty>}
            {!loading && !erro && search.length >= 2 && results.length === 0 && (
              <CommandEmpty>Nenhuma natureza encontrada.</CommandEmpty>
            )}
            <CommandGroup>
              {results.map((n) => (
                <CommandItem
                  key={n.Codigo}
                  value={n.Codigo}
                  onSelect={() => {
                    onSelect(n);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="text-[11px]"
                >
                  <Check className={cn("mr-2 h-3 w-3", value === n.Codigo ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono mr-2">{n.Codigo}</span>
                  <span className="truncate text-muted-foreground">{n.Nome}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Seletor genérico de classe/CC (busca local no Supabase) ────────────────

function ClasseCcSelector({
  tipo,
  value,
  displayValue,
  options,
  loading,
  onSelect,
}: {
  tipo: "classe" | "cc";
  value: string | null;
  displayValue: string;
  options: { codigo: string; nome: string }[];
  loading: boolean;
  onSelect: (codigo: string, nome: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const placeholder = tipo === "classe" ? "Classe..." : "Centro de custo...";

  const filtered =
    search.length === 0
      ? options.slice(0, 50)
      : options
          .filter(
            (o) =>
              o.codigo.toLowerCase().includes(search.toLowerCase()) ||
              o.nome.toLowerCase().includes(search.toLowerCase()),
          )
          .slice(0, 50);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal h-8 text-[11px]">
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? displayValue : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={`Buscar ${placeholder.toLowerCase()}`} value={search} onValueChange={setSearch} />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && filtered.length === 0 && <CommandEmpty>Nada encontrado.</CommandEmpty>}
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem
                  key={o.codigo}
                  value={o.codigo}
                  onSelect={() => {
                    onSelect(o.codigo, o.nome);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="text-[11px]"
                >
                  <Check className={cn("mr-2 h-3 w-3", value === o.codigo ? "opacity-100" : "opacity-0")} />
                  <span className="font-mono mr-2">{o.codigo}</span>
                  <span className="truncate text-muted-foreground">{o.nome}</span>
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

export function LancarNfeItensTable({ itensXml, classePedido, ccPedido, onChange }: LancarNfeItensTableProps) {
  const [itens, setItens] = useState<ItemLancamento[]>([]);
  const [classes, setClasses] = useState<ClasseOpcao[]>([]);
  const [ccs, setCcs] = useState<CcOpcao[]>([]);
  const [loadingDrops, setLoadingDrops] = useState(true);

  // Carrega classes e CCs uma vez.
  useEffect(() => {
    (async () => {
      setLoadingDrops(true);
      const [{ data: cls }, { data: cc }] = await Promise.all([
        (supabase as any)
          .from("classes_rec_desp")
          .select("codigo, nome")
          .eq("grupo", "F")
          .eq("natureza", "Débito")
          .eq("is_active", true)
          .order("codigo"),
        (supabase as any)
          .from("cost_centers")
          .select("erp_code, name, department_type")
          .eq("is_active", true)
          .eq("group_type", "F")
          .order("erp_code"),
      ]);
      setClasses((cls as ClasseOpcao[] | null) || []);
      setCcs((cc as CcOpcao[] | null) || []);
      setLoadingDrops(false);
    })();
  }, []);

  useEffect(() => {
    setItens((itensXml || []).map((x) => linhaInicial(x, classePedido, ccPedido)));
  }, [itensXml, classePedido, ccPedido]);

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
      linhaInicial(
        {
          numero_item: prev.length + 1,
          codigo_produto: "",
          descricao: "(item manual)",
          ncm: null,
          cfop: null,
          unidade: null,
          quantidade: 0,
          valor_unitario: 0,
          valor_total: 0,
        },
        classePedido,
        ccPedido,
      ),
    ]);

  const classeOpts = classes.map((c) => ({ codigo: c.codigo, nome: c.nome }));
  const ccOpts = ccs.map((c) => ({ codigo: c.erp_code, nome: c.name }));

  const nomeClasse = (cod: string | null) => classes.find((c) => c.codigo === cod)?.nome || "";
  const nomeCc = (cod: string | null) => ccs.find((c) => c.erp_code === cod)?.name || "";

  const totalGeral = itens.reduce((s, it) => s + it.valorProduto, 0);
  const algumSemProduto = itens.some((it) => !it.produtoInterno);
  const algumSemNatureza = itens.some((it) => it.produtoInterno && !it.natureza);
  const algumSemClasseCc = itens.some((it) => it.produtoInterno && (!it.classe || !it.centroCusto));

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
              <th className="p-2 font-medium w-[24%]">Item da NF (fornecedor)</th>
              <th className="p-2 font-medium w-[38%]">Produto · natureza · classe · CC</th>
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

                <td className="p-2 space-y-1">
                  <ProdutoSelector
                    value={it.produtoInterno}
                    displayValue={it.produtoInterno ? `${it.produtoInterno} — ${it.produtoNome || ""}` : ""}
                    onSelect={(p) => onSelecionarProduto(idx, p)}
                  />
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
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

                  {it.produtoInterno && (
                    <>
                      <NaturezaSelector
                        value={it.natureza}
                        displayValue={it.natureza ? `${it.natureza} — ${it.naturezaNome || ""}` : ""}
                        onSelect={(n) => atualizarLinha(idx, { natureza: n.Codigo, naturezaNome: n.Nome })}
                      />
                      <ClasseCcSelector
                        tipo="classe"
                        value={it.classe}
                        displayValue={it.classe ? `${it.classe} — ${it.classeNome || nomeClasse(it.classe)}` : ""}
                        options={classeOpts}
                        loading={loadingDrops}
                        onSelect={(cod, nome) => atualizarLinha(idx, { classe: cod, classeNome: nome })}
                      />
                      <ClasseCcSelector
                        tipo="cc"
                        value={it.centroCusto}
                        displayValue={
                          it.centroCusto ? `${it.centroCusto} — ${it.centroCustoNome || nomeCc(it.centroCusto)}` : ""
                        }
                        options={ccOpts}
                        loading={loadingDrops}
                        onSelect={(cod, nome) => atualizarLinha(idx, { centroCusto: cod, centroCustoNome: nome })}
                      />
                    </>
                  )}
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

      {(algumSemProduto || algumSemNatureza || algumSemClasseCc) && (
        <p className="flex items-center gap-1 text-[11px] text-amber-600">
          <AlertTriangle className="h-3 w-3" />
          {algumSemProduto
            ? "Todos os itens precisam de um produto interno antes de lançar."
            : algumSemNatureza
              ? "Todos os itens precisam de uma natureza de operação."
              : "Todos os itens precisam de classe e centro de custo."}
        </p>
      )}
    </div>
  );
}
