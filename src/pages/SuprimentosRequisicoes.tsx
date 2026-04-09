import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, ClipboardList, Loader2, User as UserIcon, Building2, Calendar, Package } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface RequisicaoRow {
  id: string;
  requisitante_user_id: string;
  status: string;
  created_at: string;
  numero_alvo: string | null;
  descricao: string | null;
  data_necessidade: string;
  funcionario_nome: string | null;
  centro_ctrl_nome: string | null;
  finalidade_compra_label: string | null;
  total_itens: number | null;
  numero_pedido_compra_alvo: string | null;
}

interface RequisicaoComRequisitante extends RequisicaoRow {
  requisitante_nome: string | null;
}

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
  const isAdmin = profile?.is_admin === true;

  const { data: requisicoes, isLoading } = useQuery({
    queryKey: ["compras_requisicoes", user?.id, isAdmin],
    queryFn: async (): Promise<RequisicaoComRequisitante[]> => {
      if (!user) return [];

      let query = (supabase as any)
        .from("compras_requisicoes")
        .select("*")
        .order("created_at", { ascending: false });

      if (!isAdmin) {
        query = query.eq("requisitante_user_id", user.id);
      }

      const { data: reqs, error } = await query;
      if (error) throw error;
      if (!reqs || reqs.length === 0) return [];

      if (isAdmin) {
        const userIds = [...new Set(reqs.map((r: RequisicaoRow) => r.requisitante_user_id))];
        const { data: profiles } = await (supabase as any)
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", userIds);
        const profileMap = new Map(
          (profiles || []).map((p: any) => [p.user_id, p.full_name || p.email || "Desconhecido"])
        );
        return reqs.map((r: RequisicaoRow) => ({
          ...r,
          requisitante_nome: profileMap.get(r.requisitante_user_id) as string | null,
        }));
      }

      return reqs.map((r: RequisicaoRow) => ({ ...r, requisitante_nome: null }));
    },
    enabled: !!user,
  });

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
            {isAdmin
              ? "Gerencie todas as requisições de compra do sistema."
              : "Crie e acompanhe suas requisições de compra."}
          </p>
        </div>
        <Button onClick={() => navigate("/suprimentos/requisicoes/nova")}>
          <Plus className="h-4 w-4" />
          Nova Requisição
        </Button>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !requisicoes || requisicoes.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center rounded-lg border border-dashed border-border">
          <Card className="border-0 bg-transparent shadow-none text-center max-w-md">
            <CardContent className="flex flex-col items-center gap-4 pt-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <ClipboardList className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {isAdmin ? "Nenhuma requisição cadastrada" : "Você ainda não tem requisições"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isAdmin
                    ? "Assim que os requisitantes começarem a criar requisições, elas aparecerão aqui."
                    : "Clique em \"Nova Requisição\" para criar sua primeira solicitação de compra."}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {requisicoes.map((req) => {
            const statusCfg = STATUS_CONFIG[req.status] || STATUS_CONFIG.rascunho;
            return (
              <Card
                key={req.id}
                className="cursor-pointer transition-shadow hover:shadow-md"
                onClick={() => navigate(`/suprimentos/requisicoes/${req.id}`)}
              >
                <CardContent className="space-y-3 p-5">
                  {/* Top row: status + número */}
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={statusCfg.className}>
                      {statusCfg.label}
                    </Badge>
                    {req.numero_alvo && (
                      <span className="text-xs font-mono text-muted-foreground">
                        Nº {req.numero_alvo}
                      </span>
                    )}
                  </div>

                  {/* Descrição */}
                  <div>
                    <p className="text-sm font-medium text-foreground line-clamp-2">
                      {req.descricao || "(sem descrição)"}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Package className="h-3 w-3" />
                        {req.total_itens ?? 0} {(req.total_itens ?? 0) === 1 ? "item" : "itens"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Necessidade: {format(new Date(req.data_necessidade), "dd/MM/yyyy", { locale: ptBR })}
                      </span>
                    </div>
                  </div>

                  {/* Funcionário + CC */}
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

                  {/* Admin only: nome do requisitante */}
                  {isAdmin && req.requisitante_nome && (
                    <p className="text-xs text-primary/70">
                      Requisitante: {req.requisitante_nome}
                    </p>
                  )}

                  {/* Footer: data de criação */}
                  <p className="text-[11px] text-muted-foreground/60">
                    Criada em {format(new Date(req.created_at), "dd/MM/yyyy", { locale: ptBR })}
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
