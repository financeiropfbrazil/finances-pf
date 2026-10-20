import { describe, expect, it } from "vitest";
import { getAprovacaoPedido, getStatusPedido } from "@/lib/statusPedido";

// NFSE-1.11-A — combinações reais do censo de 20/10/2026 (compras_pedidos).
const ped = (status: string, aprovado: string, status_aprovacao: string, enviou_aprovacao: string | null = "Sim") => ({
  status,
  aprovado,
  status_aprovacao,
  enviou_aprovacao,
  status_local: "sincronizado",
});

describe("getAprovacaoPedido", () => {
  it("Total + Finalizada = 100% aprovado, qualquer que seja o status", () => {
    for (const status of ["Encerrado", "Aberto", "Pendente", "Cancelado", "Cancelado Parcial"]) {
      const a = getAprovacaoPedido(ped(status, "Total", "Finalizada"));
      expect(a.aprovado100).toBe(true);
      expect(a.label).toBe("100% aprovado");
    }
  });

  it("Reavaliar (0005125, 20/10/2026) não é aprovado", () => {
    const p = ped("Reavaliar", "Não", "Nenhum", "Não");
    expect(getStatusPedido(p).key).toBe("reavaliar");
    const a = getAprovacaoPedido(p);
    expect(a.aprovado100).toBe(false);
    expect(a.label).toBe("Não aprovado");
    expect(a.tooltip).toContain("ainda não enviado para aprovação");
  });

  it("status e aprovação não se deduzem um do outro", () => {
    // Encerrado sem aprovação: status Concluído, mas não aprovado
    const p = ped("Encerrado", "Não", "Nenhum", null);
    expect(getStatusPedido(p).key).toBe("concluido");
    expect(getAprovacaoPedido(p).aprovado100).toBe(false);
  });

  it("em andamento cita o próximo aprovador; parcial tem rótulo próprio", () => {
    const andamento = getAprovacaoPedido({ ...ped("Aberto", "Não", "Em Andamento"), proximo_aprovador: "FULANO" });
    expect(andamento.aprovado100).toBe(false);
    expect(andamento.tooltip).toContain("com FULANO");
    const parcial = getAprovacaoPedido(ped("Aberto", "Parcial", "Reavaliar"));
    expect(parcial.aprovado100).toBe(false);
    expect(parcial.label).toBe("Aprovação parcial");
  });

  it("sem dado (pedido fora do Hub) nunca conta como aprovado", () => {
    expect(getAprovacaoPedido({}).aprovado100).toBe(false);
    expect(getAprovacaoPedido(null).aprovado100).toBe(false);
  });
});
