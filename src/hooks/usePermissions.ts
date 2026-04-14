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
};

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

  const hasAccess = (menuKey: string): boolean => {
    if (!user) return false;

    // Admin tem bypass total
    if (profile?.is_admin) return true;

    // Se o menu foi migrado pro RBAC, decide via permissão RBAC
    const rbacPermissionCode = MENU_TO_PERMISSION[menuKey];
    if (rbacPermissionCode) {
      return rbacPermissions.includes(rbacPermissionCode);
    }

    // Senão, cai no sistema antigo (tabela user_permissions)
    return legacyPermissions[menuKey] === true;
  };

  return {
    hasAccess,
    loading,
    isAdmin: profile?.is_admin ?? false,
    permissions: legacyPermissions,
  };
}
