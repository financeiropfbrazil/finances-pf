// deno test supabase/functions/exportar-notas-balancete/logica.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1.0.8";
import { chaveConfere, lerPedido, limpa, mesValido, respostaMes } from "./logica.ts";

Deno.test("limpa tira vazios como o script do Balancete (null, '', 0, false, listas e objetos vazios)", () => {
  const nota = {
    Numero: "0000005162",
    Cancelada: "Não",
    ValorFrete: 0,
    ValorTotal: 120000,
    DadosAdicionais: "",
    Integrado: false,
    Algo: null,
    ItemNfChildList: [{ Sequencia: 1, ValorDesconto: 0, NumSerieItemNfChildList: [], Lotes: [{ Q: 2, X: null }] }],
    Vazio: { a: null, b: "" },
  };
  assertEquals(limpa(nota), {
    Numero: "0000005162",
    Cancelada: "Não",
    ValorTotal: 120000,
    ItemNfChildList: [{ Sequencia: 1, Lotes: [{ Q: 2 }] }],
  });
});

Deno.test("chave: só a igual passa", () => {
  assert(chaveConfere("abc123", "abc123"));
  assert(!chaveConfere("abc124", "abc123"));
  assert(!chaveConfere("abc12", "abc123"));
  assert(!chaveConfere(null, "abc123"));
  assert(!chaveConfere("", ""));
});

Deno.test("mês: AAAA-MM dos últimos 24 meses, nunca futuro", () => {
  assert(mesValido("2026-11", "2026-11-12"));
  assert(mesValido("2024-12", "2026-11-12"));
  assert(!mesValido("2024-11", "2026-11-12"));
  assert(!mesValido("2026-12", "2026-11-12"));
  assert(!mesValido("2026-1", "2026-11-12"));
  assert(!mesValido("2026-13", "2026-11-12"));
  assert(!mesValido(202611, "2026-11-12"));
});

Deno.test("pedido: resumo e mês com limites; o resto é recusado", () => {
  assertEquals(lerPedido({ acao: "resumo" }, "2026-11-12"), { acao: "resumo", meses: 13 });
  assertEquals(lerPedido({ acao: "resumo", meses: 99 }, "2026-11-12"), { acao: "resumo", meses: 24 });
  assertEquals(lerPedido({ acao: "mes", mes: "2026-10" }, "2026-11-12"), { acao: "mes", mes: "2026-10", pagina: 1, porPagina: 20 });
  assertEquals(lerPedido({ acao: "mes", mes: "2026-10", pagina: 3, por_pagina: 500 }, "2026-11-12"), {
    acao: "mes",
    mes: "2026-10",
    pagina: 3,
    porPagina: 50,
  });
  assert("erro" in lerPedido({ acao: "mes", mes: "2027-01" }, "2026-11-12"));
  assert("erro" in lerPedido({ acao: "apagar" }, "2026-11-12"));
  assert("erro" in lerPedido(null, "2026-11-12"));
});

Deno.test("resposta do mês no formato dos arquivos dos scripts", () => {
  const r = respostaMes(
    {
      mes: "2026-10",
      total: 71,
      na_pagina: 2,
      sem_detalhe: [],
      loads: { "NF-e|1|0000005097": { Numero: "0000005097", ValorFrete: 0, ItemNfChildList: [{ Sequencia: 1 }] } },
      series: { "9185": { s: "TSV05908", l: "TS00081", p: "001.010.040" } },
    },
    1,
    20,
    "2026-11-12T14:00:00.000Z",
  );
  assertEquals(r.paginas, 4);
  assertEquals(r.erros, {});
  assertEquals(r.loads["NF-e|1|0000005097"], { Numero: "0000005097", ItemNfChildList: [{ Sequencia: 1 }] });
  assertEquals((r.series as any)["9185"].s, "TSV05908");
  assertEquals(r.gerado_em, "2026-11-12T14:00:00.000Z");
});
