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
 * Grava a mensagem de erro na requisição SEM mexer no status (a linha já está em
 * 'rascunho'). Se por algum motivo ela estiver num estado protegido pelo trigger
 * `trg_req_protege_aprovacao` (pendente_aprovacao/aprovada/rejeitada), o banco
 * recusa a escrita direta — por isso a falha aqui é apenas logada: o que vale para
 * o usuário é a mensagem devolvida pelo fluxo, que nunca é silenciosa.
 */
async function tentarRegistrarErroNoRascunho(requisicaoId: string, mensagem: string): Promise<void> {
  try {
    const { error } = await (supabase as any).from("compras_requisicoes").upsert(
      {
        id: requisicaoId,
        status: "rascunho",
        erro_ultimo_envio: mensagem,
        tentativa_envio_em: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) {
      console.warn(`[requisicoes] erro não registrado na requisição ${requisicaoId}: ${error.message}`);
    }
  } catch (err: any) {
    console.warn(`[requisicoes] erro não registrado na requisição ${requisicaoId}: ${err?.message || err}`);
  }
}

/**
 * Persiste o desfecho do envio pela RPC `registrar_envio_requisicao` (Fase 1, R4).
 * Devolve `null` quando registrou; senão, a descrição do problema — nunca engole.
 */
async function registrarDesfechoViaRpc(
  requisicaoId: string,
  numeroAlvo: string | null,
  erro: string | null,
): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("registrar_envio_requisicao", {
    p_req_id: requisicaoId,
    p_numero_alvo: numeroAlvo,
    p_erro: erro,
  });

  if (error) return error.message;

  const retorno = String(data ?? "");
  const esperado = numeroAlvo !== null ? "SINCRONIZADA" : "ERRO_REGISTRADO";
  return retorno === esperado ? null : `retorno inesperado "${retorno}"`;
}

/**
 * FASE 2 — split do antigo `enviarRequisicao` (one-shot: criava e enviava na mesma
 * função, sem deixar um `id` para rotear).
 *
 * `criarRequisicao` só PERSISTE: cabeçalho + itens + rateios + anexos, em
 * `status='rascunho'`, e devolve o id. Nada vai ao ERP aqui.
 *
 * Por que 'rascunho' e não o antigo 'pendente_envio': a RPC `submeter_requisicao`
 * (R1) exige rascunho. O estado transitório 'pendente_envio' continua existindo —
 * quem passa a gravá-lo é `enviarRequisicaoAlvo` no modo de persistência legado.
 */
