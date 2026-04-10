import { Globe, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SidebarTrigger } from "@/components/ui/sidebar";
export function AppHeader() {
  const { profile, signOut } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const { permissions, isAdmin } = usePermissions();

  const headerTitle = (() => {
    if (isAdmin) return "P&F Financial Controller";
    const keys = Object.keys(permissions).filter(k => permissions[k]);
    if (keys.length === 0) return "P&F Financial Controller";
    const financialPerms = keys.filter(p => !p.startsWith("suprimentos_"));
    if (financialPerms.length === 0) return "P&F Suprimentos";
    return "P&F Financial Controller";
  })();

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
        <span className="hidden text-sm font-semibold text-foreground sm:block">
          {headerTitle}
        </span>
      </div>

      <div className="flex items-center gap-2">

        {/* Language toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLanguage(language === "pt" ? "en" : "pt")}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title={language === "pt" ? "Switch to English" : "Mudar para Português"}
        >
          <Globe className="h-4 w-4" />
        </Button>

        {/* User info */}
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-primary text-xs text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-xs text-muted-foreground lg:block">
            {profile?.full_name}
          </span>
        </div>

        {/* Logout */}
        <Button
          variant="ghost"
          size="icon"
          onClick={signOut}
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          title={t("header.logout")}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
