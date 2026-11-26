// deno test supabase/functions/exportar-notas-recebidas-cbs/logica.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1.0.8";
import { chaveConfere, cnpj, lerPedido, montarNfe, montarNfse, valoresNfe, valoresNfse } from "./logica.ts";

const HOJE = "2026-11-26";
const NFE44 = "35261111222333000181550010000001231000000010";
const NFSE50 = "35503081112223330001810000000000012326110000000010";

// Trechos com o formato real (NT 2025.002 e NFS-e nacional); números e chaves fictícios.
const XML_NFE = `<nfeProc><NFe><infNFe><total><ICMSTot><vNF>4329.99</vNF></ICMSTot>
  <IBSCBSTot>
    <vBCIBSCBS>4329.99</vBCIBSCBS>
    <gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>4.33</vIBSUF></gIBSUF>
      <gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>0.00</vIBSMun></gIBSMun>
      <vIBS>4.33</vIBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS>
    <gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>38.97</vCBS><vCredPres>0.00</vCredPres></gCBS>
  </IBSCBSTot></total></infNFe></NFe></nfeProc>`;
const XML_NFSE = `<NFSe><infNFSe><IBSCBS><valores><vBC>587.72</vBC></valores>
  <totCIBS><vTotNF>587.72</vTotNF><gIBS><vIBSTot>0.41</vIBSTot><gIBSUFTot><vIBSUF>0.41</vIBSUF></gIBSUFTot>
  <gIBSMunTot><vIBSMun>0.00</vIBSMun></gIBSMunTot></gIBS><gCBS><vCBS>3.70</vCBS></gCBS></totCIBS></IBSCBS>
  <DPS><infDPS><serie>900</serie><dCompet>2026-11-25</dCompet><IBSCBS><cClassTrib>000001</cClassTrib><valores><vBC>1.00</vBC></valores></IBSCBS></infDPS></DPS>
  </infNFSe></NFSe>`;

Deno.test("chave: só a igual passa", () => {
  assert(chaveConfere("abc123", "abc123"));
  assert(!chaveConfere("abc124", "abc123"));
  assert(!chaveConfere(null, "abc123"));
  assert(!chaveConfere("abc123", ""));
});

Deno.test("pedido: tipo obrigatório, desde válido, apos é uma chave, limite de 1 a 300", () => {
  assertEquals(lerPedido({ tipo: "nfe" }, HOJE), { tipo: "nfe", desde: "2026-01-01", apos: null, limite: 100 });
  assertEquals(lerPedido({ tipo: "nfse", apos: NFSE50, limite: 999 }, HOJE), {
    tipo: "nfse", desde: "2026-01-01", apos: NFSE50, limite: 300,
  });
  assertEquals(lerPedido({ tipo: "cte" }, HOJE), { erro: "tipo deve ser 'nfe' ou 'nfse'" });
  assert("erro" in lerPedido({ tipo: "nfe", desde: "2026-11-27" }, HOJE));
  assert("erro" in lerPedido({ tipo: "nfe", apos: "1; drop table" }, HOJE));
  assert("erro" in lerPedido(null, HOJE));
});

Deno.test("só CNPJ sai do Hub (LGPD)", () => {
  assertEquals(cnpj("11.222.333/0001-81"), "11222333000181");
  assertEquals(cnpj("12345678901"), null);
  assertEquals(cnpj(null), null);
});

Deno.test("NF-e: valores do IBSCBSTot; sem o grupo, null", () => {
  assertEquals(valoresNfe(XML_NFE), { base: 4329.99, cbs: 38.97, ibs: 4.33 });
  assertEquals(valoresNfe("<NFe><total><ICMSTot/></total></NFe>"), { base: null, cbs: null, ibs: null });
  assertEquals(valoresNfe(null), { base: null, cbs: null, ibs: null });
});

Deno.test("NFS-e: o grupo da nota (com totCIBS), não o da DPS; competência e série da DPS", () => {
  assertEquals(valoresNfse(XML_NFSE), { base: 587.72, cbs: 3.7, ibs: 0.41, competencia: "2026-11-25", serie: "900" });
  const semCbs = valoresNfse("<NFSe><DPS><infDPS><serie>1</serie><dCompet>2026-10-31</dCompet></infDPS></DPS></NFSe>");
  assertEquals(semCbs, { base: null, cbs: null, ibs: null, competencia: "2026-10-31", serie: "1" });
});

Deno.test("montagem: sem XML na saída, CPF sem número nem nome, NFS-e cancelada", () => {
  const nfe = montarNfe({
    chave_acesso: NFE44, serie: "1", numero: "123", data_emissao: "2026-11-20", emitente_cnpj: "11222333000181",
    emitente_nome: "Fornecedor Exemplo", emitente_uf: "SP", valor_total: 4329.99, imported_at: "2026-11-20T15:00:00Z",
    raw_xml: XML_NFE,
  });
  assertEquals(nfe.valor_cbs, 38.97);
  assertEquals(nfe.cancelada, null);
  assert(!JSON.stringify(nfe).includes("<"));
  const nfse = montarNfse({
    chave_acesso: NFSE50, numero: "39", data_emissao: "2026-11-25", prestador_doc: "12345678901",
    prestador_nome: "Pessoa Física", valor_servico: 587.72, situacao_fisco: "cancelada", situacao_alvo: "nao_lancada",
  }, XML_NFSE);
  assertEquals(nfse.emitente_cnpj, null);
  assertEquals(nfse.emitente_nome, null);
  assertEquals(nfse.cancelada, true);
  assertEquals(nfse.valor_cbs, 3.7);
});
