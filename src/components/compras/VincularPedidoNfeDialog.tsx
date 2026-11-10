/**
 * VincularPedidoNfeDialog — vincula uma NF-e de PRODUTO (compras_nfe) a UM OU
 * MAIS pedidos de compra (multi-seleção).
 *
 * Mudanças vs versão single-pedido:
 *  - Multi-seleção via Checkbox (era RadioGroup, 1 só).
 *  - Filtro: pedidos APROVADOS 100% (status_aprovacao=Finalizada + aprovado=Total) que não estão Cancelados
 *    nem Encerrados no Alvo (entra o "Pendente") nem excluídos do Alvo. Sem filtro de "comprado".
 *  - NFE-9 (10/11/2026): mesma régua dos candidatos da etapa 2 (RPC nfe_recebida_detalhe) — antes o diálogo só
 *    aceitava status "Aberto" e sugeria por ±5% do valor total, e o pedido que a etapa 2 sugeria podia nem aparecer
 *    (ex.: NF 892720 → pedido 0003659 "Pendente"). Agora "Sugerido" = candidato da etapa 2, e os candidatos sempre
 *    aparecem no topo (mesmo de outro CNPJ da mesma raiz ou ainda não aprovados, com o aviso).
 *  - Grava N vínculos na tabela compras_nfe_pedidos (A2).
 *  - Pedido PRINCIPAL = primeiro selecionado → preenche as colunas legadas
 *    pedido_compra_* em compras_nfe (compatibilidade) + is_principal=true.
 *  - nf_vinculada=true marcado em TODOS os pedidos selecionados.
 *  - Reabrir o modal pré-marca os pedidos já vinculados (modo edição).
 *
 * Aqui só se amarra NFe ↔ pedidos. O lançamento da NF-e pelo Hub foi removido
 * em 19/10/2026 (NFE-S1): a nota é lançada direto no Alvo.
 */

import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buscarDetalheNfe, vincularPedidosNfe } from "@/services/nfeRecebidasService";
import type { PedidoCandidato } from "@/services/nfseRecebidasService";
import { chaveDetalheNfe } from "@/components/nfe/NfeDetalheEtapas";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Link as LinkIcon, Search, Sparkles } from "lucide-react";

/** Status do Alvo que tiram o pedido da lista (os mesmos que tiram dos candidatos da etapa 2). */
const STATUS_FORA = '("Cancelado","Encerrado")';
/** Aprovado 100% no Alvo (filtro das buscas). */
const APROVADO_100 = { status_aprovacao: "Finalizada", aprovado: "Total" };

/** Aprovado 100% no Alvo. */
const aprovado100 = (p: { status_aprovacao: string | null; aprovado: string | null }) =>
  p.status_aprovacao === "Finalizada" && p.aprovado === "Total";

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
  "id, numero, codigo_empresa_filial, data_pedido, valor_total, status, status_aprovacao, aprovado, comprado, codigo_entidade, nome_entidade, cnpj_entidade, texto, tipo, classe_rec_desp, centro_custo, codigo_cond_pag, nome_cond_pag, itens, detalhes_carregados, status_local";

/** Pedido excluído do Alvo não entra (filtro depois da consulta: na cadeia, o cliente tipado estoura o type-check). */
const noAlvo = (lista: Pedido[] | null | undefined) => (lista ?? []).filter((p) => p.status_local !== "excluido_alvo");