export async function criarRequisicao(input: NovaRequisicaoInput): Promise<string> {
  if (input.arquivos && input.arquivos.length > 3) {
    throw new Error("Máximo de 3 arquivos por requisição.");
  }

  const textoCompleto = montarTexto(input);
  let requisicaoId: string | null = null;

  try {
    const { data: reqCriada, error: errCreate } = await (supabase as any)
      .from("compras_requisicoes")
      .upsert({
        requisitante_user_id: input.user_id,
        status: "rascunho",
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

    requisicaoId = reqCriada.id as string;

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

    if (input.arquivos && input.arquivos.length > 0) {
      for (const arquivo of input.arquivos) {
        await salvarArquivoNoStorage(requisicaoId, arquivo, input.user_id);
      }
    }

    await (supabase as any).from("compras_requisicoes_auditoria").upsert({
      requisicao_id: requisicaoId,
      evento: "criada",
      user_id: input.user_id,
      user_nome: input.requisitante_nome,
      sucesso: true,
    });

    return requisicaoId;
  } catch (errCriacao: any) {
    // Erro no meio da persistência (itens, rateios, upload). Se a linha já existe,
    // ela fica como rascunho com o erro visível — mesmo comportamento de antes.
    const msgErro = errCriacao?.message || String(errCriacao);

    if (requisicaoId) {
      await tentarRegistrarErroNoRascunho(requisicaoId, `Erro durante criação: ${msgErro}`);

      await (supabase as any).from("compras_requisicoes_auditoria").upsert({
        requisicao_id: requisicaoId,
        evento: "envio_falha",
        user_id: input.user_id,
        user_nome: input.requisitante_nome,
        sucesso: false,
        mensagem_erro: `Erro durante criação: ${msgErro}`,
      });

      const err = new Error(msgErro) as Error & { requisicaoId?: string };
      err.requisicaoId = requisicaoId;
      throw err;
    }

    // Nem a linha do cabeçalho existe — propaga cru.
    throw errCriacao;
  }
}

/**
 * Como o desfecho do envio é persistido:
 *
 * - `legado`: exatamente o que o app faz desde sempre — upsert direto
 *   ('pendente_envio' antes; 'sincronizada' + numero_alvo + enviado_em no sucesso;
 *   'rascunho' + erro_ultimo_envio + tentativa_envio_em na falha). Válido só para
 *   requisição fora do gate (SEM_GATE), que nunca está em estado protegido.
 * - `rpc`: desfecho EXCLUSIVAMENTE via `registrar_envio_requisicao`. Obrigatório
 *   quando a req está 'aprovada' — o trigger `trg_req_protege_aprovacao` recusa
 *   qualquer escrita direta nesse estado (e é por design: escrita direta rebaixaria
 *   a req a rascunho e apagaria a decisão do líder). A auditoria desse caminho é
 *   gravada pela própria RPC (`envio_pos_aprovacao_sucesso` / `_falha`).
 */
export type PersistenciaEnvio = "legado" | "rpc";

export interface EnvioAlvoOptions {
  userId: string;
  userName: string;
  persistencia: PersistenciaEnvio;
}

/**
 * Caminho de envio ao Alvo (o de hoje, isolado numa função própria): lê a requisição
 * já persistida, monta o ReqComp, escolhe a rota (JSON puro ou multipart, conforme
 * haja anexos) e persiste o desfecho no modo pedido em `opts.persistencia`.
 *
 * ⚠️ Homônimo: existe outra `enviarRequisicaoAlvo` em `alvoProjetoPedidoService.ts`
 * (módulo de Projetos, outra entidade). São funções distintas, em módulos distintos.
 */
export async function enviarRequisicaoAlvo(requisicaoId: string, opts: EnvioAlvoOptions): Promise<EnvioResult> {
  const { data: req, error: errReq } = await (supabase as any)
    .from("compras_requisicoes")
    .select("*")
    .eq("id", requisicaoId)
    .single();

  if (errReq || !req) throw new Error(`Requisição não encontrada: ${errReq?.message}`);

  const { data: itens } = await (supabase as any)
    .from("compras_requisicoes_itens")
    .select("*")
    .eq("requisicao_id", requisicaoId)
    .order("sequencia", { ascending: true });

  if (!itens || itens.length === 0) throw new Error("Requisição sem itens.");

  const { data: arquivos } = await (supabase as any)
    .from("compras_requisicoes_arquivos")
    .select("*")
    .eq("requisicao_id", requisicaoId)
    .order("created_at", { ascending: true });

  const temArquivos = !!arquivos && arquivos.length > 0;

  const itensNormalizados = itens.map((item: any) => ({
    item_servico: item.item_servico,
    codigo_produto: item.codigo_produto,
    codigo_alternativo_produto: item.codigo_alternativo_produto,
    codigo_prod_unid_med: item.codigo_prod_unid_med,
    quantidade: Number(item.quantidade),
    observacao: item.observacao || "",
  }));

  const guids: string[] | undefined = temArquivos
    ? arquivos.map((a: any) => a.upload_identify_guid as string)
    : undefined;

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
    user_id: opts.userId,
    user_nome: opts.userName,
    payload_enviado: payload,
    sucesso: true,
  });

  if (opts.persistencia === "legado") {
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
  }

  // A chamada ao ERP fica isolada: um erro de PERSISTÊNCIA depois do sucesso no
  // Alvo não pode ser confundido com falha de envio (a req já existe no ERP).
  let respData: any = null;
  let msgErro: string | null = null;

  try {
    if (temArquivos) {
      const arquivosParaUpload: Array<{ guid: string; blob: Blob; nome: string }> = [];
      for (const arq of arquivos) {
        const { data: blob, error: dlErr } = await supabase.storage.from(STORAGE_BUCKET).download(arq.storage_path);
        if (dlErr || !blob) {
          throw new Error(`Erro ao baixar arquivo "${arq.nome_original}" do Storage: ${dlErr?.message}`);
        }
        arquivosParaUpload.push({ guid: arq.upload_identify_guid, blob, nome: arq.nome_original });
      }

      const formData = montarFormDataMultipart(payload, arquivosParaUpload);
      respData = await callGatewayReqCompMultipart("/req-comp/insert-multipart", formData);
    } else {
      respData = await callGatewayReqComp("/req-comp/insert", "POST", payload);
    }
  } catch (errEnvio: any) {
    msgErro = errEnvio?.message || String(errEnvio);
  }

  // ── Sucesso no Alvo ──
  if (msgErro === null) {
    const numeroAlvo = respData?.Numero || "";

    if (opts.persistencia === "rpc") {
      const problema = await registrarDesfechoViaRpc(requisicaoId, numeroAlvo, null);
      if (problema) {
        return {
          sucesso: false,
          requisicao_id: requisicaoId,
          numero_alvo: numeroAlvo,
          erro:
            `A requisição FOI criada no ERP (nº ${numeroAlvo}), mas o Hub não conseguiu registrar o desfecho: ` +
            `${problema}. NÃO reenvie — isso duplicaria a requisição no ERP. Avise o suporte.`,
        };
      }
    } else {
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

      await (supabase as any).from("compras_requisicoes_auditoria").upsert({
        requisicao_id: requisicaoId,
        evento: "envio_sucesso",
        user_id: opts.userId,
        user_nome: opts.userName,
        resposta_alvo: respData,
        sucesso: true,
      });
    }

    // Marcar arquivos com o número do Alvo (RPC — PATCH direto é bloqueado por CORS)
    if (guids) {
      for (const guid of guids) {
        const { error: errMarcar } = await (supabase as any).rpc("marcar_arquivo_req_enviado", {
          p_guid: guid,
          p_numero_alvo: numeroAlvo,
        });
        if (errMarcar) {
          console.warn(`Aviso: falha ao marcar arquivo ${guid} como enviado:`, errMarcar.message);
        }
      }
    }

    return { sucesso: true, requisicao_id: requisicaoId, numero_alvo: numeroAlvo };
  }

  // ── Falha no envio ──
  if (opts.persistencia === "rpc") {
    const problema = await registrarDesfechoViaRpc(requisicaoId, null, msgErro);
    if (problema) {
      msgErro = `${msgErro} (o Hub também não conseguiu registrar o erro: ${problema})`;
    }
  } else {
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
      user_id: opts.userId,
      user_nome: opts.userName,
      sucesso: false,
      mensagem_erro: msgErro,
    });
  }

  return { sucesso: false, requisicao_id: requisicaoId, erro: msgErro };
}

