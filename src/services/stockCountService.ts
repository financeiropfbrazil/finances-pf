import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

export interface CountPreviewItem {
  codigo: string;
  quantidade: number;
  valorTotal: number | null;
  productId: string | null;
  nomeProduto: string | null;
  found: boolean;
}

export interface StockCount {
  id: string;
  descricao: string;
  data_referencia: string;
  tipo_chave: string;
  status: string;
  total_itens: number;
  itens_divergentes: number;
  itens_aprovados: number;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockCountItem {
  id: string;
  count_id: string;
  product_id: string;
  codigo_enviado: string;
  quantidade_sistema: number;
  quantidade_contagem: number;
  diferenca: number;
  valor_total_contagem: number | null;
  status: string;
  aprovado_por: string | null;
  aprovado_em: string | null;
  created_at: string;
  // joined
  nome_produto?: string;
  tipo_produto?: string | null;
  codigo_produto?: string;
  codigo_alternativo?: string | null;
  codigo_reduzido?: string | null;
}

// ── Excel parsing ──

/** Read all columns from an Excel file, returning headers and rows */
export function readExcelColumns(buffer: ArrayBuffer): { headers: string[]; rows: any[][] } {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (allRows.length === 0) return { headers: [], rows: [] };

  // First row as headers
  const headers = allRows[0].map((h: any) => String(h ?? "").trim());
  const rows = allRows.slice(1);
  return { headers, rows };
}

/** Extract items from parsed rows using column indices */
export function extractItemsFromRows(
  rows: any[][],
  codeColIdx: number,
  qtyColIdx: number,
  valueColIdx: number | null
): { codigo: string; quantidade: number; valorTotal: number | null }[] {
  const items: { codigo: string; quantidade: number; valorTotal: number | null }[] = [];
  for (const row of rows) {
    const codigo = String(row[codeColIdx] ?? "").trim();
    if (!codigo) continue;
    const quantidade = Number(row[qtyColIdx]) || 0;
    const valorTotal = valueColIdx !== null ? (Number(row[valueColIdx]) || null) : null;
    items.push({ codigo, quantidade, valorTotal });
  }
  return items;
}

/** Detect which columns are numeric (for qty/value mapping) */
export function detectNumericColumns(headers: string[], rows: any[][]): number[] {
  const numeric: number[] = [];
  for (let col = 0; col < headers.length; col++) {
    let numericCount = 0;
    const sampleSize = Math.min(rows.length, 20);
    for (let r = 0; r < sampleSize; r++) {
      const val = rows[r]?.[col];
      if (val !== "" && val !== null && val !== undefined && !isNaN(Number(val))) {
        numericCount++;
      }
    }
    if (numericCount > sampleSize * 0.5) numeric.push(col);
  }
  return numeric;
}

// ── Product matching ──

function normalizeCode(value: unknown): string {
  if (value === null || value === undefined) return "";

  const normalized = String(value)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");

  if (!normalized) return "";

  const withoutSeparators = normalized.replace(/[._\-/]/g, "");

  // Normaliza casos comuns vindos do Excel (ex: 82110053.0)
  if (/^\d+[\.,]0+$/.test(withoutSeparators)) {
    return withoutSeparators.replace(/[\.,]0+$/, "");
  }

  return withoutSeparators;
}

function buildProductKeyMap(
  products: Array<{ id: string; nome_produto: string; codigo_produto: string | null; codigo_reduzido: string | null; codigo_alternativo: string | null }>,
  keyType: "codigo_produto" | "codigo_reduzido" | "codigo_alternativo"
) {
  const map = new Map<string, { id: string; nome: string }>();

  for (const p of products) {
    const rawKey =
      keyType === "codigo_produto"
        ? p.codigo_produto
        : keyType === "codigo_reduzido"
          ? p.codigo_reduzido
          : p.codigo_alternativo;

    const key = normalizeCode(rawKey);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, { id: p.id, nome: p.nome_produto });
    }
  }

  return map;
}

function matchWithMap(
  items: { codigo: string; quantidade: number; valorTotal: number | null }[],
  keyMap: Map<string, { id: string; nome: string }>
): CountPreviewItem[] {
  return items.map((item) => {
    const match = keyMap.get(normalizeCode(item.codigo));
    return {
      codigo: item.codigo,
      quantidade: item.quantidade,
      valorTotal: item.valorTotal,
      productId: match?.id ?? null,
      nomeProduto: match?.nome ?? null,
      found: !!match,
    };
  });
}

