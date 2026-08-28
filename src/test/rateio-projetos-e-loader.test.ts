import { describe, it, expect, vi } from "vitest";

// Os dois módulos importam o client do Supabase no topo. Os testes são puros
// (validação e aritmética), então o client é mockado para o import não depender
// de env nem de rede.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  validarLinhasRateio,
  consolidarRateioProjeto,
  somarFatias,
  arredondamentoItem,
  arredondamentoCabecalho,
} from "@/services/alvoProjetoPedidoService";
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
      const r = montarRateioDoItem(linhas);
      expect(r).toHaveLength(4);
      r.forEach((c) => expect(c.percentual).toBeCloseTo(25, 1));
    });

    it("a soma das classes é 100%, não 400% — era o defeito", () => {
      const r = montarRateioDoItem(linhas);
      const soma = r.reduce((s, c) => s + c.percentual, 0);
      expect(soma).toBeCloseTo(100, 1);
      expect(soma).not.toBeCloseTo(400, 0);
    });

    it("o valor exibido pela tela volta a ser o valor do item", () => {
      // A tela faz: valorTotalItem * cls.percentual / 100, somado nas classes.
      const r = montarRateioDoItem(linhas);
      const exibido = r.reduce((s, c) => s + (VALOR_ITEM * c.percentual) / 100, 0);
      expect(exibido).toBeCloseTo(VALOR_ITEM, 0);
      // Antes exibia ~4× isso (R$ 189.378,20).
      expect(exibido).toBeLessThan(VALOR_ITEM * 1.01);
    });

    it("as 4 fatias somam exatamente 100 — o resíduo de classe fecha a conta", () => {
      const r = montarRateioDoItem(linhas);
      expect(r.reduce((s, c) => s + c.percentual, 0)).toBe(100);
    });

    it("o CC dentro da classe continua 100% (a coluna já é relativa no espelho)", () => {
      const r = montarRateioDoItem(linhas);
      r.forEach((c) => {
        expect(c.ccs).toHaveLength(1);
        expect(c.ccs[0].percentual).toBe(100);
      });
    });
  });

  describe("classe única — as duas convenções coincidem (596 dos 598 itens)", () => {
    it("espelho com 1 classe e 2 CCs dá 100% na classe e 60/40 nos CCs", () => {
      const r = montarRateioDoItem([espelho("A", "CC1", 60, 600), espelho("A", "CC2", 40, 400)]);
      expect(r).toHaveLength(1);
      expect(r[0].percentual).toBeCloseTo(100, 1);
      expect(r[0].ccs.map((c) => c.percentual)).toEqual([60, 40]);
    });
  });

  describe("linhas CRUS do frontend (valor null) — comportamento antigo preservado", () => {
    it("percentual absoluto vira fatia da classe e CC normalizado", () => {
      // Item com 2 classes: A 60% (CC1 100%), B 40% (CC2 50% + CC3 50%).
      const r = montarRateioDoItem([cru("A", "CC1", 60), cru("B", "CC2", 20), cru("B", "CC3", 20)]);
      expect(r).toHaveLength(2);
      expect(r[0].percentual).toBe(60);
      expect(r[0].ccs[0].percentual).toBe(100);
      expect(r[1].percentual).toBe(40);
      expect(r[1].ccs.map((c) => c.percentual)).toEqual([50, 50]);
    });

    it("a soma das classes continua 100%", () => {
      const r = montarRateioDoItem([cru("A", "CC1", 60), cru("B", "CC2", 40)]);
      expect(r.reduce((s, c) => s + c.percentual, 0)).toBeCloseTo(100, 2);
    });
  });

  describe("bordas", () => {
    it("lista vazia devolve []", () => {
      expect(montarRateioDoItem([])).toEqual([]);
    });

    it("uma linha sem valor faz o conjunto ser tratado como CRU (conservador)", () => {
      // Mistura não deve acontecer (medido: zero itens misturam origens), mas se
      // acontecer o caminho antigo é o comportamento seguro.
      const r = montarRateioDoItem([espelho("A", "CC1", 60, 600), cru("A", "CC2", 40)]);
      expect(r[0].percentual).toBe(100); // soma dos "absolutos" 60+40
    });

    it("item com TODOS os valores zerados não divide por zero", () => {
      const r = montarRateioDoItem([espelho("A", "CC1", 100, 0)]);
      expect(Number.isFinite(r[0].percentual)).toBe(true);
      // somaValorItem = 0 ⇒ cai no caminho conservador (soma dos absolutos).
      expect(r[0].percentual).toBe(100);
    });

    it("🔴 a base é a soma do PRÓPRIO item, não quantidade × valor_unitario", () => {
      // O 0004640: rateio de R$ 69.353,42 num item cuja quantidade × unitário é
      // R$ 60.307,32 — a diferença é o IPI. Dividir pela segunda base daria 115%
      // numa classe única que sempre exibiu 100%. Medido em 28/08/2026: 27 dos
      // 598 itens monoclasse do espelho quebrariam assim.
      const r = montarRateioDoItem([espelho("19.02", "CC1", 100, 69353.42)]);
      expect(r).toHaveLength(1);
      expect(r[0].percentual).toBe(100);
    });

    it("as fatias de classe somam exatamente 100 mesmo com percentual quebrado", () => {
      // 3 classes de 1/3 de R$ 100,01 — sem o resíduo de classe fecharia 99,99.
      const r = montarRateioDoItem([
        espelho("A", "CC1", 100, 33.34),
        espelho("B", "CC2", 100, 33.34),
        espelho("C", "CC3", 100, 33.33),
      ]);
      expect(r.reduce((s2, c) => s2 + c.percentual, 0)).toBe(100);
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
// O módulo montava o rateio com map() 1:1, a mesma forma que derrubou o 0004781
// do Suprimentos com `Friendly_Message_UQ_PK`. A consolidação colapsa APENAS o par
// (classe, CC) repetido, que é o que o UNIQUE do Alvo proíbe.
//
// 🔴 Estes testes existem para FALHAR contra uma implementação map() 1:1 — a
// revisão adversarial mostrou que a bateria anterior passava inteira com ela.
describe("consolidarRateioProjeto (Projetos)", () => {
  const l = (classe: string, cc: string, percentual: number) => ({
    classe_codigo: classe,
    centro_custo_codigo: cc,
    percentual,
  });

  describe("o par (classe, CC) repetido — a forma do 0004781", () => {
    it("duas linhas 50/50 no MESMO CC viram uma linha, com as duas partes guardadas", () => {
      const { linhas, consolidacoes } = consolidarRateioProjeto([
        l("18.05", "00010.00004.00003", 50),
        l("18.05", "00010.00004.00003", 50),
      ]);
      expect(linhas).toHaveLength(1);
      expect(linhas[0].percentual).toBe(100);
      expect(linhas[0].partes).toEqual([50, 50]);
      expect(consolidacoes).toEqual([
        { codigo_classe_rec_desp: "18.05", codigo_centro_ctrl: "00010.00004.00003", linhas_originais: 2 },
      ]);
    });

    it("o Valor é SOMADO das partes, não recalculado do percentual somado", () => {
      // 3 x 33,33% de 100,01: somar as partes dá 99,99; recalcular 99,99% de
      // 100,01 daria 100,00. A regra do D4 é somar.
      const { linhas } = consolidarRateioProjeto([
        l("A", "CC1", 33.33),
        l("A", "CC1", 33.33),
        l("A", "CC1", 33.33),
      ]);
      const somado = somarFatias(linhas[0].partes, 100.01, arredondamentoItem(100.01));
      const recalculado = arredondamentoItem(100.01)(linhas[0].percentual);
      expect(somado).toBe(99.99);
      expect(recalculado).toBe(100);
      expect(somado).not.toBe(recalculado);
    });
  });

  describe("🔴 o que NÃO pode ser tratado como repetição", () => {
    it("mesma classe com CCs DIFERENTES: duas linhas e consolidacoes VAZIO", () => {
      // Caso banal de uma classe rateada entre dois centros de custo.
      // `validarLinhasRateio` aprova e nada deve ser fundido. Se `consolidacoes`
      // não vier vazio, o console.warn do buildPayload acusa "validação
      // contornada" num rateio válido — e o tripwire vira ruído.
      const rateio = [l("18.05", "CC1", 30), l("18.05", "CC2", 70)];
      expect(validarLinhasRateio(rateio)).toBeNull();

      const { linhas, consolidacoes } = consolidarRateioProjeto(rateio);
      expect(linhas).toHaveLength(2);
      expect(consolidacoes).toEqual([]);
      expect(linhas.map((x) => x.percentual)).toEqual([30, 70]);
    });

    it("mesmo CC em classes DIFERENTES: duas linhas e consolidacoes VAZIO", () => {
      const { linhas, consolidacoes } = consolidarRateioProjeto([l("A", "CC1", 50), l("B", "CC1", 50)]);
      expect(linhas).toHaveLength(2);
      expect(consolidacoes).toEqual([]);
    });

    it("rateio comum de 2 classes: consolidacoes VAZIO", () => {
      const { consolidacoes } = consolidarRateioProjeto([l("18.05", "CC1", 60), l("11.01", "CC2", 40)]);
      expect(consolidacoes).toEqual([]);
    });
  });

  describe("🔴 o payload NÃO pode mudar quando não há repetição", () => {
    // As duas fórmulas do payload, como estavam ANTES da consolidação.
    const itemAntigo = (base: number, p: number) => Math.round(((base * p) / 100) * 100) / 100;
    const cabecalhoAntigo = (base: number, p: number) => Number((base * (p / 100)).toFixed(2));

    it("as duas fórmulas divergem entre si — por isso cada nível guarda a sua", () => {
      // Caso encontrado pela revisão: com 1000,14 e 25%, item e cabeçalho dariam
      // valores diferentes se usassem a mesma função.
      expect(cabecalhoAntigo(1000.14, 25)).toBe(250.03);
      expect(itemAntigo(1000.14, 25)).toBe(250.04);
    });

    it("cabeçalho: valor idêntico ao antigo no 25/75 de 1000,14, e a soma fecha", () => {
      const rateio = [l("A", "CC1", 25), l("B", "CC2", 75)];
      const { linhas, consolidacoes } = consolidarRateioProjeto(rateio);
      expect(consolidacoes).toEqual([]);

      const novos = linhas.map((r) => somarFatias(r.partes, 1000.14, arredondamentoCabecalho(1000.14)));
      const antigos = rateio.map((r) => cabecalhoAntigo(1000.14, r.percentual));
      expect(novos).toEqual(antigos);
      // Fecha contra o ValorTotal, que é o que o Alvo valida.
      expect(novos.reduce((s, v) => s + v, 0)).toBeCloseTo(1000.14, 2);
    });

    it("item: valor idêntico ao antigo, varrendo bases e percentuais", () => {
      const bases = [100, 1199.98, 47344.55, 110000, 1000.14, 9.77, 52921.33];
      const splits = [[100], [60, 40], [25, 75], [33.33, 33.33, 33.34], [12.5, 87.5], [7.7, 92.3]];
      for (const base of bases) {
        for (const split of splits) {
          const rateio = split.map((p, i) => l("C" + i, "CC" + i, p));
          const { linhas } = consolidarRateioProjeto(rateio);
          const novos = linhas.map((r) => somarFatias(r.partes, base, arredondamentoItem(base)));
          expect(novos).toEqual(split.map((p) => itemAntigo(base, p)));
        }
      }
    });

    it("cabeçalho: valor idêntico ao antigo, na mesma varredura", () => {
      const bases = [100, 1199.98, 47344.55, 110000, 1000.14, 9.775, 1002.1, 1000.63];
      const splits = [[100], [60, 40], [25, 75], [45, 55], [20, 30, 50], [12.5, 87.5]];
      for (const base of bases) {
        for (const split of splits) {
          const rateio = split.map((p, i) => l("C" + i, "CC" + i, p));
          const { linhas } = consolidarRateioProjeto(rateio);
          const novos = linhas.map((r) => somarFatias(r.partes, base, arredondamentoCabecalho(base)));
          expect(novos).toEqual(split.map((p) => cabecalhoAntigo(base, p)));
        }
      }
    });
  });

  describe("chave do agrupamento", () => {
    it("Map aninhado: código com barra vertical não colide com outro par", () => {
      // Com chave concatenada classe + "|" + cc, ("A|B","C") e ("A","B|C")
      // colidiriam e as duas linhas sairiam com o percentual somado.
      const { linhas } = consolidarRateioProjeto([l("A|B", "C", 50), l("A", "B|C", 50)]);
      expect(linhas).toHaveLength(2);
      expect(linhas.map((x) => x.percentual)).toEqual([50, 50]);
    });

    it("usa a MESMA normalização de validarLinhasRateio (trim nos dois lados)", () => {
      const rateio = [l(" 18.05", "CC1", 50), l("18.05", "CC1 ", 50)];
      // O validador vê um par repetido...
      expect(validarLinhasRateio(rateio)).toContain("Linhas 1 e 2");
      // ...e a consolidação tem de ver o mesmo, senão a defesa em profundidade
      // tem um furo exatamente onde diz cobrir.
      const { linhas, consolidacoes } = consolidarRateioProjeto(rateio);
      expect(linhas).toHaveLength(1);
      expect(consolidacoes).toHaveLength(1);
    });
  });

  describe("bordas", () => {
    it("rateio vazio devolve vazio", () => {
      expect(consolidarRateioProjeto([]).linhas).toEqual([]);
      expect(consolidarRateioProjeto([]).consolidacoes).toEqual([]);
    });

    it("percentual/código ausentes não quebram", () => {
      const { linhas } = consolidarRateioProjeto([{ percentual: 100 }]);
      expect(linhas).toHaveLength(1);
      expect(linhas[0].classe_codigo).toBe("");
      expect(linhas[0].centro_custo_codigo).toBe("");
      expect(linhas[0].percentual).toBe(100);
    });

    it("preserva a ordem de primeira aparição (classe, depois CC)", () => {
      const { linhas } = consolidarRateioProjeto([l("A", "CC1", 25), l("B", "CC2", 50), l("A", "CC3", 25)]);
      expect(linhas.map((x) => x.classe_codigo + "/" + x.centro_custo_codigo)).toEqual(["A/CC1", "A/CC3", "B/CC2"]);
    });
  });
});
