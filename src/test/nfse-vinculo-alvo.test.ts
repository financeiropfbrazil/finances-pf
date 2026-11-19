// NFSE-1.18: aviso de vínculo com o Alvo que não é pelo número da nota no mesmo CNPJ.
import { describe, expect, it } from "vitest";
import { textoVinculoAlvo } from "@/components/nfse/nfseFormatos";

const base = {
  alvo_vinculo: "numero",
  alvo_especies: "NFS-e",
  alvo_doc_numero: "3613133",
  alvo_cnpj: "01808151005798",
  prestador_doc: "01808151005798",
  numero: "3613133",
};

describe("textoVinculoAlvo", () => {
  it("vínculo normal (ou nenhum) não avisa nada", () => {
    expect(textoVinculoAlvo(base)).toBeNull();
    expect(textoVinculoAlvo({ ...base, alvo_vinculo: null })).toBeNull();
  });

  it("outra filial: mostra os dois CNPJ formatados", () => {
    const t = textoVinculoAlvo({ ...base, alvo_vinculo: "numero_outra_filial", alvo_cnpj: "01808151003159" });
    expect(t).toContain("outra filial");
    expect(t).toContain("01.808.151/0031-59");
    expect(t).toContain("01.808.151/0057-98");
  });

  it("sem o ano: mostra o número do Alvo e o da nota", () => {
    const t = textoVinculoAlvo({
      ...base,
      alvo_vinculo: "numero_sem_ano",
      alvo_doc_numero: "53",
      numero: "2600000000053",
      alvo_cnpj: "10207650000166",
      prestador_doc: "10207650000166",
    });
    expect(t).toContain("com o número 53");
    expect(t).toContain("(2600000000053)");
  });

  it("citado na nota: mantém o texto da NFSE-1.2-B", () => {
    const t = textoVinculoAlvo({ ...base, alvo_vinculo: "citado_na_nota", alvo_especies: "DIV", alvo_doc_numero: "168240607" });
    expect(t).toBe("No Alvo com outro número: DIV 168240607, que a própria nota cita na descrição (mesmo CNPJ e mesmo valor).");
  });
});
