import { describe, it, expect, vi } from "vitest";

// Os serviços importam o client do Supabase no topo; os testes são puros.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { buildPayload, resolverParcelasParaEnvio } from "@/services/alvoProjetoPedidoService";
import {
  adicionarParcela,
  alterarDias,
  alterarVencimento,
  calcularParcelasProjeto,
  datasParaAlvo,
  interpretarFracoes,
  linhasDoResumo,
  parcelasParaAlvo,
  recalcularDias,
  removerParcela,
  validarParcelas,
  type LinhaCondicao,
  type ParcelaProjeto,
} from "@/services/projetoParcelas";

const linhas = (dias: number[], fracao: number[]): LinhaCondicao[] =>
  dias.map((d, i) => ({ numero: i + 1, dias_prazo: d, percentual_fracao: fracao[i] }));

const valores = (ps: ParcelaProjeto[]) => ps.map((p) => p.valor_parcela);

describe("interpretarFracoes — o cadastro tem os dois formatos (medido em 15/10/2026)", () => {
  it("divisor (condições antigas: 30/60/90 = 3,3,3)", () => {
    expect(interpretarFracoes(linhas([30, 60, 90], [3, 3, 3])).modo).toBe("divisor");
  });
  it("percentual (condições novas: ENTRADA/30 = 50,50)", () => {
    expect(interpretarFracoes(linhas([0, 30], [50, 50])).modo).toBe("percentual");
  });
  it("nem um nem outro: partes iguais", () => {
    expect(interpretarFracoes(linhas([0, 30], [7, 9])).modo).toBe("partes_iguais");
  });
});

describe("calcularParcelasProjeto", () => {
  it("2 X de R$ 1.000 em percentual vira 500 + 500 (não 20 + 980)", () => {
    const ps = calcularParcelasProjeto(linhas([0, 30], [50, 50]), 1000, "2026-10-15");
    expect(valores(ps)).toEqual([500, 500]);
  });

  it("30/60/90 em divisor: a última fecha o total no centavo", () => {
    const ps = calcularParcelasProjeto(linhas([30, 60, 90], [3, 3, 3]), 1000, "2026-10-15");
    expect(valores(ps)).toEqual([333.33, 333.33, 333.34]);
    expect(ps.map((p) => p.data_vencimento)).toEqual(["2026-11-14", "2026-12-14", "2027-01-13"]);
    // 1ª = dias depois da base; demais = depois da anterior
    expect(ps.map((p) => p.dias_entre_parcelas)).toEqual([30, 30, 30]);
  });

  it("0/21/42/63 (cond. 0000115, fração 25 = percentual)", () => {
    const ps = calcularParcelasProjeto(linhas([0, 21, 42, 63], [25, 25, 25, 25]), 100, "2026-10-15");
    expect(valores(ps)).toEqual([25, 25, 25, 25]);
    expect(ps.map((p) => p.dias_entre_parcelas)).toEqual([0, 21, 21, 21]);
    expect(ps[0].data_vencimento).toBe("2026-10-15");
  });

  it("33,34/33,33/33,33 (percentual quebrado) soma exatamente", () => {
    const ps = calcularParcelasProjeto(linhas([0, 30, 60], [33.34, 33.33, 33.33]), 26905.88, "2026-10-15");
    expect(Math.round(ps.reduce((s, p) => s + p.valor_parcela, 0) * 100)).toBe(2690588);
  });

  it("resumo de condicoes_pagamento reproduz o cálculo de antes do L11", () => {
    const ps = calcularParcelasProjeto(
      linhasDoResumo({ quantidade_parcelas: 1, dias_entre_parcelas: 30, primeiro_vencimento_apos: 30 }),
      10800,
      "2026-10-15",
    );
    expect(ps).toEqual([{ sequencia: 1, dias_entre_parcelas: 30, valor_parcela: 10800, data_vencimento: "2026-11-14" }]);
  });

  it("condição sem linhas não inventa parcela", () => {
    expect(() => calcularParcelasProjeto([], 100, "2026-10-15")).toThrow(/sem parcelas/);
  });
});

