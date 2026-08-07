import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";
import { marcarEnviado, descricaoErro, falhou } from "./projetosService";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SERVICO_TIPOS = ["05", "06", "07", "08", "09"];

function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0] + "T00:00:00";
}

function hoje(): Date {
  return new Date();
}

// ── Fetch & Validate ──

async function fetchRequisicao(requisicaoId: string) {
  const { data, error } = await supabase.from("projeto_requisicoes").select("*").eq("id", requisicaoId).single();
  if (error || !data) throw new Error("Requisição não encontrada");
  return data;
}

// ── P7: Gate de segurança — só permite POST ao Alvo se projeto está aprovado ──
async function fetchProjetoFase(projetoId: string): Promise<{ fase_atual: string; status: string }> {
  const { data, error } = await supabase.from("projetos").select("fase_atual, status").eq("id", projetoId).single();
  if (error || !data) throw new Error("Projeto não encontrado");
  return data as { fase_atual: string; status: string };
}

async function fetchCondPag(codigo: string) {
  const { data, error } = await supabase.from("condicoes_pagamento").select("*").eq("codigo", codigo).single();
  if (error || !data) throw new Error(`Condição de pagamento "${codigo}" não encontrada`);
  return data;
}

function validar(req: any) {
  if (!req.fornecedor_codigo) throw new Error("Fornecedor não informado");
  if (!req.cond_pagamento_codigo) throw new Error("Condição de pagamento não informada");

  const itens = req.itens as any[];
  if (!itens?.length) throw new Error("Requisição sem itens");
  for (const item of itens) {
    if (!item.codigoProduto) throw new Error(`Item "${item.descricao}" sem código de produto`);
    if (!Number(item.valor_unitario))
      throw new Error(`Item "${item.descricao}" com valor unitário zero ou não informado`);
  }

  const rateio = req.classe_rateio as any[];
  if (!rateio?.length) throw new Error("Rateio de classe/centro de custo não informado");
  const soma = rateio.reduce((s: number, r: any) => s + (r.percentual || 0), 0);
  if (Math.abs(soma - 100) > 0.01) throw new Error(`Rateio soma ${soma.toFixed(2)}% (deve ser 100%)`);
}

// ── P7: Validações específicas do pedido vs projeto ──
function validarPedidoVsProjeto(req: any, projetoFase: { fase_atual: string; status: string }) {
  // Pedido precisa estar na fase Actual
  if (req.fase !== "actual") {
    throw new Error(`Apenas pedidos da fase Actual podem ser enviados ao ERP. Este pedido está em "${req.fase}".`);
  }

  // Projeto precisa estar com Budget aprovado (fase_atual=actual + status=aprovado)
  if (projetoFase.fase_atual !== "actual") {
    throw new Error(
      `O Budget deste projeto ainda não foi aprovado (fase atual: "${projetoFase.fase_atual}"). Aprove o Budget antes de enviar pedidos ao ERP.`,
    );
  }
  if (projetoFase.status !== "aprovado") {
    throw new Error(
      `O projeto ainda não está aprovado (status: "${projetoFase.status}"). Não é possível enviar pedidos ao ERP.`,
    );
  }
}

// ── Build Payload ──

