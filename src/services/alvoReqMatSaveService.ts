import { supabase } from "@/integrations/supabase/client";
import { criarRMNoLivro, marcarRMEnviada, marcarRMConfirmada } from "./reqMatService";

/**
 * CRIAÇÃO DE RM NO ALVO — o ciclo de três passos.  ·  OP-2.7
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 POR QUE SÃO TRÊS PASSOS, E NÃO UM
 *
 * RM criada por API **nasce `TipoAtendimento = "Automático"`**, e RM automática
 * NUNCA é atendida. Medido no universo de produção em 07/08/2026 (n=287):
 * **Automático = 16, todas Abertas; Manual = 271, zero aberta.** Em 05/08 era
 * 13/266 — três RMs nasceram mortas em dois dias, e uma delas (a `0000002283`)
 * foi criada pela MARIA.EDUARDA **na tela do Alvo**, não por API. O defeito é do
 * campo, não do nosso caminho; nós só não podemos herdá-lo.
 *
 * Sem o passo 2, toda RM do Hub nasce aberta para sempre, sem baixar estoque e
 * **sem erro nenhum**. É a pior classe de falha: silenciosa e plausível.
 *
 *   passo 1  SaveReqMat  Action=Insert   → devolve `data.Numero`
 *   passo 2  SaveReqMat  Action=Update   → TipoAtendimento: "Manual"
 *   passo 3  ReqMat/Load                 → confirma que ficou "Manual"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CAMINHO: `POST {gateway}/alvo/passthrough` com o JWT do usuário, corpo
 * `{ endpoint, method, payload }` — medido em campo em 07/08/2026 (`alvo.ts`
 * faz `const { endpoint, method, payload } = req.body`). `ReqMat/SaveReqMat`
 * está na whitelist. Nada a fazer no `erp-proxy`.
 *
 * ⚠ **PERDA DE RASTREABILIDADE, CONSCIENTE E REGISTRADA (§10.24).** O contrato
 *   do `SaveReqMat` (22 campos de cabeçalho) **não tem `CodigoUsuario` nem
 *   `UsuarioLogado`** — ao contrário do `PedComp`, onde Projetos resolveu o
 *   achado A-8 mandando o login no corpo. Como o gateway autentica no Alvo por
 *   conta de serviço, `op_reqmat.codigo_usuario` de toda RM criada pelo Hub
 *   trará a CONTA DE SERVIÇO, não quem clicou. Não há campo onde mandar outra
 *   coisa. A rastreabilidade real fica em duas pernas:
 *     · `CodigoFuncionario` no ERP — fixo, do perfil de quem cria;
 *     · `op_requisicoes.criado_por` no livro do Hub.
 *   Quem abrir a coluna "Usuário" do Alvo daqui a seis meses vai ver a conta de
 *   serviço em tudo. É esperado. Não é bug.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";

/** Filial única do Hub (§ Constantes rápidas). */
const FILIAL = "1.01";

/** Tipo REQUISIÇÃO PRODUÇÃO — FIXO. O Hub não oferece escolha de tipo (§10.22). */
const TIPO_REQ_MAT = "0000002";

/**
 * Local de armazenagem. `001` em 287/287 das RMs de produção do ano (medido) e
 * aceito no Insert em campo (07/08/2026, RM 0000002285).
 */
const LOC_ARMAZ = "001";

/**
 * 🔴 A MÉTRICA DE VAZAMENTO DA §10.7 — não trocar sem ler aquela seção.
 *
 * `Origem` é GRAVÁVEL (provado na RM 0000002284) e **sobrevive ao passo 2**
 * (provado na 0000002285: Insert com "Importação" → Update → Load devolveu
 * "Importação" e "Manual"). Como as 688 RMs do espelho são `ManualAlvo`, toda
 * RM nascida no Hub fica distinguível para sempre — é assim que se mede quanto
 * do fluxo ainda passa pela tela do Alvo.
 */
const ORIGEM_HUB = "Importação";

