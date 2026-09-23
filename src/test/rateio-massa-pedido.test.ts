import { describe, it, expect, vi } from "vitest";

// O serviço importa o client do Supabase no topo; aqui só testamos montagem pura.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  montarPayloadPedComp,
  rateioExatoDoItem,
  montarRateioDoItem,
  type ItemPedidoInput,
  type NovoPedidoInput,
} from "@/services/pedidosService";
import { UNIDADES_100_POR_CENTO, percentualParaUnidades } from "@/lib/rateioExato";

/**
 * Card RATEIO-MASSA — o envio ao Alvo.
 *
 * Três provas:
 *   1. O pedido SEM item por valor sai exatamente como antes (âncora: 0004919).
 *   2. O pedido COM item por valor fecha no centavo e em 100,0000% nos dois níveis.
 *   3. A gravação local volta por valor na retomada (montarRateioDoItem).
 */

const ENRIQ = {
  CodigoClasFiscal: "0000001",
  CodigoSitTributaria: "090",
  CodigoTributA: "0",
  CodigoTributB: "90",
  CodigoSitTributariaIBSCBS: null,
  PercentualICMS: 0,
  BaseICMS: 0,
  ValorICMS: 0,
  PercentualIPI: 0,
  BaseIPI: 0,
  ValorIPI: 0,
};

function item(parcial: Partial<ItemPedidoInput>): ItemPedidoInput {
  return {
    item_servico: true,
    codigo_produto: "002.023",
    codigo_alternativo_produto: null,
    codigo_prod_unid_med: "UNID",
    produto_nome: "SERVIÇO",
    produto_unidade: "UNID",
    quantidade: 1,
    valor_unitario: 0,
    observacao: "",
    rateio: [],
    ...parcial,
  };
}

function pedido(itens: ItemPedidoInput[]): NovoPedidoInput {
  const total = itens.reduce((s, it) => s + it.quantidade * it.valor_unitario, 0);
  return {
    user_id: "u",
    analista_nome: "Teste",
    analista_email: "t@t",
    itens,
    codigo_entidade: "0000001",
    nome_entidade: "FORNECEDOR",
    codigo_cond_pag: "0000037",
    nome_cond_pag: "30 DIAS",
    tipo_entrega: "Total",
    data_pedido: "2026-09-23",
    data_entrega: "2026-09-30",
    data_validade: "2026-09-30",
    data_competencia: "2026-09-01",
    parcelas: [
      { sequencia: 1, dias_entre_parcelas: 30, percentual_fracao: 1, valor_parcela: total, data_vencimento: "2026-10-22" },
    ],
    texto_livre: "",
    texto_historico_novo: "",
  };
}

interface LinhaPayload {
  CodigoCentroCtrl: string;
  Valor: number;
  Percentual: number;
  [campo: string]: unknown;
}
interface ClassePayload {
  CodigoClasseRecDesp: string;
  Valor: number;
  Percentual: number;
  RateioItemPedCompChildList?: LinhaPayload[];
  RateioPedCompChildList?: LinhaPayload[];
  [campo: string]: unknown;
}
interface PayloadTeste {
  ValorTotal: number;
  ItemPedCompChildList: Array<{ ItemPedCompClasseRecdespChildList: ClassePayload[] }>;
  PedCompClasseRecDespChildList: ClassePayload[];
}

function payload(p: NovoPedidoInput): PayloadTeste {
  return montarPayloadPedComp({
    input: p,
    texto_completo: "",
    texto_historico_completo: "",
    itens_enriquecidos: p.itens.map(() => ENRIQ),
    codigo_comprador: null,
    codigo_usuario_alvo: "TESTE",
  });
}

const somaCentavos = (valores: number[]) => valores.reduce((s, v) => s + Math.round(v * 100), 0);
const somaUnidades = (pcts: number[]) => pcts.reduce((s, p) => s + percentualParaUnidades(p), 0);

// ── 1. Caminho antigo intacto ───────────────────────────────────────────────
describe("pedido sem item por valor — sai como antes (âncora 0004919)", () => {
  // 0004919 (15/09/2026): R$ 19.415,04, classe 24.05, 33,33 / 33,33 / 33,34.
  // O Alvo devolveu o ITEM somando 19.415,03 e o CABEÇALHO 19.415,04 — é o
  // comportamento do caminho antigo, que este card NÃO altera (pendência §7.24).
  const p = pedido([
    item({
      valor_unitario: 19415.04,
      rateio: [
        {
          codigo_classe_rec_desp: "24.05",
          classe_rec_desp_label: "24.05",
          percentual: 100,
          ccs: [
            { codigo_centro_ctrl: "00008.00001.00003", percentual: 33.33 },
            { codigo_centro_ctrl: "00010.00003.00002", percentual: 33.33 },
            { codigo_centro_ctrl: "00007.00001.00003", percentual: 33.34 },
          ],
        },
      ],
    }),
  ]);
  const pl = payload(p);

  it("item: 6.471,03 / 6.471,03 / 6.472,97 (soma 19.415,03, como gravado no Alvo)", () => {
    const linhas = pl.ItemPedCompChildList[0].ItemPedCompClasseRecdespChildList[0].RateioItemPedCompChildList;
    expect(linhas.map((l) => l.Valor)).toEqual([6471.03, 6471.03, 6472.97]);
    expect(linhas.map((l) => l.Percentual)).toEqual([33.33, 33.33, 33.34]);
  });

  it("cabeçalho: resíduo na última linha, 6.472,98 (como gravado no Alvo)", () => {
    const linhas = pl.PedCompClasseRecDespChildList[0].RateioPedCompChildList;
    expect(linhas.map((l) => l.Valor)).toEqual([6471.03, 6471.03, 6472.98]);
  });
});

