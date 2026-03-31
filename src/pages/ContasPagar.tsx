import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { iniciarSyncLog, finalizarSyncLog } from "@/services/syncLogService";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { authenticateAlvo, clearAlvoToken } from "@/services/alvoService";
import {
  RefreshCw, Download, Loader2, FileText, ChevronDown, ChevronRight, DollarSign, XCircle, RotateCcw, Package
} from "lucide-react";
import { format } from "date-fns";


// ── Types ──

interface ContaPagar {
  id: string;
  chave_docfin: number;
  sequencia: number;
  parcial: number;
  numero: string | null;
  especie: string | null;
  serie: string | null;
  origem: string | null;
  projecao: string | null;
  codigo_entidade: string | null;
  nome_entidade: string | null;
  nome_fantasia_entidade: string | null;
  cnpj_cpf: string | null;
  categorias: string | null;
  valor_bruto: number;
  valor_original: number;
  valor_pago: number;
  valor_juros: number;
  valor_multa: number;
  valor_desconto: number;
  valor_irrf: number;
  valor_pis_rf: number;
  valor_cofins_rf: number;
  valor_csll_rf: number;
  valor_inss: number;
  valor_iss: number;
  data_emissao: string | null;
  data_vencimento: string | null;
  data_prorrogacao: string | null;
  data_pagamento: string | null;
  data_competencia: string | null;
  data_entrada: string | null;
  codigo_situacao: string | null;
  nome_situacao: string | null;
  tipo_pag_rec: string | null;
  nome_tipo_pag_rec: string | null;
  tipo_cobranca: string | null;
  nome_tipo_cobranca: string | null;
  cond_pagamento: string | null;
  nome_cond_pagamento: string | null;
  classe_rec_desp: string | null;
  centro_custo: string | null;
  observacao: string | null;
  observacao_docfin: string | null;
  synced_at: string | null;
  chave_movestq: number | null;
  codigo_empresa_filial_movestq: string | null;
  alternativo1: string | null;
  modulo_origem: string | null;
}

// ── Helpers ──

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const PAGE_SIZE = 100;

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  try { return format(new Date(d + "T00:00:00"), "dd/MM/yyyy"); } catch { return d; }
};

