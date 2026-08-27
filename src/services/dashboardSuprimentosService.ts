// src/services/dashboardSuprimentosService.ts
//
// Métricas do Dashboard de Suprimentos — via RPCs (agregação no banco).
// Acaba com o limite de 1000 linhas do PostgREST: as RPCs retornam
// resultados já agregados, não as linhas brutas.
//
// Cards que respeitam o filtro de período { dataDe, dataAte }:
//   - valor médio, tempo req→pedido, tempo aprovação, funil
// Métricas que IGNORAM o filtro:
//   - volume mensal (sempre últimos 6 meses)
//   - aguardando aprovação (fila atual = "agora")
//
// v2: tempos agora usam MEDIANA (manchete) + P90 (cauda) em vez de média.
//     tempo de aprovação migrado p/ datas do Alvo (digitação → aprovação),
//     que têm cobertura ~total — antes vinha da auditoria (cobertura parcial).

import { supabase } from "@/integrations/supabase/client";

export interface PeriodoFiltro {
  dataDe?: string | null; // YYYY-MM-DD
  dataAte?: string | null; // YYYY-MM-DD
}

// ════════════════════════════════════════════════════════════
// TIPOS DE RESULTADO
// ════════════════════════════════════════════════════════════

export interface TempoResult {
  qtd: number;
  diasMediana: number | null;
  diasP90: number | null;
  diasMedia: number | null;
}

// MOEDA-PEDIDOS — composição por moeda nos agregados.
//
// Somar pedidos de moedas diferentes é uma conversão implícita a 1:1, que é
// pior que o `R$` errado que a missão veio corrigir. Por isso os KPIs de
// valor passam a declarar o escopo:
//   · `valorTotal` agrega SÓ o bucket em reais (BRL confirmado + presumido);
//   · `valorSemMoeda`/`qtdSemMoeda` é o pedaço PRESUMIDO desse total, e a
//     tela é obrigada a declará-lo — sem o rótulo, B vira presunção
//     silenciosa (condição do Pedro em 26/08/2026);
//   · USD e EUR vêm à parte e NUNCA são somados a nada;
//   · `Fora` é o balde da dúvida: pedido sem moeda cujo fornecedor já teve
//     pedido em moeda estrangeira. Não entra em soma nenhuma.
//
// O bucket presumido é DECRESCENTE: o completarCamposAusentes do cron
// preenche a moeda dos pedidos vivos de hora em hora.
export interface ComposicaoMoeda {
  qtdSemMoeda: number;
  valorSemMoeda: number;
  qtdUsd: number;
  valorUsd: number;
  qtdEur: number;
  valorEur: number;
  qtdFora: number;
  valorFora: number;
}

export interface ValorMedioResult extends ComposicaoMoeda {
  qtd: number;
  valorMedio: number;
  valorMin: number;
  valorMax: number;
  valorTotal: number;
}

export interface AguardandoAprovacaoResult extends ComposicaoMoeda {
  qtd: number;
  valorTotal: number;
  diasEsperaMax: number | null;
  diasEsperaMediana: number | null;
}

// Lê a composição de uma linha de RPC. Tolera as colunas ausentes: enquanto
// o SQL do A4 não estiver aplicado, tudo vem zerado e a tela simplesmente
// não mostra as notas — nada quebra e nenhum número fica errado.
type NumeroDaRpc = number | string | null | undefined;

interface LinhaComposicao {
  qtd_sem_moeda?: NumeroDaRpc;
  valor_sem_moeda?: NumeroDaRpc;
  qtd_usd?: NumeroDaRpc;
  valor_usd?: NumeroDaRpc;
  qtd_eur?: NumeroDaRpc;
  valor_eur?: NumeroDaRpc;
  qtd_fora?: NumeroDaRpc;
  valor_fora?: NumeroDaRpc;
}

function lerComposicao(r: LinhaComposicao | null | undefined): ComposicaoMoeda {
  return {
    qtdSemMoeda: Number(r?.qtd_sem_moeda) || 0,
    valorSemMoeda: Number(r?.valor_sem_moeda) || 0,
    qtdUsd: Number(r?.qtd_usd) || 0,
    valorUsd: Number(r?.valor_usd) || 0,
    qtdEur: Number(r?.qtd_eur) || 0,
    valorEur: Number(r?.valor_eur) || 0,
    qtdFora: Number(r?.qtd_fora) || 0,
    valorFora: Number(r?.valor_fora) || 0,
  };
}

const COMPOSICAO_VAZIA: ComposicaoMoeda = {
  qtdSemMoeda: 0,
  valorSemMoeda: 0,
  qtdUsd: 0,
  valorUsd: 0,
  qtdEur: 0,
  valorEur: 0,
  qtdFora: 0,
  valorFora: 0,
};

export interface FunilEstagio {
  estagio: string;
  qtd: number;
  cor: string;
}

export interface VolumeMes {
  mes: string; // "YYYY-MM"
  mesLabel: string; // "Dez/25"
  qtd: number;
  // MOEDA-PEDIDOS: só o bucket em reais. O que é estrangeiro sai da série e
  // vem em `valorUsd`/`valorEur`, para o gráfico poder declarar.
  valorTotal: number;
  qtdSemMoeda: number;
  valorSemMoeda: number;
  valorUsd: number;
  valorEur: number;
}

