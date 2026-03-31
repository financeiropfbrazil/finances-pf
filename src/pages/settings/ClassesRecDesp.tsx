/*
  Tabela Supabase: classes_rec_desp
  - id uuid PK
  - codigo text NOT NULL UNIQUE
  - nome text NOT NULL
  - grupo text ('T' = Título, 'F' = Folha)
  - nivel text (código do grupo pai)
  - natureza text ('Débito' ou 'Crédito')
  - is_active boolean DEFAULT true
  - conta_contabil_reduzida integer
  - conta_contabil_classificacao text
  - created_at, updated_at timestamptz
*/

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { authenticateAlvo, clearAlvoToken } from "@/services/alvoService";
import {
  enriquecerClassesComContaContabil,
  type EnrichClassesResult,
} from "@/services/alvoClassesEnriquecimentoService";
import { RefreshCw, Search, BookOpen, Hash, Layers, CreditCard, ArrowDownLeft, ArrowUpRight, Sparkles, BookMarked } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

interface ClasseRecDesp {
  id: string;
  codigo: string;
  nome: string;
  grupo: string | null;
  nivel: string | null;
  natureza: string | null;
  is_active: boolean;
  conta_contabil_reduzida?: number | null;
  created_at: string;
  updated_at: string | null;
}

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export default function ClassesRecDesp() {
  const [items, setItems] = useState<ClasseRecDesp[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // filters
  const [search, setSearch] = useState("");
  const [filterGrupo, setFilterGrupo] = useState("all");
  const [filterNatureza, setFilterNatureza] = useState("all");

  // enrich
  const [enrichOpen, setEnrichOpen] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState(0);
  const [enrichMessage, setEnrichMessage] = useState("");
  const [enrichResult, setEnrichResult] = useState<EnrichClassesResult | null>(null);

  const fetchData = async () => {
    const { data } = await (supabase as any)
      .from("classes_rec_desp")
      .select("*")
      .order("codigo", { ascending: true });
    setItems((data as ClasseRecDesp[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (search) {
        const q = search.toLowerCase();
        if (!i.codigo.toLowerCase().includes(q) && !i.nome.toLowerCase().includes(q)) return false;
      }
      if (filterGrupo !== "all" && i.grupo !== filterGrupo) return false;
      if (filterNatureza !== "all" && i.natureza !== filterNatureza) return false;
      return true;
    });
  }, [items, search, filterGrupo, filterNatureza]);

  // Summary cards
  const totalClasses = items.length;
  const totalTitulos = items.filter((i) => i.grupo === "T").length;
  const totalFolhas = items.filter((i) => i.grupo === "F").length;
  const totalDebito = items.filter((i) => i.natureza === "Débito" && i.grupo === "F").length;
  const totalCredito = items.filter((i) => i.natureza === "Crédito" && i.grupo === "F").length;

  // ── Sync with Alvo ERP ──
  const handleSync = async () => {
    setSyncing(true);
    toast({ title: "Sincronizando classes de receita/despesa com o Alvo ERP..." });

    try {
      const auth = await authenticateAlvo();
      if (!auth.success || !auth.token) {
        throw new Error(auth.error || "Autenticação falhou");
      }
      let currentToken = auth.token;

      const MAX_RETRIES = 3;
      let resp: Response | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        resp = await fetch(
          `${ERP_BASE_URL}/ClasseRecDesp/RetornaListaClasseRecDespSistemaExterno`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "riosoft-token": currentToken,
            },
            body: JSON.stringify({
              Nome: "",
              Grupo: "",
              CodigoGrupo: "",
            }),
          }
        );

        if (resp.status !== 409) break;

        console.warn(`[ClassesRecDesp] 409 session conflict (tentativa ${attempt}/${MAX_RETRIES})`);

        if (attempt === MAX_RETRIES) {
          throw new Error(
            "Conflito de sessão ERP persistente. Aguarde alguns minutos e tente novamente."
          );
        }

        clearAlvoToken();
        await delay(1000 * attempt);

        const reAuth = await authenticateAlvo();
        if (!reAuth.success || !reAuth.token) {
          throw new Error("Falha na re-autenticação após conflito de sessão");
        }
        currentToken = reAuth.token;
      }

      if (!resp || !resp.ok) {
        throw new Error(`HTTP ${resp?.status ?? "desconhecido"}`);
      }

      const data = await resp.json();

      if (!Array.isArray(data) || data.length === 0) {
        toast({
          title: "Nenhuma classe retornada pelo ERP.",
          variant: "destructive",
        });
        setSyncing(false);
        return;
      }

      const payload = data.map((item: any) => ({
        codigo: item.Codigo,
        nome: item.Nome,
        grupo: item.Grupo || null,
        nivel: item.Nivel || null,
        natureza: item.Natureza || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await (supabase as any)
        .from("classes_rec_desp")
        .upsert(payload, { onConflict: "codigo" });

      if (error) {
        toast({
          title: "Erro ao salvar classes",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({ title: `${payload.length} classes sincronizadas com sucesso.` });
        fetchData();
      }
    } catch (e: any) {
      toast({
        title: "Erro ao sincronizar",
        description: e.message,
        variant: "destructive",
      });
    }

    setSyncing(false);
  };

  // ── Enrich with conta contábil ──
  const handleEnrich = async () => {
    setEnriching(true);
    setEnrichResult(null);
    setEnrichProgress(0);
    setEnrichMessage("Iniciando...");
    try {
      const result = await enriquecerClassesComContaContabil(
        (current, total, message) => {
          setEnrichMessage(message);
          if (total > 0)
            setEnrichProgress(Math.round((current / total) * 100));
        }
      );
      setEnrichResult(result);
      toast({
        title: "Enriquecimento concluído",
        description:
          `${result.enriched} classes com conta contábil, ` +
          `${result.skipped} sem conta no ERP, ` +
          `${result.errors} erros`,
      });
      fetchData();
    } catch (err: any) {
      toast({
        title: "Erro no enriquecimento",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setEnriching(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Classes de Receita/Despesa</h1>
          <p className="text-sm text-muted-foreground">
            Visualize as classes de receita e despesa sincronizadas do ERP Alvo.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setEnrichOpen(true);
              setEnrichResult(null);
              setEnrichMessage("");
              setEnrichProgress(0);
            }}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Enriquecer Conta Contábil
          </Button>
          <Button variant="outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando..." : "Sincronizar com Alvo"}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <Hash className="h-3.5 w-3.5" /> Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalClasses}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" /> Títulos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalTitulos}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" /> Folhas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalFolhas}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <ArrowDownLeft className="h-3.5 w-3.5" /> Débito
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalDebito}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
              <ArrowUpRight className="h-3.5 w-3.5" /> Crédito
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalCredito}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por código ou nome..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterGrupo} onValueChange={setFilterGrupo}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Grupo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos grupos</SelectItem>
            <SelectItem value="T">Título</SelectItem>
            <SelectItem value="F">Folha</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterNatureza} onValueChange={setFilterNatureza}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Natureza" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="Débito">Débito</SelectItem>
            <SelectItem value="Crédito">Crédito</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Counter */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} classes encontradas (de {items.length} total)
      </p>

      {/* Content */}
      {!loading && items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <BookOpen className="mb-4 h-12 w-12" />
          <p className="text-center">
            Nenhuma classe de receita/despesa cadastrada.
            <br />
            Clique em <strong>Sincronizar com Alvo</strong> para importar automaticamente.
          </p>
        </div>
      ) : (
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">Código</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead>Nível</TableHead>
                <TableHead>Conta Contábil</TableHead>
                <TableHead>Natureza</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.codigo}
                  </TableCell>
                  <TableCell className="font-medium">{item.nome}</TableCell>
                  <TableCell>
                    {item.grupo === "T" ? (
                      <Badge variant="secondary">Título</Badge>
                    ) : item.grupo === "F" ? (
                      <Badge className="bg-primary/10 text-primary border-primary/20">Folha</Badge>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.nivel || "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {item.conta_contabil_reduzida ?? "—"}
                  </TableCell>
                  <TableCell>
                    {item.natureza === "Débito" ? (
                      <Badge className="bg-destructive/10 text-destructive border-destructive/20">Débito</Badge>
                    ) : item.natureza === "Crédito" ? (
                      <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Crédito</Badge>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    {item.is_active ? (
                      <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Ativo</Badge>
                    ) : (
                      <Badge variant="secondary">Inativo</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Enrich Dialog */}
      <Dialog open={enrichOpen} onOpenChange={(v) => !enriching && setEnrichOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enriquecer Conta Contábil</DialogTitle>
            <DialogDescription>
              Busca a conta contábil reduzida de cada classe Folha
              no ERP Alvo via ClasseRecDesp/Load.
              Apenas classes sem conta contábil serão processadas.
            </DialogDescription>
          </DialogHeader>

          {!enriching && !enrichResult && (
            <p className="text-sm text-muted-foreground">
              Clique em "Iniciar" para buscar as contas contábeis
              das classes cadastradas. O processo pode levar alguns
              minutos dependendo da quantidade de classes.
            </p>
          )}

          {enriching && (
            <div className="space-y-3">
              <Progress value={enrichProgress} />
              <p className="text-xs text-muted-foreground">
                {enrichMessage}
              </p>
            </div>
          )}

          {enrichResult && (
            <div className="space-y-2">
              <p className="text-sm text-emerald-600">
                ✓ Enriquecidas: {enrichResult.enriched}
              </p>
              <p className="text-sm text-muted-foreground">
                ⊘ Sem conta no ERP: {enrichResult.skipped}
              </p>
              {enrichResult.errors > 0 && (
                <p className="text-sm text-destructive">
                  ✗ Erros: {enrichResult.errors}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {!enrichResult ? (
              <Button onClick={handleEnrich} disabled={enriching}>
                {enriching ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Enriquecendo...
                  </>
                ) : (
                  "Iniciar"
                )}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setEnrichOpen(false)}>
                Fechar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
