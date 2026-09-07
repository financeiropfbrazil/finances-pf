import { unidadesProduto, validarItemCadastro } from "../../supabase/functions/_shared/requisicao-unidades";
// Executa o handler real do patch com dependências injetadas, sem chamar ERP/produção.
import { createHash } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, it, expect, vi, afterEach } from "vitest";
import { montarReqAprovada } from "../../docs/aprovacao-multicc/gateway/req-aprovada-payload";

const source = readFileSync("docs/aprovacao-multicc/gateway/req-aprovada.ts", "utf8").replace(/^import .*;\r?\n/gm, "").replace("export default router;", "return router;");
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function setup({ rejeita = false, arquivos = false } = {}) {
  const snapshot = { token: "token", codigo_usuario: "OPERADOR", requisicao: { codigo_empresa_filial: "1.01", codigo_centro_ctrl: "A", codigo_funcionario: "F", codigo_finalidade_compra: "1", data_necessidade: "2026-09-10" },
    itens: [{ codigo_centro_ctrl: "B", codigo_produto: "P", codigo_prod_unid_med: "UN", quantidade_solicitada: 1, posicao_prod_unid_med: 1, quantidade: 1 }], rateio: [],
    arquivos: arquivos ? [{ upload_identify_guid: "guid", nome_original: "file.pdf", conteudo_sha256: createHash("sha256").update("arquivo").digest("hex"), storage_path: "00000000-0000-0000-0000-000000000001/guid.pdf" }] : [] };
  const rpc = vi.fn(async (name: string) => name === "iniciar_envio_requisicao" ? { data: snapshot, error: rejeita ? { message: "APROVACAO_INCOMPLETA" } : null } : { data: "SINCRONIZADA", error: null });
  const download = vi.fn(async () => ({ data: Object.assign(new Blob(["arquivo"]), { arrayBuffer: () => new NodeBlob(["arquivo"]).arrayBuffer() }), error: null }));
  const db = { rpc, storage: { from: () => ({ download }) } };
  const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
  const router = { post: (paths: string | string[], fn: (req: unknown, res: unknown) => Promise<void>) => (Array.isArray(paths) ? paths : [paths]).forEach((p) => handlers.set(p, fn)) };
  const callAlvo = vi.fn(async () => ({ ok: true, data: { Codigo: "P", ProdUnidMedChildList: [{ CodigoUnidMedida: "UN", Posicao: 1, Peso: 1, PesoFatorDivisor: "Fator" }] } }));
  new Function("Router", "getSupabaseAdmin", "getAlvoToken", "montarReqAprovada", "createHash", "callAlvo", "unidadesProduto", "validarItemCadastro", js)(() => router, () => db, async () => "erp-token", montarReqAprovada, createHash, callAlvo, unidadesProduto, validarItemCadastro);
  const req = { user: { id: "usuario-nao-admin", source: "financial_hub" }, body: { requisicao_id: "00000000-0000-0000-0000-000000000001", CodigoCentroCtrl: "FORJADO" } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  vi.stubEnv("SUPABASE_URL", "https://hbtggrbauguukewiknew.supabase.co");
  vi.stubEnv("ALVO_BASE_URL", "https://erp.invalid");
  vi.stubGlobal("AbortSignal", { timeout: () => undefined });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ Numero: "123" }) })));
  return { snapshot, callAlvo, rpc, download, handlers, req, res, run: () => handlers.get("/enviar-aprovada")!(req, res) };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("gateway protegido antes do Alvo", () => {
  it("Produto/Load real confere os dois itens UNID antes de um único Insert", async () => {
    const x = setup();
    x.snapshot.itens = [1, 2].map(n => ({ ...x.snapshot.itens[0], codigo_produto: "001.013.00382", codigo_prod_unid_med: "UNID", posicao_prod_unid_med: 2, quantidade_solicitada: n === 1 ? 10 : 20, quantidade: n }));
    x.callAlvo.mockResolvedValue({ ok: true, data: JSON.parse(readFileSync("docs/aprovacao-multicc/load-gpt6-1.txt", "utf8")) });
    await x.run();
    expect(x.callAlvo).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
    const p = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(p.ItemReqCompChildList.map((i: Record<string, unknown>) => [i.CodigoProdUnidMed,i.PosicaoProdUnidMed,i.Quantidade2,i.QuantidadeProdUnidMedPrincipal])).toEqual([["UNID",2,10,1],["UNID",2,20,2]]);
  });
  it("mudança no fator desde aprovação bloqueia Insert sem recalcular silenciosamente", async () => {
    const x = setup(); x.callAlvo.mockResolvedValue({ ok: true, data: { Codigo: "P", ProdUnidMedChildList: [{ CodigoUnidMedida: "UN", Posicao: 1, Peso: 1, PesoFatorDivisor: "Fator" }, { CodigoUnidMedida: "CX", Posicao: 2, Peso: 0.2, PesoFatorDivisor: "Fator" }] } });
    Object.assign(x.snapshot.itens[0], { codigo_prod_unid_med: "CX", posicao_prod_unid_med: 2, quantidade_solicitada: 10, quantidade: 1 });
    await x.run(); expect(fetch).not.toHaveBeenCalled();
    expect(x.res.json).toHaveBeenCalledWith({ error: expect.stringContaining("diverge") });
  });
  it("conteúdo substituído não chega ao ERP", async () => {
    const x = setup({ arquivos: true });
    x.download.mockResolvedValue({ data: Object.assign(new Blob(["substituído"]), { arrayBuffer: () => new NodeBlob(["substituído"]).arrayBuffer() }), error: null }); await x.run();
    expect(fetch).not.toHaveBeenCalled();
    expect(x.res.json).toHaveBeenCalledWith({ error: expect.stringContaining("Integridade") });
  });
  it("anexo sem hash não chega ao ERP", async () => {
    const x = setup({ arquivos: true }); x.snapshot.arquivos[0].conteudo_sha256 = ""; await x.run();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("unidade alternativa não inferida bloqueia envio antes do HTTP", async () => {
    const x = setup(); x.snapshot.itens[0].posicao_prod_unid_med = 2; await x.run();
    expect(fetch).not.toHaveBeenCalled();
    expect(x.res.json).toHaveBeenCalledWith({ error: expect.stringContaining("Unidade/posição") });
  });
  it("as duas rotas antigas recusam antes de qualquer chamada", async () => {
    const x = setup();
    for (const p of ["/insert", "/insert-multipart"]) await x.handlers.get(p)!(x.req, x.res);
    expect(x.res.status).toHaveBeenCalledWith(409); expect(fetch).not.toHaveBeenCalled(); expect(x.rpc).not.toHaveBeenCalled();
  });
  it("aprovação incompleta não chama ERP nem baixa anexo", async () => {
    const x = setup({ rejeita: true, arquivos: true }); await x.run();
    expect(fetch).not.toHaveBeenCalled(); expect(x.download).not.toHaveBeenCalled();
  });
  it("JWT de outro projeto não autoriza criação", async () => {
    const x = setup(); x.req.user.source = "hub_ia"; await x.run(); expect(x.rpc).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([false, true])("monta payload canônico e confirma no backend (anexos=%s)", async (arquivos) => {
    const x = setup({ arquivos }); await x.run();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    const payload = JSON.parse(typeof init?.body === "string" ? init.body : String((init?.body as FormData).get("obj")));
    expect(payload.CodigoCentroCtrl).toBe("A"); expect(payload.ItemReqCompChildList[0].CodigoCentroCtrl).toBe("B");
    expect(String(url)).toContain(arquivos ? "SaveMultiPart" : "SavePartial");
    expect(x.rpc).toHaveBeenCalledWith("concluir_envio_requisicao", expect.objectContaining({ p_numero: "123", p_token: "token" }));
  });
  it("timeout não repete HTTP e não libera reserva", async () => {
    const x = setup(); vi.mocked(fetch).mockRejectedValue(new Error("timeout")); await x.run();
    expect(fetch).toHaveBeenCalledTimes(1); expect(x.rpc).toHaveBeenCalledWith("concluir_envio_requisicao", expect.objectContaining({ p_falha_definitiva: false, p_numero: null }));
  });
  it("falha antes do HTTP libera nova tentativa sem nova aprovação", async () => {
    const x = setup({ arquivos: true }); x.download.mockRejectedValue(new Error("storage indisponível")); await x.run();
    expect(fetch).not.toHaveBeenCalled(); expect(x.rpc).toHaveBeenCalledWith("concluir_envio_requisicao", expect.objectContaining({ p_falha_definitiva: true }));
  });
});
