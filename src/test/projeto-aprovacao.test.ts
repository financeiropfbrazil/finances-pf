import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt-teste" } } }) },
  },
}));
const sincronizar = vi.fn(async (_pedidos: unknown) => [{ persistido: true }]);
vi.mock("@/services/projetoAlvoLoadService", () => ({
  sincronizarPedidosDoProjeto: (pedidos: unknown) => sincronizar(pedidos),
}));

import {
  comandoAprovacao,
  enviarParaAprovacaoAlvo,
  podeMostrarEnviarAprovacao,
  situacaoParaAprovacao,
} from "@/services/projetoAprovacaoService";

/** Pedido como o gateway devolve no GET /ped-comp/1.01/:numero. */
const pedidoAlvo = (extra: Record<string, unknown> = {}, uf: Record<string, unknown> = {}) => ({
  CodigoEmpresaFilial: "1.01",
  Numero: "0004799",
  Status: "Aberto",
  Aprovado: "Não",
  StatusAprovacao: "Nenhum",
  ItemPedCompChildList: [{ CodigoProduto: "002.005" }],
  PedCompUserFieldsObject: { UserEnviarAprovacao: "Não", UserEnviouAprovacao: "Não", ...uf },
  ...extra,
});

const resposta = (status: number, body: unknown) =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as Response;

const rpcOk = (extra: Record<string, unknown> = {}) => ({ data: { success: true, ...extra }, error: null });

describe("situacaoParaAprovacao (leitura ao vivo do Alvo)", () => {
  it("pedido aberto, nunca enviado: pode enviar", () => {
    expect(situacaoParaAprovacao(pedidoAlvo())).toBe("pode_enviar");
  });
  it("comando já dado ou fato já registrado: não manda de novo", () => {
    expect(situacaoParaAprovacao(pedidoAlvo({}, { UserEnviarAprovacao: "Sim" }))).toBe("ja_enviado");
    expect(situacaoParaAprovacao(pedidoAlvo({}, { UserEnviouAprovacao: "Sim" }))).toBe("ja_enviado");
    expect(situacaoParaAprovacao(pedidoAlvo({ StatusAprovacao: "Em andamento" }))).toBe("ja_enviado");
  });
  it("aprovado (caso do 0004907: Total/Finalizada sem a flag) e cancelado", () => {
    expect(situacaoParaAprovacao(pedidoAlvo({ Aprovado: "Total", StatusAprovacao: "Finalizada" }))).toBe("aprovado");
    expect(situacaoParaAprovacao(pedidoAlvo({ Status: "Cancelado" }))).toBe("encerrado");
  });
});

describe("comandoAprovacao", () => {
  it("liga SÓ o comando; o fato (UserEnviouAprovacao) fica como o Alvo mandou; não muta o original", () => {
    const original = pedidoAlvo({}, { UserProximoAprovador: null });
    const cmd = comandoAprovacao(original);
    expect(cmd.PedCompUserFieldsObject).toEqual({
      UserEnviarAprovacao: "Sim",
      UserEnviouAprovacao: "Não",
      UserProximoAprovador: null,
    });
    expect(original.PedCompUserFieldsObject.UserEnviarAprovacao).toBe("Não");
  });
});

describe("podeMostrarEnviarAprovacao (vitrine pelo espelho do Hub)", () => {
  const base = { status: "enviado", numero_pedido_alvo: "0005042", status_alvo: "Aberto", aprovado: "Não", status_aprovacao: "Nenhum" };
  it("enviado ao ERP e nunca foi para aprovação: mostra", () => {
    expect(podeMostrarEnviarAprovacao({ ...base, enviou_aprovacao: null })).toBe(true);
    expect(podeMostrarEnviarAprovacao({ ...base, status_alvo: "Reavaliar", enviou_aprovacao: "Não" })).toBe(true);
  });
  it("não mostra: rascunho, já em aprovação, aprovado, cancelado, não encontrado no ERP", () => {
    expect(podeMostrarEnviarAprovacao({ ...base, status: "rascunho" })).toBe(false);
    expect(podeMostrarEnviarAprovacao({ ...base, enviou_aprovacao: "Sim" })).toBe(false);
    expect(podeMostrarEnviarAprovacao({ ...base, aprovado: "Total", status_aprovacao: "Finalizada" })).toBe(false);
    expect(podeMostrarEnviarAprovacao({ ...base, status_alvo: "Cancelado" })).toBe(false);
    expect(podeMostrarEnviarAprovacao({ ...base, alvo_nao_encontrado_em: "2026-10-10T00:00:00Z" })).toBe(false);
  });
});

