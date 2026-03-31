import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/contexts/PeriodContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Download, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface CommodatumContract {
  id: string;
  period_id: string;
  contract_name: string;
  start_date: string;
  end_date: string | null;
  value: number;
  status: string;
  object_description: string;
  file_path: string | null;
  file_name: string | null;
  notes: string | null;
}

export function CommodatumSection() {
  const { selectedPeriod } = usePeriod();
  const { t } = useLanguage();
  const [contracts, setContracts] = useState<CommodatumContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [contractName, setContractName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("ativo");
  const [objectDesc, setObjectDesc] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchContracts = useCallback(async () => {
    if (!selectedPeriod) return;
    setLoading(true);
    const { data } = await supabase
      .from("commodatum_contracts")
      .select("*")
      .eq("period_id", selectedPeriod.id)
      .order("start_date", { ascending: false });
    setContracts((data as unknown as CommodatumContract[]) ?? []);
    setLoading(false);
  }, [selectedPeriod]);

  useEffect(() => { fetchContracts(); }, [fetchContracts]);

  const resetForm = () => {
    setContractName("");
    setStartDate("");
    setEndDate("");
    setValue("");
    setStatus("ativo");
    setObjectDesc("");
    setFile(null);
  };

  const handleSave = async () => {
    if (!selectedPeriod || !contractName.trim() || !startDate) {
      toast.error("Preencha os campos obrigatórios");
      return;
    }
    setSaving(true);

    let filePath: string | null = null;
    let fileName: string | null = null;

    if (file) {
      const ext = file.name.split(".").pop();
      const path = `${selectedPeriod.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("contracts")
        .upload(path, file);
      if (uploadError) {
        toast.error(uploadError.message);
        setSaving(false);
        return;
      }
      filePath = path;
      fileName = file.name;
    }

    const { error } = await supabase.from("commodatum_contracts").insert({
      period_id: selectedPeriod.id,
      contract_name: contractName.trim(),
      start_date: startDate,
      end_date: endDate || null,
      value: parseFloat(value) || 0,
      status,
      object_description: objectDesc.trim(),
      file_path: filePath,
      file_name: fileName,
    });

    if (error) {
      toast.error(error.message);
      setSaving(false);
      return;
    }

    toast.success(t("cash.saved"));
    setSaving(false);
    setDialogOpen(false);
    resetForm();
    fetchContracts();
  };

  const handleDelete = async (c: CommodatumContract) => {
    if (c.file_path) {
      await supabase.storage.from("contracts").remove([c.file_path]);
    }
    const { error } = await supabase.from("commodatum_contracts").delete().eq("id", c.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("cash.deleted"));
    fetchContracts();
  };

  const handleDownload = async (c: CommodatumContract) => {
    if (!c.file_path) return;
    const { data, error } = await supabase.storage
      .from("contracts")
      .createSignedUrl(c.file_path, 60);
    if (error || !data?.signedUrl) {
      toast.error("Erro ao gerar link de download");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5 text-primary" />
          {t("com.title")}
        </CardTitle>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t("com.add")}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : contracts.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">{t("com.no_contracts")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("com.contract_name")}</TableHead>
                <TableHead>{t("com.start_date")}</TableHead>
                <TableHead>{t("com.end_date")}</TableHead>
                <TableHead className="text-right">{t("com.value")}</TableHead>
                <TableHead>{t("com.status")}</TableHead>
                <TableHead>{t("com.object")}</TableHead>
                <TableHead>{t("com.file")}</TableHead>
                <TableHead className="w-[80px]">{t("cash.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.contract_name}</TableCell>
                  <TableCell>{new Date(c.start_date + "T00:00").toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell>
                    {c.end_date ? new Date(c.end_date + "T00:00").toLocaleDateString("pt-BR") : "—"}
                  </TableCell>
                  <TableCell className="text-right">{formatBRL(c.value)}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === "ativo" ? "default" : "secondary"}>
                      {t(`com.st.${c.status}` as any)}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">{c.object_description || "—"}</TableCell>
                  <TableCell>
                    {c.file_path ? (
                      <Button variant="ghost" size="sm" onClick={() => handleDownload(c)}>
                        <Download className="h-4 w-4" />
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(c)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Add Contract Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("com.add")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">{t("com.contract_name")} *</Label>
              <Input value={contractName} onChange={(e) => setContractName(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">{t("com.start_date")} *</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("com.end_date")}</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">{t("com.value")} *</Label>
                <Input type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("com.status")}</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">{t("com.st.ativo")}</SelectItem>
                    <SelectItem value="encerrado">{t("com.st.encerrado")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("com.object")}</Label>
              <Textarea
                value={objectDesc}
                onChange={(e) => setObjectDesc(e.target.value)}
                placeholder="Descrição dos bens em comodato..."
                rows={2}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("com.upload")}</Label>
              <Input
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => { setDialogOpen(false); resetForm(); }}>
                {t("cash.cancel")}
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "..." : t("cash.save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
