/**
 * Whitelist dos tipos de produto exibidos no módulo de Estoque
 * (Posição, Fechamentos, Comparativo, Relatórios).
 *
 * Decisão da Controladoria: somente esses 5 tipos compõem o controle
 * de estoque do Financial Hub. Outros tipos (05-Revenda, tipos numéricos
 * sem label, serviços, EPI, TI, etc.) existem em stock_products e podem
 * ser usados em outros módulos (Requisições, Projetos), mas NÃO entram
 * no relatório de estoque.
 *
 * Importante: este filtro é aplicado APENAS na renderização das telas
 * de Estoque. A captura de saldos via API (capturarSaldoMensal) continua
 * trazendo todos os produtos ativos, para preservar histórico caso a
 * whitelist mude no futuro.
 */
export const TIPOS_VISIVEIS_ESTOQUE = [
  "01-Acabado",
  "02-Semi-Acabado",
  "03-Matéria Prima",
  "06-Material de Embalagem",
  "44-Insumos",
] as const;

/**
 * Labels amigáveis para exibição em UI.
 * Mantém a chave igual ao valor de `tipo_produto` em stock_products.
 */
export const TIPOS_LABEL: Record<string, string> = {
  "01-Acabado": "01 - Acabado",
  "02-Semi-Acabado": "02 - Semi-Acabado",
  "03-Matéria Prima": "03 - Matéria Prima",
  "06-Material de Embalagem": "06 - Material de Embalagem",
  "44-Insumos": "44 - Insumos",
};
