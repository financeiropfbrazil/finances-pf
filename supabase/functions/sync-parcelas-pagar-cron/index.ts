// =====================================================================
// Edge Function: sync-parcelas-pagar-cron   (RASTREIO · Suprimentos)  v8
// v8 (09/10/2026): B2 grava também MovEstq.DataHoraDigitacao em
//   rastreio_nf.data_hora_digitacao (coluna "Digitação" do Excel do Rastreio).
// v7 (06/10/2026): passo P — NF a partir do PEDIDO (movEstq/GetListForComponents
//   filtrando NumeroPedComp) para pedidos sem NF ligada; as NFs achadas entram
//   na fila do B2 (rastreio_nf_fila). Pega NF de fornecedor diferente do pedido
//   (ex.: Mercado Livre) e NF sem título no DocFin.
// v6 (06/10/2026): modo "sonda" — NF a partir do pedido direto no Alvo (diagnóstico, sem escrita).
// v5 (06/10/2026): B2 com 3 leituras de NF em paralelo (era o gargalo).
// v4 (06/10/2026): B1 e B2 atendem primeiro a fila de PRIORIDADE — títulos/NFs
//   de fornecedores com pedido ainda sem NF ligada (v_rastreio_b1_prioridade,
//   v_rastreio_nf_prioridade, ambas sobre mv_rastreio_compras).
// =====================================================================
// Alimenta o relatório de Rastreio de Compras com o que nenhuma outra rotina
// mantém atualizado:
//   1. PARCELAS A PAGAR do DocFin (pagamento) → public.fin_parcelas_pagar
//      inclui projeções do pedido (PC série 0) e adiantamentos (PC série A).
//   2. NF ↔ PEDIDO, lido da própria NF no Alvo → public.rastreio_nf
//      e public.rastreio_nf_pedido. (Desde 06/10/2026 o cron de despesas,
//      que trazia esse vínculo, está desligado.)
//   3. REQUISIÇÕES do Alvo (data de abertura, requisitante, CC) →
//      public.rastreio_req, via rota /req-comp/list do erp-proxy.
//
// MODOS (body.modo):
//   "lista" (padrão, cron diário 06h40):
//      A) lista as parcelas por MÊS DE VENCIMENTO: mês atual −1 … +2, mais
//         1 mês antigo com parcela de NF ainda em aberto (rodízio, mais antigo
//         primeiro). Override: body { desde, ate } 'YYYY-MM'.
//      R) requisições do mês anterior e do atual.
//      B) com o tempo que sobrar, passo NF (abaixo).
//   "nf" (cron noturno): só o passo NF, até o limite de tempo.
//   "req" (manual/backfill): só requisições, meses body { desde, ate }
//      (padrão: mês anterior e atual).
//
// PASSO NF:
//   B1) DocFin/Load dos títulos de NF (Origem=Estoque) ainda sem load →
//       grava ChaveMovEstq em fin_parcelas_pagar. A listagem não traz nem
//       filtra por ChaveMovEstq (testado no Lab em 06/10/2026).
//   B2) MovEstq/Load das NFs ainda não lidas (view v_rastreio_nf_pendentes) →
//       cabeçalho em rastreio_nf; pedidos em rastreio_nf_pedido a partir de
//       MovEstqPedCompChildList (cabeçalho, ValorItens → valor_cabecalho, com
//       IPI/frete) e NumeroPedComp dos itens (soma de ValorProduto →
//       valor_itens). rastreio_nf.status = 'recarregar' força nova leitura.
//
// ACESSO AO ALVO: via erp-proxy com X-System-Secret.
//   /alvo/passthrough — whitelist: DocFin/GetListForComponents (06/10/2026),
//                       DocFin/Load, MovEstq/Load.
//   /req-comp/list    — rota própria (a mesma do sync-compras-status-cron).
//
// SECRETS: CRON_SECRET, ERP_PROXY_URL, ERP_PROXY_SYSTEM_SECRET,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy:  verify_jwt = false (auth real = CRON_SECRET)
// =====================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const JOB_NAME = "sync-parcelas-pagar";
const JOB_TYPE = "parcelas_pagar";
const FILIAL = "1.01";

const PAGE_SIZE = 200;
const MAX_PAGINAS_MES = 40;
const UPSERT_BATCH = 500;
const WATCHDOG_MS = 110_000;
const MESES_ANTES = 1;
const MESES_DEPOIS = 2;
const MESES_ATRASADOS_MAX = 1;
const B1_FRACAO_NF = 0.55;        // no modo "nf", B1 usa até 55% do tempo; B2 o resto
const B1_MAX_LISTA = 60;          // no modo "lista", B1 no máximo 60 títulos
const B2_CONCORRENCIA = 3;        // MovEstq/Load simultâneos no passo B2
const P_FRACAO_NF = 0.25;         // no modo "nf", o passo P usa até 25% do tempo
const P_CONCORRENCIA = 3;         // buscas por pedido simultâneas