/** Rotas devolvidas pela RPC `submeter_requisicao` que seguem o fluxo adiante. */
export type RotaSubmissao = "SEM_GATE" | "AUTO_APROVADA" | "PENDENTE";

export interface SubmissaoResult {
  sucesso: boolean;
  requisicao_id: string;
  /** null quando a submissão foi recusada (nada foi enviado ao ERP). */
  rota: RotaSubmissao | null;
  numero_alvo?: string;
  erro?: string;
}

/** Traduz os retornos de recusa da RPC. Nenhum deles envia nada ao ERP. */
function mensagemRecusaSubmissao(retorno: string): string {
  if (retorno.startsWith("STATUS_INVALIDO:")) {
    const statusAtual = retorno.slice("STATUS_INVALIDO:".length) || "?";
    return `A requisição não está em rascunho (status atual: ${statusAtual}). Nada foi enviado ao ERP.`;
  }

  switch (retorno) {
    case "SEM_CENTRO_CUSTO":
      return "Requisição sem centro de custo — não é possível determinar o aprovador. Nada foi enviado ao ERP.";
    case "SEM_PERMISSAO":
      return "Você não tem permissão para criar requisições (compras.requisicoes.create). Nada foi enviado ao ERP.";
    case "NAO_AUTORIZADO":
      return "Esta requisição pertence a outro usuário. Nada foi enviado ao ERP.";
    case "NAO_ENCONTRADA":
      return "Requisição não encontrada ao submeter. Nada foi enviado ao ERP.";
    default:
      return `Retorno inesperado da submissão: "${retorno}". Nada foi enviado ao ERP.`;
  }
}

