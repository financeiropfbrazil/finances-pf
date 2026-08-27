import { describe, it, expect, vi } from "vitest";

// O módulo importa o client do Supabase no topo. O teste é puro (só aritmética
// de rateio), então o client é mockado para o import não depender de env/rede.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { consolidarRateioDoItem, type RateioClasseInput } from "@/services/pedidosService";

/**
 * Card D4 — o Alvo tem UNIQUE em (filial, número, produto, sequência, classe, CC).
 * Duas linhas com o mesmo CC na mesma classe derrubam o save com
 * `Friendly_Message_UQ_PK`, e cada tentativa queima um número do sequencer.
 * Evidência completa: docs/D4-EVIDENCIA-UQ-PK.md.
 */
describe("consolidarRateioDoItem (D4)", () => {
  // ── O caso real: pedido 0004781 (KABUM, R$ 1.199,98) ────────────────────
  // 6 tentativas queimaram os números 0004770–0004775 em 6 minutos.
  // O payload tinha, dentro da classe 18.05, DUAS linhas de rateio com o mesmo
  // centro de custo 00010.00004.00003, a 50% / R$ 599,99 cada.
  describe("reproduz o 0004781", () => {
    const VALOR_ITEM = 1199.98; // 2 × 599,99
    const rateio: RateioClasseInput[] = [
      {
        codigo_classe_rec_desp: "18.05",
        classe_rec_desp_label: "18.05",
        percentual: 100,
        ccs: [
          { codigo_centro_ctrl: "00010.00004.00003", centro_ctrl_label: "CC", percentual: 50 },
          { codigo_centro_ctrl: "00010.00004.00003", centro_ctrl_label: "CC", percentual: 50 },
        ],
      },
    ];

    it("colapsa as duas linhas do mesmo CC em UMA, a 100%", () => {
      const { classes } = consolidarRateioDoItem(rateio, VALOR_ITEM);

      expect(classes).toHaveLength(1);
      const linhas = classes[0].RateioItemPedCompChildList;

      // Antes do D4 saíam DUAS linhas aqui — era exatamente o que o Alvo recusava.
      expect(linhas).toHaveLength(1);
      expect(linhas[0].CodigoCentroCtrl).toBe("00010.00004.00003");
      expect(linhas[0].Percentual).toBe(100);
      expect(linhas[0].Valor).toBe(1199.98);
    });

    it("preserva o valor e o percentual da classe", () => {
      const { classes } = consolidarRateioDoItem(rateio, VALOR_ITEM);
      expect(classes[0].CodigoClasseRecDesp).toBe("18.05");
      expect(classes[0].Valor).toBe(1199.98);
      expect(classes[0].Percentual).toBe(100);
    });

    it("relata a consolidação para a UI poder avisar", () => {
      const { consolidacoes } = consolidarRateioDoItem(rateio, VALOR_ITEM);
      expect(consolidacoes).toEqual([
        {
          codigo_classe_rec_desp: "18.05",
          codigo_centro_ctrl: "00010.00004.00003",
          linhas_originais: 2,
        },
      ]);
    });

    it("não gera nenhuma tupla (classe, CC) repetida — a invariante do UNIQUE", () => {
      const { classes } = consolidarRateioDoItem(rateio, VALOR_ITEM);
      const tuplas = classes.flatMap((c) =>
        c.RateioItemPedCompChildList.map((l) => `${c.CodigoClasseRecDesp}|${l.CodigoCentroCtrl}`),
      );
      expect(new Set(tuplas).size).toBe(tuplas.length);
    });
  });

  // ── O caminho feliz não pode mudar (133 dos 134 pedidos históricos) ──────
  describe("sem repetição, a saída é idêntica à de antes", () => {
    const rateio: RateioClasseInput[] = [
      {
        codigo_classe_rec_desp: "18.05",
        classe_rec_desp_label: "18.05",
        percentual: 100,
        ccs: [
          { codigo_centro_ctrl: "00010.00004.00003", centro_ctrl_label: "A", percentual: 60 },
          { codigo_centro_ctrl: "00010.00004.00004", centro_ctrl_label: "B", percentual: 40 },
        ],
      },
    ];

    it("mantém as duas linhas, com os mesmos valores e percentuais", () => {
      const { classes, consolidacoes } = consolidarRateioDoItem(rateio, 1000);
      const linhas = classes[0].RateioItemPedCompChildList;

      expect(consolidacoes).toEqual([]);
      expect(linhas).toHaveLength(2);
      expect(linhas[0]).toMatchObject({ CodigoCentroCtrl: "00010.00004.00003", Valor: 600, Percentual: 60 });
      expect(linhas[1]).toMatchObject({ CodigoCentroCtrl: "00010.00004.00004", Valor: 400, Percentual: 40 });
    });

    it("preserva a ordem original das classes e dos CCs", () => {
      const doisItens: RateioClasseInput[] = [
        { ...rateio[0], codigo_classe_rec_desp: "99.01" },
        { ...rateio[0], codigo_classe_rec_desp: "11.02" },
      ];
      const { classes } = consolidarRateioDoItem(doisItens, 1000);
      expect(classes.map((c) => c.CodigoClasseRecDesp)).toEqual(["99.01", "11.02"]);
    });
  });

  // ── Classe repetida: mesmo defeito, o UNIQUE também inclui a classe ──────
  describe("classe repetida dentro do item", () => {
    const rateio: RateioClasseInput[] = [
      {
        codigo_classe_rec_desp: "18.05",
        classe_rec_desp_label: "18.05",
        percentual: 50,
        ccs: [{ codigo_centro_ctrl: "00010.00004.00003", centro_ctrl_label: "A", percentual: 100 }],
      },
      {
        codigo_classe_rec_desp: "18.05",
        classe_rec_desp_label: "18.05",
        percentual: 50,
        ccs: [{ codigo_centro_ctrl: "00010.00004.00003", centro_ctrl_label: "A", percentual: 100 }],
      },
    ];

    it("funde as duas entradas em uma classe só, somando valor e percentual", () => {
      const { classes } = consolidarRateioDoItem(rateio, 1000);
      expect(classes).toHaveLength(1);
      expect(classes[0].Valor).toBe(1000);
      expect(classes[0].Percentual).toBe(100);
    });

    it("o CC repetido entre as entradas vira uma linha a 100% da classe", () => {
      const { classes } = consolidarRateioDoItem(rateio, 1000);
      const linhas = classes[0].RateioItemPedCompChildList;
      expect(linhas).toHaveLength(1);
      expect(linhas[0].Valor).toBe(1000);
      // Ponderado: 100% de metade + 100% da outra metade = 100% do consolidado
      // (soma pura daria 200 e mentiria sobre a fatia).
      expect(linhas[0].Percentual).toBe(100);
    });
  });

  // ── Invariantes que o Alvo valida ───────────────────────────────────────
  describe("invariantes", () => {
    // 🔴 A invariante que importa para o D4 não é "as linhas fecham com a
    // classe" — o caminho do ITEM nunca teve ajuste residual, e com percentuais
    // quebrados sobra centavo desde antes deste card (quem tem ajuste residual é
    // o caminho do CABEÇALHO, que é onde o Alvo valida a soma). A invariante do
    // D4 é: consolidar NÃO PODE mudar o total. Só colapsa linhas.
    it("consolidar não altera o valor total das linhas (resíduo pré-existente incluso)", () => {
      const ccsRepetido = [
        { codigo_centro_ctrl: "CC1", centro_ctrl_label: "A", percentual: 33.33 },
        { codigo_centro_ctrl: "CC1", centro_ctrl_label: "A", percentual: 33.33 },
        { codigo_centro_ctrl: "CC2", centro_ctrl_label: "B", percentual: 33.34 },
      ];
      const comRepeticao: RateioClasseInput[] = [
        { codigo_classe_rec_desp: "18.05", classe_rec_desp_label: "18.05", percentual: 100, ccs: ccsRepetido },
      ];
      // Mesmo input, mas com os CCs já distintos: é o que o código produzia antes.
      const semRepeticao: RateioClasseInput[] = [
        {
          codigo_classe_rec_desp: "18.05",
          classe_rec_desp_label: "18.05",
          percentual: 100,
          ccs: ccsRepetido.map((cc, i) => ({ ...cc, codigo_centro_ctrl: `CC${i}` })),
        },
      ];

      const linhasDe = (r: RateioClasseInput[]) =>
        consolidarRateioDoItem(r, 1199.98).classes[0].RateioItemPedCompChildList;
      const somaDe = (r: RateioClasseInput[]) =>
        Math.round(linhasDe(r).reduce((s, l) => s + l.Valor, 0) * 100) / 100;

      expect(somaDe(comRepeticao)).toBe(somaDe(semRepeticao));
      // 3 linhas viram 2, e o dinheiro é exatamente o mesmo.
      expect(linhasDe(comRepeticao)).toHaveLength(2);
      expect(linhasDe(semRepeticao)).toHaveLength(3);
    });

    it("NÃO mexe na Sequencia — o Alvo a atribui no save", () => {
      const rateio: RateioClasseInput[] = [
        {
          codigo_classe_rec_desp: "18.05",
          classe_rec_desp_label: "18.05",
          percentual: 100,
          ccs: [
            { codigo_centro_ctrl: "CC1", centro_ctrl_label: "A", percentual: 50 },
            { codigo_centro_ctrl: "CC1", centro_ctrl_label: "A", percentual: 50 },
          ],
        },
      ];
      const { classes } = consolidarRateioDoItem(rateio, 1000);
      expect(classes[0].SequenciaItemPedComp).toBe(0);
      expect(classes[0].RateioItemPedCompChildList[0].SequenciaItemPedComp).toBe(0);
    });

    it("rateio vazio não quebra", () => {
      expect(consolidarRateioDoItem([], 1000)).toEqual({ classes: [], consolidacoes: [] });
    });
  });
});
