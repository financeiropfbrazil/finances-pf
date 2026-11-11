import { describe, expect, it, vi } from "vitest";

/** NFE-16 — comentários em lote para o Excel de etapas. */
const rpc = vi.fn(async (_nome: string, args: { p_tipo: string; p_chaves: string[] }) => ({
  data: args.p_chaves
    .filter((c) => c.endsWith("7"))
    .map((c) => ({ chave_acesso: c, comentarios: [{ texto: "ok", criado_em: "2026-11-11T17:32:05Z", autor: "Hugo" }] })),
  error: null,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...(a as [string, never])) } }));

import { buscarComentariosLote } from "@/services/notaComentariosService";

describe("buscarComentariosLote", () => {
  it("sem chaves repetidas nem vazias, 1.000 por chamada; só as notas com comentário entram no mapa", async () => {
    const chaves = Array.from({ length: 2500 }, (_, i) => `chave${i}`);
    const mapa = await buscarComentariosLote("nfse", [...chaves, "chave7", ""]);
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls.map((c) => c[1].p_chaves.length)).toEqual([1000, 1000, 500]);
    expect(rpc.mock.calls.every((c) => c[0] === "nota_comentarios_lote" && c[1].p_tipo === "nfse")).toBe(true);
    expect(mapa.size).toBe(250);
    expect(mapa.get("chave7")).toEqual([{ texto: "ok", criado_em: "2026-11-11T17:32:05Z", autor: "Hugo" }]);
    expect(mapa.has("chave8")).toBe(false);
  });

  it("sem notas, não chama o banco", async () => {
    rpc.mockClear();
    expect((await buscarComentariosLote("nfe", [])).size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("erro do banco vira erro (o download avisa)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Sem permissão para Notas Fiscais" } } as never);
    await expect(buscarComentariosLote("nfe", ["x"])).rejects.toThrow("Sem permissão para Notas Fiscais");
  });
});
