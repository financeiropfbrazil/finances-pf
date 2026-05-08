import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { KeyRound, Lock } from "lucide-react";

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"recovery" | "force_change" | null>(null);

  const navigate = useNavigate();
  const { t } = useLanguage();
  const { profile, session, refreshProfile } = useAuth();

  // Detecta de qual fluxo veio
  useEffect(() => {
    // Fluxo 1: hash recovery (link do email "Esqueci a senha")
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.get("type") === "recovery") {
      setMode("recovery");
      return;
    }

    // Fluxo 2: user logado com senha temporária (must_change_password=true)
    if (session && profile?.must_change_password === true) {
      setMode("force_change");
      return;
    }

    // Nenhum dos 2 — redireciona pra login
    navigate("/login");
  }, [profile, session, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password.length < 6) {
      toast.error("A senha deve ter no mínimo 6 caracteres");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }

    setLoading(true);

    // 1. Atualiza senha no Supabase Auth
    const { error: authErr } = await supabase.auth.updateUser({ password });

    if (authErr) {
      toast.error("Erro ao trocar senha", { description: authErr.message });
      setLoading(false);
      return;
    }

    // 2. Se for force_change, marca must_change_password=false em profiles
    if (mode === "force_change" && session?.user) {
      const { error: profileErr } = await (supabase as any).rpc("hub_clear_must_change_password");

      if (profileErr) {
        // Fallback: tenta upsert direto
        const { error: upsertErr } = await (supabase as any).from("profiles").upsert(
          {
            user_id: session.user.id,
            email: profile?.email,
            full_name: profile?.full_name,
            is_admin: profile?.is_admin ?? false,
            is_active: profile?.is_active ?? true,
            must_change_password: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        if (upsertErr) {
          console.error("Falha ao marcar must_change_password=false:", upsertErr);
          // Não bloqueia — senha já foi trocada, user pode logar
        }
      }

      // Recarrega profile pra refletir mudança
      await refreshProfile();
    }

    setLoading(false);
    toast.success("Senha atualizada com sucesso!");
    navigate("/");
  };

  if (mode === null) {
    return null; // aguardando detecção
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50 shadow-2xl">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              {mode === "force_change" ? (
                <Lock className="h-5 w-5 text-primary-foreground" />
              ) : (
                <KeyRound className="h-5 w-5 text-primary-foreground" />
              )}
            </div>
            <div>
              <CardTitle>{mode === "force_change" ? "Defina sua senha" : "Redefinir senha"}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {mode === "force_change"
                  ? "Por segurança, troque a senha temporária recebida por email."
                  : "Crie uma nova senha para sua conta."}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nova senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="bg-secondary/50"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirmar senha</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="bg-secondary/50"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading || password.length < 6 || password !== confirmPassword}
            >
              {loading ? "Salvando..." : "Salvar nova senha"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResetPassword;
