import { afterEach, beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ColarRateioCCDialog } from "@/components/compras/ColarRateioCCDialog";

/**
 * Card RATEIO-MASSA — o diálogo de colar lista, com a lista real do Pedro.
 * Sem @testing-library/react (não é dependência do projeto): react-dom + act, como
 * os demais testes de tela do repositório.
 */

const LISTA_DO_PEDRO = `Almoxarifado/Expedição  R$ 2.250,00
Clínico  R$ 1.800,00
Compras  R$ 900,00
Controladoria/Financeiro  R$ 1.800,00
Controle da Qualidade  R$ 4.500,00
Corelab  R$ 2.057,14
Design e Desenvolvimento  R$ 7.650,00
Diretoria de P&D  R$ 450,00
Engenharia de Manufatura  R$ 1.800,00
Garantia da Qualidade  R$ 1.800,00
Gerenciamento de Riscos  R$ 900,00
Laboratório  R$ 900,00
Marketing e Comunicação  R$ 900,00
Produção  R$ 17.100,00
Prototipagem  R$ 3.600,00
Recursos Humanos  R$ 1.521,43
Regulatórios  R$ 1.350,00
TI – Tecnologia da Informação  R$ 900,00
Engenharia da Qualidade  R$ 171,43`;

const CADASTRO = [
  { erp_code: "00010.00002.00007.00002", name: "ALMOXARIFADO/EXPEDICAO" },
  { erp_code: "00010.00004.00003", name: "ASSUNTOS CLINICOS" },
  { erp_code: "00010.00004.00001", name: "ASSUNTOS REGULATORIOS" },
  { erp_code: "00010.00002.00007.00001", name: "COMPRAS" },
  { erp_code: "00010.00002.00003", name: "CONTROLADORIA/FINANCEIRO" },
  { erp_code: "00010.00003.00002", name: "CONTROLE DA QUALIDADE" },
  { erp_code: "00007.00001.00003", name: "CORELAB" },
  { erp_code: "00008.00001.00003", name: "DESIGN E DESENVOLVIMENTO" },
  { erp_code: "00010.00001.00001", name: "DIRETORIA DE P&D" },
  { erp_code: "00007.00003.00001", name: "EDUCACAO CLINICA" },
  { erp_code: "00010.00003.00004", name: "ENGENHARIA DA QUALIDADE" },
  { erp_code: "00010.00002.00005", name: "ENGENHARIA DE MANUFATURA" },
  { erp_code: "00007.00001.00004", name: "ESPECIALISTAS CLINICOS" },
  { erp_code: "00010.00004.00002", name: "ESTUDO TRICUS - REGULATORIO" },
  { erp_code: "00010.00003.00001", name: "GARANTIA DA QUALIDADE" },
  { erp_code: "00010.00003.00003", name: "GERENCIAMENTO DE RISCOS" },
  { erp_code: "00008.00001.00006", name: "LAB PESQUISA" },
  { erp_code: "00008.00001.00002", name: "LABORATORIO" },
  { erp_code: "00007.00001.00002", name: "MARKETING E COMUNICACAO" },
  { erp_code: "00009.00001.00001", name: "PRODUCAO" },
  { erp_code: "00008.00001.00001", name: "PROTOTIPAGEM" },
  { erp_code: "00010.00002.00002", name: "RECURSOS HUMANOS" },
  { erp_code: "00010.00002.00008", name: "TI - TECNOLOGIA DA INFORMACAO" },
];

// ── helpers mínimos (react-dom + act) ───────────────────────────────────────
let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

