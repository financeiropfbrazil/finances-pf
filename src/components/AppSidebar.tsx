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
  CreditCard,
  Settings,
  TrendingUp,
  ChevronDown,
  LayoutDashboard,
  CheckSquare,
  ClipboardList,
  ShoppingCart,
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
  Wrench,
  History,
  Coins,
  Factory,
  PackageSearch,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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

  { titleKey: "nav.credit_cards", url: "/credit-cards", icon: CreditCard },
  { titleKey: "nav.cartao_lancamento", url: "/cartao", icon: Receipt },
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

  "/credit-cards": "credit_cards",
  "/cartao": "cartao.access",
  "/contas-a-pagar": "contas_pagar",
  "/projetos": "projetos",
  "/closing": "closing",
  "/suprimentos/requisicoes": "suprimentos_requisicoes",
  "/intercompany/reembolsos/novo": "intercompany",
};

const inventorySubItems = [{ label: "Importação de Produtos", url: "/inventory/import", icon: Upload }];

const comprasSubItems = [
  { label: "Pedidos de Compra", url: "/compras/pedidos-compra", icon: ClipboardList },
  { label: "Notas de Serviço", url: "/compras/notas-servico", icon: FileText },
  { label: "Certificado Digital", url: "/compras/certificado", icon: ShieldCheck },
];

// `perm` opcional: item só aparece para quem tem a permissão (o grupo
// Suprimentos inteiro é liberado por suprimentos_requisicoes, mas nem todo
// mundo que vê o módulo pode sincronizar cadastros).
const suprimentosSubItems: { label: string; url: string; icon: any; perm?: string }[] = [
  { label: "Dashboard", url: "/suprimentos/dashboard", icon: BarChart3 },
  { label: "Requisições de Compra", url: "/suprimentos/requisicoes", icon: ClipboardList },
  { label: "Pedidos de Compra", url: "/suprimentos/pedidos", icon: ShoppingCart },
  { label: "Notas Fiscais", url: "/compras/notas-fiscais", icon: FileText },
  { label: "Atualizar Cadastros", url: "/suprimentos/cadastros", icon: RefreshCw, perm: "compras.cadastros.sync" },
];

// `perm` opcional, mesmo contrato do `suprimentosSubItems`: o grupo inteiro é
// liberado por `producao.access`, mas a RM tem gate próprio (`producao.rm.access`).
const producaoSubItems: { label: string; url: string; icon: any; perm?: string }[] = [
  { label: "Ordens de Produção", url: "/producao/ordens", icon: ClipboardList },
  { label: "RM", url: "/producao/rm", icon: Package, perm: "producao.rm.access" },
];

// Recebimento (admin-only) — material recebido aguardando a Qualidade.
// Sem permissão nova no RBAC: o gate é a RLS de rec_laudos (_is_admin).
const recebimentoSubItems = [{ label: "Fila de Inspeção", url: "/recebimento/fila", icon: PackageSearch }];

const intercompanySubItems = [
  { label: "Master", url: "/intercompany/master", icon: ClipboardList },
  { label: "Novo Reembolso", url: "/intercompany/reembolsos/novo", icon: FileText },
  { label: "Novo Reembolso NF", url: "/intercompany/reembolsos-nf/novo", icon: FileText },
];

// Despesas (admin-only) — realizado + de-para contábil
const despesasSubItems = [
  { label: "Realizado de Despesas", url: "/despesas/realizado", icon: Coins },
  { label: "De-Para Contábil", url: "/despesas/config-contas", icon: Landmark },
];

