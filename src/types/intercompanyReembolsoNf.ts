/**
 * Tipos da Frente 3 — Intercompany / Reembolso NF.
 *
 * Esta frente converte NFs do MovEstq Alvo (compras BR) em INVs intercompany
 * multi-classe para PEF Áustria.
 *
 * ⚠️ IMPORTANTE — Sincronização com gateway:
 *   `EmitReembolsoNFRequest`, `EmitReembolsoNFResponse` e `RascunhoDetails*`
 *   espelham o contrato definido em
 *   `erp-proxy/src/types/intercompany-reembolso-nf-emit.ts` do Render.
 *   Se um lado mudar, o outro precisa mudar junto.
 */

// ═════════════════════════════════════════════════════════════
// 1. Tipos de bloco (vocabulário interno do Hub)
// ═════════════════════════════════════════════════════════════

/**
 * Os 8 tipos de bloco que a Sandra pode escolher no Lado 2.
 * Cada tipo mapeia 1:1 pra um Konto AT e pra uma classe Alvo (07.x / 01.x).
 */
export type TipoBloco =
  | "product_cmv"
  | "product_cmv_usa"
  | "inventory_valves_lab"
  | "rd_materials"
  | "service_rd_namsa"
  | "freight"
  | "travel_expenses"
  | "other_operating_expenses";

/** Label amigável pro dropdown da Sandra no Lado 2. */
export const TIPO_BLOCO_LABELS: Record<TipoBloco, string> = {
  product_cmv: "Product CMV (57520)",
  product_cmv_usa: "Product CMV USA (57530)",
  inventory_valves_lab: "Inventory Valves Lab (77608)",
  rd_materials: "R&D Materials (77603)",
  service_rd_namsa: "R&D Namsa Services (77601)",
  freight: "Freight (54401)",
  travel_expenses: "Travel Expenses (73403)",
  other_operating_expenses: "Other Operating Expenses (77930)",
};

/** TipoBloco → número do Konto AT. */
export const TIPO_BLOCO_KONTO: Record<TipoBloco, string> = {
  product_cmv: "57520",
  product_cmv_usa: "57530",
  inventory_valves_lab: "77608",
  rd_materials: "77603",
  service_rd_namsa: "77601",
  freight: "54401",
  travel_expenses: "73403",
  other_operating_expenses: "77930",
};

/**
 * TipoBloco → classe Alvo (07.x / 01.x).
 * Espelhado em `erp-proxy/src/types/intercompany-reembolso-nf-emit.ts`
 * e no CASE da RPC `convert_rascunho_to_master_for_user`.
 */
export const TIPO_BLOCO_TO_CLASSE_ALVO: Record<TipoBloco, string> = {
  product_cmv: "01.03",
  product_cmv_usa: "01.03",
  inventory_valves_lab: "07.04",
  rd_materials: "07.01",
  service_rd_namsa: "01.07",
  freight: "07.03",
  travel_expenses: "07.02",
  other_operating_expenses: "07.06",
};

/** Ordem visual estável pro dropdown. */
export const TIPOS_BLOCO_ORDENADOS: TipoBloco[] = [
  "rd_materials",
  "service_rd_namsa",
  "inventory_valves_lab",
  "freight",
  "travel_expenses",
  "product_cmv",
  "product_cmv_usa",
  "other_operating_expenses",
];

// ═════════════════════════════════════════════════════════════
// 2. View v_movestq_disponivel (Lado 1 — NFs disponíveis)
// ═════════════════════════════════════════════════════════════

/**
 * 8 espécies de documento que aparecem no MovEstq.
 * Sandra pode filtrar por espécie no Lado 1.
 */
export type Especie = "NF-e" | "NFS-e" | "CT-e" | "DIV" | "FAT" | "NFCom" | "NF3E" | "LAUDO";

export const ESPECIES_DISPONIVEIS: Especie[] = ["NF-e", "NFS-e", "CT-e", "DIV", "FAT", "NFCom", "NF3E", "LAUDO"];

