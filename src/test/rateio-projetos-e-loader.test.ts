import { describe, it, expect, vi } from "vitest";

// Os dois módulos importam o client do Supabase no topo. Os testes são puros
// (validação e aritmética), então o client é mockado para o import não depender
// de env nem de rede.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { validarLinhasRateio, consolidarRateioProjeto } from "@/services/alvoProjetoPedidoService";
import { montarRateioDoItem, type LinhaRateioBanco } from "@/services/pedidosService";

// =====================================================================
// METADE A — validação das linhas de rateio do módulo Projetos
// =====================================================================
//
// O Alvo tem UNIQUE em (filial, número, produto, sequência, classe, CC). Antes
// desta validação, as três camadas do módulo checavam SÓ a soma dar 100%, e duas
// linhas em branco a 0% passavam — saindo no payload como tupla ('', '') repetida.
describe("validarLinhasRateio (Projetos)", () => {
  const linha = (classe: string, cc: string, percentual = 50) => ({
    classe_codigo: classe,
    centro_custo_codigo: cc,
    percentual,
  });

  describe("o caminho ativo que motivou o card", () => {
    it("rejeita as DUAS linhas em branco a 0% que a soma deixava passar", () => {
      // Rateio já em 100% + dois cliques em "Adicionar Classe".
      const rateio = [linha("18.05", "00010.00004.00003", 100), linha("", "", 0), linha("", "", 0)];
      // A soma continua 100 — era exatamente por isso que passava.
      expect(rateio.reduce((s, r) => s + r.percentual, 0)).toBe(100);

      const problema = validarLinhasRateio(rateio);
      expect(problema).toBeTruthy();
      expect(problema).toContain("Linha 2");
      expect(problema).toContain("em branco");
    });

    it("a mensagem diz QUAL linha e QUAL problema, não só que o rateio é inválido", () => {
      const problema = validarLinhasRateio([linha("18.05", "CC1", 50), linha("11.01", "", 50)]);
      expect(problema).toContain("Linha 2");
      expect(problema).toContain("centro de custo não preenchido");
      // E nomeia a classe, para a pessoa achar a linha na tela.
      expect(problema).toContain("11.01");
    });

    it("classe vazia com CC preenchido também é nomeada", () => {
      const problema = validarLinhasRateio([linha("", "CC1", 100)]);
      expect(problema).toContain("Linha 1");
      expect(problema).toContain("classe não preenchida");
    });
  });

  describe("unicidade (classe, CC)", () => {
    it("rejeita o par repetido e aponta AS DUAS linhas", () => {
      const problema = validarLinhasRateio([
        linha("18.05", "CC1", 30),
        linha("11.01", "CC2", 40),
        linha("18.05", "CC1", 30),
      ]);
      expect(problema).toContain("Linhas 1 e 3");
      expect(problema).toContain("18.05");
      expect(problema).toContain("CC1");
    });

    it("mesma classe com CCs diferentes é válida", () => {
      expect(validarLinhasRateio([linha("18.05", "CC1"), linha("18.05", "CC2")])).toBeNull();
    });

    it("mesmo CC em classes diferentes é válido", () => {
      expect(validarLinhasRateio([linha("18.05", "CC1"), linha("11.01", "CC1")])).toBeNull();
    });
  });

  describe("bordas", () => {
    it("rateio válido passa", () => {
      expect(validarLinhasRateio([linha("18.05", "CC1", 60), linha("11.01", "CC2", 40)])).toBeNull();
    });

    it("array vazio não acusa (quem trata é o gate de 'rateio não informado')", () => {
      expect(validarLinhasRateio([])).toBeNull();
    });

    it("espaço em branco conta como vazio", () => {
      expect(validarLinhasRateio([linha("  ", "CC1", 100)])).toContain("classe não preenchida");
    });

    it("null/undefined nos códigos não quebra", () => {
      const problema = validarLinhasRateio([{ percentual: 100 }]);
      expect(problema).toContain("em branco");
    });
  });
});

