import { describe, it, expect, vi } from "vitest";

// Os serviços importam o client do Supabase no topo; os testes são puros.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { anexarArquivosAoPayload } from "@/services/alvoProjetoPedidoService";
import { MAX_ANEXOS_PEDIDO, MAX_BYTES_ANEXO, fmtTamanho, validarAnexos } from "@/services/projetoArquivosService";

const arquivo = (nome: string, tipo: string, tamanho: number) =>
  new File([new Uint8Array(Math.min(tamanho, 16))], nome, { type: tipo });

/** File com `size` forçado (evita alocar 5 MB no teste). */
const arquivoDeTamanho = (nome: string, tipo: string, tamanho: number) => {
  const f = arquivo(nome, tipo, 1);
  Object.defineProperty(f, "size", { value: tamanho });
  return f;
};

describe("anexarArquivosAoPayload — formato do SaveMultiPart (igual ao do Suprimentos)", () => {
  const payload = { CodigoEmpresaFilial: "1.01", Numero: "", PedCompUserFieldsObject: {} };

  it("monta a lista de anexos e as chaves {GUID}#Arquivo na mesma ordem", () => {
    const obj = anexarArquivosAoPayload(payload, ["g-1", "g-2"]);
    expect(obj.PedCompArquivoChildList).toEqual([
      { CodigoEmpresaFilial: -1, NumeroPedComp: -1, Sequencia: 1, Arquivo: null, UploadIdentify: "g-1" },
      { CodigoEmpresaFilial: -1, NumeroPedComp: -1, Sequencia: 2, Arquivo: null, UploadIdentify: "g-2" },
    ]);
    expect(obj.filesToUpload).toEqual([
      { key: "g-1#Arquivo", file: {} },
      { key: "g-2#Arquivo", file: {} },
    ]);
  });

  it("não mexe no restante do payload nem no objeto original", () => {
    const obj = anexarArquivosAoPayload(payload, ["g-1"]);
    expect(obj.CodigoEmpresaFilial).toBe("1.01");
    // o comando de aprovação continua ausente (incidente de 27/08 — §13 do plano)
    expect(obj.PedCompUserFieldsObject).toEqual({});
    expect(payload).not.toHaveProperty("PedCompArquivoChildList");
  });
});

describe("validarAnexos — limites da pasta e da rota do gateway", () => {
  it("aceita PDF, JPG e PNG dentro do limite", () => {
    const ok = [
      arquivo("a.pdf", "application/pdf", 10),
      arquivo("b.jpg", "image/jpeg", 10),
      arquivo("c.png", "image/png", 10),
    ];
    expect(validarAnexos(ok, 0)).toBeNull();
  });

  it(`recusa passar de ${MAX_ANEXOS_PEDIDO} anexos contando os já existentes`, () => {
    expect(validarAnexos([arquivo("a.pdf", "application/pdf", 10)], MAX_ANEXOS_PEDIDO)).toMatch(/no máximo/);
  });

  it("recusa outros tipos", () => {
    expect(validarAnexos([arquivo("planilha.xlsx", "application/vnd.ms-excel", 10)], 0)).toMatch(/PDF, JPG ou PNG/);
  });

  it("recusa arquivo acima de 5 MB e aceita exatamente 5 MB", () => {
    expect(validarAnexos([arquivoDeTamanho("grande.pdf", "application/pdf", MAX_BYTES_ANEXO + 1)], 0)).toMatch(/5 MB/);
    expect(validarAnexos([arquivoDeTamanho("limite.pdf", "application/pdf", MAX_BYTES_ANEXO)], 0)).toBeNull();
  });

  it("formata o tamanho para exibição", () => {
    expect(fmtTamanho(512)).toBe("1 KB");
    expect(fmtTamanho(1536 * 1024)).toBe("1,5 MB");
  });
});
