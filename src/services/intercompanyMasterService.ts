import { supabase } from "@/integrations/supabase/client";
import type {
  SugestaoNumeroInvoice,
  ClasseIntercompanyOption,
  CriarReembolsoInput,
  CriarReembolsoResult,
  EmitInvGatewayResponse,
  RateioCC,
  CriarReembolsoManualInput,
  CriarReembolsoManualResult,
  EmitInvManualGatewayResponse,
  BlocoManualInput,
} from "@/types/intercompany";

const GATEWAY_URL = "https://erp-proxy.onrender.com";

function getAccessToken(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        return parsed?.access_token ?? null;
      }
    }
  } catch (e) {
    console.error("Erro lendo access token", e);
  }
  return null;
}

// ═════════════════════════════════════════════════════════════
// Funções compartilhadas (sugestão + classes)
// ═════════════════════════════════════════════════════════════

export async function buscarSugestaoNumero(ano?: number): Promise<SugestaoNumeroInvoice> {
  const { data, error } = await (supabase as any).rpc("sugerir_proximo_numero_invoice", {
    p_ano: ano ?? null,
  });
  if (error) throw new Error(error.message);
  return data as SugestaoNumeroInvoice;
}

export async function listarClassesPorTipo(
  tipo: "venda" | "servico" | "reembolso" | "nota_credito",
): Promise<ClasseIntercompanyOption[]> {
  const { data, error } = await (supabase as any).rpc("get_classes_intercompany_by_tipo", {
    p_tipo: tipo,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ClasseIntercompanyOption[];
}

// ═════════════════════════════════════════════════════════════
// Frente 3 — Reembolso vinculado a NFs (PRESERVADO)
// ═════════════════════════════════════════════════════════════

/**
 * Cria invoice de reembolso na master (status='rascunho').
 * Persiste 1-5 rateios de CC na tabela intercompany_invoices_master_rateios.
 * Não chama o ERP Alvo — isso é feito por emitirReembolsoNoAlvo.
 */
export async function criarRascunhoReembolso(input: CriarReembolsoInput): Promise<CriarReembolsoResult> {
  const rateiosPayload = input.rateios_cc.map((r) => ({
    cc: r.centro_custo_erp_code,
    percentual: r.percentual,
  }));

  const { data, error } = await (supabase as any).rpc("criar_invoice_reembolso", {
    p_numero_invoice: input.numero_invoice,
    p_descricao_rica: input.descricao_rica,
    p_classe_codigo: input.classe_codigo,
    p_konto_austria_numero: input.konto_austria_numero,
    p_rateios_cc: rateiosPayload,
    p_cambio_eur_brl: input.cambio_eur_brl,
    p_valor_eur: input.valor_eur,
    p_observacoes: input.observacoes ?? null,
  });
  if (error) throw new Error(error.message);
  return data as CriarReembolsoResult;
}

/**
 * Emite o reembolso no ERP Alvo via gateway (Frente 3 antiga).
 */
export async function emitirReembolsoNoAlvo(params: {
  master_id: string;
  numero_invoice: string;
  numero_sequencial: string;
  descricao_rica: string;
  classe_codigo: string;
  rateios_cc: RateioCC[];
  cambio_eur_brl: number;
  valor_eur: number;
  valor_brl: number;
  codigo_indicador_economico?: "0000001" | "0000003";
}): Promise<EmitInvGatewayResponse> {
  const token = getAccessToken();
  const today = new Date().toISOString().slice(0, 10);
  const body = {
    ...params,
    codigo_indicador_economico: params.codigo_indicador_economico ?? "0000003",
    data_emissao: today,
  };
  const resp = await fetch(`${GATEWAY_URL}/intercompany/emit-inv`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  return (await resp.json()) as EmitInvGatewayResponse;
}

export async function atualizarStatusEmissao(
  master_id: string,
  sucesso: boolean,
  chave_alvo?: number,
  motivo?: string,
) {
  const { data, error } = await (supabase as any).rpc("atualizar_emissao_reembolso", {
    p_master_id: master_id,
    p_chave_docfin_alvo: chave_alvo ?? null,
    p_status: sucesso ? "emitida_alvo" : "erro_emissao",
    p_status_motivo: motivo ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function cancelarRascunho(master_id: string) {
  const { data, error } = await (supabase as any).rpc("cancelar_rascunho_reembolso", {
    p_master_id: master_id,
  });
  if (error) throw new Error(error.message);
  return data;
}

// ═════════════════════════════════════════════════════════════
// Frente 4 — Reembolso Manual (NOVO)
// ═════════════════════════════════════════════════════════════

/**
 * Cria invoice de Reembolso Manual no Hub (status='rascunho').
 * Persiste master + N blocos contábeis + rateios CC por bloco.
 * Não chama o ERP Alvo — isso é feito por emitirReembolsoManualNoAlvo.
 */
export async function criarRascunhoReembolsoManual(
  input: CriarReembolsoManualInput,
): Promise<CriarReembolsoManualResult> {
  // Sanitiza blocos pro formato esperado pela RPC: [{classe, konto_at, valor_eur, rateios:[{cc, pct}]}]
  const blocosPayload = input.blocos.map((b) => ({
    classe: b.classe_codigo,
    konto_at: b.konto_austria_numero,
    valor_eur: b.valor_eur,
    rateios: b.rateios.map((r) => ({
      cc: r.centro_custo_erp_code,
      pct: r.percentual,
    })),
  }));

  const { data, error } = await (supabase as any).rpc("criar_invoice_reembolso_manual", {
    p_numero_invoice: input.numero_invoice,
    p_descricao_observacao: input.descricao_observacao,
    p_description_pdf: input.description_pdf,
    p_cambio_eur_brl: input.cambio_eur_brl,
    p_markup_aplicado: input.markup_aplicado,
    p_valor_eur_service_fee: input.valor_eur_service_fee,
    p_valor_eur_total: input.valor_eur_total,
    p_observacoes_internas: input.observacoes_internas ?? null,
    p_blocos: blocosPayload,
  });
  if (error) throw new Error(error.message);
  return data as CriarReembolsoManualResult;
}

/**
 * Emite o Reembolso Manual no ERP Alvo via gateway.
 * Gateway cuida de: criar DocFin no Alvo + gerar PDF + anexar PDF no Alvo + subir Storage.
 */
export async function emitirReembolsoManualNoAlvo(params: {
  master_id: string;
  numero_invoice: string;
  numero_sequencial: number;
  ano: number;
  descricao_observacao: string;
  description_pdf: string;
  cambio_eur_brl: number;
  valor_eur_total: number; // grand total (com markup se aplicado)
  valor_brl: number;
  markup_aplicado: boolean;
  valor_eur_service_fee: number;
  valor_eur_other_expenses: number;
  blocos: BlocoManualInput[];
}): Promise<EmitInvManualGatewayResponse> {
  const token = getAccessToken();
  const today = new Date().toISOString().slice(0, 10);
  const body = {
    ...params,
    codigo_indicador_economico: "0000003", // sempre EUR pra reembolso intercompany
    data_emissao: today,
  };
  const resp = await fetch(`${GATEWAY_URL}/intercompany/emit-inv-manual`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  return (await resp.json()) as EmitInvManualGatewayResponse;
}

/**
 * Atualiza status do master após emit no Alvo.
 */
export async function atualizarStatusEmissaoManual(
  master_id: string,
  sucesso: boolean,
  chave_alvo?: number,
  motivo?: string,
) {
  const { data, error } = await (supabase as any).rpc("atualizar_emissao_reembolso_manual", {
    p_master_id: master_id,
    p_chave_docfin_alvo: chave_alvo ?? null,
    p_status: sucesso ? "emitida_alvo" : "erro_emissao",
    p_status_motivo: motivo ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}
