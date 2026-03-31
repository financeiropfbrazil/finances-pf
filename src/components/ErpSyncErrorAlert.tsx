import { AlertTriangle, WifiOff, KeyRound, ServerCrash, Clock, FileWarning, HelpCircle, Users } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getErrorLabel } from "@/services/alvoService";

interface Props {
  errorCode?: string;
  errorMessage: string;
  details?: string;
  onRetry?: () => void;
  onClearToken?: () => void;
}

const iconMap: Record<string, React.ElementType> = {
  NETWORK_ERROR: WifiOff,
  MAKE_NETWORK_ERROR: WifiOff,
  EDGE_FUNCTION_ERROR: ServerCrash,
  PROXY_INTERNAL_ERROR: ServerCrash,
  PROXY_NOT_CONFIGURED: ServerCrash,
  MISSING_TOKEN: KeyRound,
  TOKEN_NOT_RECEIVED: KeyRound,
  TOKEN_EXPIRED: KeyRound,
  AUTH_FAILED: KeyRound,
  MAKE_AUTH_ERROR: KeyRound,
  MAKE_RATE_LIMITED: Clock,
  MAKE_SCENARIO_FAILED: FileWarning,
  MAKE_HTML_RESPONSE: FileWarning,
  SESSION_CONFLICT: Users,
  ERP_API_ERROR: AlertTriangle,
  MAKE_HTTP_ERROR: AlertTriangle,
  UNEXPECTED_FORMAT: FileWarning,
  EMPTY_RESPONSE: FileWarning,
};

const hintMap: Record<string, string> = {
  PROXY_NOT_CONFIGURED: "Configure a variável MAKE_WEBHOOK_PROXY_URL nas configurações do backend.",
  MISSING_PARAMS: "Verifique se a URL e o método estão sendo enviados corretamente.",
  MISSING_TOKEN: "O token de autenticação não foi enviado. Tente limpar o cache e re-autenticar.",
  MAKE_NETWORK_ERROR: "Verifique a conectividade de rede e se o Make.com está acessível.",
  MAKE_SCENARIO_FAILED: "Acesse o Make.com e verifique os logs do cenário para identificar o erro.",
  MAKE_RATE_LIMITED: "Aguarde alguns minutos antes de tentar novamente.",
  MAKE_AUTH_ERROR: "Verifique se o webhook URL do Make.com está correto e ativo.",
  MAKE_HTML_RESPONSE: "O cenário pode estar desativado ou o webhook URL está incorreto.",
  ERP_API_ERROR: "Verifique os parâmetros da requisição e se o endpoint do ERP está correto.",
  TOKEN_NOT_RECEIVED: "A autenticação com o ERP não retornou um token. Verifique as credenciais.",
  AUTH_FAILED: "Credenciais do ERP podem estar incorretas. Verifique usuário e senha nas configurações.",
  EDGE_FUNCTION_ERROR: "Houve um erro interno na função do backend. Tente novamente.",
  NETWORK_ERROR: "Verifique sua conexão com a internet.",
  EMPTY_RESPONSE: "O ERP não retornou lançamentos para o período selecionado.",
  UNEXPECTED_FORMAT: "A resposta do ERP veio em um formato não esperado. Verifique o endpoint.",
  SESSION_CONFLICT: "Outro usuário está logado no ERP com as mesmas credenciais. Encerre a outra sessão ou aguarde alguns minutos antes de tentar novamente.",
};

const isTokenError = (code?: string) =>
  ["MISSING_TOKEN", "TOKEN_NOT_RECEIVED", "TOKEN_EXPIRED", "AUTH_FAILED"].includes(code || "");

export default function ErpSyncErrorAlert({ errorCode, errorMessage, details, onRetry, onClearToken }: Props) {
  const Icon = iconMap[errorCode || ""] || HelpCircle;
  const label = getErrorLabel(errorCode);
  const hint = hintMap[errorCode || ""];

  return (
    <Alert variant="destructive" className="border-danger/30 bg-danger/5">
      <Icon className="h-5 w-5" />
      <AlertTitle className="flex items-center gap-2">
        <span className="font-mono text-xs bg-danger/10 px-2 py-0.5 rounded">{errorCode || "UNKNOWN"}</span>
        {label}
      </AlertTitle>
      <AlertDescription className="mt-2 space-y-2">
        <p>{errorMessage}</p>
        {hint && (
          <p className="text-sm text-muted-foreground italic">
            💡 {hint}
          </p>
        )}
        {details && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Detalhes técnicos</summary>
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 text-xs">{details}</pre>
          </details>
        )}
        <div className="flex gap-2 pt-1">
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Tentar novamente
            </Button>
          )}
          {isTokenError(errorCode) && onClearToken && (
            <Button size="sm" variant="outline" onClick={onClearToken}>
              Limpar token e re-autenticar
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