function botao(nome: string | RegExp): HTMLButtonElement {
  const achado = Array.from(document.querySelectorAll("button")).find((b) => {
    const texto = (b.textContent ?? "").trim();
    return typeof nome === "string" ? texto === nome : nome.test(texto);
  });
  if (!achado) throw new Error(`botão não encontrado: ${nome}`);
  return achado as HTMLButtonElement;
}
function clicar(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
function digitar(el: HTMLTextAreaElement | HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  act(() => {
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const porTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;

function renderizar(total: number | null, extras: { onUsarSomaComoValorDoItem?: (c: number) => void } = {}) {
  const onAplicar = vi.fn();
  const onOpenChange = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <ColarRateioCCDialog
        open
        onOpenChange={onOpenChange}
        centrosCusto={CADASTRO}
        totalEsperadoCentavos={total}
        classeLabel="15.02 — TESTE"
        onAplicar={onAplicar}
        {...extras}
      />,
    ),
  );
  const colar = (texto: string) =>
    digitar(document.querySelector('textarea[aria-label="Lista de centros de custo e valores"]') as HTMLTextAreaElement, texto);
  return { onAplicar, onOpenChange, colar };
}

describe("ColarRateioCCDialog", () => {
  it("lista do Pedro: 17 casam sozinhos, 2 esperam escolha e o Aplicar fica travado", () => {
    const { colar } = renderizar(5_235_000);
    colar(LISTA_DO_PEDRO);

    const resumo = porTestId("resumo-colagem");
    expect(resumo).toHaveTextContent("19 linhas");
    expect(resumo).toHaveTextContent("17 reconhecidas");
    expect(resumo).toHaveTextContent("2 para escolher");
    expect(resumo).toHaveTextContent("✓ confere");
    expect(botao(/^Aplicar/)).toBeDisabled();
  });

  it("depois das duas escolhas, fecha 100,0000% e aplica os 19 valores exatos", () => {
    const { colar, onAplicar, onOpenChange } = renderizar(5_235_000);
    colar(LISTA_DO_PEDRO);

    clicar(botao("ASSUNTOS CLINICOS"));
    clicar(botao("ASSUNTOS REGULATORIOS"));

    expect(porTestId("soma-percentual")).toHaveTextContent("100,0000%");
    const aplicar = botao("Aplicar 19 centros de custo");
    expect(aplicar).toBeEnabled();
    clicar(aplicar);

    expect(onAplicar).toHaveBeenCalledTimes(1);
    const linhas = onAplicar.mock.calls[0][0] as Array<{ codigo_centro_ctrl: string; centavos: number }>;
    expect(linhas).toHaveLength(19);
    expect(linhas.reduce((s, l) => s + l.centavos, 0)).toBe(5_235_000);
    expect(linhas.find((l) => l.codigo_centro_ctrl === "00007.00001.00003")?.centavos).toBe(205714);
    expect(linhas.find((l) => l.codigo_centro_ctrl === "00010.00004.00003")?.centavos).toBe(180000);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("total diferente do item: mostra a diferença, trava, e oferece usar a soma (qtd 1)", () => {
    const usarSoma = vi.fn();
    const { colar } = renderizar(5_000_000, { onUsarSomaComoValorDoItem: usarSoma });
    colar("Compras  R$ 900,00\nCorelab  R$ 2.057,14");

    expect(porTestId("resumo-colagem")).toHaveTextContent("diferença de R$ 47.042,86 a menos");
    expect(botao(/^Aplicar/)).toBeDisabled();
    clicar(botao("Usar R$ 2.957,14 como valor do item"));
    expect(usarSoma).toHaveBeenCalledWith(295714);
  });

  it("linha ilegível aparece como erro e trava o Aplicar", () => {
    const { colar } = renderizar(null);
    colar("Compras  R$ 900,00\nCorelab  2057,142857");
    expect(document.querySelector('[role="alert"]')).toHaveTextContent("Linha 2");
    expect(botao(/^Aplicar/)).toBeDisabled();
  });

  it("linha de total é ignorada e conferida", () => {
    const { colar } = renderizar(null);
    colar("Compras\t900,00\nCorelab\t2.057,14\nTotal\t2.957,14");
    expect(document.body).toHaveTextContent("Linha 3 ignorada (linha de total)");
    expect(document.body).toHaveTextContent("confere com a soma das linhas");
    expect(botao("Aplicar 2 centros de custo")).toBeEnabled();
  });
});
