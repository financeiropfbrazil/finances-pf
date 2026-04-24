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

// ─── Interfaces públicas ───

interface CapturaResult {
  total: number;
  salvos: number;
  erros: string[];
  stats: {
    via_api: number;
    via_copia_ancora: number;
    sem_historico: number;
  };
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

// ─── Helpers internos de data ───

function toDataBR(dataYMD: string): string {
  const [y, m, d] = dataYMD.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Soma 1 dia a uma data no formato YYYY-MM-DD e retorna YYYY-MM-DD.
 * Usa UTC para evitar bugs de timezone.
 */
function addOneDay(dataYMD: string): string {
  const d = new Date(`${dataYMD}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ─── Sincronização de produtos (inalterada) ───

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

// ─── Interfaces internas do algoritmo de captura ───

interface ProdutoBase {
  id: string;
  codigo_produto: string;
  unidade_medida: string | null;
  data_cadastro: string | null;
}

interface Ancora {
  data_referencia: string;
  quantidade: number;
  valor_total_brl: number | null;
  valor_medio_unitario: number | null;
}

type FonteSaldo = "api" | "copia_ancora" | "sem_historico";

interface UpsertRow {
  product_id: string;
  periodo: string;
  data_referencia: string;
  quantidade: number;
  valor_total_brl: number | null;
  valor_medio_unitario: number | null;
  fonte: FonteSaldo;
}

// ─── Core do algoritmo (compartilhado entre captura mensal e semente histórica) ───

/**
 * Busca as âncoras (última captura em stock_balance anterior a dataReferencia)
 * para todos os product_ids informados. Retorna um Map product_id → Ancora.
 *
 * Se o produto nunca foi capturado antes, não aparece no Map.
 */
async function buscarAncoras(productIds: string[], dataReferencia: string): Promise<Map<string, Ancora>> {
  const ancoras = new Map<string, Ancora>();
  if (productIds.length === 0) return ancoras;

  // Chunk em 500 product_ids para evitar URL gigante no .in()
  const chunkSize = 500;
  for (let i = 0; i < productIds.length; i += chunkSize) {
    const chunk = productIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("stock_balance")
      .select("product_id, data_referencia, quantidade, valor_total_brl, valor_medio_unitario")
      .in("product_id", chunk)
      .lt("data_referencia", dataReferencia)
      .order("data_referencia", { ascending: false });

    if (error) {
      console.error(`[buscarAncoras] Erro no chunk ${i}:`, error.message);
      continue;
    }

    if (data) {
      // Como vem ordenado desc por data, a primeira ocorrência de cada product_id é a mais recente
      for (const row of data as any[]) {
        if (!ancoras.has(row.product_id)) {
          ancoras.set(row.product_id, {
            data_referencia: row.data_referencia,
            quantidade: Number(row.quantidade),
            valor_total_brl: row.valor_total_brl != null ? Number(row.valor_total_brl) : null,
            valor_medio_unitario: row.valor_medio_unitario != null ? Number(row.valor_medio_unitario) : null,
          });
        }
      }
    }
  }

  return ancoras;
}

/**
 * Processa um único produto aplicando o algoritmo Opção D.
 * Retorna a linha para upsert em stock_balance.
 */
async function processarProduto(
  produto: ProdutoBase,
  dataReferencia: string,
  ancora: Ancora | undefined,
  periodo: string,
): Promise<UpsertRow> {
  // Passo 1: decidir range
  let dataInicialYMD: string;
  if (ancora) {
    // Range estreito: do dia seguinte à âncora até dataReferencia
    dataInicialYMD = addOneDay(ancora.data_referencia);
  } else {
    // Sem âncora: range desde data_cadastro (sempre existe, validamos)
    dataInicialYMD = produto.data_cadastro as string;
  }

  const dataInicial = toDataBR(dataInicialYMD);
  const dataFinal = toDataBR(dataReferencia);

  // Caso patológico: se dataInicial > dataFinal (âncora está DEPOIS de dataReferencia),
  // não faz sentido consultar — usa a âncora diretamente
  if (dataInicialYMD > dataReferencia) {
    if (ancora) {
      return {
        product_id: produto.id,
        periodo,
        data_referencia: dataReferencia,
        quantidade: ancora.quantidade,
        valor_total_brl: ancora.valor_total_brl,
        valor_medio_unitario: ancora.valor_medio_unitario,
        fonte: "copia_ancora",
      };
    }
    // Sem âncora e data_cadastro > dataReferencia: produto cadastrado depois da data pedida
    return {
      product_id: produto.id,
      periodo,
      data_referencia: dataReferencia,
      quantidade: 0,
      valor_total_brl: null,
      valor_medio_unitario: null,
      fonte: "sem_historico",
    };
  }

  // Passo 2: chamar o Alvo
  const data = await callGatewayEstoque("/estoque/ficha", {
    dataInicial,
    dataFinal,
    produto: produto.codigo_produto,
    idProdutoId: null,
    peso: "1.000000000",
    pesoFatorDivisor: "Fator",
    posicao: "1",
    unidadeMedida: produto.unidade_medida || "UNID",
  });

  const items: FichaEstoqueItem[] = Array.isArray(data) ? data : [];

  // Passo 3: interpretar resposta
  // Filtra linha sintética "Saldo Anterior" que o Alvo injeta (queremos só movs reais)
  const realMovements = items.filter((m) => m.Operacao !== "Saldo Anterior");

  if (realMovements.length === 0) {
    // Resposta vazia
    if (ancora) {
      // Produto ficou parado → copia o saldo da âncora
      return {
        product_id: produto.id,
        periodo,
        data_referencia: dataReferencia,
        quantidade: ancora.quantidade,
        valor_total_brl: ancora.valor_total_brl,
        valor_medio_unitario: ancora.valor_medio_unitario,
        fonte: "copia_ancora",
      };
    }
    // Sem âncora e sem histórico → saldo legítimo é zero
    return {
      product_id: produto.id,
      periodo,
      data_referencia: dataReferencia,
      quantidade: 0,
      valor_total_brl: null,
      valor_medio_unitario: null,
      fonte: "sem_historico",
    };
  }

  // Tem movimentações reais: usa a última
  const last = realMovements[realMovements.length - 1];
  return {
    product_id: produto.id,
    periodo,
    data_referencia: dataReferencia,
    quantidade: last.QtdSaldo ?? 0,
    valor_total_brl: last.ValorSaldo ?? null,
    valor_medio_unitario: last.CustoMedio ?? null,
    fonte: "api",
  };
}

/**
 * Persiste as linhas em stock_balance com upsert em lotes.
 */
async function persistirLote(
  upsertPayload: UpsertRow[],
  result: CapturaResult,
  onProgress?: (msg: string) => void,
): Promise<void> {
  onProgress?.("Salvando saldos no banco de dados...");
  const chunkSize = 50;
  for (let i = 0; i < upsertPayload.length; i += chunkSize) {
    const chunk = upsertPayload.slice(i, i + chunkSize);
    const { error } = await supabase.from("stock_balance").upsert(chunk, { onConflict: "product_id,data_referencia" });

    if (error) {
      result.erros.push(`Lote ${Math.floor(i / chunkSize) + 1}: ${error.message}`);
    } else {
      result.salvos += chunk.length;
    }
  }
}

// ─── Função pública: captura mensal (com ancoragem inteligente) ───

/**
 * Captura o saldo de estoque em uma data específica, usando ancoragem em stock_balance
 * para evitar recalcular produtos que não tiveram movimentação desde a última captura.
 *
 * Algoritmo (Opção D):
 * 1. Para cada produto, busca a última captura em stock_balance anterior a dataReferencia (âncora).
 * 2. Se âncora existe: pede ao Alvo só o range [ancora.data+1, dataReferencia].
 *    Se âncora não existe: pede o range [data_cadastro, dataReferencia] (produto sem captura anterior).
 * 3. Se Alvo responde vazio com âncora → copia saldo da âncora (produto ficou parado).
 *    Se Alvo responde vazio sem âncora → saldo legítimo = 0 (produto sem histórico).
 *    Se Alvo responde com dados → usa a última movimentação.
 *
 * @param dataReferencia - formato "YYYY-MM-DD" (deve ser anterior a hoje)
 */
export async function capturarSaldoMensal(
  dataReferencia: string,
  onProgress?: (msg: string) => void,
): Promise<CapturaResult> {
  const result: CapturaResult = {
    total: 0,
    salvos: 0,
    erros: [],
    stats: { via_api: 0, via_copia_ancora: 0, sem_historico: 0 },
  };

  const hoje = new Date().toISOString().slice(0, 10);
  if (dataReferencia >= hoje) {
    throw new Error("Só é possível consultar datas anteriores ao dia atual.");
  }

  const periodo = dataReferencia.slice(0, 7);

  onProgress?.("Carregando catálogo de produtos...");
  const products: ProdutoBase[] = [];
  let from = 0;
  const batchDb = 1000;
  let done = false;
  while (!done) {
    const { data } = await (supabase as any)
      .from("stock_products")
      .select("id, codigo_produto, unidade_medida, data_cadastro")
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

  onProgress?.("Buscando âncoras de saldo em stock_balance...");
  const ancoras = await buscarAncoras(
    products.map((p) => p.id),
    dataReferencia,
  );

  onProgress?.(
    `${ancoras.size} produtos têm âncora anterior. ${products.length - ancoras.size} serão consultados com range completo.`,
  );

  const upsertPayload: UpsertRow[] = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    onProgress?.(`Produto ${i + 1}/${products.length} — ${p.codigo_produto}`);

    try {
      const row = await processarProduto(p, dataReferencia, ancoras.get(p.id), periodo);
      upsertPayload.push(row);

      // Atualiza stats
      if (row.fonte === "api") result.stats.via_api++;
      else if (row.fonte === "copia_ancora") result.stats.via_copia_ancora++;
      else result.stats.sem_historico++;
    } catch (e: any) {
      result.erros.push(`Produto ${p.codigo_produto}: ${e.message}`);
    }
  }

  await persistirLote(upsertPayload, result, onProgress);

  onProgress?.(
    `Concluído. API: ${result.stats.via_api} | Âncora: ${result.stats.via_copia_ancora} | Sem histórico: ${result.stats.sem_historico}`,
  );
  return result;
}

// ─── Função pública: semente histórica ───

/**
 * Captura histórica para uma data específica, útil como primeira carga
 * quando stock_balance está vazio.
 *
 * Como não há âncoras, TODOS os produtos são consultados com range completo
 * (data_cadastro → dataReferencia). É lento (~30-40 min para 2.521 produtos),
 * mas só roda 1x.
 *
 * Após rodar, capturarSaldoMensal usa o resultado desta função como âncora
 * e passa a ser rápida para as próximas datas.
 *
 * @param dataReferencia - data histórica a capturar (ex: "2025-12-31")
 */
export async function sementeHistoricaEstoque(
  dataReferencia: string,
  onProgress?: (msg: string) => void,
): Promise<CapturaResult> {
  onProgress?.("Iniciando semente histórica (range completo por produto)...");
  // A lógica é idêntica à captura mensal: se stock_balance estiver vazio para datas
  // anteriores a dataReferencia, buscarAncoras retorna Map vazio e todo mundo
  // cai no caminho "sem âncora → range desde data_cadastro". Exatamente o comportamento
  // que queremos para semear o histórico.
  return capturarSaldoMensal(dataReferencia, onProgress);
}

// ─── Movimentação individual (modal) — inalterada ───

export async function buscarMovimentacaoProduto(
  codigoProduto: string,
  dataReferencia: string,
  unidadeMedida: string | null,
): Promise<any[]> {
  const { data: produto } = await (supabase as any)
    .from("stock_products")
    .select("data_cadastro")
    .eq("codigo_produto", codigoProduto)
    .maybeSingle();

  const FALLBACK_DATA_INICIAL = "01/01/2015";
  let dataInicial = FALLBACK_DATA_INICIAL;

  if (produto?.data_cadastro) {
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

// ─── Enriquecimento de unidades de medida (inalterada) ───

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
