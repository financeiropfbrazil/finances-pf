import { authenticateAlvo, clearAlvoToken } from "./alvoService";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Tipos ──

export interface CCRateioInput { codigoCentroCtrl: string; percentual: number; valor: number; }

export interface ClasseRateioInput { codigoClasseRecDesp: string; percentual: number; valor: number; centrosCusto: CCRateioInput[]; }

export interface ParcelaMovEstqInput { sequencia: number; numeroDuplicata: string; dataEmissao: string; valorParcela: number; dataVencimento: string; }

export interface ImpostosMovEstqInput {
  baseISS: number; aliquotaISS: number; valorISS: number; deduzISSValorTotal: string;
  baseIRRF: number; aliquotaIRRF: number; valorIRRF: number; deduzIRRFValorTotal: string;
  baseINSS: number; aliquotaINSS: number; valorINSS: number; deduzINSSValorTotal: string;
  basePIS: number; aliquotaPIS: number; valorPIS: number; deduzPISValorTotal: string;
  baseCOFINS: number; aliquotaCOFINS: number; valorCOFINS: number; deduzCOFINSValorTotal: string;
  baseCSLL: number; aliquotaCSLL: number; valorCSLL: number; deduzCSLLValorTotal: string;
}

export interface LancarNfseInput {
  numero: string; serie: string; dataEmissao: string; valorServico: number;
  prestadorCnpj: string; prestadorNome: string;
  pedidoNumero: string; classes: ClasseRateioInput[];
  codigoCondPag: string; codigoEntidade: string;
  codigoProduto: string; nomeProduto: string; sequenciaItemPedComp: number;
  impostos?: ImpostosMovEstqInput; parcelas?: ParcelaMovEstqInput[];
  danfsePdfBlob?: Blob; xmlBlob?: Blob; chaveAcesso?: string;
}

export interface LancarNfseResult { success: boolean; chave?: number; error?: string; }

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

interface EntidadeData { Endereco: string|null; NumeroEndereco: string|null; ComplementoEndereco: string; Bairro: string|null; CodigoCidade: string|null; RGIE: string|null; }

interface CidadeData { NomeCompleto: string|null; SiglaUnidFederacao: string|null; SiglaPais: string|null; }

