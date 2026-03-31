import { useState, useCallback, useRef, useEffect } from "react";
import { usePeriod } from "@/contexts/PeriodContext";
import { supabase } from "@/integrations/supabase/client";
import { parseBalancete, saveBalancete, distributeToModules, type BalanceteAccount } from "@/services/balanceteParser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  ClipboardCheck, Upload, FileSpreadsheet, Loader2, CheckCircle2,
  AlertTriangle, XCircle, Clock, ArrowRight,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

interface UploadRecord {
  id: string;
  file_name: string;
  total_accounts: number;
  total_analytical: number;
  status: string;
  created_at: string;
}

interface ModuleStatus {
  name: string;
  label: string;
  route: string;
  enabled: boolean;
  accountsMapped: number;
  accountingBalance: number;
  managementBalance: number;
  difference: number;
  status: string;
}

export default function Closing() {
  const { selectedPeriod } = usePeriod();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [parsed, setParsed] = useState<BalanceteAccount[] | null>(null);
  const [parsedFileName, setParsedFileName] = useState("");
  const [existingUpload, setExistingUpload] = useState<UploadRecord | null>(null);
  const [moduleStatuses, setModuleStatuses] = useState<ModuleStatus[]>([]);
  const [distributeResult, setDistributeResult] = useState<{ modulesUpdated: string[]; errors: string[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const periodLabel = selectedPeriod
    ? `${MONTH_NAMES[selectedPeriod.month - 1]}/${selectedPeriod.year}`
    : "";

  // Load existing upload and module statuses
  const loadData = useCallback(async () => {
    if (!selectedPeriod) return;

    const [uploadRes, reconRes] = await Promise.all([
      supabase
        .from("balancete_uploads")
        .select("id, file_name, total_accounts, total_analytical, status, created_at")
        .eq("period_id", selectedPeriod.id)
        .maybeSingle(),
      supabase
        .from("fixed_assets_reconciliation")
        .select("account_asset, accounting_balance_asset, accounting_balance_depreciation, accounting_net, net_value, difference, status")
        .eq("period_id", selectedPeriod.id),
    ]);

    if (uploadRes.data) {
      setExistingUpload(uploadRes.data as unknown as UploadRecord);
    } else {
      setExistingUpload(null);
    }

    // Build module statuses
    const faRecon = reconRes.data ?? [];
    const faEnabled = faRecon.length > 0;
    const faAccountsMapped = faRecon.filter(r => Number(r.accounting_balance_asset ?? 0) !== 0 || Number(r.accounting_balance_depreciation ?? 0) !== 0).length;
    const faAccBal = faRecon.reduce((s, r) => s + Number(r.accounting_net ?? 0), 0);
    const faMgmtBal = faRecon.reduce((s, r) => s + Number(r.net_value ?? 0), 0);
    const faDiff = faRecon.reduce((s, r) => s + Number(r.difference ?? 0), 0);
    const faAllReconciled = faRecon.length > 0 && faRecon.every(r => r.status === "reconciled");
    const faAnyDivergent = faRecon.some(r => r.status === "divergent");
    const faStatus = !faEnabled ? "pending" : faAllReconciled ? "reconciled" : faAnyDivergent ? "divergent" : "justified";

    setModuleStatuses([
      {
        name: "fixed_assets", label: "Imobilizado", route: "/fixed-assets/reconciliation",
        enabled: true, accountsMapped: faAccountsMapped,
        accountingBalance: faAccBal, managementBalance: faMgmtBal,
        difference: faDiff, status: faStatus,
      },
      { name: "cash", label: "Caixa e Bancos", route: "/cash", enabled: false, accountsMapped: 0, accountingBalance: 0, managementBalance: 0, difference: 0, status: "soon" },
      { name: "receivables", label: "Contas a Receber", route: "/receivables", enabled: false, accountsMapped: 0, accountingBalance: 0, managementBalance: 0, difference: 0, status: "soon" },
      { name: "suppliers", label: "Fornecedores", route: "/suppliers", enabled: false, accountsMapped: 0, accountingBalance: 0, managementBalance: 0, difference: 0, status: "soon" },
    ]);
  }, [selectedPeriod]);

  useEffect(() => { loadData(); }, [loadData]);

  // Handle file selection
  const handleFile = async (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) {
      toast.error("Formato inválido. Selecione um arquivo .xlsx ou .xls");
      return;
    }

    setParsing(true);
    setParsed(null);
    setDistributeResult(null);

    try {
      const accounts = await parseBalancete(file);
      setParsed(accounts);
      setParsedFileName(file.name);
      toast.success(`${accounts.length} contas encontradas, ${accounts.filter(a => a.account_type === "A").length} analíticas`);
    } catch (err: any) {
      toast.error(err.message || "Erro ao parsear o balancete");
    } finally {
      setParsing(false);
    }
  };

  const handleConfirmAndDistribute = async () => {
    if (!selectedPeriod || !parsed) return;
    setSaving(true);

    try {
      const { uploadId, totalAccounts, totalAnalytical } = await saveBalancete(
        selectedPeriod.id, parsedFileName, parsed
      );

      toast.success(`${totalAccounts} contas salvas (${totalAnalytical} analíticas)`);

      const result = await distributeToModules(selectedPeriod.id, uploadId);
      setDistributeResult(result);

      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} erro(s) na distribuição`);
      } else {
        toast.success(`Saldos distribuídos: ${result.modulesUpdated.join(", ")}`);
      }

      setParsed(null);
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar balancete");
    } finally {
      setSaving(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === "reconciled") return <CheckCircle2 className="h-4 w-4 text-success" />;
    if (status === "justified") return <AlertTriangle className="h-4 w-4 text-warning" />;
    if (status === "divergent") return <XCircle className="h-4 w-4 text-destructive" />;
    if (status === "soon") return <Clock className="h-4 w-4 text-muted-foreground" />;
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  };

  const statusLabel = (status: string) => {
    if (status === "reconciled") return "Conciliado";
    if (status === "justified") return "Justificado";
    if (status === "divergent") return "Divergente";
    if (status === "soon") return "Em breve";
    return "Pendente";
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Fechamento Mensal</h1>
            <p className="text-sm text-muted-foreground">Período: {periodLabel}</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={parsing || saving}
        >
          {parsing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
          Upload Balancete
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {/* Existing upload banner */}
      {existingUpload && !parsed && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              <span className="text-sm text-foreground">
                Balancete de <strong>{periodLabel}</strong> importado em{" "}
                {new Date(existingUpload.created_at).toLocaleDateString("pt-BR")}
                {" — "}
                <span className="text-muted-foreground">
                  {existingUpload.file_name} ({existingUpload.total_accounts} contas, {existingUpload.total_analytical} analíticas)
                </span>
              </span>
            </div>
            <Badge variant="outline" className="text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Importado
            </Badge>
          </CardContent>
        </Card>
      )}

      {/* Upload card (drag & drop) — shown when no parsed data */}
      {!parsed && !existingUpload && (
        <Card
          className={`border-2 border-dashed transition-colors cursor-pointer ${
            dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
            {parsing ? (
              <>
                <Loader2 className="h-10 w-10 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Processando balancete...</p>
              </>
            ) : (
              <>
                <Upload className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm text-foreground font-medium">Arraste o arquivo do balancete aqui</p>
                <p className="text-xs text-muted-foreground">ou clique para selecionar (.xlsx, .xls)</p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Parsed preview */}
      {parsed && (
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              {parsedFileName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Badge variant="secondary" className="text-xs">
                {parsed.length} contas
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {parsed.filter(a => a.account_type === "A").length} analíticas
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {parsed.filter(a => a.account_type === "S").length} sintéticas
              </Badge>
            </div>
            {existingUpload && (
              <p className="text-xs text-warning flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Novo upload substituirá o balancete importado anteriormente.
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleConfirmAndDistribute} disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                Confirmar e Distribuir
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setParsed(null)} disabled={saving}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Distribution result */}
      {distributeResult && (
        <Card className={distributeResult.errors.length > 0 ? "border-destructive/30" : "border-success/30"}>
          <CardContent className="p-4 space-y-2">
            {distributeResult.modulesUpdated.map(m => (
              <p key={m} className="text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="font-medium">{m === "fixed_assets" ? "Imobilizado" : m}</span>: contas atualizadas
              </p>
            ))}
            {distributeResult.errors.map((err, i) => (
              <p key={i} className="text-sm flex items-center gap-2 text-destructive">
                <XCircle className="h-4 w-4" />
                {err}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Module status table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Status dos Módulos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Módulo</TableHead>
                  <TableHead className="text-xs text-center">Contas</TableHead>
                  <TableHead className="text-xs text-right">Saldo Contábil</TableHead>
                  <TableHead className="text-xs text-right">Saldo Gerencial</TableHead>
                  <TableHead className="text-xs text-right">Diferença</TableHead>
                  <TableHead className="text-xs text-center">Status</TableHead>
                  <TableHead className="text-xs w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {moduleStatuses.map(mod => (
                  <TableRow key={mod.name} className={!mod.enabled ? "opacity-50" : ""}>
                    <TableCell className="text-xs font-medium">
                      {mod.enabled ? (
                        <button
                          className="text-primary hover:underline cursor-pointer"
                          onClick={() => navigate(mod.route)}
                        >
                          {mod.label}
                        </button>
                      ) : (
                        mod.label
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-center">
                      {mod.enabled ? mod.accountsMapped : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-right">
                      {mod.enabled ? formatBRL(mod.accountingBalance) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-right">
                      {mod.enabled ? formatBRL(mod.managementBalance) : "—"}
                    </TableCell>
                    <TableCell className={`text-xs text-right font-semibold ${mod.difference === 0 ? "text-success" : "text-destructive"}`}>
                      {mod.enabled ? formatBRL(mod.difference) : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <StatusIcon status={mod.status} />
                        <span className="text-[10px] text-muted-foreground">{statusLabel(mod.status)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {mod.enabled && (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => navigate(mod.route)}>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Upload history */}
      {existingUpload && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Histórico de Uploads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Data</TableHead>
                    <TableHead className="text-xs">Arquivo</TableHead>
                    <TableHead className="text-xs text-center">Contas</TableHead>
                    <TableHead className="text-xs text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-xs">
                      {new Date(existingUpload.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{existingUpload.file_name}</TableCell>
                    <TableCell className="text-xs text-center">
                      {existingUpload.total_accounts} ({existingUpload.total_analytical} analíticas)
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={existingUpload.status === "completed" ? "default" : "destructive"}
                        className="text-[10px]"
                      >
                        {existingUpload.status === "completed" ? "✅ Completo" : existingUpload.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
