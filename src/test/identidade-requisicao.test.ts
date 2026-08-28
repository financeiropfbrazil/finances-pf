import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// D-17 no módulo de REQUISIÇÕES — a terceira ocorrência do padrão
// ══════════════════════════════════════════════════════════════════════
//
// Medido na série completa em 28/08/2026 (compras_requisicoes_auditoria, evento
// `envio_tentado`): 226 payloads, 32 pessoas distintas do Hub, UM único
// `CodigoUsuario` — `PEDRO.SCRIGNOLI` em todos. Entre eles, 3 requisições da
// ana.sanches, que tinha login próprio e foi descartado.
//
// A regra (D-17 do PLANO-PROJETOS, já em produção no módulo de Projetos): sem
// identidade própria, o envio FALHA com mensagem clara. Nunca cai para a
// identidade de outra pessoa.
//
// Estes testes exercitam `enviarRequisicaoAlvo` de ponta a ponta com um duplo do
// Supabase, porque o que precisa ser garantido não é uma função pura — é que
// NENHUM caminho chegue ao gateway sem identidade própria.

// ── Duplo do client do Supabase ──────────────────────────────────────
// Um holder mutável: o módulo captura `supabase` no import, então o objeto
// precisa ser o mesmo em todos os testes e ter o conteúdo trocado por dentro.
const estado: {
  tabelas: Record<string, unknown[]>;
  upserts: Array<{ tabela: string; linha: Record<string, unknown> }>;
  rpcs: Array<{ nome: string; args: Record<string, unknown> }>;
} = { tabelas: {}, upserts: [], rpcs: [] };

vi.mock("@/integrations/supabase/client", () => {
  const primeira = (t: string) => (estado.tabelas[t] ?? [])[0] ?? null;

  const query = (tabela: string) => {
    const q: Record<string, unknown> = {};
    const eu = () => q;
    Object.assign(q, {
      select: eu,
      eq: eu,
      // `.order()` fecha as consultas de lista; `.single()`/`.maybeSingle()` as de linha.
      order: () => Promise.resolve({ data: estado.tabelas[tabela] ?? [], error: null }),
      single: () => Promise.resolve({ data: primeira(tabela), error: null }),
      maybeSingle: () => Promise.resolve({ data: primeira(tabela), error: null }),
      upsert: (linha: Record<string, unknown>) => {
        estado.upserts.push({ tabela, linha });
        return Promise.resolve({ data: null, error: null });
      },
      insert: (linha: Record<string, unknown>) => {
        estado.upserts.push({ tabela, linha });
        return Promise.resolve({ data: null, error: null });
      },
    });
    return q;
  };

  return {
    supabase: {
      from: (tabela: string) => query(tabela),
      rpc: (nome: string, args: Record<string, unknown>) => {
        estado.rpcs.push({ nome, args });
        return Promise.resolve({
          data: args?.p_numero_alvo ? "SINCRONIZADA" : "ERRO_REGISTRADO",
          error: null,
        });
      },
      auth: {
        getSession: () =>
          Promise.resolve({
            data: { session: { access_token: "jwt-fake", user: { id: "user-1", email: "quem.clicou@pfbrazil.com" } } },
          }),
      },
      storage: { from: () => ({ download: () => Promise.resolve({ data: null, error: { message: "n/a" } }) }) },
    },
  };
});

import { enviarRequisicaoAlvo } from "@/services/requisicoesService";

const REQ_ID = "req-uuid-1";

