// src/services/dashboardSuprimentosService.ts
//
// Métricas do Dashboard de Suprimentos (Pedidos + Requisições).
// Todas aceitam um filtro opcional de período { dataDe, dataAte } (YYYY-MM-DD).
//
// Métricas:
//   1. tempoMedioReqParaPedido  — dias entre criação da req e criação do pedido
//   2. valorMedioPedidos        — valor médio + total + contagem
//   3. tempoMedioAprovacao      — dias entre "Em Andamento" e "Finalizada" (via auditoria)
//   4. funilStatus              — contagem de pedidos por estágio
//   5. volumeMensal             — qtd + R$ por mês (data_pedido)

import { supabase } from "@/integrations/supabase/client";

export interface PeriodoFiltro {
  dataDe?: string | null; // YYYY-MM-DD
  dataAte?: string | null; // YYYY-MM-DD
}

// ── Aplica filtro de data num range de coluna ──
function aplicarFiltroData(query: any, coluna: string, periodo: PeriodoFiltro) {
  if (periodo.dataDe) {
    query = query.gte(coluna, periodo.dataDe);
  }
  if (periodo.dataAte) {
    // inclui o dia inteiro do dataAte
    query = query.lte(coluna, periodo.dataAte + "T23:59:59.999Z");
  }
  return query;
}

// ════════════════════════════════════════════════════════════
// MÉTRICA 1 — Tempo médio req → pedido (em dias)
// ════════════════════════════════════════════════════════════

export interface TempoReqPedidoResult {
  qtd: number;
  diasMedio: number | null;
  diasMin: number | null;
  diasMax: number | null;
}

export async function getTempoMedioReqParaPedido(periodo: PeriodoFiltro): Promise<TempoReqPedidoResult> {
  // Busca pedidos que vieram de req (numero_req_comp preenchido)
  let query = (supabase as any)
    .from("compras_pedidos")
    .select("created_at, numero_req_comp, codigo_empresa_filial_req_comp, data_pedido")
    .not("numero_req_comp", "is", null);

  // Filtro de período aplicado sobre data_pedido do pedido
  query = aplicarFiltroData(query, "data_pedido", periodo);

  const { data: pedidos, error } = await query;
  if (error || !pedidos || pedidos.length === 0) {
    return { qtd: 0, diasMedio: null, diasMin: null, diasMax: null };
  }

  // Busca as reqs origem desses pedidos pra pegar created_at
  const numerosReq = [...new Set(pedidos.map((p: any) => p.numero_req_comp).filter(Boolean))];
  if (numerosReq.length === 0) {
    return { qtd: 0, diasMedio: null, diasMin: null, diasMax: null };
  }

  const { data: reqs } = await (supabase as any)
    .from("compras_requisicoes")
    .select("numero_alvo, codigo_empresa_filial, created_at")
    .in("numero_alvo", numerosReq);

  const reqMap = new Map<string, string>();
  (reqs || []).forEach((r: any) => {
    reqMap.set(`${r.numero_alvo}|${r.codigo_empresa_filial}`, r.created_at);
  });

  const diffsDias: number[] = [];
  for (const p of pedidos) {
    const chave = `${p.numero_req_comp}|${p.codigo_empresa_filial_req_comp}`;
    const reqCreatedAt = reqMap.get(chave);
    if (!reqCreatedAt || !p.created_at) continue;
    const ms = new Date(p.created_at).getTime() - new Date(reqCreatedAt).getTime();
    if (ms < 0) continue; // sanidade: pedido depois da req
    diffsDias.push(ms / 86400000);
  }

  if (diffsDias.length === 0) {
    return { qtd: 0, diasMedio: null, diasMin: null, diasMax: null };
  }

  const soma = diffsDias.reduce((a, b) => a + b, 0);
  return {
    qtd: diffsDias.length,
    diasMedio: soma / diffsDias.length,
    diasMin: Math.min(...diffsDias),
    diasMax: Math.max(...diffsDias),
  };
}

