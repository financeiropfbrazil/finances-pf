import { supabase } from "@/integrations/supabase/client";

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";
const EMPRESA_FILIAL = "1.01";
const USUARIO_LOGADO = "PEDRO.SCRIGNOLI";
const STORAGE_BUCKET = "compras-pedidos";

// ════════════════════════════════════════════════════════════
// TIPOS — Abordagem A: hierarquia Classe → CCs
// ════════════════════════════════════════════════════════════

export interface RateioCcInput {
  codigo_centro_ctrl: string;
  centro_ctrl_label?: string;
  percentual: number; // % dentro da classe (soma 100% entre CCs)
}

export interface RateioClasseInput {
  codigo_classe_rec_desp: string;
  classe_rec_desp_label: string;
  percentual: number; // % do valor total do item (soma 100% entre classes)
  ccs: RateioCcInput[];
}

export interface ItemPedidoInput {
  item_servico: boolean;
  codigo_produto: string;
  codigo_alternativo_produto: string | null;
  codigo_prod_unid_med: string;
  produto_nome: string;
  produto_unidade: string;
  quantidade: number;
  valor_unitario: number;
  observacao: string;
  rateio: RateioClasseInput[];
}

export interface ParcelaInput {
  sequencia: number;
  dias_entre_parcelas: number;
  percentual_fracao: number;
  valor_parcela: number;
  data_vencimento: string;
}

export interface ArquivoInput {
  file: File;
  upload_identify_guid: string;
}

export interface NovoPedidoInput {
  user_id: string;
  analista_nome: string;
  analista_email: string;

  origem_requisicao_id?: string;
  origem_numero_req_alvo?: string;
  origem_codigo_empresa_filial?: string;

  itens: ItemPedidoInput[];

  codigo_entidade: string;
  nome_entidade: string;
  cnpj_entidade?: string;
  codigo_cond_pag: string;
  nome_cond_pag: string;
  tipo_entrega: "Parcial" | "Total";

  data_pedido: string;
  data_entrega: string;
  data_validade: string;
  data_competencia: string;

  parcelas: ParcelaInput[];
  arquivos?: ArquivoInput[];

  texto_livre: string;
  texto_historico_novo: string;
}

export interface EnvioPedidoResult {
  sucesso: boolean;
  pedido_id: string;
  numero_alvo?: string;
  erro?: string;
}

export interface ArquivoPedido {
  id: string;
  pedido_id: string;
  upload_identify_guid: string;
  nome_original: string;
  storage_path: string;
  mime_type: string;
  tamanho_bytes: number;
  numero_alvo_ao_enviar: string | null;
  uploaded_by_user_id: string | null;
  created_at: string;
}

