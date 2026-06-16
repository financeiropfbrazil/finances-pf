// src/services/buildMovEstqPayloadService.ts
//
// Etapa B — Builder do payload de lançamento de NF-e no Alvo (MovEstq).
//
// Camada de DADOS, pura (sem rede, sem Alvo). Monta o objeto do item do
// MovEstq a partir dos "ingredientes" que a operadora montou na tela:
//   - produto escolhido no ProductCombobox + busca complementar (stock_products)
//   - imposto extraído do XML pelo parseNfeXml (Caminho C1 — imposto do XML)
//   - natureza de operação escolhida no dropdown
//   - quantidade/valor digitados pela operadora
//   - classe/centro de custo do pedido (editável)
//   - lote manual (opcional; produto com controla_lote)
//
// Formato de saída = um item de ItemMovEstqChildList, espelhado no lançamento
// real validado (MovEstq 17575, E0000158, SISPACK NF 187035).
//
// NÃO substitui o alvoMovEstqLancarNfeService.ts antigo (que tem hardcodes).
// Service novo; a troca acontece quando a Etapa B inteira estiver validada.
//
// Decisões aplicadas (do artifact de plano §10–§12):
//  - CodigoProduto = código INTERNO (do cadastro), nunca o do fornecedor.
//  - Unidade = do cadastro (stock_products.unidade_medida), editável.
//  - Imposto = do XML (C1), editável. CBS/IBS ficam zerados (operadora preenche).
//  - CST do XML "00" → "000" no Alvo (zero-pad de 3 dígitos).
//  - Lote = manual, em branco; child só quando controla_lote=true.
//  - Classe/CC = do pedido, 100%.

// ── Tipos de entrada (os "ingredientes") ──────────────────────────────────

/** Imposto do item, como sai do parseNfeXml.ts (parseItemImposto). */
export interface ItemImpostoXml {
  icms_cst: string | null;
  icms_orig: string | null;
  icms_mod_bc: string | null;
  icms_base: number | null;
  icms_percentual: number | null;
  icms_valor: number | null;
  pis_cst: string | null;
  pis_base: number | null;
  pis_percentual: number | null;
  pis_valor: number | null;
  cofins_cst: string | null;
  cofins_base: number | null;
  cofins_percentual: number | null;
  cofins_valor: number | null;
  ipi_cst: string | null;
  ipi_base: number | null;
  ipi_percentual: number | null;
  ipi_valor: number | null;
}

/** Produto do cadastro (stock_products), via ProductCombobox + busca complementar. */
export interface ProdutoCadastro {
  codigo_produto: string; // interno, ex. "001.003.00104"
  nome_produto: string;
  unidade_medida: string; // ex. "UNID"
  classificacao_fiscal: string | null; // ex. "0000032"
  codigo_alternativo: string | null; // ex. "801861"
  controla_lote: boolean;
}

/** Lote manual (só quando controla_lote=true). Campos em branco por padrão. */
export interface LoteManual {
  numero: string; // NumeroCtrlLote (digitado)
  validade: string | null; // YYYY-MM-DD
  fabricacao: string | null; // YYYY-MM-DD
}

/** Vínculo ao pedido de compra (de-para). */
export interface VinculoPedido {
  numeroPedComp: string; // ex. "0004036"
  codigoProdutoPedComp: string; // código interno no pedido (= codigo_produto)
  sequenciaItemPedComp: number; // ex. 1
}

/** Tudo que o builder precisa para montar UM item. */
export interface BuildItemInput {
  sequencia: number; // posição do item no lançamento (1, 2, ...)
  produto: ProdutoCadastro;
  imposto: ItemImpostoXml;
  natureza: string; // CodigoNatOperacao do dropdown, ex. "1.101.003"
  quantidade: number; // digitada pela operadora
  valorUnitario: number; // digitado/ajustado pela operadora
  valorProduto: number; // total do item (qtd * unitário)
  classe: string; // do pedido, ex. "11.03"
  centroCusto: string; // do pedido, ex. "00010.00002.00007.00002"
  vinculo?: VinculoPedido | null;
  lote?: LoteManual; // presente só se produto.controla_lote
  codigoEntidade: string; // fornecedor, ex. "0000381"
}

