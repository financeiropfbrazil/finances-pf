import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { contarRequisicoesPendentes } from "@/services/requisicoesService";

/**
 * Contagem de requisições aguardando decisão do líder — alimenta o badge do menu
 * "Aprovações" (FASE 3, decisão C1).
 *
 * A missão não tem e-mail de aviso (decisão gerencial 13): o badge é o ÚNICO
 * sinal de que existe alguém esperando. Por isso ele conta no servidor
 * (`head: true`, zero linhas trafegadas) e revalida ao voltar para a aba.
 *
 * Só consulta quem tem `compras.requisicoes.aprovar` — para todo o resto o hook
 * devolve 0 sem tocar no banco.
 */
export function useAprovacoesPendentes() {
  const { user, profile } = useAuth();
  const podeAprovar = useHasPermission(PERMISSIONS.COMPRAS_REQUISICOES_APROVAR);
  const isAdmin = profile?.is_admin === true;

  const { data: total = 0, refetch } = useQuery({
    queryKey: ["aprovacoes_pendentes_count", user?.id, isAdmin],
    queryFn: () => contarRequisicoesPendentes(user!.id, isAdmin),
    enabled: !!user && podeAprovar,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  return { total, podeAprovar, refetch };
}
