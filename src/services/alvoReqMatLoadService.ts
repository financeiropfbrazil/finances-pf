import { supabase } from "@/integrations/supabase/client";

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";

/**
 * CONFERIR RM NO ERP — leitura sob demanda, SEM PERSISTIR NADA.
 *
 * O usuário abre `/producao/rm/:numero`, vê o espelho (que anda 4×/dia pelo
 * cron) e pergunta "isto aqui ainda vale?". Esta função responde consultando o
 * Alvo AGORA e comparando com o que está na tela.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 TRÊS REGRAS QUE DEFINEM ESTE ARQUIVO
 *
 * 1. **NÃO ESCREVE.** Nem no espelho, nem no livro, nem no Alvo. Não existe
 *    caminho de escrita aqui — o que elimina, por construção, o "wipe
 *    silencioso" que custou caro no módulo de Suprimentos (proxy devolvendo 200
 *    com corpo vazio e o cron zerando o registro). Quem grava o espelho é a
 *    Edge `sync-reqmat`, com service_role e transação.
 *
 * 2. **NÃO MARCA AUSÊNCIA.** Um 412 isolado NÃO é prova de exclusão. A primeira
 *    versão do equivalente em Suprimentos marcava exclusão em qualquer 404 e
 *    marcou 7 pedidos VIVOS; a regra que ficou exige duas fontes concordando.
 *    O `sync-reqmat` já tem esse cross-check embutido (listagem completa, zero
 *    erros, sem truncação, teto de 5% do universo do ano) e já provou que
 *    funciona — foi ele que carimbou a RM 0000002271. Aqui o 412 vira AVISO.
 *
 * 3. **Guarda anti-wipe de EXIBIÇÃO.** Resposta sem âncora não vira "RM vazia"
 *    na tela: não mostramos nada de novo e mantemos o dado antigo com aviso.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CAMINHO: `POST {gateway}/alvo/passthrough` com o JWT do usuário. Funciona para
 * não-admin — o passthrough valida só o JWT (é a pendência de segurança do
 * BL-5, aqui a nosso favor) — e `ReqMat/Load` está na whitelist desde a OP-2.1.
 * NÃO usamos `authenticateAlvo()`/localStorage, ao contrário do open-load de
 * pedidos: aquele caminho exige credencial do Alvo no navegador e só funciona
 * para quem a tem configurada.
 */

/** Erro do Load com o status HTTP preservado — a tela distingue 412 de rede. */
export class ReqMatLoadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ReqMatLoadError";
    this.status = status;
  }
}

/**
 * A RM não existe (mais) no Alvo?
 *
 * O Alvo responde **412 Precondition Failed** com corpo "Registro não
 * encontrado" — medido em campo em 05/08/2026, cinco vezes, ao conferir a
 * exclusão das RMs de teste 0000002271–0000002275.
 *
 * ⚠ E aqui há uma DIVERGÊNCIA ENTRE ROTAS DO MESMO GATEWAY, que vale registrar:
 * o `/alvo/passthrough` repassa o **412 puro**, enquanto a rota `/ped-comp`
 * converte em 404 por regex na Message. Por isso o helper aceita os dois — e
 * por isso ninguém deve assumir o código de status pela entidade, e sim pela
 * rota que falou.
 */
export function isReqMatInexistenteNoAlvo(err: unknown): boolean {
  return err instanceof ReqMatLoadError && (err.status === 412 || err.status === 404);
}

// ─────────────────────────────────────────────────────────────────────────────
// Guarda estrutural — RÉPLICA de `analisarRespostaReqMat`
// ─────────────────────────────────────────────────────────────────────────────
// A original vive em `supabase/functions/sync-reqmat/index.ts` (exportada) e
// NÃO pode ser importada daqui: aquele módulo tem `Deno.serve(...)` no
// nível do topo e imports de `esm.sh` — importá-lo do front arrastaria o
// servidor inteiro para o bundle do Vite.
//
// 🔴 AS DUAS TÊM DE ANDAR JUNTAS. Se um degrau mudar lá, mude aqui. Os quatro
// degraus, na mesma ordem:
//   1. corpo não é objeto (ou é array) → falha;
//   2. envelope de exceção .NET → falha (texto procurado SÓ nos campos de
//      mensagem, nunca no corpo inteiro: os campos livres da RM têm texto em
//      português e alemão e dariam falso-positivo);
//   3. âncora `Numero` com VALOR (um envelope que ecoe `"Numero": null` não
//      passa por RM);
//   4. `ItemReqMatChildList` array e NÃO-VAZIO — lista vazia é FALHA, não "RM
//      sem itens": sem `loadChild=All` as child lists vêm vazias, e não existe
//      RM sem item.

