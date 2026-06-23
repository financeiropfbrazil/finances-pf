// src/services/cartaoImportService.ts
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

const sb = supabase as any; // tabelas cartao_* ainda não estão no types.ts gerado

/* ───────────── TIPOS ───────────── */

export type StatusLote = "rascunho" | "parcial" | "emitido";
export type StatusLinha = "pendente_entidade" | "pronto" | "emitido" | "ignorado";

export interface CartaoLote {
  id: string;
  titular: string;
  final_cartao: string | null;
  codigo_tipo_pag_rec: string;
  competencia: string;
  data_vencimento: string;
  status: StatusLote;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  total_linhas?: number;
  total_prontas?: number;
  total_emitidas?: number;
  total_pendentes?: number;
  total_ignoradas?: number;
}

export interface CartaoItem {
  id: string;
  lote_id: string;
  data_transacao: string;
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

export interface ParsedLinha {
  data_transacao: string | null;
  descricao_estabelecimento: string;
  cnpj_bruto: string | null;
  cnpj_normalizado: string | null;
  valor: number;
  justificativa: string | null;
  codigo_entidade: string | null;
}

export interface ParseResult {
  linhas: ParsedLinha[];
  totalLinhas: number;
  totalComEntidade: number;
  totalSemEntidade: number;
}

/* ───────────── HELPERS CNPJ ───────────── */

export function normalizarCnpj(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length > 14) return null;
  const padded = digits.padStart(14, "0");
  if (padded.length !== 14) return null;
  if (/^(\d)\1{13}$/.test(padded)) return null;
  return padded;
}

/* ───────────── HELPERS DATA/VALOR ───────────── */

