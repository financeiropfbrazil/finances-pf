import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { enviarRequisicaoAlvo, aprovarRequisicao, criarRequisicao, type NovaRequisicaoInput } from "@/services/requisicoesService";
import { montarReqAprovada, type SnapshotEnvio } from "../../docs/aprovacao-multicc/gateway/req-aprovada-payload";

// Resolução de login (pessoal/fallback/inválido) agora é testada nas RPCs reais:
// docs/aprovacao-multicc/tests/run.mjs. Aqui se verifica a fronteira de confiança.
const mock = vi.hoisted(() => ({ rpc: vi.fn(), getSession: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { ...mock, auth: { getSession: mock.getSession } } }));
const options = { userId: "identidade-forjada", userName: "forjado", persistencia: "rpc" as const };
beforeEach(() => {
  vi.clearAllMocks();
  mock.getSession.mockResolvedValue({ data: { session: { access_token: "jwt-real-da-sessao" } } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ Numero: "123" }) }));
});
afterEach(() => vi.unstubAllGlobals());

describe("conclusão da criação", () => {
  const input: NovaRequisicaoInput = {
    user_id: "autor", requisitante_nome: "Autor", codigo_funcionario: "FUNC", funcionario_nome: "Autor",
    codigo_centro_ctrl: "A", codigo_finalidade_compra: "F", finalidade_compra_label: "Finalidade",
    descricao: "teste", data_necessidade: "2026-09-10", observacao_livre: "",
    itens: [{ item_servico: false, codigo_produto: "P", codigo_alternativo_produto: null,
      codigo_prod_unid_med: "UN", produto_nome: "Produto", produto_unidade: "UN", quantidade: 1, quantidade_solicitada: 1, posicao_prod_unid_med: 1,
      observacao: "", rateio: [{ codigo_classe_rec_desp: "CL", classe_rec_desp_label: "Classe", percentual: 100 }] }],
  };
  it.each([false, true])("falha de classe=%s só permite finalizar gravação completa", async (falha) => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ Codigo: "P", ProdUnidMedChildList: [{ CodigoUnidMedida: "UN", Posicao: 1, Peso: 1, PesoFatorDivisor: "Fator" }] }) } as Response);
    mock.rpc.mockResolvedValue({ error: null });
    mock.from.mockImplementation((table: string) => ({
      upsert: () => table === "compras_requisicoes_itens_classe_rec_desp"
        ? Promise.resolve({ error: falha ? { message: "falha de classe" } : null })
        : { select: () => ({ single: async () => ({ data: { id: "req-1" }, error: null }) }) },
      insert: async () => ({ error: null }),
    }));
    if (falha) await expect(criarRequisicao(input)).rejects.toMatchObject({ message: expect.stringContaining("falha de classe") });
    else await expect(criarRequisicao(input)).resolves.toBe("req-1");
    expect(mock.rpc.mock.calls.some(([name]) => name === "finalizar_rascunho_requisicao")).toBe(!falha);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes("/produto/load"))).toBe(true);
  });
});

