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

  it("comentários nas colunas finais: resumo + todos numa célula, do mais novo ao mais antigo (NFE-16)", async () => {
    const com = {
      ...base,
      id: "c",
      comentarios: [
        { texto: "Prestador avisou atraso no boleto.", criado_em: "2026-11-11T17:32:05Z", autor: "mirlene.oliveira" },
        { texto: "Conferir o boleto com o fornecedor.", criado_em: "2026-11-11T15:39:17Z", autor: "Hugo" },
      ],
    };
    const sem = { ...base, id: "d", comentarios: [] };
    for (const tipo of ["nfe", "nfse"] as const) {
      const ws = (await montarPlanilhaEtapas(tipo, [com, sem], ctx)).worksheets[0];
      const rotulos: unknown[] = [];
      ws.getRow(2).eachCell((cel) => rotulos.push(cel.value));
      // as 4 últimas colunas, no bloco "Comentários"
      expect(rotulos.slice(-4)).toEqual([
        "Nº de comentários",
        "Último comentário em",
        "Último comentário por",
        "Comentários (do mais novo ao mais antigo)",
      ]);
      expect(ws.getRow(1).getCell(rotulos.length - 3).value).toBe("Comentários");
    }
    const [n, nSem] = await coluna("Nº de comentários", [com, sem]);
    expect(n.value).toBe(2);
    expect(nSem.value).toBe(0);
    const [em] = await coluna("Último comentário em", [com]);
    // 17:32:05 UTC = 14:32:05 em Brasília, gravado "como está", com segundos
    expect((em.value as Date).toISOString()).toBe("2026-11-11T14:32:05.000Z");
    expect(em.numFmt).toBe("dd/mm/yyyy hh:mm:ss");
    const [por] = await coluna("Último comentário por", [com]);
    expect(por.value).toBe("mirlene.oliveira");
    const [todos, todosSem] = await coluna("Comentários (do mais novo ao mais antigo)", [com, sem]);
    expect(todos.value).toBe(
      "11/11/2026 14:32:05 · mirlene.oliveira: Prestador avisou atraso no boleto.\n11/11/2026 12:39:17 · Hugo: Conferir o boleto com o fornecedor.",
    );
    expect(todos.alignment).toMatchObject({ wrapText: true, vertical: "top" });
    expect(todosSem.value).toBe("");
  });

  it("as outras colunas de data e hora continuam sem segundos (NFE-16 não mexe nelas)", async () => {
    const [c] = await coluna("Data da digitação", [{ ...base, digitado_em: "2026-11-10T14:00:47Z" }]);
    expect((c.value as Date).toISOString()).toBe("2026-11-10T11:00:00.000Z");
    expect(c.numFmt).toBe("dd/mm/yyyy hh:mm");
  });

  it("aba Sobre explica os comentários", async () => {
    const sobre = (await montarPlanilhaEtapas("nfse", [base], ctx)).getWorksheet("Sobre")!;
    let texto = "";
    sobre.eachRow((r) => {
      if (r.getCell(1).value === "Comentários") texto = String(r.getCell(2).value);
    });
    expect(texto).toContain("do mais novo ao mais antigo");
  });

  it("aprovação do pedido e sugeridos no bloco Pedido; não aprovado em vermelho; \"aprovado em\" só com aprovação total (NFE-17)", async () => {
    const naoAprovado = {
      ...base,
      id: "e",
      pedidos: "0004317",
      pedido_aprovado_em: "2026-11-10",
      pedido_aprovacao: "Reavaliar",
      pedido_aprovado: false,
    };
    const aprovado = { ...base, id: "f", pedido_aprovado_em: "2026-10-03", pedido_aprovacao: "Aprovado", pedido_aprovado: true };
    const sugerida = {
      ...base,
      id: "g",
      pedidos: null,
      pedidos_sugeridos: "0005253 (exato) · 0005256 (+1,4%)",
      sugeridos_aprovacao: "0005253: Em Andamento · 0005256: Em Andamento",
      sugeridos_aprovados: false,
    };
    const ws = (await montarPlanilhaEtapas("nfse", [naoAprovado, aprovado, sugerida], ctx)).worksheets[0];
    const rotulos: unknown[] = [];
    ws.getRow(2).eachCell((cel) => rotulos.push(cel.value));
    const i = rotulos.indexOf("Pedido");
    expect(rotulos.slice(i, i + 7)).toEqual([
      "Pedido",
      "Aprovação do pedido",
      "Data do pedido",
      "Pedido aprovado em",
      "Dias: pedido → emissão",
      "Pedidos sugeridos (nota sem pedido no Alvo)",
      "Aprovação dos sugeridos",
    ]);
    const [aprNao, aprSim] = await coluna("Aprovação do pedido", [naoAprovado, aprovado]);
    expect(aprNao.value).toBe("Reavaliar");
    expect(aprNao.font).toMatchObject({ bold: true, color: { argb: "FFDC2626" } });
    expect(aprSim.value).toBe("Aprovado");
    expect(aprSim.font?.bold).toBeFalsy();
    const [emNao, emSim] = await coluna("Pedido aprovado em", [naoAprovado, aprovado]);
    expect(emNao.value).toBeNull();
    expect((emSim.value as Date).toISOString()).toBe("2026-10-03T00:00:00.000Z");
    const [sug] = await coluna("Pedidos sugeridos (nota sem pedido no Alvo)", [sugerida]);
    expect(sug.value).toBe("0005253 (exato) · 0005256 (+1,4%)");
    const [sugAp] = await coluna("Aprovação dos sugeridos", [sugerida]);
    expect(sugAp.font).toMatchObject({ bold: true });
  });

  it("aba Sobre explica a aprovação e os sugeridos (NFE-17)", async () => {
    const sobre = (await montarPlanilhaEtapas("nfe", [base], ctx)).getWorksheet("Sobre")!;
    const chaves: unknown[] = [];
    sobre.eachRow((r) => chaves.push(r.getCell(1).value));
    expect(chaves).toEqual(expect.arrayContaining(["Aprovação do pedido", "Pedidos sugeridos"]));
  });

  it("Dias: pedido → emissão mantém o sinal (negativo = nota antes do pedido)", async () => {
    const [c] = await coluna("Dias: pedido → emissão", [base]);
    expect(c.value).toBe(-1);
  });
});
