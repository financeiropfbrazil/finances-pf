/**
 * Suprimentos → Notas de Serviço: NFS-e recebidas pelo ambiente nacional (ADN).
 *
 * Fonte: RPC `nfse_recebidas_listar` (NFSE-1.3, SECURITY DEFINER, gate
 * `compras.nfse.access`), que lê a view `v_nfse_recebida` (NFSE-1.2). Download do
 * XML: RPC `nfse_recebida_xml`.
 *
 * Dois eixos, sempre com nome (PLANO-NFSE D6):
 *   - "No fisco": o que o ADN diz da nota (normal / cancelada / substituída);
 *   - "No Alvo": se o Alvo tem a nota (título no contas a pagar, regra da NFSE-0.6).
 * O espelho do ADN só anda quando a sonda roda — `atualizado_em` diz até quando.
 */
import { supabase } from "@/integrations/supabase/client";

export type SituacaoFisco = "normal" | "cancelada" | "substituida";
export type SituacaoAlvo = "lancada_nfse" | "lancada_outra_especie" | "nao_lancada";
export type PagamentoAlvo = "pago" | "em_aberto" | "parcial" | "agrupado" | "baixa_sem_prova";

export interface NfseRecebida {
  nsu: number;
  chave_acesso: string;
  numero: string | null;
  data_emissao: string | null;
  prestador_doc: string | null;
  prestador_nome: string | null;
  cmun_emissor: string | null;
  municipio_emissor: string | null;
  tomador_doc: string | null;
  intermediario_doc: string | null;
  valor_servico: number | null;
  valor_liquido: number | null;
  gerado_em: string | null;
  situacao_fisco: SituacaoFisco;
  cancelada_em: string | null;
  situacao_alvo: SituacaoAlvo;
  alvo_especies: string | null;
  alvo_chave_docfin: number | null;
  alvo_chave_movestq: number | null;
  alvo_data_entrada: string | null;
  alvo_valor: number | null;
  alvo_parcelas: number | null;
  alvo_pagamento: PagamentoAlvo | null;
  alvo_pedido: string | null;
  dias_desde_emissao: number | null;
}

export interface IndicadoresNfse {
  recebidas: number;
  valor: number;
  lancadas: number;
  nao_lancadas: number;
  nao_lancadas_15d: number;
  nao_lancadas_15d_valor: number;
  canceladas: number;
  canceladas_e_lancadas: number;
}

export interface ResultadoNfseRecebidas {
  total: number;
  atualizado_em: string | null;
  indicadores: IndicadoresNfse;
  itens: NfseRecebida[];
}

/** Datas "YYYY-MM-DD" (emissão, inclusive). A RPC devolve até 1000 notas — um mês passa longe disso. */
export async function listarNfseRecebidas(de: string, ate: string): Promise<ResultadoNfseRecebidas> {
  const { data, error } = await (supabase as any).rpc("nfse_recebidas_listar", {
    p_de: de,
    p_ate: ate,
    p_limit: 1000,
  });
  if (error) throw new Error(error.message);
  return data as ResultadoNfseRecebidas;
}

export async function buscarXmlNfse(chave: string): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("nfse_recebida_xml", { p_chave: chave });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}
