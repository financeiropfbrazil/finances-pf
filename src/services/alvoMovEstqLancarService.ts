import { authenticateAlvo, clearAlvoToken } from "./alvoService";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

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
}

export interface LancarNfseResult {
  success: boolean;
  chave?: number;
  error?: string;
}

function buildPayload(input: LancarNfseInput): any {
  const hoje = new Date();
  hoje.setHours(3, 0, 0, 0);
  const hojeISO = hoje.toISOString();
  const dtEmissao = new Date(input.dataEmissao);
  dtEmissao.setHours(3, 0, 0, 0);
  const dtEmissaoISO = dtEmissao.toISOString();
  const v = input.valorServico;
  const cnpj = input.prestadorCnpj.replace(/\D/g, "");

  // Impostos — do modal ou default zeros
  const imp: ImpostosMovEstqInput = input.impostos || {
    baseISS: 0, aliquotaISS: 0, valorISS: 0, deduzISSValorTotal: "Não",
    baseIRRF: 0, aliquotaIRRF: 0, valorIRRF: 0, deduzIRRFValorTotal: "Não",
    baseINSS: 0, aliquotaINSS: 0, valorINSS: 0, deduzINSSValorTotal: "Não",
    basePIS: 0, aliquotaPIS: 0, valorPIS: 0, deduzPISValorTotal: "Não",
    baseCOFINS: 0, aliquotaCOFINS: 0, valorCOFINS: 0, deduzCOFINSValorTotal: "Não",
    baseCSLL: 0, aliquotaCSLL: 0, valorCSLL: 0, deduzCSLLValorTotal: "Não",
  };

  // Parcelas — do modal ou fallback 1 parcela (emissão + 30 dias)
  let parcelasList: any[];
  if (input.parcelas && input.parcelas.length > 0) {
    parcelasList = input.parcelas.map(p => ({
      CodigoEmpresaFilial: "1.01", ChaveMovEstq: 1,
      Sequencia: p.sequencia,
      EspecieDocumento: "NFS-e",
      SerieDocumento: input.serie || "1",
      NumeroDuplicata: p.numeroDuplicata,
      DataEmissao: dtEmissaoISO,
      ValorParcela: p.valorParcela,
      DataVencimento: new Date(p.dataVencimento + "T03:00:00.000Z").toISOString(),
      DataProrrogacao: new Date(p.dataVencimento + "T03:00:00.000Z").toISOString(),
      CodigoTipoCobranca: "0000001",
    }));
  } else {
    const dtVenc = new Date(dtEmissao);
    dtVenc.setDate(dtVenc.getDate() + 30);
    dtVenc.setHours(3, 0, 0, 0);
    parcelasList = [{
      CodigoEmpresaFilial: "1.01", ChaveMovEstq: 1,
      Sequencia: 1, EspecieDocumento: "NFS-e",
      SerieDocumento: input.serie || "1",
      NumeroDuplicata: `${input.numero}/1-1`,
      DataEmissao: dtEmissaoISO,
      ValorParcela: v,
      DataVencimento: dtVenc.toISOString(),
      DataProrrogacao: dtVenc.toISOString(),
      CodigoTipoCobranca: "0000001",
    }];
  }

  const classesList = input.classes.map(c => ({
    CodigoEmpresaFilial: "1.01", ChaveMovEstq: 1,
    CodigoClasseRecDesp: c.codigoClasseRecDesp,
    Valor: c.valor, Percentual: c.percentual,
    RateioMovEstqChildList: c.centrosCusto.map(cc => ({
      CodigoEmpresaFilial: "1.01", ChaveMovEstq: 1,
      CodigoClasseRecDesp: c.codigoClasseRecDesp,
      CodigoCentroCtrl: cc.codigoCentroCtrl,
      Valor: cc.valor, Percentual: cc.percentual,
    })),
  }));

  const totalParcelas = parcelasList.reduce((s: number, p: any) => s + p.ValorParcela, 0);

  return {
    Chamou: "DataVencimento", ChamouClasse: "Servico",
    NumeroPedComp: input.pedidoNumero,
    IPIInclusoBaseICMS: "Não",
    CodigoEmpresaFilial: "1.01", Chave: 0,
    CodigoTipoLanc: "E0000091",
    DataMovimento: hojeISO, DataEmissao: dtEmissaoISO,
    DataEntrada: hojeISO,
    CodigoEmpresaFilialDocumento: "1.01",
    Especie: "NFS-e", EspecieSelectBox: "NFS-e",
    Serie: input.serie || "1", SerieSelectBox: input.serie || "1",
    Numero: input.numero,
    CodigoEntidade: input.codigoEntidade,
    CPFCNPJEntidade: cnpj,
    NomeEntidade: input.prestadorNome,
    SiglaPaisEntidade: "BRA",
    ValorServico: v, ValorTotalServico: v, ValorDocumento: v,
    ValorLiberado: v, ValorOriginal: v, ValorLiquidoDocumento: v,
    ValorCompararClasseReceitaDespesa: v,
    ValorCompoeFinanceiro: v,
    CodigoCondPag: input.codigoCondPag,
    CodigoTipoPagRec: "0000016",
    CodigoIndEconomicoDocumento: "0000001",
    ValorCambioDocumento: 1, CasasDecimaisValorUnitario: 5,
    RateioAutomaticoDespesasDiversas: "Sim",
    // Impostos — header
    BaseISS: imp.baseISS, ValorISS: imp.valorISS,
    BaseIRRF: imp.baseIRRF, ValorIRRF: imp.valorIRRF,
    BaseINSS: imp.baseINSS, ValorINSS: imp.valorINSS,
    DeduzISSValorTotal: imp.deduzISSValorTotal,
    DeduzINSSValorTotal: imp.deduzINSSValorTotal,
    DeduzIRRFValorTotal: imp.deduzIRRFValorTotal,
    DeduzPISProdutoValorTotal: imp.deduzPISValorTotal,
    DeduzCOFINSProdutoValorTotal: imp.deduzCOFINSValorTotal,
    DeduzCSLLValorTotal: imp.deduzCSLLValorTotal || "Não",
    // Impostos RF no header
    BaseCSLLRFServico: imp.baseCSLL, ValorCSLLRFServico: imp.valorCSLL,
    PercentualCSLLRFServico: imp.aliquotaCSLL,
    BaseCOFINSRFServico: imp.baseCOFINS, ValorCOFINSRFServico: imp.valorCOFINS,
    PercentualCOFINSRFServico: imp.aliquotaCOFINS,
    BasePISRFServico: imp.basePIS, ValorPISRFServico: imp.valorPIS,
    PercentualPISRFServico: imp.aliquotaPIS,
    TipoFormulario: "Normal", TipoCompra: 1, TipoLancamentoIntegraFinanceiro: 1,
    TipoLancamentoIntegraCompras: 1, TipoLancamentoNecessitaCentroControle: 1,
    Operacao: "Entrada", Origem: "Estoque", DocumentoHomologado: "Sim",
    CalculaRateioClasseRecDesp: "Não", DeletarClasseMovEstq: false,
    ZerouImpostos: false, RecalcularImpostos: false,
    IsSuppressVerificationOfRulesAndIntegration: false,
    ValorDocumentoAnterior: -1, DiferencaMaiorDesconto: 0,
    ValorFatorICMSST: 0, LiberaST: "Não", ValorTotalParcelas: totalParcelas,
    SiglaPaisEmpresa: "BRA", SiglaUnidFederacaoEmpresa: "SP",
    CodigoEntidadeEmpresaFilial: "0000002",
    NumeroDocumentoReferencia: input.numero,
    Observacao: "",
    IcmsMovEstqChildList: [
      { CodigoEmpresaFilial: "", Chave: 1, PercentualICMS: 0 }
    ],
    ItemMovEstqChildList: [{
      CodigoEmpresaFilial: "1.01",
      CodigoProduto: input.codigoProduto,
      ChaveMovEstq: 0, Sequencia: 0,
      DataMovimento: hojeISO,
      CodigoTipoLanc: "E0000091",
      CodigoNatOperacao: "1.933",
      CodigoEmpresaFilialPedComp: "1.01",
      NumeroPedComp: input.pedidoNumero,
      QuantidadeProdUnidMedPrincipal: 1,
      ValorProduto: v,
      CodigoProdUnidMed: "UNID", PosicaoProdUnidMed: 1, Peso: 1,
      ItemServico: "Sim", Quantidade2: 1, ControlaEstoque: "Não",
      CodigoTributA: "0", CodigoTributB: "90", CodigoClasFiscal: "0000002",
      CodigoProdUnidMedValor: "UNID", CodigoEntidade: input.codigoEntidade,
      NomeProduto: input.nomeProduto,
      CodigoProdutoPedComp: input.codigoProduto,
      SequenciaItemPedComp: input.sequenciaItemPedComp,
      QuantidadePatrimonio: 1,
      CodigoConfigTributIPI: "03", CodigoConfigTributPIS: "98",
      CodigoConfigTributCOFINS: "98", TipoConfigTributPIS: "PIS",
      TipoConfigTributCOFINS: "COFINS", ValorUnitario: v,
      ItemValorCompararClasseReceitaDespesa: v,
      DesmembramentoSequenciaParcelaItemContratoOrcam: 0,
      CodigoEmpresaFilialContratoOrcam: "1.01",
      // Impostos RF no item
      BaseCSLLRF: imp.baseCSLL, PercentualCSLLRF: imp.aliquotaCSLL, ValorCSLLRF: imp.valorCSLL,
      BasePISRF: imp.basePIS, PercentualPISRF: imp.aliquotaPIS, ValorPISRF: imp.valorPIS,
      BaseCOFINSRF: imp.baseCOFINS, PercentualCOFINSRF: imp.aliquotaCOFINS, ValorCOFINSRF: imp.valorCOFINS,
      BaseISS: imp.baseISS, PercentualISS: imp.aliquotaISS, ValorISS: imp.valorISS,
      BaseIRRF: imp.baseIRRF, PercentualIRRF: imp.aliquotaIRRF, ValorIRRF: imp.valorIRRF,
      BaseINSS: imp.baseINSS, PercentualINSS: imp.aliquotaINSS, ValorINSS: imp.valorINSS,
      ItemMovEstqUserFieldsObject: {},
    }],
    MovEstqClasseRecDespChildList: classesList,
    ParcPagMovEstqChildList: parcelasList,
    MovEstqArquivoChildList: [],
    UploadIdentify: "", filesToUpload: [],
  };
}

