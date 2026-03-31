import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  Save,
  Eye,
  EyeOff,
  Plug,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const UF_OPTIONS = [
  { label: "RO", value: "11" },
  { label: "AC", value: "12" },
  { label: "AM", value: "13" },
  { label: "RR", value: "14" },
  { label: "PA", value: "15" },
  { label: "AP", value: "16" },
  { label: "TO", value: "17" },
  { label: "MA", value: "21" },
  { label: "PI", value: "22" },
  { label: "CE", value: "23" },
  { label: "RN", value: "24" },
  { label: "PB", value: "25" },
  { label: "PE", value: "26" },
  { label: "AL", value: "27" },
  { label: "SE", value: "28" },
  { label: "BA", value: "29" },
  { label: "MG", value: "31" },
  { label: "ES", value: "32" },
  { label: "RJ", value: "33" },
  { label: "SP", value: "35" },
  { label: "PR", value: "41" },
  { label: "SC", value: "42" },
  { label: "RS", value: "43" },
  { label: "MS", value: "50" },
  { label: "MT", value: "51" },
  { label: "GO", value: "52" },
  { label: "DF", value: "53" },
];

const ComprasCertificado = () => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Card 1 state
  const [pfxBase64, setPfxBase64] = useState("");
  const [pfxFilename, setPfxFilename] = useState("");
  const [pfxFileSize, setPfxFileSize] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [cnpj, setCnpj] = useState("");
  const [cufAutor, setCufAutor] = useState("35");
  const [tpAmb, setTpAmb] = useState("1");
  const [serviceUrl, setServiceUrl] = useState("https://pef-nfe-service.onrender.com");

  const [apiSecret, setApiSecret] = useState("");
  const [showApiSecret, setShowApiSecret] = useState(false);

  // Card 2 state
  const [validationResult, setValidationResult] = useState<null | { ok: boolean; missing: string[] }>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { success: boolean; elapsed: number; data: any }>(null);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    setPfxBase64(localStorage.getItem("sefaz_pfx_base64") || "");
    setPfxFilename(localStorage.getItem("sefaz_pfx_filename") || "");
    setPassphrase(localStorage.getItem("sefaz_passphrase") || "");
    setCnpj(localStorage.getItem("sefaz_cnpj") || "");
    setCufAutor(localStorage.getItem("sefaz_cuf_autor") || "35");
    setTpAmb(localStorage.getItem("sefaz_tp_amb") || "1");
    setServiceUrl(localStorage.getItem("sefaz_service_url") || "https://pef-nfe-service.onrender.com");
    setApiSecret(localStorage.getItem("sefaz_api_secret") || "");
  }, []);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFile = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pfx" && ext !== "p12") {
      toast({ title: "❌ Arquivo inválido", description: "Selecione um arquivo .pfx ou .p12", variant: "destructive" });
      return;
    }
    setPfxFilename(file.name);
    setPfxFileSize(formatFileSize(file.size));
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setPfxBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleSave = () => {
    localStorage.setItem("sefaz_pfx_base64", pfxBase64);
    localStorage.setItem("sefaz_pfx_filename", pfxFilename);
    localStorage.setItem("sefaz_passphrase", passphrase);
    localStorage.setItem("sefaz_cnpj", cnpj);
    localStorage.setItem("sefaz_cuf_autor", cufAutor);
    localStorage.setItem("sefaz_tp_amb", tpAmb);
    localStorage.setItem("sefaz_service_url", serviceUrl);
    localStorage.setItem("sefaz_api_secret", apiSecret);
    toast({ title: "✅ Configuração salva", description: "Dados do certificado digital salvos com sucesso." });
  };

  const handleTestConnection = async () => {
    const savedPfx = localStorage.getItem("sefaz_pfx_base64");
    const savedPass = localStorage.getItem("sefaz_passphrase");
    const savedCnpj = localStorage.getItem("sefaz_cnpj");
    const savedCuf = localStorage.getItem("sefaz_cuf_autor");
    const savedUrl = localStorage.getItem("sefaz_service_url") || "https://pef-nfe-service.onrender.com";
    const savedSecret = localStorage.getItem("sefaz_api_secret") || "";
    const savedTpAmb = localStorage.getItem("sefaz_tp_amb") || "1";

    const missing: string[] = [];
    if (!savedPfx) missing.push("Certificado Digital (.pfx)");
    if (!savedPass) missing.push("Senha do Certificado");
    if (!savedCnpj) missing.push("CNPJ");
    if (!savedCuf) missing.push("UF do Autor");

    if (missing.length > 0) {
      setValidationResult({ ok: false, missing });
      setTestResult(null);
      return;
    }

    setValidationResult({ ok: true, missing: [] });
    setIsTesting(true);
    setTestResult(null);

    const cleanCnpj = savedCnpj!.replace(/\D/g, "");
    const start = Date.now();

    try {
      const res = await fetch(`${savedUrl}/api/test-certificate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(savedSecret ? { "x-api-secret": savedSecret } : {}),
        },
        body: JSON.stringify({
          pfxBase64: savedPfx,
          passphrase: savedPass,
          cnpj: cleanCnpj,
          cUFAutor: savedCuf,
          tpAmb: savedTpAmb,
        }),
      });

      const data = await res.json();
      const elapsed = Date.now() - start;

      setTestResult({ success: !!data.success, elapsed, data });

      if (data.success) {
        toast({ title: "✅ Conexão Estabelecida", description: data.message || "Certificado validado com sucesso." });
      } else {
        toast({ title: "❌ Falha na Conexão", description: data.message || "Verifique o certificado e tente novamente.", variant: "destructive" });
      }
    } catch (err: any) {
      const elapsed = Date.now() - start;
      setTestResult({ success: false, elapsed, data: { error: err.message } });
      toast({ title: "❌ Erro de Rede", description: err.message, variant: "destructive" });
    } finally {
      setIsTesting(false);
    }
  };

  const savedCnpj = localStorage.getItem("sefaz_cnpj");
  const savedCuf = localStorage.getItem("sefaz_cuf_autor");
  const savedAmb = localStorage.getItem("sefaz_tp_amb");
  const ufLabel = UF_OPTIONS.find((u) => u.value === savedCuf)?.label;
  const isConfigured = !!(localStorage.getItem("sefaz_pfx_base64") && localStorage.getItem("sefaz_passphrase") && savedCnpj && savedCuf);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Certificado Digital</h1>
        <p className="text-muted-foreground">Configuração e teste de conexão com SEFAZ</p>
      </div>

      {/* Card 1 */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Certificado Digital A1</CardTitle>
              <CardDescription className="mt-1">
                Faça upload do certificado digital .pfx (A1) e configure os dados para conexão com o SEFAZ
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* File upload */}
          <div className="space-y-2">
            <Label>Arquivo do Certificado (.pfx / .p12)</Label>
            <div
              className={`relative flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-6 transition-colors ${
                isDragging ? "border-primary bg-primary/5" : "border-input hover:border-primary/50"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
              {pfxFilename ? (
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">{pfxFilename}</p>
                  {pfxFileSize && <p className="text-xs text-muted-foreground">{pfxFileSize}</p>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Arraste o arquivo aqui ou clique para selecionar
                </p>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pfx,.p12"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-2">
            <Label htmlFor="cert-password">Senha do Certificado</Label>
            <div className="relative">
              <Input
                id="cert-password"
                type={showPassword ? "text" : "password"}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="••••••••"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* CNPJ */}
            <div className="space-y-2">
              <Label htmlFor="cert-cnpj">CNPJ</Label>
              <Input
                id="cert-cnpj"
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                placeholder="00.000.000/0000-00"
              />
            </div>

            {/* UF */}
            <div className="space-y-2">
              <Label>UF do Autor</Label>
              <Select value={cufAutor} onValueChange={setCufAutor}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a UF" />
                </SelectTrigger>
                <SelectContent>
                  {UF_OPTIONS.map((uf) => (
                    <SelectItem key={uf.value} value={uf.value}>
                      {uf.label} ({uf.value})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Ambiente */}
          <div className="space-y-2">
            <Label>Ambiente</Label>
            <Select value={tpAmb} onValueChange={setTpAmb}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Produção</SelectItem>
                <SelectItem value="2">Homologação</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Service URL */}
          <div className="space-y-2">
            <Label htmlFor="service-url">URL do Serviço</Label>
            <Input
              id="service-url"
              value={serviceUrl}
              onChange={(e) => setServiceUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Endereço do microsserviço NF-e. Altere apenas para testes.
            </p>
          </div>

          {/* API Secret */}
          <div className="space-y-2">
            <Label htmlFor="api-secret">API Secret</Label>
            <div className="relative">
              <Input
                id="api-secret"
                type={showApiSecret ? "text" : "password"}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Chave de autenticação do microsserviço"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                onClick={() => setShowApiSecret(!showApiSecret)}
              >
                {showApiSecret ? (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Eye className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Configurado no painel do Render como API_SECRET.
            </p>
          </div>

          <div className="pt-2">
            <Button onClick={handleSave} className="gap-2">
              <Save className="h-4 w-4" />
              Salvar Configuração
            </Button>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Card 2 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Teste de Conexão com SEFAZ</CardTitle>
          <CardDescription className="mt-1">
            Valide se o certificado está configurado corretamente testando a conexão com o SEFAZ
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConfigured ? (
            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <p><span className="font-medium">CNPJ:</span> {savedCnpj}</p>
              <p><span className="font-medium">UF:</span> {ufLabel} ({savedCuf})</p>
              <p><span className="font-medium">Ambiente:</span> {savedAmb === "1" ? "Produção" : "Homologação"}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Configure o certificado acima antes de testar.
            </div>
          )}

          <Button onClick={handleTestConnection} className="gap-2" disabled={isTesting}>
            {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            {isTesting ? "Testando..." : "Testar Conexão"}
          </Button>

          {validationResult && !validationResult.ok && (
            <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
              <div className="space-y-2">
                <Badge variant="outline" className="gap-1 border-destructive text-destructive">
                  <XCircle className="h-3 w-3" /> Configuração Incompleta
                </Badge>
                <ul className="ml-4 list-disc text-sm text-muted-foreground">
                  {validationResult.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {testResult && (
            <div className="rounded-md border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center gap-3">
                {testResult.success ? (
                  <Badge variant="outline" className="gap-1 border-green-500 text-green-600">
                    <CheckCircle2 className="h-3 w-3" /> Conexão Estabelecida
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-destructive text-destructive">
                    <XCircle className="h-3 w-3" /> Falha na Conexão
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">{testResult.elapsed} ms</span>
              </div>
              <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs">
                <code>{JSON.stringify(testResult.data, null, 2)}</code>
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ComprasCertificado;
