import { describe, expect, it } from "vitest";
import { montarPlanilhaEtapas, type LinhaEtapas } from "@/services/notasEtapasExport";

const base: LinhaEtapas = {
  id: "a", numero: "1", fornecedor: "X", cnpj: "1", valor: 10, emissao: "2026-10-01", pedidos: "0001", data_pedido: "2026-10-02",
  pedido_aprovado_em: null, dias_pedido_emissao: -1, chave_movestq: null, lancado_em: null, digitado_em: null,
  nf_anexado_em: null, nf_anexado_por: null, boleto_anexado_em: null, boleto_anexado_por: null, docfin: null,
  parcelas_total: 0, parcelas_pagas: 0, proximo_vencimento: null, pago_em: null, situacao_pagamento: null,
  etapa_atual: "3 · MovEstq", dias_emissao_lancamento: null, dias_em_aberto: 30, dias_emissao_digitacao: null,
  dias_lancamento_pagamento: null, dias_atraso: null,
};
const ctx = { de: "2026-10-01", ate: "2026-10-31", filtros: [] };

async function coluna(rotulo: string, linhas: LinhaEtapas[]) {
  const wb = await montarPlanilhaEtapas("nfe", linhas, ctx);
  const ws = wb.worksheets[0];
  let idx = 0;
  ws.getRow(2).eachCell((c, i) => {
    if (c.value === rotulo) idx = i;
  });
  expect(idx).toBeGreaterThan(0);
  return linhas.map((_, k) => ws.getRow(3 + k).getCell(idx));
}

describe("download de controle das etapas", () => {
  it("Dias: emissão → lançamento é sempre número — nota não lançada traz os dias até hoje, em itálico", async () => {
    const lancada = { ...base, id: "b", lancado_em: "2026-10-03", dias_emissao_lancamento: 2, dias_em_aberto: null };
    const [aberta, ok] = await coluna("Dias: emissão → lançamento", [base, lancada]);
    expect(aberta.value).toBe(30);
    expect(aberta.font?.italic).toBe(true);
    expect(ok.value).toBe(2);
    expect(ok.font?.italic).toBeFalsy();
  });

  it("NF-e traz a coluna CFOP; NFS-e não (NFE-7-A)", async () => {
    const [c] = await coluna("CFOP", [{ ...base, cfop: "5102 · 5949" }]);
    expect(c.value).toBe("5102 · 5949");
    const wb = await montarPlanilhaEtapas("nfse", [base], ctx);
    const rotulos: unknown[] = [];
    wb.worksheets[0].getRow(2).eachCell((cel) => rotulos.push(cel.value));
    expect(rotulos).not.toContain("CFOP");
  });

  it("aba Sobre: na NF-e a etapa atual não conta os anexos (opcionais); na NFS-e continua (NFE-11)", async () => {
    const regra = async (tipo: "nfe" | "nfse") => {
      const sobre = (await montarPlanilhaEtapas(tipo, [base], ctx)).getWorksheet("Sobre")!;
      let texto = "";
      sobre.eachRow((r) => {
        if (r.getCell(1).value === "Etapa atual") texto = String(r.getCell(2).value);
      });
      return texto;
    };
    expect(await regra("nfe")).toContain("opcionais na NF-e");
    expect(await regra("nfe")).not.toContain("4 · PDF da nota");
    expect(await regra("nfse")).toContain("4 · PDF da nota");
  });

  it("tipo de lançamento no bloco MovEstq, na NF-e e na NFS-e (NFE-14)", async () => {
    const l = { ...base, tipo_lanc: "E0000003", tipo_lanc_descricao: "Compra (NF-e)" };
    const [cod] = await coluna("Tipo de lançamento", [l]);
    const [desc] = await coluna("Descrição do tipo (catálogo do Hub)", [l]);
    expect(cod.value).toBe("E0000003");
    expect(desc.value).toBe("Compra (NF-e)");
    const wb = await montarPlanilhaEtapas("nfse", [l], ctx);
    const rotulos: unknown[] = [];
    wb.worksheets[0].getRow(2).eachCell((cel) => rotulos.push(cel.value));
    expect(rotulos).toContain("Tipo de lançamento");
  });

  it("Dias: pedido → emissão mantém o sinal (negativo = nota antes do pedido)", async () => {
    const [c] = await coluna("Dias: pedido → emissão", [base]);
    expect(c.value).toBe(-1);
  });
});
