import type { SubmissaoResult } from "@/services/requisicoesService";

/**
 * Para onde o wizard de nova requisição vai DEPOIS de `submeterRequisicao`.
 *
 * `permanece` é a única situação em que a tela do wizard continua viva com o mesmo
 * estado — e é justamente ela que exige regenerar os GUIDs dos anexos (ver
 * `regenerarGuidsAnexos`).
 */
export type DestinoSubmissao =
  | { tipo: "lista" }
  | { tipo: "detalhe"; requisicaoId: string }
  | { tipo: "permanece" };

/**
 * Decisão de navegação extraída do componente para poder ser testada.
 *
 * A ordem dos ramos é EXATAMENTE a do `handleEnviar` de `SuprimentosRequisicaoNova`
 * (os `else if` são mutuamente exclusivos e a ordem importa):
 *
 *   1. rota === "PENDENTE"        → foi para a fila do líder            → lista
 *   2. sucesso                    → chegou ao ERP                       → lista
 *   3. rota === null              → recusa no roteamento; o RASCUNHO
 *                                   existe e já tem os anexos gravados  → detalhe
 *   4. numero_alvo                → chegou ao ERP mas o Hub não
 *                                   registrou; reenviar DUPLICARIA      → permanece
 *   5. rota === "AUTO_APROVADA"   → aprovada, envio ao ERP falhou       → permanece
 *   6. (else, rota === "SEM_GATE")→ falha de envio; salvo como rascunho → detalhe
 *
 * Ir para o detalhe nos ramos 3 e 6 é a defesa principal contra o 23505 em
 * `compras_requisicoes_arquivos_upload_identify_guid_key`: no detalhe o botão
 * "Reenviar" reusa os anexos JÁ GRAVADOS (lê os GUIDs do banco em
 * `requisicoesService.ts:1113` / `:721`), em vez de criar OUTRA requisição
 * reinserindo os mesmos GUIDs.
 *
 * Sem `requisicao_id` não há detalhe para onde ir — cai em `permanece` e o wizard
 * segue na tela, como fazia antes.
 */
export function destinoAposSubmissao(result: SubmissaoResult): DestinoSubmissao {
  if (result.rota === "PENDENTE") return { tipo: "lista" };
  if (result.sucesso) return { tipo: "lista" };

  if (result.rota === null) {
    return result.requisicao_id ? { tipo: "detalhe", requisicaoId: result.requisicao_id } : { tipo: "permanece" };
  }
  if (result.numero_alvo) return { tipo: "permanece" };
  if (result.rota === "AUTO_APROVADA") return { tipo: "permanece" };

  return result.requisicao_id ? { tipo: "detalhe", requisicaoId: result.requisicao_id } : { tipo: "permanece" };
}

/**
 * Cinto e suspensórios do mesmo defeito: sempre que a tela PERMANECE depois de uma
 * falha, os GUIDs dos anexos em memória precisam ser trocados por novos.
 *
 * POR QUÊ: `upload_identify_guid` identifica o anexo DAQUELA tentativa e tem UNIQUE
 * GLOBAL no banco (`compras_requisicoes_arquivos_upload_identify_guid_key`) — não
 * por requisição. O wizard gera o GUID uma única vez, ao escolher o arquivo. Cada
 * novo clique em "Enviar" chama `criarRequisicao`, que cria OUTRA requisição e
 * reinsere O MESMO GUID ⇒ 23505, e o rascunho fica pela metade. Foi o que produziu
 * 14 rascunhos-lixo em 04/09/2026 (defeito latente desde 18/05).
 *
 * Preserva todos os demais campos do anexo (o `File`, principalmente): só o GUID muda.
 */
export function regenerarGuidsAnexos<T extends { upload_identify_guid: string }>(arquivos: T[]): T[] {
  return arquivos.map((arquivo) => ({ ...arquivo, upload_identify_guid: crypto.randomUUID() }));
}

/**
 * Aviso a mostrar quando o 2º tempo (o envio ao ERP) falha depois de a aprovação
 * já estar gravada.
 *
 * POR QUE ISTO EXISTE: a tela concatenava o erro cru com `Use "Reenviar"`, e o
 * erro cru às vezes diz o oposto — `enviarRequisicaoAlvo` emite "Envio sem
 * confirmação do ERP. Recarregue o detalhe; não repita sem reconciliar."
 * O usuário lia "não repita sem reconciliar — Use Reenviar" na mesma frase.
 * Em 08/09/2026 isso apareceu em produção com o desfecho mais perigoso possível:
 * o documento EXISTIA no ERP (0001481) e reenviar teria duplicado.
 *
 * REGRA: `Reenviar` só é oferecido com PROVA POSITIVA de que nada chegou ao ERP.
 * Essa prova é a frase que o próprio gate de submissão emite quando recusa antes
 * de qualquer chamada ao Alvo (ver `mensagemRecusaSubmissao`). Qualquer outra
 * falha — timeout, 5xx, ANEXO_CONGELADO, violação de chave ao gravar o desfecho —
 * deixa o desfecho DESCONHECIDO, e o padrão passa a ser reconciliar.
 *
 * Lista positiva, nunca dedução por exclusão: erro novo que apareça no futuro cai
 * no ramo conservador por omissão, e não no que duplica documento no ERP.
 */