describe("enviarParaAprovacaoAlvo", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    rpc.mockReset();
    sincronizar.mockClear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  const req = { id: "req-1", numero_pedido_alvo: "0004799" };

  it("sem permissão no pré-voo: NENHUMA chamada ao Alvo", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Sem permissão para enviar este pedido para aprovação.", code: "42501" } });
    const r = await enviarParaAprovacaoAlvo(req);
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/Sem permissão/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("projeto_pedido_registrar_aprovacao", { p_id: "req-1", p_sucesso: null, p_detalhes: {} });
  });

  it("caminho normal: pré-voo → GET → POST só com o comando → registra → relê", async () => {
    rpc.mockResolvedValueOnce(rpcOk({ pre_voo: true })).mockResolvedValueOnce(rpcOk({ evento_id: "e1" }));
    fetchMock
      .mockResolvedValueOnce(resposta(200, pedidoAlvo()))
      .mockResolvedValueOnce(
        resposta(200, pedidoAlvo({ StatusAprovacao: "Em andamento" }, { UserEnviarAprovacao: "Sim", UserProximoAprovador: "FERNANDO.OLIVEIRA" })),
      );
    const r = await enviarParaAprovacaoAlvo(req);

    expect(r).toMatchObject({ ok: true, statusAprovacao: "Em andamento", proximoAprovador: "FERNANDO.OLIVEIRA" });
    const [urlGet, optGet] = fetchMock.mock.calls[0];
    expect(urlGet).toBe("https://erp-proxy.onrender.com/ped-comp/1.01/0004799");
    expect(optGet.method).toBe("GET");
    const [urlPost, optPost] = fetchMock.mock.calls[1];
    expect(urlPost).toBe("https://erp-proxy.onrender.com/ped-comp/update");
    const corpo = JSON.parse(optPost.body);
    expect(corpo.PedCompUserFieldsObject.UserEnviarAprovacao).toBe("Sim");
    expect(corpo.PedCompUserFieldsObject.UserEnviouAprovacao).toBe("Não"); // o Hub nunca escreve o fato
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_id: "req-1", p_sucesso: true });
    expect(sincronizar).toHaveBeenCalledWith([{ id: "req-1", numero_pedido_alvo: "0004799" }]);
  });

  it("Alvo já mostra em aprovação: NÃO manda o comando de novo", async () => {
    rpc.mockResolvedValue(rpcOk());
    fetchMock.mockResolvedValueOnce(resposta(200, pedidoAlvo({}, { UserEnviouAprovacao: "Sim" })));
    const r = await enviarParaAprovacaoAlvo(req);
    expect(r).toMatchObject({ ok: true, jaEstava: true });
    expect(fetchMock).toHaveBeenCalledTimes(1); // só o GET
    expect(rpc.mock.calls[1][1].p_detalhes).toMatchObject({ ja_estava: true });
  });

  it("já aprovado no Alvo: recusa sem comando", async () => {
    rpc.mockResolvedValue(rpcOk());
    fetchMock.mockResolvedValueOnce(resposta(200, pedidoAlvo({ Aprovado: "Total", StatusAprovacao: "Finalizada" })));
    const r = await enviarParaAprovacaoAlvo(req);
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/já está aprovado/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falha do ERP no comando: devolve erro, registra a falha e NÃO lança", async () => {
    rpc.mockResolvedValue(rpcOk());
    fetchMock
      .mockResolvedValueOnce(resposta(200, pedidoAlvo()))
      .mockResolvedValueOnce(resposta(500, { error: "Erro interno do Alvo" }));
    const r = await enviarParaAprovacaoAlvo(req);
    expect(r).toEqual({ ok: false, erro: "Erro interno do Alvo" });
    const ultima = rpc.mock.calls[rpc.mock.calls.length - 1][1];
    expect(ultima).toMatchObject({ p_sucesso: false });
    expect(ultima.p_detalhes.erro).toBe("Erro interno do Alvo");
  });

  it("logo após o insert o Alvo pode dar 404: tenta de novo", async () => {
    rpc.mockResolvedValue(rpcOk());
    fetchMock
      .mockResolvedValueOnce(resposta(404, { error: "não encontrado" }))
      .mockResolvedValueOnce(resposta(200, pedidoAlvo()))
      .mockResolvedValueOnce(resposta(200, pedidoAlvo({}, { UserEnviarAprovacao: "Sim" })));
    const r = await enviarParaAprovacaoAlvo(req, { intervaloReleituraMs: 0 });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