const FILIAL = "1.01";

/** CST do XML (2 díg, "00") → CST do Alvo (3 díg, "000"). Zero-pad à esquerda. */
function cstParaAlvo(cst: string | null): string {
  if (!cst) return "000";
  return cst.padStart(3, "0");
}

function n(v: number | null | undefined): number {
  return v == null || isNaN(v) ? 0 : v;
}

// ── Builder do item ───────────────────────────────────────────────────────

/**
 * Monta um item de ItemMovEstqChildList no formato do molde 17575.
 * Função pura: mesmos ingredientes → mesmo item, sempre.
 */
export function buildItemMovEstq(input: BuildItemInput): any {
  const {
    sequencia,
    produto,
    imposto,
    natureza,
    quantidade,
    valorUnitario,
    valorProduto,
    classe,
    centroCusto,
    vinculo,
    lote,
    codigoEntidade,
  } = input;

  const unid = produto.unidade_medida || "UNID";

  // Rateio classe/CC do item (100% num CC só — decisão da Etapa B)
  const rateioClasse = [
    {
      CodigoEmpresaFilial: FILIAL,
      CodigoProduto: produto.codigo_produto,
      ChaveMovEstq: 1,
      SequenciaItemMovEstq: sequencia,
      CodigoClasseRecDesp: classe,
      Valor: valorProduto,
      Percentual: 100,
      RateioItemMovEstqChildList: [
        {
          CodigoEmpresaFilial: FILIAL,
          CodigoProduto: produto.codigo_produto,
          ChaveMovEstq: 1,
          SequenciaItemMovEstq: sequencia,
          CodigoClasseRecDesp: classe,
          CodigoCentroCtrl: centroCusto,
          Valor: valorProduto,
          Percentual: 100,
        },
      ],
    },
  ];

  // Local de armazenagem (default 001)
  const locArmaz = [
    {
      CodigoEmpresaFilial: FILIAL,
      CodigoProduto: produto.codigo_produto,
      SequenciaItemMovEstq: sequencia,
      CodigoLocArmaz: "001",
      QuantidadeProdUnidMedPrincipal: quantidade,
      Quantidade2: quantidade,
      Localizacao: "",
    },
  ];

  // Child de lote — só quando o produto controla lote
  const ctrlLote =
    produto.controla_lote && lote
      ? [
          {
            CodigoEmpresaFilial: FILIAL,
            CodigoProduto: produto.codigo_produto,
            NumeroCtrlLote: lote.numero,
            DataValidadeCtrlLote: lote.validade,
            DataFabricacao: lote.fabricacao,
            SequenciaItemMovEstq: sequencia,
            QuantidadeProdUnidMedPrincipal: quantidade,
            Quantidade2: quantidade,
            QuantidadeBruta: quantidade,
            Operacao: "Entrada",
            CodigoProdUnidMed: unid,
            CodigoLocArmaz: "001",
          },
        ]
      : [];

  return {
    CodigoEmpresaFilial: FILIAL,
    CodigoProduto: produto.codigo_produto, // INTERNO
    ChaveMovEstq: 0,
    Sequencia: sequencia,
    CodigoNatOperacao: natureza, // do dropdown
    ...(vinculo
      ? {
          CodigoEmpresaFilialPedComp: FILIAL,
          NumeroPedComp: vinculo.numeroPedComp,
          CodigoProdutoPedComp: vinculo.codigoProdutoPedComp,
          SequenciaItemPedComp: vinculo.sequenciaItemPedComp,
        }
      : {}),
    QuantidadeProdUnidMedPrincipal: quantidade, // operadora
    Quantidade2: quantidade,
    ValorProduto: valorProduto,
    ValorUnitario: valorUnitario,
    CodigoProdUnidMed: unid, // cadastro
    CodigoProdUnidMedValor: unid,
    PosicaoProdUnidMed: 1,
    NomeProduto: produto.nome_produto, // cadastro
    CodigoNCM: produto.classificacao_fiscal ? undefined : undefined, // NCM vem do XML no header do item; ver nota
    CodigoClasFiscal: produto.classificacao_fiscal, // cadastro
    CodigoAlternativoProduto: produto.codigo_alternativo,
    CodigoEntidade: codigoEntidade,
    ControlaLote: produto.controla_lote ? "Sim" : "Não",
    ControlaEstoque: "Não", // como no molde 17575
    ItemServico: "Não",

    // ── Imposto do XML (C1), editável na tela antes do envio ──
    CodigoSitTributaria: cstParaAlvo(imposto.icms_cst),
    BaseICMS: n(imposto.icms_base),
    BaseICMSReduzido: n(imposto.icms_base),
    PercentualICMS: n(imposto.icms_percentual),
    ValorICMS: n(imposto.icms_valor),
    BasePIS: n(imposto.pis_base),
    PercentualPIS: n(imposto.pis_percentual),
    ValorPIS: n(imposto.pis_valor),
    BaseCOFINS: n(imposto.cofins_base),
    PercentualCOFINS: n(imposto.cofins_percentual),
    ValorCOFINS: n(imposto.cofins_valor),
    BaseIPI: n(imposto.ipi_base),
    ValorIPI: n(imposto.ipi_valor),
    // CBS/IBS ficam zerados (não vêm no XML; operadora preenche se precisar)
    BaseCBS: 0,
    ValorCBS: 0,
    BaseIBSUF: 0,
    ValorIBSUF: 0,

    ItemMovEstqClasseRecdespChildList: rateioClasse,
    LocArmazItemMovEstqChildList: locArmaz,
    CtrlLoteItemMovEstqChildList: ctrlLote,
    ItemMovEstqUserFieldsObject: {},
  };
}