describe("edição: vencimento e dias andam juntos", () => {
  const base = "2026-10-15";
  const tres = () => calcularParcelasProjeto(linhas([30, 60, 90], [3, 3, 3]), 900, base);

  it("mudar o vencimento recalcula os dias dela e da seguinte", () => {
    const ps = alterarVencimento(tres(), 1, "2026-12-01", base);
    expect(ps.map((p) => p.data_vencimento)).toEqual(["2026-11-14", "2026-12-01", "2027-01-13"]);
    expect(ps.map((p) => p.dias_entre_parcelas)).toEqual([30, 17, 43]);
  });

  it("mudar os dias move o vencimento dela e empurra as seguintes", () => {
    const ps = alterarDias(tres(), 0, 45, base);
    expect(ps.map((p) => p.data_vencimento)).toEqual(["2026-11-29", "2026-12-29", "2027-01-28"]);
    expect(ps.map((p) => p.dias_entre_parcelas)).toEqual([45, 30, 30]);
  });

  it("remover renumera e a seguinte passa a contar da anterior", () => {
    const ps = removerParcela(tres(), 1, base);
    expect(ps.map((p) => p.sequencia)).toEqual([1, 2]);
    expect(ps[1].dias_entre_parcelas).toBe(60);
  });

  it("adicionar põe 30 dias depois da última com o valor que falta", () => {
    const ps = adicionarParcela(
      [{ sequencia: 1, dias_entre_parcelas: 0, valor_parcela: 600, data_vencimento: base }],
      base,
      1000,
    );
    expect(ps[1]).toEqual({ sequencia: 2, dias_entre_parcelas: 30, valor_parcela: 400, data_vencimento: "2026-11-14" });
  });

  it("recalcularDias com outra base mantém os vencimentos", () => {
    const ps = recalcularDias(tres(), "2026-10-20");
    expect(ps.map((p) => p.data_vencimento)).toEqual(["2026-11-14", "2026-12-14", "2027-01-13"]);
    expect(ps[0].dias_entre_parcelas).toBe(25);
  });
});

describe("validarParcelas", () => {
  const p = (seq: number, venc: string, valor: number): ParcelaProjeto => ({
    sequencia: seq,
    dias_entre_parcelas: 0,
    valor_parcela: valor,
    data_vencimento: venc,
  });

  it("aceita parcelas que fecham o total", () => {
    expect(validarParcelas([p(1, "2026-11-01", 0.1), p(2, "2026-12-01", 0.2)], 0.3)).toBeNull();
  });
  it("recusa soma diferente do pedido", () => {
    expect(validarParcelas([p(1, "2026-11-01", 100)], 120)).toMatch(/soma das parcelas/);
  });
  it("recusa parcela sem valor", () => {
    expect(validarParcelas([p(1, "2026-11-01", 0)], 0)).toMatch(/sem valor/);
  });
  it("recusa vencimentos fora de ordem (o caso das 5 parcelas no mesmo dia passa; invertido não)", () => {
    expect(validarParcelas([p(1, "2026-12-01", 50), p(2, "2026-11-01", 50)], 100)).toMatch(/vence antes/);
  });
  it("no envio, recusa parcela já vencida", () => {
    expect(validarParcelas([p(1, "2026-10-01", 100)], 100, { hoje: "2026-10-15" })).toMatch(/antes de hoje/);
  });
});

describe("datasParaAlvo", () => {
  it("pedido anterior ao L11 (sem entrega) sai como antes: tudo hoje, base Data do Pedido", () => {
    expect(datasParaAlvo({}, "2026-10-15")).toEqual({
      DataEntrega: "2026-10-15T00:00:00",
      DataValidade: "2026-10-15T00:00:00",
      DataBaseVencimento: "2026-10-15T00:00:00",
      DataBaseVencimentoParcela: "Data do Pedido",
      dataBase: "2026-10-15",
    });
  });
  it("com entrega e base na entrega: validade = entrega + 30", () => {
    const d = datasParaAlvo({ data_entrega: "2026-11-14", data_base_parcelas: "Data da Entrega" }, "2026-10-15");
    expect(d.DataEntrega).toBe("2026-11-14T00:00:00");
    expect(d.DataValidade).toBe("2026-12-14T00:00:00");
    expect(d.DataBaseVencimentoParcela).toBe("Data da Entrega");
    expect(d.dataBase).toBe("2026-11-14");
  });
  it("com entrega e base no pedido: prazos contam de hoje", () => {
    const d = datasParaAlvo({ data_entrega: "2026-11-14", data_base_parcelas: "Data do Pedido" }, "2026-10-15");
    expect(d.dataBase).toBe("2026-10-15");
    expect(d.DataEntrega).toBe("2026-11-14T00:00:00");
  });
});