const CHAVES_DE_EXCECAO = [
  "ExceptionType",
  "ExceptionMessage",
  "ClassName",
  "StackTrace",
  "InnerException",
  "BrokenRules",
  "Message",
  "MessageDetail",
  "ModelState",
];

/** Índice case-insensitive das chaves (o Alvo alterna maiúsculas). */
function indexar(obj: any): Map<string, any> {
  const m = new Map<string, any>();
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) m.set(k.toLowerCase(), v);
  }
  return m;
}

function pick(idx: Map<string, any>, ...nomes: string[]): any {
  for (const n of nomes) {
    const v = idx.get(n.toLowerCase());
    if (v !== undefined) return v;
  }
  return undefined;
}

export interface AnaliseReqMat {
  ok: boolean;
  cabecalho?: any;
  itens?: any[];
  motivo?: string;
}

export function analisarRespostaReqMat(data: any): AnaliseReqMat {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, motivo: `corpo não é objeto (${data === null ? "null" : typeof data})` };
  }

  const i = indexar(data);
  const sinais = CHAVES_DE_EXCECAO.filter((c) => pick(i, c) !== undefined);
  if (sinais.length > 0) {
    const msg = [pick(i, "Message"), pick(i, "MessageDetail"), pick(i, "ExceptionMessage")]
      .filter((v) => typeof v === "string")
      .join(" | ");
    return { ok: false, motivo: msg ? `o ERP recusou: ${msg}` : `envelope de exceção do ERP (${sinais.join(", ")})` };
  }

  const numero = pick(i, "Numero");
  if (numero === undefined || numero === null || String(numero).trim() === "") {
    return { ok: false, motivo: "resposta sem âncora de requisição (campo Numero vazio)" };
  }

  const itens = pick(i, "ItemReqMatChildList");
  if (!Array.isArray(itens)) return { ok: false, motivo: "ItemReqMatChildList ausente ou não é lista" };
  if (itens.length === 0) {
    return { ok: false, motivo: "ItemReqMatChildList vazio — resposta degradada (não existe RM sem item)" };
  }

  return { ok: true, cabecalho: data, itens };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conferência
// ─────────────────────────────────────────────────────────────────────────────

export interface DiferencaRM {
  /** Rótulo legível do que mudou. */
  campo: string;
  /** O que está no espelho (o que a tela mostra agora). */
  noHub: string;
  /** O que o ERP respondeu agora. */
  noAlvo: string;
}

export interface ResultadoConferencia {
  /** Quando a conferência foi feita (para o rodapé do aviso). */
  conferidoEm: Date;
  diferencas: DiferencaRM[];
  /** Nº de itens que o ERP devolveu — só informativo. */
  totalItensAlvo: number;
}

const numeroFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function fmt(v: any): string {
  return numeroFmt.format(n(v));
}

async function jwt(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ReqMatLoadError("Sessão expirada. Faça login novamente.", 401);
  return session.access_token;
}

/**
 * Consulta o Alvo e compara com a linha do espelho. NÃO grava.
 *
 * @param numero  número da RM no Alvo (chave natural do espelho)
 * @param espelho o que a tela está exibindo (cabeçalho + itens já carregados)
 */
