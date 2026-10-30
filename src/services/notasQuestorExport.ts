/**
 * Excel para a contabilidade — natureza do Questor de cada NFS-e (PLANO-NFSE NFSE-1.16, Pedro 30/10/2026).
 * A contabilidade monta o arquivo de importação do Questor; o Hub entrega a classificação: a classe de despesa do
 * Alvo (DocFin, senão pedido, senão a única classe do fornecedor) e a natureza 8.000.xxx pelo de/para.
 *
 * Fonte: RPC `nfse_relatorio_questor` (período De/Até pela emissão). Como o download de etapas, sai com o período e
 * as notas que estão na lista no momento do clique.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  ROTULO_FISCO,
  baixarPlanilha,
  celData,
  celNumero,
  celTexto,
  escreverAbaComBlocos,
  escreverAbaSobre,
  fmtBR,
  type ColunaPlanilha,
  type ContextoExportEtapas,
} from "@/services/notasEtapasExport";

export type OrigemClasse = "docfin" | "pedido" | "fornecedor";

export interface LinhaQuestor {
  chave_acesso: string;
  numero: string | null;
  emissao: string | null;
  competencia: string | null;
  cnpj: string | null;
  prestador: string | null;
  municipio: string | null;
  valor_servico: number | null;
  valor_liquido: number | null;
  situacao_fisco: string | null;
  situacao_alvo: string | null;
  lancado_em: string | null;
  pedidos: string | null;
  docfin: number | null;
  codigo_servico: string | null;
  descricao_servico: string | null;
  classe: string | null;
  classe_nome: string | null;
  classe_origem: OrigemClasse | null;
  outras_classes: string | null;
  natureza: string | null;
  natureza_descricao: string | null;
}

export interface LinhaDePara {
  natureza: string;
  natureza_descricao: string;
  classe: string | null;
  classe_nome: string | null;
  observacao: string | null;
}

export interface RelatorioQuestor {
  linhas: LinhaQuestor[];
  de_para: LinhaDePara[];
}

export async function buscarRelatorioQuestor(de: string, ate: string): Promise<RelatorioQuestor> {
  const { data, error } = await (supabase as any).rpc("nfse_relatorio_questor", { p_de: de, p_ate: ate });
  if (error) throw new Error(error.message);
  const r = (data ?? {}) as Partial<RelatorioQuestor>;
  return { linhas: r.linhas ?? [], de_para: r.de_para ?? [] };
}

const BLOCOS: Record<string, string> = {
  Nota: "FF0891B2",
  Classificação: "FF7C3AED",
  Alvo: "FF059669",
};

const ROTULO_ORIGEM: Record<OrigemClasse, string> = {
  docfin: "DocFin",
  pedido: "Pedido",
  fornecedor: "Sugerida (fornecedor)",
};

const ROTULO_ALVO: Record<string, string> = {
  lancada_nfse: "Lançada",
  lancada_outra_especie: "Lançada em outra espécie",
  nao_lancada: "Não lançada",
  sem_dado_alvo: "Sem dado do Alvo",
};

const sugerida = (l: LinhaQuestor) => l.classe_origem === "fornecedor";

const COLUNAS: ColunaPlanilha<LinhaQuestor>[] = [
  { bloco: "Nota", label: "Número", tipo: "texto", largura: 12, valor: (l) => celTexto(l.numero) },
  { bloco: "Nota", label: "Emissão", tipo: "data", largura: 11, valor: (l) => celData(l.emissao) },
  { bloco: "Nota", label: "Competência", tipo: "data", largura: 11, valor: (l) => celData(l.competencia) },
  { bloco: "Nota", label: "Prestador", tipo: "texto", largura: 36, valor: (l) => celTexto(l.prestador) },
  { bloco: "Nota", label: "CNPJ/CPF do prestador", tipo: "texto", largura: 17, valor: (l) => celTexto(l.cnpj) },
  { bloco: "Nota", label: "Município", tipo: "texto", largura: 18, valor: (l) => celTexto(l.municipio) },
  { bloco: "Nota", label: "Valor do serviço", tipo: "valor", largura: 14, valor: (l) => celNumero(l.valor_servico) },
  { bloco: "Nota", label: "Valor líquido", tipo: "valor", largura: 14, valor: (l) => celNumero(l.valor_liquido) },
  {
    bloco: "Nota",
    label: "Situação no fisco",
    tipo: "texto",
    largura: 13,
    valor: (l) => ROTULO_FISCO[l.situacao_fisco ?? ""] ?? celTexto(l.situacao_fisco),
  },
  { bloco: "Nota", label: "Código do serviço", tipo: "texto", largura: 10, valor: (l) => celTexto(l.codigo_servico) },
  { bloco: "Nota", label: "Descrição do serviço", tipo: "texto", largura: 48, valor: (l) => celTexto(l.descricao_servico) },
  { bloco: "Nota", label: "Chave de acesso", tipo: "texto", largura: 52, valor: (l) => celTexto(l.chave_acesso) },

  { bloco: "Classificação", label: "Natureza (Questor)", tipo: "texto", largura: 12, provisorio: sugerida, valor: (l) => celTexto(l.natureza) },
  {
    bloco: "Classificação",
    label: "Descrição da natureza",
    tipo: "texto",
    largura: 40,
    provisorio: sugerida,
    valor: (l) => celTexto(l.natureza_descricao),
  },
  { bloco: "Classificação", label: "Classe (Alvo)", tipo: "texto", largura: 9, provisorio: sugerida, valor: (l) => celTexto(l.classe) },
  { bloco: "Classificação", label: "Nome da classe", tipo: "texto", largura: 32, provisorio: sugerida, valor: (l) => celTexto(l.classe_nome) },
  {
    bloco: "Classificação",
    label: "Classe veio de",
    tipo: "texto",
    largura: 14,
    provisorio: sugerida,
    valor: (l) => (l.classe_origem ? ROTULO_ORIGEM[l.classe_origem] : ""),
  },
  { bloco: "Classificação", label: "Outras classes da nota", tipo: "texto", largura: 32, valor: (l) => celTexto(l.outras_classes) },

  { bloco: "Alvo", label: "Situação no Alvo", tipo: "texto", largura: 14, valor: (l) => ROTULO_ALVO[l.situacao_alvo ?? ""] ?? celTexto(l.situacao_alvo) },
  { bloco: "Alvo", label: "Lançada no Alvo em", tipo: "data", largura: 11, valor: (l) => celData(l.lancado_em) },
  { bloco: "Alvo", label: "Pedido", tipo: "texto", largura: 14, valor: (l) => celTexto(l.pedidos) },
  { bloco: "Alvo", label: "DocFin", tipo: "inteiro", largura: 10, valor: (l) => celNumero(l.docfin) },
];

const COLUNAS_DE_PARA: ColunaPlanilha<LinhaDePara>[] = [
  { bloco: "Questor", label: "Natureza", tipo: "texto", largura: 12, valor: (l) => l.natureza },
  { bloco: "Questor", label: "Descrição", tipo: "texto", largura: 60, valor: (l) => l.natureza_descricao },
  { bloco: "Alvo", label: "Classe", tipo: "texto", largura: 9, valor: (l) => celTexto(l.classe) },
  { bloco: "Alvo", label: "Nome da classe", tipo: "texto", largura: 48, valor: (l) => celTexto(l.classe_nome) },
  { bloco: "Alvo", label: "Observação", tipo: "texto", largura: 70, valor: (l) => celTexto(l.observacao) },
];

const REGRAS: [string, string][] = [
  ["Período", "Pela data de emissão da nota, inclusive. É o período escolhido na tela no momento do download."],
  ["Natureza (Questor)", "Pela classe de despesa da nota no Alvo e o de/para da aba \"De-para\". Vazia = a nota não tem classe no Hub ou a classe não tem natureza no de/para — classificar à mão."],
  ["Classe (Alvo)", "A classe de maior valor da nota. A classe 09.04 (multa/juros) nunca conta — entra no título na hora do pagamento, não é o serviço."],
  ["Classe veio de", "DocFin = rateio do título no Alvo (o lançamento contábil) · Pedido = classe do pedido do lançamento (quando o Hub não tem o rateio do título) · Sugerida (fornecedor) = a nota não tem título nem pedido com classe, mas todos os pedidos e títulos do prestador no Hub têm uma única classe — em itálico laranja, conferir."],
  ["Outras classes da nota", "Quando a nota foi rateada em mais de uma classe, as demais (da maior para a menor)."],
  ["De-para", "Aba \"De-para\": cada natureza da lista da contabilidade e as classes do Alvo ligadas a ela. \"Provisória\" na observação = havia duas naturezas possíveis; a escolhida pode mudar."],
  ["Código do serviço", "Código de tributação nacional (cTribNac) do XML da nota: item e subitem da LC 116 + desdobramento."],
  ["Situação no Alvo", "Lançada = título da NFS-e no contas a pagar do Alvo; Não lançada = ainda não; Sem dado do Alvo = emitida antes do início do espelho do contas a pagar."],
];

export async function montarPlanilhaQuestor(rel: RelatorioQuestor, ctx: ContextoExportEtapas) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Financial Hub";
  wb.created = new Date();

  const ws = wb.addWorksheet("NFS-e", { views: [{ state: "frozen", xSplit: 1, ySplit: 2 }] });
  escreverAbaComBlocos(ws, COLUNAS, rel.linhas, BLOCOS);

  const dp = wb.addWorksheet("De-para", { views: [{ state: "frozen", ySplit: 2 }] });
  escreverAbaComBlocos(dp, COLUNAS_DE_PARA, rel.de_para, { Questor: "FF7C3AED", Alvo: "FF059669" });

  const conta = (f: (l: LinhaQuestor) => boolean) => String(rel.linhas.filter(f).length);
  escreverAbaSobre(wb, [
    ["Relatório", "Notas de Serviço (NFS-e) — natureza do Questor para a contabilidade"],
    ["Período (emissão)", `${fmtBR(ctx.de)} a ${fmtBR(ctx.ate)}`],
    ["Filtros da tela", ctx.filtros.length ? ctx.filtros.join(" · ") : "Nenhum"],
    ["Notas exportadas", String(rel.linhas.length)],
    ["Com natureza", conta((l) => !!l.natureza)],
    ["  · sugeridas pelo fornecedor", conta((l) => !!l.natureza && sugerida(l))],
    ["Sem natureza", conta((l) => !l.natureza)],
    ["  · com classe sem de/para", conta((l) => !l.natureza && !!l.classe)],
    ["Exportado em", new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) + " (Brasília)"],
    ["", ""],
    ...REGRAS,
  ]);

  return wb;
}

export async function exportarQuestorXLSX(
  rel: RelatorioQuestor,
  ctx: ContextoExportEtapas,
): Promise<{ arquivo: string; linhas: number; semNatureza: number }> {
  const wb = await montarPlanilhaQuestor(rel, ctx);
  const arquivo = `notas-servico-questor_${ctx.de}_a_${ctx.ate}.xlsx`;
  await baixarPlanilha(wb, arquivo);
  return { arquivo, linhas: rel.linhas.length, semNatureza: rel.linhas.filter((l) => !l.natureza).length };
}
