import { supabase } from "@/integrations/supabase/client";

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";

// ─── Helpers de comunicação com o gateway ───

async function getSupabaseJWT(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sessão do Supabase inválida. Faça login novamente.");
  }
  return session.access_token;
}

async function callGatewayEstoque(path: string, body: unknown): Promise<any> {
  const jwt = await getSupabaseJWT();
  const url = `${ERP_PROXY_URL}${path}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });

  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    // resposta sem body ou inválida
  }

  if (!resp.ok) {
    const msg = data?.error || `HTTP ${resp.status}`;
    const err = new Error(msg) as Error & { status?: number; details?: any };
    err.status = resp.status;
    err.details = data?.details;
    throw err;
  }

  return data;
}

async function callGatewayEstoqueGet(path: string): Promise<any> {
  const jwt = await getSupabaseJWT();
  const url = `${ERP_PROXY_URL}${path}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${jwt}`,
    },
  });

  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    // resposta sem body ou inválida
  }

  if (!resp.ok) {
    const msg = data?.error || `HTTP ${resp.status}`;
    const err = new Error(msg) as Error & { status?: number; details?: any };
    err.status = resp.status;
    err.details = data?.details;
    throw err;
  }

  return data;
}

// ─── Interfaces públicas (mantidas idênticas ao original) ───

interface CapturaResult {
  total: number;
  salvos: number;
  erros: string[];
}

interface FichaEstoqueItem {
  Data?: string;
  Operacao?: string;
  QtdSaldo?: number;
  ValorSaldo?: number;
  CustoMedio?: number;
}

const TIPO_LABELS: Record<string, string> = {
  "01": "01-Acabado",
  "02": "02-Semi-Acabado",
  "03": "03-Matéria Prima",
  "04": "04-Serviço",
  "05": "05-Revenda",
  "06": "06-Material de Embalagem",
  "44": "44-Insumos",
};

interface SyncProdutosResult {
  totalERP: number;
  novos: number;
  ignorados: number;
  erros: string[];
}

export interface EnrichUnidadesResult {
  enriched: number;
  skipped: number;
  errors: number;
}

// ─── Helper interno: converter YYYY-MM-DD → DD/MM/YYYY ───

function toDataBR(dataYMD: string): string {
  const [y, m, d] = dataYMD.split("-");
  return `${d}/${m}/${y}`;
}

// ─── Funções públicas ───

/**
 * Sincroniza catálogo de produtos do ERP → stock_products (apenas insere novos).
 * Paginação via gateway: cada página chama POST /estoque/produto-sync.
 */
export async function sincronizarProdutosDoERP(onProgress?: (msg: string) => void): Promise<SyncProdutosResult> {
  const result: SyncProdutosResult = { totalERP: 0, novos: 0, ignorados: 0, erros: [] };

  const allProducts: any[] = [];
  let pageIndex = 1;
  let hasMore = true;
  const pageSize = 500;

  while (hasMore) {
    onProgress?.(`Sincronizando produtos (página ${pageIndex})...`);
    try {
      const data = await callGatewayEstoque("/estoque/produto-sync", {
        pageIndex,
        pageSize,
      });

      const items: any[] = Array.isArray(data) ? data : (data?.lista ?? data?.Registros ?? []);
      if (items.length === 0) {
        hasMore = false;
      } else {
        for (const item of items) {
          const codigo = item.Codigo ?? "";
          const nivel = item.Nivel ?? "";

          if (!nivel || nivel === "" || codigo === nivel || item.Grupo === "T") continue;

          const tipoCodigo = item.CodigoTipoProduto ?? "";
          allProducts.push({
            codigo_produto: codigo,
            codigo_reduzido: item.Reduzido ?? null,
            codigo_alternativo: item.Alternativo ?? null,
            nome_produto: item.Nome ?? "",
            tipo_produto: TIPO_LABELS[tipoCodigo] ?? (tipoCodigo || "Outros"),
            familia_codigo: nivel,
            variacao: item.NomeAlternativo3 ?? null,
            unidade_medida: null,
            ativo: true,
            codigo_barras: item.CodigoBarras ?? null,
            controla_lote: item.ControlaLote === "Sim",
            classificacao_fiscal: item.CodigoClasFiscal ?? null,
            tipo_produto_fiscal: item.CodigoTipoProdFisc ?? null,
            data_cadastro: item.DataCadastro ? item.DataCadastro.split("T")[0] : null,
          });
        }
        if (items.length < pageSize) {
          hasMore = false;
        } else {
          pageIndex++;
        }
      }
    } catch (e: any) {
      result.erros.push(`Página ${pageIndex}: ${e.message}`);
      hasMore = false;
    }
  }

  result.totalERP = allProducts.length;
  if (allProducts.length === 0) return result;

  onProgress?.("Verificando produtos existentes...");
  const existingCodes = new Set<string>();
  let from = 0;
  const batchDb = 1000;
  let done = false;
  while (!done) {
    const { data } = await supabase
      .from("stock_products")
      .select("codigo_produto")
      .range(from, from + batchDb - 1);
    if (data && data.length > 0) {
      for (const r of data) existingCodes.add(r.codigo_produto);
      from += batchDb;
      if (data.length < batchDb) done = true;
    } else {
      done = true;
    }
  }

  const novos = allProducts.filter((p) => !existingCodes.has(p.codigo_produto));
  result.ignorados = allProducts.length - novos.length;

  if (novos.length > 0) {
    onProgress?.(`Inserindo ${novos.length} produtos novos...`);
    const chunkSize = 100;
    for (let i = 0; i < novos.length; i += chunkSize) {
      const chunk = novos.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("stock_products")
        .upsert(chunk, { onConflict: "codigo_produto", ignoreDuplicates: true });
      if (error) {
        result.erros.push(`Lote ${Math.floor(i / chunkSize) + 1}: ${error.message}`);
      } else {
        result.novos += chunk.length;
      }
    }
  }

  onProgress?.("Sincronização de produtos concluída.");
  return result;
}

/**
 * Captura saldo mensal via gateway /estoque/ficha (por produto).
 * @param dataReferencia - formato "YYYY-MM-DD" (data final da consulta, deve ser anterior a hoje)
 */
export async function capturarSaldoMensal(
  dataReferencia: string,
  onProgress?: (msg: string) => void,
): Promise<CapturaResult> {
  const result: CapturaResult = { total: 0, salvos: 0, erros: [] };

  const hoje = new Date().toISOString().slice(0, 10);
  if (dataReferencia >= hoje) {
    throw new Error("Só é possível consultar datas anteriores ao dia atual.");
  }

  const periodo = dataReferencia.slice(0, 7);

  onProgress?.("Carregando catálogo de produtos...");
  const products: { id: string; codigo_produto: string; unidade_medida: string | null }[] = [];
  let from = 0;
  const batchDb = 1000;
  let done = false;
  while (!done) {
    const { data } = await supabase
      .from("stock_products")
      .select("id, codigo_produto, unidade_medida")
      .eq("ativo", true)
      .range(from, from + batchDb - 1);
    if (data && data.length > 0) {
      products.push(...data);
      from += batchDb;
      if (data.length < batchDb) done = true;
    } else {
      done = true;
    }
  }

  if (products.length === 0) {
    result.erros.push("Nenhum produto ativo encontrado em stock_products.");
    return result;
  }

  result.total = products.length;

  const [year, month] = periodo.split("-");
  const dataInicial = `01/${month}/${year}`;
  const dataFinal = toDataBR(dataReferencia);

  const upsertPayload: {
    product_id: string;
    periodo: string;
    data_referencia: string;
    quantidade: number;
    valor_total_brl: number | null;
    valor_medio_unitario: number | null;
    fonte: "api";
  }[] = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    onProgress?.(`Produto ${i + 1}/${products.length} — ${p.codigo_produto}`);

    try {
      const data = await callGatewayEstoque("/estoque/ficha", {
        dataInicial,
        dataFinal,
        produto: p.codigo_produto,
        idProdutoId: null,
        peso: "1.000000000",
        pesoFatorDivisor: "Fator",
        posicao: "1",
        unidadeMedida: p.unidade_medida || "UNID",
      });

      const items: FichaEstoqueItem[] = Array.isArray(data) ? data : [];

      if (items.length === 0) {
        upsertPayload.push({
          product_id: p.id,
          periodo,
          data_referencia: dataReferencia,
          quantidade: 0,
          valor_total_brl: null,
          valor_medio_unitario: null,
          fonte: "api",
        });
      } else {
        const last = items[items.length - 1];
        upsertPayload.push({
          product_id: p.id,
          periodo,
          data_referencia: dataReferencia,
          quantidade: last.QtdSaldo ?? 0,
          valor_total_brl: last.ValorSaldo ?? null,
          valor_medio_unitario: last.CustoMedio ?? null,
          fonte: "api",
        });
      }
    } catch (e: any) {
      result.erros.push(`Produto ${p.codigo_produto}: ${e.message}`);
    }
  }

  onProgress?.("Salvando saldos no banco de dados...");
  const chunkSize = 50;
  for (let i = 0; i < upsertPayload.length; i += chunkSize) {
    const chunk = upsertPayload.slice(i, i + chunkSize);
    const { error } = await supabase.from("stock_balance").upsert(chunk, { onConflict: "product_id,data_referencia" });

    if (error) {
      result.erros.push(`Erro ao salvar lote ${Math.floor(i / chunkSize) + 1}: ${error.message}`);
    } else {
      result.salvos += chunk.length;
    }
  }

  onProgress?.("Concluído.");
  return result;
}

/**
 * Busca movimentações de um produto em uma data específica.
 *
 * Estratégia de range:
 *   dataInicial = data_cadastro do produto (buscada em stock_products)
 *   dataFinal   = dataReferencia (data selecionada pelo usuário)
 *
 * Isso garante que a resposta SEMPRE traga pelo menos uma movimentação
 * anterior ao dia selecionado (se existir no histórico do produto),
 * independentemente de quanto tempo o produto ficou parado.
 *
 * A modal interpreta:
 *   movements[0]     → Saldo anterior (última movimentação antes do dia)
 *   movements[1..n-1] → Movimentações do dia selecionado
 *   movements[n-1]   → Saldo final do dia
 *
 * Fallbacks para data_cadastro:
 *   - Se stock_products não tem data_cadastro → usa "01/01/2015" (conservador)
 *   - Se stock_products não encontra o produto → usa "01/01/2015"
 */
export async function buscarMovimentacaoProduto(
  codigoProduto: string,
  dataReferencia: string,
  unidadeMedida: string | null,
): Promise<any[]> {
  // Buscar data_cadastro do produto no Supabase (rápido, ~50ms)
  const { data: produto } = await (supabase as any)
    .from("stock_products")
    .select("data_cadastro")
    .eq("codigo_produto", codigoProduto)
    .maybeSingle();

  const FALLBACK_DATA_INICIAL = "01/01/2015";
  let dataInicial = FALLBACK_DATA_INICIAL;

  if (produto?.data_cadastro) {
    // data_cadastro vem no formato YYYY-MM-DD
    dataInicial = toDataBR(produto.data_cadastro as string);
  }

  const dataFinal = toDataBR(dataReferencia);

  const data = await callGatewayEstoque("/estoque/ficha", {
    dataInicial,
    dataFinal,
    produto: codigoProduto,
    idProdutoId: null,
    peso: "1.000000000",
    pesoFatorDivisor: "Fator",
    posicao: "1",
    unidadeMedida: unidadeMedida || "UNID",
  });

  return Array.isArray(data) ? data : [];
}

// ─── Enriquecimento de unidades de medida ───

/**
 * Enriquece unidade_medida em stock_products para produtos ativos sem unidade.
 * Usa GET /estoque/produto-load/:codigo no gateway (retry 401/403 é nativo).
 */
export async function enriquecerUnidadesMedida(
  onProgress?: (current: number, total: number, message: string) => void,
  shouldCancel?: () => boolean,
): Promise<EnrichUnidadesResult> {
  const { data: produtos, error } = await (supabase as any)
    .from("stock_products")
    .select("id, codigo_produto, nome_produto")
    .eq("ativo", true)
    .is("unidade_medida", null);

  if (error) throw new Error(`Erro ao buscar produtos: ${error.message}`);
  if (!produtos || produtos.length === 0) {
    return { enriched: 0, skipped: 0, errors: 0 };
  }

  onProgress?.(0, produtos.length, `${produtos.length} produtos para enriquecer...`);

  const result: EnrichUnidadesResult = { enriched: 0, skipped: 0, errors: 0 };
  const DELAY_MS = 200;

  for (let i = 0; i < produtos.length; i++) {
    if (shouldCancel?.()) {
      onProgress?.(i, produtos.length, `Cancelado pelo usuário. Processados: ${i} de ${produtos.length}`);
      break;
    }

    const p = produtos[i];
    try {
      onProgress?.(i + 1, produtos.length, `${i + 1}/${produtos.length}: ${p.codigo_produto} — ${p.nome_produto}...`);

      const path = `/estoque/produto-load/${encodeURIComponent(p.codigo_produto)}`;
      let detail: any;

      try {
        detail = await callGatewayEstoqueGet(path);
      } catch (err: any) {
        if (err?.status === 404) {
          result.skipped++;
          await new Promise((r) => setTimeout(r, DELAY_MS));
          continue;
        }
        throw err;
      }

      const childList = detail?.ProdUnidMedChildList ?? [];
      let unidadeCodigo: string | null = null;

      if (Array.isArray(childList) && childList.length > 0) {
        const principal = childList.find((u: any) => u.Posicao === 1) ?? childList[0];
        unidadeCodigo = principal?.CodigoUnidMedida ?? null;
      }

      if (!unidadeCodigo) {
        result.skipped++;
        await new Promise((r) => setTimeout(r, DELAY_MS));
        continue;
      }

      const { error: updateErr } = await (supabase as any).from("stock_products").upsert(
        {
          id: p.id,
          codigo_produto: p.codigo_produto,
          nome_produto: p.nome_produto,
          unidade_medida: unidadeCodigo,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );

      if (updateErr) {
        console.error(`Erro atualizando ${p.codigo_produto}:`, updateErr.message);
        result.errors++;
      } else {
        result.enriched++;
      }
    } catch (err: any) {
      console.error(`Erro no produto ${p.codigo_produto}:`, err);
      result.errors++;
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  return result;
}
