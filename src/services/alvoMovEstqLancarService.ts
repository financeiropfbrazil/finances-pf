import { authenticateAlvo, clearAlvoToken } from "./alvoService";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Interfaces públicas (NÃO alterar — o modal e a page dependem) ──

export interface CCRateioInput {
  codigoCentroCtrl: string;
  percentual: number;
  valor: number;
}

export interface ClasseRateioInput {
  codigoClasseRecDesp: string;
  percentual: number;
  valor: number;
  centrosCusto: CCRateioInput[];
}

export interface ParcelaMovEstqInput {
  sequencia: number;
  numeroDuplicata: string;
  dataEmissao: string;
  valorParcela: number;
  dataVencimento: string;
}

export interface ImpostosMovEstqInput {
  baseISS: number; aliquotaISS: number; valorISS: number; deduzISSValorTotal: string;
  baseIRRF: number; aliquotaIRRF: number; valorIRRF: number; deduzIRRFValorTotal: string;
  baseINSS: number; aliquotaINSS: number; valorINSS: number; deduzINSSValorTotal: string;
  basePIS: number; aliquotaPIS: number; valorPIS: number; deduzPISValorTotal: string;
  baseCOFINS: number; aliquotaCOFINS: number; valorCOFINS: number; deduzCOFINSValorTotal: string;
  baseCSLL: number; aliquotaCSLL: number; valorCSLL: number; deduzCSLLValorTotal: string;
}

export interface LancarNfseInput {
  numero: string;
  serie: string;
  dataEmissao: string;
  valorServico: number;
  prestadorCnpj: string;
  prestadorNome: string;
  pedidoNumero: string;
  classes: ClasseRateioInput[];
  codigoCondPag: string;
  codigoEntidade: string;
  codigoProduto: string;
  nomeProduto: string;
  sequenciaItemPedComp: number;
  impostos?: ImpostosMovEstqInput;
  parcelas?: ParcelaMovEstqInput[];
  danfsePdfBlob?: Blob;
  xmlBlob?: Blob;
  chaveAcesso?: string;
}

export interface LancarNfseResult {
  success: boolean;
  chave?: number;
  error?: string;
}

// ── Helpers de data ──

