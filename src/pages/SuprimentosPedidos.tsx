import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus,
  ShoppingCart,
  Loader2,
  User as UserIcon,
  Building2,
  Calendar,
  Package,
  X,
  FileText,
  Pencil,
  AlertCircle,
} from "lucide-react";
import { format, subDays, startOfWeek, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

// ════════════════════════════════════════════════════════════
// STATUS CONFIG
// ════════════════════════════════════════════════════════════
// Pedido tem 2 dimensões de status:
//  - status_local (ciclo do Hub): rascunho, enviando, enviado_alvo, erro_envio, sincronizado
//  - status (Alvo): Aberto, Pendente, Cancelado, Encerrado, etc
// Para a tela de lista, exibimos um BADGE COMBINADO inteligente
// ════════════════════════════════════════════════════════════

const STATUS_LOCAL_CONFIG: Record<string, { label: string; className: string }> = {
  rascunho: { label: "Rascunho", className: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30" },
  enviando: { label: "Enviando…", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
  enviado_alvo: {
    label: "Enviado ao ERP",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  },
  erro_envio: { label: "Erro no envio", className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30" },
  sincronizado: {
    label: "Sincronizado",
    className: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  },
};

// Para pedidos sincronizados, mostramos também o status do Alvo
const STATUS_ALVO_CONFIG: Record<string, string> = {
  Aberto: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  Pendente: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  Cancelado: "bg-red-500/10 text-red-700 border-red-500/20",
  Encerrado: "bg-slate-500/10 text-slate-700 border-slate-500/20",
};

// ════════════════════════════════════════════════════════════
// FORMATADORES
// ════════════════════════════════════════════════════════════

function formatBRL(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(valor));
}

export default function SuprimentosPedidos() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const podeVerTodos = useHasPermission(PERMISSIONS.COMPRAS_PEDIDOS_VIEW_ALL);
  const podeCriar = useHasPermission(PERMISSIONS.COMPRAS_PEDIDOS_CREATE);

  const [filtroStatusLocal, setFiltroStatusLocal] = useState("todos");
  const [filtroOrigem, setFiltroOrigem] = useState("todos");
  const [filtroDataInicio, setFiltroDataInicio] = useState<Date | undefined>(undefined);
  const [filtroDataFim, setFiltroDataFim] = useState<Date | undefined>(undefined);
  const [filtroComprador, setFiltroComprador] = useState("todos");
  const [filtroPreset, setFiltroPreset] = useState("todos");

  // ── Lista de funcionários (compradores) pra filtro ──────
  const { data: funcionarios = [] } = useQuery({
    queryKey: ["funcionarios_filtro_pedidos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("funcionarios_alvo_cache")
        .select("codigo, nome")
        .eq("status", "Trabalhando")
        .order("nome", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: podeVerTodos,
  });

  // ── Lista de pedidos ────────────────────────────────────
  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: [
      "pedidos_lista",
      user?.id,
      (profile as any)?.funcionario_alvo_codigo,
      podeVerTodos,
      filtroStatusLocal,
      filtroOrigem,
      filtroDataInicio?.toISOString(),
      filtroDataFim?.toISOString(),
      filtroComprador,
    ],
    queryFn: async () => {
      let query = (supabase as any).from("compras_pedidos").select("*").order("updated_at", { ascending: false });

      // Filtragem por papel: requisitante só vê pedidos derivados de SUAS reqs
      if (!podeVerTodos && user) {
        // Busca os numero_alvo das requisições deste usuário
        const { data: minhasReqs } = await (supabase as any)
          .from("compras_requisicoes")
          .select("numero_alvo")
          .eq("requisitante_user_id", user.id);

        const numerosReqs = (minhasReqs || []).map((r: any) => r.numero_alvo).filter((n: string | null) => n !== null);

        if (numerosReqs.length === 0) {
          // Usuário sem reqs → sem pedidos derivados → retorna vazio
          return [];
        }

        query = query.in("numero_req_comp", numerosReqs);
      }

      // Filtros UI
      if (filtroStatusLocal && filtroStatusLocal !== "todos") {
        query = query.eq("status_local", filtroStatusLocal);
      }

      if (filtroOrigem === "hub") {
        query = query.eq("criado_no_hub", true);
      } else if (filtroOrigem === "alvo") {
        query = query.eq("criado_no_hub", false);
      }

      if (filtroComprador && filtroComprador !== "todos") {
        query = query.eq("codigo_usuario", filtroComprador);
      }

      if (filtroDataInicio) {
        const inicio = new Date(filtroDataInicio);
        inicio.setHours(0, 0, 0, 0);
        query = query.gte("data_pedido", inicio.toISOString().slice(0, 10));
      }
      if (filtroDataFim) {
        const fim = new Date(filtroDataFim);
        fim.setHours(23, 59, 59, 999);
        query = query.lte("data_pedido", fim.toISOString().slice(0, 10));
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const handlePresetData = (preset: string) => {
    setFiltroPreset(preset);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const fimHoje = new Date();
    fimHoje.setHours(23, 59, 59, 999);
    if (preset === "todos") {
      setFiltroDataInicio(undefined);
      setFiltroDataFim(undefined);
    } else if (preset === "hoje") {
      setFiltroDataInicio(hoje);
      setFiltroDataFim(fimHoje);
    } else if (preset === "semana") {
      setFiltroDataInicio(startOfWeek(hoje, { weekStartsOn: 1 }));
      setFiltroDataFim(fimHoje);
    } else if (preset === "mes") {
      setFiltroDataInicio(startOfMonth(hoje));
      setFiltroDataFim(fimHoje);
    } else if (preset === "30dias") {
      setFiltroDataInicio(subDays(hoje, 30));
      setFiltroDataFim(fimHoje);
    }
  };

  const limparFiltros = () => {
    setFiltroStatusLocal("todos");
    setFiltroOrigem("todos");
    setFiltroDataInicio(undefined);
    setFiltroDataFim(undefined);
    setFiltroComprador("todos");
    setFiltroPreset("todos");
  };

  const temFiltroAtivo =
    filtroStatusLocal !== "todos" ||
    filtroOrigem !== "todos" ||
    filtroComprador !== "todos" ||
    !!filtroDataInicio ||
    !!filtroDataFim;

  const firstName = profile?.full_name?.split(" ")[0] || "";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {firstName ? `Olá, ${firstName}!` : "Pedidos de Compra"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {podeVerTodos
              ? "Gerencie todos os pedidos de compra do sistema."
              : "Acompanhe os pedidos derivados das suas requisições."}
          </p>
        </div>
        {podeCriar && (
          <Button onClick={() => navigate("/suprimentos/pedidos/novo")}>
            <Plus className="h-4 w-4" />
            Novo Pedido
          </Button>
        )}
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          {/* Status local */}
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
            <Select value={filtroStatusLocal} onValueChange={setFiltroStatusLocal}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="rascunho">Rascunho</SelectItem>
                <SelectItem value="enviando">Enviando</SelectItem>
                <SelectItem value="enviado_alvo">Enviado ao ERP</SelectItem>
                <SelectItem value="erro_envio">Erro no envio</SelectItem>
                <SelectItem value="sincronizado">Sincronizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Origem (Hub ou Alvo) */}
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Origem</label>
            <Select value={filtroOrigem} onValueChange={setFiltroOrigem}>
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas</SelectItem>
                <SelectItem value="hub">Criado no Hub</SelectItem>
                <SelectItem value="alvo">Criado no ERP</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Período */}
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Período</label>
            <Select value={filtroPreset} onValueChange={handlePresetData}>
              <SelectTrigger>
                <SelectValue placeholder="Todo período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todo período</SelectItem>
                <SelectItem value="hoje">Hoje</SelectItem>
                <SelectItem value="semana">Esta semana</SelectItem>
                <SelectItem value="mes">Este mês</SelectItem>
                <SelectItem value="30dias">Últimos 30 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Comprador (quem pode ver todos) */}
          {podeVerTodos && (
            <div className="min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Comprador</label>
              <Select value={filtroComprador} onValueChange={setFiltroComprador}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {funcionarios.map((f: any) => (
                    <SelectItem key={f.codigo} value={f.codigo}>
                      {f.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Limpar */}
          {temFiltroAtivo && (
            <Button variant="ghost" size="sm" onClick={limparFiltros} className="text-muted-foreground">
              <X className="mr-1 h-3 w-3" /> Limpar filtros
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Contagem */}
      {!isLoading && pedidos.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {pedidos.length} pedido{pedidos.length !== 1 ? "s" : ""} encontrado
          {pedidos.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : pedidos.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border">
          <Card className="border-0 bg-transparent shadow-none text-center max-w-md">
            <CardContent className="flex flex-col items-center gap-4 pt-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <ShoppingCart className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {temFiltroAtivo
                    ? "Nenhum pedido encontrado com os filtros aplicados"
                    : podeVerTodos
                      ? "Nenhum pedido cadastrado"
                      : "Você ainda não tem pedidos vinculados"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {temFiltroAtivo
                    ? "Tente ajustar os filtros para ver mais resultados."
                    : podeVerTodos
                      ? "Os pedidos aparecerão aqui quando criados no Hub ou descobertos no ERP."
                      : "Os pedidos derivados das suas requisições aparecerão aqui."}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pedidos.map((ped: any) => {
            const statusLocalCfg = STATUS_LOCAL_CONFIG[ped.status_local] || STATUS_LOCAL_CONFIG.rascunho;
            const statusAlvoClass = ped.status ? STATUS_ALVO_CONFIG[ped.status] : null;
            const isEditavel = ped.status_local === "rascunho" || ped.status_local === "erro_envio";
            const numeroVisivel = ped.numero?.startsWith("RASCUNHO-") ? "(rascunho)" : ped.numero || "(sem nº)";

            return (
              <Card
                key={ped.id}
                className={
                  "cursor-pointer transition-colors hover:border-primary/50" +
                  (isEditavel ? " bg-muted/40 border-dashed opacity-70 hover:opacity-100 hover:bg-muted/60" : "")
                }
                onClick={() => {
                  if (isEditavel) {
                    navigate(`/suprimentos/pedidos/novo?pedidoId=${ped.id}`);
                  } else {
                    navigate(`/suprimentos/pedidos/${ped.id}`);
                  }
                }}
              >
                <CardContent className="space-y-3 p-5">
                  {/* Linha 1: status + numero */}
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={statusLocalCfg.className}>
                      {statusLocalCfg.label}
                    </Badge>
                    <span className="text-xs font-mono text-muted-foreground">Nº {numeroVisivel}</span>
                  </div>

                  {/* Linha 2: status do Alvo (se tiver) + origem */}
                  <div className="flex items-center gap-2 text-xs">
                    {statusAlvoClass && (
                      <Badge variant="outline" className={statusAlvoClass}>
                        {ped.status}
                      </Badge>
                    )}
                    {ped.criado_no_hub === true && (
                      <Badge variant="outline" className="bg-purple-500/10 text-purple-700 border-purple-500/20">
                        Hub
                      </Badge>
                    )}
                  </div>

                  {/* Fornecedor + valor */}
                  <div>
                    <p className="text-sm font-medium text-foreground line-clamp-2">
                      {ped.nome_entidade || "(sem fornecedor)"}
                    </p>
                    <p className="mt-1 text-sm font-mono text-emerald-600">{formatBRL(ped.valor_total)}</p>
                  </div>

                  {/* Metadados */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {ped.data_pedido && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(ped.data_pedido), "dd/MM/yyyy", { locale: ptBR })}
                      </span>
                    )}
                    {ped.numero_req_comp && (
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        Req {ped.numero_req_comp}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {ped.codigo_usuario && (
                      <span className="flex items-center gap-1">
                        <UserIcon className="h-3 w-3" />
                        {ped.codigo_usuario}
                      </span>
                    )}
                  </div>

                  {/* Banner de erro / aviso de rascunho */}
                  {ped.status_local === "erro_envio" && ped.erro_envio?.message && (
                    <div className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                      <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                      <p className="text-[11px] text-destructive line-clamp-2">{ped.erro_envio.message}</p>
                    </div>
                  )}

                  {/* Footer: data + botão editar (se editável) */}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <p className="text-[11px] text-muted-foreground/60">
                      Atualizado em {format(new Date(ped.updated_at || ped.created_at), "dd/MM/yyyy", { locale: ptBR })}
                    </p>
                    {isEditavel && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Pencil className="h-2.5 w-2.5" />
                        Clique para editar
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
