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