/**
 * AJUSTE 1.2 — o gate propriamente dito, extraído de `submeterRequisicao` para poder
 * ser reusado pelo reenvio de requisição em rascunho (era o único caminho de UI que
 * chegava ao ERP sem passar por aqui).
 *
 * Recebe uma requisição JÁ PERSISTIDA em 'rascunho', pede o roteamento à RPC
 * `submeter_requisicao` e segue a rota:
 *
 *   SEM_GATE       → CC sem líder mapeado: envio ao Alvo com a persistência legada.
 *   AUTO_APROVADA  → quem submete é líder do CC: envio ao Alvo, desfecho só via RPC R4.
 *   PENDENTE       → para aqui: a req espera a decisão do líder (não vai ao ERP).
 *   qualquer outro → recusa com mensagem visível. Nunca cai no envio por omissão.
 */
export async function rotearSubmissao(
  requisicaoId: string,
  envio: { userId: string; userName: string },
): Promise<SubmissaoResult> {
  const { data, error } = await (supabase as any).rpc("submeter_requisicao", { p_req_id: requisicaoId });

  if (error) {
    const msg = `Falha ao submeter a requisição para roteamento: ${error.message}. Nada foi enviado ao ERP.`;
    await tentarRegistrarErroNoRascunho(requisicaoId, msg);
    return { sucesso: false, requisicao_id: requisicaoId, rota: null, erro: msg };
  }

  const retorno = String(data ?? "");

  if (retorno === "SEM_GATE") {
    const result = await enviarRequisicaoAlvo(requisicaoId, { ...envio, persistencia: "legado" });
    return { ...result, rota: "SEM_GATE" };
  }

  if (retorno === "AUTO_APROVADA") {
    const result = await enviarRequisicaoAlvo(requisicaoId, { ...envio, persistencia: "rpc" });
    return { ...result, rota: "AUTO_APROVADA" };
  }

  if (retorno === "PENDENTE") {
    return { sucesso: true, requisicao_id: requisicaoId, rota: "PENDENTE" };
  }

  const msg = mensagemRecusaSubmissao(retorno);
  await tentarRegistrarErroNoRascunho(requisicaoId, msg);
  return { sucesso: false, requisicao_id: requisicaoId, rota: null, erro: msg };
}

/**
 * Submissão da requisição (ação final do wizard). Substitui o envio direto ao Alvo:
 * persiste o rascunho e entrega o roteamento a `rotearSubmissao`.
 */
export async function submeterRequisicao(input: NovaRequisicaoInput): Promise<SubmissaoResult> {
  let requisicaoId: string;

  try {
    requisicaoId = await criarRequisicao(input);
  } catch (errCriacao: any) {
    const idParcial = (errCriacao as { requisicaoId?: string })?.requisicaoId;
    if (idParcial) {
      return {
        sucesso: false,
        requisicao_id: idParcial,
        rota: null,
        erro: errCriacao?.message || String(errCriacao),
      };
    }
    throw errCriacao;
  }

  return rotearSubmissao(requisicaoId, { userId: input.user_id, userName: input.requisitante_nome });
}

/**
 * Reenvio de requisição APROVADA cujo envio ao Alvo falhou (erro_ultimo_envio).
 * Caminho novo, separado do `reenviarRequisicao` legado de propósito: aquele só
 * aceita 'rascunho'/'pendente_envio' e REBAIXA a req a 'rascunho' quando falha, o
 * que apagaria a decisão do líder (e hoje o trigger do banco recusa a escrita).
 * Aqui não há nova aprovação: a req segue 'aprovada' até o envio dar certo.
 */