function toAlvoIsoDate(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T03:00:00.000Z`;
}

function toAlvoIsoDateFromYMD(ymd: string): string {
  return `${ymd}T03:00:00.000Z`;
}

// ── Builder do payload (será preenchido em NFSE-V2-PART2) ──

function buildPayload(input: LancarNfseInput, uploadUuid: string): any {
  const v = input.valorServico;
  const cnpj = input.prestadorCnpj.replace(/\D/g, "");
  const hoje = toAlvoIsoDate(new Date());
  const dataEmissao = toAlvoIsoDate(input.dataEmissao);
  const serie = input.serie || "1";

  // Parcelas — usa as fornecidas; se vazio, cria parcela única no dia da emissão
  const parcelasInput = (input.parcelas && input.parcelas.length > 0) ? input.parcelas : [{
    sequencia: 1,
    numeroDuplicata: `${input.numero}/1-1`,
    dataEmissao: input.dataEmissao.slice(0, 10),
    valorParcela: v,
    dataVencimento: input.dataEmissao.slice(0, 10),
  }];
  const parcelasChild = parcelasInput.map(p => ({
    CodigoEmpresaFilial: "1.01",
    ChaveMovEstq: 1,
    Sequencia: p.sequencia,
    EspecieDocumento: "NFS-e",
    SerieDocumento: serie,
    NumeroDuplicata: p.numeroDuplicata,
    DataEmissao: toAlvoIsoDateFromYMD(p.dataEmissao),
    ValorParcela: p.valorParcela,
    DataVencimento: toAlvoIsoDateFromYMD(p.dataVencimento),
    DataProrrogacao: toAlvoIsoDateFromYMD(p.dataVencimento),
    CodigoTipoCobranca: "0000001",
  }));

  // Classes com rateio de centros de custo
  const classesChild = input.classes.map(c => ({
    CodigoEmpresaFilial: "1.01",
    ChaveMovEstq: 1,
    CodigoClasseRecDesp: c.codigoClasseRecDesp,
    Valor: c.valor,
    Percentual: c.percentual,
    RateioMovEstqChildList: c.centrosCusto.map(cc => ({
      CodigoEmpresaFilial: "1.01",
      ChaveMovEstq: 1,
      CodigoClasseRecDesp: c.codigoClasseRecDesp,
      CodigoCentroCtrl: cc.codigoCentroCtrl,
      Valor: cc.valor,
      Percentual: cc.percentual,
    })),
  }));

  const item: any = {
    CodigoEmpresaFilial: "1.01",
    CodigoProduto: input.codigoProduto,
    ChaveMovEstq: 0, Sequencia: 0,
    DataMovimento: hoje,
    CodigoTipoLanc: "E0000091",
    CodigoNatOperacao: "1.933",
    CodigoEmpresaFilialPedComp: "1.01",
    NumeroPedComp: input.pedidoNumero,
    QuantidadeProdUnidMedPrincipal: 1,
    ValorProduto: v,
    CodigoProdUnidMed: "UNID",
    PosicaoProdUnidMed: 1,
    Peso: 1,
    ItemServico: "Sim",
    Quantidade2: 1,
    ControlaEstoque: "Não",
    DesmembramentoSequenciaParcelaItemContratoOrcam: 0,
    CodigoTributA: "0",
    CodigoTributB: "90",
    CodigoEmpresaFilialContratoOrcam: "1.01",
    CodigoClasFiscal: "0000002",
    CodigoProdUnidMedValor: "UNID",
    CodigoEntidade: input.codigoEntidade,
    NomeProduto: input.nomeProduto,
    CodigoProdutoPedComp: input.codigoProduto,
    SequenciaItemPedComp: input.sequenciaItemPedComp,
    QuantidadePatrimonio: 1,
    TipoConfigTributPIS: "PIS",
    TipoConfigTributCOFINS: "COFINS",
    CodigoConfigTributIPI: "03",
    CodigoConfigTributPIS: "98",
    CodigoConfigTributCOFINS: "98",
    ValorUnitario: v,
    CodigoSitTributariaIBSCBS: "",
    ItemMovEstqUserFieldsObject: {},
    ItemValorCompararClasseReceitaDespesa: v,
  };

  // Header do MovEstq
  const payload: any = {
    Chamou: "DataVencimento", ChamouClasse: "Servico",
    NumeroPedComp: input.pedidoNumero, IPIInclusoBaseICMS: "Não",
    CodigoEmpresaFilial: "1.01", Chave: 0, CodigoTipoLanc: "E0000091",
    DataMovimento: hoje, DataEmissao: dataEmissao, DataEntrada: hoje,
    CodigoEmpresaFilialDocumento: "1.01",
    Especie: "NFS-e", EspecieSelectBox: "NFS-e",
    Serie: serie, SerieSelectBox: serie,
    Numero: input.numero,
    CodigoEntidade: input.codigoEntidade,
    NomeEntidade: input.prestadorNome, CPFCNPJEntidade: cnpj,
    SiglaPaisEntidade: "BRA",
    ValorServico: v, ValorTotalServico: v, ValorDocumento: v,
    ValorLiberado: v, ValorOriginal: v, ValorLiquidoDocumento: v,
    ValorCompararClasseReceitaDespesa: v, ValorCompoeFinanceiro: v, ValorTotalParcelas: v,
    CodigoCondPag: input.codigoCondPag, CodigoCondPagAnterior: input.codigoCondPag,
    CodigoTipoPagRec: "0000016",
    CodigoIndEconomicoDocumento: "0000001", ValorCambioDocumento: 1,
    CasasDecimaisValorUnitario: 5,
    RateioAutomaticoDespesasDiversas: "Sim",
    DeduzISSValorTotal: "Não", DeduzINSSValorTotal: "Não", DeduzIRRFValorTotal: "Não",
    DeduzPISProdutoValorTotal: "Não", DeduzCOFINSProdutoValorTotal: "Não",
    IcmsMovEstqChildList: [{ CodigoEmpresaFilial: "", Chave: 1, PercentualICMS: 0 }],
    ItemMovEstqChildList: [item],
    MovEstqArquivoChildList: [{
      CodigoEmpresaFilial: -1, ChaveMovEstq: -1, Sequencia: -1,
      Arquivo: null, UploadIdentify: uploadUuid,
    }],
    MovEstqClasseRecDespChildList: classesChild,
    ParcPagMovEstqChildList: parcelasChild,
    TipoFormulario: "Normal", ChaveAcessoNFe: input.chaveAcesso || null,
    SiglaPaisEmpresa: "BRA", SiglaUnidFederacaoEmpresa: "SP",
    ZerouImpostos: false, RecalcularImpostos: false,
    TipoLancamento: "Compra", EspecieLancamento: "Consumo", OperacaoLancamento: "Entrada",
    CodigoLocArmazLancamento: null, IndustrializacaoConjunta: false, Importacao: false,
    CodigoEntidadeEmpresaFilial: "0000002", InscricaoSuframaEmpresa: null,
    ZonaFrancaEmpresa: "Não", DiferencaMaiorDesconto: 0, ValorFatorICMSST: 0,
    LiberaST: "Não", CalculaRateioClasseRecDesp: "Não",
    TipoDevolucao: 0, TipoRetorno: 0, TipoComplemento: 0, TipoTransferencia: 0,
    TipoVenda: 0, TipoRemessa: 0, TipoCompra: 1,
    EspecieImportacao: 0, EspecieFrete: 0, EspeciePreco: 0,
    TipoLancamentoIntegraFinanceiro: 1, TipoLancamentoIntegraCompras: 1,
    TipoLancamentoIntegraContratoOrcamentario: 0, TipoLancamentoIntegraContrato: 0,
    TipoLancamentoNecessitaCentroControle: 1, TipoLancamentoRepasseTerceiros: 0,
    TipoLancamentoGeraControleEstoqueTerceiros: 0, TipoLancamentoGeraControleEstoque: 0,
    TipoLancamentoIntegraProjeto: 0, TipoLancamentoIntegraSC: 0,
    TipoLancamentoIntregraExecucaoOrcamentaria: 0,
    TipoLancamentoRelacionaMovimentoEstoqueOrdemServico: 0,
    DataMovimentoAnterior: null, ValorDocumentoAnterior: -1,
    TipoOrdemContrato: "", ChaveMovimentacaoCusto: false,
    IsSuppressVerificationOfRulesAndIntegration: false,
    ConfiguracaoAlteraMovEstqLaudoConcluido: false,
    ExisteFinanceiroRealizado: 0, ChaveTransferenciaEntreEmpresa: false,
    DeletarClasseMovEstq: false, UploadIdentify: "",
    filesToUpload: [{ key: `${uploadUuid}#Arquivo`, file: {} }],
  };

  return payload;
}

// ── Caller (será preenchido em NFSE-V2-PART3) ──

export async function lancarNfseNoAlvo(_input: LancarNfseInput): Promise<LancarNfseResult> {
  return { success: false, error: "lancarNfseNoAlvo not yet implemented — apply NFSE-V2-PART3" };
}
