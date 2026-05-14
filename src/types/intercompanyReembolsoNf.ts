/**
 * Tipos da Frente 3 — Intercompany / Reembolso NF.
 *
 * Esta frente converte NFs do MovEstq Alvo (compras BR) em INVs intercompany
 * multi-classe para PEF Áustria. Diferença vs Frente Master (intercompanyMaster.ts)
 * e Frente 2 (intercompany.ts):
 *   - Origem: rateios do MovEstq do Alvo (Cenário A — link, não reuso).
 *   - Multi-classe: 1 INV agrega N items de classes contábeis diferentes.
 *   - Rascunho: cesta persistida em `intercompany_reembolso_nf_rascunho`.
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

/**
 * Label amigável pro dropdown da Sandra no Lado 2.
 * Formato: "Descrição (Konto AT)".
 */
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

/**
 * Mapeamento TipoBloco → número do Konto AT.
 * Usado pra extrair o `konto_at_numero` que vai pra RPC `set_rascunho_item_konto`.
 */
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
 * Mapeamento TipoBloco → classe Alvo (07.x / 01.x).
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

/** Array ordenado pra iterar no dropdown (mantém ordem visual estável). */
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
 * Status do rateio MovEstq na view.
 * - "disponivel": pronto pra adicionar à cesta.
 * - "aguardando_classificacao": NF entrou no cache mas não tem classe/CC preenchido
 *   no Alvo (ex: LAUDOs BioCollagen). Não selecionável.
 * Campo é opcional: a view pode filtrar e nunca retornar o status amarelo;
 * nesse caso, tudo que aparece é implicitamente "disponivel".
 */
export type MovEstqStatus = "disponivel" | "aguardando_classificacao";

/**
 * Linha da view `v_movestq_disponivel`. Granularidade = sub-linha de rateio
 * (uma NF com 3 classes × 2 CCs aparece como 6 linhas).
 */
export interface MovEstqDisponivel {
  /** UUID da sub-linha em intercompany_movestq_rateio. É o que vai pra add_rateio_to_rascunho. */
  rateio_id: string;

  /** Chave do MovEstq no Alvo (header da NF). */
  chave_movestq: number;

  /** Ex: "NF-e", "DIV", "NFS-e". */
  especie: string;

  /** Número da NF (ex: "30597", "1485"). */
  numero: string;

  /** Data de emissão. ISO YYYY-MM-DD. */
  data_emissao: string;

  /** Razão social do fornecedor. */
  nome_entidade: string;

  /** CNPJ/CPF do fornecedor (pra filtro). */
  cnpj_entidade: string | null;

  /** Classe contábil BR (ex: "11.01", "14.04"). */
  codigo_classe: string;

  /** Nome da classe contábil BR (pode estar vazio se não enriquecido). */
  nome_classe: string | null;

  /** Centro de custo (ex: "00001.00004.00002"). */
  codigo_centro_ctrl: string;

  /** Nome do CC (pode estar vazio). */
  nome_centro_ctrl: string | null;

  /**
   * Ordem da classe dentro da NF (1, 2, 3...). Junto com ordem_rateio compõe
   * a granularidade canônica da Solução C.
   */
  ordem_classe: number;

  /** Ordem do rateio dentro da classe. */
  ordem_rateio: number;

  /** Valor BRL desta sub-linha (após split de rateio se houver). */
  valor_brl: number;

  /** Status do rateio. Opcional: ver MovEstqStatus. */
  status?: MovEstqStatus;
}

// ═════════════════════════════════════════════════════════════
// 3. RPCs do rascunho (Lado 2 — cesta)
// ═════════════════════════════════════════════════════════════

/**
 * Item da cesta. Espelha `RascunhoDetailsItem` do gateway, mas com `tipo_bloco`
 * apertado pra `TipoBloco | null` em vez de `string`.
 *
 * Por que nullable: enquanto a Sandra não escolhe o Konto no dropdown,
 * `tipo_bloco` e `konto_at_numero` vêm null da RPC.
 */
export interface RascunhoItem {
  item_id: string;

  /** Ordem do item dentro do rascunho (1, 2, 3...). */
  ordem: number;

  /** UUID do rateio MovEstq de origem (FK pra intercompany_movestq_rateio). */
  movestq_rateio_id: string;

  /** Tipo de bloco escolhido pela Sandra. Null até ela preencher. */
  tipo_bloco: TipoBloco | null;

