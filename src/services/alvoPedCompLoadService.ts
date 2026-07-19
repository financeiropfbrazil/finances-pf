import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Erro do Load com o status HTTP preservado — a página precisa distinguir
 * 404 (pedido não existe mais no ERP) de falha de rede/sessão.
 */
export class PedCompLoadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PedCompLoadError";
    this.status = status;
  }
}

/**
 * O pedido não existe (mais) no ERP?
 *
 * O Alvo NÃO usa 404 para isso: no Load direto ele responde **412 Precondition
 * Failed** quando o registro foi excluído (descoberto em 19/07/2026 testando a
 * exclusão do pedido 0004455 — o log mostrou 409/409/409 de sessão e então 412).
 * O erp-proxy mascara essa diferença: ele converte a resposta do Alvo em 404 por
 * regex na Message. Ou seja, quem fala pelo gateway (o cron) vê 404 e quem fala
 * direto com o Alvo (esta página) vê 412. Aceitamos os dois.
 */
export function isPedidoInexistenteNoAlvo(err: unknown): boolean {
  return err instanceof PedCompLoadError && (err.status === 404 || err.status === 412);
}

async function fetchLoadWithRetry(numero: string): Promise<any> {
  let token = (await authenticateAlvo()).token;
  if (!token) throw new PedCompLoadError("Falha na autenticação ERP", 0);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // loadParent/loadChild/loadOneToOne = All (mesmo contrato do erp-proxy):
    // sem loadOneToOne o PedCompUserFieldsObject (UserProximoAprovador,
    // UserEnviouAprovacao) pode não vir — e são campos que o badge usa.
    const url =
      `${ERP_BASE_URL}/PedComp/Load?codigoEmpresaFilial=1.01&numero=${encodeURIComponent(numero)}` +
      `&loadParent=All&loadChild=All&loadOneToOne=All`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { "riosoft-token": token },
    });

    if (resp.status === 409) {
      console.warn(`[PedCompLoad] 409 tentativa ${attempt}/${MAX_RETRIES}`);
      if (attempt === MAX_RETRIES) throw new PedCompLoadError("Conflito de sessão persistente (409)", 409);
      clearAlvoToken();
      await delay(1000 * attempt);
      const reAuth = await authenticateAlvo();
      if (!reAuth.token) throw new PedCompLoadError("Re-autenticação falhou", 0);
      token = reAuth.token;
      continue;
    }

    if (!resp.ok) throw new PedCompLoadError(`HTTP ${resp.status}`, resp.status);
    return await resp.json();
  }
}

function extrairItens(data: any): any[] {
  const list = data?.ItemPedCompChildList || [];
  return list.map((item: any) => ({
    sequencia: item.Sequencia,
    codigoProduto: item.CodigoProduto,
    nomeProduto: item.NomeProduto || item.DescricaoAlternativaProduto,
    unidade: item.CodigoProdUnidMed,
    quantidade: item.QuantidadeProdUnidMedPrincipal,
    valorUnitario: item.ValorUnitario,
    valorTotal: item.ValorTotal,
    itemServico: item.ItemServico,
    cancelado: item.Cancelado,
    classe: item.ItemPedCompClasseRecdespChildList?.[0]?.CodigoClasseRecDesp || null,
    centroCusto: item.ItemPedCompClasseRecdespChildList?.[0]?.RateioItemPedCompChildList?.[0]?.CodigoCentroCtrl || null,
    classeRateio: (item.ItemPedCompClasseRecdespChildList || []).map((c: any) => ({
      classe: c.CodigoClasseRecDesp,
      valor: c.Valor,
      percentual: c.Percentual,
      centrosCusto: (c.RateioItemPedCompChildList || []).map((r: any) => ({
        codigo: r.CodigoCentroCtrl,
        valor: r.Valor,
        percentual: r.Percentual,
      })),
    })),
  }));
}

function extrairParcelas(data: any): any[] {
  const list = data?.ParcPagPedCompChildList || [];
  return list.map((p: any) => ({
    sequencia: p.Sequencia,
    duplicata: p.NumeroDuplicata,
    diasEntreParcelas: p.DiasEntreParcelas,
    percentual: p.PercentualFracao,
    valor: p.ValorParcela,
    vencimento: p.DataVencimento?.split("T")[0] || null,
  }));
}

