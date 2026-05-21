// ═══════════════════════════════════════════════════════════
// Types intercompany — preserva Frente 3 + adiciona Frente 4
// ═══════════════════════════════════════════════════════════

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

// ─────────────────────────────────────────────────────────────
// Frente 3 — Reembolso vinculado a NFs (mantido como estava)
// ─────────────────────────────────────────────────────────────

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
  rateios_cc: RateioCC[];
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
  rateios: RateioCC[];
  status: string;
}

export interface EmitInvGatewayResponse {
  success: boolean;
  chave_docfin_alvo?: number;
  numero_documento?: string;
  error?: string;
  error_details?: unknown;
}

// ═════════════════════════════════════════════════════════════
// Frente 4 — Reembolso Manual (sem NF de origem)
// ═════════════════════════════════════════════════════════════

/**
 * Rateio individual dentro de um bloco contábil manual.
 */
export interface RateioBlocoManual {
  centro_custo_erp_code: string;
  percentual: number; // 0 < pct ≤ 100
  valor_eur?: number; // calculado a partir do percentual do bloco
}

/**
 * Bloco contábil manual (1 classe + 1 Konto AT + N rateios CC).
 * Uma invoice pode ter múltiplos blocos somando o total.
 */
export interface BlocoManualInput {
  classe_codigo: string; // ex: "07.01"
  konto_austria_numero: string; // ex: "77603"
  valor_eur: number; // valor desse bloco em EUR (sub-total)
  rateios: RateioBlocoManual[]; // 1-5 CCs, soma 100%
}

/**
 * Input pra criar invoice de Reembolso Manual.
 */
export interface CriarReembolsoManualInput {
  numero_invoice: string;
  descricao_observacao: string; // vai pro campo Observação do Alvo
  description_pdf: string; // texto livre multi-linha que vai no PDF
  cambio_eur_brl: number;
  markup_aplicado: boolean; // toggle markup 25%
  valor_eur_service_fee: number; // valor digitado pela Sandra (base)
  valor_eur_total: number; // valor com markup aplicado (vai pro Alvo)
  observacoes_internas?: string;
  blocos: BlocoManualInput[]; // 1+ blocos, soma = valor_eur_total
}

/**
 * Retorno da RPC criar_invoice_reembolso_manual.
 */
export interface CriarReembolsoManualResult {
  success: boolean;
  master_id: string;
  numero_invoice: string;
  numero_sequencial: number;
  ano: number;
  valor_eur: number;
  valor_brl: number;
  valor_eur_service_fee: number;
  valor_eur_other_expenses: number;
  markup_aplicado: boolean;
  total_blocos: number;
  status: string;
}

/**
 * Resposta do gateway pra emit-inv-manual.
 * (Inclui campos opcionais de status do PDF.)
 */
export interface EmitInvManualGatewayResponse {
  success: boolean;
  chave_docfin_alvo?: number;
  numero_documento?: string;
  pdf_status?: {
    gerado: boolean;
    anexado_alvo: boolean;
    upload_identify_guid?: string;
    storage_path?: string;
    erro?: string;
  };
  error?: string;
  error_details?: unknown;
}