const ferramentasSubItems = [
  { label: "Bulk Edit Produtos — Campos", url: "/ferramentas/bulk-edit/produtos-campos", icon: Wrench },
  { label: "Histórico", url: "/ferramentas/bulk-edit/historico", icon: History },
  { label: "Cron Requisições", url: "/ferramentas/cron-req", icon: RefreshCw },
  { label: "Cron Despesas", url: "/ferramentas/cron-despesas", icon: Coins },
  { label: "Cron Despesas DocFin", url: "/ferramentas/cron-docfin", icon: Coins },
  { label: "Cron NF-e", url: "/ferramentas/cron-nfe", icon: FileText },
  { label: "Cron Intercompany", url: "/ferramentas/cron-intercompany", icon: Building2 },
  // OP-2.6 — "RM (Produção)" e não "Requisições": a entrada acima já é o cron
  // das Requisições de COMPRA (Suprimentos). São jobs diferentes.
  { label: "Cron RM (Produção)", url: "/ferramentas/cron-reqmat", icon: Package },
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
  { titleKey: "settings.sync_jobs", url: "/configuracoes/sincronizacoes", icon: RefreshCw, adminOnly: true },
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
  const isProducaoActive = location.pathname.startsWith("/producao");
  const isRecebimentoActive = location.pathname.startsWith("/recebimento");
  const isIntercompanyActive = location.pathname.startsWith("/intercompany");
  const isDespesasActive = location.pathname.startsWith("/despesas");
  const isFerramentasActive = location.pathname.startsWith("/ferramentas");

  // ── ORDEM DA SIDEBAR (REC-1.8) ────────────────────────────────────────────
  // A lista `entradas` abaixo É a ordem renderizada, de cima para baixo.
  //
  // Antes, os grupos colapsáveis eram injetados como efeito colateral de
  // "âncoras" (`nav.commodatum`, `nav.nf_entrada`, `nav.loans`, `nav.closing`)
  // dentro de um `navItems.map`, com a lógica DUPLICADA para o caso de o
  // usuário não enxergar a âncora. Isso amarrava a ordem dos grupos à posição
  // do item que os hospedava — Estoques só existia colado em Bens em Comodato,
  // por exemplo — e tornava a cadeia física (Compras → NF → Recebimento →
  // Estoque → Produção) impossível de montar sem quebrar o resto.
  //
  // Nada aqui muda permissão, rota, ícone, rótulo ou agrupamento: cada entrada
  // carrega o MESMO gate que tinha antes. Os itens soltos seguem lendo
  // `navItems` e `routePermMap`, que continuam intactos.
  //
  // O "guard ampliado" da OP-1.3 (que fazia os grupos aparecerem para quem não
  // tem `nf_entrada`) deixa de existir como código porque a âncora que o
  // exigia sumiu — o comportamento que ele garantia continua, agora por
  // construção: cada grupo é gateado só pela própria permissão.

  /** Item solto do `navItems`, com o mesmo gate de sempre (`routePermMap`). */
  const itemSolto = (url: string) => {
    const item = navItems.find((i) => i.url === url);
    if (!item) return null;
    const permKey = routePermMap[item.url];
    if (permKey && !hasAccess(permKey)) return null;
    return (
      <SidebarMenuItem>
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
  };

  /** Email NF-e — item fixo (sem i18n), gateado por `nf_entrada` como antes. */
  const itemEmailNfe = () => {
    if (!hasAccess(routePermMap["/email-nfe"])) return null;
    return (
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
    );
  };

  const entradas: ReactNode[] = [];
  const add = (key: string, mostrar: boolean, node: () => ReactNode) => {
    if (!mostrar) return;
    const n = node();
    if (n) entradas.push(<Fragment key={key}>{n}</Fragment>);
  };

  // 1) visão geral
  add("dashboard", true, () => itemSolto("/"));

  // 2) cadeia física: comprar → receber → estocar → produzir
  add("compras", hasAccess("compras"), () => renderComprasGroup(t, isComprasActive));
  add("suprimentos", hasAccess("suprimentos_requisicoes"), () =>
    renderSuprimentosGroup(t, isSuprimentosActive, hasAccess),
  );
  add("nf-entrada", true, () => itemSolto("/nf-entrada"));
  add("email-nfe", true, () => itemEmailNfe());
  add("recebimento", isAdmin, () => renderRecebimentoGroup(t, isRecebimentoActive));
  add("estoques", hasAccess("inventory"), () => renderInventoryGroup(t, isInventoryActive));
  add("producao", hasAccess("producao.access"), () => renderProducaoGroup(t, isProducaoActive, hasAccess));

  // 3) financeiro
  add("cash", true, () => itemSolto("/cash"));
  add("receivables", true, () => itemSolto("/receivables"));
  add("contas-a-pagar", hasAccess("contas_pagar"), () => renderContasPagarGroup(t, isContasPagarActive));
  add("sales", true, () => itemSolto("/sales"));
  add("despesas", isAdmin, () => renderDespesasGroup(t, isDespesasActive));
  add("credit-cards", true, () => itemSolto("/credit-cards"));
  add("cartao", true, () => itemSolto("/cartao"));
  add("loans", true, () => itemSolto("/loans"));
  add("taxes", true, () => itemSolto("/taxes"));

  // 4) patrimônio e contrapartes
  add("imobilizado", hasAccess("fixed_assets"), () => renderFixedAssetsGroup(t, isFixedAssetsActive));
  add("commodatum", true, () => itemSolto("/commodatum"));
  add("intercompany", hasAccess("intercompany"), () => renderIntercompanyGroup(t, isIntercompanyActive));
  add("entidades", hasAccess("entidades"), () => renderEntidadesGroup(t, isEntidadesActive));

  // 5) gestão e apoio
  add("projetos", true, () => itemSolto("/projetos"));
  add("closing", true, () => itemSolto("/closing"));
  // ⚠ O `&& hasAccess("closing")` é PRESERVAÇÃO DELIBERADA do comportamento
  // anterior, não um gate novo: na estrutura de âncoras, Ferramentas era
  // injetado dentro de `nav.closing` e quem não passava no gate de Fechamento
  // saía por `return null` antes de chegar nele — ou seja, Ferramentas já
  // dependia de `closing`. É o mesmo defeito que a OP-1.3 corrigiu para
  // `nf_entrada` (o "guard ampliado") e que nunca foi replicado aqui.
  // Hoje não afeta ninguém (o único usuário com a permissão é admin, que tem
  // bypass). Soltar essa amarra é mudança de visibilidade e fica para uma
  // tarefa própria — a REC-1.8 é só de ordem.
  add(
    "ferramentas",
    hasAccess("ferramentas_bulk_edit_produtos_campos") && hasAccess("closing"),
    () => renderFerramentasGroup(t, isFerramentasActive),
  );

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <BarChart3 className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-sm font-bold tracking-tight text-sidebar-foreground">P&F</span>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {entradas}
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
                if ("adminOnly" in item && item.adminOnly && !isAdmin) return null;
                if (item.titleKey !== "settings.users" && !hasAccess("settings")) return null;
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span>
                          {item.titleKey === "settings.sync_jobs" ? "Sincronizações" : t(item.titleKey as any)}
                        </span>
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

function renderSuprimentosGroup(t: any, isActive: boolean, hasAccess: (perm: string) => boolean) {
  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible-suprimentos">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              isActive ? "bg-sidebar-accent text-sidebar-primary font-medium" : ""
            }`}
          >
            <Boxes className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Suprimentos</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/collapsible-suprimentos:rotate-[-90deg]" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {suprimentosSubItems
              .filter((sub) => !sub.perm || hasAccess(sub.perm))
              .map((sub) => (
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

function renderProducaoGroup(t: any, isActive: boolean, hasAccess: (perm: string) => boolean) {
  const subItens = producaoSubItems.filter((sub) => !sub.perm || hasAccess(sub.perm));
  // Grupo sem nenhum sub-item visível não renderiza: um menu que abre vazio
  // parece defeito. Hoje isso não acontece (Ordens não tem `perm`, então quem
  // passa no gate do grupo sempre vê ao menos ela), mas a guarda evita que o
  // primeiro sub-item gateado que alguém acrescentar crie o estado.
  if (subItens.length === 0) return null;

  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible-producao">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              isActive ? "bg-sidebar-accent text-sidebar-primary font-medium" : ""
            }`}
          >
            <Factory className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Produção</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/collapsible-producao:rotate-[-90deg]" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {subItens.map((sub) => (
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

function renderRecebimentoGroup(_t: any, isActive: boolean) {
  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible-recebimento">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              isActive ? "bg-sidebar-accent text-sidebar-primary font-medium" : ""
            }`}
          >
            <PackageSearch className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Recebimento</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/collapsible-recebimento:rotate-[-90deg]" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {recebimentoSubItems.map((sub) => (
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

function renderIntercompanyGroup(t: any, isActive: boolean) {
  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible-intercompany">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              isActive ? "bg-sidebar-accent text-sidebar-primary font-medium" : ""
            }`}
          >
            <Handshake className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Intercompany</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/collapsible-intercompany:rotate-[-90deg]" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {intercompanySubItems.map((sub) => (
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

function renderDespesasGroup(_t: any, isActive: boolean) {
  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible-despesas">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              isActive ? "bg-sidebar-accent text-sidebar-primary font-medium" : ""
            }`}
          >
            <Coins className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Despesas</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/collapsible-despesas:rotate-[-90deg]" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {despesasSubItems.map((sub) => (
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

function renderFerramentasGroup(_t: any, isActive: boolean) {
  return (
    <Collapsible defaultOpen={isActive} className="group/collapsible-ferramentas">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
              isActive ? "bg-sidebar-accent text-sidebar-primary font-medium" : ""
            }`}
          >
            <Wrench className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Ferramentas</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]/collapsible-ferramentas:rotate-[-90deg]" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {ferramentasSubItems.map((sub) => (
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
