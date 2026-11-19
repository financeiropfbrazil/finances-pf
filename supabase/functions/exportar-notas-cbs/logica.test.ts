// deno test supabase/functions/exportar-notas-cbs/logica.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1.0.8";
import { chaveConfere, dataValida, lerPedido } from "./logica.ts";

Deno.test("chave: só a igual passa", () => {
  assert(chaveConfere("abc123", "abc123"));
  assert(!chaveConfere("abc124", "abc123"));
  assert(!chaveConfere("abc12", "abc123"));
  assert(!chaveConfere(null, "abc123"));
  assert(!chaveConfere("", ""));
});

Deno.test("data: formato, calendário e faixa", () => {
  assert(dataValida("2026-01-01", "2026-11-12"));
  assert(!dataValida("2026-02-30", "2026-11-12"));
  assert(!dataValida("2023-12-31", "2026-11-12"));
  assert(!dataValida("2026-11-13", "2026-11-12"));
  assert(!dataValida("01/01/2026", "2026-11-12"));
});

Deno.test("pedido: padrões, limites e chave da página", () => {
  assertEquals(lerPedido({}, "2026-11-12"), { desde: "2026-01-01", apos: null, limite: 500 });
  assertEquals(
    lerPedido({ desde: "2025-06-01", apos: { modelo: "NF-e", serie: "1", numero: 4593 }, limite: 5000 }, "2026-11-12"),
    { desde: "2025-06-01", apos: { modelo: "NF-e", serie: "1", numero: 4593 }, limite: 1000 },
  );
  assertEquals(lerPedido({ limite: 0 }, "2026-11-12"), { desde: "2026-01-01", apos: null, limite: 1 });
  assert("erro" in lerPedido(null, "2026-11-12"));
  assert("erro" in lerPedido({ desde: "ontem" }, "2026-11-12"));
  assert("erro" in lerPedido({ apos: { modelo: "NF-e", serie: "1", numero: "4593" } }, "2026-11-12"));
  assert("erro" in lerPedido({ apos: { modelo: "x'; drop", serie: "1", numero: 1 } }, "2026-11-12"));
  assert("erro" in lerPedido({ apos: "NF-e|1|4593" }, "2026-11-12"));
});
