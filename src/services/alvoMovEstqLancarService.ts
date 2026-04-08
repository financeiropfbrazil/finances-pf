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

async function buildPayload(input: LancarNfseInput, _token: string): Promise<any> {
  const v = input.valorServico;

  // Rateio do cabeçalho (vem do pedido cacheado)
  const classesList = input.classes.map(c => ({
    CodigoEmpresaFilial: "1.01",
    ChaveMovEstq: 1,
    CodigoClasseRecDesp: c.codigoClasseRecDesp,
    Valor: c.valor,
    Percentual: c.percentual,
    RateioMovEstqChildList: c.centrosCusto.map(cc => ({
      CodigoEmpresaFilial: "1.01",
      ChaveMovEstq: 1,
      CodigoClasseRecDesp: "",
      CodigoCentroCtrl: cc.codigoCentroCtrl,
      Valor: cc.valor,
      Percentual: cc.percentual,
    })),
  }));

  // Item de serviço — apenas o essencial
  const item: any = {
    CodigoEmpresaFilial: "1.01",
    CodigoProduto: input.codigoProduto,
    ChaveMovEstq: 0,
    Sequencia: 0,
    NumeroPedComp: input.pedidoNumero,
    CodigoEmpresaFilialPedComp: "1.01",
    SequenciaItemPedComp: input.sequenciaItemPedComp,
    QuantidadeProdUnidMedPrincipal: 1,
    ValorUnitario: v,
    ValorProduto: v,
    ItemServico: "Sim",
  };

  // Impostos vêm do modal (semântica que o backend não tem como adivinhar)
  const imp = input.impostos;

  // Cabeçalho — apenas o que o usuário preenche no Alvo nativo
  const classObject: any = {
    CodigoEmpresaFilial: "1.01",
    Chave: 0,
    CodigoTipoLanc: "E0000091",
    CodigoEntidade: input.codigoEntidade,
    Especie: "NFS-e",
    Serie: input.serie || "1",
    Numero: input.numero,
    ChaveAcessoNFe: input.chaveAcesso || null,
    NumeroPedComp: input.pedidoNumero,
    ValorServico: v,
    ValorDocumento: v,
    ItemMovEstqChildList: [item],
    MovEstqClasseRecDespChildList: classesList,
  };

  // Se há impostos declarados na NFS-e, anexa ao cabeçalho
  if (imp) {
    if (imp.valorISS > 0) {
      classObject.BaseISS = imp.baseISS;
      classObject.PercentualISS = imp.aliquotaISS;
      classObject.ValorISS = imp.valorISS;
    }
    if (imp.valorIRRF > 0) {
      classObject.BaseIRRF = imp.baseIRRF;
      classObject.ValorIRRF = imp.valorIRRF;
    }
    if (imp.valorINSS > 0) {
      classObject.BaseINSS = imp.baseINSS;
      classObject.ValorINSS = imp.valorINSS;
    }
    if (imp.valorPIS > 0) {
      classObject.BasePISRFServico = imp.basePIS;
      classObject.PercentualPISRFServico = imp.aliquotaPIS;
      classObject.ValorPISRFServico = imp.valorPIS;
    }
    if (imp.valorCOFINS > 0) {
      classObject.BaseCOFINSRFServico = imp.baseCOFINS;
      classObject.PercentualCOFINSRFServico = imp.aliquotaCOFINS;
      classObject.ValorCOFINSRFServico = imp.valorCOFINS;
    }
    if (imp.valorCSLL > 0) {
      classObject.BaseCSLLRFServico = imp.baseCSLL;
      classObject.PercentualCSLLRFServico = imp.aliquotaCSLL;
      classObject.ValorCSLLRFServico = imp.valorCSLL;
    }
  }

  // Parcelas — só envia se vieram do modal (caso contrário deixa o backend calcular)
  if (input.parcelas && input.parcelas.length > 0) {
    classObject.ParcPagMovEstqChildList = input.parcelas.map(p => ({
      CodigoEmpresaFilial: "1.01",
      ChaveMovEstq: 1,
      Sequencia: p.sequencia,
      EspecieDocumento: "NFS-e",
      SerieDocumento: input.serie || "1",
      NumeroDuplicata: p.numeroDuplicata,
      DataEmissao: `${p.dataEmissao}T00:00:00`,
      ValorParcela: p.valorParcela,
      DataVencimento: `${p.dataVencimento}T00:00:00`,
      DataProrrogacao: `${p.dataVencimento}T00:00:00`,
      CodigoTipoCobranca: "0000001",
    }));
  }

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
