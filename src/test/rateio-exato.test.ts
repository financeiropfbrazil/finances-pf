import { describe, it, expect } from "vitest";
import {
  UNIDADES_100_POR_CENTO,
  distribuirPorMaiorResto,
  unidadesPorValor,
  unidadesParaPercentual,
  percentualParaUnidades,
  formatarPercentualUnidades,
  formatarCentavosBRL,
  parseValorBRLParaCentavos,
  interpretarListaColada,
  normalizarTextoCC,
  casarCentroDeCusto,
  montarRateioExatoPorValor,
  converterPercentualEmValor,
  agregarRateioExatoDoPedido,
  type CentroCustoRef,
} from "@/lib/rateioExato";

/**
 * Card RATEIO-MASSA — núcleo do rateio por valor.
 * O caso real é a lista que o Pedro mandou em 23/09/2026: R$ 52.350,00 em 19 CCs.
 */

// Texto EXATAMENTE como veio (dois espaços antes do "R$", travessão no "TI –").
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

// Cadastro real (cost_centers ativos, grupo F) medido em 23/09/2026 — recorte com os
// vizinhos que poderiam confundir o casamento (LAB PESQUISA, ESTUDO TRICUS, etc.).
const CADASTRO: CentroCustoRef[] = [
  { erp_code: "00010.00002.00001", name: "ADMINISTRATIVO" },
  { erp_code: "00010.00002.00007.00002", name: "ALMOXARIFADO/EXPEDICAO" },
  { erp_code: "00010.00004.00003", name: "ASSUNTOS CLINICOS" },
  { erp_code: "00010.00004.00001", name: "ASSUNTOS REGULATORIOS" },
  { erp_code: "00010.00002.00007.00001", name: "COMPRAS" },
  { erp_code: "00010.00002.00003", name: "CONTROLADORIA/FINANCEIRO" },
  { erp_code: "00010.00003.00002", name: "CONTROLE DA QUALIDADE" },
  { erp_code: "00007.00001.00003", name: "CORELAB" },
  { erp_code: "00008.00001.00003", name: "DESIGN E DESENVOLVIMENTO" },
  { erp_code: "00010.00001.00001", name: "DIRETORIA DE P&D" },
  { erp_code: "00010.00001.00003", name: "DIRETORIA DE QUALIDADE" },
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
  { erp_code: "00007.00004.00023", name: "MKT – AMMED" },
  { erp_code: "00009.00001.00001", name: "PRODUCAO" },
  { erp_code: "00008.00001.00001", name: "PROTOTIPAGEM" },
  { erp_code: "00010.00002.00002", name: "RECURSOS HUMANOS" },
  { erp_code: "00010.00002.00008", name: "TI - TECNOLOGIA DA INFORMACAO" },
];

