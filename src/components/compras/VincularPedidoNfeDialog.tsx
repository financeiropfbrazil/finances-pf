/**
 * VincularPedidoNfeDialog — vincula uma NF-e de PRODUTO (compras_nfe) a UM OU
 * MAIS pedidos de compra (multi-seleção).
 *
 * Mudanças vs versão single-pedido:
 *  - Multi-seleção via Checkbox (era RadioGroup, 1 só).
 *  - Filtro: apenas pedidos APROVADOS 100% (status=Aberto + status_aprovacao=
 *    Finalizada + aprovado=Total). Sem filtro de "comprado".
 *  - Grava N vínculos na tabela compras_nfe_pedidos (A2).
 *  - Pedido PRINCIPAL = primeiro selecionado → preenche as colunas legadas
 *    pedido_compra_* em compras_nfe (compatibilidade) + is_principal=true.
 *  - nf_vinculada=true marcado em TODOS os pedidos selecionados.
 *  - Reabrir o modal pré-marca os pedidos já vinculados (modo edição).
 *
 * A edição fina de classe/CC por item NÃO acontece aqui — fica no de-para de
 * itens do lançamento (LancarNfeModal). Aqui só se amarra NFe ↔ pedidos.
 */

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Link as LinkIcon, Search, Sparkles } from "lucide-react";

const TOLERANCIA_VALOR = 0.05; // ±5% para a sugestão de match por valor

const fmtBRL = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
const fmtCNPJ = (cnpj: string) => {
  const c = (cnpj || "").replace(/\D/g, "");
  if (c.length === 14) return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return cnpj;
};

const PEDIDO_SELECT_COLS =
  "id, numero, codigo_empresa_filial, data_pedido, valor_total, status, status_aprovacao, aprovado, comprado, codigo_entidade, nome_entidade, cnpj_entidade, texto, tipo, classe_rec_desp, centro_custo, codigo_cond_pag, nome_cond_pag, itens, detalhes_carregados";

interface Pedido {
  id: string;
  numero: string;
  codigo_empresa_filial: string | null;
  data_pedido: string | null;
  valor_total: number | null;
  status: string | null;
  status_aprovacao: string | null;
  aprovado: string | null;
  comprado: string | null;
  codigo_entidade: string | null;
  nome_entidade: string | null;
  cnpj_entidade: string | null;
  texto: string | null;
  tipo: string | null;
  classe_rec_desp: string | null;
  centro_custo: string | null;
  codigo_cond_pag: string | null;
  nome_cond_pag: string | null;
  itens: any[] | null;
  detalhes_carregados: boolean | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nfe: {
    id: string;
    numero: string | null;
    emitente_nome: string | null;
    emitente_cnpj: string | null;
    valor_total: number | null;
  };
  onVinculado: () => void;
}

