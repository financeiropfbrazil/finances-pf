// Node real; execução com vitest.gateway.config.ts (sem setup de DOM do frontend).
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";

function compile(source: string, dependencies = {}) {
  const exports = {} as any;
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("exports", "require", js)(exports, name => {
    if (!(name in dependencies)) throw Error(`Dependência inesperada: ${name}`);
    return dependencies[name];
  });
  return exports;
}
let load: any;
const cadastro = JSON.parse(readFileSync("docs/aprovacao-multicc/produto-load/20260907-191432.txt", "utf8"));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
beforeEach(() => {
  vi.useFakeTimers();
  for (const name of ["ALVO_BASE_URL", "ALVO_USER", "ALVO_PASSWORD", "ALVO_EMPRESA_FILIAL_ID"]) vi.stubEnv(name, name === "ALVO_BASE_URL" ? "https://erp-simulado.invalid" : "teste-local");
  const auth = compile(readFileSync("../erp-proxy/src/alvo-auth.ts", "utf8"));
  load = compile(readFileSync("../erp-proxy/src/routes/produto-leitura.ts", "utf8"), { "../alvo-auth": auth }).carregarProdutoLeitura;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function erpLento() {
  return vi.fn(async (url: string) => {
    if (url.endsWith("RsLogin/Login")) { await wait(24_000); return new Response(JSON.stringify("token-simulado")); }
    if (url.endsWith("RsLogin/SelectCompany")) { await wait(24_600); return new Response("{}", { headers: { "riosoft-token": "token-simulado" } }); }
    expect(url).toContain("/Produto/Load?codigo=001.001.00051&loadChild=All");
    await wait(10_500);
    return new Response(JSON.stringify(cadastro));
  });
}
it("autenticação real do gateway em 48,6s + Load em 10,5s termina sem timeout prematuro", async () => {
  const fetch = erpLento(); vi.stubGlobal("fetch", fetch);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 120_000);
  const etapas: string[] = []; let terminou = false;
  const result = load("001.001.00051", controller.signal, etapa => etapas.push(etapa)).then(r => { terminou = true; return r; });
  await vi.advanceTimersByTimeAsync(45_000); expect(terminou).toBe(false); expect(controller.signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(14_100);
  expect((await result).data.ProdUnidMedChildList).toEqual(cadastro.ProdUnidMedChildList);
  expect(etapas).toEqual(["autenticacao", "consulta", "resposta"]);
  expect(fetch.mock.calls.map(([url]) => url.split("/").pop())).toHaveLength(3);
  clearTimeout(timer);
});
it("cancelar um leitor durante login não cancela o outro nem dispara Load tardio do cancelado", async () => {
  const fetch = erpLento(); vi.stubGlobal("fetch", fetch);
  const first = new AbortController(), second = new AbortController();
  const cancelado = expect(load("001.001.00051", first.signal, () => {})).rejects.toThrow();
  const outro = load("001.001.00051", second.signal, () => {});
  first.abort(); await cancelado;
  await vi.advanceTimersByTimeAsync(59_100);
  expect((await outro).ok).toBe(true);
  expect(fetch.mock.calls.filter(([url]) => url.includes("RsLogin/Login"))).toHaveLength(1);
  expect(fetch.mock.calls.filter(([url]) => url.includes("Produto/Load"))).toHaveLength(1);
});
it("prazo cancelado durante leitura aborta HTTP sem repetir GET", async () => {
  const fetch = vi.fn(async (url: string, options: any) => {
    if (url.endsWith("RsLogin/Login")) return new Response(JSON.stringify("token-simulado"));
    if (url.endsWith("RsLogin/SelectCompany")) return new Response("{}", { headers: { "riosoft-token": "token-simulado" } });
    return new Promise<Response>((_, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason)));
  });
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController(); setTimeout(() => controller.abort(), 120_000);
  const result = expect(load("001.001.00051", controller.signal, () => {})).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(120_000); await result;
  expect(fetch.mock.calls.filter(([url]) => url.includes("Produto/Load"))).toHaveLength(1);
});
