import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FlaskConical, Play, Loader2, Clock, CheckCircle2, XCircle, Copy, Trash2 } from "lucide-react";
import { type ApiTestResult, getAlvoToken, authenticateAlvo } from "@/services/alvoService";
import { useToast } from "@/hooks/use-toast";

const STORAGE_KEY = "api-tester-last-query";

const DEFAULT_PAYLOAD = JSON.stringify(
  {
    DataIni: "2020-01-01",
    DataFim: "2026-12-31",
  },
  null,
  2,
);

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as { endpoint: string; method: "GET" | "POST"; payload: string; queryString?: string };
  } catch {}
  return null;
}

export default function ApiTester() {
  const { toast } = useToast();
  const saved = loadSaved();
  const [endpoint, setEndpoint] = useState(saved?.endpoint ?? "DocFin/GetListaRelatorio");
  const [method, setMethod] = useState<"GET" | "POST">(saved?.method ?? "POST");
  const [payload, setPayload] = useState(saved?.payload ?? DEFAULT_PAYLOAD);
  const [queryString, setQueryString] = useState(saved?.queryString ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiTestResult | null>(null);

  const handleTest = async () => {
    setLoading(true);
    setResult(null);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ endpoint, method, payload, queryString }));
    const start = Date.now();
    try {
      // Ensure we have a valid token
      let token = getAlvoToken();
      if (!token) {
        const auth = await authenticateAlvo();
        if (!auth.success || !auth.token) {
          setResult({ success: false, duration_ms: Date.now() - start, error: auth.error || "Falha ao obter token.", error_code: "AUTH_FAILED" });
          setLoading(false);
          return;
        }
        token = auth.token;
      }

      const qs = method === "GET" && queryString.trim() ? `?${queryString.trim()}` : "";
      const url = `https://pef.it4you.inf.br/api/${endpoint}${qs}`;
      let parsedPayload: unknown;
      if (method === "POST" && payload?.trim()) {
        try { parsedPayload = JSON.parse(payload.trim()); } catch { parsedPayload = payload.trim(); }
      }

      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "riosoft-token": token },
        ...(method === "POST" ? { body: JSON.stringify(parsedPayload) } : {}),
      });

      const duration_ms = Date.now() - start;
      const text = await resp.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch { data = text; }

      if (!resp.ok) {
        setResult({ success: false, duration_ms, status: resp.status, error: `HTTP ${resp.status}`, error_code: "ERP_API_ERROR", data, raw: typeof data === "string" ? data : JSON.stringify(data, null, 2) });
      } else {
        setResult({ success: true, status: resp.status, duration_ms, data, raw: typeof data === "string" ? data : JSON.stringify(data, null, 2) });
      }
    } catch (err: any) {
      setResult({ success: false, duration_ms: Date.now() - start, error: err.message || "Erro de rede", error_code: "NETWORK_ERROR" });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    const text = result?.raw || (result ? JSON.stringify({ error: result.error, error_code: result.error_code }, null, 2) : null);
    if (text) {
      navigator.clipboard.writeText(text);
      toast({ title: "Copiado!", description: "Resposta copiada para a área de transferência." });
    }
  };

  const responseText = result
    ? result.raw || JSON.stringify({ error: result.error, error_code: result.error_code }, null, 2)
    : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Laboratório de API</CardTitle>
              <CardDescription className="mt-1">
                Teste qualquer endpoint do ERP Alvo em conexão direta
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Endpoint + Method */}
          <div className="flex gap-3">
            <div className="w-32 shrink-0">
              <Label className="mb-1.5 block text-xs text-muted-foreground">Método</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as "GET" | "POST")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label className="mb-1.5 block text-xs text-muted-foreground">Endpoint</Label>
              <Input
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="DocFin/GetListaRelatorio"
                className="font-mono text-sm"
              />
            </div>
          </div>

          {/* Payload (POST) or Query String (GET) */}
          {method === "POST" ? (
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Payload (JSON)</Label>
              <Textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                rows={8}
                className="font-mono text-sm resize-y"
                placeholder='{ "chave": "valor" }'
              />
            </div>
          ) : (
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Parâmetros da URL (Query String)</Label>
              <Input
                value={queryString}
                onChange={(e) => setQueryString(e.target.value)}
                placeholder="codigo=1&loadParent=All"
                className="font-mono text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Será anexado à URL: .../{endpoint}?{queryString || "param=valor"}
              </p>
            </div>
          )}

          {/* Action */}
          <Button onClick={handleTest} disabled={loading || !endpoint.trim()} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {loading ? "Aguardando resposta…" : "Testar Requisição"}
          </Button>
        </CardContent>
      </Card>

      {/* Response area */}
      {result && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {result.success ? (
                  <Badge variant="outline" className="gap-1 border-success text-success">
                    <CheckCircle2 className="h-3 w-3" /> Sucesso
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 border-destructive text-destructive">
                    <XCircle className="h-3 w-3" /> Erro
                  </Badge>
                )}
                {result.error_code && (
                  <Badge variant="secondary" className="font-mono text-xs">
                    {result.error_code}
                  </Badge>
                )}
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" /> {result.duration_ms}ms
                </span>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy} title="Copiar">
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setResult(null)}
                  title="Limpar"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="max-h-[500px] overflow-auto rounded-md bg-muted/50 p-4">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                <code>{responseText}</code>
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
