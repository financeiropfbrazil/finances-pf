import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, MoreHorizontal, Check, ChevronsUpDown } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import {
  Card, CardContent,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

interface InvoiceWithCard {
  id: string; card_id: string; year: number; month: number;
  total_amount: number; status: string; due_date: string | null;
  credit_cards: { id: string; holder_name: string; bank_name: string; network: string; last_four: string; due_day: number; card_color: string };
}
interface Txn {
  id: string; invoice_id: string; card_id: string; transaction_date: string;
  description: string; amount: number; transaction_type: string;
  category: string | null; notes: string | null;
  cost_center_id: string | null;
  cost_centers?: { id: string; name: string; erp_code: string | null } | null;
}

interface CostCenterOption {
  id: string;
  name: string;
  erp_code: string | null;
}

const MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function formatBRL(v: number) { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

function statusBadge(status: string) {
  switch (status) {
    case "aberta": return <Badge variant="outline" className="border-yellow-500/50 bg-yellow-500/10 text-yellow-600">Aberta</Badge>;
    case "fechada": return <Badge variant="outline" className="border-blue-500/50 bg-blue-500/10 text-blue-600">Fechada</Badge>;
    case "paga": return <Badge variant="outline" className="border-green-500/50 bg-green-500/10 text-green-600">Paga</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

const emptyForm = { transaction_date: new Date() as Date | undefined, description: "", amount: "", transaction_type: "debit", category: "", notes: "" };

export default function CreditCardInvoice() {
  const { cardId, invoiceId } = useParams<{ cardId: string; invoiceId: string }>();
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState<InvoiceWithCard | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTxn, setEditingTxn] = useState<Txn | null>(null);
  const [deleteTxn, setDeleteTxn] = useState<Txn | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [costCenters, setCostCenters] = useState<CostCenterOption[]>([]);
  const [selectedCostCenterId, setSelectedCostCenterId] = useState<string | null>(null);
  const [ccPopoverOpen, setCcPopoverOpen] = useState(false);

  useEffect(() => {
    supabase
      .from("cost_centers")
      .select("id, name, erp_code")
      .eq("is_active", true)
      .eq("group_type", "F")
      .order("name", { ascending: true })
      .then(({ data }) => setCostCenters((data as CostCenterOption[]) || []));
  }, []);

  const fetchData = async () => {
    if (!invoiceId || !cardId) return;
    setLoading(true);
    const [invRes, txnRes] = await Promise.all([
      supabase.from("credit_card_invoices").select("*, credit_cards(*)").eq("id", invoiceId).single(),
      supabase.from("credit_card_transactions").select("*, cost_centers(id, name, erp_code)").eq("invoice_id", invoiceId).order("transaction_date", { ascending: false }),
    ]);
    if (invRes.error) { toast({ title: "Erro ao carregar fatura", variant: "destructive" }); navigate(`/credit-cards/${cardId}`); return; }
    setInvoice(invRes.data as unknown as InvoiceWithCard);
    setTxns((txnRes.data as unknown as Txn[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [invoiceId, cardId]);

  const totals = useMemo(() => {
    const debits = txns.filter(t => t.transaction_type === "debit").reduce((s, t) => s + Number(t.amount), 0);
    const credits = txns.filter(t => t.transaction_type === "credit").reduce((s, t) => s + Number(t.amount), 0);
    return { debits, credits, balance: debits - credits };
  }, [txns]);

  const recalcTotal = async () => {
    if (!invoiceId) return;
    const { data } = await supabase.from("credit_card_transactions").select("amount, transaction_type").eq("invoice_id", invoiceId);
    const total = (data || []).reduce((acc: number, t: any) => t.transaction_type === "debit" ? acc + Number(t.amount) : acc - Number(t.amount), 0);
    await supabase.from("credit_card_invoices").update({ total_amount: total }).eq("id", invoiceId);
  };

  const openCreate = () => { setEditingTxn(null); setForm(emptyForm); setSelectedCostCenterId(null); setDialogOpen(true); };
  const openEdit = (t: Txn) => {
    setEditingTxn(t);
    setForm({
      transaction_date: new Date(t.transaction_date + "T12:00:00"),
      description: t.description,
      amount: String(t.amount),
      transaction_type: t.transaction_type,
      category: t.category || "",
      notes: t.notes || "",
    });
    setSelectedCostCenterId(t.cost_center_id ?? null);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.description || !form.amount || !form.transaction_date) {
      toast({ title: "Preencha os campos obrigatórios", variant: "destructive" }); return;
    }
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0) { toast({ title: "Valor inválido", variant: "destructive" }); return; }

    const payload = {
      invoice_id: invoiceId!,
      card_id: cardId!,
      transaction_date: format(form.transaction_date!, "yyyy-MM-dd"),
      description: form.description,
      amount: amt,
      transaction_type: form.transaction_type,
      category: form.category || null,
      notes: form.notes || null,
      cost_center_id: selectedCostCenterId || null,
    };

    setSaving(true);
    let error;
    if (editingTxn) {
      ({ error } = await supabase.from("credit_card_transactions").update(payload).eq("id", editingTxn.id));
    } else {
      ({ error } = await supabase.from("credit_card_transactions").insert(payload));
    }
    setSaving(false);
    if (error) { toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" }); return; }

    await recalcTotal();
    toast({ title: editingTxn ? "Lançamento atualizado" : "Lançamento adicionado" });
    setDialogOpen(false);
    setEditingTxn(null);
    fetchData();
  };

  const handleDelete = async () => {
    if (!deleteTxn) return;
    const { error } = await supabase.from("credit_card_transactions").delete().eq("id", deleteTxn.id);
    if (error) { toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" }); }
    else { await recalcTotal(); toast({ title: "Lançamento excluído" }); fetchData(); }
    setDeleteTxn(null);
  };

  const selectedCostCenter = costCenters.find(cc => cc.id === selectedCostCenterId);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  if (!invoice) return null;

  const card = invoice.credit_cards;
  const title = `${card.bank_name} — ${MONTH_NAMES[invoice.month - 1]} ${invoice.year}`;

  return (
    <div className="space-y-6 p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/credit-cards/${cardId}`)} className="gap-1 text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Button>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-foreground">{title}</h1>
          {statusBadge(invoice.status)}
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card><CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">Total de débitos</p>
          <p className="text-lg font-semibold text-foreground">{formatBRL(totals.debits)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">Total de créditos</p>
          <p className="text-lg font-semibold text-green-600">{formatBRL(totals.credits)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">Saldo da fatura</p>
          <p className="text-lg font-bold text-foreground">{formatBRL(totals.balance)}</p>
        </CardContent></Card>
      </div>

      {/* Toolbar */}
      <div className="flex justify-end">
        <Button size="sm" onClick={openCreate}><Plus className="mr-1 h-4 w-4" /> Adicionar lançamento</Button>
      </div>

      {/* Table */}
      {txns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">Nenhum lançamento nesta fatura. Clique em Adicionar lançamento para começar.</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]">Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-[180px]">Centro de Custo</TableHead>
                <TableHead className="w-[90px]">Tipo</TableHead>
                <TableHead className="w-[120px] text-right">Valor</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {txns.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-sm">{format(new Date(t.transaction_date + "T12:00:00"), "dd/MM/yyyy")}</TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-sm truncate block max-w-[250px]">{t.description}</span>
                      </TooltipTrigger>
                      <TooltipContent><p className="max-w-xs">{t.description}</p></TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {t.cost_centers?.name
                      ? <Badge variant="secondary" className="text-xs">{t.cost_centers.name}</Badge>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {t.transaction_type === "debit"
                      ? <Badge variant="outline" className="border-red-500/50 bg-red-500/10 text-red-600 text-xs">Débito</Badge>
                      : <Badge variant="outline" className="border-green-500/50 bg-green-500/10 text-green-600 text-xs">Crédito</Badge>}
                  </TableCell>
                  <TableCell className={cn("text-right text-sm font-medium", t.transaction_type === "credit" && "text-green-600")}>
                    {formatBRL(Number(t.amount))}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(t)}>Editar</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDeleteTxn(t)} className="text-destructive focus:text-destructive">Excluir</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setEditingTxn(null); setDialogOpen(o); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingTxn ? "Editar lançamento" : "Novo lançamento"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Data *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !form.transaction_date && "text-muted-foreground")}>
                    {form.transaction_date ? format(form.transaction_date, "dd/MM/yyyy") : "Selecionar"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={form.transaction_date} onSelect={(d) => setForm({ ...form, transaction_date: d })} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Descrição *</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex: Restaurante, Hotel..." />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Valor (R$) *</Label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0,00" />
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={form.transaction_type} onValueChange={(v) => setForm({ ...form, transaction_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debit">Débito</SelectItem>
                    <SelectItem value="credit">Crédito</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Centro de Custo</Label>
              <Popover open={ccPopoverOpen} onOpenChange={setCcPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" aria-expanded={ccPopoverOpen} className="w-full justify-between font-normal">
                    {selectedCostCenter
                      ? <span className="truncate">{selectedCostCenter.name}</span>
                      : <span className="text-muted-foreground">Selecionar centro de custo...</span>}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar centro de custo..." />
                    <CommandList>
                      <CommandEmpty>Nenhum centro encontrado.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="__none__"
                          onSelect={() => { setSelectedCostCenterId(null); setCcPopoverOpen(false); }}
                        >
                          <Check className={cn("mr-2 h-4 w-4", !selectedCostCenterId ? "opacity-100" : "opacity-0")} />
                          <span className="text-muted-foreground">Nenhum</span>
                        </CommandItem>
                        {costCenters.map((cc) => (
                          <CommandItem
                            key={cc.id}
                            value={cc.name}
                            onSelect={() => { setSelectedCostCenterId(cc.id); setCcPopoverOpen(false); }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", selectedCostCenterId === cc.id ? "opacity-100" : "opacity-0")} />
                            <span className="flex-1 truncate">{cc.name}</span>
                            {cc.erp_code && <span className="ml-2 font-mono text-xs text-muted-foreground">{cc.erp_code}</span>}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Opcional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : editingTxn ? "Salvar" : "Adicionar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTxn} onOpenChange={(o) => { if (!o) setDeleteTxn(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir lançamento</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja excluir "{deleteTxn?.description}"?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
