// Testes da lógica da Edge nfse-adn-sonda (NFSE-0.3). Rodar da raiz do repo:
//   deno test docs/nfse/testes/nfse-adn-sonda_test.ts
// Sem rede e sem banco: o ADN é simulado nas duas semânticas possíveis de NSU.
import {
  drenar, interpretarLote, lerSemantica, normalizarGeradoEm,
  type DocAdn, type LinhaDoc, type RespostaLote,
} from "../../../supabase/functions/nfse-adn-sonda/logica.ts";

function eq(atual: unknown, esperado: unknown, msg: string) {
  const a = JSON.stringify(atual), e = JSON.stringify(esperado);
  if (a !== e) throw new Error(`${msg}\n  atual:    ${a}\n  esperado: ${e}`);
}

const doc = (nsu: number, extra: Partial<DocAdn> = {}): DocAdn => ({
  nsu, chave: `CH${nsu}`, tipo_documento: "NFSE", tipo_evento: null,
  gerado_em: "2026-10-01T10:00:00-03:00", xml: `<NFSe n="${nsu}"/>`, campos_desconhecidos: [], ...extra,
});

/** ADN simulado: `total` documentos, lotes de `tam`; "depois" = devolve NSU > pedido, "apartir" = NSU >= pedido. */
function adn(total: number, tam: number, semantica: "depois" | "apartir") {
  const pedidos: number[] = [];
  return {
    pedidos,
    buscarLote: (nsu: number): Promise<RespostaLote> => {
      pedidos.push(nsu);
      const ini = semantica === "depois" ? nsu + 1 : Math.max(nsu, 1);
      const docs: DocAdn[] = [];
      for (let n = ini; n <= total && docs.length < tam; n++) docs.push(doc(n));
      if (docs.length === 0) {
        return Promise.resolve({ ok: true, fim: true, status_http: 200, status_processamento: "NENHUM_DOCUMENTO_LOCALIZADO", documentos: [] });
      }
      return Promise.resolve({ ok: true, fim: false, status_http: 200, status_processamento: "DOCUMENTOS_LOCALIZADOS", documentos: docs });
    },
  };
}

function deps(buscarLote: (nsu: number) => Promise<RespostaLote>, gravadas: Map<number, LinhaDoc>, relogio = { t: 0 }) {
  return {
    buscarLote,
    gravar: (linhas: LinhaDoc[]) => { for (const l of linhas) gravadas.set(l.nsu, l); return Promise.resolve(); },
    agora: () => relogio.t,
    pausa: (_ms: number) => { relogio.t += 10; return Promise.resolve(); },
  };
}
const OP = { nsuInicial: 0, maxLotes: 50, prazoMs: 100_000, pausaMs: 1, t0: 0 };

Deno.test("ADN 'depois do NSU': drena tudo e para em NENHUM_DOCUMENTO_LOCALIZADO", async () => {
  const a = adn(7, 3, "depois"), g = new Map<number, LinhaDoc>();
  const r = await drenar(deps(a.buscarLote, g), OP);
  eq([...g.keys()].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7], "todos os NSUs gravados, sem pular nenhum");
  eq(a.pedidos, [0, 3, 6, 7], "pede sempre a partir do maior NSU recebido");
  eq([r.parado_por, r.erro, r.documentos, r.nsu_final, r.lotes], ["fim_da_fila", null, 7, 7, 4], "resumo");
});

Deno.test("ADN 'a partir do NSU': drena tudo, relê 1 por lote e para em sem_avanco", async () => {
  const a = adn(7, 3, "apartir"), g = new Map<number, LinhaDoc>();
  const r = await drenar(deps(a.buscarLote, g), OP);
  eq([...g.keys()].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7], "todos os NSUs gravados, sem pular nenhum");
  eq(a.pedidos, [0, 3, 5, 7], "pedidos");
  eq([r.parado_por, r.erro, r.nsu_final], ["sem_avanco", null, 7], "resumo");
});

Deno.test("retomada: começa do maior NSU já gravado e não perde o seguinte", async () => {
  const a = adn(7, 3, "depois"), g = new Map<number, LinhaDoc>();
  const r = await drenar(deps(a.buscarLote, g), { ...OP, nsuInicial: 4 });
  eq([...g.keys()].sort((x, y) => x - y), [5, 6, 7], "só o que falta");
  eq(r.parado_por, "fim_da_fila", "parada");
});

Deno.test("max_lotes e prazo param sem erro e deixam o cursor certo para retomar", async () => {
  const g1 = new Map<number, LinhaDoc>();
  const r1 = await drenar(deps(adn(20, 3, "depois").buscarLote, g1), { ...OP, maxLotes: 2 });
  eq([r1.parado_por, r1.erro, r1.nsu_final, g1.size], ["max_lotes", null, 6, 6], "max_lotes");
  const g2 = new Map<number, LinhaDoc>(), relogio = { t: 0 };
  const r2 = await drenar(deps(adn(20, 3, "depois").buscarLote, g2, relogio), { ...OP, prazoMs: 15 });
  eq([r2.parado_por, r2.erro, r2.lotes], ["prazo", null, 2], "prazo (pausa avança 10 ms por lote)");
});

