import { supabase } from "@/integrations/supabase/client";
import { marcarEnviado, descricaoErro, falhou } from "./projetosService";
import { resolverUsuarioAlvoOuNull, consolidarRateioDoItem, type ConsolidacaoRateio } from "./pedidosService";

/**
 * L7-B — o envio passa pelo erp-proxy, não mais direto ao Alvo.
 *
 * Antes: authenticateAlvo() lia `alvo_username`/`alvo_password` do localStorage
 * do navegador e postava em pef.it4you.inf.br. Consequências (achado A-8):
 *   · quem não tivesse as credenciais no próprio navegador não conseguia enviar
 *     ("Falha na autenticação ERP") — era o caso da Ana e do nfe@;
 *   · o pedido ia ao ERP carimbado com o dono das credenciais, não com quem
 *     clicou. Dois pedidos foram parar no Alvo como PEDRO.SCRIGNOLI.
 *
 * Agora: POST {ERP_PROXY_URL}/ped-comp/insert com o JWT do Supabase. O gateway
 * autentica no Alvo por conta de serviço (env do Render) e faz o retry de
 * 401/403/409 por dentro — por isso o loop de retry saiu daqui.
 */
const ERP_PROXY_URL = "https://erp-proxy.onrender.com";

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

/**
 * Uma linha do rateio deste módulo: classe + centro de custo + a fatia do valor
 * TOTAL do pedido. Estrutura PLANA — diferente do rateio hierárquico do
 * Suprimentos (classe → CCs). Os códigos são opcionais de propósito: a linha
 * nasce em branco quando a pessoa clica em "Adicionar Classe", e é exatamente
 * essa linha que `validarLinhasRateio` existe para recusar.
 */
export interface LinhaRateioProjeto {
  classe_codigo?: string | null;
  centro_custo_codigo?: string | null;
  percentual?: number;
}

/**
 * Valida as LINHAS do rateio (preenchimento e unicidade). Devolve a mensagem do
 * primeiro problema encontrado, ou `null` se estiver tudo certo.
 *
 * 🔴 POR QUE EXISTE. O Alvo tem UNIQUE em
 * (filial, número, produto, sequência, classe, CC). Até 27/08/2026 as TRÊS
 * camadas de validação do módulo — esta, a UI (`ProjetoRequisicoes.tsx`) e a RPC
 * `projeto_pedido_salvar` — checavam **apenas a soma dar 100%**. Consequência:
 * com o rateio já em 100%, dois cliques em "Adicionar Classe" criam duas linhas
 * com `percentual: 0` e classe/CC VAZIOS (`ProjetoRequisicoes.tsx:1635`); a soma
 * continua 100, passa nas três, e o payload sai com dois nós idênticos de
 * `CodigoClasseRecDesp: ''` + `CodigoCentroCtrl: ''` — tupla repetida.
 * No Suprimentos, a mesma forma queimou 6 números do sequencer e 31 minutos no
 * pedido 0004781.
 *
 * ⚠️ REJEITA, não consolida. Linha em branco a 0% é sobra de clique, não
 * intenção de rateio — consolidar mascararia. (Consolidar o rateio do módulo é
 * outro card, fora deste escopo.)
 *
 * ⚠️ A mensagem nomeia a LINHA e o PROBLEMA. No 0004781 o custo não foi o erro,
 * foi a pessoa não saber o que consertar: o Alvo devolvia `Friendly_Message_UQ_PK`
 * cru e ela tentou de novo sete vezes.
 */