// ── Conferência contábil (validação para o controller) ────────────────────
//
// Roda no Console do Hub. Monta o item da SISPACK 187035 (item 1) com os
// ingredientes reais e compara com o lançamento real 17575, em português.
// Não precisa ler o código — só conferir os ✓.

export function conferenciaItem187035(): string {
  const item = buildItemMovEstq({
    sequencia: 1,
    produto: {
      codigo_produto: "001.003.00104",
      nome_produto: "INDICADOR BIOLÓGICO ETO 48 HORAS - BT10 - BIONOVA (C/100UN)",
      unidade_medida: "UNID",
      classificacao_fiscal: "0000032",
      codigo_alternativo: "801861",
      controla_lote: true,
    },
    imposto: {
      icms_cst: "00",
      icms_orig: "1",
      icms_mod_bc: "3",
      icms_base: 1732.5,
      icms_percentual: 18,
      icms_valor: 311.85,
      pis_cst: "01",
      pis_base: 1732.5,
      pis_percentual: 0.65,
      pis_valor: 11.26,
      cofins_cst: "01",
      cofins_base: 1732.5,
      cofins_percentual: 3,
      cofins_valor: 51.98,
      ipi_cst: "53",
      ipi_base: null,
      ipi_percentual: null,
      ipi_valor: null,
    },
    natureza: "1.101.003",
    quantidade: 100,
    valorUnitario: 17.325,
    valorProduto: 1732.5,
    classe: "11.03",
    centroCusto: "00010.00002.00007.00002",
    vinculo: { numeroPedComp: "0004036", codigoProdutoPedComp: "001.003.00104", sequenciaItemPedComp: 1 },
    lote: { numero: "0002572", validade: "2027-06-30", fabricacao: "2025-07-01" },
    codigoEntidade: "0000381",
  });

  const linhas: string[] = [];
  const conf = (nome: string, gerado: any, real: any) =>
    linhas.push(`${gerado === real ? "✓" : "✗"} ${nome}: gerado=${gerado} | real 17575=${real}`);

  conf("CodigoProduto (interno)", item.CodigoProduto, "001.003.00104");
  conf("CodigoNatOperacao", item.CodigoNatOperacao, "1.101.003");
  conf("Unidade", item.CodigoProdUnidMed, "UNID");
  conf("Quantidade", item.QuantidadeProdUnidMedPrincipal, 100);
  conf("ValorProduto", item.ValorProduto, 1732.5);
  conf("CST ICMS (00→000)", item.CodigoSitTributaria, "000");
  conf("BaseICMS", item.BaseICMS, 1732.5);
  conf("ValorICMS", item.ValorICMS, 311.85);
  conf("ValorPIS (0,65% do XML)", item.ValorPIS, 11.26);
  conf("ValorCOFINS (3% do XML)", item.ValorCOFINS, 51.98);
  conf("ClasseRecDesp", item.ItemMovEstqClasseRecdespChildList[0].CodigoClasseRecDesp, "11.03");
  conf(
    "CentroCusto",
    item.ItemMovEstqClasseRecdespChildList[0].RateioItemMovEstqChildList[0].CodigoCentroCtrl,
    "00010.00002.00007.00002",
  );
  conf("ControlaLote", item.ControlaLote, "Sim");
  conf("Lote (child gerado)", item.CtrlLoteItemMovEstqChildList[0]?.NumeroCtrlLote, "0002572");
  conf("Vínculo pedido", item.NumeroPedComp, "0004036");

  return linhas.join("\n");
}

