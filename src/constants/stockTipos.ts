// Tipos de estoque visíveis no módulo de Estoque

export const TIPOS_VISIVEIS_ESTOQUE = [
  "01-Acabado",
  "02-Semi-Acabado",
  "03-Matéria Prima",
  "06-Material de Embalagem",
  "44-Insumos",
] as const;

export const TIPOS_LABEL: Record<string, string> = {
  "01-Acabado": "01 - Acabado",
  "02-Semi-Acabado": "02 - Semi-Acabado",
  "03-Matéria Prima": "03 - Matéria Prima",
  "06-Material de Embalagem": "06 - Material de Embalagem",
  "44-Insumos": "44 - Insumos",
};
