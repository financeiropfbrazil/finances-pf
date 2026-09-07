import { readFileSync } from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { carregarRequisicaoParaClonar, criarRequisicao, persistirItensRequisicao } from "@/services/requisicoesService";

const mock = vi.hoisted(() => ({ req: {} as Record<string, unknown>, itens: [] as Record<string, unknown>[], writes: [] as { table: string; value: Record<string, unknown> }[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { access_token: "sintetico" } } }) },
  rpc: async () => ({ data: null, error: null }),
  from: (table: string) => {
    let head = false;
    const result = () => ({ data: table === "compras_requisicoes_itens" ? mock.itens : [], error: null, count: table === "compras_requisicoes_itens" ? mock.itens.length : 0 });
    const q = {
      select: (_s: string, options?: { head?: boolean }) => { head = !!options?.head; return q; },
      eq: () => q, in: () => q, order: () => q,
      maybeSingle: async () => ({ data: mock.req, error: null }),
      single: async () => ({ data: { id: "novo" }, error: null }),
      upsert: (value: Record<string, unknown>) => { mock.writes.push({ table, value }); return q; },
      insert: (value: Record<string, unknown>) => { mock.writes.push({ table, value }); return q; },
      update: (value: Record<string, unknown>) => { mock.writes.push({ table, value }); return q; },
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(head ? { ...result(), data: null } : result()).then(resolve),
    };
    return q;
  },
} }));
const produto = JSON.parse(readFileSync("docs/aprovacao-multicc/load-gpt6-1.txt", "utf8"));
const codigo = "001.013.00382";
const load = { ItemReqCompChildList: [1, 2].map(n => ({ Sequencia: n, CodigoProduto: codigo, CodigoProdUnidMed: "UNID", PosicaoProdUnidMed: 2, Quantidade2: n === 1 ? 10 : 20, QuantidadeProdUnidMedPrincipal: n, CodigoCentroCtrl: "A", DataNecessidade: "2026-09-10" })) };
beforeEach(() => {
  mock.writes = [];
  mock.req = { id: "origem", numero_alvo: "0001480", codigo_empresa_filial: "1.01", codigo_centro_ctrl: "A" };
  mock.itens = [1, 2].map(n => ({ id: `item-${n}`, sequencia: n, codigo_produto: codigo, codigo_prod_unid_med: "UNID", quantidade: n, quantidade_solicitada: null, posicao_prod_unid_med: null }));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("/produto/load") ? produto : load })));
});
afterEach(() => vi.unstubAllGlobals());

it("criação persiste a tupla real e o fator por produto antes da submissão", async () => {
  await criarRequisicao({ user_id: "autor", requisitante_nome: "Autor", codigo_funcionario: "FUNC", funcionario_nome: "Autor", codigo_centro_ctrl: "A", codigo_finalidade_compra: "F", finalidade_compra_label: "F", descricao: "teste", data_necessidade: "2026-09-10", observacao_livre: "", itens: [1, 2].map(n => ({ item_servico: false, codigo_produto: codigo, codigo_alternativo_produto: null, codigo_prod_unid_med: "UNID", posicao_prod_unid_med: 2, quantidade_solicitada: n === 1 ? 10 : 20, quantidade: n, produto_nome: "Produto", produto_unidade: "UNID", observacao: "", rateio: [] })) });
  const rows = mock.writes.filter(w => w.table === "compras_requisicoes_itens").map(w => w.value);
  expect(rows.map(i => [i.quantidade_solicitada,i.quantidade,i.codigo_prod_unid_med,i.posicao_prod_unid_med])).toEqual([[10,1,"UNID",2],[20,2,"UNID",2]]);
  expect(rows[0].conversao_unidade).toMatchObject({ peso: 0.1, tipo: "Fator", posicao: 2, codigo: "UNID" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("clonagem recupera Load para histórico incompleto e não escreve a origem", async () => {
  const clone = await carregarRequisicaoParaClonar("origem");
  expect(clone.itens.map(i => [i.quantidade_solicitada,i.quantidade,i.codigo_prod_unid_med,i.posicao_prod_unid_med])).toEqual([[10,1,"UNID",2],[20,2,"UNID",2]]);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/req-comp/1.01/0001480"), expect.anything());
  expect(mock.writes).toHaveLength(0);
});
it("rascunho histórico incompleto sem número não é reconstruído", async () => {
  mock.req.numero_alvo = null;
  await expect(carregarRequisicaoParaClonar("origem")).rejects.toThrow("HISTORICO_UNIDADE_INCOMPLETO");
  expect(fetch).not.toHaveBeenCalled();
});
it("Load recuperado ainda incompleto não inventa Quantidade2", async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ ItemReqCompChildList: load.ItemReqCompChildList.map(i => ({ ...i, Quantidade2: undefined })) }) } as Response);
  await expect(carregarRequisicaoParaClonar("origem")).rejects.toThrow("HISTORICO_UNIDADE_INCOMPLETO");
});
it("sincronização atualiza os quatro campos em itens já espelhados", async () => {
  await persistirItensRequisicao("origem",load);
  const rows = mock.writes.filter(w => w.table === "compras_requisicoes_itens").map(w => w.value);
  expect(rows.map(i => [i.quantidade_solicitada,i.quantidade,i.codigo_prod_unid_med,i.posicao_prod_unid_med])).toEqual([[10,1,"UNID",2],[20,2,"UNID",2]]);
});