interface Resultado {
  modo: string;
  meses_planejados: string[];
  meses_completos: string[];
  meses_incompletos: string[];
  parcelas_lidas: number;
  parcelas_gravadas: number;
  marcadas_ausentes: number;
  docfin_load_ok: number;
  docfin_load_falha: number;
  nf_lidas: number;
  nf_nao_encontradas: number;
  nf_falha: number;
  vinculos_pedido: number;
  reqs_meses_ok: number;
  reqs_gravadas: number;
  p_buscados: number;
  p_nfs: number;
  p_falha: number;
  erros: number;
  parado_por_watchdog: boolean;
  detalhes: Array<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────
// Gateway erp-proxy → /alvo/passthrough  (molde do sync-laudos)
// ─────────────────────────────────────────────────────────────────────
async function callPassthrough(
  erpUrl: string,
  systemSecret: string,
  endpoint: string,
  method: "GET" | "POST",
  payload?: unknown,
): Promise<{ ok: boolean; status: number; data: any; erro?: string }> {
  let resp: Response;
  try {
    resp = await fetch(`${erpUrl}/alvo/passthrough`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-System-Secret": systemSecret },
      body: JSON.stringify({ endpoint, method, payload }),
    });
  } catch (e: any) {
    return { ok: false, status: 0, data: null, erro: `fetch ao gateway falhou: ${e?.message || String(e)}` };
  }

  let body: any = null;
  try {
    body = await resp.json();
  } catch {
    // sem corpo JSON
  }

  if (!resp.ok && (body === null || body?.ok === undefined)) {
    const motivo =
      resp.status === 401
        ? "401 — X-System-Secret inválido/ausente no gateway"
        : resp.status === 403
          ? `403 — endpoint fora da whitelist do gateway (${endpoint.split("?")[0]})`
          : `HTTP ${resp.status}`;
    return { ok: false, status: resp.status, data: body, erro: `${motivo}: ${body?.error || ""}`.trim() };
  }

  const alvoStatus = Number(body?.status ?? resp.status);
  if (body?.ok === false || !resp.ok) {
    const motivo = alvoStatus === 417 ? "417 — payload rejeitado pelo Alvo" : `Alvo HTTP ${alvoStatus}`;
    return { ok: false, status: alvoStatus, data: body?.data ?? null, erro: `${motivo}: ${body?.error || ""}`.trim() };
  }

  return { ok: true, status: alvoStatus, data: body?.data ?? null };
}

