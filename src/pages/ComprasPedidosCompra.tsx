import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { syncPedidosCompra } from "@/services/alvoPedCompService";
import { carregarDetalhesPedido, baixarAnexoPedido } from "@/services/alvoPedCompLoadService";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RefreshCw,
  Download,
  ChevronDown,
  ChevronRight,
  Play,
  X,
  Loader2,
  Layers,
  Package,
  Calendar,
  Paperclip,
  FileText,
  CheckCircle2,
} from "lucide-react";

type Pedido = {
  id: string;
  numero: string;
  codigo_empresa_filial: string;
  status: string | null;
  aprovado: string | null;
  status_aprovacao: string | null;
  comprado: string | null;
  tipo: string | null;
  data_pedido: string | null;
  data_cadastro: string | null;
  data_entrega: string | null;
  data_validade: string | null;
  codigo_entidade: string | null;
  nome_entidade: string | null;
  cnpj_entidade: string | null;
  valor_mercadoria: number | null;
  valor_servico: number | null;
  valor_total: number | null;
  valor_frete: number | null;
  valor_desconto: number | null;
  codigo_cond_pag: string | null;
  nome_cond_pag: string | null;
  codigo_usuario: string | null;
  texto: string | null;
  texto_historico: string | null;
  classe_rec_desp: string | null;
  centro_custo: string | null;
  synced_at: string | null;
  itens: any[] | null;
  parcelas: any[] | null;
  classe_rateio: any[] | null;
  anexos: any[] | null;
  detalhes_carregados: boolean | null;
  detalhes_carregados_em: string | null;
};

const fmtBRL = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const fmtCnpj = (c: string | null | undefined) => {
  if (!c) return "—";
  const digits = c.replace(/\D/g, "");
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return c;
};

const now = new Date();