function parseDataCelula(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    return null;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function parseValorCelula(v: unknown): number {
  if (typeof v === "number") return v;
  if (v === null || v === undefined) return 0;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/* ───────────── PARSER ───────────── */

const ABA_ESPERADA = "RELAÇÃO CNPJ";

export async function parsePlanilhaCartao(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const sheetName =
    wb.SheetNames.find((n) => n.trim().toUpperCase() === ABA_ESPERADA.toUpperCase()) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Aba "${ABA_ESPERADA}" não encontrada na planilha.`);

  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  const header = (rows[1] || []).map((c) =>
    String(c ?? "")
      .trim()
      .toLowerCase(),
  );
  const temCabecalho =
    header.some((h) => h.includes("data")) &&
    header.some((h) => h.includes("cnpj")) &&
    header.some((h) => h.includes("valor"));
  const dataStart = temCabecalho ? 2 : 1;

  const brutas: Omit<ParsedLinha, "codigo_entidade">[] = [];
  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i] || [];
    const data = r[0];
    const desc = r[1];
    const cnpj = r[2];
    const valor = r[3];
    const onfly = r[5];

    if (
      (data === null || data === undefined || data === "") &&
      (desc === null || desc === undefined || desc === "") &&
      (valor === null || valor === undefined || valor === "")
    ) {
      continue;
    }

    const descricao = String(desc ?? "").trim();
    if (!descricao) continue;

    brutas.push({
      data_transacao: parseDataCelula(data),
      descricao_estabelecimento: descricao,
      cnpj_bruto: cnpj === null || cnpj === undefined ? null : String(cnpj).trim(),
      cnpj_normalizado: normalizarCnpj(cnpj),
      valor: parseValorCelula(valor),
      justificativa: onfly === null || onfly === undefined ? null : String(onfly).trim() || null,
    });
  }

  const cnpjsUnicos = Array.from(new Set(brutas.map((b) => b.cnpj_normalizado).filter((c): c is string => !!c)));
  const mapaCnpjParaCodigo = await resolverEntidadesPorCnpj(cnpjsUnicos);

  const linhas: ParsedLinha[] = brutas.map((b) => ({
    ...b,
    codigo_entidade: b.cnpj_normalizado ? (mapaCnpjParaCodigo[b.cnpj_normalizado] ?? null) : null,
  }));

  const totalComEntidade = linhas.filter((l) => l.codigo_entidade).length;
  return {
    linhas,
    totalLinhas: linhas.length,
    totalComEntidade,
    totalSemEntidade: linhas.length - totalComEntidade,
  };
}

async function resolverEntidadesPorCnpj(cnpjs: string[]): Promise<Record<string, string>> {
  const mapa: Record<string, string> = {};
  if (cnpjs.length === 0) return mapa;
  const CHUNK = 200;
  for (let i = 0; i < cnpjs.length; i += CHUNK) {
    const slice = cnpjs.slice(i, i + CHUNK);
    const { data, error } = await sb.from("compras_entidades_cache").select("codigo_entidade, cnpj").in("cnpj", slice);
    if (error) {
      console.warn("[cartao] erro resolvendo entidades por CNPJ:", error.message);
      continue;
    }
    (data || []).forEach((row: any) => {
      if (row.cnpj && row.codigo_entidade) mapa[row.cnpj] = row.codigo_entidade;
    });
  }
  return mapa;
}

/* ───────────── CRUD LOTES ───────────── */

export async function loadLotes(competenciaYYYYMM: string): Promise<CartaoLote[]> {
  const inicio = `${competenciaYYYYMM}-01`;
  const [y, m] = competenciaYYYYMM.split("-").map(Number);
  const proximo = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const { data: lotes, error } = await sb
    .from("cartao_import_lote")
    .select("*")
    .gte("competencia", inicio)
    .lt("competencia", proximo)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Erro ao carregar lotes: ${error.message}`);
  const lista = (lotes || []) as CartaoLote[];
  if (lista.length === 0) return [];

  const ids = lista.map((l) => l.id);
  const { data: itens } = await sb.from("cartao_import_item").select("lote_id, status_linha").in("lote_id", ids);

  const cont: Record<string, { t: number; pr: number; em: number; pe: number; ig: number }> = {};
  (itens || []).forEach((it: any) => {
    const c = (cont[it.lote_id] ??= { t: 0, pr: 0, em: 0, pe: 0, ig: 0 });
    c.t++;
    if (it.status_linha === "pronto") c.pr++;
    else if (it.status_linha === "emitido") c.em++;
    else if (it.status_linha === "ignorado") c.ig++;
    else c.pe++;
  });

  return lista.map((l) => {
    const c = cont[l.id] ?? { t: 0, pr: 0, em: 0, pe: 0, ig: 0 };
    return {
      ...l,
      total_linhas: c.t,
      total_prontas: c.pr,
      total_emitidas: c.em,
      total_pendentes: c.pe,
      total_ignoradas: c.ig,
    };
  });
}

export async function criarLoteComLinhas(params: {
  titular: string;
  final_cartao: string | null;
  codigo_tipo_pag_rec: string;
  competencia: string;
  data_vencimento: string;
  linhas: ParsedLinha[];
  created_by: string | null;
}): Promise<CartaoLote> {
  const { data: lote, error: errLote } = await sb
    .from("cartao_import_lote")
    .insert({
      titular: params.titular,
      final_cartao: params.final_cartao,
      codigo_tipo_pag_rec: params.codigo_tipo_pag_rec,
      competencia: params.competencia,
      data_vencimento: params.data_vencimento,
      status: "rascunho",
      created_by: params.created_by,
    })
    .select("*")
    .single();

  if (errLote) throw new Error(`Erro ao criar lote: ${errLote.message}`);

  const payload = params.linhas.map((l) => ({
    lote_id: lote.id,
    data_transacao: l.data_transacao,
    descricao_estabelecimento: l.descricao_estabelecimento,
    cnpj_bruto: l.cnpj_bruto,
    cnpj_normalizado: l.cnpj_normalizado,
    valor: l.valor,
    justificativa: l.justificativa,
    codigo_entidade: l.codigo_entidade,
  }));

  if (payload.length > 0) {
    const { error: errItens } = await sb.from("cartao_import_item").insert(payload);
    if (errItens) throw new Error(`Lote criado, mas erro ao inserir linhas: ${errItens.message}`);
  }

  return lote as CartaoLote;
}

export async function loadLote(loteId: string): Promise<CartaoLote | null> {
  const { data, error } = await sb.from("cartao_import_lote").select("*").eq("id", loteId).maybeSingle();
  if (error) throw new Error(`Erro ao carregar lote: ${error.message}`);
  return (data as CartaoLote) ?? null;
}

export async function excluirLote(loteId: string): Promise<void> {
  const { data: emitidas } = await sb
    .from("cartao_import_item")
    .select("id")
    .eq("lote_id", loteId)
    .eq("status_linha", "emitido")
    .limit(1);
  if (emitidas && emitidas.length > 0) {
    throw new Error("Lote possui linhas já emitidas no Alvo — não pode ser excluído.");
  }
  const { error } = await sb.from("cartao_import_lote").delete().eq("id", loteId);
  if (error) throw new Error(`Erro ao excluir lote: ${error.message}`);
}

/* ───────────── CRUD ITENS ───────────── */

export async function loadItens(loteId: string): Promise<CartaoItem[]> {
  const { data, error } = await sb
    .from("cartao_import_item")
    .select("*")
    .eq("lote_id", loteId)
    .order("data_transacao", { ascending: true })
    .order("valor", { ascending: true });
  if (error) throw new Error(`Erro ao carregar linhas: ${error.message}`);
  return (data || []) as CartaoItem[];
}

export async function atualizarLinha(
  itemId: string,
  patch: { codigo_entidade: string | null; codigo_classe_rec_desp: string | null; codigo_centro_ctrl: string | null },
): Promise<void> {
  const { error } = await sb.rpc("fn_cartao_atualizar_linha", {
    p_item_id: itemId,
    p_codigo_entidade: patch.codigo_entidade,
    p_codigo_classe_rec_desp: patch.codigo_classe_rec_desp,
    p_codigo_centro_ctrl: patch.codigo_centro_ctrl,
  });
  if (error) throw new Error(`Erro ao atualizar linha: ${error.message}`);
}

export async function ignorarLinha(itemId: string, motivo: string): Promise<void> {
  const { error } = await sb.rpc("fn_cartao_ignorar_linha", {
    p_item_id: itemId,
    p_motivo: motivo,
    p_ignorar: true,
  });
  if (error) throw new Error(`Erro ao ignorar linha: ${error.message}`);
}

export async function reativarLinha(itemId: string): Promise<void> {
  const { error } = await sb.rpc("fn_cartao_ignorar_linha", {
    p_item_id: itemId,
    p_motivo: null,
    p_ignorar: false,
  });
  if (error) throw new Error(`Erro ao reativar linha: ${error.message}`);
}

/* ───────────── DROPDOWNS ───────────── */

export async function loadClasses(): Promise<ClasseOption[]> {
  const { data, error } = await sb
    .from("classes_rec_desp")
    .select("codigo, nome, natureza, grupo, is_active")
    .eq("is_active", true)
    .order("codigo", { ascending: true });
  if (error) throw new Error(`Erro ao carregar classes: ${error.message}`);
  return (data || [])
    .filter((c: any) => c.grupo === "F")
    .map((c: any) => ({ codigo: c.codigo, nome: c.nome, natureza: c.natureza }));
}

export async function loadCentrosCusto(): Promise<CentroCustoOption[]> {
  const { data, error } = await sb
    .from("cost_centers")
    .select("erp_code, name, is_active")
    .eq("is_active", true)
    .not("erp_code", "is", null)
    .order("erp_code", { ascending: true });
  if (error) throw new Error(`Erro ao carregar centros de custo: ${error.message}`);
  return (data || []).filter((c: any) => c.erp_code).map((c: any) => ({ erp_code: c.erp_code, name: c.name }));
}

export async function buscarEntidades(termo: string): Promise<EntidadeOption[]> {
  const q = termo.trim();
  if (q.length < 2) return [];
  const soDigitos = q.replace(/\D/g, "");

  let query = sb.from("compras_entidades_cache").select("codigo_entidade, cnpj, nome, nome_fantasia").limit(50);

  if (soDigitos.length >= 3 && soDigitos.length === q.replace(/\s/g, "").length) {
    query = query.ilike("cnpj", `%${soDigitos}%`);
  } else {
    query = query.or(`nome.ilike.%${q}%,nome_fantasia.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[cartao] erro buscando entidades:", error.message);
    return [];
  }
  return (data || []).map((e: any) => ({
    codigo_entidade: e.codigo_entidade,
    cnpj: e.cnpj,
    nome: e.nome,
    nome_fantasia: e.nome_fantasia,
  }));
}

export async function loadEntidadePorCodigo(codigo: string): Promise<EntidadeOption | null> {
  const { data, error } = await sb
    .from("compras_entidades_cache")
    .select("codigo_entidade, cnpj, nome, nome_fantasia")
    .eq("codigo_entidade", codigo)
    .maybeSingle();
  if (error) {
    console.warn("[cartao] erro carregando entidade por código:", error.message);
    return null;
  }
  if (!data) return null;
  return { codigo_entidade: data.codigo_entidade, cnpj: data.cnpj, nome: data.nome, nome_fantasia: data.nome_fantasia };
}
