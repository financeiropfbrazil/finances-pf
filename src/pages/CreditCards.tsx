import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CreditCardRecord {
  id: string;
  holder_name: string;
  last_four: string;
  bank_name: string;
  network: string;
  due_day: number;
  card_color: string;
  is_active: boolean;
  created_at: string;
}

const COLOR_OPTIONS = [
  { label: "Azul escuro", value: "#1e3a5f" },
  { label: "Vermelho", value: "#991b1b" },
  { label: "Verde escuro", value: "#064e3b" },
  { label: "Roxo", value: "#4a1942" },
  { label: "Preto", value: "#1a1a2e" },
  { label: "Laranja", value: "#92400e" },
];

const NETWORK_OPTIONS = ["Mastercard", "Visa", "Elo", "American Express"];

const emptyForm = {
  holder_name: "",
  bank_name: "",
  last_four: "",
  network: "",
  due_day: "",
  card_color: "#1a1a2e",
};

function NetworkLogo({ network, className = "" }: { network?: string; className?: string }) {
  const base = `${className} inline-block`;
  switch (network) {
    case "Visa":
      return (
        <svg className={base} viewBox="0 0 48 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M19.2 1L15.6 15H12L15.6 1H19.2Z" fill="white"/>
          <path d="M32.4 1.4C31.6 1.1 30.4 0.8 28.8 0.8C25.2 0.8 22.6 2.8 22.6 5.6C22.6 7.6 24.4 8.8 25.8 9.4C27.2 10.2 27.8 10.6 27.8 11.2C27.8 12.2 26.6 12.6 25.4 12.6C23.8 12.6 22.8 12.4 21.4 11.8L20.8 11.4L20.2 15.2C21.2 15.6 23 16 24.8 16C28.6 16 31.2 14 31.2 11C31.2 9.4 30.2 8.2 28 7C26.8 6.4 26 5.8 26 5.2C26 4.6 26.6 4 28 4C29.2 4 30 4.2 30.6 4.4L31 4.6L31.6 1L32.4 1.4Z" fill="white"/>
          <path d="M37.2 10.2C37.6 9.2 39 5.4 39 5.4C39 5.4 39.4 4.4 39.6 3.8L40 5.2C40 5.2 40.8 9 41 10.2H37.2ZM42.6 1H39.8C39 1 38.2 1.2 37.8 2.2L32.4 15H36.2C36.2 15 36.8 13.4 37 12.8H41.6C41.8 13.4 42 15 42 15H45.4L42.6 1Z" fill="white"/>
          <path d="M11.4 1L7.8 10.8L7.4 8.8C6.6 6.2 4.2 3.2 1.6 1.8L4.8 15H8.8L15.4 1H11.4Z" fill="white"/>
          <path d="M5.4 1H0L0 1.2C4.6 2.4 7.6 5.2 8.8 8.8L7.6 2.2C7.4 1.2 6.6 1 5.4 1Z" fill="#F9A825"/>
        </svg>
      );
    case "Mastercard":
      return (
        <svg className={base} viewBox="0 0 40 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="15" cy="12" r="10" fill="#EB001B" opacity="0.9"/>
          <circle cx="25" cy="12" r="10" fill="#F79E1B" opacity="0.9"/>
          <path d="M20 4.6A10 10 0 0 1 20 19.4A10 10 0 0 1 20 4.6Z" fill="#FF5F00" opacity="0.9"/>
        </svg>
      );
    case "Elo":
      return (
        <svg className={base} viewBox="0 0 48 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <text x="0" y="16" fill="white" fontSize="16" fontWeight="bold" fontFamily="Arial, sans-serif" letterSpacing="1">elo</text>
          <circle cx="40" cy="6" r="4" fill="#FFCB05"/>
          <circle cx="40" cy="14" r="4" fill="#00A4E0"/>
          <circle cx="34" cy="10" r="4" fill="#EF4123"/>
        </svg>
      );
    case "American Express":
      return (
        <svg className={base} viewBox="0 0 60 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <text x="0" y="14" fill="white" fontSize="11" fontWeight="bold" fontFamily="Arial, sans-serif" letterSpacing="0.5">AMEX</text>
        </svg>
      );
    default:
      return null;
  }
}

function CardVisual({ card }: { card: Partial<CreditCardRecord> & { card_color: string } }) {
  return (
    <div
      className="relative flex flex-col w-full overflow-hidden rounded-2xl p-5 text-white select-none"
      style={{
        backgroundColor: card.card_color,
        aspectRatio: "1.586 / 1",
      }}
    >
      {/* Top row */}
      <div className="flex items-center justify-between">
        <div className="h-6 w-8 rounded" style={{ backgroundColor: "#d4a843" }} />
        <span className="text-xs font-medium" style={{ opacity: 0.7 }}>
          {card.bank_name || "Banco"}
        </span>
      </div>

      {/* Card number */}
      <div className="mt-6 font-mono text-lg tracking-[3px]">
        •••• •••• •••• {card.last_four || "0000"}
      </div>

      {/* Bottom row */}
      <div className="mt-auto grid grid-cols-3 gap-2 text-[10px] items-end">
        <div>
          <span className="block uppercase" style={{ opacity: 0.6 }}>Titular</span>
          <span className="block truncate text-xs font-medium">
            {card.holder_name || "—"}
          </span>
        </div>
        <div className="text-center">
          <span className="block uppercase" style={{ opacity: 0.6 }}>Vencimento</span>
          <span className="block text-xs font-medium">
            Dia {card.due_day || "—"}
          </span>
        </div>
        <div className="flex flex-col items-end">
          <NetworkLogo network={card.network} className="h-6 w-auto" />
        </div>
      </div>
    </div>
  );
}

