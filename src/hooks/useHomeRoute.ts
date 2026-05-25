import { useAuth } from "@/contexts/AuthContext";

/**
 * Hook que define a rota inicial (home) baseada nos papéis do usuário.
 *
 * Precedência (do mais "poderoso" pro mais "restrito"):
 *   admin                    → /
 *   controller_intercompany  → /intercompany/master
 *   analista_compras         → /suprimentos/pedidos
 *   aprovador_projetos       → /projetos
 *   responsavel_projeto      → /projetos
 *   requisitante             → /suprimentos/requisicoes
 *   (fallback)               → /suprimentos/requisicoes
 *
 * Cada destino foi validado contra hub_role_permissions: o role da precedência
 * sempre tem a permissão necessária pra renderizar o componente da rota.
 *
 * Se quiser mudar a ordem de precedência ou adicionar novo role, é só editar
 * o array ROLE_PRECEDENCE abaixo.
 */

interface RoleRoute {
  role_codigo: string;
  route: string;
}

// IMPORTANTE: ordem importa. Primeiro match vence.
const ROLE_PRECEDENCE: RoleRoute[] = [
  { role_codigo: "admin", route: "/" },
  { role_codigo: "controller_intercompany", route: "/intercompany/master" },
  { role_codigo: "analista_compras", route: "/suprimentos/pedidos" },
  { role_codigo: "aprovador_projetos", route: "/projetos" },
  { role_codigo: "responsavel_projeto", route: "/projetos" },
  { role_codigo: "requisitante", route: "/suprimentos/requisicoes" },
];

const FALLBACK_ROUTE = "/suprimentos/requisicoes";

export function useHomeRoute(): string {
  const { profile, roles } = useAuth();

  // Admin tem bypass independente de role (caso histórico de admin sem hub_user_role)
  if (profile?.is_admin) {
    return "/";
  }

  // Resolve por precedência
  const userRoleCodes = new Set((roles ?? []).map((r) => r.codigo));
  for (const { role_codigo, route } of ROLE_PRECEDENCE) {
    if (userRoleCodes.has(role_codigo)) {
      return route;
    }
  }

  return FALLBACK_ROUTE;
}
