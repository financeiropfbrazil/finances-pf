import { afterAll, afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { UnidadeRequisicaoSelect, restricaoUnidadeRequisicao } from "@/components/compras/UnidadeRequisicaoSelect";
import { unidadesProduto } from "../../supabase/functions/_shared/requisicao-unidades";

const load = JSON.parse(readFileSync("docs/aprovacao-multicc/produto-load/respostas/001.017.092.json", "utf8"));
const unidades = unidadesProduto(load.data, "001.017.092");
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
let root: Root;
let container: HTMLDivElement;
function mount(posicao: number, change: (n: number) => void) {
  if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  act(() => root.render(<UnidadeRequisicaoSelect unidades={unidades} posicao={posicao} onChange={change} carregando={false} />));
}
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; });
describe("restrição antecipada de unidade", () => {
  it("mostra Divisor na unidade de compras antes de qualquer clique e mantém M3/3", () => {
    const change = vi.fn();
    mount(3, change);
    expect(container.querySelector("select").value).toBe("3");
    expect(container.querySelector('[role="alert"]').textContent).toContain("M3 (posição 3) usa conversão do tipo Divisor");
    expect(container.querySelector('[role="alert"]').textContent).toContain("Não é possível adicionar");
    expect(container.querySelector('option[value="3"]').textContent).toMatch(/posição 3.*compras.*indisponível/);
    expect(change).not.toHaveBeenCalled();
  });
  it("marca ambas as posições M3 como indisponíveis e permite escolha explícita de UNID", () => {
    const change = vi.fn();
    mount(2, change);
    expect(container.querySelector('[role="alert"]').textContent).toContain("M3 (posição 2)");
    expect(restricaoUnidadeRequisicao(unidades.find(u => u.posicao === 2))).not.toBeNull();
    act(() => { const select = container.querySelector("select"); select.value = "1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(change).toHaveBeenCalledWith(1);
    mount(1, change);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("select").value).toBe("1");
    expect(restricaoUnidadeRequisicao(unidades.find(u => u.posicao === 1))).toBeNull();
  });
});
