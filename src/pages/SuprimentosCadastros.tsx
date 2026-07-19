import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Package, Building2, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { sincronizarProdutosDoERP } from "@/services/alvoEstoqueService";
import { syncEntidades } from "@/services/alvoEntidadeService";

/**
 * ATUALIZAR CADASTROS (Suprimentos) — LD.
 *
 * Problema que resolve: a operadora cadastra um produto ou fornecedor no Alvo e
 * ele não aparece no Hub na hora de lançar o pedido. Produtos têm cron diário
 * (jobid 20, 23h) — atraso de até um dia. **Fornecedores NÃO tinham cron nenhum**:
 * o cache ficou congelado de 01/07 a 19/07/2026 e 43 fornecedores novos ficaram
 * invisíveis (~2,4/dia). Os botões existiam, mas em telas administrativas
 * (/inventory/import e /entidades) às quais as operadoras não têm acesso.
 *
 * Esta página é a porta delas: os MESMOS serviços de sync das telas admin, sem
 * as operações perigosas que convivem lá (Importar XLSX, Enriquecer Unidades,
 * Importar Código Alternativo — que podem estragar o catálogo se clicadas por
 * engano). Gate: permissão `compras.cadastros.sync`.
 *
 * Nada de código de sync novo aqui: chama `sincronizarProdutosDoERP` e
 * `syncEntidades`, os mesmos que o admin usa.
 */
export default function SuprimentosCadastros() {
  const { toast } = useToast();

  const [syncProdutos, setSyncProdutos] = useState(false);
  const [msgProdutos, setMsgProdutos] = useState<string>("");
  const [resProdutos, setResProdutos] = useState<string | null>(null);

  const [syncEnt, setSyncEnt] = useState(false);
  const [msgEnt, setMsgEnt] = useState<string>("");
  const [resEnt, setResEnt] = useState<string | null>(null);

  // ── Última atualização de PRODUTOS ────────────────────────────────────
  // Vem de sync_runs (job_type='produtos'), que é onde o cron diário registra.
  const { data: ultimaProdutos, refetch: refetchProdutos } = useQuery({
    queryKey: ["cadastros-ultima-produtos"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("sync_runs")
        .select("finished_at")
        .eq("job_type", "produtos")
        .not("finished_at", "is", null)
        .eq("total_erros", 0)
        .order("finished_at", { ascending: false })
        .limit(1);
      return data?.[0]?.finished_at ?? null;
    },
  });

  // ── Última atualização de FORNECEDORES ────────────────────────────────
  // Vem de compras_config (chave sync_entidades_ts), gravada pelo próprio
  // syncEntidades — não há job em sync_runs porque não existe cron de entidades.
  const { data: ultimaEnt, refetch: refetchEnt } = useQuery({
    queryKey: ["cadastros-ultima-entidades"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("compras_config")
        .select("valor")
        .eq("chave", "sync_entidades_ts")
        .maybeSingle();
      return data?.valor ?? null;
    },
  });

  const formatar = (iso: string | null): string => {
    if (!iso) return "nunca";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    const data = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const hora = d.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${data} às ${hora}`;
  };

  /** Há quantos dias foi a última atualização? (para o aviso de desatualizado) */
  const diasDesde = (iso: string | null): number | null => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86_400_000);
  };

  const handleSyncProdutos = async () => {
    setSyncProdutos(true);
    setResProdutos(null);
    setMsgProdutos("Iniciando...");
    try {
      const r = await sincronizarProdutosDoERP((msg) => setMsgProdutos(msg));
      const resumo = `${r.novos} novo(s), ${r.ignorados} atualizado(s) de ${r.totalERP} no ERP`;
      setResProdutos(resumo);
      toast({ title: "Produtos atualizados", description: resumo });
      if (r.erros.length > 0) {
        toast({
          title: `${r.erros.length} erro(s) durante a sincronização`,
          description: r.erros[0],
          variant: "destructive",
        });
      }
      refetchProdutos();
    } catch (err: any) {
      setResProdutos(null);
      toast({
        title: "Erro ao atualizar produtos",
        description: err?.message || "Falha na comunicação com o ERP.",
        variant: "destructive",
      });
    } finally {
      setSyncProdutos(false);
      setMsgProdutos("");
    }
  };

  const handleSyncEntidades = async () => {
    setSyncEnt(true);
    setResEnt(null);
    setMsgEnt("Iniciando...");
    try {
      const total = await syncEntidades((msg) => setMsgEnt(msg));
      const resumo = `${total} fornecedor(es)/cliente(s) sincronizado(s)`;
      setResEnt(resumo);
      toast({ title: "Fornecedores atualizados", description: resumo });
      refetchEnt();
    } catch (err: any) {
      setResEnt(null);
      toast({
        title: "Erro ao atualizar fornecedores",
        description: err?.message || "Falha na comunicação com o ERP.",
        variant: "destructive",
      });
    } finally {
      setSyncEnt(false);
      setMsgEnt("");
    }
  };

  const diasProdutos = diasDesde(ultimaProdutos);
  const diasEnt = diasDesde(ultimaEnt);
  const rodando = syncProdutos || syncEnt;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Atualizar cadastros</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trouxe um produto ou fornecedor novo do ERP e ele não aparece no pedido? Atualize aqui.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-sm">
          A atualização lê o cadastro inteiro do ERP e pode levar alguns minutos. Você pode continuar usando o Hub em
          outra aba — mas não feche esta página enquanto estiver rodando.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 md:grid-cols-2">
        {/* ── PRODUTOS ────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4" />
              Produtos
            </CardTitle>
            <CardDescription>Catálogo de produtos e serviços do ERP. Atualiza sozinho todo dia às 23h.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Última atualização: </span>
              <span className="font-medium text-foreground">{formatar(ultimaProdutos)}</span>
            </div>

            {diasProdutos !== null && diasProdutos >= 2 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Há {diasProdutos} dias sem atualizar — a sincronização automática pode ter falhado.</span>
              </div>
            )}

            <Button onClick={handleSyncProdutos} disabled={rodando} className="w-full gap-2">
              {syncProdutos ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncProdutos ? "Atualizando..." : "Atualizar produtos"}
            </Button>

            {syncProdutos && msgProdutos && (
              <p className="truncate rounded-md bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
                {msgProdutos}
              </p>
            )}

            {resProdutos && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{resProdutos}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── FORNECEDORES ────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" />
              Fornecedores
            </CardTitle>
            <CardDescription>
              Cadastro de fornecedores e clientes do ERP. <strong>Só atualiza quando alguém clica aqui.</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Última atualização: </span>
              <span className="font-medium text-foreground">{formatar(ultimaEnt)}</span>
            </div>

            {diasEnt !== null && diasEnt >= 3 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Há {diasEnt} dias sem atualizar. Fornecedores cadastrados no ERP nesse período ainda não aparecem no
                  Hub.
                </span>
              </div>
            )}

            <Button onClick={handleSyncEntidades} disabled={rodando} className="w-full gap-2">
              {syncEnt ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncEnt ? "Atualizando..." : "Atualizar fornecedores"}
            </Button>

            {syncEnt && msgEnt && (
              <p className="truncate rounded-md bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
                {msgEnt}
              </p>
            )}

            {resEnt && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{resEnt}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Depois de atualizar, volte ao pedido e busque o produto ou fornecedor novamente. Se ainda não aparecer, confirme
        no ERP se o cadastro está ativo.
      </p>
    </div>
  );
}
