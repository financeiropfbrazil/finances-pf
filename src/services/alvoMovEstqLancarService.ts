import { authenticateAlvo, clearAlvoToken } from "./alvoService";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Tipos ──

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
  baseISS: number;
  aliquotaISS: number;
  valorISS: number;
  deduzISSValorTotal: string;
  baseIRRF: number;
  aliquotaIRRF: number;
  valorIRRF: number;
  deduzIRRFValorTotal: string;
  baseINSS: number;
  aliquotaINSS: number;
  valorINSS: number;
  deduzINSSValorTotal: string;
  basePIS: number;
  aliquotaPIS: number;
  valorPIS: number;
  deduzPISValorTotal: string;
  baseCOFINS: number;
  aliquotaCOFINS: number;
  valorCOFINS: number;
  deduzCOFINSValorTotal: string;
  baseCSLL: number;
  aliquotaCSLL: number;
  valorCSLL: number;
  deduzCSLLValorTotal: string;
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
  codigoAlternativoProduto?: string | null;
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

function fmtAlvoDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T00:00:00`;
}

function fmtAlvoDateFromYMD(ymd: string): string {
  return `${ymd}T00:00:00`;
}

// ── Fetchers ──

interface EntidadeData {
  Endereco: string | null;
  NumeroEndereco: string | null;
  ComplementoEndereco: string;
  Bairro: string | null;
  CodigoCidade: string | null;
  RGIE: string | null;
}

interface CidadeData {
  NomeCompleto: string | null;
  SiglaUnidFederacao: string | null;
  SiglaPais: string | null;
}

async function fetchEntidade(codigo: string, token: string): Promise<EntidadeData> {
  try {
    const url = `${ERP_BASE_URL}/entidade/Load?codigo=${codigo}&loadChild=All&loadOneToOne=All`;
    const resp = await fetch(url, { headers: { "riosoft-token": token } });
    if (!resp.ok) {
      console.warn(`[fetchEntidade] HTTP ${resp.status} para ${codigo}`);
      return {
        Endereco: null,
        NumeroEndereco: null,
        ComplementoEndereco: "",
        Bairro: null,
        CodigoCidade: null,
        RGIE: null,
      };
    }
    const data = await resp.json();
    return {
      Endereco: data?.Endereco ?? null,
      NumeroEndereco: data?.NumeroEndereco ?? null,
      ComplementoEndereco: data?.ComplementoEndereco ?? "",
      Bairro: data?.Bairro ?? null,
      CodigoCidade: data?.CodigoCidade ?? null,
      RGIE: data?.RGIE ?? null,
    };
  } catch (e) {
    console.warn(`[fetchEntidade] erro:`, e);
    return {
      Endereco: null,
      NumeroEndereco: null,
      ComplementoEndereco: "",
      Bairro: null,
      CodigoCidade: null,
      RGIE: null,
    };
  }
}

async function fetchCidade(codigo: string, token: string): Promise<CidadeData> {
  try {
    const url = `${ERP_BASE_URL}/cidade/Load?codigo=${codigo}&loadChild=All&loadOneToOne=All`;
    const resp = await fetch(url, { headers: { "riosoft-token": token } });
    if (!resp.ok) {
      console.warn(`[fetchCidade] HTTP ${resp.status} para ${codigo}`);
      return { NomeCompleto: null, SiglaUnidFederacao: null, SiglaPais: null };
    }
    const data = await resp.json();
    return {
      NomeCompleto: data?.NomeCompleto ?? data?.Nome ?? null,
      SiglaUnidFederacao: data?.SiglaUnidFederacao ?? null,
      SiglaPais: data?.SiglaPais ?? null,
    };
  } catch (e) {
    console.warn(`[fetchCidade] erro:`, e);
    return { NomeCompleto: null, SiglaUnidFederacao: null, SiglaPais: null };
  }
}

// ── Build payload ──
// Reescrito espelhando o gabarito real da NFS-e chave 15762 (MovEstq/Load).
// Cada campo aqui existe no gabarito. Nada inventado.

async function buildPayload(input: LancarNfseInput, token: string): Promise<any> {
  const cnpj = input.prestadorCnpj.replace(/\D/g, "");
  const v = input.valorServico;
  const dataEmissaoFmt = fmtAlvoDate(input.dataEmissao);
  const hojeFmt = fmtAlvoDate(new Date());

  const entidade = await fetchEntidade(input.codigoEntidade, token);
  const cidade = entidade.CodigoCidade
    ? await fetchCidade(entidade.CodigoCidade, token)
    : { NomeCompleto: null, SiglaUnidFederacao: null, SiglaPais: null };

  const imp: ImpostosMovEstqInput = input.impostos || {
    baseISS: 0,
    aliquotaISS: 0,
    valorISS: 0,
    deduzISSValorTotal: "Não",
    baseIRRF: 0,
    aliquotaIRRF: 0,
    valorIRRF: 0,
    deduzIRRFValorTotal: "Não",
    baseINSS: 0,
    aliquotaINSS: 0,
    valorINSS: 0,
    deduzINSSValorTotal: "Não",
    basePIS: 0,
    aliquotaPIS: 0,
    valorPIS: 0,
    deduzPISValorTotal: "Não",
    baseCOFINS: 0,
    aliquotaCOFINS: 0,
    valorCOFINS: 0,
    deduzCOFINSValorTotal: "Não",
    baseCSLL: 0,
    aliquotaCSLL: 0,
    valorCSLL: 0,
    deduzCSLLValorTotal: "Não",
  };

  // ── Parcelas ──
  let parcelasList: any[];
  if (input.parcelas && input.parcelas.length > 0) {
    parcelasList = input.parcelas.map((p) => ({
      CodigoEmpresaFilial: "1.01",
      Sequencia: p.sequencia,
      EspecieDocumento: "NFS-e",
      SerieDocumento: input.serie || "1",
      NumeroDuplicata: p.numeroDuplicata,
      DataEmissao: fmtAlvoDateFromYMD(p.dataEmissao),
      ValorParcela: p.valorParcela,
      ValorPago: 0,
      DataPagamento: null,
      DataVencimento: fmtAlvoDateFromYMD(p.dataVencimento),
      DataProrrogacao: fmtAlvoDateFromYMD(p.dataVencimento),
      NumeroBanco: null,
      NumeroAgBancaria: null,
      CodigoTipoCobranca: "0000001",
      ParcPagMovEstqUserFieldsObject: {},
      UploadIdentify: "",
    }));
  } else {
    const dt = new Date(input.dataEmissao);
    dt.setDate(dt.getDate() + 30);
    parcelasList = [
      {
        CodigoEmpresaFilial: "1.01",
        Sequencia: 1,
        EspecieDocumento: "NFS-e",
        SerieDocumento: input.serie || "1",
        NumeroDuplicata: `${input.numero}/1-1`,
        DataEmissao: dataEmissaoFmt,
        ValorParcela: v,
        ValorPago: 0,
        DataPagamento: null,
        DataVencimento: fmtAlvoDate(dt),
        DataProrrogacao: fmtAlvoDate(dt),
        NumeroBanco: null,
        NumeroAgBancaria: null,
        CodigoTipoCobranca: "0000001",
        ParcPagMovEstqUserFieldsObject: {},
        UploadIdentify: "",
      },
    ];
  }

  // ── Classes/CCs do cabeçalho ──
  const classesList = input.classes.map((c) => ({
    CodigoEmpresaFilial: "1.01",
    CodigoClasseRecDesp: c.codigoClasseRecDesp,
    Valor: c.valor,
    Percentual: c.percentual,
    ExcluiCentroControleValorZero: "Sim",
    MovEstqClasseRecDespUserFieldsObject: {},
    RateioMovEstqChildList: c.centrosCusto.map((cc) => ({
      CodigoEmpresaFilial: "1.01",
      CodigoClasseRecDesp: c.codigoClasseRecDesp,
      CodigoCentroCtrl: cc.codigoCentroCtrl,
      Valor: cc.valor,
      Percentual: cc.percentual,
      RateioMovEstqUserFieldsObject: {},
      UploadIdentify: "",
    })),
    UploadIdentify: "",
  }));

  // ── Item de serviço (espelhando exatamente o gabarito) ──
  const item: any = {
    ValorUnitarioFOB: 0,
    ControlaLote: "Não",
    CodigoEmpresaFilial: "1.01",
    CodigoProduto: input.codigoProduto,
    Sequencia: 1,
    DataMovimento: hojeFmt,
    CodigoTipoLanc: "E0000091",
    CodigoNatOperacao: "1.933",
    CodigoCentroCtrl: null,
    CodigoEmpresaFilialPedComp: "1.01",
    NumeroPedComp: input.pedidoNumero,
    QuantidadeProdUnidMedPrincipal: 1,
    ValorProduto: v,
    CodigoProdUnidMed: "UNID",
    PosicaoProdUnidMed: 1,
    Peso: 1,
    FatorDivisor: "Fator",
    PercentualAcrescimoFinanceiro: 0,
    ValorAcrescimoFinanceiro: 0,
    PercentualDescontoEspecial: 0,
    ValorDescontoEspecial: 0,
    ValorEmbalagem: 0,
    ValorFrete: 0,
    ValorSeguro: 0,
    ValorOutrasDespesas: 0,
    ValorDespesasDiversas: 0,
    ValorServico: 0,
    BaseICMS: 0,
    PercentualReducaoICMS: 0,
    ValorReducaoICMS: 0,
    BaseICMSReduzido: 0,
    PercentualICMS: 0,
    ValorICMS: 0,
    ValorICMSRecuperado: 0,
    CalculaST: "F",
    ValorICMSSTRetido: 0,
    ValorICMSSTRetidoRecuperado: 0,
    BaseIPI: 0,
    PercentualIPI: 0,
    ValorIPI: 0,
    IPIInclusoBaseICMS: "Não",
    ValorIPIRecuperado: 0,
    ItemServico: "Sim",
    BaseISS: imp.valorISS > 0 ? imp.baseISS : 0,
    PercentualISS: imp.valorISS > 0 ? imp.aliquotaISS : 0,
    ValorISS: imp.valorISS,
    BaseIRRF: 0,
    PercentualIRRF: 0,
    ValorIRRF: imp.valorIRRF,
    BaseINSS: 0,
    PercentualINSS: 0,
    ValorINSS: imp.valorINSS,
    Quantidade2: 1,
    ControlaEstoque: "Não",
    DesmembramentoSequenciaParcelaItemContratoOrcam: 0,
    RejeitadoPatrimonio: "Não",
    BaseII: 0,
    PercentualII: 0,
    ValorII: 0,
    ValorIIRecuperado: 0,
    CodigoTributA: "0",
    CodigoTributB: "90",
    CodigoEmpresaFilialContratoOrcam: "1.01",
    CodigoClasFiscal: "0000002",
    ValorProdutoOriginalDocumento: 0,
    CodigoProdUnidMedValor: "UNID",
    PosicaoProdUnidMedValor: 1,
    ValorFreteOriginalDocumento: 0,
    ValorSeguroOriginalDocumento: 0,
    ValorDespesaOriginalDocumento: 0,
    ValorProdutoFOB: 0,
    ValorSISCOMEX: 0,
    BasePIS: 0,
    PercentualPIS: 0,
    ValorPIS: 0,
    BaseCOFINS: 0,
    PercentualCOFINS: 0,
    ValorCOFINS: 0,
    ValorISSDeduzirTotal: 0,
    ValorICMSDIFAL: 0,
    ValorPISRecuperado: 0,
    ValorCOFINSRecuperado: 0,
    BaseCSLLRF: imp.valorCSLL > 0 ? imp.baseCSLL : 0,
    PercentualCSLLRF: imp.valorCSLL > 0 ? imp.aliquotaCSLL : 0,
    ValorCSLLRF: imp.valorCSLL,
    PercentualCOFINSRF: imp.valorCOFINS > 0 ? imp.aliquotaCOFINS : 0,
    ValorCOFINSRF: imp.valorCOFINS,
    PercentualPISRF: imp.valorPIS > 0 ? imp.aliquotaPIS : 0,
    ValorPISRF: imp.valorPIS,
    CodigoEntidade: input.codigoEntidade,
    AcrescimoCustoComposicao: 0,
    DescontoCustoComposicao: 0,
    NomeProduto: input.nomeProduto,
    PercentualReducaoPIS: 0,
    ValorReducaoPIS: 0,
    BasePISReduzida: 0,
    PercentualReducaoCOFINS: 0,
    ValorReducaoCOFINS: 0,
    BaseCOFINSReduzida: 0,
    Patrimonio: "Não",
    CodigoProdutoPedComp: input.codigoProduto,
    SequenciaItemPedComp: input.sequenciaItemPedComp,
    ValorDescontoGeral: 0,
    PercentualDescontoRepasseICMS: 0,
    ValorDescontoRepasseICMS: 0,
    ValorReducaoDescontoRepasseICMS: 0,
    CodigoClasseRecDesp: null,
    CalculoICMSSTPrecoLista: "Não",
    MargemLucroST: 0,
    PrecoListaICMSST: 0,
    PercentualReducaoICMSST: 0,
    BaseICMSST: 0,
    PercentualICMSST: 0,
    ValorICMSST: 0,
    ValorEmbalagemST: 0,
    ValorICMSSTEmbalagem: 0,
    ValorFreteST: 0,
    ValorICMSSTFrete: 0,
    ValorSeguroST: 0,
    ValorICMSSTSeguro: 0,
    ValorOutrasDespesaST: 0,
    ValorICMSSTOutrasDespesas: 0,
    ValorFreteEmbutidoST: 0,
    ValorICMSSTFreteEmbutido: 0,
    PesoLiquido: 0,
    PesoBruto: 0,
    CustoUnitarioLiquido: 0,
    ValorCapatazia: 0,
    PercentualReducaoINSS: 0,
    ValorReducaoINSS: 0,
    BaseINSSReduzida: 0,
    RateiaValorICMSSTRecolhidoAntecipadamente: "Não",
    ValorICMSSTRecolhidoAntecipadamente: 0,
    ReducaoII: "Nenhum",
    PercentualReducaoII: 0,
    ValorReducaoII: 0,
    BaseIIReduzida: 0,
    ValorIIOriginal: 0,
    ReducaoIPI: "Nenhum",
    PercentualReducaoIPI: 0,
    ValorReducaoIPI: 0,
    BaseIPIReduzida: 0,
    ValorIPIOriginal: 0,
    ReducaoICMS: "Nenhum",
    ValorICMSOriginal: 0,
    ReducaoPIS: "Nenhum",
    ValorPISOriginal: 0,
    ReducaoCOFINS: "Nenhum",
    ValorCOFINSOriginal: 0,
    ReducaoISS: "Nenhum",
    PercentualReducaoISS: 0,
    ValorReducaoISS: 0,
    BaseISSReduzida: 0,
    ValorISSOriginal: 0,
    ReducaoINSS: "Nenhum",
    ValorINSSOriginal: 0,
    ValorDescontoICMS: 0,
    ValorReembolso: 0,
    SequenciaItemContrato: 1,
    NumeroVersaoContrato: 1,
    PercentualDiferimentoICMS: 0,
    ValorDiferimentoICMS: 0,
    ValorICMSDevido: 0,
    ValorCreditoPresumidoICMS: 0,
    ValorICMSRecolher: 0,
    QuantidadeSTProdUnidMedPrincipal: 0,
    QuantidadeST2: 0,
    DaeGNREPago: "Não",
    DeduzICMSSTRetido: "Não",
    GeraRMEspecificaLaudo: "Não",
    ValorGlosa: 0,
    ValorPedagio: 0,
    PercentualICMSExonerado: 0,
    BaseICMSOperacao: 0,
    PercentualICMSOperacao: 0,
    ValorICMSOperacao: 0,
    PrecoVendaVarejo: 0,
    ValorSeloControle: 0,
    QuantidadePatrimonio: 1,
    TipoConfigTributPIS: "PIS",
    TipoConfigTributCOFINS: "COFINS",
    CodigoConfigTributIPI: "03",
    CodigoConfigTributPIS: "98",
    CodigoConfigTributCOFINS: "98",
    AtualizacaoFichaTecnica: "Nenhum",
    ValorICMSSTRetidoRecuperadoX: 0,
    ValorICMSRecuperadoX: 0,
    BaseICMSX: 0,
    BaseIPIPauta: 0,
    ValorUnitarioIPIPauta: 0,
    BasePISPauta: 0,
    ValorUnitarioPISPauta: 0,
    BaseCOFINSPauta: 0,
    ValorUnitarioCOFINSPauta: 0,
    QuantidadeReducaoProdUnidMedPrincipal: 0,
    QuantidadeReducao2: 0,
    QuantidadeDesmembrada2: 0,
    BaseFUNRURAL: 0,
    PercentualFUNRURAL: 0,
    ValorFUNRURAL: 0,
    FatorCalculoComodato: 0,
    BaseSegundoCustoMedio: 0,
    CustoUnitarioSegundoCustoMedio: 0,
    CustoUnitSegCustoMedioSegMoeda: 0,
    BaseSegCustoMedioSegMoeda: 0,
    PesoCubado: 0,
    ValorDeducaoISS: 0,
    BaseDeduzidaISS: 0,
    ValorUnitario: v,
    BasePISRF: imp.valorPIS > 0 ? imp.basePIS : 0,
    BaseCOFINSRF: imp.valorCOFINS > 0 ? imp.baseCOFINS : 0,
    ValorDescontoICMSZFM: 0,
    ValorDescontoPISZFM: 0,
    ValorDescontoCOFINSZFM: 0,
    BaseReduzidaICMSDestino: 0,
    PercentualReducaoICMSDestino: 0,
    DemonstrativoPercentualMargemLucroST: 0,
    DemonstrativoPrecoListaST: 0,
    DemonstrativoBaseICMSST: 0,
    DemonstrativoPercentualICMSST: 0,
    DemonstrativoValorICMSST: 0,
    DemonstrativoValorICMSSTRetido: 0,
    ValorMarinhaMercante: 0,
    ValorICMSMarinhaMercante: 0,
    MotivoDesoneracaoICMS: "Nenhum",
    PercentualICMSInternoEstadoDestinatarioPartilha: 0,
    PercentualICMSInterestadualPartilha: 0,
    ValorICMSEstadoDestinatarioPartilha: 0,
    ValorICMSEstadoRemetentePartilha: 0,
    CustoUnitarioICMSRecuperado: 0,
    SequenciaItemNotaFiscal: 1,
    BaseFCPICMS: 0,
    PercentualFCPICMS: 0,
    ValorFCPICMS: 0,
    BaseFCPICMSST: 0,
    PercentualFCPICMSST: 0,
    ValorFCPICMSST: 0,
    BaseFCPICMSPartilha: 0,
    ValorRetencaoEspecial15: 0,
    ValorRetencaoEspecial20: 0,
    ValorRetencaoEspecial25: 0,
    ValorAdicionalREINF: 0,
    ValorAdicionalNaoRetidoREINF: 0,
    BaseNaoDevidoINSS: 0,
    PercentualNaoDevidoINSS: 0,
    ValorNaoDevidoINSS: 0,
    BaseNaoDevidoIRRF: 0,
    PercentualNaoDevidoIRRF: 0,
    ValorNaoDevidoIRRF: 0,
    BaseNaoDevidoPIS: 0,
    PercentualNaoDevidoPIS: 0,
    ValorNaoDevidoPIS: 0,
    BaseNaoDevidoCOFINS: 0,
    PercentualNaoDevidoCOFINS: 0,
    ValorNaoDevidoCOFINS: 0,
    BaseNaoDevidoCSLL: 0,
    PercentualNaoDevidoCSLL: 0,
    ValorNaoDevidoCSLL: 0,
    ValorFCPRetidoST: 0,
    IndustrializacaoConjunta: "Não",
    BaseIIOperacao: 0,
    PercentualIIOperacao: 0,
    ValorIIOperacao: 0,
    BaseIPIOperacao: 0,
    PercentualIPIOperacao: 0,
    ValorIPIOperacao: 0,
    BasePISOperacao: 0,
    PercentualPISOperacao: 0,
    ValorPISOperacao: 0,
    BaseCOFINSOperacao: 0,
    PercentualCOFINSOperacao: 0,
    ValorCOFINSOperacao: 0,
    CodigoAlternativoProduto: input.codigoAlternativoProduto || null,
    ValorContribuicaoPrevidenciaria: 0,
    PercentualContribuicaoPrevidenciaria: 0,
    ValorContribuicaoDestinadaFinanciamento: 0,
    PercentualContribuicaoDestinadaFinanciamento: 0,
    ValorSENAR: 0,
    PercentualSENAR: 0,
    ValorContribuicaoPrevidenciariaNaoRetida: 0,
    ValorGILRATNaoRetida: 0,
    ValorSenarNaoRetida: 0,
    DescontoRepasseICMSPor: "Nenhum",
    BasePISRecuperado: 0,
    BaseCOFINSRecuperado: 0,
    PercentualSuspensaoICMSImportacao: 0,
    ValorSuspensaoICMSImportacao: 0,
    ValorICMSRecuperadoFiscal: 0,
    DeduzICMSISSBasePISCOFINS: "Sim",
    DeduzICMSDIFALBasePISCOFINS: "Não",
    DeduzICMSSTBasePISCOFINS: "Não",
    BaseIOF: 0,
    PercentualIOF: 0,
    ValorIOF: 0,
    BaseCIDE: 0,
    PercentualCIDE: 0,
    ValorCIDE: 0,
    BaseSENAR: 0,
    ValorGILRAT: 0,
    PercentualGILRAT: 0,
    BaseGILRAT: 0,
    BaseCBS: 0,
    PercentualCBS: 0,
    ValorCBS: 0,
    PercentualReducaoCBS: 0,
    ReducaoSobreCBS: "Nenhum",
    BaseIBSUF: 0,
    PercentualIBSUF: 0,
    ValorIBSUF: 0,
    PercentualReducaoIBSUF: 0,
    ReducaoSobreIBSUF: "Nenhum",
    BaseIBSCidade: 0,
    PercentualIBSCidade: 0,
    ValorIBSCidade: 0,
    PercentualReducaoIBSCidade: 0,
    ReducaoSobreIBSCidade: "Nenhum",
    PercentualCBSOriginal: 0,
    PercentualIBSUFOriginal: 0,
    PercentualIBSCidadeOriginal: 0,
    ItemMovEstqUserFieldsObject: {},
    CompItemMovEstqChildList: [],
    CtrlLoteItemMovEstqChildList: [],
    ItMovEstqParcContrOrcamChildList: [],
    ItemMovEstqBemPatChildList: [],
    ItemMovEstqClasseRecdespChildList: input.classes.map((c) => ({
      CodigoEmpresaFilial: "1.01",
      CodigoProduto: input.codigoProduto,
      SequenciaItemMovEstq: 1,
      CodigoClasseRecDesp: c.codigoClasseRecDesp,
      Valor: c.valor,
      Percentual: c.percentual,
      ExcluiCentroControleValorZero: "Sim",
      ItemMovEstqClasseRecdespUserFieldsObject: {},
      RateioItemMovEstqChildList: c.centrosCusto.map((cc) => ({
        CodigoEmpresaFilial: "1.01",
        CodigoProduto: input.codigoProduto,
        SequenciaItemMovEstq: 1,
        CodigoClasseRecDesp: c.codigoClasseRecDesp,
        CodigoCentroCtrl: cc.codigoCentroCtrl,
        Valor: cc.valor,
        Percentual: cc.percentual,
        RateioItemMovEstqUserFieldsObject: {},
        UploadIdentify: "",
      })),
      UploadIdentify: "",
    })),
    ItemMovEstqConfImpNfeChildList: [],
    ItemMovEstqDocRelacChildList: [],
    ItemMovEstqProcChildList: [],
    ItemMovEstqSubcontChildList: [],
    LocArmazItemMovEstqChildList: [],
    MovEstqFifoChildList: [],
    NumSerieItemMovEstqChildList: [],
    ValorAnteriorExecucaoOrcamentaria: v,
    IDGeraNumSerie: 0,
    ItemValorCompararClasseReceitaDespesa: 0,
    Quantidade2Old: 0,
    UploadIdentify: "",
  };

  // ── Cabeçalho (espelhando exatamente o gabarito) ──
  const classObject: any = {
    IPIInclusoBaseICMS: null,
    CodigoEmpresaFilial: "1.01",
    CodigoTipoLanc: "E0000091",
    DataMovimento: hojeFmt,
    DataEmissao: dataEmissaoFmt,
    CodigoEmpresaFilialDocumento: "1.01",
    Especie: "NFS-e",
    Serie: input.serie || "1",
    Numero: input.numero,
    CodigoEntidade: input.codigoEntidade,
    Observacao: "",
    ValorAcrescimoFinanceiroProduto: 0,
    ValorAcrescimoFinanceiroServico: 0,
    ValorDescontoEspecialProduto: 0,
    ValorDescontoEspecialServico: 0,
    ValorServico: v,
    BaseISS: imp.valorISS > 0 ? imp.baseISS : 0,
    ValorISS: imp.valorISS,
    BaseIRRF: 0,
    ValorIRRF: imp.valorIRRF,
    ValorTotalServico: v,
    ValorEmbalagem: 0,
    ValorFrete: 0,
    ValorSeguro: 0,
    ValorOutrasDespesas: 0,
    ValorDespesaDiversas: 0,
    BaseICMS: 0,
    ValorICMS: 0,
    BaseICMSST: 0,
    ValorICMSST: 0,
    ValorICMSSTRetido: 0,
    BaseIPI: 0,
    ValorIPI: 0,
    ValorMercadoria: 0,
    ValorFinalMercadoria: 0,
    ValorMercadoriaDiversa: 0,
    ValorDocumento: v,
    CodigoCondPag: input.codigoCondPag,
    IntegradoFinanceiro: "Sim",
    RateioAutomaticoDespesasDiversas: "Sim",
    BaseINSS: 0,
    ValorINSS: imp.valorINSS,
    IntegradoFiscal: "Sim",
    DeduzISSValorTotal: "Não",
    DeduzINSSValorTotal: "Não",
    PercentualFreteEmbutidoValor: 0,
    ValorFreteEmbutidoValor: 0,
    PercentualFinanceiroEmbutidoValor: 0,
    ValorFinanceiroEmbutidoValor: 0,
    PercentualDescontoGeral: 0,
    ValorDescontoGeral: 0,
    PercentualDescontoGeralProduto: 0,
    ValorDescontoGeralProduto: 0,
    PercentualDescontoGeralServico: 0,
    ValorDescontoGeralServico: 0,
    ValorCambioCustoMedio: 0,
    ControlaEstoque: "Não",
    DeduzIRRFValorTotal: "Não",
    ValorLiberado: v,
    ValorOriginal: v,
    Origem: "Estoque",
    PossuiItensRejeitadosPatrimono: "Não",
    BaseII: 0,
    ValorII: 0,
    DataEntrada: hojeFmt,
    CodigoIndEconomicoDocumento: "0000001",
    ValorCambioDocumento: 1,
    ValorMercadoriaDocumento: 0,
    CodigoTipoPagRec: "0000016",
    ValorDocumentoFrete: 0,
    CambioIndiceEconomicoFrete: 0,
    ValorDocumentoSeguro: 0,
    CambioIndiceEconomicoSeguro: 0,
    ValorDespesasAcessoriasImportacao: 0,
    ValorSISCOMEX: 0,
    BasePIS: 0,
    ValorPIS: 0,
    BaseCOFINS: 0,
    ValorCOFINS: 0,
    ValorISSDeduzir: 0,
    ValorICMSDIFAL: 0,
    BaseCSLLRFServico: imp.valorCSLL > 0 ? imp.baseCSLL : 0,
    ValorCSLLRFServico: imp.valorCSLL,
    PercentualCSLLRFServico: imp.valorCSLL > 0 ? imp.aliquotaCSLL : 0,
    DeduzCSLLValorTotal: "Não",
    PercentualCOFINSRFServico: imp.valorCOFINS > 0 ? imp.aliquotaCOFINS : 0,
    ValorCOFINSRFServico: imp.valorCOFINS,
    DeduzCOFINSValorTotal: "Não",
    PercentualPISRFServico: imp.valorPIS > 0 ? imp.aliquotaPIS : 0,
    ValorPISRFServico: imp.valorPIS,
    DeduzPISValorTotal: "Não",
    ValorAtivo: 0,
    ValorDescontoRepasseICMSDiferencial: 0,
    ValorDescontoRepasseICMSReducao: 0,
    BaseICMSProprioST: 0,
    ValorICMSProprioST: 0,
    BaseICMSSTPrecoLista: 0,
    ValorICMSSTPrecoLista: 0,
    BaseICMSSTMargemLucro: 0,
    ValorICMSSTMargemLucro: 0,
    SomaFreteBaseICMSST: "Não",
    ValorMercadoriaST: 0,
    PesoLiquido: 0,
    PesoBruto: 0,
    RateioFretePorPeso: "Não",
    ValorCapatazia: 0,
    RateioCapataziaPeso: "Não",
    ValorICMSRecolhidoAntecipST: 0,
    ValorICMSRecolhidoAntecipSTPago: "Não",
    ValorDescontoICMS: 0,
    ValorReembolso: 0,
    ValorDiferimentoICMS: 0,
    ValorICMSDevido: 0,
    ValorCreditoPresumidoICMS: 0,
    ValorICMSRecolher: 0,
    Selecionado: "Não",
    IntegraFiscal: "Não",
    ValorGlosa: 0,
    ValorLiquidoDocumento: v,
    ValorPedagio: 0,
    BaseICMSOperacao: 0,
    ValorICMSOperacao: 0,
    PrecoVendaVarejo: 0,
    ValorDespesasCompoeValorTotal: "Não",
    DesabilitaRecalculoValores: "Não",
    ValorSeloControle: 0,
    ValorPISRFProduto: 0,
    ValorCOFINSRFProduto: 0,
    BasePISRFServico: imp.valorPIS > 0 ? imp.basePIS : 0,
    BaseCOFINSRFServico: imp.valorCOFINS > 0 ? imp.baseCOFINS : 0,
    BasePISRFProduto: 0,
    BaseCOFINSRFProduto: 0,
    ModalidadeFrete: "Sem Frete",
    PercentualAcrescimoFinanceiro: 0,
    ValorAcrescimoFinanceiro: 0,
    DeduzPISProdutoValorTotal: "Não",
    DeduzCOFINSProdutoValorTotal: "Não",
    BaseFUNRURAL: 0,
    ValorFUNRURAL: 0,
    DeduzFUNRURALValorTotal: "Não",
    PesoCubado: 0,
    NomeEntidade: input.prestadorNome,
    CPFCNPJEntidade: cnpj,
    RGIEEntidade: entidade.RGIE,
    EnderecoEntidade: entidade.Endereco,
    NumeroEnderecoEntidade: entidade.NumeroEndereco,
    ComplementoEnderecoEntidade: entidade.ComplementoEndereco || "",
    BairroEntidade: entidade.Bairro,
    SiglaPaisEntidade: cidade.SiglaPais || "BRA",
    NomeCidadeEntidade: cidade.NomeCompleto,
    SiglaUnidFederacaoEntidade: cidade.SiglaUnidFederacao,
    CodigoCidadeEntidade: entidade.CodigoCidade,
    DeduzValorPISParcelaPagamento: "Não",
    DeduzValorCOFINSParcelaPagamento: "Não",
    DeduzValorCSLLParcelaPagamento: "Não",
    NaturezaFrete: "N",
    DescontoICMSZFM: 0,
    DescontoPISZFM: 0,
    DescontoCOFINSZFM: 0,
    TaxaMarinhaMercante: 0,
    TaxaMarinhaMercantePorPeso: "Não",
    SISCOMEXPorPeso: "Não",
    DespesasImportacaoPeso: "Não",
    ConferidoIntegracaoSistemas: "Regular",
    BaseFCPICMS: 0,
    ValorFCPICMS: 0,
    BaseFCPICMSST: 0,
    ValorFCPICMSST: 0,
    BaseFCPICMSPartilha: 0,
    ValorRetencaoEspecial15: 0,
    ValorRetencaoEspecial20: 0,
    ValorRetencaoEspecial25: 0,
    ValorAdicionalREINF: 0,
    ValorAdicionalNaoRetidoREINF: 0,
    BaseNaoDevidoINSS: 0,
    ValorNaoDevidoINSS: 0,
    BaseNaoDevidoIRRF: 0,
    ValorNaoDevidoIRRF: 0,
    BaseNaoDevidoPIS: 0,
    ValorNaoDevidoPIS: 0,
    BaseNaoDevidoCOFINS: 0,
    ValorNaoDevidoCOFINS: 0,
    BaseNaoDevidoCSLL: 0,
    ValorNaoDevidoCSLL: 0,
    DataCompetencia: dataEmissaoFmt,
    NFEmissaoPropria: "Não",
    ValorFCPRetidoST: 0,
    OrigemModulo: "Estoque",
    Operacao: "Entrada",
    BaseIIOperacao: 0,
    ValorIIOperacao: 0,
    BaseIPIOperacao: 0,
    ValorIPIOperacao: 0,
    BasePISOperacao: 0,
    ValorPISOperacao: 0,
    BaseCofinsOperacao: 0,
    ValorCofinsOperacao: 0,
    DocumentoHomologado: "Sim",
    DocumentoConferido: "Não",
    DeduzIRRFPrimeiraParcela: "Não",
    DeduzISSPrimeiraParcela: "Não",
    DeduzINSSPrimeiraParcela: "Não",
    DeduzPISPrimeiraParcela: "Não",
    DeduzCOFINSPrimeiraParcela: "Não",
    DeduzCSLLPrimeiraParcela: "Não",
    ValorContribuicaoPrevidenciaria: 0,
    ValorContribuicaoDestinadaFinanciamento: 0,
    ValorSENAR: 0,
    ValorContribuicaoPrevidenciariaNaoRetida: 0,
    ValorGILRATNaoRetida: 0,
    ValorSenarNaoRetida: 0,
    Rascunho: "Não",
    NumeroDocumentoReferencia: input.numero,
    CasasDecimaisValorUnitario: 5,
    IntegradoExterno: "Não",
    ValorSuspensaoICMSImportacao: 0,
    RefazParcelas: "Sim",
    BaseIOF: 0,
    ValorIOF: 0,
    BaseCIDE: 0,
    ValorCIDE: 0,
    FinalidadeCTe: "0- CT-e Normal",
    BaseSENAR: 0,
    ValorGILRAT: 0,
    BaseGILRAT: 0,
    BaseCBS: 0,
    ValorCBS: 0,
    BaseIBSUF: 0,
    ValorIBSUF: 0,
    BaseIBSCidade: 0,
    ValorIBSCidade: 0,
    IndicadorPresenca: "Nenhum",
    MovEstqUserFieldsObject: {},
    IcmsMovEstqChildList: [
      {
        CodigoEmpresaFilial: "1.01",
        PercentualICMS: 0,
        BaseCalculoICMS: 0,
        ValorICMS: 0,
        IcmsMovEstqUserFieldsObject: {},
        UploadIdentify: "",
      },
    ],
    ItemMovEstqChildList: [item],
    MovEstqAcordVendChildList: [],
    MovEstqAdiantChildList: [],
    MovEstqArquivoChildList: [],
    MovEstqCctrlChildList: [],
    MovEstqClasseRecDespChildList: classesList,
    MovEstqDocComplemChildList: [],
    MovEstqEmpChildList: [],
    MovEstqNfEletronicaChildList: input.chaveAcesso
      ? [
          {
            CodigoEmpresaFilial: "1.01",
            ChaveNFEletronica: input.chaveAcesso,
            Status: "Manual",
            XML: null,
            MovEstqNfEletronicaUserFieldsObject: {},
            UploadIdentify: "",
          },
        ]
      : [],
    MovEstqPedCompChildList: [
      {
        CodigoEmpresaFilial: "1.01",
        CodigoEmpresaFilialPedComp: "1.01",
        NumeroPedComp: input.pedidoNumero,
        ValorItens: v,
        ValorLiberado: 0,
        ValorOriginal: 0,
        MovEstqPedCompNecNovaProj: "Não",
        MovEstqPedCompValDocSaldo: v,
        MovEstqPedCompUserFieldsObject: {},
        UploadIdentify: "",
      },
    ],
    ParcPagMovEstqChildList: parcelasList,
    TipoFormulario: "Normal",
    ListaMensagens: [],
    EspecieSelectBox: "NFS-e",
    SerieSelectBox: input.serie || "1",
    UploadIdentify: "",
  };

  return { Action: "Insert", ClassObject: classObject };
}

// ── Caller ──

export async function lancarNfseNoAlvo(input: LancarNfseInput): Promise<LancarNfseResult> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt === 1) clearAlvoToken();
    const auth = await authenticateAlvo();
    if (!auth.success || !auth.token) {
      return { success: false, error: "Falha na autenticação ERP" };
    }

    const payload = await buildPayload(input, auth.token);

    // 🔍 DEBUG TEMPORÁRIO
    console.log("🔍 NFS-e Launch Payload:", JSON.stringify(payload, null, 2));
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      console.log("✅ Payload copiado para clipboard");
    } catch {}

    const resp = await fetch(`${ERP_BASE_URL}/MovEstq/SaveMovEstq`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "riosoft-token": auth.token,
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 409) {
      clearAlvoToken();
      await delay(1000 * attempt);
      continue;
    }

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      let msg = `HTTP ${resp.status}`;
      try {
        msg = JSON.parse(t).Message || msg;
      } catch {}
      return { success: false, error: msg };
    }

    const data = await resp.json();
    const chave = data?.Chave ?? data?.ClassObject?.Chave;
    if (!chave || chave === 0) {
      return { success: false, error: "Resposta sem Chave válida" };
    }
    return { success: true, chave };
  }

  return { success: false, error: "Conflito de sessão (409)" };
}