async function fetchEntidade(codigo: string, token: string): Promise<EntidadeData> {
  try {
    const url = `${ERP_BASE_URL}/entidade/Load?codigo=${codigo}&loadChild=All&loadOneToOne=All`;
    const resp = await fetch(url, { headers: { "riosoft-token": token } });
    if (!resp.ok) {
      console.warn(`[fetchEntidade] HTTP ${resp.status} para ${codigo}`);
      return { Endereco: null, NumeroEndereco: null, ComplementoEndereco: "", Bairro: null, CodigoCidade: null, RGIE: null };
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
    return { Endereco: null, NumeroEndereco: null, ComplementoEndereco: "", Bairro: null, CodigoCidade: null, RGIE: null };
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
    baseISS: 0, aliquotaISS: 0, valorISS: 0, deduzISSValorTotal: "Não",
    baseIRRF: 0, aliquotaIRRF: 0, valorIRRF: 0, deduzIRRFValorTotal: "Não",
    baseINSS: 0, aliquotaINSS: 0, valorINSS: 0, deduzINSSValorTotal: "Não",
    basePIS: 0, aliquotaPIS: 0, valorPIS: 0, deduzPISValorTotal: "Não",
    baseCOFINS: 0, aliquotaCOFINS: 0, valorCOFINS: 0, deduzCOFINSValorTotal: "Não",
    baseCSLL: 0, aliquotaCSLL: 0, valorCSLL: 0, deduzCSLLValorTotal: "Não",
  };

  let parcelasList: any[];
  if (input.parcelas && input.parcelas.length > 0) {
    parcelasList = input.parcelas.map(p => ({
      CodigoEmpresaFilial: "1.01", ChaveMovEstq: 1, Sequencia: p.sequencia,
      EspecieDocumento: "NFS-e", SerieDocumento: input.serie || "1",
      NumeroDuplicata: p.numeroDuplicata,
      DataEmissao: fmtAlvoDateFromYMD(p.dataEmissao),
      ValorParcela: p.valorParcela,
      DataVencimento: fmtAlvoDateFromYMD(p.dataVencimento),
      DataProrrogacao: fmtAlvoDateFromYMD(p.dataVencimento),
      CodigoTipoCobranca: "0000001",
    }));
  } else {
    const dt = new Date(input.dataEmissao);
    dt.setDate(dt.getDate() + 30);
    parcelasList = [{
      CodigoEmpresaFilial: "1.01", ChaveMovEstq: 1, Sequencia: 1,
      EspecieDocumento: "NFS-e", SerieDocumento: input.serie || "1",
      NumeroDuplicata: `${input.numero}/1-1`,
      DataEmissao: dataEmissaoFmt, ValorParcela: v,
      DataVencimento: fmtAlvoDate(dt), DataProrrogacao: fmtAlvoDate(dt),
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

  const item: any = {
    CodigoEmpresaFilial: "1.01", CodigoProduto: input.codigoProduto,
    ChaveMovEstq: 0, Sequencia: 0, DataMovimento: hojeFmt,
    CodigoTipoLanc: "E0000091", CodigoEmpresaFilialPedComp: "1.01",
    NumeroPedComp: input.pedidoNumero,
    QuantidadeProdUnidMedPrincipal: 1, Quantidade2: 1, QuantidadePatrimonio: 1,
    ValorProduto: v, ValorUnitario: v,
    CodigoProdUnidMed: "UNID", CodigoProdUnidMedValor: "UNID",
    PosicaoProdUnidMed: 1, Peso: 1,
    ItemServico: "Sim", ControlaEstoque: "Não",
    CodigoNatOperacao: "1.933",
    CodigoTributA: "0", CodigoTributB: "90",
    CodigoEmpresaFilialContratoOrcam: "1.01",
    CodigoClasFiscal: "0000002", CodigoSitTributariaIBSCBS: "",
    CodigoEntidade: input.codigoEntidade,
    NomeProduto: input.nomeProduto,
    CodigoProdutoPedComp: input.codigoProduto,
    SequenciaItemPedComp: input.sequenciaItemPedComp,
    DesmembramentoSequenciaParcelaItemContratoOrcam: 0,
    DeduzICMSISSBasePISCOFINS: "Sim",
    TipoConfigTributPIS: "PIS", TipoConfigTributCOFINS: "COFINS",
    CodigoConfigTributIPI: "03", CodigoConfigTributPIS: "98", CodigoConfigTributCOFINS: "98",
    BasePISRF: imp.basePIS, PercentualPISRF: imp.aliquotaPIS, ValorPISRF: imp.valorPIS,
    BaseCOFINSRF: imp.baseCOFINS, PercentualCOFINSRF: imp.aliquotaCOFINS, ValorCOFINSRF: imp.valorCOFINS,
    BaseCSLLRF: imp.baseCSLL, PercentualCSLLRF: imp.aliquotaCSLL, ValorCSLLRF: imp.valorCSLL,
    ItemValorCompararClasseReceitaDespesa: v,
    ItemMovEstqUserFieldsObject: {},
    ItemMovEstqClasseRecdespChildList: input.classes.map(c => ({
      CodigoEmpresaFilial: "",
      CodigoProduto: "",
      ChaveMovEstq: 1,
      SequenciaItemMovEstq: 1,
      CodigoClasseRecDesp: c.codigoClasseRecDesp,
      Valor: c.valor,
      Percentual: c.percentual,
      RateioItemMovEstqChildList: c.centrosCusto.map(cc => ({
        CodigoEmpresaFilial: "",
        CodigoProduto: "",
        ChaveMovEstq: 1,
        SequenciaItemMovEstq: 1,
        CodigoClasseRecDesp: "",
        CodigoCentroCtrl: cc.codigoCentroCtrl,
        Valor: cc.valor,
        Percentual: cc.percentual,
      })),
    })),
  };

  const classObject: any = {
    Chamou: "SaveChild", ChamouClasse: "Servico",
    NumeroPedComp: input.pedidoNumero,
    IPIInclusoBaseICMS: "Não",
    CodigoEmpresaFilial: "1.01", Chave: 0,
    CodigoTipoLanc: "E0000091",
    DataMovimento: hojeFmt, DataEmissao: dataEmissaoFmt, DataEntrada: hojeFmt,
    CodigoEmpresaFilialDocumento: "1.01",
    Especie: "NFS-e", EspecieSelectBox: "NFS-e",
    Serie: input.serie || "1", SerieSelectBox: input.serie || "1",
    Numero: input.numero,
    CodigoEntidade: input.codigoEntidade,
    CodigoEntidadeEmpresaFilial: null,
    NomeEntidade: input.prestadorNome,
    CPFCNPJEntidade: cnpj,
    RGIEEntidade: entidade.RGIE,
    EnderecoEntidade: entidade.Endereco,
    NumeroEnderecoEntidade: entidade.NumeroEndereco,
    ComplementoEnderecoEntidade: entidade.ComplementoEndereco || "",
    BairroEntidade: entidade.Bairro,
    CodigoCidadeEntidade: entidade.CodigoCidade,
    NomeCidadeEntidade: cidade.NomeCompleto,
    SiglaUnidFederacaoEntidade: cidade.SiglaUnidFederacao,
    SiglaPaisEntidade: cidade.SiglaPais,
    SiglaPaisEmpresa: "BRA", SiglaUnidFederacaoEmpresa: "SP",
    ZonaFrancaEmpresa: "Não",
    ValorServico: v, ValorTotalServico: v, ValorDocumento: v,
    ValorLiberado: v, ValorOriginal: v, ValorLiquidoDocumento: v,
    ValorCompararClasseReceitaDespesa: v, ValorCompoeFinanceiro: v, ValorTotalParcelas: v,
    BaseISS: imp.baseISS, ValorISS: imp.valorISS,
    BaseIRRF: imp.baseIRRF, ValorIRRF: imp.valorIRRF,
    BaseINSS: imp.baseINSS, ValorINSS: imp.valorINSS,
    BasePISRFServico: imp.basePIS, ValorPISRFServico: imp.valorPIS, PercentualPISRFServico: imp.aliquotaPIS,
    BaseCOFINSRFServico: imp.baseCOFINS, ValorCOFINSRFServico: imp.valorCOFINS, PercentualCOFINSRFServico: imp.aliquotaCOFINS,
    BaseCSLLRFServico: imp.baseCSLL, ValorCSLLRFServico: imp.valorCSLL, PercentualCSLLRFServico: imp.aliquotaCSLL,
    DeduzISSValorTotal: imp.deduzISSValorTotal,
    DeduzIRRFValorTotal: imp.deduzIRRFValorTotal,
    DeduzINSSValorTotal: imp.deduzINSSValorTotal,
    DeduzPISProdutoValorTotal: "Não", DeduzCOFINSProdutoValorTotal: "Não",
    CodigoCondPag: input.codigoCondPag,
    CodigoCondPagAnterior: input.codigoCondPag,
    CodigoTipoPagRec: "0000016",
    CodigoIndEconomicoDocumento: "0000001", ValorCambioDocumento: 1,
    IntegradoFinanceiro: "Sim",
    RateioAutomaticoDespesasDiversas: "Sim",
    CalculaRateioClasseRecDesp: "Não",
    LiberaST: "Não",
    CasasDecimaisValorUnitario: 5,
    DiferencaMaiorDesconto: 0, ValorFatorICMSST: 0,
    ChaveMovimentacaoCusto: false, ChaveTransferenciaEntreEmpresa: false,
    ConfiguracaoAlteraMovEstqLaudoConcluido: false,
    DeletarClasseMovEstq: false, ExisteFinanceiroRealizado: 0,
    Importacao: false, IndustrializacaoConjunta: false,
    IsSuppressVerificationOfRulesAndIntegration: false,
    InscricaoSuframaEmpresa: null,
    RecalcularImpostos: false, ZerouImpostos: false,
    DataMovimentoAnterior: null, ValorDocumentoAnterior: -1,
    CodigoLocArmazLancamento: null, ChaveAcessoNFe: null,
    TipoFormulario: "Normal", TipoOrdemContrato: "", UploadIdentify: "",
    TipoLancamento: "Compra",
    EspecieLancamento: "Consumo",
    OperacaoLancamento: "Entrada",
    TipoCompra: 1,
    TipoComplemento: 0, TipoDevolucao: 0, TipoRemessa: 0,
    TipoRetorno: 0, TipoTransferencia: 0, TipoVenda: 0,
    EspecieFrete: 0, EspecieImportacao: 0, EspeciePreco: 0,
    TipoLancamentoIntegraCompras: 1,
    TipoLancamentoIntegraFinanceiro: 1,
    TipoLancamentoNecessitaCentroControle: 1,
    TipoLancamentoIntegraContrato: 0,
    TipoLancamentoIntegraContratoOrcamentario: 0,
    TipoLancamentoIntegraProjeto: 0,
    TipoLancamentoIntegraSC: 0,
    TipoLancamentoIntregraExecucaoOrcamentaria: 0,
    TipoLancamentoGeraControleEstoque: 0,
    TipoLancamentoGeraControleEstoqueTerceiros: 0,
    TipoLancamentoRelacionaMovimentoEstoqueOrdemServico: 0,
    TipoLancamentoRepasseTerceiros: 0,
    IcmsMovEstqChildList: [{ CodigoEmpresaFilial: "", Chave: 1, PercentualICMS: 0 }],
    ItemMovEstqChildList: [item],
    MovEstqClasseRecDespChildList: classesList,
    ParcPagMovEstqChildList: parcelasList,
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
      try { msg = JSON.parse(t).Message || msg; } catch {}
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