// ─────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────
// "0001-01-01T00:00:00-02:00" é o DateTime.MinValue do .NET → null.
const dia = (v: unknown): string | null => {
  if (typeof v !== "string" || v.length < 10) return null;
  const d = v.substring(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= "1900-01-01" ? d : null;
};
const momento = (v: unknown): string | null => {
  if (dia(v) === null) return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** "2026-08" → limites do filtro em UTC (meia-noite de Brasília = 03:00Z). */
function limitesMes(mes: string): { ini: string; fim: string } {
  const [a, m] = mes.split("-").map(Number);
  const ini = `${a}-${String(m).padStart(2, "0")}-01T03:00:00.000Z`;
  const prox = m === 12 ? { a: a + 1, m: 1 } : { a, m: m + 1 };
  const fim = `${prox.a}-${String(prox.m).padStart(2, "0")}-01T03:00:00.000Z`;
  return { ini, fim };
}

function somarMeses(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const total = a * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function mesAtualBrasil(): string {
  const agora = new Date(Date.now() - 3 * 3600 * 1000);
  return `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;
}

function intervaloMeses(desde: string, ate: string): string[] {
  const out: string[] = [];
  let m = desde;
  for (let i = 0; i < 60 && m <= ate; i++) {
    out.push(m);
    m = somarMeses(m, 1);
  }
  return out;
}

function extrairLista(data: any): any[] | null {
  if (Array.isArray(data)) return data;
  for (const k of ["lista", "Registros", "Items", "Data", "data", "result", "Result"]) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  return null;
}

const arr = (v: any): any[] => (Array.isArray(v) ? v : []);

function mapear(r: any, agora: string) {
  return {
    codigo_empresa_filial: txt(r.CodigoEmpresaFilial) ?? FILIAL,
    chave_docfin: num(r.ChaveDocFin ?? r.Chave),
    sequencia: num(r.Sequencia) ?? 1,
    parcial: num(r.Parcial) ?? 0,
    numero: txt(r.Numero),
    tipo: txt(r.Tipo),
    especie: txt(r.Especie),
    serie: txt(r.Serie),
    origem: txt(r.Origem),
    projecao: txt(r.Projecao),
    realizado: txt(r.Realizado),
    codigo_entidade: txt(r.CodigoEntidade),
    nome_entidade: txt(r.NomeEntidade),
    cpf_cnpj_entidade: txt(r.CpfCnpjEntidade),
    data_emissao: dia(r.DataEmissao),
    data_entrada: dia(r.DataEntrada),
    data_competencia: dia(r.DataCompetencia),
    data_vencimento: dia(r.DataVencimento),
    data_prorrogacao: dia(r.DataProrrogacao),
    data_pagamento: dia(r.DataPagamento),
    valor_original: num(r.ValorOriginal),
    valor_bruto: num(r.ValorBruto),
    valor_pago: num(r.ValorPago),
    valor_juros: num(r.ValorJuros),
    valor_multa: num(r.ValorMulta),
    valor_desconto: num(r.ValorDesconto),
    moeda: txt(r.CodigoIndEconomicoDocumento),
    cotacao: num(r.CotacaoIndice),
    codigo_situacao: txt(r.CodigoSituacao),
    nome_situacao: txt(r.CodigoNomeSituacao)?.split(" - ").slice(1).join(" - ") || txt(r.CodigoNomeSituacao),
    tipo_cobranca: txt(r.CodigoNomeTipoCobranca),
    cond_pagamento: txt(r.NomeCondPag),
    observacao_docfin: txt(r.ObservacaoDocFin),
    usuario: txt(r.UsuCod),
    numero_mov_ctrl_banc: txt(r.NumeroMovCtrlBanc),
    sincronizado_em: agora,
    ausente_no_alvo_em: null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Passo A — listagem por mês de vencimento
// ─────────────────────────────────────────────────────────────────────
async function lerMes(
  supabase: SupabaseClient,
  erpUrl: string,
  secret: string,
  mes: string,
  t0: number,
  res: Resultado,
): Promise<boolean> {
  const { ini, fim } = limitesMes(mes);
  const filtro = `DataVencimento >= #${ini}# AND DataVencimento < #${fim}# AND CodigoEmpresaFilial = '${FILIAL}'`;
  const inicioMes = new Date().toISOString();
  let lidasMes = 0;

  for (let pagina = 1; pagina <= MAX_PAGINAS_MES; pagina++) {
    if (Date.now() - t0 > WATCHDOG_MS) {
      res.parado_por_watchdog = true;
      return false;
    }

    const payload = {
      FormName: "ViewParcDocFin",
      ClassInput: "ViewParcDocFin",
      ControllerForm: "docFin",
      ClassVinculo: "docFin",
      BindingName: "",
      DisabledCache: false,
      Filter: filtro,
      Input: "ViewParcDocFinPagar",
      IsGroupBy: false,
      Order: "",
      OrderUser: "",
      PageIndex: pagina,
      PageSize: PAGE_SIZE,
      Shortcut: "dfa",
      Type: "GridTable",
      TypeObject: "tabForm",
    };

    const r = await callPassthrough(erpUrl, secret, "DocFin/GetListForComponents", "POST", payload);
    if (!r.ok) {
      res.erros++;
      res.detalhes.push({ etapa: "lista", mes, pagina, erro: r.erro });
      return false;
    }

    const lista = extrairLista(r.data);
    if (lista === null) {
      res.erros++;
      res.detalhes.push({ etapa: "lista", mes, pagina, erro: "resposta sem lista reconhecível", amostra: JSON.stringify(r.data)?.slice(0, 300) });
      return false;
    }

    const agora = new Date().toISOString();
    const porChave = new Map<string, ReturnType<typeof mapear>>();
    for (const x of lista) {
      if ((x?.Tipo ?? "PAG") !== "PAG") continue;
      const l = mapear(x, agora);
      if (l.chave_docfin === null) continue;
      porChave.set(`${l.codigo_empresa_filial}|${l.chave_docfin}|${l.sequencia}|${l.parcial}`, l);
    }
    const linhas = Array.from(porChave.values());

    for (let i = 0; i < linhas.length; i += UPSERT_BATCH) {
      const lote = linhas.slice(i, i + UPSERT_BATCH);
      const { error } = await supabase
        .from("fin_parcelas_pagar")
        .upsert(lote, { onConflict: "codigo_empresa_filial,chave_docfin,sequencia,parcial", ignoreDuplicates: false });
      if (error) {
        res.erros++;
        res.detalhes.push({ etapa: "upsert", mes, pagina, erro: error.message });
        return false;
      }
      res.parcelas_gravadas += lote.length;
    }

    lidasMes += lista.length;
    res.parcelas_lidas += lista.length;
    if (lista.length < PAGE_SIZE) break;

    if (pagina === MAX_PAGINAS_MES) {
      res.erros++;
      res.detalhes.push({ etapa: "lista", mes, erro: `mais de ${MAX_PAGINAS_MES} páginas — mês NÃO marcado como completo` });
      return false;
    }
  }

  const [a, m] = mes.split("-");
  const ultimoDia = new Date(Date.UTC(Number(a), Number(m), 0)).getUTCDate();
  const { count, error: errAus } = await supabase
    .from("fin_parcelas_pagar")
    .update({ ausente_no_alvo_em: new Date().toISOString() }, { count: "exact" })
    .gte("data_vencimento", `${mes}-01`)
    .lte("data_vencimento", `${mes}-${String(ultimoDia).padStart(2, "0")}`)
    .lt("sincronizado_em", inicioMes)
    .is("ausente_no_alvo_em", null);
  if (errAus) {
    res.erros++;
    res.detalhes.push({ etapa: "ausentes", mes, erro: errAus.message });
  } else {
    res.marcadas_ausentes += count ?? 0;
  }

  res.detalhes.push({ etapa: "mes_ok", mes, parcelas: lidasMes });
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Passo R — requisições do Alvo (rota /req-comp/list do erp-proxy)
// ─────────────────────────────────────────────────────────────────────
async function lerRequisicoes(
  supabase: SupabaseClient,
  erpUrl: string,
  secret: string,
  meses: string[],
  t0: number,
  res: Resultado,
): Promise<void> {
  for (const mes of meses) {
    if (Date.now() - t0 > WATCHDOG_MS) {
      res.parado_por_watchdog = true;
      return;
    }
    const [a, m] = mes.split("-").map(Number);
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const path = `/req-comp/list?dataInicio=${mes}-01&dataFim=${mes}-${String(ultimo).padStart(2, "0")}&apenasAbertas=false`;

    let status = 0;
    let data: any = null;
    try {
      const resp = await fetch(`${erpUrl}${path}`, {
        method: "GET",
        headers: { "X-System-Secret": secret, "Content-Type": "application/json" },
      });
      status = resp.status;
      data = await resp.json().catch(() => null);
    } catch (e: any) {
      res.erros++;
      res.detalhes.push({ etapa: "req_lista", mes, erro: `fetch falhou: ${e?.message || String(e)}` });
      continue;
    }

    const lista = extrairLista(data);
    if (status < 200 || status >= 300 || lista === null) {
      res.erros++;
      res.detalhes.push({ etapa: "req_lista", mes, erro: `HTTP ${status}: ${data?.error ?? JSON.stringify(data)?.slice(0, 200)}` });
      continue;
    }

    const agora = new Date().toISOString();
    const porNumero = new Map<string, Record<string, unknown>>();
    for (const r of lista) {
      const numero = txt(r?.Numero);
      if (!numero) continue;
      const cef = txt(r?.CodigoEmpresaFilial) ?? FILIAL;
      porNumero.set(`${cef}|${numero}`, {
        codigo_empresa_filial: cef,
        numero,
        data: dia(r?.Data),
        data_hora_digitacao: momento(r?.DataHoraDigitacao),
        status: txt(r?.Status),
        descricao: txt(r?.Descricao),
        codigo_funcionario: txt(r?.CodigoFuncionario),
        codigo_centro_ctrl: txt(r?.CodigoCentroCtrl),
        codigo_usuario: txt(r?.CodigoUsuario),
        aprovada: txt(r?.Aprovada),
        reprovada: txt(r?.Reprovada),
        gerou_ped_comp: txt(r?.GerouPedComp),
        codigo_finalidade_compra: txt(r?.CodigoFinalidadeCompra),
        carregado_em: agora,
      });
    }
    const linhas = Array.from(porNumero.values());
    for (let i = 0; i < linhas.length; i += UPSERT_BATCH) {
      const { error } = await supabase
        .from("rastreio_req")
        .upsert(linhas.slice(i, i + UPSERT_BATCH), { onConflict: "codigo_empresa_filial,numero" });
      if (error) {
        res.erros++;
        res.detalhes.push({ etapa: "req_upsert", mes, erro: error.message });
        break;
      }
      res.reqs_gravadas += Math.min(UPSERT_BATCH, linhas.length - i);
    }
    res.reqs_meses_ok++;
    res.detalhes.push({ etapa: "req_mes_ok", mes, reqs: linhas.length });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Passo B1 — DocFin/Load: ChaveMovEstq dos títulos de NF
// ─────────────────────────────────────────────────────────────────────
async function passoB1(
  supabase: SupabaseClient,
  erpUrl: string,
  secret: string,
  limiteMs: number,
  maxTitulos: number,
  t0: number,
  res: Resultado,
): Promise<void> {
  // Prioridade: títulos de fornecedores com pedido ainda sem NF ligada
  // (v_rastreio_b1_prioridade). Depois, o resto da fila.
  const { data: prio, error: errPrio } = await supabase
    .from("v_rastreio_b1_prioridade")
    .select("chave_docfin")
    .order("pedidos", { ascending: false })
    .order("ultimo_vencimento", { ascending: false })
    .limit(maxTitulos);
  if (errPrio) res.detalhes.push({ etapa: "b1_prioridade", erro: errPrio.message });

  const { data: pend, error } = await supabase
    .from("fin_parcelas_pagar")
    .select("chave_docfin")
    .eq("origem", "Estoque")
    .is("load_em", null)
    .order("data_vencimento", { ascending: false })
    .limit(Math.max(maxTitulos * 4, 200));

  if (error) {
    res.erros++;
    res.detalhes.push({ etapa: "b1_fila", erro: error.message });
    return;
  }

  const chaves = Array.from(
    new Set([...(prio ?? []), ...(pend ?? [])].map((p: any) => Number(p.chave_docfin))),
  ).slice(0, maxTitulos);
  const falhas: string[] = [];

  for (const chave of chaves) {
    if (Date.now() - t0 > limiteMs) {
      if (limiteMs >= WATCHDOG_MS) res.parado_por_watchdog = true;
      break;
    }
    const r = await callPassthrough(erpUrl, secret, `DocFin/Load?codigoEmpresaFilial=${FILIAL}&chave=${chave}`, "GET");
    const doc = r.ok ? r.data : null;

    let patch: Record<string, unknown> | null = null;
    if (doc && Number(doc?.Chave) === chave) {
      patch = {
        chave_movestq: num(doc.ChaveMovEstq),
        codigo_empresa_filial_movestq: txt(doc.CodigoEmpresaFilialMovEstq),
        load_em: new Date().toISOString(),
      };
    } else if (r.status === 404 || r.status === 412) {
      // Título excluído no Alvo: para de tentar (a listagem marcará como ausente).
      patch = { load_em: new Date().toISOString() };
    }

    if (!patch) {
      res.docfin_load_falha++;
      if (falhas.length < 20) falhas.push(`${chave}: ${r.erro ?? "Load sem Chave correspondente"}`);
      continue;
    }

    const { error: errUp } = await supabase
      .from("fin_parcelas_pagar")
      .update(patch)
      .eq("codigo_empresa_filial", FILIAL)
      .eq("chave_docfin", chave);
    if (errUp) {
      res.docfin_load_falha++;
      if (falhas.length < 20) falhas.push(`${chave}: update ${errUp.message}`);
    } else {
      res.docfin_load_ok++;
    }
  }

  if (falhas.length > 0) {
    res.erros += 1;
    res.detalhes.push({ etapa: "b1_docfin_load", erro: `${res.docfin_load_falha} falharam (voltam na próxima)`, amostra: falhas });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Passo B2 — MovEstq/Load: cabeçalho da NF e pedidos que ela atende
// ─────────────────────────────────────────────────────────────────────
async function passoB2(
  supabase: SupabaseClient,
  erpUrl: string,
  secret: string,
  t0: number,
  res: Resultado,
): Promise<void> {
  // 1º: NFs achadas pela busca por pedido (passo P; ultimo_vencimento nulo).
  const { data: doPedido, error: errPed } = await supabase
    .from("v_rastreio_nf_pendentes")
    .select("chave_movestq")
    .is("ultimo_vencimento", null)
    .limit(400);
  if (errPed) res.detalhes.push({ etapa: "b2_do_pedido", erro: errPed.message });

  // 2º: NFs de fornecedores com pedido ainda sem NF ligada.
  const { data: prio, error: errPrio } = await supabase
    .from("v_rastreio_nf_prioridade")
    .select("chave_movestq")
    .order("ultimo_vencimento", { ascending: false })
    .limit(400);
  if (errPrio) res.detalhes.push({ etapa: "b2_prioridade", erro: errPrio.message });

  const { data: pend, error } = await supabase
    .from("v_rastreio_nf_pendentes")
    .select("chave_movestq")
    .order("ultimo_vencimento", { ascending: false })
    .limit(400);

  if (error) {
    res.erros++;
    res.detalhes.push({ etapa: "b2_fila", erro: error.message });
    return;
  }

  const falhas: string[] = [];
  const fila = Array.from(
    new Set([...(doPedido ?? []), ...(prio ?? []), ...(pend ?? [])].map((p: any) => Number(p.chave_movestq))),
  ).map((chave_movestq) => ({ chave_movestq }));

  // B2_CONCORRENCIA leituras em paralelo: o MovEstq/Load (loadChild=All) é o
  // passo lento (~1,7 s) e o gargalo da fila.
  let proxima = 0;
  const processar = async (chave: number): Promise<void> => {
    const r = await callPassthrough(
      erpUrl,
      secret,
      `MovEstq/Load?codigoEmpresaFilial=${FILIAL}&chave=${chave}&loadChild=All`,
      "GET",
    );
    const mov = r.ok ? r.data : null;
    const agora = new Date().toISOString();

    if (!mov || Number(mov?.Chave) !== chave) {
      if (r.status === 404 || r.status === 412) {
        // NF excluída no Alvo: registra para não tentar de novo.
        await supabase.from("rastreio_nf").upsert(
          { codigo_empresa_filial: FILIAL, chave_movestq: chave, status: "nao_encontrada", carregado_em: agora },
          { onConflict: "codigo_empresa_filial,chave_movestq" },
        );
        res.nf_nao_encontradas++;
      } else {
        res.nf_falha++;
        if (falhas.length < 20) falhas.push(`${chave}: ${r.erro ?? "Load sem Chave correspondente"}`);
      }
      return;
    }

    // Pedidos: itens (ValorProduto) + cabeçalho (MovEstqPedCompChildList.ValorItens,
    // que inclui IPI/frete — é o valor que fecha com o total da NF).
    const itens = arr(mov.ItemMovEstqChildList);
    const porPedido = new Map<string, { valor: number; cab: number | null; qtd: number; fonte: string }>();
    for (const it of itens) {
      const ped = txt(it?.NumeroPedComp);
      if (!ped) continue;
      const atual = porPedido.get(ped) ?? { valor: 0, cab: null, qtd: 0, fonte: "item" };
      atual.valor += num(it?.ValorProduto) ?? 0;
      atual.qtd += 1;
      porPedido.set(ped, atual);
    }
    for (const c of arr(mov.MovEstqPedCompChildList)) {
      const ped = txt(c?.NumeroPedComp);
      if (!ped) continue;
      const atual = porPedido.get(ped) ?? { valor: NaN, cab: null, qtd: 0, fonte: "cabecalho" };
      const v = num(c?.ValorItens);
      if (v !== null) atual.cab = (atual.cab ?? 0) + v;
      porPedido.set(ped, atual);
    }

    const { error: errNf } = await supabase.from("rastreio_nf").upsert(
      {
        codigo_empresa_filial: FILIAL,
        chave_movestq: chave,
        numero: txt(mov.Numero),
        especie: txt(mov.Especie),
        serie: txt(mov.Serie),
        codigo_tipo_lanc: txt(mov.CodigoTipoLanc),
        controla_estoque: txt(mov.ControlaEstoque),
        operacao: txt(mov.Operacao),
        codigo_entidade: txt(mov.CodigoEntidade),
        nome_entidade: txt(mov.NomeEntidade),
        data_emissao: dia(mov.DataEmissao),
        data_entrada: dia(mov.DataEntrada),
        data_movimento: dia(mov.DataMovimento),
        data_hora_digitacao: momento(mov.DataHoraDigitacao),
        valor_documento: num(mov.ValorDocumento),
        valor_mercadoria: num(mov.ValorMercadoria),
        chave_acesso_nfe: txt(mov.ChaveAcessoNFe),
        qtd_itens: itens.length,
        qtd_pedidos: porPedido.size,
        status: "ok",
        carregado_em: agora,
      },
      { onConflict: "codigo_empresa_filial,chave_movestq" },
    );
    if (errNf) {
      res.nf_falha++;
      if (falhas.length < 20) falhas.push(`${chave}: rastreio_nf ${errNf.message}`);
      return;
    }

    // Substitui os vínculos desta NF (a NF pode ter sido corrigida no Alvo).
    const { error: errDel } = await supabase
      .from("rastreio_nf_pedido")
      .delete()
      .eq("codigo_empresa_filial", FILIAL)
      .eq("chave_movestq", chave);
    if (errDel) {
      res.nf_falha++;
      if (falhas.length < 20) falhas.push(`${chave}: limpar vínculos ${errDel.message}`);
      return;
    }
    if (porPedido.size > 0) {
      const linhas = Array.from(porPedido.entries()).map(([ped, v]) => ({
        codigo_empresa_filial: FILIAL,
        chave_movestq: chave,
        pedido_numero: ped,
        valor_itens: Number.isFinite(v.valor) ? Math.round(v.valor * 100) / 100 : null,
        valor_cabecalho: v.cab !== null ? Math.round(v.cab * 100) / 100 : null,
        qtd_itens: v.qtd,
        fonte: v.fonte,
        carregado_em: agora,
      }));
      const { error: errIns } = await supabase.from("rastreio_nf_pedido").insert(linhas);
      if (errIns) {
        res.nf_falha++;
        if (falhas.length < 20) falhas.push(`${chave}: vínculos ${errIns.message}`);
        return;
      }
      res.vinculos_pedido += linhas.length;
    }
    res.nf_lidas++;
  };

  const trabalhador = async (): Promise<void> => {
    while (proxima < fila.length) {
      if (Date.now() - t0 > WATCHDOG_MS) {
        res.parado_por_watchdog = true;
        return;
      }
      const chave = fila[proxima++].chave_movestq;
      await processar(chave);
    }
  };
  await Promise.all(Array.from({ length: B2_CONCORRENCIA }, () => trabalhador()));

  if (falhas.length > 0) {
    res.erros += 1;
    res.detalhes.push({ etapa: "b2_movestq_load", erro: `${res.nf_falha} falharam (voltam na próxima)`, amostra: falhas });
  }
}

// ─────────────────────────────────────────────────────────────────────
// NF a partir do PEDIDO — movEstq/GetListForComponents (provado em 06/10/2026:
// 0003506 → NF 20086; 0004835 → NF de outro CNPJ que o do pedido).
// ─────────────────────────────────────────────────────────────────────
const FILTROS_PEDIDO: Record<string, (p: string) => string> = {
  item: (p) => `( CodigoEmpresaFilial == '${FILIAL}' && ItemMovEstqQuery [ NumeroPedComp == '${p}' ] )`,
  cabecalho: (p) => `( CodigoEmpresaFilial == '${FILIAL}' && MovEstqPedCompQuery [ NumeroPedComp == '${p}' ] )`,
};

function payloadMovEstqLista(filtro: string) {
  return {
    FormName: "movEstq",
    ClassInput: "MovEstq",
    ControllerForm: "movEstq",
    ClassVinculo: "movEstq",
    BindingName: "",
    DisabledCache: false,
    TypeObject: "tabForm",
    Filter: filtro,
    Input: "gridTableMovEstq",
    IsGroupBy: false,
    Order: "Chave DESC",
    OrderUser: "",
    PageIndex: 1,
    PageSize: 50,
    Shortcut: "movestq",
    Type: "GridTable",
  };
}

// Passo P — pedidos sem NF ligada (v_rastreio_pedido_fila) → NFs de ENTRADA
// que citam o pedido → rastreio_nf_fila (o B2 lê e grava o vínculo com valor).
async function passoP(
  supabase: SupabaseClient,
  erpUrl: string,
  secret: string,
  limiteMs: number,
  t0: number,
  res: Resultado,
): Promise<void> {
  const { data: fila, error } = await supabase
    .from("v_rastreio_pedido_fila")
    .select("pedido_numero")
    .order("etapa_ordem", { ascending: false })
    .order("pedido_data", { ascending: false })
    .limit(300);
  if (error) {
    res.erros++;
    res.detalhes.push({ etapa: "p_fila", erro: error.message });
    return;
  }
  const pedidos = (fila ?? []).map((x: any) => String(x.pedido_numero));
  const falhas: string[] = [];
  let proxima = 0;

  const buscar = async (ped: string): Promise<void> => {
    let lista: any[] | null = null;
    let erro: string | null = null;
    for (const filtro of Object.values(FILTROS_PEDIDO)) {
      const r = await callPassthrough(erpUrl, secret, "movEstq/GetListForComponents", "POST", payloadMovEstqLista(filtro(ped)));
      if (!r.ok) {
        erro = r.erro ?? `HTTP ${r.status}`;
        break;
      }
      lista = extrairLista(r.data) ?? [];
      if (lista.length > 0) break;
    }
    if (lista === null) {
      res.p_falha++;
      if (falhas.length < 20) falhas.push(`${ped}: ${erro}`);
      return;
    }
    const chaves = Array.from(
      new Set(
        lista
          .filter((x: any) => (txt(x?.Operacao) ?? "Entrada") === "Entrada")
          .map((x: any) => num(x?.Chave))
          .filter((c): c is number => c !== null),
      ),
    );
    const agora = new Date().toISOString();
    if (chaves.length > 0) {
      const { error: errFila } = await supabase.from("rastreio_nf_fila").upsert(
        chaves.map((c) => ({ codigo_empresa_filial: FILIAL, chave_movestq: c, origem: "pedido", pedido_numero: ped, criado_em: agora })),
        { onConflict: "codigo_empresa_filial,chave_movestq", ignoreDuplicates: true },
      );
      if (errFila) {
        res.p_falha++;
        if (falhas.length < 20) falhas.push(`${ped}: fila ${errFila.message}`);
        return;
      }
    }
    const { error: errBusca } = await supabase
      .from("rastreio_pedido_busca")
      .upsert({ pedido_numero: ped, buscado_em: agora, qtd_nfs: chaves.length, chaves, erro: null }, { onConflict: "pedido_numero" });
    if (errBusca) {
      res.p_falha++;
      if (falhas.length < 20) falhas.push(`${ped}: busca ${errBusca.message}`);
      return;
    }
    res.p_buscados++;
    res.p_nfs += chaves.length;
  };

  const trabalhador = async (): Promise<void> => {
    while (proxima < pedidos.length) {
      if (Date.now() - t0 > limiteMs) return;
      await buscar(pedidos[proxima++]);
    }
  };
  await Promise.all(Array.from({ length: P_CONCORRENCIA }, () => trabalhador()));

  if (falhas.length > 0) {
    res.erros += 1;
    res.detalhes.push({ etapa: "p_busca_pedido", erro: `${res.p_falha} falharam (voltam na próxima)`, amostra: falhas });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Modo "sonda" (diagnóstico, sem escrita): NF a partir do PEDIDO, direto no
// Alvo — movEstq/GetListForComponents filtrando pelo nº do pedido. Testa
// variantes do filtro e devolve o que cada uma achou (em detalhes).
// ─────────────────────────────────────────────────────────────────────
async function sondaPedido(erpUrl: string, secret: string, pedidos: string[], res: Resultado): Promise<void> {
  for (const ped of pedidos.slice(0, 10)) {
    for (const [nome, filtro] of Object.entries(FILTROS_PEDIDO)) {
      const t = Date.now();
      const r = await callPassthrough(erpUrl, secret, "movEstq/GetListForComponents", "POST", payloadMovEstqLista(filtro(ped)));
      const lista = r.ok ? extrairLista(r.data) : null;
      res.detalhes.push({
        etapa: "sonda",
        pedido: ped,
        variante: nome,
        ok: r.ok,
        status: r.status,
        ms: Date.now() - t,
        erro: r.erro ?? (r.ok && lista === null ? `sem lista: ${JSON.stringify(r.data)?.slice(0, 200)}` : undefined),
        qtd: lista?.length ?? null,
        nfs: (lista ?? []).slice(0, 10).map((x: any) => ({
          chave: x?.Chave, numero: x?.Numero, especie: x?.Especie, tipo: x?.CodigoTipoLanc, operacao: x?.Operacao,
          entidade: x?.NomeEntidade ?? x?.CodigoEntidade,
        })),
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const t0 = Date.now();

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
      },
    });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ error: "Edge function mal configurada (CRON_SECRET)" }, 500);
  const body = await req.json().catch(() => ({}));
  if (req.headers.get("x-cron-secret") !== expected && body?.cron_secret !== expected) {
    return json({ error: "Não autorizado" }, 401);
  }
  const trigger = ["pg_cron", "manual_admin", "test"].includes(body?.triggered_by) ? body.triggered_by : "pg_cron";
  const modo = ["nf", "req", "sonda"].includes(body?.modo) ? body.modo : "lista";

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: settings } = await supabase
    .from("sync_settings")
    .select("enabled, paused_reason")
    .eq("job_name", JOB_NAME)
    .maybeSingle();
  if (settings && settings.enabled === false) {
    await supabase.from("sync_runs").insert({
      triggered_by: trigger,
      job_type: JOB_TYPE,
      total_candidatos: 0,
      total_consultados: 0,
      total_mudaram: 0,
      total_erros: 0,
      duracao_ms: Date.now() - t0,
      observacao: `[${modo}] Pausado: ${settings.paused_reason || "sem motivo"}`,
      finished_at: new Date().toISOString(),
    });
    return json({ skipped: true, reason: "sync_settings.enabled = false" });
  }

  const { data: run, error: errRun } = await supabase
    .from("sync_runs")
    .insert({ triggered_by: trigger, job_type: JOB_TYPE })
    .select("id")
    .single();
  if (errRun || !run) return json({ error: "Falha ao iniciar sync_run", details: errRun }, 500);

  const erpUrl = Deno.env.get("ERP_PROXY_URL");
  const secret = Deno.env.get("ERP_PROXY_SYSTEM_SECRET");
  if (!erpUrl || !secret) {
    await supabase
      .from("sync_runs")
      .update({ finished_at: new Date().toISOString(), duracao_ms: Date.now() - t0, total_erros: 1, observacao: "Sem ERP_PROXY_URL/ERP_PROXY_SYSTEM_SECRET" })
      .eq("id", run.id);
    return json({ error: "Edge function mal configurada (proxy)" }, 500);
  }

  const res: Resultado = {
    modo,
    meses_planejados: [],
    meses_completos: [],
    meses_incompletos: [],
    parcelas_lidas: 0,
    parcelas_gravadas: 0,
    marcadas_ausentes: 0,
    docfin_load_ok: 0,
    docfin_load_falha: 0,
    nf_lidas: 0,
    nf_nao_encontradas: 0,
    nf_falha: 0,
    vinculos_pedido: 0,
    reqs_meses_ok: 0,
    reqs_gravadas: 0,
    p_buscados: 0,
    p_nfs: 0,
    p_falha: 0,
    erros: 0,
    parado_por_watchdog: false,
    detalhes: [],
  };

  let observacao: string | null = null;
  const re = /^\d{4}-(0[1-9]|1[0-2])$/;
  try {
    if (modo === "sonda") {
      const pedidos = Array.isArray(body?.pedidos) ? body.pedidos.map((x: unknown) => String(x)) : [];
      await sondaPedido(erpUrl, secret, pedidos, res);
    } else if (modo === "req") {
      const atual = mesAtualBrasil();
      const desde = typeof body?.desde === "string" && re.test(body.desde) ? body.desde : somarMeses(atual, -1);
      const ate = typeof body?.ate === "string" && re.test(body.ate) ? body.ate : atual;
      res.meses_planejados = intervaloMeses(desde, ate);
      await lerRequisicoes(supabase, erpUrl, secret, res.meses_planejados, t0, res);
    } else if (modo === "lista") {
      let meses: string[];
      if (typeof body?.desde === "string" && re.test(body.desde)) {
        const ate = typeof body?.ate === "string" && re.test(body.ate) ? body.ate : body.desde;
        meses = intervaloMeses(body.desde, ate);
      } else {
        const atual = mesAtualBrasil();
        const iniJanela = somarMeses(atual, -MESES_ANTES);
        meses = intervaloMeses(iniJanela, somarMeses(atual, MESES_DEPOIS));
        const { data: antigos } = await supabase
          .from("fin_parcelas_pagar")
          .select("data_vencimento")
          .is("data_pagamento", null)
          .eq("projecao", "Não")
          .is("ausente_no_alvo_em", null)
          .lt("data_vencimento", `${iniJanela}-01`)
          .order("data_vencimento", { ascending: true })
          .limit(1000);
        const extra: string[] = Array.from(
          new Set<string>((antigos ?? []).map((x: any) => String(x.data_vencimento).slice(0, 7))),
        ).slice(0, MESES_ATRASADOS_MAX);
        meses = [...extra, ...meses];
      }
      res.meses_planejados = meses;

      for (const mes of meses) {
        if (Date.now() - t0 > WATCHDOG_MS) {
          res.parado_por_watchdog = true;
          res.meses_incompletos.push(mes);
          continue;
        }
        const ok = await lerMes(supabase, erpUrl, secret, mes, t0, res);
        (ok ? res.meses_completos : res.meses_incompletos).push(mes);
      }
      if (!res.parado_por_watchdog) {
        const atual = mesAtualBrasil();
        await lerRequisicoes(supabase, erpUrl, secret, [somarMeses(atual, -1), atual], t0, res);
      }
      if (!res.parado_por_watchdog) {
        await passoB1(supabase, erpUrl, secret, WATCHDOG_MS, B1_MAX_LISTA, t0, res);
        if (!res.parado_por_watchdog) await passoB2(supabase, erpUrl, secret, t0, res);
      }
    } else {
      await passoP(supabase, erpUrl, secret, Math.round(WATCHDOG_MS * P_FRACAO_NF), t0, res);
      await passoB1(supabase, erpUrl, secret, Math.round(WATCHDOG_MS * B1_FRACAO_NF), 1000, t0, res);
      await passoB2(supabase, erpUrl, secret, t0, res);
    }
  } catch (e: any) {
    res.erros++;
    observacao = `Exception: ${e?.message || String(e)}`;
    res.detalhes.push({ etapa: "exception", erro: observacao });
  }

  const [{ count: fingerprint }, { count: pendB1 }, { count: pendB2 }, { count: pendP }] = await Promise.all([
    supabase.from("compras_pedidos").select("id", { count: "exact", head: true }),
    supabase.from("fin_parcelas_pagar").select("chave_docfin", { count: "exact", head: true }).eq("origem", "Estoque").is("load_em", null),
    supabase.from("v_rastreio_nf_pendentes").select("chave_movestq", { count: "exact", head: true }),
    supabase.from("v_rastreio_pedido_fila").select("pedido_numero", { count: "exact", head: true }),
  ]);

  observacao =
    observacao ??
    [
      `[${modo}]`,
      modo === "lista" ? `meses ok ${res.meses_completos.length}/${res.meses_planejados.length}` : null,
      res.meses_incompletos.length ? `incompletos: ${res.meses_incompletos.join(",")}` : null,
      modo === "lista" ? `parcelas ${res.parcelas_lidas}` : null,
      res.marcadas_ausentes ? `ausentes +${res.marcadas_ausentes}` : null,
      modo === "lista" || modo === "req" ? `reqs ${res.reqs_gravadas} (${res.reqs_meses_ok} meses)` : null,
      modo === "nf" ? `pedidos ${res.p_buscados} buscados/${res.p_falha} falha → ${res.p_nfs} NFs (faltam ${pendP ?? "?"})` : null,
      modo !== "req" ? `títulos ${res.docfin_load_ok} ok/${res.docfin_load_falha} falha (faltam ${pendB1 ?? "?"})` : null,
      modo !== "req" ? `NFs ${res.nf_lidas} ok/${res.nf_falha} falha/${res.nf_nao_encontradas} excluídas (faltam ${pendB2 ?? "?"})` : null,
      modo !== "req" ? `vínculos +${res.vinculos_pedido}` : null,
      res.parado_por_watchdog ? "PARADO PELO WATCHDOG" : null,
      `fingerprint pedidos=${fingerprint ?? "?"}`,
    ]
      .filter(Boolean)
      .join(" · ");

  await supabase
    .from("sync_runs")
    .update({
      finished_at: new Date().toISOString(),
      duracao_ms: Date.now() - t0,
      total_candidatos: res.meses_planejados.length,
      total_consultados: res.parcelas_lidas + res.docfin_load_ok + res.nf_lidas,
      total_mudaram: res.parcelas_gravadas + res.vinculos_pedido + res.reqs_gravadas,
      total_erros: res.erros,
      detalhes: res.detalhes,
      observacao,
    })
    .eq("id", run.id);

  return json({ ok: res.erros === 0, run_id: run.id, ...res, detalhes: undefined, observacao });
});
