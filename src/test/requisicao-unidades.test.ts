import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { converterSolicitada, exigirQuantidadesCompletas, quantidadesLoad, unidadesProduto, validarItemCadastro } from "../../supabase/functions/_shared/requisicao-unidades";

const produto = JSON.parse(readFileSync("docs/aprovacao-multicc/load-gpt6-1.txt", "utf8"));
const codigo = "001.013.00382";
export const itensReais = [1, 2].map(n => ({ Sequencia: n, CodigoProduto: codigo, CodigoProdUnidMed: "UNID", PosicaoProdUnidMed: 2, Quantidade2: n === 1 ? 10 : 20, QuantidadeProdUnidMedPrincipal: n, DataNecessidade: "2026-09-10", CodigoCentroCtrl: "B" }));

describe("cadastro e quantidades reais", () => {
  it.each(itensReais)("UNID item $Sequencia preserva solicitada e principal", item => {
    const unidades = unidadesProduto(produto, codigo);
    expect(unidades.find(u => u.compras)).toMatchObject({ codigo: "UNID", posicao: 2, peso: 0.1, tipo: "Fator" });
    const tuple = quantidadesLoad(item);
    expect(converterSolicitada(item.Quantidade2, unidades[1])).toBe(item.QuantidadeProdUnidMedPrincipal);
    expect(validarItemCadastro(tuple, unidades).posicao).toBe(2);
    expect(tuple).toEqual({ codigo_prod_unid_med: "UNID", posicao_prod_unid_med: 2, quantidade_solicitada: item.Quantidade2, quantidade: item.QuantidadeProdUnidMedPrincipal });
  });
  it("outro produto usa seu próprio fator e códigos repetidos mantêm posições", () => {
    const outro = structuredClone(produto); outro.Codigo = "OUTRO";
    outro.ProdUnidMedChildList.forEach((u: Record<string, unknown>) => { u.CodigoProduto = "OUTRO"; });
    outro.ProdUnidMedChildList[1].Peso = 0.25;
    outro.ProdUnidMedChildList.push({ ...outro.ProdUnidMedChildList[1], Posicao: 3, Peso: 0.5 });
    const unidades = unidadesProduto(outro, "OUTRO");
    expect(converterSolicitada(12, unidades[1])).toBe(3);
    expect(converterSolicitada(12, unidades[2])).toBe(6);
  });
  it("aritmética decimal não introduz 0.30000000000000004", () => {
    expect(converterSolicitada(3, unidadesProduto(produto,codigo)[1])).toBe(0.3);
  });
  it("Divisor exige outra captura de escrita", () => {
    const u = { ...unidadesProduto(produto,codigo)[1], tipo: "Divisor" };
    expect(() => converterSolicitada(10,u)).toThrow("Divisor");
  });
  it("precisão não comprovada não arredonda silenciosamente", () => {
    expect(() => converterSolicitada(0.000000001, unidadesProduto(produto,codigo)[1])).toThrow("arredondamento");
  });
  it("Load incompleto permanece incompleto e não é clonado por suposição", () => {
    const i = quantidadesLoad({ ...itensReais[0], Quantidade2: undefined, PosicaoProdUnidMed: undefined });
    expect(i.quantidade_solicitada).toBeNull(); expect(i.posicao_prod_unid_med).toBeNull();
    expect(() => exigirQuantidadesCompletas(i)).toThrow("HISTORICO_UNIDADE_INCOMPLETO");
  });
  it("identidade de produto e posição ambígua são recusadas", () => {
    expect(() => unidadesProduto(produto,"OUTRO")).toThrow("não corresponde");
    const duplicado = structuredClone(produto); duplicado.ProdUnidMedChildList.push(duplicado.ProdUnidMedChildList[1]);
    expect(() => unidadesProduto(duplicado,codigo)).toThrow("duplicada");
  });
});

it("normalizador real do cron preserva os quatro campos do ReqComp/Load", () => {
  const source = readFileSync("supabase/functions/sync-compras-status-cron/index.ts", "utf8");
  const ast = ts.createSourceFile("cron.ts", source, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && ["textoObrigatorioAlvo", "extrairItensRequisicaoAlvo"].includes(n.name?.text || "")).map(n => n.getText(ast)).join("\n");
  const js = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const extrair = new Function("quantidadesLoad", `${js}; return extrairItensRequisicaoAlvo;`)(quantidadesLoad);
  expect(extrair({ ItemReqCompChildList: itensReais }, {}).map((i: Record<string, unknown>) => [i.quantidade_solicitada,i.quantidade,i.codigo_prod_unid_med,i.posicao_prod_unid_med])).toEqual([[10,1,"UNID",2],[20,2,"UNID",2]]);
});

it("cron atualiza quantidades mesmo quando o CC não mudou", async () => {
  const source = readFileSync("supabase/functions/sync-compras-status-cron/index.ts", "utf8");
  const ast = ts.createSourceFile("cron.ts", source, ts.ScriptTarget.Latest, true);
  const names = ["textoObrigatorioAlvo", "extrairItensRequisicaoAlvo", "espelharDetalheRequisicao"];
  const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text || "")).map(n => n.getText(ast)).join("\n");
  const js = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const espelhar = new Function("quantidadesLoad", "extrairRateioRequisicaoAlvo", `${js}; return espelharDetalheRequisicao;`)(quantidadesLoad, () => []);
  const writes: Record<string, unknown>[] = [];
  const db = {
    rpc: async () => ({ data: {}, error: null }),
    from: () => ({
      select: () => ({ eq: async () => ({ data: itensReais.map(i => ({ id: String(i.Sequencia), sequencia: i.Sequencia, codigo_produto: codigo, codigo_centro_ctrl: "B" })), error: null }) }),
      update: (value: Record<string, unknown>) => { writes.push(value); return { eq: async () => ({ error: null }) }; },
    }),
  };
  await espelhar(db, { id: "req" }, { ItemReqCompChildList: itensReais }, {});
  expect(writes.map(i => [i.quantidade_solicitada,i.quantidade,i.codigo_prod_unid_med,i.posicao_prod_unid_med])).toEqual([[10,1,"UNID",2],[20,2,"UNID",2]]);
});
