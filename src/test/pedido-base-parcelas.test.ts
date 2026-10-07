import { describe, it, expect, vi } from "vitest";

// O serviço importa o client do Supabase no topo; aqui só testamos montagem pura.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  montarPayloadPedComp,
  normalizarBaseParcelas,
  type BaseParcelas,
  type NovoPedidoInput,
} from "@/services/pedidosService";

/**
 * "Data Base Parcelas" do pedido no Alvo (DataBaseVencimentoParcela).
 * Padrão: Data da Entrega. O Alvo grava os vencimentos exatamente como o Hub
 * manda, então rótulo, data base e vencimentos precisam sair coerentes.
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

function pedido(base?: BaseParcelas): NovoPedidoInput {
  return {
    user_id: "u",
    analista_nome: "Teste",
    analista_email: "t@t",
    itens: [
      {
        item_servico: true,
        codigo_produto: "002.023",
        codigo_alternativo_produto: null,
        codigo_prod_unid_med: "UNID",
        produto_nome: "SERVIÇO",
        produto_unidade: "UNID",
        quantidade: 1,
        valor_unitario: 300,
        observacao: "",
        rateio: [
          {
            codigo_classe_rec_desp: "24.05",
            classe_rec_desp_label: "24.05",
            percentual: 100,
            ccs: [{ codigo_centro_ctrl: "00008.00001.00003", percentual: 100 }],
          },
        ],
      },
    ],
    codigo_entidade: "0000003",
    nome_entidade: "FORNECEDOR",
    codigo_cond_pag: "0000037",
    nome_cond_pag: "15 DIAS",
    tipo_entrega: "Total",
    data_pedido: "2026-10-06",
    data_entrega: "2026-10-15",
    data_validade: "2026-11-05",
    data_competencia: "2026-10-01",
    ...(base ? { data_base_parcelas: base } : {}),
    parcelas: [
      { sequencia: 1, dias_entre_parcelas: 0, percentual_fracao: 1, valor_parcela: 300, data_vencimento: "2026-10-30" },
    ],
    texto_livre: "",
    texto_historico_novo: "",
  };
}

function payload(p: NovoPedidoInput) {
  return montarPayloadPedComp({
    input: p,
    texto_completo: "",
    texto_historico_completo: "",
    itens_enriquecidos: p.itens.map(() => ENRIQ),
    codigo_comprador: null,
    codigo_usuario_alvo: "TESTE",
  });
}

describe("Data Base Parcelas no payload do pedido", () => {
  it("padrão (sem escolha): Data da Entrega, com a data base = entrega", () => {
    const pl = payload(pedido());
    expect(pl.DataBaseVencimentoParcela).toBe("Data da Entrega");
    expect(pl.DataBaseVencimento).toBe(pl.DataEntrega);
    expect(String(pl.DataEntrega)).toContain("2026-10-15");
  });

  it("Data da Entrega escolhida: rótulo e data base da entrega", () => {
    const pl = payload(pedido("Data da Entrega"));
    expect(pl.DataBaseVencimentoParcela).toBe("Data da Entrega");
    expect(pl.DataBaseVencimento).toBe(pl.DataEntrega);
  });

  it("Data do Pedido escolhida: comportamento antigo", () => {
    const pl = payload(pedido("Data do Pedido"));
    expect(pl.DataBaseVencimentoParcela).toBe("Data do Pedido");
    expect(pl.DataBaseVencimento).toBe(pl.DataPedido);
  });

  it("vencimentos vão como o Hub calculou (o Alvo grava o que recebe)", () => {
    const pl = payload(pedido("Data da Entrega"));
    expect(String(pl.ParcPagPedCompChildList[0].DataVencimento)).toContain("2026-10-30");
  });

  it("pedido salvo antes da opção (null no banco) volta como Data do Pedido", () => {
    expect(normalizarBaseParcelas(null)).toBe("Data do Pedido");
    expect(normalizarBaseParcelas(undefined)).toBe("Data do Pedido");
    expect(normalizarBaseParcelas("Data da Entrega")).toBe("Data da Entrega");
    expect(normalizarBaseParcelas("Data do Sistema")).toBe("Data do Pedido");
  });
});
