/**
 * NF-e de produto recebidas (Suprimentos → Notas Fiscais) — escrita (PLANO-NFE).
 *
 * As tabelas `compras_nfe` / `compras_nfe_pedidos` não aceitam escrita direta do navegador (NFE-2): tudo passa
 * pelas RPCs abaixo, com gate `nfe_pode_gravar()` (admin ou compras.nfe.create). A entrada automática das notas
 * é outra — a Edge `receber-nfe`, chamada pela Riosoft (Arqimport) com chave de serviço.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ParsedNfe } from "@/services/parseNfeXml";

export type ResultadoImportacaoXml = { status: "importada" | "duplicada" | "erro"; id?: string; mensagem?: string };

/** Upload manual de um XML já lido pelo `parseNfeXml` (origem 'Upload'). Duplicada = a chave já existe. */
export async function importarXmlNfe(nota: ParsedNfe, xml: string): Promise<ResultadoImportacaoXml> {
  const { data, error } = await (supabase as any).rpc("compras_nfe_importar_xml", { p_nota: nota, p_xml: xml });
  if (error) throw new Error(error.message);
  return data as ResultadoImportacaoXml;
}

/** Vincula a NF-e aos pedidos, na ordem dada — o primeiro é o principal. */
export async function vincularPedidosNfe(
  nfeId: string,
  pedidos: { numero: string; codigo_empresa_filial?: string | null }[],
): Promise<void> {
  const { data, error } = await (supabase as any).rpc("compras_nfe_vincular_pedidos", {
    p_nfe_id: nfeId,
    p_pedidos: pedidos.map((p) => ({ numero: p.numero, codigo_empresa_filial: p.codigo_empresa_filial || "1.01" })),
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.mensagem ?? "Não foi possível vincular.");
}

/** Tira o vínculo de pedido da NF-e (colunas legadas e vínculos múltiplos). */
export async function desvincularPedidosNfe(nfeId: string): Promise<void> {
  const { data, error } = await (supabase as any).rpc("compras_nfe_desvincular", { p_nfe_id: nfeId });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.mensagem ?? "Não foi possível desvincular.");
}
