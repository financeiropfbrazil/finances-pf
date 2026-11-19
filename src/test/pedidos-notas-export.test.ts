import { describe, expect, it, vi } from "vitest";

/** NFE-17 — aprovação do pedido e pedidos sugeridos nos Excel de notas. */
const rpc = vi.fn(async (nome: string, args: Record<string, string[]>) => {
  if (nome === "pedidos_aprovacao") {
    return { data: args.p_numeros.map((numero) => ({ numero, status_aprovacao: "Finalizada", aprovado: "Total", aprovado_total: true })), error: null };
  }
  const chaves = args.p_ids ?? args.p_chaves;
  const campo = args.p_ids ? "id" : "chave_acesso";
  return { data: chaves.filter((c) => c.endsWith("1")).map((c) => ({ [campo]: c, candidatos: [{ numero: "0000001" }] })), error: null };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...(a as [string, never])) } }));

import {
  buscarAprovacaoPedidos,
  buscarSugeridosNfe,
  buscarSugeridosNfse,
  pedidosDaLinha,
  rotuloAprovacao,
  separarPedidos,
  textoSugeridos,
  type AprovacaoPedido,
} from "@/services/pedidosNotasExport";

const ap = (numero: string, status_aprovacao: string | null, aprovado: string | null): AprovacaoPedido => ({
  numero,
  status: "Aberto",
  status_aprovacao,
  aprovado,
  aprovado_total: status_aprovacao === "Finalizada" && aprovado === "Total",
  data_aprovacao_alvo: null,
});
const mapa = new Map([
  ["0004317", ap("0004317", "Reavaliar", "Não")],
  ["0004669", ap("0004669", "Finalizada", "Total")],
  ["0004670", ap("0004670", "Finalizada", "Total")],
]);

describe("aprovação do pedido", () => {
  it("separa a coluna Pedido dos relatórios", () => {
    expect(separarPedidos("0003810, 0003811")).toEqual(["0003810", "0003811"]);
    expect(separarPedidos(null)).toEqual([]);
  });

  it("rótulo: Aprovado só com aprovação finalizada e total; pedido que o Hub não tem = Fora do Hub", () => {
    expect(rotuloAprovacao(ap("1", "Finalizada", "Total"))).toBe("Aprovado");
    expect(rotuloAprovacao(ap("1", "Em Andamento", "Não"))).toBe("Em Andamento");
    expect(rotuloAprovacao(ap("1", "Finalizada", "Parcial"))).toBe("Finalizada");
    expect(rotuloAprovacao(ap("1", null, null))).toBe("Sem aprovação");
    expect(rotuloAprovacao(undefined)).toBe("Fora do Hub");
  });

  it("um pedido não aprovado → vermelho; todos aprovados → \"Aprovado\"; mistura → cada um com a sua situação", () => {
    expect(pedidosDaLinha("0004317", mapa, undefined)).toMatchObject({ pedido_aprovacao: "Reavaliar", pedido_aprovado: false });
    expect(pedidosDaLinha("0004669, 0004670", mapa, undefined)).toMatchObject({ pedido_aprovacao: "Aprovado", pedido_aprovado: true });
    expect(pedidosDaLinha("0004317, 0004669", mapa, undefined)).toMatchObject({
      pedido_aprovacao: "0004317: Reavaliar · 0004669: Aprovado",
      pedido_aprovado: false,
    });
    expect(pedidosDaLinha("0000362", mapa, undefined)).toMatchObject({ pedido_aprovacao: "Fora do Hub", pedido_aprovado: false });
    expect(pedidosDaLinha(null, mapa, undefined)).toMatchObject({ pedido_aprovacao: null, pedido_aprovado: null });
  });
});

describe("pedidos sugeridos", () => {
  const sug = [
    { numero: "0005253", status_aprovacao: "Em Andamento", aprovado: "Não", diferenca_pct: 0, forca: 2 },
    { numero: "0005256", status_aprovacao: "Em Andamento", aprovado: "Não", diferenca_pct: 1.4, forca: 2 },
  ];
  it("texto na ordem da etapa 2, com a diferença do saldo e o \"citado na nota\"", () => {
    expect(textoSugeridos(sug)).toBe("0005253 (exato) · 0005256 (+1,4%)");
    expect(textoSugeridos([{ numero: "0005201", status_aprovacao: "Reavaliar", aprovado: "Não", diferenca_pct: -15.9, forca: 1 }])).toBe(
      "0005201 (citado na nota, −15,9%)",
    );
    expect(textoSugeridos([])).toBeNull();
  });

  it("aprovação dos sugeridos: não aprovados também aparecem, em vermelho", () => {
    expect(pedidosDaLinha(null, mapa, sug)).toMatchObject({
      pedidos_sugeridos: "0005253 (exato) · 0005256 (+1,4%)",
      sugeridos_aprovacao: "0005253: Em Andamento · 0005256: Em Andamento",
      sugeridos_aprovados: false,
    });
    expect(
      pedidosDaLinha(null, mapa, [{ numero: "0004669", status_aprovacao: "Finalizada", aprovado: "Total", diferenca_pct: 0, forca: 2 }]),
    ).toMatchObject({ sugeridos_aprovacao: "Aprovado", sugeridos_aprovados: true });
  });

  it("busca em lotes de 1.000, sem repetir, e só as notas com sugestão entram no mapa", async () => {
    rpc.mockClear();
    const ids = Array.from({ length: 2300 }, (_, i) => `n${i}`);
    const nfe = await buscarSugeridosNfe([...ids, "n1", ""]);
    expect(rpc.mock.calls.map((c) => [c[0], (c[1] as { p_ids: string[] }).p_ids.length])).toEqual([
      ["nfe_pedidos_sugeridos", 1000],
      ["nfe_pedidos_sugeridos", 1000],
      ["nfe_pedidos_sugeridos", 300],
    ]);
    expect(nfe.get("n1")).toEqual([{ numero: "0000001" }]);
    expect(nfe.has("n2")).toBe(false);
    const nfse = await buscarSugeridosNfse(["chave1", "chave2"]);
    expect([...nfse.keys()]).toEqual(["chave1"]);
    const aprov = await buscarAprovacaoPedidos(["0004669", "0004669"]);
    expect(aprov.get("0004669")?.aprovado_total).toBe(true);
    expect((rpc.mock.calls.at(-1)![1] as { p_numeros: string[] }).p_numeros).toEqual(["0004669"]);
  });
});
