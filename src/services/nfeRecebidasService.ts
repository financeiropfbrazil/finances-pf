/**
 * NF-e de produto recebidas (Suprimentos → Notas Fiscais) — escrita e detalhe em 6 etapas (PLANO-NFE).
 *
 * As tabelas `compras_nfe` / `compras_nfe_pedidos` não aceitam escrita direta do navegador (NFE-2): tudo passa
 * pelas RPCs abaixo, com gate `nfe_pode_gravar()` (admin ou compras.nfe.create). A entrada automática das notas
 * é outra — a Edge `receber-nfe`, chamada pela Riosoft (Arqimport) com chave de serviço.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ParsedNfe } from "@/services/parseNfeXml";
import {
  TAMANHO_MAX_ANEXO,
  lerBoletoNfse,
  type AnexoNfse,
  type LeituraBoletoIA,
  type MovEstqNfse,
  type ParcelaDocFin,
  type PedidoCandidato,
  type PedidoVinculado,
  type TipoAnexoNfse,
} from "@/services/nfseRecebidasService";

// ════════════════════════════════════════════════════════════
// LISTA DO PERÍODO (NFE-5) — sem raw_xml, em blocos de 1000 (teto do PostgREST)
// ════════════════════════════════════════════════════════════
const COLUNAS_LISTA =
  "id, numero, serie, chave_acesso, emitente_nome, emitente_cnpj, emitente_ie, emitente_uf, valor_produtos, valor_icms, " +
  "valor_ipi, valor_frete, valor_desconto, valor_total, base_calculo_icms, data_emissao, natureza_operacao, situacao, origem, " +
  "recebido, dados_extraidos, status_lancamento, pedido_compra_numero, pedido_compra_entidade, pedido_compra_classe, " +
  "pedido_compra_centro_custo, pedido_compra_cond_pagamento, pedido_compra_valor";

/** NF-e com emissão entre `de` e `ate` ("YYYY-MM-DD", inclusive), mais recentes primeiro. */
export async function listarNotasDoPeriodo<T = Record<string, unknown>>(de: string, ate: string): Promise<T[]> {
  const BLOCO = 1000;
  const todas: T[] = [];
  for (let inicio = 0; ; inicio += BLOCO) {
    const { data, error } = await supabase
      .from("compras_nfe")
      .select(COLUNAS_LISTA)
      .gte("data_emissao", de)
      .lte("data_emissao", ate)
      .order("data_emissao", { ascending: false })
      .order("id", { ascending: true })
      .range(inicio, inicio + BLOCO - 1);
    if (error) throw new Error(error.message);
    todas.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < BLOCO) return todas;
  }
}

/** XML autorizado (nfeProc) de uma NF-e — buscado só quando alguém pede para ver ou baixar. */
export async function buscarXmlNfe(id: string): Promise<string | null> {
  const { data, error } = await supabase.from("compras_nfe").select("raw_xml").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { raw_xml: string | null } | null)?.raw_xml ?? null;
}

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

// ════════════════════════════════════════════════════════════
// DETALHE EM 6 ETAPAS (NFE-3/NFE-4) — RPC nfe_recebida_detalhe, anexos nfe_anexo
// ════════════════════════════════════════════════════════════
/** "No Alvo" da NF-e: achada nos espelhos, não achada, ou nota anterior ao espelho (sem como saber). */
export type SituacaoAlvoNfe = "lancada" | "nao_encontrada" | "sem_dado_alvo";

export interface ItemNfe {
  numero_item: number;
  codigo_produto: string | null;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total: number | null;
  pedido_xml?: string | null;
}

/** Pedido vinculado à NF-e no Hub (diálogo "Vincular"), quando o Alvo ainda não tem a nota. */
export type PedidoVinculoHub = Omit<PedidoVinculado, "valor_na_nf" | "fonte"> & {
  principal: boolean;
  vinculado_em: string | null;
  vinculado_por: string | null;
};

