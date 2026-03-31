import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, MoreHorizontal } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
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

/* ── types ── */
interface CardRecord {
  id: string; holder_name: string; last_four: string; bank_name: string;
  network: string; due_day: number; card_color: string;
}
interface InvoiceRecord {
  id: string; card_id: string; year: number; month: number;
  total_amount: number; status: string; due_date: string | null;
  payment_date: string | null;
}

/* ── network logos (same as CreditCards.tsx) ── */
function NetworkLogo({ network, className = "" }: { network?: string; className?: string }) {
  const base = `${className} inline-block`;
  switch (network) {
    case "Visa":
      return (<svg className={base} viewBox="0 0 48 16" fill="none"><path d="M19.2 1L15.6 15H12L15.6 1H19.2Z" fill="white"/><path d="M32.4 1.4C31.6 1.1 30.4 0.8 28.8 0.8C25.2 0.8 22.6 2.8 22.6 5.6C22.6 7.6 24.4 8.8 25.8 9.4C27.2 10.2 27.8 10.6 27.8 11.2C27.8 12.2 26.6 12.6 25.4 12.6C23.8 12.6 22.8 12.4 21.4 11.8L20.8 11.4L20.2 15.2C21.2 15.6 23 16 24.8 16C28.6 16 31.2 14 31.2 11C31.2 9.4 30.2 8.2 28 7C26.8 6.4 26 5.8 26 5.2C26 4.6 26.6 4 28 4C29.2 4 30 4.2 30.6 4.4L31 4.6L31.6 1L32.4 1.4Z" fill="white"/><path d="M37.2 10.2C37.6 9.2 39 5.4 39 5.4C39 5.4 39.4 4.4 39.6 3.8L40 5.2C40 5.2 40.8 9 41 10.2H37.2ZM42.6 1H39.8C39 1 38.2 1.2 37.8 2.2L32.4 15H36.2C36.2 15 36.8 13.4 37 12.8H41.6C41.8 13.4 42 15 42 15H45.4L42.6 1Z" fill="white"/><path d="M11.4 1L7.8 10.8L7.4 8.8C6.6 6.2 4.2 3.2 1.6 1.8L4.8 15H8.8L15.4 1H11.4Z" fill="white"/><path d="M5.4 1H0L0 1.2C4.6 2.4 7.6 5.2 8.8 8.8L7.6 2.2C7.4 1.2 6.6 1 5.4 1Z" fill="#F9A825"/></svg>);
    case "Mastercard":
      return (<svg className={base} viewBox="0 0 40 24" fill="none"><circle cx="15" cy="12" r="10" fill="#EB001B" opacity="0.9"/><circle cx="25" cy="12" r="10" fill="#F79E1B" opacity="0.9"/><path d="M20 4.6A10 10 0 0 1 20 19.4A10 10 0 0 1 20 4.6Z" fill="#FF5F00" opacity="0.9"/></svg>);
    case "Elo":
      return (<svg className={base} viewBox="0 0 48 20" fill="none"><text x="0" y="16" fill="white" fontSize="16" fontWeight="bold" fontFamily="Arial, sans-serif" letterSpacing="1">elo</text><circle cx="40" cy="6" r="4" fill="#FFCB05"/><circle cx="40" cy="14" r="4" fill="#00A4E0"/><circle cx="34" cy="10" r="4" fill="#EF4123"/></svg>);
    case "American Express":
      return (<svg className={base} viewBox="0 0 60 20" fill="none"><text x="0" y="14" fill="white" fontSize="11" fontWeight="bold" fontFamily="Arial, sans-serif" letterSpacing="0.5">AMEX</text></svg>);
    default: return null;
  }
}

function MiniCard({ card }: { card: CardRecord }) {
  return (
    <div className="relative flex flex-col w-full max-w-[320px] overflow-hidden rounded-2xl p-4 text-white select-none" style={{ backgroundColor: card.card_color, aspectRatio: "1.586 / 1" }}>
      <div className="flex items-center justify-between">
        <div className="h-5 w-7 rounded" style={{ backgroundColor: "#d4a843" }} />
        <span className="text-[10px] font-medium" style={{ opacity: 0.7 }}>{card.bank_name}</span>
      </div>
      <div className="mt-4 font-mono text-sm tracking-[3px]">•••• •••• •••• {card.last_four}</div>
      <div className="mt-auto grid grid-cols-3 gap-2 text-[9px] items-end">
        <div><span className="block uppercase" style={{ opacity: 0.6 }}>Titular</span><span className="block truncate text-[10px] font-medium">{card.holder_name}</span></div>
        <div className="text-center"><span className="block uppercase" style={{ opacity: 0.6 }}>Vencimento</span><span className="block text-[10px] font-medium">Dia {card.due_day}</span></div>
        <div className="flex flex-col items-end"><NetworkLogo network={card.network} className="h-5 w-auto" /></div>
      </div>
    </div>
  );
}

