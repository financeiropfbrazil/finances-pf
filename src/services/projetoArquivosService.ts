/**
 * Anexos dos pedidos de compra do módulo de Projetos (L9).
 *
 * Fluxo de inclusão: o arquivo sobe para a pasta privada `projetos-pedidos` no
 * caminho `{projeto}/{pedido}/{guid}.{ext}` e só então é registrado pela RPC
 * `projeto_pedido_arquivo_registrar`, que monta o caminho do lado do banco,
 * confere que o arquivo existe e aplica o limite. Se o registro falhar, o
 * arquivo enviado é apagado — não fica arquivo órfão nem registro sem arquivo.
 *
 * Quem pode mexer é decidido no banco (policies da pasta + RPCs): responsável
 * do projeto, pedido do Actual, ainda não enviado ao ERP. Depois do envio o
 * anexo é imutável. Os limites abaixo repetem os da pasta e da rota
 * `/ped-comp/insert-multipart` do erp-proxy só para avisar antes do upload.
 */
import { supabase } from "@/integrations/supabase/client";
import { descricaoErro, excluirArquivo, falhou, registrarArquivo, type ArquivoPedidoProjeto } from "./projetosService";

export const BUCKET_ANEXOS_PROJETO = "projetos-pedidos";
export const MAX_ANEXOS_PEDIDO = 3;
export const MAX_BYTES_ANEXO = 5 * 1024 * 1024;

const EXTENSAO_POR_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export const ACCEPT_ANEXOS = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

/** Valida os arquivos escolhidos contra o limite do pedido. Devolve a mensagem do primeiro problema. */
export function validarAnexos(novos: File[], jaAnexados: number): string | null {
  if (jaAnexados + novos.length > MAX_ANEXOS_PEDIDO) {
    return `O pedido pode ter no máximo ${MAX_ANEXOS_PEDIDO} anexos (já tem ${jaAnexados}).`;
  }
  for (const f of novos) {
    if (!EXTENSAO_POR_MIME[f.type]) return `"${f.name}" não é PDF, JPG ou PNG.`;
    if (f.size <= 0) return `"${f.name}" está vazio.`;
    if (f.size > MAX_BYTES_ANEXO) return `"${f.name}" passa de 5 MB.`;
  }
  return null;
}

export const fmtTamanho = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Anexos de todos os pedidos de um projeto (a RLS limita ao que o usuário pode ver). */
export async function listarArquivosDoProjeto(projetoId: string): Promise<ArquivoPedidoProjeto[]> {
  const { data, error } = await (supabase as any)
    .from("projeto_pedido_arquivos")
    .select("*")
    .eq("projeto_id", projetoId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Erro ao listar anexos: ${error.message}`);
  return (data || []) as ArquivoPedidoProjeto[];
}

/** Anexos de um pedido. */
export async function listarArquivosDoPedido(requisicaoId: string): Promise<ArquivoPedidoProjeto[]> {
  const { data, error } = await (supabase as any)
    .from("projeto_pedido_arquivos")
    .select("*")
    .eq("requisicao_id", requisicaoId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Erro ao listar os anexos do pedido: ${error.message}`);
  return (data || []) as ArquivoPedidoProjeto[];
}

export interface ResultadoAnexar {
  anexados: ArquivoPedidoProjeto[];
  /** uma mensagem por arquivo que não entrou */
  falhas: string[];
}

/** Envia e registra os arquivos, um a um. Um arquivo que falha não impede os outros. */
export async function anexarArquivos(
  projetoId: string,
  requisicaoId: string,
  arquivos: File[],
): Promise<ResultadoAnexar> {
  const resultado: ResultadoAnexar = { anexados: [], falhas: [] };

  for (const arquivo of arquivos) {
    const ext = EXTENSAO_POR_MIME[arquivo.type];
    if (!ext) {
      resultado.falhas.push(`"${arquivo.name}": tipo não aceito.`);
      continue;
    }
    const guid = crypto.randomUUID();
    const caminho = `${projetoId}/${requisicaoId}/${guid}.${ext}`;

    const { error: errUpload } = await supabase.storage
      .from(BUCKET_ANEXOS_PROJETO)
      .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
    if (errUpload) {
      resultado.falhas.push(`"${arquivo.name}": ${errUpload.message}`);
      continue;
    }

    const reg = await registrarArquivo(requisicaoId, guid, arquivo.name, arquivo.type, arquivo.size);
    if (falhou(reg)) {
      // Sem registro, o arquivo não serve para nada: desfaz o upload.
      const { error: errLimpeza } = await supabase.storage.from(BUCKET_ANEXOS_PROJETO).remove([caminho]);
      if (errLimpeza) console.error("[anexos] arquivo enviado e não registrado ficou na pasta:", caminho, errLimpeza);
      resultado.falhas.push(`"${arquivo.name}": ${descricaoErro(reg)}`);
      continue;
    }
    resultado.anexados.push(reg.dados.arquivo);
  }

  return resultado;
}

/** Remove um anexo (registro + arquivo). Só enquanto o pedido não foi enviado ao ERP. */
export async function removerAnexo(arquivo: ArquivoPedidoProjeto): Promise<{ ok: true } | { ok: false; erro: string }> {
  const res = await excluirArquivo(arquivo.id);
  if (falhou(res)) return { ok: false, erro: descricaoErro(res) };

  const { error } = await supabase.storage.from(BUCKET_ANEXOS_PROJETO).remove([res.dados.storage_path]);
  if (error) {
    // O registro já saiu; o arquivo que sobrou não aparece em lugar nenhum. Não é
    // motivo para dizer ao usuário que a remoção falhou, mas fica no log.
    console.error("[anexos] registro removido, arquivo ficou na pasta:", res.dados.storage_path, error);
  }
  return { ok: true };
}

/**
 * Apaga da pasta os arquivos de um pedido que acabou de ser EXCLUÍDO (os
 * registros saem junto com o pedido, em cascata). Melhor esforço: falha só vai
 * ao log, a exclusão do pedido já está feita.
 */
export async function limparArquivosDePedidoExcluido(caminhos: string[]): Promise<void> {
  if (caminhos.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET_ANEXOS_PROJETO).remove(caminhos);
  if (error) console.error("[anexos] arquivos de pedido excluído ficaram na pasta:", caminhos, error);
}

/** Link temporário (5 min) para abrir o anexo. */
export async function urlTemporariaAnexo(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_ANEXOS_PROJETO).createSignedUrl(caminho, 300);
  if (error || !data?.signedUrl) throw new Error(`Não foi possível abrir o anexo: ${error?.message || "sem link"}`);
  return data.signedUrl;
}

/** Baixa os arquivos para o envio multipart ao ERP. Qualquer falha interrompe o envio. */
export async function baixarAnexosParaEnvio(
  arquivos: ArquivoPedidoProjeto[],
): Promise<Array<{ guid: string; blob: Blob; nome: string }>> {
  const blobs: Array<{ guid: string; blob: Blob; nome: string }> = [];
  for (const a of arquivos) {
    const { data, error } = await supabase.storage.from(BUCKET_ANEXOS_PROJETO).download(a.storage_path);
    if (error || !data) {
      throw new Error(`Não foi possível carregar o anexo "${a.nome_original}": ${error?.message || "arquivo vazio"}`);
    }
    blobs.push({ guid: a.upload_identify_guid, blob: data, nome: a.nome_original });
  }
  return blobs;
}
