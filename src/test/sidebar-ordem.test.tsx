/**
 * Regressão da SIDEBAR — ordem e gates.
 *
 * Por que existe: a sidebar é compartilhada por todos os módulos do Hub
 * (100+ usuários em Suprimentos, além de Despesas, Intercompany, NF-e). A
 * ordem é montada por uma lista declarativa em `AppSidebar.tsx`, e um
 * descuido ali some com um menu inteiro para um perfil específico — sem
 * quebrar build nem type-check. Este teste renderiza o componente de
 * verdade (jsdom) e trava duas coisas:
 *
 *   1. a ORDEM das entradas de topo (selada na REC-1.8);
 *   2. o GATE de cada entrada — o que cada permissão, isolada, faz aparecer.
 *
 * Ao mexer na sidebar, se este teste falhar, confirme que a mudança era
 * intencional ANTES de atualizar a lista esperada.
 *
 * Nota: `t()` é mockado para devolver a própria chave, por isso os itens com
 * i18n aparecem como "nav.xxx" e os grupos colapsáveis (que usam label fixo
 * em português — dívida registrada em BL-3) aparecem com o texto literal.
 */
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const permissoes = { hasAccess: (_k: string) => true, isAdmin: true };

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (k: string) => k }),
  LanguageProvider: ({ children }: any) => children,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { is_admin: permissoes.isAdmin } }),
}));
vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAccess: (k: string) => permissoes.hasAccess(k),
    isAdmin: permissoes.isAdmin,
    loading: false,
    permissions: {},
  }),
}));

import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";

/**
 * Rótulos de TOPO na ordem do DOM. Os grupos vêm embrulhados em <div>, então
 * varremos por querySelectorAll (ordem de documento) e descartamos o que
 * estiver dentro de um submenu.
 */
function ordemDeTopo(): string[] {
  const principal = document.querySelectorAll('ul[data-sidebar="menu"]')[0];
  if (!principal) return [];
  return Array.from(principal.querySelectorAll('li[data-sidebar="menu-item"]'))
    .filter((li) => !li.closest('ul[data-sidebar="menu-sub"]'))
    .map((li) => {
      const clone = li.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('ul[data-sidebar="menu-sub"]').forEach((s) => s.remove());
      return (clone.textContent || "").replace(/\s+/g, " ").trim();
    });
}

function montar(cfg: { hasAccess?: (k: string) => boolean; isAdmin?: boolean } = {}) {
  permissoes.hasAccess = cfg.hasAccess ?? (() => true);
  permissoes.isAdmin = cfg.isAdmin ?? true;
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      <MemoryRouter>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </MemoryRouter>,
    );
  });
  return ordemDeTopo();
}

/** Ordem selada na REC-1.8 (validada no app publicado em 28/07/2026). */
const ORDEM_ESPERADA = [
  "nav.dashboard",
  // cadeia física: comprar → receber → estocar → produzir
  "Compras",
  "Suprimentos",
  "nav.nf_entrada",
  "Email NF-e",
  "Recebimento",
  "nav.inventory",
  "Produção",
  // financeiro
  "nav.cash",
  "nav.receivables",
  "Contas a Pagar",
  "nav.sales",
  "Despesas",
  "nav.credit_cards",
  "nav.cartao_lancamento",
  "nav.loans",
  "nav.taxes",
  // patrimônio e contrapartes
  "nav.fixed_assets",
  "nav.commodatum",
  "Intercompany",
  "nav.entidades",
  // gestão e apoio
  "nav.projetos",
  "nav.closing",
  "Ferramentas",
];

describe("AppSidebar — ordem", () => {
  it("mantém a ordem selada na REC-1.8 quando tudo está liberado", () => {
    expect(montar()).toEqual(ORDEM_ESPERADA);
  });

  it("tem 24 entradas de topo", () => {
    expect(montar()).toHaveLength(24);
  });
});

describe("AppSidebar — gates", () => {
  it("não-admin com apenas producao.access vê só Produção", () => {
    expect(montar({ hasAccess: (k) => k === "producao.access", isAdmin: false })).toEqual(["Produção"]);
  });

  it("não-admin com apenas suprimentos_requisicoes vê só Suprimentos", () => {
    expect(montar({ hasAccess: (k) => k === "suprimentos_requisicoes", isAdmin: false })).toEqual(["Suprimentos"]);
  });

  it("admin sem nenhuma permissão RBAC vê os grupos admin-only", () => {
    expect(montar({ hasAccess: () => false, isAdmin: true })).toEqual(["Recebimento", "Despesas"]);
  });

  it("sem permissão nenhuma não vê nada", () => {
    expect(montar({ hasAccess: () => false, isAdmin: false })).toEqual([]);
  });

  it("cada permissão isolada libera exatamente a sua entrada", () => {
    const casos: Array<[string, string[]]> = [
      ["dashboard", ["nav.dashboard"]],
      ["cash", ["nav.cash"]],
      ["receivables", ["nav.receivables"]],
      ["sales", ["nav.sales"]],
      ["commodatum", ["nav.commodatum"]],
      ["nf_entrada", ["nav.nf_entrada", "Email NF-e"]],
      ["entidades", ["nav.entidades"]],
      ["loans", ["nav.loans"]],
      ["taxes", ["nav.taxes"]],
      ["credit_cards", ["nav.credit_cards"]],
      ["cartao.access", ["nav.cartao_lancamento"]],
      ["contas_pagar", ["Contas a Pagar"]],
      ["projetos", ["nav.projetos"]],
      ["closing", ["nav.closing"]],
      ["intercompany", ["Intercompany"]],
      ["inventory", ["nav.inventory"]],
      ["fixed_assets", ["nav.fixed_assets"]],
      ["compras", ["Compras"]],
      // BL-2: Ferramentas segue amarrado a `closing` (dívida preservada de
      // propósito na REC-1.8) — sozinha, a permissão dele não mostra nada.
      ["ferramentas_bulk_edit_produtos_campos", []],
    ];
    for (const [perm, esperado] of casos) {
      expect(montar({ hasAccess: (k) => k === perm, isAdmin: false }), `permissão "${perm}"`).toEqual(esperado);
    }
  });
});