  /** Número do Konto AT correspondente. Null até a Sandra preencher. */
  konto_at_numero: string | null;

  /**
   * Status de classificação:
   * - "classified": tipo_bloco e konto_at_numero preenchidos.
   * - "needs_konto_at": item adicionado mas sem Konto escolhido.
   */
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
 * Retorno da RPC `get_rascunho_details()`. Estado completo da cesta da Sandra.
 *
 * ⚠️ Atenção: `total_eur` NÃO existe aqui. EUR só existe depois da Sandra
 * preencher câmbio no modal — o cálculo é client-side.
 */
export interface RascunhoDetails {
  rascunho_id: string | null;
  descricao: string | null;
  items: RascunhoItem[];

  /** Quantidade total de itens na cesta. */
  total_itens: number;

  /** Soma dos valor_brl de todos os itens. */
  total_brl: number;

  /** Quantos itens ainda precisam de Konto AT. */
  total_needs_konto_at: number;

  /** Quantos itens já estão classificados. */
  total_classified: number;

  /** True quando total_needs_konto_at = 0 e total_itens > 0. Habilita botão "Gerar INV". */
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
  /** Item criado/atualizado quando aplicável. */
  item?: RascunhoItem;
}

// ═════════════════════════════════════════════════════════════
// 4. Sugestão de número de invoice
// ═════════════════════════════════════════════════════════════

/**
 * Retorno da RPC `sugerir_proximo_numero_invoice(p_ano)`.
 *
 * Estrutura idêntica à da Frente Master/Frente 2 — re-declarada aqui em vez
 * de importar de @/types/intercompany pra manter a Frente 3 auto-contida.
 */
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

/**
 * Body do POST /intercompany/reembolso-nf/emit.
 * Espelha `EmitReembolsoNFRequest` do erp-proxy.
 */
export interface EmitReembolsoNFRequest {
  /** Formato "NNN/AAAA". Sandra preenche/edita o sugerido. Valida UNIQUE no banco. */
  numero_invoice: string;

  /** Cotação EUR→BRL no momento do emit. Sandra preenche manualmente. */
  cambio_eur_brl: number;

  /** YYYY-MM-DD. Default = hoje. */
  data_emissao: string;

  /** Texto livre p/ campo Observacao do DocFin. */
  descricao_rica: string;
}

/**
 * Resultado da conversão rascunho → master (parte da resposta de sucesso).
 * Espelha `ConvertRascunhoResult` do erp-proxy.
 */
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

/**
 * Resposta do POST /intercompany/reembolso-nf/emit.
 * Espelha `EmitReembolsoNFResponse` do erp-proxy.
 *
 * Campos opcionais cobrem 3 cenários:
 *   - Sucesso: success=true, master + alvo_response + payload_alvo_enviado preenchidos.
 *   - Erro Alvo (validação rejeitada): success=false, error + payload_alvo_enviado.
 *   - Erro tardio (Alvo OK, Hub falhou): success=false, error + chave_docfin_alvo_orfa.
 *     Sandra precisa avisar TI — DocFin existe no Alvo mas não tem master no Hub.
 */
export interface EmitReembolsoNFResponse {
  success: boolean;
  error?: string;
  error_details?: unknown;
  payload_alvo_enviado?: unknown;
  alvo_response?: unknown;
  master?: ConvertRascunhoResult;
  /** Chave DocFin órfã em caso de erro tardio. UI mostra alerta pra TI. */
  chave_docfin_alvo_orfa?: number;
}

// ═════════════════════════════════════════════════════════════
// 6. Rota /intercompany/movestq/sync (gateway)
// ═════════════════════════════════════════════════════════════

export interface SyncMovEstqRequest {
  /** YYYY-MM-DD. */
  dataInicial: string;
  /** YYYY-MM-DD. */
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
 * Filtros aplicados client-side sobre `MovEstqDisponivel[]`.
 * Mantemos client-side porque 603 NFs cabem tranquilo em memória.
 */
export interface MovEstqFiltros {
  /** Range de data de emissão. */
  data_de?: string | null;
  data_ate?: string | null;

  /** Texto livre — busca em fornecedor, número, classe. */
  busca?: string | null;

  /** Filtro exato por classe BR (ex: "11.01"). */
  codigo_classe?: string | null;

  /** Filtro exato por CC. */
  codigo_centro_ctrl?: string | null;
}