// ══════════════════════════════════════════════════════════════════════════
// Builder do HEADER — monta o MovEstq completo
// ══════════════════════════════════════════════════════════════════════════
//
// Junta peças JÁ PRONTAS: cabeçalho + itens (de buildItemMovEstq) + parcelas
// (de gerarParcelas) + classe/CC do total. Função pura.
//
// Recebe o CodigoTipoLanc já decidido pela tela (produto de lote → E0000158,
// "automático com aviso"). O builder não decide o tipo.

/** Uma parcela já montada (formato do molde 17575). */
export interface ParcelaMovEstq {
  Sequencia: number;
  NumeroDuplicata: string;
  DataEmissao: string; // ISO
  ValorParcela: number;
  DataVencimento: string; // ISO
  DataProrrogacao: string; // ISO
  CodigoTipoCobranca: string; // default "0000021" (BOLETO OUTROS BANCOS)
}

export interface BuildHeaderInput {
  codigoTipoLanc: string; // já decidido (E0000158 / E0000003)
  numero: string; // número da NF
  serie: string; // default "1"
  especie: string; // default "NF-e"
  chaveAcessoNfe: string; // 44 díg, read-only
  dataEmissao: string; // ISO
  dataMovimento: string; // ISO (data de entrada)
  codigoEntidade: string; // fornecedor
  nomeEntidade: string;
  cpfCnpjEntidade: string;
  codigoCondPag: string; // ex. "0000037"
  codigoTipoPagRec: string; // tipo conta a pagar, default "0000016"
  valorTotal: number; // soma dos itens
  classeTotal: string; // classe do rateio do total
  centroCustoTotal: string;
  itens: any[]; // de buildItemMovEstq
  parcelas: ParcelaMovEstq[]; // de gerarParcelas
}

/**
 * Monta o MovEstq completo, pronto para enviar ao Save do Alvo.
 * Pura: mesmas peças → mesmo payload.
 */
