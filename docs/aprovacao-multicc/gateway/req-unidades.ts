// Contrato Fator comprovado por Produto/Load + ReqComp/Insert nativo (0001480).
// Sem inferência de Divisor, unidades dependentes ou arredondamento implícito.
export interface UnidadeRequisicao {
  codigo: string; posicao: number; peso: number; tipo: string; compras: boolean;
}
type Json = Record<string, unknown>;
export function objetoAlvo(raw: unknown, campo: string): Json {
  if (!raw || typeof raw !== "object") throw new Error(`Load sem ${campo}`);
  const r = raw as Json;
  if (Array.isArray(r[campo])) return r;
  for (const k of ["data", "Data", "result", "Result", "Produto", "ReqComp", "listaReqComp"]) {
    if (r[k]) { try { return objetoAlvo(r[k], campo); } catch { /* outro envelope */ } }
  }
  if (Array.isArray(raw) && raw.length === 1) return objetoAlvo(raw[0], campo);
  throw new Error(`Load sem ${campo}`);
}
export function unidadesProduto(raw: unknown, codigo: string): UnidadeRequisicao[] {
  const p = objetoAlvo(raw, "ProdUnidMedChildList");
  if (p.Codigo !== codigo) throw new Error("Produto/Load não corresponde ao produto solicitado");
  const rows = p.ProdUnidMedChildList as Json[];
  const posicoes = new Set<number>();
  const unidades = rows.map(u => {
    if (u.CodigoProduto != null && u.CodigoProduto !== codigo) throw new Error("Unidade pertence a outro produto");
    const posicao = Number(u.Posicao);
    if (!Number.isInteger(posicao) || posicao <= 0 || posicoes.has(posicao)) throw new Error("Posição ausente ou duplicada no Produto/Load");
    posicoes.add(posicao);
    if (u.Dependente === "Sim" || [u.ExibeCampoComprimentoVenda, u.ExibeCampoLarguraVenda, u.ExibeCampoAlturaVenda].includes("Sim"))
      throw new Error("CONVERSAO_NAO_COMPROVADA: unidade dependente/dimensional exige captura de Insert");
    const codigoUnidade = String(u.CodigoUnidMedida ?? "");
    if (!codigoUnidade) throw new Error("Unidade sem código");
    return { codigo: codigoUnidade, posicao, peso: Number(u.Peso), tipo: String(u.PesoFatorDivisor ?? ""), compras: u.UnidadeMedidaCompras === "Sim" };
  });
  const base = unidades.find(u => u.posicao === 1);
  if (!base || base.peso !== 1 || base.tipo !== "Fator") throw new Error("CONVERSAO_NAO_COMPROVADA: base diferente de Fator 1 exige captura de Insert");
  return unidades;
}
const ESCALA = BigInt(1_000_000_000);
function decimal(v: number): bigint {
  if (!Number.isFinite(v) || v <= 0 || v >= 1_000_000_000 || Number(v.toFixed(9)) !== v)
    throw new Error("Quantidade/fator fora da precisão suportada (9 casas decimais)");
  return BigInt(v.toFixed(9).replace(".", ""));
}
export function converterSolicitada(solicitada: number, unidade: UnidadeRequisicao): number {
  if (unidade.tipo !== "Fator") throw new Error(`CONVERSAO_NAO_COMPROVADA: ${unidade.tipo || "tipo ausente"} exige Produto/Load e Insert nativo`);
  const produto = decimal(solicitada) * decimal(unidade.peso);
  if (produto % ESCALA !== BigInt(0)) throw new Error("Conversão exige mais de 9 casas: falta contrato de arredondamento do Alvo");
  const principal = Number(produto / ESCALA) / Number(ESCALA);
  decimal(principal);
  return principal;
}
export interface QuantidadesItem {
  codigo_prod_unid_med: string; posicao_prod_unid_med: number | null;
  quantidade_solicitada: number | null; quantidade: number;
}
export function quantidadesLoad(i: Json): QuantidadesItem {
  const principal = Number(i.QuantidadeProdUnidMedPrincipal);
  if (i.QuantidadeProdUnidMedPrincipal == null || !Number.isFinite(principal) || principal <= 0) throw new Error("Quantidade principal ausente/inválida no ReqComp/Load");
  const solicitada = i.Quantidade2 == null ? null : Number(i.Quantidade2);
  const posicao = i.PosicaoProdUnidMed == null ? null : Number(i.PosicaoProdUnidMed);
  if (solicitada !== null && (!Number.isFinite(solicitada) || solicitada <= 0)) throw new Error("Quantidade2 inválida no ReqComp/Load");
  if (posicao !== null && (!Number.isInteger(posicao) || posicao <= 0)) throw new Error("PosicaoProdUnidMed inválida no ReqComp/Load");
  if (!i.CodigoProdUnidMed) throw new Error("Unidade ausente no ReqComp/Load");
  return { codigo_prod_unid_med: String(i.CodigoProdUnidMed), posicao_prod_unid_med: posicao, quantidade_solicitada: solicitada, quantidade: principal };
}
export function exigirQuantidadesCompletas(i: QuantidadesItem): void {
  if (i.quantidade_solicitada == null || i.posicao_prod_unid_med == null || !i.codigo_prod_unid_med)
    throw new Error("HISTORICO_UNIDADE_INCOMPLETO: recuperar ReqComp/Load original com Quantidade2, QuantidadeProdUnidMedPrincipal, CodigoProdUnidMed e PosicaoProdUnidMed");
  decimal(Number(i.quantidade_solicitada)); decimal(Number(i.quantidade));
  if (!Number.isInteger(i.posicao_prod_unid_med) || i.posicao_prod_unid_med <= 0) throw new Error("Posição inválida");
}
export function validarItemCadastro(i: QuantidadesItem, unidades: UnidadeRequisicao[]): UnidadeRequisicao {
  exigirQuantidadesCompletas(i);
  const u = unidades.find(u => u.posicao === i.posicao_prod_unid_med && u.codigo === i.codigo_prod_unid_med);
  if (!u) throw new Error("Unidade/posição do item não existe mais no cadastro: revisar em nova requisição");
  const principal = converterSolicitada(Number(i.quantidade_solicitada), u);
  if (principal !== Number(i.quantidade)) throw new Error("Conversão do cadastro diverge da quantidade principal preservada: revisar em nova requisição");
  return u;
}
