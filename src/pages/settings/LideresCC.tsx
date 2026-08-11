/**
 * LideresCC — Mapa de Líderes por Centro de Custo (FASE 6.1, §4 do AJUSTE-6.1-POS-DISCOVERY)
 *
 * Molde: src/pages/settings/Users.tsx — gate `profile.is_admin`, card de acesso restrito,
 * escrita SÓ por RPC, toasts com variant destructive no erro.
 *
 * Universo (P1): os 81 centros de custo `is_active AND group_type='F'` — a mesma fonte que o
 * wizard de requisição oferece. Os 14 CCs do bloco `00001.*` (renumerados no Alvo em 17/05/2026)
 * ficam de fora de propósito: apareceriam como "sem líder" para sempre e falsificariam a cobertura.
 */

import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "@/hooks/use-toast";
import {
  UserPlus,
  Loader2,
  Search,
  ShieldAlert,
  Check,
  ChevronsUpDown,
  X,
  History,
  RefreshCw,
  AlertTriangle,
  Users,
  Info,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  listarMapaLideres,
  listarUsuariosParaSelecao,
  obterDataEspelhoCcs,
  listarMapeamentosInativos,
  atribuirLiderCc,
  revogarLiderCc,
  atribuirLideresEmMassa,
  type LinhaMapaLideres,
  type LiderDoCc,
  type UsuarioSelecao,
  type MapeamentoInativo,
  type RelatorioMassa,
} from "@/services/lideresCcService";

/** Acima disto, o espelho de CCs é considerado velho e ganha destaque visual (P3). */
const DIAS_ESPELHO_VELHO = 7;

function formatarData(valor: string | null | undefined, comHora = false): string {
  if (!valor) return "—";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, comHora ? "dd/MM/yyyy 'às' HH:mm" : "dd/MM/yyyy", { locale: ptBR });
}

function rotuloUsuario(u: { full_name?: string | null; email?: string | null }): string {
  return u.full_name?.trim() || u.email?.trim() || "(sem nome)";
}

type CheckState = boolean | "indeterminate";

/**
 * Estado do checkbox do cabeçalho, medido SÓ contra o conjunto visível (§3.1 do AJUSTE 6.2).
 * A seleção pode conter CCs escondidos pelo filtro atual — eles não influenciam este estado,
 * senão o cabeçalho ficaria "indeterminado" sem nada indeterminado à vista.
 */
function estadoCabecalho(selecionados: Set<string>, visiveis: string[]): CheckState {
  if (visiveis.length === 0) return false;
  const marcados = visiveis.filter((c) => selecionados.has(c)).length;
  if (marcados === 0) return false;
  if (marcados === visiveis.length) return true;
  return "indeterminate";
}