export async function matchItemsToProducts(
  items: { codigo: string; quantidade: number; valorTotal: number | null }[],
  tipoChave: "codigo_produto" | "codigo_reduzido" | "codigo_alternativo"
): Promise<CountPreviewItem[]> {
  let allProducts: any[] = [];
  let from = 0;
  const batchSize = 1000;
  let done = false;

  while (!done) {
    const { data, error } = await supabase
      .from("stock_products")
      .select("id, codigo_produto, codigo_reduzido, codigo_alternativo, nome_produto")
      .eq("ativo", true)
      .range(from, from + batchSize - 1);

    if (error) {
      throw new Error(`Erro ao carregar catálogo de produtos: ${error.message}`);
    }

    if (data && data.length > 0) {
      allProducts = allProducts.concat(data);
      from += batchSize;
      if (data.length < batchSize) done = true;
    } else {
      done = true;
    }
  }

  const keyMaps = {
    codigo_produto: buildProductKeyMap(allProducts, "codigo_produto"),
    codigo_reduzido: buildProductKeyMap(allProducts, "codigo_reduzido"),
    codigo_alternativo: buildProductKeyMap(allProducts, "codigo_alternativo"),
  } as const;

  let matched = matchWithMap(items, keyMaps[tipoChave]);
  let foundCount = matched.filter((m) => m.found).length;

  // Fallback automático: se o tipo escolhido não encontrou nenhum, usa o melhor mapa disponível
  if (items.length > 0 && foundCount === 0) {
    const candidates: Array<"codigo_produto" | "codigo_reduzido" | "codigo_alternativo"> = [
      "codigo_alternativo",
      "codigo_produto",
      "codigo_reduzido",
    ];

    for (const candidate of candidates) {
      const candidateMatch = matchWithMap(items, keyMaps[candidate]);
      const candidateFound = candidateMatch.filter((m) => m.found).length;
      if (candidateFound > foundCount) {
        matched = candidateMatch;
        foundCount = candidateFound;
      }
    }
  }

  return matched;
}

// ── System balances ──

export async function getSystemBalances(
  productIds: string[],
  dataReferencia: string
): Promise<Map<string, { quantidade: number; valorMedioUnitario: number | null; valorTotal: number | null }>> {
  const map = new Map<string, { quantidade: number; valorMedioUnitario: number | null; valorTotal: number | null }>();
  const batchSize = 500;
  for (let i = 0; i < productIds.length; i += batchSize) {
    const batch = productIds.slice(i, i + batchSize);
    const { data } = await supabase
      .from("stock_balance")
      .select("product_id, quantidade, valor_medio_unitario, valor_total_brl")
      .in("product_id", batch)
      .eq("data_referencia", dataReferencia);
    if (data) {
      for (const row of data) {
        map.set(row.product_id, {
          quantidade: Number(row.quantidade),
          valorMedioUnitario: row.valor_medio_unitario != null ? Number(row.valor_medio_unitario) : null,
          valorTotal: row.valor_total_brl != null ? Number(row.valor_total_brl) : null,
        });
      }
    }
  }
  return map;
}

// ── Create stock count ──

export async function createStockCount(params: {
  descricao: string;
  dataReferencia: string;
  tipoChave: "codigo_produto" | "codigo_reduzido" | "codigo_alternativo";
  uploadedBy: string | null;
  items: CountPreviewItem[];
  systemBalances: Map<string, { quantidade: number; valorMedioUnitario: number | null; valorTotal: number | null }>;
}) {
  const matchedItems = params.items.filter((i) => i.found && i.productId);

  const divergentes = matchedItems.filter((item) => {
    const sys = params.systemBalances.get(item.productId!);
    const sysQty = sys?.quantidade ?? 0;
    return item.quantidade !== sysQty;
  }).length;

  const { data: countData, error: countError } = await supabase
    .from("stock_counts")
    .insert({
      descricao: params.descricao,
      data_referencia: params.dataReferencia,
      tipo_chave: params.tipoChave,
      total_itens: matchedItems.length,
      itens_divergentes: divergentes,
      itens_aprovados: 0,
      uploaded_by: params.uploadedBy,
    })
    .select("id")
    .single();

  if (countError || !countData) throw new Error(countError?.message ?? "Erro ao criar contagem");

  const countItems = matchedItems.map((item) => {
    const sys = params.systemBalances.get(item.productId!);
    const sysQty = sys?.quantidade ?? 0;
    return {
      count_id: countData.id,
      product_id: item.productId!,
      codigo_enviado: item.codigo,
      quantidade_sistema: sysQty,
      quantidade_contagem: item.quantidade,
      diferenca: item.quantidade - sysQty,
      valor_total_contagem: item.valorTotal,
    };
  });

  const BATCH = 500;
  for (let i = 0; i < countItems.length; i += BATCH) {
    const batch = countItems.slice(i, i + BATCH);
    const { error } = await supabase.from("stock_count_items").insert(batch);
    if (error) throw new Error(`Erro ao salvar itens: ${error.message}`);
  }

  return countData.id;
}