describe("envio ao Alvo (L11)", () => {
  const req = {
    sequencia: 95,
    descricao: "Teste",
    fornecedor_codigo: "0000298",
    cond_pagamento_codigo: "0000046",
    cond_pagamento_nome: "30/60/90 DIAS - BOLETO",
    valor_total: 900,
    itens: [{ codigoProduto: "002.005", quantidade: 1, valor_unitario: 900, codigoTipoProdFisc: "09" }],
    classe_rateio: [
      { classe_codigo: "14.09", centro_custo_codigo: "00007.00003.00001", percentual: 100 },
    ],
    data_entrega: "2026-11-14",
    data_base_parcelas: "Data do Pedido",
    parcelas: null,
    parcelas_manuais: false,
  };
  const datas = datasParaAlvo(req, "2026-10-15");

  it("automáticas são recalculadas no envio pela condição", async () => {
    const ps = await resolverParcelasParaEnvio(req, {}, datas, linhas([30, 60, 90], [3, 3, 3]));
    expect(ps.map((p) => p.data_vencimento)).toEqual(["2026-11-14", "2026-12-14", "2027-01-13"]);
  });

  it("editadas vão como gravadas, com os dias refeitos contra a data do envio", async () => {
    const gravadas = [
      { sequencia: 1, dias_entre_parcelas: 30, valor_parcela: 400, data_vencimento: "2026-11-20" },
      { sequencia: 2, dias_entre_parcelas: 30, valor_parcela: 500, data_vencimento: "2026-12-20" },
    ];
    const ps = await resolverParcelasParaEnvio({ ...req, parcelas: gravadas, parcelas_manuais: true }, {}, datas, []);
    expect(ps.map((p) => p.valor_parcela)).toEqual([400, 500]);
    expect(ps.map((p) => p.data_vencimento)).toEqual(["2026-11-20", "2026-12-20"]);
    expect(ps.map((p) => p.dias_entre_parcelas)).toEqual([36, 30]);
  });

  it("payload: parcelas no formato de sempre, datas do pedido e SEM comando de aprovação", () => {
    const ps = calcularParcelasProjeto(linhas([30, 60, 90], [3, 3, 3]), 900, datas.dataBase);
    const payload = buildPayload(req, {}, "Evento SBC", "ANA.SANCHES", ps, datas);
    expect(payload.ParcPagPedCompChildList).toEqual(parcelasParaAlvo(ps, 900));
    expect(payload.ParcPagPedCompChildList[0]).toMatchObject({
      Sequencia: 1,
      NumeroDuplicata: "1/3",
      DiasEntreParcelas: 30,
      ValorParcela: 300,
      DataVencimento: "2026-11-14T00:00:00",
    });
    expect(payload.DataEntrega).toBe("2026-11-14T00:00:00");
    expect(payload.DataValidade).toBe("2026-12-14T00:00:00");
    expect(payload.DataBaseVencimentoParcela).toBe("Data do Pedido");
    // §13: nada de UserEnviarAprovacao no insert
    expect(payload.PedCompUserFieldsObject).toEqual({});
  });
});

import { situacaoPagamento } from "@/components/projetos/projetosFormat";

describe("situacaoPagamento — regra de prova do Rastreio", () => {
  it("só é 'Pago' com baixa e movimento bancário; baixa sem movimento não é pagamento comprovado", () => {
    expect(situacaoPagamento("pago").label).toBe("Pago");
    expect(situacaoPagamento("baixa_sem_mov")).toEqual({ label: "Baixado sem movimento bancário", tom: "atencao" });
    expect(situacaoPagamento("aberto").label).toBe("Em aberto");
    expect(situacaoPagamento("qualquer-coisa").label).toBe("Situação desconhecida");
  });
});