export interface CloneReqResult {
  origem_requisicao_id: string;
  origem_numero_req_alvo: string;
  origem_codigo_empresa_filial: string;
  cnpj_sugerido: string | null;
  itens_clonados: Array<{
    codigo_produto: string;
    codigo_alternativo_produto: string | null;
    codigo_prod_unid_med: string;
    produto_nome: string;
    produto_unidade: string;
    quantidade: number;
    item_servico: boolean;
    observacao: string;
    rateio_sugerido: RateioClasseInput[];
  }>;
  texto_sugerido: string;
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

function formatarDataParaAlvo(dataYMD: string): string {
  return `${dataYMD.substring(0, 10)}T03:00:00.000Z`;
}

function dataHoraAgoraUtc(): string {
  return new Date().toISOString();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function montarStampAnalista(input: NovoPedidoInput): string {
  const idCurto = input.user_id.substring(0, 8);
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  return `[Hub] Analista: ${input.analista_nome} | ${dd}/${mm}/${yyyy} ${hh}:${mi} | ID: ${idCurto}`;
}

function montarTextoCompleto(input: NovoPedidoInput): string {
  const stamp = montarStampAnalista(input);
  return input.texto_livre ? `${stamp}\n${input.texto_livre}` : stamp;
}

function montarTextoHistoricoCompleto(input: NovoPedidoInput): string {
  const stamp = montarStampAnalista(input);
  return input.texto_historico_novo ? `${stamp}\n${input.texto_historico_novo}` : stamp;
}

async function getSupabaseJWT(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sessão do Supabase inválida. Faça login novamente.");
  }
  return session.access_token;
}

async function callGatewayMultipart(path: string, formData: FormData): Promise<any> {
  const jwt = await getSupabaseJWT();
  const url = `${ERP_PROXY_URL}${path}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: formData,
  });
  let data: any = null;
  try {
    data = await resp.json();
  } catch {}
  if (!resp.ok) {
    const msg = data?.error || `HTTP ${resp.status}`;
    const err = new Error(msg) as Error & { status?: number; details?: any };
    err.status = resp.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}

// ════════════════════════════════════════════════════════════
// MONTAGEM DO PAYLOAD PEDCOMP
// ════════════════════════════════════════════════════════════

interface MontarPayloadParams {
  input: NovoPedidoInput;
  texto_completo: string;
  texto_historico_completo: string;
  arquivos_guids?: string[];
}

function montarPayloadPedComp(p: MontarPayloadParams): any {
  const { input, texto_completo, texto_historico_completo, arquivos_guids } = p;

  const valorMercadoria = round2(input.itens.reduce((acc, it) => acc + it.quantidade * it.valor_unitario, 0));
  const valorTotal = valorMercadoria;
  const origem = input.origem_requisicao_id ? "Requisição" : "Pedido";

  const dataPedido = formatarDataParaAlvo(input.data_pedido);
  const dataValidade = formatarDataParaAlvo(input.data_validade);
  const dataEntrega = formatarDataParaAlvo(input.data_entrega);
  const dataCompetencia = formatarDataParaAlvo(input.data_competencia);
  const dataBaseVencimento = dataPedido;
  const dataHoraDigitacao = dataHoraAgoraUtc();

  const itensPayload = input.itens.map((item) => {
    const valorTotalItem = round2(item.quantidade * item.valor_unitario);

    const classesPayload = item.rateio.map((cls) => {
      const valorClasse = round2((valorTotalItem * cls.percentual) / 100);

      const rateiosCC = cls.ccs.map((cc) => {
        const valorCC = round2((valorClasse * cc.percentual) / 100);
        return {
          CodigoEmpresaFilial: "-1",
          NumeroPedComp: "-1",
          CodigoProduto: "-1",
          SequenciaItemPedComp: 0,
          CodigoClasseRecDesp: "-1",
          CodigoCentroCtrl: cc.codigo_centro_ctrl,
          Valor: valorCC,
          Percentual: cc.percentual,
        };
      });

      return {
        CodigoEmpresaFilial: "-1",
        NumeroPedComp: "-1",
        CodigoProduto: "-1",
        SequenciaItemPedComp: 0,
        CodigoClasseRecDesp: cls.codigo_classe_rec_desp,
        Valor: valorClasse,
        Percentual: cls.percentual,
        RateioItemPedCompChildList: rateiosCC,
      };
    });

    return {
      CodigoEmpresaFilial: "",
      NumeroPedComp: "",
      CodigoProduto: item.codigo_produto,
      Sequencia: 0,
      CodigoProdUnidMed: item.codigo_prod_unid_med,
      ValorUnitario: item.valor_unitario,
      ValorTotal: valorTotalItem,
      ValorFinal: valorTotalItem,
      BaseICMS: 0,
      PercentualICMS: 0,
      ValorICMS: 0,
      SaldoQuantidade: item.quantidade,
      CodigoProdUnidMedValor: item.codigo_prod_unid_med,
      Quantidade2: item.quantidade,
      ValorUnitarioCalculado: item.valor_unitario,
      ValorMultiplicador: 1,
      NomeProduto: item.produto_nome,
      DescricaoAlternativaProduto: item.produto_nome,
      CodigoAlternativoProduto: item.codigo_alternativo_produto || "",
      DescricaoItem: item.observacao || item.produto_nome,
      ItemPedCompClasseRecdespChildList: classesPayload,
    };
  });

  const parcelasPayload = input.parcelas.map((p) => ({
    CodigoEmpresaFilial: EMPRESA_FILIAL,
    NumeroPedComp: "",
    Sequencia: p.sequencia,
    NumeroDuplicata: `/${p.sequencia}-${input.parcelas.length}`,
    DiasEntreParcelas: p.dias_entre_parcelas,
    PercentualFracao: p.percentual_fracao,
    ValorParcela: p.valor_parcela,
    DataVencimento: formatarDataParaAlvo(p.data_vencimento),
  }));

  // Rateio agregado do PEDIDO (soma de todos itens)
  const rateioAgregado = new Map<string, Map<string, { valor: number; pct: number }>>();

  for (const item of input.itens) {
    const valorTotalItem = round2(item.quantidade * item.valor_unitario);
    for (const cls of item.rateio) {
      const valorClasse = round2((valorTotalItem * cls.percentual) / 100);
      for (const cc of cls.ccs) {
        const valorCC = round2((valorClasse * cc.percentual) / 100);

        if (!rateioAgregado.has(cls.codigo_classe_rec_desp)) {
          rateioAgregado.set(cls.codigo_classe_rec_desp, new Map());
        }
        const ccMap = rateioAgregado.get(cls.codigo_classe_rec_desp)!;
        const existing = ccMap.get(cc.codigo_centro_ctrl) || { valor: 0, pct: 0 };
        ccMap.set(cc.codigo_centro_ctrl, {
          valor: round2(existing.valor + valorCC),
          pct: existing.pct + (valorCC / valorTotal) * 100,
        });
      }
    }
  }

  const pedCompClassesPayload = Array.from(rateioAgregado.entries()).map(([codigoClasse, ccMap]) => {
    const linhasCC = Array.from(ccMap.entries()).map(([codigoCC, { valor, pct }]) => ({
      CodigoEmpresaFilial: "-1",
      NumeroPedComp: "-1",
      CodigoClasseRecDesp: "-1",
      CodigoCentroCtrl: codigoCC,
      Valor: valor,
      Percentual: round2(pct),
    }));

    const valorClasseTotal = round2(linhasCC.reduce((s, l) => s + l.Valor, 0));
    const pctClasseTotal = round2(linhasCC.reduce((s, l) => s + l.Percentual, 0));

    return {
      CodigoEmpresaFilial: "-1",
      NumeroPedComp: "-1",
      CodigoClasseRecDesp: codigoClasse,
      Valor: valorClasseTotal,
      Percentual: pctClasseTotal,
      RateioPedCompChildList: linhasCC,
    };
  });

  const arquivoChildList = arquivos_guids
    ? arquivos_guids.map((guid, idx) => ({
        CodigoEmpresaFilial: -1,
        NumeroPedComp: -1,
        Sequencia: idx + 1,
        Arquivo: null,
        UploadIdentify: guid,
      }))
    : [];

  const filesToUpload = arquivos_guids
    ? arquivos_guids.map((guid) => ({
        key: `${guid}#Arquivo`,
        file: {},
      }))
    : [];

  const payload: any = {
    CondPagPedCompObject: {
      CodigoEmpresaFilial: "",
      Numero: "",
      CodigoCondPag: input.codigo_cond_pag,
      Nome: input.nome_cond_pag,
    },
    PedCompUserFieldsObject: {},
    CodigoEmpresaFilial: EMPRESA_FILIAL,
    Numero: "",
    DataPedido: dataPedido,
    DataCadastro: dataPedido,
    DataValidade: dataValidade,
    DataEntrega: dataEntrega,
    DataBaseVencimento: dataBaseVencimento,
    DataCompetencia: dataCompetencia,
    CodigoEntidade: input.codigo_entidade,
    CodigoTabPv: "000000000000001",
    ValorMercadoria: valorMercadoria,
    BaseICMS: 0,
    ValorICMS: 0,
    GeralBaseICMS: 0,
    GeralValorICMS: 0,
    ValorTotal: valorTotal,
    CodigoEntidadeTransportadora: input.codigo_entidade,
    PercentualAcrescimoFinanceiroProduto: null,
    PercentualDescontoEspecialProduto: null,
    PercentualAcrescimoFinanceiroServico: null,
    PercentualDescontoEspecialServico: null,
    ValorCambio: 1,
    CodigoUsuario: USUARIO_LOGADO,
    Texto: texto_completo,
    Origem: origem,
    CodigoTipoPagRec: "0000016",
    DataBaseVencimentoParcela: "Data do Pedido",
    NomeEntidade: input.nome_entidade,
    DataHoraDigitacao: dataHoraDigitacao,
    CasasDecimaisValorUnitario: 5,
    TipoEntrega: input.tipo_entrega,
    ItemPedCompChildList: itensPayload,
    ParcPagPedCompChildList: parcelasPayload,
    PedCompArquivoChildList: arquivoChildList,
    PedCompClasseRecDespChildList: pedCompClassesPayload,
    ExecutaOnAfterSave: false,
    ValidaSalvarPedido: true,
    Chamou: "beforeSaveChild",
    TextoHistoricoNovo: texto_historico_completo,
    InformacaoCotacaoCompra: "",
    CodigoFuncionarioReqComp: null,
    EmailFuncionario: null,
    NomeComprador: null,
    EmailComprador: null,
    ImpostoZerado: "Não",
    UsuarioLogado: USUARIO_LOGADO,
    UploadIdentify: "",
    filesToUpload,
  };

  if (input.origem_codigo_empresa_filial && input.origem_numero_req_alvo) {
    payload.CodigoEmpresaFilialReqComp = input.origem_codigo_empresa_filial;
    payload.NumeroReqComp = input.origem_numero_req_alvo;
  }

  return payload;
}

