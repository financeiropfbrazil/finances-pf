import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authenticateAlvo, clearAlvoToken } from "@/services/alvoService";
import { carregarDetalhesPedido } from "@/services/alvoPedCompLoadService";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, Link as LinkIcon, AlertTriangle, Search } from "lucide-react";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";

const fmtBRL = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};
const fmtCNPJ = (cnpj: string) => {
  const c = cnpj.replace(/\D/g, "");
  if (c.length === 14) return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return cnpj;
};

const PEDIDO_SELECT_COLS = "id, numero, data_pedido, valor_total, status, aprovado, codigo_entidade, nome_entidade, texto, tipo, classe_rec_desp, centro_custo, nome_cond_pag, itens, detalhes_carregados";

interface Pedido {
  id: string;
  numero: string;
  data_pedido: string | null;
  valor_total: number | null;
  status: string | null;
  aprovado: string | null;
  codigo_entidade: string | null;
  nome_entidade: string | null;
  texto: string | null;
  tipo: string | null;
  classe_rec_desp: string | null;
  centro_custo: string | null;
  nome_cond_pag: string | null;
  itens: any[] | null;
  detalhes_carregados: boolean | null;
}

interface PedidoDetails {
  classe: string | null;
  centroCusto: string | null;
  condPag: string | null;
  condPagNome: string | null;
}

