// src/services/dashboardSuprimentosService.ts
//
// Métricas do Dashboard de Suprimentos — via RPCs (agregação no banco).
// Acaba com o limite de 1000 linhas do PostgREST: as RPCs retornam
// resultados já agregados, não as linhas brutas.
//
// 4 métricas respeitam o filtro de período { dataDe, dataAte }:
//   - valor médio, tempo req→pedido, tempo aprovação, funil
// 1 métrica IGNORA o filtro (sempre últimos 6 meses):
//   - volume mensal

import { supabase } from "@/integrations/supabase/client";

export interface PeriodoFiltro {
  dataDe?: string | null; // YYYY-MM-DD
  dataAte?: string | null; // YYYY-MM-DD
}

// ════════════════════════════════════════════════════════════
// TIPOS DE RESULTADO
// ════════════════════════════════════════════════════════════

export interface TempoReqPedidoResult {
  qtd: number;
  diasMedio: number | null;
  diasMin: number | null;
  diasMax: number | null;
}

export interface ValorMedioResult {
  qtd: number;
  valorMedio: number;
  valorMin: number;
  valorMax: number;
  valorTotal: number;
}

export interface TempoAprovacaoResult {
  qtd: number;
  diasMedio: number | null;
  diasMin: number | null;
  diasMax: number | null;
}

export interface FunilEstagio {
  estagio: string;
  qtd: number;
  cor: string;
}

export interface VolumeMes {
  mes: string; // "YYYY-MM"
  mesLabel: string; // "Dez/25"
  qtd: number;
  valorTotal: number;
}

// Cores do funil (mapeadas por estágio)
const CORES_FUNIL: Record<string, string> = {
  "Pendente de envio": "#64748b", // slate
  "Aguardando aprovação": "#f59e0b", // amber
  Aprovado: "#3b82f6", // blue
  Concluído: "#059669", // emerald
  Indefinido: "#94a3b8", // slate claro
};

const MESES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// ════════════════════════════════════════════════════════════
// MÉTRICA 1 — Valor médio (RPC dashboard_supr_valor_medio)
// ════════════════════════════════════════════════════════════

export async function getValorMedioPedidos(periodo: PeriodoFiltro): Promise<ValorMedioResult> {
  const { data, error } = await (supabase as any).rpc("dashboard_supr_valor_medio", {
    p_data_de: periodo.dataDe || null,
    p_data_ate: periodo.dataAte || null,
  });

  if (error || !data || data.length === 0) {
    if (error) console.error("[dashboard] valor_medio:", error);
    return { qtd: 0, valorMedio: 0, valorMin: 0, valorMax: 0, valorTotal: 0 };
  }

  const r = data[0];
  return {
    qtd: Number(r.qtd) || 0,
    valorMedio: Number(r.valor_medio) || 0,
    valorMin: Number(r.valor_min) || 0,
    valorMax: Number(r.valor_max) || 0,
    valorTotal: Number(r.valor_total) || 0,
  };
}

// ════════════════════════════════════════════════════════════
// MÉTRICA 2 — Tempo req→pedido (RPC dashboard_supr_tempo_req_pedido)
// ════════════════════════════════════════════════════════════

export async function getTempoMedioReqParaPedido(periodo: PeriodoFiltro): Promise<TempoReqPedidoResult> {
  const { data, error } = await (supabase as any).rpc("dashboard_supr_tempo_req_pedido", {
    p_data_de: periodo.dataDe || null,
    p_data_ate: periodo.dataAte || null,
  });

  if (error || !data || data.length === 0) {
    if (error) console.error("[dashboard] tempo_req_pedido:", error);
    return { qtd: 0, diasMedio: null, diasMin: null, diasMax: null };
  }

  const r = data[0];
  return {
    qtd: Number(r.qtd) || 0,
    diasMedio: r.dias_medio !== null ? Number(r.dias_medio) : null,
    diasMin: r.dias_min !== null ? Number(r.dias_min) : null,
    diasMax: r.dias_max !== null ? Number(r.dias_max) : null,
  };
}

