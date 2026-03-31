import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

const SERVICO_TIPOS = ["05", "06", "07", "08", "09"];

function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0] + "T00:00:00";
}

function hoje(): Date {
  return new Date();
}

// ── Fetch & Validate ──

async function fetchRequisicao(requisicaoId: string) {
  const { data, error } = await supabase
    .from("projeto_requisicoes")
    .select("*")
    .eq("id", requisicaoId)
    .single();
  if (error || !data) throw new Error("Requisição não encontrada");
  return data;
}

async function fetchCondPag(codigo: string) {
  const { data, error } = await supabase
    .from("condicoes_pagamento")
    .select("*")
    .eq("codigo", codigo)
    .single();
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
    if (!Number(item.valor_unitario)) throw new Error(`Item "${item.descricao}" com valor unitário zero ou não informado`);
  }

  const rateio = req.classe_rateio as any[];
  if (!rateio?.length) throw new Error("Rateio de classe/centro de custo não informado");
  const soma = rateio.reduce((s: number, r: any) => s + (r.percentual || 0), 0);
  if (Math.abs(soma - 100) > 0.01) throw new Error(`Rateio soma ${soma.toFixed(2)}% (deve ser 100%)`);
}

// ── Build Payload ──

function buildPayload(
  req: any,
  condPag: any,
  projetoNome: string,
) {
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
  const _isService = (item: any) =>
    SERVICO_TIPOS.includes(item.codigoTipoProdFisc);

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
        Valor: Math.round(total * r.percentual / 100 * 100) / 100,
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
            Valor: Math.round(total * r.percentual / 100 * 100) / 100,
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
    const valor = isLast
      ? valorTotal - valorParcela * (qtdParcelas - 1)
      : valorParcela;

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
    const resp = await fetch(
      `${ERP_BASE_URL}/PedComp/SavePartial?action=Insert`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "riosoft-token": token,
        },
        body: JSON.stringify(payload),
      },
    );

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
    try { data = JSON.parse(text); } catch { data = text; }

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

    validar(req);

    const condPag = await fetchCondPag(req.cond_pagamento_codigo);
    const payload = buildPayload(req, condPag, projetoNome);

    console.log("[PedComp] Enviando payload:", JSON.stringify(payload).substring(0, 500));

    const result = await postPedido(payload);

    const numeroPedido =
      result?.Numero || result?.numero || result?.NumeroPedComp || null;

    console.log("[PedComp] Atualizando requisição:", requisicaoId, "pedido:", numeroPedido);
    
    // Buscar registro completo para fazer upsert (POST, evita CORS block no PATCH)
    const { data: reqAtual, error: fetchReqErr } = await supabase
      .from("projeto_requisicoes")
      .select("*")
      .eq("id", requisicaoId)
      .single();
    
    if (fetchReqErr || !reqAtual) {
      console.error("[PedComp] Não encontrou requisição para atualizar:", fetchReqErr);
      return { 
        success: true, 
        numeroPedido,
        error: `Pedido criado no Alvo (#${numeroPedido}) mas não encontrou registro local para atualizar` 
      };
    }

    const { error: upsertError } = await supabase
      .from("projeto_requisicoes")
      .upsert({
        ...reqAtual,
        status: "enviado",
        numero_pedido_alvo: numeroPedido,
        enviado_em: new Date().toISOString(),
        erro_envio: null,
        bloqueado: true,
        enviado_alvo_em: new Date().toISOString(),
        enviado_alvo_por: "sistema",
        updated_at: new Date().toISOString(),
      });
    
    if (upsertError) {
      console.error("[PedComp] Erro ao atualizar via upsert:", upsertError);
      return { 
        success: true, 
        numeroPedido,
        error: `Pedido criado no Alvo (#${numeroPedido}) mas erro ao atualizar status local: ${upsertError.message}` 
      };
    }
    
    console.log("[PedComp] Requisição atualizada com sucesso via upsert:", requisicaoId);

    return { success: true, numeroPedido };
  } catch (err: any) {
    const msg = err.message || "Erro desconhecido";
    console.error("[PedComp] Erro ao enviar:", msg);

    // Update requisição → erro (com log)
    // Usar upsert para evitar CORS block no PATCH
    const { data: reqErr } = await supabase
      .from("projeto_requisicoes")
      .select("*")
      .eq("id", requisicaoId)
      .single();
    
    if (reqErr) {
      const { error: errUpsert } = await supabase
        .from("projeto_requisicoes")
        .upsert({
          ...reqErr,
          status: "erro",
          erro_envio: msg,
          updated_at: new Date().toISOString(),
        });
      if (errUpsert) {
        console.error("[PedComp] Falha ao salvar erro via upsert:", errUpsert);
      }
    }

    return { success: false, error: msg };
  }
}
