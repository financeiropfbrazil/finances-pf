import { unidadesProduto, validarItemCadastro, quantidadesLoad, exigirQuantidadesCompletas, objetoAlvo, type UnidadeRequisicao } from "../../supabase/functions/_shared/requisicao-unidades";
import { validarRateioCC } from "@/lib/requisicaoCC";
import { supabase } from "@/integrations/supabase/client";

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";
const EMPRESA_FILIAL = "1.01";
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
  codigo_centro_ctrl?: string;
  produto_nome: string;
  produto_unidade: string;
  quantidade: number;
  quantidade_solicitada?: number;
  posicao_prod_unid_med?: number;
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
  rateio_cc?: RateioCCClasseInput[];
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

async function callGatewayReqComp(path: string, method: "GET" | "POST", body?: unknown, signal?: AbortSignal): Promise<any> {
  const jwt = await getSupabaseJWT();
  if (signal?.aborted) throw new DOMException("Consulta cancelada", "AbortError");
  const url = `${ERP_PROXY_URL}${path}`;

  const resp = await fetch(url, {
    method,
    ...(signal ? { signal } : {}),
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

  const digest = await crypto.subtle.digest("SHA-256", await arquivo.file.arrayBuffer());
  const conteudoSha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
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
      conteudo_sha256: conteudoSha256,
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
 * Grava a mensagem de erro na requisição SEM mexer no status (a linha já está em
 * 'rascunho'). Se por algum motivo ela estiver num estado protegido pelo trigger
 * `trg_req_protege_aprovacao` (pendente_aprovacao/aprovada/rejeitada), o banco
 * recusa a escrita direta — por isso a falha aqui é apenas logada: o que vale para
 * o usuário é a mensagem devolvida pelo fluxo, que nunca é silenciosa.
 */
async function tentarRegistrarErroNoRascunho(requisicaoId: string, mensagem: string): Promise<void> {
  try {
    const { error } = await (supabase as any).rpc("registrar_erro_rascunho_requisicao", { p_req_id: requisicaoId, p_erro: mensagem });
    if (error) {
      console.warn(`[requisicoes] erro não registrado na requisição ${requisicaoId}: ${error.message}`);
    }
  } catch (err: any) {
    console.warn(`[requisicoes] erro não registrado na requisição ${requisicaoId}: ${err?.message || err}`);
  }
}

/**
 * FASE 2 — split do antigo `enviarRequisicao` (one-shot: criava e enviava na mesma
 * função, sem deixar um `id` para rotear).
 *
 * `criarRequisicao` só PERSISTE: cabeçalho + itens + rateios + anexos, em
 * `status='rascunho'`, e devolve o id. Nada vai ao ERP aqui.
 *
 * Por que 'rascunho' e não o antigo 'pendente_envio': a RPC `submeter_requisicao`
 * (R1) exige rascunho. A conclusão da criação só é registrada depois de todas
 * as gravações; uma falha parcial impede a submissão do conteúdo incompleto.
 */
export async function carregarUnidadesProduto(codigo: string, signal?: AbortSignal): Promise<UnidadeRequisicao[]> {
  const controller = new AbortController();
  const cancelar = () => controller.abort();
  signal?.addEventListener("abort", cancelar, { once: true });
  if (signal?.aborted) cancelar();
  let timer: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`A consulta das unidades de ${codigo} excedeu 45 segundos. Tente novamente.`));
      controller.abort();
    }, 45_000);
  });
  try {
    return await Promise.race([limite, (async () => {
      const raw = await callGatewayReqComp(`/produto/load?codigo=${encodeURIComponent(codigo)}`, "GET", undefined, controller.signal);
      let produto: ReturnType<typeof objetoAlvo>;
      try { produto = objetoAlvo(raw, "ProdUnidMedChildList"); }
      catch { throw new Error(`A resposta do Alvo para ${codigo} não trouxe a lista de unidades. Tente novamente; se persistir, confira o cadastro com Suprimentos.`); }
      if (produto.Codigo !== codigo) throw new Error("Produto/Load não corresponde ao produto solicitado");
      // Ausência explícita é diferente de conversão não comprovada. Nunca inventar base.
      if ((produto.ProdUnidMedChildList as unknown[]).length === 0) return [];
      return unidadesProduto(produto, codigo);
    })()]);
  } finally {
    clearTimeout(timer!);
    signal?.removeEventListener("abort", cancelar);
  }
}

