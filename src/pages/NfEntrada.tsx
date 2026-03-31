import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  FileText, RefreshCw, Download, Search, Pencil, Check, Trash2, Plus,
  Hash, Receipt, Sparkles, CheckCircle2, AlertCircle, Clock, ChevronDown, ChevronRight,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  sincronizarNfEntradaPorPeriodo,
  type SyncNfEntradaResult,
} from "@/services/alvoNfEntradaService";
import {
  enriquecerNfEntrada,
  type EnrichResult,
} from "@/services/alvoNfEnriquecimentoService";
import {
  sincronizarDocFinDespesas,
  type SyncDocFinDespesasResult,
} from "@/services/alvoDocFinDespesasService";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ── Types ──────────────────────────────────────────────────────
interface NfEntradaRow {
  id: string;
  erp_chave: number;
  tipo_lancamento: string;
  especie: string | null;
  numero: string | null;
  serie: string | null;
  data_emissao: string | null;
  data_movimento: string | null;
  data_entrada: string | null;
  fornecedor_codigo: string | null;
  fornecedor_nome: string | null;
  fornecedor_cnpj: string | null;
  valor_documento: number | null;
  valor_liquido: number | null;
  valor_mercadoria: number | null;
  chave_acesso_nfe: string | null;
  observacao: string | null;
  cost_center_id: string | null;
  class_rec_desp_codigo: string | null;
  class_rec_desp_nome: string | null;
  cost_centers: { id: string; name: string; erp_code: string | null } | null;
  nf_entrada_rateio?: { id: string; cost_center_id: string | null }[];
  origem?: string | null;
}

interface NfRateioRow {
  id: string;
  sequencia: number | null;
  class_rec_desp_codigo: string | null;
  class_rec_desp_nome: string | null;
  classe_percentual: number | null;
  classe_valor: number | null;
  cost_center_erp_code: string | null;
  centro_percentual: number | null;
  centro_valor: number | null;
  cost_centers: { name: string } | null;
}

interface RateioEditRow {
  id: string;
  isNew?: boolean;
  sequencia: number | null;
  class_rec_desp_codigo: string;
  class_rec_desp_nome: string;
  classe_percentual: number | null;
  classe_valor: number | null;
  cost_center_id: string | null;
  cost_center_erp_code: string | null;
  centro_percentual: number | null;
  centro_valor: number | null;
}

interface AddDespesaForm {
  data_movimento: string;
  fornecedor_nome: string;
  especie: string;
  valor_documento: string;
  observacao: string;
}

interface CostCenter {
  id: string;
  name: string;
  erp_code: string | null;
}

// ── Helpers ────────────────────────────────────────────────────
const fmt = (v: number | null) =>
  v != null
    ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

