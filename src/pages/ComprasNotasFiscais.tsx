import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search,
  Download,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  Hash,
  Package,
  ChevronDown,
  ChevronRight,
  Eye,
  Copy,
  Link as LinkIcon,
  Unlink,
  RotateCcw,
  Send,
  RefreshCw,
  Boxes,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { VincularPedidoNfeDialog } from "@/components/compras/VincularPedidoNfeDialog";
import { LancarNfeModal } from "@/components/compras/LancarNfeModal";
import { UploadXmlButton } from "@/components/compras/UploadXmlButton";
import { carregarMovEstq } from "@/services/alvoMovEstqLoadService";

// ── Types ──
interface NfeItemExtraido {
  numero_item: number;
  codigo_produto: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
}
interface LoteGerado {
  numeroLote: string;
  dataValidade: string | null;
  dataFabricacao: string | null;
  quantidade: number;
  produto: string;
}
interface NfeRow {
  id: string;
  numero: string | null;
  serie: string | null;
  chave_acesso: string;
  emitente_nome: string | null;
  emitente_cnpj: string | null;
  emitente_ie: string | null;
  emitente_uf: string | null;
  valor_produtos: number | null;
  valor_icms: number | null;
  valor_ipi: number | null;
  valor_frete: number | null;
  valor_desconto: number | null;
  valor_total: number | null;
  base_calculo_icms: number | null;
  data_emissao: string | null;
  natureza_operacao: string | null;
  situacao: string | null;
  origem: string | null;
  recebido: boolean | null;
  raw_xml: string | null;
  dados_extraidos: any;
  status_lancamento: string | null;
  pedido_compra_numero: string | null;
  pedido_compra_entidade: string | null;
  pedido_compra_classe: string | null;
  pedido_compra_centro_custo: string | null;
  pedido_compra_cond_pagamento: string | null;
  pedido_compra_valor: number | null;
  erp_chave_movestq: number | null;
  lancado_por: string | null;
  lancado_em: string | null;
}

// ── Helpers ──
const formatCurrency = (v: number | null | undefined) =>
  v != null ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v) : "—";
const formatDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("pt-BR");
};
const formatCnpj = (cnpj: string | null) => {
  if (!cnpj) return "—";
  const c = cnpj.replace(/\D/g, "");
  if (c.length !== 14) return cnpj;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
};
const situacaoBadge = (sit: string | null) => {
  const s = (sit || "").toLowerCase();
  if (s === "ativa" || s === "autorizada")
    return <Badge className="bg-green-600 text-white hover:bg-green-700">Ativa</Badge>;
  if (s === "cancelada") return <Badge variant="destructive">Cancelada</Badge>;
  return <Badge variant="outline">{sit || "—"}</Badge>;
};

