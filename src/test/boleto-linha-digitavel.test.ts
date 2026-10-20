import { describe, expect, it } from "vitest";
import {
  conferirLinhaDigitavel,
  dvBancario,
  modulo10,
  vencimentoDoFator,
} from "../../supabase/functions/nfse-ler-boleto/boleto";

// Linhas sintéticas (montadas pelas regras da Febraban), para não guardar no repositório a linha real de
// fornecedor. As 7 linhas reais dos boletos de teste do Pedro (20/10/2026) foram conferidas fora do repo.

/** Monta a linha digitável bancária a partir de banco, fator, valor (centavos) e campo livre (25 dígitos). */
function linhaBancaria(banco: string, fator: string, valorCentavos: string, campoLivre: string) {
  const semDv = banco + "9" + fator + valorCentavos + campoLivre; // 43 dígitos, sem o DV geral
  const dv = dvBancario(semDv);
  const codigo = semDv.slice(0, 4) + dv + semDv.slice(4);
  const c1 = codigo.slice(0, 4) + codigo.slice(19, 24);
  const c2 = codigo.slice(24, 34);
  const c3 = codigo.slice(34, 44);
  return { codigo, linha: `${c1}${modulo10(c1)}${c2}${modulo10(c2)}${c3}${modulo10(c3)}${dv}${fator}${valorCentavos}` };
}

/** Monta uma linha de arrecadação com identificador 6 (valor real, módulo 10). */
function linhaArrecadacao(semDvGeral: string) {
  const codigo = semDvGeral.slice(0, 3) + modulo10(semDvGeral) + semDvGeral.slice(3);
  return [0, 1, 2, 3].map((i) => codigo.slice(i * 11, i * 11 + 11)).map((b) => b + modulo10(b)).join("");
}

describe("fator de vencimento (Febraban)", () => {
  it("1º ciclo: fator 1000 = 03/07/2000", () => {
    expect(vencimentoDoFator("1000", new Date("2000-07-01"))).toBe("2000-07-03");
  });
  it("fator 9999 = 21/02/2025, último dia do 1º ciclo", () => {
    expect(vencimentoDoFator("9999", new Date("2025-01-15"))).toBe("2025-02-21");
  });
  it("2º ciclo: fator 1000 volta em 22/02/2025", () => {
    expect(vencimentoDoFator("1000", new Date("2025-03-01"))).toBe("2025-02-22");
  });
  it("escolhe o ciclo pela data de referência", () => {
    // fator 1596 = 22/02/2025 + 596 dias = 11/10/2026 (no 1º ciclo seria 2002)
    expect(vencimentoDoFator("1596", new Date("2026-10-01"))).toBe("2026-10-11");
  });
  it("fator 0000 = sem vencimento", () => {
    expect(vencimentoDoFator("0000")).toBeNull();
  });
});

describe("boleto bancário (47 dígitos)", () => {
  const { linha, codigo } = linhaBancaria("341", "1596", "0000042800", "1090300601707300796341800");

  it("aceita a linha, com ou sem pontos e espaços, e decodifica banco, valor e vencimento", () => {
    const formatada = `${linha.slice(0, 5)}.${linha.slice(5, 10)} ${linha.slice(10, 15)}.${linha.slice(15, 21)} ${linha.slice(21, 26)}.${linha.slice(26, 32)} ${linha[32]} ${linha.slice(33)}`;
    for (const entrada of [linha, formatada]) {
      const r = conferirLinhaDigitavel(entrada, new Date("2026-10-01"));
      expect(r.valida).toBe(true);
      expect(r.erros).toEqual([]);
      expect(r.tipo).toBe("bancario");
      expect(r.banco).toBe("341");
      expect(r.valor).toBe(428);
      expect(r.vencimento).toBe("2026-10-11");
      expect(r.codigo_barras).toBe(codigo);
      expect(r.linha_formatada).toBe(formatada);
    }
  });

  it("campos 1 a 4: recusa qualquer dígito trocado", () => {
    for (let i = 0; i <= 32; i++) {
      const trocado = linha.slice(0, i) + ((Number(linha[i]) + 1) % 10) + linha.slice(i + 1);
      expect(conferirLinhaDigitavel(trocado).valida, `posição ${i + 1}`).toBe(false);
    }
  });

  it("campo 5 (fator e valor): o DV geral não pega toda troca — o valor ou o vencimento lidos mudam", () => {
    // A regra Febraban leva os restos 0, 1 e 10 ao mesmo DV (1). Por isso a Edge compara o valor e o vencimento
    // tirados da linha com os impressos: uma troca aqui que passe no DV muda um dos dois.
    const original = conferirLinhaDigitavel(linha, new Date("2026-10-01"));
    for (let i = 33; i < linha.length; i++) {
      const trocado = linha.slice(0, i) + ((Number(linha[i]) + 1) % 10) + linha.slice(i + 1);
      const r = conferirLinhaDigitavel(trocado, new Date("2026-10-01"));
      const pega = !r.valida || r.valor !== original.valor || r.vencimento !== original.vencimento;
      expect(pega, `posição ${i + 1}`).toBe(true);
    }
  });

  it("recusa dois dígitos vizinhos invertidos num campo", () => {
    const invertida = linha.slice(0, 10) + linha[11] + linha[10] + linha.slice(12);
    if (invertida !== linha) expect(conferirLinhaDigitavel(invertida).valida).toBe(false);
  });

  it("recusa linha com dígito a menos ou a mais", () => {
    expect(conferirLinhaDigitavel(linha.slice(1)).valida).toBe(false);
    expect(conferirLinhaDigitavel(linha + "0").valida).toBe(false);
    expect(conferirLinhaDigitavel("").erros[0]).toMatch(/0 dígitos/);
  });
});

describe("arrecadação (48 dígitos, começa com 8)", () => {
  const linha = linhaArrecadacao("816" + "00000123450" + "0".repeat(29)); // 43 dígitos: valor R$ 1.234,50
  it("aceita e lê o valor quando o identificador é de valor real", () => {
    const r = conferirLinhaDigitavel(linha);
    expect(r.valida).toBe(true);
    expect(r.tipo).toBe("arrecadacao");
    expect(r.valor).toBe(1234.5);
    expect(r.vencimento).toBeNull();
  });
  it("recusa um dígito trocado", () => {
    const trocado = linha.slice(0, 5) + ((Number(linha[5]) + 1) % 10) + linha.slice(6);
    expect(conferirLinhaDigitavel(trocado).valida).toBe(false);
  });
});
