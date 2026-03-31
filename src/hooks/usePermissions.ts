import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export function usePermissions() {
  const { user, profile } = useAuth();
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }

    if (profile?.is_admin) {
      setPermissions({});
      setLoading(false);
      return;
    }

    const fetchPermissions = async () => {
      const { data } = await supabase
        .from("user_permissions")
        .select("menu_key, allowed")
        .eq("user_id", user.id);

      const map: Record<string, boolean> = {};
      (data || []).forEach((p: any) => { map[p.menu_key] = p.allowed; });
      setPermissions(map);
      setLoading(false);
    };

    fetchPermissions();
  }, [user, profile?.is_admin]);

  const hasAccess = (menuKey: string): boolean => {
    if (!user) return false;
    if (profile?.is_admin) return true;
    return permissions[menuKey] === true;
  };

  return { hasAccess, loading, isAdmin: profile?.is_admin ?? false };
}
