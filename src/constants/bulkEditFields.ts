/**
 * Catálogo de campos editáveis em massa via Bulk Edit.
 *
 * Cada entrada define:
 * - O nome do campo no payload do Alvo (key do objeto)
 * - Tipo de input (text livre, enum, número)
 * - Label amigável em PT-BR para a UI
 * - Para enums: lista de valores válidos com labels
 *
 * SEGURANÇA: só inclua aqui campos comprovadamente seguros de alterar em massa.
 * Campos fiscais (NCM, TipoProdFisc, RecuperaXxx) NÃO entram nesta lista.
 */

export type BulkEditFieldType = "text" | "enum";

export interface BulkEditEnumOption {
  value: string; // O que vai no payload do Alvo
  label: string; // O que o usuário vê
}

export interface BulkEditFieldDefinition {
  key: string; // Nome do campo no payload do Alvo (case-sensitive)
  label: string; // Nome para o usuário
  type: BulkEditFieldType;
  maxLength?: number; // Para type=text
  options?: BulkEditEnumOption[]; // Para type=enum
  helpText?: string; // Texto de ajuda opcional
}

/**
 * Whitelist de campos editáveis em massa para o tipo bulk "produtos_campos".
 *
 * Para adicionar um campo novo aqui:
 * 1. Confirmar que altera-lo via SavePartial não tem efeitos colaterais (testar com 1 produto)
 * 2. Adicionar entrada abaixo
 * 3. Para enums, mapear todos os valores válidos do Alvo
 */
export const BULK_EDIT_PRODUTO_FIELDS: BulkEditFieldDefinition[] = [
  {
    key: "Nome",
    label: "Nome do Produto",
    type: "text",
    maxLength: 80,
    helpText: "Nome principal exibido no Alvo e em documentos fiscais. Limite Alvo: 80 caracteres.",
  },
  {
    key: "NomeAlternativo1",
    label: "Nome Alternativo 1",
    type: "text",
    maxLength: 80,
  },
  {
    key: "NomeAlternativo2",
    label: "Nome Alternativo 2",
    type: "text",
    maxLength: 80,
  },
  {
    key: "NomeAlternativo3",
    label: "Nome Alternativo 3",
    type: "text",
    maxLength: 80,
  },
  {
    key: "CodigoBarras",
    label: "Código de Barras",
    type: "text",
    maxLength: 30,
  },
  {
    key: "Status",
    label: "Status",
    type: "enum",
    options: [
      { value: "Ativado", label: "Ativado" },
      { value: "Desativado", label: "Desativado" },
    ],
    helpText: "Cuidado: produtos desativados não aparecem em movimentações.",
  },
  {
    key: "CodigoTipoProduto",
    label: "Tipo de Produto",
    type: "enum",
    options: [
      { value: "01", label: "01 - Acabado" },
      { value: "02", label: "02 - Semi-Acabado" },
      { value: "03", label: "03 - Matéria Prima" },
      { value: "06", label: "06 - Material de Embalagem" },
      { value: "44", label: "44 - Insumos" },
    ],
    helpText: "Reflete o tipo de produto no Alvo. Afeta filtros e relatórios.",
  },
];

/**
 * Helper para localizar a definição de um campo pelo key.
 * Retorna undefined se o campo não estiver na whitelist.
 */
export function getBulkEditFieldByKey(key: string): BulkEditFieldDefinition | undefined {
  return BULK_EDIT_PRODUTO_FIELDS.find((f) => f.key === key);
}

/**
 * Helper para validar se um valor é aceitável para um campo enum.
 * Retorna null se válido, ou mensagem de erro se inválido.
 */
export function validateEnumValue(field: BulkEditFieldDefinition, value: string): string | null {
  if (field.type !== "enum" || !field.options) return null;
  const valid = field.options.some((opt) => opt.value === value || opt.label === value);
  if (!valid) {
    const validValues = field.options.map((o) => o.value).join(", ");
    return `Valor "${value}" inválido. Aceitos: ${validValues}`;
  }
  return null;
}

/**
 * Normaliza um valor de input do Excel para o formato esperado pelo Alvo.
 * Por exemplo, se o usuário colocar "Acabado" em vez de "01", localiza o código.
 */
export function normalizeEnumValue(field: BulkEditFieldDefinition, rawValue: string): string | null {
  if (field.type !== "enum" || !field.options) return rawValue;

  const trimmed = String(rawValue).trim();

  // 1. Match exato no value (mais comum: usuário cola o código)
  const byValue = field.options.find((o) => o.value === trimmed);
  if (byValue) return byValue.value;

  // 2. Match exato no label
  const byLabel = field.options.find((o) => o.label === trimmed);
  if (byLabel) return byLabel.value;

  // 3. Match case-insensitive no label parcial (ex: "Acabado" vira "01-Acabado")
  const byLabelPartial = field.options.find((o) => o.label.toLowerCase().includes(trimmed.toLowerCase()));
  if (byLabelPartial) return byLabelPartial.value;

  return null; // Não encontrou
}