// ── Fetch counts ──

export async function fetchStockCounts(): Promise<StockCount[]> {
  const { data, error } = await supabase
    .from("stock_counts")
    .select("*")
    .order("data_referencia", { ascending: false });
  if (error) throw error;
  return (data ?? []) as StockCount[];
}

// ── Fetch count items ──

export async function fetchCountItems(countId: string): Promise<StockCountItem[]> {
  let all: any[] = [];
  let from = 0;
  const batchSize = 1000;
  let done = false;
  while (!done) {
    const { data, error } = await supabase
      .from("stock_count_items")
      .select("*, stock_products(nome_produto, tipo_produto, codigo_produto, codigo_reduzido, codigo_alternativo)")
      .eq("count_id", countId)
      .order("codigo_enviado")
      .range(from, from + batchSize - 1);
    if (error) throw error;
    if (data && data.length > 0) {
      all = all.concat(data);
      from += batchSize;
      if (data.length < batchSize) done = true;
    } else {
      done = true;
    }
  }
  return all.map((row: any) => ({
    ...row,
    nome_produto: row.stock_products?.nome_produto ?? "",
    tipo_produto: row.stock_products?.tipo_produto ?? null,
    codigo_produto: row.stock_products?.codigo_produto ?? "",
    codigo_reduzido: row.stock_products?.codigo_reduzido ?? null,
    codigo_alternativo: row.stock_products?.codigo_alternativo ?? null,
    stock_products: undefined,
  }));
}

// ── Approve items ──

export async function approveItems(params: {
  countId: string;
  itemIds: string[];
  dataReferencia: string;
  userEmail: string;
}) {
  const { data: items, error } = await supabase
    .from("stock_count_items")
    .select("*")
    .in("id", params.itemIds)
    .eq("status", "pendente");
  if (error) throw error;
  if (!items || items.length === 0) return 0;

  const productIds = items.map((i: any) => i.product_id);
  const balanceMap = await getSystemBalances(productIds, params.dataReferencia);

  for (const item of items) {
    const currentBalance = balanceMap.get(item.product_id);
    const qtdAnterior = currentBalance?.quantidade ?? 0;
    const valorAnterior = currentBalance?.valorTotal ?? null;
    const valorMedio = currentBalance?.valorMedioUnitario ?? null;

    // Use valor_total_contagem if provided, otherwise recalc from unit cost
    const valorNovo = item.valor_total_contagem != null
      ? item.valor_total_contagem
      : (valorMedio != null ? valorMedio * item.quantidade_contagem : null);

    await supabase.from("stock_adjustments").insert({
      count_item_id: item.id,
      product_id: item.product_id,
      data_referencia: params.dataReferencia,
      quantidade_anterior: qtdAnterior,
      quantidade_nova: item.quantidade_contagem,
      valor_total_anterior: valorAnterior,
      valor_total_novo: valorNovo,
      ajustado_por: params.userEmail,
    });

    await supabase
      .from("stock_balance")
      .update({
        quantidade: item.quantidade_contagem,
        valor_total_brl: valorNovo,
        fonte: "contagem",
      })
      .eq("product_id", item.product_id)
      .eq("data_referencia", params.dataReferencia);

    await supabase
      .from("stock_count_items")
      .update({
        status: "aprovado",
        aprovado_por: params.userEmail,
        aprovado_em: new Date().toISOString(),
      })
      .eq("id", item.id);
  }

  // Update count counters
  const { data: allItems } = await supabase
    .from("stock_count_items")
    .select("status, diferenca")
    .eq("count_id", params.countId);

  if (allItems) {
    const aprovados = allItems.filter((i: any) => i.status === "aprovado").length;
    const pendentes = allItems.filter((i: any) => i.status === "pendente").length;
    const divergentes = allItems.filter((i: any) => i.diferenca !== 0).length;
    const newStatus = pendentes === 0 ? "concluida" : aprovados > 0 ? "parcial" : "pendente";

    await supabase
      .from("stock_counts")
      .update({
        itens_aprovados: aprovados,
        itens_divergentes: divergentes,
        status: newStatus,
      })
      .eq("id", params.countId);
  }

  return items.length;
}

