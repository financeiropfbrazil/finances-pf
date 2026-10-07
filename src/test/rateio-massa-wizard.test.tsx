import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Card RATEIO-MASSA — o fluxo inteiro na tela real do wizard (SuprimentosPedidoNovo):
 * retomar um rascunho → editar o item → Colar lista → escolher os 2 ambíguos →
 * aplicar → salvar → avançar até "Enviar Pedido" → conferir o que chega ao serviço
 * e o payload que o serviço monta para o Alvo.
 *
 * Sem @testing-library/react (não é dependência do projeto): react-dom + act, como
 * os demais testes de tela do repositório.
 */

// ── Dados que as queries do wizard leem do Supabase ─────────────────────────
const TABELAS: Record<string, unknown[]> = {
  stock_products: [
    { codigo_produto: "002.023", nome_produto: "SERVIÇO RATEADO", codigo_alternativo: null, unidade_medida: "UNID", tipo_produto_fiscal: "09" },
  ],
  classes_rec_desp: [{ codigo: "15.02", nome: "VIAGENS" }],
  cost_centers: [
    ["00010.00002.00007.00002", "ALMOXARIFADO/EXPEDICAO"], ["00010.00004.00003", "ASSUNTOS CLINICOS"],
    ["00010.00004.00001", "ASSUNTOS REGULATORIOS"], ["00010.00002.00007.00001", "COMPRAS"],
    ["00010.00002.00003", "CONTROLADORIA/FINANCEIRO"], ["00010.00003.00002", "CONTROLE DA QUALIDADE"],
    ["00007.00001.00003", "CORELAB"], ["00008.00001.00003", "DESIGN E DESENVOLVIMENTO"],
    ["00010.00001.00001", "DIRETORIA DE P&D"], ["00007.00003.00001", "EDUCACAO CLINICA"],
    ["00010.00003.00004", "ENGENHARIA DA QUALIDADE"], ["00010.00002.00005", "ENGENHARIA DE MANUFATURA"],
    ["00007.00001.00004", "ESPECIALISTAS CLINICOS"], ["00010.00004.00002", "ESTUDO TRICUS - REGULATORIO"],
    ["00010.00003.00001", "GARANTIA DA QUALIDADE"], ["00010.00003.00003", "GERENCIAMENTO DE RISCOS"],
    ["00008.00001.00006", "LAB PESQUISA"], ["00008.00001.00002", "LABORATORIO"],
    ["00007.00001.00002", "MARKETING E COMUNICACAO"], ["00009.00001.00001", "PRODUCAO"],
    ["00008.00001.00001", "PROTOTIPAGEM"], ["00010.00002.00002", "RECURSOS HUMANOS"],
    ["00010.00002.00008", "TI - TECNOLOGIA DA INFORMACAO"],
  ].map(([erp_code, name]) => ({ erp_code, name, department_type: "Administrativo" })),
  compras_entidades_cache: [
    { codigo_entidade: "0000123", cnpj: null, nome: "FORNECEDOR TESTE", nome_fantasia: null, municipio: null, uf: null },
  ],
  condicoes_pagamento: [{ codigo: "0000037", nome: "30 DIAS", quantidade_parcelas: 1, dias_entre_parcelas: 30 }],
};

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const resultado = () => Promise.resolve({ data: TABELAS[tabela] ?? [], error: null });
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "in", "ilike", "or", "limit", "not", "is"]) q[m] = () => q;
    q.range = (de: number) => Promise.resolve({ data: de === 0 ? TABELAS[tabela] ?? [] : [], error: null });
    q.maybeSingle = resultado;
    q.single = resultado;
    q.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => resultado().then(ok, erro);
    return q;
  };
  return { supabase: { from: consulta, storage: { from: () => ({ download: async () => ({ data: null, error: null }) }) } } };
});

// Os toasts são desenhados pelo <Toaster /> do App (fora desta tela) — aqui só registramos.
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toastMock(...a), useToast: () => ({ toast: toastMock, toasts: [] }) }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", email: "operadora@pfbrazil.com" }, profile: { full_name: "Operadora Teste" } }),
}));