function buildPayload(req: any, condPag: any, projetoNome: string) {
  const now = hoje();
  const nowStr = fmtDate(now);
  const itens = req.itens as any[];
  const rateio = req.classe_rateio as any[];
  const valorTotal = Number(req.valor_total) || 0;
  const codigoUsuario = localStorage.getItem("alvo_username") || "PEDRO.SCRIGNOLI";

  const texto = `Projeto: ${projetoNome} | Req #${req.sequencia} - ${req.descricao}`;

  // Calculate service vs product totals separately
  let valorMercadoria = 0;
  let valorServicoTotal = 0;
  itens.forEach((item: any) => {
    const total = (Number(item.quantidade) || 1) * (Number(item.valor_unitario) || 0);
    if (SERVICO_TIPOS.includes(item.codigoTipoProdFisc)) {
      valorServicoTotal += total;
    } else {
      valorMercadoria += total;
    }
  });

  // DataCompetencia = first day of current month
  const dataCompetencia = nowStr.substring(0, 8) + "01T00:00:00";

  // Detect if any item is service
  const _isService = (item: any) => SERVICO_TIPOS.includes(item.codigoTipoProdFisc);

  // ── Items ──
  const itemChildList = itens.map((item: any) => {
    const qty = Number(item.quantidade) || 1;
    const unit = Number(item.valor_unitario) || 0;
    const total = qty * unit;
    const servico = _isService(item);

    return {
      CodigoEmpresaFilial: "",
      NumeroPedComp: "",
      CodigoProduto: item.codigoProduto,
      Sequencia: 0,
      ItemServico: servico ? "Sim" : "Não",
      CodigoProdUnidMed: item.unidade || "UNID",
      PosicaoProdUnidMed: 1,
      CodigoProdUnidMedValor: item.unidade || "UNID",
      PosicaoProdUnidMedValor: 1,
      QuantidadeProdUnidMedPrincipal: qty,
      Quantidade2: qty,
      SaldoQuantidade: qty,
      ValorUnitario: unit,
      ValorUnitarioCalculado: unit,
      ValorTotal: total,
      ValorFinal: total,
      CodigoClasFiscal: item.codigoClasFiscal || "0000002",
      CodigoTributA: "0",
      Cancelado: "Não",
      ImpostoZerado: "Sim",
      IndicadorNomeProduto: "Principal",
      ...(servico ? {} : { CodigoSitTributaria: "000", CodigoTributB: "00" }),
      ItemPedCompClasseRecdespChildList: rateio.map((r: any) => ({
        CodigoEmpresaFilial: "",
        NumeroPedComp: "",
        CodigoProduto: item.codigoProduto,
        SequenciaItemPedComp: 0,
        CodigoClasseRecDesp: r.classe_codigo,
        Valor: Math.round(((total * r.percentual) / 100) * 100) / 100,
        Percentual: r.percentual,
        ExcluiCentroControleValorZero: "Sim",
        RateioItemPedCompChildList: [
          {
            CodigoEmpresaFilial: "",
            NumeroPedComp: "",
            CodigoProduto: item.codigoProduto,
            SequenciaItemPedComp: 0,
            CodigoClasseRecDesp: r.classe_codigo,
            CodigoCentroCtrl: r.centro_custo_codigo,
            Valor: Math.round(((total * r.percentual) / 100) * 100) / 100,
            Percentual: r.percentual,
          },
        ],
      })),
    };
  });

  // ── Parcelas ──
  const qtdParcelas = condPag.quantidade_parcelas || 1;
  const diasEntre = condPag.dias_entre_parcelas || 0;
  const primeiroApos = condPag.primeiro_vencimento_apos || 0;
  const valorParcela = Math.floor((valorTotal / qtdParcelas) * 100) / 100;

  const parcelas = [];
  for (let i = 0; i < qtdParcelas; i++) {
    const diasOffset = primeiroApos + diasEntre * i;
    const venc = new Date(now);
    venc.setDate(venc.getDate() + diasOffset);

    const isLast = i === qtdParcelas - 1;
    const valor = isLast ? valorTotal - valorParcela * (qtdParcelas - 1) : valorParcela;

    parcelas.push({
      CodigoEmpresaFilial: "",
      NumeroPedComp: "",
      Sequencia: i + 1,
      NumeroDuplicata: qtdParcelas === 1 ? "1" : `${i + 1}/${qtdParcelas}`,
      DiasEntreParcelas: i === 0 ? primeiroApos : diasEntre,
      PercentualFracao: Number(((valor / valorTotal) * 100).toFixed(4)),
      ValorParcela: Number(valor.toFixed(2)),
      DataVencimento: fmtDate(venc),
    });
  }

  // ── Classe header-level ──
  const classeHeader = rateio.map((r: any) => ({
    CodigoEmpresaFilial: "-1",
    NumeroPedComp: "-1",
    CodigoClasseRecDesp: r.classe_codigo,
    Valor: Number((valorTotal * (r.percentual / 100)).toFixed(2)),
    Percentual: r.percentual,
    ExcluiCentroControleValorZero: "Sim",
    RateioPedCompChildList: [
      {
        CodigoEmpresaFilial: "-1",
        NumeroPedComp: "-1",
        CodigoClasseRecDesp: r.classe_codigo,
        CodigoCentroCtrl: r.centro_custo_codigo,
        Valor: Number((valorTotal * (r.percentual / 100)).toFixed(2)),
        Percentual: r.percentual,
      },
    ],
  }));

  return {
    CodigoEmpresaFilial: "1.01",
    Numero: "",
    Aprovado: "Não",
    Status: "Aberto",
    Comprado: "Não",
    DataPedido: nowStr,
    DataCadastro: nowStr,
    DataValidade: nowStr,
    DataBaseVencimento: nowStr,
    DataBaseVencimentoParcela: "Data do Pedido",
    DataCompetencia: dataCompetencia,
    CodigoEntidade: req.fornecedor_codigo,
    CodigoComprador: "0000013",
    CodigoUsuario: codigoUsuario,
    UsuarioLogado: codigoUsuario,
    Texto: texto,
    Origem: "Pedido",
    ValorCambio: 1,
    ValorTotal: valorTotal,
    ValorMercadoria: valorMercadoria,
    ValorServico: valorServicoTotal,
    CasasDecimaisValorUnitario: 5,
    ValidaSalvarPedido: true,
    Chamou: "beforeSaveChild",
    IntegradoFinanceiro: "Não",
    CodigoTipoPagRec: "0000016",
    CodigoIndEconomico: "0000001",
    CodigoEntidadeTransportadora: req.fornecedor_codigo,
    DataEntrega: nowStr,
    ExecutaOnAfterSave: false,
    ImpostoZerado: "Não",
    CondPagPedCompObject: {
      CodigoEmpresaFilial: "",
      Numero: "",
      CodigoCondPag: req.cond_pagamento_codigo,
      Nome: req.cond_pagamento_nome || "",
    },
    ItemPedCompChildList: itemChildList,
    ParcPagPedCompChildList: parcelas,
    PedCompClasseRecDespChildList: classeHeader,
    PedCompUserFieldsObject: {
      UserEnviarAprovacao: "Sim",
      UserEnviouAprovacao: "Sim",
    },
    UploadIdentify: "",
  };
}