// =====================================================================
// METADE B — o loader e as DUAS convenções da coluna `percentual`
// =====================================================================
//
// Frontend grava ABSOLUTO (fatia do item, soma 100 por item) com valor null.
// A RPC de sync grava RELATIVO À CLASSE (soma 100 por classe) com valor preenchido.
// O leitor antigo assumia sempre absoluto e inflava item multi-classe em N×100%.
describe("montarRateioDoItem — dupla convenção do percentual", () => {
  const espelho = (classe: string, cc: string, percentual: number, valor: number): LinhaRateioBanco => ({
    codigo_classe_rec_desp: classe,
    classe_rec_desp_label: classe,
    codigo_centro_ctrl: cc,
    centro_ctrl_label: cc,
    percentual,
    valor,
  });
  const cru = (classe: string, cc: string, percentual: number): LinhaRateioBanco => ({
    codigo_classe_rec_desp: classe,
    classe_rec_desp_label: classe,
    codigo_centro_ctrl: cc,
    centro_ctrl_label: cc,
    percentual,
    valor: null,
  });

  describe("reproduz o 0004691 (4 classes, espelho) — o caso do valor fantasma", () => {
    // Item de R$ 47.344,55 dividido em 4 classes de 25% cada. Cada classe soma
    // 100% entre seus CCs, que é a convenção da RPC.
    const VALOR_ITEM = 47344.55;
    const fatia = round(VALOR_ITEM / 4);
    const linhas = [
      espelho("A", "CC1", 100, fatia),
      espelho("B", "CC2", 100, fatia),
      espelho("C", "CC3", 100, fatia),
      espelho("D", "CC4", 100, VALOR_ITEM - fatia * 3),
    ];

    it("cada classe recebe ~25%, não 100%", () => {
      const r = montarRateioDoItem(linhas, VALOR_ITEM);
      expect(r).toHaveLength(4);
      r.forEach((c) => expect(c.percentual).toBeCloseTo(25, 1));
    });

    it("a soma das classes é 100%, não 400% — era o defeito", () => {
      const r = montarRateioDoItem(linhas, VALOR_ITEM);
      const soma = r.reduce((s, c) => s + c.percentual, 0);
      expect(soma).toBeCloseTo(100, 1);
      expect(soma).not.toBeCloseTo(400, 0);
    });

    it("o valor exibido pela tela volta a ser o valor do item", () => {
      // A tela faz: valorTotalItem * cls.percentual / 100, somado nas classes.
      const r = montarRateioDoItem(linhas, VALOR_ITEM);
      const exibido = r.reduce((s, c) => s + (VALOR_ITEM * c.percentual) / 100, 0);
      expect(exibido).toBeCloseTo(VALOR_ITEM, 0);
      // Antes exibia ~4× isso (R$ 189.378,20).
      expect(exibido).toBeLessThan(VALOR_ITEM * 1.01);
    });

    it("o CC dentro da classe continua 100% (a coluna já é relativa no espelho)", () => {
      const r = montarRateioDoItem(linhas, VALOR_ITEM);
      r.forEach((c) => {
        expect(c.ccs).toHaveLength(1);
        expect(c.ccs[0].percentual).toBe(100);
      });
    });
  });

  describe("classe única — as duas convenções coincidem (596 dos 598 itens)", () => {
    it("espelho com 1 classe e 2 CCs dá 100% na classe e 60/40 nos CCs", () => {
      const r = montarRateioDoItem([espelho("A", "CC1", 60, 600), espelho("A", "CC2", 40, 400)], 1000);
      expect(r).toHaveLength(1);
      expect(r[0].percentual).toBeCloseTo(100, 1);
      expect(r[0].ccs.map((c) => c.percentual)).toEqual([60, 40]);
    });
  });

  describe("linhas CRUS do frontend (valor null) — comportamento antigo preservado", () => {
    it("percentual absoluto vira fatia da classe e CC normalizado", () => {
      // Item com 2 classes: A 60% (CC1 100%), B 40% (CC2 50% + CC3 50%).
      const r = montarRateioDoItem([cru("A", "CC1", 60), cru("B", "CC2", 20), cru("B", "CC3", 20)], 1000);
      expect(r).toHaveLength(2);
      expect(r[0].percentual).toBe(60);
      expect(r[0].ccs[0].percentual).toBe(100);
      expect(r[1].percentual).toBe(40);
      expect(r[1].ccs.map((c) => c.percentual)).toEqual([50, 50]);
    });

    it("a soma das classes continua 100%", () => {
      const r = montarRateioDoItem([cru("A", "CC1", 60), cru("B", "CC2", 40)], 1000);
      expect(r.reduce((s, c) => s + c.percentual, 0)).toBeCloseTo(100, 2);
    });
  });

  describe("bordas", () => {
    it("lista vazia devolve []", () => {
      expect(montarRateioDoItem([], 1000)).toEqual([]);
    });

    it("uma linha sem valor faz o conjunto ser tratado como CRU (conservador)", () => {
      // Mistura não deve acontecer (medido: zero itens misturam origens), mas se
      // acontecer o caminho antigo é o comportamento seguro.
      const r = montarRateioDoItem([espelho("A", "CC1", 60, 600), cru("A", "CC2", 40)], 1000);
      expect(r[0].percentual).toBe(100); // soma dos "absolutos" 60+40
    });

    it("valorTotalItem zero não divide por zero", () => {
      const r = montarRateioDoItem([espelho("A", "CC1", 100, 0)], 0);
      expect(Number.isFinite(r[0].percentual)).toBe(true);
    });
  });
});

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// =====================================================================
// METADE C — consolidação de (classe, CC) no módulo Projetos (§7.29)
// =====================================================================
//
// O módulo montava o rateio com `map()` 1:1, a mesma forma que derrubou o 0004781
// do Suprimentos com `Friendly_Message_UQ_PK`. `consolidarRateioProjeto` reusa
// `consolidarRateioDoItem` (a função do D4) e mantém a saída PLANA: colapsa só o
// par (classe, CC) repetido, que é o que o UNIQUE do Alvo proíbe.
describe("consolidarRateioProjeto (Projetos)", () => {
  const l = (classe: string, cc: string, percentual: number) => ({
    classe_codigo: classe,
    centro_custo_codigo: cc,
    percentual,
  });

  describe("sem repetição — o payload NÃO pode mudar", () => {
    it("preserva linha, ordem, percentual e valor de uma linha só", () => {
      const { linhas, consolidacoes } = consolidarRateioProjeto([l("18.05", "CC1", 60)], 1000);
      expect(consolidacoes).toHaveLength(0);
      expect(linhas).toEqual([{ classe_codigo: "18.05", centro_custo_codigo: "CC1", percentual: 60, valor: 600 }]);
    });

    it("classes distintas: o valor de cada linha é o mesmo que o cálculo antigo", () => {
      const rateio = [l("18.05", "CC1", 60), l("11.01", "CC2", 40)];
      const { linhas, consolidacoes } = consolidarRateioProjeto(rateio, 1199.98);
      expect(consolidacoes).toHaveLength(0);
      // Cálculo antigo, linha a linha: Math.round(((total * pct) / 100) * 100) / 100
      const antigo = rateio.map((r) => Math.round(((1199.98 * r.percentual) / 100) * 100) / 100);
      expect(linhas.map((x) => x.valor)).toEqual(antigo);
      expect(linhas.map((x) => x.percentual)).toEqual([60, 40]);
    });

    it("percentual com casas decimais NÃO é rearredondado", () => {
      const { linhas } = consolidarRateioProjeto(
        [l("A", "CC1", 33.333), l("B", "CC2", 33.333), l("C", "CC3", 33.334)],
        1000,
      );
      expect(linhas.map((x) => x.percentual)).toEqual([33.333, 33.333, 33.334]);
      expect(linhas.reduce((s2, x) => s2 + x.percentual, 0)).toBe(100);
    });
  });

  describe("o par (classe, CC) repetido — a forma do 0004781", () => {
    it("duas linhas 50/50 no MESMO CC viram uma linha de 100%", () => {
      const { linhas, consolidacoes } = consolidarRateioProjeto(
        [l("18.05", "00010.00004.00003", 50), l("18.05", "00010.00004.00003", 50)],
        1199.98,
      );
      expect(linhas).toHaveLength(1);
      expect(linhas[0].percentual).toBe(100);
      expect(linhas[0].valor).toBe(1199.98);
      expect(consolidacoes.length).toBeGreaterThan(0);
    });

    it("o valor é SOMADO das linhas, não recalculado do percentual somado", () => {
      // 3 × 33,33% de 100,01 → round2 de cada pedaço soma 33,33+33,33+33,33=99,99;
      // recalcular 99,99% de 100,01 daria 100,00. A regra do D4 é somar.
      const { linhas } = consolidarRateioProjeto(
        [l("A", "CC1", 33.33), l("A", "CC1", 33.33), l("A", "CC1", 33.33)],
        100.01,
      );
      expect(linhas).toHaveLength(1);
      const somaDasPartes = 3 * (Math.round(((100.01 * 33.33) / 100) * 100) / 100);
      expect(linhas[0].valor).toBeCloseTo(somaDasPartes, 2);
    });

    it("a consolidação nomeia a classe e o CC colapsados", () => {
      const { consolidacoes } = consolidarRateioProjeto([l("18.05", "CC1", 50), l("18.05", "CC1", 50)], 1000);
      const doCc = consolidacoes.find((c) => c.codigo_centro_ctrl === "CC1");
      expect(doCc).toBeTruthy();
      expect(doCc!.codigo_classe_rec_desp).toBe("18.05");
      expect(doCc!.linhas_originais).toBe(2);
    });
  });

  describe("escopo estreito — o que NÃO deve ser fundido", () => {
    it("mesma classe com CCs DIFERENTES continua em duas linhas", () => {
      // Não viola o UNIQUE do Alvo (que inclui o CC). Fundir mudaria a convenção
      // do Percentual do CC — decisão fora deste card.
      const { linhas, consolidacoes } = consolidarRateioProjeto([l("A", "CC1", 30), l("A", "CC2", 30)], 1000);
      expect(linhas).toHaveLength(2);
      expect(linhas.map((x) => x.percentual)).toEqual([30, 30]);
      expect(linhas.map((x) => x.valor)).toEqual([300, 300]);
      expect(consolidacoes.filter((c) => c.codigo_centro_ctrl !== null)).toHaveLength(0);
    });

    it("mesmo CC em classes DIFERENTES continua em duas linhas", () => {
      const { linhas } = consolidarRateioProjeto([l("A", "CC1", 50), l("B", "CC1", 50)], 1000);
      expect(linhas).toHaveLength(2);
      expect(linhas.map((x) => x.classe_codigo)).toEqual(["A", "B"]);
    });
  });

  describe("bordas", () => {
    it("rateio vazio devolve vazio", () => {
      expect(consolidarRateioProjeto([], 1000).linhas).toEqual([]);
    });

    it("ordena por classe (primeira aparição) e depois por CC", () => {
      const { linhas } = consolidarRateioProjeto([l("A", "CC1", 25), l("B", "CC2", 50), l("A", "CC3", 25)], 1000);
      expect(linhas.map((x) => `${x.classe_codigo}/${x.centro_custo_codigo}`)).toEqual(["A/CC1", "A/CC3", "B/CC2"]);
    });

    it("percentual/código ausentes não quebram", () => {
      const { linhas } = consolidarRateioProjeto([{ percentual: 100 }], 1000);
      expect(linhas).toHaveLength(1);
      expect(linhas[0].classe_codigo).toBe("");
      expect(linhas[0].centro_custo_codigo).toBe("");
    });
  });
});
