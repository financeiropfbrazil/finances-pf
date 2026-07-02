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
  return `[Hub] Operador de Compras: ${input.analista_nome} | ${dd}/${mm}/${yyyy} ${hh}:${mi} | ID: ${idCurto}`;
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

/**
 * Chamada JSON ao gateway (sem multipart).
 * Usado para endpoints que esperam payload JSON puro, como /ped-comp/atualiza-item-pedido.
 */
async function callGatewayJson(path: string, payload: any): Promise<any> {
  const jwt = await getSupabaseJWT();
  const url = `${ERP_PROXY_URL}${path}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
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
/**
 * Chamada GET ao gateway (com JWT). Usada para buscar o Load de uma
 * requisição antes de baixá-la.
 */
async function callGatewayGet(path: string): Promise<any> {
  const jwt = await getSupabaseJWT();
  const url = `${ERP_PROXY_URL}${path}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${jwt}` },
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
// ═══════════════════════════════════════════════════════════════════
// RESOLVER USUARIO ALVO (CodigoUsuario = login Alvo do operador)
// ═══════════════════════════════════════════════════════════════════
//
// O dashboard mostra na coluna "Comprador" o compras_pedidos.codigo_usuario,
// alimentado pelo CodigoUsuario do payload. O Alvo respeita esse campo
// (confirmado: a sessão erp-proxy é conta de serviço única, e os pedidos
// saíam carimbados conforme o payload, não conforme o token). Resolve o
// login Alvo do operador (profiles.alvo_usuario) a partir do user_id logado.
//
// Robusto a esquema: tenta profiles.user_id = auth uid (chave canônica; NÃO é
// profiles.id); se não achar, cai pra email; só então usa o fallback da conta de serviço.
async function resolverUsuarioAlvo(userId: string, email?: string | null): Promise<string> {
  const porId = await (supabase as any).from("profiles").select("alvo_usuario").eq("user_id", userId).maybeSingle();
  if (porId?.data?.alvo_usuario) return porId.data.alvo_usuario;

  if (email) {
    const porEmail = await (supabase as any).from("profiles").select("alvo_usuario").eq("email", email).maybeSingle();
    if (porEmail?.data?.alvo_usuario) return porEmail.data.alvo_usuario;
  }

  console.error(
    `[resolverUsuarioAlvo] profile sem alvo_usuario (user=${userId} email=${email ?? "?"}) — fallback ${USUARIO_LOGADO}`,
  );
  return USUARIO_LOGADO;
}
// ═══════════════════════════════════════════════════════════════════
// RESOLVER CODIGO COMPRADOR (requisitante se vínculo; senão operador)
// ═══════════════════════════════════════════════════════════════════
//
// Regra de negócio:
//   1. Pedido COM vínculo a requisição → comprador = REQUISITANTE
//      (codigo_funcionario gravado na requisição de origem).
//   2. Pedido SEM vínculo → comprador = OPERADOR que emitiu
//      (funcionario_alvo_codigo do profile do usuário logado).
//   3. Fallback → null (o Alvo aplica seu default).
//
// Função no NÍVEL DO MÓDULO (fora de montarPayloadPedComp) para que
// enviarPedido possa chamá-la.

async function resolverCodigoComprador(input: NovoPedidoInput): Promise<string | null> {
  // CodigoComprador SEMPRE null. (Decisão 22/06/2026)
  //
  // No Alvo, "comprador" (tabela COMPRADOR) e "funcionário" (tabela
  // FUNCIONARIO) são cadastros DISTINTOS, com códigos diferentes para a
  // mesma pessoa — ex.: Elisangela = funcionário 0000112, comprador 0000013.
  // O Hub só conhece o funcionario_alvo_codigo; mandá-lo como CodigoComprador
  // quebra a FK FK_PED_COMP_REF_5411_COMPRADO quando o código não existe em
  // COMPRADOR. O Alvo ACEITA CodigoComprador null (confirmado: pedidos do
  // Pedro saem assim e funcionam) e aplica seu default. Quem criou o pedido
  // continua rastreável via CodigoUsuario. Por isso: sempre null.
  //
  // O parâmetro `input` é mantido na assinatura para não alterar a chamada
  // em enviarPedido (e permitir reintroduzir lógica no futuro, se preciso).
  return null;
}

// ████████████████████████████████████████████████████████████████████
// baixarRequisicaoAlvo + desembrulharReq
// ████████████████████████████████████████████████████████████████████

/**
 * Tenta extrair o objeto "plano" da requisição de qualquer envelope
 * que o GET do proxy possa devolver:
 *   - objeto direto:            { CodigoEmpresaFilial, Numero, ItemReqCompChildList, ... }
 *   - dentro de .data:          { data: { ...req... } }
 *   - lista nomeada:            { listaReqComp: [ { ...req... } ] }
 *   - array puro:               [ { ...req... } ]
 * Retorna null se não achar um objeto com ItemReqCompChildList.
 */
function desembrulharReq(bruto: any): any | null {
  if (!bruto || typeof bruto !== "object") return null;

  // 1. Objeto direto já com a lista de itens
  if (Array.isArray(bruto.ItemReqCompChildList) && bruto.Numero) {
    return bruto;
  }

  // 2. Envelope { data: ... }
  if (bruto.data && typeof bruto.data === "object") {
    const d = bruto.data;
    if (Array.isArray(d.ItemReqCompChildList) && d.Numero) return d;
    if (Array.isArray(d) && d[0]?.ItemReqCompChildList) return d[0];
  }

  // 3. Listas nomeadas conhecidas
  for (const chave of ["listaReqComp", "ReqComp", "result", "Result"]) {
    const v = bruto[chave];
    if (Array.isArray(v) && v[0]?.ItemReqCompChildList && v[0]?.Numero) return v[0];
    if (v && typeof v === "object" && Array.isArray(v.ItemReqCompChildList) && v.Numero) return v;
  }

  // 4. Array puro
  if (Array.isArray(bruto) && bruto[0]?.ItemReqCompChildList && bruto[0]?.Numero) {
    return bruto[0];
  }

  return null;
}

/**
 * "Baixa" a requisição no Alvo depois que o Hub gerou um pedido a partir dela.
 * v1 (Postura A + Opção 1): atualiza SOMENTE a requisição, sempre "Total".
 * Retorna { ok, erro } — `erro` traz a mensagem real do Alvo/proxy.
 * Best-effort: nunca lança; o pedido já foi criado e não é afetado.
 */
async function baixarRequisicaoAlvo(params: {
  codigoEmpresaFilialReq: string;
  numeroReqAlvo: string;
  numeroPedidoAlvo: string;
}): Promise<{ ok: boolean; erro?: string }> {
  const { codigoEmpresaFilialReq, numeroReqAlvo, numeroPedidoAlvo } = params;

  try {
    // ── 1. Carrega a req atual e desembrulha ──
    const bruto = await callGatewayGet(
      `/req-comp/${encodeURIComponent(codigoEmpresaFilialReq)}/${encodeURIComponent(numeroReqAlvo)}`,
    );

    const reqAtual = desembrulharReq(bruto);

    if (!reqAtual) {
      const amostra = JSON.stringify(bruto)?.slice(0, 300);
      const erro = `GET da req ${numeroReqAlvo} não trouxe ItemReqCompChildList reconhecível. Retorno: ${amostra}`;
      console.warn(`[baixaReq] ${erro}`);
      return { ok: false, erro };
    }

    // Idempotência: se já baixada, nada a fazer.
    if (reqAtual.Status === "Pedido" && reqAtual.GerouPedComp === "Total") {
      console.log(`[baixaReq] req ${numeroReqAlvo} já estava baixada.`);
      return { ok: true };
    }

    // ── 2. Altera os campos de baixa ──
    reqAtual.Status = "Pedido";
    reqAtual.GerouPedComp = "Total";
    if (Array.isArray(reqAtual.ItemReqCompChildList)) {
      for (const item of reqAtual.ItemReqCompChildList) {
        item.GerouPedComp = "T";
        item.NumeroPedComp = numeroPedidoAlvo;
      }
    }

    // ── 3. Devolve via update ──
    const resp = await callGatewayJson("/req-comp/update", reqAtual);
    console.log(
      `[baixaReq] req ${numeroReqAlvo} baixada → pedido ${numeroPedidoAlvo} (Status: ${resp?.Status || "?"}).`,
    );
    return { ok: true };
  } catch (err: any) {
    const detalhe = err?.details && typeof err.details === "object" ? JSON.stringify(err.details).slice(0, 400) : "";
    const erro = `${err?.message || String(err)}${detalhe ? ` | details: ${detalhe}` : ""}`;
    console.warn(`[baixaReq] Falha ao baixar req ${numeroReqAlvo}: ${erro}`);
    return { ok: false, erro };
  }
}

// ════════════════════════════════════════════════════════════
// ENRIQUECIMENTO DE ITEM VIA ALVO
// ════════════════════════════════════════════════════════════
//
// Sem essa chamada, o Alvo rejeita o pedido com:
//   "Produto X Situação Tributária não cadastrada"
//   "Produto X Classificação Fiscal não cadastrada"

interface EnriquecimentoItemInput {
  codigo_produto: string;
  codigo_prod_unid_med: string;
  quantidade: number;
  valor_unitario: number;
  produto_nome: string;
  produto_codigo_alternativo: string;
  produto_codigo_reduzido?: string;
  codigo_empresa_filial: string;
  codigo_entidade: string;
  nome_entidade: string;
  data_pedido: string; // YYYY-MM-DD
  data_cadastro: string;
  data_validade: string;
  data_competencia: string;
  data_base_vencimento: string;
  codigo_tipo_pag_rec: string;
  codigo_usuario: string;
}

interface ItemEnriquecido {
  CodigoClasFiscal: string | null;
  CodigoSitTributaria: string | null;
  CodigoTributA: string | null;
  CodigoTributB: string | null;
  CodigoSitTributariaIBSCBS: string | null;
  PercentualICMS: number;
  BaseICMS: number;
  ValorICMS: number;
  PercentualIPI: number;
  BaseIPI: number;
  ValorIPI: number;
}

/**
 * Chama o endpoint /PedComp/AtualizaItemPedido do Alvo via erp-proxy
 * e retorna apenas os campos fiscais relevantes do item enriquecido.
 */
async function enriquecerItemViaAlvo(params: EnriquecimentoItemInput): Promise<ItemEnriquecido> {
  // Datas no formato YYYY-MM-DDTHH:mm:ss (sem Z, sem milissegundos) — igual ao Alvo
  const dataPedidoIso = `${params.data_pedido}T00:00:00`;
  const dataCadastroIso = `${params.data_cadastro}T00:00:00`;
  const dataCompetenciaIso = `${params.data_competencia}T00:00:00`;
  const dataBaseVencIso = `${params.data_base_vencimento}T00:00:00`;

  const pedCompDTO = {
    CodigoEmpresaFilial: params.codigo_empresa_filial,
    Numero: "",
    CodigoEntidade: params.codigo_entidade,
    NomeEntidade: params.nome_entidade,
    DataPedido: dataPedidoIso,
    DataCadastro: dataCadastroIso,
    DataBaseVencimento: dataBaseVencIso,
    DataCompetencia: dataCompetenciaIso,
    DataBaseVencimentoParcela: "Data do Pedido",
    Origem: "Pedido",
    Chamou: "CodigoProduto",
    ValorCambio: 1,
    CodigoUsuario: params.codigo_usuario,
    PossuiCertificado: "Não",
    CodigoTabPv: null,
    Comprado: "Não",
    FreteTerceiro: "Não",
    CodigoGrupoCompra: null,
    CodigoMatriz: null,
    CodigoLinha: null,
    CodigoColuna: null,
    SequenciaVerbaCtrlProjeto: null,
    CodigoComprador: null,
    Tipo: "Total",
    CodigoTipoPagRec: params.codigo_tipo_pag_rec,
    CodigoEntidadeTransportadora: params.codigo_entidade,
    CodigoIndEconomico: null,
    CodigoCentroCtrl: null,
    CodigoEmpresaFilialReqComp: null,
    NumeroReqComp: null,
    Status: "Aberto",
    ImpostoZerado: "Não",
    NumeroPedCompReferencia: null,
  };

  const itemBase: any = {
    QuantidadeSaldo: 0,
    QuantidadeDesmembrar: 0,
    CodigoProduto: params.codigo_produto,
    ItemServico: "Não",
    NomeProdutoDiverso: null,
    CodigoProdUnidMed: null,
    PosicaoProdUnidMed: 1,
    QuantidadeProdutoDiverso: 0,
    QuantidadeProdUnidMedPrincipal: 1,
    QuantidadeDesmembrada: 0,
    ValorTabelaPreco: 0,
    DescontoComposto: null,
    ValorUnitario: 0,
    ValorUnitarioBase: 0,
    ValorTotal: 0,
    PercentualAcrescimoFinanceiro: 0,
    ValorAcrescimoFinanceiro: 0,
    PercentualDescontoEspecial: 0,
    ValorDescontoEspecial: 0,
    ValorFinal: 0,
    BaseISS: 0,
    PercentualISS: 0,
    ValorISS: 0,
    BaseIRRF: 0,
    PercentualIRRF: 0,
    ValorIRRF: 0,
    PercentualReducaoICMS: 0,
    BaseICMS: 0,
    PercentualICMS: 0,
    ValorICMS: 0,
    BaseIPI: 0,
    PercentualIPI: 0,
    ValorIPI: 0,
    IndicadorNomeProduto: "Principal",
    SaldoQuantidade: 0,
    CodigoUsuarioAprovacao: null,
    DataAprovacao: null,
    Cancelado: "Não",
    DataCancelamento: null,
    CodigoUsuarioCancelamento: null,
    CodigoIndEconomico: null,
    ValorCambio: 0,
    CodigoCentroCtrl: null,
    Bloqueado: "Não",
    CodigoUsuarioLiberacaoBloqueio: null,
    DataLiberacaoBloqueio: null,
    LiberacaoBloqueioAtualizaTabelaPreco: "Não",
    CodigoProdUnidMedValor: null,
    PosicaoProdUnidMedValor: 1,
    Quantidade2: 0,
    CalculaSTPrecoLista: "Não",
    MargemLucroST: 0,
    PrecoListaST: 0,
    PercentualReducaoICMSST: 0,
    BaseICMSST: 0,
    PercentualICMSST: 0,
    ValorICMSST: 0,
    ValorICMSSTRetido: 0,
    ValorEmbalagemST: 0,
    ValorICMSSTEmbalagem: 0,
    ValorFreteST: 0,
    ValorICMSSTFrete: 0,
    ValorSeguroST: 0,
    ValorICMSSTSeguro: 0,
    ValorOutrasDespesasST: 0,
    ValorICMSSTOutrasDespesas: 0,
    ValorCalculoFreteST: 0,
    ValorICMSSTCalculoFrete: 0,
    CodigoSitTributaria: null,
    BaseII: 0,
    PercentualII: 0,
    ValorII: 0,
    CodigoTributA: null,
    MotivoCancelamento: null,
    DataPrometida: null,
    ValorUnitarioCalculado: 0,
    CodigoProdUnidMedEmbalagem: null,
    QuantidadeEmbalagem: 0,
    ValorEmbalagem: 0,
    ValorIssDeduzirTotal: 0,
    CalculaDifalICMS: "Não",
    PercentualDifalICMS: 0,
    ValorDifalICMS: 0,
    BaseCOFINS: 0,
    PercentualCOFINSRF: 0,
    ValorCOFINSRF: 0,
    BasePIS: 0,
    PercentualPISRF: 0,
    ValorPISRF: 0,
    BaseCSLL: 0,
    PercentualCSLLRF: 0,
    ValorCSLLRF: 0,
    NumeroPedidoFornecedor: null,
    DataSolicitada: null,
    DataPrevisaoEntrega: null,
    QuantidadeEntregaParcial: 0,
    Observacao: null,
    NumeroProdutoFornecedor: null,
    CodigoEntidadeOrigem: null,
    NumeroShortForm: null,
    ValorMultiplicador: 0,
    NumeroDescrTecnProd: null,
    AcrescimoCustoCompra: 0,
    DescontoCustoCompra: 0,
    NomeProduto: null,
    NumeroReqComp: null,
    SequenciaFornItemReqComp: null,
    UtilizaPromocao: "Sim",
    PercentualDescontoRepasseIcmsDiferencial: 0,
    ValorDescontoRepasseIcmsDiferencial: 0,
    ValorDescontoRepasseIcmsReducao: 0,
    DataEntradaCliente: null,
    EntradaCliente: "Não",
    PesoLiquido: 0,
    PesoBruto: 0,
    IPIInclusoBaseICMS: "Não",
    PercentualReducaoINSS: 0,
    CodigoTipoLanc: null,
    StatusDevolucao: "Não Devolvido",
    QuantidadeDevolvida: 0,
    Urgente: "Não",
    CodigoTributBModBc: null,
    CodigoTributBModBcST: null,
    TipoTributacaoIPI: null,
    TipoTributacaoPIS: null,
    TipoTributacaoCOFINS: null,
    CodigoConfigTributIPI: null,
    CodigoConfigTributPIS: null,
    CodigoConfigTributCOFINS: null,
    Multiplicidade: 0,
    BaseIPIPauta: 0,
    ValorUnitarioIPIPauta: 0,
    BasePisPauta: 0,
    ValorUnitarioPisPauta: 0,
    BaseCofinsPauta: 0,
    ValorUnitarioCofinsPauta: 0,
    DataSaidaPassagem: null,
    Trecho: null,
    HorarioSaida: null,
    HorarioChegada: null,
    CidadeHospedagem: null,
    DataCheckIn: null,
    DataCheckOut: null,
    NomeHotel: null,
    CidadeLocacaoVeiculo: null,
    DataRetiradaVeiculo: null,
    DataDevolucaoVeiculo: null,
    NomeLocadoraVeiculo: null,
    Multiplicador: "Nenhum",
    QuantidadeCancelada: 0,
    DescricaoAlternativaProduto: null,
    PercentualReducaoIPI: 0,
    CodigoTributC: null,
    QuantidadePlanejada: 0,
    CodigoAlternativoProduto: null,
    ImpostoZerado: "Não",
    DataHoraInicialEntrega: null,
    DataHoraFinalEntrega: null,
    NumeroPedCompAgrup: null,
    AcrescimoComposto: null,
    PercentualDescontoGeral: 0,
    ValorDescontoGeral: 0,
    PercentualAcrescimoGeral: 0,
    ValorAcrescimoGeral: 0,
    IdProdutoId: null,
    SequenciaDesmembramento: null,
    BaseIOF: 0,
    PercentualIOF: 0,
    ValorIOF: 0,
    BaseCIDE: 0,
    PercentualCIDE: 0,
    ValorCIDE: 0,
    CodigoSitTributariaIBSCBS: null,
    BaseCBS: 0,
    PercentualCBS: 0,
    ValorCBS: 0,
    PercentualReducaoCBS: 0,
    ReducaoSobreCBS: "Nenhum",
    BaseIBSUF: 0,
    PercentualIBSUF: 0,
    ValorIBSUF: 0,
    PercentualReducaoIBSUF: 0,
    ReducaoSobreIBSUF: "Nenhum",
    BaseIBSCidade: 0,
    PercentualIBSCidade: 0,
    ValorIBSCidade: 0,
    PercentualReducaoIBSCidade: 0,
    ReducaoSobreIBSCidade: "Nenhum",
    PercentualCBSOriginal: 0,
    PercentualIBSUFOriginal: 0,
    PercentualIBSCidadeOriginal: 0,
    ItemPedCompUserFieldsObject: {},
    ItemPedCompAgrupChildList: [],
    ItemPedCompCancChildList: [],
    ItemPedCompClasseRecdespChildList: [],
    ItemPedCompCtrlImpChildList: [],
    ItemPedCompFabPartnumberChildList: [],
    ItemReqCompPedCompChildList: [],
    CodigoProdutoAlternativo: null,
    NomeProdutoAlternativo1: null,
    CodigoNCMNBS: null,
    NomeGrupoProduto: null,
    DescricaoItem: null,
    QuantidadeCancelar: 0,
    UploadIdentify: "",
    vinculoTela: "alvoerp.pedcomp",
    objRef: [],
    IndicadorNomeProdutoObject: {
      name: "Default_Principal",
      value: "Principal",
      formName: "pedComp",
      nameClass: "pedComp",
    },
    ReducaoSobreIBSUFObject: {
      name: "Default_Nenhum",
      value: "Nenhum",
      formName: "pedComp",
      nameClass: "pedComp",
    },
    ReducaoSobreIBSCidadeObject: {
      name: "Default_Nenhum",
      value: "Nenhum",
      formName: "pedComp",
      nameClass: "pedComp",
    },
    ReducaoSobreCBSObject: {
      name: "Default_Nenhum",
      value: "Nenhum",
      formName: "pedComp",
      nameClass: "pedComp",
    },
    CodigoProdutoObject: {
      Codigo: params.codigo_produto,
      Nome: params.produto_nome,
      Reduzido: params.produto_codigo_reduzido || "",
      Alternativo: params.produto_codigo_alternativo,
      NomeAlternativo1: null,
      checked: true,
    },
  };

  const payload = {
    PedCompDTO: pedCompDTO,
    ItemPedComp: itemBase,
  };

  const resp = await callGatewayJson("/ped-comp/atualiza-item-pedido", payload);

  const enriquecido = resp?.itemPedComp || resp?.ItemPedComp || resp;

  if (!enriquecido || typeof enriquecido !== "object") {
    throw new Error(`Alvo retornou resposta inesperada para enriquecimento do item ${params.codigo_produto}`);
  }

  return {
    CodigoClasFiscal: enriquecido.CodigoClasFiscal ?? null,
    CodigoSitTributaria: enriquecido.CodigoSitTributaria ?? null,
    CodigoTributA: enriquecido.CodigoTributA ?? null,
    CodigoTributB: enriquecido.CodigoTributB ?? null,
    CodigoSitTributariaIBSCBS: enriquecido.CodigoSitTributariaIBSCBS ?? null,
    PercentualICMS: Number(enriquecido.PercentualICMS ?? 0),
    BaseICMS: Number(enriquecido.BaseICMS ?? 0),
    ValorICMS: Number(enriquecido.ValorICMS ?? 0),
    PercentualIPI: Number(enriquecido.PercentualIPI ?? 0),
    BaseIPI: Number(enriquecido.BaseIPI ?? 0),
    ValorIPI: Number(enriquecido.ValorIPI ?? 0),
  };
}

// ════════════════════════════════════════════════════════════
// MONTAGEM DO PAYLOAD PEDCOMP
// ════════════════════════════════════════════════════════════

interface MontarPayloadParams {
  input: NovoPedidoInput;
  texto_completo: string;
  texto_historico_completo: string;
  arquivos_guids?: string[];
  itens_enriquecidos: ItemEnriquecido[]; // 1 por item, na mesma ordem que input.itens
  codigo_comprador: string | null;
  codigo_usuario_alvo: string;
}

function montarPayloadPedComp(p: MontarPayloadParams): any {
  const {
    input,
    texto_completo,
    texto_historico_completo,
    arquivos_guids,
    itens_enriquecidos,
    codigo_comprador,
    codigo_usuario_alvo,
  } = p;

  if (itens_enriquecidos.length !== input.itens.length) {
    throw new Error(`Inconsistência: ${input.itens.length} itens vs ${itens_enriquecidos.length} enriquecimentos`);
  }

  const valorMercadoria = round2(input.itens.reduce((acc, it) => acc + it.quantidade * it.valor_unitario, 0));
  const valorTotal = valorMercadoria;
  const origem = input.origem_requisicao_id ? "Requisição" : "Pedido";

  const dataPedido = formatarDataParaAlvo(input.data_pedido);
  const dataValidade = formatarDataParaAlvo(input.data_validade);
  const dataEntrega = formatarDataParaAlvo(input.data_entrega);
  const dataCompetencia = formatarDataParaAlvo(input.data_competencia);
  const dataBaseVencimento = dataPedido;
  const dataHoraDigitacao = dataHoraAgoraUtc();

  const itensPayload = input.itens.map((item, idx) => {
    const valorTotalItem = round2(item.quantidade * item.valor_unitario);
    const enriq = itens_enriquecidos[idx];

    const baseICMS = enriq.PercentualICMS > 0 ? valorTotalItem : 0;
    const valorICMS = round2((baseICMS * enriq.PercentualICMS) / 100);

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
      ItemServico: item.item_servico ? "Sim" : "Não",
      CodigoProdUnidMed: item.codigo_prod_unid_med,
      QuantidadeProdUnidMedPrincipal: item.quantidade,
      ValorUnitario: item.valor_unitario,
      ValorTotal: valorTotalItem,
      ValorFinal: valorTotalItem,
      BaseICMS: baseICMS,
      PercentualICMS: enriq.PercentualICMS,
      ValorICMS: valorICMS,
      BaseIPI: 0,
      PercentualIPI: enriq.PercentualIPI,
      ValorIPI: 0,
      CodigoClasFiscal: enriq.CodigoClasFiscal,
      CodigoSitTributaria: enriq.CodigoSitTributaria,
      CodigoTributA: enriq.CodigoTributA,
      CodigoTributB: enriq.CodigoTributB,
      CodigoSitTributariaIBSCBS: enriq.CodigoSitTributariaIBSCBS,
      ImpostoZerado: "Não",
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

  const geralBaseICMS = round2(itensPayload.reduce((s, it) => s + (it.BaseICMS || 0), 0));
  const geralValorICMS = round2(itensPayload.reduce((s, it) => s + (it.ValorICMS || 0), 0));

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

  // Monta as linhas planas (classe + CC) com valor e percentual.
  const linhasFlat: Array<{
    codigoClasse: string;
    codigoCC: string;
    valor: number;
    pct: number;
  }> = [];
  for (const [codigoClasse, ccMap] of rateioAgregado.entries()) {
    for (const [codigoCC, { valor, pct }] of ccMap.entries()) {
      linhasFlat.push({ codigoClasse, codigoCC, valor: round2(valor), pct: round2(pct) });
    }
  }

  // ── AJUSTE RESIDUAL (fecha a soma EXATA com o ValorTotal) ──────────
  // O Alvo valida "soma das classes == Valor Total do Pedido". Como cada
  // linha é arredondada a 2 casas, a soma de muitas linhas com percentuais
  // quebrados (ex.: 64.6%, 7.85%) acumula uma diferença de centavos que faz
  // o Alvo rejeitar ("Existe diferença entre a soma das classes e o Valor
  // Total"). Aqui jogamos a diferença residual de VALOR (e de %) na última
  // linha, garantindo fechamento exato. Mesmo padrão usado em calcularParcelas
  // (última parcela = total - soma das anteriores).
  if (linhasFlat.length > 0) {
    const somaValor = round2(linhasFlat.reduce((s, l) => s + l.valor, 0));
    const difValor = round2(valorTotal - somaValor);
    if (Math.abs(difValor) >= 0.01) {
      linhasFlat[linhasFlat.length - 1].valor = round2(linhasFlat[linhasFlat.length - 1].valor + difValor);
    }

    const somaPct = round2(linhasFlat.reduce((s, l) => s + l.pct, 0));
    const difPct = round2(100 - somaPct);
    if (Math.abs(difPct) >= 0.01) {
      linhasFlat[linhasFlat.length - 1].pct = round2(linhasFlat[linhasFlat.length - 1].pct + difPct);
    }
  }

  // Reagrupa as linhas (já ajustadas) por classe para o payload do Alvo.
  const porClasseMap = new Map<string, Array<{ codigoCC: string; valor: number; pct: number }>>();
  for (const l of linhasFlat) {
    if (!porClasseMap.has(l.codigoClasse)) porClasseMap.set(l.codigoClasse, []);
    porClasseMap.get(l.codigoClasse)!.push({ codigoCC: l.codigoCC, valor: l.valor, pct: l.pct });
  }

  const pedCompClassesPayload = Array.from(porClasseMap.entries()).map(([codigoClasse, linhas]) => {
    const linhasCC = linhas.map(({ codigoCC, valor, pct }) => ({
      CodigoEmpresaFilial: "-1",
      NumeroPedComp: "-1",
      CodigoClasseRecDesp: "-1",
      CodigoCentroCtrl: codigoCC,
      Valor: valor,
      Percentual: pct,
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
    CodigoTabPv: null,
    ValorMercadoria: valorMercadoria,
    BaseICMS: geralBaseICMS,
    ValorICMS: geralValorICMS,
    GeralBaseICMS: geralBaseICMS,
    GeralValorICMS: geralValorICMS,
    ValorTotal: valorTotal,
    CodigoEntidadeTransportadora: input.codigo_entidade,
    PercentualAcrescimoFinanceiroProduto: null,
    PercentualDescontoEspecialProduto: null,
    PercentualAcrescimoFinanceiroServico: null,
    PercentualDescontoEspecialServico: null,
    ValorCambio: 1,
    CodigoUsuario: codigo_usuario_alvo,
    CodigoComprador: codigo_comprador,
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
    Chamou: "CodigoCondPag",
    TextoHistoricoNovo: texto_historico_completo,
    InformacaoCotacaoCompra: "",
    CodigoFuncionarioReqComp: null,
    EmailFuncionario: null,
    NomeComprador: null,
    EmailComprador: null,
    ImpostoZerado: "Não",
    UsuarioLogado: codigo_usuario_alvo,
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

/**
 * Limpa todos os filhos de um pedido (itens, rateios, parcelas, arquivos).
 */
async function limparFilhosDoPedido(pedidoId: string): Promise<void> {
  const { data: arquivos } = await (supabase as any)
    .from("compras_pedidos_arquivos")
    .select("storage_path")
    .eq("pedido_id", pedidoId);

  if (arquivos && arquivos.length > 0) {
    const paths = arquivos.map((a: any) => a.storage_path);
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove(paths);
    } catch (e) {
      console.warn("Aviso: falha ao remover arquivos do storage:", e);
    }
  }

  const { data: itensIds } = await (supabase as any)
    .from("compras_pedidos_itens")
    .select("id")
    .eq("pedido_id", pedidoId);

  if (itensIds && itensIds.length > 0) {
    const ids = itensIds.map((i: any) => i.id);
    await (supabase as any).from("compras_pedidos_itens_rateio").delete().in("item_id", ids);
  }

  await (supabase as any).from("compras_pedidos_itens").delete().eq("pedido_id", pedidoId);
  await (supabase as any).from("compras_pedidos_parcelas").delete().eq("pedido_id", pedidoId);
  await (supabase as any).from("compras_pedidos_arquivos").delete().eq("pedido_id", pedidoId);
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

export async function enviarPedido(input: NovoPedidoInput, pedidoIdExistente?: string): Promise<EnvioPedidoResult> {
  if (input.arquivos && input.arquivos.length > 3) {
    throw new Error("Máximo de 3 arquivos por pedido.");
  }

  const textoCompleto = montarTextoCompleto(input);
  const textoHistoricoCompleto = montarTextoHistoricoCompleto(input);

  let pedidoId: string | null = pedidoIdExistente || null;
  const modoEdicao = !!pedidoIdExistente;

  try {
    const codigoUsuarioAlvo = await resolverUsuarioAlvo(input.user_id, input.analista_email);
    const valorTotal = input.itens.reduce((acc, it) => acc + it.quantidade * it.valor_unitario, 0);

    if (modoEdicao) {
      await limparFilhosDoPedido(pedidoId!);

      const { data: pedAtual, error: errFetch } = await (supabase as any)
        .from("compras_pedidos")
        .select("numero")
        .eq("id", pedidoId)
        .single();

      if (errFetch || !pedAtual) {
        throw new Error(`Pedido não encontrado para edição: ${errFetch?.message}`);
      }

      const { error: errUpd } = await (supabase as any).from("compras_pedidos").upsert(
        {
          id: pedidoId,
          codigo_empresa_filial: EMPRESA_FILIAL,
          numero: pedAtual.numero,
          criado_no_hub: true,
          status_local: "rascunho",
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
          codigo_usuario: codigoUsuarioAlvo,
          texto: textoCompleto,
          texto_historico: textoHistoricoCompleto,
          valor_mercadoria: round2(valorTotal),
          valor_total: round2(valorTotal),
          tipo: "Total",
          numero_req_comp: input.origem_numero_req_alvo || null,
          codigo_empresa_filial_req_comp: input.origem_codigo_empresa_filial || null,
          erro_envio: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      if (errUpd) {
        throw new Error(`Erro ao atualizar pedido: ${errUpd.message}`);
      }
    } else {
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
          codigo_usuario: codigoUsuarioAlvo,
          texto: textoCompleto,
          texto_historico: textoHistoricoCompleto,
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
    }

    // ── REINSERÇÃO DOS FILHOS (vale pra ambos modos) ──

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
      evento: modoEdicao ? "editado_hub" : "criado_hub",
      user_id: input.user_id,
      user_nome: input.analista_nome,
      sucesso: true,
    });

    if (modoEdicao) {
      const { data: pedAtualEnviando } = await (supabase as any)
        .from("compras_pedidos")
        .select("numero")
        .eq("id", pedidoId)
        .single();

      await (supabase as any).from("compras_pedidos").upsert(
        {
          id: pedidoId,
          codigo_empresa_filial: EMPRESA_FILIAL,
          numero: pedAtualEnviando?.numero || `RASCUNHO-${pedidoId!.substring(0, 8)}`,
          status_local: "enviando",
        },
        { onConflict: "id" },
      );
    } else {
      await (supabase as any).from("compras_pedidos").upsert(
        {
          id: pedidoId,
          codigo_empresa_filial: EMPRESA_FILIAL,
          numero: `RASCUNHO-${Date.now()}`,
          status_local: "enviando",
        },
        { onConflict: "id" },
      );
    }

    const guids = input.arquivos?.map((a) => a.upload_identify_guid) || [];

    // ── ENRIQUECIMENTO FISCAL ──────────────────────────────
    const itensEnriquecidos: ItemEnriquecido[] = [];
    for (const item of input.itens) {
      const enriq = await enriquecerItemViaAlvo({
        codigo_produto: item.codigo_produto,
        codigo_prod_unid_med: item.codigo_prod_unid_med,
        quantidade: item.quantidade,
        valor_unitario: item.valor_unitario,
        produto_nome: item.produto_nome,
        produto_codigo_alternativo: item.codigo_alternativo_produto || "",
        codigo_empresa_filial: EMPRESA_FILIAL,
        codigo_entidade: input.codigo_entidade,
        nome_entidade: input.nome_entidade,
        data_pedido: input.data_pedido,
        data_cadastro: input.data_pedido,
        data_validade: input.data_validade,
        data_competencia: input.data_competencia,
        data_base_vencimento: input.data_pedido,
        codigo_tipo_pag_rec: "0000016",
        codigo_usuario: codigoUsuarioAlvo,
      });
      itensEnriquecidos.push(enriq);
    }

    // Resolve o CodigoComprador (requisitante se vínculo; senão operador)
    const codigoComprador = await resolverCodigoComprador(input);

    const payload = montarPayloadPedComp({
      input,
      texto_completo: textoCompleto,
      texto_historico_completo: textoHistoricoCompleto,
      arquivos_guids: guids.length > 0 ? guids : undefined,
      itens_enriquecidos: itensEnriquecidos,
      codigo_comprador: codigoComprador,
      codigo_usuario_alvo: codigoUsuarioAlvo,
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

      // ── BAIXA DA REQUISIÇÃO (v1: só a req é atualizada) ──────────────
      {
        let reqAlvoParaBaixar: string | null = input.origem_numero_req_alvo || null;
        let filialReqParaBaixar: string | null = input.origem_codigo_empresa_filial || null;

        if (!reqAlvoParaBaixar || !filialReqParaBaixar) {
          const { data: pedOrigem } = await (supabase as any)
            .from("compras_pedidos")
            .select("numero_req_comp, codigo_empresa_filial_req_comp")
            .eq("id", pedidoId)
            .single();
          if (pedOrigem) {
            reqAlvoParaBaixar = reqAlvoParaBaixar || pedOrigem.numero_req_comp || null;
            filialReqParaBaixar = filialReqParaBaixar || pedOrigem.codigo_empresa_filial_req_comp || null;
          }
        }

        console.log(
          `[baixaReq] origem → numeroAlvo=${numeroAlvo} req=${reqAlvoParaBaixar} filialReq=${filialReqParaBaixar}`,
        );

        if (numeroAlvo && reqAlvoParaBaixar && filialReqParaBaixar) {
          const resultadoBaixa = await baixarRequisicaoAlvo({
            codigoEmpresaFilialReq: filialReqParaBaixar,
            numeroReqAlvo: reqAlvoParaBaixar,
            numeroPedidoAlvo: numeroAlvo,
          });

          await (supabase as any).from("compras_pedidos_auditoria").insert({
            pedido_id: pedidoId,
            evento: resultadoBaixa.ok ? "req_baixada" : "req_baixa_falhou",
            user_id: input.user_id,
            user_nome: input.analista_nome,
            sucesso: resultadoBaixa.ok,
            mensagem_erro: resultadoBaixa.ok
              ? null
              : `[req ${reqAlvoParaBaixar} → ped ${numeroAlvo}] ${resultadoBaixa.erro || "erro desconhecido"}`,
          });
        } else {
          console.warn(
            `[baixaReq] origem incompleta — baixa não disparada. req=${reqAlvoParaBaixar} filialReq=${filialReqParaBaixar}`,
          );
        }
      }
      // ── FIM DA BAIXA DA REQUISIÇÃO ──────────────────────────────────

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

        if (!modoEdicao) {
          // DESATIVADO: a clonagem de anexos agora acontece no wizard (SuprimentosPedidoNovo).
          // await clonarAnexosDaRequisicao(input.origem_requisicao_id, pedidoId!);
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

      const erroEnvioPayload = {
        message: msgErro,
        details: errEnvio?.details || null,
        timestamp: new Date().toISOString(),
      };

      if (modoEdicao) {
        const { data: pedAtualErro } = await (supabase as any)
          .from("compras_pedidos")
          .select("numero")
          .eq("id", pedidoId)
          .single();

        await (supabase as any).from("compras_pedidos").upsert(
          {
            id: pedidoId,
            codigo_empresa_filial: EMPRESA_FILIAL,
            numero: pedAtualErro?.numero || `RASCUNHO-${pedidoId!.substring(0, 8)}`,
            status_local: "erro_envio",
            erro_envio: erroEnvioPayload,
          },
          { onConflict: "id" },
        );
      } else {
        await (supabase as any).from("compras_pedidos").upsert(
          {
            id: pedidoId,
            codigo_empresa_filial: EMPRESA_FILIAL,
            numero: `RASCUNHO-${pedidoId!.substring(0, 8)}`,
            status_local: "erro_envio",
            erro_envio: erroEnvioPayload,
          },
          { onConflict: "id" },
        );
      }

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
      const erroEnvioPayload = {
        message: `Erro durante criação: ${msgErro}`,
        timestamp: new Date().toISOString(),
      };

      if (modoEdicao) {
        const { data: pedAtualCatch } = await (supabase as any)
          .from("compras_pedidos")
          .select("numero")
          .eq("id", pedidoId)
          .single();

        await (supabase as any).from("compras_pedidos").upsert(
          {
            id: pedidoId,
            codigo_empresa_filial: EMPRESA_FILIAL,
            numero: pedAtualCatch?.numero || `RASCUNHO-${pedidoId.substring(0, 8)}`,
            status_local: "erro_envio",
            erro_envio: erroEnvioPayload,
          },
          { onConflict: "id" },
        );
      } else {
        await (supabase as any).from("compras_pedidos").upsert(
          {
            id: pedidoId,
            codigo_empresa_filial: EMPRESA_FILIAL,
            numero: `RASCUNHO-${pedidoId.substring(0, 8)}`,
            status_local: "erro_envio",
            erro_envio: erroEnvioPayload,
          },
          { onConflict: "id" },
        );
      }

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
// CARREGAR PEDIDO PARA EDIÇÃO (modo retomada de rascunho/erro)
// ════════════════════════════════════════════════════════════

export interface CarregarPedidoResult {
  pedido_id: string;
  numero: string;
  status_local: string;
  erro_envio: { message?: string; details?: any; timestamp?: string } | null;

  origem_numero_req_alvo: string | null;
  origem_codigo_empresa_filial_req_comp: string | null;

  codigo_entidade: string;
  nome_entidade: string;
  cnpj_entidade: string | null;
  codigo_cond_pag: string;
  nome_cond_pag: string;
  tipo_entrega: "Total" | "Parcial";
  data_pedido: string; // YYYY-MM-DD
  data_entrega: string;
  data_validade: string;

  itens: Array<{
    item_servico: boolean;
    codigo_produto: string;
    codigo_alternativo_produto: string | null;
    codigo_prod_unid_med: string;
    produto_nome: string;
    produto_unidade: string | null;
    quantidade: number;
    valor_unitario: number;
    observacao: string | null;
    rateio: Array<{
      codigo_classe_rec_desp: string;
      classe_rec_desp_label: string | null;
      percentual: number;
      ccs: Array<{
        codigo_centro_ctrl: string;
        centro_ctrl_label: string | null;
        percentual: number;
      }>;
    }>;
  }>;

  parcelas: ParcelaInput[];

  arquivos_existentes: Array<{
    id: string;
    upload_identify_guid: string;
    nome_original: string;
    storage_path: string;
    mime_type: string;
    tamanho_bytes: number;
  }>;

  texto_livre_existente: string;
  texto_historico_existente: string;
}

export async function carregarPedidoParaEdicao(pedidoId: string): Promise<CarregarPedidoResult> {
  return _carregarPedidoCompleto(pedidoId, /* modoEdicao */ true);
}

export async function carregarPedidoParaDetalhe(pedidoId: string): Promise<CarregarPedidoResult> {
  return _carregarPedidoCompleto(pedidoId, /* modoEdicao */ false);
}

// ────────────────────────────────────────────────────────────
// HELPERS — Fallback para reconstruir itens/parcelas do jsonb
// ────────────────────────────────────────────────────────────

function reconstruirItensDoJsonb(itensJsonb: any[]): any[] {
  if (!Array.isArray(itensJsonb) || itensJsonb.length === 0) return [];

  return itensJsonb.map((it: any) => {
    const rateio = Array.isArray(it.classeRateio)
      ? it.classeRateio.map((cls: any) => ({
          codigo_classe_rec_desp: cls.classe || "",
          classe_rec_desp_label: null,
          percentual: Number(cls.percentual) || 0,
          ccs: Array.isArray(cls.centrosCusto)
            ? cls.centrosCusto.map((cc: any) => ({
                codigo_centro_ctrl: cc.codigo || "",
                centro_ctrl_label: null,
                percentual: Number(cc.percentual) || 0,
              }))
            : [],
        }))
      : [];

    return {
      item_servico: it.itemServico === "Sim",
      codigo_produto: it.codigoProduto || "",
      codigo_alternativo_produto: null,
      codigo_prod_unid_med: it.unidade || "",
      produto_nome: it.nomeProduto || "",
      produto_unidade: it.unidade || "",
      quantidade: Number(it.quantidade) || 0,
      valor_unitario: Number(it.valorUnitario) || 0,
      observacao: null,
      rateio,
    };
  });
}

function reconstruirParcelasDoJsonb(parcelasJsonb: any[]): any[] {
  if (!Array.isArray(parcelasJsonb) || parcelasJsonb.length === 0) return [];

  return parcelasJsonb.map((p: any) => ({
    sequencia: Number(p.sequencia) || 0,
    dias_entre_parcelas: Number(p.diasEntreParcelas) || 0,
    percentual_fracao: Number(p.percentual) || 0,
    valor_parcela: Number(p.valor) || 0,
    data_vencimento: p.vencimento || null,
  }));
}

/**
 * Helper interno — carrega o pedido completo com filhos e reconstrói rateio.
 */
async function _carregarPedidoCompleto(pedidoId: string, modoEdicao: boolean): Promise<CarregarPedidoResult> {
  const { data: ped, error: errPed } = await (supabase as any)
    .from("compras_pedidos")
    .select("*")
    .eq("id", pedidoId)
    .single();

  if (errPed || !ped) {
    throw new Error(`Pedido não encontrado: ${errPed?.message}`);
  }

  if (modoEdicao && ped.status_local !== "rascunho" && ped.status_local !== "erro_envio") {
    throw new Error(
      `Só é possível editar pedidos com status 'rascunho' ou 'erro_envio'. Status atual: ${ped.status_local}`,
    );
  }

  const { data: itensRows, error: errItens } = await (supabase as any)
    .from("compras_pedidos_itens")
    .select("*")
    .eq("pedido_id", pedidoId)
    .order("sequencia", { ascending: true });

  if (errItens) {
    throw new Error(`Erro ao carregar itens: ${errItens.message}`);
  }

  const usarJsonbItens = (!itensRows || itensRows.length === 0) && Array.isArray(ped.itens) && ped.itens.length > 0;
  let itens: any[] = [];

  if (usarJsonbItens) {
    itens = reconstruirItensDoJsonb(ped.itens);
  } else {
    for (const itemRow of itensRows || []) {
      const { data: rateiosRows } = await (supabase as any)
        .from("compras_pedidos_itens_rateio")
        .select("*")
        .eq("item_id", itemRow.id);

      const porClasse = new Map<
        string,
        {
          codigo_classe_rec_desp: string;
          classe_rec_desp_label: string | null;
          percentual: number;
          ccs: Array<{
            codigo_centro_ctrl: string;
            centro_ctrl_label: string | null;
            percentual: number;
          }>;
        }
      >();

      for (const r of rateiosRows || []) {
        const key = r.codigo_classe_rec_desp;
        if (!porClasse.has(key)) {
          porClasse.set(key, {
            codigo_classe_rec_desp: r.codigo_classe_rec_desp,
            classe_rec_desp_label: r.classe_rec_desp_label,
            percentual: 0,
            ccs: [],
          });
        }
        const cls = porClasse.get(key)!;
        cls.percentual = round2(cls.percentual + Number(r.percentual));
        cls.ccs.push({
          codigo_centro_ctrl: r.codigo_centro_ctrl,
          centro_ctrl_label: r.centro_ctrl_label,
          percentual: Number(r.percentual),
        });
      }

      const rateioFinal = Array.from(porClasse.values()).map((cls) => {
        const ccs = cls.ccs.map((cc) => ({
          ...cc,
          percentual: cls.percentual > 0 ? round2((cc.percentual / cls.percentual) * 100) : 0,
        }));
        if (ccs.length > 0) {
          const somaCcs = ccs.reduce((s, c) => s + c.percentual, 0);
          const diff = round2(100 - somaCcs);
          if (Math.abs(diff) > 0.001 && Math.abs(diff) <= 0.02) {
            ccs[ccs.length - 1].percentual = round2(ccs[ccs.length - 1].percentual + diff);
          }
        }
        return {
          codigo_classe_rec_desp: cls.codigo_classe_rec_desp,
          classe_rec_desp_label: cls.classe_rec_desp_label,
          percentual: cls.percentual,
          ccs,
        };
      });

      itens.push({
        item_servico: itemRow.item_servico,
        codigo_produto: itemRow.codigo_produto,
        codigo_alternativo_produto: itemRow.codigo_alternativo_produto,
        codigo_prod_unid_med: itemRow.codigo_prod_unid_med,
        produto_nome: itemRow.produto_nome,
        produto_unidade: itemRow.produto_unidade,
        quantidade: Number(itemRow.quantidade),
        valor_unitario: Number(itemRow.valor_unitario),
        observacao: itemRow.observacao,
        rateio: rateioFinal,
      });
    }
  }

  const { data: parcelasRows } = await (supabase as any)
    .from("compras_pedidos_parcelas")
    .select("*")
    .eq("pedido_id", pedidoId)
    .order("sequencia", { ascending: true });

  const usarJsonbParcelas =
    (!parcelasRows || parcelasRows.length === 0) && Array.isArray(ped.parcelas) && ped.parcelas.length > 0;

  const parcelas: ParcelaInput[] = usarJsonbParcelas
    ? reconstruirParcelasDoJsonb(ped.parcelas)
    : (parcelasRows || []).map((p: any) => ({
        sequencia: p.sequencia,
        dias_entre_parcelas: p.dias_entre_parcelas,
        percentual_fracao: Number(p.percentual_fracao),
        valor_parcela: Number(p.valor_parcela),
        data_vencimento: p.data_vencimento,
      }));

  const { data: arquivosRows } = await (supabase as any)
    .from("compras_pedidos_arquivos")
    .select("id, upload_identify_guid, nome_original, storage_path, mime_type, tamanho_bytes")
    .eq("pedido_id", pedidoId);

  // Remove o stamp (primeira linha [Hub] ...) ao carregar para edição.
  // Aceita tanto o stamp antigo "[Hub] Analista:" quanto o novo
  // "[Hub] Operador de Compras:".
  const removerStamp = (texto: string | null): string => {
    if (!texto) return "";
    const linhas = texto.split("\n");
    if (linhas.length > 0 && linhas[0].startsWith("[Hub] ")) {
      return linhas.slice(1).join("\n").trim();
    }
    return texto;
  };

  return {
    pedido_id: ped.id,
    numero: ped.numero,
    status_local: ped.status_local,
    erro_envio: ped.erro_envio,
    origem_numero_req_alvo: ped.numero_req_comp,
    origem_codigo_empresa_filial_req_comp: ped.codigo_empresa_filial_req_comp,
    codigo_entidade: ped.codigo_entidade,
    nome_entidade: ped.nome_entidade,
    cnpj_entidade: ped.cnpj_entidade,
    codigo_cond_pag: ped.codigo_cond_pag,
    nome_cond_pag: ped.nome_cond_pag,
    tipo_entrega: (ped.tipo === "Parcial" ? "Parcial" : "Total") as "Total" | "Parcial",
    data_pedido: ped.data_pedido,
    data_entrega: ped.data_entrega,
    data_validade: ped.data_validade,
    itens,
    parcelas,
    arquivos_existentes: arquivosRows || [],
    texto_livre_existente: removerStamp(ped.texto),
    texto_historico_existente: removerStamp(ped.texto_historico),
  };
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
// CLONAR ANEXOS DA REQUISIÇÃO → PEDIDO
// ════════════════════════════════════════════════════════════

const STORAGE_BUCKET_REQ = "compras-requisicoes";

async function clonarAnexosDaRequisicao(requisicaoId: string, pedidoId: string): Promise<void> {
  const { data: anexosReq, error: errList } = await (supabase as any)
    .from("compras_requisicoes_arquivos")
    .select("nome_original, storage_path, mime_type, tamanho_bytes, uploaded_by_user_id")
    .eq("requisicao_id", requisicaoId);

  if (errList) {
    console.warn(`[clonarAnexos] Erro ao listar anexos da req ${requisicaoId}:`, errList.message);
    return;
  }

  if (!anexosReq || anexosReq.length === 0) {
    return;
  }

  console.log(`[clonarAnexos] Clonando ${anexosReq.length} anexo(s) da req ${requisicaoId} pro pedido ${pedidoId}`);

  for (const anexo of anexosReq) {
    try {
      const { data: fileData, error: errDl } = await supabase.storage
        .from(STORAGE_BUCKET_REQ)
        .download(anexo.storage_path);

      if (errDl || !fileData) {
        console.warn(`[clonarAnexos] Falha ao baixar ${anexo.storage_path}:`, errDl?.message);
        continue;
      }

      const novoGuid = crypto.randomUUID();
      const ext = anexo.nome_original?.split(".").pop() || "bin";
      const novoStoragePath = `${pedidoId}/${novoGuid}.${ext}`;

      const { error: errUp } = await supabase.storage.from(STORAGE_BUCKET).upload(novoStoragePath, fileData, {
        contentType: anexo.mime_type || "application/octet-stream",
        upsert: false,
      });

      if (errUp) {
        console.warn(`[clonarAnexos] Falha ao subir ${novoStoragePath}:`, errUp.message);
        continue;
      }

      const { error: errIns } = await (supabase as any).from("compras_pedidos_arquivos").insert({
        pedido_id: pedidoId,
        upload_identify_guid: novoGuid,
        nome_original: anexo.nome_original,
        storage_path: novoStoragePath,
        mime_type: anexo.mime_type,
        tamanho_bytes: anexo.tamanho_bytes,
        uploaded_by_user_id: anexo.uploaded_by_user_id,
      });

      if (errIns) {
        console.warn(`[clonarAnexos] Falha ao inserir metadados de ${anexo.nome_original}:`, errIns.message);
        await supabase.storage.from(STORAGE_BUCKET).remove([novoStoragePath]);
      }
    } catch (err: any) {
      console.warn(`[clonarAnexos] Exceção ao clonar ${anexo.nome_original}:`, err?.message || err);
    }
  }
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

// ═══════════════════════════════════════════════════════════════════
// enviarPedidoParaAprovacao + desembrulharPedido
// ═══════════════════════════════════════════════════════════════════

/**
 * Desembrulha o objeto do pedido de qualquer envelope que o GET possa
 * devolver (objeto direto, .data, lista nomeada, array puro).
 */
function desembrulharPedido(bruto: any): any | null {
  if (!bruto || typeof bruto !== "object") return null;

  if (Array.isArray(bruto.ItemPedCompChildList) && bruto.Numero) return bruto;

  if (bruto.data && typeof bruto.data === "object") {
    const d = bruto.data;
    if (Array.isArray(d.ItemPedCompChildList) && d.Numero) return d;
    if (Array.isArray(d) && d[0]?.ItemPedCompChildList) return d[0];
  }

  for (const chave of ["pedComp", "PedComp", "result", "Result"]) {
    const v = bruto[chave];
    if (Array.isArray(v) && v[0]?.ItemPedCompChildList && v[0]?.Numero) return v[0];
    if (v && typeof v === "object" && Array.isArray(v.ItemPedCompChildList) && v.Numero) return v;
  }

  if (Array.isArray(bruto) && bruto[0]?.ItemPedCompChildList && bruto[0]?.Numero) return bruto[0];

  return null;
}

export interface EnviarAprovacaoResult {
  ok: boolean;
  erro?: string;
  status_aprovacao?: string | null;
  proximo_aprovador?: string | null;
}

/**
 * Envia um pedido existente para aprovação no Alvo.
 */
export async function enviarPedidoParaAprovacao(
  pedidoId: string,
  userId: string,
  userNome: string,
): Promise<EnviarAprovacaoResult> {
  const { data: ped, error: errPed } = await (supabase as any)
    .from("compras_pedidos")
    .select("numero, codigo_empresa_filial, status_local")
    .eq("id", pedidoId)
    .single();

  if (errPed || !ped) {
    return { ok: false, erro: `Pedido não encontrado no Hub: ${errPed?.message || "?"}` };
  }

  if (!ped.numero || ped.numero.startsWith("RASCUNHO-")) {
    return {
      ok: false,
      erro: "Este pedido ainda não foi enviado ao Alvo. Envie o pedido antes de mandar para aprovação.",
    };
  }

  const numeroAlvo = ped.numero;
  const filial = ped.codigo_empresa_filial;

  try {
    const bruto = await callGatewayGet(`/ped-comp/${encodeURIComponent(filial)}/${encodeURIComponent(numeroAlvo)}`);

    const pedidoAlvo = desembrulharPedido(bruto);

    if (!pedidoAlvo) {
      const amostra = JSON.stringify(bruto)?.slice(0, 300);
      return {
        ok: false,
        erro: `GET do pedido ${numeroAlvo} não trouxe ItemPedCompChildList reconhecível. Retorno: ${amostra}`,
      };
    }

    const jaEnviou =
      pedidoAlvo?.PedCompUserFieldsObject?.UserEnviouAprovacao === "Sim" ||
      pedidoAlvo?.PedCompUserFieldsObject?.UserEnviarAprovacao === "Sim";

    if (jaEnviou) {
      const statusAprov = pedidoAlvo?.StatusAprovacao || null;
      const proxAprov = pedidoAlvo?.PedCompUserFieldsObject?.UserProximoAprovador || null;

      await (supabase as any).from("compras_pedidos").upsert(
        {
          id: pedidoId,
          codigo_empresa_filial: filial,
          numero: numeroAlvo,
          enviou_aprovacao: "Sim",
          status_aprovacao: statusAprov,
          proximo_aprovador: proxAprov,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      return {
        ok: true,
        status_aprovacao: statusAprov,
        proximo_aprovador: proxAprov,
      };
    }

    if (!pedidoAlvo.PedCompUserFieldsObject || typeof pedidoAlvo.PedCompUserFieldsObject !== "object") {
      pedidoAlvo.PedCompUserFieldsObject = {};
    }
    pedidoAlvo.PedCompUserFieldsObject.UserEnviarAprovacao = "Sim";

    const resp = await callGatewayJson("/ped-comp/update", pedidoAlvo);
    const respPedido = desembrulharPedido(resp) || resp;

    const statusAprov = respPedido?.StatusAprovacao || null;
    const proxAprov = respPedido?.PedCompUserFieldsObject?.UserProximoAprovador || null;
    const enviou = respPedido?.PedCompUserFieldsObject?.UserEnviouAprovacao || "Sim";

    await (supabase as any).from("compras_pedidos").upsert(
      {
        id: pedidoId,
        codigo_empresa_filial: filial,
        numero: numeroAlvo,
        enviou_aprovacao: enviou,
        status_aprovacao: statusAprov,
        proximo_aprovador: proxAprov,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    await (supabase as any).from("compras_pedidos_auditoria").insert({
      pedido_id: pedidoId,
      evento: "enviado_aprovacao",
      user_id: userId,
      user_nome: userNome,
      sucesso: true,
    });

    console.log(`[enviarAprovacao] pedido ${numeroAlvo} → aprovação OK (status=${statusAprov} prox=${proxAprov})`);

    return {
      ok: true,
      status_aprovacao: statusAprov,
      proximo_aprovador: proxAprov,
    };
  } catch (err: any) {
    const detalhe = err?.details && typeof err.details === "object" ? JSON.stringify(err.details).slice(0, 400) : "";
    const erro = `${err?.message || String(err)}${detalhe ? ` | details: ${detalhe}` : ""}`;

    await (supabase as any).from("compras_pedidos_auditoria").insert({
      pedido_id: pedidoId,
      evento: "enviar_aprovacao_falhou",
      user_id: userId,
      user_nome: userNome,
      sucesso: false,
      mensagem_erro: `[ped ${numeroAlvo}] ${erro}`,
    });

    console.warn(`[enviarAprovacao] falha no pedido ${numeroAlvo}: ${erro}`);
    return { ok: false, erro };
  }
}
