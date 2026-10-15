/**
 * projetosService — acesso ao módulo de Projetos (pedidos de compra).
 *
 * Todo acesso de ESCRITA passa por RPC `SECURITY DEFINER` (L2/L3): depois do L3
 * as tabelas do módulo não têm mais policy de escrita para `authenticated`, só
 * para admin. Escrita direta (`.upsert()/.insert()/.update()/.delete()`) daqui
 * para frente falha para usuário comum — e é isso que queremos.
 *
 * Duas armadilhas que este arquivo existe para evitar:
 *
 * 1. `.upsert()` avalia a WITH CHECK da policy de INSERT mesmo quando o conflito
 *    ocorre e a operação vira UPDATE ("Row proposed for insertion is checked
 *    regardless of whether or not a conflict occurs" — doc do PostgreSQL). Era a
 *    causa-raiz do 42501 no Actual.
 * 2. Erro engolido. A rejeição por teto orçamentário volta como **HTTP 200** com
 *    `{success:false}` (decisão D-10 — um RAISE desfaria o evento `teto_rejeitado`
 *    gravado logo antes). Por isso o requisito R-1: **`success !== true` é falha**,
 *    sempre. Tratar como sucesso reintroduziria exatamente o bug que a
 *    refatoração corrige.
 */

import { supabase } from "@/integrations/supabase/client";

// ── Tipos ────────────────────────────────────────────────────────────

export interface FalhaRpc {
  ok: false;
  /** Mensagem pronta para exibir ao usuário (as RPCs levantam mensagens amigáveis). */
  mensagem: string;
  /** `erro_codigo` do envelope (ex.: "teto_excedido") ou o `code` do PostgREST (ex.: "42501"). */
  codigo: string | null;
  detalhes: string | null;
  hint: string | null;
  /** Envelope completo quando a RPC respondeu 200 com success:false. */
  payload?: EnvelopeRpc;
}

/** Envelope devolvido pelas RPCs do módulo (D-11). */
interface EnvelopeRpc {
  success?: boolean;
  mensagem?: string;
  erro_codigo?: string;
  [campo: string]: unknown;
}

export interface SucessoRpc<T> {
  ok: true;
  dados: T;
}

export type ResultadoRpc<T = unknown> = SucessoRpc<T> | FalhaRpc;

export interface PedidoSalvo {
  success: true;
  operacao: "criado" | "editado";
  pedido: Record<string, unknown>;
}

export interface PedidoExcluido {
  success: true;
  deleted: true;
  id: string;
  sequencia: number;
  descricao: string;
  valor_total: number;
}

/** Campos aceitos por `projeto_pedido_salvar`. `status`, `sequencia`, `criado_por` e
 *  `fase` de linha existente são responsabilidade do banco — não enviar. */
export interface DadosPedido {
  descricao: string;
  fornecedor_codigo: string | null;
  fornecedor_nome: string | null;
  fornecedor_cnpj: string | null;
  cond_pagamento_codigo: string | null;
  cond_pagamento_nome: string | null;
  itens: unknown[];
  classe_rateio: unknown[];
  valor_total: number;
  fase: "budget" | "actual";
  /** L11 (só Actual): "Data da Entrega" no Alvo, YYYY-MM-DD. */
  data_entrega?: string | null;
  /** L11: de qual data os prazos da condição contam. */
  data_base_parcelas?: "Data do Pedido" | "Data da Entrega" | null;
  /** L11: parcelas como a pessoa deixou; o banco recusa se não somarem o valor. */
  parcelas?: { sequencia: number; dias_entre_parcelas: number; valor_parcela: number; data_vencimento: string }[];
  /** L11: true = editadas à mão (vão ao Alvo como estão); false = recalculadas no envio. */
  parcelas_manuais?: boolean;
}

// ── Núcleo ───────────────────────────────────────────────────────────

/**
 * Executa uma RPC do módulo e normaliza os dois modos de falha:
 * erro do PostgREST (RAISE no banco) e envelope `success:false` (HTTP 200).
 */
async function chamarRpc<T = unknown>(nome: string, params: Record<string, unknown>): Promise<ResultadoRpc<T>> {
  // (supabase as any) é o padrão de RPC deste repo — o client tipado não conhece
  // as funções criadas fora do types.ts gerado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(nome, params);
  const envelope = (data ?? null) as EnvelopeRpc | null;

  // Falha "clássica": RAISE no banco chega como erro do PostgREST.
  if (error) {
    console.error(`[projetosService] ${nome} — erro`, {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      params,
    });
    return {
      ok: false,
      mensagem: error.message || `Falha ao executar ${nome}.`,
      codigo: error.code ?? null,
      detalhes: error.details ?? null,
      hint: error.hint ?? null,
    };
  }

  // R-1 / D-10: HTTP 200 com success !== true é FALHA.
  if (!envelope || envelope.success !== true) {
    console.error(`[projetosService] ${nome} — rejeitado pelo servidor (success !== true)`, { data, params });
    return {
      ok: false,
      mensagem: envelope?.mensagem || `Operação rejeitada pelo servidor (${nome}).`,
      codigo: envelope?.erro_codigo ?? null,
      detalhes: null,
      hint: null,
      payload: envelope ?? undefined,
    };
  }

  return { ok: true, dados: data as T };
}

/**
 * Type guard de falha. Use `if (falhou(res))` em vez de `if (!res.ok)`:
 * o `tsconfig` deste projeto roda com `strict: false`, e sem `strictNullChecks`
 * o TypeScript não estreita a união discriminada pelo booleano sozinho.
 */
