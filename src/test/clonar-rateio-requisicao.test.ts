import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Gerar pedido a partir da requisição: o rateio classe × CC gravado na requisição
 * (multi-CC da tela ou lançada por e-mail) vem junto como rateio sugerido do item.
 * Caso real: requisição 0001622 (26/10/2026), classe 19.05 em 13 CCs.
 */

// Banco falso: cada tabela devolve as linhas que o filtro .eq/.in seleciona.
const tabelas: Record<string, any[]> = {};
function consulta(tabela: string) {
  let linhas = [...(tabelas[tabela] || [])];
  let unica = false;
  const q: any = {
    select: () => q,
    eq: (col: string, v: unknown) => { linhas = linhas.filter((l) => l[col] === v); return q; },
    in: (col: string, vs: unknown[]) => { linhas = linhas.filter((l) => vs.includes(l[col])); return q; },
    order: () => q,
    single: () => { unica = true; return q; },
    then: (ok: (r: any) => unknown) => ok({ data: unica ? linhas[0] ?? null : linhas, error: null }),
  };
  return q;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => consulta(t) } }));

import { clonarDeRequisicao, rateioSugeridoDoItem } from "@/services/pedidosService";

const CCS_0001622: [string, string, number][] = [
  ["00008.00001.00003", "DESIGN E DESENVOLVIMENTO", 33.5], ["00010.00002.00003", "CONTROLADORIA/FINANCEIRO", 17.5],
  ["00010.00002.00005", "ENGENHARIA DE MANUFATURA", 12.9], ["00010.00003.00001", "GARANTIA DA QUALIDADE", 9.3],
  ["00007.00001.00002", "MARKETING E COMUNICACAO", 6], ["00010.00003.00002", "CONTROLE DA QUALIDADE", 5.4],
  ["00010.00002.00002", "RECURSOS HUMANOS", 4.8], ["00010.00003.00003", "GERENCIAMENTO DE RISCOS", 3.9],
  ["00010.00004.00001", "ASSUNTOS REGULATORIOS", 3.3], ["00010.00002.00007.00003", "LOGISTICA", 2.7],
  ["00009.00001.00001", "PRODUCAO", 0.4], ["00010.00002.00008", "TI - TECNOLOGIA DA INFORMACAO", 0.2],
  ["00010.00001.00004", "DIRETORIA EXECUTIVA", 0.1],
];

function requisicao(id: string, comRateio: boolean) {
  tabelas.compras_requisicoes = [{
    id, status: "sincronizada", numero_pedido_compra_alvo: null, numero_alvo: "0001622",
    codigo_empresa_filial: "1.01", cnpj_sugestao_requisicao: null, descricao: "Recargas de IA da Anthropic",
  }];
  tabelas.compras_requisicoes_itens = [{
    requisicao_id: id, sequencia: 1, codigo_produto: "002.050", codigo_alternativo_produto: null,
    codigo_prod_unid_med: "UNID", produto_nome: "SERVIÇO DE IA", produto_unidade: "UNID", quantidade: 50,
    item_servico: true, observacao: "Recargas", codigo_centro_ctrl: "00008.00001.00003",
    compras_requisicoes_itens_classe_rec_desp: [{ codigo_classe_rec_desp: "19.05", classe_rec_desp_label: "MANUTENCAO DE SOFTWARE", percentual: 100 }],
  }];
  tabelas.compras_requisicoes_rateio_classes = comRateio
    ? [{ id: "cl1", requisicao_id: id, codigo_classe_rec_desp: "19.05", classe_rec_desp_label: "MANUTENCAO DE SOFTWARE", percentual: 100 }]
    : [];
  // Ordem embaralhada de propósito: o banco não guarda ordem.
  tabelas.compras_requisicoes_rateio_cc = comRateio
    ? [...CCS_0001622].reverse().map(([codigo_centro_ctrl, centro_ctrl_label, percentual]) =>
        ({ rateio_classe_id: "cl1", codigo_centro_ctrl, centro_ctrl_label, percentual }))
    : [];
}

beforeEach(() => { for (const k of Object.keys(tabelas)) delete tabelas[k]; });

describe("gerar pedido a partir da requisição — rateio por CC vai junto", () => {
  it("requisição com rateio de 13 CCs: o item do pedido nasce com os 13 CCs e os percentuais", async () => {
    requisicao("r1", true);
    const r = await clonarDeRequisicao("r1");
    const rateio = r.itens_clonados[0].rateio_sugerido;
    expect(rateio).toHaveLength(1);
    expect(rateio[0]).toMatchObject({ codigo_classe_rec_desp: "19.05", percentual: 100 });
    expect(rateio[0].ccs.map((c) => [c.codigo_centro_ctrl, c.centro_ctrl_label, c.percentual])).toEqual(CCS_0001622);
    const soma = rateio[0].ccs.reduce((s, c) => s + Math.round(c.percentual * 10000), 0);
    expect(soma).toBe(1_000_000);
  });

  it("requisição sem rateio gravado (fluxo comum da tela): igual a antes, 100% no CC do item", async () => {
    requisicao("r2", false);
    const r = await clonarDeRequisicao("r2");
    expect(r.itens_clonados[0].rateio_sugerido).toEqual([{
      codigo_classe_rec_desp: "19.05", classe_rec_desp_label: "MANUTENCAO DE SOFTWARE", percentual: 100,
      ccs: [{ codigo_centro_ctrl: "00008.00001.00003", percentual: 100 }],
    }]);
  });
});

describe("rateioSugeridoDoItem", () => {
  const rateioReq = [{
    codigo_classe_rec_desp: "19.04", classe_rec_desp_label: "MANUTENCAO DE TI", percentual: 70,
    ccs: [{ codigo_centro_ctrl: "00010.00002.00008", percentual: 50 }, { codigo_centro_ctrl: "00010.00002.00003", percentual: 50 }],
  }];

  it("classe do item que não está no rateio da requisição vai 100% no CC do item", () => {
    const r = rateioSugeridoDoItem(
      [{ codigo_classe_rec_desp: "19.04", classe_rec_desp_label: "MANUTENCAO DE TI", percentual: 70 },
       { codigo_classe_rec_desp: "21.14", classe_rec_desp_label: "SERVICOS DE TERCEIROS - OUTROS", percentual: 30 }],
      "00010.00002.00008", rateioReq);
    expect(r[0].ccs).toHaveLength(2);
    expect(r[1].ccs).toEqual([{ codigo_centro_ctrl: "00010.00002.00008", percentual: 100 }]);
  });

  it("item sem classe própria usa as classes do rateio da requisição", () => {
    const r = rateioSugeridoDoItem([], "00010.00002.00008", rateioReq);
    expect(r).toEqual([{ ...rateioReq[0] }]);
  });

  it("não compartilha os objetos de CC entre itens (o wizard edita cada item à parte)", () => {
    const a = rateioSugeridoDoItem([], "x", rateioReq);
    const b = rateioSugeridoDoItem([], "x", rateioReq);
    expect(a[0].ccs[0]).not.toBe(b[0].ccs[0]);
    expect(a[0].ccs[0]).not.toBe(rateioReq[0].ccs[0]);
  });
});
