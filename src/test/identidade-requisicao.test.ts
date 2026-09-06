import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// D-17 no módulo de REQUISIÇÕES — e o hotfix que a destravou
// ══════════════════════════════════════════════════════════════════════
//
// Medido na série completa em 28/08/2026 (compras_requisicoes_auditoria, evento
// `envio_tentado`): 226 payloads, 32 pessoas distintas do Hub, UM único
// `CodigoUsuario` — `PEDRO.SCRIGNOLI` em todos. Entre eles, 3 requisições da
// ana.sanches, que tinha login próprio e foi descartado.
//
// A D-17 (PLANO-PROJETOS) mandava PARAR o envio de quem não tivesse login próprio.
// Foi publicada em 02/09/2026 SEM o pré-requisito dela — o backfill dos ~30
// `profiles.alvo_usuario` — e travou o módulo inteiro: em 06/09/2026, 5 de 58
// perfis tinham login; 31 requisitantes ativos e 2 dos 4 líderes estavam sem. Como
// o envio pós-aprovação roda na sessão do LÍDER, aprovar travou junto.
//
// HOTFIX de 06/09/2026 (o que estes testes fixam agora):
//   · sem `alvo_usuario` → o envio SEGUE com o LOGIN DE SERVIÇO, com warn explícito;
//   · login próprio com formato inválido → continua PARANDO (erro de cadastro
//     precisa aparecer, não virar envio silencioso com identidade trocada);
//   · a identidade REAL do requisitante nunca dependeu deste login: ela está em
//     `CodigoFuncionario` e no carimbo "[Hub] Requisitante:" do campo `Texto`.
//
// Estes testes exercitam `enviarRequisicaoAlvo` de ponta a ponta com um duplo do
// Supabase, porque o que precisa ser garantido não é uma função pura — é o que
// chega (ou não chega) ao gateway em cada um desses três casos.

// Contrato duplicado DE PROPÓSITO: o service não exporta a constante, e o valor
// aqui é a trava. Trocar o login de serviço no service (pelo `HUB.REQUISICOES`
// definitivo, por exemplo) tem de quebrar este arquivo e ser uma decisão, não um
// efeito colateral.
const LOGIN_SERVICO = "PEDRO.SCRIGNOLI";

// Logins pessoais de OUTRAS pessoas do Hub. O fallback jamais pode resolver para
// um deles — seria de novo a identidade emprestada que a D-17 veio fechar.
const LOGINS_PESSOAIS_DE_TERCEIROS = ["ANA.SANCHES", "GUILHERME.OLIVEIRA", "CAIO.SANTOS"];

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
/** Tudo que o service mandou para `console.warn` no teste corrente. */
let avisos: string[];

/** Payload JSON efetivamente entregue ao gateway na primeira (e única) chamada. */
function payloadEnviado(): Record<string, unknown> {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body));
}

