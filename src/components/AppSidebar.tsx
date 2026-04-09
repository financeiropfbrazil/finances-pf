import {
  BarChart3,
  Landmark,
  FileText,
  Package,
  Building2,
  Handshake,
  PackageCheck,
  Wallet,
  Receipt,
  ArrowLeftRight,
  CreditCard,
  Settings,
  TrendingUp,
  ChevronDown,
  LayoutDashboard,
  CheckSquare,
  ClipboardList,
  ClipboardCheck,
  Upload,
  FolderKanban,
  FileBarChart,
  Tag,
  BookOpen,
  ShieldCheck,
  Users as UsersIcon,
  RefreshCw,
  Mail,
  Boxes,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const navItems = [
  { titleKey: "nav.dashboard", url: "/", icon: BarChart3 },
  { titleKey: "nav.cash", url: "/cash", icon: Landmark },
  { titleKey: "nav.receivables", url: "/receivables", icon: FileText },
  { titleKey: "nav.sales", url: "/sales", icon: TrendingUp },
  // Inventory handled separately as expandable
  // Fixed Assets handled separately as expandable
  { titleKey: "nav.commodatum", url: "/commodatum", icon: Handshake },
  { titleKey: "nav.nf_entrada", url: "/nf-entrada", icon: FileText },
  // Compras handled separately as expandable
  // Entidades handled separately as expandable
  // Contas a Pagar handled separately as expandable
  { titleKey: "nav.loans", url: "/loans", icon: Wallet },
  { titleKey: "nav.taxes", url: "/taxes", icon: Receipt },
  { titleKey: "nav.intercompany", url: "/intercompany", icon: ArrowLeftRight },
  { titleKey: "nav.credit_cards", url: "/credit-cards", icon: CreditCard },
  { titleKey: "nav.projetos", url: "/projetos", icon: FolderKanban },
  { titleKey: "nav.closing", url: "/closing", icon: ClipboardCheck },
] as const;

const routePermMap: Record<string, string> = {
  "/": "dashboard",
  "/cash": "cash",
  "/receivables": "receivables",
  "/sales": "sales",
  "/commodatum": "commodatum",
  "/nf-entrada": "nf_entrada",
  "/email-nfe": "nf_entrada",
  "/entidades": "entidades",
  "/loans": "loans",
  "/taxes": "taxes",
  "/intercompany": "intercompany",
  "/credit-cards": "credit_cards",
  "/contas-a-pagar": "contas_pagar",
  "/projetos": "projetos",
  "/closing": "closing",
  "/suprimentos/requisicoes": "suprimentos_requisicoes",
};

const inventorySubItems = [
  { label: "Posição de Estoque", url: "/inventory", icon: Package },
  { label: "Fechamentos", url: "/inventory/closings", icon: ClipboardCheck },
  { label: "Contagem", url: "/inventory/counting", icon: ClipboardList },
  { label: "Importação de Produtos", url: "/inventory/import", icon: Upload },
  { label: "Relatórios", url: "/inventory/reports", icon: FileBarChart },
];

const comprasSubItems = [
  { label: "Pedidos de Compra", url: "/compras/pedidos-compra", icon: ClipboardList },
  { label: "Notas Fiscais", url: "/compras/notas-fiscais", icon: FileText },
  { label: "Notas de Serviço", url: "/compras/notas-servico", icon: FileText },
  { label: "Certificado Digital", url: "/compras/certificado", icon: ShieldCheck },
];

const suprimentosSubItems = [
  { label: "Requisições de Compra", url: "/suprimentos/requisicoes", icon: ClipboardList },
];

const entidadesSubItems = [
  { label: "Lista de Entidades", url: "/entidades", icon: UsersIcon },
  { label: "Upload de Códigos", url: "/entidades/upload-codigos", icon: Upload },
];

const contasPagarSubItems = [
  { label: "Lista", url: "/contas-a-pagar", icon: ClipboardList },
  { label: "Dashboards", url: "/contas-a-pagar/dashboard", icon: LayoutDashboard },
];

const fixedAssetsSubItems = [
  { label: "Dashboard", url: "/fixed-assets/dashboard", icon: LayoutDashboard },
  { label: "Conciliação Contábil", url: "/fixed-assets/reconciliation", icon: CheckSquare },
  { label: "Ativos", url: "/fixed-assets/items", icon: ClipboardList },
];

const settingsItems = [
  { titleKey: "settings.api_connection", url: "/settings/api", icon: Settings },
  { titleKey: "settings.cost_centers", url: "/settings/cost-centers", icon: Tag },
  { titleKey: "settings.classes_rec_desp", url: "/settings/classes-rec-desp", icon: BookOpen },
  { titleKey: "settings.sync_jobs", url: "/configuracoes/sincronizacoes", icon: RefreshCw },
  { titleKey: "settings.users", url: "/settings/users", icon: UsersIcon, adminOnly: true },
] as const;

export function AppSidebar() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  const { hasAccess, isAdmin } = usePermissions();
  const location = useLocation();
  const isFixedAssetsActive = location.pathname.startsWith("/fixed-assets");
  const isInventoryActive = location.pathname.startsWith("/inventory");
  const isComprasActive = location.pathname.startsWith("/compras");
  const isEntidadesActive = location.pathname.startsWith("/entidades");
  const isContasPagarActive = location.pathname.startsWith("/contas-a-pagar");
  const isSuprimentosActive = location.pathname.startsWith("/suprimentos");

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <BarChart3 className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-sm font-bold tracking-tight text-sidebar-foreground">
            P&F
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                // Permission check for regular items
                const permKey = routePermMap[item.url];
                if (permKey && !hasAccess(permKey)) {
                  // Still need to render expandable groups even if the trigger item is hidden
                  if (item.titleKey === "nav.commodatum") {
                    const showInventory = hasAccess("inventory");
                    const showFixedAssets = hasAccess("fixed_assets");
                    if (!showInventory && !showFixedAssets) return null;
                    return (
                      <div key="inventory-and-fixed-assets-group">
                        {showInventory && renderInventoryGroup(t, isInventoryActive)}
                        {showFixedAssets && renderFixedAssetsGroup(t, isFixedAssetsActive)}
                      </div>
                    );
                  }
                  if (item.titleKey === "nav.nf_entrada") {
                    if (!hasAccess("compras") && !hasAccess("entidades")) return null;
                    return (
                      <div key="nf-entrada-and-compras-group">
                        {hasAccess("compras") && renderComprasGroup(t, isComprasActive)}
                        {hasAccess("entidades") && renderEntidadesGroup(t, isEntidadesActive)}
                      </div>
                    );
                  }
                  if (item.titleKey === "nav.loans") {
                    if (!hasAccess("contas_pagar")) return null;
                    return (
                      <div key="contaspagar-only">
                        {renderContasPagarGroup(t, isContasPagarActive)}
                      </div>
                    );
                  }
                  return null;
                }

                // Insert Inventory + Fixed Assets expandable before Commodatum
                if (item.titleKey === "nav.commodatum") {
                  return (
                    <div key="inventory-and-fixed-assets-group">
                      {hasAccess("inventory") && renderInventoryGroup(t, isInventoryActive)}
                      {hasAccess("fixed_assets") && renderFixedAssetsGroup(t, isFixedAssetsActive)}

                      {/* Then render commodatum */}
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <NavLink
                            to={item.url}
                            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span>{t(item.titleKey as any)}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </div>
                  );
                }

                // Insert Compras expandable after NF Entrada
                if (item.titleKey === "nav.nf_entrada") {
                  return (
                    <div key="nf-entrada-and-compras-group">
                      {/* NF Entrada item */}
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <NavLink
                            to={item.url}
                            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span>{t(item.titleKey as any)}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>

                      {/* Email NF-e item */}
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <NavLink
                            to="/email-nfe"
                            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                          >
                            <Mail className="h-4 w-4 shrink-0" />
                            <span>Email NF-e</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>

                      {/* Compras expandable */}
                      {hasAccess("compras") && renderComprasGroup(t, isComprasActive)}

                      {/* Entidades expandable */}
                      {hasAccess("entidades") && renderEntidadesGroup(t, isEntidadesActive)}
                    </div>
                  );
                }


                // Insert Contas a Pagar expandable before Loans
                if (item.titleKey === "nav.loans") {
                  return (
                    <div key="contaspagar-and-loans">
                      {hasAccess("contas_pagar") && renderContasPagarGroup(t, isContasPagarActive)}
                      <SidebarMenuItem>
                        <SidebarMenuButton asChild>
                          <NavLink
                            to={item.url}
                            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                            activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span>{t(item.titleKey as any)}</span>
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </div>
                  );
                }

                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        end={item.url === "/"}
                        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span>{t(item.titleKey as any)}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="my-2" />

        <SidebarGroup>
          <SidebarGroupLabel className="px-3 text-xs font-semibold uppercase text-muted-foreground">
            {t("nav.settings" as any)}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => {
                if ('adminOnly' in item && item.adminOnly && !isAdmin) return null;
                if (item.titleKey !== "settings.users" && item.titleKey !== "settings.sync_jobs" && !hasAccess("settings")) return null;
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span>{item.titleKey === "settings.sync_jobs" ? "Sincronizações" : t(item.titleKey as any)}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

function renderInventoryGroup(t: any, isActive: boolean) {
  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible-inv">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              isActive ? "bg-sidebar-accent text-sidebar-primary font-medium" : ""
            }`}
          >
            <Package className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">{t("nav.inventory" as any)}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/collapsible-inv:rotate-[-90deg]" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {inventorySubItems.map((sub) => (
              <SidebarMenuSubItem key={sub.url}>
                <SidebarMenuSubButton asChild>
                  <NavLink
                    to={sub.url}
                    end={sub.url === "/inventory"}
                    className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                  >
                    <sub.icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{sub.label}</span>
                  </NavLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function renderFixedAssetsGroup(t: any, isActive: boolean) {
  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              isActive ? "bg-sidebar-accent text-sidebar-primary font-medium" : ""
            }`}
          >
            <Building2 className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">{t("nav.fixed_assets" as any)}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/collapsible:rotate-[-90deg]" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {fixedAssetsSubItems.map((sub) => (
              <SidebarMenuSubItem key={sub.url}>
                <SidebarMenuSubButton asChild>
                  <NavLink
                    to={sub.url}
                    className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                  >
                    <sub.icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{sub.label}</span>
                  </NavLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function renderComprasGroup(t: any, isActive: boolean) {
  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible-compras">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              isActive ? "bg-sidebar-accent text-sidebar-primary font-medium" : ""
            }`}
          >
            <PackageCheck className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Compras</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/collapsible-compras:rotate-[-90deg]" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {comprasSubItems.map((sub) => (
              <SidebarMenuSubItem key={sub.url}>
                <SidebarMenuSubButton asChild>
                  <NavLink
                    to={sub.url}
                    className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                  >
                    <sub.icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{sub.label}</span>
                  </NavLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function renderEntidadesGroup(t: any, isActive: boolean) {
  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible-entidades">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              isActive ? "bg-sidebar-accent text-sidebar-primary font-medium" : ""
            }`}
          >
            <UsersIcon className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">{t("nav.entidades" as any)}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/collapsible-entidades:rotate-[-90deg]" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {entidadesSubItems.map((sub) => (
              <SidebarMenuSubItem key={sub.url}>
                <SidebarMenuSubButton asChild>
                  <NavLink
                    to={sub.url}
                    end={sub.url === "/entidades"}
                    className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                  >
                    <sub.icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{sub.label}</span>
                  </NavLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function renderContasPagarGroup(t: any, isActive: boolean) {
  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible-cap">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              isActive ? "bg-sidebar-accent text-sidebar-primary font-medium" : ""
            }`}
          >
            <CreditCard className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Contas a Pagar</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/collapsible-cap:rotate-[-90deg]" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {contasPagarSubItems.map((sub) => (
              <SidebarMenuSubItem key={sub.url}>
                <SidebarMenuSubButton asChild>
                  <NavLink
                    to={sub.url}
                    end={sub.url === "/contas-a-pagar"}
                    className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                  >
                    <sub.icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{sub.label}</span>
                  </NavLink>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
