import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** NFE-15 — etapa 7 "Comentários" (Pedro, 11/11/2026). */
const LISTA = [
  { id: "2", texto: "Prestador avisou atraso no boleto.", criado_em: "2026-11-11T17:32:05Z", autor: "mirlene.oliveira", meu: false },
  { id: "1", texto: "Conferir o boleto com o fornecedor.", criado_em: "2026-11-11T15:39:17Z", autor: "Hugo", meu: true },
];
const adicionar = vi.fn(async () => undefined);
vi.mock("@/services/notaComentariosService", async (original) => ({
  ...(await original<typeof import("@/services/notaComentariosService")>()),
  listarComentarios: vi.fn(async () => LISTA),
  adicionarComentario: (...a: unknown[]) => adicionar(...(a as [])),
}));

import { EtapaComentarios } from "@/components/notas/EtapaComentarios";
import { formatarInstanteComSegundos, iniciais } from "@/services/notaComentariosService";

describe("comentários — formatos", () => {
  it("hora com segundos em Brasília e iniciais do avatar", () => {
    expect(formatarInstanteComSegundos("2026-11-11T17:32:05Z")).toBe("11/11/2026 14:32:05");
    expect(iniciais("mirlene.oliveira")).toBe("MO");
    expect(iniciais("Hugo")).toBe("H");
    expect(iniciais("pedro.scrignoli@pfbrazil.com")).toBe("PS");
  });
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  adicionar.mockClear();
});
const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
function digitar(el: HTMLTextAreaElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const botaoAdicionar = () =>
  Array.from(container!.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes("Adicionar")) as HTMLButtonElement;

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root!.render(
      <QueryClientProvider client={qc}>
        <EtapaComentarios tipo="nfe" chave="35261128036074000105550010000018541000000001" colRef={() => {}} />
      </QueryClientProvider>,
    ),
  );
  await esperar();
}

describe("comentários — a etapa", () => {
  it("mostra o registro do mais novo ao mais antigo, com quem escreveu e a hora com segundos", async () => {
    await montar();
    const itens = Array.from(container!.querySelectorAll("ol li"));
    expect(itens).toHaveLength(2);
    expect(itens[0].textContent).toContain("mirlene.oliveira");
    expect(itens[0].textContent).toContain("11/11/2026 14:32:05");
    expect(itens[1].textContent).toContain("Hugo(você)");
    expect(container!.textContent).toContain("2 comentários · último de mirlene.oliveira");
  });

  it("Adicionar só com texto; contador; envia sem os espaços das pontas (também por Ctrl+Enter)", async () => {
    await montar();
    const caixa = container!.querySelector("textarea") as HTMLTextAreaElement;
    expect(botaoAdicionar().disabled).toBe(true);
    digitar(caixa, "   ");
    expect(botaoAdicionar().disabled).toBe(true);
    digitar(caixa, "  Pedido confirmado com Compras.  ");
    expect(container!.textContent).toContain("34/280");
    expect(botaoAdicionar().disabled).toBe(false);
    await act(async () => {
      caixa.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    });
    await esperar();
    expect(adicionar).toHaveBeenCalledWith("nfe", "35261128036074000105550010000018541000000001", "Pedido confirmado com Compras.");
    expect((container!.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("não deixa passar de 280 caracteres", async () => {
    await montar();
    const caixa = container!.querySelector("textarea") as HTMLTextAreaElement;
    digitar(caixa, "x".repeat(300));
    expect(caixa.value).toHaveLength(280);
    expect(container!.textContent).toContain("280/280");
  });
});