beforeEach(() => {
  fetchSpy = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ Numero: "0001500" }) } as Response),
  );
  vi.stubGlobal("fetch", fetchSpy);
  avisos = [];
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    avisos.push(args.map((a) => String(a)).join(" "));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("identidade no envio de requisição ao Alvo (D-17 + hotfix 06/09/2026)", () => {
  describe("sem login próprio, o envio usa o login de SERVIÇO", () => {
    it("chega ao gateway — o módulo não para mais por falta de cadastro", async () => {
      montarBase(null);
      const r = await enviarRequisicaoAlvo(REQ_ID, {
        userId: "user-1",
        userName: "Quem Clicou",
        persistencia: "legado",
      });

      expect(r.sucesso).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/req-comp/insert");
    });

    it("o payload sai com o login de SERVIÇO — e com o de nenhuma outra pessoa", async () => {
      montarBase(null);
      await enviarRequisicaoAlvo(REQ_ID, { userId: "user-1", userName: "Quem Clicou", persistencia: "legado" });

      const payload = payloadEnviado();
      // Asserção central: é EXATAMENTE a constante de serviço...
      expect(payload.CodigoUsuario).toBe(LOGIN_SERVICO);
      expect(payload.UsuarioLogado).toBe(LOGIN_SERVICO);
      // ...e não o login pessoal de um terceiro qualquer (o que seria a identidade
      // emprestada de volta, agora por outra porta).
      expect(LOGINS_PESSOAIS_DE_TERCEIROS).not.toContain(payload.CodigoUsuario);
    });

    it("a identidade REAL do requisitante continua no payload (CodigoFuncionario + carimbo)", async () => {
      montarBase(null);
      await enviarRequisicaoAlvo(REQ_ID, { userId: "user-1", userName: "Quem Clicou", persistencia: "legado" });

      const payload = payloadEnviado();
      // O login trocado é o do DIGITADOR. Quem pediu está nestes dois eixos, que o
      // fallback não toca — é o que torna o envio com login de serviço rastreável.
      expect(payload.CodigoFuncionario).toBe("0000142");
      expect(String(payload.Texto)).toContain("[Hub] Requisitante:");
    });

    it("o fallback NUNCA é silencioso: o warn cita o user_id e o e-mail (é a fila de cadastro)", async () => {
      montarBase(null);
      await enviarRequisicaoAlvo(REQ_ID, { userId: "user-1", userName: "Quem Clicou", persistencia: "legado" });

      expect(avisos.length).toBeGreaterThan(0);
      const texto = avisos.join("\n");
      expect(texto).toContain("alvo_usuario");
      expect(texto).toContain("user-1");
      expect(texto).toContain("quem.clicou@pfbrazil.com");
      expect(texto).toContain(LOGIN_SERVICO);
    });

    it("o `envio_tentado` registra EM NOME DE QUEM o documento saiu (login de serviço)", async () => {
      montarBase(null);
      await enviarRequisicaoAlvo(REQ_ID, { userId: "user-1", userName: "Quem Clicou", persistencia: "legado" });

      const tentado = estado.upserts.find(
        (u) => u.tabela === "compras_requisicoes_auditoria" && u.linha.evento === "envio_tentado",
      );
      expect(tentado).toBeTruthy();
      const payloadAuditado = tentado!.linha.payload_enviado as Record<string, unknown>;
      expect(payloadAuditado.CodigoUsuario).toBe(LOGIN_SERVICO);
      // A trilha tem de permitir reconstruir os dois lados: quem digitou e quem pediu.
      expect(payloadAuditado.CodigoFuncionario).toBe("0000142");
    });
  });

  describe("login próprio MAL CADASTRADO continua parando o envio", () => {
    // Estes testes eram do caso "sem login". Depois do hotfix, o caso que ainda para
    // é o do valor sujo — e as garantias que eles davam (nada de payload de uma
    // tentativa que não houve; rascunho com o erro registrado; desfecho pela RPC sem
    // número do Alvo) valem inteiras aqui. `profiles.alvo_usuario` é TEXTO LIVRE
    // preenchido à mão, e o backfill pendente prevê ~30 cadastros de uma vez.

    it("um login mal cadastrado (minúscula) PARA antes do ERP", async () => {
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

    it("a mensagem diz O QUE corrigir e que NADA foi enviado", async () => {
      montarBase("Ana.Sanches");
      const r = await enviarRequisicaoAlvo(REQ_ID, {
        userId: "user-1",
        userName: "Ana",
        persistencia: "legado",
      });

      expect(r.erro).toContain("login do ERP Alvo");
      expect(r.erro).toContain("administrador");
      expect(r.erro).toContain("NÃO foi enviada");
    });

    it("valor sujo NÃO cai para o login de serviço — erro de cadastro tem de aparecer", async () => {
      montarBase("Ana.Sanches");
      const r = await enviarRequisicaoAlvo(REQ_ID, { userId: "user-1", userName: "Ana", persistencia: "legado" });

      expect(r.sucesso).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
      const tentado = estado.upserts.find(
        (u) => u.tabela === "compras_requisicoes_auditoria" && u.linha.evento === "envio_tentado",
      );
      expect(tentado).toBeUndefined();
    });

    it("espaço sobrando é aparado, não recusado", async () => {
      montarBase("  ANA.SANCHES  ");
      const r = await enviarRequisicaoAlvo(REQ_ID, {
        userId: "user-1",
        userName: "Ana",
        persistencia: "legado",
      });
      expect(r.sucesso).toBe(true);
      expect(payloadEnviado().CodigoUsuario).toBe("ANA.SANCHES");
    });

    it("não grava `envio_tentado`: não existe payload de uma tentativa que não houve", async () => {
      montarBase("Ana.Sanches");
      await enviarRequisicaoAlvo(REQ_ID, { userId: "user-1", userName: "Ana", persistencia: "legado" });

      const auditorias = estado.upserts.filter((u) => u.tabela === "compras_requisicoes_auditoria");
      expect(auditorias.map((a) => a.linha.evento)).toEqual(["envio_falha"]);
      expect(auditorias.every((a) => a.linha.payload_enviado === undefined)).toBe(true);
    });

    it("no modo legado a requisição volta a rascunho com o erro registrado", async () => {
      montarBase("Ana.Sanches");
      await enviarRequisicaoAlvo(REQ_ID, { userId: "user-1", userName: "Ana", persistencia: "legado" });

      const req = estado.upserts.find((u) => u.tabela === "compras_requisicoes");
      expect(req?.linha.status).toBe("rascunho");
      expect(String(req?.linha.erro_ultimo_envio)).toContain("formato");
      // Nunca marca `pendente_envio`: o envio não começou.
      expect(estado.upserts.filter((u) => u.linha.status === "pendente_envio")).toHaveLength(0);
    });

    it("no modo RPC o desfecho vai pela `registrar_envio_requisicao`, sem número do Alvo", async () => {
      montarBase("Ana.Sanches");
      const r = await enviarRequisicaoAlvo(REQ_ID, {
        userId: "user-1",
        userName: "Ana",
        persistencia: "rpc",
      });

      expect(r.sucesso).toBe(false);
      const rpc = estado.rpcs.find((x) => x.nome === "registrar_envio_requisicao");
      expect(rpc).toBeTruthy();
      expect(rpc!.args.p_numero_alvo).toBeNull();
      expect(String(rpc!.args.p_erro)).toContain("formato");
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
      // Quem TEM login próprio não é atropelado pelo fallback de serviço.
      expect(payload.CodigoUsuario).not.toBe(LOGIN_SERVICO);
      expect(avisos).toHaveLength(0);
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
