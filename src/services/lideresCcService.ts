/**
 * lideresCcService — Mapa de Líderes por Centro de Custo (FASE 6.1)
 *
 * Toda escrita passa pelas RPCs SECURITY DEFINER `atribuir_lider_cc` / `revogar_lider_cc`.
 * `compras_lideres_cc` NÃO tem policy de escrita (só SELECT para authenticated), então um
 * `.update()`/`.insert()` direto daqui seria recusado pelo banco — e é assim de propósito.
 *
 * Gate das 3 RPCs: `hub_caller_is_admin()` (decisão P2 do AJUSTE-6.1), o mesmo helper que
 * `hub_assign_role`/`hub_revoke_role`/`hub_list_users_with_roles` já usam. Nenhuma delas olha
 * `admin.users.manage` — gatear a tela pela permissão criaria uma tela meio-viva.
 */

import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Líder ativo de um CC, como vem do `jsonb_agg` de `listar_mapa_lideres`. */
export interface LiderDoCc {
  user_id: string;
  nome: string | null;
  email: string | null;
  atribuido_em: string | null;
}

/** Uma linha do mapa: um CC do universo (81 ativos-folha) ou um mapeamento órfão. */
export interface LinhaMapaLideres {
  erp_code: string;
  nome: string;
  department_type: string | null;
  lideres: LiderDoCc[];
  qtd_lideres: number;
  pendentes: number;
  total_reqs: number;
  /** true = mapeamento aponta para CC que saiu do universo (apagado, expirado ou totalizador). */
  orfao: boolean;
}

/** Usuário para o seletor de atribuição (fonte: `hub_list_users_with_roles`). */
export interface UsuarioSelecao {
  user_id: string;
  full_name: string | null;
  email: string | null;
  is_active: boolean;
  /** Já é líder de departamento? Só informativo — a RPC concede o papel de qualquer forma. */
  ja_lider: boolean;
}

/** Mapeamento revogado (soft-delete), para o histórico. */
export interface MapeamentoInativo {
  id: string;
  lider_user_id: string;
  codigo_centro_ctrl: string;
  atribuido_em: string | null;
  revogado_em: string | null;
  motivo: string | null;
}

export interface ResultadoLiderCc {
  ok: boolean;
  /** Código cru devolvido pela RPC (`OK`, `OK:3`, `SEM_PERMISSAO`…). */
  codigo: string;
  /** Mensagem pronta para a tela. Nunca vazia. */
  mensagem: string;
  /** Só em `revogar`: quantas requisições pendentes existem no CC (informativo, F5). */
  pendentes?: number;
}

// ---------------------------------------------------------------------------
// Tradução de retorno → mensagem. Nenhum retorno cai no vazio.
// ---------------------------------------------------------------------------

function traduzirRetorno(codigo: string, acao: "atribuir" | "revogar"): ResultadoLiderCc {
  if (codigo === "OK") {
    return {
      ok: true,
      codigo,
      mensagem:
        acao === "atribuir"
          ? "Liderança atribuída. O papel “Líder de Departamento” foi concedido no mesmo ato."
          : "Liderança removida.",
    };
  }

  // `OK:n` — revogação bem-sucedida + nº de requisições pendentes no CC (informativo)
  if (codigo.startsWith("OK:")) {
    const n = Number.parseInt(codigo.slice(3), 10);
    const pendentes = Number.isFinite(n) ? n : 0;
    return {
      ok: true,
      codigo,
      pendentes,
      mensagem:
        pendentes > 0
          ? `Liderança removida. ${pendentes} requisição(ões) pendente(s) neste centro de custo NÃO foram alteradas — continuam decidíveis por um administrador.`
          : "Liderança removida. Não havia requisições pendentes neste centro de custo.",
    };
  }

  const mapa: Record<string, string> = {
    SEM_PERMISSAO: "Você não tem permissão para administrar o mapa de líderes.",
    USUARIO_INVALIDO: "Usuário não encontrado. Recarregue a página e escolha alguém da lista.",
    CC_INVALIDO:
      "Centro de custo inválido — ele precisa estar ativo e ser analítico (folha). Recarregue a página.",
    NAO_ENCONTRADA: "Este mapeamento não está mais ativo. A lista foi recarregada.",
    PAPEL_INEXISTENTE:
      "O papel “lider_departamento” não existe no banco. Nada foi gravado — avise o administrador do Hub.",
  };

  if (mapa[codigo]) return { ok: false, codigo, mensagem: mapa[codigo] };

  return {
    ok: false,
    codigo,
    mensagem: `Retorno inesperado ao ${acao} a liderança: "${codigo}".`,
  };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * O mapa completo: os 81 CCs `is_active AND group_type='F'` (P1) + linhas órfãs (P4).
 * Sem permissão, a RPC devolve zero linhas (não é erro).
 */
export async function listarMapaLideres(): Promise<LinhaMapaLideres[]> {
  const { data, error } = await (supabase as any).rpc("listar_mapa_lideres");
  if (error) throw error;

  return ((data as any[]) || []).map((row: any) => ({
    erp_code: row.erp_code,
    nome: row.nome,
    department_type: row.department_type ?? null,
    // `lideres` chega como jsonb; o cliente já entrega array/objeto desserializado.
    lideres: Array.isArray(row.lideres) ? (row.lideres as LiderDoCc[]) : [],
    qtd_lideres: Number(row.qtd_lideres ?? 0),
    pendentes: Number(row.pendentes ?? 0),
    total_reqs: Number(row.total_reqs ?? 0),
    orfao: row.orfao === true,
  }));
}

/**
 * Usuários para o seletor. Mesma fonte das telas administrativas (`hub_list_users_with_roles`),
 * coerente com o gate `is_admin` — a RPC lança 42501 para quem não é admin.
 */
export async function listarUsuariosParaSelecao(): Promise<UsuarioSelecao[]> {
  const { data, error } = await (supabase as any).rpc("hub_list_users_with_roles");
  if (error) throw error;

  return ((data as any[]) || []).map((u: any) => ({
    user_id: u.user_id,
    full_name: u.full_name ?? null,
    email: u.email ?? null,
    is_active: u.is_active !== false,
    ja_lider: Array.isArray(u.roles)
      ? u.roles.some((r: any) => r?.codigo === "lider_departamento")
      : false,
  }));
}

/**
 * Data do último sync do espelho de centros de custo (P3).
 * Medido no Discovery: os 182 registros têm `updated_at` idêntico (30/07/2026) — o sync manual
 * rodou uma única vez. A tela mostra isso em vez de fingir que o espelho está fresco.
 */
export async function obterDataEspelhoCcs(): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from("cost_centers")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.updated_at ?? null;
}

