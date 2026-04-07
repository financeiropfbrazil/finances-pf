import { authenticateAlvo, clearAlvoToken } from "./alvoService";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface NfeItemInput {
  codigoProduto: string;
  sequencia: number;
  codigoProdutoPedComp: string;
  sequenciaItemPedComp: number;
  valorProduto: number;
  codigoNCM?: string;
  codigoClasFiscal?: string;
  classeRecDesp: string;
  centroCusto: string;
}

export interface NfeParcelaInput {
  sequencia: number;
  numeroDuplicata: string;
  dataEmissao: string;
  valorParcela: number;
  dataVencimento: string;
}

export interface LancarNfeInput {
  numero: string;
  serie: string;
  dataEmissao: string;
  valorTotal: number;
  fornecedorCnpj: string;
  fornecedorNome: string;
  codigoEntidade: string;
  pedidoNumero: string;
  codigoCondPag: string;
  chaveAcessoNfe: string;
  itens: NfeItemInput[];
  parcelas: NfeParcelaInput[];
  classeRecDesp: string;
  centroCusto: string;
  icmsBase: number;
  icmsPercentual: number;
  icmsValor: number;
  danfePdfBlob?: Blob;
  xmlBlob?: Blob;
}

export interface LancarNfeResult {
  success: boolean;
  chave?: number;
  error?: string;
}

