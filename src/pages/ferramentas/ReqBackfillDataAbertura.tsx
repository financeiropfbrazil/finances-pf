import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Play, CheckCircle2, AlertTriangle, Database } from "lucide-react";

// ════════════════════════════════════════════════════════════
// Constantes Alvo (idênticas ao backfill de pedidos)
// ════════════════════════════════════════════════════════════
const ERP_BASE = "https://pef.it4you.inf.br/api";
const EMPRESA = "1.01";
const RENEW_MS = 17 * 60 * 1000; // renovação preventiva do token (~17 min)
const DELAY_MS = 120; // respiro entre chamadas ao Alvo

export default function ReqBackfillDataAbertura() {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [total, setTotal] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [okCount, setOkCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [resumo, setResumo] = useState<{ atualizadas: number; nao_encontradas: string[] } | null>(null);

  const tokenRef = useRef<string | null>(null);
  const lastAuthRef = useRef<number>(0);

  const addLog = (msg: string) => setLog((l) => [...l, msg]);

  // ── Auth de duas etapas (token no HEADER riosoft-token, não Bearer) ──
  async function reautenticar(): Promise<string> {
    const userName = localStorage.getItem("alvo_username");
    const password = localStorage.getItem("alvo_password");
    const integrationUser = localStorage.getItem("alvo_user_integration");

    const r1 = await fetch(`${ERP_BASE}/RsLogin/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName, password, userNameIntegration: integrationUser }),
    });
    const t1 = r1.headers.get("riosoft-token") || r1.headers.get("Token");
    if (!t1) throw new Error("Login Alvo: token ausente no header (passo 1).");

    const r2 = await fetch(`${ERP_BASE}/RsLogin/SelectCompany`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "riosoft-token": t1 },
      body: JSON.stringify({ Id: EMPRESA }),
    });
    const t2 = r2.headers.get("riosoft-token") || r2.headers.get("Riosoft-Token");
    if (!t2) throw new Error("SelectCompany Alvo: token ausente no header (passo 2).");

    tokenRef.current = t2;
    lastAuthRef.current = Date.now();
    localStorage.setItem("alvo_erp_token", t2);
    return t2;
  }

  async function ensureToken(): Promise<string> {
    if (!tokenRef.current) {
      const cached = localStorage.getItem("alvo_erp_token");
      if (cached) {
        tokenRef.current = cached;
        lastAuthRef.current = Date.now();
      }
    }
    if (!tokenRef.current || Date.now() - lastAuthRef.current > RENEW_MS) {
      return reautenticar();
    }
    return tokenRef.current;
  }

  async function carregarRequisicao(numero: string): Promise<any> {
    const num7 = String(numero).padStart(7, "0");
    const url = `${ERP_BASE}/ReqComp/Load?codigoEmpresaFilial=${EMPRESA}&numero=${num7}&loadChild=All`;
    let token = await ensureToken();
    let resp = await fetch(url, { headers: { "riosoft-token": token } });
    if ([401, 403, 409].includes(resp.status)) {
      token = await reautenticar();
      resp = await fetch(url, { headers: { "riosoft-token": token } });
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  // ── Execução ──
  async function runBackfill() {
    setStatus("running");
    setLog([]);
    setResumo(null);
    setProcessed(0);
    setOkCount(0);
    setFailCount(0);

    try {
      // 1) Reqs sem data_abertura_alvo
      const { data: pendentes, error } = await (supabase as any)
        .from("compras_requisicoes")
        .select("numero_alvo, codigo_empresa_filial")
        .is("data_abertura_alvo", null);

      if (error) throw new Error(`Supabase select: ${error.message}`);
      const lista = pendentes || [];
      setTotal(lista.length);
      addLog(`${lista.length} requisições sem data de abertura. Iniciando...`);

      if (lista.length === 0) {
        setStatus("done");
        setResumo({ atualizadas: 0, nao_encontradas: [] });
        return;
      }

      // 2) Busca cada req no Alvo, extrai DataHoraDigitacao
      const rows: { numero: string; cef: string; data: string }[] = [];
      let ok = 0;
      let fail = 0;

      for (let i = 0; i < lista.length; i++) {
        const numero = lista[i].numero_alvo as string;
        const cef = (lista[i].codigo_empresa_filial as string) || EMPRESA;
        try {
          const det = await carregarRequisicao(numero);
          const dataHora = det?.DataHoraDigitacao;
          if (!dataHora) {
            fail++;
            addLog(`⚠ ${numero}: DataHoraDigitacao ausente na resposta.`);
          } else {
            rows.push({ numero, cef, data: dataHora });
            ok++;
          }
        } catch (e: any) {
          fail++;
          addLog(`✗ ${numero}: ${e.message}`);
        }
        setProcessed(i + 1);
        setOkCount(ok);
        setFailCount(fail);
        if (DELAY_MS) await new Promise((res) => setTimeout(res, DELAY_MS));
      }

      // 3) Grava tudo numa chamada RPC
      addLog(`Buscas concluídas: ${ok} ok, ${fail} falhas. Gravando ${rows.length} via RPC...`);
      if (rows.length > 0) {
        const { data: res, error: rpcErr } = await (supabase as any).rpc("backfill_req_data_abertura", {
          p_rows: rows,
        });
        if (rpcErr) throw new Error(`RPC: ${rpcErr.message}`);
        const r0 = Array.isArray(res) ? res[0] : res;
        setResumo({
          atualizadas: Number(r0?.atualizadas) || 0,
          nao_encontradas: (r0?.nao_encontradas as string[]) || [],
        });
        addLog(`✓ RPC concluída: ${r0?.atualizadas ?? 0} requisições atualizadas.`);
      } else {
        addLog("Nenhuma linha válida para gravar.");
        setResumo({ atualizadas: 0, nao_encontradas: [] });
      }

      setStatus("done");
    } catch (e: any) {
      addLog(`ERRO FATAL: ${e.message}`);
      setStatus("error");
    }
  }

  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Backfill — Data de abertura das requisições
        </h1>
        <p className="text-sm text-muted-foreground">
          Preenche <code>data_abertura_alvo</code> a partir do <code>ReqComp.DataHoraDigitacao</code> do Alvo.
          Idempotente: só toca nas requisições com a data ainda vazia.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            Execução
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={runBackfill} disabled={status === "running"}>
            {status === "running" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rodando...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" /> Iniciar backfill
              </>
            )}
          </Button>

          {status !== "idle" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {processed}/{total} processadas
                </span>
                <span className="text-muted-foreground">
                  {okCount} ok · {failCount} falhas
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {status === "done" && resumo && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
              <div>
                <p className="font-medium text-foreground">{resumo.atualizadas} requisições atualizadas.</p>
                {resumo.nao_encontradas.length > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Não encontradas no banco ({resumo.nao_encontradas.length}): {resumo.nao_encontradas.join(", ")}
                  </p>
                )}
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600" />
              <p className="text-foreground">Execução interrompida. Veja o log abaixo.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {log.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs">
              {log.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap text-muted-foreground">
                  {line}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
