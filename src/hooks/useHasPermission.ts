import { useAuth } from "@/contexts/AuthContext";
import type { PermissionCode } from "@/constants/permissions";

/**
 * Hook para verificar se o usuário logado tem uma permissão específica.
 *
 * Regra de bypass: se profile.is_admin === true, retorna true pra qualquer
 * permissão (super-poder). Isso é consistente com a função SQL user_has_permission.
 *
 * @example
 * const podeVerTodas = useHasPermission(PERMISSIONS.COMPRAS_REQUISICOES_VIEW_ALL);
 * if (!podeVerTodas) return <NaoAutorizado />;
 */
export function useHasPermission(permissionCode: PermissionCode | string): boolean {
  const { profile, permissions } = useAuth();

  // Bypass: admin tem tudo
  if (profile?.is_admin === true) return true;

  // Senão, verifica se o código está na lista de permissões do user
  return permissions.includes(permissionCode);
}

/**
 * Hook para verificar se o usuário tem PELO MENOS UMA das permissões listadas.
 * Útil quando uma tela pode ser acessada por múltiplos papéis com perms diferentes.
 *
 * @example
 * const podeAcessar = useHasAnyPermission([
 *   PERMISSIONS.COMPRAS_REQUISICOES_VIEW_ALL,
 *   PERMISSIONS.COMPRAS_REQUISICOES_VIEW_OWN,
 * ]);
 */
export function useHasAnyPermission(permissionCodes: (PermissionCode | string)[]): boolean {
  const { profile, permissions } = useAuth();

  // Bypass: admin tem tudo
  if (profile?.is_admin === true) return true;

  return permissionCodes.some((code) => permissions.includes(code));
}

/**
 * Hook para verificar se o usuário tem TODAS as permissões listadas.
 * Útil quando uma ação exige combinação (ex: criar + enviar).
 */
export function useHasAllPermissions(permissionCodes: (PermissionCode | string)[]): boolean {
  const { profile, permissions } = useAuth();

  // Bypass: admin tem tudo
  if (profile?.is_admin === true) return true;

  return permissionCodes.every((code) => permissions.includes(code));
}

/**
 * Hook que retorna se o usuário tem um papel específico.
 * Use com moderação — geralmente é melhor verificar por permissão, não por papel.
 * Útil principalmente pra labels/UI ("você é Analista de Compras").
 */
export function useHasRole(roleCode: string): boolean {
  const { roles } = useAuth();
  return roles.some((r) => r.codigo === roleCode);
}
