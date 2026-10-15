/**
 * L10 — "Enviar para aprovação" do pedido do Projetos.
 *
 * É o MESMO caminho manual do Suprimentos (`pedidosService.enviarPedidoParaAprovacao`,
 * usado em 111+ pedidos): ler o pedido do Alvo, ligar SÓ o comando
 * `UserEnviarAprovacao = "Sim"` e regravar por `POST /ped-comp/update`.
 *
 * 🔴 Por que não no INSERT: foi assim que o 0004664 (R$ 110 mil) nasceu enviado
 * para aprovação e percorreu a cadeia inteira em 26/08/2026 sem ninguém no Hub
 * ter dado o comando (§13). Aqui o comando só sai depois de:
 *   1. a pessoa confirmar na tela, com aviso explícito;
 *   2. o banco conferir a permissão (pré-voo da RPC — o gateway só exige login);
 *   3. a leitura do Alvo mostrar que o pedido ainda NÃO foi para aprovação.
 *
 * `UserEnviouAprovacao` é o FATO, derivado pelo ERP — nunca é escrito daqui.
 *
 * Esta função NUNCA lança: quem a chama acabou de criar o pedido no Alvo, e um
 * throw lá marcaria o pedido como 'erro' — liberando um reenvio que DUPLICARIA o
 * pedido no ERP.
 */
/* eslint-disable @typescript-eslint/no-explicit-any --
   o pedido do Alvo (PedComp/Load) chega cru, sem tipo gerado; mesmo tratamento do pedidosService. */
import { supabase } from "@/integrations/supabase/client";
import { desembrulharPedido } from "./pedidosService";
import { descricaoErro, falhou, registrarEnvioAprovacao } from "./projetosService";
import { sincronizarPedidosDoProjeto } from "./projetoAlvoLoadService";

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";
const FILIAL = "1.01";

export type SituacaoAprovacao = "pode_enviar" | "ja_enviado" | "aprovado" | "encerrado";

/** Lê, no pedido devolvido pelo Alvo, se ainda cabe mandar o comando. */
export function situacaoParaAprovacao(ped: any): SituacaoAprovacao {
  const uf = ped?.PedCompUserFieldsObject ?? {};
  const status = String(ped?.Status ?? "");
  if (status === "Cancelado" || status === "Encerrado") return "encerrado";
  if (ped?.Aprovado === "Total" || ped?.StatusAprovacao === "Finalizada") return "aprovado";
  if (
    uf.UserEnviouAprovacao === "Sim" ||
    uf.UserEnviarAprovacao === "Sim" ||
    (ped?.StatusAprovacao && ped.StatusAprovacao !== "Nenhum")
  ) {
    return "ja_enviado";
  }
  return "pode_enviar";
}

/** Cópia do pedido com SÓ o comando ligado. Não altera o objeto recebido. */
export function comandoAprovacao<T extends { PedCompUserFieldsObject?: Record<string, unknown> | null }>(ped: T): T {
  return {
    ...ped,
    PedCompUserFieldsObject: { ...(ped.PedCompUserFieldsObject ?? {}), UserEnviarAprovacao: "Sim" },
  };
}

/**
 * Mostrar o botão avulso na linha? Usa o ESPELHO do Alvo gravado no Hub (open-load).
 * É só a vitrine — a decisão de verdade é a leitura ao vivo em `enviarParaAprovacaoAlvo`.
 */
export function podeMostrarEnviarAprovacao(r: {
  status?: string | null;
  numero_pedido_alvo?: string | null;
  enviou_aprovacao?: string | null;
  aprovado?: string | null;
  status_aprovacao?: string | null;
  status_alvo?: string | null;
  alvo_nao_encontrado_em?: string | null;
}): boolean {
  if (r.status !== "enviado" || !r.numero_pedido_alvo || r.alvo_nao_encontrado_em) return false;
  if (r.enviou_aprovacao === "Sim" || r.aprovado === "Total") return false;
  if (r.status_aprovacao && r.status_aprovacao !== "Nenhum") return false;
  if (r.status_alvo === "Cancelado" || r.status_alvo === "Encerrado") return false;
  return true;
}

export interface ResultadoAprovacao {
  ok: boolean;
  /** O Alvo já mostrava o pedido enviado para aprovação: nenhum comando foi dado. */
  jaEstava?: boolean;
  statusAprovacao?: string | null;
  proximoAprovador?: string | null;
  erro?: string;
  /** Comando dado, mas algo secundário falhou (registro no Hub, releitura). */
  aviso?: string;
}

async function jwtAtual(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada — faça login novamente.");
  return session.access_token;
}