export default function ComprasPedidosCompra() {
  const { toast } = useToast();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());
  const [rows, setRows] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [lastSyncInfo, setLastSyncInfo] = useState<{ timestamp: number; mes: number; ano: number } | null>(null);
  const [showSyncPicker, setShowSyncPicker] = useState(false);
  const [syncMes, setSyncMes] = useState(now.getMonth() + 1);
  const [syncAno, setSyncAno] = useState(now.getFullYear());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tipoFilter, setTipoFilter] = useState("all");
  const [aprovFilter, setAprovFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadingDetailsId, setLoadingDetailsId] = useState<string | null>(null);
  const [refreshingDetailsId, setRefreshingDetailsId] = useState<string | null>(null);
  const [nomeClassesCache, setNomeClassesCache] = useState<Record<string, string>>({});
  const [nomeCCCache, setNomeCCCache] = useState<Record<string, string>>({});
  const [nfseCountByPedido, setNfseCountByPedido] = useState<Record<string, number>>({});
  const [nfseByPedido, setNfseByPedido] = useState<Record<string, any[]>>({});

  // Load last sync timestamp
  useEffect(() => {
    supabase
      .from("compras_config")
      .select("valor")
      .eq("chave", "pedcomp_last_sync_ts")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.valor) {
          try {
            const parsed = JSON.parse(data.valor);
            if (parsed.timestamp) setLastSyncInfo(parsed);
            else setLastSyncInfo({ timestamp: Number(data.valor), mes: 0, ano: 0 });
          } catch {
            setLastSyncInfo({ timestamp: Number(data.valor), mes: 0, ano: 0 });
          }
        }
      });
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const padM = String(mes).padStart(2, "0");
    const startDate = `${ano}-${padM}-01`;
    const lastDay = new Date(ano, mes, 0).getDate();
    const endDate = `${ano}-${padM}-${String(lastDay).padStart(2, "0")}`;

    const { data, error } = await supabase
      .from("compras_pedidos")
      .select("*")
      .gte("data_pedido", startDate)
      .lte("data_pedido", endDate)
      .order("data_pedido", { ascending: false });

    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      setRows((data ?? []) as Pedido[]);
      // Batch fetch NFS-e counts
      const numeros = (data || []).map((r: any) => r.numero).filter(Boolean);
      if (numeros.length > 0) {
        const { data: nfseData } = await supabase
          .from("compras_nfse")
          .select("pedido_compra_numero, id")
          .in("pedido_compra_numero", numeros);
        const map: Record<string, number> = {};
        (nfseData || []).forEach((n: any) => {
          map[n.pedido_compra_numero] = (map[n.pedido_compra_numero] || 0) + 1;
        });
        setNfseCountByPedido(map);
      }
    }
    setLoading(false);
  }, [ano, mes, toast]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg("");
    try {
      await syncPedidosCompra(syncMes, syncAno, (msg) => setSyncMsg(msg));
      setLastSyncInfo({ timestamp: Date.now(), mes: syncMes, ano: syncAno });
      setShowSyncPicker(false);
      await fetchRows();
      toast({ title: "Sincronização concluída" });
    } catch (err: any) {
      toast({ title: "Erro na sincronização", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const lastSyncLabel = lastSyncInfo
    ? `${new Date(lastSyncInfo.timestamp).toLocaleString("pt-BR")}${lastSyncInfo.mes ? ` (${String(lastSyncInfo.mes).padStart(2, "0")}/${lastSyncInfo.ano})` : ""}`
    : "Nunca";

  const filtered = useMemo(() => {
    let f = rows;
    if (search) {
      const s = search.toLowerCase();
      f = f.filter(
        (r) =>
          r.nome_entidade?.toLowerCase().includes(s) ||
          r.cnpj_entidade?.includes(s) ||
          r.numero?.toLowerCase().includes(s),
      );
    }
    if (statusFilter !== "all") {
      f = f.filter((r) => (r.status || "").toLowerCase().includes(statusFilter.toLowerCase()));
    }
    if (tipoFilter !== "all") {
      f = f.filter((r) => r.tipo === tipoFilter);
    }
    if (aprovFilter !== "all") {
      f = f.filter((r) => (r.aprovado || "").toLowerCase() === aprovFilter.toLowerCase());
    }
    return f;
  }, [rows, search, statusFilter, tipoFilter, aprovFilter]);

  const handleExport = async () => {
    const XLSX = await import("xlsx");
    const exportRows = filtered.map((r) => ({
      Número: r.numero,
      "Data Pedido": fmtDate(r.data_pedido),
      "Data Entrega": fmtDate(r.data_entrega),
      Fornecedor: r.nome_entidade,
      CNPJ: r.cnpj_entidade,
      Tipo: r.tipo,
      "Valor Mercadoria": r.valor_mercadoria,
      "Valor Serviço": r.valor_servico,
      "Valor Total": r.valor_total,
      Status: r.status,
      Aprovado: r.aprovado,
      "Cond. Pagamento": r.codigo_cond_pag,
      Comprador: r.codigo_usuario,
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pedidos");
    XLSX.writeFile(wb, `pedidos_compra_${ano}_${mes}.xlsx`);
  };

  // Resolve class/CC names in batch
  const resolveNames = useCallback(
    async (r: Pedido) => {
      const classeRateio = (r.classe_rateio as any[]) || [];
      const itens = (r.itens as any[]) || [];
      const classeCodes = new Set<string>();
      const ccCodes = new Set<string>();

      classeRateio.forEach((c) => {
        if (c.classe && !nomeClassesCache[c.classe]) classeCodes.add(c.classe);
        (c.centrosCusto || []).forEach((cc: any) => {
          if (cc.codigo && !nomeCCCache[cc.codigo]) ccCodes.add(cc.codigo);
        });
      });
      itens.forEach((item) => {
        if (item.classe && !nomeClassesCache[item.classe]) classeCodes.add(item.classe);
        if (item.centroCusto && !nomeCCCache[item.centroCusto]) ccCodes.add(item.centroCusto);
      });

      const promises: Promise<any>[] = [];
      if (classeCodes.size > 0) {
        const p = async () => {
          const { data } = await supabase
            .from("classes_rec_desp")
            .select("codigo, nome")
            .in("codigo", [...classeCodes]);
          if (data) {
            const map: Record<string, string> = {};
            data.forEach((d) => {
              map[d.codigo] = d.nome;
            });
            setNomeClassesCache((prev) => ({ ...prev, ...map }));
          }
        };
        promises.push(p());
      }
      if (ccCodes.size > 0) {
        const p = async () => {
          const { data } = await supabase
            .from("cost_centers")
            .select("erp_code, name")
            .in("erp_code", [...ccCodes]);
          if (data) {
            const map: Record<string, string> = {};
            data.forEach((d) => {
              if (d.erp_code) map[d.erp_code] = d.name;
            });
            setNomeCCCache((prev) => ({ ...prev, ...map }));
          }
        };
        promises.push(p());
      }
      await Promise.all(promises);
    },
    [nomeClassesCache, nomeCCCache],
  );

  const fetchNfseForPedido = useCallback(async (numero: string) => {
    const { data: nfseVinculadas } = await supabase
      .from("compras_nfse")
      .select("id, numero, prestador_nome, prestador_cnpj, valor_servico, data_emissao, status_lancamento, lancado_em")
      .eq("pedido_compra_numero", numero)
      .order("data_emissao", { ascending: false });
    if (nfseVinculadas) {
      setNfseByPedido((prev) => ({ ...prev, [numero]: nfseVinculadas }));
    }
  }, []);

  const handleExpand = useCallback(
    async (r: Pedido) => {
      if (expandedId === r.id) {
        setExpandedId(null);
        return;
      }
      setExpandedId(r.id);

      if (r.detalhes_carregados) {
        await Promise.all([resolveNames(r), fetchNfseForPedido(r.numero)]);
        return;
      }

      setLoadingDetailsId(r.id);
      try {
        await carregarDetalhesPedido(r.numero);
        const { data } = await supabase.from("compras_pedidos").select("*").eq("id", r.id).single();
        if (data) {
          setRows((prev) => prev.map((p) => (p.id === r.id ? (data as Pedido) : p)));
          await Promise.all([resolveNames(data as Pedido), fetchNfseForPedido(r.numero)]);
        }
      } catch (err: any) {
        toast({ title: "Erro ao carregar detalhes", description: err.message, variant: "destructive" });
        await fetchNfseForPedido(r.numero);
      } finally {
        setLoadingDetailsId(null);
      }
    },
    [expandedId, resolveNames, fetchNfseForPedido, toast],
  );

  const handleRefreshDetails = useCallback(
    async (r: Pedido) => {
      setRefreshingDetailsId(r.id);
      try {
        await carregarDetalhesPedido(r.numero);
        const { data } = await supabase.from("compras_pedidos").select("*").eq("id", r.id).single();
        if (data) {
          setRows((prev) => prev.map((p) => (p.id === r.id ? (data as Pedido) : p)));
          await resolveNames(data as Pedido);
        }
        toast({ title: "Detalhes atualizados" });
      } catch (err: any) {
        toast({ title: "Erro ao atualizar detalhes", description: err.message, variant: "destructive" });
      } finally {
        setRefreshingDetailsId(null);
      }
    },
    [resolveNames, toast],
  );

  const statusBadge = (s: string | null) => {
    const val = (s || "").toLowerCase();
    if (val === "aberto") return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Aberto</Badge>;
    if (val.includes("parcial"))
      return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Parcial</Badge>;
    if (val === "encerrado") return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Encerrado</Badge>;
    if (val === "cancelado") return <Badge variant="destructive">Cancelado</Badge>;
    return <Badge variant="outline">{s || "—"}</Badge>;
  };

  const tipoBadge = (t: string | null) => {
    if (t === "Produto") return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">Produto</Badge>;
    if (t === "Serviço") return <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">Serviço</Badge>;
    return <Badge variant="outline">{t || "Misto"}</Badge>;
  };

  const aprovBadge = (a: string | null) => {
    const val = (a || "").toLowerCase();
    if (val === "total" || val === "sim")
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">{a}</Badge>;
    if (val === "parcial") return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Parcial</Badge>;
    if (val === "não") return <Badge variant="destructive">Não</Badge>;
    return <Badge variant="outline">{a || "—"}</Badge>;
  };

  const totalFiltered = filtered.reduce((s, r) => s + (r.valor_total || 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Pedidos de Compra</h1>
        <p className="text-sm text-muted-foreground">Pedidos de compra sincronizados do ERP Alvo</p>
      </div>

      {/* Sync Card */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Sincronizar pedidos de compra do ERP Alvo</p>
                <p className="text-xs text-muted-foreground">Última sincronização: {lastSyncLabel}</p>
                {syncMsg && <p className="text-xs text-primary mt-1">{syncMsg}</p>}
              </div>
            </div>
            {!showSyncPicker && (
              <Button onClick={() => setShowSyncPicker(true)} disabled={syncing} size="sm">
                <RefreshCw className="mr-2 h-4 w-4" />
                Sincronizar Pedidos
              </Button>
            )}
          </div>

          {showSyncPicker && (
            <div className="border rounded-md p-4 bg-muted/30 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <p className="text-sm font-medium">Selecione o período</p>
              <div className="flex items-center gap-3">
                <Select value={String(syncMes)} onValueChange={(v) => setSyncMes(Number(v))}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => (
                      <SelectItem key={i + 1} value={String(i + 1)}>
                        {new Date(2000, i).toLocaleString("pt-BR", { month: "long" })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={String(syncAno)} onValueChange={(v) => setSyncAno(Number(v))}>
                  <SelectTrigger className="w-[90px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => setShowSyncPicker(false)} disabled={syncing}>
                  <X className="mr-1 h-4 w-4" /> Cancelar
                </Button>
                <Button size="sm" onClick={handleSync} disabled={syncing}>
                  {syncing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  {syncing ? "Sincronizando..." : "Iniciar Sincronização"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {new Date(2000, i).toLocaleString("pt-BR", { month: "short" })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
            <SelectTrigger className="w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2023, 2024, 2025, 2026, 2027].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input
          placeholder="Buscar fornecedor, CNPJ ou número..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-[250px]"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="aberto">Aberto</SelectItem>
            <SelectItem value="parcial">Parcial</SelectItem>
            <SelectItem value="encerrado">Encerrado</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tipoFilter} onValueChange={setTipoFilter}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="Produto">Produto</SelectItem>
            <SelectItem value="Serviço">Serviço</SelectItem>
            <SelectItem value="Misto">Misto</SelectItem>
          </SelectContent>
        </Select>
        <Select value={aprovFilter} onValueChange={setAprovFilter}>
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Aprovação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="sim">Sim</SelectItem>
            <SelectItem value="não">Não</SelectItem>
            <SelectItem value="total">Total</SelectItem>
            <SelectItem value="parcial">Parcial</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" /> Exportar Excel
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Número</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Valor Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aprovado</TableHead>
                <TableHead>Comprador</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    Nenhum pedido encontrado no período.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TooltipProvider key={r.id}>
                    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => handleExpand(r)}>
                      <TableCell>
                        {expandedId === r.id ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.numero}</TableCell>
                      <TableCell className="text-xs">{fmtDate(r.data_pedido)}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>{r.nome_entidade || "—"}</span>
                          </TooltipTrigger>
                          <TooltipContent>{r.nome_entidade}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{fmtCnpj(r.cnpj_entidade)}</TableCell>
                      <TableCell>{tipoBadge(r.tipo)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtBRL(r.valor_total)}</TableCell>
                      <TableCell>
                        {statusBadge(r.status)}
                        {(nfseCountByPedido[r.numero] || 0) > 0 && (
                          <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100 ml-1 text-[10px]">
                            {nfseCountByPedido[r.numero]} NFS-e
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{aprovBadge(r.aprovado)}</TableCell>
                      <TableCell className="text-xs">{r.codigo_usuario || "—"}</TableCell>
                    </TableRow>
                    {expandedId === r.id && (
                      <TableRow>
                        <TableCell colSpan={10} className="bg-muted/30 p-4">
                          {loadingDetailsId === r.id ? (
                            <div className="flex items-center gap-3 py-6 justify-center">
                              <Loader2 className="h-5 w-5 animate-spin text-primary" />
                              <span className="text-sm text-muted-foreground">Carregando detalhes do pedido...</span>
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {/* Seção 1 — Rateio */}
                              <div>
                                <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                                  <Layers className="h-3.5 w-3.5" /> Classe de Despesa e Centro de Custo
                                </h4>
                                {(() => {
                                  const cr = (r.classe_rateio as any[]) || [];
                                  if (cr.length === 0)
                                    return (
                                      <p className="text-xs text-muted-foreground italic">
                                        Nenhuma classe/centro de custo definido neste pedido
                                      </p>
                                    );
                                  return (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b text-muted-foreground">
                                          <th className="text-left py-1 pr-2">Classe</th>
                                          <th className="text-left py-1 pr-2">Nome Classe</th>
                                          <th className="text-left py-1 pr-2">CC</th>
                                          <th className="text-left py-1 pr-2">Nome CC</th>
                                          <th className="text-right py-1 pr-2">%</th>
                                          <th className="text-right py-1">Valor</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {cr.map((c: any, i: number) => {
                                          const ccs = c.centrosCusto || [];
                                          const ccCode = ccs[0]?.codigo || "—";
                                          return (
                                            <tr key={i} className="border-b border-muted/50">
                                              <td className="py-1 pr-2 font-mono">{c.classe}</td>
                                              <td className="py-1 pr-2">{nomeClassesCache[c.classe] || "—"}</td>
                                              <td className="py-1 pr-2 font-mono">{ccCode}</td>
                                              <td className="py-1 pr-2">
                                                {ccCode !== "—" ? nomeCCCache[ccCode] || "—" : "—"}
                                              </td>
                                              <td className="py-1 pr-2 text-right">
                                                {c.percentual != null ? `${c.percentual}%` : "—"}
                                              </td>
                                              <td className="py-1 text-right font-mono">
                                                {c.valor != null ? fmtBRL(c.valor) : "—"}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  );
                                })()}
                              </div>

                              <Separator />

                              {/* Seção 2 — Itens */}
                              <div>
                                <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                                  <Package className="h-3.5 w-3.5" /> Itens do Pedido
                                </h4>
                                {(() => {
                                  const itens = (r.itens as any[]) || [];
                                  if (itens.length === 0)
                                    return (
                                      <p className="text-xs text-muted-foreground italic">
                                        Pedido sem itens detalhados (comum em pedidos de serviço)
                                      </p>
                                    );
                                  return (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b text-muted-foreground">
                                          <th className="text-left py-1 pr-2">#</th>
                                          <th className="text-left py-1 pr-2">Produto</th>
                                          <th className="text-left py-1 pr-2">Descrição</th>
                                          <th className="text-left py-1 pr-2">Classe</th>
                                          <th className="text-left py-1 pr-2">CC</th>
                                          <th className="text-left py-1 pr-2">Unid.</th>
                                          <th className="text-right py-1 pr-2">Qtd</th>
                                          <th className="text-right py-1 pr-2">Vlr Unit</th>
                                          <th className="text-right py-1">Vlr Total</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {itens.map((item: any, i: number) => (
                                          <tr key={i} className="border-b border-muted/50">
                                            <td className="py-1 pr-2">{item.sequencia}</td>
                                            <td className="py-1 pr-2 font-mono">{item.codigoProduto || "—"}</td>
                                            <td className="py-1 pr-2">
                                              {item.nomeProduto || "—"}
                                              {item.itemServico === "Sim" && (
                                                <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0">
                                                  Serviço
                                                </Badge>
                                              )}
                                              {item.cancelado === "Sim" && (
                                                <Badge variant="destructive" className="ml-1 text-[10px] px-1 py-0">
                                                  Cancelado
                                                </Badge>
                                              )}
                                            </td>
                                            <td className="py-1 pr-2">
                                              {item.classe ? (
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <span className="font-mono text-xs cursor-help">{item.classe}</span>
                                                  </TooltipTrigger>
                                                  <TooltipContent>
                                                    {nomeClassesCache[item.classe] || item.classe}
                                                  </TooltipContent>
                                                </Tooltip>
                                              ) : (
                                                "—"
                                              )}
                                            </td>
                                            <td className="py-1 pr-2">
                                              {item.centroCusto ? (
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <span className="font-mono text-xs cursor-help">
                                                      {item.centroCusto}
                                                    </span>
                                                  </TooltipTrigger>
                                                  <TooltipContent>
                                                    {nomeCCCache[item.centroCusto] || item.centroCusto}
                                                  </TooltipContent>
                                                </Tooltip>
                                              ) : (
                                                "—"
                                              )}
                                            </td>
                                            <td className="py-1 pr-2">{item.unidade || "—"}</td>
                                            <td className="py-1 pr-2 text-right">{item.quantidade ?? "—"}</td>
                                            <td className="py-1 pr-2 text-right font-mono">
                                              {item.valorUnitario != null ? fmtBRL(item.valorUnitario) : "—"}
                                            </td>
                                            <td className="py-1 text-right font-mono">
                                              {item.valorTotal != null ? fmtBRL(item.valorTotal) : "—"}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  );
                                })()}
                              </div>

                              <Separator />

                              {/* Seção 3 — Parcelas */}
                              <div>
                                <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                                  <Calendar className="h-3.5 w-3.5" /> Parcelas de Pagamento
                                </h4>
                                {(() => {
                                  const parcelas = (r.parcelas as any[]) || [];
                                  if (parcelas.length === 0)
                                    return (
                                      <p className="text-xs text-muted-foreground italic">Nenhuma parcela definida</p>
                                    );
                                  return (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="border-b text-muted-foreground">
                                          <th className="text-left py-1 pr-2">#</th>
                                          <th className="text-left py-1 pr-2">Duplicata</th>
                                          <th className="text-left py-1 pr-2">Vencimento</th>
                                          <th className="text-right py-1">Valor</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {parcelas.map((p: any, i: number) => (
                                          <tr key={i} className="border-b border-muted/50">
                                            <td className="py-1 pr-2">{p.sequencia}</td>
                                            <td className="py-1 pr-2 font-mono">{p.duplicata || "—"}</td>
                                            <td className="py-1 pr-2">{fmtDate(p.vencimento)}</td>
                                            <td className="py-1 text-right font-mono">
                                              {p.valor != null ? fmtBRL(p.valor) : "—"}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  );
                                })()}
                              </div>

                              <Separator />

                              {/* Seção 4 — Dados gerais */}
                              <div>
                                <h4 className="text-xs font-semibold text-muted-foreground mb-2">Detalhes do Pedido</h4>
                                <div className="grid grid-cols-3 gap-4 text-sm">
                                  <div>
                                    <span className="text-muted-foreground text-xs">Fornecedor:</span>
                                    <p>{r.nome_entidade || "—"}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">CNPJ:</span>
                                    <p className="font-mono">{fmtCnpj(r.cnpj_entidade)}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Código Entidade:</span>
                                    <p className="font-mono">{r.codigo_entidade || "—"}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Cond. Pagamento:</span>
                                    <p>
                                      {r.codigo_cond_pag
                                        ? `${r.codigo_cond_pag}${r.nome_cond_pag ? ` — ${r.nome_cond_pag}` : ""}`
                                        : "—"}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Comprador:</span>
                                    <p>{r.codigo_usuario || "—"}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Data Entrega:</span>
                                    <p>{fmtDate(r.data_entrega)}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Data Validade:</span>
                                    <p>{fmtDate(r.data_validade)}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Data Cadastro:</span>
                                    <p>{fmtDate(r.data_cadastro)}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Valor Mercadoria:</span>
                                    <p>{fmtBRL(r.valor_mercadoria)}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Valor Serviço:</span>
                                    <p>{fmtBRL(r.valor_servico)}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Valor Frete:</span>
                                    <p>{fmtBRL(r.valor_frete)}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Valor Desconto:</span>
                                    <p>{fmtBRL(r.valor_desconto)}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground text-xs">Valor Total:</span>
                                    <p className="font-semibold">{fmtBRL(r.valor_total)}</p>
                                  </div>
                                </div>
                              </div>

                              {/* Observações */}
                              {r.texto && (
                                <>
                                  <Separator />
                                  <div>
                                    <h4 className="text-xs font-semibold text-muted-foreground mb-2">Observações</h4>
                                    <div className="max-h-[120px] overflow-auto rounded border bg-background p-2 text-xs">
                                      {r.texto}
                                    </div>
                                  </div>
                                </>
                              )}

                              {/* Seção 5 — Anexos */}
                              {(() => {
                                const anexos = (r.anexos as any[]) || [];
                                if (anexos.length === 0) return null;
                                return (
                                  <>
                                    <Separator />
                                    <div>
                                      <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                                        <Paperclip className="h-3.5 w-3.5" /> Anexos
                                      </h4>
                                      <div className="space-y-1.5">
                                        {anexos.map((a: any, i: number) => (
                                          <div key={i} className="flex items-center gap-2 text-xs">
                                            <button
                                              className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer font-medium"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                baixarAnexoPedido(a.nomeArquivo, a.caminhoOriginal, a.storagePath)
                                                  .then(() => toast({ title: `${a.nomeArquivo} baixado!` }))
                                                  .catch((err) =>
                                                    toast({
                                                      title: "Erro ao baixar",
                                                      description: err.message,
                                                      variant: "destructive",
                                                    }),
                                                  );
                                              }}
                                            >
                                              <Download className="h-3 w-3" />
                                              {a.nomeArquivo}
                                            </button>
                                            {a.storagePath ? (
                                              <span
                                                className="text-[10px] text-green-600"
                                                title="Disponível offline (cache)"
                                              >
                                                ● cache
                                              </span>
                                            ) : (
                                              <span
                                                className="text-[10px] text-muted-foreground"
                                                title="Requer conexão com ERP"
                                              >
                                                ● ERP
                                              </span>
                                            )}
                                            <span className="text-muted-foreground">
                                              — {a.usuario || "—"} em {fmtDate(a.data)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                );
                              })()}

                              <Separator />

                              {/* Rodapé */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRefreshDetails(r);
                                    }}
                                    disabled={refreshingDetailsId === r.id}
                                  >
                                    {refreshingDetailsId === r.id ? (
                                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                    )}
                                    Atualizar detalhes
                                  </Button>
                                  {r.detalhes_carregados_em && (
                                    <span className="text-xs text-muted-foreground">
                                      Detalhes carregados em{" "}
                                      {new Date(r.detalhes_carregados_em).toLocaleString("pt-BR")}
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                                    <FileText className="h-3.5 w-3.5" /> NFS-e Vinculadas
                                  </h4>
                                  {(() => {
                                    const nfses = nfseByPedido[r.numero] || [];
                                    if (nfses.length === 0)
                                      return (
                                        <p className="text-xs text-muted-foreground italic">
                                          Nenhuma NFS-e vinculada a este pedido.
                                        </p>
                                      );
                                    return (
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="border-b text-muted-foreground">
                                            <th className="text-left py-1 pr-2">Número</th>
                                            <th className="text-left py-1 pr-2">Prestador</th>
                                            <th className="text-right py-1 pr-2">Valor</th>
                                            <th className="text-left py-1 pr-2">Data Emissão</th>
                                            <th className="text-left py-1">Status</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {nfses.map((n: any) => (
                                            <tr key={n.id} className="border-b border-muted/50">
                                              <td className="py-1 pr-2 font-mono">{n.numero || "—"}</td>
                                              <td className="py-1 pr-2">{n.prestador_nome || "—"}</td>
                                              <td className="py-1 pr-2 text-right font-mono">
                                                {fmtBRL(n.valor_servico)}
                                              </td>
                                              <td className="py-1 pr-2">
                                                {n.data_emissao
                                                  ? new Date(n.data_emissao).toLocaleDateString("pt-BR")
                                                  : "—"}
                                              </td>
                                              <td className="py-1">
                                                {n.status_lancamento === "lancada" ? (
                                                  <Badge className="bg-green-100 text-green-800 hover:bg-green-100 text-[10px]">
                                                    Lançada
                                                  </Badge>
                                                ) : n.status_lancamento === "vinculada" ? (
                                                  <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 text-[10px]">
                                                    Vinculada
                                                  </Badge>
                                                ) : (
                                                  <Badge variant="outline" className="text-[10px]">
                                                    Pendente
                                                  </Badge>
                                                )}
                                                {n.lancado_em && (
                                                  <span className="ml-1 text-[10px] text-muted-foreground">
                                                    {new Date(n.lancado_em).toLocaleDateString("pt-BR")}
                                                  </span>
                                                )}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </TooltipProvider>
                ))
              )}
            </TableBody>
            {filtered.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={6} className="text-xs font-medium">
                    {filtered.length} registro(s)
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold">{fmtBRL(totalFiltered)}</TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