export function falhou<T>(resultado: ResultadoRpc<T>): resultado is FalhaRpc {
  return resultado.ok === false;
}

/** Descrição de erro pronta para o toast: mensagem + código/hint quando houver. */
export function descricaoErro(falha: FalhaRpc): string {
  const extras = [falha.codigo ? `código ${falha.codigo}` : null, falha.hint || null].filter(Boolean).join(" · ");
  return extras ? `${falha.mensagem} (${extras})` : falha.mensagem;
}

// ── API ──────────────────────────────────────────────────────────────

/**
 * Cria (id null) ou edita (id preenchido) um pedido de compra do projeto.
 * O banco valida teto orçamentário (D-1), rateio, fase e titularidade.
 */
export async function salvarPedido(
  projetoId: string,
  id: string | null,
  dados: DadosPedido,
): Promise<ResultadoRpc<PedidoSalvo>> {
  return chamarRpc<PedidoSalvo>("projeto_pedido_salvar", {
    p_projeto_id: projetoId,
    p_id: id,
    p_dados: dados,
  });
}

/** Exclui um pedido. O banco só aceita `rascunho`/`erro` da fase corrente (D-3, D-13). */
export async function excluirPedido(id: string): Promise<ResultadoRpc<PedidoExcluido>> {
  return chamarRpc<PedidoExcluido>("projeto_pedido_excluir", { p_id: id });
}

/**
 * Registra no Hub o resultado do envio ao ERP Alvo.
 * Substitui o `.upsert()` que falhava silenciosamente para não-admin — o pedido
 * entrava no ERP e o Hub não registrava nada (achado A-2).
 */
export async function marcarEnviado(
  id: string,
  numeroAlvo: string | null,
  sucesso: boolean,
  erro: string | null = null,
): Promise<ResultadoRpc> {
  return chamarRpc("projeto_pedido_marcar_enviado", {
    p_id: id,
    p_numero_alvo: numeroAlvo,
    p_sucesso: sucesso,
    p_erro: erro,
  });
}

/**
 * Registra o timestamp do e-mail de aprovação (achado A-7).
 * RPC dedicada porque neste ponto a fase já é `budget_em_aprovacao` e a policy
 * de UPDATE de `projetos` não cobre o responsável.
 */
export async function marcarEmailAprovacao(projetoId: string): Promise<ResultadoRpc> {
  return chamarRpc("projeto_marcar_email_aprovacao", { p_projeto_id: projetoId });
}

// ── Anexos (L9) ──────────────────────────────────────────────────────

/** Linha de `projeto_pedido_arquivos`. */
export interface ArquivoPedidoProjeto {
  id: string;
  projeto_id: string;
  requisicao_id: string;
  upload_identify_guid: string;
  nome_original: string;
  storage_path: string;
  mime_type: string;
  tamanho_bytes: number;
  numero_alvo_ao_enviar: string | null;
  enviado_alvo_em: string | null;
  uploaded_by: string;
  created_at: string;
}

/**
 * Registra um arquivo que JÁ foi enviado para a pasta `projetos-pedidos`. O
 * banco monta o caminho a partir do pedido, confere que o arquivo existe e
 * aplica o limite de 3 anexos.
 */
export async function registrarArquivo(
  requisicaoId: string,
  guid: string,
  nome: string,
  mime: string,
  tamanho: number,
): Promise<ResultadoRpc<{ success: true; arquivo: ArquivoPedidoProjeto }>> {
  return chamarRpc("projeto_pedido_arquivo_registrar", {
    p_requisicao_id: requisicaoId,
    p_guid: guid,
    p_nome: nome,
    p_mime: mime,
    p_tamanho: tamanho,
  });
}

/** Remove o registro do anexo; devolve o caminho para apagar o arquivo da pasta. */
export async function excluirArquivo(id: string): Promise<ResultadoRpc<{ success: true; storage_path: string }>> {
  return chamarRpc("projeto_pedido_arquivo_excluir", { p_id: id });
}

/** Carimba os anexos do pedido com o número criado no Alvo. */
export async function marcarArquivosEnviados(
  requisicaoId: string,
  numeroAlvo: string | null,
): Promise<ResultadoRpc<{ success: true; marcados: number }>> {
  return chamarRpc("projeto_pedido_arquivos_marcar_enviados", {
    p_requisicao_id: requisicaoId,
    p_numero_alvo: numeroAlvo,
  });
}

// ── Etapa do pedido (L11 — fonte: Rastreio de Compras) ───────────────

export interface EtapaPedidoProjeto {
  numero: string;
  etapa: string;
  etapa_ordem: number | null;
  qtd_nf: number;
}

export interface EtapasDoProjeto {
  success: true;
  /** Hora da última atualização do Rastreio (roda de hora em hora, aos :55). */
  atualizado_em: string | null;
  pedidos: EtapaPedidoProjeto[];
}

/**
 * Etapa de cada pedido do projeto já enviado ao Alvo, lida da mesma base do
 * Rastreio de Compras. Só informativa: o Hub não decide nada com ela.
 * Pedido com 2+ NFs vem com a etapa menos avançada.
 */
export async function listarEtapasDoProjeto(projetoId: string): Promise<ResultadoRpc<EtapasDoProjeto>> {
  return chamarRpc<EtapasDoProjeto>("projeto_pedidos_etapa", { p_projeto_id: projetoId });
}
