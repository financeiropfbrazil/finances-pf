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
import { Plus, ClipboardList, Loader2, User as UserIcon, Building2, Calendar, Package, Filter, X } from "lucide-react";
import { format, subDays, startOfWeek, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  rascunho: { label: "Rascunho", className: "bg-slate-500/15 text-slate-600 border-slate-500/30" },
  pendente_envio: { label: "Pendente de envio", className: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  sincronizada: { label: "Enviada ao ERP", className: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  cancelada: { label: "Cancelada", className: "bg-red-500/15 text-red-600 border-red-500/30" },
  convertida_pedido: { label: "Convertida em Pedido", className: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
};

export default function SuprimentosRequisicoes() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const podeVerTodas = useHasPermission(PERMISSIONS.COMPRAS_REQUISICOES_VIEW_ALL);

  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [filtroDataInicio, setFiltroDataInicio] = useState<Date | undefined>(undefined);
  const [filtroDataFim, setFiltroDataFim] = useState<Date | undefined>(undefined);
  const [filtroFuncionario, setFiltroFuncionario] = useState("todos");
  const [filtroPreset, setFiltroPreset] = useState("todos");

  const { data: funcionarios = [] } = useQuery({
    queryKey: ["funcionarios_filtro_lista"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("funcionarios_alvo_cache")
        .select("codigo, nome")
        .eq("status", "Trabalhando")
        .order("nome", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: podeVerTodas,
  });

  const { data: requisicoes = [], isLoading } = useQuery({
    queryKey: [
      "requisicoes_lista",
      user?.id,
      (profile as any)?.funcionario_alvo_codigo,
      podeVerTodas,
      filtroStatus,
      filtroDataInicio?.toISOString(),
      filtroDataFim?.toISOString(),
      filtroFuncionario,
    ],
    queryFn: async () => {
      let query = (supabase as any).from("compras_requisicoes").select("*").order("updated_at", { ascending: false });

      if (!podeVerTodas && user) {
        const funcionarioCodigo = (profile as any)?.funcionario_alvo_codigo;
        if (funcionarioCodigo) {
          query = query.or(`requisitante_user_id.eq.${user.id},codigo_funcionario.eq.${funcionarioCodigo}`);
        } else {
          query = query.eq("requisitante_user_id", user.id);
        }
      }

      if (filtroStatus && filtroStatus !== "todos") {
        query = query.eq("status", filtroStatus);
      }

      if (filtroFuncionario && filtroFuncionario !== "todos") {
        query = query.eq("codigo_funcionario", filtroFuncionario);
      }

      if (filtroDataInicio) {
        const inicio = new Date(filtroDataInicio);
        inicio.setHours(0, 0, 0, 0);
        query = query.gte("updated_at", inicio.toISOString());
      }
      if (filtroDataFim) {
        const fim = new Date(filtroDataFim);
        fim.setHours(23, 59, 59, 999);
        query = query.lte("updated_at", fim.toISOString());
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
    setFiltroStatus("todos");
    setFiltroDataInicio(undefined);
    setFiltroDataFim(undefined);
    setFiltroFuncionario("todos");
    setFiltroPreset("todos");
  };

  const temFiltroAtivo =
    filtroStatus !== "todos" || filtroFuncionario !== "todos" || !!filtroDataInicio || !!filtroDataFim;

  const firstName = profile?.full_name?.split(" ")[0] || "";

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {firstName ? `Olá, ${firstName}!` : "Requisições de Compra"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {podeVerTodas
              ? "Gerencie todas as requisições de compra do sistema."
              : "Crie e acompanhe suas requisições de compra."}
          </p>
        </div>
        <Button onClick={() => navigate("/suprimentos/requisicoes/nova")}>
          <Plus className="h-4 w-4" />
          Nova Requisição
        </Button>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          {/* Status */}
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Status</label>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="rascunho">Rascunho (erro)</SelectItem>
                <SelectItem value="pendente_envio">Pendente de envio</SelectItem>
                <SelectItem value="sincronizada">Enviada ao ERP</SelectItem>
                <SelectItem value="cancelada">Cancelada</SelectItem>
                <SelectItem value="convertida_pedido">Convertida em pedido</SelectItem>
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

          {/* Funcionário (quem pode ver todas) */}
          {podeVerTodas && (
            <div className="min-w-[200px]">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Funcionário</label>
              <Select value={filtroFuncionario} onValueChange={setFiltroFuncionario}>
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
      {!isLoading && requisicoes.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {requisicoes.length} requisição{requisicoes.length !== 1 ? "ões" : ""} encontrada
          {requisicoes.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : requisicoes.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border">
          <Card className="border-0 bg-transparent shadow-none text-center max-w-md">
            <CardContent className="flex flex-col items-center gap-4 pt-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <ClipboardList className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {temFiltroAtivo
                    ? "Nenhuma requisição encontrada com os filtros aplicados"
                    : podeVerTodas
                      ? "Nenhuma requisição cadastrada"
                      : "Você ainda não tem requisições"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {temFiltroAtivo
                    ? "Tente ajustar os filtros para ver mais resultados."
                    : podeVerTodas
                      ? "Assim que os requisitantes começarem a criar requisições, elas aparecerão aqui."
                      : 'Clique em "Nova Requisição" para criar sua primeira solicitação de compra.'}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {requisicoes.map((req: any) => {
            const statusCfg = STATUS_CONFIG[req.status] || STATUS_CONFIG.rascunho;
            return (
              <Card
                key={req.id}
                className="cursor-pointer transition-colors hover:border-primary/50"
                onClick={() => navigate(`/suprimentos/requisicoes/${req.id}`)}
              >
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={statusCfg.className}>
                      {statusCfg.label}
                    </Badge>
                    {req.numero_alvo && (
                      <span className="text-xs font-mono text-muted-foreground">Nº {req.numero_alvo}</span>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-medium text-foreground line-clamp-2">
                      {req.descricao || "(sem descrição)"}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        {req.total_itens ?? 0} {(req.total_itens ?? 0) === 1 ? "item" : "itens"}
                      </span>
                      {req.data_necessidade && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Necessidade: {format(new Date(req.data_necessidade), "dd/MM/yyyy", { locale: ptBR })}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {req.funcionario_nome && (
                      <span className="flex items-center gap-1">
                        <UserIcon className="h-3 w-3" />
                        {req.funcionario_nome}
                      </span>
                    )}
                    {req.centro_ctrl_nome && (
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {req.centro_ctrl_nome}
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground/60">
                    Atualizada em {format(new Date(req.updated_at || req.created_at), "dd/MM/yyyy", { locale: ptBR })}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
