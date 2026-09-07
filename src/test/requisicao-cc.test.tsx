import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { centrosEnvolvidos, validarRateioCC } from "@/lib/requisicaoCC";
import { AprovacoesCC } from "@/components/compras/AprovacoesCC";

describe("centros envolvidos", () => {
  it("une cabeçalho, itens e rateios sem duplicar", () => {
    expect(centrosEnvolvidos(" A ", [{ codigo_centro_ctrl: "B" }, {}, { codigo_centro_ctrl: "B" }], [{ codigo_classe_rec_desp: "CL", percentual: 100, ccs: [{ codigo_centro_ctrl: "A", percentual: 1 }, { codigo_centro_ctrl: "C", percentual: 99 }] }])).toEqual(["A", "B", "C"]);
  });
  it("rejeita cabeçalho fora do rateio", () => {
    expect(validarRateioCC("A", [{ codigo_classe_rec_desp: "CL", percentual: 100, ccs: [{ codigo_centro_ctrl: "B", percentual: 100 }] }])).toContain("principal");
  });
  it("rejeita classe sem CC e percentual zero", () => {
    expect(validarRateioCC("A", [{ codigo_classe_rec_desp: "CL", percentual: 100, ccs: [] }])).not.toBeNull();
    expect(validarRateioCC("A", [{ codigo_classe_rec_desp: "CL", percentual: 100, ccs: [{ codigo_centro_ctrl: "A", percentual: 100 }, { codigo_centro_ctrl: "B", percentual: 0 }] }])).not.toBeNull();
  });
  it("mostra dispensa apenas em A e pendência em B", () => {
    const html = renderToStaticMarkup(<AprovacoesCC grupos={[
      { codigo_centro_ctrl: "A", situacao: "dispensado_autor", aprovado_por: "autor", aprovado_em: null, automatica: true, lider_atual: true, lideres: [{ user_id: "autor", nome: "Autor" }] },
      { codigo_centro_ctrl: "B", situacao: "pendente", aprovado_por: null, aprovado_em: null, automatica: false, lider_atual: false, lideres: [{ user_id: "lider-b", nome: "Líder B" }] },
    ]} />);
    expect(html).toContain("Dispensado — autor lidera este CC");
    expect(html).toContain("Aguardando aprovação");
    expect(html).toContain("Líderes: Líder B");
  });
});
