import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search,
  RefreshCw,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  Clock,
  Timer,
  ChevronDown,
  ChevronRight,
  Eye,
  Copy,
  Package,
  Hash,
  Link as LinkIcon,
  Unlink,
  RotateCcw,
  Send,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { importarNfesDoSefaz } from "@/services/comprasNfeService";
import { VincularPedidoDialog } from "@/components/compras/VincularPedidoDialog";
import { lancarNfeNoAlvo, type LancarNfeInput, type NfeItemInput, type NfeParcelaInput } from "@/services/alvoMovEstqLancarNfeService";

// ── Types ──

interface NfeResult {
  nsu: string;
  schema: string;
  json: any;
  xml: string;
  chaveAcesso: string;
  numero: string;
  fornecedorNome: string;
  fornecedorCnpj: string;
  valor: number;
  dataEmissao: string;
  situacao: number | null;
  jaImportada: boolean;
}

interface NfeRow {
  id: string;
  nsu: string | null;
  numero: string | null;
  serie: string | null;
  chave_acesso: string;
  fornecedor_nome: string | null;
  fornecedor_cnpj: string | null;
  fornecedor_ie: string | null;
  fornecedor_uf: string | null;
  valor_produtos: number | null;
  valor_icms: number | null;
  valor_ipi: number | null;
  valor_pis: number | null;
  valor_cofins: number | null;
  valor_frete: number | null;
  valor_desconto: number | null;
  valor_total: number | null;
  data_emissao: string | null;
  situacao: string | null;
  schema_type: string | null;
  tipo_operacao: string | null;
  imported_at: string | null;
  raw_xml: string | null;
  raw_json: any;
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

interface NfeItem {
  id: string;
  compras_nfe_id: string;
  numero_item: number | null;
  codigo_produto: string | null;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total: number | null;
  valor_icms: number | null;
  valor_ipi: number | null;
  valor_pis: number | null;
  valor_cofins: number | null;
  valor_desconto: number | null;
}

// ── Helpers ──

const formatCurrency = (value: number | null | undefined) =>
  value != null
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value)
    : "—";

const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("pt-BR");
};

const formatCnpj = (cnpj: string | null) => {
  if (!cnpj) return "—";
  const c = cnpj.replace(/\D/g, "");
  if (c.length !== 14) return cnpj;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
};

const situacaoLabelSefaz = (sit: number | null) => {
  if (sit === 1) return <Badge className="bg-green-600 text-white hover:bg-green-700">Autorizada</Badge>;
  if (sit === 2) return <Badge variant="destructive">Denegada</Badge>;
  if (sit === 3) return <Badge className="bg-yellow-500 text-white hover:bg-yellow-600">Cancelada</Badge>;
  return <Badge variant="outline">—</Badge>;
};

const situacaoBadge = (sit: string | null) => {
  const s = (sit || "").toLowerCase();
  if (s === "autorizada") return <Badge className="bg-green-600 text-white hover:bg-green-700">Autorizada</Badge>;
  if (s === "cancelada") return <Badge variant="destructive">Cancelada</Badge>;
  if (s === "denegada") return <Badge className="bg-yellow-500 text-white hover:bg-yellow-600">Denegada</Badge>;
  return <Badge variant="outline">{sit || "—"}</Badge>;
};

const extractNfeData = (doc: { json: any; nsu: string; schema: string; xml: string }): NfeResult | null => {
  const { json, nsu, schema, xml } = doc;
  if (!schema) return null;
  const isResNFe = schema.includes("resNFe");
  const isProcNFe = schema.includes("procNFe");
  if (!isResNFe && !isProcNFe) return null;

  let numero = "", fornecedorNome = "", fornecedorCnpj = "";
  let valor = 0, dataEmissao = "";
  let situacao: number | null = null;
  let chaveAcesso = "";

  if (isResNFe && json?.resNFe) {
    const r = json.resNFe;
    numero = r.nNF || "";
    fornecedorNome = r.xNome || "";
    fornecedorCnpj = r.CNPJ || "";
    valor = parseFloat(r.vNF) || 0;
    dataEmissao = r.dhEmi || "";
    situacao = r.cSitNFe != null ? parseInt(r.cSitNFe) : null;
    chaveAcesso = r.chNFe || "";
  } else if (isProcNFe && json?.nfeProc) {
    const nfe = json.nfeProc?.NFe?.infNFe;
    if (nfe) {
      numero = nfe.ide?.nNF || "";
      fornecedorNome = nfe.emit?.xNome || "";
      fornecedorCnpj = nfe.emit?.CNPJ || "";
      const pag = nfe.pag?.detPag;
      if (Array.isArray(pag)) {
        valor = pag.reduce((s: number, p: any) => s + (parseFloat(p.vPag) || 0), 0);
      } else if (pag) {
        valor = parseFloat(pag.vPag) || 0;
      }
      dataEmissao = nfe.ide?.dhEmi || "";
      situacao = 1;
    }
    chaveAcesso = json.nfeProc?.protNFe?.infProt?.chNFe || "";
  }

  return { nsu, schema, json, xml, chaveAcesso, numero, fornecedorNome, fornecedorCnpj, valor, dataEmissao, situacao, jaImportada: false };
};