// ════════════════════════════════════════════════════════════
// MÉTRICA 2 — Valor médio dos pedidos
// ════════════════════════════════════════════════════════════

export interface ValorMedioResult {
  qtd: number;
  valorMedio: number;
  valorMin: number;
  valorMax: number;
  valorTotal: number;
}

export async function getValorMedioPedidos(periodo: PeriodoFiltro): Promise<ValorMedioResult> {
  let query = (supabase as any)
    .from("compras_pedidos")
    .select("valor_total")
    .not("valor_total", "is", null)
    .gt("valor_total", 0);

  query = aplicarFiltroData(query, "data_pedido", periodo);

  const { data, error } = await query;
  if (error || !data || data.length === 0) {
    return { qtd: 0, valorMedio: 0, valorMin: 0, valorMax: 0, valorTotal: 0 };
  }

  const valores = data.map((p: any) => Number(p.valor_total));
  const total = valores.reduce((a: number, b: number) => a + b, 0);
  return {
    qtd: valores.length,
    valorMedio: total / valores.length,
    valorMin: Math.min(...valores),
    valorMax: Math.max(...valores),
    valorTotal: total,
  };
}

// ════════════════════════════════════════════════════════════
// MÉTRICA 3 — Tempo médio de aprovação (em dias)
// Via auditoria: 1º "Em Andamento" → 1º "Finalizada" por pedido
// ════════════════════════════════════════════════════════════

export interface TempoAprovacaoResult {
  qtd: number;
  diasMedio: number | null;
  diasMin: number | null;
  diasMax: number | null;
}

export async function getTempoMedioAprovacao(periodo: PeriodoFiltro): Promise<TempoAprovacaoResult> {
  // Busca eventos de transição de status_aprovacao
  let query = (supabase as any)
    .from("compras_pedidos_auditoria")
    .select("pedido_id, status_aprovacao_novo, created_at")
    .in("status_aprovacao_novo", ["Em Andamento", "Finalizada"]);

  // Filtro de período aplicado sobre created_at do evento
  if (periodo.dataDe) {
    query = query.gte("created_at", periodo.dataDe);
  }
  if (periodo.dataAte) {
    query = query.lte("created_at", periodo.dataAte + "T23:59:59.999Z");
  }

  const { data: eventos, error } = await query;
  if (error || !eventos || eventos.length === 0) {
    return { qtd: 0, diasMedio: null, diasMin: null, diasMax: null };
  }

  // Agrupa por pedido: 1º "Em Andamento" e 1º "Finalizada"
  const inicio = new Map<string, number>();
  const fim = new Map<string, number>();

  for (const ev of eventos) {
    const t = new Date(ev.created_at).getTime();
    if (ev.status_aprovacao_novo === "Em Andamento") {
      const atual = inicio.get(ev.pedido_id);
      if (atual === undefined || t < atual) inicio.set(ev.pedido_id, t);
    } else if (ev.status_aprovacao_novo === "Finalizada") {
      const atual = fim.get(ev.pedido_id);
      if (atual === undefined || t < atual) fim.set(ev.pedido_id, t);
    }
  }

  const diffsDias: number[] = [];
  for (const [pedidoId, tInicio] of inicio.entries()) {
    const tFim = fim.get(pedidoId);
    if (tFim === undefined || tFim < tInicio) continue;
    diffsDias.push((tFim - tInicio) / 86400000);
  }

  if (diffsDias.length === 0) {
    return { qtd: 0, diasMedio: null, diasMin: null, diasMax: null };
  }

  const soma = diffsDias.reduce((a, b) => a + b, 0);
  return {
    qtd: diffsDias.length,
    diasMedio: soma / diffsDias.length,
    diasMin: Math.min(...diffsDias),
    diasMax: Math.max(...diffsDias),
  };
}

// ════════════════════════════════════════════════════════════
// MÉTRICA 4 — Funil de status (5 estágios agrupados)
// ════════════════════════════════════════════════════════════