// ── Component ──────────────────────────────────────────────────
export default function NfEntrada() {
  const { t } = useLanguage();

  const [ano, setAno] = useState(currentYear);
  const [mes, setMes] = useState(currentMonth);

  const [rows, setRows] = useState<NfEntradaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);

  const [search, setSearch] = useState("");
  const [especieFilter, setEspecieFilter] = useState("all");
  const [origemFilter, setOrigemFilter] = useState("all");

  const [syncOpen, setSyncOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncResult, setSyncResult] = useState<SyncNfEntradaResult | null>(null);

  // Sync DocFin dialog
  const [syncDocFinOpen, setSyncDocFinOpen] = useState(false);
  const [syncingDocFin, setSyncingDocFin] = useState(false);
  const [syncDocFinProgress, setSyncDocFinProgress] = useState(0);
  const [syncDocFinMessage, setSyncDocFinMessage] = useState("");
  const [syncDocFinResult, setSyncDocFinResult] = useState<SyncDocFinDespesasResult | null>(null);

  // Edit rateio dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingNf, setEditingNf] = useState<NfEntradaRow | null>(null);
  const [editRateioRows, setEditRateioRows] = useState<RateioEditRow[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [classesRecDesp, setClassesRecDesp] = useState<
    { codigo: string; nome: string }[]
  >([]);

  // Add despesa dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddDespesaForm>({
    data_movimento: new Date().toISOString().slice(0, 10),
    fornecedor_nome: "",
    especie: "Outros",
    valor_documento: "",
    observacao: "",
  });
  const [addSaving, setAddSaving] = useState(false);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Enrich dialog
  const [enrichOpen, setEnrichOpen] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState(0);
  const [enrichMessage, setEnrichMessage] = useState("");
  const [enrichResult, setEnrichResult] = useState<EnrichResult | null>(null);

  // Accordion / rateio
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [rateioMap, setRateioMap] = useState<Map<string, NfRateioRow[]>>(new Map());
  const [loadingRateio, setLoadingRateio] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    const padM = String(mes).padStart(2, "0");
    const startDate = `${ano}-${padM}-01`;
    const lastDay = new Date(ano, mes, 0).getDate();
    const endDate = `${ano}-${padM}-${String(lastDay).padStart(2, "0")}`;

    const { data, error } = await supabase
      .from("nf_entrada")
      .select("*, cost_centers(id, name, erp_code), nf_entrada_rateio(id, cost_center_id)")
      .gte("data_movimento", startDate)
      .lte("data_movimento", endDate)
      .order("data_movimento", { ascending: false });

    if (error) {
      console.error("Erro ao buscar NFs:", error);
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      setRows(data ?? []);
    }
    setLoading(false);
  }, [ano, mes]);

  const fetchCostCenters = useCallback(async () => {
    const { data } = await supabase
      .from("cost_centers")
      .select("id, name, erp_code")
      .eq("is_active", true)
      .eq("group_type", "F")
      .order("erp_code");
    setCostCenters(data ?? []);
  }, []);

  const toggleRow = async (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) {
      next.delete(id);
      setExpandedRows(next);
      return;
    }
    next.add(id);
    setExpandedRows(next);

    if (rateioMap.has(id)) return;

    setLoadingRateio((prev) => new Set(prev).add(id));
    const { data } = await (supabase as any)
      .from("nf_entrada_rateio")
      .select("*, cost_centers(name)")
      .eq("nf_entrada_id", id)
      .order("sequencia");
    setRateioMap((prev) => new Map(prev).set(id, data ?? []));
    setLoadingRateio((prev) => {
      const s = new Set(prev);
      s.delete(id);
      return s;
    });
  };

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchCostCenters(); }, [fetchCostCenters]);

  useEffect(() => {
    supabase
      .from("classes_rec_desp")
      .select("codigo, nome")
      .eq("grupo", "F")
      .order("codigo")
      .then(({ data }) => setClassesRecDesp(data ?? []));
  }, []);

  // ── Filtered rows ──────────────────────────────────────────
  const especiesUnicas = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => { if (r.especie) set.add(r.especie); });
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    let f = rows;
    if (origemFilter !== "all") {
      f = f.filter((r) => r.origem === origemFilter);
    }
    if (especieFilter !== "all") {
      f = f.filter((r) => r.especie === especieFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter(
        (r) =>
          r.fornecedor_nome?.toLowerCase().includes(q) ||
          r.numero?.toLowerCase().includes(q) ||
          r.fornecedor_cnpj?.toLowerCase().includes(q)
      );
    }
    return f;
  }, [rows, especieFilter, origemFilter, search]);

  // ── Summary cards ──────────────────────────────────────────
  const totalNfs = filtered.length;
  const totalNfe = filtered.filter((r) =>
    r.especie?.toLowerCase().includes("nf-e") && !r.especie?.toLowerCase().includes("nfs-e")
  ).length;
  const totalNfse = filtered.filter((r) =>
    r.especie?.toLowerCase().includes("nfs-e")
  ).length;
  const somaValorDoc = filtered.reduce(
    (acc, r) => acc + (r.valor_documento ?? 0),
    0
  );
  const totalEnriquecidas = filtered.filter((r) => (r.nf_entrada_rateio ?? []).length > 0).length;
  const pendentesEnriquecimento = filtered.filter(
    (r) => (r.nf_entrada_rateio ?? []).length === 0
  ).length;

  // ── Sync ───────────────────────────────────────────────────
  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncProgress(0);
    setSyncMessage("Iniciando sincronização...");

    try {
      const result = await sincronizarNfEntradaPorPeriodo(
        ano,
        mes,
        (current, total, msg) => {
          setSyncMessage(msg);
          if (total > 0) setSyncProgress(Math.round((current / total) * 100));
        }
      );
      setSyncResult(result);
      toast({
        title: "Sincronização concluída",
        description: `${result.inserted} inseridos, ${result.updated} atualizados, ${result.errors} erros`,
      });
      fetchData();
    } catch (err: any) {
      setSyncMessage(`Erro: ${err.message}`);
      toast({
        title: "Erro na sincronização",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncDocFin = async () => {
    setSyncingDocFin(true);
    setSyncDocFinResult(null);
    setSyncDocFinProgress(0);
    setSyncDocFinMessage("Iniciando sincronização DocFin...");

    try {
      const result = await sincronizarDocFinDespesas(
        ano,
        mes,
        (current, total, msg) => {
          setSyncDocFinMessage(msg);
          if (total > 0)
            setSyncDocFinProgress(Math.round((current / total) * 100));
        }
      );
      setSyncDocFinResult(result);
      toast({
        title: "Sincronização DocFin concluída",
        description: `${result.inserted} inseridos, ${result.updated} atualizados, ${result.errors} erros`,
      });
      fetchData();
    } catch (err: any) {
      setSyncDocFinMessage(`Erro: ${err.message}`);
      toast({
        title: "Erro na sincronização DocFin",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSyncingDocFin(false);
    }
  };

  // ── Export Excel ────────────────────────────────────────────
  const handleExport = async () => {
    const XLSX = await import("xlsx");

    // Buscar todos os rateios das NFs do período visível
    const nfIds = filtered.map((r) => r.id);

    let allRateios: any[] = [];
    if (nfIds.length > 0) {
      const { data: rateioData } = await (supabase as any)
        .from("nf_entrada_rateio")
        .select("*, cost_centers(name)")
        .in("nf_entrada_id", nfIds)
        .order("nf_entrada_id")
        .order("sequencia");
      allRateios = rateioData ?? [];
    }

    // Mapa nf_entrada_id → rateios
    const rateioByNf = new Map<string, any[]>();
    for (const rt of allRateios) {
      const list = rateioByNf.get(rt.nf_entrada_id) ?? [];
      list.push(rt);
      rateioByNf.set(rt.nf_entrada_id, list);
    }

    // Montar linhas — uma por rateio, repetindo dados da NF
    const wsData: any[] = [];

    for (const r of filtered) {
      const rateios = rateioByNf.get(r.id) ?? [];

      if (rateios.length === 0) {
        wsData.push({
          "Data Mov.": fmtDate(r.data_movimento),
          "Espécie": r.especie ?? "",
          "Número": r.numero ?? "",
          "Fornecedor": r.fornecedor_nome ?? "",
          "CNPJ": r.fornecedor_cnpj ?? "",
          "Valor Documento": r.valor_documento ?? 0,
          "Código Classe": "",
          "Nome Classe": "",
          "% Classe": "",
          "Valor Classe": "",
          "Centro de Custo": "",
          "Cód. Centro": "",
          "% Centro": "",
          "Valor Centro": "",
        });
      } else {
        for (const rt of rateios) {
          wsData.push({
            "Data Mov.": fmtDate(r.data_movimento),
            "Espécie": r.especie ?? "",
            "Número": r.numero ?? "",
            "Fornecedor": r.fornecedor_nome ?? "",
            "CNPJ": r.fornecedor_cnpj ?? "",
            "Valor Documento": r.valor_documento ?? 0,
            "Código Classe": rt.class_rec_desp_codigo ?? "",
            "Nome Classe": rt.class_rec_desp_nome ?? "",
            "% Classe": rt.classe_percentual != null
              ? Number(rt.classe_percentual.toFixed(4))
              : "",
            "Valor Classe": rt.classe_valor ?? "",
            "Centro de Custo": rt.cost_centers?.name ?? rt.cost_center_erp_code ?? "",
            "Cód. Centro": rt.cost_center_erp_code ?? "",
            "% Centro": rt.centro_percentual != null
              ? Number(rt.centro_percentual.toFixed(4))
              : "",
            "Valor Centro": rt.centro_valor ?? "",
          });
        }
      }
    }

    const ws = XLSX.utils.json_to_sheet(wsData);

    ws["!cols"] = [
      { wch: 12 },
      { wch: 8 },
      { wch: 14 },
      { wch: 35 },
      { wch: 18 },
      { wch: 16 },
      { wch: 12 },
      { wch: 30 },
      { wch: 10 },
      { wch: 14 },
      { wch: 30 },
      { wch: 20 },
      { wch: 10 },
      { wch: 14 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "NF Entrada");
    XLSX.writeFile(
      wb,
      `nf_entrada_${ano}_${String(mes).padStart(2, "0")}.xlsx`
    );
  };

  const openEditDialog = async (e: React.MouseEvent, row: NfEntradaRow) => {
    e.stopPropagation();
    setEditingNf(row);
    setEditDialogOpen(true);
    setEditLoading(true);
    const { data } = await (supabase as any)
      .from("nf_entrada_rateio")
      .select("*")
      .eq("nf_entrada_id", row.id)
      .order("sequencia");
    setEditRateioRows(
      (data ?? []).map((r: any) => ({
        id: r.id,
        sequencia: r.sequencia,
        class_rec_desp_codigo: r.class_rec_desp_codigo ?? "",
        class_rec_desp_nome: r.class_rec_desp_nome ?? "",
        classe_percentual: r.classe_percentual,
        classe_valor: r.classe_valor,
        cost_center_id: r.cost_center_id,
        cost_center_erp_code: r.cost_center_erp_code,
        centro_percentual: r.centro_percentual,
        centro_valor: r.centro_valor,
      }))
    );
    setEditLoading(false);
  };

  const saveRateioEdits = async () => {
    if (!editingNf) return;

    const soma = editRateioRows.reduce(
      (acc, r) => acc + (r.classe_percentual ?? 0), 0
    );
    if (Math.abs(soma - 100) > 0.01) {
      toast({ title: "Rateio deve somar 100%",
        variant: "destructive" });
      return;
    }

    setEditSaving(true);
    try {
      // Buscar IDs originais para detectar deletados
      const { data: originais } = await (supabase as any)
        .from("nf_entrada_rateio")
        .select("id")
        .eq("nf_entrada_id", editingNf.id);

      const idsOriginais = new Set(
        (originais ?? []).map((r: any) => r.id)
      );
      const idsAtuais = new Set(
        editRateioRows.filter((r) => !r.isNew).map((r) => r.id)
      );

      // Deletar removidos
      const deletar = [...idsOriginais].filter((id: string) => !idsAtuais.has(id));
      for (const id of deletar) {
        await (supabase as any)
          .from("nf_entrada_rateio")
          .delete()
          .eq("id", id);
      }

      // Update existentes
      for (const row of editRateioRows.filter((r) => !r.isNew)) {
        await (supabase as any)
          .from("nf_entrada_rateio")
          .update({
            class_rec_desp_codigo: row.class_rec_desp_codigo || null,
            class_rec_desp_nome: row.class_rec_desp_nome || null,
            cost_center_id: row.cost_center_id || null,
            classe_percentual: row.classe_percentual,
            classe_valor: row.classe_valor,
          })
          .eq("id", row.id);
      }

      // Insert novos
      const novos = editRateioRows.filter((r) => r.isNew);
      if (novos.length > 0) {
        await (supabase as any)
          .from("nf_entrada_rateio")
          .insert(
            novos.map((row, i) => ({
              nf_entrada_id: editingNf.id,
              erp_chave: editingNf.erp_chave,
              sequencia: (editRateioRows.length - novos.length + i + 1),
              class_rec_desp_codigo: row.class_rec_desp_codigo || null,
              class_rec_desp_nome: row.class_rec_desp_nome || null,
              classe_percentual: row.classe_percentual,
              classe_valor: row.classe_valor,
              cost_center_id: row.cost_center_id || null,
            }))
          );
      }

      // Atualizar campo de exibição rápida
      const maior = editRateioRows.reduce((max, cur) =>
        (cur.classe_valor ?? 0) > (max.classe_valor ?? 0) ? cur : max,
        editRateioRows[0]
      );
      await supabase
        .from("nf_entrada")
        .update({
          class_rec_desp_codigo: maior?.class_rec_desp_codigo || null,
          class_rec_desp_nome: maior?.class_rec_desp_nome || null,
          cost_center_id: maior?.cost_center_id || null,
        })
        .eq("id", editingNf.id);

      setRateioMap((prev) => {
        const next = new Map(prev);
        next.delete(editingNf.id);
        return next;
      });
      toast({ title: "Rateio atualizado com sucesso" });
      fetchData();
      setEditDialogOpen(false);
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message,
        variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  const handleAddDespesa = async () => {
    if (!addForm.fornecedor_nome.trim() || !addForm.valor_documento) {
      toast({ title: "Preencha fornecedor e valor", 
        variant: "destructive" });
      return;
    }
    setAddSaving(true);
    try {
      const { error } = await supabase
        .from("nf_entrada")
        .insert({
          erp_chave: Date.now(),
          tipo_lancamento: "MANUAL",
          origem: "MANUAL",
          especie: addForm.especie,
          data_movimento: addForm.data_movimento,
          fornecedor_nome: addForm.fornecedor_nome.trim(),
          valor_documento: parseFloat(
            addForm.valor_documento.replace(",", ".")
          ),
          observacao: addForm.observacao.trim() || null,
        });
      if (error) throw new Error(error.message);
      toast({ title: "Despesa adicionada com sucesso" });
      setAddDialogOpen(false);
      setAddForm({
        data_movimento: new Date().toISOString().slice(0, 10),
        fornecedor_nome: "",
        especie: "Outros",
        valor_documento: "",
        observacao: "",
      });
      fetchData();
    } catch (err: any) {
      toast({ title: "Erro ao adicionar", description: err.message,
        variant: "destructive" });
    } finally {
      setAddSaving(false);
    }
  };

  const confirmDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteId(id);
    setDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("nf_entrada")
        .delete()
        .eq("id", deleteId)
        .eq("origem", "MANUAL");
      if (error) throw new Error(error.message);
      toast({ title: "Despesa excluída" });
      setDeleteConfirmOpen(false);
      setDeleteId(null);
      fetchData();
    } catch (err: any) {
      toast({ title: "Erro ao excluir", description: err.message,
        variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  // ── Enrichment status helper ───────────────────────────────
  const getEnrichmentStatus = (r: NfEntradaRow) => {
    const rateios = r.nf_entrada_rateio ?? [];
    if (rateios.length === 0) return "pending";
    if (rateios.every((rt) => rt.cost_center_id)) return "complete";
    return "partial";
  };

  // ── Months / years ─────────────────────────────────────────
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("nav.nf_entrada" as any)}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {String(m).padStart(2, "0")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
            <SelectTrigger className="w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-1" />
                Sincronizar
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => {
                setSyncOpen(true);
                setSyncResult(null);
                setSyncMessage("");
                setSyncProgress(0);
              }}>
                <Receipt className="h-4 w-4 mr-2" />
                Sincronizar NFs
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                setSyncDocFinOpen(true);
                setSyncDocFinResult(null);
                setSyncDocFinMessage("");
                setSyncDocFinProgress(0);
              }}>
                <div className="flex flex-col">
                  <div className="flex items-center">
                    <FileText className="h-4 w-4 mr-2" />
                    <span className="font-medium">DocFin</span>
                  </div>
                  <span className="text-xs text-muted-foreground ml-6">
                    Sincronizar despesas sem NF via DocFin
                  </span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="sm"
            disabled={pendentesEnriquecimento === 0}
            onClick={() => {
              setEnrichOpen(true);
              setEnrichResult(null);
              setEnrichMessage("");
              setEnrichProgress(0);
            }}
          >
            <Sparkles className="h-4 w-4 mr-1" />
            Enriquecer
          </Button>

          <Button
            size="sm"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Adicionar Despesa
          </Button>

          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />
            Exportar Excel
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <Hash className="h-3.5 w-3.5" /> Total NFs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalNfs}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" /> NF-e
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalNfe}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <Receipt className="h-3.5 w-3.5" /> NFS-e
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalNfse}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium">
              Valor Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmt(somaValorDoc)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Enriquecidas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {totalEnriquecidas}
              <span className="text-sm font-normal text-muted-foreground ml-1">/ {totalNfs}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por fornecedor, número ou CNPJ..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={origemFilter} onValueChange={setOrigemFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Origem" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas origens</SelectItem>
            <SelectItem value="MOVESTQ">MOVESTQ</SelectItem>
            <SelectItem value="DOCFIN">DOCFIN</SelectItem>
            <SelectItem value="MANUAL">MANUAL</SelectItem>
          </SelectContent>
        </Select>
        <Select value={especieFilter} onValueChange={setEspecieFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Espécie" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas espécies</SelectItem>
            {especiesUnicas.map((e) => (
              <SelectItem key={e} value={e}>{e}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data Mov.</TableHead>
                <TableHead>Espécie</TableHead>
                <TableHead>Número</TableHead>
                <TableHead>Chave ERP</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-right">Valor Doc.</TableHead>
                <TableHead className="w-10 text-center">Status</TableHead>
                <TableHead className="w-10">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                   <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    Carregando...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    Nenhuma nota fiscal de entrada encontrada.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => {
                  const enrichment = getEnrichmentStatus(r);
                  return (
                    <React.Fragment key={r.id}>
                    <TableRow className="cursor-pointer" onClick={() => toggleRow(r.id)}>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {expandedRows.has(r.id)
                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          }
                          {fmtDate(r.data_movimento)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline" className="text-xs w-fit">
                            {r.especie ?? "—"}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-xs w-fit ${
                              r.origem === "MANUAL"
                                ? "bg-purple-50 text-purple-700 border-purple-300"
                                : r.origem === "DOCFIN"
                                ? "bg-blue-50 text-blue-700 border-blue-300"
                                : "bg-muted/50 text-muted-foreground"
                            }`}
                          >
                            {r.origem ?? "MOVESTQ"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>{r.numero ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.erp_chave ?? "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{r.fornecedor_nome ?? "—"}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">{fmt(r.valor_documento)}</TableCell>
                      <TableCell className="text-center">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {enrichment === "complete" ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                              ) : enrichment === "partial" ? (
                                <AlertCircle className="h-4 w-4 text-yellow-500 mx-auto" />
                              ) : (
                                <Clock className="h-4 w-4 text-muted-foreground mx-auto" />
                              )}
                            </TooltipTrigger>
                            <TooltipContent>
                              {enrichment === "complete"
                                ? "Enriquecido"
                                : enrichment === "partial"
                                ? "Enriquecimento parcial"
                                : "Aguardando enriquecimento"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={(e) => openEditDialog(e, r)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Editar rateio</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {r.origem === "MANUAL" && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    onClick={(e) => confirmDelete(e, r.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Excluir despesa</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedRows.has(r.id) && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={7} className="p-0">
                          <div className="px-10 py-3 border-t border-muted/40">
                            {loadingRateio.has(r.id) ? (
                              <p className="text-xs text-muted-foreground py-2">
                                Carregando rateio...
                              </p>
                            ) : (rateioMap.get(r.id) ?? []).length === 0 ? (
                              <p className="text-xs text-muted-foreground py-2 italic">
                                Sem rateio registrado — clique em Enriquecer para buscar do ERP.
                              </p>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-muted-foreground border-b border-muted/40">
                                    <th className="text-left py-1.5 pr-4 font-medium w-16">Classe</th>
                                    <th className="text-left py-1.5 pr-4 font-medium">Nome Classe</th>
                                    <th className="text-right py-1.5 pr-4 font-medium w-20">% Classe</th>
                                    <th className="text-right py-1.5 pr-4 font-medium w-28">Valor Classe</th>
                                    <th className="text-left py-1.5 pr-4 font-medium">Centro de Custo</th>
                                    <th className="text-right py-1.5 pr-4 font-medium w-20">% Centro</th>
                                    <th className="text-right py-1.5 font-medium w-28">Valor Centro</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(rateioMap.get(r.id) ?? []).map((rl: NfRateioRow, idx: number) => (
                                    <tr
                                      key={rl.id}
                                      className={
                                        idx % 2 === 0
                                          ? "border-b border-muted/20"
                                          : "border-b border-muted/20 bg-muted/10"
                                      }
                                    >
                                      <td className="py-1.5 pr-4 font-mono text-primary">
                                        {rl.class_rec_desp_codigo ?? "—"}
                                      </td>
                                      <td className="py-1.5 pr-4">
                                        {rl.class_rec_desp_nome ?? "—"}
                                      </td>
                                      <td className="py-1.5 pr-4 text-right tabular-nums">
                                        {rl.classe_percentual != null
                                          ? `${rl.classe_percentual.toFixed(2)}%`
                                          : "—"}
                                      </td>
                                      <td className="py-1.5 pr-4 text-right tabular-nums">
                                        {rl.classe_valor != null
                                          ? rl.classe_valor.toLocaleString("pt-BR", {
                                              style: "currency",
                                              currency: "BRL",
                                            })
                                          : "—"}
                                      </td>
                                      <td className="py-1.5 pr-4">
                                        {rl.cost_centers?.name ? (
                                          rl.cost_centers.name
                                        ) : rl.cost_center_erp_code ? (
                                          <span className="text-muted-foreground font-mono">
                                            {rl.cost_center_erp_code}
                                          </span>
                                        ) : (
                                          <span className="text-muted-foreground">—</span>
                                        )}
                                      </td>
                                      <td className="py-1.5 pr-4 text-right tabular-nums">
                                        {rl.centro_percentual != null
                                          ? `${rl.centro_percentual.toFixed(2)}%`
                                          : "—"}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums">
                                        {rl.centro_valor != null
                                          ? rl.centro_valor.toLocaleString("pt-BR", {
                                              style: "currency",
                                              currency: "BRL",
                                            })
                                          : "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
            {filtered.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="text-xs text-muted-foreground">
                    {filtered.length} registro(s)
                  </TableCell>
                  <TableCell className="text-right font-semibold">{fmt(somaValorDoc)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </CardContent>
      </Card>

      {/* Sync Dialog */}
      <Dialog open={syncOpen} onOpenChange={(v) => !syncing && setSyncOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sincronizar NF Entrada</DialogTitle>
            <DialogDescription>
              Período: {String(mes).padStart(2, "0")}/{ano}
            </DialogDescription>
          </DialogHeader>

          {!syncing && !syncResult && (
            <div className="py-4 text-sm text-muted-foreground">
              Clique em "Iniciar" para buscar as notas fiscais de entrada do ERP Alvo.
            </div>
          )}

          {syncing && (
            <div className="space-y-3 py-4">
              <Progress value={syncProgress} />
              <p className="text-xs text-muted-foreground truncate">{syncMessage}</p>
            </div>
          )}

          {syncResult && (
            <div className="space-y-2 py-4 text-sm">
              <p className="text-primary">✓ Inseridos: {syncResult.inserted}</p>
              <p className="text-accent-foreground">↻ Atualizados: {syncResult.updated}</p>
              {syncResult.errors > 0 && (
                <p className="text-destructive">✗ Erros: {syncResult.errors}</p>
              )}
              {syncResult.skipped > 0 && (
                <p className="text-muted-foreground">⊘ Ignorados: {syncResult.skipped}</p>
              )}
            </div>
          )}

          <DialogFooter>
            {!syncResult ? (
              <Button onClick={handleSync} disabled={syncing}>
                {syncing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                    Sincronizando...
                  </>
                ) : (
                  "Iniciar"
                )}
              </Button>
            ) : (
              <Button onClick={() => setSyncOpen(false)}>Fechar</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sync DocFin Dialog */}
      <Dialog open={syncDocFinOpen} onOpenChange={(v) => !syncingDocFin && setSyncDocFinOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sincronizar Despesas DocFin</DialogTitle>
            <DialogDescription>
              Período: {String(mes).padStart(2, "0")}/{ano} —
              despesas sem NF (boletos, guias, impostos, seguros, etc.)
            </DialogDescription>
          </DialogHeader>

          {!syncingDocFin && !syncDocFinResult && (
            <div className="py-4 text-sm text-muted-foreground">
              Busca todos os lançamentos de pagamento (Tipo PAG) do DocFin
              para o período selecionado, excluindo NF-e e NFS-e que já
              vêm via sincronização MOVESTQ.
            </div>
          )}

          {syncingDocFin && (
            <div className="space-y-3 py-4">
              <Progress value={syncDocFinProgress} />
              <p className="text-xs text-muted-foreground truncate">
                {syncDocFinMessage}
              </p>
            </div>
          )}

          {syncDocFinResult && (
            <div className="space-y-2 py-4 text-sm">
              <p className="text-primary">✓ Inseridos: {syncDocFinResult.inserted}</p>
              <p className="text-accent-foreground">↻ Atualizados: {syncDocFinResult.updated}</p>
              {syncDocFinResult.errors > 0 && (
                <p className="text-destructive">✗ Erros: {syncDocFinResult.errors}</p>
              )}
              {syncDocFinResult.skipped > 0 && (
                <p className="text-muted-foreground">⊘ Ignorados: {syncDocFinResult.skipped}</p>
              )}
            </div>
          )}

          <DialogFooter>
            {!syncDocFinResult ? (
              <Button onClick={handleSyncDocFin} disabled={syncingDocFin}>
                {syncingDocFin ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                    Sincronizando...
                  </>
                ) : (
                  "Iniciar"
                )}
              </Button>
            ) : (
              <Button onClick={() => setSyncDocFinOpen(false)}>Fechar</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enrich Dialog */}
      <Dialog open={enrichOpen} onOpenChange={(v) => !enriching && setEnrichOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enriquecer NF Entrada</DialogTitle>
            <DialogDescription>
              Período: {String(mes).padStart(2, "0")}/{ano} — busca Classe e Centro de Custo para {pendentesEnriquecimento} NFs pendentes
            </DialogDescription>
          </DialogHeader>

          {!enriching && !enrichResult && (
            <div className="py-4 text-sm text-muted-foreground">
              Clique em "Iniciar" para buscar a Classe Rec/Desp e o Centro de Custo de cada NF no ERP Alvo.
            </div>
          )}

          {enriching && (
            <div className="space-y-3 py-4">
              <Progress value={enrichProgress} />
              <p className="text-xs text-muted-foreground truncate">{enrichMessage}</p>
            </div>
          )}

          {enrichResult && (
            <div className="space-y-2 py-4 text-sm">
              <p className="text-primary">✓ Enriquecidas (completo): {enrichResult.enriched}</p>
              <p className="text-accent-foreground">◐ Parciais: {enrichResult.partial}</p>
              {enrichResult.skipped > 0 && (
                <p className="text-muted-foreground">⊘ Sem dados no ERP: {enrichResult.skipped}</p>
              )}
              {enrichResult.errors > 0 && (
                <p className="text-destructive">✗ Erros: {enrichResult.errors}</p>
              )}
            </div>
          )}

          <DialogFooter>
            {!enrichResult ? (
              <Button
                onClick={async () => {
                  setEnriching(true);
                  try {
                    const result = await enriquecerNfEntrada(ano, mes, ({ current, total, message }) => {
                      setEnrichMessage(message);
                      if (total > 0) setEnrichProgress(Math.round((current / total) * 100));
                    });
                    setEnrichResult(result);
                    toast({
                      title: "Enriquecimento concluído",
                      description: `${result.enriched} completos, ${result.partial} parciais, ${result.skipped} sem dados, ${result.errors} erros`,
                    });
                    fetchData();
                    setRateioMap(new Map());
                    setExpandedRows(new Set());
                  } catch (err: any) {
                    setEnrichMessage(`Erro: ${err.message}`);
                    toast({
                      title: "Erro no enriquecimento",
                      description: err.message,
                      variant: "destructive",
                    });
                  } finally {
                    setEnriching(false);
                  }
                }}
                disabled={enriching}
              >
                {enriching ? (
                  <>
                    <Sparkles className="h-4 w-4 mr-1 animate-spin" />
                    Enriquecendo...
                  </>
                ) : (
                  "Iniciar"
                )}
              </Button>
            ) : (
              <Button onClick={() => setEnrichOpen(false)}>Fechar</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Rateio Dialog */}
      <Dialog
        open={editDialogOpen}
        onOpenChange={(v) => !editSaving && setEditDialogOpen(v)}
      >
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Editar Rateio</DialogTitle>
            <DialogDescription>
              NF {editingNf?.especie} {editingNf?.numero} —{" "}
              {editingNf?.fornecedor_nome} —{" "}
              {fmt(editingNf?.valor_documento ?? null)}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto py-4">
            {editLoading ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Carregando rateio...
              </p>
            ) : (
              <>
                {/* Indicador de soma */}
                {(() => {
                  const soma = editRateioRows.reduce(
                    (acc, r) => acc + (r.classe_percentual ?? 0), 0
                  );
                  const ok = Math.abs(soma - 100) <= 0.01;
                  return (
                    <div className={`flex items-center justify-between mb-4 px-3 py-2 rounded-md text-sm font-medium ${
                      ok
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : "bg-red-50 text-red-700 border border-red-200"
                    }`}>
                      <span>Total do rateio</span>
                      <span className="tabular-nums">
                        {soma.toFixed(2)}% / 100%
                      </span>
                    </div>
                  );
                })()}

                {editRateioRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4 italic">
                    Nenhum rateio. Adicione uma linha abaixo.
                  </p>
                ) : (
                  <table className="w-full text-sm mb-4">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="text-left py-2 pr-2 font-medium w-36">Classe</th>
                        <th className="text-left py-2 pr-2 font-medium">Nome</th>
                        <th className="text-right py-2 pr-2 font-medium w-24">% Classe</th>
                        <th className="text-right py-2 pr-2 font-medium w-28">Valor (R$)</th>
                        <th className="text-left py-2 pr-2 font-medium">Centro de Custo</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {editRateioRows.map((rl, idx) => (
                        <tr key={rl.id} className="border-b border-muted/30">
                          <td className="py-1.5 pr-2">
                            <Select
                              value={rl.class_rec_desp_codigo || "__none__"}
                              onValueChange={(val) => {
                                const found = classesRecDesp.find(
                                  (c) => c.codigo === val
                                );
                                setEditRateioRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? {
                                      ...r,
                                      class_rec_desp_codigo:
                                        val === "__none__" ? "" : val,
                                      class_rec_desp_nome: found?.nome ?? "",
                                    } : r
                                  )
                                );
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs font-mono">
                                <SelectValue placeholder="Classe..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__" className="text-xs">
                                  — Nenhuma —
                                </SelectItem>
                                {classesRecDesp.map((c) => (
                                  <SelectItem key={c.codigo} value={c.codigo}
                                    className="text-xs">
                                    <span className="font-mono mr-2">{c.codigo}</span>
                                    {c.nome}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="py-1.5 pr-2 text-xs text-muted-foreground">
                            {rl.class_rec_desp_nome || "—"}
                          </td>
                          <td className="py-1.5 pr-2">
                            <Input
                              className="h-8 text-xs text-right w-20 ml-auto"
                              value={rl.classe_percentual ?? ""}
                              onChange={(e) => {
                                const pct = parseFloat(e.target.value) || 0;
                                const val = editingNf?.valor_documento
                                  ? (pct / 100) * editingNf.valor_documento
                                  : null;
                                setEditRateioRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? {
                                      ...r,
                                      classe_percentual: pct,
                                      classe_valor: val
                                        ? parseFloat(val.toFixed(2))
                                        : null,
                                    } : r
                                  )
                                );
                              }}
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <Input
                              className="h-8 text-xs text-right w-28 ml-auto"
                              value={rl.classe_valor ?? ""}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const pct = editingNf?.valor_documento
                                  ? (val / editingNf.valor_documento) * 100
                                  : null;
                                setEditRateioRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? {
                                      ...r,
                                      classe_valor: val,
                                      classe_percentual: pct
                                        ? parseFloat(pct.toFixed(4))
                                        : null,
                                    } : r
                                  )
                                );
                              }}
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <Select
                              value={rl.cost_center_id ?? "__none__"}
                              onValueChange={(val) => {
                                const cc = costCenters.find((c) => c.id === val);
                                setEditRateioRows((prev) =>
                                  prev.map((r, i) =>
                                    i === idx ? {
                                      ...r,
                                      cost_center_id:
                                        val === "__none__" ? null : val,
                                      cost_center_erp_code: cc?.erp_code ?? null,
                                    } : r
                                  )
                                );
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="CC..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__" className="text-xs">
                                  — Nenhum —
                                </SelectItem>
                                {costCenters.map((cc) => (
                                  <SelectItem key={cc.id} value={cc.id}
                                    className="text-xs">
                                    <span className="font-mono text-muted-foreground mr-2">
                                      {cc.erp_code}
                                    </span>
                                    {cc.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="py-1.5 text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() =>
                                setEditRateioRows((prev) =>
                                  prev.filter((_, i) => i !== idx)
                                )
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    setEditRateioRows((prev) => [
                      ...prev,
                      {
                        id: `new-${Date.now()}`,
                        isNew: true,
                        sequencia: null,
                        class_rec_desp_codigo: "",
                        class_rec_desp_nome: "",
                        classe_percentual: 0,
                        classe_valor: 0,
                        cost_center_id: null,
                        cost_center_erp_code: null,
                        centro_percentual: null,
                        centro_valor: null,
                      },
                    ])
                  }
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Adicionar linha
                </Button>
              </>
            )}
          </div>

          <DialogFooter>
            {(() => {
              const soma = editRateioRows.reduce(
                (acc, r) => acc + (r.classe_percentual ?? 0), 0
              );
              const ok = Math.abs(soma - 100) <= 0.01;
              return (
                <>
                  <Button variant="outline"
                    onClick={() => setEditDialogOpen(false)}
                    disabled={editSaving}>
                    Cancelar
                  </Button>
                  <Button onClick={saveRateioEdits}
                    disabled={editSaving || editLoading ||
                      editRateioRows.length === 0 || !ok}>
                    {editSaving ? "Salvando..." : "Salvar alterações"}
                  </Button>
                </>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Despesa Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar Despesa</DialogTitle>
            <DialogDescription>
              Lançamento manual — não sincronizado com o ERP.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-1">
              <label className="text-xs font-medium">Data de Movimento *</label>
              <Input type="date" value={addForm.data_movimento}
                onChange={(e) => setAddForm((p) => ({
                  ...p, data_movimento: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Fornecedor / Descrição *</label>
              <Input placeholder="Nome do fornecedor ou descrição"
                value={addForm.fornecedor_nome}
                onChange={(e) => setAddForm((p) => ({
                  ...p, fornecedor_nome: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Espécie</label>
              <Select value={addForm.especie}
                onValueChange={(v) => setAddForm((p) => ({ ...p, especie: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["NF-e","NFS-e","Boleto","Reembolso","Outros"].map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Valor *</label>
              <Input placeholder="0,00" value={addForm.valor_documento}
                onChange={(e) => setAddForm((p) => ({
                  ...p, valor_documento: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Observação</label>
              <Input placeholder="Opcional" value={addForm.observacao}
                onChange={(e) => setAddForm((p) => ({
                  ...p, observacao: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleAddDespesa} disabled={addSaving}>
              {addSaving ? "Salvando..." : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen}
        onOpenChange={(v) => !deleting && setDeleteConfirmOpen(v)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar exclusão</DialogTitle>
            <DialogDescription>
              Esta despesa manual será excluída permanentemente.
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete}
              disabled={deleting}>
              {deleting ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
