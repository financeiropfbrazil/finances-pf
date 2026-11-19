/**
 * Situação "No Alvo" das NF-e de produto (Suprimentos → Notas Fiscais).
 *
 * Fonte: RPC `compras_nfe_no_alvo(p_de, p_ate)` (NFE-S1, SECURITY DEFINER, gate
 * `nfe_pode_acessar()` = admin ou compras.nfe.access — PLANO-NFE NFE-0). Ela olha os ESPELHOS do Alvo — chave de
 * acesso em `rastreio_nf`, contas a pagar (`fin_parcelas_pagar`), `rastreio_nf`
 * por número + CNPJ e os espelhos de Despesas/Intercompany — e devolve só as
 * notas encontradas. Nota ausente da resposta = não encontrada no Alvo.
 *
 * Eixo: isto responde "o Alvo já tem esta nota?" (ESPELHO). Não confundir com
 * `compras_nfe.status_lancamento`, que é o vínculo de pedido feito no Hub.
 */
import { supabase } from "@/integrations/supabase/client";

export interface NfeNoAlvo {
  nfe_id: string;
  chave_movestq: number | null;
  data_entrada: string | null;
  fonte: string;
}

/** Datas em "YYYY-MM-DD" (data de emissão da NF-e, inclusive). */
export async function listarNfeNoAlvo(de: string, ate: string): Promise<Map<string, NfeNoAlvo>> {
  const { data, error } = await (supabase as any).rpc("compras_nfe_no_alvo", { p_de: de, p_ate: ate });
  if (error) throw new Error(error.message);
  const mapa = new Map<string, NfeNoAlvo>();
  for (const linha of (data ?? []) as NfeNoAlvo[]) mapa.set(linha.nfe_id, linha);
  return mapa;
}