// ── 2. Caminho exato ────────────────────────────────────────────────────────
const LISTA_DO_PEDRO: Array<[string, number]> = [
  ["00010.00002.00007.00002", 225000], ["00010.00004.00003", 180000], ["00010.00002.00007.00001", 90000],
  ["00010.00002.00003", 180000], ["00010.00003.00002", 450000], ["00007.00001.00003", 205714],
  ["00008.00001.00003", 765000], ["00010.00001.00001", 45000], ["00010.00002.00005", 180000],
  ["00010.00003.00001", 180000], ["00010.00003.00003", 90000], ["00008.00001.00002", 90000],
  ["00007.00001.00002", 90000], ["00009.00001.00001", 1710000], ["00008.00001.00001", 360000],
  ["00010.00002.00002", 152143], ["00010.00004.00001", 135000], ["00010.00002.00008", 90000],
  ["00010.00003.00004", 17143],
];

describe("pedido com item por valor — a lista do Pedro (R$ 52.350,00 em 19 CCs)", () => {
  const p = pedido([
    item({
      valor_unitario: 52350,
      rateio_por_valor: true,
      rateio: [
        {
          codigo_classe_rec_desp: "15.02",
          classe_rec_desp_label: "15.02",
          percentual: 100,
          ccs: LISTA_DO_PEDRO.map(([codigo, centavos]) => ({ codigo_centro_ctrl: codigo, percentual: 0, valor_centavos: centavos })),
        },
      ],
    }),
  ]);
  const pl = payload(p);
  const classeItem = pl.ItemPedCompChildList[0].ItemPedCompClasseRecdespChildList[0];
  const classeCab = pl.PedCompClasseRecDespChildList[0];

  it("item: os 19 valores saem EXATAMENTE como digitados e somam R$ 52.350,00", () => {
    const linhas = classeItem.RateioItemPedCompChildList;
    expect(linhas).toHaveLength(19);
    expect(linhas.map((l) => Math.round(l.Valor * 100))).toEqual(LISTA_DO_PEDRO.map(([, c]) => c));
    expect(somaCentavos(linhas.map((l) => l.Valor))).toBe(5_235_000);
    expect(classeItem.Valor).toBe(52350);
  });

  it("item: percentuais com 4 casas somando 100,0000 exatos", () => {
    const pcts = classeItem.RateioItemPedCompChildList.map((l) => l.Percentual);
    expect(somaUnidades(pcts)).toBe(UNIDADES_100_POR_CENTO);
    expect(classeItem.Percentual).toBe(100);
    expect(pcts[5]).toBe(3.9296); // Corelab
    expect(pcts[13]).toBe(32.6647); // Produção (arredondou para baixo para fechar 100)
  });

  it("cabeçalho: mesma soma, mesmos valores, fecha com o ValorTotal", () => {
    const linhas = classeCab.RateioPedCompChildList;
    expect(linhas.map((l) => Math.round(l.Valor * 100))).toEqual(LISTA_DO_PEDRO.map(([, c]) => c));
    expect(somaUnidades(linhas.map((l) => l.Percentual))).toBe(UNIDADES_100_POR_CENTO);
    expect(Math.round(classeCab.Valor * 100)).toBe(Math.round(pl.ValorTotal * 100));
  });

  it("mantém os placeholders -1 que o Alvo resolve pelo aninhamento", () => {
    expect(classeItem).toMatchObject({ CodigoEmpresaFilial: "-1", NumeroPedComp: "-1", CodigoProduto: "-1", SequenciaItemPedComp: 0 });
    expect(classeItem.RateioItemPedCompChildList[0]).toMatchObject({ CodigoClasseRecDesp: "-1", SequenciaItemPedComp: 0 });
    expect(classeCab.RateioPedCompChildList[0]).toMatchObject({ CodigoEmpresaFilial: "-1", CodigoClasseRecDesp: "-1" });
  });
});