interface PedidoDetailsExtra {
  tipo: string | null;
  condPagNome: string | null;
  texto: string | null;
  classeNome: string | null;
  ccNome: string | null;
  itens: any[];
  classeRateioCompleto: any[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nfse: {
    id: string;
    numero: string | null;
    prestador_nome: string | null;
    prestador_cnpj: string | null;
    valor_servico: number | null;
  };
  onVinculado: () => void;
}

export function VincularPedidoDialog({ open, onOpenChange, nfse, onVinculado }: Props) {
  const { toast } = useToast();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<PedidoDetails | null>(null);
  const [detailsExtra, setDetailsExtra] = useState<PedidoDetailsExtra | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [saving, setSaving] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<Pedido[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const cnpjLimpo = (nfse.prestador_cnpj || "").replace(/\D/g, "");

  useEffect(() => {
    if (!open) {
      setPedidos([]);
      setSelectedId(null);
      setDetails(null);
      setDetailsExtra(null);
      setSearchTerm("");
      setSearchResults([]);
      setHasSearched(false);
      return;
    }
    searchPedidos();
  }, [open]);

  const searchPedidos = async () => {
    setLoading(true);
    try {
      let { data } = await supabase
        .from("compras_pedidos")
        .select(PEDIDO_SELECT_COLS)
        .eq("cnpj_entidade", cnpjLimpo)
        .in("status", ["Aberto", "Parcial", "Comprado Parcial"])
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
            .in("status", ["Aberto", "Parcial", "Comprado Parcial"])
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
        .in("status", ["Aberto", "Parcial", "Comprado Parcial"])
        .order("data_pedido", { ascending: false })
        .limit(20);

      if (cleanSearch.length >= 11) {
        query = query.eq("cnpj_entidade", cleanSearch);
      } else if (/^\d+$/.test(term)) {
        query = query.ilike("numero", `%${term}%`);
      } else {
        query = query.ilike("nome_entidade", `%${term}%`);
      }

      const { data } = await query;
      setSearchResults((data || []) as Pedido[]);
    } catch (err) {
      console.error("Erro na busca:", err);
    } finally {
      setSearching(false);
    }
  };

  const allPedidos = [...pedidos, ...searchResults];

  const resolveNames = async (classe: string | null, centroCusto: string | null) => {
    let classeNome: string | null = null;
    let ccNome: string | null = null;

    const [classeRes, ccRes] = await Promise.all([
      classe ? supabase.from("classes_rec_desp").select("nome").eq("codigo", classe).maybeSingle() : null,
      centroCusto ? supabase.from("cost_centers").select("name").eq("erp_code", centroCusto).maybeSingle() : null,
    ]);
    classeNome = classeRes?.data?.nome || null;
    ccNome = ccRes?.data?.name || null;
    return { classeNome, ccNome };
  };

  const handleSelectPedido = async (pedidoId: string) => {
    setSelectedId(pedidoId);
    setDetails(null);
    setDetailsExtra(null);
    setLoadingDetails(true);

    const pedido = allPedidos.find(p => p.id === pedidoId);
    if (!pedido) { setLoadingDetails(false); return; }

    try {
      // Check Supabase cache first
      const { data: cached } = await supabase
        .from("compras_pedidos")
        .select("classe_rateio, nome_cond_pag, itens, detalhes_carregados, codigo_cond_pag, classe_rec_desp, centro_custo")
        .eq("numero", pedido.numero)
        .eq("codigo_empresa_filial", "1.01")
        .maybeSingle();

      let classe: string | null = null;
      let centroCusto: string | null = null;
      let condPag: string | null = null;
      let condPagNome: string | null = null;
      let itensData: any[] = [];
      let classeRateioCompleto: any[] = [];

      if (cached?.detalhes_carregados) {
        // Use cache — no ERP call
        const cr = (cached.classe_rateio as any[]) || [];
        classe = cr[0]?.classe || cached.classe_rec_desp || null;
        centroCusto = cr[0]?.centrosCusto?.[0]?.codigo || cached.centro_custo || null;
        condPag = cached.codigo_cond_pag || null;
        condPagNome = cached.nome_cond_pag || null;
        itensData = (cached.itens as any[]) || [];
        classeRateioCompleto = cr;
      } else {
        // Call ERP with GET
        const auth = await authenticateAlvo();
        if (!auth.success || !auth.token) {
          setDetails({ classe: null, centroCusto: null, condPag: null, condPagNome: null });
          setDetailsExtra({ tipo: pedido.tipo, condPagNome: null, texto: pedido.texto, classeNome: null, ccNome: null, itens: [], classeRateioCompleto: [] });
          setLoadingDetails(false);
          return;
        }

        const url = `${ERP_BASE_URL}/PedComp/Load?codigoEmpresaFilial=1.01&numero=${encodeURIComponent(pedido.numero)}&loadChild=All`;
        const resp = await fetch(url, {
          method: "GET",
          headers: { "riosoft-token": auth.token },
        });

        if (resp.status === 409) clearAlvoToken();

        if (!resp.ok) {
          setDetails({ classe: null, centroCusto: null, condPag: null, condPagNome: null });
          setDetailsExtra({ tipo: pedido.tipo, condPagNome: null, texto: pedido.texto, classeNome: null, ccNome: null, itens: [], classeRateioCompleto: [] });
          setLoadingDetails(false);
          return;
        }

        const data = await resp.json();

        const classeList = data?.PedCompClasseRecDespChildList;
        if (classeList && classeList.length > 0) {
          classe = classeList[0].CodigoClasseRecDesp || null;
          const rateioList = classeList[0].RateioPedCompChildList;
          if (rateioList && rateioList.length > 0) {
            centroCusto = rateioList[0].CodigoCentroCtrl || null;
          }
        }

        if (!classe) {
          const itemList = data?.ItemPedCompChildList;
          if (itemList && itemList.length > 0) {
            const itemClasse = itemList[0].ItemPedCompClasseRecdespChildList;
            if (itemClasse && itemClasse.length > 0) {
              classe = itemClasse[0].CodigoClasseRecDesp || null;
              const itemRateio = itemClasse[0].RateioItemPedCompChildList;
              if (itemRateio && itemRateio.length > 0) {
                centroCusto = itemRateio[0].CodigoCentroCtrl || null;
              }
            }
          }
        }

        const condPagObj = data?.CondPagPedCompObject;
        condPag = condPagObj?.CodigoCondPag || null;
        condPagNome = condPagObj?.Nome || null;

        const itemList = data?.ItemPedCompChildList || [];
        itensData = itemList.map((item: any) => ({
          codigoProduto: item.CodigoProduto,
          nomeProduto: item.NomeProduto || item.DescricaoAlternativaProduto,
          quantidade: item.QuantidadeProdUnidMedPrincipal,
          valorTotal: item.ValorTotal,
        }));

        // Persist cache via service
        try {
          await carregarDetalhesPedido(pedido.numero);
        } catch (e) {
          console.warn("Erro ao persistir cache de detalhes:", e);
        }
      }

      // Resolve names in parallel
      const { classeNome, ccNome } = await resolveNames(classe, centroCusto);

      setDetails({ classe, centroCusto, condPag, condPagNome });
      setDetailsExtra({
        tipo: pedido.tipo,
        condPagNome,
        texto: pedido.texto,
        classeNome,
        ccNome,
        itens: itensData,
        classeRateioCompleto,
      });
    } catch (err) {
      console.error("Erro ao carregar detalhes do pedido:", err);
      setDetails({ classe: null, centroCusto: null, condPag: null, condPagNome: null });
      setDetailsExtra(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleVincular = async () => {
    if (!selectedId) return;
    const pedido = allPedidos.find(p => p.id === selectedId);
    if (!pedido) return;

    setSaving(true);
    try {
      const { data: currentRow, error: loadError } = await supabase
        .from("compras_nfse")
        .select("*")
        .eq("id", nfse.id)
        .single();

      if (loadError || !currentRow) {
        throw loadError || new Error("NFS-e não encontrada para vinculação");
      }

      const payload = {
        ...currentRow,
        status_lancamento: "vinculada",
        pedido_compra_numero: pedido.numero,
        pedido_compra_entidade: pedido.codigo_entidade,
        pedido_compra_classe: details?.classe || null,
        pedido_compra_centro_custo: details?.centroCusto || null,
        pedido_compra_cond_pagamento: details?.condPag
          ? `${details.condPag}${details.condPagNome ? ` (${details.condPagNome})` : ""}`
          : null,
        pedido_compra_valor: pedido.valor_total,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("compras_nfse")
        .upsert(payload, { onConflict: "id" });

      if (error) throw error;

      toast({ title: `NFS-e vinculada ao Pedido ${pedido.numero}` });
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
    if (t.includes("servi")) return <Badge variant="secondary" className="text-[10px]">Serviço</Badge>;
    if (t.includes("produ") || t.includes("merca")) return <Badge className="text-[10px]">Produto</Badge>;
    if (t.includes("mist")) return <Badge variant="outline" className="text-[10px]">Misto</Badge>;
    return <Badge variant="outline" className="text-[10px]">{tipo}</Badge>;
  };

  const renderPedidoRows = (list: Pedido[]) =>
    list.map(p => (
      <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleSelectPedido(p.id)}>
        <TableCell><RadioGroupItem value={p.id} /></TableCell>
        <TableCell className="font-mono text-xs">{p.numero}</TableCell>
        <TableCell className="text-xs">{fmtDate(p.data_pedido)}</TableCell>
        <TableCell className="text-xs truncate max-w-[140px]">{p.nome_entidade || "—"}</TableCell>
        <TableCell>{tipoBadge(p.tipo)}</TableCell>
        <TableCell className="text-right text-xs font-mono">{fmtBRL(p.valor_total)}</TableCell>
        <TableCell><Badge variant="outline" className="text-xs">{p.status}</Badge></TableCell>
        <TableCell className="text-xs font-mono">
          {p.detalhes_carregados && p.classe_rec_desp ? p.classe_rec_desp : "—"}
        </TableCell>
      </TableRow>
    ));

  const pedidoTableHeader = (
    <TableHeader>
      <TableRow>
        <TableHead className="w-10">Sel.</TableHead>
        <TableHead>Número</TableHead>
        <TableHead>Data</TableHead>
        <TableHead>Fornecedor</TableHead>
        <TableHead>Tipo</TableHead>
        <TableHead className="text-right">Valor</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Classe/CC</TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Vincular NFS-e a Pedido de Compra</DialogTitle>
          <p className="text-xs text-muted-foreground">
            NFS-e #{nfse.numero || "—"} — {nfse.prestador_nome || "—"} — {fmtBRL(nfse.valor_servico)}
          </p>
        </DialogHeader>

        <RadioGroup value={selectedId || ""} onValueChange={handleSelectPedido}>
          {/* Section 1: Same supplier */}
          <div className="space-y-2">
            <p className="text-sm font-medium">
              Pedidos do fornecedor ({cnpjLimpo ? fmtCNPJ(cnpjLimpo) : "—"})
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-4 gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs text-muted-foreground">Buscando pedidos do fornecedor...</span>
              </div>
            ) : pedidos.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                Nenhum pedido aberto encontrado para este CNPJ.
              </p>
            ) : (
              <Table>
                {pedidoTableHeader}
                <TableBody>{renderPedidoRows(pedidos)}</TableBody>
              </Table>
            )}
          </div>

          <Separator className="my-3" />

          {/* Section 2: Search other suppliers */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Buscar pedido de outro fornecedor</p>
            <p className="text-xs text-muted-foreground">
              Use quando o pedido foi emitido em outro CNPJ (matriz, filial, etc.)
            </p>

            <div className="flex gap-2">
              <Input
                placeholder="Buscar por nome do fornecedor, CNPJ ou número do pedido"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                className="text-xs h-8"
              />
              <Button variant="outline" size="sm" onClick={handleSearch} disabled={searching} className="gap-1 shrink-0">
                {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                Buscar
              </Button>
            </div>

            {searching ? (
              <div className="flex items-center justify-center py-4 gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs text-muted-foreground">Buscando...</span>
              </div>
            ) : hasSearched && searchResults.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                Nenhum pedido encontrado para "{searchTerm}".
              </p>
            ) : searchResults.length > 0 ? (
              <Table>
                {pedidoTableHeader}
                <TableBody>{renderPedidoRows(searchResults)}</TableBody>
              </Table>
            ) : null}
          </div>
        </RadioGroup>

        {/* Details panel */}
        {selectedId && (
          <div className="rounded border bg-muted/30 p-3 text-xs space-y-3">
            {loadingDetails ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Carregando detalhes do pedido...
              </div>
            ) : details ? (
              <>
                {/* Block 1: Classification */}
                <div className="space-y-1">
                  <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Classificação</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <span className="text-muted-foreground">Classe: </span>
                      <strong className="font-mono">{details.classe || "N/D"}</strong>
                      {detailsExtra?.classeNome && <span className="text-muted-foreground"> — {detailsExtra.classeNome}</span>}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Centro de Custo: </span>
                      <strong className="font-mono">{details.centroCusto || "N/D"}</strong>
                      {detailsExtra?.ccNome && <span className="text-muted-foreground"> — {detailsExtra.ccNome}</span>}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Cond. Pagamento: </span>
                      <strong className="font-mono">{details.condPag || "N/D"}</strong>
                      {details.condPagNome && <span className="text-muted-foreground"> — {details.condPagNome}</span>}
                    </div>
                  </div>
                  {!details.classe && !details.centroCusto && (
                    <div className="flex items-center gap-1 text-yellow-600 mt-1">
                      <AlertTriangle className="h-3 w-3" />
                      <span>Este pedido não possui classificação definida.</span>
                    </div>
                  )}
                </div>

                {/* Block 2: Items */}
                {detailsExtra && detailsExtra.itens.length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Itens do pedido</p>
                      <div className="max-h-[120px] overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs py-1">Produto</TableHead>
                              <TableHead className="text-xs py-1">Descrição</TableHead>
                              <TableHead className="text-xs py-1 text-right">Qtd</TableHead>
                              <TableHead className="text-xs py-1 text-right">Valor</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detailsExtra.itens.map((item: any, idx: number) => (
                              <TableRow key={idx}>
                                <TableCell className="text-xs py-1 font-mono">{item.codigoProduto || "—"}</TableCell>
                                <TableCell className="text-xs py-1 truncate max-w-[200px]">{item.nomeProduto || "—"}</TableCell>
                                <TableCell className="text-xs py-1 text-right font-mono">{item.quantidade ?? "—"}</TableCell>
                                <TableCell className="text-xs py-1 text-right font-mono">{fmtBRL(item.valorTotal)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </>
                )}
                {detailsExtra && detailsExtra.itens.length === 0 && (
                  <>
                    <Separator />
                    <p className="text-xs text-muted-foreground italic">Sem itens detalhados.</p>
                  </>
                )}

                {/* Block 3: Notes */}
                {detailsExtra?.texto && (
                  <>
                    <Separator />
                    <div className="space-y-1">
                      <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Observações</p>
                      <div className="max-h-[60px] overflow-auto text-xs bg-background rounded border p-2">
                        {detailsExtra.texto}
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleVincular}
            disabled={!selectedId || loadingDetails || saving}
            className="gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
