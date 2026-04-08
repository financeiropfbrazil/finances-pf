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

function buildPayload(_input: LancarNfseInput, _uploadUuid: string): any {
  throw new Error("buildPayload not yet implemented — apply NFSE-V2-PART2");
}

// ── Caller (será preenchido em NFSE-V2-PART3) ──

export async function lancarNfseNoAlvo(_input: LancarNfseInput): Promise<LancarNfseResult> {
  return { success: false, error: "lancarNfseNoAlvo not yet implemented — apply NFSE-V2-PART3" };
}