export async function criarRequisicao(input: NovaRequisicaoInput): Promise<string> {
  const erroRateio = validarRateioCC(input.codigo_centro_ctrl, input.rateio_cc || []);
  if (erroRateio) throw new Error(erroRateio);
  const itemComObservacaoLonga = input.itens.findIndex((item) => Array.from(item.observacao || "").length > 255);
  if (itemComObservacaoLonga >= 0) {
    throw new Error(`A observação do item ${itemComObservacaoLonga + 1} deve ter no máximo 255 caracteres.`);
  }

  if (input.arquivos && input.arquivos.length > 3) {
    throw new Error("Máximo de 3 arquivos por requisição.");
  }

  const cadastros = new Map<string, UnidadeRequisicao[]>();
  for (const item of input.itens) {
    if (!cadastros.has(item.codigo_produto)) cadastros.set(item.codigo_produto, await carregarUnidadesProduto(item.codigo_produto));
    validarItemCadastro({ ...item, quantidade_solicitada: item.quantidade_solicitada ?? null, posicao_prod_unid_med: item.posicao_prod_unid_med ?? null }, cadastros.get(item.codigo_produto)!);
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
          quantidade_solicitada: item.quantidade_solicitada,
          posicao_prod_unid_med: item.posicao_prod_unid_med,
          conversao_unidade: validarItemCadastro({ ...item, quantidade_solicitada: item.quantidade_solicitada ?? null, posicao_prod_unid_med: item.posicao_prod_unid_med ?? null }, cadastros.get(item.codigo_produto)!),
          data_necessidade: input.data_necessidade,
          codigo_centro_ctrl: item.codigo_centro_ctrl || input.codigo_centro_ctrl,
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
        const { error: erroClasse } = await (supabase as any).from("compras_requisicoes_itens_classe_rec_desp").upsert({
          item_id: itemCriado.id,
          codigo_classe_rec_desp: r.codigo_classe_rec_desp,
          classe_rec_desp_label: r.classe_rec_desp_label,
          percentual: r.percentual,
        });
        if (erroClasse) throw new Error(`Erro ao salvar classe do item ${idx + 1}: ${erroClasse.message}`);
      }
    }

    if (input.rateio_cc?.length) {
      const { error } = await (supabase as any).rpc("salvar_rateio_requisicao", { p_req_id: requisicaoId, p_rateio: input.rateio_cc });
      if (error) throw new Error(`Erro ao salvar rateio por CC: ${error.message}`);
    }
    if (input.arquivos && input.arquivos.length > 0) {
      for (const arquivo of input.arquivos) {
        await salvarArquivoNoStorage(requisicaoId, arquivo, input.user_id);
      }
    }

    const { error: errAuditCriada } = await (supabase as any).from("compras_requisicoes_auditoria").insert({
      requisicao_id: requisicaoId,
      evento: "criada",
      user_id: input.user_id,
      user_nome: input.requisitante_nome,
      sucesso: true,
    });
    // Não lança: a requisição FOI criada; perder a trilha não pode desfazer isso.
    if (errAuditCriada) {
      console.error(
        `[auditoria] falhou ao gravar evento "criada" da requisição ${requisicaoId}: ${errAuditCriada.message}`,
      );
    }

    const { error: erroFinalizar } = await (supabase as any).rpc("finalizar_rascunho_requisicao", { p_req_id: requisicaoId });
    if (erroFinalizar) throw new Error(`Erro ao finalizar criação: ${erroFinalizar.message}`);
    return requisicaoId;
  } catch (errCriacao: any) {
    // Erro no meio da persistência (itens, rateios, upload). Se a linha já existe,
    // ela fica como rascunho com o erro visível — mesmo comportamento de antes.
    const msgErro = errCriacao?.message || String(errCriacao);

    if (requisicaoId) {
      await tentarRegistrarErroNoRascunho(requisicaoId, `Erro durante criação: ${msgErro}`);

      const { error: errAuditFalhaCriacao } = await (supabase as any)
        .from("compras_requisicoes_auditoria")
        .insert({
          requisicao_id: requisicaoId,
          evento: "envio_falha",
          user_id: input.user_id,
          user_nome: input.requisitante_nome,
          sucesso: false,
          mensagem_erro: `Erro durante criação: ${msgErro}`,
        });
      // Não lança: mascararia `msgErro`, que é o erro real que a pessoa precisa ver.
      if (errAuditFalhaCriacao) {
        console.error(
          `[auditoria] falhou ao gravar evento "envio_falha" da requisição ${requisicaoId}: ` +
            errAuditFalhaCriacao.message,
        );
      }

      const err = new Error(msgErro) as Error & { requisicaoId?: string };
      err.requisicaoId = requisicaoId;
      throw err;
    }

    // Nem a linha do cabeçalho existe — propaga cru.
    throw errCriacao;
  }
}