export async function conferirRMNoAlvo(
  numero: string,
  espelho: {
    status?: string | null;
    tipo_atendimento?: string | null;
    baixou_estoque?: string | null;
    itens: Array<{ sequencia: number; quantidade: number; quantidade_atendida: number; quantidade_saldo: number }>;
  },
): Promise<ResultadoConferencia> {
  const token = await jwt();
  const endpoint = `ReqMat/Load?numero=${encodeURIComponent(numero)}&loadChild=All`;

  let resp: Response;
  try {
    resp = await fetch(`${ERP_PROXY_URL}/alvo/passthrough`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint, method: "GET" }),
    });
  } catch (e: any) {
    throw new ReqMatLoadError(`Falha de rede ao falar com o gateway: ${e?.message || String(e)}`, 0);
  }

  let envelope: any = null;
  try {
    envelope = await resp.json();
  } catch {
    /* resposta sem corpo JSON */
  }

  // O passthrough devolve `{ ok, status, data, error }`, mas em erro do próprio
  // gateway (ou 412 repassado) o status HTTP da resposta já é o do Alvo.
  const statusAlvo = Number(envelope?.status ?? resp.status);

  if (!resp.ok || envelope?.ok === false) {
    // 412 = "Registro não encontrado" — RM excluída no ERP. Medido em campo
    // (05/08/2026). NÃO marcamos nada: quem confirma exclusão é o sync.
    throw new ReqMatLoadError(
      statusAlvo === 412 || statusAlvo === 404
        ? "Requisição não encontrada no ERP"
        : `ERP respondeu ${statusAlvo}${envelope?.error ? `: ${envelope.error}` : ""}`,
      statusAlvo,
    );
  }

  const analise = analisarRespostaReqMat(envelope?.data);
  if (!analise.ok) {
    // GUARDA ANTI-WIPE DE EXIBIÇÃO: não inventamos "RM vazia" na tela.
    throw new ReqMatLoadError(analise.motivo || "resposta inesperada do ERP", 502);
  }

  const idx = indexar(analise.cabecalho);
  const diferencas: DiferencaRM[] = [];

  const comparar = (campo: string, noHub: any, noAlvo: any) => {
    const a = noHub === null || noHub === undefined || noHub === "" ? "—" : String(noHub);
    const b = noAlvo === null || noAlvo === undefined || noAlvo === "" ? "—" : String(noAlvo);
    if (a !== b) diferencas.push({ campo, noHub: a, noAlvo: b });
  };

  comparar("Status", espelho.status, pick(idx, "Status"));
  comparar("Tipo de atendimento", espelho.tipo_atendimento, pick(idx, "TipoAtendimento"));
  comparar("Baixou estoque", espelho.baixou_estoque, pick(idx, "BaixouEstoque"));

  // Itens: comparação por sequência. As três quantidades que a tela usa para
  // decidir — e `quantidade_saldo` é COMPARADA como veio, nunca recalculada
  // (saldo não é pedido − atendido; o excedente vai para QuantidadeAtendidaMaior).
  const porSequenciaAlvo = new Map<number, any>();
  for (const it of analise.itens || []) {
    const seq = Number(pick(indexar(it), "Sequencia"));
    if (Number.isFinite(seq)) porSequenciaAlvo.set(seq, it);
  }

  for (const itemHub of espelho.itens) {
    const itemAlvo = porSequenciaAlvo.get(itemHub.sequencia);
    if (!itemAlvo) {
      diferencas.push({
        campo: `Item ${itemHub.sequencia}`,
        noHub: "presente",
        noAlvo: "ausente (item cancelado ou removido)",
      });
      continue;
    }
    const ia = indexar(itemAlvo);
    // Nomes IDÊNTICOS aos do `mapearItem` do sync-reqmat — sem fallback de
    // propósito: os campos "2" (`QuantidadeAtendida2`…) são a quantidade na
    // SEGUNDA unidade de medida, e um fallback frouxo poderia casar com eles
    // e comparar eixos diferentes.
    const pedida = n(pick(ia, "QuantidadeProdUnidMedPrincipal"));
    const atendida = n(pick(ia, "QuantidadeAtendidaProdUnidMedPrincipal"));
    const saldo = n(pick(ia, "QuantidadeSaldoProdUnidMedPrincipal"));

    if (n(itemHub.quantidade) !== pedida) {
      comparar(`Item ${itemHub.sequencia} · pedido`, fmt(itemHub.quantidade), fmt(pedida));
    }
    if (n(itemHub.quantidade_atendida) !== atendida) {
      comparar(`Item ${itemHub.sequencia} · atendido`, fmt(itemHub.quantidade_atendida), fmt(atendida));
    }
    if (n(itemHub.quantidade_saldo) !== saldo) {
      comparar(`Item ${itemHub.sequencia} · saldo`, fmt(itemHub.quantidade_saldo), fmt(saldo));
    }
  }

  const novos = (analise.itens || []).length - espelho.itens.length;
  if (novos > 0) {
    diferencas.push({ campo: "Itens", noHub: String(espelho.itens.length), noAlvo: String((analise.itens || []).length) });
  }

  return { conferidoEm: new Date(), diferencas, totalItensAlvo: (analise.itens || []).length };
}