export async function reenviarRequisicaoAprovada(
  requisicaoId: string,
  userId: string,
  userName: string,
): Promise<EnvioResult> {
  const { data: req, error: errReq } = await (supabase as any)
    .from("compras_requisicoes")
    .select("status")
    .eq("id", requisicaoId)
    .single();

  if (errReq || !req) throw new Error(`Requisição não encontrada: ${errReq?.message}`);
  if (req.status !== "aprovada") {
    throw new Error(
      `Este reenvio é exclusivo de requisições aprovadas aguardando envio ao ERP (status atual: ${req.status}).`,
    );
  }

  return enviarRequisicaoAlvo(requisicaoId, { userId, userName, persistencia: "rpc" });
}

/**
 * Reenvia requisição. Detecta automaticamente se tem arquivos associados
 * e escolhe a rota correta (JSON puro ou multipart).
 *
 * AJUSTE 1.2 — requisição em 'rascunho' volta a passar pelo gate: toda recusa do
 * roteamento produz um rascunho, e este botão era o único caminho de UI que levava
 * um rascunho ao ERP sem consultar `submeter_requisicao`. Agora o rascunho é
 * RE-ROTEADO (o destino pode mudar de propósito: um CC que ganhou líder entre a
 * criação e o reenvio passa a exigir aprovação).
 *
 * 'pendente_envio' NÃO é re-roteado: só a persistência legada grava esse status,
 * logo a req já foi roteada como SEM_GATE — e a RPC devolveria
 * `STATUS_INVALIDO:pendente_envio`, já que ela exige rascunho.
 *
 * Retorno: `rota` diz por onde o reenvio passou — `null` no caminho legado de
 * 'pendente_envio' (e nas recusas, junto com `sucesso: false`). `rota: 'PENDENTE'`
 * é sucesso SEM envio ao ERP: a req foi para a fila do líder.
 */
