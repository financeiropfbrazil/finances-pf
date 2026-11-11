import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

/** VND-7 — Vendas › Notas de Saída (Pedro, 11/11/2026). */
const NOTA = {
  data_competencia: null, codigo_entidade: null, nome_fantasia: null, nome_cidade: null, intercompany_austria: false,
  abrangencia: null, classe_principal: null, vendedor_principal: null, data_cancelamento: null, numero_nfse_prefeitura: null,
  moeda_codigo: "0000001", cambio: null, valor_original: null, valor_produto: null, valor_servico: null, valor_frete: null,
  valor_desconto: null, valor_icms: null, valor_ipi: null, valor_iss: null, detalhe_status: "carregado", ausente_desde: null,
  situacao_hub: "ativa", uf: null,
};
const RESULTADO = {
  total: 3,
  ultima_leitura_alvo: "2026-11-11T20:17:40Z",
  ultima_rodada: { fim: "2026-11-11T20:18:11Z", erros: 0, origem: "manual_admin" },
  pendentes_detalhe: 0,
  agendamento_ligado: true,
  resumo: { notas: 3, canceladas: 1, valor_total: 0, por_regiao: [], por_tipo: [] },
  linhas: [
    { ...NOTA, id: "a", modelo: "NF-e", serie: "1", numero: 5106, data_emissao: "2026-10-05", razao_social: "ENDOTEC PRODUTOS MEDICOS S/A",
      cpf_cnpj: "09586279000101", sigla_pais: "BRA", nome_pais: "Brasil", regiao: "Brasil", natureza_principal: "5.922.001",
      tipo_operacao: "venda", numero_pedvenda: "0002644", cancelada: false, valor_total: 625560 },
    { ...NOTA, id: "b", modelo: "NFS-e", serie: "001", numero: 439, data_emissao: "2026-10-02", razao_social: "PEF PRODUCTS AND FEATURES GMBH",
      cpf_cnpj: null, sigla_pais: "AUT", nome_pais: "Áustria", regiao: "Áustria", natureza_principal: "7.933.001",
      tipo_operacao: "venda", numero_pedvenda: null, cancelada: false, valor_total: 920508.32, situacao_hub: "provisoria" },
    { ...NOTA, id: "c", modelo: "NF-e", serie: "1", numero: 5100, data_emissao: "2026-10-01", razao_social: "CLIENTE CANCELADO LTDA",
      cpf_cnpj: "11222333000144", sigla_pais: "BRA", nome_pais: "Brasil", regiao: "Brasil", natureza_principal: "5.101.001",
      tipo_operacao: "venda", numero_pedvenda: null, cancelada: true, valor_total: 1000 },
  ],
};
const DETALHE = {
  nota: RESULTADO.linhas[0],
  itens: [{ sequencia: 1, item_servico: false, codigo_produto: "001.001.00034", codigo_alternativo: "TRV", nome_produto: "SISTEMA TRICVALVE",
    natureza_operacao: "5.922.001", cfop: "5922", ncm: null, unidade: "UN", quantidade: 10, valor_unitario: 62556, valor_total: 625560,
    valor_frete: 0, valor_desconto: 0, valor_icms: 0, valor_ipi: 0, valor_pis: 0, valor_cofins: 0, valor_iss: 0, numero_pedvenda: null }],
  lotes: [{ sequencia_item: 1, ordem: 1, codigo_produto: "001.001.00034", numero_lote: "TS00058", data_validade: "2027-05-01", codigo_local: "001", quantidade: 10 }],
  series: [{ sequencia_item: 1, controle_num_serie: 9001 }, { sequencia_item: 1, controle_num_serie: 9002 }],
  parcelas: [{ sequencia_cond: 1, sequencia_parcela: 1, duplicata: null, nome_cond_pag: "30 dias", data_vencimento: "2026-11-04", valor: 625560, chave_docfin: 1 }],
  classes: [{ codigo_classe: "01.03", valor: 625560, natureza: null }],
};
const detalhe = vi.fn(async () => DETALHE);
vi.mock("@/services/vendasNotasService", async (original) => ({
  ...(await original<typeof import("@/services/vendasNotasService")>()),
  listarNotasSaida: vi.fn(async () => RESULTADO),
  buscarDetalheNotaSaida: (...a: unknown[]) => detalhe(...(a as [])),
  listarItensNotasSaida: vi.fn(async () => []),
  exportarNotasSaidaXLSX: vi.fn(() => ({ arquivo: "x.xlsx", notas: 0, itens: 0 })),
}));

import VendasNotasSaida from "@/pages/VendasNotasSaida";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  detalhe.mockClear();
});
const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });

async function montar() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<MemoryRouter><VendasNotasSaida /></MemoryRouter>));
  await esperar();
  return container;
}
const linhas = (c: HTMLElement) => Array.from(c.querySelectorAll("tbody tr"));

describe("Vendas › Notas de Saída", () => {
  it("lista as notas e soma o valor sem as canceladas no Alvo", async () => {
    const c = await montar();
    expect(linhas(c)).toHaveLength(3);
    expect(c.textContent).toContain("ENDOTEC PRODUTOS MEDICOS S/A");
    expect(c.textContent).toContain("Provisória");
    expect(c.textContent).toContain("Cancelada");
    // 625.560,00 + 920.508,32 (a cancelada de 1.000,00 fica fora)
    expect(c.querySelector("tfoot")?.textContent).toContain("1.546.068,32");
    expect(c.textContent).toContain("Lidas do Alvo até");
  });

  it("busca por número filtra a lista", async () => {
    const c = await montar();
    const input = c.querySelector("input") as HTMLInputElement;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "439");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await esperar();
    expect(linhas(c)).toHaveLength(1);
    expect(c.textContent).toContain("PEF PRODUCTS AND FEATURES GMBH");
  });

  it("clicar na nota abre itens, lote, séries e parcelas", async () => {
    const c = await montar();
    act(() => (linhas(c)[0] as HTMLElement).click());
    await esperar();
    expect(detalhe).toHaveBeenCalledWith("a");
    expect(c.textContent).toContain("SISTEMA TRICVALVE");
    expect(c.textContent).toContain("TS00058");
    expect(c.textContent).toContain("2 nº de série");
    expect(c.textContent).toContain("30 dias");
  });
});