// O rascunho retomado: 1 serviço de R$ 52.350,00, hoje rateado 100% num CC só.
const RASCUNHO = {
  pedido_id: "ped-1",
  numero: "RASCUNHO-abc",
  status_local: "erro_envio",
  erro_envio: null,
  origem_numero_req_alvo: null,
  origem_codigo_empresa_filial_req_comp: null,
  codigo_entidade: "0000123",
  nome_entidade: "FORNECEDOR TESTE",
  cnpj_entidade: null,
  codigo_cond_pag: "0000037",
  nome_cond_pag: "30 DIAS",
  codigo_ind_economico: "0000001",
  tipo_entrega: "Total" as const,
  data_pedido: "2026-09-23",
  data_entrega: "2099-12-30",
  data_validade: "2099-12-31",
  itens: [
    {
      item_servico: true,
      codigo_produto: "002.023",
      codigo_alternativo_produto: null,
      codigo_prod_unid_med: "UNID",
      produto_nome: "SERVIÇO RATEADO",
      produto_unidade: "UNID",
      quantidade: 1,
      valor_unitario: 52350,
      observacao: "",
      rateio: [
        {
          codigo_classe_rec_desp: "15.02",
          classe_rec_desp_label: "VIAGENS",
          percentual: 100,
          ccs: [{ codigo_centro_ctrl: "00009.00001.00001", centro_ctrl_label: "PRODUCAO", percentual: 100 }],
        },
      ],
    },
  ],
  parcelas: [{ sequencia: 1, dias_entre_parcelas: 30, percentual_fracao: 1, valor_parcela: 52350, data_vencimento: "2099-10-22" }],
  arquivos_existentes: [],
  texto_livre_existente: "",
  texto_historico_existente: "",
};

const enviarPedidoMock = vi.fn();
vi.mock("@/services/pedidosService", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/pedidosService")>();
  return {
    ...real,
    carregarPedidoParaEdicao: vi.fn(async () => RASCUNHO),
    enviarPedido: (...args: unknown[]) => enviarPedidoMock(...args),
  };
});

import SuprimentosPedidoNovo from "@/pages/SuprimentosPedidoNovo";
import { montarPayloadPedComp, type NovoPedidoInput } from "@/services/pedidosService";
import { percentualParaUnidades } from "@/lib/rateioExato";

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

// ── helpers mínimos (react-dom + act) ───────────────────────────────────────
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});
afterAll(() => vi.unstubAllGlobals());

function montarWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <MemoryRouter initialEntries={["/suprimentos/pedidos/novo?pedidoId=ped-1"]}>
        <QueryClientProvider client={qc}>
          <SuprimentosPedidoNovo />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  );
}
async function esperar(condicao: () => boolean, descricao: string, ms = 5000) {
  const fim = Date.now() + ms;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error(`tempo esgotado esperando: ${descricao}`);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}
