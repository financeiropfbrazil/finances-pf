/**
 * Config Contas de Despesas — De-Para Contábil.
 *
 * Tela de configuração do de-para classe → conta contábil, com:
 *  - Aba "De-Para": as classes no controle, conta contábil editável por
 *    combobox (busca no plano de resultado), selo de status
 *    (Mapeada / Desempate pendente / Sem conta). Trocar a conta abre o
 *    modal de reprocessamento (escolha dos meses abertos).
 *  - Aba "Competências": status ABERTA/FECHADA por mês, Fechar / Reabrir.
 *
 * Backend: RPCs desp_set_conta_classe, desp_fechar_competencia,
 * desp_reabrir_competencia (via deparaContabilService).
 * Regra de ouro: mês FECHADO não pode ter conta alterada (trava no banco).
 *
 * Gate: apenas administrador (padrão de RealizadoDespesas).
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ShieldX,
  Loader2,
  Landmark,
  Search,
  Check,
  ChevronsUpDown,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  CircleSlash,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  getClassesDePara,
  getPlanoContasResultado,
  getCompetencias,
  setContaClasse,
  fecharCompetencia,
  reabrirCompetencia,
  type ClasseDePara,
  type ContaPlano,
  type Competencia,
  type StatusDePara,
} from "@/services/deparaContabilService";

// ─── Helpers ────────────────────────────────────────────────────────

const formatBRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const MESES_LABEL = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const formatComp = (ano: number, mes: number) => `${MESES_LABEL[mes]}/${ano}`;

const STATUS_META: Record<StatusDePara, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  MAPEADA: {
    label: "Mapeada",
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    icon: CheckCircle2,
  },
  DESEMPATE: {
    label: "Desempate pendente",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    icon: AlertTriangle,
  },
  SEM_CONTA: {
    label: "Sem conta",
    cls: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
    icon: CircleSlash,
  },
};

// ════════════════════════════════════════════════════════════════════
// COMBOBOX de conta (Popover + Input, padrão do projeto)
// ════════════════════════════════════════════════════════════════════

function ContaCombobox({
  contas,
  value,
  onSelect,
  disabled,
}: {
  contas: ContaPlano[];
  value: string | null;
  onSelect: (conta: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return contas.slice(0, 50);
    return contas
      .filter(
        (c) =>
          c.conta_hierarquica.toLowerCase().includes(q) ||
          c.nome.toLowerCase().includes(q) ||
          (c.conta_reduzida ?? "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [contas, busca]);

  const selecionada = contas.find((c) => c.conta_hierarquica === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" disabled={disabled} className="w-full justify-between font-normal">
          <span className="truncate text-left">
            {selecionada ? (
              <>
                <span className="font-mono text-xs text-muted-foreground">{selecionada.conta_hierarquica}</span>{" "}
                {selecionada.nome}
              </>
            ) : value ? (
              <span className="font-mono text-xs">{value}</span>
            ) : (
              <span className="text-muted-foreground">Selecionar conta…</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Buscar por código, nome ou reduzida…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-8 border-0 p-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {filtradas.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma conta encontrada.</div>
          ) : (
            filtradas.map((c) => (
              <button
                key={c.conta_hierarquica}
                onClick={() => {
                  onSelect(c.conta_hierarquica);
                  setOpen(false);
                  setBusca("");
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <Check className={`h-4 w-4 shrink-0 ${value === c.conta_hierarquica ? "opacity-100" : "opacity-0"}`} />
                <span className="font-mono text-xs text-muted-foreground">{c.conta_hierarquica}</span>
                <span className="truncate">{c.nome}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════════

type Aba = "depara" | "competencias";

export default function ConfigContasDespesas() {
  const { isAdmin, loading: permLoading } = usePermissions();
  const queryClient = useQueryClient();

  const [aba, setAba] = useState<Aba>("depara");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"TODAS" | StatusDePara>("TODAS");

  // Modal de reprocessamento
  const [modalOpen, setModalOpen] = useState(false);
  const [classeAlvo, setClasseAlvo] = useState<ClasseDePara | null>(null);
  const [contaEscolhida, setContaEscolhida] = useState<string | null>(null);
  const [mesesSelecionados, setMesesSelecionados] = useState<number[]>([]);

  // Dialog fechar/reabrir
  const [compDialog, setCompDialog] = useState<{ comp: Competencia; acao: "fechar" | "reabrir" } | null>(null);

  // ── Queries ──
  const classesQuery = useQuery({
    queryKey: ["depara-classes"],
    queryFn: getClassesDePara,
    enabled: isAdmin,
  });
  const planoQuery = useQuery({
    queryKey: ["depara-plano"],
    queryFn: getPlanoContasResultado,
    enabled: isAdmin,
  });
  const compQuery = useQuery({
    queryKey: ["depara-competencias"],
    queryFn: getCompetencias,
    enabled: isAdmin,
  });

  const competencias = compQuery.data ?? [];
  const mesesAbertos = competencias.filter((c) => c.status === "ABERTA");
  const anoRef = competencias[0]?.ano ?? new Date().getFullYear();

  // ── Mutations ──
  const aplicarMutation = useMutation({
    mutationFn: async () => {
      if (!classeAlvo || !contaEscolhida) throw new Error("Seleção incompleta.");
      return setContaClasse(
        classeAlvo.codigo,
        contaEscolhida,
        mesesSelecionados.length > 0 ? anoRef : null,
        mesesSelecionados.length > 0 ? mesesSelecionados : null,
      );
    },
    onSuccess: (linhas) => {
      const total = linhas.reduce((s, l) => s + Number(l.linhas_afetadas || 0), 0);
      toast.success(
        mesesSelecionados.length > 0
          ? `Conta aplicada — ${total} linha(s) atualizada(s) em ${mesesSelecionados.length} mês(es).`
          : "Conta definida (sem reprocessar meses).",
      );
      setModalOpen(false);
      setClasseAlvo(null);
      setContaEscolhida(null);
      setMesesSelecionados([]);
      queryClient.invalidateQueries({ queryKey: ["depara-classes"] });
    },
    onError: (err: any) => toast.error(err?.message || "Erro ao aplicar conta."),
  });

  const compMutation = useMutation({
    mutationFn: async ({ comp, acao }: { comp: Competencia; acao: "fechar" | "reabrir" }) => {
      if (acao === "fechar") return fecharCompetencia(comp.ano, comp.mes, null);
      return reabrirCompetencia(comp.ano, comp.mes);
    },
    onSuccess: (msg) => {
      toast.success(msg);
      setCompDialog(null);
      queryClient.invalidateQueries({ queryKey: ["depara-competencias"] });
    },
    onError: (err: any) => toast.error(err?.message || "Erro na competência."),
  });

  // ── Abrir modal ao trocar conta ──
  function abrirReprocesso(classe: ClasseDePara, conta: string) {
    setClasseAlvo(classe);
    setContaEscolhida(conta);
    setMesesSelecionados(mesesAbertos.map((m) => m.mes)); // sugere todos os abertos
    setModalOpen(true);
  }

  // ── Filtro da tabela ──
  const classesFiltradas = useMemo(() => {
    const rows = classesQuery.data ?? [];
    const q = busca.trim().toLowerCase();
    return rows.filter((c) => {
      if (filtroStatus !== "TODAS" && c.status !== filtroStatus) return false;
      if (!q) return true;
      return c.codigo.toLowerCase().includes(q) || c.nome.toLowerCase().includes(q);
    });
  }, [classesQuery.data, busca, filtroStatus]);

  const resumo = useMemo(() => {
    const rows = classesQuery.data ?? [];
    return {
      total: rows.length,
      mapeadas: rows.filter((c) => c.status === "MAPEADA").length,
      desempate: rows.filter((c) => c.status === "DESEMPATE").length,
      semConta: rows.filter((c) => c.status === "SEM_CONTA").length,
    };
  }, [classesQuery.data]);

  // ── Gates ──
  if (permLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <ShieldX className="h-16 w-16" />
        <h2 className="text-xl font-semibold text-foreground">Acesso Restrito</h2>
        <p>Esta página é restrita a administradores.</p>
      </div>
    );
  }

  const loading = classesQuery.isLoading || planoQuery.isLoading || compQuery.isLoading;

  return (
    <TooltipProvider>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
            <Landmark className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Configuração de Contas — Despesas</h1>
            <p className="text-sm text-muted-foreground">
              De-para de classe → conta contábil e fechamento de competências.
            </p>
          </div>
        </div>

        {/* Abas */}
        <div className="flex gap-1 border-b">
          <button
            onClick={() => setAba("depara")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              aba === "depara"
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            De-Para
          </button>
          <button
            onClick={() => setAba("competencias")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              aba === "competencias"
                ? "border-b-2 border-foreground text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Competências
          </button>
        </div>

        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : aba === "depara" ? (
          <>
            {/* Resumo */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Classes no controle", val: resumo.total, cls: "text-foreground" },
                { label: "Mapeadas", val: resumo.mapeadas, cls: "text-emerald-600 dark:text-emerald-400" },
                { label: "Desempate pendente", val: resumo.desempate, cls: "text-amber-600 dark:text-amber-400" },
                { label: "Sem conta", val: resumo.semConta, cls: "text-red-600 dark:text-red-400" },
              ].map((k) => (
                <Card key={k.label}>
                  <CardContent className="p-4">
                    <div className={`text-2xl font-bold tabular-nums ${k.cls}`}>{k.val}</div>
                    <div className="text-xs text-muted-foreground">{k.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por código ou nome da classe…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={filtroStatus} onValueChange={(v) => setFiltroStatus(v as any)}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODAS">Todas</SelectItem>
                  <SelectItem value="MAPEADA">Mapeadas</SelectItem>
                  <SelectItem value="DESEMPATE">Desempate pendente</SelectItem>
                  <SelectItem value="SEM_CONTA">Sem conta</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Tabela De-Para */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                        <th className="px-3 py-2.5 font-medium">Código</th>
                        <th className="px-3 py-2.5 font-medium">Classe</th>
                        <th className="px-3 py-2.5 font-medium">Setor</th>
                        <th className="px-3 py-2.5 font-medium">Conta contábil</th>
                        <th className="px-3 py-2.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classesFiltradas.map((c) => {
                        const meta = STATUS_META[c.status];
                        const Icon = meta.icon;
                        return (
                          <tr key={c.codigo} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="px-3 py-2.5 font-mono text-xs tabular-nums">{c.codigo}</td>
                            <td className="px-3 py-2.5">{c.nome}</td>
                            <td className="px-3 py-2.5">
                              {c.categoria ? (
                                <Badge variant="outline" className="font-normal capitalize">
                                  {c.categoria}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 min-w-[320px]">
                              <ContaCombobox
                                contas={planoQuery.data ?? []}
                                value={c.contaPadrao}
                                onSelect={(conta) => abrirReprocesso(c, conta)}
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <Badge variant="outline" className={`gap-1 ${meta.cls}`}>
                                <Icon className="h-3 w-3" />
                                {meta.label}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                      {classesFiltradas.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                            Nenhuma classe para o filtro atual.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          // ─── Aba Competências ───
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium">Competência</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Fechada em</th>
                    <th className="px-3 py-2.5 font-medium">Fechada por</th>
                    <th className="px-3 py-2.5 text-right font-medium">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {competencias.map((comp) => {
                    const fechada = comp.status === "FECHADA";
                    return (
                      <tr key={`${comp.ano}-${comp.mes}`} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2.5 font-medium tabular-nums">{formatComp(comp.ano, comp.mes)}</td>
                        <td className="px-3 py-2.5">
                          {fechada ? (
                            <Badge
                              variant="outline"
                              className="gap-1 bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30"
                            >
                              <Lock className="h-3 w-3" /> Fechada
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="gap-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                            >
                              <Unlock className="h-3 w-3" /> Aberta
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">
                          {comp.fechada_em
                            ? format(new Date(comp.fechada_em), "dd/MM/yyyy HH:mm", { locale: ptBR })
                            : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-muted-foreground">{comp.fechada_por ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right">
                          {fechada ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setCompDialog({ comp, acao: "reabrir" })}
                                >
                                  <Unlock className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Reabrir competência</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => setCompDialog({ comp, acao: "fechar" })}>
                              <Lock className="mr-1.5 h-3.5 w-3.5" /> Fechar mês
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {competencias.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                        Nenhuma competência cadastrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* ─── Modal de Reprocessamento ─── */}
        <Dialog open={modalOpen} onOpenChange={(o) => !aplicarMutation.isPending && setModalOpen(o)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                Aplicar conta — {classeAlvo?.codigo} {classeAlvo?.nome}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-1 pt-1">
                  <div>
                    Nova conta: <span className="font-mono text-xs text-foreground">{contaEscolhida}</span>
                  </div>
                  <div>
                    Selecione em quais meses <strong>abertos</strong> aplicar o carimbo.
                  </div>
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-2 py-2">
              {competencias.map((comp) => {
                const fechada = comp.status === "FECHADA";
                const checked = mesesSelecionados.includes(comp.mes);
                return (
                  <label
                    key={`${comp.ano}-${comp.mes}`}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                      fechada ? "cursor-not-allowed border-dashed opacity-50" : "cursor-pointer hover:bg-accent"
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={fechada}
                      checked={checked}
                      onChange={(e) =>
                        setMesesSelecionados((prev) =>
                          e.target.checked ? [...prev, comp.mes] : prev.filter((m) => m !== comp.mes),
                        )
                      }
                      className="h-4 w-4"
                    />
                    <span className="tabular-nums">{formatComp(comp.ano, comp.mes)}</span>
                    {fechada && <Lock className="ml-auto h-3 w-3 text-muted-foreground" />}
                  </label>
                );
              })}
            </div>

            {mesesSelecionados.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Nenhum mês marcado: a conta será definida como padrão, mas nenhum mês será reprocessado.
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setModalOpen(false)} disabled={aplicarMutation.isPending}>
                Cancelar
              </Button>
              <Button onClick={() => aplicarMutation.mutate()} disabled={aplicarMutation.isPending}>
                {aplicarMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Aplicar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ─── Dialog Fechar/Reabrir ─── */}
        <Dialog open={!!compDialog} onOpenChange={(o) => !compMutation.isPending && !o && setCompDialog(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {compDialog?.acao === "fechar" ? "Fechar competência" : "Reabrir competência"}{" "}
                {compDialog && formatComp(compDialog.comp.ano, compDialog.comp.mes)}
              </DialogTitle>
              <DialogDescription>
                {compDialog?.acao === "fechar"
                  ? "Após fechar, nenhuma conta contábil deste mês poderá ser alterada. A trava é aplicada no banco de dados."
                  : "Reabrir permite alterar novamente as contas contábeis deste mês."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCompDialog(null)} disabled={compMutation.isPending}>
                Cancelar
              </Button>
              <Button
                variant={compDialog?.acao === "fechar" ? "destructive" : "default"}
                onClick={() => compDialog && compMutation.mutate(compDialog)}
                disabled={compMutation.isPending}
              >
                {compMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {compDialog?.acao === "fechar" ? "Fechar mês" : "Reabrir"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