/** Limite duro do `Descricao` no Alvo — acima disso vem BrokenRules (§6.2). */
export const DESCRICAO_MAX = 40;

// ─────────────────────────────────────────────────────────────────────────────

export interface ItemRMEnvio {
  codigo_produto: string;
  codigo_alternativo_produto: string | null;
  /** `stock_products.unidade_medida` — a unidade-base, PosicaoProdUnidMed = 1. */
  produto_unidade: string;
  quantidade: number;
}

export interface DadosRMEnvio {
  op_id: string;
  op_numero: string;
  descricao: string;
  codigo_centro_ctrl: string;
  codigo_funcionario: string;
  texto: string;
  itens: ItemRMEnvio[];
}

/** Onde o ciclo parou. A tela decide o que oferecer a partir daqui. */
export type FaseRM = "livro" | "insert" | "update" | "load" | "completo";

export interface ResultadoEnvioRM {
  ok: boolean;
  /** Id da linha no livro (`op_requisicoes`) — existe desde antes do POST. */
  livroId: string | null;
  /** Número da RM no Alvo. Preenchido a partir do passo 1. */
  numero: string | null;
  fase: FaseRM;
  erro?: string;
}

export class ReqMatSaveError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ReqMatSaveError";
    this.status = status;
  }
}

async function jwt(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ReqMatSaveError("Sessão expirada. Faça login novamente.", 401);
  return session.access_token;
}

/**
 * Chamada ao Alvo pelo passthrough.
 *
 * O gateway devolve `{ ok, status, data, error }`; em erro repassado, o status
 * HTTP da resposta já é o do Alvo. Mesmo tratamento do `alvoReqMatLoadService`.
 */
async function chamarAlvo(endpoint: string, method: "GET" | "POST", payload?: unknown): Promise<any> {
  const token = await jwt();

  let resp: Response;
  try {
    resp = await fetch(`${ERP_PROXY_URL}/alvo/passthrough`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload === undefined ? { endpoint, method } : { endpoint, method, payload }),
    });
  } catch (e: any) {
    throw new ReqMatSaveError(`Falha de rede ao falar com o gateway: ${e?.message || String(e)}`, 0);
  }

  let envelope: any = null;
  try {
    envelope = await resp.json();
  } catch {
    /* resposta sem corpo JSON */
  }

  const statusAlvo = Number(envelope?.status ?? resp.status);

  if (!resp.ok || envelope?.ok === false) {
    const detalhe = envelope?.error || envelope?.data?.Message || envelope?.data?.ExceptionMessage;
    throw new ReqMatSaveError(`ERP respondeu ${statusAlvo}${detalhe ? `: ${detalhe}` : ""}`, statusAlvo);
  }

  return envelope?.data ?? null;
}

/**
 * Monta o `ClassObject` do `SaveReqMat`.
 *
 * Contrato medido do Network (§10.16) — os nomes são os da LEITURA
 * (`CodigoTipoReqMat`, `CodigoCentroCtrl`, `ItemReqMatChildList`,
 * `CodigoProdUnidMed`), NÃO os do swagger. O servidor preenche sozinho `Data`,
 * `Operacao`, `DataValidade`, `Status` e `EspecieDocumento`.
 *
 * ⚠ Placeholders do item no Insert são STRING VAZIA, não `-1` — diferente do
 *   `DocFin/SavePartial`. E `Numero: ""` funciona AQUI (no `InserirAlterar`
 *   dava SqlException 156): o comportamento é do endpoint, não da entidade.
 */