describe("distribuirPorMaiorResto", () => {
  it("fecha a soma exata e dá a sobra para a maior fração (empate: ordem original)", () => {
    expect(distribuirPorMaiorResto([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(distribuirPorMaiorResto([1, 2], 10)).toEqual([3, 7]);
  });

  it("peso zero recebe zero", () => {
    expect(distribuirPorMaiorResto([0, 5, 5], 7)).toEqual([0, 4, 3]);
  });

  it("recusa ratear total sobre pesos todos zero", () => {
    expect(() => distribuirPorMaiorResto([0, 0], 10)).toThrow(/valem zero/);
  });

  it("recusa peso negativo ou quebrado", () => {
    expect(() => distribuirPorMaiorResto([1, -1], 10)).toThrow();
    expect(() => distribuirPorMaiorResto([1.5, 1], 10)).toThrow();
  });

  it("aguenta valores altos sem perder precisão (BigInt)", () => {
    // R$ 900 milhões em centavos × 1.000.000 passa longe do limite do `number`.
    const r = distribuirPorMaiorResto([90_000_000_000, 1], UNIDADES_100_POR_CENTO);
    expect(r[0] + r[1]).toBe(UNIDADES_100_POR_CENTO);
    expect(r).toEqual([1_000_000, 0]);
  });

  it("propriedade: 5.000 casos aleatórios — soma exata e cada parte no piso ou no teto", () => {
    let semente = 20260923;
    const aleatorio = (max: number) => {
      semente = (semente * 1103515245 + 12345) % 2147483648;
      return semente % max;
    };
    for (let caso = 0; caso < 5000; caso++) {
      const n = 1 + aleatorio(40);
      const pesos: number[] = Array.from({ length: n }, () => (aleatorio(5) === 0 ? 0 : 1 + aleatorio(10_000_000)));
      if (!pesos.some((p) => p > 0)) pesos[0] = 1;
      const total = aleatorio(3) === 0 ? UNIDADES_100_POR_CENTO : 1 + aleatorio(100_000_000);
      const partes = distribuirPorMaiorResto(pesos, total);

      expect(partes.reduce((s, p) => s + p, 0)).toBe(total);
      const P = pesos.reduce((s, p) => s + BigInt(p), BigInt(0));
      partes.forEach((parte, i) => {
        const exato = BigInt(pesos[i]) * BigInt(total); // cota exata × P
        const diff = BigInt(parte) * P - exato;
        expect(diff > -P && diff < P).toBe(true); // |parte − cota| < 1
        if (pesos[i] === 0) expect(parte).toBe(0);
      });
    }
  });
});

describe("conversões e formatação", () => {
  it("unidades ⇄ percentual", () => {
    expect(unidadesParaPercentual(42980)).toBe(4.298);
    expect(JSON.stringify({ Percentual: unidadesParaPercentual(42980) })).toBe('{"Percentual":4.298}');
    expect(percentualParaUnidades(33.33)).toBe(333300);
    expect(percentualParaUnidades(14.29)).toBe(142900);
    expect(() => percentualParaUnidades(3.929589)).toThrow(/4 casas/);
  });

  it("formata sem float", () => {
    expect(formatarPercentualUnidades(42980)).toBe("4,2980%");
    expect(formatarPercentualUnidades(1_000_000)).toBe("100,0000%");
    expect(formatarPercentualUnidades(3275)).toBe("0,3275%");
    expect(formatarCentavosBRL(5_235_000)).toBe("R$ 52.350,00");
    expect(formatarCentavosBRL(17143)).toBe("R$ 171,43");
  });
});

describe("parseValorBRLParaCentavos", () => {
  const ok = (t: string) => {
    const r = parseValorBRLParaCentavos(t);
    if (!r.ok) throw new Error(`esperava ok para "${t}": ${r.erro}`);
    return r.valor;
  };
  const erro = (t: string) => {
    const r = parseValorBRLParaCentavos(t);
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.erro;
  };

  it("formatos brasileiros", () => {
    expect(ok("R$ 2.250,00")).toBe(225000);
    expect(ok("2.057,14")).toBe(205714);
    expect(ok("2057,14")).toBe(205714);
    expect(ok("R$ 17.100,00")).toBe(1710000);
    expect(ok("17.100")).toBe(1710000);
    expect(ok("17100")).toBe(1710000);
    expect(ok("171,43")).toBe(17143);
    expect(ok("0,5")).toBe(50);
    expect(ok("1.234.567,89")).toBe(123456789);
    expect(ok("R$\u00a0900,00")).toBe(90000);
  });

  it("formatos do Excel em inglês", () => {
    expect(ok("2057.14")).toBe(205714);
    expect(ok("1,234,567.89")).toBe(123456789);
    expect(ok("17.1")).toBe(1710);
  });

  it("recusa em vez de adivinhar", () => {
    expect(erro("2057,142857")).toMatch(/2 casas/);
    expect(erro("1,234")).toMatch(/ambíguo/);
    expect(erro("-10,00")).toMatch(/negativo/);
    expect(erro("(10,00)")).toMatch(/negativo/);
    expect(erro("abc")).toMatch(/Não é um valor/);
    expect(erro("0.500")).toMatch(/fora do lugar/);
    expect(erro("")).toMatch(/vazio/);
  });
});

describe("interpretarListaColada", () => {
  it("lê a lista do Pedro: 19 linhas, R$ 52.350,00", () => {
    const r = interpretarListaColada(LISTA_DO_PEDRO);
    expect(r.erros).toEqual([]);
    expect(r.ignoradas).toEqual([]);
    expect(r.linhas).toHaveLength(19);
    expect(r.linhas.reduce((s, l) => s + l.centavos, 0)).toBe(5_235_000);
    expect(r.linhas[0]).toMatchObject({ nome: "Almoxarifado/Expedição", centavos: 225000, codigo: null });
    expect(r.linhas[17]).toMatchObject({ nome: "TI – Tecnologia da Informação", centavos: 90000 });
  });

  it("lê colagem do Excel (TAB), com cabeçalho, total, linha vazia, zero e coluna de %", () => {
    const texto = [
      "Centro de custo\tValor\t%",
      "Produção\tR$ 17.100,00\t32,66%",
      "",
      "00010.00002.00008\tTI – Tecnologia da Informação\t900",
      "Compras\t0,00",
      "Total\t18.000,00",
    ].join("\r\n");
    const r = interpretarListaColada(texto);
    expect(r.erros).toEqual([]);
    expect(r.linhas).toEqual([
      expect.objectContaining({ linha: 2, nome: "Produção", codigo: null, centavos: 1710000 }),
      expect.objectContaining({ linha: 4, nome: "TI – Tecnologia da Informação", codigo: "00010.00002.00008", centavos: 90000 }),
    ]);
    expect(r.ignoradas.map((i) => i.motivo)).toEqual(["cabecalho", "valor_zero", "total"]);
    expect(r.ignoradas[2].centavos).toBe(1800000);
  });

  it("aponta a linha com valor ilegível em vez de pular", () => {
    const r = interpretarListaColada("Compras  R$ 900,00\nCorelab  2057,142857");
    expect(r.linhas).toHaveLength(1);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0].linha).toBe(2);
    expect(r.erros[0].erro).toMatch(/2 casas/);
  });

  it("aceita ponto e vírgula (CSV)", () => {
    const r = interpretarListaColada("Compras;900,00\nCorelab;2.057,14");
    expect(r.linhas.map((l) => l.centavos)).toEqual([90000, 205714]);
  });
});

describe("casarCentroDeCusto", () => {
  it("normaliza acento, caixa, travessão e barra", () => {
    expect(normalizarTextoCC("TI – Tecnologia da Informação")).toBe(normalizarTextoCC("TI - TECNOLOGIA DA INFORMACAO"));
    expect(normalizarTextoCC("Almoxarifado/Expedição")).toBe(normalizarTextoCC("ALMOXARIFADO/EXPEDICAO"));
    expect(normalizarTextoCC("MKT - AMMED")).toBe(normalizarTextoCC("MKT – AMMED"));
    expect(normalizarTextoCC("Produção:")).toBe("PRODUCAO");
  });

  it("na lista do Pedro, 17 casam sozinhos e 2 pedem escolha", () => {
    const r = interpretarListaColada(LISTA_DO_PEDRO);
    const casamentos = r.linhas.map((l) => ({ nome: l.nome, c: casarCentroDeCusto(l, CADASTRO) }));

    const exatos = casamentos.filter((x) => x.c.tipo === "exato");
    expect(exatos).toHaveLength(17);

    const pendentes = casamentos.filter((x) => x.c.tipo !== "exato");
    expect(pendentes.map((x) => x.nome)).toEqual(["Clínico", "Regulatórios"]);

    const clinico = pendentes[0].c;
    expect(clinico.tipo).toBe("ambiguo");
    if (clinico.tipo === "ambiguo") {
      expect(clinico.sugestoes.map((s) => s.name)).toEqual([
        "ASSUNTOS CLINICOS",
        "EDUCACAO CLINICA",
        "ESPECIALISTAS CLINICOS",
      ]);
    }
    const regulatorios = pendentes[1].c;
    if (regulatorios.tipo === "ambiguo") {
      expect(regulatorios.sugestoes[0].name).toBe("ASSUNTOS REGULATORIOS");
      expect(regulatorios.sugestoes.map((s) => s.name)).toContain("ESTUDO TRICUS - REGULATORIO");
    } else {
      throw new Error("Regulatórios deveria ser ambíguo");
    }
  });

  it("nunca troca Laboratório por LAB PESQUISA", () => {
    const c = casarCentroDeCusto({ nome: "Laboratório", codigo: null }, CADASTRO);
    expect(c).toEqual({ tipo: "exato", por: "nome", cc: { erp_code: "00008.00001.00002", name: "LABORATORIO" } });
  });

  it("código na linha vence o nome", () => {
    const c = casarCentroDeCusto({ nome: "qualquer coisa", codigo: "00010.00002.00008" }, CADASTRO);
    expect(c.tipo === "exato" && c.cc.name).toBe("TI - TECNOLOGIA DA INFORMACAO");
  });

  it("nome sem nenhum parentesco não inventa sugestão", () => {
    expect(casarCentroDeCusto({ nome: "Zebra", codigo: null }, CADASTRO)).toEqual({
      tipo: "nao_encontrado",
      sugestoes: [],
    });
  });
});

describe("montarRateioExatoPorValor — o caso real", () => {
  const linhas = interpretarListaColada(LISTA_DO_PEDRO).linhas;
  const rateio = montarRateioExatoPorValor([
    {
      codigo_classe_rec_desp: "99.99",
      ccs: linhas.map((l, i) => ({ codigo_centro_ctrl: `CC${String(i).padStart(2, "0")}`, centavos: l.centavos })),
    },
  ]);
  const ccs = rateio.classes[0].ccs;

  it("valores fecham R$ 52.350,00 e percentuais fecham 100,0000% — exatos", () => {
    expect(rateio.totalCentavos).toBe(5_235_000);
    expect(ccs.reduce((s, c) => s + c.centavos, 0)).toBe(5_235_000);
    expect(ccs.reduce((s, c) => s + c.unidades, 0)).toBe(UNIDADES_100_POR_CENTO);
    expect(rateio.classes[0].unidades).toBe(UNIDADES_100_POR_CENTO);
  });

  it("cada percentual fica a menos de 0,0001 p.p. do exato", () => {
    ccs.forEach((c) => {
      const exatoVezesTotal = BigInt(c.centavos) * BigInt(UNIDADES_100_POR_CENTO);
      const diff = BigInt(c.unidades) * BigInt(rateio.totalCentavos) - exatoVezesTotal;
      expect(diff > -BigInt(rateio.totalCentavos) && diff < BigInt(rateio.totalCentavos)).toBe(true);
    });
  });

  it("percentuais esperados (arredondamento independente daria 100,0002%)", () => {
    expect(ccs.map((c) => formatarPercentualUnidades(c.unidades))).toEqual([
      "4,2980%", "3,4384%", "1,7192%", "3,4384%", "8,5960%", "3,9296%", "14,6132%",
      "0,8596%", "3,4384%", "3,4384%", "1,7192%", "1,7192%", "1,7192%", "32,6647%",
      "6,8768%", "2,9062%", "2,5788%", "1,7192%", "0,3275%",
    ]);
  });

  it("o valor é o que foi digitado, não o recalculado do percentual", () => {
    // Corelab: 3,9296% de 52.350 daria 2.057,15 — o valor enviado continua 2.057,14.
    expect(ccs[5].centavos).toBe(205714);
    expect(ccs[5].unidades).toBe(39296);
  });
});

describe("montarRateioExatoPorValor — estrutura", () => {
  it("duas classes: classe relativa ao total, CC relativo à classe (dízima de 1/7)", () => {
    const r = montarRateioExatoPorValor([
      {
        codigo_classe_rec_desp: "15.01",
        ccs: [
          { codigo_centro_ctrl: "A", centavos: 1000 },
          { codigo_centro_ctrl: "B", centavos: 2000 },
        ],
      },
      { codigo_classe_rec_desp: "15.02", ccs: [{ codigo_centro_ctrl: "C", centavos: 4000 }] },
    ]);
    expect(r.totalCentavos).toBe(7000);
    expect(r.classes.map((c) => c.unidades)).toEqual([428571, 571429]); // 42,8571% + 57,1429%
    expect(r.classes[0].ccs.map((c) => c.unidades)).toEqual([333333, 666667]);
    expect(r.classes[1].ccs[0].unidades).toBe(1_000_000);
  });

  it("CC repetido na mesma classe é somado em centavos e relatado (UNIQUE do Alvo, D4)", () => {
    const r = montarRateioExatoPorValor([
      {
        codigo_classe_rec_desp: "18.05",
        ccs: [
          { codigo_centro_ctrl: "X", centavos: 59999 },
          { codigo_centro_ctrl: "X", centavos: 59999 },
        ],
      },
    ]);
    expect(r.classes[0].ccs).toEqual([
      expect.objectContaining({ codigo_centro_ctrl: "X", centavos: 119998, unidades: 1_000_000, linhasOriginais: 2 }),
    ]);
    expect(r.consolidacoes).toEqual([{ codigo_classe_rec_desp: "18.05", codigo_centro_ctrl: "X", linhas: 2 }]);
  });

  it("recusa CC com valor zero e valor pequeno demais para 4 casas", () => {
    expect(() =>
      montarRateioExatoPorValor([{ codigo_classe_rec_desp: "1", ccs: [{ codigo_centro_ctrl: "A", centavos: 0 }, { codigo_centro_ctrl: "B", centavos: 10 }] }]),
    ).toThrow(/valor zero/);
    // R$ 0,01 em R$ 1.000.000,00 = 0,000001% → não cabe em 4 casas.
    expect(() =>
      montarRateioExatoPorValor([
        { codigo_classe_rec_desp: "1", ccs: [{ codigo_centro_ctrl: "A", centavos: 1 }, { codigo_centro_ctrl: "B", centavos: 99_999_999 }] },
      ]),
    ).toThrow(/pequeno demais/);
  });
});

describe("converterPercentualEmValor", () => {
  it("33,33/33,33/33,34 de R$ 19.415,04 fecha no centavo (o 0004919 saiu com 19.415,03)", () => {
    const [cls] = converterPercentualEmValor(
      [
        {
          codigo_classe_rec_desp: "24.05",
          percentual: 100,
          ccs: [
            { codigo_centro_ctrl: "00007.00001.00003", percentual: 33.34 },
            { codigo_centro_ctrl: "00008.00001.00003", percentual: 33.33 },
            { codigo_centro_ctrl: "00010.00003.00002", percentual: 33.33 },
          ],
        },
      ],
      1941504,
    );
    expect(cls.ccs.map((c) => c.centavos)).toEqual([647298, 647103, 647103]);
    expect(cls.ccs.reduce((s, c) => s + c.centavos, 0)).toBe(1941504);
  });
});

describe("agregarRateioExatoDoPedido", () => {
  it("cabeçalho = soma exata dos itens, sem ajuste residual", () => {
    const item1 = montarRateioExatoPorValor([
      { codigo_classe_rec_desp: "15.02", ccs: [{ codigo_centro_ctrl: "A", centavos: 33333 }, { codigo_centro_ctrl: "B", centavos: 66667 }] },
    ]);
    const item2 = montarRateioExatoPorValor([
      { codigo_classe_rec_desp: "15.02", ccs: [{ codigo_centro_ctrl: "B", centavos: 1 }] },
      { codigo_classe_rec_desp: "15.01", ccs: [{ codigo_centro_ctrl: "C", centavos: 50000 }] },
    ]);
    const cab = agregarRateioExatoDoPedido([item1, item2]);

    expect(cab.totalCentavos).toBe(150001);
    expect(cab.classes.map((c) => [c.codigo_classe_rec_desp, c.centavos])).toEqual([
      ["15.02", 100001],
      ["15.01", 50000],
    ]);
    expect(cab.classes[0].ccs.map((c) => [c.codigo_centro_ctrl, c.centavos])).toEqual([
      ["A", 33333],
      ["B", 66668],
    ]);
    expect(cab.classes.reduce((s, c) => s + c.unidades, 0)).toBe(UNIDADES_100_POR_CENTO);
    cab.classes.forEach((c) => expect(c.ccs.reduce((s, x) => s + x.unidades, 0)).toBe(UNIDADES_100_POR_CENTO));
    expect(cab.consolidacoes).toEqual([]);
  });
});

describe("unidadesPorValor", () => {
  it("soma sempre 1.000.000", () => {
    expect(unidadesPorValor([1, 1, 1]).reduce((s, u) => s + u, 0)).toBe(UNIDADES_100_POR_CENTO);
    expect(unidadesPorValor([8000, 8000, 8000])).toEqual([333334, 333333, 333333]); // 0004371: 80/80/80
  });
});
