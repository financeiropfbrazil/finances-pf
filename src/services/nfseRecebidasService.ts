/**
 * Suprimentos → Notas de Serviço: NFS-e recebidas pelo ambiente nacional (ADN).
 *
 * Fonte: RPC `nfse_recebidas_listar` (NFSE-1.3, SECURITY DEFINER, gate
 * `compras.nfse.access`), que lê a view `v_nfse_recebida` (NFSE-1.2). Download do
 * XML: RPC `nfse_recebida_xml`.
 *
 * Dois eixos, sempre com nome (PLANO-NFSE D6):
 *   - "No fisco": o que o ADN diz da nota (normal / cancelada / substituída);
 *   - "No Alvo": se o Alvo tem a nota (título no contas a pagar, regra da NFSE-0.6). O espelho só
 *     tem títulos com vencimento a partir de `alvo_espelho_desde`: nota não achada emitida antes
 *     disso é `sem_dado_alvo` (o Hub não sabe), nunca `nao_lancada` (NFSE-1.2-A).
 * O espelho do ADN só anda quando a sonda roda — `atualizado_em` diz até quando.
 */
import { supabase } from "@/integrations/supabase/client";

export type SituacaoFisco = "normal" | "cancelada" | "substituida";
export type SituacaoAlvo = "lancada_nfse" | "lancada_outra_especie" | "nao_lancada" | "sem_dado_alvo";
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
  sem_dado_alvo: number;
}

export interface ResultadoNfseRecebidas {
  total: number;
  atualizado_em: string | null;
  /** Menor vencimento no espelho do contas a pagar — antes disso o eixo "No Alvo" não tem dado. */
  alvo_espelho_desde: string | null;
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

// ════════════════════════════════════════════════════════════
// DETALHE EM ETAPAS (NFSE-1.11) e ANEXOS (NFSE-1.10)
// ════════════════════════════════════════════════════════════

export interface PedidoVinculado {
  numero: string;
  valor_na_nf: number | null;
  fonte: string | null;
  fornecedor: string | null;
  data_pedido: string | null;
  valor_pedido: number | null;
  status: string | null;
  natureza: string | null;
  no_hub: boolean;
}

export interface PedidoCandidato {
  numero: string;
  fornecedor: string | null;
  data_pedido: string | null;
  valor_pedido: number;
  ja_faturado: number;
  saldo: number;
  nfs_ligadas: number;
  status: string | null;
  aprovacao: string | null;
  natureza: string | null;
  so_raiz_cnpj: boolean;
  /** 1 citado na nota · 2 saldo ±20% · 3 contrato recorrente · 4 valor do pedido ±20% */
  forca: 1 | 2 | 3 | 4;
  motivo: string;
  diferenca: number;
  diferenca_pct: number;
}

export interface MovEstqNfse {
  chave_movestq: number;
  numero: string | null;
  especie: string | null;
  serie: string | null;
  codigo_tipo_lanc: string | null;
  data_emissao: string | null;
  data_entrada: string | null;
  data_movimento: string | null;
  data_hora_digitacao: string | null;
  valor_documento: number | null;
  qtd_itens: number | null;
  qtd_pedidos: number | null;
  carregado_em: string | null;
}

export type TipoAnexoNfse = "nf" | "boleto";

export interface AnexoNfse {
  id: string;
  tipo: TipoAnexoNfse;
  bucket_id: string;
  storage_path: string;
  nome_original: string;
  tamanho_bytes: number;
  enviado_em: string;
  enviado_por: string | null;
}

export interface ParcelaDocFin {
  chave_docfin: number | null;
  sequencia: number | null;
  numero: string | null;
  especie: string | null;
  data_entrada: string | null;
  data_vencimento: string | null;
  data_prorrogacao: string | null;
  data_pagamento: string | null;
  valor_original: number | null;
  valor_pago: number | null;
  valor_juros: number | null;
  valor_multa: number | null;
  valor_desconto: number | null;
  situacao: string | null;
  codigo_situacao: string | null;
  /** rastreio_classe_pagamento: pago · quitado_adto · baixa_sem_mov · agrupado · aberto · desconhecido */
  classe_pagamento: string | null;
  tipo_cobranca: string | null;
  cond_pagamento: string | null;
  sincronizado_em: string | null;
}

export interface DetalheNfse {
  nota: NfseRecebida & {
    descricao_servico?: string;
    codigo_servico?: string;
    competencia?: string;
    informacoes_complementares?: string;
    valor_iss?: string;
    /** ADN: 1 = não retido, 2 = retido */
    iss_retido?: string;
    valor_total_retido?: string;
    municipio_incidencia?: string;
    erro_xml?: string;
  };
  pedidos: { vinculados: PedidoVinculado[]; candidatos: PedidoCandidato[] };
  movestq: MovEstqNfse | null;
  anexos: AnexoNfse[];
  docfin: { parcelas: ParcelaDocFin[] };
  meta: { adn_lido_em: string | null; titulos_lidos_em: string | null; alvo_espelho_desde: string | null };
}

export const BUCKET_ANEXO: Record<TipoAnexoNfse, string> = { nf: "nfse-nf-pdf", boleto: "nfse-boleto-pdf" };
export const TAMANHO_MAX_ANEXO = 10 * 1024 * 1024;

export async function buscarDetalheNfse(chave: string): Promise<DetalheNfse | null> {
  const { data, error } = await (supabase as any).rpc("nfse_recebida_detalhe", { p_chave: chave });
  if (error) throw new Error(error.message);
  return (data as DetalheNfse | null) ?? null;
}

/**
 * Envia o PDF para a pasta do tipo e registra o anexo. O caminho é {chave}/{uuid}.pdf — a policy da pasta
 * e a RPC conferem o formato. Um anexo novo do mesmo tipo substitui o anterior (que fica no histórico).
 */
export async function anexarPdfNfse(chave: string, tipo: TipoAnexoNfse, arquivo: File): Promise<void> {
  if (arquivo.type !== "application/pdf" && !arquivo.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("O anexo deve ser um arquivo PDF.");
  }
  if (arquivo.size > TAMANHO_MAX_ANEXO) throw new Error("O PDF passa de 10 MB.");
  const guid = crypto.randomUUID();
  const { error: errUpload } = await supabase.storage
    .from(BUCKET_ANEXO[tipo])
    .upload(`${chave}/${guid}.pdf`, arquivo, { contentType: "application/pdf", upsert: false });
  if (errUpload) throw new Error(errUpload.message);
  const { data, error } = await (supabase as any).rpc("nfse_anexo_registrar", {
    p_chave: chave,
    p_tipo: tipo,
    p_guid: guid,
    p_nome: arquivo.name,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.mensagem ?? "Não foi possível registrar o anexo.");
}

/** Link temporário (5 min) para abrir o PDF — a pasta é privada. */
export async function linkAnexoNfse(anexo: AnexoNfse): Promise<string> {
  const { data, error } = await supabase.storage.from(anexo.bucket_id).createSignedUrl(anexo.storage_path, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Não foi possível abrir o anexo.");
  return data.signedUrl;
}

/** Tira o anexo da nota (o arquivo fica na pasta, para histórico). */
export async function removerAnexoNfse(id: string): Promise<void> {
  const { data, error } = await (supabase as any).rpc("nfse_anexo_remover", { p_id: id });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.mensagem ?? "Não foi possível remover o anexo.");
}