/** Compatibilidade de assinatura. O gateway persiste todos os envios. */
export type PersistenciaEnvio = "legado" | "rpc";

export interface EnvioAlvoOptions {
  userId: string;
  userName: string;
  persistencia: PersistenciaEnvio;
}

/** Envia o ID ao gateway; conteúdo e autorização são resolvidos no backend. */
export async function enviarRequisicaoAlvo(requisicaoId: string, _opts: EnvioAlvoOptions): Promise<EnvioResult> {
  // O gateway lê o documento aprovado no banco, reivindica a tentativa e persiste
  // o desfecho. Nenhum payload/estado de aprovação vindo do navegador é confiado.
  try {
    const data = await callGatewayReqComp("/req-comp/enviar-aprovada", "POST", { requisicao_id: requisicaoId });
    if (!data?.Numero) throw new Error("Envio sem confirmação do ERP. Recarregue o detalhe; não repita sem reconciliar.");
    return { sucesso: true, requisicao_id: requisicaoId, numero_alvo: data.Numero };
  } catch (error) {
    return { sucesso: false, requisicao_id: requisicaoId, erro: error instanceof Error ? error.message : String(error) };
  }
}

/** Rotas devolvidas pela RPC `submeter_requisicao` que seguem o fluxo adiante. */
export type RotaSubmissao = "SEM_GATE" | "AUTO_APROVADA" | "PENDENTE";

/** Status que o reenvio legado aceita (lista positiva — ver `reenviarRequisicao`). */
const STATUS_REENVIAVEIS_LEGADO = ["rascunho", "pendente_envio"];

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
    case "UNIDADE_INCOMPLETA_OU_DIVERGENTE":
      return "Quantidade/unidade incompleta ou divergente. Clone recuperando o Load original ou recrie o item com o cadastro atual.";
    case "ANEXO_SEM_INTEGRIDADE":
      return "Anexo antigo ou incompleto: clone a requisição e anexe novamente os arquivos antes de submeter.";
    case "CRIACAO_INCOMPLETA":
      return "A criação ficou incompleta. Clone a requisição, confira os itens e o rateio e anexe novamente os arquivos antes de submeter.";
    case "RATEIO_INVALIDO":
      return "Confira os percentuais do rateio: cada nível deve somar 100%.";
    case "CABECALHO_FORA_RATEIO":
      return "O CC principal precisa fazer parte do rateio por CC.";
    case "SEM_ITENS":
      return "Adicione ao menos um item antes de submeter.";
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
 *   SEM_GATE       → todos os CCs sem líder: envio autorizado no backend.
 *   AUTO_APROVADA  → autor lidera os CCs exigidos: envio autorizado no backend.
 *   PENDENTE       → para aqui: a req espera a decisão do líder (não vai ao ERP).
 *   qualquer outro → recusa com mensagem visível. Nunca cai no envio por omissão.
 */
