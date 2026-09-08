/**
 * Decisão de UI depois de uma falha no envio de pedido ao ERP.
 *
 * POR QUE ISTO EXISTE: a lista de pedidos mostrava `erro_envio.message` cru e, logo
 * abaixo, o convite "Clique para editar" — sem nunca dizer que o pedido podia já existir
 * no Alvo. Em 08/09/2026 isso custou uma duplicata real: a primeira tentativa criou o
 * pedido 0004864 no ERP e falhou ao gravar o vínculo; a pessoa editou e reenviou; a
 * segunda criou o 0004865. Mesmo valor (R$ 7.548), mesmo fornecedor, dois documentos.
 *
 * REGRA (a mesma de `avisoFalhaEnvioPosAprovacao`, em requisições): retry só é oferecido
 * com PROVA POSITIVA de que nada chegou ao ERP. Lista positiva, nunca dedução por
 * exclusão — sinal novo que apareça no futuro cai no ramo conservador, não no que
 * duplica documento.
 *
 * As três provas de que o ERP JÁ criou (qualquer uma basta):
 *   1. o pedido tem número real — só é gravado a partir da resposta do Alvo;
 *   2. `resposta_200_sem_numero`: o ERP respondeu 200 sem informar número, o caso
 *      ambíguo por definição;
 *   3. a mensagem cita um número de pedido — cobre as linhas anteriores à correção A2,
 *      que perderam o número mas guardaram a mensagem (ex.: `RASCUNHO-a28ae319`, cuja
 *      mensagem nomeia o pedido 0004867).
 */

/** Número de documento do Alvo: 7 dígitos, como 0004867. */
const NUMERO_ALVO_NA_MENSAGEM = /\b\d{7}\b/;

export interface ErroEnvioPedido {
  message?: string | null;
  tipo?: string | null;
  resposta_200_sem_numero?: boolean | null;
}

export interface AvisoFalhaPedido {
  /** false ⇒ a tela NÃO deve abrir o pedido para edição/reenvio. */
  podeReenviar: boolean;
  titulo: string;
  descricao: string;
}

export function pedidoTemNumeroReal(numero: string | null | undefined): boolean {
  const n = (numero ?? "").trim();
  return n.length > 0 && !n.startsWith("RASCUNHO-");
}

export function avisoFalhaEnvioPedido(
  numero: string | null | undefined,
  erro: ErroEnvioPedido | null | undefined,
): AvisoFalhaPedido {
  const mensagem = (erro?.message ?? "").trim();

  const temNumeroReal = pedidoTemNumeroReal(numero);
  const respostaSemNumero = erro?.resposta_200_sem_numero === true || erro?.tipo === "resposta_200_sem_numero";
  const mensagemCitaNumero = NUMERO_ALVO_NA_MENSAGEM.test(mensagem);

  if (temNumeroReal || respostaSemNumero || mensagemCitaNumero) {
    const identificacao = temNumeroReal
      ? `O pedido ${String(numero).trim()} foi criado no ERP`
      : "O pedido pode ter sido criado no ERP";

    return {
      podeReenviar: false,
      titulo: "Falhou depois de criar no ERP — não reenvie",
      descricao:
        `${identificacao}, mas o Hub não conseguiu concluir o registro. ` +
        `NÃO reenvie nem edite para tentar de novo: cada tentativa cria OUTRO pedido no ERP. ` +
        `Confira o pedido no ERP e acione a reconciliação.` +
        (mensagem ? ` Detalhe técnico: ${mensagem}` : ""),
    };
  }

  return {
    podeReenviar: true,
    titulo: "Falha antes de chegar ao ERP",
    descricao:
      (mensagem || "Falha sem mensagem.") +
      " — nada foi criado no ERP. Corrija e envie novamente.",
  };
}