// Menor vencimento (YYYY-MM-DD) entre as parcelas — usado para ordenar a listagem
// por "prestes a vencer/vencidos". Cobre pedidos sem sequencia=1 (pega a parcela
// mais antiga disponível). Retorna null se não houver vencimento.
function calcularPrimeiroVencimento(parcelas: any[]): string | null {
  const vencs = (parcelas || [])
    .map((p) => p?.vencimento)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (vencs.length === 0) return null;
  return vencs.reduce((menor, atual) => (atual < menor ? atual : menor));
}

/**
 * Data de aprovação final do pedido. Fica no ITEM (ItemPedCompChildList), não no
 * cabeçalho; itens aprovados juntos compartilham a mesma data. Null se não aprovado.
 * (Mesma regra do sync-compras-status-cron.)
 */
function extrairDataAprovacao(data: any): string | null {
  const itens = (data?.ItemPedCompChildList || []) as any[];
  for (const it of itens) {
    if (it?.DataAprovacao && it?.Cancelado !== "Total") return it.DataAprovacao;
  }
  return null;
}

function extrairClasseRateio(data: any): any[] {
  let list = data?.PedCompClasseRecDespChildList || [];
  if (list.length === 0) {
    const items = data?.ItemPedCompChildList || [];
    for (const item of items) {
      const ic = item.ItemPedCompClasseRecdespChildList || [];
      list.push(...ic);
    }
  }
  return list.map((c: any) => ({
    classe: c.CodigoClasseRecDesp,
    valor: c.Valor,
    percentual: c.Percentual,
    centrosCusto: (c.RateioPedCompChildList || c.RateioItemPedCompChildList || []).map((r: any) => ({
      codigo: r.CodigoCentroCtrl,
      valor: r.Valor,
      percentual: r.Percentual,
    })),
  }));
}

function extrairAnexos(data: any): any[] {
  const list = data?.PedCompArquivoChildList || [];
  return list.map((a: any) => {
    const path = a.Arquivo || "";
    const nome = path.split("\\").pop() || path;
    return {
      sequencia: a.Sequencia,
      nomeArquivo: nome,
      caminhoOriginal: path,
      usuario: a.CodigoUsuario,
      data: a.DataArquivo?.split("T")[0] || null,
      observacao: a.Observacao,
    };
  });
}

/**
 * Soma o valorTotal dos itens NÃO cancelados.
 * Usado como fallback quando o cabeçalho do Alvo (ValorTotal) vier null/undefined.
 * Domínio real de Cancelado = {Não, Parcial, Total} — 'Sim' NÃO existe (validado
 * em 4.535 itens da auditoria). Exclui só os cancelados INTEGRALMENTE ('Total');
 * 'Parcial' tem remanescente ativo e entra na soma.
 */
function somarItensNaoCancelados(itens: any[]): number {
  return (itens || [])
    .filter((it: any) => it?.cancelado !== "Total")
    .reduce((acc: number, it: any) => acc + (Number(it?.valorTotal) || 0), 0);
}

/**
 * Resolve o valor_total do pedido a partir do retorno do Load.
 * Fonte da verdade: o ValorTotal do cabeçalho do Alvo (inclui frete/desconto).
 * Fallback: soma dos itens não cancelados — só quando o Alvo NÃO fornecer total
 * (null/undefined). Um 0 explícito do Alvo é respeitado APENAS se não houver itens
 * com valor; havendo itens com valor mas cabeçalho 0, usa a soma dos itens
 * (cobre o caso de pedido "Em Andamento" cujo cabeçalho ainda não consolidou).
 */
function resolverValorTotal(data: any, itens: any[]): number {
  const cab = data?.ValorTotal;
  const somaItens = somarItensNaoCancelados(itens);

  if (cab === null || cab === undefined) {
    return somaItens;
  }
  const cabNum = Number(cab) || 0;
  if (cabNum === 0 && somaItens > 0) {
    return somaItens;
  }
  return cabNum;
}

/**
 * Extrai o vínculo req↔ped do retorno completo do Alvo (cabeçalho + itens).
 * Regra: 'sem_vinculo' só pode ser afirmado por quem viu o detalhe completo
 * (Load com loadChild=All). Listagens leves nunca devem afirmar ausência.
 */