export function montarMovEstq(input: BuildHeaderInput): any {
  const v = input.valorTotal;

  // Rateio classe/CC do total (header)
  const classeTotal = [
    {
      CodigoEmpresaFilial: FILIAL,
      ChaveMovEstq: 1,
      CodigoClasseRecDesp: input.classeTotal,
      Valor: v,
      Percentual: 100,
      RateioMovEstqChildList: [
        {
          CodigoEmpresaFilial: FILIAL,
          ChaveMovEstq: 1,
          CodigoClasseRecDesp: input.classeTotal,
          CodigoCentroCtrl: input.centroCustoTotal,
          Valor: v,
          Percentual: 100,
        },
      ],
    },
  ];

  const parcelas = input.parcelas.map((p) => ({
    CodigoEmpresaFilial: FILIAL,
    ChaveMovEstq: 1,
    Sequencia: p.Sequencia,
    EspecieDocumento: input.especie,
    SerieDocumento: input.serie,
    NumeroDuplicata: p.NumeroDuplicata,
    DataEmissao: p.DataEmissao,
    ValorParcela: p.ValorParcela,
    DataVencimento: p.DataVencimento,
    DataProrrogacao: p.DataProrrogacao,
    CodigoTipoCobranca: p.CodigoTipoCobranca,
  }));

  return {
    CodigoEmpresaFilial: FILIAL,
    Chave: 0,
    CodigoTipoLanc: input.codigoTipoLanc,
    Especie: input.especie,
    EspecieSelectBox: input.especie,
    Serie: input.serie,
    SerieSelectBox: input.serie,
    Numero: input.numero,
    NumeroDocumentoReferencia: input.numero,
    ChaveAcessoNFe: input.chaveAcessoNfe,
    DataEmissao: input.dataEmissao,
    DataMovimento: input.dataMovimento,
    DataEntrada: input.dataMovimento,
    CodigoEmpresaFilialDocumento: FILIAL,
    CodigoEntidade: input.codigoEntidade,
    NomeEntidade: input.nomeEntidade,
    CPFCNPJEntidade: input.cpfCnpjEntidade.replace(/\D/g, ""),
    CodigoCondPag: input.codigoCondPag,
    CodigoTipoPagRec: input.codigoTipoPagRec,
    CodigoIndEconomicoDocumento: "0000001", // Real
    ValorCambioDocumento: 1,
    CodigoEntidadeEmpresaFilial: "0000002",
    ValorMercadoria: v,
    ValorFinalMercadoria: v,
    ValorDocumento: v,
    ValorLiberado: v,
    ValorOriginal: v,
    ValorLiquidoDocumento: v,
    ValorTotalParcelas: v,
    Origem: "Estoque",
    Operacao: "Entrada",
    ControlaEstoque: "Não",
    RecalcularImpostos: false, // C1: tributos vêm prontos do XML
    ZerouImpostos: false,
    MovEstqNfEletronicaChildList: [
      {
        CodigoEmpresaFilial: FILIAL,
        ChaveNFEletronica: input.chaveAcessoNfe,
        Status: "Manual",
      },
    ],
    ItemMovEstqChildList: input.itens,
    MovEstqClasseRecDespChildList: classeTotal,
    ParcPagMovEstqChildList: parcelas,
  };
}

// ── Geração de parcelas (função à parte) ──────────────────────────────────
//
// A partir da condição de pagamento (qtd parcelas, dias entre, primeiro
// vencimento após), gera as parcelas. A operadora ajusta cada vencimento
// no Date Picker (fase de UI). Default de cobrança = "0000021".

export interface CondicaoPagamento {
  quantidade_parcelas: number;
  dias_entre_parcelas: number;
  primeiro_vencimento_apos: number;
}

function addDias(iso: string, dias: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + dias);
  return d.toISOString().split("T")[0] + "T00:00:00-03:00";
}

export function gerarParcelas(input: {
  numeroNf: string;
  dataEmissao: string; // ISO
  valorTotal: number;
  cond: CondicaoPagamento;
  codigoTipoCobranca?: string; // default "0000021"
}): ParcelaMovEstq[] {
  const qtd = Math.max(1, input.cond.quantidade_parcelas || 1);
  const diasEntre = input.cond.dias_entre_parcelas || 30;
  const primeiro = input.cond.primeiro_vencimento_apos || 30;
  const cobranca = input.codigoTipoCobranca || "0000021";

  // Divide o valor em qtd parcelas; última ajusta o centavo residual.
  const base = Math.floor((input.valorTotal / qtd) * 100) / 100;
  const parcelas: ParcelaMovEstq[] = [];
  for (let i = 0; i < qtd; i++) {
    const venc = addDias(input.dataEmissao, primeiro + diasEntre * i);
    const valor = i === qtd - 1 ? Number((input.valorTotal - base * (qtd - 1)).toFixed(2)) : base;
    parcelas.push({
      Sequencia: i + 1,
      NumeroDuplicata: `${input.numeroNf}/${i + 1}-${qtd}`,
      DataEmissao: input.dataEmissao,
      ValorParcela: valor,
      DataVencimento: venc,
      DataProrrogacao: venc,
      CodigoTipoCobranca: cobranca,
    });
  }
  return parcelas;
}

// ── Conferência do header (validação para o controller) ───────────────────
//
// Monta o MovEstq completo da SISPACK 187035 (2 itens) e compara com o
// lançamento real 17575, em português. Roda no Console (autocontido na tela).