// ── Component ──

const ComprasNotasFiscais = () => {
  const { toast } = useToast();

  // ── SEFAZ query state (existing) ──
  const [ultNsu, setUltNsu] = useState("000000000000000");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<NfeResult[]>([]);
  const [queryDone, setQueryDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [minutesLeft, setMinutesLeft] = useState(0);
  const [lastQueryTs, setLastQueryTs] = useState<number | null>(null);
  const COOLDOWN_MS = 3600000;

  // ── Imported NF-e state (new) ──
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());
  const [rows, setRows] = useState<NfeRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroSituacao, setFiltroSituacao] = useState("todas");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [itemsCache, setItemsCache] = useState<Record<string, NfeItem[]>>({});
  const [loadingItems, setLoadingItems] = useState<string | null>(null);
  const [xmlDialog, setXmlDialog] = useState<{ open: boolean; numero: string; fornecedor: string; xml: string }>({ open: false, numero: "", fornecedor: "", xml: "" });
  const [itemsCountMap, setItemsCountMap] = useState<Record<string, number>>({});
  const [vincularDialog, setVincularDialog] = useState<{ open: boolean; nfe: NfeRow | null }>({ open: false, nfe: null });
  const [alertAction, setAlertAction] = useState<{ type: "desvincular" | "reverter"; nfe: NfeRow } | null>(null);
  const [filtroLancamento, setFiltroLancamento] = useState("todos");
  const [lancarTarget, setLancarTarget] = useState<NfeRow | null>(null);
  const [lancando, setLancando] = useState(false);

  // ── Load config from Supabase ──
  useEffect(() => {
    const loadConfig = async () => {
      const { data } = await supabase.from("compras_config").select("valor").eq("chave", "nfe_ult_nsu").maybeSingle();
      if (data?.valor) setUltNsu(data.valor);
      const { data: tsData } = await supabase.from("compras_config").select("valor").eq("chave", "nfe_last_query_ts").maybeSingle();
      if (tsData?.valor) setLastQueryTs(Number(tsData.valor));
    };
    loadConfig();
  }, []);

  useEffect(() => {
    const calcRemaining = () => {
      if (!lastQueryTs) { setMinutesLeft(0); return; }
      const diff = COOLDOWN_MS - (Date.now() - lastQueryTs);
      setMinutesLeft(diff > 0 ? Math.ceil(diff / 60000) : 0);
    };
    calcRemaining();
    const id = setInterval(calcRemaining, 60000);
    return () => clearInterval(id);
  }, [lastQueryTs]);

  // ── Fetch imported NF-e ──
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

    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      const r = (data ?? []) as unknown as NfeRow[];
      setRows(r);

      // Count items per NF-e
      if (r.length > 0) {
        const ids = r.map(n => n.id);
        // batch in chunks of 100 to avoid URL length issues
        const countMap: Record<string, number> = {};
        for (let i = 0; i < ids.length; i += 100) {
          const chunk = ids.slice(i, i + 100);
          const { data: itemRows } = await supabase
            .from("compras_nfe_itens")
            .select("compras_nfe_id")
            .in("compras_nfe_id", chunk);
          (itemRows || []).forEach((ir: any) => {
            countMap[ir.compras_nfe_id] = (countMap[ir.compras_nfe_id] || 0) + 1;
          });
        }
        setItemsCountMap(countMap);
      } else {
        setItemsCountMap({});
      }
    }
    setLoadingRows(false);
  }, [ano, mes, toast]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Refetch after import
  const handleAfterImport = useCallback(() => { fetchRows(); }, [fetchRows]);

  // ── Expand row & load items ──
  const toggleExpand = async (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!itemsCache[id]) {
      setLoadingItems(id);
      const { data } = await supabase
        .from("compras_nfe_itens")
        .select("*")
        .eq("compras_nfe_id", id)
        .order("numero_item");
      setItemsCache(prev => ({ ...prev, [id]: (data || []) as unknown as NfeItem[] }));
      setLoadingItems(null);
    }
  };

  // ── Filtering ──
  const filtered = useMemo(() => {
    let list = rows;
    if (filtroSituacao !== "todas") {
      list = list.filter(r => (r.situacao || "").toLowerCase() === filtroSituacao);
    }
    if (filtroLancamento !== "todos") {
      list = list.filter(r => (r.status_lancamento || "pendente") === filtroLancamento);
    }
    if (searchTerm.trim()) {
      const s = searchTerm.toLowerCase();
      list = list.filter(r =>
        (r.fornecedor_nome || "").toLowerCase().includes(s) ||
        (r.fornecedor_cnpj || "").includes(s) ||
        (r.numero || "").toLowerCase().includes(s)
      );
    }
    return list;
  }, [rows, filtroSituacao, filtroLancamento, searchTerm]);

  // ── Summaries ──
  const summary = useMemo(() => {
    const total = rows.length;
    const autorizadas = rows.filter(r => (r.situacao || "").toLowerCase() === "autorizada").length;
    const canceladas = rows.filter(r => ["cancelada", "denegada"].includes((r.situacao || "").toLowerCase())).length;
    const valorTotal = rows
      .filter(r => (r.situacao || "").toLowerCase() === "autorizada")
      .reduce((s, r) => s + (r.valor_total || 0), 0);
    const comItens = rows.filter(r => (itemsCountMap[r.id] || 0) > 0).length;
    return { total, autorizadas, canceladas, valorTotal, comItens };
  }, [rows, itemsCountMap]);

  const footerTotals = useMemo(() => ({
    valorTotal: filtered.reduce((s, r) => s + (r.valor_total || 0), 0),
  }), [filtered]);

  // ── SEFAZ handlers (existing) ──
  const handleConsultar = async () => {
    const pfx = localStorage.getItem("sefaz_pfx_base64");
    const pass = localStorage.getItem("sefaz_passphrase");
    const cnpj = localStorage.getItem("sefaz_cnpj");
    const cuf = localStorage.getItem("sefaz_cuf_autor");
    const tpAmb = localStorage.getItem("sefaz_tp_amb") || "1";
    const url = localStorage.getItem("sefaz_service_url") || "https://pef-nfe-service.onrender.com";
    const secret = localStorage.getItem("sefaz_api_secret") || "";

    if (!pfx || !pass || !cnpj || !cuf) {
      toast({ title: "❌ Configuração ausente", description: "Configure o certificado digital em Compras > Certificado Digital", variant: "destructive" });
      return;
    }

    setIsLoading(true); setErrorMsg(""); setResults([]); setQueryDone(false);

    try {
      const res = await fetch(`${url}/api/consulta-ult-nsu`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(secret ? { "x-api-secret": secret } : {}) },
        body: JSON.stringify({ pfxBase64: pfx, passphrase: pass, cnpj: cnpj.replace(/\D/g, ""), cUFAutor: cuf, tpAmb, ultNSU: ultNsu }),
      });
      const data = await res.json();

      if (!data.success && !data.docZip) {
        setErrorMsg(data.message || "Erro na consulta");
        toast({ title: "❌ Erro", description: data.message || "Falha na consulta ao SEFAZ", variant: "destructive" });
        setQueryDone(true); return;
      }

      if (data.ultNSU) {
        await supabase.from("compras_config").upsert({ chave: "nfe_ult_nsu", valor: data.ultNSU, updated_at: new Date().toISOString() }, { onConflict: "chave" });
        setUltNsu(data.ultNSU);
      }

      const docs: any[] = data.docZip || [];
      const parsed = docs.map(extractNfeData).filter(Boolean) as NfeResult[];

      if (parsed.length > 0) {
        const chaves = parsed.map(p => p.chaveAcesso).filter(Boolean);
        if (chaves.length > 0) {
          const { data: existing } = await supabase.from("compras_nfe").select("chave_acesso").in("chave_acesso", chaves);
          const existingSet = new Set((existing || []).map(e => e.chave_acesso));
          parsed.forEach(p => { if (p.chaveAcesso && existingSet.has(p.chaveAcesso)) p.jaImportada = true; });
        }
      }

      const ts = Date.now();
      await supabase.from("compras_config").upsert({ chave: "nfe_last_query_ts", valor: String(ts), updated_at: new Date().toISOString() }, { onConflict: "chave" });
      setLastQueryTs(ts);

      setResults(parsed); setQueryDone(true);
      if (parsed.length > 0) toast({ title: "✅ Consulta concluída", description: `${parsed.length} NF-e(s) encontrada(s)` });
      else toast({ title: "ℹ️ Sem novidades", description: "Nenhuma NF-e nova encontrada" });
    } catch (err: any) {
      setErrorMsg(err.message);
      toast({ title: "❌ Erro de rede", description: err.message, variant: "destructive" });
      setQueryDone(true);
    } finally { setIsLoading(false); }
  };

  const novas = results.filter(r => !r.jaImportada);
  const importadasSefaz = results.filter(r => r.jaImportada);

  const handleImportar = async () => {
    const docsToImport = results.filter(r => !r.jaImportada).map(r => ({ json: r.json, xml: r.xml, nsu: r.nsu, schema: r.schema }));
    if (docsToImport.length === 0) return;
    setIsImporting(true);
    try {
      const res = await importarNfesDoSefaz(docsToImport);
      if (res.erros.length > 0) toast({ title: "⚠️ Importação parcial", description: `${res.importadas} importada(s), ${res.erros.length} erro(s)`, variant: "destructive" });
      else toast({ title: "✅ Importação concluída", description: `${res.importadas} NF-e(s) importada(s) com sucesso` });

      const chaves = results.map(r => r.chaveAcesso).filter(Boolean);
      if (chaves.length > 0) {
        const { data: existing } = await supabase.from("compras_nfe").select("chave_acesso").in("chave_acesso", chaves);
        const existingSet = new Set((existing || []).map(e => e.chave_acesso));
        setResults(prev => prev.map(r => ({ ...r, jaImportada: r.chaveAcesso ? existingSet.has(r.chaveAcesso) : r.jaImportada })));
      }
      handleAfterImport();
    } catch (err: any) {
      toast({ title: "❌ Erro na importação", description: err.message, variant: "destructive" });
    } finally { setIsImporting(false); }
  };

  // ── Export Excel ──
  const handleExport = async () => {
    const XLSX = await import("xlsx");
    const nfIds = filtered.map(r => r.id);
    let allItens: NfeItem[] = [];
    for (let i = 0; i < nfIds.length; i += 100) {
      const chunk = nfIds.slice(i, i + 100);
      const { data } = await supabase.from("compras_nfe_itens").select("*").in("compras_nfe_id", chunk).order("compras_nfe_id").order("numero_item");
      allItens = allItens.concat((data || []) as unknown as NfeItem[]);
    }

    const itensMap: Record<string, NfeItem[]> = {};
    allItens.forEach(it => { (itensMap[it.compras_nfe_id] ||= []).push(it); });

    const exportRows: any[] = [];
    filtered.forEach(nf => {
      const itens = itensMap[nf.id];
      if (itens && itens.length > 0) {
        itens.forEach(it => {
          exportRows.push({
            "Data Emissão": formatDate(nf.data_emissao),
            "Número": nf.numero || "",
            "Série": nf.serie || "",
            "Fornecedor": nf.fornecedor_nome || "",
            "CNPJ": nf.fornecedor_cnpj || "",
            "Valor Total NF": nf.valor_total || 0,
            "Situação": nf.situacao || "",
            "#Item": it.numero_item || "",
            "Cód. Produto": it.codigo_produto || "",
            "Descrição": it.descricao || "",
            "NCM": it.ncm || "",
            "CFOP": it.cfop || "",
            "Unid.": it.unidade || "",
            "Qtd.": it.quantidade || 0,
            "V. Unit.": it.valor_unitario || 0,
            "V. Total Item": it.valor_total || 0,
            "ICMS": it.valor_icms || 0,
            "IPI": it.valor_ipi || 0,
            "PIS": it.valor_pis || 0,
            "COFINS": it.valor_cofins || 0,
          });
        });
      } else {
        exportRows.push({
          "Data Emissão": formatDate(nf.data_emissao),
          "Número": nf.numero || "",
          "Série": nf.serie || "",
          "Fornecedor": nf.fornecedor_nome || "",
          "CNPJ": nf.fornecedor_cnpj || "",
          "Valor Total NF": nf.valor_total || 0,
          "Situação": nf.situacao || "",
          "#Item": "", "Cód. Produto": "", "Descrição": "(Resumo — sem itens)", "NCM": "", "CFOP": "",
          "Unid.": "", "Qtd.": "", "V. Unit.": "", "V. Total Item": "", "ICMS": "", "IPI": "", "PIS": "", "COFINS": "",
        });
      }
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NF-e");
    XLSX.writeFile(wb, `nfe_${ano}_${String(mes).padStart(2, "0")}.xlsx`);
    toast({ title: "✅ Exportação concluída" });
  };

  // ── Status lançamento badge ──
  const statusLancBadge = (r: NfeRow) => {
    const st = r.status_lancamento || "pendente";
    switch (st) {
      case "vinculada": return <Badge className="bg-blue-600 text-white hover:bg-blue-700 text-[10px]">Vinculada (Ped. {r.pedido_compra_numero})</Badge>;
      case "lancada": return <Badge className="bg-green-600 text-white hover:bg-green-700 text-[10px]">Lançada</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">Pendente</Badge>;
    }
  };

  // ── Lançar NF-e no Alvo ──
  const handleLancarAlvo = async () => {
    if (!lancarTarget) return;
    const nfe = lancarTarget;
    setLancarTarget(null);
    setLancando(true);

    try {
      toast({ title: "Enviando NF-e para o Alvo ERP..." });

      const pedNum = nfe.pedido_compra_numero;
      if (!pedNum) throw new Error("NF-e sem pedido vinculado");

      // Buscar pedido no cache
      const { data: pedido } = await supabase
        .from("compras_pedidos")
        .select("itens, classe_rateio, codigo_cond_pag, codigo_entidade")
        .eq("numero", pedNum)
        .eq("codigo_empresa_filial", "1.01")
        .maybeSingle();

      if (!pedido) throw new Error("Pedido não encontrado no cache");

      // Resolver entidade
      const codigoEntidade = nfe.pedido_compra_entidade || pedido.codigo_entidade;
      if (!codigoEntidade) throw new Error("Entidade não encontrada");

      // Buscar itens da NF-e
      const { data: nfeItens } = await supabase
        .from("compras_nfe_itens")
        .select("*")
        .eq("compras_nfe_id", nfe.id)
        .order("numero_item");

      if (!nfeItens || nfeItens.length === 0) throw new Error("NF-e sem itens");

      // Classe e CC do pedido
      const rateio = (pedido.classe_rateio as any[]) || [];
      const classe = rateio[0]?.classe || nfe.pedido_compra_classe || "";
      const cc = rateio[0]?.centrosCusto?.[0]?.codigo || nfe.pedido_compra_centro_custo || "";
      if (!classe) throw new Error("Classe não encontrada no pedido");

      // Mapear itens NF-e → itens do pedido
      const pedidoItens = (pedido.itens as any[]) || [];
      const itensInput: NfeItemInput[] = nfeItens.map((it: any, idx: number) => {
        const pedItem = pedidoItens.find((p: any) =>
          (p.codigoProduto || p.CodigoProduto) === it.codigo_produto
        ) || pedidoItens[idx] || pedidoItens[0];

        return {
          codigoProduto: it.codigo_produto || "",
          sequencia: it.numero_item || (idx + 1),
          codigoProdutoPedComp: pedItem?.codigoProduto || pedItem?.CodigoProduto || it.codigo_produto || "",
          sequenciaItemPedComp: pedItem?.sequencia ?? pedItem?.Sequencia ?? (idx + 1),
          valorProduto: it.valor_total || 0,
          codigoNCM: it.ncm || undefined,
          codigoClasFiscal: undefined,
          classeRecDesp: classe,
          centroCusto: cc,
        };
      });

      // Condição de pagamento
      const condPag = pedido.codigo_cond_pag
        || (nfe.pedido_compra_cond_pagamento || "").split(" ")[0]
        || "";
      if (!condPag) throw new Error("Condição de pagamento não encontrada");

      // Buscar condPag para gerar parcelas
      const { data: condPagData } = await supabase
        .from("condicoes_pagamento")
        .select("quantidade_parcelas, dias_entre_parcelas, primeiro_vencimento_apos")
        .eq("codigo", condPag)
        .maybeSingle();

      const qtdParcelas = condPagData?.quantidade_parcelas || 1;
      const diasEntre = condPagData?.dias_entre_parcelas || 30;
      const primeiroApos = condPagData?.primeiro_vencimento_apos || 30;
      const valorTotal = nfe.valor_total || 0;
      const valorParcela = Math.floor((valorTotal / qtdParcelas) * 100) / 100;

      const parcelas: NfeParcelaInput[] = [];
      const dtEmissao = new Date(nfe.data_emissao || new Date());
      for (let i = 0; i < qtdParcelas; i++) {
        const diasOffset = primeiroApos + diasEntre * i;
        const dtVenc = new Date(dtEmissao);
        dtVenc.setDate(dtVenc.getDate() + diasOffset);

        const isLast = i === qtdParcelas - 1;
        const val = isLast ? valorTotal - valorParcela * (qtdParcelas - 1) : valorParcela;

        parcelas.push({
          sequencia: i + 1,
          numeroDuplicata: `${nfe.numero}/${i + 1}-${qtdParcelas}`,
          dataEmissao: nfe.data_emissao || new Date().toISOString(),
          valorParcela: Number(val.toFixed(2)),
          dataVencimento: dtVenc.toISOString().split("T")[0],
        });
      }

      const input: LancarNfeInput = {
        numero: nfe.numero || "",
        serie: nfe.serie || "1",
        dataEmissao: nfe.data_emissao || new Date().toISOString(),
        valorTotal,
        fornecedorCnpj: (nfe.fornecedor_cnpj || "").replace(/\D/g, ""),
        fornecedorNome: nfe.fornecedor_nome || "",
        codigoEntidade,
        pedidoNumero: pedNum,
        codigoCondPag: condPag,
        chaveAcessoNfe: nfe.chave_acesso || "",
        itens: itensInput,
        parcelas,
        classeRecDesp: classe,
        centroCusto: cc,
        icmsBase: nfe.valor_icms ? (nfe.valor_total || 0) : 0,
        icmsPercentual: nfe.valor_icms && nfe.valor_total ? Math.round((nfe.valor_icms / nfe.valor_total) * 10000) / 100 : 0,
        icmsValor: nfe.valor_icms || 0,
      };

      const result = await lancarNfeNoAlvo(input);
      if (!result.success) {
        toast({ title: "❌ Erro no Alvo", description: result.error, variant: "destructive" });
        setLancando(false);
        return;
      }

      // Atualizar no Supabase via upsert
      const user = (await supabase.auth.getUser()).data.user;
      const { data: current } = await supabase.from("compras_nfe").select("*").eq("id", nfe.id).single();
      if (current) {
        await supabase.from("compras_nfe").upsert({
          ...current,
          status_lancamento: "lancada",
          lancado_por: user?.email || "desconhecido",
          lancado_em: new Date().toISOString(),
          erp_chave_movestq: result.chave,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });
      }

      toast({ title: `✅ NF-e lançada no Alvo! Chave: ${result.chave}` });
      fetchRows();
    } catch (err: any) {
      toast({ title: "❌ Erro", description: err.message, variant: "destructive" });
    } finally {
      setLancando(false);
    }
  };

  // ── Desvincular / Reverter handler ──
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
        pedido_compra_numero: null, pedido_compra_entidade: null,
        pedido_compra_classe: null, pedido_compra_centro_custo: null,
        pedido_compra_cond_pagamento: null, pedido_compra_valor: null,
        updated_at: new Date().toISOString(),
      });
      if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
      else toast({ title: "Vinculação removida" });
    } else if (type === "reverter") {
      const { error } = await upsertNfe({
        status_lancamento: "vinculada",
        lancado_por: null, lancado_em: null,
        updated_at: new Date().toISOString(),
      });
      if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
      else toast({ title: "Lançamento revertido" });
    }
    setAlertAction(null);
    fetchRows();
  };

  // ── Render ──
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Notas Fiscais (NF-e)</h1>
        <p className="text-muted-foreground">Importação de Notas Fiscais Eletrônicas via SEFAZ</p>
      </div>

      {/* ══════ Área 1 — Consulta SEFAZ (existing) ══════ */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Search className="h-4 w-4 shrink-0" />
            <span>Buscar novas NF-es emitidas contra o CNPJ da empresa no SEFAZ</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Último NSU</Label>
              <Input className="h-8 w-48 text-xs" value={ultNsu} onChange={(e) => setUltNsu(e.target.value)} />
            </div>
            <div className="flex flex-col items-end gap-1 self-end">
              <Button onClick={handleConsultar} disabled={isLoading || minutesLeft > 0} className="gap-2">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : minutesLeft > 0 ? <Timer className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                {isLoading ? "Consultando SEFAZ..." : minutesLeft > 0 ? `Aguarde ${minutesLeft} min` : "Consultar SEFAZ"}
              </Button>
              {minutesLeft > 0 && (
                <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={handleConsultar}>
                  Consultar mesmo assim
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        {lastQueryTs ? (
          <span>
            Última consulta: {new Date(lastQueryTs).toLocaleDateString("pt-BR")} às {new Date(lastQueryTs).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            {minutesLeft > 0 && <span className="ml-2">· Próxima consulta disponível em {minutesLeft} min</span>}
          </span>
        ) : <span>Nenhuma consulta realizada</span>}
      </div>

      {queryDone && (
        <div className="flex items-center gap-2">
          {errorMsg ? (
            <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Erro: {errorMsg}</Badge>
          ) : results.length > 0 ? (
            <Badge className="gap-1 bg-green-600 text-white hover:bg-green-700"><CheckCircle2 className="h-3 w-3" /> {results.length} NF-e(s) encontrada(s)</Badge>
          ) : (
            <Badge className="gap-1 bg-yellow-500 text-white hover:bg-yellow-600"><AlertTriangle className="h-3 w-3" /> Nenhuma NF-e nova</Badge>
          )}
        </div>
      )}

      {results.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">Resultados da Consulta</CardTitle>
                <CardDescription>NF-es retornadas pela SEFAZ</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">NSU</TableHead>
                  <TableHead>Número</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>CNPJ Fornecedor</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Data Emissão</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r, i) => (
                  <TableRow key={`${r.nsu}-${i}`}>
                    <TableCell className="text-xs text-muted-foreground font-mono">{r.nsu}</TableCell>
                    <TableCell>{r.numero || "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{r.fornecedorNome || "—"}</TableCell>
                    <TableCell className="text-xs font-mono">{r.fornecedorCnpj || "—"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatCurrency(r.valor)}</TableCell>
                    <TableCell>{formatDate(r.dataEmissao)}</TableCell>
                    <TableCell>{situacaoLabelSefaz(r.situacao)}</TableCell>
                    <TableCell>
                      {r.jaImportada ? <Badge variant="secondary">Já importada</Badge> : <Badge className="bg-blue-600 text-white hover:bg-blue-700">Nova</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Total: {results.length} NF-e(s) | {novas.length} nova(s) | {importadasSefaz.length} já importada(s)
              </p>
              <Button className="gap-2" disabled={novas.length === 0 || isImporting} onClick={handleImportar}>
                {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {isImporting ? `Importando ${novas.length} NF-e(s)...` : "Importar Todas as Novas"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ══════ Área 2 — NF-e Importadas ══════ */}
      <div className="border-t pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">NF-e Importadas</h2>
            <p className="text-sm text-muted-foreground">Notas fiscais salvas no sistema</p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={String(mes)} onValueChange={v => setMes(Number(v))}>
              <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {new Date(2000, i).toLocaleString("pt-BR", { month: "long" }).replace(/^\w/, c => c.toUpperCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(ano)} onValueChange={v => setAno(Number(v))}>
              <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map(y => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total NF-e", value: summary.total, icon: Hash },
            { label: "Autorizadas", value: summary.autorizadas, icon: CheckCircle2 },
            { label: "Canceladas", value: summary.canceladas, icon: XCircle },
            { label: "Valor Total", value: formatCurrency(summary.valorTotal), icon: FileText },
            { label: "Com Itens", value: summary.comItens, icon: Package },
          ].map(c => (
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

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Input placeholder="Buscar por fornecedor, CNPJ ou número..." className="h-8 text-xs sm:max-w-xs" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          <Select value={filtroSituacao} onValueChange={setFiltroSituacao}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              <SelectItem value="autorizada">Autorizada</SelectItem>
              <SelectItem value="cancelada">Cancelada</SelectItem>
              <SelectItem value="denegada">Denegada</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filtroLancamento} onValueChange={setFiltroLancamento}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="pendente">Pendentes</SelectItem>
              <SelectItem value="vinculada">Vinculadas</SelectItem>
              <SelectItem value="lancada">Lançadas</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1 text-xs h-8" onClick={handleExport} disabled={filtered.length === 0}>
            <Download className="h-3 w-3" /> Exportar Excel
          </Button>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {loadingRows ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
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
                  {filtered.map(r => (
                    <TooltipProvider key={r.id}>
                      <>
                        <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleExpand(r.id)}>
                          <TableCell className="px-1">
                            {expandedId === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="text-xs px-2">{r.numero || "—"}</TableCell>
                          <TableCell className="text-xs max-w-[180px] truncate px-2">{r.fornecedor_nome || "—"}</TableCell>
                          <TableCell className="text-xs font-mono px-2">{formatCnpj(r.fornecedor_cnpj)}</TableCell>
                          <TableCell className="text-xs text-right whitespace-nowrap font-medium px-2">{formatCurrency(r.valor_total)}</TableCell>
                          <TableCell className="text-xs px-2">{formatDate(r.data_emissao)}</TableCell>
                          <TableCell className="px-2">{situacaoBadge(r.situacao)}</TableCell>
                          <TableCell className="px-2">{statusLancBadge(r)}</TableCell>
                          <TableCell className="px-2" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              {(() => {
                                const st = r.status_lancamento || "pendente";
                                if (st === "pendente") return (
                                  <Button variant="outline" size="sm" className="gap-1 text-xs h-7" onClick={() => setVincularDialog({ open: true, nfe: r })}>
                                    <LinkIcon className="h-3 w-3" /> Vincular
                                  </Button>
                                );
                                if (st === "vinculada") return (
                                  <>
                                    <Button variant="outline" size="sm" className="gap-1 text-xs h-7" onClick={() => setLancarTarget(r)} disabled={lancando}>
                                      <Send className="h-3 w-3" /> Lançar
                                    </Button>
                                    <Button variant="outline" size="sm" className="gap-1 text-xs h-7" onClick={() => setAlertAction({ type: "desvincular", nfe: r })}>
                                      <Unlink className="h-3 w-3" />
                                    </Button>
                                  </>
                                );
                                if (st === "lancada") return (
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-muted-foreground">{r.lancado_por}</span>
                                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setAlertAction({ type: "reverter", nfe: r })}>
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
                                {/* Bloco 1 — Dados da Nota */}
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">Dados da Nota</h4>
                                  <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
                                    <div><span className="text-muted-foreground">Fornecedor:</span> {r.fornecedor_nome || "—"}</div>
                                    <div><span className="text-muted-foreground">CNPJ:</span> {formatCnpj(r.fornecedor_cnpj)}</div>
                                    <div><span className="text-muted-foreground">IE:</span> {r.fornecedor_ie || "—"}</div>
                                    <div><span className="text-muted-foreground">UF:</span> {r.fornecedor_uf || "—"}</div>
                                    <div><span className="text-muted-foreground">Tipo Operação:</span> {r.tipo_operacao || "—"}</div>
                                    <div><span className="text-muted-foreground">Schema:</span> {r.schema_type || "—"}</div>
                                    <div className="col-span-3"><span className="text-muted-foreground">Chave:</span> <span className="font-mono text-[10px]">{r.chave_acesso}</span></div>
                                    <div><span className="text-muted-foreground">Importada em:</span> {r.imported_at ? new Date(r.imported_at).toLocaleString("pt-BR") : "—"}</div>
                                  </div>
                                </div>

                                {/* Bloco 2 — Itens */}
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">Itens da Nota</h4>
                                  {loadingItems === r.id ? (
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Carregando itens...</div>
                                  ) : (itemsCache[r.id] || []).length === 0 ? (
                                    <p className="text-xs text-muted-foreground italic">Esta NF-e foi importada como resumo — sem detalhes de itens disponíveis.</p>
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
                                            <TableHead className="text-[10px] text-right">ICMS</TableHead>
                                            <TableHead className="text-[10px] text-right">IPI</TableHead>
                                            <TableHead className="text-[10px] text-right">PIS</TableHead>
                                            <TableHead className="text-[10px] text-right">COFINS</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {(itemsCache[r.id] || []).map(it => (
                                            <TableRow key={it.id}>
                                              <TableCell className="text-[10px]">{it.numero_item ?? "—"}</TableCell>
                                              <TableCell className="text-[10px]">{it.codigo_produto || "—"}</TableCell>
                                              <TableCell className="text-[10px] max-w-[200px] truncate">
                                                <Tooltip>
                                                  <TooltipTrigger asChild><span>{it.descricao || "—"}</span></TooltipTrigger>
                                                  <TooltipContent className="max-w-sm"><p className="text-xs">{it.descricao}</p></TooltipContent>
                                                </Tooltip>
                                              </TableCell>
                                              <TableCell className="text-[10px] font-mono">{it.ncm || "—"}</TableCell>
                                              <TableCell className="text-[10px] font-mono">{it.cfop || "—"}</TableCell>
                                              <TableCell className="text-[10px]">{it.unidade || "—"}</TableCell>
                                              <TableCell className="text-[10px] text-right">{it.quantidade ?? "—"}</TableCell>
                                              <TableCell className="text-[10px] text-right">{formatCurrency(it.valor_unitario)}</TableCell>
                                              <TableCell className="text-[10px] text-right">{formatCurrency(it.valor_total)}</TableCell>
                                              <TableCell className="text-[10px] text-right">{formatCurrency(it.valor_icms)}</TableCell>
                                              <TableCell className="text-[10px] text-right">{formatCurrency(it.valor_ipi)}</TableCell>
                                              <TableCell className="text-[10px] text-right">{formatCurrency(it.valor_pis)}</TableCell>
                                              <TableCell className="text-[10px] text-right">{formatCurrency(it.valor_cofins)}</TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                        <TableFooter>
                                          <TableRow>
                                            <TableCell colSpan={8} className="text-[10px] font-semibold text-right">Totais</TableCell>
                                            <TableCell className="text-[10px] text-right font-semibold">{formatCurrency((itemsCache[r.id] || []).reduce((s, it) => s + (it.valor_total || 0), 0))}</TableCell>
                                            <TableCell className="text-[10px] text-right font-semibold">{formatCurrency((itemsCache[r.id] || []).reduce((s, it) => s + (it.valor_icms || 0), 0))}</TableCell>
                                            <TableCell className="text-[10px] text-right font-semibold">{formatCurrency((itemsCache[r.id] || []).reduce((s, it) => s + (it.valor_ipi || 0), 0))}</TableCell>
                                            <TableCell className="text-[10px] text-right font-semibold">{formatCurrency((itemsCache[r.id] || []).reduce((s, it) => s + (it.valor_pis || 0), 0))}</TableCell>
                                            <TableCell className="text-[10px] text-right font-semibold">{formatCurrency((itemsCache[r.id] || []).reduce((s, it) => s + (it.valor_cofins || 0), 0))}</TableCell>
                                          </TableRow>
                                        </TableFooter>
                                      </Table>
                                    </div>
                                  )}
                                </div>

                                {/* Bloco 3 — Valores e Impostos */}
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground mb-2">Valores e Impostos</h4>
                                  <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
                                    <div><span className="text-muted-foreground">V. Produtos:</span> {formatCurrency(r.valor_produtos)}</div>
                                    <div><span className="text-muted-foreground">V. Frete:</span> {formatCurrency(r.valor_frete)}</div>
                                    <div><span className="text-muted-foreground">V. Desconto:</span> {formatCurrency(r.valor_desconto)}</div>
                                    <div><span className="text-muted-foreground">ICMS:</span> {formatCurrency(r.valor_icms)}</div>
                                    <div><span className="text-muted-foreground">IPI:</span> {formatCurrency(r.valor_ipi)}</div>
                                    <div><span className="text-muted-foreground">PIS:</span> {formatCurrency(r.valor_pis)}</div>
                                    <div><span className="text-muted-foreground">COFINS:</span> {formatCurrency(r.valor_cofins)}</div>
                                    <div><span className="text-muted-foreground">V. Total:</span> <span className="font-semibold">{formatCurrency(r.valor_total)}</span></div>
                                  </div>
                                </div>

                                {/* Bloco 4 — Ações */}
                                <div className="flex gap-2 pt-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1 text-xs"
                                    onClick={e => {
                                      e.stopPropagation();
                                      const xml = r.raw_xml || (r.raw_json ? JSON.stringify(r.raw_json, null, 2) : "Sem conteúdo disponível");
                                      setXmlDialog({ open: true, numero: r.numero || "", fornecedor: r.fornecedor_nome || "", xml });
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
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={9} className="text-xs">Total: {filtered.length} NF-e(s)</TableCell>
                    <TableCell className="text-xs text-right font-semibold">{formatCurrency(footerTotals.valorTotal)}</TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ══════ Dialog Ver XML ══════ */}
      <Dialog open={xmlDialog.open} onOpenChange={open => setXmlDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">XML da NF-e {xmlDialog.numero} — {xmlDialog.fornecedor}</DialogTitle>
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

      {/* ══════ Vincular Pedido Dialog ══════ */}
      {vincularDialog.nfe && (
        <VincularPedidoDialog
          open={vincularDialog.open}
          onOpenChange={open => setVincularDialog(prev => ({ ...prev, open }))}
          nfse={{
            id: vincularDialog.nfe.id,
            numero: vincularDialog.nfe.numero,
            prestador_nome: vincularDialog.nfe.fornecedor_nome,
            prestador_cnpj: vincularDialog.nfe.fornecedor_cnpj,
            valor_servico: vincularDialog.nfe.valor_total,
          }}
          onVinculado={() => { setVincularDialog({ open: false, nfe: null }); fetchRows(); }}
        />
      )}

      {/* ══════ Alert Desvincular / Reverter ══════ */}
      <AlertDialog open={!!alertAction} onOpenChange={open => { if (!open) setAlertAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {alertAction?.type === "desvincular" && "Confirmar Desvinculação"}
              {alertAction?.type === "reverter" && "Reverter Lançamento"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {alertAction?.type === "desvincular" && `Desvincular NF-e #${alertAction.nfe.numero} do pedido?`}
              {alertAction?.type === "reverter" && `Reverter lançamento da NF-e #${alertAction.nfe.numero}?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ══════ Alert Lançar no Alvo ══════ */}
      <AlertDialog open={!!lancarTarget} onOpenChange={v => { if (!v) setLancarTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lançar NF-e no ERP Alvo</AlertDialogTitle>
            <AlertDialogDescription>
              Criar movimentação no ERP Alvo para NF-e #{lancarTarget?.numero} — {lancarTarget?.fornecedor_nome}?
              Valor: {formatCurrency(lancarTarget?.valor_total)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleLancarAlvo} className="bg-green-600 hover:bg-green-700">
              {lancando ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              Lançar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ComprasNotasFiscais;