const MONTH_NAMES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function statusBadge(status: string) {
  switch (status) {
    case "aberta": return <Badge variant="outline" className="border-yellow-500/50 bg-yellow-500/10 text-yellow-600">Aberta</Badge>;
    case "fechada": return <Badge variant="outline" className="border-blue-500/50 bg-blue-500/10 text-blue-600">Fechada</Badge>;
    case "paga": return <Badge variant="outline" className="border-green-500/50 bg-green-500/10 text-green-600">Paga</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
}

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function CreditCardDetail() {
  const { cardId } = useParams<{ cardId: string }>();
  const navigate = useNavigate();

  const [card, setCard] = useState<CardRecord | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteInvoice, setDeleteInvoice] = useState<InvoiceRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const now = new Date();
  const [newMonth, setNewMonth] = useState(String(now.getMonth() + 1));
  const [newYear, setNewYear] = useState(String(now.getFullYear()));
  const [newStatus, setNewStatus] = useState("aberta");
  const [newDueDate, setNewDueDate] = useState<Date | undefined>();

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  const fetchData = async () => {
    if (!cardId) return;
    setLoading(true);
    const [cardRes, invRes] = await Promise.all([
      supabase.from("credit_cards").select("*").eq("id", cardId).single(),
      supabase.from("credit_card_invoices").select("*").eq("card_id", cardId).order("year", { ascending: false }).order("month", { ascending: false }),
    ]);
    if (cardRes.error) { toast({ title: "Erro ao carregar cartão", variant: "destructive" }); navigate("/credit-cards"); return; }
    setCard(cardRes.data as CardRecord);
    setInvoices((invRes.data as InvoiceRecord[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [cardId]);

  // Pre-fill due date when month/year/card changes
  useEffect(() => {
    if (!card) return;
    const m = parseInt(newMonth);
    const y = parseInt(newYear);
    const day = Math.min(card.due_day, new Date(y, m, 0).getDate());
    setNewDueDate(new Date(y, m - 1, day));
  }, [newMonth, newYear, card]);

  const handleCreateInvoice = async () => {
    if (!cardId) return;
    const m = parseInt(newMonth);
    const y = parseInt(newYear);

    // Check duplicate
    const existing = invoices.find((i) => i.year === y && i.month === m);
    if (existing) {
      toast({ title: "Já existe uma fatura para este período.", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("credit_card_invoices").insert({
      card_id: cardId,
      year: y,
      month: m,
      due_date: newDueDate ? format(newDueDate, "yyyy-MM-dd") : null,
      status: newStatus,
      total_amount: 0,
    });
    setSaving(false);

    if (error) {
      if (error.code === "23505") toast({ title: "Já existe uma fatura para este período.", variant: "destructive" });
      else toast({ title: "Erro ao criar fatura", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Fatura criada" });
      setDialogOpen(false);
      fetchData();
    }
  };

  const updateInvoiceStatus = async (inv: InvoiceRecord, status: string) => {
    const updates: any = { status };
    if (status === "paga") updates.payment_date = format(new Date(), "yyyy-MM-dd");
    const { error } = await supabase.from("credit_card_invoices").update(updates).eq("id", inv.id);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else { toast({ title: `Fatura marcada como ${status}` }); fetchData(); }
  };

  const handleDeleteInvoice = async () => {
    if (!deleteInvoice) return;
    const { error } = await supabase.from("credit_card_invoices").delete().eq("id", deleteInvoice.id);
    if (error) toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    else { toast({ title: "Fatura excluída" }); fetchData(); }
    setDeleteInvoice(null);
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
  );

  if (!card) return null;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <Button variant="ghost" size="sm" onClick={() => navigate("/credit-cards")} className="gap-1 text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Button>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        <MiniCard card={card} />
        <div className="space-y-1 pt-2">
          <h1 className="text-xl font-bold text-foreground">{card.holder_name}</h1>
          <p className="text-sm text-muted-foreground">{card.bank_name} · {card.network}</p>
          <p className="text-sm text-muted-foreground">Vencimento: Dia {card.due_day}</p>
        </div>
      </div>

      {/* Invoices section */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Faturas</h2>
        <Button size="sm" onClick={() => setDialogOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nova Fatura</Button>
      </div>

      {invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">Nenhuma fatura cadastrada. Clique em Nova Fatura para começar.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between rounded-lg border bg-card p-4">
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="min-w-[120px]">
                  <span className="font-medium text-sm text-foreground">{MONTH_NAMES[inv.month - 1]} {inv.year}</span>
                </div>
                <span className="font-semibold text-sm text-foreground">{formatBRL(Number(inv.total_amount) || 0)}</span>
                {statusBadge(inv.status)}
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {inv.due_date ? `Vence ${format(new Date(inv.due_date + "T12:00:00"), "dd/MM/yyyy")}` : "—"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate(`/credit-cards/${cardId}/invoices/${inv.id}`)}>Ver lançamentos</Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {inv.status !== "paga" && (
                      <DropdownMenuItem onClick={() => updateInvoiceStatus(inv, "paga")}>Marcar como paga</DropdownMenuItem>
                    )}
                    {inv.status !== "fechada" && inv.status !== "paga" && (
                      <DropdownMenuItem onClick={() => updateInvoiceStatus(inv, "fechada")}>Marcar como fechada</DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setDeleteInvoice(inv)} className="text-destructive focus:text-destructive">Excluir</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New invoice dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova Fatura</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Mês</Label>
                <Select value={newMonth} onValueChange={setNewMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MONTH_NAMES.map((m, i) => (<SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ano</Label>
                <Select value={newYear} onValueChange={setNewYear}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => (<SelectItem key={y} value={String(y)}>{y}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Data de vencimento</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !newDueDate && "text-muted-foreground")}>
                    {newDueDate ? format(newDueDate, "dd/MM/yyyy") : "Selecionar data"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={newDueDate} onSelect={setNewDueDate} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Status inicial</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="aberta">Aberta</SelectItem>
                  <SelectItem value="fechada">Fechada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreateInvoice} disabled={saving}>{saving ? "Salvando..." : "Criar fatura"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteInvoice} onOpenChange={(o) => { if (!o) setDeleteInvoice(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir fatura</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a fatura de {deleteInvoice ? `${MONTH_NAMES[deleteInvoice.month - 1]} ${deleteInvoice.year}` : ""}? Todos os lançamentos vinculados serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteInvoice} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
