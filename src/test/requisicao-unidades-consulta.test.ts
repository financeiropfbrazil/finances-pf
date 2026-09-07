import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { carregarUnidadesProduto } from "@/services/requisicoesService";
import { converterSolicitada } from "../../supabase/functions/_shared/requisicao-unidades";
import { posicaoInicialUnidade } from "@/components/compras/UnidadeRequisicaoSelect";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "teste-local" } } }) } } }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("formulário aceita o tempo real de autenticação mais Load, superior a 45s", async () => {
  vi.useFakeTimers();
  const real = JSON.parse(readFileSync("docs/aprovacao-multicc/produto-load/20260907-191432.txt", "utf8"));
  vi.stubGlobal("fetch", vi.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 59_100));
    return { ok: true, json: async () => real };
  }));
  const request = carregarUnidadesProduto("001.001.00051");
  await vi.advanceTimersByTimeAsync(59_100);
  expect(posicaoInicialUnidade(await request)).toBe(1);
});
it("requisição pendente termina em 135s e cancela o transporte, sem alegar incompatibilidade", async () => {
  vi.useFakeTimers();
  let signal: AbortSignal;
  vi.stubGlobal("fetch", vi.fn((_url, options) => { signal = options.signal; return new Promise(() => {}); }));
  const request = carregarUnidadesProduto("001.001.00051");
  const result = expect(request).rejects.toThrow("excedeu 135 segundos");
  await vi.advanceTimersByTimeAsync(135_000);
  await result;
  expect(signal.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/produto/load?codigo=001.001.00051"), expect.objectContaining({ method: "GET" }));
});
it("preserva resposta HTTP de falha para nova tentativa explícita", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: "Produto não encontrado no ERP." }) })));
  await expect(carregarUnidadesProduto("001.001.00051")).rejects.toThrow("Produto não encontrado");
  expect(fetch).toHaveBeenCalledOnce();
});
it("lista vazia explícita não inventa unidade nem classifica como conversão incompatível", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ Codigo: "TESTE-LOCAL", ProdUnidMedChildList: [] }) })));
  expect(await carregarUnidadesProduto("TESTE-LOCAL")).toEqual([]);
});
it("resposta de outro produto não é usada", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ Codigo: "OUTRO", ProdUnidMedChildList: [] }) })));
  await expect(carregarUnidadesProduto("TESTE-LOCAL")).rejects.toThrow("não corresponde");
});
it("resposta sem lista de unidades explica ausência de dados, sem alegar incompatibilidade", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ Codigo: "TESTE-LOCAL" }) })));
  await expect(carregarUnidadesProduto("TESTE-LOCAL")).rejects.toThrow("não trouxe a lista de unidades");
});
it("Load real do produto do aceite seleciona UNID/2 e preserva 10→1,20→2", async () => {
  const real = JSON.parse(readFileSync("docs/aprovacao-multicc/load-gpt6-1.txt", "utf8"));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => real })));
  const units = await carregarUnidadesProduto("001.013.00382");
  expect(posicaoInicialUnidade(units)).toBe(2);
  const u = units.find(u => u.posicao === 2)!;
  expect([u.codigo, u.posicao, converterSolicitada(10, u), converterSolicitada(20, u)]).toEqual(["UNID", 2, 1, 2]);
});
it("captura real do Laboratório de 001.001.00051 preenche UNID/1 sem exigir marca de compras", async () => {
  const real = JSON.parse(readFileSync("docs/aprovacao-multicc/produto-load/20260907-191432.txt", "utf8"));
  // HTTP simulado para isolar tratamento da resposta; o status original não foi registrado.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => real })));
  const units = await carregarUnidadesProduto("001.001.00051");
  expect(units).toEqual([{ codigo: "UNID", posicao: 1, peso: 1, tipo: "Fator", compras: false }]);
  expect(posicaoInicialUnidade(units)).toBe(1);
  expect([converterSolicitada(10, units[0]), converterSolicitada(20, units[0])]).toEqual([10, 20]);
});
