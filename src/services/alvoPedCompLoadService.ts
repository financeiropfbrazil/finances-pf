import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchLoadWithRetry(numero: string): Promise<any> {
  let token = (await authenticateAlvo()).token;
  if (!token) throw new Error("Falha na autenticação ERP");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const url = `${ERP_BASE_URL}/PedComp/Load?codigoEmpresaFilial=1.01&numero=${encodeURIComponent(numero)}&loadChild=All`;
    const resp = await fetch(url, {
      method: "GET",
      headers: { "riosoft-token": token },
    });

    if (resp.status === 409) {
      console.warn(`[PedCompLoad] 409 tentativa ${attempt}/${MAX_RETRIES}`);
      if (attempt === MAX_RETRIES) throw new Error("Conflito de sessão persistente (409)");
      clearAlvoToken();
      await delay(1000 * attempt);
      const reAuth = await authenticateAlvo();
      if (!reAuth.token) throw new Error("Re-autenticação falhou");
      token = reAuth.token;
      continue;
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }
}

function extrairItens(data: any): any[] {
  const list = data?.ItemPedCompChildList || [];
  return list.map((item: any) => ({
    sequencia: item.Sequencia,
    codigoProduto: item.CodigoProduto,
    nomeProduto: item.NomeProduto || item.DescricaoAlternativaProduto,
    unidade: item.CodigoProdUnidMed,
    quantidade: item.QuantidadeProdUnidMedPrincipal,
    valorUnitario: item.ValorUnitario,
    valorTotal: item.ValorTotal,
    itemServico: item.ItemServico,
    cancelado: item.Cancelado,
    classe: item.ItemPedCompClasseRecdespChildList?.[0]?.CodigoClasseRecDesp || null,
    centroCusto: item.ItemPedCompClasseRecdespChildList?.[0]?.RateioItemPedCompChildList?.[0]?.CodigoCentroCtrl || null,
    classeRateio: (item.ItemPedCompClasseRecdespChildList || []).map((c: any) => ({
      classe: c.CodigoClasseRecDesp,
      valor: c.Valor,
      percentual: c.Percentual,
      centrosCusto: (c.RateioItemPedCompChildList || []).map((r: any) => ({
        codigo: r.CodigoCentroCtrl,
        valor: r.Valor,
        percentual: r.Percentual,
      })),
    })),
  }));
}

function extrairParcelas(data: any): any[] {
  const list = data?.ParcPagPedCompChildList || [];
  return list.map((p: any) => ({
    sequencia: p.Sequencia,
    duplicata: p.NumeroDuplicata,
    diasEntreParcelas: p.DiasEntreParcelas,
    percentual: p.PercentualFracao,
    valor: p.ValorParcela,
    vencimento: p.DataVencimento?.split("T")[0] || null,
  }));
}

// Menor vencimento (YYYY-MM-DD) entre as parcelas — usado para ordenar a listagem
// por "prestes a vencer/vencidos". Cobre pedidos sem sequencia=1 (pega a parcela
// mais antiga disponível). Retorna null se não houver vencimento.
function calcularPrimeiroVencimento(parcelas: any[]): string | null {
  const vencs = (parcelas || [])
    .map((p) => p?.vencimento)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (vencs.length === 0) return null;
  return vencs.reduce((menor, atual) => (atual < menor ? atual : menor));
}

function extrairClasseRateio(data: any): any[] {
  let list = data?.PedCompClasseRecDespChildList || [];
  if (list.length === 0) {
    const items = data?.ItemPedCompChildList || [];
    for (const item of items) {
      const ic = item.ItemPedCompClasseRecdespChildList || [];
      list.push(...ic);
    }
  }
  return list.map((c: any) => ({
    classe: c.CodigoClasseRecDesp,
    valor: c.Valor,
    percentual: c.Percentual,
    centrosCusto: (c.RateioPedCompChildList || c.RateioItemPedCompChildList || []).map((r: any) => ({
      codigo: r.CodigoCentroCtrl,
      valor: r.Valor,
      percentual: r.Percentual,
    })),
  }));
}

function extrairAnexos(data: any): any[] {
  const list = data?.PedCompArquivoChildList || [];
  return list.map((a: any) => {
    const path = a.Arquivo || "";
    const nome = path.split("\\").pop() || path;
    return {
      sequencia: a.Sequencia,
      nomeArquivo: nome,
      caminhoOriginal: path,
      usuario: a.CodigoUsuario,
      data: a.DataArquivo?.split("T")[0] || null,
      observacao: a.Observacao,
    };
  });
}