export async function rotearSubmissao(
  requisicaoId: string,
  envio: { userId: string; userName: string },
): Promise<SubmissaoResult> {
  // FASE 3 (C5.2) — requisição sem itens não entra no gate. Quem validava isso era
  // `enviarRequisicaoAlvo`, que a rota PENDENTE nunca chama: uma req vazia chegava
  // à fila do líder para ser aprovada e só então falhar. O wizard também valida
  // (feedback antecipado), mas o reenvio de rascunho não passava por lá.
  const { count, error: errItens } = await (supabase as any)
    .from("compras_requisicoes_itens")
    .select("id", { count: "exact", head: true })
    .eq("requisicao_id", requisicaoId);

  if (errItens) {
    const msg = `Não foi possível conferir os itens da requisição: ${errItens.message}. Nada foi enviado ao ERP.`;
    return { sucesso: false, requisicao_id: requisicaoId, rota: null, erro: msg };
  }
  if ((count ?? 0) === 0) {
    const msg = "Requisição sem itens — adicione ao menos um item antes de submeter. Nada foi enviado ao ERP.";
    await tentarRegistrarErroNoRascunho(requisicaoId, msg);
    return { sucesso: false, requisicao_id: requisicaoId, rota: null, erro: msg };
  }

  const { data, error } = await (supabase as any).rpc("submeter_requisicao", { p_req_id: requisicaoId });

  if (error) {
    const msg = `Falha ao submeter a requisição para roteamento: ${error.message}. Nada foi enviado ao ERP.`;
    await tentarRegistrarErroNoRascunho(requisicaoId, msg);
    return { sucesso: false, requisicao_id: requisicaoId, rota: null, erro: msg };
  }

  const retorno = String(data ?? "");

  if (retorno === "SEM_GATE") {
    const result = await enviarRequisicaoAlvo(requisicaoId, { ...envio, persistencia: "rpc" });
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
  // Lista POSITIVA (Fase 3): quem pode ser reenviado por este caminho é enumerado,
  // nunca deduzido por exclusão — status novo que apareça no futuro é recusado por
  // omissão, e não admitido por acidente.
  if (!STATUS_REENVIAVEIS_LEGADO.includes(req.status)) {
    throw new Error("Só é possível reenviar requisições com status rascunho ou pendente de envio.");
  }

  if (req.status === "rascunho") {
    return rotearSubmissao(requisicaoId, { userId, userName });
  }

  throw new Error("Envio legado em andamento: reconcilie com o ERP antes de reenviar.");
}

// ─── FASE 3 — fila do líder (aprovar / rejeitar) ───

export interface RequisicaoPendente {
  aguardando_voce: boolean;
  id: string;
  numero_alvo: string | null;
  descricao: string | null;
  codigo_centro_ctrl: string | null;
  centro_ctrl_nome: string | null;
  funcionario_nome: string | null;
  codigo_funcionario: string | null;
  requisitante_user_id: string | null;
  data_necessidade: string | null;
  total_itens: number | null;
  created_at: string;
  updated_at: string | null;
}

/** Resultado padronizado das RPCs de decisão. `ok=false` sempre traz mensagem. */
export interface DecisaoResult {
  final?: boolean;
  ok: boolean;
  /** true quando a requisição saiu de `pendente_aprovacao` por decisão de outra pessoa. */
  jaDecidida?: boolean;
  mensagem?: string;
}

/**
 * Centros de custo que o usuário lidera (`compras_lideres_cc`, linhas ativas).
 * É o escopo da fila: quem não lidera nenhum CC não tem fila, mesmo tendo a
 * permissão `compras.requisicoes.aprovar`.
 */
export async function listarCentrosDeCustoDoLider(userId: string): Promise<string[]> {
  const { data, error } = await (supabase as any)
    .from("compras_lideres_cc")
    .select("codigo_centro_ctrl")
    .eq("lider_user_id", userId)
    .eq("ativo", true);

  if (error) throw new Error(`Erro ao carregar seus centros de custo: ${error.message}`);
  return (data || []).map((l: any) => l.codigo_centro_ctrl as string);
}

/**
 * Conta as requisições aguardando decisão. Usada pelo badge do menu — `head: true`
 * conta no servidor, sem trazer linha nenhuma.
 *
 * `admin` conta todas (é o bypass do Hub, consistente com as RPCs R2/R3).
 */
export async function contarRequisicoesPendentes(userId: string, isAdmin: boolean): Promise<number> {
  const { count, error } = await (supabase as any).rpc("requisicoes_fila_aprovacao", {}, { count: "exact", head: true }).eq("aguardando_voce", true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Fila de decisão: `pendente_aprovacao` nos CCs do líder (admin vê todas).
 * Ordem: **mais antiga primeiro** — é fila, não feed.
 */
export async function listarRequisicoesPendentes(
  userId: string,
  isAdmin: boolean,
  opts?: { offset?: number; limit?: number },
): Promise<RequisicaoPendente[]> {
  const offset = opts?.offset ?? 0;
  const limit = Math.min(opts?.limit ?? 200, 1000);
  const { data, error } = await (supabase as any).rpc("requisicoes_fila_aprovacao").range(offset, offset + limit - 1);
  if (error) throw new Error(`Erro ao carregar aprovações: ${error.message}`);
  return (data || []).map((row: { requisicao: RequisicaoPendente; aguardando_voce: boolean }) => ({ ...row.requisicao, aguardando_voce: row.aguardando_voce }));
}

/**
 * Traduz os retornos das RPCs de decisão (R2/R3) para mensagem de tela.
 * Nenhum retorno cai no vazio — desconhecido vira mensagem explícita.
 */
function traduzirDecisao(retorno: string, acao: "aprovar" | "rejeitar"): DecisaoResult {
  if (retorno === "PARCIAL") return { ok: true, final: false, mensagem: "Sua aprovação foi registrada. Aguardando os demais centros de custo." };
  if (retorno === "FINAL") return { ok: true, final: true };
  if (retorno === "OK" && acao === "rejeitar") return { ok: true };

  if (retorno.startsWith("STATUS_INVALIDO:")) {
    const statusAtual = retorno.slice("STATUS_INVALIDO:".length) || "?";
    return {
      ok: false,
      jaDecidida: true,
      mensagem:
        `Esta requisição já foi decidida por outra pessoa (status atual: ${statusAtual}). ` +
        `A fila foi recarregada.`,
    };
  }

  switch (retorno) {
    case "SEM_PERMISSAO":
      return { ok: false, mensagem: "Você não tem permissão para aprovar ou rejeitar requisições." };
    case "FORA_DO_SEU_CC":
      return {
        ok: false,
        mensagem: "Esta requisição pertence a um centro de custo que você não lidera.",
      };
    case "NAO_ENCONTRADA":
      return { ok: false, jaDecidida: true, mensagem: "Requisição não encontrada — ela pode ter sido excluída." };
    case "MOTIVO_OBRIGATORIO":
      // Assinatura antiga da RPC (texto livre). Mantido para não sumir em silêncio
      // caso o SQL do AJUSTE 1.3 ainda não tenha sido executado no banco.
      return { ok: false, mensagem: "Informe o motivo da rejeição (mínimo de 5 caracteres)." };
    case "MOTIVO_INVALIDO":
      return {
        ok: false,
        mensagem: "Motivo de rejeição inválido ou desativado. Recarregue a página e escolha um motivo da lista.",
      };
    case "OBSERVACAO_OBRIGATORIA":
      return {
        ok: false,
        mensagem: 'O motivo escolhido exige observação (mínimo de 5 caracteres). Descreva o que precisa mudar.',
      };
    default:
      return { ok: false, mensagem: `Retorno inesperado ao ${acao} a requisição: "${retorno}".` };
  }
}

// ─── AJUSTE 1.3 — catálogo de motivos de rejeição ───

export interface MotivoRejeicao {
  codigo: string;
  rotulo: string;
  exige_observacao: boolean;
  ordem: number;
}

/**
 * Catálogo de motivos (tabela `compras_motivos_rejeicao`, só os ativos, na ordem
 * definida no banco). Fica FORA do frontend de propósito (decisão G3): mudar a
 * lista é um insert/update no SQL Editor, não um deploy.
 */
export async function listarMotivosRejeicao(): Promise<MotivoRejeicao[]> {
  const { data, error } = await (supabase as any)
    .from("compras_motivos_rejeicao")
    .select("codigo, rotulo, exige_observacao, ordem")
    .eq("ativo", true)
    .order("ordem", { ascending: true });

  if (error) throw new Error(`Erro ao carregar os motivos de rejeição: ${error.message}`);
  return (data || []) as MotivoRejeicao[];
}

/** Aprova a requisição (RPC R2). NÃO envia ao ERP — o envio é o 2º tempo, na tela. */
export async function aprovarRequisicao(requisicaoId: string): Promise<DecisaoResult> {
  const { data, error } = await (supabase as any).rpc("aprovar_requisicao", { p_req_id: requisicaoId });
  if (error) return { ok: false, mensagem: `Falha ao aprovar: ${error.message}` };
  return traduzirDecisao(String(data ?? ""), "aprovar");
}

/**
 * Rejeita a requisição (RPC R3). Estado TERMINAL: nunca vai ao ERP.
 *
 * AJUSTE 1.3 — assinatura nova: o motivo passa a ser um CÓDIGO do catálogo
 * (`compras_motivos_rejeicao`), para virar indicador agregável; o texto livre
 * sobra como observação, obrigatória apenas quando o motivo exige (G1/G2).
 * A assinatura antiga `(uuid, text)` é dropada no banco — não há caminho velho.
 */
export async function rejeitarRequisicao(
  requisicaoId: string,
  motivoCodigo: string,
  observacao: string | null,
): Promise<DecisaoResult> {
  const { data, error } = await (supabase as any).rpc("rejeitar_requisicao", {
    p_req_id: requisicaoId,
    p_motivo_codigo: motivoCodigo,
    p_observacao: observacao,
  });
  if (error) return { ok: false, mensagem: `Falha ao rejeitar: ${error.message}` };
  return traduzirDecisao(String(data ?? ""), "rejeitar");
}

// ─── FASE 3 — clonar para nova requisição ───

export interface RequisicaoClonada {
  rateio_cc: RateioCCClasseInput[];
  codigo_funcionario: string;
  funcionario_nome: string | null;
  codigo_centro_ctrl: string;
  codigo_finalidade_compra: string;
  finalidade_compra_label: string | null;
  descricao: string | null;
  cnpj_sugestao_requisicao: string | null;
  data_necessidade: string | null;
  itens: Array<{
    codigo_centro_ctrl?: string;
    item_servico: boolean;
    codigo_produto: string;
    codigo_alternativo_produto: string | null;
    codigo_prod_unid_med: string;
    produto_nome: string | null;
    produto_unidade: string | null;
    quantidade: number;
    quantidade_solicitada: number;
    posicao_prod_unid_med: number;
    observacao: string | null;
    rateio: Array<{ codigo_classe_rec_desp: string; classe_rec_desp_label: string | null; percentual: number }>;
  }>;
  /** Quantidade de anexos da origem — v1 NÃO copia anexos; a tela avisa o usuário. */
  qtd_anexos_nao_copiados: number;
}

/**
 * Lê uma requisição (qualquer status) para pré-preencher o wizard.
 *
 * NÃO grava nada: o rascunho novo só nasce quando o usuário submeter o wizard,
 * já como requisição DELE. É o caminho de reaproveitamento de uma `rejeitada`,
 * que é estado terminal.
 *
 * `data_necessidade` volta apenas se ainda for futura — data vencida faria o
 * wizard nascer inválido.
 */
export async function carregarRequisicaoParaClonar(requisicaoId: string): Promise<RequisicaoClonada> {
  const { data: req, error: errReq } = await (supabase as any)
    .from("compras_requisicoes")
    .select("*")
    .eq("id", requisicaoId)
    .maybeSingle();

  if (errReq) throw new Error(`Erro ao carregar a requisição de origem: ${errReq.message}`);
  if (!req) throw new Error("Requisição de origem não encontrada.");

  const { data: itens, error: errItens } = await (supabase as any)
    .from("compras_requisicoes_itens")
    .select("*")
    .eq("requisicao_id", requisicaoId)
    .order("sequencia", { ascending: true });

  if (errItens) throw new Error(`Erro ao carregar os itens da requisição: ${errItens.message}`);
  if (!itens || itens.length === 0) throw new Error("A requisição de origem não tem itens para copiar.");

  if (itens.some((i: any) => i.quantidade_solicitada == null || i.posicao_prod_unid_med == null)) {
    if (!req.numero_alvo) throw new Error("HISTORICO_UNIDADE_INCOMPLETO: rascunho sem Load original. Recrie os itens informando quantidade e unidade; não é seguro deduzir.");
    const original = objetoAlvo(await callGatewayReqComp(`/req-comp/${encodeURIComponent(req.codigo_empresa_filial)}/${encodeURIComponent(req.numero_alvo)}`, "GET"), "ItemReqCompChildList");
    const lista = original.ItemReqCompChildList as any[];
    for (const item of itens) {
      const matches = lista.filter(i => Number(i.Sequencia) === Number(item.sequencia));
      if (matches.length !== 1 || matches[0].CodigoProduto !== item.codigo_produto) throw new Error("Load original não corresponde aos itens do espelho; sincronize e confira antes de clonar.");
      Object.assign(item, quantidadesLoad(matches[0]));
    }
  }
  for (const item of itens) exigirQuantidadesCompletas(item);

  const itensIds = itens.map((i: any) => i.id);
  const { data: rateios } = await (supabase as any)
    .from("compras_requisicoes_itens_classe_rec_desp")
    .select("*")
    .in("item_id", itensIds);

  const { count: qtdAnexos } = await (supabase as any)
    .from("compras_requisicoes_arquivos")
    .select("id", { count: "exact", head: true })
    .eq("requisicao_id", requisicaoId);

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dataNecessidade = req.data_necessidade ? new Date(`${String(req.data_necessidade).substring(0, 10)}T12:00:00`) : null;
  const dataAindaValida = dataNecessidade && !isNaN(dataNecessidade.getTime()) && dataNecessidade >= hoje;

  return {
    rateio_cc: await carregarRateioCC(requisicaoId),
    codigo_funcionario: req.codigo_funcionario,
    funcionario_nome: req.funcionario_nome,
    codigo_centro_ctrl: req.codigo_centro_ctrl,
    codigo_finalidade_compra: req.codigo_finalidade_compra,
    finalidade_compra_label: req.finalidade_compra_label,
    descricao: req.descricao,
    cnpj_sugestao_requisicao: req.cnpj_sugestao_requisicao,
    data_necessidade: dataAindaValida ? String(req.data_necessidade).substring(0, 10) : null,
    itens: itens.map((item: any) => ({
      codigo_centro_ctrl: item.codigo_centro_ctrl,
      item_servico: !!item.item_servico,
      codigo_produto: item.codigo_produto,
      codigo_alternativo_produto: item.codigo_alternativo_produto,
      codigo_prod_unid_med: item.codigo_prod_unid_med,
      produto_nome: item.produto_nome,
      produto_unidade: item.codigo_prod_unid_med,
      quantidade: Number(item.quantidade),
      quantidade_solicitada: Number(item.quantidade_solicitada),
      posicao_prod_unid_med: Number(item.posicao_prod_unid_med),
      observacao: item.observacao,
      rateio: (rateios || [])
        .filter((r: any) => r.item_id === item.id)
        .map((r: any) => ({
          codigo_classe_rec_desp: r.codigo_classe_rec_desp,
          classe_rec_desp_label: r.classe_rec_desp_label,
          percentual: Number(r.percentual) || 0,
        })),
    })),
    qtd_anexos_nao_copiados: qtdAnexos ?? 0,
  };
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
export async function persistirItensRequisicao(requisicaoId: string, respData: any): Promise<number> {
  const { count, error: errCount } = await (supabase as any)
    .from("compras_requisicoes_itens")
    .select("id", { count: "exact", head: true })
    .eq("requisicao_id", requisicaoId);

  if (errCount) {
    console.error("[persistirItensRequisicao] erro ao contar itens:", errCount);
    return 0;
  }
  if ((count ?? 0) > 0) {
    const { data: existentes, error } = await (supabase as any).from("compras_requisicoes_itens").select("id,sequencia,codigo_produto").eq("requisicao_id", requisicaoId);
    if (error) throw error;
    const lista = objetoAlvo(respData, "ItemReqCompChildList").ItemReqCompChildList as any[];
    const updates = (existentes || []).map((item: any) => {
      const matches = lista.filter(i => Number(i.Sequencia) === Number(item.sequencia));
      if (matches.length !== 1 || matches[0].CodigoProduto !== item.codigo_produto) throw new Error("Load não corresponde ao espelho: confira produto e sequência");
      return { id: item.id, valores: quantidadesLoad(matches[0]) };
    });
    for (const item of updates) {
      const { error: erroUpdate } = await (supabase as any).from("compras_requisicoes_itens").update({ ...item.valores, produto_unidade: item.valores.codigo_prod_unid_med, conversao_unidade: null }).eq("id", item.id);
      if (erroUpdate) throw erroUpdate;
    }
    return 0;
  }

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
    ...quantidadesLoad(it),
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

    const { error: errAuditCancelada } = await (supabase as any).from("compras_requisicoes_auditoria").insert({
      requisicao_id: requisicaoId,
      evento: "cancelada_alvo",
      user_id: userId,
      user_nome: userName,
      sucesso: true,
      mensagem_erro: "Requisição não encontrada no ERP (possivelmente deletada fisicamente).",
      resposta_alvo: respData,
    });
    // Não lança: a mudança de status já foi persistida acima; um throw aqui subiria
    // para o laço de sincronização e derrubaria as outras requisições da rodada.
    if (errAuditCancelada) {
      console.error(
        `[auditoria] falhou ao gravar evento "cancelada_alvo" da requisição ${requisicaoId}: ` +
          errAuditCancelada.message,
      );
    }

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

  const { error: errAuditStatus } = await (supabase as any).from("compras_requisicoes_auditoria").insert({
    requisicao_id: requisicaoId,
    evento,
    user_id: userId,
    user_nome: userName,
    sucesso: true,
    resposta_alvo: respData,
    mensagem_erro: motivo,
  });
  // Não lança: mesma razão do bloco de `cancelada_alvo` acima — a mudança de status
  // já está persistida e este código roda dentro de uma varredura de várias requisições.
  if (errAuditStatus) {
    console.error(
      `[auditoria] falhou ao gravar evento "${evento}" da requisição ${requisicaoId}: ${errAuditStatus.message}`,
    );
  }

  return {
    mudou: true,
    statusAnterior: req.status,
    statusNovo: novoStatusHub,
    motivo,
  };
}

export interface RateioCCClasseInput {
  codigo_classe_rec_desp: string;
  classe_rec_desp_label?: string;
  percentual: number;
  ccs: Array<{ codigo_centro_ctrl: string; centro_ctrl_label?: string; percentual: number }>;
}

export interface AprovacaoCC {
  codigo_centro_ctrl: string;
  situacao: "aprovado" | "dispensado_autor" | "sem_lider" | "pendente" | "rejeitado";
  aprovado_nome?: string;
  aprovado_por: string | null;
  aprovado_em: string | null;
  automatica: boolean;
  lider_atual: boolean;
  lideres: Array<{ user_id: string; nome: string }>;
}

export async function carregarAprovacaoCC(id: string): Promise<AprovacaoCC[]> {
  const { data, error } = await (supabase as any).rpc("requisicao_aprovacao_cc", { p_req_id: id });
  if (error) throw new Error(`Não foi possível consultar as aprovações por CC: ${error.message}`);
  return data || [];
}

export async function carregarRateioCC(id: string): Promise<RateioCCClasseInput[]> {
  const { data, error } = await (supabase as any).from("compras_requisicoes_rateio_classes")
    .select("codigo_classe_rec_desp,classe_rec_desp_label,percentual,ccs:compras_requisicoes_rateio_cc(codigo_centro_ctrl,centro_ctrl_label,percentual)").eq("requisicao_id", id);
  if (error) throw new Error(`Não foi possível carregar o rateio por CC: ${error.message}`);
  return data || [];
}
