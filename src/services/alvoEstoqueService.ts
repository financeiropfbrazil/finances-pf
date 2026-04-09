import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";

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

async function fetchWithRetryAuth(
  url: string,
  body: any,
  token: string
): Promise<{ data: any; newToken?: string }> {
  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Riosoft-Token": token },
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 409) {
    clearAlvoToken();
    await new Promise((r) => setTimeout(r, 2000));
    const auth = await authenticateAlvo();
    if (!auth.success || !auth.token) throw new Error("Falha ao re-autenticar no ERP Alvo");
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Riosoft-Token": auth.token },
      body: JSON.stringify(body),
    });
    return { data: await res.json(), newToken: auth.token };
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return { data: await res.json() };
}

// ── Tipo labels ──
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

/**
 * Sincroniza catálogo de produtos do ERP → stock_products (apenas insere novos).
 */
export async function sincronizarProdutosDoERP(
  onProgress?: (msg: string) => void
): Promise<SyncProdutosResult> {
  const result: SyncProdutosResult = { totalERP: 0, novos: 0, ignorados: 0, erros: [] };

  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    result.erros.push("Falha na autenticação ERP: " + (auth.error || "token ausente"));
    return result;
  }
  let token = auth.token;

  const allProducts: any[] = [];
  let pageIndex = 1;
  let hasMore = true;

  while (hasMore) {
    onProgress?.(`Sincronizando produtos (página ${pageIndex})...`);
    try {
      const { data, newToken } = await fetchWithRetryAuth(
        `${ERP_BASE_URL}/produto/GetListForComponents`,
        {
          FormName: "produto",
          ClassInput: "produto",
          ControllerForm: "produto",
          TypeObject: "rsSearch",
          BindingName: "",
          ClassVinculo: "produto",
          DisabledCache: false,
          Filter: "Status = 'Ativado'",
          Input: "defaultSearch",
          IsGroupBy: false,
          Order: "Codigo ASC",
          OrderUser: "",
          PageIndex: pageIndex,
          PageSize: 500,
          Shortcut: "prod",
          Type: "GridTable",
        },
        token
      );
      if (newToken) token = newToken;

      const items: any[] = Array.isArray(data) ? data : (data?.lista ?? data?.Registros ?? []);
      if (items.length === 0) {
        hasMore = false;
      } else {
        for (const item of items) {
          const codigo = item.Codigo ?? "";
          const nivel = item.Nivel ?? "";

          // Filtrar nós de grupo/categoria (sem nível ou código = nível)
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
        if (items.length < 500) {
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

  // Buscar códigos existentes no Supabase
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
 * Captura saldo mensal via RetornaFichaEstoque (por produto).
 * @param dataReferencia - formato "YYYY-MM-DD" (data final da consulta, deve ser anterior a hoje)
 */
export async function capturarSaldoMensal(
  dataReferencia: string,
  onProgress?: (msg: string) => void
): Promise<CapturaResult> {
  const result: CapturaResult = { total: 0, salvos: 0, erros: [] };

  // Validação: não permitir data >= hoje
  const hoje = new Date().toISOString().slice(0, 10);
  if (dataReferencia >= hoje) {
    throw new Error("Só é possível consultar datas anteriores ao dia atual.");
  }

  // Derivar periodo automaticamente
  const periodo = dataReferencia.slice(0, 7); // "YYYY-MM"

  // 1. Auth
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    result.erros.push("Falha na autenticação ERP: " + (auth.error || "token ausente"));
    return result;
  }
  let token = auth.token;

  // 2. Fetch all active products
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

  // 3. Build date strings
  const [year, month] = periodo.split("-");
  const dataInicial = `01/${month}/${year}`;
  const [refY, refM, refD] = dataReferencia.split("-");
  const dataFinal = `${refD}/${refM}/${refY}`;

  // 4. Call RetornaFichaEstoque for each product
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
      const { data, newToken } = await fetchWithRetryAuth(
        `${ERP_BASE_URL}/MovEstq/RetornaFichaEstoque`,
        {
          dataInicial,
          dataFinal,
          produto: p.codigo_produto,
          idProdutoId: null,
          peso: "1.000000000",
          pesoFatorDivisor: "Fator",
          posicao: "1",
          unidadeMedida: p.unidade_medida || "UNID",
        },
        token
      );
      if (newToken) token = newToken;

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

  // 5. Upsert into stock_balance
  onProgress?.("Salvando saldos no banco de dados...");
  const chunkSize = 50;
  for (let i = 0; i < upsertPayload.length; i += chunkSize) {
    const chunk = upsertPayload.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("stock_balance")
      .upsert(chunk, { onConflict: "product_id,data_referencia" });

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
 * Busca movimentações de um produto em uma data específica via RetornaFichaEstoque.
 */
export async function buscarMovimentacaoProduto(
  codigoProduto: string,
  dataReferencia: string,
  unidadeMedida: string | null
): Promise<any[]> {
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    throw new Error("Falha na autenticação ERP: " + (auth.error || "token ausente"));
  }

  const [y, m, d] = dataReferencia.split("-");
  const dataBR = `${d}/${m}/${y}`;

  const { data } = await fetchWithRetryAuth(
    `${ERP_BASE_URL}/MovEstq/RetornaFichaEstoque`,
    {
      dataInicial: dataBR,
      dataFinal: dataBR,
      produto: codigoProduto,
      idProdutoId: null,
      peso: "1.000000000",
      pesoFatorDivisor: "Fator",
      posicao: "1",
      unidadeMedida: unidadeMedida || "UNID",
    },
    auth.token
  );

  return Array.isArray(data) ? data : [];
}

// ── Enriquecimento de unidades de medida ──

export interface EnrichUnidadesResult {
  enriched: number;
  skipped: number;
  errors: number;
}

async function loadProdutoComRetry(
  codigo: string,
  token: string
): Promise<{ data: any; usedToken: string }> {
  const MAX_RETRIES = 3;
  let currentToken = token;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const url = `${ERP_BASE_URL}/Produto/Load?codigo=${encodeURIComponent(codigo)}&loadChild=ProdUnidMedChildList`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Riosoft-Token": currentToken,
      },
    });

    if (resp.status !== 409 && resp.status !== 401) {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return { data, usedToken: currentToken };
    }

    if (attempt === MAX_RETRIES) {
      throw new Error("Conflito de sessão ERP persistente.");
    }

    clearAlvoToken();
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    const reAuth = await authenticateAlvo();
    if (!reAuth.success || !reAuth.token) {
      throw new Error("Falha na re-autenticação.");
    }
    currentToken = reAuth.token;
  }

  throw new Error("Falha inesperada no fluxo de retry");
}

export async function enriquecerUnidadesMedida(
  onProgress?: (current: number, total: number, message: string) => void
): Promise<EnrichUnidadesResult> {
  // 1. Buscar produtos ativos sem unidade_medida
  const { data: produtos, error } = await (supabase as any)
    .from("stock_products")
    .select("id, codigo_produto, nome_produto")
    .eq("ativo", true)
    .is("unidade_medida", null);

  if (error) throw new Error(`Erro ao buscar produtos: ${error.message}`);
  if (!produtos || produtos.length === 0) {
    return { enriched: 0, skipped: 0, errors: 0 };
  }

  onProgress?.(0, produtos.length, `${produtos.length} produtos para enriquecer. Autenticando...`);

  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    throw new Error(`Falha na autenticação: ${auth.error}`);
  }
  let currentToken = auth.token;

  const result: EnrichUnidadesResult = { enriched: 0, skipped: 0, errors: 0 };
  const DELAY_MS = 200;

  for (let i = 0; i < produtos.length; i++) {
    const p = produtos[i];
    try {
      onProgress?.(
        i + 1,
        produtos.length,
        `${i + 1}/${produtos.length}: ${p.codigo_produto} — ${p.nome_produto}...`
      );

      const { data: detail, usedToken } = await loadProdutoComRetry(
        p.codigo_produto,
        currentToken
      );
      currentToken = usedToken;

      // Extrair unidade principal: Posicao === 1, fallback primeiro do array
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

      const { error: updateErr } = await (supabase as any)
        .from("stock_products")
        .upsert(
          { id: p.id, unidade_medida: unidadeCodigo, updated_at: new Date().toISOString() },
          { onConflict: "id" }
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
