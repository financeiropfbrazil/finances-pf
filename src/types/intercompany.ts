export interface SugestaoNumeroInvoice {
  ano: number;
  sugestao: string;
  sugestao_sequencial: number;
  maior_sequencial: number;
  maior_sequencial_alvo: number;
  maior_sequencial_master: number;
  total_invoices_alvo: number;
  total_invoices_master: number;
  ultima_sincronizacao: string | null;
}

export interface ClasseIntercompanyOption {
  classe_codigo: string;
  classe_nome: string;
  classe_grupo: string;
  classe_natureza: string;
  conta_contabil_reduzida: number | null;
  konto_at_default: string;
  konto_at_descricao: string;
  prioridade: number;
}

/**
 * Item individual de rateio de CC.
 * Usado tanto na criação (input) quanto no retorno (output).
 */
export interface RateioCC {
  centro_custo_erp_code: string;
  percentual: number; // 0 < pct ≤ 100
  valor_eur?: number; // calculado pelo backend; opcional no input
  ordem?: number; // calculado pelo backend; opcional no input
}

export interface CriarReembolsoInput {
  numero_invoice: string;
  descricao_rica: string;
  classe_codigo: string;
  konto_austria_numero: string;
  rateios_cc: RateioCC[]; // ✅ NOVO: substitui centro_custo_erp_code (1-5 items, soma=100%)
  cambio_eur_brl: number;
  valor_eur: number;
  observacoes?: string;
}

export interface CriarReembolsoResult {
  success: boolean;
  master_id: string;
  numero_invoice: string;
  numero_sequencial: string;
  valor_brl: number;
  rateios: RateioCC[]; // ✅ NOVO: array completo retornado pelo backend
  status: string;
}

export interface EmitInvGatewayResponse {
  success: boolean;
  chave_docfin_alvo?: number;
  numero_documento?: string;
  error?: string;
  error_details?: unknown;
}
