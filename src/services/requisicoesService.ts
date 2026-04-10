import { supabase } from "@/integrations/supabase/client";

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";
const EMPRESA_FILIAL = "1.01";
const USUARIO_LOGADO = "PEDRO.SCRIGNOLI";

export interface RateioInput {
  codigo_classe_rec_desp: string;
  classe_rec_desp_label: string;
  percentual: number;
}

export interface ItemInput {
  item_servico: boolean;
  codigo_produto: string;
  codigo_alternativo_produto: string | null;
  codigo_prod_unid_med: string;
  produto_nome: string;
  produto_unidade: string;
  quantidade: number;
  observacao: string;
  rateio: RateioInput[];
}

export interface NovaRequisicaoInput {
  user_id: string;
  requisitante_nome: string;
  codigo_funcionario: string;
  funcionario_nome: string;
  codigo_centro_ctrl: string;
  codigo_finalidade_compra: string;
  finalidade_compra_label: string;
  descricao: string;
  data_necessidade: string;
  observacao_livre: string;
  itens: ItemInput[];
}

export interface EnvioResult {
  sucesso: boolean;
  requisicao_id: string;
  numero_alvo?: string;
  erro?: string;
}

export type SyncStatusResult =
  | { mudou: false; statusAtual: string }
  | { mudou: true; statusAnterior: string; statusNovo: string; motivo: string };

// ─── Helpers ───

async function getSupabaseJWT(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sessão do Supabase inválida. Faça login novamente.");
  }
  return session.access_token;
}

