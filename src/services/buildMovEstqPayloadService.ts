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
  vinculo: VinculoPedido;
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
    CodigoEmpresaFilialPedComp: FILIAL,
    NumeroPedComp: vinculo.numeroPedComp,
    CodigoProdutoPedComp: vinculo.codigoProdutoPedComp,
    SequenciaItemPedComp: vinculo.sequenciaItemPedComp,
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
