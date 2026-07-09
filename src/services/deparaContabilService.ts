// src/services/deparaContabilService.ts
//
// Camada de serviço do De-Para Contábil de Despesas.
// Todas as chamadas ao Supabase (queries + RPCs) do módulo de configuração
// de contas contábeis vivem aqui. Componentes não chamam supabase direto.
//
// Backend já existente (NÃO criar):
//   Tabelas: desp_classe_config, desp_plano_contas, desp_classe_conta,
//            desp_competencia_status
//   RPCs:    desp_set_conta_classe, desp_recarimbar,
//            desp_fechar_competencia, desp_reabrir_competencia
//
// Espelha o estilo de dashboardSuprimentosService.ts (cast (supabase as any)
// nas RPCs novas, tratamento de erro com console.error).

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
  contaPadrao: string | null; // conta_hierarquica com is_padrao=true
  contaPadraoNome: string | null; // nome da conta padrão (join no plano)
  requerDesempate: boolean;
  status: StatusDePara;
}

export interface ContaPlano {
  conta_hierarquica: string;
  conta_reduzida: string | null;
  nome: string;
  ramo: string | null;
}

export interface ContaCandidata {
  conta_hierarquica: string;
  nome: string | null;
  is_padrao: boolean;
  requer_desempate_manual: boolean;
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
// LEITURA — De-Para (classes + conta padrão vigente)
// ════════════════════════════════════════════════════════════

export async function getClassesDePara(): Promise<ClasseDePara[]> {
  // 1. Classes no controle
  const { data: classes, error: errC } = await supabase
    .from("desp_classe_config")
    .select("codigo, nome, grupo, categoria")
    .eq("incluir_controle", true)
    .order("codigo");

  if (errC || !classes) {
    if (errC) console.error("[depara] getClassesDePara classes:", errC);
    return [];
  }

  // 2. De-para vigente (todas as linhas; resolvemos padrão/desempate em JS)
  const { data: mapRows, error: errM } = await supabase
    .from("desp_classe_conta")
    .select("codigo_classe, conta_hierarquica, is_padrao, requer_desempate_manual");

  if (errM) {
    console.error("[depara] getClassesDePara map:", errM);
  }

  // 3. Nomes das contas (para exibir a conta padrão com nome)
  const contasPadrao = (mapRows || []).filter((r: any) => r.is_padrao).map((r: any) => r.conta_hierarquica);

  const nomePorConta = new Map<string, string>();
  if (contasPadrao.length > 0) {
    const { data: planoRows } = await supabase
      .from("desp_plano_contas")
      .select("conta_hierarquica, nome")
      .in("conta_hierarquica", contasPadrao);
    (planoRows || []).forEach((p: any) => nomePorConta.set(p.conta_hierarquica, p.nome));
  }

  // 4. Indexar de-para por classe
  const porClasse = new Map<string, any[]>();
  (mapRows || []).forEach((r: any) => {
    const arr = porClasse.get(r.codigo_classe) || [];
    arr.push(r);
    porClasse.set(r.codigo_classe, arr);
  });

  // 5. Montar resultado + status
  return classes.map((c: any) => {
    const linhas = porClasse.get(c.codigo) || [];
    const padrao = linhas.find((l) => l.is_padrao);
    const temDesempate = linhas.some((l) => l.requer_desempate_manual);

    let status: StatusDePara;
    if (linhas.length === 0) status = "SEM_CONTA";
    else if (temDesempate && !padrao) status = "DESEMPATE";
    else status = "MAPEADA";

    return {
      codigo: c.codigo,
      nome: c.nome,
      grupo: c.grupo ?? null,
      categoria: c.categoria ?? null,
      contaPadrao: padrao ? padrao.conta_hierarquica : null,
      contaPadraoNome: padrao ? (nomePorConta.get(padrao.conta_hierarquica) ?? null) : null,
      requerDesempate: temDesempate,
      status,
    };
  });
}

// ════════════════════════════════════════════════════════════
// LEITURA — Plano de contas de resultado (dropdown)
// ════════════════════════════════════════════════════════════

export async function getPlanoContasResultado(): Promise<ContaPlano[]> {
  const { data, error } = await supabase
    .from("desp_plano_contas")
    .select("conta_hierarquica, conta_reduzida, nome, ramo")
    .eq("analitica", true)
    .in("ramo", ["4", "5", "6"])
    .order("conta_hierarquica");

  if (error || !data) {
    if (error) console.error("[depara] getPlanoContasResultado:", error);
    return [];
  }
  return data as ContaPlano[];
}

// ════════════════════════════════════════════════════════════
// LEITURA — Contas candidatas de uma classe (casos 1:N)
// ════════════════════════════════════════════════════════════

export async function getContasCandidatas(codigoClasse: string): Promise<ContaCandidata[]> {
  const { data, error } = await supabase
    .from("desp_classe_conta")
    .select("conta_hierarquica, is_padrao, requer_desempate_manual")
    .eq("codigo_classe", codigoClasse);

  if (error || !data) {
    if (error) console.error("[depara] getContasCandidatas:", error);
    return [];
  }

  // Enriquecer com nome do plano
  const contas = data.map((r: any) => r.conta_hierarquica);
  const nomePorConta = new Map<string, string>();
  if (contas.length > 0) {
    const { data: planoRows } = await supabase
      .from("desp_plano_contas")
      .select("conta_hierarquica, nome")
      .in("conta_hierarquica", contas);
    (planoRows || []).forEach((p: any) => nomePorConta.set(p.conta_hierarquica, p.nome));
  }

  return data.map((r: any) => ({
    conta_hierarquica: r.conta_hierarquica,
    nome: nomePorConta.get(r.conta_hierarquica) ?? null,
    is_padrao: r.is_padrao,
    requer_desempate_manual: r.requer_desempate_manual,
  }));
}

// ════════════════════════════════════════════════════════════
// LEITURA — Competências
// ════════════════════════════════════════════════════════════

export async function getCompetencias(): Promise<Competencia[]> {
  const { data, error } = await supabase
    .from("desp_competencia_status")
    .select("ano, mes, status, fechada_em, fechada_por")
    .order("ano", { ascending: true })
    .order("mes", { ascending: true });

  if (error || !data) {
    if (error) console.error("[depara] getCompetencias:", error);
    return [];
  }
  return data as Competencia[];
}

// ════════════════════════════════════════════════════════════
// ESCRITA — RPCs (cast (supabase as any) — não estão nos tipos gerados)
// ════════════════════════════════════════════════════════════

// Define/troca a conta padrão da classe e, se ano+meses, re-carimba.
// Propaga error.message para o chamador tratar em toast.
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
