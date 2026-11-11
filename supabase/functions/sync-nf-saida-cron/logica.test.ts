// deno test supabase/functions/sync-nf-saida-cron/logica.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1.0.8";
import {
  Banco,
  Deps,
  endpointLoad,
  envelopeLista,
  ItemFila,
  novoResultado,
  numeroAlvo,
  Opcoes,
  passoDetalhe,
  passoLista,
  passoNotas,
  RespostaProxy,
} from "./logica.ts";

// ── Fakes ────────────────────────────────────────────────────────────
function linha(numero: number, data: string, extra: Record<string, unknown> = {}) {
  return {
    CodigoEmpresaFilial: "1.01",
    ModeloCtrlDf: "NF-e",
    SerieCtrlDf: "1",
    Numero: String(numero).padStart(10, "0"),
    DataEmissao: `${data}T00:00:00-03:00`,
    ...extra,
  };
}

class FakeBanco implements Banco {
  listas: unknown[][] = [];
  notas = new Map<string, string>(); // chave → id
  detalhes: Array<{ id: string; payload: unknown }> = [];
  falhas: Array<{ id: string; erro: string }> = [];
  fila: ItemFila[] = [];
  explodirNoGravar = false;
  async registrarLista(linhas: any[]) {
    this.listas.push(linhas);
    let novas = 0;
    for (const l of linhas) {
      const k = `${l.CodigoEmpresaFilial}|${l.ModeloCtrlDf}|${l.SerieCtrlDf}|${l.Numero}`;
      if (!this.notas.has(k)) {
        this.notas.set(k, `id-${l.Numero}`);
        novas++;
      }
    }
    return { linhas: linhas.length, novas, mudaram: 0, iguais: linhas.length - novas, reconferir: 0 };
  }
  async filaDetalhe(limite: number) {
    return this.fila.slice(0, limite);
  }
  async idDaNota(f: string, m: string, s: string, n: string) {
    return this.notas.get(`${f}|${m}|${s}|${n}`) ?? null;
  }
  async gravarDetalhe(id: string, payload: unknown) {
    if (this.explodirNoGravar) throw new Error("o detalhe recebido não é da nota");
    this.detalhes.push({ id, payload });
    return { resultado: payload === null ? "ausente" : "nova_versao", versao: 1 };
  }
  async registrarFalha(id: string, erro: string) {
    this.falhas.push({ id, erro });
    return { tentativas: 1, detalhe_status: "erro" };
  }
}

function opcoes(p: Partial<Opcoes> = {}): Opcoes {
  return {
    modelos: ["NF-e"],
    desde: "2026-10-01",
    pageSize: 3,
    paginaInicial: 1,
    maxPaginas: 5,
    maxDetalhes: 10,
    concorrencia: 2,
    inicio: 0,
    watchdogMs: 1_000_000,
    margemListaMs: 0,
    ...p,
  };
}

function deps(banco: FakeBanco, responder: (endpoint: string, payload?: any) => RespostaProxy, agora = () => 0): Deps & { chamadas: string[] } {
  const chamadas: string[] = [];
  return {
    chamadas,
    banco,
    agora,
    proxy: async (endpoint, _m, payload) => {
      chamadas.push(endpoint + (payload ? `#p${(payload as any).PageIndex}` : ""));
      return responder(endpoint, payload);
    },
  };
}

// ── Endpoints ────────────────────────────────────────────────────────
Deno.test("envelope da lista e endpoint do Load seguem a grafia provada no Lab", () => {
  const e = envelopeLista("NFS-e", 2, 300);
  assertEquals(e.ClassInput, "NotaFiscal");
  assertEquals(e.FormName, "notaFiscal");
  assertEquals(e.Input, "gridTableNotaFiscal");
  assertEquals(e.Filter, "( CodigoEmpresaFilial == '1.01' && ModeloCtrlDf == 'NFS-e' )");
  assertEquals([e.PageIndex, e.PageSize, e.Order], [2, 300, "Numero DESC"]);
  assertEquals(
    endpointLoad("NF-e", "1", "0000005100"),
    "notaFiscal/Load?modeloCtrlDf=NF-e&serieCtrlDf=1&numero=0000005100&loadParent=All&loadChild=All&loadOneToOne=All",
  );
  assertEquals(numeroAlvo("5160"), "0000005160");
  assertEquals(numeroAlvo(425), "0000000425");
});

