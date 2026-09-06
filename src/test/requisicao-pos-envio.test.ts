import { describe, it, expect } from "vitest";
import { destinoAposSubmissao, regenerarGuidsAnexos } from "@/lib/requisicaoPosEnvio";
import type { SubmissaoResult } from "@/services/requisicoesService";

// ══════════════════════════════════════════════════════════════════════
// CARD B — o wizard que fabricava rascunhos-lixo
// ══════════════════════════════════════════════════════════════════════
//
// Medido em 06/09/2026 no log do Postgres: "duplicate key value violates unique
// constraint compras_requisicoes_arquivos_upload_identify_guid_key" (INSERT via
// postgrest, 04/09 11:51:11). O wizard gera o `upload_identify_guid` UMA vez, ao
// escolher o arquivo, e o guarda no estado. Toda falha de envio deixava a tela viva
// com o mesmo estado; cada novo clique em "Enviar" chamava `criarRequisicao`, que
// cria OUTRA requisição e reinsere O MESMO GUID — e o UNIQUE é GLOBAL, não por
// requisição. Resultado: 23505 e 14 rascunhos-lixo. Defeito latente desde 18/05;
// explodiu quando o gate de identidade passou a reprovar todo primeiro envio.
//
// Duas defesas, testadas aqui:
//   1. NAVEGAÇÃO — nas falhas que já deixaram rascunho gravado (`rota: null` e o
//      `else` final, ambos com `requisicao_id`), sair para o DETALHE, onde
//      "Reenviar" reusa os anexos do banco em vez de criar outra requisição.
//   2. REGENERAÇÃO — em todo caminho que permanece na tela, trocar os GUIDs.
//
// Contra o código antigo os dois blocos falham: antes, `rota: null` e o `else`
// final não navegavam para lugar nenhum e nada regenerava os GUIDs.

function resultado(parcial: Partial<SubmissaoResult>): SubmissaoResult {
  return { sucesso: false, requisicao_id: "x", rota: null, ...parcial };
}

describe("destinoAposSubmissao — para onde o wizard vai depois de submeter", () => {
  describe("falhas que já gravaram o rascunho vão para o DETALHE", () => {
    it("recusa no roteamento (rota null) leva ao detalhe da requisição criada", () => {
      const destino = destinoAposSubmissao(
        resultado({ sucesso: false, rota: null, requisicao_id: "x", erro: "Você não tem permissão..." }),
      );
      expect(destino).toEqual({ tipo: "detalhe", requisicaoId: "x" });
    });

    it("falha de envio ao ERP (o `else` final: SEM_GATE, sem número) leva ao detalhe", () => {
      // Único shape que cai no `else` de `handleEnviar`: sucesso false, rota não é
      // PENDENTE nem null nem AUTO_APROVADA, e não há numero_alvo.
      const destino = destinoAposSubmissao(
        resultado({ sucesso: false, rota: "SEM_GATE", requisicao_id: "x", erro: "gateway 502" }),
      );
      expect(destino).toEqual({ tipo: "detalhe", requisicaoId: "x" });
    });

    it("sem requisicao_id não há detalhe para onde ir — permanece na tela", () => {
      expect(destinoAposSubmissao(resultado({ rota: null, requisicao_id: "", erro: "..." }))).toEqual({
        tipo: "permanece",
      });
      expect(destinoAposSubmissao(resultado({ rota: "SEM_GATE", requisicao_id: "", erro: "..." }))).toEqual({
        tipo: "permanece",
      });
    });
  });

  describe("desfechos que encerram o wizard vão para a LISTA", () => {
    it("PENDENTE (fila do líder) vai para a lista", () => {
      expect(destinoAposSubmissao(resultado({ sucesso: true, rota: "PENDENTE", requisicao_id: "x" }))).toEqual({
        tipo: "lista",
      });
    });

    it("sucesso com número do ERP vai para a lista", () => {
      expect(
        destinoAposSubmissao(resultado({ sucesso: true, rota: "SEM_GATE", requisicao_id: "x", numero_alvo: "0001500" })),
      ).toEqual({ tipo: "lista" });
    });

    it("PENDENTE tem precedência: mesmo sem sucesso, é a fila do líder", () => {
      // Espelha a ordem dos ramos do componente — o primeiro `if` é o da rota.
      expect(destinoAposSubmissao(resultado({ sucesso: false, rota: "PENDENTE", requisicao_id: "x" }))).toEqual({
        tipo: "lista",
      });
    });
  });

  describe("desfechos ambíguos PERMANECEM na tela (e por isso regeneram os GUIDs)", () => {
    it("chegou ao ERP mas o Hub não registrou (numero_alvo presente): reenviar duplicaria", () => {
      expect(
        destinoAposSubmissao(
          resultado({ sucesso: false, rota: "SEM_GATE", requisicao_id: "x", numero_alvo: "0001500", erro: "..." }),
        ),
      ).toEqual({ tipo: "permanece" });
    });

    it("AUTO_APROVADA com envio falho permanece: a aprovação já está preservada no Hub", () => {
      expect(
        destinoAposSubmissao(resultado({ sucesso: false, rota: "AUTO_APROVADA", requisicao_id: "x", erro: "..." })),
      ).toEqual({ tipo: "permanece" });
    });
  });
});

describe("regenerarGuidsAnexos — o GUID é da tentativa, não do arquivo", () => {
  const anexos = [
    { file: { name: "nota.pdf" } as unknown as File, upload_identify_guid: "guid-1" },
    { file: { name: "foto.png" } as unknown as File, upload_identify_guid: "guid-2" },
  ];

  it("troca todos os GUIDs por outros", () => {
    const novos = regenerarGuidsAnexos(anexos);
    expect(novos.map((a) => a.upload_identify_guid)).not.toContain("guid-1");
    expect(novos.map((a) => a.upload_identify_guid)).not.toContain("guid-2");
  });

  it("os novos GUIDs são distintos entre si", () => {
    const novos = regenerarGuidsAnexos(anexos);
    expect(new Set(novos.map((a) => a.upload_identify_guid)).size).toBe(2);
  });

  it("preserva os demais campos — o File é o mesmo objeto, só o GUID muda", () => {
    const novos = regenerarGuidsAnexos(anexos);
    expect(novos).toHaveLength(2);
    expect(novos[0].file).toBe(anexos[0].file);
    expect(novos[1].file).toBe(anexos[1].file);
  });

  it("não muta a lista original (é updater de estado do React)", () => {
    regenerarGuidsAnexos(anexos);
    expect(anexos.map((a) => a.upload_identify_guid)).toEqual(["guid-1", "guid-2"]);
  });

  it("lista vazia continua vazia", () => {
    expect(regenerarGuidsAnexos([])).toEqual([]);
  });
});