// ════════════════════════════════════════════════════════════
// MÉTRICA 3 — Tempo de aprovação (RPC dashboard_supr_tempo_aprovacao)
// ════════════════════════════════════════════════════════════

export async function getTempoMedioAprovacao(periodo: PeriodoFiltro): Promise<TempoAprovacaoResult> {
  const { data, error } = await (supabase as any).rpc("dashboard_supr_tempo_aprovacao", {
    p_data_de: periodo.dataDe || null,
    p_data_ate: periodo.dataAte || null,
  });

  if (error || !data || data.length === 0) {
    if (error) console.error("[dashboard] tempo_aprovacao:", error);
    return { qtd: 0, diasMedio: null, diasMin: null, diasMax: null };
  }

  const r = data[0];
  return {
    qtd: Number(r.qtd) || 0,
    diasMedio: r.dias_medio !== null ? Number(r.dias_medio) : null,
    diasMin: r.dias_min !== null ? Number(r.dias_min) : null,
    diasMax: r.dias_max !== null ? Number(r.dias_max) : null,
  };
}

// ════════════════════════════════════════════════════════════
// MÉTRICA 4 — Funil de status (RPC dashboard_supr_funil)
// ════════════════════════════════════════════════════════════

export async function getFunilStatus(periodo: PeriodoFiltro): Promise<FunilEstagio[]> {
  const { data, error } = await (supabase as any).rpc("dashboard_supr_funil", {
    p_data_de: periodo.dataDe || null,
    p_data_ate: periodo.dataAte || null,
  });

  if (error || !data) {
    if (error) console.error("[dashboard] funil:", error);
    return [];
  }

  // A RPC já retorna ordenado por `ordem`
  return data.map((r: any) => ({
    estagio: r.estagio,
    qtd: Number(r.qtd) || 0,
    cor: CORES_FUNIL[r.estagio] || "#94a3b8",
  }));
}

// ════════════════════════════════════════════════════════════
// MÉTRICA 5 — Volume mensal (RPC dashboard_supr_volume_mensal)
// SEMPRE últimos 6 meses — ignora o filtro de período.
// ════════════════════════════════════════════════════════════

export async function getVolumeMensal(): Promise<VolumeMes[]> {
  const { data, error } = await (supabase as any).rpc("dashboard_supr_volume_mensal");

  if (error || !data) {
    if (error) console.error("[dashboard] volume_mensal:", error);
    return [];
  }

  return data.map((r: any) => {
    const [ano, mes] = String(r.mes).split("-");
    const mesIdx = parseInt(mes, 10) - 1;
    return {
      mes: r.mes,
      mesLabel: `${MESES_PT[mesIdx]}/${ano.slice(2)}`,
      qtd: Number(r.qtd) || 0,
      valorTotal: Number(r.valor_total) || 0,
    };
  });
}

// ════════════════════════════════════════════════════════════
// AGREGADOR
// ════════════════════════════════════════════════════════════

export interface DashboardData {
  tempoReqPedido: TempoReqPedidoResult;
  valorMedio: ValorMedioResult;
  tempoAprovacao: TempoAprovacaoResult;
  funil: FunilEstagio[];
  volumeMensal: VolumeMes[];
}

export async function getDashboardSuprimentos(periodo: PeriodoFiltro): Promise<DashboardData> {
  const [tempoReqPedido, valorMedio, tempoAprovacao, funil, volumeMensal] = await Promise.all([
    getTempoMedioReqParaPedido(periodo),
    getValorMedioPedidos(periodo),
    getTempoMedioAprovacao(periodo),
    getFunilStatus(periodo),
    getVolumeMensal(), // sem período — sempre 6 meses
  ]);

  return { tempoReqPedido, valorMedio, tempoAprovacao, funil, volumeMensal };
}