export function conferenciaHeader187035(): string {
  const item1 = buildItemMovEstq({
    sequencia: 1,
    produto: {
      codigo_produto: "001.003.00104",
      nome_produto: "INDICADOR BIOLÓGICO ETO 48 HORAS - BT10 - BIONOVA (C/100UN)",
      unidade_medida: "UNID",
      classificacao_fiscal: "0000032",
      codigo_alternativo: "801861",
      controla_lote: true,
    },
    imposto: {
      icms_cst: "00",
      icms_orig: "1",
      icms_mod_bc: "3",
      icms_base: 1732.5,
      icms_percentual: 18,
      icms_valor: 311.85,
      pis_cst: "01",
      pis_base: 1732.5,
      pis_percentual: 0.65,
      pis_valor: 11.26,
      cofins_cst: "01",
      cofins_base: 1732.5,
      cofins_percentual: 3,
      cofins_valor: 51.98,
      ipi_cst: "53",
      ipi_base: null,
      ipi_percentual: null,
      ipi_valor: null,
    },
    natureza: "1.101.003",
    quantidade: 100,
    valorUnitario: 17.325,
    valorProduto: 1732.5,
    classe: "11.03",
    centroCusto: "00010.00002.00007.00002",
    vinculo: { numeroPedComp: "0004036", codigoProdutoPedComp: "001.003.00104", sequenciaItemPedComp: 1 },
    lote: { numero: "0002572", validade: "2027-06-30", fabricacao: "2025-07-01" },
    codigoEntidade: "0000381",
  });
  const item2 = buildItemMovEstq({
    sequencia: 2,
    produto: {
      codigo_produto: "001.003.00037",
      nome_produto: "INDICADOR DE LIMPEZA ULTRASSONICA - TESTE DE CAVITAÇÃO (CDWU)",
      unidade_medida: "UN",
      classificacao_fiscal: "0000581",
      codigo_alternativo: "800839",
      controla_lote: true,
    },
    imposto: {
      icms_cst: "00",
      icms_orig: "1",
      icms_mod_bc: "3",
      icms_base: 1039.5,
      icms_percentual: 18,
      icms_valor: 187.11,
      pis_cst: "01",
      pis_base: 1039.5,
      pis_percentual: 0.65,
      pis_valor: 6.76,
      cofins_cst: "01",
      cofins_base: 1039.5,
      cofins_percentual: 3,
      cofins_valor: 31.19,
      ipi_cst: "53",
      ipi_base: null,
      ipi_percentual: null,
      ipi_valor: null,
    },
    natureza: "1.101.003",
    quantidade: 30,
    valorUnitario: 34.65,
    valorProduto: 1039.5,
    classe: "11.03",
    centroCusto: "00010.00002.00007.00002",
    vinculo: { numeroPedComp: "0004036", codigoProdutoPedComp: "001.003.00037", sequenciaItemPedComp: 2 },
    lote: { numero: "0002573", validade: "2027-07-31", fabricacao: "2026-02-01" },
    codigoEntidade: "0000381",
  });

  const parcelas = gerarParcelas({
    numeroNf: "187035",
    dataEmissao: "2026-06-09T00:00:00-03:00",
    valorTotal: 2772,
    cond: { quantidade_parcelas: 1, dias_entre_parcelas: 30, primeiro_vencimento_apos: 30 },
  });

  const mov = montarMovEstq({
    codigoTipoLanc: "E0000158",
    numero: "187035",
    serie: "1",
    especie: "NF-e",
    chaveAcessoNfe: "35260654565478000198550010001870351588728391",
    dataEmissao: "2026-06-09T00:00:00-03:00",
    dataMovimento: "2026-06-12T00:00:00-03:00",
    codigoEntidade: "0000381",
    nomeEntidade: "SISPACK MEDICAL LTDA.",
    cpfCnpjEntidade: "54565478000198",
    codigoCondPag: "0000037",
    codigoTipoPagRec: "0000016",
    valorTotal: 2772,
    classeTotal: "11.03",
    centroCustoTotal: "00010.00002.00007.00002",
    itens: [item1, item2],
    parcelas,
  });

  const linhas: string[] = [];
  const conf = (nome: string, g: any, r: any) =>
    linhas.push(`${g === r ? "✓" : "✗"} ${nome}: gerado=${g} | real 17575=${r}`);

  conf("CodigoTipoLanc", mov.CodigoTipoLanc, "E0000158");
  conf("Numero", mov.Numero, "187035");
  conf("ChaveAcessoNFe", mov.ChaveAcessoNFe?.length, 44);
  conf("CodigoEntidade", mov.CodigoEntidade, "0000381");
  conf("CodigoCondPag", mov.CodigoCondPag, "0000037");
  conf("CodigoTipoPagRec (conta)", mov.CodigoTipoPagRec, "0000016");
  conf("ValorDocumento", mov.ValorDocumento, 2772);
  conf("Qtd itens", mov.ItemMovEstqChildList.length, 2);
  conf("RecalcularImpostos (C1)", mov.RecalcularImpostos, false);
  conf("Chave NF-e no child", mov.MovEstqNfEletronicaChildList[0].ChaveNFEletronica?.length, 44);
  conf("Status NF-e child", mov.MovEstqNfEletronicaChildList[0].Status, "Manual");
  conf("Qtd parcelas", mov.ParcPagMovEstqChildList.length, 1);
  conf("Parcela duplicata", mov.ParcPagMovEstqChildList[0].NumeroDuplicata, "187035/1-1");
  conf("Parcela cobrança (0000021)", mov.ParcPagMovEstqChildList[0].CodigoTipoCobranca, "0000021");
  conf("Parcela vencimento (emissão+30)", mov.ParcPagMovEstqChildList[0].DataVencimento.split("T")[0], "2026-07-09");
  conf("Classe total", mov.MovEstqClasseRecDespChildList[0].CodigoClasseRecDesp, "11.03");
  conf(
    "Soma itens = total",
    mov.ItemMovEstqChildList.reduce((s: number, it: any) => s + it.ValorProduto, 0),
    2772,
  );

  return linhas.join("\n");
}

