import { supabase } from "@/integrations/supabase/client";
import { authenticateAlvo } from "./alvoService";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
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
  data_necessidade: string; // "YYYY-MM-DD"
  observacao_livre: string;
  itens: ItemInput[];
}

export interface EnvioResult {
  sucesso: boolean;
  requisicao_id: string;
  numero_alvo?: string;
  erro?: string;
}

function formatarDataISO(dataYMD: string): string {
  return `${dataYMD}T00:00:00-03:00`;
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

export async function enviarRequisicao(input: NovaRequisicaoInput): Promise<EnvioResult> {
  const textoCompleto = montarTexto(input);

  // 1. Criar header no Supabase com status pendente_envio
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

  // 2. Inserir itens e seus rateios
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

    // Rateio do item
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

  // 3. Auditoria: criada
  await (supabase as any).from("compras_requisicoes_auditoria").upsert({
    requisicao_id: requisicaoId,
    evento: "criada",
    user_id: input.user_id,
    user_nome: input.requisitante_nome,
    sucesso: true,
  });

  // 4. Montar payload e enviar ao Alvo
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
    const auth = await authenticateAlvo();
    if (!auth.success || !auth.token) {
      throw new Error(`Autenticação ERP falhou: ${auth.error}`);
    }

    const resp = await fetch(`${ERP_BASE_URL}/ReqComp/SavePartial?action=Insert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Riosoft-Token": auth.token,
      },
      body: JSON.stringify(payload),
    });

    const respData = await resp.json();

    if (!resp.ok || respData?.ClassName) {
      const msgErro = respData?.Message || `HTTP ${resp.status}`;
      throw new Error(msgErro);
    }

    const numeroAlvo = respData?.Numero || "";

    // Sucesso: atualizar requisição
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
