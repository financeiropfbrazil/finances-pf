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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
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
  CheckCircle2, XCircle, AlertTriangle, Plus, MoreHorizontal, Pencil, Trash2, Clock, Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Receivable {
  id: string;
  period_id: string;
  customer_name: string;
  document_number: string;
  issue_date: string;
  due_date: string;
  currency: string;
  original_amount: number;
  exchange_rate: number;
  amount_brl: number;
  market: string;
  status: string;
  receipt_date: string | null;
  receipt_amount: number;
  remaining_balance: number;
  notes: string | null;
}

interface ReconciliationRow {
  module_name: string;
  accounting_account: string;
  management_balance: number;
  accounting_balance: number;
  difference: number;
  status: string;
}

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

function StatusIcon({ status }: { status: string }) {
  if (status === "reconciled") return <CheckCircle2 className="h-5 w-5 text-success" />;
  if (status === "justified") return <AlertTriangle className="h-5 w-5 text-warning" />;
  return <XCircle className="h-5 w-5 text-danger" />;
}

function getAgingBucket(dueDate: string): string {
  const now = new Date();
  const due = new Date(dueDate);
  const diffDays = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "not_due";
  if (diffDays <= 30) return "1_30";
  if (diffDays <= 60) return "31_60";
  if (diffDays <= 90) return "61_90";
  return "over_90";
}

const AGING_BUCKETS = ["not_due", "1_30", "31_60", "61_90", "over_90"] as const;
const AGING_COLORS: Record<string, string> = {
  not_due: "bg-success/20 text-success border-success/30",
  "1_30": "bg-primary/20 text-primary border-primary/30",
  "31_60": "bg-warning/20 text-warning border-warning/30",
  "61_90": "bg-danger/20 text-danger border-danger/30",
  over_90: "bg-danger/30 text-danger border-danger/40",
};

const EMPTY_FORM = {
  customer_name: "", document_number: "", issue_date: "", due_date: "",
  currency: "BRL", original_amount: "", exchange_rate: "1", market: "interno",
  status: "em_aberto", receipt_date: "", receipt_amount: "0", notes: "",
};