// ══════════════════════════════════════════════════════════════════════════
// Ponte UI → payload (fatia 6)
// ══════════════════════════════════════════════════════════════════════════
//
// Converte o estado coletado no modal (itens da tabela + pagamento + dados da
// nota) no MovEstq completo, pronto para a rota /mov-estq/save.
//
// Os tipos de entrada espelham o que a UI produz (LancarNfeItensTable e
// LancarNfePagamento), mas mantidos frouxos (any) para não acoplar o service
// aos componentes. A UI passa os objetos como estão.

export interface MontarDoModalInput {
  // cabeçalho / nota
  codigoTipoLanc: string;
  numero: string;
  serie: string;
  especie?: string;
  chaveAcessoNfe: string;
  dataEmissao: string; // ISO (YYYY-MM-DD)
  dataMovimento?: string; // ISO; default = hoje
  codigoEntidade: string; // pedido_compra_entidade
  nomeEntidade: string;
  cpfCnpjEntidade: string;
  numeroPedComp?: string | null; // pedido_compra_numero (vínculo de cabeçalho)
  // itens (do estado da tabela)
  itens: Array<{
    produtoInterno: string;
    produtoNome: string;
    unidade: string;
    codigoAlternativo: string | null;
    classificacaoFiscal: string | null;
    controlaLote: boolean;
    natureza: string;
    classe: string;
    centroCusto: string;
    quantidade: number;
    valorUnitario: number;
    valorProduto: number;
    imposto: any; // ItemImposto da UI
    lote?: { numero: string; validade: string; fabricacao: string } | null;
    origemXml?: { ncm?: string | null } | null;
  }>;
  // pagamento (do estado do componente de pagamento)
  pagamento: {
    tipoContaPagar: string;
    parcelas: Array<{ sequencia: number; vencimento: Date | string; valor: number; tipoCobranca: string }>;
  };
}

function isoDate(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().split("T")[0] + "T00:00:00-03:00";
}

