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
  /** Eixos crus do Alvo (NFSE-1.11-A) — a tela traduz por `getStatusPedido` / `getAprovacaoPedido`. */
  status_local: string | null;
  status_aprovacao: string | null;
  aprovado: string | null;
  comprado: string | null;
  enviou_aprovacao: string | null;
  proximo_aprovador: string | null;
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
  /** = status_aprovacao (chave antiga da NFSE-1.11, mantida). */
  aprovacao: string | null;
  /** Eixos crus do Alvo (NFSE-1.11-A) — a tela traduz por `getStatusPedido` / `getAprovacaoPedido`. */
  status_local: string | null;
  status_aprovacao: string | null;
  aprovado: string | null;
  comprado: string | null;
  enviou_aprovacao: string | null;
  proximo_aprovador: string | null;
  natureza: string | null;
  so_raiz_cnpj: boolean;
  /** Só entra pedido com saldo dentro de ±20% da nota (NFSE-1.11-B): 1 também citado na nota · 2 só pelo saldo */
  forca: 1 | 2;
  motivo: string;
  /** saldo − valor da nota: o que sobra no pedido depois desta nota (negativo = a nota passa o saldo) */
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

// ════════════════════════════════════════════════════════════
// LEITURA DO BOLETO PELA IA (teste da Fase B — Edge nfse-ler-boleto, só leitura)
// ════════════════════════════════════════════════════════════

export interface BoletoLidoIA {
  linha_digitavel: string;
  linha_legivel: boolean;
  banco_impresso: string | null;
  beneficiario_nome: string | null;
  beneficiario_cnpj: string | null;
  pagador_cnpj: string | null;
  vencimento: string | null;
  valor_documento: number | null;
  nosso_numero: string | null;
  numero_documento: string | null;
  pix_copia_e_cola: string | null;
}

export interface BoletoConferidoIA {
  lido: BoletoLidoIA;
  conferencia: {
    valida: boolean;
    tipo: "bancario" | "arrecadacao" | null;
    linha: string;
    linha_formatada: string | null;
    codigo_barras: string | null;
    banco: string | null;
    valor: number | null;
    vencimento: string | null;
    erros: string[];
  };
  confere: {
    vencimento: boolean | null;
    valor: boolean | null;
    pagador_pf: boolean | null;
    beneficiario: "igual_prestador" | "mesma_raiz" | "diferente" | "sem_dado";
  };
  /** DV válido + valor e vencimento impressos iguais aos da linha. */
  perfeita: boolean;
}

export interface LeituraBoletoIA {
  versao: string;
  boletos: BoletoConferidoIA[];
  todas_perfeitas: boolean;
  prestador_doc: string | null;
  uso: { modelo_solicitado: string; modelo_usado: string | null; input_tokens: number | null; output_tokens: number | null; duracao_ms: number };
}

const lerArquivoBase64 = (arquivo: File) =>
  new Promise<string>((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(",")[1] ?? "");
    leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    leitor.readAsDataURL(arquivo);
  });

/**
 * Lê a(s) linha(s) digitável(is) do boleto com o Claude e confere por regra. Não salva nada.
 * Com `anexo` lê o boleto anexado na etapa 5; com `arquivo`, um PDF de teste que não vai para a pasta.
 */
export async function lerBoletoNfse(entrada: { anexo: AnexoNfse } | { arquivo: File }): Promise<LeituraBoletoIA> {
  let corpo: Record<string, string>;
  if ("anexo" in entrada) {
    corpo = { anexo_id: entrada.anexo.id };
  } else {
    if (entrada.arquivo.type !== "application/pdf" && !entrada.arquivo.name.toLowerCase().endsWith(".pdf")) {
      throw new Error("O arquivo deve ser um PDF.");
    }
    if (entrada.arquivo.size > TAMANHO_MAX_ANEXO) throw new Error("O PDF passa de 10 MB.");
    corpo = { pdfBase64: await lerArquivoBase64(entrada.arquivo) };
  }
  const { data, error } = await supabase.functions.invoke("nfse-ler-boleto", { body: corpo });
  if (error) {
    let mensagem = error.message;
    try {
      const resposta = await (error as { context?: { json?: () => Promise<{ erro?: string }> } }).context?.json?.();
      if (resposta?.erro) mensagem = resposta.erro;
    } catch {
      /* mantém a mensagem do cliente */
    }
    throw new Error(mensagem);
  }
  if (!data?.ok) throw new Error(data?.erro ?? "A leitura do boleto falhou.");
  return data as LeituraBoletoIA;
}

