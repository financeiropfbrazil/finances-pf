// src/services/deparaContabilService.ts
//
// Camada de serviço do De-Para Contábil de Despesas.
// LEITURAS via RPCs SECURITY DEFINER (as tabelas têm RLS sem policy de
// SELECT; leitura direta .from() retorna vazio). Espelha o padrão do
// resto do módulo de despesas (RealizadoDespesas lê tudo por RPC).
//
// Backend já existente (NÃO criar):
//   RPCs leitura: desp_listar_depara, desp_listar_plano_resultado,
//                 desp_listar_competencias
//   RPCs escrita: desp_set_conta_classe, desp_recarimbar,
//                 desp_fechar_competencia, desp_reabrir_competencia

import { supabase } from "@/integrations/supabase/client";

// ════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════

export type StatusDePara = "MAPEADA" | "DESEMPATE" | "SEM_CONTA";

export interface ClasseDePara {
  codigo: string;
  nome: string;
  grupo: string | null;
  categoria: string | null;
  contaPadrao: string | null;
  contaPadraoNome: string | null;
  requerDesempate: boolean;
  status: StatusDePara;
}

export interface ContaPlano {
  conta_hierarquica: string;
  conta_reduzida: string | null;
  nome: string;
  ramo: string | null;
}

export interface Competencia {
  ano: number;
  mes: number;
  status: "ABERTA" | "FECHADA";
  fechada_em: string | null;
  fechada_por: string | null;
}

export interface RecarimboLinha {
  mes: number;
  fonte: string;
  linhas_afetadas: number;
}

// ════════════════════════════════════════════════════════════
// LEITURA — via RPC (contorna RLS)
// ════════════════════════════════════════════════════════════

export async function getClassesDePara(): Promise<ClasseDePara[]> {
  const { data, error } = await (supabase as any).rpc("desp_listar_depara");
  if (error || !data) {
    if (error) console.error("[depara] getClassesDePara:", error);
    return [];
  }
  return data.map((r: any) => ({
    codigo: r.codigo,
    nome: r.nome,
    grupo: r.grupo ?? null,
    categoria: r.categoria ?? null,
    contaPadrao: r.conta_padrao ?? null,
    contaPadraoNome: r.conta_padrao_nome ?? null,
    requerDesempate: !!r.requer_desempate,
    status: r.status as StatusDePara,
  }));
}

export async function getPlanoContasResultado(): Promise<ContaPlano[]> {
  const { data, error } = await (supabase as any).rpc("desp_listar_plano_resultado");
  if (error || !data) {
    if (error) console.error("[depara] getPlanoContasResultado:", error);
    return [];
  }
  return data as ContaPlano[];
}

export async function getCompetencias(): Promise<Competencia[]> {
  const { data, error } = await (supabase as any).rpc("desp_listar_competencias");
  if (error || !data) {
    if (error) console.error("[depara] getCompetencias:", error);
    return [];
  }
  return data as Competencia[];
}

// ════════════════════════════════════════════════════════════
// ESCRITA — RPCs (propaga error.message para toast)
// ════════════════════════════════════════════════════════════

export async function setContaClasse(
  codigo: string,
  conta: string,
  ano: number | null,
  meses: number[] | null,
): Promise<RecarimboLinha[]> {
  const { data, error } = await (supabase as any).rpc("desp_set_conta_classe", {
    p_codigo_classe: codigo,
    p_conta_hierarquica: conta,
    p_ano: ano,
    p_meses: meses,
  });
  if (error) {
    console.error("[depara] setContaClasse:", error);
    throw new Error(error.message);
  }
  return (data || []) as RecarimboLinha[];
}

export async function fecharCompetencia(ano: number, mes: number, usuario: string | null): Promise<string> {
  const { data, error } = await (supabase as any).rpc("desp_fechar_competencia", {
    p_ano: ano,
    p_mes: mes,
    p_usuario: usuario,
  });
  if (error) {
    console.error("[depara] fecharCompetencia:", error);
    throw new Error(error.message);
  }
  return data as string;
}

export async function reabrirCompetencia(ano: number, mes: number): Promise<string> {
  const { data, error } = await (supabase as any).rpc("desp_reabrir_competencia", {
    p_ano: ano,
    p_mes: mes,
  });
  if (error) {
    console.error("[depara] reabrirCompetencia:", error);
    throw new Error(error.message);
  }
  return data as string;
}