// ════════════════════════════════════════════════════════════
// HELPERS DE PERSISTÊNCIA
// ════════════════════════════════════════════════════════════

async function salvarArquivoNoStorage(pedidoId: string, arquivo: ArquivoInput, userId: string): Promise<ArquivoPedido> {
  const extensao = arquivo.file.name.split(".").pop()?.toLowerCase() || "bin";
  const storagePath = `${pedidoId}/${arquivo.upload_identify_guid}.${extensao}`;

  const { error: uploadErr } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, arquivo.file, {
    contentType: arquivo.file.type,
    upsert: false,
  });

  if (uploadErr) {
    throw new Error(`Erro ao fazer upload do arquivo "${arquivo.file.name}": ${uploadErr.message}`);
  }

  const { data, error: insertErr } = await (supabase as any)
    .from("compras_pedidos_arquivos")
    .insert({
      pedido_id: pedidoId,
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
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
    throw new Error(`Erro ao gravar metadados do arquivo: ${insertErr?.message}`);
  }

  return data as ArquivoPedido;
}

function montarFormDataMultipart(payload: any, arquivos: Array<{ guid: string; blob: Blob; nome: string }>): FormData {
  const formData = new FormData();
  formData.append("obj", JSON.stringify(payload));
  for (const arq of arquivos) {
    formData.append(`${arq.guid}#Arquivo`, arq.blob, arq.nome);
  }
  return formData;
}

