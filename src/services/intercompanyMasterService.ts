import { supabase } from "@/integrations/supabase/client";
import type {
  SugestaoNumeroInvoice,
  ClasseIntercompanyOption,
  CriarReembolsoInput,
  CriarReembolsoResult,
  EmitInvGatewayResponse,
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

export async function buscarSugestaoNumero(ano?: number): Promise<SugestaoNumeroInvoice> {
  const { data, error } = await (supabase as any).rpc("sugerir_proximo_numero_invoice", {
    p_ano: ano ?? null,
  });
  if (error) throw new Error(error.message);
  return data as SugestaoNumeroInvoice;
}

export async function listarClassesPorTipo(
  tipo: "venda" | "servico" | "reembolso" | "nota_credito"
): Promise<ClasseIntercompanyOption[]> {
  const { data, error } = await (supabase as any).rpc("get_classes_intercompany_by_tipo", {
    p_tipo: tipo,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ClasseIntercompanyOption[];
}

export async function criarRascunhoReembolso(
  input: CriarReembolsoInput
): Promise<CriarReembolsoResult> {
  const { data, error } = await (supabase as any).rpc("criar_invoice_reembolso", {
    p_numero_invoice: input.numero_invoice,
    p_descricao_rica: input.descricao_rica,
    p_classe_codigo: input.classe_codigo,
    p_konto_austria_numero: input.konto_austria_numero,
    p_cambio_eur_brl: input.cambio_eur_brl,
    p_valor_eur: input.valor_eur,
    p_observacoes: input.observacoes ?? null,
  });
  if (error) throw new Error(error.message);
  return data as CriarReembolsoResult;
}

export async function emitirReembolsoNoAlvo(params: {
  master_id: string;
  numero_invoice: string;
  numero_sequencial: string;
  descricao_rica: string;
  classe_codigo: string;
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
  motivo?: string
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
