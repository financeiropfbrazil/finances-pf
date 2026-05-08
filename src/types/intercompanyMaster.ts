/**
 * Tipos da página /intercompany/master.
 * Consome v_intercompany_master_unificado via RPCs:
 *   - get_master_filtros_disponiveis()
 *   - listar_intercompany_master(filtros, page, page_size)
 */

// ─── Item da listagem ─────────────────────────────────────────────────

export type MasterOrigem = "Hub" | "Alvo";

export type MasterTipo = "reembolso" | "venda" | "servico" | "outros";

export type MasterEspecie = "INV" | "NF-e" | "NFS-e";

export type MasterStatusUnificado =
  | "rascunho"
  | "pendente_emissao"
  | "emitida"
  | "erro"
  | "sincronizada"
  | "classificada"
  | "pendente_eur"
  | "pendente_revisao"
  | "validada"
  | "reconciliada";

export interface MasterItem {
  id: string; // uuid (master) ou uuid (invoices)
  source_table: "master" | "invoices"; // discriminador interno
  origem: MasterOrigem;
  numero_invoice: string | null;
  tipo: MasterTipo;
  especie: MasterEspecie;
  data_emissao: string; // YYYY-MM-DD
  valor_eur: number;
  valor_brl: number;
  cambio: number;
  status_unificado: MasterStatusUnificado;
  status_label: string;
  status_motivo: string | null;
  classe_codigo: string | null;
  classe_nome: string | null;
  konto_at_numero: string | null;
  konto_at_descricao: string | null;
  chave_docfin_alvo: number | null;
  numero_documento_alvo: string | null;
  descricao: string | null;
  total_ccs: number;
  ccs_codigos: string[]; // array vazio se não houver rateios
  origem_categoria: string | null;
  created_at: string; // ISO timestamp
  emitida_em: string | null;
}

// ─── Filtros ──────────────────────────────────────────────────────────

export interface MasterFiltros {
  data_de?: string | null; // YYYY-MM-DD
  data_ate?: string | null;
  tipo?: MasterTipo | null;
  status?: MasterStatusUnificado | null;
  origem?: MasterOrigem | null;
  classe_codigo?: string | null;
  konto_at_numero?: string | null;
  cc_erp_code?: string | null;
  busca?: string | null;
}

// ─── Resposta da listagem ─────────────────────────────────────────────

export interface MasterPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface MasterStatusBucket {
  status: MasterStatusUnificado;
  label: string;
  qtd: number;
}

export interface MasterResumo {
  total_invoices: number;
  soma_eur: number;
  soma_brl: number;
  qtd_hub: number;
  qtd_alvo: number;
  por_status: MasterStatusBucket[];
}

export interface MasterListResponse {
  items: MasterItem[];
  pagination: MasterPagination;
  resumo: MasterResumo;
}

// ─── Filtros disponíveis (alimenta os dropdowns) ──────────────────────

export interface MasterFiltrosDisponiveis {
  anos: number[];
  tipos: MasterTipo[];
  status: { value: MasterStatusUnificado; label: string }[];
  origens: MasterOrigem[];
  classes: { codigo: string; nome: string }[];
  kontos: { numero: string; descricao: string }[];
  ccs: { erp_code: string; name: string }[];
}

// ─── Detalhes do rateio (consumido pelo accordion ao expandir linha) ──

export interface MasterRateioDetalhe {
  centro_custo_erp_code: string;
  centro_custo_nome: string | null;
  percentual: number;
  valor_eur: number;
  ordem: number;
}