export default function Receivables() {
  const { selectedPeriod } = usePeriod();
  const { t } = useLanguage();
  const { session } = useAuth();
  const { toast } = useToast();

  const [rows, setRows] = useState<Receivable[]>([]);
  const [recon, setRecon] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterMarket, setFilterMarket] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterAging, setFilterAging] = useState("all");
  const [filterCustomer, setFilterCustomer] = useState("");

  // Dialog
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchData = useCallback(async () => {
    if (!selectedPeriod) return;
    setLoading(true);
    const [{ data: recvData }, { data: reconData }] = await Promise.all([
      supabase.from("receivables").select("*").eq("period_id", selectedPeriod.id).order("due_date"),
      supabase.from("reconciliation_summary").select("*").eq("period_id", selectedPeriod.id)
        .in("module_name", ["receivables_interno", "receivables_externo"]),
    ]);
    if (recvData) setRows(recvData as unknown as Receivable[]);
    if (reconData) setRecon(reconData as unknown as ReconciliationRow[]);
    setLoading(false);
  }, [selectedPeriod]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filtered rows
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (r.status === "recebido") return false; // exclude fully received from active view unless filtered
      if (filterMarket !== "all" && r.market !== filterMarket) return false;
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (filterAging !== "all" && getAgingBucket(r.due_date) !== filterAging) return false;
      if (filterCustomer && !r.customer_name.toLowerCase().includes(filterCustomer.toLowerCase())) return false;
      return true;
    });
  }, [rows, filterMarket, filterStatus, filterAging, filterCustomer]);

  // Aging totals (only non-received)
  const agingTotals = useMemo(() => {
    const totals: Record<string, number> = { not_due: 0, "1_30": 0, "31_60": 0, "61_90": 0, over_90: 0 };
    rows.filter((r) => r.status !== "recebido").forEach((r) => {
      totals[getAgingBucket(r.due_date)] += Number(r.remaining_balance);
    });
    return totals;
  }, [rows]);

  // Reconciliation helpers
  const reconInterno = recon.find((r) => r.module_name === "receivables_interno");
  const reconExterno = recon.find((r) => r.module_name === "receivables_externo");
  const totalMgmt = Number(reconInterno?.management_balance ?? 0) + Number(reconExterno?.management_balance ?? 0);
  const totalAcct = Number(reconInterno?.accounting_balance ?? 0) + Number(reconExterno?.accounting_balance ?? 0);
  const totalDiff = totalMgmt - totalAcct;

  // Form handlers
  const openAdd = () => { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit = (r: Receivable) => {
    setEditId(r.id);
    setForm({
      customer_name: r.customer_name,
      document_number: r.document_number,
      issue_date: r.issue_date,
      due_date: r.due_date,
      currency: r.currency,
      original_amount: String(r.original_amount),
      exchange_rate: String(r.exchange_rate),
      market: r.market,
      status: r.status,
      receipt_date: r.receipt_date ?? "",
      receipt_amount: String(r.receipt_amount),
      notes: r.notes ?? "",
    });
    setShowForm(true);
  };

  const computedBRL = (parseFloat(form.original_amount) || 0) * (parseFloat(form.exchange_rate) || 1);

  const saveForm = async () => {
    if (!selectedPeriod) return;
    const payload = {
      period_id: selectedPeriod.id,
      customer_name: form.customer_name.trim(),
      document_number: form.document_number.trim(),
      issue_date: form.issue_date,
      due_date: form.due_date,
      currency: form.currency,
      original_amount: parseFloat(form.original_amount) || 0,
      exchange_rate: form.currency === "BRL" ? 1 : (parseFloat(form.exchange_rate) || 1),
      market: form.market,
      status: form.status,
      receipt_date: form.receipt_date || null,
      receipt_amount: parseFloat(form.receipt_amount) || 0,
      notes: form.notes.trim() || null,
      responsible_user: session?.user?.id,
    };

    if (editId) {
      await supabase.from("receivables").update(payload).eq("id", editId);
    } else {
      await supabase.from("receivables").insert(payload);
    }
    setShowForm(false);
    toast({ title: t("cash.saved") });
    fetchData();
  };

  const deleteRow = async (id: string) => {
    await supabase.from("receivables").delete().eq("id", id);
    toast({ title: t("cash.deleted") });
    fetchData();
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
        <h1 className="text-2xl font-bold text-foreground">{t("recv.title")}</h1>
        <Button onClick={openAdd} size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> {t("recv.add_title")}
        </Button>
      </div>

      {/* Reconciliation cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: t("recv.domestic"), account: "1.1.02.001", data: reconInterno },
          { label: t("recv.foreign"), account: "1.1.02.008", data: reconExterno },
          { label: t("recv.total"), account: "1.1.02", data: null },
        ].map((card, i) => {
          const mgmt = card.data ? Number(card.data.management_balance) : totalMgmt;
          const acct = card.data ? Number(card.data.accounting_balance) : totalAcct;
          const diff = card.data ? Number(card.data.difference) : totalDiff;
          const st = card.data ? card.data.status : (totalDiff === 0 ? "reconciled" : "divergent");
          return (
            <Card key={i}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-foreground">{card.label}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{card.account}</span>
                  </div>
                  <StatusIcon status={st} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">{t("dashboard.management_balance")}</span>
                  <span className="text-right font-medium text-foreground">{formatBRL(mgmt)}</span>
                  <span className="text-muted-foreground">{t("dashboard.accounting_balance")}</span>
                  <span className="text-right font-medium text-foreground">{formatBRL(acct)}</span>
                  <span className="text-muted-foreground">{t("dashboard.difference")}</span>
                  <span className={`text-right font-semibold ${diff === 0 ? "text-success" : "text-danger"}`}>
                    {formatBRL(diff)}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Aging cards */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4" /> {t("recv.aging")}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {AGING_BUCKETS.map((bucket) => (
            <button
              key={bucket}
              onClick={() => setFilterAging(filterAging === bucket ? "all" : bucket)}
              className={`rounded-lg border p-4 text-center transition-all ${AGING_COLORS[bucket]} ${filterAging === bucket ? "ring-2 ring-ring" : ""}`}
            >
              <div className="text-xs font-medium mb-1">{t(("recv." + bucket) as any)}</div>
              <div className="text-lg font-bold">{formatBRL(agingTotals[bucket])}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-muted/30 border-none shadow-none">
        <CardContent className="p-3 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-muted-foreground mr-2">
            <Search className="h-4 w-4" />
            <span className="text-sm font-medium">Filtros</span>
          </div>

          <div className="relative flex-1 min-w-[240px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60" />
            <Input
              placeholder={t("recv.customer")}
              className="pl-9 bg-background border-muted-foreground/20 focus-visible:ring-primary/30"
              value={filterCustomer}
              onChange={(e) => setFilterCustomer(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Select value={filterMarket} onValueChange={setFilterMarket}>
              <SelectTrigger className="w-[160px] bg-background border-muted-foreground/20">
                <SelectValue placeholder={t("recv.market")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("recv.filter_all")}</SelectItem>
                <SelectItem value="interno">{t("recv.domestic")}</SelectItem>
                <SelectItem value="externo">{t("recv.foreign")}</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[160px] bg-background border-muted-foreground/20">
                <SelectValue placeholder={t("dashboard.status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("recv.filter_all")}</SelectItem>
                <SelectItem value="em_aberto">{t("recv.status.em_aberto")}</SelectItem>
                <SelectItem value="vencido">{t("recv.status.vencido")}</SelectItem>
                <SelectItem value="parcial">{t("recv.status.parcial")}</SelectItem>
                <SelectItem value="recebido">{t("recv.status.recebido")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("recv.customer")}</TableHead>
                <TableHead>{t("recv.document")}</TableHead>
                <TableHead>{t("recv.issue_date")}</TableHead>
                <TableHead>{t("recv.due_date")}</TableHead>
                <TableHead>{t("recv.currency")}</TableHead>
                <TableHead className="text-right">{t("recv.original_amount")}</TableHead>
                <TableHead className="text-right">{t("recv.exchange_rate")}</TableHead>
                <TableHead className="text-right">{t("recv.amount_brl")}</TableHead>
                <TableHead>{t("recv.market")}</TableHead>
                <TableHead>{t("dashboard.status")}</TableHead>
                <TableHead className="text-right">{t("recv.remaining")}</TableHead>
                <TableHead className="text-center">{t("cash.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                    {t("recv.add_title")}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.customer_name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.document_number}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(r.issue_date)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(r.due_date)}</TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell className="text-right">{formatBRL(Number(r.original_amount))}</TableCell>
                    <TableCell className="text-right">{r.currency !== "BRL" ? Number(r.exchange_rate).toFixed(4) : "—"}</TableCell>
                    <TableCell className="text-right">{formatBRL(Number(r.amount_brl))}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${r.market === "interno" ? "bg-primary/20 text-primary" : "bg-accent/20 text-accent-foreground"}`}>
                        {t(r.market === "interno" ? "recv.domestic" : "recv.foreign")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                        r.status === "recebido" ? "bg-success/20 text-success"
                        : r.status === "vencido" ? "bg-danger/20 text-danger"
                        : r.status === "parcial" ? "bg-warning/20 text-warning"
                        : "bg-primary/20 text-primary"
                      }`}>
                        {t(("recv.status." + r.status) as any)}
                      </span>
                    </TableCell>
                    <TableCell className={`text-right font-semibold ${Number(r.remaining_balance) === 0 ? "text-success" : "text-foreground"}`}>
                      {formatBRL(Number(r.remaining_balance))}
                    </TableCell>
                    <TableCell className="text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(r)}>
                            <Pencil className="mr-2 h-4 w-4" /> {t("cash.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => deleteRow(r.id)} className="text-danger">
                            <Trash2 className="mr-2 h-4 w-4" /> {t("cash.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? t("cash.edit") : t("recv.add_title")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">{t("recv.customer")}</label>
                <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{t("recv.document")}</label>
                <Input value={form.document_number} onChange={(e) => setForm({ ...form, document_number: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">{t("recv.issue_date")}</label>
                <Input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{t("recv.due_date")}</label>
                <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">{t("recv.currency")}</label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v, exchange_rate: v === "BRL" ? "1" : form.exchange_rate })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BRL">BRL</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{t("recv.original_amount")}</label>
                <Input type="number" step="0.01" value={form.original_amount} onChange={(e) => setForm({ ...form, original_amount: e.target.value })} />
              </div>
              {form.currency !== "BRL" && (
                <div>
                  <label className="text-sm text-muted-foreground">{t("recv.exchange_rate")}</label>
                  <Input type="number" step="0.0001" value={form.exchange_rate} onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })} />
                </div>
              )}
            </div>
            {/* Computed BRL value */}
            <div className="rounded-md bg-muted p-3 text-sm">
              <span className="text-muted-foreground">{t("recv.amount_brl")}: </span>
              <span className="font-semibold text-foreground">{formatBRL(computedBRL)}</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-muted-foreground">{t("recv.market")}</label>
                <Select value={form.market} onValueChange={(v) => setForm({ ...form, market: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interno">{t("recv.domestic")}</SelectItem>
                    <SelectItem value="externo">{t("recv.foreign")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{t("dashboard.status")}</label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="em_aberto">{t("recv.status.em_aberto")}</SelectItem>
                    <SelectItem value="vencido">{t("recv.status.vencido")}</SelectItem>
                    <SelectItem value="parcial">{t("recv.status.parcial")}</SelectItem>
                    <SelectItem value="recebido">{t("recv.status.recebido")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(form.status === "parcial" || form.status === "recebido") && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">{t("recv.receipt_date")}</label>
                  <Input type="date" value={form.receipt_date} onChange={(e) => setForm({ ...form, receipt_date: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">{t("recv.receipt_amount")}</label>
                  <Input type="number" step="0.01" value={form.receipt_amount} onChange={(e) => setForm({ ...form, receipt_amount: e.target.value })} />
                </div>
              </div>
            )}
            <div>
              <label className="text-sm text-muted-foreground">{t("recv.notes")}</label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowForm(false)}>{t("cash.cancel")}</Button>
            <Button onClick={saveForm} disabled={!form.customer_name.trim() || !form.document_number.trim() || !form.issue_date || !form.due_date}>
              {t("cash.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
