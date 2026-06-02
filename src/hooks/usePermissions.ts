import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mapa de migração gradual: menu_key (sistema antigo) → código RBAC (sistema novo).
 *
 * Módulos presentes aqui são decididos pelo RBAC via AuthContext.permissions.
 * Módulos NÃO presentes continuam saindo da tabela user_permissions (legado).
 *
 * Conforme for migrando mais módulos pro RBAC, adiciona uma entrada aqui
 * e cria a permissão correspondente no catálogo hub_permissions.
 */
const MENU_TO_PERMISSION: Record<string, string> = {
  suprimentos_requisicoes: "compras.requisicoes.access",
  suprimentos_pedidos: "compras.pedidos.access",
  intercompany: "intercompany.access",
  projetos: "projetos.access",
  ferramentas_bulk_edit_produtos_campos: "ferramentas.bulk_edit.execute",
  ferramentas_cron_req: "ferramentas.cron.view",
};

/**
 * Heurística para distinguir um código RBAC de um menu_key legado.
 * Códigos RBAC seguem o padrão "modulo.recurso.acao" (contêm ponto),
 * ex.: "compras.pedidos.access", "compras.pedidos.view_all".
 * menu_keys legados usam snake_case sem ponto, ex.: "suprimentos_pedidos".
 */
function isRbacCode(key: string): boolean {
  return key.includes(".");
}

export function usePermissions() {
  const { user, profile, permissions: rbacPermissions } = useAuth();
  const [legacyPermissions, setLegacyPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    if (profile?.is_admin) {
      setLegacyPermissions({});
      setLoading(false);
      return;
    }

    const fetchLegacyPermissions = async () => {
      const { data } = await supabase.from("user_permissions").select("menu_key, allowed").eq("user_id", user.id);

      const map: Record<string, boolean> = {};
      (data || []).forEach((p: any) => {
        map[p.menu_key] = p.allowed;
      });
      setLegacyPermissions(map);
      setLoading(false);
    };

    fetchLegacyPermissions();
  }, [user, profile?.is_admin]);

  /**
   * Decide se o usuário tem acesso a um recurso.
   *
   * Aceita TRÊS formatos de chave:
   *   1. menu_key migrado (ex.: "suprimentos_pedidos") → traduz via MENU_TO_PERMISSION
   *      e checa o código RBAC resultante em rbacPermissions.
   *   2. código RBAC direto (ex.: "compras.pedidos.access", "compras.pedidos.view_all")
   *      → checa diretamente em rbacPermissions. Isso cobre rotas que passam a
   *      permissão fina como permKey (detalhe/novo/dashboard de pedidos), que antes
   *      caíam erroneamente no fallback legado e retornavam false para não-admin.
   *   3. menu_key legado não migrado → consulta a tabela user_permissions.
   */
  const hasAccess = (permKey: string): boolean => {
    if (!user) return false;

    // Admin tem bypass total
    if (profile?.is_admin) return true;

    // (1) menu_key migrado pro RBAC → traduz e checa
    const rbacPermissionCode = MENU_TO_PERMISSION[permKey];
    if (rbacPermissionCode) {
      return rbacPermissions.includes(rbacPermissionCode);
    }

    // (2) código RBAC passado diretamente (contém ponto) → checa direto no RBAC
    if (isRbacCode(permKey)) {
      return rbacPermissions.includes(permKey);
    }

    // (3) menu_key legado → sistema antigo (tabela user_permissions)
    return legacyPermissions[permKey] === true;
  };

  return {
    hasAccess,
    loading,
    isAdmin: profile?.is_admin ?? false,
    permissions: legacyPermissions,
  };
}