// ── POST with retry ──

async function postPedido(payload: any): Promise<any> {
  clearAlvoToken();
  let token = (await authenticateAlvo()).token;
  if (!token) throw new Error("Falha na autenticação ERP");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch(`${ERP_BASE_URL}/PedComp/SavePartial?action=Insert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "riosoft-token": token,
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 409) {
      console.warn(`[PedComp/Insert] 409 tentativa ${attempt}/${MAX_RETRIES}`);
      if (attempt === MAX_RETRIES) throw new Error("Conflito de sessão persistente (409)");
      clearAlvoToken();
      await delay(1000 * attempt);
      const reAuth = await authenticateAlvo();
      if (!reAuth.token) throw new Error("Re-autenticação falhou");
      token = reAuth.token;
      continue;
    }

    const text = await resp.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!resp.ok) {
      const detail = typeof data === "string" ? data : JSON.stringify(data).substring(0, 500);
      throw new Error(`HTTP ${resp.status}: ${detail}`);
    }

    return data;
  }
}

// ── Public API ──

export async function enviarRequisicaoAlvo(
  requisicaoId: string,
  projetoNome: string,
): Promise<{ success: boolean; numeroPedido?: string; error?: string }> {
  try {
    const req = await fetchRequisicao(requisicaoId);

    // Guard: prevent duplicate submission
    if (req.status === "enviado" && req.numero_pedido_alvo) {
      return {
        success: false,
        error: `Este pedido já foi enviado ao Alvo (Pedido #${req.numero_pedido_alvo})`,
      };
    }

    // ── P7: Gate de fase ──
    // Defesa em profundidade: mesmo que o frontend escape, aqui não passa.
    // Valida em paralelo: pedido está em fase=actual E projeto está aprovado.
    const projetoFase = await fetchProjetoFase(req.projeto_id);
    validarPedidoVsProjeto(req, projetoFase);

    validar(req);

    const condPag = await fetchCondPag(req.cond_pagamento_codigo);
    const payload = buildPayload(req, condPag, projetoNome);

    console.log("[PedComp] Enviando payload:", JSON.stringify(payload).substring(0, 500));

    const result = await postPedido(payload);

    const numeroPedido = result?.Numero || result?.numero || result?.NumeroPedComp || null;

    console.log("[PedComp] Atualizando requisição:", requisicaoId, "pedido:", numeroPedido);

    // A-2: o pós-envio passa por RPC SECURITY DEFINER. O .upsert() anterior era
    // barrado pela RLS para não-admin — o pedido entrava no ERP e o Hub não
    // registrava nada, devolvendo success:true. A RPC também grava o usuário real
    // em enviado_alvo_por (D-8), no lugar do literal "sistema".
    const marcado = await marcarEnviado(requisicaoId, numeroPedido, true);

    if (falhou(marcado)) {
      console.error("[PedComp] Pedido criado no Alvo mas o Hub não registrou:", marcado);
      return {
        success: true,
        numeroPedido,
        error: `Pedido criado no Alvo (#${numeroPedido}) mas o Hub não registrou o status: ${descricaoErro(marcado)}`,
      };
    }

    console.log("[PedComp] Requisição atualizada via RPC:", requisicaoId);

    return { success: true, numeroPedido };
  } catch (err: any) {
    const msg = err.message || "Erro desconhecido";
    console.error("[PedComp] Erro ao enviar:", msg);

    // A-2: registra o erro via RPC. O .upsert() anterior falhava pela mesma RLS
    // que barrava o caminho de sucesso — ou seja, nem o status 'erro' era gravado.
    const marcado = await marcarEnviado(requisicaoId, null, false, msg);
    if (falhou(marcado)) {
      console.error("[PedComp] Falha ao registrar o erro de envio no Hub:", marcado);
    }

    return { success: false, error: msg };
  }
}
