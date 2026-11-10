import { describe, expect, it } from "vitest";
import {
  cfopsDaNota,
  notaCasaBusca,
  notaFaturavel,
  situacaoAlvoDaNota,
  pedidosCitadosNosItens,
  resumoErrosUpload,
  type NotaBuscavel,
} from "@/components/nfe/nfeLista";

const nota: NotaBuscavel = {
  numero: "13902",
  emitente_nome: "FAST PARTS PROTOTIPOS LTDA",
  emitente_cnpj: "11222333000144",
  chave_acesso: "35261011222333000144550010000139021000000001",
  pedido_compra_numero: null,
  dados_extraidos: {
    itens: [
      { cfop: "5102", pedido_xml: "0004780" },
      { cfop: "5949", pedido_xml: "RETIRAR 14h" },
      { cfop: "5102", pedido_xml: "4780" },
    ],
  },
};

describe("lista de NF-e (NFE-7)", () => {
  it("CFOPs distintos na ordem dos itens; nota sem itens não quebra", () => {
    expect(cfopsDaNota(nota)).toEqual(["5102", "5949"]);
    expect(cfopsDaNota({ dados_extraidos: null })).toEqual([]);
    expect(cfopsDaNota({ dados_extraidos: { itens: null } })).toEqual([]);
  });

  it("pedido citado no item: só número, sem zeros à esquerda, sem repetir", () => {
    expect(pedidosCitadosNosItens(nota)).toEqual(["4780"]);
  });

  it("busca por fornecedor e número continua por trecho", () => {
    expect(notaCasaBusca(nota, "fast parts")).toBe(true);
    expect(notaCasaBusca(nota, "1390")).toBe(true);
    expect(notaCasaBusca(nota, "outro fornecedor")).toBe(false);
    expect(notaCasaBusca(nota, "  ")).toBe(true);
  });

  it("CNPJ com ou sem pontuação e chave de acesso (inteira ou um trecho longo)", () => {
    expect(notaCasaBusca(nota, "11.222.333/0001-44")).toBe(true);
    expect(notaCasaBusca(nota, "11222333")).toBe(true);
    expect(notaCasaBusca(nota, "3526 1011 2223 3300 0144 5500 1000 0139 0210 0000 0001")).toBe(true);
    expect(notaCasaBusca(nota, "99.999.999/0001-99")).toBe(false);
  });

  it("pedido pelo número exato, com ou sem zeros: citado no item ou vinculado no Hub", () => {
    expect(notaCasaBusca(nota, "4780")).toBe(true);
    expect(notaCasaBusca(nota, "0004780")).toBe(true);
    expect(notaCasaBusca(nota, "478")).toBe(false);
    const vinculada = { ...nota, dados_extraidos: { itens: [] }, pedido_compra_numero: "0003892" };
    expect(notaCasaBusca(vinculada, "3892")).toBe(true);
  });

  it("CFOP pelo código de 4 dígitos", () => {
    expect(notaCasaBusca(nota, "5949")).toBe(true);
    expect(notaCasaBusca(nota, "5916")).toBe(false);
  });

  it("aviso do upload traz o motivo dos 2 primeiros erros e conta o resto", () => {
    expect(resumoErrosUpload([])).toBeNull();
    expect(resumoErrosUpload(["a.xml: sem chave"])).toBe("a.xml: sem chave");
    expect(resumoErrosUpload(["a: x", "b: y", "c: z", "d: w"])).toBe("a: x · b: y · e mais 2");
  });

  it("venda pelo mesmo critério das RPCs; nota sem itens conta como venda (NFE-8)", () => {
    expect(notaFaturavel(nota)).toBe(true); // 5102 + 5949
    expect(notaFaturavel({ dados_extraidos: { itens: [{ cfop: "5949" }, { cfop: "5916" }] } })).toBe(false);
    expect(notaFaturavel({ dados_extraidos: { itens: [{ cfop: "6918" }] } })).toBe(false);
    expect(notaFaturavel({ dados_extraidos: { itens: [{ cfop: "5405" }] } })).toBe(true);
    expect(notaFaturavel({ dados_extraidos: { itens: [{ cfop: "6933" }] } })).toBe(true);
    expect(notaFaturavel({ dados_extraidos: { itens: [] } })).toBe(true);
  });

  it("No Alvo na lista: lançada › sem dado (antes do espelho) › sem como saber (sem venda) › não encontrada", () => {
    const remessa = { data_emissao: "2026-10-30", dados_extraidos: { itens: [{ cfop: "5949" }] } };
    const venda = { data_emissao: "2026-10-30", dados_extraidos: { itens: [{ cfop: "5102" }] } };
    const antiga = { ...venda, data_emissao: "2025-12-15" };
    expect(situacaoAlvoDaNota(true, remessa, "2026-01-01")).toBe("lancada");
    expect(situacaoAlvoDaNota(false, antiga, "2026-01-01")).toBe("sem_dado_alvo");
    expect(situacaoAlvoDaNota(false, remessa, "2026-01-01")).toBe("sem_como_saber");
    expect(situacaoAlvoDaNota(false, venda, "2026-01-01")).toBe("nao_encontrada");
    // sem a data do espelho (consulta falhou), a nota antiga com venda volta a "não encontrada", como antes
    expect(situacaoAlvoDaNota(false, antiga, null)).toBe("nao_encontrada");
  });
});