function montarClassObject(d: DadosRMEnvio, numero: string): Record<string, unknown> {
  return {
    CodigoEmpresaFilial: FILIAL,
    Numero: numero,
    Descricao: d.descricao,
    CodigoTipoReqMat: TIPO_REQ_MAT,
    CodigoFuncionario: d.codigo_funcionario,
    CodigoCentroCtrl: d.codigo_centro_ctrl,
    CodigoLocArmaz: LOC_ARMAZ,
    EspecieDocumento: "RM",
    AlarmeValidade: "Não",
    Origem: ORIGEM_HUB,
    TipoFormulario: "Normal",
    IsEstorno: false,
    ExisteRetiradaDaTransferencia: "Não",
    ExisteTransferenciadaRetirada: "Não",
    CodigoFuncionarioAtendente: null,
    CodigoFuncionarioDevolveu: null,
    CodigoFuncionarioRecebeu: null,
    CodigoLocArmazDestino: null,
    DataRecebimento: null,
    Texto: d.texto,
    MensagemRetorno: "",
    UploadIdentify: "",
    ItemReqMatChildList: d.itens.map((it, idx) => ({
      CodigoEmpresaFilial: "",
      NumeroReqMat: numero,
      Sequencia: idx + 1,
      CodigoProduto: it.codigo_produto,
      CodigoAlternativoProduto: it.codigo_alternativo_produto ?? "",
      // (a) UNIDADE — usamos a unidade-base do catálogo (PosicaoProdUnidMed = 1).
      // ~4% dos itens usam outra posição (§9.8); a conversão por proporção
      // resolve na LEITURA. É escolha registrada, não descuido.
      CodigoProdUnidMed: it.produto_unidade,
      PosicaoProdUnidMed: 1,
      CodigoLocArmaz: LOC_ARMAZ,
      // As quatro quantidades repetem o pedido. Foi o payload que passou em
      // campo (07/08/2026) — não é dedução.
      QuantidadeProdUnidMedPrincipal: it.quantidade,
      QuantidadeSaldoProdUnidMedPrincipal: it.quantidade,
      QuantidadeEmpenharProdUnidMedPrincipal: it.quantidade,
      Quantidade2: it.quantidade,
      QuantidadeSaldo2: it.quantidade,
      QuantidadeEmpenhar2: it.quantidade,
      AvisoRetorno: "",
    })),
  };
}

/**
 * Extrai o número da RM da resposta do Insert.
 *
 * ⚠ Medido em 07/08/2026: por ESTA rota o envelope vem LIMPO — `data` é o
 *   objeto ReqMat direto e o número está em `data.Numero` ("0000002285"). Não
 *   há o eco bugado do `PedComp` (§6.2), onde o `Numero` é replicado em todos
 *   os campos string. Ainda assim lemos SÓ `Numero`, e a verdade final vem do
 *   `Load` do passo 3.
 */
function extrairNumero(data: any): string | null {
  const n = data?.Numero;
  if (typeof n !== "string") return null;
  const limpo = n.trim();
  return limpo.length > 0 ? limpo : null;
}