export interface DetalheNfe {
  nota: {
    id: string;
    chave_acesso: string;
    numero: string | null;
    serie: string | null;
    modelo: string | null;
    data_emissao: string | null;
    natureza_operacao: string | null;
    emitente_cnpj: string | null;
    emitente_nome: string | null;
    valor_produtos: number | null;
    valor_frete: number | null;
    valor_desconto: number | null;
    valor_icms: number | null;
    valor_icms_st: number | null;
    valor_ipi: number | null;
    valor_total: number | null;
    origem: string | null;
    imported_at: string | null;
    status_lancamento: string | null;
    itens: ItemNfe[];
    /** Tem item com CFOP de venda — sem isso (remessa, retorno, bonificação…) não há pedido candidato. */
    faturavel: boolean;
    situacao_alvo: SituacaoAlvoNfe;
    alvo_chave_movestq: number | null;
    alvo_data_entrada: string | null;
    alvo_fonte: string | null;
    dias_desde_emissao: number | null;
    tem_xml: boolean;
    informacoes_complementares?: string;
    pedidos_citados?: string[];
    emitente_uf_xml?: string;
    emitente_municipio_xml?: string;
    emitente_ie_xml?: string;
    protocolo_xml?: string;
  };
  pedidos: { vinculados: PedidoVinculado[]; vinculo_hub: PedidoVinculoHub[]; candidatos: PedidoCandidato[] };
  movestq: MovEstqNfse | null;
  anexos: AnexoNfse[];
  docfin: { parcelas: ParcelaDocFin[] };
  meta: { titulos_lidos_em: string | null; alvo_espelho_desde: string | null; riosoft_ultima_entrada: string | null };
}

export const BUCKET_ANEXO_NFE: Record<TipoAnexoNfse, string> = { nf: "nfe-nf-pdf", boleto: "nfe-boleto-pdf" };

export async function buscarDetalheNfe(id: string): Promise<DetalheNfe | null> {
  const { data, error } = await (supabase as any).rpc("nfe_recebida_detalhe", { p_id: id });
  if (error) throw new Error(error.message);
  return (data as DetalheNfe | null) ?? null;
}

/** Envia o PDF para a pasta do tipo ({chave}/{uuid}.pdf) e registra o anexo. Um novo substitui o anterior. */
export async function anexarPdfNfe(chave: string, tipo: TipoAnexoNfse, arquivo: File): Promise<void> {
  if (arquivo.type !== "application/pdf" && !arquivo.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("O anexo deve ser um arquivo PDF.");
  }
  if (arquivo.size > TAMANHO_MAX_ANEXO) throw new Error("O PDF passa de 10 MB.");
  const guid = crypto.randomUUID();
  const { error: errUpload } = await supabase.storage
    .from(BUCKET_ANEXO_NFE[tipo])
    .upload(`${chave}/${guid}.pdf`, arquivo, { contentType: "application/pdf", upsert: false });
  if (errUpload) throw new Error(errUpload.message);
  const { data, error } = await (supabase as any).rpc("nfe_anexo_registrar", {
    p_chave: chave,
    p_tipo: tipo,
    p_guid: guid,
    p_nome: arquivo.name,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.mensagem ?? "Não foi possível registrar o anexo.");
}

/** Tira o anexo da nota (o arquivo fica na pasta, para histórico). */
export async function removerAnexoNfe(id: string): Promise<void> {
  const { data, error } = await (supabase as any).rpc("nfe_anexo_remover", { p_id: id });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.mensagem ?? "Não foi possível remover o anexo.");
}

/** Leitura da linha digitável pelo mesmo Edge da NFS-e, com origem 'nfe'. Não salva nada. */
export const lerBoletoNfe = (entrada: { anexo: AnexoNfse } | { arquivo: File }): Promise<LeituraBoletoIA> =>
  lerBoletoNfse(entrada, "nfe");