export async function lancarNfseNoAlvo(
  input: LancarNfseInput
): Promise<LancarNfseResult> {
  const payload = buildPayload(input);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt === 1) clearAlvoToken();
    const auth = await authenticateAlvo();
    if (!auth.success || !auth.token)
      return { success: false, error: "Falha na autenticação ERP" };

    const formData = new FormData();
    formData.append("obj", JSON.stringify(payload));

    // Anexar PDF da DANFSE se disponível
    if (input.danfsePdfBlob) {
      const nomeArquivo = `DANFSE_${input.numero}_${input.prestadorNome.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      formData.append("file", input.danfsePdfBlob, nomeArquivo);
    }

    const resp = await fetch(
      `${ERP_BASE_URL}/MovEstq/SaveMovEstqMultPart?action=Insert`,
      { method: "POST",
        headers: { "riosoft-token": auth.token },
        body: formData }
    );

    if (resp.status === 409) {
      clearAlvoToken();
      await delay(1000 * attempt);
      continue;
    }
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      let msg = `HTTP ${resp.status}`;
      try { msg = JSON.parse(t).Message || msg; } catch {}
      return { success: false, error: msg };
    }

    const data = await resp.json();
    if (!data?.Chave || data.Chave === 0)
      return { success: false, error: "Resposta sem Chave" };
    return { success: true, chave: data.Chave };
  }
  return { success: false, error: "Conflito de sessão (409)" };
}
