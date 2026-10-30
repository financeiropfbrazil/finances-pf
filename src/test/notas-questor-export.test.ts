import { describe, expect, it } from "vitest";
import { montarPlanilhaQuestor, type LinhaQuestor, type RelatorioQuestor } from "@/services/notasQuestorExport";

const base: LinhaQuestor = {
  chave_acesso: "35260100000000000000000000000000000000000000000001", numero: "123", emissao: "2026-10-01",
  competencia: "2026-09-30", cnpj: "11222333000144", prestador: "Contabil X", municipio: "São Paulo",
  valor_servico: 1000, valor_liquido: 900, situacao_fisco: "normal", situacao_alvo: "lancada_nfse",
  lancado_em: "2026-10-03", pedidos: "0005000", docfin: 123456, codigo_servico: "171901",
  descricao_servico: "Serviços contábeis", classe: "21.01", classe_nome: "CONTABILIDADE", classe_origem: "docfin",
  outras_classes: null, natureza: "8.000.001", natureza_descricao: "Servicos Tomados c/ Contabilidade",
};
const ctx = { de: "2026-10-01", ate: "2026-10-31", filtros: [] };

async function planilha(rel: RelatorioQuestor) {
  const wb = await montarPlanilhaQuestor(rel, ctx);
  const ws = wb.getWorksheet("NFS-e")!;
  const col = (rotulo: string) => {
    let idx = 0;
    ws.getRow(2).eachCell((c, i) => {
      if (c.value === rotulo) idx = i;
    });
    expect(idx).toBeGreaterThan(0);
    return idx;
  };
  return { wb, ws, col };
}

describe("Excel para a contabilidade (natureza do Questor)", () => {
  it("traz a natureza e a classe de cada nota; sugestão pelo fornecedor fica em itálico", async () => {
    const sugerida: LinhaQuestor = { ...base, chave_acesso: "b", classe_origem: "fornecedor" };
    const semClasse: LinhaQuestor = { ...base, chave_acesso: "c", classe: null, classe_nome: null, classe_origem: null, natureza: null, natureza_descricao: null };
    const { ws, col } = await planilha({ linhas: [base, sugerida, semClasse], de_para: [] });
    const nat = col("Natureza (Questor)");
    expect(ws.getRow(3).getCell(nat).value).toBe("8.000.001");
    expect(ws.getRow(3).getCell(nat).font?.italic).toBeFalsy();
    expect(ws.getRow(3).getCell(col("Classe veio de")).value).toBe("DocFin");
    expect(ws.getRow(4).getCell(nat).font?.italic).toBe(true);
    expect(ws.getRow(4).getCell(col("Classe veio de")).value).toBe("Sugerida (fornecedor)");
    expect(ws.getRow(5).getCell(nat).value).toBe("");
    expect(ws.getRow(3).getCell(col("Competência")).value).toEqual(new Date(Date.UTC(2026, 8, 30)));
  });

  it("leva o de/para numa aba própria", async () => {
    const { wb } = await planilha({
      linhas: [base],
      de_para: [
        { natureza: "8.000.001", natureza_descricao: "Servicos Tomados c/ Contabilidade", classe: "21.01", classe_nome: "CONTABILIDADE", observacao: null },
        { natureza: "8.000.008", natureza_descricao: "Servicos Tomados licenciamento ou Cessao de Direito", classe: null, classe_nome: null, observacao: null },
      ],
    });
    const dp = wb.getWorksheet("De-para")!;
    expect(dp.getRow(3).getCell(1).value).toBe("8.000.001");
    expect(dp.getRow(3).getCell(3).value).toBe("21.01");
    expect(dp.getRow(4).getCell(3).value).toBe("");
    expect(wb.getWorksheet("Sobre")).toBeDefined();
  });
});