export function montarPayloadDoModal(input: MontarDoModalInput): any {
  const especie = input.especie || "NF-e";
  const dataMov = input.dataMovimento || new Date().toISOString().split("T")[0];

  // 1. Monta os itens via buildItemMovEstq.
  const itensPayload = input.itens.map((it, idx) => {
    const imp = it.imposto || {};
    return buildItemMovEstq({
      sequencia: idx + 1,
      produto: {
        codigo_produto: it.produtoInterno,
        nome_produto: it.produtoNome,
        unidade_medida: it.unidade,
        classificacao_fiscal: it.classificacaoFiscal,
        codigo_alternativo: it.codigoAlternativo,
        controla_lote: it.controlaLote,
      },
      imposto: {
        icms_cst: imp.icms_cst ?? null,
        icms_orig: imp.icms_orig ?? "1",
        icms_mod_bc: imp.icms_mod_bc ?? "3",
        icms_base: imp.icms_base ?? 0,
        icms_percentual: imp.icms_percentual ?? 0,
        icms_valor: imp.icms_valor ?? 0,
        pis_cst: imp.pis_cst ?? null,
        pis_base: imp.pis_base ?? 0,
        pis_percentual: imp.pis_percentual ?? 0,
        pis_valor: imp.pis_valor ?? 0,
        cofins_cst: imp.cofins_cst ?? null,
        cofins_base: imp.cofins_base ?? 0,
        cofins_percentual: imp.cofins_percentual ?? 0,
        cofins_valor: imp.cofins_valor ?? 0,
        ipi_cst: imp.ipi_cst ?? null,
        ipi_base: imp.ipi_base ?? 0,
        ipi_percentual: 0,
        ipi_valor: imp.ipi_valor ?? 0,
      } as any,
      natureza: it.natureza,
      quantidade: it.quantidade,
      valorUnitario: it.valorUnitario,
      valorProduto: it.valorProduto,
      classe: it.classe,
      centroCusto: it.centroCusto,
      // vínculo item-pedido: vazio por ora (descobrir no fire-test se é exigido).
      // Mantemos só o vínculo de cabeçalho (NumeroPedComp no header).
      vinculo: null,
      lote:
        it.controlaLote && it.lote && it.lote.numero
          ? { numero: it.lote.numero, validade: it.lote.validade || null, fabricacao: it.lote.fabricacao || null }
          : undefined,
      codigoEntidade: input.codigoEntidade,
    });
  });

  // 2. Monta as parcelas no formato do builder.
  const valorTotal = Number(input.itens.reduce((s, it) => s + it.valorProduto, 0).toFixed(2));
  const parcelas: ParcelaMovEstq[] = input.pagamento.parcelas.map((p) => ({
    Sequencia: p.sequencia,
    NumeroDuplicata: `${input.numero}/${p.sequencia}-${input.pagamento.parcelas.length}`,
    DataEmissao: isoDate(input.dataEmissao),
    ValorParcela: p.valor,
    DataVencimento: isoDate(p.vencimento),
    DataProrrogacao: isoDate(p.vencimento),
    CodigoTipoCobranca: p.tipoCobranca,
  }));

  // 3. Classe/CC do total: usa a do primeiro item (rateio único do cabeçalho).
  const classeTotal = input.itens[0]?.classe || "";
  const ccTotal = input.itens[0]?.centroCusto || "";

  // 4. Monta o MovEstq completo.
  const mov = montarMovEstq({
    codigoTipoLanc: input.codigoTipoLanc,
    numero: input.numero,
    serie: input.serie,
    especie,
    chaveAcessoNfe: input.chaveAcessoNfe,
    dataEmissao: isoDate(input.dataEmissao),
    dataMovimento: isoDate(dataMov),
    codigoEntidade: input.codigoEntidade,
    nomeEntidade: input.nomeEntidade,
    cpfCnpjEntidade: input.cpfCnpjEntidade,
    codigoCondPag: "", // o Alvo usa as parcelas; cond. pagamento informativa
    codigoTipoPagRec: input.pagamento.tipoContaPagar,
    valorTotal,
    classeTotal,
    centroCustoTotal: ccTotal,
    itens: itensPayload,
    parcelas,
  });

  // 5. Vínculo de cabeçalho com o pedido (se houver).
  if (input.numeroPedComp) {
    mov.NumeroPedComp = input.numeroPedComp;
    mov.CodigoEmpresaFilialPedComp = FILIAL;
  }

  return mov;
}