describe("envio autorizado pelo gateway", () => {
  it("envia somente ID e JWT; identidade/payload do navegador não são confiados", async () => {
    expect((await enviarRequisicaoAlvo("req-1", options)).sucesso).toBe(true);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://erp-proxy.onrender.com/req-comp/enviar-aprovada");
    expect(JSON.parse(String(init?.body))).toEqual({ requisicao_id: "req-1" });
    expect(init?.headers).toMatchObject({ Authorization: "Bearer jwt-real-da-sessao" });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("recusa do backend preserva ID para recuperar no detalhe", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "APROVACAO_INCOMPLETA" }) } as Response);
    expect(await enviarRequisicaoAlvo("req-1", options)).toMatchObject({ sucesso: false, requisicao_id: "req-1", erro: "APROVACAO_INCOMPLETA" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("sessão expirada não chama gateway", async () => {
    mock.getSession.mockResolvedValue({ data: { session: null } });
    expect((await enviarRequisicaoAlvo("req-1", options)).sucesso).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("resposta sem número nunca vira sucesso nem retry", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    expect((await enviarRequisicaoAlvo("req-1", options)).sucesso).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([["PARCIAL", true, false], ["FINAL", true, true], ["OK", false, undefined]])("aprovação %s controla envio final", async (retorno, ok, final) => {
    mock.rpc.mockResolvedValue({ data: retorno, error: null });
    expect(await aprovarRequisicao("req-1")).toMatchObject({ ok, ...(final === undefined ? {} : { final }) });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("payload construído com snapshot do banco", () => {
  const snapshot: SnapshotEnvio = {
    token: "token", codigo_usuario: "ANA.SANCHES",
    requisicao: { codigo_empresa_filial: "1.01", codigo_centro_ctrl: "A", codigo_funcionario: "FUNC-AUTOR", codigo_finalidade_compra: "FINALIDADE", data_necessidade: "2026-09-10", descricao: "teste", texto: "[Hub] Requisitante: autor" },
    itens: [{ codigo_centro_ctrl: "B", codigo_produto: "P", codigo_alternativo_produto: null, codigo_prod_unid_med: "UN", quantidade_solicitada: 2, posicao_prod_unid_med: 1, quantidade: 2, item_servico: false, observacao: "item" }],
    rateio: [{ codigo_classe_rec_desp: "CL", percentual: 100, ccs: [{ codigo_centro_ctrl: "A", percentual: 1 }, { codigo_centro_ctrl: "C", percentual: 99 }] }], arquivos: [],
  };
  it("preserva identidade do operador e do requisitante separadamente", () => {
    expect(montarReqAprovada(snapshot)).toMatchObject({ CodigoUsuario: "ANA.SANCHES", UsuarioLogado: "ANA.SANCHES", CodigoFuncionario: "FUNC-AUTOR", Texto: "[Hub] Requisitante: autor" });
  });
  it("preserva CC divergente de item e todo rateio, inclusive 1%", () => {
    const p = montarReqAprovada(snapshot);
    expect(p.CodigoCentroCtrl).toBe("A");
    expect(p.ItemReqCompChildList[0].CodigoCentroCtrl).toBe("B");
    expect(p.ReqCompClasseRecDespChildList[0].RateioReqCompChildList).toEqual([
      { CodigoClasseRecDesp: "CL", CodigoCentroCtrl: "A", Percentual: 1 },
      { CodigoClasseRecDesp: "CL", CodigoCentroCtrl: "C", Percentual: 99 },
    ]);
  });
  it("unidade-base explícita usa posição 1 e quantidades iguais", () => {
    expect(montarReqAprovada(snapshot).ItemReqCompChildList[0]).toMatchObject({ PosicaoProdUnidMed: 1, Quantidade2: 2, QuantidadeProdUnidMedPrincipal: 2 });
  });
  it.each([1, 2])("0001480 principal=%s preserva Quantidade2 e posição capturadas", (quantidade) => {
    const i = { ...snapshot.itens[0], codigo_produto: "001.013.00382", codigo_prod_unid_med: "UNID", posicao_prod_unid_med: 2, quantidade_solicitada: quantidade === 1 ? 10 : 20, quantidade };
    expect(montarReqAprovada({ ...snapshot, itens: [i] }).ItemReqCompChildList[0]).toMatchObject({ CodigoProdUnidMed: "UNID", PosicaoProdUnidMed: 2, Quantidade2: quantidade === 1 ? 10 : 20, QuantidadeProdUnidMedPrincipal: quantidade });
  });
  it("cadastro ausente não supõe equivalência", () => {
    expect(() => montarReqAprovada({ ...snapshot, itens: [{ ...snapshot.itens[0], quantidade_solicitada: undefined }] })).toThrow("HISTORICO_UNIDADE_INCOMPLETO");
  });
  it("anexos usam os GUIDs persistidos no snapshot", () => {
    const p = montarReqAprovada({ ...snapshot, arquivos: [{ upload_identify_guid: "guid", storage_path: "req/guid.pdf", nome_original: "arquivo.pdf" }] });
    expect(p.ReqCompDocChildList?.[0].UploadIdentify).toBe("guid");
    expect(p.filesToUpload?.[0].key).toBe("guid#Arquivo");
  });
});