export function VincularPedidoNfeDialog({ open, onOpenChange, nfe, onVinculado }: Props) {
  const { toast } = useToast();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(false);
  // Multi-seleção: ids de pedido marcados
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Pedido[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const cnpjLimpo = (nfe.emitente_cnpj || "").replace(/\D/g, "");
  const valorNf = nfe.valor_total || 0;

  // Sugestão: pedido com CNPJ igual E valor dentro da tolerância (apenas destaca)
  const isSugerido = (p: Pedido): boolean => {
    const cnpjPed = (p.cnpj_entidade || "").replace(/\D/g, "");
    if (!cnpjPed || cnpjPed !== cnpjLimpo) return false;
    const vp = p.valor_total || 0;
    if (vp <= 0 || valorNf <= 0) return false;
    return Math.abs(vp - valorNf) / valorNf <= TOLERANCIA_VALOR;
  };

  // Reset + carregamento inicial ao abrir
  useEffect(() => {
    if (!open) {
      setPedidos([]);
      setSelectedIds(new Set());
      setSearchTerm("");
      setSearchResults([]);
      setHasSearched(false);
      return;
    }
    searchPedidos();
  }, [open]);

  // Pré-marca os pedidos JÁ vinculados a esta NF-e (modo edição).
  // Roda depois que pedidos/searchResults estão populados, casando por numero.
  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.from("compras_nfe_pedidos").select("pedido_numero").eq("nfe_id", nfe.id);
      if (!data || data.length === 0) return;
      const numerosVinculados = new Set(data.map((d) => d.pedido_numero));
      const todos = [...pedidos, ...searchResults];
      const idsPre = new Set<string>();
      for (const p of todos) {
        if (numerosVinculados.has(p.numero)) idsPre.add(p.id);
      }
      if (idsPre.size > 0) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          idsPre.forEach((id) => next.add(id));
          return next;
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pedidos, searchResults, nfe.id]);

  // Busca automática: pedidos APROVADOS do fornecedor (por CNPJ).
  const searchPedidos = async () => {
    setLoading(true);
    try {
      let { data } = await supabase
        .from("compras_pedidos")
        .select(PEDIDO_SELECT_COLS)
        .eq("cnpj_entidade", cnpjLimpo)
        .eq("status", "Aberto")
        .eq("status_aprovacao", "Finalizada")
        .eq("aprovado", "Total")
        .order("data_pedido", { ascending: false });

      if (!data || data.length === 0) {
        const { data: cacheData } = await supabase
          .from("compras_entidades_cache")
          .select("codigo_entidade")
          .eq("cnpj", cnpjLimpo)
          .limit(1)
          .maybeSingle();
        if (cacheData?.codigo_entidade) {
          const res = await supabase
            .from("compras_pedidos")
            .select(PEDIDO_SELECT_COLS)
            .eq("codigo_entidade", cacheData.codigo_entidade)
            .eq("status", "Aberto")
            .eq("status_aprovacao", "Finalizada")
            .eq("aprovado", "Total")
            .order("data_pedido", { ascending: false });
          data = res.data;
        }
      }
      setPedidos((data || []) as Pedido[]);
    } catch (err) {
      console.error("Erro ao buscar pedidos:", err);
    } finally {
      setLoading(false);
    }
  };

  // Busca manual: também restrita a APROVADOS.
  const handleSearch = async () => {
    const term = searchTerm.trim();
    if (!term) return;
    setSearching(true);
    setHasSearched(true);
    try {
      const cleanSearch = term.replace(/[^\d]/g, "");
      let query = supabase
        .from("compras_pedidos")
        .select(PEDIDO_SELECT_COLS)
        .eq("status", "Aberto")
        .eq("status_aprovacao", "Finalizada")
        .eq("aprovado", "Total")
        .order("data_pedido", { ascending: false })
        .limit(20);
      if (cleanSearch.length >= 11) query = query.eq("cnpj_entidade", cleanSearch);
      else if (/^\d+$/.test(term)) query = query.ilike("numero", `%${term}%`);
      else query = query.ilike("nome_entidade", `%${term}%`);
      const { data } = await query;
      setSearchResults((data || []) as Pedido[]);
    } catch (err) {
      console.error("Erro na busca:", err);
    } finally {
      setSearching(false);
    }
  };

  // Lista combinada (sem duplicar por id)
  const allPedidos = (() => {
    const map = new Map<string, Pedido>();
    for (const p of [...pedidos, ...searchResults]) map.set(p.id, p);
    return Array.from(map.values());
  })();

  const togglePedido = (pedidoId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pedidoId)) next.delete(pedidoId);
      else next.add(pedidoId);
      return next;
    });
  };

  const selecionados = allPedidos.filter((p) => selectedIds.has(p.id));
  const valorSelecionado = selecionados.reduce((s, p) => s + (p.valor_total || 0), 0);

  const handleVincular = async () => {
    if (selectedIds.size === 0) return;
    setSaving(true);
    try {
      // ordem estável: usa a ordem em que aparecem em allPedidos
      const selOrdenados = allPedidos.filter((p) => selectedIds.has(p.id));
      const principal = selOrdenados[0];
      if (!principal) throw new Error("Nenhum pedido selecionado");

      const user = (await supabase.auth.getUser()).data.user;

      // (a) compras_nfe — colunas legadas com o pedido PRINCIPAL
      const { data: currentRow, error: loadError } = await supabase
        .from("compras_nfe")
        .select("*")
        .eq("id", nfe.id)
        .single();
      if (loadError || !currentRow) throw loadError || new Error("NF-e não encontrada");

      const condPagLegado = principal.codigo_cond_pag
        ? `${principal.codigo_cond_pag}${principal.nome_cond_pag ? ` (${principal.nome_cond_pag})` : ""}`
        : null;

      const { error: nfeErr } = await supabase.from("compras_nfe").upsert(
        {
          ...currentRow,
          status_lancamento: "vinculada",
          pedido_compra_numero: principal.numero,
          pedido_compra_entidade: principal.codigo_entidade,
          pedido_compra_classe: principal.classe_rec_desp || null,
          pedido_compra_centro_custo: principal.centro_custo || null,
          pedido_compra_cond_pagamento: condPagLegado,
          pedido_compra_valor: principal.valor_total,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (nfeErr) throw nfeErr;

      // (b) compras_nfe_pedidos — limpa e regrava (idempotente p/ re-edição)
      await supabase.from("compras_nfe_pedidos").delete().eq("nfe_id", nfe.id);

      const vinculos = selOrdenados.map((p, idx) => ({
        nfe_id: nfe.id,
        pedido_numero: p.numero,
        codigo_empresa_filial: p.codigo_empresa_filial || "1.01",
        is_principal: idx === 0,
        created_by: user?.id || null,
      }));
      const { error: vincErr } = await supabase.from("compras_nfe_pedidos").insert(vinculos);
      if (vincErr) throw vincErr;

      // (c) nf_vinculada=true em TODOS os selecionados
      for (const p of selOrdenados) {
        await supabase
          .from("compras_pedidos")
          .update({
            nf_vinculada: true,
            nf_vinculada_em: new Date().toISOString(),
            nf_vinculada_tipo: "compras_nfe",
          } as any)
          .eq("numero", p.numero)
          .eq("codigo_empresa_filial", p.codigo_empresa_filial || "1.01");
      }

      toast({
        title: `NF-e vinculada a ${selOrdenados.length} pedido${selOrdenados.length > 1 ? "s" : ""}`,
      });
      onOpenChange(false);
      onVinculado();
    } catch (err: any) {
      toast({ title: "Erro ao vincular", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const tipoBadge = (tipo: string | null) => {
    if (!tipo) return null;
    const t = tipo.toLowerCase();
    if (t.includes("servi"))
      return (
        <Badge variant="secondary" className="text-[10px]">
          Serviço
        </Badge>
      );
    if (t.includes("produ") || t.includes("merca")) return <Badge className="text-[10px]">Produto</Badge>;
    if (t.includes("mist"))
      return (
        <Badge variant="outline" className="text-[10px]">
          Misto
        </Badge>
      );
    return (
      <Badge variant="outline" className="text-[10px]">
        {tipo}
      </Badge>
    );
  };

  const renderPedidoRows = (list: Pedido[]) =>
    list.map((p) => {
      const sugerido = isSugerido(p);
      const checked = selectedIds.has(p.id);
      return (
        <TableRow
          key={p.id}
          className={`cursor-pointer hover:bg-muted/50 ${sugerido ? "bg-emerald-500/5" : ""} ${
            checked ? "bg-primary/5" : ""
          }`}
          onClick={() => togglePedido(p.id)}
        >
          <TableCell onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={checked} onCheckedChange={() => togglePedido(p.id)} />
          </TableCell>
          <TableCell className="font-mono text-xs">
            {p.numero}
            {sugerido && (
              <Badge className="ml-1 gap-0.5 bg-emerald-600 text-white text-[9px] px-1 py-0">
                <Sparkles className="h-2.5 w-2.5" /> Sugerido
              </Badge>
            )}
          </TableCell>
          <TableCell className="text-xs">{fmtDate(p.data_pedido)}</TableCell>
          <TableCell className="text-xs truncate max-w-[140px]">{p.nome_entidade || "—"}</TableCell>
          <TableCell>{tipoBadge(p.tipo)}</TableCell>
          <TableCell className="text-right text-xs font-mono">{fmtBRL(p.valor_total)}</TableCell>
        </TableRow>
      );
    });

  const pedidoTableHeader = (
    <TableHeader>
      <TableRow>
        <TableHead className="w-10">Sel.</TableHead>
        <TableHead>Número</TableHead>
        <TableHead>Data</TableHead>
        <TableHead>Fornecedor</TableHead>
        <TableHead>Tipo</TableHead>
        <TableHead className="text-right">Valor</TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Vincular NF-e a Pedido(s) de Compra</DialogTitle>
          <p className="text-xs text-muted-foreground">
            NF-e #{nfe.numero || "—"} — {nfe.emitente_nome || "—"} — {fmtBRL(nfe.valor_total)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Marque um ou mais pedidos aprovados. Itens de cada pedido são mapeados na hora do lançamento.
          </p>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm font-medium">
            Pedidos aprovados do fornecedor ({cnpjLimpo ? fmtCNPJ(cnpjLimpo) : "—"})
          </p>
          {loading ? (
            <div className="flex items-center justify-center py-4 gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs text-muted-foreground">Buscando pedidos aprovados do fornecedor...</span>
            </div>
          ) : pedidos.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              Nenhum pedido aprovado (100%) encontrado para este CNPJ.
            </p>
          ) : (
            <Table>
              {pedidoTableHeader}
              <TableBody>{renderPedidoRows(pedidos)}</TableBody>
            </Table>
          )}
        </div>

        <Separator className="my-3" />

        <div className="space-y-2">
          <p className="text-sm font-medium">Buscar pedido de outro fornecedor</p>
          <p className="text-xs text-muted-foreground">
            Use quando o pedido foi emitido em outro CNPJ (marketplace, matriz, etc.). Só lista aprovados.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Nome do fornecedor, CNPJ ou número do pedido"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="text-xs h-8"
            />
            <Button variant="outline" size="sm" onClick={handleSearch} disabled={searching} className="gap-1 shrink-0">
              {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />} Buscar
            </Button>
          </div>
          {searching ? (
            <div className="flex items-center justify-center py-4 gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs text-muted-foreground">Buscando...</span>
            </div>
          ) : hasSearched && searchResults.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Nenhum pedido aprovado encontrado para "{searchTerm}".</p>
          ) : searchResults.length > 0 ? (
            <Table>
              {pedidoTableHeader}
              <TableBody>{renderPedidoRows(searchResults)}</TableBody>
            </Table>
          ) : null}
        </div>

        {selecionados.length > 0 && (
          <div className="rounded border bg-muted/30 p-3 text-xs flex items-center justify-between">
            <div>
              <span className="text-muted-foreground">Pedidos selecionados: </span>
              <strong>{selecionados.length}</strong>
              <span className="text-muted-foreground"> · principal: </span>
              <strong className="font-mono">{selecionados[0].numero}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Valor somado: </span>
              <strong>{fmtBRL(valorSelecionado)}</strong>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleVincular} disabled={selectedIds.size === 0 || saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
            Vincular{selectedIds.size > 0 ? ` (${selectedIds.size} pedido${selectedIds.size > 1 ? "s" : ""})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
