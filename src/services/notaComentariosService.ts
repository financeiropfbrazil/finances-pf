/**
 * Comentários das notas — etapa 7 do detalhe da NF-e e da NFS-e (PLANO-NFE NFE-15).
 *
 * Tabela `nota_comentario` fechada (RLS sem policy): só pelas RPCs `nota_comentarios` / `nota_comentario_adicionar`,
 * com o gate de ver a tela (NF-e: compras.nfe.access · NFS-e: compras.nfse.access). Só acréscimo: ninguém edita nem
 * apaga. Até 280 caracteres.
 */
import { supabase } from "@/integrations/supabase/client";

export type TipoNotaComentario = "nfe" | "nfse";

export const LIMITE_COMENTARIO = 280;

export interface ComentarioNota {
  id: string;
  texto: string;
  criado_em: string;
  autor: string;
  /** Escrito por quem está vendo. */
  meu: boolean;
}

export const chaveComentarios = (tipo: TipoNotaComentario, chave: string) => ["nota-comentarios", tipo, chave] as const;

/** Do mais novo ao mais antigo. */
export async function listarComentarios(tipo: TipoNotaComentario, chave: string): Promise<ComentarioNota[]> {
  const { data, error } = await (supabase as any).rpc("nota_comentarios", { p_tipo: tipo, p_chave: chave });
  if (error) throw new Error(error.message);
  return (data ?? []) as ComentarioNota[];
}

export async function adicionarComentario(tipo: TipoNotaComentario, chave: string, texto: string): Promise<void> {
  const { data, error } = await (supabase as any).rpc("nota_comentario_adicionar", { p_tipo: tipo, p_chave: chave, p_texto: texto });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.mensagem ?? "Não foi possível adicionar o comentário.");
}

/** Comentário como vai para o Excel de etapas (NFE-16). */
export interface ComentarioExport {
  texto: string;
  criado_em: string;
  autor: string;
}

/** A RPC aceita até 5.000 chaves; 1.000 por chamada mantém cada pedido pequeno (~50 KB). */
const LOTE_COMENTARIOS = 1000;

/**
 * Comentários de várias notas de uma vez (Excel de etapas, NFE-16): chave de acesso → lista do mais novo ao mais
 * antigo. Nota sem comentário não vem no mapa.
 */
export async function buscarComentariosLote(tipo: TipoNotaComentario, chaves: string[]): Promise<Map<string, ComentarioExport[]>> {
  const unicas = [...new Set(chaves.filter(Boolean))];
  const mapa = new Map<string, ComentarioExport[]>();
  for (let i = 0; i < unicas.length; i += LOTE_COMENTARIOS) {
    const { data, error } = await (supabase as any).rpc("nota_comentarios_lote", {
      p_tipo: tipo,
      p_chaves: unicas.slice(i, i + LOTE_COMENTARIOS),
    });
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as { chave_acesso: string; comentarios: ComentarioExport[] | null }[]) {
      mapa.set(r.chave_acesso, r.comentarios ?? []);
    }
  }
  return mapa;
}

/** "11/11/2026 14:32:05" — sempre no horário de Brasília (o Hub também é usado na Áustria). */
export const formatarInstanteComSegundos = (iso: string): string =>
  new Date(iso)
    .toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    .replace(",", "");

/** Iniciais para o avatar ("mirlene.oliveira" → "MO", "Hugo" → "H"). */
export function iniciais(autor: string): string {
  const partes = autor.replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  return (partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : (partes[0] ?? "?").slice(0, 1)).toUpperCase();
}