/** Deixa um de cada id, na ordem em que aparecem. */
const semRepetir = (lista: Pedido[]) => {
  const m = new Map<string, Pedido>();
  for (const p of lista) if (!m.has(p.id)) m.set(p.id, p);
  return Array.from(m.values());
};

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
  status_local: string | null;
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

  // Sugestão = os candidatos da etapa 2 (mesma RPC e mesmo cache do detalhe da nota).
  const { data: detalhe } = useQuery({
    queryKey: chaveDetalheNfe(nfe.id),
    queryFn: () => buscarDetalheNfe(nfe.id),
    enabled: open,
    staleTime: 30_000,
  });
  const candidatos = useMemo(() => {
    const m = new Map<string, PedidoCandidato>();
    for (const c of detalhe?.pedidos.candidatos ?? []) m.set(c.numero, c);
    return m;
  }, [detalhe]);
  const [pedidosCandidatos, setPedidosCandidatos] = useState<Pedido[]>([]);
  const candidatoDe = (p: Pedido) => (p.codigo_empresa_filial === "1.01" ? candidatos.get(p.numero) : undefined);

  // Os candidatos entram sempre no topo, mesmo de outro CNPJ da raiz ou ainda não aprovados.
  useEffect(() => {
    const numeros = Array.from(candidatos.keys());
    if (!open || numeros.length === 0) {
      setPedidosCandidatos([]);
      return;
    }
    let vivo = true;
    (async () => {
      const { data } = await supabase
        .from("compras_pedidos")
        .select(PEDIDO_SELECT_COLS)
        .eq("codigo_empresa_filial", "1.01")
        .in("numero", numeros);
      if (!vivo) return;
      // os tipos gerados do Supabase no repo não têm `status_local` (coluna existe no banco) → conversão explícita
      const lista = (data || []) as unknown as Pedido[];
      lista.sort((a, b) => numeros.indexOf(a.numero) - numeros.indexOf(b.numero));
      setPedidosCandidatos(lista);
    })();
    return () => {
      vivo = false;
    };
  }, [open, candidatos]);

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
      const todos = [...pedidosCandidatos, ...pedidos, ...searchResults];
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
  }, [open, pedidosCandidatos, pedidos, searchResults, nfe.id]);

  // Busca automática: pedidos APROVADOS do fornecedor (por CNPJ), fora os Cancelados/Encerrados/excluídos do Alvo.
  const searchPedidos = async () => {
    setLoading(true);
    try {
      let { data } = await supabase
        .from("compras_pedidos")
        .select(PEDIDO_SELECT_COLS)
        .eq("cnpj_entidade", cnpjLimpo)
        .filter("status", "not.in", STATUS_FORA)
        .match(APROVADO_100)
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
            .filter("status", "not.in", STATUS_FORA)
            .match(APROVADO_100)
            .order("data_pedido", { ascending: false });
          data = res.data;
        }
      }
      setPedidos(noAlvo(data as unknown as Pedido[] | null));
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
        .filter("status", "not.in", STATUS_FORA)
        .match(APROVADO_100)
        .order("data_pedido", { ascending: false })
        .limit(20);
      if (cleanSearch.length >= 11) query = query.eq("cnpj_entidade", cleanSearch);
      else if (/^\d+$/.test(term)) query = query.ilike("numero", `%${term}%`);
      else query = query.ilike("nome_entidade", `%${term}%`);
      const { data } = await query;
      setSearchResults(noAlvo(data as unknown as Pedido[] | null));
    } catch (err) {
      console.error("Erro na busca:", err);
    } finally {
      setSearching(false);
    }
  };

  // Lista do fornecedor: candidatos da etapa 2 primeiro. Lista combinada (sem duplicar por id).
  const pedidosDoFornecedor = semRepetir([...pedidosCandidatos, ...pedidos]);
  const allPedidos = semRepetir([...pedidosDoFornecedor, ...searchResults]);

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

      // Uma RPC só (PLANO-NFE NFE-1): colunas legadas de compras_nfe com o PRINCIPAL, compras_nfe_pedidos
      // (limpa e regrava — idempotente p/ re-edição) e nf_vinculada=true em todos os selecionados.
      await vincularPedidosNfe(nfe.id, selOrdenados);

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
      const candidato = candidatoDe(p);
      const sugerido = !!candidato;
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
            {candidato && (
              <Badge
                className="ml-1 gap-0.5 bg-emerald-600 text-white text-[9px] px-1 py-0"
                title={`${candidato.motivo} · saldo ${fmtBRL(candidato.saldo)}`}
              >
                <Sparkles className="h-2.5 w-2.5" /> Sugerido
              </Badge>
            )}
            {!aprovado100(p) && (
              <Badge variant="outline" className="ml-1 border-amber-500 text-amber-700 text-[9px] px-1 py-0">
                não aprovado
              </Badge>
            )}
          </TableCell>
          <TableCell className="text-xs">{p.status || "—"}</TableCell>
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
        <TableHead>Status</TableHead>
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
            Marque um ou mais pedidos aprovados. "Sugerido" = o mesmo pedido que a etapa 2 da nota sugere (mesmo
            fornecedor, saldo dentro de ±20% do valor da nota).
          </p>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-sm font-medium">
            Pedidos aprovados e não encerrados do fornecedor ({cnpjLimpo ? fmtCNPJ(cnpjLimpo) : "—"})
          </p>
          {loading ? (
            <div className="flex items-center justify-center py-4 gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-xs text-muted-foreground">Buscando pedidos aprovados do fornecedor...</span>
            </div>
          ) : pedidosDoFornecedor.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              Nenhum pedido aprovado (100%) e não encerrado encontrado para este CNPJ.
            </p>
          ) : (
            <Table>
              {pedidoTableHeader}
              <TableBody>{renderPedidoRows(pedidosDoFornecedor)}</TableBody>
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
