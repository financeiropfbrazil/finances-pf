import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SuprimentosRequisicaoDetalhe from "@/pages/SuprimentosRequisicaoDetalhe";

const state = vi.hoisted(() => ({
  detalhe: undefined as undefined | (() => Promise<unknown>),
  req: { id: "req", codigo_centro_ctrl: "A", codigo_funcionario: "F-AUTOR", requisitante_user_id: "autor", status: "pendente_aprovacao" },
  grupos: [{ codigo_centro_ctrl: "A", lider_atual: false }, { codigo_centro_ctrl: "B", lider_atual: true }],
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ id: "req" }), useNavigate: () => vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "lider-b" }, profile: { is_admin: false, funcionario_alvo_codigo: "F-B" } }) }));
vi.mock("@/hooks/useHasPermission", () => ({ useHasPermission: (code: string) => code.endsWith("aprovar") }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), fetchQuery: async () => ({ escopo: "cc", ccs: ["B"], indisponivel: false }) }),
  useQuery: (opts: { queryKey: string[]; queryFn: () => Promise<unknown> }) => {
    if (opts.queryKey[0] === "requisicao_detalhe") state.detalhe = opts.queryFn;
    return { data: undefined, isLoading: opts.queryKey[0] === "requisicao_detalhe", refetch: vi.fn() };
  },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: state.req, error: null }) };
  return q;
} } }));
vi.mock("@/services/requisicoesService", async (original) => ({
  ...await original<object>(), carregarAprovacaoCC: async () => state.grupos,
}));
beforeEach(() => { state.req.status = "pendente_aprovacao"; state.detalhe = undefined; });
describe("acesso ao detalhe com identidade não-admin", () => {
  it("líder apenas do CC B do item abre requisição com cabeçalho A", async () => {
    renderToStaticMarkup(<SuprimentosRequisicaoDetalhe />);
    expect(await state.detalhe!()).toEqual(state.req);
  });
  it("o mesmo líder continua sem acesso ao rascunho alheio", async () => {
    state.req.status = "rascunho";
    renderToStaticMarkup(<SuprimentosRequisicaoDetalhe />);
    expect(await state.detalhe!()).toBeNull();
  });
});
