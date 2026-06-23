// src/services/cartaoImportService.ts
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

/* ──────────────────────────────────────────────────────────────────────────
   TIPOS
   ────────────────────────────────────────────────────────────────────────── */

export type StatusLote = "rascunho" | "parcial" | "emitido";
export type StatusLinha = "pendente_entidade" | "pronto" | "emitido" | "ignorado";

export interface CartaoLote {
  id: string;
  titular: string;
  final_cartao: string | null;
  codigo_tipo_pag_rec: string;
  competencia: string;       // date ISO (YYYY-MM-DD)
  data_vencimento: string;   // date ISO
  status: StatusLote;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // agregados (preenchidos por loadLotes)
  total_linhas?: number;
  total_prontas?: number;
  total_emitidas?: number;
  total_pendentes?: number;
  total_ignoradas?: number;
}

export interface CartaoItem {
  id: string;
  lote_id: string;
  data_transacao: string;            // date ISO
  descricao_estabelecimento: string;
  cnpj_bruto: string | null;
  cnpj_normalizado: string | null;
  valor: number;
  justificativa: string | null;
  codigo_entidade: string | null;
  codigo_classe_rec_desp: string | null;
  codigo_centro_ctrl: string | null;
  status_linha: StatusLinha;
  motivo_ignorado: string | null;
  ignorado_by: string | null;
  ignorado_at: string | null;
  docfin_chave: number | null;
  docfin_numero: string | null;
  emitido_at: string | null;
  created_at: string;
  updated_at: string;
}

// Dropdowns
export interface ClasseOption {
  codigo: string;
  nome: string;
  natureza: string | null;
}
export interface CentroCustoOption {
  erp_code: string;
  name: string;
}
export interface EntidadeOption {
  codigo_entidade: string;
  cnpj: string | null;
  nome: string;
  nome_fantasia: string | null;
}

// Linha crua do parser da planilha
export interface ParsedLinha {
  data_transacao: string | null;
  descricao_estabelecimento: string;
  cnpj_bruto: string | null;
  cnpj_normalizado: string | null;
  valor: number;
  justificativa: string | null;
  codigo_entidade: string | null;   // pré-resolvido por match de CNPJ
}

export interface ParseResult {
  linhas: ParsedLinha[];
  totalLinhas: number;
  totalComEntidade: number;
  totalSemEntidade: number;
}

/* ──────────────────────────────────────────────────────────────────────────
   HELPERS — CNPJ
   ────────────────────────────────────────────────────────────────────────── */

/** Normaliza CNPJ: só dígitos, zfill 14. Retorna null se inválido (≠14 dígitos). */
export function normalizarCnpj(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 0) return null;
  // CPF (11) ou lixo → inválido para entidade
  if (digits.length > 14) return null;
  const padded = digits.padStart(14, "0");
  if (padded.length !== 14) return null;
  // rejeita placeholders óbvios (todos iguais, ex.: 111... do CPF inválido)
  if (/^(\d)\1{13}$/.test(padded)) return null;
  return padded;
}

/* ──────────────────────────────────────────────────────────────────────────
   HELPERS — datas / valores da planilha
   ────────────────────────────────────────────────────────────────────────── */

/** Converte célula de data (string dd-mm-yyyy, dd/mm/yyyy, ou serial Excel) → YYYY-MM-DD. */
function parseDataCelula(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;

  // Serial numérico do Excel
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y) {
      return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    }
    return null;
  }

  const s = String(v).trim();
  // dd-mm-yyyy ou dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }
  // yyyy-mm-dd já válido
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/** Converte valor BR ("1.234,56" ou 1234.56) → number. */
function parseValorCelula(v: unknown): number {
  if (typeof v === "number") return v;
  if (v === null || v === undefined) return 0;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/* ──────────────────────────────────────────────────────────────────────────
   PARSER DA PLANILHA (layout fixo — aba "RELAÇÃO CNPJ", cabeçalho na linha 2)
   Colunas: Data | Descrição | CNPJ | Valor da Moeda | Conciliado no ALVO | DESCRIÇÃO NA ONFLY
   ────────────────────────────────────────────────────────────────────────── */

const ABA_ESPERADA = "RELAÇÃO CNPJ";

/**
 * Lê o arquivo .xlsx e devolve as linhas parseadas, já com a entidade
 * pré-resolvida quando o CNPJ normalizado casa com compras_entidades_cache.
 */
export async function parsePlanilhaCartao(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  // localiza a aba (tolera variação de acento/caixa)
  const sheetName =
    wb.SheetNames.find((n) => n.trim().toUpperCase() === ABA_ESPERADA.toUpperCase()) ||
    wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Aba "${ABA_ESPERADA}" não encontrada na planilha.`);

  // matriz de linhas (array de arrays), preservando posições
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  // cabeçalho está na linha 2 (índice 1); dados a partir da linha 3 (índice 2)
  // valida o cabeçalho minimamente
  const header = (rows[1] || []).map((c) => String(c ?? "").trim().toLowerCase())