const ComprasNotasFiscais = () => {
  const { toast } = useToast();
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());
  const [rows, setRows] = useState<NfeRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroLancamento, setFiltroLancamento] = useState("todos");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [xmlDialog, setXmlDialog] = useState<{ open: boolean; numero: string; fornecedor: string; xml: string }>({
    open: false,
    numero: "",
    fornecedor: "",
    xml: "",
  });
  const [vincularDialog, setVincularDialog] = useState<{ open: boolean; nfe: NfeRow | null }>({
    open: false,
    nfe: null,
  });
  const [lancarModal, setLancarModal] = useState<{ open: boolean; nfe: NfeRow | null }>({ open: false, nfe: null });
  const [alertAction, setAlertAction] = useState<{ type: "desvincular" | "reverter"; nfe: NfeRow } | null>(null);

  // Cache de lotes por nota (Estratégia 1: cacheia na sessão, botão atualiza)
  const [lotesCache, setLotesCache] = useState<Record<string, LoteGerado[]>>({});
  const [loadingLotes, setLoadingLotes] = useState<string | null>(null);

  // ── Fetch ──
  const fetchRows = useCallback(async () => {
    setLoadingRows(true);
    const padM = String(mes).padStart(2, "0");
    const startDate = `${ano}-${padM}-01`;
    const lastDay = new Date(ano, mes, 0).getDate();
    const endDate = `${ano}-${padM}-${String(lastDay).padStart(2, "0")}`;
    const { data, error } = await supabase
      .from("compras_nfe")
      .select("*")
      .gte("data_emissao", startDate)
      .lte("data_emissao", endDate)
      .order("data_emissao", { ascending: false });
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else setRows((data ?? []) as unknown as NfeRow[]);
    setLoadingRows(false);
  }, [ano, mes, toast]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // ── Lotes (lê do Alvo, cacheado) ──
  const carregarLotes = useCallback(
    async (nfe: NfeRow, force = false) => {
      if (!nfe.erp_chave_movestq) return;
      if (!force && lotesCache[nfe.id]) return; // usa cache
      setLoadingLotes(nfe.id);
      try {
        const data = await carregarMovEstq(nfe.erp_chave_movestq);
        const itens = (data?.ItemMovEstqChildList || []) as any[];
        const lotes: LoteGerado[] = [];
        for (const item of itens) {
          const ctrlLotes = (item?.CtrlLoteItemMovEstqChildList || []) as any[];
          for (const cl of ctrlLotes) {
            lotes.push({
              numeroLote: cl.NumeroCtrlLote,
              dataValidade: cl.DataValidadeCtrlLote,
              dataFabricacao: cl.DataFabricacao,
              quantidade: cl.QuantidadeProdUnidMedPrincipal,
              produto: item.NomeProduto || item.CodigoProduto || "—",
            });
          }
        }
        setLotesCache((prev) => ({ ...prev, [nfe.id]: lotes }));
      } catch (e: any) {
        toast({ title: "Erro ao carregar lotes", description: e?.message || String(e), variant: "destructive" });
      } finally {
        setLoadingLotes(null);
      }
    },
    [lotesCache, toast],
  );

  const toggleExpand = (nfe: NfeRow) => {
    if (expandedId === nfe.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(nfe.id);
    // se lançada, busca lotes (cacheado)
    if (nfe.status_lancamento === "lancada" && nfe.erp_chave_movestq) {
      carregarLotes(nfe);
    }
  };

  // ── Filtering ──
  const filtered = useMemo(() => {
    let list = rows;
    if (filtroLancamento !== "todos") {
      list = list.filter((r) => (r.status_lancamento || "pendente") === filtroLancamento);
    }
    if (searchTerm.trim()) {
      const s = searchTerm.toLowerCase();
      list = list.filter(
        (r) =>
          (r.emitente_nome || "").toLowerCase().includes(s) ||
          (r.emitente_cnpj || "").includes(s) ||
          (r.numero || "").toLowerCase().includes(s),
      );
    }
    return list;
  }, [rows, filtroLancamento, searchTerm]);

  const summary = useMemo(() => {
    const total = rows.length;
    const pendentes = rows.filter((r) => (r.status_lancamento || "pendente") === "pendente").length;
    const vinculadas = rows.filter((r) => r.status_lancamento === "vinculada").length;
    const lancadas = rows.filter((r) => r.status_lancamento === "lancada").length;
    const valorTotal = rows.reduce((s, r) => s + (r.valor_total || 0), 0);
    return { total, pendentes, vinculadas, lancadas, valorTotal };
  }, [rows]);

  const footerTotal = useMemo(() => filtered.reduce((s, r) => s + (r.valor_total || 0), 0), [filtered]);

  const statusLancBadge = (r: NfeRow) => {
    const st = r.status_lancamento || "pendente";
    if (st === "vinculada")
      return (
        <Badge className="bg-blue-600 text-white hover:bg-blue-700 text-[10px]">
          Vinculada (Ped. {r.pedido_compra_numero})
        </Badge>
      );
    if (st === "lancada")
      return <Badge className="bg-green-600 text-white hover:bg-green-700 text-[10px]">Lançada</Badge>;
    return (
      <Badge variant="outline" className="text-[10px]">
        Pendente
      </Badge>
    );
  };

  // ── Desvincular / Reverter ──
  const handleConfirmAction = async () => {
    if (!alertAction) return;
    const { type, nfe } = alertAction;
    const upsertNfe = async (updates: Record<string, any>) => {
      const { data: current } = await supabase.from("compras_nfe").select("*").eq("id", nfe.id).single();
      if (!current) return { error: { message: "NF-e não encontrada" } };
      return supabase.from("compras_nfe").upsert({ ...current, ...updates }, { onConflict: "id" });
    };
    if (type === "desvincular") {
      const { error } = await upsertNfe({
        status_lancamento: "pendente",
        pedido_compra_numero: null,
        pedido_compra_entidade: null,
        pedido_compra_classe: null,
        pedido_compra_centro_custo: null,
        pedido_compra_cond_pagamento: null,
        pedido_compra_valor: null,
        updated_at: new Date().toISOString(),
      });
      if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
      else toast({ title: "Vinculação removida" });
    } else if (type === "reverter") {
      const { error } = await upsertNfe({
        status_lancamento: "vinculada",
        lancado_por: null,
        lancado_em: null,
        erp_chave_movestq: null,
        updated_at: new Date().toISOString(),
      });
      if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
      else toast({ title: "Lançamento revertido" });
    }
    setAlertAction(null);
    fetchRows();
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Notas Fiscais (NF-e)</h1>
        <p className="text-muted-foreground">
          Recebimento e lançamento de NF-e de produto no Alvo. As notas chegam via integração (API) ou upload manual de
          XML.
        </p>
      </div>

      {/* Filtros de período */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {new Date(2000, i).toLocaleString("pt-BR", { month: "long" }).replace(/^\w/, (c) => c.toUpperCase())}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
            <SelectTrigger className="h-8 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <UploadXmlButton onImported={fetchRows} />
          <Button variant="outline" size="sm" onClick={fetchRows} disabled={loadingRows} className="gap-1">
            {loadingRows ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Atualizar
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total NF-e", value: summary.total, icon: Hash },
          { label: "Pendentes", value: summary.pendentes, icon: FileText },
          { label: "Vinculadas", value: summary.vinculadas, icon: LinkIcon },
          { label: "Lançadas", value: summary.lancadas, icon: CheckCircle2 },
          { label: "Valor Total", value: formatCurrency(summary.valorTotal), icon: Package },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-3 flex items-center gap-2">
              <c.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="text-sm font-semibold">{c.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="Buscar por fornecedor, CNPJ ou número..."
          className="h-8 text-xs sm:max-w-xs"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <Select value={filtroLancamento} onValueChange={setFiltroLancamento}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="vinculada">Vinculadas</SelectItem>
            <SelectItem value="lancada">Lançadas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          {loadingRows ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Nenhuma NF-e encontrada no período.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6 px-1" />
                  <TableHead className="text-xs px-2">Número</TableHead>
                  <TableHead className="text-xs px-2">Fornecedor</TableHead>
                  <TableHead className="text-xs px-2">CNPJ</TableHead>
                  <TableHead className="text-xs text-right px-2">V. Total</TableHead>
                  <TableHead className="text-xs px-2">Data</TableHead>
                  <TableHead className="text-xs px-2">Situação</TableHead>
                  <TableHead className="text-xs px-2">Lançamento</TableHead>
                  <TableHead className="text-xs px-2">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const itens = (r.dados_extraidos?.itens || []) as NfeItemExtraido[];
                  const isLancada = r.status_lancamento === "lancada";
                  const lotes = lotesCache[r.id] || [];
                  return (
                    <TooltipProvider key={r.id}>
                      <>
                        <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleExpand(r)}>
                          <TableCell className="px-1">
                            {expandedId === r.id ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell className="text-xs px-2">{r.numero || "—"}</TableCell>
                          <TableCell className="text-xs max-w-[180px] truncate px-2">
                            {r.emitente_nome || "—"}
                          </TableCell>
                          <TableCell className="text-xs font-mono px-2">{formatCnpj(r.emitente_cnpj)}</TableCell>
                          <TableCell className="text-xs text-right whitespace-nowrap font-medium px-2">
                            {formatCurrency(r.valor_total)}
                          </TableCell>
                          <TableCell className="text-xs px-2">{formatDate(r.data_emissao)}</TableCell>
                          <TableCell className="px-2">{situacaoBadge(r.situacao)}</TableCell>
                          <TableCell className="px-2">{statusLancBadge(r)}</TableCell>
                          <TableCell className="px-2" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              {(() => {
                                const st = r.status_lancamento || "pendente";
                                if (st === "pendente")
                                  return (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="gap-1 text-xs h-7"
                                      onClick={() => setVincularDialog({ open: true, nfe: r })}
                                    >
                                      <LinkIcon className="h-3 w-3" /> Vincular
                                    </Button>
                                  );
                                if (st === "vinculada")
                                  return (
                                    <>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-1 text-xs h-7"
                                        onClick={() => setLancarModal({ open: true, nfe: r })}
                                      >
                                        <Send className="h-3 w-3" /> Lançar
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-1 text-xs h-7"
                                        onClick={() => setAlertAction({ type: "desvincular", nfe: r })}
                                      >
                                        <Unlink className="h-3 w-3" />
                                      </Button>
                                    </>
                                  );
                                if (st === "lancada")
                                  return (
                                    <div className="flex items-center gap-1">
                                      <span className="text-[10px] text-muted-foreground">
                                        Chave {r.erp_chave_movestq}
                                      </span>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0"
                                        onClick={() => setAlertAction({ type: "reverter", nfe: r })}
                                      >
                                        <RotateCcw className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  );
                                return null;
                              })()}
                            </div>
                          </TableCell>
                        </TableRow>

                        {expandedId === r.id && (
                          <TableRow>
                            <TableCell colSpan={9} className="bg-muted/30 p-4">
                              <div className="space-y-4">
                                {/* Dados da Nota */}
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">Dados da Nota</h4>
                                  <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
                                    <div>
                                      <span className="text-muted-foreground">Fornecedor:</span>{" "}
                                      {r.emitente_nome || "—"}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">CNPJ:</span> {formatCnpj(r.emitente_cnpj)}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">IE:</span> {r.emitente_ie || "—"}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">UF:</span> {r.emitente_uf || "—"}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Nat. Operação:</span>{" "}
                                      {r.natureza_operacao || "—"}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Recebido:</span>{" "}
                                      {r.recebido ? "Sim" : "Não"}
                                    </div>
                                    <div className="col-span-3">
                                      <span className="text-muted-foreground">Chave:</span>{" "}
                                      <span className="font-mono text-[10px]">{r.chave_acesso}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Itens da Nota (do dados_extraidos) */}
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">Itens da Nota</h4>
                                  {itens.length === 0 ? (
                                    <p className="text-xs text-muted-foreground italic">Sem itens detalhados.</p>
                                  ) : (
                                    <div className="border rounded-md overflow-auto">
                                      <Table>
                                        <TableHeader>
                                          <TableRow>
                                            <TableHead className="text-[10px]">#</TableHead>
                                            <TableHead className="text-[10px]">Código</TableHead>
                                            <TableHead className="text-[10px]">Descrição</TableHead>
                                            <TableHead className="text-[10px] font-mono">NCM</TableHead>
                                            <TableHead className="text-[10px] font-mono">CFOP</TableHead>
                                            <TableHead className="text-[10px]">Unid.</TableHead>
                                            <TableHead className="text-[10px] text-right">Qtd.</TableHead>
                                            <TableHead className="text-[10px] text-right">V. Unit.</TableHead>
                                            <TableHead className="text-[10px] text-right">V. Total</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {itens.map((it) => (
                                            <TableRow key={it.numero_item}>
                                              <TableCell className="text-[10px]">{it.numero_item}</TableCell>
                                              <TableCell className="text-[10px]">{it.codigo_produto}</TableCell>
                                              <TableCell className="text-[10px] max-w-[220px] truncate">
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <span>{it.descricao}</span>
                                                  </TooltipTrigger>
                                                  <TooltipContent className="max-w-sm">
                                                    <p className="text-xs">{it.descricao}</p>
                                                  </TooltipContent>
                                                </Tooltip>
                                              </TableCell>
                                              <TableCell className="text-[10px] font-mono">{it.ncm || "—"}</TableCell>
                                              <TableCell className="text-[10px] font-mono">{it.cfop || "—"}</TableCell>
                                              <TableCell className="text-[10px]">{it.unidade || "—"}</TableCell>
                                              <TableCell className="text-[10px] text-right">
                                                {it.quantidade ?? "—"}
                                              </TableCell>
                                              <TableCell className="text-[10px] text-right">
                                                {formatCurrency(it.valor_unitario)}
                                              </TableCell>
                                              <TableCell className="text-[10px] text-right">
                                                {formatCurrency(it.valor_total)}
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </div>
                                  )}
                                </div>

                                {/* Lotes gerados (só p/ lançadas — lidos do Alvo) */}
                                {isLancada && (
                                  <div>
                                    <div className="flex items-center justify-between mb-2">
                                      <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                                        <Boxes className="h-3.5 w-3.5" /> Lotes Gerados no Alvo
                                      </h4>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 gap-1 text-[10px]"
                                        onClick={() => carregarLotes(r, true)}
                                        disabled={loadingLotes === r.id}
                                      >
                                        {loadingLotes === r.id ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <RefreshCw className="h-3 w-3" />
                                        )}{" "}
                                        Atualizar
                                      </Button>
                                    </div>
                                    {loadingLotes === r.id ? (
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <Loader2 className="h-3 w-3 animate-spin" /> Carregando lotes do Alvo...
                                      </div>
                                    ) : lotes.length === 0 ? (
                                      <p className="text-xs text-muted-foreground italic">
                                        Nenhum lote gerado para esta nota (ou produto sem controle de lote).
                                      </p>
                                    ) : (
                                      <div className="border rounded-md overflow-auto">
                                        <Table>
                                          <TableHeader>
                                            <TableRow>
                                              <TableHead className="text-[10px]">Lote</TableHead>
                                              <TableHead className="text-[10px]">Produto</TableHead>
                                              <TableHead className="text-[10px] text-right">Qtd.</TableHead>
                                              <TableHead className="text-[10px]">Fabricação</TableHead>
                                              <TableHead className="text-[10px]">Validade</TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {lotes.map((l, i) => (
                                              <TableRow key={`${l.numeroLote}-${i}`}>
                                                <TableCell className="text-[10px] font-mono">{l.numeroLote}</TableCell>
                                                <TableCell className="text-[10px] max-w-[220px] truncate">
                                                  {l.produto}
                                                </TableCell>
                                                <TableCell className="text-[10px] text-right">{l.quantidade}</TableCell>
                                                <TableCell className="text-[10px]">
                                                  {formatDate(l.dataFabricacao)}
                                                </TableCell>
                                                <TableCell className="text-[10px]">
                                                  {formatDate(l.dataValidade)}
                                                </TableCell>
                                              </TableRow>
                                            ))}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Valores e Impostos */}
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">
                                    Valores e Impostos
                                  </h4>
                                  <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
                                    <div>
                                      <span className="text-muted-foreground">V. Produtos:</span>{" "}
                                      {formatCurrency(r.valor_produtos)}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">V. Frete:</span>{" "}
                                      {formatCurrency(r.valor_frete)}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">V. Desconto:</span>{" "}
                                      {formatCurrency(r.valor_desconto)}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">ICMS:</span>{" "}
                                      {formatCurrency(r.valor_icms)}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">IPI:</span> {formatCurrency(r.valor_ipi)}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">V. Total:</span>{" "}
                                      <span className="font-semibold">{formatCurrency(r.valor_total)}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Ações de detalhe */}
                                <div className="flex gap-2 pt-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setXmlDialog({
                                        open: true,
                                        numero: r.numero || "",
                                        fornecedor: r.emitente_nome || "",
                                        xml: r.raw_xml || "Sem XML disponível",
                                      });
                                    }}
                                  >
                                    <Eye className="h-3 w-3" /> Ver XML
                                  </Button>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    </TooltipProvider>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="text-xs">
                    Total: {filtered.length} NF-e(s)
                  </TableCell>
                  <TableCell className="text-xs text-right font-semibold">{formatCurrency(footerTotal)}</TableCell>
                  <TableCell colSpan={4} />
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Ver XML */}
      <Dialog open={xmlDialog.open} onOpenChange={(open) => setXmlDialog((prev) => ({ ...prev, open }))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              XML da NF-e {xmlDialog.numero} — {xmlDialog.fornecedor}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">{xmlDialog.xml}</pre>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => {
                navigator.clipboard.writeText(xmlDialog.xml);
                toast({ title: "Copiado!" });
              }}
            >
              <Copy className="h-3 w-3" /> Copiar XML
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vincular */}
      {vincularDialog.nfe && (
        <VincularPedidoNfeDialog
          open={vincularDialog.open}
          onOpenChange={(open) => setVincularDialog((prev) => ({ ...prev, open }))}
          nfe={{
            id: vincularDialog.nfe.id,
            numero: vincularDialog.nfe.numero,
            emitente_nome: vincularDialog.nfe.emitente_nome,
            emitente_cnpj: vincularDialog.nfe.emitente_cnpj,
            valor_total: vincularDialog.nfe.valor_total,
          }}
          onVinculado={() => {
            setVincularDialog({ open: false, nfe: null });
            fetchRows();
          }}
        />
      )}

      {/* Lançar */}
      <LancarNfeModal
        open={lancarModal.open}
        onOpenChange={(open) => setLancarModal((prev) => ({ ...prev, open }))}
        nfe={lancarModal.nfe as any}
        onLancado={() => {
          setLancarModal({ open: false, nfe: null });
          fetchRows();
        }}
      />

      {/* Desvincular / Reverter */}
      <AlertDialog
        open={!!alertAction}
        onOpenChange={(open) => {
          if (!open) setAlertAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {alertAction?.type === "desvincular" && "Confirmar Desvinculação"}
              {alertAction?.type === "reverter" && "Reverter Lançamento"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {alertAction?.type === "desvincular" && `Desvincular NF-e #${alertAction.nfe.numero} do pedido?`}
              {alertAction?.type === "reverter" &&
                `Reverter lançamento da NF-e #${alertAction.nfe.numero}? Isso NÃO remove o lançamento do Alvo — apenas volta o status aqui para "vinculada".`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ComprasNotasFiscais;