/** Lista compacta dos CCs de um grupo do diálogo de massa; rola sozinha quando cresce. */
function ListaCcs({
  linhas,
  comLideres = false,
}: {
  linhas: LinhaMapaLideres[];
  comLideres?: boolean;
}) {
  return (
    <ScrollArea className={cn("mt-2", linhas.length > 6 && "h-32")}>
      <div className="space-y-1 pr-3">
        {linhas.map((l) => (
          <div key={l.erp_code} className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-mono">{l.erp_code}</span>
            <span className="text-muted-foreground">{l.nome}</span>
            {comLideres && l.lideres.length > 0 && (
              <span className="text-amber-700 dark:text-amber-500">
                hoje: {l.lideres.map((x) => rotuloUsuario(x)).join(", ")}
              </span>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

export default function LideresCC() {
  const { profile } = useAuth();
  const isCurrentUserAdmin = profile?.is_admin === true;

  const [linhas, setLinhas] = useState<LinhaMapaLideres[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioSelecao[]>([]);
  const [inativos, setInativos] = useState<MapeamentoInativo[]>([]);
  const [dataEspelho, setDataEspelho] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // filtros
  const [busca, setBusca] = useState("");
  const [somenteSemLider, setSomenteSemLider] = useState(false);
  const [mostrarInativos, setMostrarInativos] = useState(false);

  // dialog de atribuição
  const [atribuirAlvo, setAtribuirAlvo] = useState<LinhaMapaLideres | null>(null);
  const [usuarioSel, setUsuarioSel] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // confirmação de remoção
  const [removerAlvo, setRemoverAlvo] = useState<{ linha: LinhaMapaLideres; lider: LiderDoCc } | null>(null);
  const [removendo, setRemovendo] = useState(false);

  // seleção + atribuição em massa (AJUSTE 6.2)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [massaAberta, setMassaAberta] = useState(false);
  const [usuarioMassa, setUsuarioMassa] = useState<string>("");
  const [motivoMassa, setMotivoMassa] = useState("");
  const [userPopoverMassaOpen, setUserPopoverMassaOpen] = useState(false);
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioMassa | null>(null);
  /** Congelado ao disparar o laço: depois do recarregamento, todos passam a "já é líder". */
  const [ignoradosMassa, setIgnoradosMassa] = useState(0);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [mapa, users, espelho, revogados] = await Promise.all([
        listarMapaLideres(),
        listarUsuariosParaSelecao(),
        obterDataEspelhoCcs(),
        listarMapeamentosInativos(),
      ]);
      setLinhas(mapa);
      setUsuarios(users);
      setDataEspelho(espelho);
      setInativos(revogados);
    } catch (err: any) {
      toast({
        title: "Erro ao carregar o mapa de líderes",
        description: err?.message || "Verifique suas permissões.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isCurrentUserAdmin) fetchData();
    else setLoading(false);
  }, [isCurrentUserAdmin]);

  // ── Cobertura: só o universo real (órfãos não entram na conta) ─────────────
  const cobertura = useMemo(() => {
    const universo = linhas.filter((l) => !l.orfao);
    const comLider = universo.filter((l) => l.qtd_lideres > 0).length;
    const total = universo.length;
    return {
      comLider,
      total,
      pct: total > 0 ? Math.round((comLider / total) * 100) : 0,
      orfaos: linhas.filter((l) => l.orfao).length,
    };
  }, [linhas]);

  const diasDesdeEspelho = useMemo(() => {
    if (!dataEspelho) return null;
    const d = new Date(dataEspelho);
    if (Number.isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86_400_000);
  }, [dataEspelho]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (somenteSemLider && l.qtd_lideres > 0) return false;
      if (!q) return true;
      if (l.erp_code.toLowerCase().includes(q)) return true;
      if (l.nome.toLowerCase().includes(q)) return true;
      return l.lideres.some(
        (x) =>
          (x.nome || "").toLowerCase().includes(q) || (x.email || "").toLowerCase().includes(q),
      );
    });
  }, [linhas, busca, somenteSemLider]);

  /** user_id → rótulo, para o histórico (evita depender de leitura direta de `profiles`). */
  const mapaUsuarios = useMemo(() => {
    const m = new Map<string, string>();
    usuarios.forEach((u) => m.set(u.user_id, rotuloUsuario(u)));
    return m;
  }, [usuarios]);

  const usuariosOrdenados = useMemo(
    () =>
      [...usuarios].sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return rotuloUsuario(a).localeCompare(rotuloUsuario(b), "pt-BR");
      }),
    [usuarios],
  );

  // ── Seleção em massa (§3.1) ────────────────────────────────────────────────
  // Regra central: o cabeçalho age sobre o VISÍVEL; a seleção guardada é a acumulada.
  // Isso permite empilhar (filtra "Administrativo" → marca todos; filtra "Operacional" →
  // marca mais alguns) sem que trocar o filtro apague o que já estava marcado.

  /** Visíveis E selecionáveis: órfãos ficam de fora — atribuir neles daria `CC_INVALIDO`. */
  const visiveisSelecionaveis = useMemo(() => filtradas.filter((l) => !l.orfao), [filtradas]);

  const estadoHeader = useMemo(
    () => estadoCabecalho(selecionados, visiveisSelecionaveis.map((l) => l.erp_code)),
    [selecionados, visiveisSelecionaveis],
  );

  /**
   * Linhas selecionadas — inclusive as escondidas pelo filtro atual.
   * Deriva de `linhas` (não de `selecionados` direto) para que um código que sumiu do mapa
   * depois de um recarregamento não seja contado nem enviado.
   */
  const linhasSelecionadas = useMemo(
    () => linhas.filter((l) => selecionados.has(l.erp_code)),
    [linhas, selecionados],
  );

  /** Quantos dos selecionados o filtro atual está escondendo — dito na barra, sem surpresa. */
  const selecionadosOcultos = useMemo(() => {
    const visiveis = new Set(filtradas.map((l) => l.erp_code));
    return linhasSelecionadas.filter((l) => !visiveis.has(l.erp_code)).length;
  }, [linhasSelecionadas, filtradas]);

  const alternarLinha = (cc: string, marcar: boolean) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (marcar) next.add(cc);
      else next.delete(cc);
      return next;
    });
  };

  /** "Todos os visíveis": só o conjunto exibido agora; o resto da seleção é preservado. */
  const alternarVisiveis = (marcar: boolean) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      visiveisSelecionaveis.forEach((l) => {
        if (marcar) next.add(l.erp_code);
        else next.delete(l.erp_code);
      });
      return next;
    });
  };

  /**
   * Os três grupos do diálogo (§3.3), calculados contra o líder escolhido:
   *  - `jaLider`    → já lidera este CC; **não entra no laço** (ver nota em `handleAtribuirMassa`);
   *  - `jaTemOutro` → tem outro líder ativo; entra, mas passa pelo aviso de H1;
   *  - `receberao`  → está sem líder; caso simples.
   */
  const grupos = useMemo(() => {
    const jaLider: LinhaMapaLideres[] = [];
    const jaTemOutro: LinhaMapaLideres[] = [];
    const receberao: LinhaMapaLideres[] = [];

    linhasSelecionadas.forEach((l) => {
      if (usuarioMassa && l.lideres.some((x) => x.user_id === usuarioMassa)) jaLider.push(l);
      else if (l.qtd_lideres > 0) jaTemOutro.push(l);
      else receberao.push(l);
    });

    return { jaLider, jaTemOutro, receberao, aplicar: [...receberao, ...jaTemOutro] };
  }, [linhasSelecionadas, usuarioMassa]);

  const abrirMassa = () => {
    setUsuarioMassa("");
    setMotivoMassa("");
    setUserPopoverMassaOpen(false);
    setRelatorio(null);
    setProgresso(null);
    setMassaAberta(true);
  };

  const handleAtribuirMassa = async () => {
    if (!usuarioMassa || grupos.aplicar.length === 0) return;

    const alvos = grupos.aplicar.map((l) => ({ erp_code: l.erp_code, nome: l.nome }));
    setIgnoradosMassa(grupos.jaLider.length);
    setProgresso({ feitos: 0, total: alvos.length });

    const rel = await atribuirLideresEmMassa(usuarioMassa, alvos, motivoMassa, (feitos, total) =>
      setProgresso({ feitos, total }),
    );

    setProgresso(null);
    setRelatorio(rel);
    await fetchData(); // recarrega tabela, cobertura e "sem líder" (§3.4)
  };

  /** A seleção só é limpa aqui — depois de o relatório ser lido e fechado (§3.4). */
  const fecharRelatorio = () => {
    setRelatorio(null);
    setMassaAberta(false);
    setSelecionados(new Set());
    setUsuarioMassa("");
    setMotivoMassa("");
  };

  const abrirAtribuir = (linha: LinhaMapaLideres) => {
    setAtribuirAlvo(linha);
    setUsuarioSel("");
    setMotivo("");
    setUserPopoverOpen(false);
  };

  /** No individual: o escolhido já lidera este CC? Reatribuir só sobrescreveria a trilha. */
  const jaLiderDesteCc =
    !!atribuirAlvo && !!usuarioSel && atribuirAlvo.lideres.some((x) => x.user_id === usuarioSel);

  const handleAtribuir = async () => {
    if (!atribuirAlvo || !usuarioSel) return;
    setSalvando(true);
    const r = await atribuirLiderCc(usuarioSel, atribuirAlvo.erp_code, motivo);
    setSalvando(false);

    toast({
      title: r.ok ? "Liderança atribuída" : "Não foi possível atribuir",
      description: r.mensagem,
      variant: r.ok ? undefined : "destructive",
    });

    if (r.ok) {
      setAtribuirAlvo(null);
      fetchData();
    }
  };

  const handleRemover = async () => {
    if (!removerAlvo) return;
    setRemovendo(true);
    const r = await revogarLiderCc(removerAlvo.lider.user_id, removerAlvo.linha.erp_code);
    setRemovendo(false);

    toast({
      title: r.ok ? "Liderança removida" : "Não foi possível remover",
      description: r.mensagem,
      variant: r.ok ? undefined : "destructive",
    });

    setRemoverAlvo(null);
    if (r.ok || r.codigo === "NAO_ENCONTRADA") fetchData();
  };

  // ── Gate (mesmo padrão de settings/Users.tsx) ──────────────────────────────
  if (!isCurrentUserAdmin) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Acesso restrito a administradores.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Líderes por Centro de Custo</h1>
          <p className="text-sm text-muted-foreground">
            Quem aprova as requisições de cada centro de custo. Atribuir aqui concede o papel{" "}
            <span className="font-medium">Líder de Departamento</span> no mesmo ato.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      {/* Cobertura + data do espelho */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cobertura</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {cobertura.comLider} de {cobertura.total}
            </div>
            <p className="text-xs text-muted-foreground">
              centros de custo com líder definido ({cobertura.pct}%)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sem líder definido
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{cobertura.total - cobertura.comLider}</div>
            <p className="text-xs text-muted-foreground">
              requisições nesses CCs seguem direto ao ERP, sem passar pelo gate de aprovação
            </p>
          </CardContent>
        </Card>

        <Card className={cn(diasDesdeEspelho !== null && diasDesdeEspelho > DIAS_ESPELHO_VELHO && "border-amber-500")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Espelho de centros de custo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm">
              {diasDesdeEspelho !== null && diasDesdeEspelho > DIAS_ESPELHO_VELHO && (
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
              )}
              <span className="font-medium">
                Atualizado em {formatarData(dataEspelho, true)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {diasDesdeEspelho === null
                ? "Data indisponível."
                : `Há ${diasDesdeEspelho} dia(s). `}
              A lista vem do Alvo e só muda ao sincronizar em{" "}
              <Link to="/settings/cost-centers" className="underline underline-offset-2">
                Centros de Custo
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por código, nome do centro ou líder…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="sem-lider" checked={somenteSemLider} onCheckedChange={setSomenteSemLider} />
          <Label htmlFor="sem-lider" className="cursor-pointer text-sm">
            Somente sem líder
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="inativos" checked={mostrarInativos} onCheckedChange={setMostrarInativos} />
          <Label htmlFor="inativos" className="cursor-pointer text-sm">
            Mostrar histórico
          </Label>
        </div>
      </div>

      {/* Tabela principal */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando o mapa…
            </div>
          ) : filtradas.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {linhas.length === 0
                ? "Nenhum centro de custo ativo encontrado. Sincronize o espelho em Centros de Custo."
                : "Nenhum centro de custo corresponde ao filtro."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[44px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Checkbox
                            checked={estadoHeader}
                            onCheckedChange={(v) => alternarVisiveis(v === true)}
                            disabled={visiveisSelecionaveis.length === 0}
                            aria-label="Selecionar todos os centros de custo visíveis"
                            /* o Checkbox compartilhado desenha o mesmo ✓ no estado parcial;
                               sem isto, "alguns" e "todos" ficam idênticos aos olhos */
                            className="data-[state=indeterminate]:bg-primary/40 data-[state=indeterminate]:text-primary-foreground"
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        Marca apenas os {visiveisSelecionaveis.length} centro(s) que o filtro atual
                        está exibindo. O que já estiver selecionado fora do filtro é preservado.
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="w-[280px]">Centro de custo</TableHead>
                  <TableHead>
                    <span className="inline-flex items-center gap-1">
                      Líder(es)
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Um centro de custo pode ter mais de um líder.{" "}
                          <span className="font-medium">Qualquer um deles aprova sozinho</span> — não
                          há aprovação conjunta nem ordem, e a decisão do primeiro encerra a
                          pendência para os demais.
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </TableHead>
                  <TableHead className="w-[110px] text-right">Requisições</TableHead>
                  <TableHead className="w-[110px] text-right">Pendentes</TableHead>
                  <TableHead className="w-[130px] text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((l) => (
                  <TableRow
                    key={l.erp_code}
                    className={cn(
                      l.orfao && "bg-amber-50/60 dark:bg-amber-950/20",
                      !l.orfao && selecionados.has(l.erp_code) && "bg-muted/50",
                    )}
                  >
                    <TableCell className="align-top">
                      {l.orfao ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {/* `span` porque checkbox desabilitado não emite eventos de mouse */}
                            <span className="inline-flex">
                              <Checkbox checked={false} disabled aria-label="Não selecionável" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            Este centro saiu do universo ativo — atribuir liderança aqui seria
                            recusado com <span className="font-mono text-[11px]">CC_INVALIDO</span>.
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Checkbox
                          checked={selecionados.has(l.erp_code)}
                          onCheckedChange={(v) => alternarLinha(l.erp_code, v === true)}
                          aria-label={`Selecionar ${l.erp_code}`}
                        />
                      )}
                    </TableCell>

                    <TableCell className="align-top">
                      <div className="font-mono text-xs">{l.erp_code}</div>
                      <div className={cn("text-sm", l.orfao && "text-amber-700 dark:text-amber-500")}>
                        {l.nome}
                      </div>
                      {l.orfao ? (
                        <div className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-500">
                          <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>
                            Mapeamento aponta para um centro que saiu do universo ativo (apagado,
                            expirado ou totalizador). Remova a liderança ou corrija o cadastro.
                          </span>
                        </div>
                      ) : (
                        l.department_type && (
                          <Badge variant="secondary" className="mt-1 text-[10px]">
                            {l.department_type}
                          </Badge>
                        )
                      )}
                    </TableCell>

                    <TableCell className="align-top">
                      {l.lideres.length === 0 ? (
                        <span className="text-sm text-muted-foreground">— sem líder —</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {l.lideres.map((x) => (
                            <div key={x.user_id} className="flex items-center gap-2">
                              <span className="text-sm">{rotuloUsuario(x)}</span>
                              {x.email && x.nome && (
                                <span className="text-xs text-muted-foreground">{x.email}</span>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-1 text-muted-foreground hover:text-destructive"
                                title="Remover liderança"
                                onClick={() => setRemoverAlvo({ linha: l, lider: x })}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                          {l.lideres.length > 1 && (
                            <span className="text-xs text-muted-foreground">
                              Qualquer um deles aprova sozinho.
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="text-right align-top text-sm tabular-nums">
                      {l.total_reqs}
                    </TableCell>
                    <TableCell className="text-right align-top text-sm tabular-nums">
                      {l.pendentes > 0 ? (
                        <Badge variant="secondary">{l.pendentes}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => abrirAtribuir(l)}
                        disabled={l.orfao}
                        title={
                          l.orfao
                            ? "Centro de custo fora do universo ativo — não é possível atribuir"
                            : undefined
                        }
                      >
                        <UserPlus className="mr-2 h-3.5 w-3.5" />
                        Atribuir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Barra de ação da seleção (§3.2) — sticky, não some ao rolar */}
      {linhasSelecionadas.length > 0 && (
        <div className="sticky bottom-4 z-20">
          <Card className="border-primary/40 shadow-lg">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="text-sm">
                <span className="font-medium">{linhasSelecionadas.length}</span> centro(s) de custo
                selecionado(s)
                {selecionadosOcultos > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {selecionadosOcultos} fora do filtro atual
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelecionados(new Set())}>
                  Limpar seleção
                </Button>
                <Button size="sm" onClick={abrirMassa}>
                  <Users className="mr-2 h-3.5 w-3.5" />
                  Atribuir líder
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Histórico (soft-delete) */}
      {mostrarInativos && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              Histórico de lideranças removidas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {inativos.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Nenhuma liderança foi removida até hoje.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Centro de custo</TableHead>
                    <TableHead>Quem liderava</TableHead>
                    <TableHead>Desde</TableHead>
                    <TableHead>Removido em</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inativos.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">{m.codigo_centro_ctrl}</TableCell>
                      <TableCell className="text-sm">
                        {mapaUsuarios.get(m.lider_user_id) ?? "(usuário removido)"}
                      </TableCell>
                      <TableCell className="text-sm">{formatarData(m.atribuido_em)}</TableCell>
                      <TableCell className="text-sm">{formatarData(m.revogado_em)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {m.motivo || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialog: atribuir */}
      <Dialog open={!!atribuirAlvo} onOpenChange={(o) => !o && setAtribuirAlvo(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Atribuir líder</DialogTitle>
            <DialogDescription>
              {atribuirAlvo && (
                <>
                  <span className="font-mono text-xs">{atribuirAlvo.erp_code}</span> — {atribuirAlvo.nome}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Usuário</Label>
              <Popover open={userPopoverOpen} onOpenChange={setUserPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {usuarioSel
                      ? rotuloUsuario(usuarios.find((u) => u.user_id === usuarioSel) || {})
                      : "Escolher usuário…"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[470px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar por nome ou e-mail…" />
                    <CommandList>
                      <CommandEmpty>Nenhum usuário encontrado.</CommandEmpty>
                      <CommandGroup>
                        {usuariosOrdenados.map((u) => (
                          <CommandItem
                            key={u.user_id}
                            value={`${u.full_name ?? ""} ${u.email ?? ""}`}
                            onSelect={() => {
                              setUsuarioSel(u.user_id);
                              setUserPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                usuarioSel === u.user_id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <div className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-sm">{rotuloUsuario(u)}</span>
                              {u.full_name && u.email && (
                                <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                              )}
                            </div>
                            {u.ja_lider && (
                              <Badge variant="secondary" className="ml-2 shrink-0 text-[10px]">
                                já é líder
                              </Badge>
                            )}
                            {!u.is_active && (
                              <Badge variant="outline" className="ml-2 shrink-0 text-[10px]">
                                inativo
                              </Badge>
                            )}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="motivo-lider">Motivo (opcional)</Label>
              <Input
                id="motivo-lider"
                placeholder="Ex.: assumiu a gestão do departamento em 08/2026"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>

            {/* H1: nunca substitui, mas avisa antes de somar mais um líder */}
            {atribuirAlvo && atribuirAlvo.qtd_lideres > 0 && !jaLiderDesteCc && (
              <div className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-50 p-3 dark:bg-amber-950/20">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="space-y-1 text-xs">
                  <p className="font-medium text-amber-800 dark:text-amber-400">
                    Este CC já tem líder. Deseja mesmo adicionar?
                  </p>
                  <p className="text-muted-foreground">
                    Ambos poderão aprovar; basta a decisão de um deles. O líder atual{" "}
                    <span className="font-medium">não é substituído</span> — hoje:{" "}
                    {atribuirAlvo.lideres.map((x) => rotuloUsuario(x)).join(", ")}.
                  </p>
                </div>
              </div>
            )}

            {/* Reatribuir a quem já lidera sobrescreveria `atribuido_em` e `motivo` do vínculo */}
            {jaLiderDesteCc && (
              <div className="flex gap-2 rounded-md border p-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Esta pessoa <span className="font-medium">já lidera este centro de custo</span>.
                  Não há o que atribuir — escolha outro usuário ou cancele.
                </p>
              </div>
            )}

            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              Ao confirmar, o papel <span className="font-medium">Líder de Departamento</span> é
              concedido a esta pessoa no mesmo ato — não é preciso um segundo passo na tela de
              Usuários. Requisições já pendentes não são alteradas.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAtribuirAlvo(null)} disabled={salvando}>
              Cancelar
            </Button>
            <Button onClick={handleAtribuir} disabled={!usuarioSel || salvando || jaLiderDesteCc}>
              {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Atribuir liderança
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: atribuição em massa (§3.3 e §3.4) */}
      <Dialog
        open={massaAberta}
        onOpenChange={(aberto) => {
          if (aberto) return;
          if (progresso) return; // não fecha no meio do laço
          if (relatorio) fecharRelatorio();
          else setMassaAberta(false);
        }}
      >
        <DialogContent className="sm:max-w-[640px]">
          {relatorio ? (
            /* ── 3. Relatório ─────────────────────────────────────────────── */
            <>
              <DialogHeader>
                <DialogTitle>Atribuição concluída</DialogTitle>
                <DialogDescription>
                  {relatorio.sucessos.length} atribuído(s) · {relatorio.falhas.length} falharam
                  {ignoradosMassa > 0 && ` · ${ignoradosMassa} ignorado(s)`}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                {relatorio.sucessos.length > 0 && (
                  <div className="flex items-start gap-2 rounded-md border p-3 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <span>
                      <span className="font-medium">{relatorio.sucessos.length}</span> centro(s) de
                      custo agora têm este líder. O papel{" "}
                      <span className="font-medium">Líder de Departamento</span> foi concedido uma
                      única vez, não uma por centro.
                    </span>
                  </div>
                )}

                {relatorio.falhas.length > 0 && (
                  <div className="rounded-md border border-destructive/50 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                      <XCircle className="h-4 w-4" />
                      {relatorio.falhas.length} centro(s) de custo falharam
                    </div>
                    <ScrollArea className="mt-2 max-h-48">
                      <div className="space-y-2 pr-3">
                        {relatorio.falhas.map((f) => (
                          <div key={f.erp_code} className="text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-mono">{f.erp_code}</span>
                              <Badge variant="outline" className="text-[10px]">
                                {f.resultado.codigo}
                              </Badge>
                            </div>
                            <p className="text-muted-foreground">{f.resultado.mensagem}</p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Os demais centros não foram afetados por estas falhas — cada atribuição é
                      independente. Corrija a causa e tente de novo só nestes.
                    </p>
                  </div>
                )}

                {ignoradosMassa > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {ignoradosMassa} centro(s) foram ignorados porque esta pessoa já os liderava.
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button onClick={fecharRelatorio}>Fechar</Button>
              </DialogFooter>
            </>
          ) : progresso ? (
            /* ── 2. Execução ──────────────────────────────────────────────── */
            <>
              <DialogHeader>
                <DialogTitle>Atribuindo liderança…</DialogTitle>
                <DialogDescription>
                  Processando {Math.min(progresso.feitos + 1, progresso.total)} de {progresso.total}.
                  Não feche esta janela.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-2">
                <Progress
                  value={progresso.total > 0 ? (progresso.feitos / progresso.total) * 100 : 0}
                />
                <p className="text-xs text-muted-foreground">
                  {progresso.feitos} de {progresso.total} concluído(s). Uma falha isolada não
                  interrompe o restante.
                </p>
              </div>
            </>
          ) : (
            /* ── 1. Formulário ────────────────────────────────────────────── */
            <>
              <DialogHeader>
                <DialogTitle>Atribuir líder a {linhasSelecionadas.length} centro(s) de custo</DialogTitle>
                <DialogDescription>
                  Um único líder é aplicado a todos os selecionados. Nenhum líder atual é removido.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Usuário</Label>
                  <Popover open={userPopoverMassaOpen} onOpenChange={setUserPopoverMassaOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between font-normal"
                      >
                        {usuarioMassa
                          ? rotuloUsuario(usuarios.find((u) => u.user_id === usuarioMassa) || {})
                          : "Escolher usuário…"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[580px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar por nome ou e-mail…" />
                        <CommandList>
                          <CommandEmpty>Nenhum usuário encontrado.</CommandEmpty>
                          <CommandGroup>
                            {usuariosOrdenados.map((u) => (
                              <CommandItem
                                key={u.user_id}
                                value={`${u.full_name ?? ""} ${u.email ?? ""}`}
                                onSelect={() => {
                                  setUsuarioMassa(u.user_id);
                                  setUserPopoverMassaOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    usuarioMassa === u.user_id ? "opacity-100" : "opacity-0",
                                  )}
                                />
                                <div className="flex min-w-0 flex-1 flex-col">
                                  <span className="truncate text-sm">{rotuloUsuario(u)}</span>
                                  {u.full_name && u.email && (
                                    <span className="truncate text-xs text-muted-foreground">
                                      {u.email}
                                    </span>
                                  )}
                                </div>
                                {u.ja_lider && (
                                  <Badge variant="secondary" className="ml-2 shrink-0 text-[10px]">
                                    já é líder
                                  </Badge>
                                )}
                                {!u.is_active && (
                                  <Badge variant="outline" className="ml-2 shrink-0 text-[10px]">
                                    inativo
                                  </Badge>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Resumo do que vai acontecer, em três grupos (§3.3.2) */}
                <div className="space-y-2">
                  {grupos.receberao.length > 0 && (
                    <div className="rounded-md border p-3">
                      <p className="text-sm font-medium">
                        {grupos.receberao.length} centro(s) de custo receberão este líder
                      </p>
                      <ListaCcs linhas={grupos.receberao} />
                    </div>
                  )}

                  {grupos.jaTemOutro.length > 0 && (
                    <div className="rounded-md border border-amber-500/50 bg-amber-50 p-3 dark:bg-amber-950/20">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
                            {grupos.jaTemOutro.length} centro(s) de custo já têm líder
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Este CC já tem líder. Deseja mesmo adicionar? Ambos poderão aprovar;
                            basta a decisão de um deles.
                          </p>
                          <ListaCcs linhas={grupos.jaTemOutro} comLideres />
                        </div>
                      </div>
                    </div>
                  )}

                  {grupos.jaLider.length > 0 && (
                    <div className="rounded-md border p-3">
                      <p className="text-sm font-medium text-muted-foreground">
                        {grupos.jaLider.length} centro(s) — já é líder, será ignorado
                      </p>
                      <ListaCcs linhas={grupos.jaLider} />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="motivo-massa">Motivo (opcional)</Label>
                  <Input
                    id="motivo-massa"
                    placeholder="Ex.: reorganização de alçadas 08/2026"
                    value={motivoMassa}
                    onChange={(e) => setMotivoMassa(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    O mesmo texto é gravado em todas as atribuições — vira a trilha comum desta
                    rodada.
                  </p>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setMassaAberta(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleAtribuirMassa} disabled={!usuarioMassa || grupos.aplicar.length === 0}>
                  <Users className="mr-2 h-4 w-4" />
                  {grupos.aplicar.length > 0
                    ? `Atribuir a ${grupos.aplicar.length} centro(s) de custo`
                    : "Nada a atribuir"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmação: remover */}
      <AlertDialog open={!!removerAlvo} onOpenChange={(o) => !o && setRemoverAlvo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover liderança?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-medium">{removerAlvo && rotuloUsuario(removerAlvo.lider)}</span>{" "}
                  deixa de aprovar requisições de{" "}
                  <span className="font-mono text-xs">{removerAlvo?.linha.erp_code}</span> —{" "}
                  {removerAlvo?.linha.nome}.
                </p>
                <p>
                  {removerAlvo && removerAlvo.linha.pendentes > 0 ? (
                    <>
                      Há <span className="font-medium">{removerAlvo.linha.pendentes}</span>{" "}
                      requisição(ões) pendente(s) neste centro de custo. Elas{" "}
                      <span className="font-medium">não serão alteradas</span> e continuam decidíveis
                      por um administrador.
                    </>
                  ) : (
                    "Não há requisições pendentes neste centro de custo. Nenhuma requisição é alterada."
                  )}
                </p>
                <p className="text-muted-foreground">
                  O registro é mantido no histórico (quem liderava e quando saiu). Se esta pessoa não
                  liderar mais nenhum centro de custo, o papel Líder de Departamento também é revogado.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removendo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleRemover();
              }}
              disabled={removendo}
            >
              {removendo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