function botao(nome: string | RegExp, escopo: ParentNode = document): HTMLButtonElement {
  const todos = Array.from(escopo.querySelectorAll("button"));
  const achado = todos.reverse().find((b) => {
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
const temTexto = (t: string) => (document.body.textContent ?? "").includes(t);
const modais = () => Array.from(document.querySelectorAll('[role="dialog"]')) as HTMLElement[];
const porTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;

beforeAll(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  // cmdk/radix pedem ResizeObserver em jsdom.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe("wizard de pedido — rateio em massa por valor, ponta a ponta na tela", () => {
  it("colar → escolher → aplicar → salvar → enviar: 19 CCs, R$ 52.350,00 e 100,0000% exatos", async () => {
    enviarPedidoMock.mockResolvedValue({ sucesso: true, pedido_id: "ped-1", numero_alvo: "0009999" });
    montarWizard();

    // Rascunho carregado → editar o item.
    await esperar(() => temTexto("SERVIÇO RATEADO"), "rascunho carregado");
    const editar = container!.querySelector("button svg.lucide-pencil")?.closest("button");
    expect(editar).toBeTruthy();
    clicar(editar!);
    await esperar(() => modais().length === 1, "modal do item");
    clicar(botao(/Próximo/, modais()[0]));

    // Sub-etapa do rateio → Colar lista.
    await esperar(() => temTexto("Colar lista (R$)"), "botão Colar lista");
    clicar(botao(/Colar lista \(R\$\)/, modais()[0]));
    await esperar(() => !!document.querySelector('textarea[aria-label="Lista de centros de custo e valores"]'), "diálogo de colar");
    digitar(document.querySelector('textarea[aria-label="Lista de centros de custo e valores"]') as HTMLTextAreaElement, LISTA_DO_PEDRO);
    clicar(botao("ASSUNTOS CLINICOS"));
    clicar(botao("ASSUNTOS REGULATORIOS"));
    clicar(botao("Aplicar 19 centros de custo"));

    // De volta ao modal do item: modo por valor, total conferido e 100,0000%.
    await esperar(() => !!porTestId("total-rateio-valor"), "rodapé por valor");
    expect(porTestId("total-rateio-valor")).toHaveTextContent("CCs: R$ 52.350,00 de R$ 52.350,00 ✓ 100,0000%");
    const campos = Array.from(document.querySelectorAll('input[aria-label^="Valor em R$ do centro de custo"]')) as HTMLInputElement[];
    expect(campos).toHaveLength(19);
    expect(campos.some((c) => c.value === "2.057,14")).toBe(true); // Corelab, exato
    expect(temTexto("3,9296%")).toBe(true);

    clicar(botao("Salvar", modais()[0]));
    await esperar(() => temTexto("rateio por valor (R$)") && modais().length === 0, "item salvo");

    // Avança as etapas (fornecedor, datas e parcelas vieram do rascunho) e envia.
    for (let i = 0; i < 4; i++) {
      clicar(botao(/Próximo/));
    }
    await esperar(() => temTexto("Enviar Pedido"), "etapa de revisão");
    clicar(botao(/Enviar Pedido/));
    await esperar(() => enviarPedidoMock.mock.calls.length === 1, "envio");

    // O que a tela entrega ao serviço.
    const input = enviarPedidoMock.mock.calls[0][0] as NovoPedidoInput;
    expect(enviarPedidoMock.mock.calls[0][1]).toBe("ped-1");
    // Rascunho salvo antes da opção "Data Base Parcelas" mantém a Data do Pedido.
    expect(input.data_base_parcelas).toBe("Data do Pedido");
    const item = input.itens[0];
    expect(item.rateio_por_valor).toBe(true);
    const ccs = item.rateio[0].ccs;
    expect(ccs).toHaveLength(19);
    expect(ccs.reduce((s, cc) => s + (cc.valor_centavos ?? 0), 0)).toBe(5_235_000);
    expect(ccs.find((cc) => cc.codigo_centro_ctrl === "00007.00001.00003")?.valor_centavos).toBe(205714);

    // E o payload que o serviço monta para o Alvo com esse input.
    const payload = montarPayloadPedComp({
      input,
      texto_completo: "",
      texto_historico_completo: "",
      itens_enriquecidos: input.itens.map(() => ({
        CodigoClasFiscal: null, CodigoSitTributaria: null, CodigoTributA: null, CodigoTributB: null,
        CodigoSitTributariaIBSCBS: null, PercentualICMS: 0, BaseICMS: 0, ValorICMS: 0, PercentualIPI: 0, BaseIPI: 0, ValorIPI: 0,
      })),
      codigo_comprador: null,
      codigo_usuario_alvo: "OPERADORA",
    });
    const linhas = payload.ItemPedCompChildList[0].ItemPedCompClasseRecdespChildList[0].RateioItemPedCompChildList as Array<{
      Valor: number;
      Percentual: number;
    }>;
    expect(linhas.reduce((s, l) => s + Math.round(l.Valor * 100), 0)).toBe(5_235_000);
    expect(linhas.reduce((s, l) => s + percentualParaUnidades(l.Percentual), 0)).toBe(1_000_000);
  }, 30_000);

  it("digitar por valor: a troca % → R$ converte exato, e soma diferente do item não deixa salvar", async () => {
    montarWizard();
    await esperar(() => temTexto("SERVIÇO RATEADO"), "rascunho carregado");
    clicar(container!.querySelector("button svg.lucide-pencil")!.closest("button")!);
    await esperar(() => modais().length === 1, "modal do item");
    clicar(botao(/Próximo/, modais()[0]));

    // Aba "Valor (R$)" (Radix ativa no mousedown do botão esquerdo).
    await esperar(() => !!Array.from(document.querySelectorAll('[role="tab"]')).find((t) => t.textContent === "Valor (R$)"), "abas");
    const aba = Array.from(document.querySelectorAll('[role="tab"]')).find((t) => t.textContent === "Valor (R$)")!;
    act(() => {
      aba.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });

    // 100% de R$ 52.350,00 vira R$ 52.350,00 no CC, e o rodapé confere.
    await esperar(() => !!document.querySelector('input[aria-label^="Valor em R$ do centro de custo"]'), "campo R$");
    const campoValor = document.querySelector('input[aria-label^="Valor em R$ do centro de custo"]') as HTMLInputElement;
    expect(campoValor).toHaveValue("52.350,00");
    expect(porTestId("total-rateio-valor")).toHaveTextContent("✓ 100,0000%");

    // Um valor que não fecha o item: rodapé acusa e o Salvar não aceita.
    digitar(campoValor, "50.000,00");
    expect(porTestId("total-rateio-valor")).toHaveTextContent("diferença de R$ 2.350,00");
    toastMock.mockClear();
    clicar(botao("Salvar", modais()[0]));
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Rateio inválido",
        description: expect.stringMatching(/Os CCs somam R\$ 50\.000,00 e o item vale R\$ 52\.350,00/),
      }),
    );
    expect(modais()).toHaveLength(1); // o modal continua aberto

    // Ao sair do campo, o texto mostra como o valor foi entendido.
    digitar(campoValor, "52350");
    act(() => {
      campoValor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(campoValor).toHaveValue("52.350,00");
  }, 30_000);
});