export function validarLinhasRateio(rateio: readonly LinhaRateioProjeto[]): string | null {
  const vistos = new Map<string, number>();

  for (let i = 0; i < rateio.length; i++) {
    const linha = i + 1;
    const classe = String(rateio[i]?.classe_codigo ?? "").trim();
    const cc = String(rateio[i]?.centro_custo_codigo ?? "").trim();

    if (!classe && !cc) {
      return `Linha ${linha} do rateio está em branco (sem classe e sem centro de custo). Preencha ou remova a linha.`;
    }
    if (!classe) {
      return `Linha ${linha} do rateio: classe não preenchida.`;
    }
    if (!cc) {
      return `Linha ${linha} do rateio: centro de custo não preenchido (classe ${classe}).`;
    }

    const chave = `${classe}|${cc}`;
    const anterior = vistos.get(chave);
    if (anterior !== undefined) {
      return `Linhas ${anterior} e ${linha} do rateio repetem a mesma combinação (classe ${classe}, centro de custo ${cc}). O ERP não aceita a repetição — junte as duas numa linha só.`;
    }
    vistos.set(chave, linha);
  }

  return null;
}

/** Uma linha do rateio já consolidada, com o valor que vai ao payload. */
export interface LinhaRateioProjetoConsolidada {
  classe_codigo: string;
  centro_custo_codigo: string;
  /** Fatia do valor de referência (item ou pedido), em %. Soma dos originais colapsados. */
  percentual: number;
  /** Valor da linha, em reais. SOMADO dos valores já calculados — nunca recalculado. */
  valor: number;
}

/**
 * Consolida o rateio deste módulo por (classe, CC), reusando
 * `consolidarRateioDoItem` — a MESMA função que fechou o D4 no Suprimentos.
 *
 * 🔴 POR QUE EXISTE (pendência §7.29 / §13.7 do `PLANO-PROJETOS`). Este módulo
 * montava o rateio com `rateio.map()` 1:1, sem agrupar (classe, CC) — a forma
 * exata que derrubou o pedido 0004781 do Suprimentos com `Friendly_Message_UQ_PK`,
 * queimando 6 números do sequencer. O Alvo tem UNIQUE em
 * (filial, número, produto, sequência, classe, CC).
 *
 * ⚠️ DEFESA EM PROFUNDIDADE, não o portão principal. Desde o card do wizard,
 * `validarLinhasRateio` **recusa** o par (classe, CC) repetido nos dois portões
 * (UI e `validar()`), então pelo caminho normal esta consolidação não tem o que
 * colapsar. Ela existe para o dia em que a validação for relaxada ou o input
 * chegar por outro caminho — e por isso registra em `console.warn` quando age:
 * se alguém vir esse aviso, uma validação foi contornada.
 *
 * ⚠️ ESCOPO DELIBERADAMENTE ESTREITO — colapsa só o que o UNIQUE do ERP proíbe.
 * A saída continua PLANA (um nó de classe por linha), como este módulo sempre
 * mandou, em vez de virar hierárquica como no Suprimentos. Duas linhas da MESMA
 * classe com CCs DIFERENTES não violam o UNIQUE (ele inclui o CC), e fundi-las
 * num nó só mudaria a convenção do `Percentual` do CC — de fatia do total
 * (o que este módulo manda hoje) para fatia da classe (o que o Suprimentos
 * manda). Com **exposição zero medida** em `projeto_requisicoes.classe_rateio`,
 * não se arrisca o caminho de criação, que acabou de ser validado pelo A/B
 * 0004798 × 0004799. Unificar as duas convenções é card próprio.
 *
 * ⚠️ `valor` vem SOMADO das linhas colapsadas, nunca recalculado a partir do
 * percentual somado — regra do D4 (`docs/D4-PLANO-CORRECAO.md` §2). Cada parcela
 * é `round2` do seu próprio pedaço; é a soma delas que fecha contra o total.
 * `percentual` vem da soma EXATA dos originais, não derivado do percentual
 * relativo que a função devolve: derivar reintroduziria um arredondamento a 2
 * casas que a linha original não tinha.
 *
 * ℹ️ A ordem passa a ser por classe (primeira aparição), depois por CC. Sem
 * repetição, o conteúdo de cada linha é idêntico ao de antes.
 */