/**
 * Soma o valorTotal dos itens NÃO cancelados.
 * Usado como fallback quando o cabeçalho do Alvo (ValorTotal) vier null/undefined.
 */
function somarItensNaoCancelados(itens: any[]): number {
  return (itens || [])
    .filter((it: any) => it?.cancelado !== "Sim")
    .reduce((acc: number, it: any) => acc + (Number(it?.valorTotal) || 0), 0);
}

/**
 * Resolve o valor_total do pedido a partir do retorno do Load.
 * Fonte da verdade: o ValorTotal do cabeçalho do Alvo (inclui frete/desconto).
 * Fallback: soma dos itens não cancelados — só quando o Alvo NÃO fornecer total
 * (null/undefined). Um 0 explícito do Alvo é respeitado APENAS se não houver itens
 * com valor; havendo itens com valor mas cabeçalho 0, usa a soma dos itens
 * (cobre o caso de pedido "Em Andamento" cujo cabeçalho ainda não consolidou).
 */
function resolverValorTotal(data: any, itens: any[]): number {
  const cab = data?.ValorTotal;
  const somaItens = somarItensNaoCancelados(itens);

  if (cab === null || cab === undefined) {
    return somaItens;
  }
  const cabNum = Number(cab) || 0;
  if (cabNum === 0 && somaItens > 0) {
    return somaItens;
  }
  return cabNum;
}

export async function baixarAnexoPedido(
  nomeArquivo: string,
  caminhoOriginal: string,
  storagePath?: string | null,
): Promise<void> {
  // 1. Tentar Supabase Storage primeiro
  if (storagePath) {
    const { data, error } = await supabase.storage.from("attachments").download(storagePath);

    if (data && !error) {
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeArquivo;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }
  }

  // 2. Fallback: baixar do ERP
  const auth = await authenticateAlvo();
  if (!auth.token) {
    throw new Error("Anexo não disponível. Peça ao administrador para sincronizar os pedidos.");
  }

  const resp = await fetch(`${ERP_BASE_URL}/pedComp/DownloadFile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "riosoft-token": auth.token,
    },
    body: JSON.stringify({
      property: "Arquivo",
      classVincul: "PedCompArquivo",
      nameFile: nomeArquivo,
      pathFile: caminhoOriginal,
    }),
  });

  if (resp.status === 409) {
    clearAlvoToken();
    throw new Error("Conflito de sessão. Tente novamente.");
  }

  if (!resp.ok) throw new Error(`Erro HTTP ${resp.status}`);

  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function carregarDetalhesPedido(numero: string): Promise<void> {
  const data = await fetchLoadWithRetry(numero);

  const condPagObj = data?.CondPagPedCompObject;
  const nomeCondPag = condPagObj?.Nome || null;

  const itens = extrairItens(data);
  const parcelas = extrairParcelas(data);

  const update: Record<string, any> = {
    itens,
    parcelas,
    classe_rateio: extrairClasseRateio(data),
    anexos: extrairAnexos(data),
    nome_cond_pag: nomeCondPag,
    // ── Valores do cabeçalho (corrige listagem zerada) ──────────────────
    // O /ped-comp/list (descoberta) traz ValorTotal=0 para pedidos em
    // andamento; o Load completo traz o valor consolidado. Aqui gravamos
    // esses valores para que a LISTAGEM (que lê compras_pedidos.valor_total)
    // fique consistente com a tela de DETALHE.
    valor_total: resolverValorTotal(data, itens),
    valor_mercadoria: data?.ValorMercadoria ?? null,
    valor_servico: data?.ValorServico ?? null,
    valor_frete: data?.ValorFrete ?? null,
    valor_desconto: data?.ValorDescontoGeral ?? null,
    valor_outras_despesas: data?.ValorOutrasDespesas ?? null,
    valor_ipi: data?.GeralValorIPI ?? null,
    primeiro_vencimento: calcularPrimeiroVencimento(parcelas),
    detalhes_carregados: true,
    detalhes_carregados_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Preenche classe_rec_desp e centro_custo do primeiro rateio encontrado
  if (update.classe_rateio.length > 0) {
    const primeiro = update.classe_rateio[0];
    update.classe_rec_desp = primeiro.classe;
    if (primeiro.centrosCusto?.length > 0) {
      update.centro_custo = primeiro.centrosCusto[0].codigo;
    }
  }

  const { error } = await supabase
    .from("compras_pedidos")
    .upsert({ ...update, numero, codigo_empresa_filial: "1.01" }, { onConflict: "codigo_empresa_filial,numero" });

  if (error) throw new Error(`Erro ao salvar detalhes: ${error.message}`);
}
