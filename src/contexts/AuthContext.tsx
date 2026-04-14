import React, { createContext, useContext, useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  is_admin: boolean;
  is_active: boolean;
}

interface UserRole {
  codigo: string;
  nome: string;
  modulo: string;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  permissions: string[];
  roles: UserRole[];
  loading: boolean;
  signOut: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (userId: string): Promise<Profile | null> => {
    try {
      const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
      if (error) throw error;
      return data ?? null;
    } catch (error) {
      console.error("Failed to fetch profile", error);
      return null;
    }
  };

  const loadPermissions = async (userId: string): Promise<string[]> => {
    try {
      const { data, error } = await (supabase as any).rpc("get_user_permissions", {
        p_user_id: userId,
      });
      if (error) throw error;
      return (data || []).map((row: { codigo: string }) => row.codigo);
    } catch (error) {
      console.error("Failed to fetch permissions", error);
      return [];
    }
  };

  const loadRoles = async (userId: string): Promise<UserRole[]> => {
    try {
      const { data, error } = await (supabase as any).rpc("get_user_roles", {
        p_user_id: userId,
      });
      if (error) throw error;
      return (data || []) as UserRole[];
    } catch (error) {
      console.error("Failed to fetch roles", error);
      return [];
    }
  };

  useEffect(() => {
    let mounted = true;

    const syncSession = async (nextSession: Session | null) => {
      if (!mounted) return;
      setSession(nextSession);

      if (nextSession?.user) {
        const userId = nextSession.user.id;
        // Carrega profile, permissions e roles em paralelo
        const [profileData, permsData, rolesData] = await Promise.all([
          loadProfile(userId),
          loadPermissions(userId),
          loadRoles(userId),
        ]);

        if (mounted) {
          setProfile(profileData);
          setPermissions(permsData);
          setRoles(rolesData);
        }
      } else {
        setProfile(null);
        setPermissions([]);
        setRoles([]);
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncSession(nextSession).finally(() => {
        if (mounted) setLoading(false);
      });
    });

    void (async () => {
      try {
        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();
        await syncSession(currentSession);
      } catch (error) {
        console.error("Failed to restore auth session", error);
        if (mounted) {
          setSession(null);
          setProfile(null);
          setPermissions([]);
          setRoles([]);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setPermissions([]);
    setRoles([]);
  };

  /**
   * Recarrega permissões e papéis do usuário atual.
   * Útil quando um admin muda o papel de alguém e quer refletir sem logout.
   */
  const refreshPermissions = async () => {
    if (!session?.user) return;
    const userId = session.user.id;
    const [permsData, rolesData] = await Promise.all([loadPermissions(userId), loadRoles(userId)]);
    setPermissions(permsData);
    setRoles(rolesData);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        permissions,
        roles,
        loading,
        signOut,
        refreshPermissions,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