export interface FunilEstagio {
  estagio: string;
  qtd: number;
  cor: string; // classe tailwind ou cor hex pro gráfico
}

export async function getFunilStatus(periodo: PeriodoFiltro): Promise<FunilEstagio[]> {
  let query = (supabase as any)
    .from("compras_pedidos")
    .select("status, status_aprovacao, aprovado, comprado, enviou_aprovacao");

  query = aplicarFiltroData(query, "data_pedido", periodo);

  const { data, error } = await query;
  if (error || !data) {
    return [];
  }

  // Agrupa nos 5 estágios
  let pendenteEnvio = 0;
  let aguardandoAprovacao = 0;
  let aprovado = 0;
  let concluido = 0;
  let indefinido = 0;

  for (const p of data) {
    const sa = p.status_aprovacao;
    const apr = p.aprovado;
    const comp = p.comprado;

    if (sa === null || sa === undefined) {
      indefinido++;
    } else if (sa === "Finalizada" && apr === "Total" && comp === "Sim") {
      concluido++;
    } else if (sa === "Finalizada" && apr === "Total") {
      aprovado++; // aprovado mas ainda não comprado
    } else if (sa === "Em Andamento" || sa === "Reavaliar") {
      aguardandoAprovacao++;
    } else if (sa === "Nenhum") {
      pendenteEnvio++;
    } else {
      indefinido++;
    }
  }

  return [
    { estagio: "Pendente de envio", qtd: pendenteEnvio, cor: "#64748b" }, // slate
    { estagio: "Aguardando aprovação", qtd: aguardandoAprovacao, cor: "#f59e0b" }, // amber
    { estagio: "Aprovado", qtd: aprovado, cor: "#3b82f6" }, // blue
    { estagio: "Concluído", qtd: concluido, cor: "#059669" }, // emerald
    { estagio: "Indefinido", qtd: indefinido, cor: "#94a3b8" }, // slate claro
  ];
}

// ════════════════════════════════════════════════════════════
// MÉTRICA 5 — Volume mensal (qtd + R$ por mês)
// ════════════════════════════════════════════════════════════

export interface VolumeMes {
  mes: string; // "YYYY-MM"
  mesLabel: string; // "Jan/26"
  qtd: number;
  valorTotal: number;
}

const MESES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export async function getVolumeMensal(periodo: PeriodoFiltro): Promise<VolumeMes[]> {
  let query = (supabase as any)
    .from("compras_pedidos")
    .select("data_pedido, valor_total")
    .not("data_pedido", "is", null);

  query = aplicarFiltroData(query, "data_pedido", periodo);

  const { data, error } = await query;
  if (error || !data) {
    return [];
  }

  const mapa = new Map<string, { qtd: number; valor: number }>();
  for (const p of data) {
    const d = new Date(p.data_pedido);
    if (isNaN(d.getTime())) continue;
    const ano = d.getUTCFullYear();
    const mes = d.getUTCMonth(); // 0-11
    const chave = `${ano}-${String(mes + 1).padStart(2, "0")}`;
    const atual = mapa.get(chave) || { qtd: 0, valor: 0 };
    atual.qtd++;
    atual.valor += Number(p.valor_total) || 0;
    mapa.set(chave, atual);
  }

  const resultado: VolumeMes[] = [];
  for (const [chave, v] of mapa.entries()) {
    const [ano, mes] = chave.split("-");
    const mesIdx = parseInt(mes, 10) - 1;
    resultado.push({
      mes: chave,
      mesLabel: `${MESES_PT[mesIdx]}/${ano.slice(2)}`,
      qtd: v.qtd,
      valorTotal: v.valor,
    });
  }

  // Ordena cronológico ascendente
  resultado.sort((a, b) => a.mes.localeCompare(b.mes));
  return resultado;
}

// ════════════════════════════════════════════════════════════
// AGREGADOR — busca todas as métricas de uma vez
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
    getVolumeMensal(periodo),
  ]);

  return { tempoReqPedido, valorMedio, tempoAprovacao, funil, volumeMensal };
}