function extrairVinculoRequisicao(data: any): {
  numero_req_comp: string | null;
  codigo_empresa_filial_req_comp: string | null;
  req_comp_itens: string[] | null;
  vinculo_requisicao: "com_vinculo" | "sem_vinculo";
} {
  const trim = (v: any): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.length > 0 ? s : null;
  };
  const reqCab = trim(data?.NumeroReqComp);
  const filialCab = trim(data?.CodigoEmpresaFilialReqComp);
  const setItens = new Set<string>();
  for (const it of data?.ItemPedCompChildList || []) {
    const r = trim(it?.NumeroReqComp);
    if (r) setItens.add(r);
  }
  const reqsItens = Array.from(setItens);
  const temVinculo = reqCab !== null || reqsItens.length > 0;
  return {
    numero_req_comp: reqCab,
    codigo_empresa_filial_req_comp: filialCab,
    req_comp_itens: reqsItens.length > 0 ? reqsItens : null,
    vinculo_requisicao: temVinculo ? "com_vinculo" : "sem_vinculo",
  };
}

export async function baixarAnexoPedido(
  nomeArquivo: string,
  caminhoOriginal: string,
  storagePath?: string | null,
): Promise<void> {
  // 1. Tentar Supabase Storage primeiro
  if (storagePath) {
    const { data, error } = await supabase.storage.from("attachments").download(storagePath);

    if (data && !error) {
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArquivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }
  }

  // 2. Fallback: baixar do ERP
  const auth = await authenticateAlvo();
  if (!auth.token) {
    throw new Error("Anexo não disponível. Peça ao administrador para sincronizar os pedidos.");
  }

  const resp = await fetch(`${ERP_BASE_URL}/pedComp/DownloadFile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "riosoft-token": auth.token,
    },
    body: JSON.stringify({
      property: "Arquivo",
      classVincul: "PedCompArquivo",
      nameFile: nomeArquivo,
      pathFile: caminhoOriginal,
    }),
  });

  if (resp.status === 409) {
    clearAlvoToken();
    throw new Error("Conflito de sessão. Tente novamente.");
  }

  if (!resp.ok) throw new Error(`Erro HTTP ${resp.status}`);

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Resultado do open-load, para a página informar o usuário. */
export interface ResultadoLoadPedido {
  /** Campos de status que mudaram nesta carga (vazio = nada mudou). */
  mudancas: string[];
  /** Quantidade de itens trazidos do ERP. */
  totalItens: number;
  statusAnterior: string | null;
  statusNovo: string | null;
}

/**
 * OPEN-LOAD (L4) — carrega o pedido do ERP e atualiza o Hub.
 *
 * Chamada a CADA abertura do card (não só na primeira): o cron de status roda
 * de hora em hora, então quem abre o pedido precisa ver o estado de AGORA.
 *
 * O que grava:
 *  · STATUS do workflow (status, aprovado, status_aprovacao, comprado,
 *    proximo_aprovador, enviou_aprovacao) — NOVO no L4; antes esta função só
 *    trazia itens/valores, e o badge continuava defasado até o cron passar;
 *  · itens, parcelas, rateio, anexos, valores, vínculo req↔ped (como antes).
 *
 * O que NÃO faz:
 *  · NÃO marca `excluido_alvo` no 404. Um 404 isolado não é prova de exclusão
 *    (foi o erro da Correção 2 do L1, revertida): a regra exige cross-check
 *    (404 + ausência da lista de descoberta), e essa lista o cron tem, a
 *    página não. Aqui o 404 vira aviso; a marcação fica com o cron.
 *
 * ⚠️ Esta função fala com o Alvo DIRETO (não pelo erp-proxy), então a guarda
 * 502 do proxy (L3.1) não a protege — por isso a guarda anti-wipe abaixo é
 * obrigatória: sem ela, um Load 200 com corpo vazio zeraria itens e valores
 * (o mesmo wipe corrigido no cron em L1.1).
 */
export async function carregarDetalhesPedido(numero: string): Promise<ResultadoLoadPedido> {
  const data = await fetchLoadWithRetry(numero);

  // ── GUARDA ANTI-WIPE ────────────────────────────────────────────────────
  // Load 200 com payload vazio/não-objeto/sem Numero: NÃO gravar. Sem isso o
  // upsert abaixo gravaria itens=[] e valor_total=0, apagando o pedido.
  if (!data || typeof data !== "object" || !data.Numero) {
    throw new PedCompLoadError("Resposta inválida do ERP (payload sem Numero) — nada foi alterado", 502);
  }

  // Estado anterior, para reportar o que mudou (o usuário vê "status atualizado")
  const { data: antes } = await supabase
    .from("compras_pedidos")
    .select("status, aprovado, status_aprovacao, comprado, proximo_aprovador")
    .eq("codigo_empresa_filial", "1.01")
    .eq("numero", numero)
    .maybeSingle();

  const condPagObj = data?.CondPagPedCompObject;
  const nomeCondPag = condPagObj?.Nome || null;

  const itens = extrairItens(data);
  const parcelas = extrairParcelas(data);
  const vinculo = extrairVinculoRequisicao(data);
  const userFields = data?.PedCompUserFieldsObject || {};

  // ── Campos de STATUS do Alvo (NOVO no L4) ───────────────────────────────
  const statusNovo = {
    status: data?.Status ?? null,
    aprovado: data?.Aprovado ?? null,
    status_aprovacao: data?.StatusAprovacao ?? null,
    comprado: data?.Comprado ?? null,
    proximo_aprovador: userFields?.UserProximoAprovador ?? null,
    enviou_aprovacao: userFields?.UserEnviouAprovacao ?? null,
    data_notificacao_aprovador: userFields?.UserDataNotificao ?? null,
    data_digitacao_alvo: data?.DataHoraDigitacao ?? null,
    data_aprovacao_alvo: extrairDataAprovacao(data),
  };

  const update: Record<string, any> = {
    ...statusNovo,
    itens,
    parcelas,
    classe_rateio: extrairClasseRateio(data),
    anexos: extrairAnexos(data),
    nome_cond_pag: nomeCondPag,
    // ── Valores do cabeçalho (corrige listagem zerada) ──────────────────
    // O /ped-comp/list (descoberta) traz ValorTotal=0 para pedidos em
    // andamento; o Load completo traz o valor consolidado. Aqui gravamos
    // esses valores para que a LISTAGEM (que lê compras_pedidos.valor_total)
    // fique consistente com a tela de DETALHE.
    valor_total: resolverValorTotal(data, itens),
    valor_mercadoria: data?.ValorMercadoria ?? null,
    valor_servico: data?.ValorServico ?? null,
    valor_frete: data?.ValorFrete ?? null,
    valor_desconto: data?.ValorDescontoGeral ?? null,
    valor_outras_despesas: data?.ValorOutrasDespesas ?? null,
    valor_ipi: data?.GeralValorIPI ?? null,
    primeiro_vencimento: calcularPrimeiroVencimento(parcelas),
    detalhes_carregados: true,
    detalhes_carregados_em: new Date().toISOString(),
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    // ── Vínculo com requisição (cabeçalho + itens) ───────────────────────
    // O Load completo é fonte autorizada: pode afirmar tanto presença quanto
    // ausência de vínculo. 'nao_verificado' nunca é escrito aqui.
    vinculo_requisicao: vinculo.vinculo_requisicao,
    req_comp_itens: vinculo.req_comp_itens,
    vinculo_verificado_em: new Date().toISOString(),
    // Elo de cabeçalho: só grava quando presente (nunca apaga elo existente,
    // preservando o saneamento retroativo via auditoria).
    ...(vinculo.numero_req_comp
      ? {
          numero_req_comp: vinculo.numero_req_comp,
          codigo_empresa_filial_req_comp: vinculo.codigo_empresa_filial_req_comp ?? "1.01",
        }
      : {}),
  };

  // Preenche classe_rec_desp e centro_custo do primeiro rateio encontrado
  if (update.classe_rateio.length > 0) {
    const primeiro = update.classe_rateio[0];
    update.classe_rec_desp = primeiro.classe;
    if (primeiro.centrosCusto?.length > 0) {
      update.centro_custo = primeiro.centrosCusto[0].codigo;
    }
  }

  const { error } = await supabase
    .from("compras_pedidos")
    .upsert({ ...update, numero, codigo_empresa_filial: "1.01" }, { onConflict: "codigo_empresa_filial,numero" });

  if (error) throw new Error(`Erro ao salvar detalhes: ${error.message}`);

  // ── O que mudou? (para a página avisar o usuário) ───────────────────────
  const rotulos: Record<string, string> = {
    status: "situação",
    aprovado: "aprovação",
    status_aprovacao: "workflow de aprovação",
    comprado: "compra",
    proximo_aprovador: "próximo aprovador",
  };
  const mudancas: string[] = [];
  if (antes) {
    for (const campo of Object.keys(rotulos)) {
      const anterior = (antes as any)[campo] ?? null;
      const novo = (statusNovo as any)[campo] ?? null;
      if (anterior !== novo) mudancas.push(rotulos[campo]);
    }
  }

  return {
    mudancas,
    totalItens: itens.length,
    statusAnterior: (antes as any)?.status ?? null,
    statusNovo: statusNovo.status,
  };
}