/** Lê `TipoAtendimento` do corpo do `ReqMat/Load`. */
function tipoAtendimentoDe(data: any): string | null {
  const t = data?.TipoAtendimento;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Passos 2 e 3, isolados — a tela reexecuta SÓ eles quando o Insert já passou
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Passo 2 + passo 3, a partir de uma RM que JÁ EXISTE no Alvo.
 *
 * 🔴 É o caminho de recuperação do estado perigoso. Quando o Insert passa e o
 *    Update falha, a RM existe no ERP e está morta — e o reflexo do operador
 *    ("não funcionou, vou de novo") DUPLICARIA a RM. Por isso a tela oferece
 *    "Concluir envio (passo 2)" e não "criar de novo".
 */
export async function concluirEnvioRM(
  livroId: string,
  numero: string,
  dados: DadosRMEnvio,
): Promise<ResultadoEnvioRM> {
  // ── Passo 2 — TipoAtendimento: "Manual" ──
  try {
    await chamarAlvo("ReqMat/SaveReqMat", "POST", {
      Action: "Update",
      ClassObject: { ...montarClassObject(dados, numero), TipoAtendimento: "Manual" },
    });
  } catch (e: any) {
    const erro = e?.message || String(e);
    await marcarRMEnviada(livroId, numero, null, `Passo 2 (TipoAtendimento) falhou: ${erro}`);
    return { ok: false, livroId, numero, fase: "update", erro };
  }

  // ── Passo 3 — Load de confirmação ──
  try {
    const data = await chamarAlvo(
      `ReqMat/Load?numero=${encodeURIComponent(numero)}&loadChild=All`,
      "GET",
    );
    const tipo = tipoAtendimentoDe(data);

    if (tipo !== "Manual") {
      const erro = `O ERP aceitou a alteração mas devolveu TipoAtendimento = "${tipo ?? "(vazio)"}". A RM ${numero} pode não ser atendida.`;
      await marcarRMEnviada(livroId, numero, data, erro);
      return { ok: false, livroId, numero, fase: "load", erro };
    }

    const r = await marcarRMConfirmada(livroId, data);
    if (!r.ok) {
      // A RM está certa no ERP; só o livro não registrou. Não é falha do envio.
      return { ok: true, livroId, numero, fase: "completo", erro: r.mensagem };
    }
    return { ok: true, livroId, numero, fase: "completo" };
  } catch (e: any) {
    // Passo 3 falhando sozinho é benigno: o passo 2 já passou e o próximo sync
    // (≤3h) traz o `tipo_atendimento` real. Fica em `enviado` com a nota.
    const erro = e?.message || String(e);
    await marcarRMEnviada(livroId, numero, null, `Passo 3 (confirmação) falhou: ${erro}`);
    return { ok: false, livroId, numero, fase: "load", erro };
  }
}

/**
 * O ciclo completo: livro → Insert → Update → Load.
 *
 * O livro nasce ANTES do POST (§10.14): se a rede cair depois de o Alvo gravar,
 * a linha pré-gravada é o único rastro para reconciliar a RM órfã.
 */
export async function criarRMNoAlvo(dados: DadosRMEnvio): Promise<ResultadoEnvioRM> {
  // ── Passo 0 — o livro ──
  const criacao = await criarRMNoLivro(dados.op_id, {
    descricao: dados.descricao,
    codigo_centro_ctrl: dados.codigo_centro_ctrl,
    codigo_funcionario: dados.codigo_funcionario,
    texto: dados.texto,
    codigo_tipo_req_mat: TIPO_REQ_MAT,
    codigo_loc_armaz: LOC_ARMAZ,
    origem: ORIGEM_HUB,
    itens: dados.itens,
  });
  if (!criacao.ok) {
    return { ok: false, livroId: null, numero: null, fase: "livro", erro: criacao.mensagem };
  }
  const livroId = criacao.id;

  // ── Passo 1 — Insert ──
  let numero: string | null = null;
  try {
    const data = await chamarAlvo("ReqMat/SaveReqMat", "POST", {
      Action: "Insert",
      ClassObject: montarClassObject(dados, ""),
    });
    numero = extrairNumero(data);

    if (!numero) {
      // ⚠ 200-sem-Numero NÃO é sucesso, mas TAMBÉM não é prova de que nada foi
      // criado — a RM pode existir no ERP. Mesma decisão do `/ped-comp/insert`
      // do L7-B. Registramos como erro COM a resposta crua, e o texto manda
      // conferir antes de tentar de novo.
      const erro =
        "O ERP respondeu sem número de RM. Confira no Alvo se a requisição foi criada ANTES de tentar novamente — pode haver RM órfã.";
      await marcarRMEnviada(livroId, null, data, erro);
      return { ok: false, livroId, numero: null, fase: "insert", erro };
    }

    const marcado = await marcarRMEnviada(livroId, numero, data, null);
    if (!marcado.ok) {
      // A RM existe no ERP e o Hub não registrou — exatamente o achado A-2 de
      // Projetos. Não seguimos para o passo 2 sem rastro no livro.
      return {
        ok: false,
        livroId,
        numero,
        fase: "insert",
        erro: `RM ${numero} criada no ERP, mas o Hub não registrou: ${marcado.mensagem}`,
      };
    }
  } catch (e: any) {
    const erro = e?.message || String(e);
    await marcarRMEnviada(livroId, null, null, erro);
    return { ok: false, livroId, numero: null, fase: "insert", erro };
  }

  // ── Passos 2 e 3 ──
  return concluirEnvioRM(livroId, numero, dados);
}
