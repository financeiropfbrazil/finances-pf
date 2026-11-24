// deno test supabase/functions/exportar-notas-recebidas-balancete/logica.test.ts
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.8";
import {
  chaveConfere, impressao, intervaloMes, lerPedido, linhaImpressao, montarNfe, montarNfse, paginacao, pedidosPorNota,
  resumoMeses, ultimosMeses, CAMPOS_IMPRESSAO_NFE,
} from "./logica.ts";

const HOJE = "2026-11-23";

Deno.test("chave: só a igual passa", () => {
  assert(chaveConfere("abc123", "abc123"));
  assert(!chaveConfere("abc124", "abc123"));
  assert(!chaveConfere("abc12", "abc123"));
  assert(!chaveConfere(null, "abc123"));
  assert(!chaveConfere("abc123", ""));
});

Deno.test("pedido: resumo com padrão de 13 meses e limite de 24", () => {
  assertEquals(lerPedido({ acao: "resumo" }, HOJE), { acao: "resumo", meses: 13 });
  assertEquals(lerPedido({ acao: "resumo", meses: 99 }, HOJE), { acao: "resumo", meses: 24 });
  assertEquals(lerPedido({ acao: "resumo", meses: 0 }, HOJE), { acao: "resumo", meses: 1 });
});

Deno.test("pedido: mês exige tipo e mês válido; página até 50", () => {
  assertEquals(lerPedido({ acao: "mes", tipo: "nfe", mes: "2026-09" }, HOJE),
    { acao: "mes", tipo: "nfe", mes: "2026-09", pagina: 1, porPagina: 20 });
  assertEquals(lerPedido({ acao: "mes", tipo: "nfse", mes: "2026-09", pagina: 3, por_pagina: 500 }, HOJE),
    { acao: "mes", tipo: "nfse", mes: "2026-09", pagina: 3, porPagina: 50 });
  assert("erro" in lerPedido({ acao: "mes", mes: "2026-09" }, HOJE));
  assert("erro" in lerPedido({ acao: "mes", tipo: "cte", mes: "2026-09" }, HOJE));
  assert("erro" in lerPedido({ acao: "mes", tipo: "nfe", mes: "2026-12" }, HOJE)); // futuro
  assert("erro" in lerPedido({ acao: "mes", tipo: "nfe", mes: "2024-11" }, HOJE)); // 25 meses atrás
  assert("erro" in lerPedido({ acao: "mes", tipo: "nfe", mes: "2026-9" }, HOJE));
  assert("erro" in lerPedido(null, HOJE));
  assert("erro" in lerPedido({ acao: "apagar" }, HOJE));
});

Deno.test("intervalo do mês, inclusive dezembro", () => {
  assertEquals(intervaloMes("2026-09"), { de: "2026-09-01", ate: "2026-10-01" });
  assertEquals(intervaloMes("2025-12"), { de: "2025-12-01", ate: "2026-01-01" });
});

Deno.test("últimos meses atravessam o ano", () => {
  assertEquals(ultimosMeses(3, "2026-01-15"), ["2025-11", "2025-12", "2026-01"]);
  assertEquals(ultimosMeses(13, HOJE).length, 13);
  assertEquals(ultimosMeses(13, HOJE)[0], "2025-11");
});

Deno.test("impressão não depende da ordem e muda quando a situação no Hub muda", async () => {
  const a = { chave_acesso: "1", updated_at: "t1", status_lancamento: "pendente", recebido: false };
  const b = { chave_acesso: "2", updated_at: "t1", status_lancamento: "vinculada", recebido: true };
  const l1 = [linhaImpressao(a, CAMPOS_IMPRESSAO_NFE), linhaImpressao(b, CAMPOS_IMPRESSAO_NFE)];
  assertEquals(await impressao(l1), await impressao([...l1].reverse()));
  const a2 = { ...a, status_lancamento: "vinculada" };
  assertNotEquals(await impressao(l1), await impressao([linhaImpressao(a2, CAMPOS_IMPRESSAO_NFE), l1[1]]));
  // vínculo de pedido feito no Hub também muda a impressão
  assertNotEquals(linhaImpressao(a, CAMPOS_IMPRESSAO_NFE, []), linhaImpressao(a, CAMPOS_IMPRESSAO_NFE, [{ pedido: "0004317" }]));
});

Deno.test("resumo: mês sem nota aparece com zero; nota fora dos meses não entra", async () => {
  const r = await resumoMeses(
    ["2026-10", "2026-11"],
    [{ linha: { chave_acesso: "1", data_emissao: "2026-11-05" }, pedidos: [] },
     { linha: { chave_acesso: "2", data_emissao: "2026-08-05" }, pedidos: [] }],
    [{ nsu: 9, chave_acesso: "x", data_emissao: "2026-10-31" }],
  );
  assertEquals(r.map((m) => [m.mes, m.nfe.notas, m.nfse.notas]), [["2026-10", 0, 1], ["2026-11", 1, 0]]);
  assertEquals(r[0].nfe.impressao, await impressao([]));
});

Deno.test("pedidos vinculados: principal primeiro", () => {
  const m = pedidosPorNota([
    { nfe_id: "n1", pedido_numero: "0002", is_principal: false },
    { nfe_id: "n1", pedido_numero: "0001", is_principal: true },
    { nfe_id: "n2", pedido_numero: "0003", is_principal: null },
  ]);
  assertEquals(m.get("n1"), [{ pedido: "0001", principal: true }, { pedido: "0002", principal: false }]);
  assertEquals(m.get("n2"), [{ pedido: "0003", principal: false }]);
});

Deno.test("NF-e viaja com o XML, o emitente e a situação no Hub; sem pedido do lançamento = null", () => {
  const n = montarNfe({ chave_acesso: "352611", numero: "15058", emitente_cnpj: "123", valor_total: 10, raw_xml: "<nfeProc/>",
    status_lancamento: "pendente", pedido_compra_numero: null }, []);
  assertEquals(n.tipo, "NF-e");
  assertEquals(n.xml, "<nfeProc/>");
  assertEquals(n.emitente.cnpj, "123");
  assertEquals(n.valores.total, 10);
  assertEquals(n.no_hub.pedido_do_lancamento, null);
  assertEquals(n.no_hub.pedidos_vinculados_no_hub, []);
});

Deno.test("NFS-e viaja com o XML e os dois eixos separados: no fisco e no Alvo", () => {
  const n = montarNfse({ chave_acesso: "x", nsu: 5, situacao_fisco: "cancelada", situacao_alvo: "lancada" }, "<NFSe/>");
  assertEquals(n.no_fisco.situacao, "cancelada");
  assertEquals(n.no_alvo.situacao, "lancada");
  assertEquals(n.xml, "<NFSe/>");
});

Deno.test("paginação", () => {
  assertEquals(paginacao(41, 3, 20), { total: 41, pagina: 3, por_pagina: 20, paginas: 3 });
  assertEquals(paginacao(0, 1, 20).paginas, 1);
});