export default function CreditCards() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<CreditCardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<CreditCardRecord | null>(null);
  const [deleteCard, setDeleteCard] = useState<CreditCardRecord | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchCards = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("credit_cards")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    if (error) {
      toast({ title: "Erro ao carregar cartões", description: error.message, variant: "destructive" });
    } else {
      setCards((data as CreditCardRecord[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchCards(); }, []);

  const openCreate = () => {
    setEditingCard(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (card: CreditCardRecord) => {
    setEditingCard(card);
    setForm({
      holder_name: card.holder_name,
      bank_name: card.bank_name,
      last_four: card.last_four,
      network: card.network,
      due_day: String(card.due_day),
      card_color: card.card_color,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.holder_name || !form.bank_name || !form.last_four || !form.network || !form.due_day) {
      toast({ title: "Preencha todos os campos obrigatórios", variant: "destructive" });
      return;
    }
    if (form.last_four.length !== 4 || !/^\d{4}$/.test(form.last_four)) {
      toast({ title: "Últimos 4 dígitos inválidos", variant: "destructive" });
      return;
    }
    const dueDay = parseInt(form.due_day);
    if (isNaN(dueDay) || dueDay < 1 || dueDay > 31) {
      toast({ title: "Dia de vencimento deve ser entre 1 e 31", variant: "destructive" });
      return;
    }

    const payload = {
      holder_name: form.holder_name,
      bank_name: form.bank_name,
      last_four: form.last_four,
      network: form.network,
      due_day: dueDay,
      card_color: form.card_color,
    };

    setSaving(true);
    let error;
    if (editingCard) {
      ({ error } = await supabase.from("credit_cards").update(payload).eq("id", editingCard.id));
    } else {
      ({ error } = await supabase.from("credit_cards").insert(payload));
    }
    setSaving(false);

    if (error) {
      toast({ title: "Erro ao salvar cartão", description: error.message, variant: "destructive" });
    } else {
      toast({ title: editingCard ? "Cartão atualizado" : "Cartão adicionado com sucesso" });
      setForm(emptyForm);
      setEditingCard(null);
      setDialogOpen(false);
      fetchCards();
    }
  };

  const handleDelete = async () => {
    if (!deleteCard) return;
    const { error } = await supabase.rpc("soft_delete_credit_card", { p_card_id: deleteCard.id });
    if (error) {
      toast({ title: "Erro ao excluir cartão", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Cartão excluído" });
      fetchCards();
    }
    setDeleteCard(null);
  };

  const previewCard = {
    holder_name: form.holder_name,
    bank_name: form.bank_name,
    last_four: form.last_four,
    network: form.network,
    due_day: parseInt(form.due_day) || 0,
    card_color: form.card_color,
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Cartões de Crédito</h1>
          <p className="text-sm text-muted-foreground">Gerencie seus cartões corporativos</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {cards.map((card) => (
            <div key={card.id} className="group relative">
              {/* Action menu */}
              <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 bg-black/30 hover:bg-black/50 text-white rounded-full backdrop-blur-sm">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(card)}>
                      <Pencil className="mr-2 h-4 w-4" /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleteCard(card)} className="text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <button
                onClick={() => navigate(`/credit-cards/${card.id}`)}
                className="w-full text-left transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-2xl"
              >
                <CardVisual card={card} />
              </button>
            </div>
          ))}

          {/* Add card */}
          <button
            onClick={openCreate}
            className="flex flex-col items-center justify-center gap-3 rounded-2xl border-[1.5px] border-dashed border-muted-foreground/30 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            style={{ aspectRatio: "1.586 / 1" }}
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-current">
              <Plus className="h-6 w-6" />
            </div>
            <span className="text-sm font-medium">Adicionar cartão</span>
          </button>
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setEditingCard(null); } setDialogOpen(open); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingCard ? "Editar cartão" : "Novo cartão de crédito"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <div>
                <Label>Titular *</Label>
                <Input value={form.holder_name} onChange={(e) => setForm({ ...form, holder_name: e.target.value })} placeholder="Nome do titular" />
              </div>
              <div>
                <Label>Banco *</Label>
                <Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder="Ex: Santander, Bradesco" />
              </div>
              <div>
                <Label>Últimos 4 dígitos *</Label>
                <Input value={form.last_four} onChange={(e) => setForm({ ...form, last_four: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="0000" maxLength={4} />
              </div>
              <div>
                <Label>Rede *</Label>
                <Select value={form.network} onValueChange={(v) => setForm({ ...form, network: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {NETWORK_OPTIONS.map((n) => (
                      <SelectItem key={n} value={n}>
                        <div className="flex items-center gap-2">
                          <span>{n}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Dia de vencimento *</Label>
                <Input type="number" min={1} max={31} value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} placeholder="1-31" />
              </div>
              <div>
                <Label>Cor do cartão</Label>
                <Select value={form.card_color} onValueChange={(v) => setForm({ ...form, card_color: v })}>
                  <SelectTrigger>
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded" style={{ backgroundColor: form.card_color }} />
                      <span>{COLOR_OPTIONS.find((c) => c.value === form.card_color)?.label || "Selecione"}</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {COLOR_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-4 rounded" style={{ backgroundColor: c.value }} />
                          <span>{c.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Live preview */}
            <div className="flex flex-col gap-2">
              <Label className="text-muted-foreground">Preview</Label>
              <CardVisual card={previewCard} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : editingCard ? "Salvar" : "Adicionar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteCard} onOpenChange={(open) => { if (!open) setDeleteCard(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cartão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o cartão {deleteCard?.bank_name} •••• {deleteCard?.last_four}? Esta ação pode ser desfeita pela equipe de suporte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