Deno.test("429 e rejeição param no primeiro erro, com o que já foi gravado preservado", async () => {
  let n = 0;
  const g = new Map<number, LinhaDoc>();
  const r = await drenar(deps((nsu) => {
    n++;
    return Promise.resolve(n === 1
      ? { ok: true, fim: false, status_http: 200, status_processamento: "DOCUMENTOS_LOCALIZADOS", documentos: [doc(nsu + 1)] }
      : interpretarLote(429, { ok: false, etapa: "limite_adn", status_http: 429, erros: [{ Codigo: "E429" }] }));
  }, g), OP);
  eq([r.parado_por, g.size, r.lotes], ["limite_adn", 1, 2], "429");
  eq(r.erro?.startsWith("limite_adn: HTTP 429"), true, `mensagem: ${r.erro}`);

  const r2 = await drenar(deps(() => Promise.resolve(interpretarLote(502, {
    ok: false, etapa: "resposta_adn", status_http: 400, status_processamento: "REJEICAO", erros: [{ Codigo: "E1" }],
  })), new Map()), OP);
  eq(r2.parado_por, "erro_adn", "rejeição");
  eq(r2.erro, 'resposta_adn: HTTP 502 (ADN 400): [{"Codigo":"E1"}]', "mensagem da rejeição");
});

Deno.test("documento sem NSU: não grava nada do lote e para", async () => {
  const g = new Map<number, LinhaDoc>();
  const r = await drenar(deps(() => Promise.resolve({
    ok: true, fim: false, status_http: 200, status_processamento: "DOCUMENTOS_LOCALIZADOS", documentos: [doc(1), doc(0, { nsu: null })],
  }), g), OP);
  eq([r.parado_por, g.size], ["documento_sem_nsu", 0], "nada gravado");
});

Deno.test("lote vazio sem a marca de fim é erro, não fim", async () => {
  const r = await drenar(deps(() => Promise.resolve({
    ok: true, fim: false, status_http: 200, status_processamento: "DOCUMENTOS_LOCALIZADOS", documentos: [],
  }), new Map()), OP);
  eq(r.parado_por, "lote_vazio_sem_marca", "parada");
});

Deno.test("falha ao gravar para a drenagem e não avança o cursor", async () => {
  const a = adn(7, 3, "depois");
  const r = await drenar({
    ...deps(a.buscarLote, new Map()),
    gravar: () => Promise.reject(new Error("violates check constraint")),
  }, OP);
  eq([r.parado_por, r.documentos, r.nsu_final, a.pedidos], ["erro_gravacao", 0, null, [0]], "resumo");
});

Deno.test("contadores: tipos, eventos, sem XML, gerado_em e campos novos", async () => {
  const r = await drenar(deps(() => Promise.resolve({
    ok: true, fim: false, status_http: 200, status_processamento: "DOCUMENTOS_LOCALIZADOS",
    documentos: [
      doc(1, { gerado_em: "2026-10-01T10:00:00", campos_desconhecidos: ["Novo"] }),
      doc(2, { tipo_documento: "EVENTO", tipo_evento: "CANCELAMENTO", xml: null, gerado_em: null }),
      doc(3, { gerado_em: "ontem" }),
    ],
  }), new Map()), { ...OP, maxLotes: 1 });
  eq(r.por_tipo, { NFSE: 2, "EVENTO/CANCELAMENTO": 1 }, "por tipo");
  eq([r.sem_xml, r.gerado_em, r.campos_desconhecidos], [1, { ok: 0, sem_fuso: 1, ilegivel: 1, vazio: 1 }, ["Novo"]], "contadores");
});

Deno.test("normalizarGeradoEm", () => {
  eq(normalizarGeradoEm("2026-10-01T10:00:00-03:00"), { valor: "2026-10-01T10:00:00-03:00", situacao: "ok" }, "com fuso");
  eq(normalizarGeradoEm("2026-10-01T13:00:00Z"), { valor: "2026-10-01T13:00:00Z", situacao: "ok" }, "UTC");
  eq(normalizarGeradoEm("2026-10-01T10:00:00.123"), { valor: "2026-10-01T10:00:00.123-03:00", situacao: "sem_fuso" }, "sem fuso");
  eq(normalizarGeradoEm("2026-10-01"), { valor: "2026-10-01T00:00:00-03:00", situacao: "sem_fuso" }, "só data");
  eq(normalizarGeradoEm("01/10/2026"), { valor: null, situacao: "ilegivel" }, "formato BR");
  eq(normalizarGeradoEm(""), { valor: null, situacao: "vazio" }, "vazio");
});

Deno.test("interpretarLote: contrato da rota do erp-proxy", () => {
  eq(interpretarLote(200, { ok: true, fim: true, status_http: 200, status_processamento: "NENHUM_DOCUMENTO_LOCALIZADO", documentos: [] }).ok, true, "fim");
  eq(interpretarLote(200, { ok: true, documentos: "x" }).ok, false, "200 sem lista é erro");
  eq(interpretarLote(401, { error: "X-System-Secret inválido." }), { ok: false, http: 401, etapa: "auth_gateway", erro: "HTTP 401: X-System-Secret inválido." }, "401");
  eq(interpretarLote(403, { ok: false, error: "Rota restrita" }), { ok: false, http: 403, etapa: "rota_restrita", erro: "HTTP 403: Rota restrita" }, "403");
  const erro = (r: RespostaLote) => (r.ok ? null : r.erro);
  eq(erro(interpretarLote(0, { etapa: "conexao_gateway", error: "timeout" })), "HTTP 0: timeout", "conexão");
  eq(erro(interpretarLote(502, { ok: false, etapa: "resposta_adn", status_http: 404, corpo_inicio: "(vazio)" })), "HTTP 502 (ADN 404): (vazio)", "404 sem marca");
});

Deno.test("lerSemantica", () => {
  eq(lerSemantica(1, 1), "a partir do NSU pedido (>=)", ">=");
  eq(lerSemantica(1, 2), "depois do NSU pedido (>)", ">");
  eq(lerSemantica(1, null), "indefinida (sem 1ª entrada com NSU)", "sem entrada");
});
