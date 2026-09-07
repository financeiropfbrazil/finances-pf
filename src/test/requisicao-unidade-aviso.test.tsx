import { afterAll, afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { UnidadeRequisicaoSelect as SeletorAntes } from "../../docs/aprovacao-multicc/tests/seletor-antes-aceite";
import { readFileSync } from "node:fs";
import { UnidadeRequisicaoSelect, restricaoUnidadeRequisicao, posicaoInicialUnidade } from "@/components/compras/UnidadeRequisicaoSelect";
import { unidadesProduto } from "../../supabase/functions/_shared/requisicao-unidades";

const load = JSON.parse(readFileSync("docs/aprovacao-multicc/produto-load/respostas/001.017.092.json", "utf8"));
const unidades = unidadesProduto(load.data, "001.017.092");
beforeAll(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); Element.prototype.scrollIntoView = vi.fn(); });
afterAll(() => vi.unstubAllGlobals());
let root: Root;
let container: HTMLDivElement;
function mount(posicao: number, change: (n: number) => void) {
  if (!root) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  act(() => root.render(<UnidadeRequisicaoSelect unidades={unidades} posicao={posicao} onChange={change} carregando={false} />));
}
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; vi.useRealTimers(); });
describe("restrição antecipada de unidade", () => {
  it("explica espera prolongada e limpa o aviso ao concluir a consulta", () => {
    vi.useFakeTimers();
    mount(1, () => {});
    act(() => root.render(<UnidadeRequisicaoSelect unidades={[]} posicao={null} onChange={() => {}} carregando />));
    expect(container.textContent).toContain("Consultando unidades no Alvo");
    act(() => vi.advanceTimersByTime(15_000));
    expect(container.textContent).toContain("pode levar até 2 minutos");
    act(() => root.render(<UnidadeRequisicaoSelect unidades={unidades} posicao={1} onChange={() => {}} carregando={false} />));
    expect(container.textContent).not.toContain("Ainda aguardando");
    expect(container.querySelector('button[aria-label="Unidade solicitada"]')).not.toHaveAttribute("disabled");
  });
  it("reproduz no componente anterior uma consulta pendente com seletor bloqueado sem explicação", () => {
    const antes = renderToStaticMarkup(<SeletorAntes unidades={[]} posicao={null} onChange={() => {}} carregando />);
    expect(antes).toContain('disabled=""');
    expect(antes).not.toContain('role="status"');
    expect(antes).not.toContain('role="alert"');
    expect(antes).not.toContain('Tentar novamente');
  });
  it("mostra Divisor na unidade de compras antes de qualquer clique e mantém M3/3", () => {
    const change = vi.fn();
    mount(3, change);
    expect(container.querySelector('[role="combobox"]').textContent).toMatch(/M3.*posição 3/);
    expect(container.querySelector('[role="alert"]').textContent).toContain("M3 (posição 3) usa conversão do tipo Divisor");
    expect(container.querySelector('[role="alert"]').textContent).toContain("Não é possível adicionar");
    expect(container.querySelector('[role="combobox"]').textContent).toMatch(/posição 3.*compras.*indisponível/);
    expect(change).not.toHaveBeenCalled();
  });
  it("marca ambas as posições M3 como indisponíveis e permite escolha explícita de UNID", () => {
    const change = vi.fn();
    mount(2, change);
    expect(container.querySelector('[role="alert"]').textContent).toContain("M3 (posição 2)");
    expect(restricaoUnidadeRequisicao(unidades.find(u => u.posicao === 2))).not.toBeNull();
    act(() => container.querySelector('[role="combobox"]').dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const option = Array.from(document.querySelectorAll('[role="option"]')).find(x => x.textContent.includes("UNID"));
    act(() => option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(change).toHaveBeenCalledWith(1);
    mount(1, change);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="combobox"]').textContent).toMatch(/UNID.*posição 1/);
    expect(restricaoUnidadeRequisicao(unidades.find(u => u.posicao === 1))).toBeNull();
  });
  it("prioriza compras mesmo bloqueada e não infere escolha entre alternativas", () => {
    expect(posicaoInicialUnidade(unidades)).toBe(3);
    expect(posicaoInicialUnidade(unidades.map(u => ({ ...u, compras: false })))).toBe(1);
    expect(posicaoInicialUnidade([{ ...unidades[0], compras: true }, { ...unidades[0], posicao: 2, compras: true }])).toBeNull();
  });
  it("mostra carregamento, erro recuperável e ausência de unidades", () => {
    mount(3, vi.fn());
    const retry = vi.fn();
    act(() => root.render(<UnidadeRequisicaoSelect unidades={[]} posicao={null} onChange={vi.fn()} carregando onRetry={retry} />));
    expect(container.querySelector('[role="status"]').textContent).toContain("Consultando unidades");
    expect(container.querySelector('[role="combobox"]').hasAttribute("disabled")).toBe(true);
    act(() => root.render(<UnidadeRequisicaoSelect unidades={[]} posicao={null} onChange={vi.fn()} carregando={false} erro={new Error("HTTP 503")} onRetry={retry} />));
    expect(container.querySelector('[role="alert"]').textContent).toContain("HTTP 503");
    act(() => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Tentar novamente').click());
    expect(retry).toHaveBeenCalledOnce();
    act(() => root.render(<UnidadeRequisicaoSelect unidades={[]} posicao={null} onChange={vi.fn()} carregando={false} onRetry={retry} />));
    expect(container.querySelector('[role="status"]').textContent).toContain("nenhuma unidade cadastrada");
    expect(container.textContent).not.toContain("CONVERSAO_NAO_COMPROVADA");
  });
});