export async function reenviarRequisicao(
  requisicaoId: string,
  userId: string,
  userName: string,
): Promise<SubmissaoResult> {
  const { data: req, error: errReq } = await (supabase as any)
    .from("compras_requisicoes")
    .select("*")
    .eq("id", requisicaoId)
    .single();

  if (errReq || !req) throw new Error(`Requisição não encontrada: ${errReq?.message}`);
  // Defesa em profundidade: este caminho rebaixa a req a 'rascunho' quando o envio
  // falha — em requisição aprovada isso apagaria a decisão do líder (e o trigger
  // trg_req_protege_aprovacao recusaria a escrita). Use reenviarRequisicaoAprovada.
  if (req.status === "aprovada") {
    throw new Error(
      "Requisição aprovada: use o reenvio pós-aprovação (reenviarRequisicaoAprovada), que preserva a decisão do líder.",
    );
  }
  if (req.status !== "rascunho" && req.status !== "pendente_envio") {
    throw new Error("Só é possível reenviar requisições com status rascunho ou pendente de envio.");
  }

  if (req.status === "rascunho") {
    return rotearSubmissao(requisicaoId, { userId, userName });
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

    return { sucesso: true, requisicao_id: requisicaoId, numero_alvo: numeroAlvo, rota: null };
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

    return { sucesso: false, requisicao_id: requisicaoId, erro: msgErro, rota: null };
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
/**
 * Persiste os itens da requisição vindos do Load do Alvo (L4/requisições).
 *
 * Contexto: o Job 4 (descoberta) insere só o CABEÇALHO — 107 das 111 requisições
 * descobertas no Alvo ficaram sem itens, e a tela exibia "Itens (0)" em silêncio.
 * O detalhe já vem no mesmo Load que o sync de status faz: aqui apenas paramos
 * de descartá-lo. Zero chamadas extras ao ERP.
 *
 * ⚠️ SÓ INSERE QUANDO NÃO HÁ NENHUM ITEM. Não existe UNIQUE (requisicao_id,
 * sequencia) nesta tabela, então não dá para fazer upsert; e apagar/reinserir
 * seria destrutivo — os itens criados pelo Hub têm rateio em
 * compras_requisicoes_itens_classe_rec_desp (FK por item_id), que ficaria órfão.
 * Requisição que já tem itens é deixada intacta.
 *
 * Nome do produto: o ItemReqCompChildList NÃO traz nome (só CodigoProduto), e a
 * tela usa produto_nome como título do item — por isso enriquecemos pelo
 * catálogo local (stock_products). Sem correspondência, fica null e a tela cai
 * no código.
 */
async function persistirItensRequisicao(requisicaoId: string, respData: any): Promise<number> {
  const { count, error: errCount } = await (supabase as any)
    .from("compras_requisicoes_itens")
    .select("id", { count: "exact", head: true })
    .eq("requisicao_id", requisicaoId);

  if (errCount) {
    console.error("[persistirItensRequisicao] erro ao contar itens:", errCount);
    return 0;
  }
  if ((count ?? 0) > 0) return 0; // já tem itens — não mexe

  const lista = (respData?.ItemReqCompChildList || []) as any[];
  if (lista.length === 0) return 0;

  // Enriquecimento de nome pelo catálogo local
  const codigos = Array.from(new Set(lista.map((it) => it?.CodigoProduto).filter(Boolean)));
  const nomePorCodigo = new Map<string, string>();
  if (codigos.length > 0) {
    const { data: prods } = await (supabase as any)
      .from("stock_products")
      .select("codigo_produto, nome_produto")
      .in("codigo_produto", codigos);
    for (const p of prods || []) nomePorCodigo.set(p.codigo_produto, p.nome_produto);
  }

  const rows = lista.map((it: any, idx: number) => ({
    requisicao_id: requisicaoId,
    sequencia: Number(it?.Sequencia) || idx + 1,
    item_servico: it?.ItemServico === "Sim",
    codigo_produto: it?.CodigoProduto,
    codigo_alternativo_produto: it?.CodigoAlternativoProduto ?? null,
    codigo_prod_unid_med: it?.CodigoProdUnidMed,
    // Mesma lição dos pedidos: a quantidade canônica é a da unidade PRINCIPAL
    // (Quantidade2 diverge em parte dos itens).
    quantidade: Number(it?.QuantidadeProdUnidMedPrincipal) || 0,
    data_necessidade: it?.DataNecessidade ?? null,
    codigo_centro_ctrl: it?.CodigoCentroCtrl ?? null,
    observacao: it?.Observacao ?? null,
    produto_nome: nomePorCodigo.get(it?.CodigoProduto) ?? null,
    produto_unidade: it?.CodigoProdUnidMed ?? null,
  }));

  // Colunas NOT NULL sem default: descartar linha incompleta em vez de derrubar
  // o insert inteiro (e registrar, para não sumir em silêncio).
  const validas = rows.filter(
    (r) => r.codigo_produto && r.codigo_prod_unid_med && r.data_necessidade && r.codigo_centro_ctrl,
  );
  if (validas.length < rows.length) {
    console.warn(
      `[persistirItensRequisicao] ${rows.length - validas.length} item(ns) descartado(s) por campo obrigatório ausente`,
    );
  }
  if (validas.length === 0) return 0;

  const { error } = await (supabase as any).from("compras_requisicoes_itens").insert(validas);
  if (error) {
    console.error("[persistirItensRequisicao] erro ao inserir itens:", error);
    return 0;
  }
  return validas.length;
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

  // ── Itens (L4/requisições) ────────────────────────────────────────────
  // Antes do cálculo de status: a maioria das requisições NÃO muda de status,
  // e o early return abaixo pularia a persistência.
  const itensPersistidos = await persistirItensRequisicao(requisicaoId, respData);
  if (itensPersistidos > 0) {
    console.log(`[sincronizarStatusRequisicao] ${itensPersistidos} itens persistidos para req ${req.numero_alvo}`);
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