const situacaoConfig: Record<string, { label: string; color: string }> = {
  "02.001": { label: "Em Aberto", color: "bg-amber-100 text-amber-800 border-amber-200" },
  "02.002": { label: "Pago", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  "02.003": { label: "Protestado", color: "bg-red-100 text-red-800 border-red-200" },
  "02.004": { label: "Atrasado", color: "bg-red-100 text-red-800 border-red-200" },
  "02.005": { label: "Cancelado", color: "bg-muted text-muted-foreground border-border" },
  "02.006": { label: "Pago Parc.", color: "bg-blue-100 text-blue-800 border-blue-200" },
  "02.007": { label: "Agrupado", color: "bg-slate-100 text-slate-800 border-slate-200" },
  "02.008": { label: "Aberto LADC", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
  "02.009": { label: "Provisão", color: "bg-violet-100 text-violet-800 border-violet-200" },
};

function SituacaoBadge({ codigo, nome }: { codigo: string | null; nome: string | null }) {
  const cfg = situacaoConfig[codigo || ""];
  if (cfg) {
    return <Badge variant="outline" className={`${cfg.color} text-[10px] whitespace-nowrap max-w-[90px] truncate`}>{cfg.label}</Badge>;
  }
  return <Badge variant="outline" className="text-[10px] whitespace-nowrap max-w-[90px] truncate">{nome || codigo || "—"}</Badge>;
}

const mapRow = (r: any) => ({
  codigo_empresa_filial: r.CodigoEmpresaFilial || "1.01",
  chave_docfin: r.ChaveDocFin,
  sequencia: r.Sequencia || 1,
  parcial: r.Parcial || 0,
  numero: r.Numero,
  especie: r.Especie,
  serie: r.Serie,
  origem: r.Origem,
  projecao: r.Projecao,
  codigo_entidade: r.CodigoEntidade,
  nome_entidade: r.NomeEntidade,
  nome_fantasia_entidade: r.EntNomeFant,
  cnpj_cpf: r.CpfCnpjEntidade,
  categorias: r.Categorias,
  valor_bruto: r.ValorBruto || 0,
  valor_original: r.ValorOriginal || 0,
  valor_pago: r.ValorPago || 0,
  valor_juros: r.ValorJuros || 0,
  valor_multa: r.ValorMulta || 0,
  valor_desconto: r.ValorDesconto || 0,
  valor_irrf: r.ValorIRRF || 0,
  valor_pis_rf: r.ValorPISRF || 0,
  valor_cofins_rf: r.ValorCOFINSRF || 0,
  valor_csll_rf: r.ValorCSLLRF || 0,
  valor_inss: r.ValorInss || 0,
  valor_iss: r.ValorIss || 0,
  data_emissao: r.DataEmissao?.split("T")[0] || null,
  data_vencimento: r.DataVencimento?.split("T")[0] || null,
  data_prorrogacao: r.DataProrrogacao?.split("T")[0] || null,
  data_pagamento: r.DataPagamento?.split("T")[0] || null,
  data_competencia: r.DataCompetencia?.split("T")[0] || null,
  data_entrada: r.DataEntrada?.split("T")[0] || null,
  codigo_situacao: r.CodigoSituacao,
  nome_situacao: r.CodigoNomeSituacao?.split(" - ")[1] || r.CodigoNomeSituacao,
  tipo_pag_rec: r.CodigoTipoPagRec,
  nome_tipo_pag_rec: r.CodigoNomeTipoPagRec?.split(" - ")[1] || "",
  tipo_cobranca: r.CodigoTipoCobranca,
  nome_tipo_cobranca: r.CodigoNomeTipoCobranca?.split(" - ")[1] || "",
  cond_pagamento: r.CodigoCondPag,
  nome_cond_pagamento: r.NomeCondPag,
  observacao: r.Observacao,
  observacao_docfin: r.ObservacaoDocFin,
  synced_at: new Date().toISOString(),
});

// ── Component ──

export default function ContasPagar() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const now = new Date();
  const [dataInicio, setDataInicio] = useState(() => {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [dataFim, setDataFim] = useState(() => {
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  });
  const [rows, setRows] = useState<ContaPagar[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncMsg, setSyncMsg] = useState("");
  const [filtroSituacao, setFiltroSituacao] = useState("all");
  const [filtroEspecie, setFiltroEspecie] = useState("all");
  const [filtroProjecao, setFiltroProjecao] = useState("all");
  const [filtroTipoPag, setFiltroTipoPag] = useState("all");
  const [filtroTipoCobranca, setFiltroTipoCobranca] = useState("all");
  const [filtroFornecedor, setFiltroFornecedor] = useState("");
  const [filtroData, setFiltroData] = useState<"vencimento" | "competencia" | "emissao" | "pagamento" | "prorrogacao" | "entrada">("vencimento");
  const [page, setPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [loadingClasseId, setLoadingClasseId] = useState<string | null>(null);
  const [pedidoModalOpen, setPedidoModalOpen] = useState(false);
  const [pedidoModalData, setPedidoModalData] = useState<any>(null);
  const [pedidoModalLoading, setPedidoModalLoading] = useState(false);
  const [pedidoNfseList, setPedidoNfseList] = useState<any[]>([]);
  const [nfOrigemModalOpen, setNfOrigemModalOpen] = useState(false);
  const [nfOrigemModalData, setNfOrigemModalData] = useState<any>(null);
  const [nfOrigemModalLoading, setNfOrigemModalLoading] = useState(false);

  const handleOpenPedidoModal = async (numeroPedido: string) => {
    setPedidoModalOpen(true);
    setPedidoModalLoading(true);
    setPedidoModalData(null);
    setPedidoNfseList([]);
    try {
      const { data: pedido } = await supabase
        .from("compras_pedidos").select("*").eq("numero", numeroPedido).maybeSingle();
      if (pedido) {
        setPedidoModalData(pedido);
        if (!pedido.detalhes_carregados) {
          try {
            const { carregarDetalhesPedido } = await import("@/services/alvoPedCompLoadService");
            await carregarDetalhesPedido(numeroPedido);
            const { data: updated } = await supabase
              .from("compras_pedidos").select("*").eq("numero", numeroPedido).maybeSingle();
            if (updated) setPedidoModalData(updated);
          } catch (err) { console.error("Erro detalhes:", err); }
        }
        const { data: nfses } = await supabase
          .from("compras_nfse")
          .select("id, numero, prestador_nome, prestador_cnpj, valor_servico, valor_liquido, valor_iss, aliquota_iss, valor_total_retencoes, data_emissao, data_competencia, chave_acesso, descricao_servico, status_lancamento, erp_chave_movestq")
          .eq("pedido_compra_numero", numeroPedido)
          .order("data_emissao", { ascending: false });
        setPedidoNfseList(nfses || []);
      } else {
        toast({ title: "Pedido não encontrado no cache", description: "Sincronize os pedidos de compra.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally { setPedidoModalLoading(false); }
  };

  const handleResetDates = () => {
    const d = new Date();
    setDataInicio(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    setDataFim(`${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`);
    setPage(1);
  };

  // ── Load last sync timestamp ──
  useEffect(() => {
    supabase.from("compras_config").select("valor").eq("chave", "cap_last_sync").maybeSingle()
      .then(({ data }) => { if (data?.valor) setLastSync(data.valor); });
  }, []);

  // ── Load data (no 1000 limit) ──
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const campoSupabase = filtroData === "vencimento" ? "data_vencimento"
        : filtroData === "competencia" ? "data_competencia"
        : filtroData === "pagamento" ? "data_pagamento"
        : filtroData === "prorrogacao" ? "data_prorrogacao"
        : filtroData === "entrada" ? "data_entrada"
        : "data_emissao";
      // dataFim is inclusive, so we query <= dataFim
      const endDateExcl = (() => {
        const d = new Date(dataFim + "T00:00:00");
        d.setDate(d.getDate() + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })();

      let allData: any[] = [];
      let from = 0;
      const batchSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("contas_pagar")
          .select("*")
          .gte(campoSupabase, dataInicio)
          .lt(campoSupabase, endDateExcl)
          .order("data_vencimento", { ascending: true })
          .range(from, from + batchSize - 1);

        if (error) throw error;
        allData = allData.concat(data || []);
        if (!data || data.length < batchSize) hasMore = false;
        else from += batchSize;
      }
      setRows(allData);
    } catch (err: any) {
      toast({ title: "Erro ao carregar dados", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [dataInicio, dataFim, filtroData, toast]);

  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (searchParams.get("autoSync") === "true") {
      setSearchParams({});
      setTimeout(() => handleSync(), 500);
    }
  }, []);

  // ── Fetch Classe/CC on expand ──
  const processClasseCC = async (data: any, chaveDocFin: number) => {
    const classes = data.DocFinClasseRecDespChildList || [];
    const classeStr = classes.map((c: any) => c.CodigoClasseRecDesp).filter(Boolean).join(", ");

    let ccStr = "";
    for (const c of classes) {
      const rateios = c.RateioDocFinChildList || [];
      const ccs = rateios.map((r: any) => r.CodigoCentroCtrl).filter(Boolean);
      if (ccs.length > 0) {
        ccStr = ccStr ? ccStr + ", " + ccs.join(", ") : ccs.join(", ");
      }
    }

    const chaveMovEstq = data.ChaveMovEstq || null;
    const codigoEmpresaFilialMovEstq = data.CodigoEmpresaFilialMovEstq || null;
    const alternativo1 = data.Alternativo1 || null;
    const moduloOrigem = data.ModuloOrigem || null;

    // Atualizar todas as parcelas desse documento no cache
    const { data: parcelas } = await supabase
      .from("contas_pagar")
      .select("*")
      .eq("chave_docfin", chaveDocFin);

    if (parcelas && parcelas.length > 0) {
      for (const p of parcelas) {
        await supabase.from("contas_pagar").upsert({
          ...p,
          classe_rec_desp: classeStr || null,
          centro_custo: ccStr || null,
          chave_movestq: chaveMovEstq,
          codigo_empresa_filial_movestq: codigoEmpresaFilialMovEstq,
          alternativo1: alternativo1,
          modulo_origem: moduloOrigem,
        } as any, { onConflict: "codigo_empresa_filial,chave_docfin,sequencia,parcial" });
      }
    }

    // Atualizar o state local
    setRows(prev => prev.map(r =>
      r.chave_docfin === chaveDocFin
        ? { ...r, classe_rec_desp: classeStr || null, centro_custo: ccStr || null,
            chave_movestq: chaveMovEstq, codigo_empresa_filial_movestq: codigoEmpresaFilialMovEstq,
            alternativo1: alternativo1, modulo_origem: moduloOrigem }
        : r
    ));

    return { classe: classeStr, cc: ccStr };
  };

  const fetchClasseCC = async (chaveDocFin: number, rowId: string) => {
    setLoadingClasseId(rowId);
    try {
      let auth = await authenticateAlvo();
      if (!auth.token) return;

      const resp = await fetch(
        `${ERP_BASE_URL}/DocFin/Load?codigoEmpresaFilial=1.01&chave=${chaveDocFin}&loadChild=All`,
        { headers: { "riosoft-token": auth.token } }
      );

      if (resp.status === 409) {
        clearAlvoToken();
        auth = await authenticateAlvo();
        if (!auth.token) return;
        const retry = await fetch(
          `${ERP_BASE_URL}/DocFin/Load?codigoEmpresaFilial=1.01&chave=${chaveDocFin}&loadChild=All`,
          { headers: { "riosoft-token": auth.token } }
        );
        if (!retry.ok) return;
        const data = await retry.json();
        return processClasseCC(data, chaveDocFin);
      }

      if (!resp.ok) return;
      const data = await resp.json();
      return processClasseCC(data, chaveDocFin);
    } catch (err) {
      console.error("Erro ao buscar classe/CC:", err);
    } finally {
      setLoadingClasseId(null);
    }
  };

  const handleExpand = async (row: ContaPagar) => {
    const newId = expandedRow === row.id ? null : row.id;
    setExpandedRow(newId);

    // Se expandindo e sem classe/CC, buscar do Alvo
    if (newId && !row.classe_rec_desp) {
      await fetchClasseCC(row.chave_docfin, row.id);
    }
  };

  // ── Sync (últimos 3 meses) ──
  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress(0);
    setSyncMsg("Autenticando...");
    let logId: string | null = null;

    try {
      logId = await iniciarSyncLog("contas_pagar");
      clearAlvoToken();
      let auth = await authenticateAlvo();
      if (!auth.token) throw new Error("Falha na autenticação ERP");

      // Últimos 3 meses
      const hoje = new Date();
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1);
      const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 2, 1);
      const startISO = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, "0")}-01T03:00:00.000Z`;
      const endISO = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, "0")}-01T03:00:00.000Z`;

      const filter = `DataVencimento >= #${startISO}# AND DataVencimento < #${endISO}# AND CodigoEmpresaFilial = '1.01'`;

      let allItems: any[] = [];
      let pageIndex = 1;

      while (true) {
        setSyncMsg(`Buscando página ${pageIndex}...`);
        setSyncProgress(Math.min(pageIndex * 3, 40));

        let resp: Response | undefined;
        for (let attempt = 1; attempt <= 3; attempt++) {
          resp = await fetch(`${ERP_BASE_URL}/DocFin/GetListForComponents`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "riosoft-token": auth.token! },
            body: JSON.stringify({
              FormName: "ViewParcDocFin",
              ClassInput: "ViewParcDocFin",
              ControllerForm: "docFin",
              ClassVinculo: "docFin",
              BindingName: "",
              DisabledCache: false,
              Filter: filter,
              Input: "ViewParcDocFinPagar",
              IsGroupBy: false,
              Order: "",
              OrderUser: "",
              PageIndex: pageIndex,
              PageSize: 50,
              Shortcut: "dfa",
              Type: "GridTable",
              TypeObject: "tabForm",
            }),
          });

          if (resp!.status === 409) {
            clearAlvoToken();
            auth = await authenticateAlvo();
            await new Promise(r => setTimeout(r, 1000 * attempt));
            continue;
          }
          break;
        }

        if (!resp!.ok) throw new Error(`HTTP ${resp!.status} ao buscar ERP`);

        const data = await resp!.json();
        const items: any[] = Array.isArray(data) ? data : (data?.lista ?? data?.Registros ?? data?.Items ?? data?.Data ?? []);
        if (!items.length) break;

        allItems.push(...items);
        setSyncMsg(`${allItems.length} registros carregados...`);
        if (items.length < 50) break;
        pageIndex++;
      }

      if (allItems.length === 0) {
        toast({ title: "Nenhum registro encontrado no ERP." });
        setSyncing(false);
        return;
      }

      // Upsert em batches de 200
      setSyncMsg("Gravando no banco...");
      const mapped = allItems.map(mapRow);
      for (let i = 0; i < mapped.length; i += 200) {
        const batch = mapped.slice(i, i + 200);
        const { error } = await supabase
          .from("contas_pagar")
          .upsert(batch as any, { onConflict: "codigo_empresa_filial,chave_docfin,sequencia,parcial" });
        if (error) console.error("Upsert error:", error);
        setSyncProgress(40 + Math.round((i / mapped.length) * 55));
        setSyncMsg(`Gravando ${i + batch.length}/${mapped.length}...`);
      }

      // Salvar timestamp da última sync
      const syncTs = new Date().toISOString();
      await supabase.from("compras_config")
        .upsert({ chave: "cap_last_sync", valor: syncTs, updated_at: syncTs } as any, { onConflict: "chave" });
      setLastSync(syncTs);

      setSyncProgress(100);
      await finalizarSyncLog(logId, "contas_pagar", { status: "success", records_processed: mapped.length });
      toast({ title: "Sincronização concluída", description: `${mapped.length} registros processados.` });
      await loadData();
    } catch (err: any) {
      await finalizarSyncLog(logId, "contas_pagar", { status: "error", error_message: err.message });
      toast({ title: "Erro na sincronização", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
      setSyncProgress(0);
      setSyncMsg("");
    }
  };

  // ── Handle filter change (local only, no resync) ──
  const handleTrocaFiltroData = (novoFiltro: string) => {
    setFiltroData(novoFiltro as any);
    setPage(1);
  };

  // ── Filters ──
  // Distinct values for dynamic filters
  const tipoPagOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { if (r.nome_tipo_pag_rec) set.add(r.nome_tipo_pag_rec); });
    return Array.from(set).sort();
  }, [rows]);

  const tipoCobrancaOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { if (r.nome_tipo_cobranca) set.add(r.nome_tipo_cobranca); });
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let result = rows;
    if (filtroSituacao !== "all") {
      result = result.filter(r => r.codigo_situacao === filtroSituacao);
    }
    if (filtroEspecie !== "all") {
      result = result.filter(r => r.especie === filtroEspecie);
    }
    if (filtroProjecao !== "all") {
      result = result.filter(r => r.projecao === filtroProjecao);
    }
    if (filtroTipoPag !== "all") {
      result = result.filter(r => r.nome_tipo_pag_rec === filtroTipoPag);
    }
    if (filtroTipoCobranca !== "all") {
      result = result.filter(r => r.nome_tipo_cobranca === filtroTipoCobranca);
    }
    if (filtroFornecedor.trim()) {
      const term = filtroFornecedor.toLowerCase();
      result = result.filter(r =>
        (r.nome_entidade || "").toLowerCase().includes(term) ||
        (r.nome_fantasia_entidade || "").toLowerCase().includes(term) ||
        (r.cnpj_cpf || "").includes(term)
      );
    }
    return result;
  }, [rows, filtroSituacao, filtroEspecie, filtroProjecao, filtroTipoPag, filtroTipoCobranca, filtroFornecedor]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ── Totals for filtered ──
  const totalBruto = filtered.reduce((s, r) => s + (r.valor_bruto || 0), 0);
  const totalPago = filtered.reduce((s, r) => s + (r.valor_pago || 0), 0);
  const saldoTotal = totalBruto - totalPago;

  // ── Export ──
  const handleExport = async () => {
    const XLSX = await import("xlsx");

    // Buscar mapa de código alternativo
    const { data: entidades } = await supabase
      .from("compras_entidades_cache")
      .select("cnpj, codigo_alternativo, codigo_entidade")
      .not("cnpj", "is", null);

    const codAltMap = new Map(
      (entidades || []).map(e => [e.cnpj, { codAlt: e.codigo_alternativo, codEnt: e.codigo_entidade }])
    );

    const exportRows = filtered.map(r => {
      const cnpjLimpo = (r.cnpj_cpf || "").replace(/\D/g, "");
      const entInfo = codAltMap.get(cnpjLimpo);
      return {
        "Código Alternativo": entInfo?.codAlt || "",
        "Cód. Entidade": r.codigo_entidade || entInfo?.codEnt || "",
        "Nome Entidade": r.nome_entidade || "",
        "CNPJ/CPF": r.cnpj_cpf || "",
        "Nº Documento": r.numero || "",
        "Espécie": r.especie || "",
        "Série": r.serie || "",
        "Situação": r.nome_situacao || "",
        "Origem": r.origem || "",
        "Data Emissão": r.data_emissao || "",
        "Data Vencimento": r.data_vencimento || "",
        "Data Pagamento": r.data_pagamento || "",
        "Data Competência": r.data_competencia || "",
        "Valor Bruto": r.valor_bruto || 0,
        "Valor Original": r.valor_original || 0,
        "Valor Pago": r.valor_pago || 0,
        "Saldo": (r.valor_bruto || 0) - (r.valor_pago || 0),
        "Valor Desconto": r.valor_desconto || 0,
        "Valor Juros": r.valor_juros || 0,
        "Valor Multa": r.valor_multa || 0,
        "Valor IRRF": r.valor_irrf || 0,
        "Valor PIS RF": r.valor_pis_rf || 0,
        "Valor COFINS RF": r.valor_cofins_rf || 0,
        "Valor CSLL RF": r.valor_csll_rf || 0,
        "Valor INSS": r.valor_inss || 0,
        "Valor ISS": r.valor_iss || 0,
        "Tipo Pag/Rec": r.nome_tipo_pag_rec || "",
        "Tipo Cobrança": r.nome_tipo_cobranca || "",
        "Cond. Pagamento": r.nome_cond_pagamento || "",
        "Projeção": r.projecao || "",
        "Classe Rec/Desp": r.classe_rec_desp || "",
        "Centro Custo": r.centro_custo || "",
        "Categorias": r.categorias || "",
        "Chave DocFin": r.chave_docfin,
        "Observação": r.observacao || "",
        "Obs. DocFin": r.observacao_docfin || "",
      };
    });

    const ws = XLSX.utils.json_to_sheet(exportRows);
    ws["!cols"] = [
      { wch: 15 }, { wch: 12 }, { wch: 40 }, { wch: 20 }, { wch: 20 },
      { wch: 8 }, { wch: 6 }, { wch: 15 }, { wch: 12 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contas a Pagar");
    const mes = dataInicio.slice(5, 7);
    const ano = dataInicio.slice(0, 4);
    XLSX.writeFile(wb, `contas-a-pagar-${ano}-${mes}.xlsx`);
  };

  return (
    <div className="relative">
      {/* Overlay de congelamento */}
      {syncing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-lg border bg-card p-8 shadow-lg text-center space-y-4 max-w-md">
            <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
            <h3 className="text-lg font-semibold">Sincronizando com o ERP Alvo</h3>
            <p className="text-sm text-muted-foreground">{syncMsg}</p>
            <Progress value={syncProgress} className="w-full" />
            <p className="text-xs text-muted-foreground">{syncProgress}% concluído</p>
            <p className="text-xs text-muted-foreground/60">Aguarde, não feche ou navegue.</p>
          </div>
        </div>
      )}

      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Contas a Pagar</h1>
            <p className="text-sm text-muted-foreground">
              Títulos a pagar sincronizados do ERP
              {lastSync && (
                <span className="ml-2 text-xs">
                  · Última sync: {new Date(lastSync).toLocaleDateString("pt-BR")} às {new Date(lastSync).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0} className="gap-1.5">
              <Download className="h-4 w-4" /> Exportar
            </Button>
            <Button size="sm" onClick={handleSync} disabled={syncing} className="gap-1.5">
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sincronizar Alvo
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-[105px] shrink-0">
            <label className="mb-0.5 block text-[10px] text-muted-foreground">Filtrar por</label>
            <Select value={filtroData} onValueChange={handleTrocaFiltroData}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vencimento">Vencimento</SelectItem>
                <SelectItem value="competencia">Competência</SelectItem>
                <SelectItem value="emissao">Emissão</SelectItem>
                <SelectItem value="pagamento">Pagamento</SelectItem>
                <SelectItem value="prorrogacao">Prorrogação</SelectItem>
                <SelectItem value="entrada">Entrada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-[120px] shrink-0">
            <label className="mb-0.5 block text-[10px] text-muted-foreground">De</label>
            <Input type="date" value={dataInicio} onChange={e => { setDataInicio(e.target.value); setPage(1); }} className="h-8 text-xs" />
          </div>
          <div className="w-[120px] shrink-0">
            <label className="mb-0.5 block text-[10px] text-muted-foreground">Até</label>
            <Input type="date" value={dataFim} onChange={e => { setDataFim(e.target.value); setPage(1); }} className="h-8 text-xs" />
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleResetDates} title="Resetar para mês atual">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <div className="w-[100px] shrink-0">
            <label className="mb-0.5 block text-[10px] text-muted-foreground">Situação</label>
            <Select value={filtroSituacao} onValueChange={v => { setFiltroSituacao(v); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="02.001">Em Aberto</SelectItem>
                <SelectItem value="02.002">Pago</SelectItem>
                <SelectItem value="02.004">Atrasado</SelectItem>
                <SelectItem value="02.005">Cancelado</SelectItem>
                <SelectItem value="02.006">Pago Parcial</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-[80px] shrink-0">
            <label className="mb-0.5 block text-[10px] text-muted-foreground">Espécie</label>
            <Select value={filtroEspecie} onValueChange={v => { setFiltroEspecie(v); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="NFS-e">NFS-e</SelectItem>
                <SelectItem value="NF-e">NF-e</SelectItem>
                <SelectItem value="PC">PC</SelectItem>
                <SelectItem value="EMP">EMP</SelectItem>
                <SelectItem value="PROV">PROV</SelectItem>
                <SelectItem value="PARC">PARC</SelectItem>
                <SelectItem value="FOL">FOL</SelectItem>
                <SelectItem value="DIV">DIV</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-[70px] shrink-0">
            <label className="mb-0.5 block text-[10px] text-muted-foreground">Projeção</label>
            <Select value={filtroProjecao} onValueChange={v => { setFiltroProjecao(v); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="Sim">Sim</SelectItem>
                <SelectItem value="Não">Não</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-[100px] shrink-0">
            <label className="mb-0.5 block text-[10px] text-muted-foreground">Tp Pagamento</label>
            <Select value={filtroTipoPag} onValueChange={v => { setFiltroTipoPag(v); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {tipoPagOptions.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[100px] shrink-0">
            <label className="mb-0.5 block text-[10px] text-muted-foreground">Tp Cobrança</label>
            <Select value={filtroTipoCobranca} onValueChange={v => { setFiltroTipoCobranca(v); setPage(1); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {tipoCobrancaOptions.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[120px] flex-1">
            <label className="mb-0.5 block text-[10px] text-muted-foreground">Fornecedor</label>
            <Input
              placeholder="Nome ou CNPJ..."
              value={filtroFornecedor}
              onChange={e => { setFiltroFornecedor(e.target.value); setPage(1); }}
              className="h-8 text-xs"
            />
          </div>
          <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2" onClick={() => { setFiltroSituacao("all"); setFiltroEspecie("all"); setFiltroProjecao("all"); setFiltroTipoPag("all"); setFiltroTipoCobranca("all"); setFiltroFornecedor(""); setPage(1); }}>
            <XCircle className="mr-1 h-3.5 w-3.5" /> Limpar
          </Button>
        </div>

        {/* Table */}
        <Card className="overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="table-fixed w-full caption-bottom text-sm">
              <thead className="sticky top-0 z-10 bg-card shadow-sm [&_tr]:border-b">
                <TableRow>
                  <TableHead className="w-[2.5%] px-0.5" />
                  <TableHead className="w-[6.5%] px-1 text-xs">Situação</TableHead>
                  <TableHead className="w-[6%] px-1 text-xs">Emissão</TableHead>
                  <TableHead className="w-[6%] px-1 text-xs">Vencim.</TableHead>
                  <TableHead className="w-[6%] px-1 text-xs">Pagam.</TableHead>
                  <TableHead className="w-[6%] px-1 text-xs">Prorrog.</TableHead>
                  <TableHead className="w-[6%] px-1 text-xs">Entrada</TableHead>
                  <TableHead className="w-[6.5%] px-1 text-xs">Nº Doc</TableHead>
                  <TableHead className="w-[16%] px-1 text-xs">Fornecedor</TableHead>
                  <TableHead className="w-[8%] px-1 text-right text-xs">Vl. Bruto</TableHead>
                  <TableHead className="w-[7.5%] px-1 text-right text-xs">Saldo</TableHead>
                  <TableHead className="w-[2.5%] px-0.5 text-center text-xs">Pr</TableHead>
                  <TableHead className="w-[10%] px-1 text-xs">Tp Pag</TableHead>
                  <TableHead className="w-[10%] px-1 text-xs">Tp Cobr</TableHead>
                </TableRow>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {loading ? (
                  <TableRow><TableCell colSpan={14} className="py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                  </TableCell></TableRow>
                ) : paged.length === 0 ? (
                  <TableRow><TableCell colSpan={14} className="py-12 text-center text-muted-foreground">
                    Nenhum registro encontrado.
                  </TableCell></TableRow>
                ) : (
                  paged.map(row => {
                    const saldo = (row.valor_bruto || 0) - (row.valor_pago || 0);
                    const isExpanded = expandedRow === row.id;
                    return (
                      <>{/* Main row */}
                        <TableRow
                          key={row.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => handleExpand(row)}
                        >
                          <TableCell className="px-0.5">
                            {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                          </TableCell>
                          <TableCell className="px-1"><SituacaoBadge codigo={row.codigo_situacao} nome={row.nome_situacao} /></TableCell>
                          <TableCell className="whitespace-nowrap px-1 text-xs">{fmtDate(row.data_emissao)}</TableCell>
                          <TableCell className="whitespace-nowrap px-1 text-xs">{fmtDate(row.data_vencimento)}</TableCell>
                          <TableCell className="whitespace-nowrap px-1 text-xs">{fmtDate(row.data_pagamento)}</TableCell>
                          <TableCell className="whitespace-nowrap px-1 text-xs">{fmtDate(row.data_prorrogacao)}</TableCell>
                          <TableCell className="whitespace-nowrap px-1 text-xs">{fmtDate(row.data_entrada)}</TableCell>
                          <TableCell className="truncate px-1 text-xs font-medium" title={row.numero || ""}>{row.numero || "—"}</TableCell>
                          <TableCell className="truncate px-1 text-xs" title={row.nome_entidade || ""}>
                            {row.nome_entidade || row.nome_fantasia_entidade || "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap px-1 text-right text-xs font-medium">{fmtBRL(row.valor_bruto)}</TableCell>
                          <TableCell className={`whitespace-nowrap px-1 text-right text-xs font-medium ${saldo > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                            {fmtBRL(saldo)}
                          </TableCell>
                          <TableCell className="px-0.5 text-center text-xs">
                            {row.projecao === "Sim"
                              ? <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200 px-0.5 text-[8px] leading-none">P</Badge>
                              : ""}
                          </TableCell>
                          <TableCell className="truncate px-1 text-xs" title={row.nome_tipo_pag_rec || ""}>{row.nome_tipo_pag_rec || "—"}</TableCell>
                          <TableCell className="truncate px-1 text-xs" title={row.nome_tipo_cobranca || ""}>{row.nome_tipo_cobranca || "—"}</TableCell>
                        </TableRow>
                        {/* Expanded detail */}
                        {isExpanded && (
                          <TableRow key={`${row.id}-detail`} className="bg-muted/30">
                             <TableCell colSpan={14}>
                              {/* Botões de rastreabilidade */}
                              <div className="flex items-center gap-3 mb-3 pt-2">
                                {row.chave_movestq && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(`/nf-entrada?chave=${row.chave_movestq}&empresa=${row.codigo_empresa_filial_movestq || "1.01"}`);
                                    }}
                                  >
                                    <FileText className="h-3.5 w-3.5" />
                                    NF de Origem (MovEstq {row.chave_movestq})
                                  </Button>
                                )}
                                {row.modulo_origem === "Compras" && row.alternativo1 && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="gap-1.5 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenPedidoModal(row.alternativo1!);
                                    }}
                                  >
                                    <Package className="h-3.5 w-3.5" />
                                    Pedido de Compra {row.alternativo1}
                                  </Button>
                                )}
                                {!row.chave_movestq && !(row.modulo_origem === "Compras" && row.alternativo1) && row.classe_rec_desp !== undefined && row.modulo_origem && (
                                  <span className="text-xs text-muted-foreground italic">
                                    Origem: {row.modulo_origem} — sem NF ou pedido vinculado
                                  </span>
                                )}
                                {loadingClasseId === row.id && (
                                  <span className="text-xs text-muted-foreground">Carregando referências...</span>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-x-8 gap-y-1 py-2 text-xs sm:grid-cols-3 lg:grid-cols-4">
                                <Detail label="Espécie" value={row.especie} />
                                <Detail label="Valor Pago" value={fmtBRL(row.valor_pago)} />
                                <Detail label="Competência" value={fmtDate(row.data_competencia)} />
                                <Detail label="Classe Rec/Desp" value={loadingClasseId === row.id ? "Carregando..." : row.classe_rec_desp} />
                                <Detail label="Centro de Custo" value={loadingClasseId === row.id ? "Carregando..." : row.centro_custo} />
                                <Detail label="Cond. Pagamento" value={row.nome_cond_pagamento} />
                                <Detail label="Origem" value={row.origem} />
                                <Detail label="IRRF" value={fmtBRL(row.valor_irrf)} />
                                <Detail label="PIS RF" value={fmtBRL(row.valor_pis_rf)} />
                                <Detail label="COFINS RF" value={fmtBRL(row.valor_cofins_rf)} />
                                <Detail label="CSLL RF" value={fmtBRL(row.valor_csll_rf)} />
                                <Detail label="INSS" value={fmtBRL(row.valor_inss)} />
                                <Detail label="ISS" value={fmtBRL(row.valor_iss)} />
                                <Detail label="Juros" value={fmtBRL(row.valor_juros)} />
                                <Detail label="Multa" value={fmtBRL(row.valor_multa)} />
                                {row.observacao && <div className="col-span-full"><span className="text-muted-foreground">Obs: </span>{row.observacao}</div>}
                                {row.observacao_docfin && <div className="col-span-full"><span className="text-muted-foreground">Obs DocFin: </span>{row.observacao_docfin}</div>}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })
                )}
                {/* Footer totals */}
                {paged.length > 0 && (
                   <TableRow className="bg-muted/50 font-medium">
                    <TableCell colSpan={9} className="text-right text-xs text-muted-foreground px-1">Totais filtrados:</TableCell>
                     <TableCell className="whitespace-nowrap text-right text-xs px-1">{fmtBRL(totalBruto)}</TableCell>
                     <TableCell className="whitespace-nowrap text-right text-xs px-1">{fmtBRL(saldoTotal)}</TableCell>
                     <TableCell colSpan={3} />
                  </TableRow>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t p-3">
              <span className="text-xs text-muted-foreground">{filtered.length} registro(s)</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
                <span className="flex items-center px-2 text-xs text-muted-foreground">{page}/{totalPages}</span>
                <Button variant="ghost" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Próximo</Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Modal Pedido de Compra */}
      <Dialog open={pedidoModalOpen} onOpenChange={setPedidoModalOpen}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Pedido de Compra {pedidoModalData?.numero}
            </DialogTitle>
          </DialogHeader>

          {pedidoModalLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">Carregando pedido...</span>
            </div>
          ) : !pedidoModalData ? (
            <p className="text-sm text-muted-foreground text-center py-8">Pedido não encontrado.</p>
          ) : (
            <div className="space-y-4">
              {/* 1. Dados Básicos */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">Dados Básicos</h4>
                <div className="grid grid-cols-4 gap-x-4 gap-y-1 text-xs">
                  <Detail label="Número" value={pedidoModalData.numero} />
                  <Detail label="Data Pedido" value={pedidoModalData.data_pedido?.split("T")[0]} />
                  <Detail label="Data Entrega" value={pedidoModalData.data_entrega?.split("T")[0]} />
                  <Detail label="Status" value={pedidoModalData.status} />
                  <div className="col-span-2"><Detail label="Fornecedor" value={pedidoModalData.nome_entidade} /></div>
                  <Detail label="CNPJ" value={pedidoModalData.cnpj_entidade} />
                  <Detail label="Aprovado" value={pedidoModalData.aprovado} />
                  <Detail label="Tipo" value={pedidoModalData.tipo} />
                  <div><span className="text-muted-foreground">Valor Total: </span><span className="font-semibold text-foreground">{fmtBRL(pedidoModalData.valor_total)}</span></div>
                  <Detail label="Cond. Pagamento" value={pedidoModalData.nome_cond_pag || pedidoModalData.codigo_cond_pag} />
                  <Detail label="Comprador" value={pedidoModalData.comprado || pedidoModalData.codigo_usuario} />
                </div>
              </div>

              <Separator />

              {/* 2. Itens do Pedido */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">Itens do Pedido</h4>
                {(() => {
                  const itens = Array.isArray(pedidoModalData.itens) ? pedidoModalData.itens : [];
                  return itens.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Sem itens detalhados</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead><tr className="border-b text-muted-foreground">
                        <th className="py-1 text-left w-8">#</th>
                        <th className="py-1 text-left">Produto</th>
                        <th className="py-1 text-left">Descrição</th>
                        <th className="py-1 text-left w-12">Unid.</th>
                        <th className="py-1 text-right w-14">Qtd</th>
                        <th className="py-1 text-right w-20">Vlr Unit</th>
                        <th className="py-1 text-right w-20">Vlr Total</th>
                      </tr></thead>
                      <tbody>
                        {itens.map((it: any, i: number) => (
                          <tr key={i} className="border-b border-muted/50">
                            <td className="py-1">{it.sequencia || i + 1}</td>
                            <td className="py-1">{it.codigoProduto}</td>
                            <td className="py-1">{it.nomeProduto}</td>
                            <td className="py-1">{it.unidade}</td>
                            <td className="py-1 text-right font-mono">{it.quantidade}</td>
                            <td className="py-1 text-right font-mono">{fmtBRL(it.valorUnitario)}</td>
                            <td className="py-1 text-right font-mono">{fmtBRL(it.valorTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>

              <Separator />

              {/* 3. Classe/CC Rateio */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">Classe / Centro de Custo (Rateio)</h4>
                {(() => {
                  const rateio = Array.isArray(pedidoModalData.classe_rateio) ? pedidoModalData.classe_rateio : [];
                  return rateio.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Sem rateio</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead><tr className="border-b text-muted-foreground">
                        <th className="py-1 text-left">Classe</th>
                        <th className="py-1 text-left">Centro Custo</th>
                        <th className="py-1 text-right w-16">%</th>
                        <th className="py-1 text-right w-24">Valor</th>
                      </tr></thead>
                      <tbody>
                        {rateio.map((c: any, i: number) => (
                          <tr key={i} className="border-b border-muted/50">
                            <td className="py-1">{c.classe}</td>
                            <td className="py-1">{(c.centrosCusto || [])[0]?.codigo || "—"}</td>
                            <td className="py-1 text-right font-mono">{c.percentual != null ? `${c.percentual}%` : "—"}</td>
                            <td className="py-1 text-right font-mono">{fmtBRL(c.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>

              <Separator />

              {/* 4. Parcelas */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">Parcelas</h4>
                {(() => {
                  const parcelas = Array.isArray(pedidoModalData.parcelas) ? pedidoModalData.parcelas : [];
                  return parcelas.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Sem parcelas</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead><tr className="border-b text-muted-foreground">
                        <th className="py-1 text-left w-8">#</th>
                        <th className="py-1 text-left">Duplicata</th>
                        <th className="py-1 text-left w-24">Vencimento</th>
                        <th className="py-1 text-right w-24">Valor</th>
                      </tr></thead>
                      <tbody>
                        {parcelas.map((p: any, i: number) => (
                          <tr key={i} className="border-b border-muted/50">
                            <td className="py-1">{p.sequencia || i + 1}</td>
                            <td className="py-1">{p.duplicata || "—"}</td>
                            <td className="py-1">{p.vencimento || "—"}</td>
                            <td className="py-1 text-right font-mono">{fmtBRL(p.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>

              <Separator />

              {/* 5. NFS-e Vinculadas */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground mb-2">NFS-e Vinculadas</h4>
                {pedidoNfseList.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Nenhuma NFS-e vinculada</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead><tr className="border-b text-muted-foreground">
                      <th className="py-1 text-left">Número</th>
                      <th className="py-1 text-left">Prestador</th>
                      <th className="py-1 text-right w-24">Valor</th>
                      <th className="py-1 text-left w-24">Emissão</th>
                      <th className="py-1 text-left w-24">Competência</th>
                      <th className="py-1 text-right w-24">Vlr Líquido</th>
                      <th className="py-1 text-right w-24">Retenções</th>
                      <th className="py-1 text-left w-20">Status</th>
                      <th className="py-1 text-center w-16">Ações</th>
                    </tr></thead>
                    <tbody>
                      {pedidoNfseList.map((nf: any) => (
                        <React.Fragment key={nf.id}>
                          <tr className="border-b border-muted/50">
                            <td className="py-1">{nf.numero}</td>
                            <td className="py-1">{nf.prestador_nome}</td>
                            <td className="py-1 text-right font-mono">{fmtBRL(nf.valor_servico)}</td>
                            <td className="py-1">{nf.data_emissao?.split("T")[0] || "—"}</td>
                            <td className="py-1">{nf.data_competencia || "—"}</td>
                            <td className="py-1 text-right font-mono">{fmtBRL(nf.valor_liquido)}</td>
                            <td className="py-1 text-right font-mono">{fmtBRL(nf.valor_total_retencoes)}</td>
                            <td className="py-1"><Badge variant="outline" className="text-[10px]">{nf.status_lancamento || "—"}</Badge></td>
                            <td className="py-1 text-center">
                              {nf.chave_acesso && (
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="DANFSE"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      const { data: nfData } = await supabase
                                        .from("compras_nfse").select("raw_xml").eq("id", nf.id).maybeSingle();
                                      if (!nfData?.raw_xml) {
                                        toast({ title: "XML não disponível", variant: "destructive" });
                                        return;
                                      }
                                      const { gerarDanfsePdfBlob } = await import("@/services/danfseGeneratorService");
                                      const blob = gerarDanfsePdfBlob(nfData.raw_xml);
                                      const url = URL.createObjectURL(blob);
                                      window.open(url, "_blank");
                                    } catch (err: any) {
                                      toast({ title: "Erro ao gerar DANFSE", description: err.message, variant: "destructive" });
                                    }
                                  }}>
                                  <Download className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </td>
                          </tr>
                          {nf.descricao_servico && (
                            <tr className="border-b border-muted/50">
                              <td colSpan={9} className="py-0.5 pl-2 text-xs text-muted-foreground italic">
                                {nf.descricao_servico.length > 100 ? nf.descricao_servico.slice(0, 100) + "…" : nf.descricao_servico}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* 6. Observações */}
              {pedidoModalData.texto && (
                <>
                  <Separator />
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground mb-2">Observações</h4>
                    <div className="max-h-[100px] overflow-auto rounded border border-border p-2 text-xs text-foreground whitespace-pre-wrap">
                      {pedidoModalData.texto}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <span className="text-foreground">{value || "—"}</span>
    </div>
  );
}