const SINAL_NADA_ENVIADO = /nada foi enviado ao erp/i;

/**
 * Recusa do ERP por licença esgotada — o texto literal do Alvo é
 * "Você tentou acessar uma transação do módulo Prime Back Office mas todas as
 * licenças estão em uso." Apareceu 7 vezes em 09/09/2026 entre 12:02 e 13:39 UTC,
 * atingindo 4 pessoas e 100% dos envios do dia; zero ocorrências nos 5 meses
 * anteriores de auditoria.
 *
 * Isto NÃO é prova de que nada chegou ao ERP: o gateway já havia despachado o
 * POST `ReqComp/…?action=Insert` quando essa mensagem voltou (a auditoria das 7
 * gravou `falha_definitiva: false`, que o gateway só produz DEPOIS de iniciar a
 * chamada). Por isso a assinatura entra aqui apenas para TRADUZIR o texto — segue
 * no ramo conservador, sem liberar "Reenviar", até que se comprove no ERP que a
 * recusa acontece antes da gravação.
 */
const SINAL_LICENCA_ESGOTADA = /licen[çc]as?\s+est[ãa]o\s+em\s+uso|prime\s+back\s+office/i;

export interface ErroEnvioTraduzido {
  titulo: string;
  descricao: string;
  /** Texto literal do ERP — sai da frase principal, mas nunca some da tela. */
  detalheTecnico: string;
}

/**
 * Traduz para linguagem de quem usa o Hub as recusas do ERP cuja mensagem crua não
 * significa nada para quem lê ("Prime Back Office", "licenças em uso"). Devolve
 * `null` quando a mensagem não é de uma assinatura conhecida — aí a tela mostra o
 * texto do ERP como sempre mostrou, e nada muda.
 *
 * Lista positiva, como no aviso pós-aprovação: traduzir por semelhança seria pior
 * que não traduzir, porque uma tradução errada é lida como diagnóstico.
 */
export function traduzirErroEnvioAlvo(erro: string | null | undefined): ErroEnvioTraduzido | null {
  const mensagem = erro?.trim();
  if (!mensagem || !SINAL_LICENCA_ESGOTADA.test(mensagem)) return null;

  return {
    titulo: "ERP sem licença disponível — envio recusado",
    descricao:
      "O ERP recusou a operação porque todas as licenças do módulo estão ocupadas. " +
      "Não é erro da sua requisição nem do preenchimento, e não adianta corrigir os dados. " +
      "NÃO crie outra requisição para o mesmo pedido: peça ao Suprimentos para conferir no ERP " +
      "se ela chegou a ser criada antes de tentar de novo.",
    detalheTecnico: mensagem,
  };
}

export interface AvisoFalhaEnvio {
  titulo: string;
  descricao: string;
  /** false ⇒ a tela não deve oferecer "Reenviar": reenviar pode duplicar no ERP. */
  podeReenviar: boolean;
  /**
   * Texto literal do ERP, quando a `descricao` foi reescrita e já não o contém.
   * Ausente nos ramos que embutem a mensagem original na própria frase.
   */
  detalheTecnico?: string;
}

export function avisoFalhaEnvioPosAprovacao(erro: string, ondeReenviar = "abaixo"): AvisoFalhaEnvio {
  const mensagem = erro?.trim() || "Falha sem mensagem.";

  if (SINAL_NADA_ENVIADO.test(mensagem)) {
    return {
      titulo: "Aprovada, mas o envio ao ERP falhou",
      descricao: `${mensagem} — a aprovação foi preservada e nada foi criado no ERP. Use "Reenviar" ${ondeReenviar}.`,
      podeReenviar: true,
    };
  }

  const traduzido = traduzirErroEnvioAlvo(mensagem);
  if (traduzido) {
    return {
      titulo: traduzido.titulo,
      descricao: `A aprovação foi preservada. ${traduzido.descricao}`,
      podeReenviar: false,
      detalheTecnico: traduzido.detalheTecnico,
    };
  }

  return {
    titulo: "Aprovada — desfecho do envio INCERTO",
    descricao:
      `${mensagem} — a aprovação foi preservada. NÃO reenvie: o documento pode ter sido criado no ERP, ` +
      `e reenviar duplicaria. Confira o número no ERP e acione a reconciliação.`,
    podeReenviar: false,
  };
}
