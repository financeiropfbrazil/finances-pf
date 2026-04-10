/**
 * Remove todos os caracteres não numéricos do CNPJ.
 */
export function stripCnpjMask(value: string): string {
  return (value || "").replace(/\D/g, "");
}

/**
 * Aplica máscara brasileira de CNPJ (00.000.000/0000-00) durante digitação.
 * Aceita string em qualquer estado (com ou sem máscara) e retorna formatado.
 */
export function applyCnpjMask(value: string): string {
  const digits = stripCnpjMask(value).substring(0, 14);
  if (digits.length === 0) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.substring(0, 2)}.${digits.substring(2)}`;
  if (digits.length <= 8) return `${digits.substring(0, 2)}.${digits.substring(2, 5)}.${digits.substring(5)}`;
  if (digits.length <= 12) return `${digits.substring(0, 2)}.${digits.substring(2, 5)}.${digits.substring(5, 8)}/${digits.substring(8)}`;
  return `${digits.substring(0, 2)}.${digits.substring(2, 5)}.${digits.substring(5, 8)}/${digits.substring(8, 12)}-${digits.substring(12, 14)}`;
}

/**
 * Valida se o CNPJ tem exatamente 14 dígitos (apenas contagem, sem validação de DV).
 * Retorna true se for válido para submissão, false caso contrário.
 * Aceita string vazia como válida (campo opcional).
 */
export function isValidCnpjLength(value: string): boolean {
  const digits = stripCnpjMask(value);
  if (digits.length === 0) return true; // opcional
  return digits.length === 14;
}