// ── Reject / Revert ──

export async function rejectItems(countId: string, itemIds: string[]) {
  await supabase
    .from("stock_count_items")
    .update({ status: "rejeitado" })
    .in("id", itemIds);

  const { data: allItems } = await supabase
    .from("stock_count_items")
    .select("status, diferenca")
    .eq("count_id", countId);

  if (allItems) {
    const aprovados = allItems.filter((i: any) => i.status === "aprovado").length;
    const pendentes = allItems.filter((i: any) => i.status === "pendente").length;
    const newStatus = pendentes === 0 ? "concluida" : aprovados > 0 ? "parcial" : "pendente";

    await supabase
      .from("stock_counts")
      .update({ itens_aprovados: aprovados, status: newStatus })
      .eq("id", countId);
  }
}

export async function revertToPending(countId: string, itemIds: string[]) {
  await supabase
    .from("stock_count_items")
    .update({ status: "pendente", aprovado_por: null, aprovado_em: null })
    .in("id", itemIds);

  const { data: allItems } = await supabase
    .from("stock_count_items")
    .select("status")
    .eq("count_id", countId);

  if (allItems) {
    const aprovados = allItems.filter((i: any) => i.status === "aprovado").length;
    const pendentes = allItems.filter((i: any) => i.status === "pendente").length;
    const newStatus = pendentes === allItems.length ? "pendente" : aprovados > 0 || pendentes < allItems.length ? "parcial" : "pendente";

    await supabase
      .from("stock_counts")
      .update({ itens_aprovados: aprovados, status: newStatus })
      .eq("id", countId);
  }
}

// ── Delete ──

export async function deleteStockCount(countId: string) {
  const { error } = await supabase
    .from("stock_counts")
    .delete()
    .eq("id", countId);
  if (error) throw error;
}

// ── Available dates ──

export async function fetchAvailableDates(): Promise<string[]> {
  // Fetch all distinct data_referencia values by paginating to avoid the 1000-row limit
  const allDates: string[] = [];
  const PAGE_SIZE = 1000;
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("stock_balance")
      .select("data_referencia")
      .order("data_referencia", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      for (const row of data) {
        allDates.push(row.data_referencia);
      }
      hasMore = data.length === PAGE_SIZE;
      from += PAGE_SIZE;
    }
  }

  const unique = [...new Set(allDates)].sort((a, b) => b.localeCompare(a));
  return unique;
}

// ── Month closed check ──

export async function isMonthClosed(dataReferencia: string): Promise<boolean> {
  const date = new Date(dataReferencia + "T00:00:00");
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const periodo = `${year}-${String(month).padStart(2, "0")}`;

  const { data } = await supabase
    .from("stock_balance")
    .select("status")
    .eq("periodo", periodo)
    .eq("status", "closed")
    .limit(1);

  return (data ?? []).length > 0;
}

// ── Export ──

export function exportCountToExcel(
  items: StockCountItem[],
  descricao: string,
  dataReferencia: string
) {
  const hasValue = items.some(i => i.valor_total_contagem != null);

  const allRows = items.map((i) => {
    const row: Record<string, any> = {
      "Código": i.codigo_produto ?? i.codigo_enviado,
      "Cód. Externo": i.codigo_alternativo ?? "",
      "Descrição": i.nome_produto ?? "",
      "Tipo": i.tipo_produto ?? "",
      "Qtde Sistema": i.quantidade_sistema,
      "Qtde Contagem": i.quantidade_contagem,
      "Diferença": i.diferenca,
      "Diferença %": i.quantidade_sistema !== 0
        ? Number(((i.diferenca / i.quantidade_sistema) * 100).toFixed(2))
        : i.diferenca !== 0 ? 100 : 0,
    };
    if (hasValue) {
      row["Valor Contagem"] = i.valor_total_contagem ?? "";
    }
    row["Status"] = i.status === "aprovado" ? "Aprovado" : i.status === "rejeitado" ? "Rejeitado" : "Pendente";
    return row;
  });

  const divergentRows = allRows.filter((r) => r["Diferença"] !== 0);

  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(allRows);
  XLSX.utils.book_append_sheet(wb, ws1, "Comparativo");
  const ws2 = XLSX.utils.json_to_sheet(divergentRows);
  XLSX.utils.book_append_sheet(wb, ws2, "Apenas Divergentes");

  const safeName = descricao.replace(/[^a-zA-Z0-9À-ÿ\s-]/g, "").substring(0, 40);
  XLSX.writeFile(wb, `Contagem_${safeName}_${dataReferencia}.xlsx`);
}
