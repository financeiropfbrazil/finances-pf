import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/contexts/PeriodContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
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
  CheckCircle2, XCircle, AlertTriangle, Plus, ArrowLeft,
  Calendar, FileText, AlertCircle, Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Types
interface Plan {
  id: string;
  period_id: string;
  tax_type: string;
  program_name: string;
  process_number: string | null;
  original_debt: number;
  penalty_amount: number;
  interest_amount: number;
  total_consolidated: number;
  total_installments: number;
  paid_installments: number;
  current_installment_amount: number;
  outstanding_balance_total: number;
  outstanding_balance_short_term: number;
  outstanding_balance_long_term: number;
  start_date: string;
  next_due_date: string | null;
  update_index: string;
  status: string;
  notes: string | null;
}

interface Payment {
  id: string;
  plan_id: string;
  installment_number: number;
  due_date: string;
  principal_amount: number;
  interest_amount: number;
  penalty_amount: number;
  total_amount: number;
  status: string;
  payment_date: string | null;
  amount_paid: number;
  darf_number: string | null;
  notes: string | null;
}

interface ReconRow {
  module_name: string;
  management_balance: number;
  accounting_balance: number;
  status: string;
}

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatDate = (d: string) => {
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const TAX_TYPES = ["IRPJ", "CSLL", "PIS", "COFINS", "ISS", "ICMS", "FGTS", "INSS", "outros"];
const STATUS_OPTIONS = ["ativo", "quitado", "suspenso", "cancelado"];
const PAYMENT_STATUS = ["a_vencer", "pago", "vencido"];
const INDEX_OPTIONS = ["SELIC", "IPCA", "TJLP", "outro"];

function StatusIcon({ status }: { status: string }) {
  if (status === "reconciled") return <CheckCircle2 className="h-5 w-5 text-success" />;
  if (status === "justified") return <AlertTriangle className="h-5 w-5 text-warning" />;
  return <XCircle className="h-5 w-5 text-danger" />;
}

const EMPTY_PLAN = {
  tax_type: "IRPJ", program_name: "", process_number: "",
  original_debt: "", penalty_amount: "", interest_amount: "",
  total_installments: "1", paid_installments: "0",
  current_installment_amount: "", outstanding_balance_total: "",
  outstanding_balance_short_term: "", outstanding_balance_long_term: "",
  start_date: "", next_due_date: "", update_index: "SELIC",
  status: "ativo", notes: "",
};

const EMPTY_PAYMENT = {
  installment_number: "1", due_date: "",
  principal_amount: "", interest_amount: "", penalty_amount: "",
  status: "a_vencer", payment_date: "", amount_paid: "0",
  darf_number: "", notes: "",
};

export default function Taxes() {
  const { selectedPeriod } = usePeriod();
  const { t } = useLanguage();
  const { session } = useAuth();
  const { toast } = useToast();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [reconCP, setReconCP] = useState<ReconRow | null>(null);
  const [reconLP, setReconLP] = useState<ReconRow | null>(null);
  const [loading, setLoading] = useState(true);

  // Detail view
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);

  // Forms
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [editPlanId, setEditPlanId] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState(EMPTY_PLAN);

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [editPaymentId, setEditPaymentId] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT);

  const fetchData = useCallback(async () => {
    if (!selectedPeriod) return;
    setLoading(true);
    const [{ data: planData }, { data: reconData }] = await Promise.all([
      supabase.from("tax_installments_plan").select("*").eq("period_id", selectedPeriod.id).order("tax_type"),
      supabase.from("reconciliation_summary").select("*").eq("period_id", selectedPeriod.id).in("module_name", ["taxes_cp", "taxes_lp"]),
    ]);
    if (planData) setPlans(planData as unknown as Plan[]);
    if (reconData) {
      setReconCP((reconData as unknown as ReconRow[]).find(r => r.module_name === "taxes_cp") ?? null);
      setReconLP((reconData as unknown as ReconRow[]).find(r => r.module_name === "taxes_lp") ?? null);
    }
    setLoading(false);
  }, [selectedPeriod]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchPayments = useCallback(async (planId: string) => {
    setLoadingPayments(true);
    const { data } = await supabase
      .from("tax_installment_payments")
      .select("*")
      .eq("plan_id", planId)
      .order("installment_number");
    if (data) setPayments(data as unknown as Payment[]);
    setLoadingPayments(false);
  }, []);

  const openPlanDetail = (plan: Plan) => {
    setSelectedPlan(plan);
    fetchPayments(plan.id);
  };

  // Plan form
  const openAddPlan = () => { setEditPlanId(null); setPlanForm(EMPTY_PLAN); setShowPlanForm(true); };
  const openEditPlan = (p: Plan) => {
    setEditPlanId(p.id);
    setPlanForm({
      tax_type: p.tax_type, program_name: p.program_name,
      process_number: p.process_number ?? "",
      original_debt: String(p.original_debt), penalty_amount: String(p.penalty_amount),
      interest_amount: String(p.interest_amount),
      total_installments: String(p.total_installments), paid_installments: String(p.paid_installments),
      current_installment_amount: String(p.current_installment_amount),
      outstanding_balance_total: String(p.outstanding_balance_total),
      outstanding_balance_short_term: String(p.outstanding_balance_short_term),
      outstanding_balance_long_term: String(p.outstanding_balance_long_term),
      start_date: p.start_date, next_due_date: p.next_due_date ?? "",
      update_index: p.update_index, status: p.status, notes: p.notes ?? "",
    });
    setShowPlanForm(true);
  };

  const savePlan = async () => {
    if (!selectedPeriod) return;
    const payload = {
      period_id: selectedPeriod.id,
      tax_type: planForm.tax_type,
      program_name: planForm.program_name.trim(),
      process_number: planForm.process_number.trim() || null,
      original_debt: parseFloat(planForm.original_debt) || 0,
      penalty_amount: parseFloat(planForm.penalty_amount) || 0,
      interest_amount: parseFloat(planForm.interest_amount) || 0,
      total_installments: parseInt(planForm.total_installments) || 1,
      paid_installments: parseInt(planForm.paid_installments) || 0,
      current_installment_amount: parseFloat(planForm.current_installment_amount) || 0,
      outstanding_balance_total: parseFloat(planForm.outstanding_balance_total) || 0,
      outstanding_balance_short_term: parseFloat(planForm.outstanding_balance_short_term) || 0,
      outstanding_balance_long_term: parseFloat(planForm.outstanding_balance_long_term) || 0,
      start_date: planForm.start_date,
      next_due_date: planForm.next_due_date || null,
      update_index: planForm.update_index,
      status: planForm.status,
      notes: planForm.notes.trim() || null,
      responsible_user: session?.user?.id,
    };
    if (editPlanId) {
      await supabase.from("tax_installments_plan").update(payload).eq("id", editPlanId);
    } else {
      await supabase.from("tax_installments_plan").insert(payload);
    }
    setShowPlanForm(false);
    toast({ title: t("cash.saved") });
    fetchData();
    if (selectedPlan && editPlanId === selectedPlan.id) {
      setSelectedPlan({ ...selectedPlan, ...payload, total_consolidated: (payload.original_debt + payload.penalty_amount + payload.interest_amount), id: selectedPlan.id } as Plan);
    }
  };

  const deletePlan = async (id: string) => {
    await supabase.from("tax_installments_plan").delete().eq("id", id);
    toast({ title: t("cash.deleted") });
    if (selectedPlan?.id === id) setSelectedPlan(null);
    fetchData();
  };

  // Payment form
  const openAddPayment = () => { setEditPaymentId(null); setPaymentForm(EMPTY_PAYMENT); setShowPaymentForm(true); };
  const openEditPayment = (p: Payment) => {
    setEditPaymentId(p.id);
    setPaymentForm({
      installment_number: String(p.installment_number), due_date: p.due_date,
      principal_amount: String(p.principal_amount), interest_amount: String(p.interest_amount),
      penalty_amount: String(p.penalty_amount), status: p.status,
      payment_date: p.payment_date ?? "", amount_paid: String(p.amount_paid),
      darf_number: p.darf_number ?? "", notes: p.notes ?? "",
    });
    setShowPaymentForm(true);
  };

  const savePayment = async () => {
    if (!selectedPlan) return;
    const payload = {
      plan_id: selectedPlan.id,
      installment_number: parseInt(paymentForm.installment_number) || 1,
      due_date: paymentForm.due_date,
      principal_amount: parseFloat(paymentForm.principal_amount) || 0,
      interest_amount: parseFloat(paymentForm.interest_amount) || 0,
      penalty_amount: parseFloat(paymentForm.penalty_amount) || 0,
      status: paymentForm.status,
      payment_date: paymentForm.payment_date || null,
      amount_paid: parseFloat(paymentForm.amount_paid) || 0,
      darf_number: paymentForm.darf_number.trim() || null,
      notes: paymentForm.notes.trim() || null,
    };
    if (editPaymentId) {
      await supabase.from("tax_installment_payments").update(payload).eq("id", editPaymentId);
    } else {
      await supabase.from("tax_installment_payments").insert(payload);
    }
    setShowPaymentForm(false);
    toast({ title: t("cash.saved") });
    fetchPayments(selectedPlan.id);
  };

  const deletePayment = async (id: string) => {
    if (!selectedPlan) return;
    await supabase.from("tax_installment_payments").delete().eq("id", id);
    toast({ title: t("cash.deleted") });
    fetchPayments(selectedPlan.id);
  };

  // Computed
  const activePlans = useMemo(() => plans.filter(p => p.status !== "quitado" && p.status !== "cancelado"), [plans]);
  const totalCP = useMemo(() => activePlans.reduce((s, p) => s + Number(p.outstanding_balance_short_term), 0), [activePlans]);
  const totalLP = useMemo(() => activePlans.reduce((s, p) => s + Number(p.outstanding_balance_long_term), 0), [activePlans]);

  const statusColor = (s: string) => {
    switch (s) {
      case "ativo": return "bg-primary/20 text-primary";
      case "quitado": return "bg-success/20 text-success";
      case "suspenso": return "bg-warning/20 text-warning";
      case "cancelado": return "bg-muted text-muted-foreground";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const paymentStatusColor = (s: string) => {
    switch (s) {
      case "pago": return "bg-success/20 text-success";
      case "vencido": return "bg-danger/20 text-danger";
      default: return "bg-primary/20 text-primary";
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // ===== DETAIL VIEW =====
  if (selectedPlan) {
    const p = selectedPlan;
    const progressPct = p.total_installments > 0 ? (p.paid_installments / p.total_installments) * 100 : 0;
    const overduePayments = payments.filter(pay => pay.status === "vencido");

    return (
      <div className="space-y-6 p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedPlan(null)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> {t("auth.back_to_login").replace("login", "")}Voltar
          </Button>
          <h1 className="text-2xl font-bold text-foreground">
            {p.tax_type} — {p.program_name}
          </h1>
          <Badge className={statusColor(p.status)}>{t(`tax.st.${p.status}` as any)}</Badge>
        </div>

        {/* Overdue alert */}
        {overduePayments.length > 0 && (
          <Card className="border-danger/50 bg-danger/5">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-danger" />
              <span className="text-sm font-medium text-danger">
                {overduePayments.length} {overduePayments.length === 1 ? "parcela vencida" : "parcelas vencidas"} não paga{overduePayments.length > 1 ? "s" : ""}
              </span>
            </CardContent>
          </Card>
        )}

        {/* Debt composition */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("tax.debt_composition" as any)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("tax.original_debt" as any)}</span>
                <span className="font-medium">{formatBRL(Number(p.original_debt))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">(+) {t("tax.penalty" as any)}</span>
                <span className="font-medium">{formatBRL(Number(p.penalty_amount))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">(+) {t("tax.interest" as any)}</span>
                <span className="font-medium">{formatBRL(Number(p.interest_amount))}</span>
              </div>
              <div className="border-t pt-2 flex justify-between text-sm font-bold">
                <span>(=) {t("tax.consolidated" as any)}</span>
                <span>{formatBRL(Number(p.total_consolidated))}</span>
              </div>
              <div className="border-t pt-3 mt-2">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>{t("tax.update_index" as any)}: {p.update_index}</span>
                  <span>{p.process_number ? `Processo: ${p.process_number}` : ""}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("tax.progress" as any)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("tax.installments" as any)}</span>
                <span className="font-medium">{p.paid_installments} / {p.total_installments}</span>
              </div>
              <Progress value={progressPct} className="h-3" />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("tax.current_amount" as any)}</span>
                <span className="font-medium">{formatBRL(Number(p.current_installment_amount))}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("tax.next_due" as any)}</span>
                <span className="font-medium">{p.next_due_date ? formatDate(p.next_due_date) : "—"}</span>
              </div>
              <div className="border-t pt-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("tax.balance_total" as any)}</span>
                  <span className="font-bold">{formatBRL(Number(p.outstanding_balance_total))}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">CP</span>
                  <span>{formatBRL(Number(p.outstanding_balance_short_term))}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">LP</span>
                  <span>{formatBRL(Number(p.outstanding_balance_long_term))}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Payments schedule */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t("tax.schedule" as any)}</CardTitle>
            <Button size="sm" onClick={openAddPayment}><Plus className="h-4 w-4 mr-1" /> {t("tax.add_payment" as any)}</Button>
          </CardHeader>
          <CardContent className="p-0">
            {loadingPayments ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>{t("recv.due_date")}</TableHead>
                    <TableHead className="text-right">{t("tax.principal" as any)}</TableHead>
                    <TableHead className="text-right">{t("tax.interest" as any)}</TableHead>
                    <TableHead className="text-right">{t("tax.penalty" as any)}</TableHead>
                    <TableHead className="text-right">{t("tax.total" as any)}</TableHead>
                    <TableHead>{t("dashboard.status")}</TableHead>
                    <TableHead>{t("tax.darf" as any)}</TableHead>
                    <TableHead className="w-20">{t("cash.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">{t("generic.no_entries")}</TableCell></TableRow>
                  ) : payments.map(pay => (
                    <TableRow key={pay.id} className={pay.status === "vencido" ? "bg-danger/5" : ""}>
                      <TableCell className="font-medium">{pay.installment_number}</TableCell>
                      <TableCell>{formatDate(pay.due_date)}</TableCell>
                      <TableCell className="text-right">{formatBRL(Number(pay.principal_amount))}</TableCell>
                      <TableCell className="text-right">{formatBRL(Number(pay.interest_amount))}</TableCell>
                      <TableCell className="text-right">{formatBRL(Number(pay.penalty_amount))}</TableCell>
                      <TableCell className="text-right font-semibold">{formatBRL(Number(pay.total_amount))}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${paymentStatusColor(pay.status)}`}>
                          {t(`tax.pst.${pay.status}` as any)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{pay.darf_number || "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditPayment(pay)}>
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-danger" onClick={() => deletePayment(pay.id)}>
                            <XCircle className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Edit plan button */}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => openEditPlan(p)}>{t("cash.edit")} {t("tax.plan" as any)}</Button>
          <Button variant="destructive" onClick={() => deletePlan(p.id)}>{t("cash.delete")}</Button>
        </div>

        {/* Payment form dialog */}
        <Dialog open={showPaymentForm} onOpenChange={setShowPaymentForm}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editPaymentId ? t("cash.edit") : t("tax.add_payment" as any)}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground">#</label>
                <Input type="number" value={paymentForm.installment_number} onChange={e => setPaymentForm(f => ({ ...f, installment_number: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("recv.due_date")}</label>
                <Input type="date" value={paymentForm.due_date} onChange={e => setPaymentForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("tax.principal" as any)}</label>
                <Input type="number" step="0.01" value={paymentForm.principal_amount} onChange={e => setPaymentForm(f => ({ ...f, principal_amount: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("tax.interest" as any)}</label>
                <Input type="number" step="0.01" value={paymentForm.interest_amount} onChange={e => setPaymentForm(f => ({ ...f, interest_amount: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("tax.penalty" as any)}</label>
                <Input type="number" step="0.01" value={paymentForm.penalty_amount} onChange={e => setPaymentForm(f => ({ ...f, penalty_amount: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("dashboard.status")}</label>
                <Select value={paymentForm.status} onValueChange={v => setPaymentForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYMENT_STATUS.map(s => <SelectItem key={s} value={s}>{t(`tax.pst.${s}` as any)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("generic.payment_date")}</label>
                <Input type="date" value={paymentForm.payment_date} onChange={e => setPaymentForm(f => ({ ...f, payment_date: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("generic.payment_amount")}</label>
                <Input type="number" step="0.01" value={paymentForm.amount_paid} onChange={e => setPaymentForm(f => ({ ...f, amount_paid: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">{t("tax.darf" as any)}</label>
                <Input value={paymentForm.darf_number} onChange={e => setPaymentForm(f => ({ ...f, darf_number: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-muted-foreground">{t("recv.notes")}</label>
                <Textarea value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPaymentForm(false)}>{t("cash.cancel")}</Button>
              <Button onClick={savePayment}>{t("cash.save")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ===== LIST VIEW =====
  const cpMgmt = Number(reconCP?.management_balance ?? 0);
  const cpAcct = Number(reconCP?.accounting_balance ?? 0);
  const cpDiff = cpMgmt - cpAcct;
  const lpMgmt = Number(reconLP?.management_balance ?? 0);
  const lpAcct = Number(reconLP?.accounting_balance ?? 0);
  const lpDiff = lpMgmt - lpAcct;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("nav.taxes")}</h1>
        <Button onClick={openAddPlan}><Plus className="h-4 w-4 mr-1" /> {t("tax.add_plan" as any)}</Button>
      </div>

      {/* Reconciliation cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { label: "CP — 2.1.06", mgmt: cpMgmt, acct: cpAcct, diff: cpDiff, status: reconCP?.status ?? "divergent" },
          { label: "LP — 2.2.01.003", mgmt: lpMgmt, acct: lpAcct, diff: lpDiff, status: reconLP?.status ?? "divergent" },
        ].map(r => (
          <Card key={r.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-sm font-semibold text-foreground">{t("tax.reconciliation" as any)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{r.label}</span>
                </div>
                <StatusIcon status={r.status} />
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-xs text-muted-foreground">{t("dashboard.management_balance")}</div>
                  <div className="text-lg font-bold text-foreground">{formatBRL(r.mgmt)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("dashboard.accounting_balance")}</div>
                  <div className="text-lg font-bold text-foreground">{formatBRL(r.acct)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("dashboard.difference")}</div>
                  <div className={`text-lg font-bold ${r.diff === 0 ? "text-success" : "text-danger"}`}>{formatBRL(r.diff)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Plan cards */}
      {plans.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {t("generic.no_entries")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map(p => {
            const pct = p.total_installments > 0 ? (p.paid_installments / p.total_installments) * 100 : 0;
            const remaining = p.total_installments - p.paid_installments;
            return (
              <Card
                key={p.id}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => openPlanDetail(p)}
              >
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-foreground">{p.tax_type}</span>
                      <Badge variant="outline" className={statusColor(p.status)}>{t(`tax.st.${p.status}` as any)}</Badge>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">{p.program_name}</div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t("tax.balance_total" as any)}</span>
                      <span className="font-bold text-foreground">{formatBRL(Number(p.outstanding_balance_total))}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">CP: {formatBRL(Number(p.outstanding_balance_short_term))}</span>
                      <span className="text-muted-foreground">LP: {formatBRL(Number(p.outstanding_balance_long_term))}</span>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{p.paid_installments}/{p.total_installments} parcelas</span>
                      <span>{remaining} restantes</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                  </div>

                  {p.next_due_date && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      <span>Próx. venc.: {formatDate(p.next_due_date)}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Plan form dialog */}
      <Dialog open={showPlanForm} onOpenChange={setShowPlanForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editPlanId ? t("cash.edit") : t("tax.add_plan" as any)}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.tax_type" as any)}</label>
              <Select value={planForm.tax_type} onValueChange={v => setPlanForm(f => ({ ...f, tax_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TAX_TYPES.map(tt => <SelectItem key={tt} value={tt}>{tt}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.program" as any)}</label>
              <Input value={planForm.program_name} onChange={e => setPlanForm(f => ({ ...f, program_name: e.target.value }))} placeholder="REFIS, Parcelamento Ordinário..." />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground">{t("tax.process" as any)}</label>
              <Input value={planForm.process_number} onChange={e => setPlanForm(f => ({ ...f, process_number: e.target.value }))} placeholder="Nº do processo administrativo" />
            </div>

            <div className="col-span-2 border-t pt-3 mt-1">
              <span className="text-sm font-semibold text-foreground">{t("tax.debt_composition" as any)}</span>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.original_debt" as any)}</label>
              <Input type="number" step="0.01" value={planForm.original_debt} onChange={e => setPlanForm(f => ({ ...f, original_debt: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.penalty" as any)}</label>
              <Input type="number" step="0.01" value={planForm.penalty_amount} onChange={e => setPlanForm(f => ({ ...f, penalty_amount: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.interest" as any)}</label>
              <Input type="number" step="0.01" value={planForm.interest_amount} onChange={e => setPlanForm(f => ({ ...f, interest_amount: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.consolidated" as any)}</label>
              <Input disabled value={formatBRL((parseFloat(planForm.original_debt) || 0) + (parseFloat(planForm.penalty_amount) || 0) + (parseFloat(planForm.interest_amount) || 0))} />
            </div>

            <div className="col-span-2 border-t pt-3 mt-1">
              <span className="text-sm font-semibold text-foreground">{t("tax.installments" as any)}</span>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.total_installments" as any)}</label>
              <Input type="number" value={planForm.total_installments} onChange={e => setPlanForm(f => ({ ...f, total_installments: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.paid_installments" as any)}</label>
              <Input type="number" value={planForm.paid_installments} onChange={e => setPlanForm(f => ({ ...f, paid_installments: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.current_amount" as any)}</label>
              <Input type="number" step="0.01" value={planForm.current_installment_amount} onChange={e => setPlanForm(f => ({ ...f, current_installment_amount: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.update_index" as any)}</label>
              <Select value={planForm.update_index} onValueChange={v => setPlanForm(f => ({ ...f, update_index: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INDEX_OPTIONS.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 border-t pt-3 mt-1">
              <span className="text-sm font-semibold text-foreground">{t("tax.balances" as any)}</span>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.balance_total" as any)}</label>
              <Input type="number" step="0.01" value={planForm.outstanding_balance_total} onChange={e => setPlanForm(f => ({ ...f, outstanding_balance_total: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">CP ({t("module.taxes_cp")})</label>
              <Input type="number" step="0.01" value={planForm.outstanding_balance_short_term} onChange={e => setPlanForm(f => ({ ...f, outstanding_balance_short_term: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">LP ({t("module.taxes_lp")})</label>
              <Input type="number" step="0.01" value={planForm.outstanding_balance_long_term} onChange={e => setPlanForm(f => ({ ...f, outstanding_balance_long_term: e.target.value }))} />
            </div>

            <div className="col-span-2 border-t pt-3 mt-1">
              <span className="text-sm font-semibold text-foreground">{t("tax.dates_status" as any)}</span>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.start_date" as any)}</label>
              <Input type="date" value={planForm.start_date} onChange={e => setPlanForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("tax.next_due" as any)}</label>
              <Input type="date" value={planForm.next_due_date} onChange={e => setPlanForm(f => ({ ...f, next_due_date: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("dashboard.status")}</label>
              <Select value={planForm.status} onValueChange={v => setPlanForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{t(`tax.st.${s}` as any)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground">{t("recv.notes")}</label>
              <Textarea value={planForm.notes} onChange={e => setPlanForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPlanForm(false)}>{t("cash.cancel")}</Button>
            <Button onClick={savePlan}>{t("cash.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