async function chamarGateway(path: string, jwt: string, body?: unknown): Promise<{ status: number; data: any }> {
  const resp = await fetch(`${ERP_PROXY_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    // sem corpo JSON
  }
  return { status: resp.status, data };
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Load completo do pedido. Logo depois do insert o Alvo pode demorar a achá-lo: tenta de novo no 404. */
async function lerPedidoCompleto(numero: string, jwt: string, tentativas = 3, intervaloMs = 2000): Promise<any> {
  for (let i = 1; i <= tentativas; i++) {
    const { status, data } = await chamarGateway(`/ped-comp/${FILIAL}/${encodeURIComponent(numero)}`, jwt);
    if (status >= 200 && status < 300) {
      const ped = desembrulharPedido(data);
      if (!ped) throw new Error(`O Alvo devolveu o pedido ${numero} num formato não reconhecido.`);
      return ped;
    }
    if (status !== 404 || i === tentativas) {
      throw new Error(data?.error || `HTTP ${status} ao ler o pedido ${numero} no Alvo`);
    }
    await espera(intervaloMs);
  }
  throw new Error(`Pedido ${numero} não encontrado no Alvo.`);
}

const resumoAlvo = (ped: any) => ({
  Status: ped?.Status ?? null,
  Aprovado: ped?.Aprovado ?? null,
  StatusAprovacao: ped?.StatusAprovacao ?? null,
  UserEnviarAprovacao: ped?.PedCompUserFieldsObject?.UserEnviarAprovacao ?? null,
  UserEnviouAprovacao: ped?.PedCompUserFieldsObject?.UserEnviouAprovacao ?? null,
  UserProximoAprovador: ped?.PedCompUserFieldsObject?.UserProximoAprovador ?? null,
});

/** Releitura do Alvo para o espelho do Hub (o fato vem só daqui). Falha vira aviso. */
async function reler(id: string, numero: string): Promise<string | undefined> {
  try {
    const [r] = await sincronizarPedidosDoProjeto([{ id, numero_pedido_alvo: numero }]);
    return r && !r.persistido ? `status do ERP não relido: ${r.erro ?? "erro desconhecido"}` : undefined;
  } catch (err: any) {
    return `status do ERP não relido: ${err?.message || err}`;
  }
}

/**
 * Manda um pedido do Projetos, já criado no Alvo, para a cadeia de aprovação.
 * Nunca lança — ver o cabeçalho do arquivo.
 */
export async function enviarParaAprovacaoAlvo(
  req: { id: string; numero_pedido_alvo: string | null },
  opcoes: { intervaloReleituraMs?: number } = {},
): Promise<ResultadoAprovacao> {
  const numero = req.numero_pedido_alvo;
  if (!numero) return { ok: false, erro: "Pedido sem número no Alvo." };

  // 1) Pré-voo no banco: permissão e estado ANTES de qualquer comando ao ERP.
  try {
    const pre = await registrarEnvioAprovacao(req.id, null);
    if (falhou(pre)) return { ok: false, erro: descricaoErro(pre) };
  } catch (err: any) {
    return { ok: false, erro: `Não foi possível conferir a permissão: ${err?.message || err}` };
  }

  let antes: ReturnType<typeof resumoAlvo> | null = null;
  try {
    const jwt = await jwtAtual();

    // 2) Leitura ao vivo: só manda o comando se o Alvo disser que ainda cabe.
    const ped = await lerPedidoCompleto(numero, jwt, 3, opcoes.intervaloReleituraMs ?? 2000);
    antes = resumoAlvo(ped);
    const situacao = situacaoParaAprovacao(ped);

    if (situacao === "aprovado" || situacao === "encerrado") {
      return {
        ok: false,
        erro:
          situacao === "aprovado"
            ? `O pedido ${numero} já está aprovado no Alvo — nada a enviar.`
            : `O pedido ${numero} está ${ped?.Status} no Alvo — não pode ir para aprovação.`,
      };
    }

    if (situacao === "ja_enviado") {
      const reg = await registrarEnvioAprovacao(req.id, true, { ja_estava: true, antes });
      const aviso = await reler(req.id, numero);
      return {
        ok: true,
        jaEstava: true,
        statusAprovacao: antes.StatusAprovacao,
        proximoAprovador: antes.UserProximoAprovador,
        aviso: [falhou(reg) ? `evento não registrado no Hub: ${descricaoErro(reg)}` : null, aviso]
          .filter(Boolean)
          .join(" · ") || undefined,
      };
    }

    // 3) O comando — e só ele.
    const { status, data } = await chamarGateway("/ped-comp/update", jwt, comandoAprovacao(ped));
    if (status < 200 || status >= 300) {
      throw new Error(data?.error || `HTTP ${status} ao enviar o pedido ${numero} para aprovação`);
    }
    const depois = resumoAlvo(desembrulharPedido(data) || data);

    // 4) Livro do Hub + releitura do espelho.
    const reg = await registrarEnvioAprovacao(req.id, true, {
      comando: { UserEnviarAprovacao: "Sim" },
      antes,
      resposta: depois,
    });
    const aviso = await reler(req.id, numero);
    return {
      ok: true,
      statusAprovacao: depois.StatusAprovacao,
      proximoAprovador: depois.UserProximoAprovador,
      aviso: [falhou(reg) ? `evento não registrado no Hub: ${descricaoErro(reg)}` : null, aviso]
        .filter(Boolean)
        .join(" · ") || undefined,
    };
  } catch (err: any) {
    const erro = err?.message || String(err);
    console.error(`[L10] envio do pedido ${numero} para aprovação falhou:`, erro);
    try {
      await registrarEnvioAprovacao(req.id, false, { erro, antes });
    } catch {
      // registro da falha é melhor-esforço
    }
    return { ok: false, erro };
  }
}
