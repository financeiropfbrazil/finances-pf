import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** NFE-18 — no detalhe da NF-e, "Vincular pedido" só aparece para quem pode vincular (Analista Fiscal/admin). */
const DETALHE = {
  nota: {
    id: "n1", chave_acesso: "35261128036074000105550010000018541000000001", numero: "1854", serie: "1", data_emissao: "2026-11-09",
    natureza_operacao: "VENDA", emitente_cnpj: "28036074000105", emitente_nome: "BIOCOLLAGEN LTDA", valor_produtos: 38700,
    valor_frete: 0, valor_desconto: 0, valor_icms: 0, valor_icms_st: 0, valor_ipi: 0, valor_total: 38700, origem: "alvo",
    imported_at: "2026-11-10T15:01:00Z", status_lancamento: "pendente",
    itens: [{ numero_item: 1, codigo_produto: "X", descricao: "Item", ncm: "", cfop: "5101", unidade: "UN", quantidade: 1, valor_unitario: 38700, valor_total: 38700 }],
    faturavel: true, situacao_alvo: "nao_encontrada", alvo_chave_movestq: null, alvo_data_entrada: null, alvo_fonte: null,
    dias_desde_emissao: 3, tem_xml: true,
  },
  pedidos: {
    vinculados: [], vinculo_hub: [],
    candidatos: [{ numero: "0005252", fornecedor: "BIOCOLLAGEN LTDA", data_pedido: "2026-11-06", valor_pedido: 38700, ja_faturado: 0, saldo: 38700,
      nfs_ligadas: 0, status: "Aberto", status_aprovacao: "Em Andamento", aprovado: "Não", forca: 1, motivo: "citado", diferenca: 0,
      diferenca_pct: 0, disputa: [], saldo_nao_confirmado: false, hub_reservado: 0, vinculado_hub_a: [] }],
  },
  movestq: null, anexos: [], docfin: { parcelas: [] },
  meta: { titulos_lidos_em: "2026-11-11T09:40:00Z", alvo_espelho_desde: "2026-01-01", riosoft_ultima_entrada: "2026-11-10T15:01:00Z" },
};
vi.mock("@/services/nfeRecebidasService", async (original) => ({
  ...(await original<typeof import("@/services/nfeRecebidasService")>()),
  buscarDetalheNfe: vi.fn(async () => DETALHE),
}));
vi.mock("@/services/notaComentariosService", async (original) => ({
  ...(await original<typeof import("@/services/notaComentariosService")>()),
  listarComentarios: vi.fn(async () => []),
}));
vi.mock("@/services/alvoTipoLancService", async (original) => ({
  ...(await original<typeof import("@/services/alvoTipoLancService")>()),
  useTipoLanc: () => ({ data: undefined }),
}));

import { NfeDetalheEtapas } from "@/components/nfe/NfeDetalheEtapas";

let root: Root | undefined;
let container: HTMLDivElement | undefined;
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});
const esperar = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });

async function montar(vincular?: () => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root!.render(
      <QueryClientProvider client={qc}>
        <NfeDetalheEtapas nfeId="n1" onVerXml={() => {}} onBaixarXml={() => {}} onVincular={vincular} onDesvincular={vincular} />
      </QueryClientProvider>,
    ),
  );
  await esperar();
}
const textos = () => Array.from(container!.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim());

describe("detalhe da NF-e — Vincular pedido (NFE-18)", () => {
  it("quem pode vincular vê o botão na etapa 2", async () => {
    await montar(() => {});
    expect(container!.textContent).toContain("0005252");
    expect(textos()).toContain("Vincular pedido");
  });

  it("Operador de Compras: vê a sugestão (consulta), mas sem o botão de vincular", async () => {
    await montar(undefined);
    expect(container!.textContent).toContain("0005252");
    expect(textos()).not.toContain("Vincular pedido");
    expect(textos()).not.toContain("Desvincular");
  });
});
