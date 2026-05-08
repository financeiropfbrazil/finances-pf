import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "sonner";
import { BarChart3, Globe } from "lucide-react";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const navigate = useNavigate();
  const { t, language, setLanguage } = useLanguage();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      toast.error(t("auth.error"), { description: error.message });
      setLoading(false);
      return;
    }

    // ✅ NOVO: detecta must_change_password antes de redirecionar pra "/"
    if (data?.user) {
      const { data: profileData } = await (supabase as any)
        .from("profiles")
        .select("must_change_password")
        .eq("user_id", data.user.id)
        .maybeSingle();

      setLoading(false);

      if (profileData?.must_change_password === true) {
        toast.info("Senha temporária detectada", {
          description: "Por segurança, defina uma nova senha agora.",
        });
        navigate("/reset-password");
        return;
      }
    }

    setLoading(false);
    navigate("/");
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast.error(t("auth.error"), { description: error.message });
    } else {
      toast.success(t("auth.reset_sent"));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLanguage(language === "pt" ? "en" : "pt")}
            className="text-muted-foreground hover:text-foreground"
          >
            <Globe className="mr-1 h-4 w-4" />
            {language === "pt" ? "EN" : "PT"}
          </Button>
        </div>

        <Card className="border-border/50 shadow-2xl">
          <CardHeader className="items-center space-y-4 pb-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                <BarChart3 className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-foreground">P&F Financial Controller</h1>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={forgotMode ? handleForgotPassword : handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="bg-secondary/50"
                />
              </div>

              {!forgotMode && (
                <div className="space-y-2">
                  <Label htmlFor="password">{t("auth.password")}</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="bg-secondary/50"
                  />
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("auth.signing_in") : forgotMode ? t("auth.send_reset") : t("auth.login")}
              </Button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setForgotMode(!forgotMode)}
                className="text-sm text-muted-foreground hover:text-primary transition-colors"
              >
                {forgotMode ? t("auth.back_to_login") : t("auth.forgot_password")}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
