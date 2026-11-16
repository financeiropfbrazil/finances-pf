import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/** NFE-19 — vários anexos por etapa (até 5), NF-e e NFS-e (componente comum). */
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { AreaAnexos, LeituraBoleto, rotuloAnexos } from "@/components/nfse/NfseDetalheEtapas";
import type { AnexoNfse } from "@/services/nfseRecebidasService";

const anexo = (i: number): AnexoNfse => ({
  id: `a${i}`,
  tipo: "boleto",
  bucket_id: "nfse-boleto-pdf",
  storage_path: `x/${i}.pdf`,
  nome_original: `boleto-parcela-${i}.pdf`,
  tamanho_bytes: 1000 * i,
  enviado_em: "2026-11-16T15:00:00Z",
  enviado_por: "mirlene.oliveira",
});
const pdf = (nome: string) => new File(["%PDF"], nome, { type: "application/pdf" });

let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = "";
  toast.mockClear();
});
const esperar = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });

function montar(ui: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}
const botoes = () => Array.from(document.querySelectorAll("button"));
const textoDe = (b: Element) => (b.textContent ?? "").trim();
async function escolher(arquivos: File[]) {
  const input = container!.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input.multiple).toBe(true);
  Object.defineProperty(input, "files", { value: arquivos, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperar();
}

describe("anexos — vários arquivos por etapa (NFE-19)", () => {
  it("sem arquivos: área grande de anexar, avisando o limite de 5", () => {
    montar(<AreaAnexos chave="c" tipo="boleto" anexos={[]} onMudou={() => {}} acoes={{ anexar: vi.fn(), remover: vi.fn() }} />);
    expect(container!.textContent).toContain("Anexar PDF do boleto");
    expect(container!.textContent).toContain("até 5 arquivos");
  });

  it("com arquivos: lista cada um (nome, quem enviou) e mostra \"Anexar mais (2 de 5)\"", () => {
    montar(<AreaAnexos chave="c" tipo="boleto" anexos={[anexo(1), anexo(2)]} onMudou={() => {}} acoes={{ anexar: vi.fn(), remover: vi.fn() }} />);
    const itens = container!.querySelectorAll("li");
    expect(itens).toHaveLength(2);
    expect(itens[0].textContent).toContain("boleto-parcela-1.pdf");
    expect(itens[0].textContent).toContain("mirlene.oliveira");
    expect(botoes().map(textoDe)).toContain("Anexar mais (2 de 5)");
  });

  it("escolher 5 arquivos com 2 já anexados: só 3 sobem, e o aviso diz que 2 ficaram de fora", async () => {
    const anexar = vi.fn(async (_chave: string, _tipo: string, _arquivo: File) => undefined);
    const onMudou = vi.fn();
    montar(<AreaAnexos chave="c" tipo="boleto" anexos={[anexo(1), anexo(2)]} onMudou={onMudou} acoes={{ anexar, remover: vi.fn() }} />);
    await escolher(["p3.pdf", "p4.pdf", "p5.pdf", "p6.pdf", "p7.pdf"].map(pdf));
    expect(anexar).toHaveBeenCalledTimes(3);
    expect(anexar.mock.calls.map((c) => (c[2] as File).name)).toEqual(["p3.pdf", "p4.pdf", "p5.pdf"]);
    expect(onMudou).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ title: "3 arquivos anexados", variant: "destructive" });
    expect(toast.mock.calls[0][0].description).toContain("2 arquivo(s) ficaram de fora");
  });

  it("um arquivo falha no meio do lote: os outros entram e o aviso diz qual falhou e por quê", async () => {
    const anexar = vi.fn(async (_c: string, _t: string, f: File) => {
      if (f.name === "dup.pdf") throw new Error("Este arquivo já está anexado nesta etapa.");
    });
    montar(<AreaAnexos chave="c" tipo="nf" anexos={[]} onMudou={() => {}} acoes={{ anexar, remover: vi.fn() }} />);
    await escolher([pdf("a.pdf"), pdf("dup.pdf"), pdf("b.pdf")]);
    expect(anexar).toHaveBeenCalledTimes(3);
    expect(toast.mock.calls[0][0].title).toBe("2 arquivos anexados");
    expect(toast.mock.calls[0][0].description).toBe("dup.pdf: Este arquivo já está anexado nesta etapa.");
  });

  it("com 5 arquivos: some o \"Anexar\" e aparece o aviso do limite", () => {
    montar(
      <AreaAnexos chave="c" tipo="boleto" anexos={[1, 2, 3, 4, 5].map(anexo)} onMudou={() => {}} acoes={{ anexar: vi.fn(), remover: vi.fn() }} />,
    );
    expect(botoes().map(textoDe).some((t) => t.startsWith("Anexar"))).toBe(false);
    expect(container!.textContent).toContain("Limite de 5 arquivos atingido");
  });

  it("remover pede confirmação e remove só aquele arquivo", async () => {
    const remover = vi.fn(async () => undefined);
    montar(<AreaAnexos chave="c" tipo="boleto" anexos={[anexo(1), anexo(2)]} onMudou={() => {}} acoes={{ anexar: vi.fn(), remover }} />);
    const botaoRemover = container!.querySelector('button[aria-label="Remover boleto-parcela-2.pdf"]') as HTMLButtonElement;
    await act(async () => botaoRemover.click());
    expect(document.body.textContent).toContain("boleto-parcela-2.pdf sai desta nota");
    const confirmar = botoes().find((b) => textoDe(b) === "Remover" && !b.getAttribute("aria-label"))!;
    await act(async () => confirmar.click());
    await esperar();
    expect(remover).toHaveBeenCalledWith("a2");
  });

  it("leitura do boleto: um botão por boleto anexado (com o nome quando há mais de um)", () => {
    montar(<LeituraBoleto anexos={[anexo(1), anexo(2)]} />);
    const textos = botoes().map(textoDe);
    expect(textos).toContain("Ler linha digitável · boleto-parcela-1.pdf");
    expect(textos).toContain("Ler linha digitável · boleto-parcela-2.pdf");
    act(() => root!.render(<LeituraBoleto anexos={[anexo(1)]} />));
    expect(botoes().map(textoDe)).toContain("Ler linha digitável");
  });

  it("resumo da etapa", () => {
    expect(rotuloAnexos(1)).toBe("1 arquivo anexado");
    expect(rotuloAnexos(3)).toBe("3 arquivos anexados");
  });
});