// ── Lista ────────────────────────────────────────────────────────────
Deno.test("lista pagina até a 1ª página com emissão anterior ao corte", async () => {
  const b = new FakeBanco();
  const paginas: Record<number, unknown[]> = {
    1: [linha(10, "2026-11-05"), linha(9, "2026-11-01"), linha(8, "2026-10-20")],
    2: [linha(7, "2026-10-10"), linha(6, "2026-09-30"), linha(5, "2026-09-28")],
    3: [linha(4, "2026-09-01")],
  };
  const d = deps(b, (_e, p) => ({ ok: true, status: 200, data: paginas[p.PageIndex] ?? [] }));
  const res = novoResultado();
  await passoLista(d, opcoes(), res);
  assertEquals(d.chamadas, ["notaFiscal/GetListForComponents#p1", "notaFiscal/GetListForComponents#p2"]);
  assertEquals(res.paginas, 2);
  assertEquals(res.linhas_lidas, 6);
  assertEquals(res.novas, 6);
  assertEquals(res.lista_incompleta, []);
});

Deno.test("lista para na página curta (fim da numeração)", async () => {
  const b = new FakeBanco();
  const d = deps(b, () => ({ ok: true, status: 200, data: [linha(2, "2026-11-05"), linha(1, "2026-11-04")] }));
  const res = novoResultado();
  await passoLista(d, opcoes(), res);
  assertEquals(res.paginas, 1);
  assertEquals(res.lista_incompleta, []);
});

Deno.test("lista que não chega ao corte em max_paginas fica marcada como incompleta", async () => {
  const b = new FakeBanco();
  let n = 100;
  const d = deps(b, () => ({ ok: true, status: 200, data: [linha(n--, "2026-11-05"), linha(n--, "2026-11-05"), linha(n--, "2026-11-05")] }));
  const res = novoResultado();
  await passoLista(d, opcoes({ maxPaginas: 2 }), res);
  assertEquals(res.paginas, 2);
  assertEquals(res.lista_incompleta, ["NF-e"]);
});

Deno.test("página com linha de outra filial é recusada inteira e nada é gravado", async () => {
  const b = new FakeBanco();
  const d = deps(b, () => ({ ok: true, status: 200, data: [linha(3, "2026-11-05"), linha(2, "2026-11-05", { CodigoEmpresaFilial: "1.02" })] }));
  const res = novoResultado();
  await passoLista(d, opcoes(), res);
  assertEquals(b.listas.length, 0);
  assertEquals(res.erros, 1);
  assertEquals(res.lista_incompleta, ["NF-e"]);
});

Deno.test("erro do proxy na lista para o modelo sem gravar", async () => {
  const b = new FakeBanco();
  const d = deps(b, () => ({ ok: false, status: 403, data: null, erro: "403 — endpoint fora da whitelist" }));
  const res = novoResultado();
  await passoLista(d, opcoes({ modelos: ["NF-e", "NFS-e"] }), res);
  assertEquals(b.listas.length, 0);
  assertEquals(res.erros, 2);
  assertEquals(res.lista_incompleta, ["NF-e", "NFS-e"]);
});

// ── Detalhe ──────────────────────────────────────────────────────────
Deno.test("detalhe: objeto grava, null marca ausente, erro registra falha", async () => {
  const b = new FakeBanco();
  b.fila = [
    { id: "a", modelo: "NF-e", serie: "1", numero_alvo: "0000000001" },
    { id: "b", modelo: "NF-e", serie: "1", numero_alvo: "0000000002" },
    { id: "c", modelo: "NF-e", serie: "1", numero_alvo: "0000000003" },
  ];
  const d = deps(b, (e) => {
    if (e.includes("numero=0000000001")) return { ok: true, status: 200, data: { Numero: "0000000001" } };
    if (e.includes("numero=0000000002")) return { ok: true, status: 200, data: null };
    return { ok: false, status: 417, data: null, erro: "417 — payload rejeitado pelo Alvo" };
  });
  const res = novoResultado();
  await passoDetalhe(d, opcoes(), res);
  assertEquals(res.detalhes_tentados, 3);
  assertEquals([res.nova_versao, res.ausentes, res.falhas], [1, 1, 1]);
  assertEquals(b.detalhes.map((x) => [x.id, x.payload === null]).sort(), [["a", false], ["b", true]]);
  assertEquals(b.falhas.map((x) => x.id), ["c"]);
  assert(d.chamadas.every((c) => c.includes("loadChild=All")));
});

Deno.test("detalhe: exceção da RPC vira falha registrada, não derruba a rodada", async () => {
  const b = new FakeBanco();
  b.explodirNoGravar = true;
  b.fila = [{ id: "a", modelo: "NF-e", serie: "1", numero_alvo: "0000000001" }];
  const d = deps(b, () => ({ ok: true, status: 200, data: { Numero: "0000000099" } }));
  const res = novoResultado();
  await passoDetalhe(d, opcoes(), res);
  assertEquals(res.falhas, 1);
  assertEquals(b.falhas.length, 1);
  assert(b.falhas[0].erro.includes("não é da nota"));
});