describe("pedido misto (um item por valor + um por percentual)", () => {
  const p = pedido([
    item({
      valor_unitario: 70,
      rateio_por_valor: true,
      rateio: [
        { codigo_classe_rec_desp: "15.01", classe_rec_desp_label: "", percentual: 0, ccs: [
          { codigo_centro_ctrl: "A", percentual: 0, valor_centavos: 1000 },
          { codigo_centro_ctrl: "B", percentual: 0, valor_centavos: 2000 },
        ] },
        { codigo_classe_rec_desp: "15.02", classe_rec_desp_label: "", percentual: 0, ccs: [
          { codigo_centro_ctrl: "C", percentual: 0, valor_centavos: 4000 },
        ] },
      ],
    }),
    item({
      valor_unitario: 19415.04,
      rateio: [
        { codigo_classe_rec_desp: "15.01", classe_rec_desp_label: "", percentual: 100, ccs: [
          { codigo_centro_ctrl: "A", percentual: 33.33 },
          { codigo_centro_ctrl: "B", percentual: 33.33 },
          { codigo_centro_ctrl: "C", percentual: 33.34 },
        ] },
      ],
    }),
  ]);
  const pl = payload(p);

  it("o item por percentual também fecha no centavo (maior resto)", () => {
    const linhas = pl.ItemPedCompChildList[1].ItemPedCompClasseRecdespChildList[0].RateioItemPedCompChildList;
    expect(somaCentavos(linhas.map((l) => l.Valor))).toBe(1_941_504);
  });

  it("dízima de 1/7 no item por valor: 42,8571% + 57,1429% e 33,3333% + 66,6667%", () => {
    const classes = pl.ItemPedCompChildList[0].ItemPedCompClasseRecdespChildList;
    expect(classes.map((c) => c.Percentual)).toEqual([42.8571, 57.1429]);
    expect(classes[0].RateioItemPedCompChildList.map((l) => l.Percentual)).toEqual([33.3333, 66.6667]);
  });

  it("cabeçalho = soma exata dos itens; classes fecham o ValorTotal e 100,0000%", () => {
    const cab = pl.PedCompClasseRecDespChildList;
    expect(somaCentavos(cab.map((c) => c.Valor))).toBe(Math.round(pl.ValorTotal * 100));
    expect(somaUnidades(cab.map((c) => c.Percentual))).toBe(UNIDADES_100_POR_CENTO);
    cab.forEach((c) => {
      expect(somaUnidades(c.RateioPedCompChildList.map((l) => l.Percentual))).toBe(UNIDADES_100_POR_CENTO);
      expect(somaCentavos(c.RateioPedCompChildList.map((l) => l.Valor))).toBe(Math.round(c.Valor * 100));
    });
  });
});

describe("rateioExatoDoItem — recusas", () => {
  it("valores que não fecham o total do item: mostra a diferença", () => {
    expect(() =>
      rateioExatoDoItem({
        quantidade: 1,
        valor_unitario: 100,
        rateio_por_valor: true,
        rateio: [{ codigo_classe_rec_desp: "1", classe_rec_desp_label: "", percentual: 0, ccs: [
          { codigo_centro_ctrl: "A", percentual: 0, valor_centavos: 9999 },
        ] }],
      }),
    ).toThrow(/R\$ 99,99.*R\$ 100,00.*R\$ 0,01/);
  });
});

// ── 3. Gravação local ⇄ retomada ────────────────────────────────────────────
describe("montarRateioDoItem — item por valor gravado volta com os centavos", () => {
  it("linhas com valor trazem valor_centavos exatos (classe = soma inteira)", () => {
    const r = montarRateioDoItem([
      { codigo_classe_rec_desp: "15.02", classe_rec_desp_label: null, codigo_centro_ctrl: "A", centro_ctrl_label: null, percentual: "3.9296", valor: "2057.14" },
      { codigo_classe_rec_desp: "15.02", classe_rec_desp_label: null, codigo_centro_ctrl: "B", centro_ctrl_label: null, percentual: "96.0704", valor: "50292.86" },
    ]);
    expect(r[0].valor_centavos).toBe(5_235_000);
    expect(r[0].ccs.map((c) => c.valor_centavos)).toEqual([205714, 5029286]);
  });

  it("linhas antigas (sem valor) não ganham valor_centavos", () => {
    const r = montarRateioDoItem([
      { codigo_classe_rec_desp: "15.02", classe_rec_desp_label: null, codigo_centro_ctrl: "A", centro_ctrl_label: null, percentual: 60, valor: null },
      { codigo_classe_rec_desp: "15.02", classe_rec_desp_label: null, codigo_centro_ctrl: "B", centro_ctrl_label: null, percentual: 40, valor: null },
    ]);
    expect(r[0].valor_centavos).toBeUndefined();
    expect(r[0].ccs.every((c) => c.valor_centavos === undefined)).toBe(true);
  });
});
