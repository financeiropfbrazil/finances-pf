import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { diasNoPeriodo, escolherDia, lerDataDigitada, mascaraData, periodoFinal, type RascunhoPeriodo } from "@/lib/periodo";
import { PeriodoPicker } from "@/components/PeriodoPicker";

/** NFE-13 — seletor de período com data inicial e final (Pedro, 11/11/2026). */
describe("seletor de período — regras", () => {
  it("lê a data digitada em vários formatos e recusa data que não existe", () => {
    expect(lerDataDigitada("11/11/2026")).toBe("2026-11-11");
    expect(lerDataDigitada("1/2/26")).toBe("2026-02-01");
    expect(lerDataDigitada("11112026")).toBe("2026-11-11");
    expect(lerDataDigitada("2026-11-11")).toBe("2026-11-11");
    expect(lerDataDigitada("31/02/2026")).toBeNull();
    expect(lerDataDigitada("11/11/20")).toBe("2020-11-11");
    expect(lerDataDigitada("11/11")).toBeNull();
  });

  it("máscara põe as barras enquanto digita", () => {
    expect(mascaraData("1")).toBe("1");
    expect(mascaraData("1111")).toBe("11/11");
    expect(mascaraData("11112026")).toBe("11/11/2026");
    expect(mascaraData("11/11/2026999")).toBe("11/11/2026");
  });

  it("clique no calendário preenche o campo ativo e passa da inicial para a final", () => {
    let r: RascunhoPeriodo = { de: null, ate: null, ativo: "de" };
    r = escolherDia(r, "2026-11-05");
    expect(r).toEqual({ de: "2026-11-05", ate: null, ativo: "ate" });
    r = escolherDia(r, "2026-11-20");
    expect(r).toEqual({ de: "2026-11-05", ate: "2026-11-20", ativo: "de" });
    // ajustar só a final: clicar no campo "Data final" e no dia
    expect(escolherDia({ ...r, ativo: "ate" }, "2026-11-25")).toEqual({ de: "2026-11-05", ate: "2026-11-25", ativo: "de" });
    // final antes da inicial vira a nova inicial
    expect(escolherDia({ ...r, ativo: "ate" }, "2026-11-01")).toEqual({ de: "2026-11-01", ate: null, ativo: "ate" });
    // nova inicial depois da final limpa a final
    expect(escolherDia({ ...r, ativo: "de" }, "2026-11-28")).toEqual({ de: "2026-11-28", ate: null, ativo: "ate" });
  });

  it("ao aplicar: troca datas invertidas, um dia só vale como período; conta os dias", () => {
    expect(periodoFinal({ de: "2026-11-30", ate: "2026-11-01" })).toEqual({ de: "2026-11-01", ate: "2026-11-30" });
    expect(periodoFinal({ de: "2026-11-05", ate: null })).toEqual({ de: "2026-11-05", ate: "2026-11-05" });
    expect(periodoFinal({ de: null, ate: null })).toBeNull();
    expect(diasNoPeriodo("2026-11-01", "2026-11-30")).toBe(30);
    expect(diasNoPeriodo("2026-02-01", "2026-03-31")).toBe(59);
    expect(diasNoPeriodo("2026-11-05", null)).toBe(1);
  });
});

// ── a tela (react-dom + act, como os demais testes de tela) ──
let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});
const clicar = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const botao = (texto: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === texto) as HTMLButtonElement;

function abrir(valor = { de: "2026-11-01", ate: "2026-11-30" }) {
  const onChange = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<PeriodoPicker valor={valor} onChange={onChange} permitirTudo={false} />));
  clicar(container.querySelector("button")!);
  return onChange;
}

describe("seletor de período — a tela", () => {
  it("abre com as datas aplicadas nos campos e mostra os dias", () => {
    abrir();
    expect((document.querySelector('input[aria-label="Data inicial"]') as HTMLInputElement).value).toBe("01/11/2026");
    expect((document.querySelector('input[aria-label="Data final"]') as HTMLInputElement).value).toBe("30/11/2026");
    expect(document.body.textContent).toContain("30 dias");
  });

  it("digitar a inicial e a final e aplicar devolve o período (invertido, troca)", () => {
    const onChange = abrir();
    digitar(document.querySelector('input[aria-label="Data inicial"]') as HTMLInputElement, "20102026");
    digitar(document.querySelector('input[aria-label="Data final"]') as HTMLInputElement, "05/10/2026");
    clicar(botao("Aplicar"));
    expect(onChange).toHaveBeenCalledWith({ de: "2026-10-05", ate: "2026-10-20" });
  });

  it("atalho aplica direto", () => {
    const onChange = abrir();
    clicar(botao("Mês anterior"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].de).toMatch(/^\d{4}-\d{2}-01$/);
  });
});