// ════════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL: enviarPedido
// ════════════════════════════════════════════════════════════

export async function enviarPedido(input: NovoPedidoInput): Promise<EnvioPedidoResult> {
  if (input.arquivos && input.arquivos.length > 3) {
    throw new Error("Máximo de 3 arquivos por pedido.");
  }

  const textoCompleto = montarTextoCompleto(input);
  const textoHistoricoCompleto = montarTextoHistoricoCompleto(input);

  let pedidoId: string | null = null;

  try {
    const valorTotal = input.itens.reduce((acc, it) => acc + it.quantidade * it.valor_unitario, 0);

    const { data: pedidoCriado, error: errPed } = await (supabase as any)
      .from("compras_pedidos")
      .insert({
        codigo_empresa_filial: EMPRESA_FILIAL,
        numero: `RASCUNHO-${Date.now()}`,
        status_local: "rascunho",
        criado_no_hub: true,
        criado_por_user_id: input.user_id,
        criado_por_nome: input.analista_nome,
        data_pedido: input.data_pedido,
        data_cadastro: input.data_pedido,
        data_entrega: input.data_entrega,
        data_validade: input.data_validade,
        codigo_entidade: input.codigo_entidade,
        nome_entidade: input.nome_entidade,
        cnpj_entidade: input.cnpj_entidade || null,
        codigo_cond_pag: input.codigo_cond_pag,
        nome_cond_pag: input.nome_cond_pag,
        codigo_usuario: USUARIO_LOGADO,
        texto: textoCompleto,
        valor_mercadoria: round2(valorTotal),
        valor_total: round2(valorTotal),
        tipo: "Total",
        numero_req_comp: input.origem_numero_req_alvo || null,
        codigo_empresa_filial_req_comp: input.origem_codigo_empresa_filial || null,
      })
      .select("id")
      .single();

    if (errPed || !pedidoCriado) {
      throw new Error(`Erro ao criar pedido: ${errPed?.message}`);
    }

    pedidoId = pedidoCriado.id;

    // Itens + rateio (achatado: 1 linha por par classe-cc)
    for (let idx = 0; idx < input.itens.length; idx++) {
      const item = input.itens[idx];
      const valorTotalItem = round2(item.quantidade * item.valor_unitario);

      const { data: itemCriado, error: errItem } = await (supabase as any)
        .from("compras_pedidos_itens")
        .insert({
          pedido_id: pedidoId,
          sequencia: idx + 1,
          item_servico: item.item_servico,
          codigo_produto: item.codigo_produto,
          codigo_alternativo_produto: item.codigo_alternativo_produto,
          codigo_prod_unid_med: item.codigo_prod_unid_med,
          produto_nome: item.produto_nome,
          produto_unidade: item.produto_unidade,
          quantidade: item.quantidade,
          valor_unitario: item.valor_unitario,
          valor_total_item: valorTotalItem,
          observacao: item.observacao || null,
        })
        .select("id")
        .single();

      if (errItem || !itemCriado) {
        throw new Error(`Erro ao criar item ${idx + 1}: ${errItem?.message}`);
      }

      // Salva rateio achatado:
      // Cada combinação (classe, cc) vira 1 linha com percentual relativo ao TOTAL DO ITEM
      // = (% da classe) × (% do CC dentro da classe) ÷ 100
      for (const cls of item.rateio) {
        for (const cc of cls.ccs) {
          const percFinal = round2((cls.percentual * cc.percentual) / 100);
          await (supabase as any).from("compras_pedidos_itens_rateio").insert({
            item_id: itemCriado.id,
            codigo_classe_rec_desp: cls.codigo_classe_rec_desp,
            classe_rec_desp_label: cls.classe_rec_desp_label,
            codigo_centro_ctrl: cc.codigo_centro_ctrl,
            centro_ctrl_label: cc.centro_ctrl_label,
            percentual: percFinal,
          });
        }
      }
    }

    for (const p of input.parcelas) {
      await (supabase as any).from("compras_pedidos_parcelas").insert({
        pedido_id: pedidoId,
        sequencia: p.sequencia,
        dias_entre_parcelas: p.dias_entre_parcelas,
        percentual_fracao: p.percentual_fracao,
        valor_parcela: p.valor_parcela,
        data_vencimento: p.data_vencimento,
      });
    }

    if (input.arquivos && input.arquivos.length > 0) {
      for (const arquivo of input.arquivos) {
        await salvarArquivoNoStorage(pedidoId!, arquivo, input.user_id);
      }
    }

    await (supabase as any).from("compras_pedidos_auditoria").insert({
      pedido_id: pedidoId,
      evento: "criado_hub",
      user_id: input.user_id,
      user_nome: input.analista_nome,
      sucesso: true,
    });

    await (supabase as any).from("compras_pedidos").upsert(
      {
        id: pedidoId,
        codigo_empresa_filial: EMPRESA_FILIAL,
        numero: `RASCUNHO-${Date.now()}`,
        status_local: "enviando",
      },
      { onConflict: "id" },
    );

    const guids = input.arquivos?.map((a) => a.upload_identify_guid) || [];
    const payload = montarPayloadPedComp({
      input,
      texto_completo: textoCompleto,
      texto_historico_completo: textoHistoricoCompleto,
      arquivos_guids: guids.length > 0 ? guids : undefined,
    });

    await (supabase as any).from("compras_pedidos_auditoria").insert({
      pedido_id: pedidoId,
      evento: "envio_tentado",
      user_id: input.user_id,
      user_nome: input.analista_nome,
      payload_enviado: payload,
      sucesso: true,
    });

    const blobs = (input.arquivos || []).map((a) => ({
      guid: a.upload_identify_guid,
      blob: a.file,
      nome: a.file.name,
    }));

    const formData = montarFormDataMultipart(payload, blobs);

    try {
      const respData = await callGatewayMultipart("/ped-comp/insert-multipart", formData);

      const numeroAlvo = respData?.Numero || "";

      await (supabase as any).from("compras_pedidos").upsert(
        {
          id: pedidoId,
          codigo_empresa_filial: EMPRESA_FILIAL,
          numero: numeroAlvo,
          status_local: "enviado_alvo",
          status: respData?.Status || null,
          aprovado: respData?.Aprovado || null,
          status_aprovacao: respData?.StatusAprovacao || null,
          comprado: respData?.Comprado || null,
          tipo: respData?.Tipo || null,
          proximo_aprovador: respData?.PedCompUserFieldsObject?.UserProximoAprovador || null,
          enviou_aprovacao: respData?.PedCompUserFieldsObject?.UserEnviouAprovacao || null,
          enviado_em: new Date().toISOString(),
          erro_envio: null,
        },
        { onConflict: "id" },
      );

      for (const guid of guids) {
        const { error: errMarcar } = await (supabase as any).rpc("marcar_arquivo_ped_enviado", {
          p_guid: guid,
          p_numero_alvo: numeroAlvo,
        });
        if (errMarcar) {
          console.warn(`Aviso: falha ao marcar arquivo ${guid} como enviado:`, errMarcar.message);
        }
      }

      if (input.origem_requisicao_id) {
        const { data: reqRow } = await (supabase as any)
          .from("compras_requisicoes")
          .select(
            "id, requisitante_user_id, status, codigo_empresa_filial, codigo_funcionario, codigo_centro_ctrl, codigo_finalidade_compra, data_necessidade, total_itens",
          )
          .eq("id", input.origem_requisicao_id)
          .single();

        if (reqRow) {
          await (supabase as any).from("compras_requisicoes").upsert(
            {
              id: reqRow.id,
              requisitante_user_id: reqRow.requisitante_user_id,
              status: reqRow.status,
              codigo_empresa_filial: reqRow.codigo_empresa_filial,
              codigo_funcionario: reqRow.codigo_funcionario,
              codigo_centro_ctrl: reqRow.codigo_centro_ctrl,
              codigo_finalidade_compra: reqRow.codigo_finalidade_compra,
              data_necessidade: reqRow.data_necessidade,
              total_itens: reqRow.total_itens,
              numero_pedido_compra_alvo: numeroAlvo,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );
        }
      }

      await (supabase as any).from("compras_pedidos_auditoria").insert({
        pedido_id: pedidoId,
        evento: "envio_sucesso",
        user_id: input.user_id,
        user_nome: input.analista_nome,
        resposta_alvo: respData,
        sucesso: true,
      });

      return { sucesso: true, pedido_id: pedidoId!, numero_alvo: numeroAlvo };
    } catch (errEnvio: any) {
      const msgErro = errEnvio?.message || String(errEnvio);

      await (supabase as any).from("compras_pedidos").upsert(
        {
          id: pedidoId,
          codigo_empresa_filial: EMPRESA_FILIAL,
          numero: `RASCUNHO-${pedidoId!.substring(0, 8)}`,
          status_local: "erro_envio",
          erro_envio: {
            message: msgErro,
            details: errEnvio?.details || null,
            timestamp: new Date().toISOString(),
          },
        },
        { onConflict: "id" },
      );

      await (supabase as any).from("compras_pedidos_auditoria").insert({
        pedido_id: pedidoId,
        evento: "envio_falha",
        user_id: input.user_id,
        user_nome: input.analista_nome,
        sucesso: false,
        mensagem_erro: msgErro,
      });

      return { sucesso: false, pedido_id: pedidoId!, erro: msgErro };
    }
  } catch (errCriacao: any) {
    const msgErro = errCriacao?.message || String(errCriacao);

    if (pedidoId) {
      await (supabase as any).from("compras_pedidos").upsert(
        {
          id: pedidoId,
          codigo_empresa_filial: EMPRESA_FILIAL,
          numero: `RASCUNHO-${pedidoId.substring(0, 8)}`,
          status_local: "erro_envio",
          erro_envio: {
            message: `Erro durante criação: ${msgErro}`,
            timestamp: new Date().toISOString(),
          },
        },
        { onConflict: "id" },
      );

      await (supabase as any).from("compras_pedidos_auditoria").insert({
        pedido_id: pedidoId,
        evento: "envio_falha",
        user_id: input.user_id,
        user_nome: input.analista_nome,
        sucesso: false,
        mensagem_erro: `Erro durante criação: ${msgErro}`,
      });

      return { sucesso: false, pedido_id: pedidoId, erro: msgErro };
    }

    throw errCriacao;
  }
}

// ════════════════════════════════════════════════════════════
// EXCLUIR PEDIDO
// ════════════════════════════════════════════════════════════

export async function excluirPedido(pedidoId: string): Promise<void> {
  const { data: ped, error } = await (supabase as any)
    .from("compras_pedidos")
    .select("status_local")
    .eq("id", pedidoId)
    .single();

  if (error || !ped) throw new Error(`Pedido não encontrado: ${error?.message}`);

  if (ped.status_local !== "rascunho" && ped.status_local !== "erro_envio") {
    throw new Error("Só é possível excluir pedidos com status rascunho ou erro_envio.");
  }

  const { data: arquivos } = await (supabase as any)
    .from("compras_pedidos_arquivos")
    .select("storage_path")
    .eq("pedido_id", pedidoId);

  if (arquivos && arquivos.length > 0) {
    const paths = arquivos.map((a: any) => a.storage_path);
    await supabase.storage.from(STORAGE_BUCKET).remove(paths);
  }

  const { error: errDel } = await (supabase as any).from("compras_pedidos").delete().eq("id", pedidoId);

  if (errDel) throw new Error(`Erro ao excluir pedido: ${errDel.message}`);
}

// ════════════════════════════════════════════════════════════
// CLONAR DE REQUISIÇÃO
// ════════════════════════════════════════════════════════════

export async function clonarDeRequisicao(requisicaoId: string): Promise<CloneReqResult> {
  const { data: req, error: errReq } = await (supabase as any)
    .from("compras_requisicoes")
    .select("*")
    .eq("id", requisicaoId)
    .single();

  if (errReq || !req) {
    throw new Error(`Requisição não encontrada: ${errReq?.message}`);
  }

  if (req.status !== "sincronizada") {
    throw new Error(
      `Requisição precisa estar com status='sincronizada' para gerar pedido. Status atual: ${req.status}`,
    );
  }

  if (req.numero_pedido_compra_alvo) {
    throw new Error(`Esta requisição já gerou o pedido ${req.numero_pedido_compra_alvo}.`);
  }

  const { data: itens, error: errItens } = await (supabase as any)
    .from("compras_requisicoes_itens")
    .select("*, compras_requisicoes_itens_classe_rec_desp(codigo_classe_rec_desp, classe_rec_desp_label, percentual)")
    .eq("requisicao_id", requisicaoId)
    .order("sequencia", { ascending: true });

  if (errItens || !itens) {
    throw new Error(`Erro ao carregar itens da requisição: ${errItens?.message}`);
  }

  const itensClonados = itens.map((item: any) => {
    const rateioReq = item.compras_requisicoes_itens_classe_rec_desp || [];

    // Cada classe da Req vira 1 classe no rateio do Pedido,
    // com 1 CC dentro (do item da Req) com 100% interno
    const rateioSugerido: RateioClasseInput[] = rateioReq.map((r: any) => ({
      codigo_classe_rec_desp: r.codigo_classe_rec_desp,
      classe_rec_desp_label: r.classe_rec_desp_label,
      percentual: Number(r.percentual),
      ccs: [
        {
          codigo_centro_ctrl: item.codigo_centro_ctrl,
          percentual: 100,
        },
      ],
    }));

    return {
      codigo_produto: item.codigo_produto,
      codigo_alternativo_produto: item.codigo_alternativo_produto,
      codigo_prod_unid_med: item.codigo_prod_unid_med,
      produto_nome: item.produto_nome,
      produto_unidade: item.produto_unidade,
      quantidade: Number(item.quantidade),
      item_servico: item.item_servico,
      observacao: item.observacao || "",
      rateio_sugerido: rateioSugerido,
    };
  });

  return {
    origem_requisicao_id: req.id,
    origem_numero_req_alvo: req.numero_alvo,
    origem_codigo_empresa_filial: req.codigo_empresa_filial,
    cnpj_sugerido: req.cnpj_sugestao_requisicao || null,
    itens_clonados: itensClonados,
    texto_sugerido: req.descricao || "",
  };
}

// ════════════════════════════════════════════════════════════
// LISTAR/CARREGAR
// ════════════════════════════════════════════════════════════

export async function listarArquivosDoPedido(pedidoId: string): Promise<ArquivoPedido[]> {
  const { data, error } = await (supabase as any)
    .from("compras_pedidos_arquivos")
    .select("*")
    .eq("pedido_id", pedidoId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Erro ao listar arquivos: ${error.message}`);
  return (data || []) as ArquivoPedido[];
}

export async function getUrlAssinadaArquivoPedido(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 300);
  if (error || !data?.signedUrl) {
    throw new Error(`Erro ao gerar URL: ${error?.message}`);
  }
  return data.signedUrl;
}

export async function removerArquivoPedido(arquivoId: string): Promise<void> {
  const { data: arq, error: errBusca } = await (supabase as any)
    .from("compras_pedidos_arquivos")
    .select("storage_path")
    .eq("id", arquivoId)
    .single();

  if (errBusca || !arq) {
    throw new Error(`Arquivo não encontrado: ${errBusca?.message}`);
  }

  await supabase.storage.from(STORAGE_BUCKET).remove([arq.storage_path]);

  const { error: errDel } = await (supabase as any).from("compras_pedidos_arquivos").delete().eq("id", arquivoId);

  if (errDel) throw new Error(`Erro ao remover metadados do arquivo: ${errDel.message}`);
}

// ════════════════════════════════════════════════════════════
// CALCULAR PARCELAS
// ════════════════════════════════════════════════════════════

export async function calcularParcelas(
  codigoCondPag: string,
  valorTotal: number,
  dataBase: string,
): Promise<ParcelaInput[]> {
  const { data: linhasParc, error } = await (supabase as any)
    .from("condicoes_pagamento_parcelas")
    .select("numero, dias_prazo, percentual_fracao")
    .eq("codigo_cond_pag", codigoCondPag)
    .order("numero", { ascending: true });

  if (error || !linhasParc || linhasParc.length === 0) {
    throw new Error(`Condição de pagamento ${codigoCondPag} sem parcelas cadastradas.`);
  }

  const parcelas: ParcelaInput[] = [];
  let somaAcumulada = 0;
  const baseDate = new Date(`${dataBase}T03:00:00.000Z`);

  for (let i = 0; i < linhasParc.length; i++) {
    const p = linhasParc[i] as any;
    const isLast = i === linhasParc.length - 1;

    let valorParcela: number;
    if (isLast) {
      valorParcela = round2(valorTotal - somaAcumulada);
    } else {
      valorParcela = round2(valorTotal / Number(p.percentual_fracao));
      somaAcumulada += valorParcela;
    }

    const dataVenc = new Date(baseDate);
    dataVenc.setDate(dataVenc.getDate() + p.dias_prazo);
    const dataVencYMD = dataVenc.toISOString().slice(0, 10);

    const diasEntre = i === 0 ? 0 : p.dias_prazo - (linhasParc[i - 1] as any).dias_prazo;

    parcelas.push({
      sequencia: p.numero,
      dias_entre_parcelas: diasEntre,
      percentual_fracao: Number(p.percentual_fracao),
      valor_parcela: valorParcela,
      data_vencimento: dataVencYMD,
    });
  }

  return parcelas;
}
