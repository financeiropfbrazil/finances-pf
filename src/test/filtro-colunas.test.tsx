import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  aplicarFiltros,
  descreverFiltros,
  lerNumeroDigitado,
  opcoesDaColuna,
  passaFiltro,
  VAZIO,
  type DefColuna,
  type FiltroColuna,
} from "@/lib/filtroColunas";
import { FiltroCabecalho } from "@/components/FiltroCabecalho";

/** NFE-12 — filtro no cabeçalho, no estilo do Excel. */
interface Nota {
  numero: string;
  fornecedor: string | null;
  cfops: string[];
  valor: number | null;
}
const notas: Nota[] = [
  { numero: "1854", fornecedor: "BIOCOLLAGEN", cfops: ["5101"], valor: 38700 },
  { numero: "13902", fornecedor: "FAST PARTS", cfops: ["5102", "5949"], valor: 5504 },
  { numero: "13900", fornecedor: "FAST PARTS", cfops: ["5102"], valor: 53822.34 },
  { numero: "61", fornecedor: null, cfops: [], valor: null },
];
const defs: DefColuna<Nota>[] = [
  { id: "numero", rotulo: "Número", tipo: "texto", texto: (n) => n.numero },
  { id: "fornecedor", rotulo: "Fornecedor", tipo: "valores", valores: (n) => (n.fornecedor ? [n.fornecedor] : []) },
  { id: "cfop", rotulo: "CFOP", tipo: "valores", valores: (n) => n.cfops },
  { id: "valor", rotulo: "V. Total", tipo: "intervalo", numero: (n) => n.valor },
];
const def = (id: string) => defs.find((d) => d.id === id)!;

describe("filtro no cabeçalho — regras (NFE-12)", () => {
  it("lista de valores: passa se algum valor da linha estiver marcado (CFOPs da nota)", () => {
    const f: FiltroColuna = { tipo: "valores", aceitos: ["5949"] };
    expect(notas.filter((n) => passaFiltro(n, def("cfop"), f)).map((n) => n.numero)).toEqual(["13902"]);
    // nota sem CFOP só passa quando "(vazio)" está marcado
    expect(passaFiltro(notas[3], def("cfop"), { tipo: "valores", aceitos: [VAZIO] })).toBe(true);
    // nada marcado = nada passa (como no Excel)
    expect(notas.filter((n) => passaFiltro(n, def("cfop"), { tipo: "valores", aceitos: [] }))).toHaveLength(0);
  });

  it("texto contém (sem diferenciar maiúscula) e intervalo de valor (nota sem valor não passa)", () => {
    expect(notas.filter((n) => passaFiltro(n, def("numero"), { tipo: "texto", texto: " 139 " })).map((n) => n.numero)).toEqual([
      "13902",
      "13900",
    ]);
    const f: FiltroColuna = { tipo: "intervalo", min: 5000, max: 40000 };
    expect(notas.filter((n) => passaFiltro(n, def("valor"), f)).map((n) => n.numero)).toEqual(["1854", "13902"]);
  });

  it("opções em cascata: a lista de uma coluna sai das linhas que passam nos OUTROS filtros", () => {
    const filtros = { fornecedor: { tipo: "valores", aceitos: ["FAST PARTS"] } as FiltroColuna };
    const cfop = opcoesDaColuna(aplicarFiltros(notas, defs, filtros, "cfop"), def("cfop"));
    expect(cfop).toEqual([
      { valor: "5102", rotulo: "5102", n: 2 },
      { valor: "5949", rotulo: "5949", n: 1 },
    ]);
    // a própria coluna mostra todos os fornecedores (o filtro dela não conta), "(vazio)" por último
    const forn = opcoesDaColuna(aplicarFiltros(notas, defs, filtros, "fornecedor"), def("fornecedor"));
    expect(forn.map((o) => o.rotulo)).toEqual(["BIOCOLLAGEN", "FAST PARTS", "(vazio)"]);
    expect(aplicarFiltros(notas, defs, filtros)).toHaveLength(2);
  });

  it("descreve os filtros para a aba Sobre do Excel", () => {
    expect(
      descreverFiltros(defs, {
        cfop: { tipo: "valores", aceitos: ["5101", "5102"] },
        numero: { tipo: "texto", texto: "139" },
        valor: { tipo: "intervalo", min: 1000, max: null },
      }),
    ).toEqual(['Número contém "139"', "CFOP: 5101, 5102", "V. Total ≥ 1.000"]);
  });

  it("número digitado em pt-BR ou com ponto decimal", () => {
    expect(lerNumeroDigitado("1.234,56")).toBe(1234.56);
    expect(lerNumeroDigitado("1234.56")).toBe(1234.56);
    expect(lerNumeroDigitado("R$ 500")).toBe(500);
    expect(lerNumeroDigitado("")).toBeNull();
    expect(lerNumeroDigitado("abc")).toBeNull();
  });
});

// ── a caixa (react-dom + act, como os demais testes de tela) ──────────────────
let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});
const clicar = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const linhaDoValor = (rotulo: string) =>
  Array.from(document.querySelectorAll("label")).find((l) => (l.textContent ?? "").startsWith(rotulo))!;

describe("filtro no cabeçalho — a caixa (NFE-12)", () => {
  const opcoes = [
    { valor: "5101", rotulo: "5101", n: 1 },
    { valor: "5102", rotulo: "5102", n: 2 },
    { valor: "5949", rotulo: "5949", n: 1 },
  ];
  function abrir(filtro: FiltroColuna | undefined) {
    const onChange = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<FiltroCabecalho rotulo="CFOP" tipo="valores" filtro={filtro} onChange={onChange} opcoes={opcoes} />));
    clicar(document.querySelector('button[aria-label="Filtrar CFOP"]')!);
    return onChange;
  }

  it("desmarcar um valor filtra pelos outros; marcar tudo de novo tira o filtro", () => {
    const onChange = abrir(undefined);
    clicar(linhaDoValor("5102").querySelector('[role="checkbox"]')!);
    expect(onChange).toHaveBeenLastCalledWith({ tipo: "valores", aceitos: ["5101", "5949"] });
  });

  it("com filtro ativo, \"Selecionar tudo\" tira o filtro", () => {
    const onChange = abrir({ tipo: "valores", aceitos: ["5101"] });
    clicar(linhaDoValor("Selecionar tudo").querySelector('[role="checkbox"]')!);
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("digitar na busca já filtra pelo que ela acha; apagar a busca volta ao que era (Pedro, 10/11)", () => {
    const onChange = abrir(undefined);
    const busca = document.querySelector('input[placeholder="Buscar..."]') as HTMLInputElement;
    digitar(busca, "510");
    expect(onChange).toHaveBeenLastCalledWith({ tipo: "valores", aceitos: ["5101", "5102"] });
    digitar(busca, "");
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