/**
 * Status de classificação contábil:
 * - "classificado": tem classe + CC + rateio preenchidos → SELECIONÁVEL.
 * - "aguardando_classificacao": NF entrou no cache mas contabilidade ainda
 *   não preencheu classe/CC no Alvo (ex: LAUDOs BioCollagen). Aparece na UI
 *   com cadeado, NÃO selecionável. Filtro default esconde.
 */
export type StatusClassificacao = "classificado" | "aguardando_classificacao";

/**
 * Linha da view `v_movestq_disponivel`. Granularidade canônica = sub-linha
 * de rateio (uma NF com 3 classes × 2 CCs aparece como 6 linhas).
 *
 * Quando status = "aguardando_classificacao":
 *   - `rateio_id`, `codigo_classe`, `nome_classe`, `codigo_centro_ctrl`,
 *     `nome_centro_ctrl`, `valor_rateio`, `percentual` vêm NULL.
 *   - `valor_doc_total` e demais campos do header sempre vêm preenchidos.
 *
 * Datas:
 *   - `data_emissao`: data da NF do fornecedor. CANÔNICA pra Sandra
 *     (filtro, ordenação, exibição). É o "quando o gasto aconteceu".
 *   - `data_movimento`: data do lançamento no estoque. Disponível pra uso
 *     futuro (tooltip, coluna alternativa). UI atual não usa.
 */
export interface MovEstqDisponivel {
  /**
   * UUID da sub-linha em intercompany_movestq_rateio.
   * É o que vai pra add_rateio_to_rascunho.
   * NULL quando status = "aguardando_classificacao" (não selecionável).
   */
  rateio_id: string | null;

  /** Chave do MovEstq no Alvo (header da NF). */
  chave_movestq: number;

  /** Espécie do documento. */
  especie: Especie;

  /** Número do documento (ex: "30597", "1485"). */
  numero: string;

  /** Data de emissão da NF pelo fornecedor. ISO YYYY-MM-DD. CANÔNICA. */
  data_emissao: string;

  /** Data de movimentação no estoque. ISO YYYY-MM-DD. Disponível, não usado pela UI atual. */
  data_movimento: string;

  /** Razão social do fornecedor. */
  nome_entidade: string;

  /** Valor TOTAL da NF (header). Mostrado no header agrupado. */
  valor_doc_total: number;

  /** Classe contábil BR (ex: "11.01"). NULL quando aguardando. */
  codigo_classe: string | null;

  /** Nome da classe contábil BR. NULL quando aguardando. */
  nome_classe: string | null;

  /** Centro de custo (ex: "00001.00004.00002"). NULL quando aguardando. */
  codigo_centro_ctrl: string | null;

  /** Nome do CC. NULL quando aguardando. */
  nome_centro_ctrl: string | null;

  /** Valor BRL desta sub-linha (já com split de rateio). NULL quando aguardando. */
  valor_rateio: number | null;

  /** Percentual desta sub-linha dentro da classe. NULL quando aguardando. */
  percentual: number | null;

  /** Total de sub-linhas (rateios) que essa NF tem. Define modo de render. */
  total_rateios_na_nf: number;

  /** Total de classes contábeis distintas na NF. Define modo de render. */
  total_classes_na_nf: number;

  /** Status de classificação. Filtra quem é selecionável. */
  status_classificacao: StatusClassificacao;
}

// ═════════════════════════════════════════════════════════════
// 3. RPCs do rascunho (Lado 2 — cesta)
// ═════════════════════════════════════════════════════════════

/**
 * Item da cesta. Espelha `RascunhoDetailsItem` do gateway, com `tipo_bloco`
 * apertado pra `TipoBloco | null` em vez de `string`.
 */
export interface RascunhoItem {
  item_id: string;
  ordem: number;
  movestq_rateio_id: string;
  tipo_bloco: TipoBloco | null;
  konto_at_numero: string | null;
  classification_status: "classified" | "needs_konto_at";

