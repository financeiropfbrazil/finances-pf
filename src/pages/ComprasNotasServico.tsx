import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search, RefreshCw, Download, AlertTriangle, CheckCircle2, XCircle,
  Loader2, FileText, Clock, Timer, ChevronDown, ChevronRight, Eye, Copy,
  Hash, Receipt, Link as LinkIcon, Unlink, RotateCcw, FileDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { parseNfseXml, importarNfsesDoSefaz, type ParsedNfse } from "@/services/comprasNfseService";
import { VincularPedidoDialog } from "@/components/compras/VincularPedidoDialog";
import { gerarDanfsePdf } from "@/services/danfseGeneratorService";
import { lancarNfseNoAlvo, type LancarNfseInput } from "@/services/alvoMovEstqLancarService";
import ConfirmarLancamentoModal, { type DadosLancamento } from "@/components/compras/ConfirmarLancamentoModal";

// ── Types ──────────────────────────────────────────────────────
interface DecodedItem {
  NSU: number;
  ChaveAcesso: string;
  TipoDocumento: string;
  TipoEvento: string | null;
  DataHoraGeracao: string;
  xml: string;
}

interface NfseResult {
  decoded: DecodedItem;
  parsed: ParsedNfse;
  jaImportada: boolean;
  cancelada: boolean;
}