/** Histórico: mapeamentos revogados (soft-delete, F4). Nomes resolvidos pela tela. */
export async function listarMapeamentosInativos(): Promise<MapeamentoInativo[]> {
  const { data, error } = await (supabase as any)
    .from("compras_lideres_cc")
    .select("id, lider_user_id, codigo_centro_ctrl, atribuido_em, revogado_em, motivo")
    .eq("ativo", false)
    .order("revogado_em", { ascending: false, nullsFirst: false });

  if (error) throw error;
  return (data as MapeamentoInativo[]) || [];
}

// ---------------------------------------------------------------------------
// Escrita — só por RPC
// ---------------------------------------------------------------------------

/** Atribui (ou reativa) a liderança e concede `lider_departamento` no mesmo ato (F2). */
export async function atribuirLiderCc(
  userId: string,
  cc: string,
  motivo?: string | null,
): Promise<ResultadoLiderCc> {
  const { data, error } = await (supabase as any).rpc("atribuir_lider_cc", {
    p_user_id: userId,
    p_cc: cc,
    p_motivo: motivo?.trim() ? motivo.trim() : null,
  });

  if (error) {
    return { ok: false, codigo: "ERRO_TRANSPORTE", mensagem: `Falha ao atribuir: ${error.message}` };
  }
  return traduzirRetorno(String(data ?? ""), "atribuir");
}

/**
 * Soft-delete do mapeamento (F4) + revogação do papel se o usuário não liderar mais nada.
 * Devolve `pendentes` para a tela confirmar que nenhuma requisição foi alterada (F5).
 */
export async function revogarLiderCc(userId: string, cc: string): Promise<ResultadoLiderCc> {
  const { data, error } = await (supabase as any).rpc("revogar_lider_cc", {
    p_user_id: userId,
    p_cc: cc,
  });

  if (error) {
    return { ok: false, codigo: "ERRO_TRANSPORTE", mensagem: `Falha ao remover: ${error.message}` };
  }
  return traduzirRetorno(String(data ?? ""), "revogar");
}

// ---------------------------------------------------------------------------
// Atribuição em massa (AJUSTE 6.2 §3.4)
// ---------------------------------------------------------------------------

/** Um centro de custo processado pelo laço, com o retorno que a RPC deu para ele. */
export interface ItemMassa {
  erp_code: string;
  nome: string;
  resultado: ResultadoLiderCc;
}

export interface RelatorioMassa {
  /** Quantos CCs entraram no laço (não é o total de selecionados — os ignorados ficam de fora). */
  total: number;
  sucessos: ItemMassa[];
  falhas: ItemMassa[];
}

/**
 * Chama `atribuir_lider_cc` uma vez por centro de custo, SEQUENCIALMENTE.
 *
 * Não paraleliza de propósito (§3.4): evita rajada de requisições e mantém a ordem do relatório
 * igual à ordem da tela. **Uma falha nunca aborta o restante** — cada retorno é acumulado e
 * devolvido no relatório final, com o código cru da RPC (`CC_INVALIDO`, `USUARIO_INVALIDO`,
 * `PAPEL_INEXISTENTE`, `SEM_PERMISSAO`) traduzido por `traduzirRetorno`.
 *
 * Não há RPC de massa no banco: `atribuir_lider_cc` é idempotente (upsert por
 * `(lider_user_id, codigo_centro_ctrl)`) e concede o papel `lider_departamento` só se ainda não
 * houver linha ativa — então N chamadas deixam **uma** linha de papel, não N.
 */
export async function atribuirLideresEmMassa(
  userId: string,
  ccs: Array<{ erp_code: string; nome: string }>,
  motivo?: string | null,
  onProgresso?: (feitos: number, total: number) => void,
): Promise<RelatorioMassa> {
  const sucessos: ItemMassa[] = [];
  const falhas: ItemMassa[] = [];

  for (let i = 0; i < ccs.length; i++) {
    const cc = ccs[i];
    onProgresso?.(i, ccs.length);

    let resultado: ResultadoLiderCc;
    try {
      resultado = await atribuirLiderCc(userId, cc.erp_code, motivo);
    } catch (err: any) {
      // `atribuirLiderCc` já captura o erro que o supabase-js devolve; este catch cobre o
      // inesperado (queda de rede lançando antes da resposta). O laço segue mesmo assim.
      resultado = {
        ok: false,
        codigo: "ERRO_INESPERADO",
        mensagem: `Falha inesperada: ${err?.message || String(err)}`,
      };
    }

    (resultado.ok ? sucessos : falhas).push({ ...cc, resultado });
  }

  onProgresso?.(ccs.length, ccs.length);
  return { total: ccs.length, sucessos, falhas };
}