// Cores do funil (mapeadas por estágio)
const CORES_FUNIL: Record<string, string> = {
  "Pendente de envio": "#64748b", // slate
  "Aguardando aprovação": "#f59e0b", // amber
  Aprovado: "#3b82f6", // blue
  Concluído: "#059669", // emerald
  Cancelado: "#dc2626", // red
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
    return { qtd: 0, valorMedio: 0, valorMin: 0, valorMax: 0, valorTotal: 0, ...COMPOSICAO_VAZIA };
  }

  const r = data[0];
  return {
    qtd: Number(r.qtd) || 0,
    valorMedio: Number(r.valor_medio) || 0,
    valorMin: Number(r.valor_min) || 0,
    valorMax: Number(r.valor_max) || 0,
    valorTotal: Number(r.valor_total) || 0,
    ...lerComposicao(r),
  };
}

// ════════════════════════════════════════════════════════════
// MÉTRICA 2 — Tempo req→pedido (RPC dashboard_supr_tempo_req_pedido)
// ════════════════════════════════════════════════════════════

export async function getTempoMedioReqParaPedido(periodo: PeriodoFiltro): Promise<TempoResult> {
  const { data, error } = await (supabase as any).rpc("dashboard_supr_tempo_req_pedido", {
    p_data_de: periodo.dataDe || null,
    p_data_ate: periodo.dataAte || null,
  });

  if (error || !data || data.length === 0) {
    if (error) console.error("[dashboard] tempo_req_pedido:", error);
    return { qtd: 0, diasMediana: null, diasP90: null, diasMedia: null };
  }

  const r = data[0];
  return {
    qtd: Number(r.qtd) || 0,
    diasMediana: r.dias_mediana !== null ? Number(r.dias_mediana) : null,
    diasP90: r.dias_p90 !== null ? Number(r.dias_p90) : null,
    diasMedia: r.dias_media !== null ? Number(r.dias_media) : null,
  };
}

// ════════════════════════════════════════════════════════════
// MÉTRICA 3 — Tempo de aprovação (RPC dashboard_supr_tempo_aprovacao)
// ════════════════════════════════════════════════════════════

export async function getTempoMedioAprovacao(periodo: PeriodoFiltro): Promise<TempoResult> {
  const { data, error } = await (supabase as any).rpc("dashboard_supr_tempo_aprovacao", {
    p_data_de: periodo.dataDe || null,
    p_data_ate: periodo.dataAte || null,
  });

  if (error || !data || data.length === 0) {
    if (error) console.error("[dashboard] tempo_aprovacao:", error);
    return { qtd: 0, diasMediana: null, diasP90: null, diasMedia: null };
  }

  const r = data[0];
  return {
    qtd: Number(r.qtd) || 0,
    diasMediana: r.dias_mediana !== null ? Number(r.dias_mediana) : null,
    diasP90: r.dias_p90 !== null ? Number(r.dias_p90) : null,
    diasMedia: r.dias_media !== null ? Number(r.dias_media) : null,
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
      qtdSemMoeda: Number(r.qtd_sem_moeda) || 0,
      valorSemMoeda: Number(r.valor_sem_moeda) || 0,
      valorUsd: Number(r.valor_usd) || 0,
      valorEur: Number(r.valor_eur) || 0,
    };
  });
}

// ════════════════════════════════════════════════════════════
// MÉTRICA 6 — Aguardando aprovação (RPC dashboard_supr_aguardando_aprovacao)
// Fila ATUAL — ignora o filtro de período (é "agora").
// ════════════════════════════════════════════════════════════

export async function getAguardandoAprovacao(): Promise<AguardandoAprovacaoResult> {
  const { data, error } = await (supabase as any).rpc("dashboard_supr_aguardando_aprovacao");

  if (error || !data || data.length === 0) {
    if (error) console.error("[dashboard] aguardando_aprovacao:", error);
    return { qtd: 0, valorTotal: 0, diasEsperaMax: null, diasEsperaMediana: null, ...COMPOSICAO_VAZIA };
  }

  const r = data[0];
  return {
    // `qtd` é a fila INTEIRA, todas as moedas — "quantos pedidos estão
    // parados" não sofre com moeda mista; só o valor sofre.
    qtd: Number(r.qtd) || 0,
    valorTotal: Number(r.valor_total) || 0,
    diasEsperaMax: r.dias_espera_max !== null ? Number(r.dias_espera_max) : null,
    diasEsperaMediana: r.dias_espera_mediana !== null ? Number(r.dias_espera_mediana) : null,
    ...lerComposicao(r),
  };
}

// ════════════════════════════════════════════════════════════
// AGREGADOR
// ════════════════════════════════════════════════════════════

export interface DashboardData {
  tempoReqPedido: TempoResult;
  valorMedio: ValorMedioResult;
  tempoAprovacao: TempoResult;
  funil: FunilEstagio[];
  volumeMensal: VolumeMes[];
  aguardando: AguardandoAprovacaoResult;
}

export async function getDashboardSuprimentos(periodo: PeriodoFiltro): Promise<DashboardData> {
  const [tempoReqPedido, valorMedio, tempoAprovacao, funil, volumeMensal, aguardando] = await Promise.all([
    getTempoMedioReqParaPedido(periodo),
    getValorMedioPedidos(periodo),
    getTempoMedioAprovacao(periodo),
    getFunilStatus(periodo),
    getVolumeMensal(), // sem período — sempre 6 meses
    getAguardandoAprovacao(), // sem período — fila atual
  ]);

  return { tempoReqPedido, valorMedio, tempoAprovacao, funil, volumeMensal, aguardando };
}