interface NfseRow {
  id: string;
  nsu: number | null;
  numero: string | null;
  chave_acesso: string;
  prestador_nome: string | null;
  prestador_cnpj: string | null;
  prestador_cpf: string | null;
  prestador_inscricao_municipal: string | null;
  prestador_municipio_codigo: string | null;
  prestador_municipio_nome: string | null;
  prestador_uf: string | null;
  tomador_cnpj: string | null;
  tomador_cpf: string | null;
  tomador_nome: string | null;
  descricao_servico: string | null;
  codigo_servico: string | null;
  cnae: string | null;
  valor_servico: number | null;
  valor_liquido: number | null;
  valor_deducoes: number | null;
  valor_desconto_condicionado: number | null;
  valor_desconto_incondicionado: number | null;
  base_calculo_iss: number | null;
  aliquota_iss: number | null;
  valor_iss: number | null;
  iss_retido: boolean | null;
  valor_iss_retido: number | null;
  valor_pis: number | null;
  valor_cofins: number | null;
  valor_retencao_inss: number | null;
  valor_retencao_irrf: number | null;
  valor_retencao_csll: number | null;
  valor_total_retencoes: number | null;
  data_emissao: string | null;
  data_competencia: string | null;
  municipio_incidencia_codigo: string | null;
  municipio_incidencia_nome: string | null;
  natureza_tributacao: string | null;
  situacao: string | null;
  tipo_documento: string | null;
  tipo_evento: string | null;
  raw_xml: string | null;
  imported_at: string | null;
  status_lancamento: string | null;
  pedido_compra_numero: string | null;
  pedido_compra_entidade: string | null;
  pedido_compra_classe: string | null;
  pedido_compra_centro_custo: string | null;
  pedido_compra_cond_pagamento: string | null;
  pedido_compra_valor: number | null;
  lancado_por: string | null;
  lancado_em: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────
const formatCurrency = (value: number | null | undefined) => {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
};

const formatDate = (dateStr: string | null) => {
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

const formatPercent = (value: number | null | undefined) => {
  if (value == null) return "—";
  return `${value.toFixed(2)}%`;
};

const COOLDOWN_MS = 3600000;

const MONTHS = [
  { value: "1", label: "Janeiro" }, { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" }, { value: "4", label: "Abril" },
  { value: "5", label: "Maio" }, { value: "6", label: "Junho" },
  { value: "7", label: "Julho" }, { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" }, { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" }, { value: "12", label: "Dezembro" },
];

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

// ── Component ──────────────────────────────────────────────────────
const ComprasNotasServico = () => {
  const { toast } = useToast();

  // SEFAZ Consultation state (existing)
  const [ultNsu, setUltNsu] = useState("0");
  const [maxDocs, setMaxDocs] = useState(50);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<NfseResult[]>([]);
  const [queryDone, setQueryDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [minutesLeft, setMinutesLeft] = useState(0);
  const [lastQueryTs, setLastQueryTs] = useState<number | null>(null);

  // Imported NFS-e section state
  const now = new Date();
  const [mes, setMes] = useState(now.getMonth() + 1);
  const [ano, setAno] = useState(now.getFullYear());
  const [nfseRows, setNfseRows] = useState<NfseRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroSituacao, setFiltroSituacao] = useState("todas");
  const [filtroLancamento, setFiltroLancamento] = useState("todos");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [xmlDialog, setXmlDialog] = useState<{ open: boolean; numero: string; prestador: string; xml: string }>({ open: false, numero: "", prestador: "", xml: "" });
  const [vincularDialog, setVincularDialog] = useState<{ open: boolean; nfse: NfseRow | null }>({ open: false, nfse: null });
  const [alertAction, setAlertAction] = useState<{ type: "desvincular" | "reverter"; nfse: NfseRow } | null>(null);
  const [lancamentoModal, setLancamentoModal] = useState<{ open: boolean; nfse: NfseRow | null }>({ open: false, nfse: null });

  // ── Load config from Supabase ──────────────────────────────────
  useEffect(() => {
    const loadConfig = async () => {
      const { data } = await supabase
        .from("compras_config")
        .select("valor")
        .eq("chave", "nfse_ult_nsu")
        .maybeSingle();
      if (data?.valor) setUltNsu(data.valor);

      const { data: tsData } = await supabase
        .from("compras_config")
        .select("valor")
        .eq("chave", "nfse_last_query_ts")
        .maybeSingle();
      if (tsData?.valor) setLastQueryTs(Number(tsData.valor));
    };
    loadConfig();
  }, []);

  useEffect(() => {
    const calc = () => {
      if (!lastQueryTs) { setMinutesLeft(0); return; }
      const diff = COOLDOWN_MS - (Date.now() - lastQueryTs);
      setMinutesLeft(diff > 0 ? Math.ceil(diff / 60000) : 0);
    };
    calc();
    const id = setInterval(calc, 60000);
    return () => clearInterval(id);
  }, [lastQueryTs]);

  // ── SEFAZ Consultation ──────────────────────────────────────
  const handleConsultar = async () => {
    const pfx = localStorage.getItem("sefaz_pfx_base64");
    const pass = localStorage.getItem("sefaz_passphrase");
    const tpAmb = localStorage.getItem("sefaz_tp_amb") || "1";
    const url = localStorage.getItem("sefaz_service_url") || "https://pef-nfe-service.onrender.com";
    const secret = localStorage.getItem("sefaz_api_secret") || "";

    if (!pfx || !pass) {
      toast({ title: "❌ Configuração ausente", description: "Configure o certificado digital em Compras > Certificado Digital", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    setErrorMsg("");
    setResults([]);
    setQueryDone(false);

    try {
      const res = await fetch(`${url}/api/nfse-consulta-dfe-decoded`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(secret ? { "x-api-secret": secret } : {}) },
        body: JSON.stringify({ pfxBase64: pfx, passphrase: pass, tpAmb, NSU: ultNsu, maxDocs }),
      });

      const data = await res.json().catch(() => ({}));

      // 404 da API Nacional = nenhum documento novo (não é erro)
      if (res.status === 404 || data?.data?.StatusProcessamento === "NENHUM_DOCUMENTO_LOCALIZADO") {
        setQueryDone(true);
        setResults([]);
        toast({ title: "ℹ️ Sem novidades", description: "Nenhuma NFS-e nova encontrada a partir do NSU informado." });
        const ts = Date.now();
        await supabase.from("compras_config").upsert(
          { chave: "nfse_last_query_ts", valor: String(ts), updated_at: new Date().toISOString() },
          { onConflict: "chave" }
        );
        setLastQueryTs(ts);
        return;
      }

      if (!data.success && !data.decoded) {
        setErrorMsg(data.message || "Erro na consulta");
        toast({ title: "❌ Erro", description: data.message || "Falha na consulta NFS-e", variant: "destructive" });
        setQueryDone(true);
        return;
      }

      const decoded: DecodedItem[] = data.decoded || [];

      if (decoded.length > 0) {
        const maxNsu = Math.max(...decoded.map(d => d.NSU));
        await supabase.from("compras_config").upsert({ chave: "nfse_ult_nsu", valor: String(maxNsu), updated_at: new Date().toISOString() }, { onConflict: "chave" });
        setUltNsu(String(maxNsu));
      }

      const cancelChaves = new Set(
        decoded.filter(d => d.TipoDocumento === "EVENTO" && d.TipoEvento === "CANCELAMENTO").map(d => d.ChaveAcesso)
      );

      const nfseItems = decoded.filter(d => d.TipoDocumento === "NFSE");
      const parsed: NfseResult[] = nfseItems.map(d => ({
        decoded: d,
        parsed: parseNfseXml(d.xml || "", d.ChaveAcesso),
        jaImportada: false,
        cancelada: cancelChaves.has(d.ChaveAcesso),
      }));

      if (parsed.length > 0) {
        const chaves = parsed.map(p => p.decoded.ChaveAcesso).filter(Boolean);
        if (chaves.length > 0) {
          const { data: existing } = await supabase.from("compras_nfse").select("chave_acesso").in("chave_acesso", chaves);
          const existingSet = new Set((existing || []).map(e => e.chave_acesso));
          parsed.forEach(p => { if (existingSet.has(p.decoded.ChaveAcesso)) p.jaImportada = true; });
        }
      }

      const ts = Date.now();
      await supabase.from("compras_config").upsert({ chave: "nfse_last_query_ts", valor: String(ts), updated_at: new Date().toISOString() }, { onConflict: "chave" });
      setLastQueryTs(ts);

      setResults(parsed);
      setQueryDone(true);

      if (parsed.length > 0) {
        toast({ title: "✅ Consulta concluída", description: `${parsed.length} NFS-e(s) encontrada(s)` });
      } else {
        toast({ title: "ℹ️ Sem novidades", description: "Nenhuma NFS-e nova encontrada" });
      }
    } catch (err: any) {
      setErrorMsg(err.message);
      toast({ title: "❌ Erro de rede", description: err.message, variant: "destructive" });
      setQueryDone(true);
    } finally {
      setIsLoading(false);
    }
  };

  const novas = results.filter(r => !r.jaImportada);
  const importadas = results.filter(r => r.jaImportada);

  const handleImportar = async () => {
    const docsToImport = novas.map(r => r.decoded);
    if (docsToImport.length === 0) return;

    setIsImporting(true);
    try {
      const res = await importarNfsesDoSefaz(docsToImport);
      if (res.erros.length > 0) {
        toast({ title: "⚠️ Importação parcial", description: `${res.importadas} importada(s), ${res.erros.length} erro(s)`, variant: "destructive" });
      } else {
        toast({ title: "✅ Importação concluída", description: `${res.importadas} NFS-e(s) importada(s) com sucesso` });
      }

      const chaves = results.map(r => r.decoded.ChaveAcesso).filter(Boolean);
      if (chaves.length > 0) {
        const { data: existing } = await supabase.from("compras_nfse").select("chave_acesso").in("chave_acesso", chaves);
        const existingSet = new Set((existing || []).map(e => e.chave_acesso));
        setResults(prev => prev.map(r => ({ ...r, jaImportada: existingSet.has(r.decoded.ChaveAcesso) || r.jaImportada })));
      }

      // Refresh imported table
      fetchNfseRows();
    } catch (err: any) {
      toast({ title: "❌ Erro na importação", description: err.message, variant: "destructive" });
    } finally {
      setIsImporting(false);
    }
  };

  // ── Imported NFS-e Data ──────────────────────────────────────
  const fetchNfseRows = useCallback(async () => {
    setLoadingRows(true);
    const lastDay = daysInMonth(ano, mes);
    const from = `${ano}-${String(mes).padStart(2, "0")}-01`;
    const to = `${ano}-${String(mes).padStart(2, "0")}-${lastDay}`;

    const { data, error } = await supabase
      .from("compras_nfse")
      .select("*")
      .gte("data_emissao", from)
      .lte("data_emissao", `${to}T23:59:59`)
      .order("data_emissao", { ascending: false });

    if (error) {
      console.error("Erro ao buscar NFS-e:", error);
    }
    setNfseRows((data as NfseRow[]) || []);
    setLoadingRows(false);
  }, [ano, mes]);

  useEffect(() => { fetchNfseRows(); }, [fetchNfseRows]);

  // ── Filtering ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let rows = nfseRows;
    if (filtroSituacao !== "todas") {
      rows = rows.filter(r => r.situacao === filtroSituacao);
    }
    if (filtroLancamento !== "todos") {
      rows = rows.filter(r => (r.status_lancamento || "pendente") === filtroLancamento);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      rows = rows.filter(r =>
        (r.prestador_nome || "").toLowerCase().includes(term) ||
        (r.prestador_cnpj || "").includes(term) ||
        (r.numero || "").toLowerCase().includes(term)
      );
    }
    return rows;
  }, [nfseRows, filtroSituacao, filtroLancamento, searchTerm]);

  // ── Summary ──────────────────────────────────────────────
  const summary = useMemo(() => {
    const normais = nfseRows.filter(r => r.situacao === "normal");
    const canceladas = nfseRows.filter(r => r.situacao === "cancelada");
    const valorTotal = normais.reduce((s, r) => s + (r.valor_servico || 0), 0);
    const pendentes = nfseRows.filter(r => !r.status_lancamento || r.status_lancamento === "pendente").length;
    const lancadas = nfseRows.filter(r => r.status_lancamento === "lancada").length;
    return { total: nfseRows.length, normais: normais.length, canceladas: canceladas.length, valorTotal, pendentes, lancadas };
  }, [nfseRows]);

  // Footer totals for filtered rows
  const footerTotals = useMemo(() => ({
    valorServico: filtered.reduce((s, r) => s + (r.valor_servico || 0), 0),
    valorLiquido: filtered.reduce((s, r) => s + (r.valor_liquido || 0), 0),
  }), [filtered]);

  // ── Status Lancamento Actions ──────────────────────────────

  const handleConfirmarLancamento = async (dados: DadosLancamento) => {
    const nfse = lancamentoModal.nfse;
    if (!nfse) return;

    try {
      toast({ title: "Enviando para o Alvo ERP..." });

      const cnpjLimpo = (nfse.prestador_cnpj || "").replace(/\D/g, "");
      const valorTotal = nfse.valor_servico || 0;

      const classesInput = dados.classes.map(c => ({
        codigoClasseRecDesp: c.codigoClasseRecDesp,
        percentual: c.percentual,
        valor: c.valor,
        centrosCusto: c.centrosCusto.map(cc => ({
          codigoCentroCtrl: cc.codigo,
          percentual: cc.percentual,
          valor: cc.valor,
        })),
      }));

      // Mapear impostos (boolean → "Sim"/"Não")
      const impostosInput = {
        baseISS: dados.impostos.baseISS,
        aliquotaISS: dados.impostos.aliquotaISS,
        valorISS: dados.impostos.valorISS,
        deduzISSValorTotal: dados.impostos.deduzISSValorTotal ? "Sim" : "Não",
        baseIRRF: dados.impostos.baseIRRF,
        aliquotaIRRF: dados.impostos.aliquotaIRRF,
        valorIRRF: dados.impostos.valorIRRF,
        deduzIRRFValorTotal: dados.impostos.deduzIRRFValorTotal ? "Sim" : "Não",
        baseINSS: dados.impostos.baseINSS,
        aliquotaINSS: dados.impostos.aliquotaINSS,
        valorINSS: dados.impostos.valorINSS,
        deduzINSSValorTotal: dados.impostos.deduzINSSValorTotal ? "Sim" : "Não",
        basePIS: dados.impostos.basePIS,
        aliquotaPIS: dados.impostos.aliquotaPIS,
        valorPIS: dados.impostos.valorPIS,
        deduzPISValorTotal: dados.impostos.deduzPISValorTotal ? "Sim" : "Não",
        baseCOFINS: dados.impostos.baseCOFINS,
        aliquotaCOFINS: dados.impostos.aliquotaCOFINS,
        valorCOFINS: dados.impostos.valorCOFINS,
        deduzCOFINSValorTotal: dados.impostos.deduzCOFINSValorTotal ? "Sim" : "Não",
        baseCSLL: dados.impostos.baseCSLL,
        aliquotaCSLL: dados.impostos.aliquotaCSLL,
        valorCSLL: dados.impostos.valorCSLL,
        deduzCSLLValorTotal: dados.impostos.deduzCSLLValorTotal ? "Sim" : "Não",
      };

      // Gerar PDF da DANFSE a partir do raw_xml
      let danfsePdfBlob: Blob | undefined;
      if (nfse.raw_xml) {
        try {
          const { gerarDanfsePdfBlob } = await import("@/services/danfseGeneratorService");
          danfsePdfBlob = await gerarDanfsePdfBlob(nfse.raw_xml);
        } catch (e) {
          console.warn("[NFS-e] Falha ao gerar DANFSE PDF:", e);
        }
      }

      // Criar XML blob a partir do raw_xml
      let xmlBlob: Blob | undefined;
      if (nfse.raw_xml) {
        xmlBlob = new Blob([nfse.raw_xml], { type: "application/xml" });
      }

      // Busca cidade/UF da entidade no cache local (para enriquecer o payload do Alvo)
      let nomeCidadeEntidade: string | undefined;
      let siglaUfEntidade: string | undefined;
      if (dados.codigoEntidade) {
        const { data: entidadeCache } = await supabase
          .from("compras_entidades_cache")
          .select("municipio, uf")
          .eq("codigo_entidade", dados.codigoEntidade)
          .maybeSingle();
        if (entidadeCache) {
          nomeCidadeEntidade = entidadeCache.municipio || undefined;
          siglaUfEntidade = entidadeCache.uf || undefined;
        }
      }

      const input: LancarNfseInput = {
        numero: nfse.numero || "",
        serie: "1",
        dataEmissao: nfse.data_emissao || new Date().toISOString(),
        valorServico: valorTotal,
        prestadorCnpj: cnpjLimpo,
        prestadorNome: nfse.prestador_nome || "",
        pedidoNumero: nfse.pedido_compra_numero || "",
        classes: classesInput,
        codigoCondPag: dados.codigoCondPag,
        codigoEntidade: dados.codigoEntidade,
        codigoProduto: dados.codigoProduto,
        nomeProduto: dados.nomeProduto,
        sequenciaItemPedComp: dados.sequenciaItemPedComp,
        impostos: impostosInput,
        parcelas: dados.parcelas,
        danfsePdfBlob,
        xmlBlob,
        chaveAcesso: nfse.chave_acesso,
        nomeCidadeEntidade,
        siglaUfEntidade,
      };

      const result = await lancarNfseNoAlvo(input);
      if (!result.success) {
        toast({ title: "❌ Erro no Alvo", description: result.error, variant: "destructive" });
        return;
      }

      const user = (await supabase.auth.getUser()).data.user;
      const upsertData: Record<string, any> = {
        status_lancamento: "lancada",
        lancado_por: user?.email || "desconhecido",
        lancado_em: new Date().toISOString(),
        erp_chave_movestq: result.chave,
        pedido_compra_classe: dados.classes.map(c => c.codigoClasseRecDesp).join(", "),
        pedido_compra_centro_custo: dados.classes.flatMap(c => c.centrosCusto.map(cc => cc.codigo)).join(", "),
        pedido_compra_cond_pagamento: `${dados.codigoCondPag} (${dados.nomeCondPag})`,
        updated_at: new Date().toISOString(),
      };

      const { data: current } = await supabase.from("compras_nfse").select("*").eq("id", nfse.id).single();
      if (current) {
        await supabase.from("compras_nfse").upsert({ ...current, ...upsertData }, { onConflict: "id" });
      }

      toast({ title: `✅ NFS-e lançada! Chave: ${result.chave}` });
      setLancamentoModal({ open: false, nfse: null });
      fetchNfseRows();
    } catch (err: any) {
      toast({ title: "❌ Erro", description: err.message, variant: "destructive" });
    }
  };

  const handleConfirmAction = async () => {
    if (!alertAction) return;
    const { type, nfse } = alertAction;

    const upsertNfse = async (updates: Record<string, any>) => {
      const { data: current } = await supabase.from("compras_nfse").select("*").eq("id", nfse.id).single();
      if (!current) return { error: { message: "NFS-e não encontrada" } };
      return supabase.from("compras_nfse").upsert({ ...current, ...updates }, { onConflict: "id" });
    };

    if (type === "desvincular") {
      const { error } = await upsertNfse({
        status_lancamento: "pendente",
        pedido_compra_numero: null, pedido_compra_entidade: null,
        pedido_compra_classe: null, pedido_compra_centro_custo: null,
        pedido_compra_cond_pagamento: null, pedido_compra_valor: null,
        updated_at: new Date().toISOString(),
      });
      if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Vinculação removida" }); }
    } else if (type === "reverter") {
      const { error } = await upsertNfse({
        status_lancamento: "vinculada",
        lancado_por: null, lancado_em: null,
        updated_at: new Date().toISOString(),
      });
      if (error) { toast({ title: "Erro", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Lançamento revertido" }); }
    }
    setAlertAction(null);
    fetchNfseRows();
  };

  const statusLancBadge = (r: NfseRow) => {
    const st = r.status_lancamento || "pendente";
    switch (st) {
      case "vinculada": return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Vinculada (Ped. {r.pedido_compra_numero})</Badge>;
      case "lancada": return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Lançada</Badge>;
      
      default: return <Badge variant="outline">Pendente</Badge>;
    }
  };

  // ── Export Excel ──────────────────────────────────────────────
  const handleExport = async () => {
    const XLSX = await import("xlsx");
    const rows = filtered.map(r => ({
      "NSU": r.nsu,
      "Número": r.numero,
      "Prestador": r.prestador_nome,
      "CNPJ Prestador": formatCnpj(r.prestador_cnpj),
      "Serviço": r.descricao_servico,
      "Código Serviço": r.codigo_servico,
      "Valor Serviço": r.valor_servico,
      "Base ISS": r.base_calculo_iss,
      "Alíq. ISS": r.aliquota_iss,
      "Valor ISS": r.valor_iss,
      "ISS Retido": r.iss_retido ? "Sim" : "Não",
      "PIS": r.valor_pis,
      "COFINS": r.valor_cofins,
      "CSLL": r.valor_retencao_csll,
      "IRRF": r.valor_retencao_irrf,
      "INSS": r.valor_retencao_inss,
      "Total Retenções": r.valor_total_retencoes,
      "Valor Líquido": r.valor_liquido,
      "Data Emissão": formatDate(r.data_emissao),
      "Situação": r.situacao,
      "Chave Acesso": r.chave_acesso,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NFS-e");
    XLSX.writeFile(wb, `nfse_${ano}_${String(mes).padStart(2, "0")}.xlsx`);
  };

  // ── XML Pretty Print ──────────────────────────────────────
  const prettyXml = (xml: string) => {
    try {
      const serializer = new XMLSerializer();
      const doc = new DOMParser().parseFromString(xml, "text/xml");
      let result = serializer.serializeToString(doc);
      // Simple indent
      let indent = 0;
      result = result.replace(/(>)(<)/g, "$1\n$2");
      return result.split("\n").map(line => {
        if (line.match(/^<\/\w/)) indent--;
        const pad = "  ".repeat(Math.max(0, indent));
        if (line.match(/^<\w[^>]*[^/]>$/)) indent++;
        return pad + line;
      }).join("\n");
    } catch { return xml; }
  };

  const toggleExpand = (id: string) => setExpandedId(prev => prev === id ? null : id);

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Notas de Serviço (NFS-e)</h1>
        <p className="text-muted-foreground">Importação de Notas Fiscais de Serviço Eletrônicas via API Nacional</p>
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* AREA 1 — SEFAZ Consultation (existing, untouched logic) */}
      {/* ═══════════════════════════════════════════════════════ */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Search className="h-4 w-4 shrink-0" />
            <span>Buscar NFS-e emitidas contra o CNPJ da empresa na base nacional</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Último NSU</Label>
              <Input className="h-8 w-48 text-xs" value={ultNsu} onChange={e => setUltNsu(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Máx. Docs</Label>
              <Input className="h-8 w-24 text-xs" type="number" value={maxDocs} onChange={e => setMaxDocs(Number(e.target.value) || 50)} />
            </div>
            <div className="flex flex-col items-end gap-1 self-end">
              <Button onClick={handleConsultar} disabled={isLoading || minutesLeft > 0} className="gap-2">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : minutesLeft > 0 ? <Timer className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                {isLoading ? "Consultando..." : minutesLeft > 0 ? `Aguarde ${minutesLeft} min` : "Consultar NFS-e"}
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
        ) : (
          <span>Nenhuma consulta realizada</span>
        )}
      </div>

      {queryDone && (
        <div className="flex items-center gap-2">
          {errorMsg ? (
            <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Erro: {errorMsg}</Badge>
          ) : results.length > 0 ? (
            <Badge className="gap-1 bg-green-600 text-white hover:bg-green-700"><CheckCircle2 className="h-3 w-3" /> {results.length} NFS-e(s) encontrada(s)</Badge>
          ) : (
            <Badge className="gap-1 bg-yellow-500 text-white hover:bg-yellow-600"><AlertTriangle className="h-3 w-3" /> Nenhuma NFS-e nova</Badge>
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
                <CardDescription>NFS-e retornadas pela API Nacional</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">NSU</TableHead>
                  <TableHead>Prestador</TableHead>
                  <TableHead>CNPJ Prestador</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r, i) => (
                  <TableRow key={`${r.decoded.NSU}-${i}`}>
                    <TableCell className="text-xs text-muted-foreground font-mono">{r.decoded.NSU}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{r.parsed.prestadorNome || "N/D"}</TableCell>
                    <TableCell className="text-xs font-mono">{formatCnpj(r.parsed.prestadorCnpj)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatCurrency(r.parsed.valorServico)}</TableCell>
                    <TableCell>{formatDate(r.parsed.dataEmissao || r.decoded.DataHoraGeracao)}</TableCell>
                    <TableCell>
                      {r.cancelada ? (
                        <Badge variant="destructive">Cancelada</Badge>
                      ) : (
                        <Badge className="bg-green-600 text-white hover:bg-green-700">Normal</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.jaImportada ? (
                        <Badge variant="secondary">Já importada</Badge>
                      ) : (
                        <Badge className="bg-blue-600 text-white hover:bg-blue-700">Nova</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Total: {results.length} NFS-e(s) | {novas.length} nova(s) | {importadas.length} já importada(s)
              </p>
              <Button className="gap-2" disabled={novas.length === 0 || isImporting} onClick={handleImportar}>
                {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {isImporting ? `Importando ${novas.length} NFS-e(s)...` : "Importar Todas as Novas"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* AREA 2 — NFS-e Importadas (NEW)                       */}
      {/* ═══════════════════════════════════════════════════════ */}

      {/* Period Selector */}
      <div className="flex items-center gap-3 pt-4 border-t">
        <h2 className="text-lg font-semibold text-foreground mr-2">NFS-e Importadas</h2>
        <Select value={String(mes)} onValueChange={v => setMes(Number(v))}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(ano)} onValueChange={v => setAno(Number(v))}>
          <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[2024, 2025, 2026, 2027].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Total NFS-e</p>
          <p className="text-xl font-bold text-foreground">{summary.total}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Normais</p>
          <p className="text-xl font-bold text-green-600">{summary.normais}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Canceladas</p>
          <p className="text-xl font-bold text-destructive">{summary.canceladas}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Valor Total</p>
          <p className="text-lg font-bold text-foreground">{formatCurrency(summary.valorTotal)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Pendentes</p>
          <p className="text-xl font-bold text-muted-foreground">{summary.pendentes}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Lançadas</p>
          <p className="text-xl font-bold text-green-600">{summary.lancadas}</p>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-9 text-sm" placeholder="Buscar por prestador, CNPJ ou número..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <Select value={filtroSituacao} onValueChange={setFiltroSituacao}>
          <SelectTrigger className="w-36 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="cancelada">Cancelada</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroLancamento} onValueChange={setFiltroLancamento}>
          <SelectTrigger className="w-36 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="vinculada">Vinculadas</SelectItem>
            <SelectItem value="lancada">Lançadas</SelectItem>
            
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="gap-2" onClick={handleExport} disabled={filtered.length === 0}>
          <Download className="h-4 w-4" /> Exportar Excel
        </Button>
      </div>

      {/* Imported NFS-e Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6 px-1" />
                <TableHead className="text-xs px-2">Número</TableHead>
                <TableHead className="text-xs px-2 max-w-[180px]">Prestador</TableHead>
                <TableHead className="text-xs px-2">CNPJ</TableHead>
                <TableHead className="text-xs text-right px-2">Valor</TableHead>
                <TableHead className="text-xs px-2">Data</TableHead>
                <TableHead className="text-xs px-2">Status</TableHead>
                <TableHead className="text-xs px-2">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingRows ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                  <span className="text-sm text-muted-foreground">Carregando NFS-e...</span>
                </TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Nenhuma NFS-e encontrada no período
                </TableCell></TableRow>
              ) : filtered.map(r => {
                const st = r.status_lancamento || "pendente";
                return (
                <TooltipProvider key={r.id}>
                  {/* Main Row */}
                  <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleExpand(r.id)}>
                    <TableCell className="px-1">
                      {expandedId === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </TableCell>
                    <TableCell className="text-xs px-2">{r.numero ?? "—"}</TableCell>
                    <TableCell className="max-w-[180px] truncate text-xs px-2">{r.prestador_nome ?? "—"}</TableCell>
                    <TableCell className="text-xs font-mono px-2">{formatCnpj(r.prestador_cnpj)}</TableCell>
                    <TableCell className="text-right text-xs whitespace-nowrap px-2">{formatCurrency(r.valor_servico)}</TableCell>
                    <TableCell className="text-xs px-2">{formatDate(r.data_emissao)}</TableCell>
                    <TableCell className="px-2">{statusLancBadge(r)}</TableCell>
                    <TableCell className="px-2" onClick={e => e.stopPropagation()}>
                      <div className="flex gap-1">
                        {st === "pendente" && (
                            <Tooltip><TooltipTrigger asChild>
                              <Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1"
                                onClick={() => setVincularDialog({ open: true, nfse: r })}>
                                <LinkIcon className="h-3 w-3" /> Vincular
                              </Button>
                            </TooltipTrigger><TooltipContent>Vincular a pedido de compra</TooltipContent></Tooltip>
                        )}
                        {st === "vinculada" && (
                          <>
                            <Button size="sm" className="h-7 px-2 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white"
                              onClick={() => setLancamentoModal({ open: true, nfse: r })}>
                              <CheckCircle2 className="h-3 w-3" /> Lançar
                            </Button>
                            <Tooltip><TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                                onClick={() => setAlertAction({ type: "desvincular", nfse: r })}>
                                <Unlink className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger><TooltipContent>Desvincular pedido</TooltipContent></Tooltip>
                          </>
                        )}
                        {st === "lancada" && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{r.lancado_por} em {formatDate(r.lancado_em)}</span>
                            <Tooltip><TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                                onClick={() => setAlertAction({ type: "reverter", nfse: r })}>
                                <RotateCcw className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger><TooltipContent>Reverter para vinculada</TooltipContent></Tooltip>
                          </div>
                        )}
                        {r.raw_xml && (
                          <Tooltip><TooltipTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                              onClick={() => gerarDanfsePdf(r.raw_xml!, `DANFSE_${r.numero || r.chave_acesso}.pdf`)}>
                              <FileDown className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger><TooltipContent>Baixar DANFSE (PDF)</TooltipContent></Tooltip>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Expanded Detail */}
                  {expandedId === r.id && (
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={8} className="p-4">
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                          {/* Bloco 1 — Prestador */}
                          <div className="space-y-1">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Prestador</h4>
                            <p className="text-sm">{r.prestador_nome ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">CNPJ: {formatCnpj(r.prestador_cnpj)}</p>
                            <p className="text-xs text-muted-foreground">IM: {r.prestador_inscricao_municipal ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">Município: {r.prestador_municipio_nome || r.prestador_municipio_codigo || "—"} / {r.prestador_uf ?? "—"}</p>
                          </div>

                          {/* Bloco 2 — Serviço */}
                          <div className="space-y-1">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Serviço</h4>
                            <p className="text-xs">Código: <span className="font-mono">{r.codigo_servico ?? "—"}</span></p>
                            <p className="text-xs">{r.descricao_servico ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">Mun. Incidência: {r.municipio_incidencia_nome || r.municipio_incidencia_codigo || "—"}</p>
                            <p className="text-xs text-muted-foreground">Nat. Tributação: {r.natureza_tributacao ?? "—"}</p>
                          </div>

                          {/* Bloco 3 — Valores e Tributos */}
                          <div className="space-y-1">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Valores e Tributos</h4>
                            <div className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-xs">
                              <span>Valor Serviço: <strong>{formatCurrency(r.valor_servico)}</strong></span>
                              <span>Descontos: {formatCurrency((r.valor_desconto_condicionado || 0) + (r.valor_desconto_incondicionado || 0))}</span>
                              <span>Deduções: {formatCurrency(r.valor_deducoes)}</span>
                              <span>Base ISS: {formatCurrency(r.base_calculo_iss)}</span>
                              <span>Alíq. ISS: {formatPercent(r.aliquota_iss)}</span>
                              <span>Valor ISS: {formatCurrency(r.valor_iss)}</span>
                              <span>ISS Retido: {r.iss_retido === true ? "Sim" : r.iss_retido === false ? "Não" : "—"}</span>
                              <span>ISS Retido R$: {formatCurrency(r.valor_iss_retido)}</span>
                              <span />
                              <span>PIS: {formatCurrency(r.valor_pis)}</span>
                              <span>COFINS: {formatCurrency(r.valor_cofins)}</span>
                              <span>CSLL: {formatCurrency(r.valor_retencao_csll)}</span>
                              <span>IRRF: {formatCurrency(r.valor_retencao_irrf)}</span>
                              <span>INSS: {formatCurrency(r.valor_retencao_inss)}</span>
                              <span>Tot. Ret.: {formatCurrency(r.valor_total_retencoes)}</span>
                              <span className="col-span-3 font-semibold pt-1">Valor Líquido: {formatCurrency(r.valor_liquido)}</span>
                            </div>
                          </div>

                          {/* Bloco 4 — Metadados + Ações */}
                          <div className="space-y-2">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Metadados</h4>
                            <p className="text-xs text-muted-foreground font-mono break-all">Chave: {r.chave_acesso}</p>
                            <p className="text-xs text-muted-foreground">NSU: {r.nsu ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">Importado em: {formatDate(r.imported_at)}</p>
                            <p className="text-xs text-muted-foreground">Tipo: {r.tipo_documento ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">Competência: {formatDate(r.data_competencia)}</p>
                            <div className="flex gap-2 pt-2">
                              <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={e => { e.stopPropagation(); setXmlDialog({ open: true, numero: r.numero || "—", prestador: r.prestador_nome || "—", xml: r.raw_xml || "" }); }}>
                                <Eye className="h-3 w-3" /> Ver XML
                              </Button>
                              {r.raw_xml && (
                                <Button variant="outline" size="sm" className="gap-1 text-xs"
                                  onClick={e => { e.stopPropagation(); gerarDanfsePdf(r.raw_xml!, `DANFSE_${r.numero || r.chave_acesso}.pdf`); }}>
                                  <FileDown className="h-3 w-3" /> Baixar DANFSE
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Bloco 5 — Pedido de Compra Vinculado */}
                        <div className="mt-4 pt-3 border-t">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pedido de Compra Vinculado</h4>
                          {(st === "vinculada" || st === "lancada") && r.pedido_compra_numero ? (
                            <div className="grid grid-cols-3 gap-4 text-xs">
                              <span>Pedido: <strong>{r.pedido_compra_numero}</strong></span>
                              <span>Classe: <strong>{r.pedido_compra_classe || "N/D"}</strong></span>
                              <span>Centro de Custo: <strong>{r.pedido_compra_centro_custo || "N/D"}</strong></span>
                              <span>Cond. Pagamento: <strong>{r.pedido_compra_cond_pagamento || "N/D"}</strong></span>
                              <span>Valor Pedido: <strong>{formatCurrency(r.pedido_compra_valor)}</strong></span>
                              <span>Entidade: <strong>{r.pedido_compra_entidade || "N/D"}</strong></span>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">Nenhum pedido de compra vinculado</p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TooltipProvider>
                );
              })}
            </TableBody>
            {filtered.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5} className="text-sm font-medium">{filtered.length} registro(s)</TableCell>
                  <TableCell className="text-right text-sm font-semibold">{formatCurrency(footerTotals.valorServico)}</TableCell>
                  <TableCell className="text-right text-sm font-semibold">{formatCurrency(footerTotals.valorLiquido)}</TableCell>
                  <TableCell colSpan={4} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      {/* XML Dialog */}
      <Dialog open={xmlDialog.open} onOpenChange={open => setXmlDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">XML da NFS-e {xmlDialog.numero} — {xmlDialog.prestador}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded border bg-muted/50 p-3">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">{prettyXml(xmlDialog.xml)}</pre>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => { navigator.clipboard.writeText(xmlDialog.xml); toast({ title: "✅ XML copiado" }); }}>
              <Copy className="h-4 w-4" /> Copiar XML
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vincular Pedido Dialog */}
      {vincularDialog.nfse && (
        <VincularPedidoDialog
          open={vincularDialog.open}
          onOpenChange={(open) => setVincularDialog(prev => ({ ...prev, open }))}
          nfse={vincularDialog.nfse}
          onVinculado={() => { setVincularDialog({ open: false, nfse: null }); fetchNfseRows(); }}
        />
      )}

      {/* Alert Dialog for Desvincular/Reverter */}
      <AlertDialog open={!!alertAction} onOpenChange={(open) => { if (!open) setAlertAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {alertAction?.type === "desvincular" && "Confirmar Desvinculação"}
              {alertAction?.type === "reverter" && "Reverter Lançamento"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {alertAction?.type === "desvincular" && `Deseja desvincular a NFS-e #${alertAction.nfse.numero} do pedido ${alertAction.nfse.pedido_compra_numero}?`}
              {alertAction?.type === "reverter" && `Deseja reverter o lançamento da NFS-e #${alertAction.nfse.numero}? O status voltará para "vinculada".`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction}>
              {alertAction?.type === "desvincular" && "Desvincular"}
              {alertAction?.type === "reverter" && "Reverter"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de Confirmação de Lançamento */}
      {lancamentoModal.nfse && (
        <ConfirmarLancamentoModal
          open={lancamentoModal.open}
          onOpenChange={(open) => setLancamentoModal(prev => ({ ...prev, open }))}
          nfse={lancamentoModal.nfse}
          onConfirmarLancamento={handleConfirmarLancamento}
        />
      )}
    </div>
  );
};

export default ComprasNotasServico;
