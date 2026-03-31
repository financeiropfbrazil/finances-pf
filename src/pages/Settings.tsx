import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plug, CheckCircle2, XCircle, Loader2, Save, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { authenticateAlvo, clearAlvoToken } from "@/services/alvoService";
import { syncCondicoesPagamento } from "@/services/alvoCondPagService";
import { syncEntidades } from "@/services/alvoEntidadeService";
import { syncProdutos } from "@/services/alvoProdutoService";
import { supabase } from "@/integrations/supabase/client";
import ApiTester from "@/components/ApiTester";

function formatSyncInfo(ts: string | null, count: string | null, label: string) {
  if (!ts) return "Nunca sincronizado.";
  const d = new Date(ts);
  const date = d.toLocaleDateString("pt-BR");
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `Última sincronização: ${date} às ${time}${count ? ` — ${count} ${label}` : ""}`;
}

export default function Settings() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<"idle" | "success" | "error">("idle");
  const [syncingCondPag, setSyncingCondPag] = useState(false);
  const [syncEntLoading, setSyncEntLoading] = useState(false);
  const [syncEntProgress, setSyncEntProgress] = useState("");
  const [syncProdLoading, setSyncProdLoading] = useState(false);
  const [syncProdProgress, setSyncProdProgress] = useState("");
  // Sync metadata
  const [syncMeta, setSyncMeta] = useState<Record<string, string>>({});
  // ERP credentials state
  const [erpUser, setErpUser] = useState("");
  const [erpPassword, setErpPassword] = useState("");
  const [erpIntegrationUser, setErpIntegrationUser] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Audit App config state
  const [auditUrl, setAuditUrl] = useState("");
  const [auditAnonKey, setAuditAnonKey] = useState("");

  const loadSyncMeta = useCallback(async () => {
    const { data } = await supabase
      .from("compras_config")
      .select("chave, valor")
      .in("chave", ["sync_entidades_ts", "sync_entidades_count", "sync_produtos_ts", "sync_produtos_count"]);
    if (data) {
      const map: Record<string, string> = {};
      data.forEach(r => { if (r.valor) map[r.chave] = r.valor; });
      setSyncMeta(map);
    }
  }, []);

  useEffect(() => {
    setErpUser(localStorage.getItem("alvo_username") || "");
    setErpPassword(localStorage.getItem("alvo_password") || "");
    setErpIntegrationUser(localStorage.getItem("alvo_user_integration") || "");
    setAuditUrl(localStorage.getItem("audit_app_supabase_url") || "");
    setAuditAnonKey(localStorage.getItem("audit_app_supabase_anon_key") || "");
    loadSyncMeta();
  }, [loadSyncMeta]);

  const handleSaveCredentials = () => {
    localStorage.setItem("alvo_username", erpUser);
    localStorage.setItem("alvo_password", erpPassword);
    localStorage.setItem("alvo_user_integration", erpIntegrationUser || erpUser);
    clearAlvoToken(); // force re-auth with new credentials
    setConnectionStatus("idle");
    toast({
      title: "✅ Credenciais salvas",
      description: "O próximo sync usará as novas credenciais.",
    });
  };

  const handleTestConnection = async () => {
    // Save before testing
    localStorage.setItem("alvo_username", erpUser);
    localStorage.setItem("alvo_password", erpPassword);
    localStorage.setItem("alvo_user_integration", erpIntegrationUser || erpUser);
    clearAlvoToken();

    setTesting(true);
    setConnectionStatus("idle");
    try {
      const result = await authenticateAlvo();
      if (result.success) {
        setConnectionStatus("success");
        const origem = result.source === "cache" ? "Cache" : "Rede";
        toast({
          title: "✅ Conexão com ERP Alvo estabelecida!",
          description: `Token obtido via ${origem}.`,
        });
      } else {
        setConnectionStatus("error");
        toast({
          title: "❌ Falha na conexão com o ERP Alvo",
          description: result.error,
          variant: "destructive",
        });
      }
    } catch {
      setConnectionStatus("error");
      toast({
        title: "❌ Falha na conexão com o ERP Alvo",
        description: "Erro inesperado ao conectar.",
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold text-foreground">{t("nav.settings")}</h1>

      {/* ERP Credentials Section */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Integração ERP Alvo</h2>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Credenciais de Acesso</CardTitle>
                <CardDescription className="mt-1">
                  Configure o usuário e senha para autenticação com a API do ERP Alvo.
                </CardDescription>
              </div>
              {connectionStatus === "success" && (
                <Badge variant="outline" className="gap-1 border-success text-success">
                  <CheckCircle2 className="h-3 w-3" /> {t("settings.connected")}
                </Badge>
              )}
              {connectionStatus === "error" && (
                <Badge variant="outline" className="gap-1 border-destructive text-destructive">
                  <XCircle className="h-3 w-3" /> {t("settings.connection_failed")}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="erp-user">Usuário</Label>
                <Input
                  id="erp-user"
                  value={erpUser}
                  onChange={(e) => setErpUser(e.target.value)}
                  placeholder="ex: wsintegracao"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="erp-password">Senha</Label>
                <div className="relative">
                  <Input
                    id="erp-password"
                    type={showPassword ? "text" : "password"}
                    value={erpPassword}
                    onChange={(e) => setErpPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="erp-integration-user">Usuário de Integração</Label>
              <Input
                id="erp-integration-user"
                value={erpIntegrationUser}
                onChange={(e) => setErpIntegrationUser(e.target.value)}
                placeholder="Mesmo do Usuário (se vazio)"
              />
              <p className="text-xs text-muted-foreground">
                Se deixado em branco, será usado o mesmo valor do campo "Usuário".
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSaveCredentials} variant="outline" className="gap-2">
                <Save className="h-4 w-4" />
                Salvar Credenciais
              </Button>
              <Button
                onClick={handleTestConnection}
                disabled={testing || !erpUser || !erpPassword}
                className="gap-2"
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4" />
                )}
                {testing ? t("settings.testing") : t("settings.test_connection")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Fornecedores */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Fornecedores</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sincronizar do ERP Alvo</CardTitle>
            <CardDescription className="mt-1">
              Sincronizar cadastro de fornecedores do ERP Alvo para uso no módulo Projetos e Pedidos de Compra.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              onClick={async () => {
                setSyncEntLoading(true);
                setSyncEntProgress("");
                try {
                  const count = await syncEntidades(setSyncEntProgress);
                  await loadSyncMeta();
                  toast({ title: `✅ ${count} fornecedores sincronizados` });
                } catch (err: any) {
                  toast({ title: "Erro", description: err.message, variant: "destructive" });
                } finally {
                  setSyncEntLoading(false);
                  setSyncEntProgress("");
                }
              }}
              disabled={syncEntLoading}
              className="gap-2"
            >
              {syncEntLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncEntLoading ? "Sincronizando..." : "Sincronizar Fornecedores"}
            </Button>
            {syncEntProgress && (
              <p className="text-sm text-muted-foreground">{syncEntProgress}</p>
            )}
            {!syncEntLoading && (
              <p className="text-xs text-muted-foreground">
                {formatSyncInfo(syncMeta.sync_entidades_ts || null, syncMeta.sync_entidades_count || null, "fornecedores")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Produtos */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Produtos</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sincronizar do ERP Alvo</CardTitle>
            <CardDescription className="mt-1">
              Sincronizar catálogo de produtos do ERP Alvo para uso nos Pedidos de Compra de Projetos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              onClick={async () => {
                setSyncProdLoading(true);
                setSyncProdProgress("");
                try {
                  const count = await syncProdutos(setSyncProdProgress);
                  await loadSyncMeta();
                  toast({ title: `✅ ${count} produtos sincronizados` });
                } catch (err: any) {
                  toast({ title: "Erro", description: err.message, variant: "destructive" });
                } finally {
                  setSyncProdLoading(false);
                  setSyncProdProgress("");
                }
              }}
              disabled={syncProdLoading}
              className="gap-2"
            >
              {syncProdLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncProdLoading ? "Sincronizando..." : "Sincronizar Produtos"}
            </Button>
            {syncProdProgress && (
              <p className="text-sm text-muted-foreground">{syncProdProgress}</p>
            )}
            {!syncProdLoading && (
              <p className="text-xs text-muted-foreground">
                {formatSyncInfo(syncMeta.sync_produtos_ts || null, syncMeta.sync_produtos_count || null, "produtos")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Condições de Pagamento */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Condições de Pagamento</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sincronizar do ERP Alvo</CardTitle>
            <CardDescription className="mt-1">
              Importa as condições de pagamento do ERP para uso no módulo de Projetos e Pedidos de Compra.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={async () => {
                setSyncingCondPag(true);
                try {
                  const count = await syncCondicoesPagamento();
                  toast({ title: `✅ ${count} condições sincronizadas` });
                } catch (err: any) {
                  toast({ title: "Erro", description: err.message, variant: "destructive" });
                } finally {
                  setSyncingCondPag(false);
                }
              }}
              disabled={syncingCondPag}
              className="gap-2"
            >
              {syncingCondPag ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncingCondPag ? "Sincronizando..." : "Sincronizar Condições de Pagamento"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Audit App Configuration */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Audit App (Imobilizado)</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conexão com o App de Auditoria</CardTitle>
            <CardDescription className="mt-1">
              Configure a URL e chave anônima do projeto do App de Auditoria de Imobilizados para importar dados de ativos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="audit-url">URL do Projeto</Label>
              <Input
                id="audit-url"
                value={auditUrl}
                onChange={(e) => setAuditUrl(e.target.value)}
                placeholder="https://xxxxx.supabase.co"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-anon-key">Anon Key</Label>
              <Input
                id="audit-anon-key"
                value={auditAnonKey}
                onChange={(e) => setAuditAnonKey(e.target.value)}
                placeholder="eyJhbGciOi..."
              />
              <p className="text-xs text-muted-foreground">
                A chave pública (anon key) do projeto do Audit App. RLS deve estar configurado para permitir leitura.
              </p>
            </div>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                localStorage.setItem("audit_app_supabase_url", auditUrl.trim());
                localStorage.setItem("audit_app_supabase_anon_key", auditAnonKey.trim());
                toast({
                  title: "✅ Configuração salva",
                  description: "Dados do Audit App salvos com sucesso.",
                });
              }}
              disabled={!auditUrl.trim() || !auditAnonKey.trim()}
            >
              <Save className="h-4 w-4" />
              Salvar Configuração
            </Button>
          </CardContent>
        </Card>
      </div>



      <Separator />

      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">Laboratório de API</h2>
        <ApiTester />
      </div>
    </div>
  );
}