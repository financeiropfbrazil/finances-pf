import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { setMasterCambio } from "@/services/intercompanyMasterEditService";

interface MasterCambioModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  masterId: string | null;
  numeroInvoice: string | null;
  valorBrl: number | null;
  cambioAtual: number | null;
  valorEurAtual: number | null;
  onSaved: () => void; // callback pra refresh da lista
}

const formatBRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatEUR = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "EUR" });

export function MasterCambioModal({
  open,
  onOpenChange,
  masterId,
  numeroInvoice,
  valorBrl,
  cambioAtual,
  valorEurAtual,
  onSaved,
}: MasterCambioModalProps) {
  const { toast } = useToast();
  const [cambioInput, setCambioInput] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Inicializa input quando o modal abre
  useEffect(() => {
    if (open) {
      setCambioInput(cambioAtual != null ? cambioAtual.toString().replace(".", ",") : "");
    }
  }, [open, cambioAtual]);

  // Parse do input (aceita vírgula e ponto)
  const cambioNumerico = useMemo(() => {
    const cleaned = cambioInput.replace(",", ".").trim();
    if (!cleaned) return null;
    const n = parseFloat(cleaned);
    if (isNaN(n) || n <= 0) return null;
    return n;
  }, [cambioInput]);

  // EUR calculado em tempo real
  const eurCalculado = useMemo(() => {
    if (cambioNumerico == null || valorBrl == null || valorBrl <= 0) return null;
    return valorBrl / cambioNumerico;
  }, [cambioNumerico, valorBrl]);

  const handleSave = async () => {
    if (!masterId || cambioNumerico == null) return;
    setSaving(true);
    try {
      const result = await setMasterCambio({
        masterId,
        cambio: cambioNumerico,
      });
      toast({
        title: "Câmbio atualizado",
        description: `${numeroInvoice}: ${formatEUR(result.valor_eur)} (câmbio ${cambioNumerico.toFixed(4).replace(".", ",")}). ${result.blocos_atualizados} bloco(s) recalculado(s).`,
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Erro ao salvar",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar câmbio — INV {numeroInvoice}</DialogTitle>
          <DialogDescription>
            Defina o câmbio EUR/BRL. O sistema recalcula o valor em EUR, os blocos e os rateios automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs uppercase text-muted-foreground">BRL (do Alvo)</Label>
            <Input value={formatBRL(valorBrl)} readOnly className="font-mono bg-muted/50" />
          </div>

          <div className="space-y-1">
            <Label htmlFor="cambio-input" className="text-xs uppercase text-muted-foreground">
              Câmbio EUR/BRL *
            </Label>
            <Input
              id="cambio-input"
              value={cambioInput}
              onChange={(e) => setCambioInput(e.target.value)}
              placeholder="Ex: 6,1939"
              className="font-mono"
              disabled={saving}
              autoFocus
            />
            <p className="text-[10px] text-muted-foreground italic">
              Aceita vírgula ou ponto. Quantos BRL valem 1 EUR.
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase text-muted-foreground">EUR (calculado)</Label>
            <Input
              value={eurCalculado == null ? "—" : formatEUR(eurCalculado)}
              readOnly
              className="font-mono bg-muted/50 text-emerald-700 font-semibold"
            />
            {cambioAtual != null && cambioNumerico != null && cambioNumerico !== cambioAtual && (
              <p className="text-[10px] text-amber-700 italic">
                Anterior: {formatEUR(valorEurAtual)} (câmbio {cambioAtual.toFixed(4).replace(".", ",")})
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || cambioNumerico == null}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Salvar
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
