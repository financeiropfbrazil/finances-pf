import { useState, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { authenticateAlvo, getAlvoToken, clearAlvoToken } from "@/services/alvoService";
import { Download, Upload, FileSpreadsheet, CheckCircle2, AlertCircle, XCircle, Loader2 } from "lucide-react";

interface UploadedRow {
  CNPJ: string;
  "Razão Social": string;
  "Código Alternativo": string;
  cnpjLimpo?: string;
  codAlt?: string;
  entidade?: {
    codigo_entidade: string;
    cnpj: string;
    nome: string;
    codigo_alternativo: string | null;
  } | null;
  status?: "igual" | "atualizar" | "não encontrada";
}

export default function EntidadesUploadCodigos() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [uploadedRows, setUploadedRows] = useState<UploadedRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);

  const handleDownloadModelo = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([["CNPJ", "Razão Social", "Código Alternativo"]]);
    ws["!cols"] = [{ wch: 20 }, { wch: 50 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Planilha1");
    XLSX.writeFile(wb, "codigos-alternativos-modelo.xlsx");
  };

  const matchRows = async (rows: any[]) => {
    const cnpjs = rows.map(r => (r.CNPJ || "").toString().replace(/\D/g, ""));
    const { data: entidades } = await supabase
      .from("compras_entidades_cache")
      .select("codigo_entidade, cnpj, nome, codigo_alternativo")
      .in("cnpj", cnpjs) as any;

    const entMap = new Map((entidades || []).map((e: any) => [e.cnpj, e]));

    return rows.map(r => {
      const cnpjLimpo = (r.CNPJ || "").toString().replace(/\D/g, "");
      const ent = entMap.get(cnpjLimpo) as any;
      const fileCodAlt = r["Código Alternativo"]?.toString() || "";
      
      let status: "igual" | "atualizar" | "não encontrada" = "não encontrada";
      if (ent) {
        status = ent.codigo_alternativo === fileCodAlt ? "igual" : "atualizar";
      }

      return {
        ...r,
        cnpjLimpo,
        codAlt: fileCodAlt,
        entidade: ent || null,
        status,
      };
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws);
      
      // Filtrar linhas vazias
      const valid = rows.filter(r => r.CNPJ && r["Código Alternativo"]);
      const matched = await matchRows(valid);
      setUploadedRows(matched);
      
      toast({
        title: "Arquivo processado",
        description: `${matched.length} linhas encontradas.`,
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "Erro ao processar arquivo",
        description: "Verifique se o formato do arquivo está correto.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      // Reset input
      event.target.value = "";
    }
  };

  const gravarNoAlvo = async (codigoEntidade: string, codAlternativo: string): Promise<{ success: boolean; error?: string }> => {
    const { authenticateAlvo, clearAlvoToken } = await import("@/services/alvoService");
    const ERP = "https://pef.it4you.inf.br/api";
    const MAX_RETRIES = 3;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (attempt === 1) clearAlvoToken();
      const auth = await authenticateAlvo();
      if (!auth.token) return { success: false, error: "Falha na autenticação" };

      const resp = await fetch(`${ERP}/Entidade/SavePartial`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "riosoft-token": auth.token },
        body: JSON.stringify({
          Codigo: codigoEntidade,
          CodigoAlternativo: codAlternativo,
          SavePartialEndereco: false,
          ValidacaoParcial: false,
        }),
      });

      if (resp.status === 409) {
        clearAlvoToken();
        await new Promise(r => setTimeout(r, 1000 * attempt));
        continue;
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        let msg = `HTTP ${resp.status}`;
        try { msg = JSON.parse(text).Message || msg; } catch {}
        return { success: false, error: msg };
      }

      return { success: true };
    }
    return { success: false, error: "Conflito de sessão persistente (409)" };
  };

  const handleApplyChanges = async () => {
    const rowsToUpdate = uploadedRows.filter(r => r.status === "atualizar");
    if (rowsToUpdate.length === 0) {
      toast({
        title: "Nada para atualizar",
        description: "Todas as linhas já estão iguais ou não foram encontradas.",
      });
      return;
    }

    setProcessing(true);
    setProgress(0);

    try {
      const { authenticateAlvo, clearAlvoToken } = await import("@/services/alvoService");
      const ERP = "https://pef.it4you.inf.br/api";

      clearAlvoToken();
      let auth = await authenticateAlvo();
      if (!auth.token) {
        toast({ title: "❌ Falha na autenticação ERP", variant: "destructive" });
        setProcessing(false);
        return;
      }

      let updated = 0;
      let errors = 0;

      for (let i = 0; i < rowsToUpdate.length; i++) {
        const row = rowsToUpdate[i];
        
        // Gravar no Alvo com retry
        let success = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          const resp = await fetch(`${ERP}/Entidade/SavePartial`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "riosoft-token": auth.token! },
            body: JSON.stringify({
              Codigo: row.entidade!.codigo_entidade,
              CodigoAlternativo: row.codAlt,
              SavePartialEndereco: false,
              ValidacaoParcial: false,
            }),
          });

          if (resp.status === 409) {
            clearAlvoToken();
            auth = await authenticateAlvo();
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
          if (resp.ok) {
            success = true;
            break;
          }
          break;
        }

        if (success) {
          // 2. Atualizar no Supabase Cache (upsert para evitar CORS com PATCH)
          const { data: current } = await supabase
            .from("compras_entidades_cache")
            .select("*")
            .eq("codigo_entidade", row.entidade!.codigo_entidade)
            .maybeSingle();

          const sbError = current
            ? (await supabase.from("compras_entidades_cache").upsert({
                ...current,
                codigo_alternativo: row.codAlt,
                updated_at: new Date().toISOString(),
              }, { onConflict: "codigo_entidade" })).error
            : null;

          if (!sbError) {
            updated++;
          } else {
            console.error(`Erro no Supabase for ${row.CNPJ}:`, sbError);
            errors++;
          }
        } else {
          errors++;
        }
        
        setProgress(Math.round(((i + 1) / rowsToUpdate.length) * 100));
      }

      toast({
        title: "Processamento concluído",
        description: `${updated} atualizados, ${errors} erros.`,
      });

      // Refresh data
      const refreshed = await matchRows(uploadedRows);
      setUploadedRows(refreshed);
    } catch (error: any) {
      toast({
        title: "Erro no processamento",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
      setProgress(0);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Upload de Códigos Alternativos</h1>
        <p className="text-muted-foreground">Atualize os códigos alternativos das entidades em massa via planilha Excel</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">1. Download do modelo</CardTitle>
            <CardDescription>Baixe a planilha modelo para preencher com os dados das entidades.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleDownloadModelo} variant="outline" className="w-full gap-2">
              <Download className="h-4 w-4" />
              Baixar Planilha Modelo
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">2. Upload de arquivo</CardTitle>
            <CardDescription>Selecione o arquivo .xlsx preenchido para validação.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <input
                type="file"
                accept=".xlsx"
                onChange={handleFileUpload}
                className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                disabled={loading || processing}
              />
              <Button variant="secondary" className="w-full gap-2" disabled={loading || processing}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {loading ? "Processando..." : "Selecionar Arquivo"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {uploadedRows.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">3. Preview e Match</CardTitle>
              <CardDescription>Verifique os dados antes de aplicar as alterações.</CardDescription>
            </div>
            <Button 
              onClick={handleApplyChanges} 
              disabled={processing || !uploadedRows.some(r => r.status === "atualizar")}
              className="gap-2"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Aplicar Alterações
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {processing && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Processando atualizações...</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            )}

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">#</TableHead>
                    <TableHead>CNPJ (arquivo)</TableHead>
                    <TableHead>Razão Social (arquivo)</TableHead>
                    <TableHead>Cód. Alternativo</TableHead>
                    <TableHead>Entidade Encontrada</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploadedRows.map((row, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{index + 1}</TableCell>
                      <TableCell>{row.CNPJ}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={row["Razão Social"]}>
                        {row["Razão Social"]}
                      </TableCell>
                      <TableCell>{row.codAlt}</TableCell>
                      <TableCell>
                        {row.entidade ? (
                          <div className="flex flex-col">
                            <span className="text-xs font-medium">{row.entidade.nome}</span>
                            <span className="text-[10px] text-muted-foreground">{row.entidade.codigo_entidade}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Não encontrada</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.status === "igual" && (
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Igual
                          </Badge>
                        )}
                        {row.status === "atualizar" && (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1">
                            <AlertCircle className="h-3 w-3" /> Atualizar
                          </Badge>
                        )}
                        {row.status === "não encontrada" && (
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1">
                            <XCircle className="h-3 w-3" /> Não encontrada
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