async function callGatewayReqComp(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<any> {
  const jwt = await getSupabaseJWT();
  const url = `${ERP_PROXY_URL}${path}`;

  const resp = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${jwt}`,
    },
    ...(method === "POST" && body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    // resposta sem body ou inválida
  }

  if (!resp.ok) {
    const msg = data?.error || `HTTP ${resp.status}`;
    const err = new Error(msg) as Error & { status?: number; details?: any };
    err.status = resp.status;
    err.details = data?.details;
    throw err;
  }

  return data;
}

function formatarDataISO(dataYMD: string): string {
  return `${dataYMD.substring(0, 10)}T00:00:00-03:00`;
}

function formatarDataHoraBR(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function montarTexto(input: NovaRequisicaoInput): string {
  const idCurto = input.user_id.substring(0, 8);
  const header = `[Hub] Requisitante: ${input.requisitante_nome} | ${formatarDataHoraBR()} | ID: ${idCurto}`;
  return input.observacao_livre ? `${header}\n${input.observacao_livre}` : header;
}

function montarPayloadAlvo(input: NovaRequisicaoInput, texto: string): any {
  return {
    CodigoEmpresaFilial: EMPRESA_FILIAL,
    CodigoEmpresaFilialOrigem: EMPRESA_FILIAL,
    Numero: "",
    CodigoCentroCtrl: input.codigo_centro_ctrl,
    CodigoFinalidadeCompra: input.codigo_finalidade_compra,
    CodigoFuncionario: input.codigo_funcionario,
    DataNecessidade: formatarDataISO(input.data_necessidade),
    Descricao: input.descricao || "",
    Texto: texto,
    ItemReqCompChildList: input.itens.map((item, idx) => ({
      CodigoEmpresaFilial: "",
      NumeroReqComp: "",
      Sequencia: idx + 1,
      ItemServico: item.item_servico ? "Sim" : "Não",
      CodigoProduto: item.codigo_produto,
      CodigoAlternativoProduto: item.codigo_alternativo_produto || "",
      DataNecessidade: formatarDataISO(input.data_necessidade),
      CodigoCentroCtrl: input.codigo_centro_ctrl,
      Quantidade2: item.quantidade,
      QuantidadeProdUnidMedPrincipal: item.quantidade,
      Observacao: item.observacao || "",
    })),
    ReqCompClasseRecDespChildList: [],
    MensagemRetorno: null,
    TextoHistoricoNovo: null,
    TipoFormulario: "Normal",
    UploadIdentify: "",
    UsuarioLogado: USUARIO_LOGADO,
  };
}

// ─── Funções principais ───

export async function enviarRequisicao(input: NovaRequisicaoInput): Promise<EnvioResult> {
  const textoCompleto = montarTexto(input);

  const { data: reqCriada, error: errCreate } = await (supabase as any)
    .from("compras_requisicoes")
    .upsert({
      requisitante_user_id: input.user_id,
      status: "pendente_envio",
      codigo_empresa_filial: EMPRESA_FILIAL,
      codigo_funcionario: input.codigo_funcionario,
      codigo_centro_ctrl: input.codigo_centro_ctrl,
      codigo_finalidade_compra: input.codigo_finalidade_compra,
      descricao: input.descricao || null,
      data_necessidade: input.data_necessidade,
      texto: textoCompleto,
      funcionario_nome: input.funcionario_nome,
      centro_ctrl_nome: null,
      finalidade_compra_label: input.finalidade_compra_label,
      total_itens: input.itens.length,
    })
    .select("id")
    .single();

  if (errCreate || !reqCriada) {
    throw new Error(`Erro ao criar requisição: ${errCreate?.message}`);
  }

  const requisicaoId = reqCriada.id;

  for (let idx = 0; idx < input.itens.length; idx++) {
    const item = input.itens[idx];
    const { data: itemCriado, error: errItem } = await (supabase as any)
      .from("compras_requisicoes_itens")
      .upsert({
        requisicao_id: requisicaoId,
        sequencia: idx + 1,
        item_servico: item.item_servico,
        codigo_produto: item.codigo_produto,
        codigo_alternativo_produto: item.codigo_alternativo_produto,
        codigo_prod_unid_med: item.codigo_prod_unid_med,
        quantidade: item.quantidade,
        data_necessidade: input.data_necessidade,
        codigo_centro_ctrl: input.codigo_centro_ctrl,
        observacao: item.observacao || null,
        produto_nome: item.produto_nome,
        produto_unidade: item.produto_unidade,
      })
      .select("id")
      .single();

    if (errItem || !itemCriado) {
      throw new Error(`Erro ao criar item ${idx + 1}: ${errItem?.message}`);
    }

    for (const r of item.rateio) {
      await (supabase as any)
        .from("compras_requisicoes_itens_classe_rec_desp")
        .upsert({
          item_id: itemCriado.id,
          codigo_classe_rec_desp: r.codigo_classe_rec_desp,
          classe_rec_desp_label: r.classe_rec_desp_label,
          percentual: r.percentual,
        });
    }
  }

  await (supabase as any).from("compras_requisicoes_auditoria").upsert({
    requisicao_id: requisicaoId,
    evento: "criada",
    user_id: input.user_id,
    user_nome: input.requisitante_nome,
    sucesso: true,
  });

  const payload = montarPayloadAlvo(input, textoCompleto);

  await (supabase as any).from("compras_requisicoes_auditoria").upsert({
    requisicao_id: requisicaoId,
    evento: "envio_tentado",
    user_id: input.user_id,
    user_nome: input.requisitante_nome,
    payload_enviado: payload,
    sucesso: true,
  });

  try {
    const respData = await callGatewayReqComp("/req-comp/insert", "POST", payload);

    const numeroAlvo = respData?.Numero || "";

    await (supabase as any)
      .from("compras_requisicoes")
      .upsert({
        id: requisicaoId,
        requisitante_user_id: input.user_id,
        status: "sincronizada",
        numero_alvo: numeroAlvo,
        enviado_em: new Date().toISOString(),
        codigo_empresa_filial: EMPRESA_FILIAL,
        codigo_funcionario: input.codigo_funcionario,
        codigo_centro_ctrl: input.codigo_centro_ctrl,
        codigo_finalidade_compra: input.codigo_finalidade_compra,
        data_necessidade: input.data_necessidade,
        total_itens: input.itens.length,
      }, { onConflict: "id" });

    await (supabase as any).from("compras_requisicoes_auditoria").upsert({
      requisicao_id: requisicaoId,
      evento: "envio_sucesso",
      user_id: input.user_id,
      user_nome: input.requisitante_nome,
      resposta_alvo: respData,
      sucesso: true,
    });

    return { sucesso: true, requisicao_id: requisicaoId, numero_alvo: numeroAlvo };
  } catch (err: any) {
    const msgErro = err?.message || String(err);

    await (supabase as any)
      .from("compras_requisicoes")
      .upsert({
        id: requisicaoId,
        requisitante_user_id: input.user_id,
        status: "rascunho",
        erro_ultimo_envio: msgErro,
        tentativa_envio_em: new Date().toISOString(),
        codigo_empresa_filial: EMPRESA_FILIAL,
        codigo_funcionario: input.codigo_funcionario,
        codigo_centro_ctrl: input.codigo_centro_ctrl,
        codigo_finalidade_compra: input.codigo_finalidade_compra,
        data_necessidade: input.data_necessidade,
        total_itens: input.itens.length,
      }, { onConflict: "id" });

    await (supabase as any).from("compras_requisicoes_auditoria").upsert({
      requisicao_id: requisicaoId,
      evento: "envio_falha",
      user_id: input.user_id,
      user_nome: input.requisitante_nome,
      sucesso: false,
      mensagem_erro: msgErro,
    });

    return { sucesso: false, requisicao_id: requisicaoId, erro: msgErro };
  }
}

export async function reenviarRequisicao(
  requisicaoId: string,
  userId: string,
  userName: string
): Promise<EnvioResult> {
  const { data: req, error: errReq } = await (supabase as any)
    .from("compras_requisicoes")
    .select("*")
    .eq("id", requisicaoId)
    .single();

  if (errReq || !req) throw new Error(`Requisição não encontrada: ${errReq?.message}`);
  if (req.status !== "rascunho") {
    throw new Error("Só é possível reenviar requisições com status rascunho.");
  }

  const { data: itens } = await (supabase as any)
    .from("compras_requisicoes_itens")
    .select("*")
    .eq("requisicao_id", requisicaoId)
    .order("sequencia", { ascending: true });

  if (!itens || itens.length === 0) throw new Error("Requisição sem itens.");

  const dataNec = formatarDataISO(String(req.data_necessidade));

  const payload = {
    CodigoEmpresaFilial: EMPRESA_FILIAL,
    CodigoEmpresaFilialOrigem: EMPRESA_FILIAL,
    Numero: "",
    CodigoCentroCtrl: req.codigo_centro_ctrl,
    CodigoFinalidadeCompra: req.codigo_finalidade_compra,
    CodigoFuncionario: req.codigo_funcionario,
    DataNecessidade: dataNec,
    Descricao: req.descricao || "",
    Texto: req.texto || "",
    ItemReqCompChildList: itens.map((item: any, idx: number) => ({
      CodigoEmpresaFilial: "",
      NumeroReqComp: "",
      Sequencia: idx + 1,
      ItemServico: item.item_servico ? "Sim" : "Não",
      CodigoProduto: item.codigo_produto,
      CodigoAlternativoProduto: item.codigo_alternativo_produto || "",
      DataNecessidade: dataNec,
      CodigoCentroCtrl: req.codigo_centro_ctrl,
      Quantidade2: Number(item.quantidade),
      QuantidadeProdUnidMedPrincipal: Number(item.quantidade),
      Observacao: item.observacao || "",
    })),
    ReqCompClasseRecDespChildList: [],
    MensagemRetorno: null,
    TextoHistoricoNovo: null,
    TipoFormulario: "Normal",
    UploadIdentify: "",
    UsuarioLogado: USUARIO_LOGADO,
  };

  await (supabase as any).from("compras_requisicoes_auditoria").upsert({
    requisicao_id: requisicaoId,
    evento: "envio_tentado",
    user_id: userId,
    user_nome: userName,
    payload_enviado: payload,
    sucesso: true,
  });

  await (supabase as any).from("compras_requisicoes").upsert({
    id: requisicaoId,
    requisitante_user_id: req.requisitante_user_id,
    status: "pendente_envio",
    codigo_empresa_filial: req.codigo_empresa_filial,
    codigo_funcionario: req.codigo_funcionario,
    codigo_centro_ctrl: req.codigo_centro_ctrl,
    codigo_finalidade_compra: req.codigo_finalidade_compra,
    data_necessidade: req.data_necessidade,
    total_itens: req.total_itens,
    tentativa_envio_em: new Date().toISOString(),
  }, { onConflict: "id" });

  try {
    const respData = await callGatewayReqComp("/req-comp/insert", "POST", payload);

    const numeroAlvo = respData?.Numero || "";

    await (supabase as any).from("compras_requisicoes").upsert({
      id: requisicaoId,
      requisitante_user_id: req.requisitante_user_id,
      status: "sincronizada",
      numero_alvo: numeroAlvo,
      enviado_em: new Date().toISOString(),
      erro_ultimo_envio: null,
      codigo_empresa_filial: req.codigo_empresa_filial,
      codigo_funcionario: req.codigo_funcionario,
      codigo_centro_ctrl: req.codigo_centro_ctrl,
      codigo_finalidade_compra: req.codigo_finalidade_compra,
      data_necessidade: req.data_necessidade,
      total_itens: req.total_itens,
    }, { onConflict: "id" });

    await (supabase as any).from("compras_requisicoes_auditoria").upsert({
      requisicao_id: requisicaoId,
      evento: "envio_sucesso",
      user_id: userId,
      user_nome: userName,
      resposta_alvo: respData,
      sucesso: true,
    });

    return { sucesso: true, requisicao_id: requisicaoId, numero_alvo: numeroAlvo };
  } catch (err: any) {
    const msgErro = err?.message || String(err);

    await (supabase as any).from("compras_requisicoes").upsert({
      id: requisicaoId,
      requisitante_user_id: req.requisitante_user_id,
      status: "rascunho",
      erro_ultimo_envio: msgErro,
      tentativa_envio_em: new Date().toISOString(),
      codigo_empresa_filial: req.codigo_empresa_filial,
      codigo_funcionario: req.codigo_funcionario,
      codigo_centro_ctrl: req.codigo_centro_ctrl,
      codigo_finalidade_compra: req.codigo_finalidade_compra,
      data_necessidade: req.data_necessidade,
      total_itens: req.total_itens,
    }, { onConflict: "id" });

    await (supabase as any).from("compras_requisicoes_auditoria").upsert({
      requisicao_id: requisicaoId,
      evento: "envio_falha",
      user_id: userId,
      user_nome: userName,
      sucesso: false,
      mensagem_erro: msgErro,
    });

    return { sucesso: false, requisicao_id: requisicaoId, erro: msgErro };
  }
}

export async function excluirRequisicao(requisicaoId: string): Promise<void> {
  const { error } = await (supabase as any)
    .from("compras_requisicoes")
    .delete()
    .eq("id", requisicaoId);

  if (error) throw new Error(`Erro ao excluir: ${error.message}`);
}

export async function sincronizarStatusRequisicao(
  requisicaoId: string,
  userId: string,
  userName: string
): Promise<SyncStatusResult> {
  const { data: req, error: errReq } = await (supabase as any)
    .from("compras_requisicoes")
    .select("*")
    .eq("id", requisicaoId)
    .single();

  if (errReq || !req) throw new Error(`Requisição não encontrada: ${errReq?.message}`);
  if (!req.numero_alvo) {
    return { mudou: false, statusAtual: req.status };
  }

  const filial = encodeURIComponent(req.codigo_empresa_filial);
  const numero = encodeURIComponent(req.numero_alvo);
  const path = `/req-comp/${filial}/${numero}`;

  let respData: any = null;
  let notFound = false;

  try {
    respData = await callGatewayReqComp(path, "GET");
  } catch (err: any) {
    if (err?.status === 404) {
      notFound = true;
      respData = err?.details || null;
    } else {
      throw err;
    }
  }

  if (notFound) {
    if (req.status === "cancelada") {
      return { mudou: false, statusAtual: "cancelada" };
    }

    await (supabase as any).from("compras_requisicoes").upsert({
      id: requisicaoId,
      requisitante_user_id: req.requisitante_user_id,
      status: "cancelada",
      codigo_empresa_filial: req.codigo_empresa_filial,
      codigo_funcionario: req.codigo_funcionario,
      codigo_centro_ctrl: req.codigo_centro_ctrl,
      codigo_finalidade_compra: req.codigo_finalidade_compra,
      data_necessidade: req.data_necessidade,
      total_itens: req.total_itens,
    }, { onConflict: "id" });

    await (supabase as any).from("compras_requisicoes_auditoria").upsert({
      requisicao_id: requisicaoId,
      evento: "cancelada_alvo",
      user_id: userId,
      user_nome: userName,
      sucesso: true,
      mensagem_erro: "Requisição não encontrada no ERP (possivelmente deletada fisicamente).",
      resposta_alvo: respData,
    });

    return {
      mudou: true,
      statusAnterior: req.status,
      statusNovo: "cancelada",
      motivo: "Requisição deletada no ERP",
    };
  }

  const statusAlvo = String(respData?.Status || "").toLowerCase();
  const gerouPedComp = String(respData?.GerouPedComp || "").toLowerCase() === "sim";

  let novoStatusHub: string;
  let motivo: string;

  if (gerouPedComp || statusAlvo === "pedido") {
    novoStatusHub = "convertida_pedido";
    motivo = "Convertida em Pedido de Compra";
  } else if (statusAlvo === "cancelado") {
    novoStatusHub = "cancelada";
    motivo = "Cancelada no ERP";
  } else {
    novoStatusHub = "sincronizada";
    motivo = "Nenhuma mudança";
  }

  if (novoStatusHub === req.status) {
    return { mudou: false, statusAtual: req.status };
  }

  const updatePayload: any = {
    id: requisicaoId,
    requisitante_user_id: req.requisitante_user_id,
    status: novoStatusHub,
    codigo_empresa_filial: req.codigo_empresa_filial,
    codigo_funcionario: req.codigo_funcionario,
    codigo_centro_ctrl: req.codigo_centro_ctrl,
    codigo_finalidade_compra: req.codigo_finalidade_compra,
    data_necessidade: req.data_necessidade,
    total_itens: req.total_itens,
  };

  if (novoStatusHub === "convertida_pedido" && respData?.NumeroPedComp) {
    updatePayload.numero_pedido_compra_alvo = String(respData.NumeroPedComp);
  }

  await (supabase as any).from("compras_requisicoes").upsert(updatePayload, { onConflict: "id" });

  const evento = novoStatusHub === "convertida_pedido" ? "convertida_pedido" : "cancelada_alvo";

  await (supabase as any).from("compras_requisicoes_auditoria").upsert({
    requisicao_id: requisicaoId,
    evento,
    user_id: userId,
    user_nome: userName,
    sucesso: true,
    resposta_alvo: respData,
    mensagem_erro: motivo,
  });

  return {
    mudou: true,
    statusAnterior: req.status,
    statusNovo: novoStatusHub,
    motivo,
  };
}
