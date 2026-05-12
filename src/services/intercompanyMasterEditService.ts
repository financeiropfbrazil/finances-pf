import { supabase } from "@/integrations/supabase/client";

export interface SetMasterCambioInput {
  masterId: string;
  cambio: number;
}

export interface SetMasterCambioResult {
  success: boolean;
  master_id: string;
  numero_invoice: string;
  modo_emissao: string;
  valor_brl: number;
  cambio: number;
  valor_eur: number;
  blocos_atualizados: number;
  warning?: string;
}

/**
 * Atualiza o câmbio EUR/BRL de uma master. A RPC `set_master_cambio` no banco:
 * - Calcula valor_eur = valor_brl / cambio
 * - Recalcula blocos (NFS-e: 80/20; demais: 100%)
 * - Recalcula rateios CC
 *
 * @throws Error com mensagem da RPC se câmbio inválido ou master não encontrado
 */
export async function setMasterCambio(input: SetMasterCambioInput): Promise<SetMasterCambioResult> {
  const { data, error } = await (supabase as any).rpc("set_master_cambio", {
    p_master_id: input.masterId,
    p_cambio: input.cambio,
  });

  if (error) {
    throw new Error(error.message ?? "Erro ao atualizar câmbio");
  }

  return data as SetMasterCambioResult;
}