function montarBase(alvoUsuario: string | null) {
  estado.tabelas = {
    compras_requisicoes: [
      {
        id: REQ_ID,
        requisitante_user_id: "user-1",
        codigo_empresa_filial: "1.01",
        codigo_funcionario: "0000142",
        codigo_centro_ctrl: "00010.00004.00003",
        codigo_finalidade_compra: "0000001",
        data_necessidade: "2026-09-10",
        total_itens: 1,
        descricao: "Cabo HDMI",
        texto: "[Hub] Requisitante: fulano",
      },
    ],
    compras_requisicoes_itens: [
      {
        item_servico: false,
        codigo_produto: "001.014.001",
        codigo_alternativo_produto: null,
        codigo_prod_unid_med: "UNID",
        quantidade: 2,
        observacao: "",
        sequencia: 1,
      },
    ],
    compras_requisicoes_arquivos: [],
    profiles: [{ alvo_usuario: alvoUsuario }],
  };
  estado.upserts = [];
  estado.rpcs = [];
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ Numero: "0001500" }) } as Response),
  );
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("identidade no envio de requisição ao Alvo (D-17)", () => {
  describe("sem login próprio do Alvo, o envio PARA", () => {
    it("não chega ao gateway — a chamada ao ERP nem acontece", async () => {
      montarBase(null);
      const r = await enviarRequisicaoAlvo(REQ_ID, {
        userId: "user-1",
        userName: "Quem Clicou",
        persistencia: "legado",
      });

      expect(r.sucesso).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("a mensagem diz O QUE fazer e que NADA foi enviado", async () => {
      montarBase(null);
      const r = await enviarRequisicaoAlvo(REQ_ID, {
        userId: "user-1",
        userName: "Quem Clicou",
        persistencia: "legado",
      });

      expect(r.erro).toContain("login do ERP Alvo");
      expect(r.erro).toContain("administrador");
      expect(r.erro).toContain("NÃO foi enviada");
    });

    it("um login mal cadastrado (minuscula) tambem PARA antes do ERP", async () => {
      // O desbloqueio deste card preve cadastrar 30 logins a mao numa coluna de
      // texto livre. Um valor sujo so apareceria como recusa do Alvo — depois de o
      // `envio_tentado` ja ter sido gravado.
      montarBase("Ana.Sanches");
      const r = await enviarRequisicaoAlvo(REQ_ID, {
        userId: "user-1",
        userName: "Ana",
        persistencia: "legado",
      });
      expect(r.sucesso).toBe(false);
      expect(r.erro).toContain("formato");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("espaço sobrando é aparado, não recusado", async () => {
      montarBase("  ANA.SANCHES  ");
      const r = await enviarRequisicaoAlvo(REQ_ID, {
        userId: "user-1",
        userName: "Ana",
        persistencia: "legado",
      });
      expect(r.sucesso).toBe(true);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(String(init.body)).CodigoUsuario).toBe("ANA.SANCHES");
    });

    it("não grava `envio_tentado`: não existe payload de uma tentativa que não houve", async () => {
      montarBase(null);
      await enviarRequisicaoAlvo(REQ_ID, { userId: "user-1", userName: "Quem Clicou", persistencia: "legado" });

      const auditorias = estado.upserts.filter((u) => u.tabela === "compras_requisicoes_auditoria");
      expect(auditorias.map((a) => a.linha.evento)).toEqual(["envio_falha"]);
      expect(auditorias.every((a) => a.linha.payload_enviado === undefined)).toBe(true);
    });

    it("no modo legado a requisição volta a rascunho com o erro registrado", async () => {
      montarBase(null);
      await enviarRequisicaoAlvo(REQ_ID, { userId: "user-1", userName: "Quem Clicou", persistencia: "legado" });

      const req = estado.upserts.find((u) => u.tabela === "compras_requisicoes");
      expect(req?.linha.status).toBe("rascunho");
      expect(String(req?.linha.erro_ultimo_envio)).toContain("login do ERP Alvo");
      // Nunca marca `pendente_envio`: o envio não começou.
      expect(estado.upserts.filter((u) => u.linha.status === "pendente_envio")).toHaveLength(0);
    });

    it("no modo RPC o desfecho vai pela `registrar_envio_requisicao`, sem número do Alvo", async () => {
      montarBase(null);
      const r = await enviarRequisicaoAlvo(REQ_ID, {
        userId: "user-1",
        userName: "Quem Clicou",
        persistencia: "rpc",
      });

      expect(r.sucesso).toBe(false);
      const rpc = estado.rpcs.find((x) => x.nome === "registrar_envio_requisicao");
      expect(rpc).toBeTruthy();
      expect(rpc!.args.p_numero_alvo).toBeNull();
      expect(String(rpc!.args.p_erro)).toContain("login do ERP Alvo");
    });
  });

  describe("com login próprio, o payload leva a identidade de quem operou", () => {
    it("CodigoUsuario e UsuarioLogado são o login da pessoa, não a constante antiga", async () => {
      montarBase("GUILHERME.OLIVEIRA");
      const r = await enviarRequisicaoAlvo(REQ_ID, {
        userId: "user-1",
        userName: "Guilherme",
        persistencia: "legado",
      });

      expect(r.sucesso).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/req-comp/insert");
      const payload = JSON.parse(String(init.body));
      expect(payload.CodigoUsuario).toBe("GUILHERME.OLIVEIRA");
      expect(payload.UsuarioLogado).toBe("GUILHERME.OLIVEIRA");
    });

    it("o requisitante continua no CodigoFuncionario — os dois eixos são independentes", async () => {
      montarBase("GUILHERME.OLIVEIRA");
      await enviarRequisicaoAlvo(REQ_ID, { userId: "user-1", userName: "Guilherme", persistencia: "legado" });

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(String(init.body));
      // 34 códigos distintos nos 226 envios medidos: este eixo NUNCA esteve emprestado.
      expect(payload.CodigoFuncionario).toBe("0000142");
    });

    it("o `envio_tentado` guarda o payload com a identidade certa", async () => {
      montarBase("ANA.SANCHES");
      await enviarRequisicaoAlvo(REQ_ID, { userId: "user-1", userName: "Ana", persistencia: "legado" });

      const tentado = estado.upserts.find(
        (u) => u.tabela === "compras_requisicoes_auditoria" && u.linha.evento === "envio_tentado",
      );
      expect((tentado?.linha.payload_enviado as Record<string, unknown>).CodigoUsuario).toBe("ANA.SANCHES");
    });
  });
});