function buildPayload(input: LancarNfeInput, anexos: { uuid: string; tipo: 'pdf' | 'xml' }[]): any {
  const hoje = new Date();
  hoje.setHours(3, 0, 0, 0);
  const hojeISO = hoje.toISOString();
  const dtEmissao = new Date(input.dataEmissao);
  dtEmissao.setHours(3, 0, 0, 0);
  const dtEmissaoISO = dtEmissao.toISOString();
  const v = input.valorTotal;
  const cnpj = input.fornecedorCnpj.replace(/\D/g, "");

  // Parcelas
  let parcelasList: any[];
  if (input.parcelas && input.parcelas.length > 0) {
    parcelasList = input.parcelas.map(p => ({
      CodigoEmpresaFilial: "1.01",
      ChaveMovEstq: 1,
      Sequencia: p.sequencia,
      EspecieDocumento: "NF-e",
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
      CodigoEmpresaFilial: "1.01",
      ChaveMovEstq: 1,
      Sequencia: 1,
      EspecieDocumento: "NF-e",
      SerieDocumento: input.serie || "1",
      NumeroDuplicata: `${input.numero}/1-1`,
      DataEmissao: dtEmissaoISO,
      ValorParcela: v,
      DataVencimento: dtVenc.toISOString(),
      DataProrrogacao: dtVenc.toISOString(),
      CodigoTipoCobranca: "0000001",
    }];
  }

  // Classe/CC do header
  const classesList = [{
    CodigoEmpresaFilial: "1.01",
    ChaveMovEstq: 1,
    CodigoClasseRecDesp: input.classeRecDesp,
    Valor: v,
    Percentual: 100,
    RateioMovEstqChildList: [{
      CodigoEmpresaFilial: "1.01",
      ChaveMovEstq: 1,
      CodigoClasseRecDesp: input.classeRecDesp,
      CodigoCentroCtrl: input.centroCusto,
      Valor: v,
      Percentual: 100,
    }],
  }];

  const totalParcelas = parcelasList.reduce((s: number, p: any) => s + p.ValorParcela, 0);

  // Itens reais
  const itemsList = input.itens.map((item, idx) => ({
    CodigoEmpresaFilial: "1.01",
    CodigoProduto: item.codigoProduto,
    ChaveMovEstq: 0,
    Sequencia: item.sequencia || idx + 1,
    DataMovimento: hojeISO,
    CodigoTipoLanc: "E0000003",
    CodigoNatOperacao: "1.101",
    CodigoEmpresaFilialPedComp: "1.01",
    NumeroPedComp: input.pedidoNumero,
    CodigoProdutoPedComp: item.codigoProdutoPedComp,
    SequenciaItemPedComp: item.sequenciaItemPedComp,
    QuantidadeProdUnidMedPrincipal: 1,
    ValorProduto: item.valorProduto,
    CodigoProdUnidMed: "UNID",
    PosicaoProdUnidMed: 1,
    Peso: 1,
    ItemServico: "Não",
    Quantidade2: 1,
    ControlaEstoque: "Sim",
    CodigoTributA: "0",
    CodigoTributB: "90",
    CodigoClasFiscal: item.codigoClasFiscal || "0000002",
    CodigoProdUnidMedValor: "UNID",
    CodigoEntidade: input.codigoEntidade,
    NomeProduto: item.codigoProduto,
    QuantidadePatrimonio: 1,
    CodigoConfigTributIPI: "03",
    CodigoConfigTributPIS: "98",
    CodigoConfigTributCOFINS: "98",
    TipoConfigTributPIS: "PIS",
    TipoConfigTributCOFINS: "COFINS",
    ValorUnitario: item.valorProduto,
    ItemValorCompararClasseReceitaDespesa: item.valorProduto,
    DesmembramentoSequenciaParcelaItemContratoOrcam: 0,
    CodigoEmpresaFilialContratoOrcam: "1.01",
    ItemMovEstqUserFieldsObject: {},
    ItemMovEstqClasseRecdespChildList: [{
      CodigoEmpresaFilial: "1.01",
      ChaveMovEstq: -1,
      CodigoClasseRecDesp: item.classeRecDesp,
      Valor: item.valorProduto,
      Percentual: 100,
      RateioItemMovEstqChildList: [{
        CodigoEmpresaFilial: "1.01",
        ChaveMovEstq: -1,
        CodigoClasseRecDesp: item.classeRecDesp,
        CodigoCentroCtrl: item.centroCusto,
        Valor: item.valorProduto,
        Percentual: 100,
      }],
    }],
  }));

  return {
    Chamou: "DataVencimento",
    ChamouClasse: "Produto",
    NumeroPedComp: input.pedidoNumero,
    IPIInclusoBaseICMS: "Não",
    CodigoEmpresaFilial: "1.01",
    Chave: 0,
    CodigoTipoLanc: "E0000003",
    DataMovimento: hojeISO,
    DataEmissao: dtEmissaoISO,
    DataEntrada: hojeISO,
    CodigoEmpresaFilialDocumento: "1.01",
    Especie: "NF-e",
    EspecieSelectBox: "NF-e",
    Serie: input.serie || "1",
    SerieSelectBox: input.serie || "1",
    Numero: input.numero,
    CodigoEntidade: input.codigoEntidade,
    CPFCNPJEntidade: cnpj,
    NomeEntidade: input.fornecedorNome,
    SiglaPaisEntidade: "BRA",
    ValorMercadoria: v,
    ValorFinalMercadoria: v,
    ValorServico: 0,
    ValorTotalServico: 0,
    ValorDocumento: v,
    ValorLiberado: v,
    ValorOriginal: v,
    ValorLiquidoDocumento: v,
    ValorCompararClasseReceitaDespesa: v,
    ValorCompoeFinanceiro: v,
    CodigoCondPag: input.codigoCondPag,
    CodigoTipoPagRec: "0000016",
    CodigoIndEconomicoDocumento: "0000001",
    ValorCambioDocumento: 1,
    CasasDecimaisValorUnitario: 5,
    RateioAutomaticoDespesasDiversas: "Sim",
    CalculaRateioClasseRecDesp: "Não",
    ChaveAcessoNFe: input.chaveAcessoNfe,
    TipoCompra: 5,
    TipoLancamentoIntegraFinanceiro: 5,
    TipoLancamentoIntegraCompras: 5,
    TipoLancamentoGeraControleEstoque: 5,
    TipoLancamentoNecessitaCentroControle: 1,
    TipoLancamento: "Compra",
    EspecieLancamento: "Compra",
    OperacaoLancamento: "Entrada",
    Operacao: "Entrada",
    Origem: "Importação Arquivo",
    DocumentoHomologado: "Não",
    DocumentoConferido: "Sim",
    DeletarClasseMovEstq: false,
    ZerouImpostos: false,
    RecalcularImpostos: false,
    IsSuppressVerificationOfRulesAndIntegration: false,
    ValorDocumentoAnterior: -1,
    DiferencaMaiorDesconto: 0,
    ValorFatorICMSST: 0,
    LiberaST: "Não",
    ValorTotalParcelas: totalParcelas,
    SiglaPaisEmpresa: "BRA",
    SiglaUnidFederacaoEmpresa: "SP",
    CodigoEntidadeEmpresaFilial: "0000002",
    NumeroDocumentoReferencia: input.numero,
    Observacao: "",
    // ICMS real
    IcmsMovEstqChildList: [{
      CodigoEmpresaFilial: "",
      Chave: 1,
      PercentualICMS: input.icmsPercentual,
      BaseCalculoICMS: input.icmsBase,
      ValorICMS: input.icmsValor,
    }],
    // NF-e eletrônica child
    MovEstqNfEletronicaChildList: [{
      CodigoEmpresaFilial: "1.01",
      ChaveMovEstq: 0,
    }],
    ItemMovEstqChildList: itemsList,
    MovEstqClasseRecDespChildList: classesList,
    ParcPagMovEstqChildList: parcelasList,
    MovEstqArquivoChildList: anexos.map(a => ({
      CodigoEmpresaFilial: -1,
      ChaveMovEstq: -1,
      Sequencia: -1,
      Arquivo: null,
      UploadIdentify: a.uuid,
    })),
    UploadIdentify: "",
    filesToUpload: anexos.map(a => ({
      key: `${a.uuid}#Arquivo`,
      file: {},
    })),
  };
}

export async function lancarNfeNoAlvo(
  input: LancarNfeInput
): Promise<LancarNfeResult> {
  const anexos: { uuid: string; tipo: 'pdf' | 'xml'; blob: Blob; filename: string }[] = [];

  if (input.danfePdfBlob) {
    const safeNome = input.fornecedorNome.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '_');
    anexos.push({
      uuid: crypto.randomUUID(),
      tipo: 'pdf',
      blob: input.danfePdfBlob,
      filename: `DANFE_${input.numero}_${safeNome}.pdf`,
    });
  }

  if (input.xmlBlob) {
    anexos.push({
      uuid: crypto.randomUUID(),
      tipo: 'xml',
      blob: input.xmlBlob,
      filename: `NFE_${input.numero}.xml`,
    });
  }

  const payload = buildPayload(input, anexos.map(a => ({ uuid: a.uuid, tipo: a.tipo })));

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt === 1) clearAlvoToken();
    const auth = await authenticateAlvo();
    if (!auth.success || !auth.token)
      return { success: false, error: "Falha na autenticação ERP" };

    const formData = new FormData();
    formData.append("obj", JSON.stringify(payload));

    // Anexar PDF da DANFE se disponível
    if (input.danfePdfBlob) {
      const nomeArquivo = `DANFE_${input.numero}_${input.fornecedorNome.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      formData.append("file", input.danfePdfBlob, nomeArquivo);
    }

    const resp = await fetch(
      `${ERP_BASE_URL}/MovEstq/SaveMovEstqMultPart?action=Insert`,
      {
        method: "POST",
        headers: { "riosoft-token": auth.token },
        body: formData,
      }
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