Deno.test("detalhe: watchdog para antes de ler mais notas", async () => {
  const b = new FakeBanco();
  b.fila = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, modelo: "NF-e", serie: "1", numero_alvo: String(i) }));
  let t = 0;
  const d = deps(b, () => ({ ok: true, status: 200, data: { x: 1 } }), () => (t += 40));
  const res = novoResultado();
  await passoDetalhe(d, opcoes({ watchdogMs: 100, concorrencia: 1 }), res);
  assert(res.parado_por_watchdog);
  assert(res.detalhes_tentados < 10);
});

// ── Notas escolhidas ─────────────────────────────────────────────────
Deno.test("notas: inexistente no Alvo só é relatada; nova é registrada e detalhada; outra nota é recusada", async () => {
  const b = new FakeBanco();
  const d = deps(b, (e) => {
    if (e.includes("numero=0000005160")) return { ok: true, status: 200, data: null };
    if (e.includes("numero=0000005100")) return { ok: true, status: 200, data: linha(5100, "2026-10-02") };
    return { ok: true, status: 200, data: linha(1, "2026-10-02") }; // pediu 5099, veio a 1
  });
  const res = novoResultado();
  await passoNotas(d, opcoes(), [
    { modelo: "NF-e", serie: "1", numero: "5160" },
    { modelo: "NF-e", serie: "1", numero: "5100" },
    { modelo: "NF-e", serie: "1", numero: "5099" },
  ], res);
  assertEquals(res.notas.map((n) => n.desfecho), ["nao_existe_no_alvo", "nova_versao", "falha"]);
  assertEquals(b.listas.length, 1); // só a 5100 entrou
  assertEquals(b.detalhes.length, 1);
  assertEquals(res.erros, 1);
});

Deno.test("notas: nota que já existe no Hub passa pelo mesmo caminho do detalhe", async () => {
  const b = new FakeBanco();
  b.notas.set("1.01|NFS-e|001|0000000425", "id-425");
  const d = deps(b, () => ({ ok: true, status: 200, data: { Numero: "0000000425" } }));
  const res = novoResultado();
  await passoNotas(d, opcoes(), [{ modelo: "NFS-e", serie: "001", numero: "425" }], res);
  assertEquals(res.notas[0], { nota: "NFS-e 001 0000000425", ja_existia: true, desfecho: "nova_versao" });
  assertEquals(b.detalhes[0].id, "id-425");
});

Deno.test("lista continua de pagina_inicial e devolve de onde seguir quando para antes do corte", async () => {
  const b = new FakeBanco();
  const paginas: Record<number, unknown[]> = {
    4: [linha(30, "2025-03-01"), linha(29, "2025-02-20"), linha(28, "2025-02-10")],
    5: [linha(27, "2025-02-01"), linha(26, "2025-01-20"), linha(25, "2025-01-10")],
    6: [linha(24, "2024-12-30"), linha(23, "2024-12-20"), linha(22, "2024-12-10")],
  };
  const d = deps(b, (_e, p) => ({ ok: true, status: 200, data: paginas[p.PageIndex] ?? [] }));
  const res = novoResultado();
  await passoLista(d, opcoes({ desde: "2025-01-01", paginaInicial: 4, maxPaginas: 2 }), res);
  assertEquals(d.chamadas, ["notaFiscal/GetListForComponents#p4", "notaFiscal/GetListForComponents#p5"]);
  assertEquals(res.lista_incompleta, ["NF-e"]);
  assertEquals(res.proxima_pagina, { "NF-e": 6 });
  const res2 = novoResultado();
  await passoLista(d, opcoes({ desde: "2025-01-01", paginaInicial: 6, maxPaginas: 2 }), res2);
  assertEquals(res2.lista_incompleta, []);
  assertEquals(res2.proxima_pagina, {});
});

Deno.test("lista não começa página nova sem a margem de tempo", async () => {
  const b = new FakeBanco();
  let t = 0;
  let n = 100;
  const d = deps(b, () => {
    t += 30; // cada página "leva" 30
    return { ok: true, status: 200, data: [linha(n--, "2026-11-05"), linha(n--, "2026-11-05"), linha(n--, "2026-11-05")] };
  }, () => t);
  const res = novoResultado();
  await passoLista(d, opcoes({ watchdogMs: 110, margemListaMs: 40, maxPaginas: 10 }), res);
  assertEquals(res.paginas, 3); // começa em 0, 30 e 60; em 90 já não há 40 de folga
  assert(res.parado_por_watchdog);
  assertEquals(res.proxima_pagina, { "NF-e": 4 });
});