export function consolidarRateioProjeto(
  rateio: readonly LinhaRateioProjeto[],
  valorReferencia: number,
): { linhas: LinhaRateioProjetoConsolidada[]; consolidacoes: ConsolidacaoRateio[] } {
  // Cada linha plana vira uma "classe com um único CC a 100%" — a forma que
  // `consolidarRateioDoItem` consome.
  const hierarquico = rateio.map((r) => ({
    codigo_classe_rec_desp: String(r.classe_codigo ?? ""),
    // Obrigatório no tipo do Suprimentos e ignorado por `consolidarRateioDoItem`:
    // o rótulo não volta na saída e não entra no payload deste módulo.
    classe_rec_desp_label: "",
    percentual: Number(r.percentual) || 0,
    ccs: [{ codigo_centro_ctrl: String(r.centro_custo_codigo ?? ""), percentual: 100 }],
  }));

  const { classes, consolidacoes } = consolidarRateioDoItem(hierarquico, valorReferencia);

  // Soma exata dos percentuais originais por (classe, CC).
  const pctPorPar = new Map<string, number>();
  for (const r of rateio) {
    const chave = `${String(r.classe_codigo ?? "")}|${String(r.centro_custo_codigo ?? "")}`;
    pctPorPar.set(chave, (pctPorPar.get(chave) ?? 0) + (Number(r.percentual) || 0));
  }

  const linhas = classes.flatMap((cls) =>
    cls.RateioItemPedCompChildList.map((cc) => ({
      classe_codigo: cls.CodigoClasseRecDesp,
      centro_custo_codigo: cc.CodigoCentroCtrl,
      percentual: pctPorPar.get(`${cls.CodigoClasseRecDesp}|${cc.CodigoCentroCtrl}`) ?? 0,
      valor: cc.Valor,
    })),
  );

  return { linhas, consolidacoes };
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

  const problema = validarLinhasRateio(rateio);
  if (problema) throw new Error(problema);

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

function buildPayload(req: any, condPag: any, projetoNome: string, codigoUsuario: string) {
  const now = hoje();
  const nowStr = fmtDate(now);
  const itens = req.itens as any[];
  const rateio = req.classe_rateio as any[];
  const valorTotal = Number(req.valor_total) || 0;
  // b4: `codigoUsuario` chega resolvido de profiles.alvo_usuario (quem clicou).
  // Não existe mais leitura de localStorage nem fallback hardcoded aqui.

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
      ItemPedCompClasseRecdespChildList: consolidarRateioProjeto(rateio, total).linhas.map((r) => ({
        CodigoEmpresaFilial: "",
        NumeroPedComp: "",
        CodigoProduto: item.codigoProduto,
        SequenciaItemPedComp: 0,
        CodigoClasseRecDesp: r.classe_codigo,
        Valor: r.valor,
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
            Valor: r.valor,
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
  // Mesma consolidação do item, agora sobre o valor do PEDIDO. O cabeçalho não
  // tinha o defeito do UQ_PK (o UNIQUE do Alvo é no item), mas montava o rateio
  // pelo mesmo `map()` 1:1 — deixá-lo fora produziria cabeçalho e item com
  // números de linhas diferentes para o mesmo input, que é justamente a
  // assimetria que o D4 existiu para matar (lá era o inverso: cabeçalho
  // consolidava, item não).
  const { linhas: rateioCabecalho, consolidacoes } = consolidarRateioProjeto(rateio, valorTotal);

  if (consolidacoes.length > 0) {
    // Chegar aqui significa que `validarLinhasRateio` foi contornada: ela recusa
    // o par (classe, CC) repetido antes do envio, nos dois portões.
    console.warn(
      "[PedComp] rateio com (classe, CC) repetido chegou ao payload e foi consolidado — " +
        "a validação de unicidade foi contornada:",
      consolidacoes,
    );
  }

  const classeHeader = rateioCabecalho.map((r) => ({
    CodigoEmpresaFilial: "-1",
    NumeroPedComp: "-1",
    CodigoClasseRecDesp: r.classe_codigo,
    Valor: r.valor,
    Percentual: r.percentual,
    ExcluiCentroControleValorZero: "Sim",
    RateioPedCompChildList: [
      {
        CodigoEmpresaFilial: "-1",
        NumeroPedComp: "-1",
        CodigoClasseRecDesp: r.classe_codigo,
        CodigoCentroCtrl: r.centro_custo_codigo,
        Valor: r.valor,
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
    // b3 — CodigoComprador SEMPRE null (decisão de 22/06, ver pedidosService.ts:281).
    // O literal "0000013" que estava aqui é o funcionario_alvo_codigo do
    // cleber.rosa@pfbrazil.com: todo pedido de projeto ia ao ERP com ele como
    // comprador, sem que ninguém tivesse decidido isso.
    CodigoComprador: null,
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
    // 🔴 NÃO REPOR OS CAMPOS DE APROVAÇÃO AQUI.
    // `UserEnviarAprovacao: "Sim"` é o COMANDO que dispara a cadeia de aprovação
    // no Alvo — é exatamente o que `enviarPedidoParaAprovacao` escreve no passo
    // manual do Suprimentos (pedidosService.ts:2689, seguido de POST
    // /ped-comp/update). Mandá-lo no INSERT faz o pedido nascer já enviado para
    // aprovação, pulando a autorização humana: foi assim que o 0004664
    // (R$ 110 mil) percorreu a cadeia inteira e foi aprovado em 26/08/2026 sem
    // ninguém no Hub ter dado o comando.
    // `UserEnviouAprovacao` é o FATO, derivado pelo ERP — o Hub só lê, nunca escreve.
    // Objeto vazio replica o contrato do Suprimentos (pedidosService.ts:1256).
    PedCompUserFieldsObject: {},
    UploadIdentify: "",
  };
}

// ── POST with retry ──

/**
 * POST /ped-comp/insert no gateway.
 *
 * O `callAlvo` do proxy NÃO lança exceção — devolve o resultado e o proxy
 * traduz em status HTTP. Então aqui o tratamento é por `resp.ok`/status, no
 * molde do pedidosService: nada de try/catch esperando throw.
 * Retry de 401/403/409 é responsabilidade do gateway.
 */
async function postPedidoViaGateway(payload: any, jwt: string): Promise<any> {
  const resp = await fetch(`${ERP_PROXY_URL}/ped-comp/insert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await resp.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!resp.ok) {
    const detalhe =
      (data && typeof data === "object" && (data.error || data.message)) ||
      (typeof data === "string" ? data : JSON.stringify(data)?.slice(0, 500));
    throw new Error(`Gateway HTTP ${resp.status}: ${detalhe || "sem detalhe"}`);
  }

  return data;
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

    // ── b2 + b4: identidade do operador ANTES de qualquer chamada ao ERP ──
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token || !session.user?.id) {
      throw new Error("Sessão expirada — faça login novamente antes de enviar ao ERP.");
    }

    // b4: sem login do Alvo, o envio PARA. Nunca cair em fallback nem mandar o
    // CodigoUsuario de outra pessoa — pedido no ERP com identidade errada é pior
    // do que pedido não enviado (foi assim que 2 pedidos saíram como o Pedro).
    const codigoUsuario = await resolverUsuarioAlvoOuNull(session.user.id, session.user.email);
    if (!codigoUsuario) {
      throw new Error(
        "Usuário sem login do Alvo configurado — contate o administrador. " +
          "O pedido NÃO foi enviado ao ERP para não ser lançado com a identidade de outra pessoa.",
      );
    }

    const condPag = await fetchCondPag(req.cond_pagamento_codigo);
    const payload = buildPayload(req, condPag, projetoNome, codigoUsuario);

    console.log(`[PedComp] Enviando via gateway como ${codigoUsuario}:`, JSON.stringify(payload).substring(0, 500));

    const result = await postPedidoViaGateway(payload, session.access_token);

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
