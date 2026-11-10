import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * NFE-12 — a lista de NF-e inteira responde ao filtro do cabeçalho (Pedro, 10/11: "não vejo o filtro funcionar").
 * Os serviços são trocados por notas de exemplo; o resto da tela é o de verdade.
 */
const item = (cfop: string) => ({ numero_item: 1, codigo_produto: "X", descricao: "Item", ncm: "", cfop, unidade: "UN", quantidade: 1, valor_unitario: 1, valor_total: 1 });
const nota = (id: string, numero: string, fornecedor: string, cnpj: string, cfop: string, valor: number) => ({
  id, numero, serie: "1", chave_acesso: `chave-${id}`, emitente_nome: fornecedor, emitente_cnpj: cnpj, emitente_ie: null, emitente_uf: "SP",
  valor_produtos: valor, valor_icms: 0, valor_ipi: 0, valor_frete: 0, valor_desconto: 0, valor_total: valor, base_calculo_icms: 0,
  data_emissao: "2026-11-09", natureza_operacao: "VENDA", situacao: "normal", origem: "alvo", recebido: false,
  dados_extraidos: { itens: [item(cfop)] }, status_lancamento: "pendente", pedido_compra_numero: null, pedido_compra_entidade: null,
  pedido_compra_classe: null, pedido_compra_centro_custo: null, pedido_compra_cond_pagamento: null, pedido_compra_valor: null,
  imported_at: "2026-11-10T15:01:00Z",
});
const NOTAS = [
  nota("a", "892720", "AGROMETAL COMERCIAL DE FERRAGENS", "11111111000111", "5102", 110.2),
  nota("b", "1854", "BIOCOLLAGEN LTDA", "28036074000105", "5101", 38700),
  nota("c", "1853", "BIOCOLLAGEN LTDA", "28036074000105", "5102", 14400),
];

vi.mock("@/services/nfeRecebidasService", async (original) => ({
  ...(await original<typeof import("@/services/nfeRecebidasService")>()),
  listarNotasDoPeriodo: vi.fn(async () => NOTAS),
  buscarEspelhoAlvoDesde: vi.fn(async () => "2026-01-01"),
  buscarUltimaLevaRiosoft: vi.fn(async () => "2026-11-10T15:01:00Z"),
}));
vi.mock("@/services/comprasNfeNoAlvoService", () => ({
  listarNfeNoAlvo: vi.fn(async () => new Map([["c", { nfe_id: "c", chave_movestq: 1, data_entrada: "2026-11-09", fonte: "Alvo" }]])),
}));

import ComprasNotasFiscais from "@/pages/ComprasNotasFiscais";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const clicar = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** Números das notas que aparecem na tabela. */
const numerosNaTabela = () =>
  Array.from(container!.querySelectorAll("tbody tr"))
    .map((tr) => tr.querySelectorAll("td")[1]?.textContent?.trim())
    .filter((t): t is string => !!t && /^\d+$/.test(t));

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root!.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/compras/notas-fiscais?de=2026-11-01&ate=2026-11-30"]}>
          <ComprasNotasFiscais />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await esperar();
}

describe("lista de NF-e — filtro no cabeçalho (NFE-12)", () => {
  it("digitar na busca do funil de Fornecedor já filtra a tabela", async () => {
    await montar();
    expect(numerosNaTabela()).toEqual(expect.arrayContaining(["892720", "1854", "1853"]));
    clicar(document.querySelector('button[aria-label="Filtrar Fornecedor"]')!);
    digitar(document.querySelector('input[placeholder="Buscar..."]') as HTMLInputElement, "agrome");
    expect(numerosNaTabela()).toEqual(["892720"]);
    expect(container!.textContent).toContain("Limpar filtros das colunas (1)");
  });

  it("desmarcar um CFOP tira as notas dele; o No Alvo filtra pelos estados", async () => {
    await montar();
    clicar(document.querySelector('button[aria-label="Filtrar CFOP"]')!);
    const linha5102 = Array.from(document.querySelectorAll("label")).find((l) => (l.textContent ?? "").startsWith("5102"))!;
    clicar(linha5102.querySelector('[role="checkbox"]')!);
    expect(numerosNaTabela()).toEqual(["1854"]);
  });

  it("No Alvo: marcar só \"Lançada\" deixa só a nota achada no Alvo", async () => {
    await montar();
    clicar(document.querySelector('button[aria-label="Filtrar No Alvo"]')!);
    digitar(document.querySelector('input[placeholder="Buscar..."]') as HTMLInputElement, "lançada");
    expect(numerosNaTabela()).toEqual(["1853"]);
  });
});
