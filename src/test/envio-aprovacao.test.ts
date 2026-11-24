// LP-ENV (PLANO-PEDIDOS): data do envio do pedido para aprovação e contagem de dias.
import { describe, expect, it } from "vitest";
import {
  diaBrasilia,
  diasAteAprovar,
  diasAteEnviar,
  origemEnvioTexto,
  rotuloOrigemEnvio,
  situacaoEnvio,
  textoDias,
} from "@/lib/envioAprovacao";

describe("diaBrasilia", () => {
  it("data pura passa como está (não volta um dia)", () => {
    expect(diaBrasilia("2026-11-24")).toBe("2026-11-24");
  });

  it("timestamp à noite em Brasília é o dia de Brasília, não o de UTC", () => {
    // 01h30 UTC de 25/11 = 22h30 de 24/11 em Brasília
    expect(diaBrasilia("2026-11-25T01:30:00+00:00")).toBe("2026-11-24");
    expect(diaBrasilia("2026-11-24T18:18:33.008271+00:00")).toBe("2026-11-24");
  });

  it("vazio ou inválido = null", () => {
    expect(diaBrasilia(null)).toBeNull();
    expect(diaBrasilia("")).toBeNull();
    expect(diaBrasilia("não é data")).toBeNull();
  });
});

describe("dias até enviar e até aprovar", () => {
  it("conta dias de calendário em Brasília", () => {
    expect(diasAteEnviar("2026-11-18", "2026-11-23T13:00:00+00:00")).toBe(5);
    expect(diasAteEnviar("2026-11-18", "2026-11-18T20:35:00+00:00")).toBe(0);
    // enviado 22h30 de 18/11 (Brasília) ainda é o dia do pedido
    expect(diasAteEnviar("2026-11-18", "2026-11-19T01:30:00+00:00")).toBe(0);
    expect(diasAteAprovar("2026-11-18T20:35:00+00:00", "2026-11-19T12:22:00+00:00")).toBe(1);
  });

  it("sem uma das datas = null", () => {
    expect(diasAteEnviar("2026-11-18", null)).toBeNull();
    expect(diasAteEnviar(null, "2026-11-23T13:00:00+00:00")).toBeNull();
    expect(diasAteAprovar(null, "2026-11-19T12:22:00+00:00")).toBeNull();
  });
});

describe("textos", () => {
  it("dias", () => {
    expect(textoDias(null)).toBeNull();
    expect(textoDias(0)).toBe("no mesmo dia");
    expect(textoDias(1)).toBe("1 dia");
    expect(textoDias(5)).toBe("5 dias");
  });

  it("origem", () => {
    expect(rotuloOrigemEnvio("botao_hub")).toContain("exata");
    expect(rotuloOrigemEnvio("leitura")).toContain("1 h");
    expect(rotuloOrigemEnvio("aproximado")).toContain("aproximada");
    expect(rotuloOrigemEnvio("desconhecido")).toContain("não registrou");
    expect(rotuloOrigemEnvio(null)).toBeNull();
    expect(origemEnvioTexto("botao_hub")).toBe("Exata (botão do Hub)");
    expect(origemEnvioTexto("desconhecido")).toBe("Sem data");
    expect(origemEnvioTexto(undefined)).toBe("");
  });
});

describe("situacaoEnvio", () => {
  it("com data, sem data (desconhecido) e não enviado", () => {
    expect(situacaoEnvio({ enviado_aprovacao_em: "2026-11-24T18:18:33+00:00", enviado_aprovacao_origem: "leitura" })).toBe(
      "com_data",
    );
    expect(situacaoEnvio({ enviado_aprovacao_em: null, enviado_aprovacao_origem: "desconhecido" })).toBe("sem_data");
    expect(situacaoEnvio({ enviado_aprovacao_em: null, enviado_aprovacao_origem: null })).toBe("nao_enviado");
    expect(situacaoEnvio({})).toBe("nao_enviado");
  });
});
