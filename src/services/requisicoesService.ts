import { supabase } from "@/integrations/supabase/client";

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";
const EMPRESA_FILIAL = "1.01";
const USUARIO_LOGADO = "PEDRO.SCRIGNOLI";
const STORAGE_BUCKET = "compras-requisicoes";

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

export interface ArquivoInput {
  file: File;
  upload_identify_guid: string; // gerado no frontend via crypto.randomUUID()
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
  cnpj_sugestao_requisicao?: string; // apenas 14 dígitos, sem máscara
  data_necessidade: string;
  observacao_livre: string;
  itens: ItemInput[];
  arquivos?: ArquivoInput[];
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

export interface ArquivoRequisicao {
  id: string;
  requisicao_id: string;
  upload_identify_guid: string;
  nome_original: string;
  storage_path: string;
  mime_type: string;
  tamanho_bytes: number;
  numero_alvo_ao_enviar: string | null;
  uploaded_by_user_id: string | null;
  created_at: string;
}

// ─── Helpers ───

async function getSupabaseJWT(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sessão do Supabase inválida. Faça login novamente.");
  }
  return session.access_token;
}

async function callGatewayReqComp(path: string, method: "GET" | "POST", body?: unknown): Promise<any> {
  const jwt = await getSupabaseJWT();
  const url = `${ERP_PROXY_URL}${path}`;

  const resp = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
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

async function callGatewayReqCompMultipart(path: string, formData: FormData): Promise<any> {
  const jwt = await getSupabaseJWT();
  const url = `${ERP_PROXY_URL}${path}`;

  // NÃO setar Content-Type — o browser seta automaticamente o boundary do multipart
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
    body: formData,
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

/**
 * Helper genérico para montar o payload ReqComp do Alvo.
 * Usado tanto por enviarRequisicao (formato NovaRequisicaoInput)
 * quanto por reenviarRequisicao (formato já persistido no Supabase).
 */
interface PayloadReqCompParams {
  codigo_centro_ctrl: string;
  codigo_finalidade_compra: string;
  codigo_funcionario: string;
  data_necessidade_ymd: string;
  descricao: string;
  texto: string;
  itens: Array<{
    item_servico: boolean;
    codigo_produto: string;
    codigo_alternativo_produto: string | null;
    codigo_prod_unid_med: string;
    quantidade: number;
    observacao: string;
  }>;
  arquivos_guids?: string[]; // GUIDs dos arquivos (só para modo multipart)
}

function montarPayloadReqComp(params: PayloadReqCompParams): any {
  const dataNec = formatarDataISO(params.data_necessidade_ymd);

  const payload: any = {
    CodigoEmpresaFilial: EMPRESA_FILIAL,
    CodigoEmpresaFilialOrigem: EMPRESA_FILIAL,
    CodigoUsuario: USUARIO_LOGADO,
    Numero: "",
    CodigoCentroCtrl: params.codigo_centro_ctrl,
    CodigoFinalidadeCompra: params.codigo_finalidade_compra,
    CodigoFuncionario: params.codigo_funcionario,
    DataNecessidade: dataNec,
    Descricao: params.descricao || "",
    Texto: params.texto,
    ItemReqCompChildList: params.itens.map((item, idx) => ({
      CodigoEmpresaFilial: "",
      NumeroReqComp: "",
      Sequencia: idx + 1,
      ItemServico: item.item_servico ? "Sim" : "Não",
      CodigoProduto: item.codigo_produto,
      CodigoAlternativoProduto: item.codigo_alternativo_produto || "",
      DataNecessidade: dataNec,
      CodigoCentroCtrl: params.codigo_centro_ctrl,
      Quantidade2: Number(item.quantidade),
      QuantidadeProdUnidMedPrincipal: Number(item.quantidade),
      CodigoProdUnidMed: item.codigo_prod_unid_med,
      Observacao: item.observacao || "",
    })),
    ReqCompClasseRecDespChildList: [],
    MensagemRetorno: null,
    TextoHistoricoNovo: null,
    TipoFormulario: "Normal",
    UploadIdentify: "",
    UsuarioLogado: USUARIO_LOGADO,
  };

  // Se houver arquivos, adiciona ReqCompDocChildList e filesToUpload
  if (params.arquivos_guids && params.arquivos_guids.length > 0) {
    payload.ReqCompDocChildList = params.arquivos_guids.map((guid, idx) => ({
      CodigoEmpresaFilial: "-1",
      NumeroReqComp: "-1",
      Sequencia: idx,
      UploadIdentify: guid,
    }));
    payload.filesToUpload = params.arquivos_guids.map((guid) => ({
      key: `${guid}#Arquivo`,
      file: {},
    }));
  }

  return payload;
}

/**
 * Faz upload de um arquivo para o Storage e grava a linha em compras_requisicoes_arquivos.
 * Usado durante a criação de requisição com anexos.
 */
async function salvarArquivoNoStorage(
  requisicaoId: string,
  arquivo: ArquivoInput,
  userId: string,
): Promise<ArquivoRequisicao> {
  const extensao = arquivo.file.name.split(".").pop()?.toLowerCase() || "bin";
  const storagePath = `${requisicaoId}/${arquivo.upload_identify_guid}.${extensao}`;

  const { error: uploadErr } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, arquivo.file, {
    contentType: arquivo.file.type,
    upsert: false,
  });

  if (uploadErr) {
    throw new Error(`Erro ao fazer upload do arquivo "${arquivo.file.name}": ${uploadErr.message}`);
  }

  const { data, error: insertErr } = await (supabase as any)
    .from("compras_requisicoes_arquivos")
    .insert({
      requisicao_id: requisicaoId,
      upload_identify_guid: arquivo.upload_identify_guid,
      nome_original: arquivo.file.name,
      storage_path: storagePath,
      mime_type: arquivo.file.type,
      tamanho_bytes: arquivo.file.size,
      uploaded_by_user_id: userId,
    })
    .select("*")
    .single();

  if (insertErr || !data) {
    // Tentar limpar o arquivo do Storage se o insert falhar
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    throw new Error(`Erro ao gravar metadados do arquivo: ${insertErr?.message}`);
  }

  return data as ArquivoRequisicao;
}

/**
 * Monta o FormData para enviar ao gateway /req-comp/insert-multipart.
 * Recebe os blobs (já baixados do Storage ou direto do estado local) + o payload JSON.
 */
function montarFormDataMultipart(payload: any, arquivos: Array<{ guid: string; blob: Blob; nome: string }>): FormData {
  const formData = new FormData();
  formData.append("obj", JSON.stringify(payload));
  for (const arq of arquivos) {
    formData.append(`${arq.guid}#Arquivo`, arq.blob, arq.nome);
  }
  return formData;
}

// ─── Funções principais ───

/**
 * Envia requisição SEM arquivos (rota JSON puro /req-comp/insert).
 * Mantida para compatibilidade e para o caminho rápido sem anexos.
 */
export async function enviarRequisicao(input: NovaRequisicaoInput): Promise<EnvioResult> {
  const textoCompleto = montarTexto(input);
  let requisicaoId: string | null = null;

  try {
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
        cnpj_sugestao_requisicao: input.cnpj_sugestao_requisicao || null,
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

    requisicaoId = reqCriada.id;

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
        await (supabase as any).from("compras_requisicoes_itens_classe_rec_desp").upsert({
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

    const payload = montarPayloadReqComp({
      codigo_centro_ctrl: input.codigo_centro_ctrl,
      codigo_finalidade_compra: input.codigo_finalidade_compra,
      codigo_funcionario: input.codigo_funcionario,
      data_necessidade_ymd: input.data_necessidade,
      descricao: input.descricao,
      texto: textoCompleto,
      itens: input.itens,
    });

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

      await (supabase as any).from("compras_requisicoes").upsert(
        {
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
        },
        { onConflict: "id" },
      );

      await (supabase as any).from("compras_requisicoes_auditoria").upsert({
        requisicao_id: requisicaoId,
        evento: "envio_sucesso",
        user_id: input.user_id,
        user_nome: input.requisitante_nome,
        resposta_alvo: respData,
        sucesso: true,
      });

      return { sucesso: true, requisicao_id: requisicaoId, numero_alvo: numeroAlvo };
    } catch (errEnvio: any) {
      const msgErro = errEnvio?.message || String(errEnvio);

      await (supabase as any).from("compras_requisicoes").upsert(
        {
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
        },
        { onConflict: "id" },
      );

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
  } catch (errCriacao: any) {
    // Captura erros que ocorrem ANTES do envio ao Alvo (criação de itens, rateios, etc).
    // Se requisicaoId já foi criado, marca como rascunho para não ficar órfã.
    const msgErro = errCriacao?.message || String(errCriacao);

    if (requisicaoId) {
      await (supabase as any).from("compras_requisicoes").upsert(
        {
          id: requisicaoId,
          requisitante_user_id: input.user_id,
          status: "rascunho",
          erro_ultimo_envio: `Erro durante criação: ${msgErro}`,
          tentativa_envio_em: new Date().toISOString(),
          codigo_empresa_filial: EMPRESA_FILIAL,
          codigo_funcionario: input.codigo_funcionario,
          codigo_centro_ctrl: input.codigo_centro_ctrl,
          codigo_finalidade_compra: input.codigo_finalidade_compra,
          data_necessidade: input.data_necessidade,
          total_itens: input.itens.length,
        },
        { onConflict: "id" },
      );

      await (supabase as any).from("compras_requisicoes_auditoria").upsert({
        requisicao_id: requisicaoId,
        evento: "envio_falha",
        user_id: input.user_id,
        user_nome: input.requisitante_nome,
        sucesso: false,
        mensagem_erro: `Erro durante criação: ${msgErro}`,
      });

      return { sucesso: false, requisicao_id: requisicaoId, erro: msgErro };
    }

    // Se nem conseguiu criar a linha no banco, propaga o erro
    throw errCriacao;
  }
}

/**
 * Envia requisição COM arquivos (rota multipart /req-comp/insert-multipart).
 * Os arquivos são primeiro salvos no Supabase Storage + tabela de metadados,
 * depois enviados ao Alvo junto com o payload JSON.
 */
export async function enviarRequisicaoComArquivos(input: NovaRequisicaoInput): Promise<EnvioResult> {
  if (!input.arquivos || input.arquivos.length === 0) {
    // Sem arquivos → redireciona para a função padrão
    return enviarRequisicao(input);
  }

  if (input.arquivos.length > 3) {
    throw new Error("Máximo de 3 arquivos por requisição.");
  }

  const textoCompleto = montarTexto(input);
  let requisicaoId: string | null = null;

  try {
    // 1. Criar requisição no Supabase
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
        cnpj_sugestao_requisicao: input.cnpj_sugestao_requisicao || null,
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

    requisicaoId = reqCriada.id;

    // 2. Criar itens + rateios
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
        await (supabase as any).from("compras_requisicoes_itens_classe_rec_desp").upsert({
          item_id: itemCriado.id,
          codigo_classe_rec_desp: r.codigo_classe_rec_desp,
          classe_rec_desp_label: r.classe_rec_desp_label,
          percentual: r.percentual,
        });
      }
    }

    // 3. Upload dos arquivos para Storage + tabela de metadados
    for (const arquivo of input.arquivos) {
      await salvarArquivoNoStorage(requisicaoId, arquivo, input.user_id);
    }

    await (supabase as any).from("compras_requisicoes_auditoria").upsert({
      requisicao_id: requisicaoId,
      evento: "criada",
      user_id: input.user_id,
      user_nome: input.requisitante_nome,
      sucesso: true,
    });

    // 4. Montar payload multipart
    const guids = input.arquivos.map((a) => a.upload_identify_guid);
    const payload = montarPayloadReqComp({
      codigo_centro_ctrl: input.codigo_centro_ctrl,
      codigo_finalidade_compra: input.codigo_finalidade_compra,
      codigo_funcionario: input.codigo_funcionario,
      data_necessidade_ymd: input.data_necessidade,
      descricao: input.descricao,
      texto: textoCompleto,
      itens: input.itens,
      arquivos_guids: guids,
    });

    await (supabase as any).from("compras_requisicoes_auditoria").upsert({
      requisicao_id: requisicaoId,
      evento: "envio_tentado",
      user_id: input.user_id,
      user_nome: input.requisitante_nome,
      payload_enviado: payload,
      sucesso: true,
    });

    // 5. Chamar gateway multipart
    try {
      const formData = montarFormDataMultipart(
        payload,
        input.arquivos.map((a) => ({
          guid: a.upload_identify_guid,
          blob: a.file,
          nome: a.file.name,
        })),
      );

      const respData = await callGatewayReqCompMultipart("/req-comp/insert-multipart", formData);

      const numeroAlvo = respData?.Numero || "";

      // Atualizar requisição como sincronizada
      await (supabase as any).from("compras_requisicoes").upsert(
        {
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
        },
        { onConflict: "id" },
      );

      // Marcar arquivos com o número do Alvo (via RPC para contornar bloqueio de PATCH no CORS)
      for (const guid of guids) {
        const { error: errMarcar } = await (supabase as any).rpc("marcar_arquivo_req_enviado", {
          p_guid: guid,
          p_numero_alvo: numeroAlvo,
        });
        if (errMarcar) {
          console.warn(`Aviso: falha ao marcar arquivo ${guid} como enviado:`, errMarcar.message);
        }
      }

      await (supabase as any).from("compras_requisicoes_auditoria").upsert({
        requisicao_id: requisicaoId,
        evento: "envio_sucesso",
        user_id: input.user_id,
        user_nome: input.requisitante_nome,
        resposta_alvo: respData,
        sucesso: true,
      });

      return { sucesso: true, requisicao_id: requisicaoId, numero_alvo: numeroAlvo };
    } catch (errEnvio: any) {
      const msgErro = errEnvio?.message || String(errEnvio);

      await (supabase as any).from("compras_requisicoes").upsert(
        {
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
        },
        { onConflict: "id" },
      );

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
  } catch (errCriacao: any) {
    // Captura erros que ocorrem ANTES do envio ao Alvo (criação de itens, upload de arquivo, etc).
    const msgErro = errCriacao?.message || String(errCriacao);

    if (requisicaoId) {
      await (supabase as any).from("compras_requisicoes").upsert(
        {
          id: requisicaoId,
          requisitante_user_id: input.user_id,
          status: "rascunho",
          erro_ultimo_envio: `Erro durante criação: ${msgErro}`,
          tentativa_envio_em: new Date().toISOString(),
          codigo_empresa_filial: EMPRESA_FILIAL,
          codigo_funcionario: input.codigo_funcionario,
          codigo_centro_ctrl: input.codigo_centro_ctrl,
          codigo_finalidade_compra: input.codigo_finalidade_compra,
          data_necessidade: input.data_necessidade,
          total_itens: input.itens.length,
        },
        { onConflict: "id" },
      );

      await (supabase as any).from("compras_requisicoes_auditoria").upsert({
        requisicao_id: requisicaoId,
        evento: "envio_falha",
        user_id: input.user_id,
        user_nome: input.requisitante_nome,
        sucesso: false,
        mensagem_erro: `Erro durante criação: ${msgErro}`,
      });

      return { sucesso: false, requisicao_id: requisicaoId, erro: msgErro };
    }

    throw errCriacao;
  }
}

/**
 * Reenvia requisição. Detecta automaticamente se tem arquivos associados
 * e escolhe a rota correta (JSON puro ou multipart).
 */
export async function reenviarRequisicao(requisicaoId: string, userId: string, userName: string): Promise<EnvioResult> {
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

  // Verificar se tem arquivos
  const { data: arquivos } = await (supabase as any)
    .from("compras_requisicoes_arquivos")
    .select("*")
    .eq("requisicao_id", requisicaoId)
    .order("created_at", { ascending: true });

  const temArquivos = arquivos && arquivos.length > 0;

  const itensNormalizados = itens.map((item: any) => ({
    item_servico: item.item_servico,
    codigo_produto: item.codigo_produto,
    codigo_alternativo_produto: item.codigo_alternativo_produto,
    codigo_prod_unid_med: item.codigo_prod_unid_med,
    quantidade: Number(item.quantidade),
    observacao: item.observacao || "",
  }));

  const guids = temArquivos ? arquivos.map((a: any) => a.upload_identify_guid) : undefined;

  const payload = montarPayloadReqComp({
    codigo_centro_ctrl: req.codigo_centro_ctrl,
    codigo_finalidade_compra: req.codigo_finalidade_compra,
    codigo_funcionario: req.codigo_funcionario,
    data_necessidade_ymd: String(req.data_necessidade),
    descricao: req.descricao || "",
    texto: req.texto || "",
    itens: itensNormalizados,
    arquivos_guids: guids,
  });

  await (supabase as any).from("compras_requisicoes_auditoria").upsert({
    requisicao_id: requisicaoId,
    evento: "envio_tentado",
    user_id: userId,
    user_nome: userName,
    payload_enviado: payload,
    sucesso: true,
  });

  await (supabase as any).from("compras_requisicoes").upsert(
    {
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
    },
    { onConflict: "id" },
  );

  try {
    let respData: any;

    if (temArquivos) {
      // Baixar os arquivos do Storage e montar FormData
      const arquivosParaUpload: Array<{ guid: string; blob: Blob; nome: string }> = [];
      for (const arq of arquivos) {
        const { data: blob, error: dlErr } = await supabase.storage.from(STORAGE_BUCKET).download(arq.storage_path);
        if (dlErr || !blob) {
          throw new Error(`Erro ao baixar arquivo "${arq.nome_original}" do Storage: ${dlErr?.message}`);
        }
        arquivosParaUpload.push({
          guid: arq.upload_identify_guid,
          blob,
          nome: arq.nome_original,
        });
      }

      const formData = montarFormDataMultipart(payload, arquivosParaUpload);
      respData = await callGatewayReqCompMultipart("/req-comp/insert-multipart", formData);
    } else {
      respData = await callGatewayReqComp("/req-comp/insert", "POST", payload);
    }

    const numeroAlvo = respData?.Numero || "";

    await (supabase as any).from("compras_requisicoes").upsert(
      {
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
      },
      { onConflict: "id" },
    );

    // Marcar arquivos com o número do Alvo (se houver, via RPC)
    if (temArquivos) {
      for (const guid of guids!) {
        const { error: errMarcar } = await (supabase as any).rpc("marcar_arquivo_req_enviado", {
          p_guid: guid,
          p_numero_alvo: numeroAlvo,
        });
        if (errMarcar) {
          console.warn(`Aviso: falha ao marcar arquivo ${guid} como enviado:`, errMarcar.message);
        }
      }
    }

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

    await (supabase as any).from("compras_requisicoes").upsert(
      {
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
      },
      { onConflict: "id" },
    );

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

// ─── Funções de arquivos ───

/**
 * Lista todos os arquivos de uma requisição.
 */
export async function listarArquivosDaRequisicao(requisicaoId: string): Promise<ArquivoRequisicao[]> {
  const { data, error } = await (supabase as any)
    .from("compras_requisicoes_arquivos")
    .select("*")
    .eq("requisicao_id", requisicaoId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Erro ao listar arquivos: ${error.message}`);
  return (data || []) as ArquivoRequisicao[];
}

/**
 * Gera uma URL assinada (válida por 5 minutos) para download do arquivo.
 */
export async function getUrlAssinadaArquivo(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 300); // 5 minutos

  if (error || !data?.signedUrl) {
    throw new Error(`Erro ao gerar URL de download: ${error?.message}`);
  }
  return data.signedUrl;
}

/**
 * Remove um arquivo: deleta do Storage E da tabela de metadados.
 * Só deve ser chamado para requisições em status "rascunho" (pré-envio ao Alvo).
 */
export async function removerArquivo(arquivoId: string): Promise<void> {
  // 1. Buscar o storage_path antes de deletar
  const { data: arq, error: errBusca } = await (supabase as any)
    .from("compras_requisicoes_arquivos")
    .select("storage_path")
    .eq("id", arquivoId)
    .single();

  if (errBusca || !arq) {
    throw new Error(`Arquivo não encontrado: ${errBusca?.message}`);
  }

  // 2. Deletar do Storage
  const { error: errStorage } = await supabase.storage.from(STORAGE_BUCKET).remove([arq.storage_path]);

  if (errStorage) {
    console.warn(`Aviso: falha ao remover arquivo do Storage: ${errStorage.message}`);
    // Continua mesmo assim para limpar o metadado
  }

  // 3. Deletar linha da tabela
  const { error: errDelete } = await (supabase as any)
    .from("compras_requisicoes_arquivos")
    .delete()
    .eq("id", arquivoId);

  if (errDelete) {
    throw new Error(`Erro ao remover metadados do arquivo: ${errDelete.message}`);
  }
}

// ─── Funções existentes (excluir, sincronizar status) ───

export async function excluirRequisicao(requisicaoId: string): Promise<void> {
  // Buscar arquivos antes de deletar para limpar o Storage
  const { data: arquivos } = await (supabase as any)
    .from("compras_requisicoes_arquivos")
    .select("storage_path")
    .eq("requisicao_id", requisicaoId);

  if (arquivos && arquivos.length > 0) {
    const paths = arquivos.map((a: any) => a.storage_path);
    await supabase.storage.from(STORAGE_BUCKET).remove(paths);
  }

  // Cascade delete remove automaticamente as linhas de compras_requisicoes_arquivos
  const { error } = await (supabase as any).from("compras_requisicoes").delete().eq("id", requisicaoId);

  if (error) throw new Error(`Erro ao excluir: ${error.message}`);
}

export async function sincronizarStatusRequisicao(
  requisicaoId: string,
  userId: string,
  userName: string,
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

    await (supabase as any).from("compras_requisicoes").upsert(
      {
        id: requisicaoId,
        requisitante_user_id: req.requisitante_user_id,
        status: "cancelada",
        codigo_empresa_filial: req.codigo_empresa_filial,
        codigo_funcionario: req.codigo_funcionario,
        codigo_centro_ctrl: req.codigo_centro_ctrl,
        codigo_finalidade_compra: req.codigo_finalidade_compra,
        data_necessidade: req.data_necessidade,
        total_itens: req.total_itens,
      },
      { onConflict: "id" },
    );

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