  // ─── Dados da NF de origem (denormalizados pra UI não precisar de join) ───
  chave_movestq: number;
  especie: string;
  numero: string;
  nome_entidade: string;

  // ─── Dados do rateio de origem ───
  codigo_classe: string;
  nome_classe: string | null;
  codigo_centro_ctrl: string;
  nome_centro_ctrl: string | null;
  valor_brl: number;
}

/**
 * Retorno da RPC `get_rascunho_details()`. Estado completo da cesta.
 *
 * ⚠️ `total_eur` NÃO existe aqui. EUR só existe depois da Sandra preencher
 * câmbio no modal — cálculo client-side.
 */
export interface RascunhoDetails {
  rascunho_id: string | null;
  descricao: string | null;
  items: RascunhoItem[];
  total_itens: number;
  total_brl: number;
  total_needs_konto_at: number;
  total_classified: number;
  ready_to_emit: boolean;
}

/** Retorno da RPC `init_or_resume_rascunho()`. */
export interface InitOrResumeRascunhoResult {
  rascunho_id: string;
  was_resumed: boolean;
  total_itens: number;
}

/** Retorno genérico das RPCs de mutação (add/remove/set/discard). */
export interface RascunhoMutationResult {
  success: boolean;
  message?: string;
  item?: RascunhoItem;
}

// ═════════════════════════════════════════════════════════════
// 4. Sugestão de número de invoice
// ═════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════
// 5. Rota /intercompany/reembolso-nf/emit (gateway)
// ═════════════════════════════════════════════════════════════

export interface EmitReembolsoNFRequest {
  numero_invoice: string;
  cambio_eur_brl: number;
  data_emissao: string;
  descricao_rica: string;
}

export interface ConvertRascunhoResult {
  success: boolean;
  master_id: string;
  numero_invoice: string;
  chave_docfin_alvo: number;
  blocos_criados: number;
  valor_eur_total: number;
  valor_brl_total: number;
  cambio_eur_brl: number;
}

export interface EmitReembolsoNFResponse {
  success: boolean;
  error?: string;
  error_details?: unknown;
  payload_alvo_enviado?: unknown;
  alvo_response?: unknown;
  master?: ConvertRascunhoResult;
  chave_docfin_alvo_orfa?: number;
}

// ═════════════════════════════════════════════════════════════
// 6. Rota /intercompany/movestq/sync (gateway)
// ═════════════════════════════════════════════════════════════

export interface SyncMovEstqRequest {
  dataInicial: string;
  dataFinal: string;
}

export interface SyncMovEstqResponse {
  success: boolean;
  error?: string;
  summary?: {
    nfs_processadas: number;
    rateios_distribuidos: number;
    nfs_aguardando_classificacao?: number;
    duracao_ms?: number;
  };
}

// ═════════════════════════════════════════════════════════════
// 7. Filtros do Lado 1
// ═════════════════════════════════════════════════════════════

/**
 * Filtros aplicados como WHERE clause no SELECT da view.
 *
 * Defaults aplicados pelo service quando não informado:
 *   - status_classificacao = "classificado" (esconde aguardando)
 *   - data_emissao_de = hoje - 30 dias (evita query gigante)
 */
export interface MovEstqFiltros {
  /** Range de data de emissão da NF. Canônica pra Sandra. */
  data_emissao_de?: string | null;
  data_emissao_ate?: string | null;

  /** Texto livre — busca em fornecedor e número. */
  busca?: string | null;

  /** Filtro exato por classe BR (ex: "11.01"). */
  codigo_classe?: string | null;

  /** Filtro exato por CC. */
  codigo_centro_ctrl?: string | null;

  /** Filtro por espécie. */
  especie?: Especie | null;

  /**
   * Filtro por status. Default = "classificado" se não informado.
   * Use null EXPLÍCITO pra ver todos (incluindo aguardando).
   */
  status_classificacao?: StatusClassificacao | null;
}
