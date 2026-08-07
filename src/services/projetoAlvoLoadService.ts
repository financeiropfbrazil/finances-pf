/**
 * projetoAlvoLoadService — open-load do ERP Alvo para pedidos de projeto (L7-A).
 *
 * Lê pelo **erp-proxy**, não pelo Alvo direto: as rotas `/ped-comp` do gateway
 * passam por `requireSupabaseAuth` (JWT do Supabase, que todo usuário logado
 * tem) e acessam o ERP por conta de serviço. É o que permite qualquer operador
 * consultar — diferente do envio, que ainda autentica com credenciais do
 * localStorage e por isso só funciona para quem as configurou (achado A-8).
 *
 * ┌─ REGRA DURA ────────────────────────────────────────────────────────────┐
 * │ 404 isolado NÃO marca pedido como excluído no ERP. Em Suprimentos isso  │
 * │ marcou 7 pedidos VIVOS. Aqui o 404 só carimba `alvo_nao_encontrado_em`  │
 * │ e a tela avisa; os dados locais ficam intactos. Quem pode concluir      │
 * │ exclusão é o cross-check (404 no Load E ausência no /ped-comp/list da   │
 * │ janela) — que NÃO está implementado neste lote.                         │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * O status exibido vem de `src/lib/statusPedido.ts` — a mesma função que
 * Suprimentos usa. Este arquivo não tem (e não pode ter) mapa de status próprio.
 */

import { supabase } from "@/integrations/supabase/client";
import { getStatusPedido, type StatusPedidoVisual } from "@/lib/statusPedido";

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";

/** Mesma filial usada no payload de envio (`CodigoEmpresaFilial`). */
const FILIAL_PADRAO = "1.01";

async function getSupabaseJWT(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sessão do Supabase inválida. Faça login novamente.");
  }
  return session.access_token;
}

/** Campos do Alvo que o Hub espelha. Nomes iguais aos de `compras_pedidos`. */
export interface CamposAlvo {
  status_alvo: string | null;
  aprovado: string | null;
  status_aprovacao: string | null;
  comprado: string | null;
  enviou_aprovacao: string | null;
  proximo_aprovador: string | null;
}

export interface ResultadoSync {
  id: string;
  numero: string;
  /** false = o ERP respondeu 404 (aviso, NUNCA exclusão) */
  encontrado: boolean;
  /** true = a leitura E a gravação concluíram; false = o Hub não registrou nada */
  persistido: boolean;
  erro?: string;
}

/** Shape (parcial) do PedComp/Load devolvido pelo gateway. */
interface PedCompLoad {
  Status?: string | null;
  Aprovado?: string | null;
  StatusAprovacao?: string | null;
  Comprado?: string | null;
  PedCompUserFieldsObject?: {
    UserEnviouAprovacao?: string | null;
    UserProximoAprovador?: string | null;
  } | null;
  /** presente nas respostas de erro do proxy */
  error?: string;
}

/** Extrai do Load do PedComp os campos que interessam (mesmo mapeamento de Suprimentos). */
function extrairCamposAlvo(ped: PedCompLoad | null): CamposAlvo {
  const uf = ped?.PedCompUserFieldsObject ?? null;
  return {
    status_alvo: ped?.Status ?? null,
    aprovado: ped?.Aprovado ?? null,
    status_aprovacao: ped?.StatusAprovacao ?? null,
    comprado: ped?.Comprado ?? null,
    enviou_aprovacao: uf?.UserEnviouAprovacao ?? null,
    proximo_aprovador: uf?.UserProximoAprovador ?? null,
  };
}

/**
 * GET /ped-comp/:filial/:numero — Load completo do pedido no Alvo.
 * 404 volta como `{ encontrado: false }`, não como exceção: é informação, não falha.
 */
export async function carregarPedidoAlvo(
  numero: string,
  filial: string = FILIAL_PADRAO,
): Promise<{ encontrado: boolean; dados?: CamposAlvo; erro?: string }> {
  const jwt = await getSupabaseJWT();
  const resp = await fetch(`${ERP_PROXY_URL}/ped-comp/${encodeURIComponent(filial)}/${encodeURIComponent(numero)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${jwt}` },
  });

  if (resp.status === 404) {
    return { encontrado: false, erro: `Pedido ${numero} não encontrado no ERP (HTTP 404)` };
  }

  let corpo: PedCompLoad | null = null;
  try {
    corpo = (await resp.json()) as PedCompLoad;
  } catch {
    // resposta sem body válido
  }

  if (!resp.ok) {
    return { encontrado: false, erro: corpo?.error || `HTTP ${resp.status} ao ler o pedido ${numero}` };
  }

  return { encontrado: true, dados: extrairCamposAlvo(corpo) };
}

