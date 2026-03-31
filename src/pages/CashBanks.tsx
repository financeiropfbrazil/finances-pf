import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/contexts/PeriodContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle2, XCircle, AlertTriangle, Plus, MoreHorizontal, Pencil, MessageSquare, Trash2, RefreshCw, Loader2, PlayCircle, Lock, Link2,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { fetchFaturasERP, clearAlvoToken, type FaturaERP } from "@/services/alvoService";
import ErpTransactionsTable from "@/components/ErpTransactionsTable";
import BankStatementTable from "@/components/BankStatementTable";
import ErpSyncErrorAlert from "@/components/ErpSyncErrorAlert";
import MonthYearPicker from "@/components/MonthYearPicker";
import ReconciliationHealthPanel from "@/components/ReconciliationHealthPanel";
import type { OfxTransaction } from "@/lib/ofxParser";

interface BankAccount {
  id: string;
  period_id: string;
  bank_name: string;
  account_type: string;
  account_number: string | null;
  accounting_account_code: string;
  bank_statement_balance: number;
  accounting_balance: number;
  difference: number;
  status: string;
  justification: string | null;
  responsible_user: string | null;
  updated_at: string;
}

const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const parseBRL = (str: string): number => {
  const cleaned = str.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

function StatusIcon({ status }: { status: string }) {
  if (status === "reconciled") return <CheckCircle2 className="h-5 w-5 text-success" />;
  if (status === "justified") return <AlertTriangle className="h-5 w-5 text-warning" />;
  return <XCircle className="h-5 w-5 text-danger" />;
}

export default function CashBanks() {
  const { selectedPeriod } = usePeriod();
  const { t } = useLanguage();
  const { session } = useAuth();
  const { toast } = useToast();

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [erpTransactions, setErpTransactions] = useState<FaturaERP[]>([]);
  const [syncError, setSyncError] = useState<{ code?: string; message: string; details?: string } | null>(null);
  const [erpMonth, setErpMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [erpLoading, setErpLoading] = useState(false);
  const [ofxTransactions, setOfxTransactions] = useState<OfxTransaction[]>([]);
  const [processedOfxIds, setProcessedOfxIds] = useState<Set<string>>(new Set());
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [monthClosed, setMonthClosed] = useState(false);
  const [closingMonth, setClosingMonth] = useState(false);
  const [selectedBank, setSelectedBank] = useState("0000016");
  const [selectedOfxId, setSelectedOfxId] = useState<string | null>(null);
  const [selectedErpId, setSelectedErpId] = useState<string | null>(null);
  const [manualMatches, setManualMatches] = useState<Map<string, string>>(new Map()); // ofxId → erpId
  const [manualMatchesReverse, setManualMatchesReverse] = useState<Map<string, string>>(new Map()); // erpId → ofxId

  // Derive period_id from erpMonth selector, auto-creating if needed
  const { periods, ensurePeriod } = usePeriod();
  const [activePeriodId, setActivePeriodId] = useState<string | null>(null);

  useEffect(() => {
    const [year, month] = erpMonth.split("-").map(Number);
    const existing = periods.find((p) => p.year === year && p.month === month);
    if (existing) {
      setActivePeriodId(existing.id);
    } else {
      ensurePeriod(year, month).then((id) => setActivePeriodId(id));
    }
  }, [erpMonth, periods, ensurePeriod]);

  // Load saved OFX transactions from DB
  const loadSavedOfx = useCallback(async (periodId: string, bankCode: string) => {
    const { data } = await supabase
      .from("bank_statement_transactions")
      .select("*")
      .eq("period_id", periodId)
      .eq("bank_code", bankCode)
      .order("transaction_date");
    if (data && data.length > 0) {
      const txs: OfxTransaction[] = data.map((row: any) => ({
        fitId: row.fit_id,
        date: row.transaction_date,
        amount: Number(row.amount),
        memo: row.memo || "",
      }));
      setOfxTransactions(txs);
      const processed = new Set<string>();
      data.forEach((row: any) => {
        if (row.status === "processed") processed.add(row.fit_id);
      });
      setProcessedOfxIds(processed);
    } else {
      setOfxTransactions([]);
      setProcessedOfxIds(new Set());
    }
  }, []);

  // Load saved ERP transactions from DB
  const loadSavedErp = useCallback(async (periodId: string, bankCode: string) => {
    const { data } = await supabase
      .from("erp_transactions")
      .select("*")
      .eq("period_id", periodId)
      .eq("bank_code", bankCode)
      .order("due_date");
    if (data && data.length > 0) {
      const txs: FaturaERP[] = data.map((row: any) => ({
        Id: row.erp_id,
        DataVencimento: row.due_date,
        ValorBruto: Number(row.amount),
        ObservacaoDocFin: row.description || "",
        CodigoNomeEntidade: row.entity_name || "",
        Tipo: row.transaction_type,
        Realizado: row.realized,
      }));
      setErpTransactions(txs);
    } else {
      setErpTransactions([]);
    }
  }, []);

  // Check if month is closed
  const checkMonthStatus = useCallback(async (periodId: string) => {
    const { data } = await supabase
      .from("reconciliation_summary")
      .select("status")
      .eq("period_id", periodId)
      .eq("module_name", "cash")
      .maybeSingle();
    setMonthClosed(data?.status === "closed");
  }, []);

  // Load saved data when period changes
  useEffect(() => {
    if (!activePeriodId) return;
    loadSavedOfx(activePeriodId, selectedBank);
    loadSavedErp(activePeriodId, selectedBank);
    checkMonthStatus(activePeriodId);
  }, [activePeriodId, selectedBank, loadSavedOfx, loadSavedErp, checkMonthStatus]);

  // Save OFX transactions to DB
  const saveOfxToDb = useCallback(async (txs: OfxTransaction[], periodId: string, bankCode: string) => {
    // Delete existing for this period+bank first
    await supabase.from("bank_statement_transactions").delete().eq("period_id", periodId).eq("bank_code", bankCode);
    if (txs.length === 0) return;
    const rows = txs.map((tx) => ({
      period_id: periodId,
      bank_code: bankCode,
      fit_id: tx.fitId,
      transaction_date: tx.date,
      amount: tx.amount,
      memo: tx.memo || null,
      status: "pending" as const,
    }));
    await supabase.from("bank_statement_transactions").insert(rows);
  }, []);

  // Save ERP transactions to DB
  const saveErpToDb = useCallback(async (txs: FaturaERP[], periodId: string, bankCode: string) => {
    await supabase.from("erp_transactions").delete().eq("period_id", periodId).eq("bank_code", bankCode);
    if (txs.length === 0) return;
    const rows = txs.map((tx) => {
      const descPart = tx.ObservacaoDocFin || "";
      const fullDesc = tx.Numero ? `${tx.Numero} - ${descPart}` : descPart;
      return {
        period_id: periodId,
        bank_code: bankCode,
        erp_id: tx.Id,
        due_date: tx.DataVencimento || new Date().toISOString().split("T")[0],
        amount: Math.abs(Number(tx.ValorBruto ?? 0)),
        description: fullDesc || null,
        entity_name: tx.CodigoNomeEntidade || null,
        transaction_type: tx.Tipo || "REC",
        realized: tx.Realizado || "Não",
      };
    });
    await supabase.from("erp_transactions").insert(rows);
  }, []);

  // Handle OFX import — auto-save
  const handleOfxImport = useCallback(async (txs: OfxTransaction[]) => {
    setOfxTransactions(txs);
    if (activePeriodId) {
      await saveOfxToDb(txs, activePeriodId, selectedBank);
      toast({ title: "💾 Extrato salvo", description: `${txs.length} lançamentos gravados para a conta selecionada.` });
    }
  }, [activePeriodId, selectedBank, saveOfxToDb, toast]);

  // Reconciliation: match OFX ↔ ERP by value + date (±3 days) + manual matches
  const { matchedOfxIds, matchedErpIds } = useMemo(() => {
    const ofxMatched = new Set<string>();
    const erpMatched = new Set<string>();

    // Include manual matches first
    manualMatches.forEach((erpId, ofxId) => {
      ofxMatched.add(ofxId);
      erpMatched.add(erpId);
    });

    if (ofxTransactions.length === 0 || erpTransactions.length === 0) return { matchedOfxIds: ofxMatched, matchedErpIds: erpMatched };

    const usedErp = new Set<string>(erpMatched);

    for (const ofx of ofxTransactions) {
      if (ofxMatched.has(ofx.fitId)) continue;
      const ofxDate = new Date(ofx.date);
      const ofxAmt = Math.abs(ofx.amount);

      for (const erp of erpTransactions) {
        if (usedErp.has(erp.Id)) continue;
        const erpAmt = Math.abs(Number(erp.ValorBruto ?? 0));
        if (Math.abs(ofxAmt - erpAmt) > 0.01) continue;

        const erpDate = erp.DataVencimento ? new Date(erp.DataVencimento) : null;
        if (!erpDate) continue;
        const diffDays = Math.abs((ofxDate.getTime() - erpDate.getTime()) / 86400000);
        if (diffDays <= 3) {
          ofxMatched.add(ofx.fitId);
          erpMatched.add(erp.Id);
          usedErp.add(erp.Id);
          break;
        }
      }
    }
    return { matchedOfxIds: ofxMatched, matchedErpIds: erpMatched };
  }, [ofxTransactions, erpTransactions, manualMatches]);

  // Manual match handler
  const handleManualMatch = useCallback(() => {
    if (!selectedOfxId || !selectedErpId) return;
    setManualMatches(prev => {
      const next = new Map(prev);
      next.set(selectedOfxId, selectedErpId);
      return next;
    });
    setManualMatchesReverse(prev => {
      const next = new Map(prev);
      next.set(selectedErpId, selectedOfxId);
      return next;
    });
    setSelectedOfxId(null);
    setSelectedErpId(null);
    toast({ title: "🔗 Match manual criado", description: "Os lançamentos foram vinculados manualmente." });
  }, [selectedOfxId, selectedErpId, toast]);

  // Unmatch handler
  const handleUnmatchOfx = useCallback((fitId: string) => {
    setManualMatches(prev => {
      const next = new Map(prev);
      const erpId = next.get(fitId);
      next.delete(fitId);
      if (erpId) {
        setManualMatchesReverse(p => { const n = new Map(p); n.delete(erpId); return n; });
      }
      return next;
    });
    toast({ title: "🔓 Match desfeito" });
  }, [toast]);

  const handleUnmatchErp = useCallback((erpId: string) => {
    setManualMatchesReverse(prev => {
      const next = new Map(prev);
      const ofxId = next.get(erpId);
      next.delete(erpId);
      if (ofxId) {
        setManualMatches(p => { const n = new Map(p); n.delete(ofxId); return n; });
      }
      return next;
    });
    toast({ title: "🔓 Match desfeito" });
  }, [toast]);

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatement, setEditStatement] = useState("");
  const [editAccounting, setEditAccounting] = useState("");

  // Justification dialog
  const [justifyId, setJustifyId] = useState<string | null>(null);
  const [justifyText, setJustifyText] = useState("");

  // Add account dialog
  const [showAdd, setShowAdd] = useState(false);
  const [newBankName, setNewBankName] = useState("");
  const [newAccountType, setNewAccountType] = useState("corrente");
  const [newAccountNumber, setNewAccountNumber] = useState("");
  const [newAccountCode, setNewAccountCode] = useState("");

  const fetchAccounts = useCallback(async () => {
    if (!selectedPeriod) return;
    setLoading(true);
    const { data } = await supabase
      .from("bank_accounts")
      .select("*")
      .eq("period_id", selectedPeriod.id)
      .order("bank_name");
    if (data) setAccounts(data as unknown as BankAccount[]);
    setLoading(false);
  }, [selectedPeriod]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const totalStatement = accounts.reduce((s, a) => s + Number(a.bank_statement_balance), 0);
  const totalAccounting = accounts.reduce((s, a) => s + Number(a.accounting_balance), 0);
  const totalDiff = totalStatement - totalAccounting;
  const allReconciled = accounts.length > 0 && accounts.every((a) => a.status === "reconciled");
  const overallStatus = allReconciled ? "reconciled" : accounts.some((a) => a.status === "divergent") ? "divergent" : "justified";

  // Inline edit helpers
  const startEdit = (acc: BankAccount) => {
    setEditingId(acc.id);
    setEditStatement(Number(acc.bank_statement_balance).toFixed(2).replace(".", ","));
    setEditAccounting(Number(acc.accounting_balance).toFixed(2).replace(".", ","));
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const stmtVal = parseBRL(editStatement);
    const acctVal = parseBRL(editAccounting);
    const diff = stmtVal - acctVal;
    const acc = accounts.find((a) => a.id === editingId);
    let newStatus: string;
    if (diff === 0) newStatus = "reconciled";
    else if (acc?.justification) newStatus = "justified";
    else newStatus = "divergent";

    await supabase.from("bank_accounts").update({
      bank_statement_balance: stmtVal,
      accounting_balance: acctVal,
      status: newStatus,
      responsible_user: session?.user?.id,
    }).eq("id", editingId);

    setEditingId(null);
    toast({ title: t("cash.saved") });
    fetchAccounts();
  };

  const saveJustification = async () => {
    if (!justifyId) return;
    const acc = accounts.find((a) => a.id === justifyId);
    const newStatus = Number(acc?.difference) === 0 ? "reconciled" : justifyText.trim() ? "justified" : "divergent";
    await supabase.from("bank_accounts").update({
      justification: justifyText.trim() || null,
      status: newStatus,
      responsible_user: session?.user?.id,
    }).eq("id", justifyId);
    setJustifyId(null);
    setJustifyText("");
    toast({ title: t("cash.saved") });
    fetchAccounts();
  };

  const addAccount = async () => {
    if (!selectedPeriod || !newBankName.trim()) return;
    await supabase.from("bank_accounts").insert({
      period_id: selectedPeriod.id,
      bank_name: newBankName.trim(),
      account_type: newAccountType,
      account_number: newAccountNumber.trim() || null,
      accounting_account_code: newAccountCode.trim(),
      responsible_user: session?.user?.id,
    });
    setShowAdd(false);
    setNewBankName("");
    setNewAccountType("corrente");
    setNewAccountNumber("");
    setNewAccountCode("");
    toast({ title: t("cash.saved") });
    fetchAccounts();
  };

  const deleteAccount = async (id: string) => {
    await supabase.from("bank_accounts").delete().eq("id", id);
    toast({ title: t("cash.deleted") });
    fetchAccounts();
  };

  const handleSyncERP = async () => {
    setSyncing(true);
    setErpLoading(true);
    setSyncError(null);
    try {
      const [year, month] = erpMonth.split("-").map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      const dataIni = `${year}-${String(month).padStart(2, "0")}-01`;
      const dataFim = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
      console.log(`📤 Sincronizando faturas ERP: ${dataIni} → ${dataFim}`);

      const result = await fetchFaturasERP(dataIni, dataFim, selectedBank);
      if (result.success) {
        const items = Array.isArray(result.data) ? result.data : [];
        setErpTransactions(items);
        // Auto-save to DB
        if (activePeriodId) {
          await saveErpToDb(items, activePeriodId, selectedBank);
        }
        if (items.length === 0) {
          toast({ title: "⚠️ Nenhum lançamento encontrado", description: `O ERP não retornou dados para ${String(month).padStart(2, "0")}/${year}.` });
        } else {
          toast({ title: "✅ Dados do ERP sincronizados e salvos!", description: `${items.length} faturas carregadas e gravadas.` });
        }
      } else {
        setSyncError({ code: result.error_code, message: result.error || "Erro desconhecido", details: result.details });
        toast({ title: "❌ Erro ao sincronizar ERP", description: result.error, variant: "destructive" });
      }
    } catch (err: any) {
      setSyncError({ code: "NETWORK_ERROR", message: err.message });
      toast({ title: "❌ Erro inesperado", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
      setErpLoading(false);
    }
  };

  const handleClearToken = () => {
    clearAlvoToken();
    toast({ title: "🔑 Token limpo", description: "O próximo sync irá re-autenticar com o ERP." });
  };

  // Clear all records for selected period + bank
  const [clearing, setClearing] = useState(false);
  const handleClearRecords = async () => {
    if (!activePeriodId) return;
    const confirm = window.confirm(
      `Deseja realmente limpar todos os registros (OFX e ERP) do mês selecionado para esta conta bancária?\n\nEssa ação não pode ser desfeita.`
    );
    if (!confirm) return;
    setClearing(true);
    try {
      await supabase.from("bank_statement_transactions").delete().eq("period_id", activePeriodId).eq("bank_code", selectedBank);
      await supabase.from("erp_transactions").delete().eq("period_id", activePeriodId).eq("bank_code", selectedBank);
      setOfxTransactions([]);
      setErpTransactions([]);
      setProcessedOfxIds(new Set());
      setManualMatches(new Map());
      setManualMatchesReverse(new Map());
      toast({ title: "🗑️ Registros limpos", description: "Todos os lançamentos OFX e ERP do período foram removidos." });
    } catch (err: any) {
      toast({ title: "❌ Erro ao limpar registros", description: err.message, variant: "destructive" });
    } finally {
      setClearing(false);
    }
  };

  // Build matched pairs for batch processing
  const matchedPairs = useMemo(() => {
    const pairs: { ofxId: string; erpId: string; dataBanco: string }[] = [];
    if (ofxTransactions.length === 0 || erpTransactions.length === 0) return pairs;
    const usedErp = new Set<string>();
    for (const ofx of ofxTransactions) {
      if (processedOfxIds.has(ofx.fitId)) continue;
      const ofxDate = new Date(ofx.date);
      const ofxAmt = Math.abs(ofx.amount);
      for (const erp of erpTransactions) {
        if (usedErp.has(erp.Id)) continue;
        const erpAmt = Math.abs(Number(erp.ValorBruto ?? 0));
        if (Math.abs(ofxAmt - erpAmt) > 0.01) continue;
        const erpDate = erp.DataVencimento ? new Date(erp.DataVencimento) : null;
        if (!erpDate) continue;
        const diffDays = Math.abs((ofxDate.getTime() - erpDate.getTime()) / 86400000);
        if (diffDays <= 3) {
          pairs.push({ ofxId: ofx.fitId, erpId: erp.Id, dataBanco: ofx.date });
          usedErp.add(erp.Id);
          break;
        }
      }
    }
    return pairs;
  }, [ofxTransactions, erpTransactions, processedOfxIds]);

  const handleProcessReconciliation = async () => {
    if (matchedPairs.length === 0) return;
    setProcessing(true);
    setProcessProgress(0);
    const newProcessed = new Set(processedOfxIds);
    let count = 0;

    for (let i = 0; i < matchedPairs.length; i++) {
      const pair = matchedPairs[i];
      newProcessed.add(pair.ofxId);
      count++;
      // Save match to DB (local only — no ERP call)
      if (activePeriodId) {
        await supabase
          .from("bank_statement_transactions")
          .update({ status: "processed", matched_erp_id: pair.erpId })
          .eq("period_id", activePeriodId)
          .eq("bank_code", selectedBank)
          .eq("fit_id", pair.ofxId);
        await supabase
          .from("erp_transactions")
          .update({ matched_ofx_fit_id: pair.ofxId })
          .eq("period_id", activePeriodId)
          .eq("bank_code", selectedBank)
          .eq("erp_id", pair.erpId);
      }
      setProcessProgress(Math.round(((i + 1) / matchedPairs.length) * 100));
    }

    setProcessedOfxIds(newProcessed);
    setProcessing(false);
    toast({
      title: `✅ Conciliação detectada!`,
      description: `${count} lançamento${count > 1 ? "s" : ""} do extrato conciliado${count > 1 ? "s" : ""} com o ERP (apenas detecção, sem envio ao sistema).`,
    });
  };

  // Close month handler
  const handleCloseMonth = async () => {
    if (!activePeriodId) return;
    setClosingMonth(true);
    try {
      // Update reconciliation_summary for cash module
      const { data: existing } = await supabase
        .from("reconciliation_summary")
        .select("id")
        .eq("period_id", activePeriodId)
        .eq("module_name", "cash")
        .maybeSingle();

      if (existing) {
        await supabase
          .from("reconciliation_summary")
          .update({
            status: "closed",
            closed_at: new Date().toISOString(),
            closed_by: session?.user?.id,
          })
          .eq("id", existing.id);
      } else {
        // Calculate management balance from OFX totals
        const mgmtBalance = ofxTransactions.reduce((sum, tx) => sum + tx.amount, 0);
        await supabase.from("reconciliation_summary").insert({
          period_id: activePeriodId,
          module_name: "cash",
          accounting_account: "1.1.01",
          management_balance: mgmtBalance,
          status: "closed",
          closed_at: new Date().toISOString(),
          closed_by: session?.user?.id,
        });
      }

      setMonthClosed(true);
      toast({ title: "🔒 Mês fechado!", description: "Os dados de Caixa e Bancos foram travados para este período." });
    } catch (err: any) {
      toast({ title: "❌ Erro ao fechar mês", description: err.message, variant: "destructive" });
    } finally {
      setClosingMonth(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("cash.title")}</h1>
        <div className="flex items-center gap-2">
          {monthClosed && (
            <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
              <Lock className="h-3.5 w-3.5" /> Mês fechado
            </span>
          )}
          <MonthYearPicker value={erpMonth} onChange={setErpMonth} />
          <Select value={selectedBank} onValueChange={setSelectedBank}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Conta bancária" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0000016">Santander</SelectItem>
              <SelectItem value="0000017">Bradesco</SelectItem>
              <SelectItem value="0000018">Itaú</SelectItem>
              <SelectItem value="0000019">Banco do Brasil</SelectItem>
              <SelectItem value="0000020">Caixa Econômica</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleSyncERP} disabled={syncing || monthClosed} variant="default" size="sm" className="gap-2">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? "Sincronizando..." : "Sincronizar ERP"}
          </Button>
          <Button onClick={handleClearRecords} disabled={clearing || monthClosed || (ofxTransactions.length === 0 && erpTransactions.length === 0)} variant="destructive" size="sm" className="gap-2">
            {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {clearing ? "Limpando..." : "Limpar Registros"}
          </Button>
          <Button onClick={() => setShowAdd(true)} size="sm" variant="outline" className="gap-2">
            <Plus className="h-4 w-4" /> {t("cash.add_account")}
          </Button>
        </div>
      </div>

      {/* Summary card */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 p-5">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("cash.statement_balance")}</span>
            <span className="text-lg font-semibold text-foreground">{formatBRL(totalStatement)}</span>
          </div>
          <div className="h-10 w-px bg-border" />
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("dashboard.accounting_balance")}</span>
            <span className="text-lg font-semibold text-foreground">{formatBRL(totalAccounting)}</span>
          </div>
          <div className="h-10 w-px bg-border" />
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("dashboard.difference")}</span>
            <span className={`text-lg font-semibold ${totalDiff === 0 ? "text-success" : "text-danger"}`}>
              {formatBRL(totalDiff)}
            </span>
          </div>
          <div className="h-10 w-px bg-border" />
          <div className="flex flex-col items-center gap-1">
            <span className="text-xs text-muted-foreground">{t("cash.reconciliation_status")}</span>
            <StatusIcon status={overallStatus} />
          </div>
        </CardContent>
      </Card>

      {/* Accounts table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("cash.bank")}</TableHead>
                <TableHead>{t("cash.type")}</TableHead>
                <TableHead>{t("cash.accounting_code")}</TableHead>
                <TableHead className="text-right">{t("cash.statement_balance")}</TableHead>
                <TableHead className="text-right">{t("dashboard.accounting_balance")}</TableHead>
                <TableHead className="text-right">{t("dashboard.difference")}</TableHead>
                <TableHead className="text-center">{t("dashboard.status")}</TableHead>
                <TableHead className="text-center">{t("cash.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((acc) => {
                const isEditing = editingId === acc.id;
                const diff = Number(acc.difference);
                return (
                  <TableRow key={acc.id}>
                    <TableCell className="font-medium">{acc.bank_name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {t(("cash.type." + acc.account_type) as any)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{acc.accounting_account_code}</TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <Input
                          value={editStatement}
                          onChange={(e) => setEditStatement(e.target.value)}
                          className="h-8 w-32 text-right ml-auto"
                          onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                        />
                      ) : (
                        formatBRL(Number(acc.bank_statement_balance))
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <Input
                          value={editAccounting}
                          onChange={(e) => setEditAccounting(e.target.value)}
                          className="h-8 w-32 text-right ml-auto"
                          onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                        />
                      ) : (
                        formatBRL(Number(acc.accounting_balance))
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-semibold ${diff === 0 ? "text-success" : "text-danger"}`}>
                      {formatBRL(diff)}
                    </TableCell>
                    <TableCell className="text-center">
                      <StatusIcon status={acc.status} />
                    </TableCell>
                    <TableCell className="text-center">
                      {isEditing ? (
                        <div className="flex justify-center gap-1">
                          <Button size="sm" variant="ghost" onClick={saveEdit}>{t("cash.save")}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>{t("cash.cancel")}</Button>
                        </div>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => startEdit(acc)}>
                              <Pencil className="mr-2 h-4 w-4" /> {t("cash.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setJustifyId(acc.id); setJustifyText(acc.justification ?? ""); }}>
                              <MessageSquare className="mr-2 h-4 w-4" /> {t("cash.justify")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => deleteAccount(acc.id)} className="text-danger">
                              <Trash2 className="mr-2 h-4 w-4" /> {t("cash.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow className="font-semibold">
                <TableCell colSpan={3}>{t("cash.total")}</TableCell>
                <TableCell className="text-right">{formatBRL(totalStatement)}</TableCell>
                <TableCell className="text-right">{formatBRL(totalAccounting)}</TableCell>
                <TableCell className={`text-right ${totalDiff === 0 ? "text-success" : "text-danger"}`}>
                  {formatBRL(totalDiff)}
                </TableCell>
                <TableCell className="text-center"><StatusIcon status={overallStatus} /></TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      {/* ERP Sync Error */}
      {syncError && (
        <ErpSyncErrorAlert
          errorCode={syncError.code}
          errorMessage={syncError.message}
          details={syncError.details}
          onRetry={handleSyncERP}
          onClearToken={handleClearToken}
        />
      )}

      {/* Reconciliation Health Panel */}
      {(ofxTransactions.length > 0 || erpTransactions.length > 0) && (
        <ReconciliationHealthPanel
          ofxCount={ofxTransactions.length}
          erpCount={erpTransactions.length}
          matchedCount={matchedOfxIds.size - processedOfxIds.size}
          processedCount={processedOfxIds.size}
          pendingOfx={Math.max(0, ofxTransactions.length - matchedOfxIds.size - processedOfxIds.size)}
          pendingErp={Math.max(0, erpTransactions.length - matchedErpIds.size)}
        />
      )}

      {/* Manual match bar */}
      {selectedOfxId && selectedErpId && (
        <Card>
          <CardContent className="flex items-center justify-between p-3">
            <span className="text-sm text-muted-foreground">
              Vincular manualmente: <strong>OFX</strong> selecionado ↔ <strong>ERP</strong> selecionado
            </span>
            <Button onClick={handleManualMatch} size="sm" className="gap-2">
              <Link2 className="h-4 w-4" /> Conciliar Manualmente
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Side-by-side: Bank Statement (OFX) | ERP Transactions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="max-h-[600px] overflow-y-auto rounded-lg">
          <BankStatementTable
            transactions={ofxTransactions}
            onImport={handleOfxImport}
            matchedIds={matchedOfxIds}
            processedIds={processedOfxIds}
            disabled={monthClosed}
            selectedBank={selectedBank}
            selectedPeriod={erpMonth}
            selectedOfxId={selectedOfxId}
            onSelectOfx={setSelectedOfxId}
            onUnmatch={handleUnmatchOfx}
          />
        </div>
        <div className="max-h-[600px] overflow-y-auto rounded-lg">
          <ErpTransactionsTable
            transactions={erpTransactions}
            loading={erpLoading}
            matchedIds={matchedErpIds}
            selectedErpId={selectedErpId}
            onSelectErp={setSelectedErpId}
            onUnmatch={handleUnmatchErp}
          />
        </div>
      </div>

      {/* Action buttons */}
      {(ofxTransactions.length > 0 || erpTransactions.length > 0) && (
        <Card>
          <CardContent className="flex items-center justify-end gap-3 p-4">
            {processing && (
              <Progress value={processProgress} className="h-2 w-48" />
            )}
            {!monthClosed && matchedPairs.length > 0 && (
              <Button
                onClick={handleProcessReconciliation}
                disabled={matchedPairs.length === 0 || processing}
                className="gap-2"
              >
                {processing ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Processando... ({processProgress}%)</>
                ) : (
                  <><PlayCircle className="h-4 w-4" /> Processar Conciliações ({matchedPairs.length} itens)</>
                )}
              </Button>
            )}
            {!monthClosed && (
              <Button
                onClick={handleCloseMonth}
                disabled={closingMonth}
                variant="outline"
                className="gap-2 border-success text-success hover:bg-success/10"
              >
                {closingMonth ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Fechando...</>
                ) : (
                  <><Lock className="h-4 w-4" /> Fechar Mês</>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Justification Dialog */}
      <Dialog open={!!justifyId} onOpenChange={(open) => { if (!open) setJustifyId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cash.justification")}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={justifyText}
            onChange={(e) => setJustifyText(e.target.value)}
            rows={4}
            placeholder={t("cash.justification")}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setJustifyId(null)}>{t("cash.cancel")}</Button>
            <Button onClick={saveJustification}>{t("cash.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Account Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cash.add_account")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">{t("cash.bank_name")}</label>
              <Input value={newBankName} onChange={(e) => setNewBankName(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">{t("cash.type")}</label>
              <Select value={newAccountType} onValueChange={setNewAccountType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="corrente">{t("cash.type.corrente")}</SelectItem>
                  <SelectItem value="aplicacao">{t("cash.type.aplicacao")}</SelectItem>
                  <SelectItem value="poupanca">{t("cash.type.poupanca")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">{t("cash.account_number")}</label>
              <Input value={newAccountNumber} onChange={(e) => setNewAccountNumber(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">{t("cash.accounting_code")}</label>
              <Input value={newAccountCode} onChange={(e) => setNewAccountCode(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>{t("cash.cancel")}</Button>
            <Button onClick={addAccount} disabled={!newBankName.trim()}>{t("cash.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