/**
 * Persiste o retorno do Alvo via RPC (D-4 — escrita direta está fechada desde o L3).
 *
 * Devolve a falha em vez de só logar: na primeira versão deste arquivo o erro
 * morria no console e a tela não dizia nada — quando o open-load não gravou,
 * ninguém soube. É a mesma classe de bug do A-2/A-7 e não se repete aqui.
 */
async function persistirSync(
  id: string,
  encontrado: boolean,
  dados: CamposAlvo | null,
  erro: string | null,
): Promise<{ ok: boolean; erro?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("projeto_pedido_sync_alvo", {
    p_id: id,
    p_encontrado: encontrado,
    p_dados: dados ?? {},
    p_erro: erro,
  });

  if (error) {
    console.error("[projetoAlvoLoadService] projeto_pedido_sync_alvo falhou", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
      id,
    });
    return { ok: false, erro: `${error.message}${error.code ? ` [${error.code}]` : ""}` };
  }

  return { ok: true };
}

/**
 * Sincroniza os pedidos do projeto que já existem no Alvo.
 * Sequencial de propósito: são poucos pedidos por projeto e o ERP não gosta de
 * rajada. Um pedido que falha não interrompe os demais.
 */
export async function sincronizarPedidosDoProjeto(
  pedidos: Array<{ id: string; numero_pedido_alvo?: string | null }>,
): Promise<ResultadoSync[]> {
  const alvos = pedidos.filter((p) => !!p.numero_pedido_alvo);
  const resultados: ResultadoSync[] = [];

  for (const p of alvos) {
    const numero = p.numero_pedido_alvo as string;
    try {
      const r = await carregarPedidoAlvo(numero);
      const gravou = await persistirSync(p.id, r.encontrado, r.dados ?? null, r.erro ?? null);
      resultados.push({
        id: p.id,
        numero,
        encontrado: r.encontrado,
        persistido: gravou.ok,
        erro: gravou.ok ? r.erro : `não gravado no Hub: ${gravou.erro}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[projetoAlvoLoadService] falha ao sincronizar ${numero}:`, msg);
      // Erro de rede/sessão não é 404: NÃO carimba "não encontrado" e NÃO grava nada.
      resultados.push({ id: p.id, numero, encontrado: true, persistido: false, erro: msg });
    }
  }

  return resultados;
}

/**
 * Adapta a linha de `projeto_requisicoes` ao shape que `getStatusPedido` espera
 * e devolve o status efetivo — ou `null` se o pedido ainda não foi lido do Alvo.
 *
 * O de-para existe porque em Projetos a coluna `status` é o **status local**
 * (rascunho/erro/enviado), enquanto `getStatusPedido` espera `status_local` no
 * vocabulário de Suprimentos e `status` como o status do ERP.
 */
export interface LinhaPedidoComAlvo {
  /** status LOCAL do Hub: 'rascunho' | 'erro' | 'enviado' */
  status?: string | null;
  status_alvo?: string | null;
  aprovado?: string | null;
  status_aprovacao?: string | null;
  comprado?: string | null;
  enviou_aprovacao?: string | null;
  proximo_aprovador?: string | null;
  [campo: string]: unknown;
}

export function getStatusAlvoDoPedido(r: LinhaPedidoComAlvo): StatusPedidoVisual | null {
  if (!r?.status_alvo) return null; // sem open-load ainda: quem manda é o status local

  const statusLocalHub =
    r.status === "erro" ? "erro_envio" : r.status === "enviado" ? "enviado_alvo" : (r.status as string);

  return getStatusPedido({
    status_local: statusLocalHub,
    status: r.status_alvo,
    status_aprovacao: r.status_aprovacao,
    enviou_aprovacao: r.enviou_aprovacao,
    aprovado: r.aprovado,
    comprado: r.comprado,
    proximo_aprovador: r.proximo_aprovador,
  });
}
