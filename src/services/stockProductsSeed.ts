import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

interface RawProduct {
  codigo_produto: string;
  codigo_reduzido: string | null;
  nome_produto: string;
  tipo_produto: string | null;
  ativo: boolean;
}

function extractFamilia(codigo: string): string | null {
  const parts = codigo.split(".");
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
  return null;
}

function extractVariacao(nome: string): string | null {
  const idx = nome.lastIndexOf(" - ");
  if (idx === -1) return null;
  const suffix = nome.substring(idx + 3).trim();
  if (suffix.length <= 30) return suffix;
  return null;
}

function cleanTipoProduto(tipo: string | null): string | null {
  if (!tipo) return null;
  return tipo.replace(/\n/g, "").replace(/\r/g, "").trim();
}

function parseWorkbook(workbook: XLSX.WorkBook): RawProduct[] {
  const sheetName = workbook.SheetNames[1] || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const header = rows[0] as string[];
  let colCodigo = -1, colEstruct = -1, colReduzido = -1, colNome = -1, colTipo = -1, colStatus = -1;

  for (let i = 0; i < header.length; i++) {
    const h = String(header[i]).trim().toLowerCase();
    if (h === "estruturado" && colCodigo === -1) colCodigo = i;
    if (h === "reduzido") colReduzido = i;
    if (h === "nome") colNome = i;
    if (h === "tipo do produto") colTipo = i;
    if (h === "status") colStatus = i;
  }

  const isPage2 = colReduzido !== -1;

  if (!isPage2) {
    colCodigo = 0;
    colReduzido = -1;
    for (let i = 0; i < header.length; i++) {
      const h = String(header[i]).trim().toLowerCase();
      if (h === "alternativo" && colReduzido === -1) colReduzido = i;
      if (h === "nome" && colNome === -1) colNome = i;
      if (h === "tipo do produto" && colTipo === -1) colTipo = i;
      if (h === "status" && colStatus === -1) colStatus = i;
    }
  }

  let colEstructLimpo = -1;
  for (let i = 0; i < header.length; i++) {
    if (String(header[i]).trim().toLowerCase() === "estruturado limpo") colEstructLimpo = i;
  }

  if (isPage2 && rows.length > 2) {
    for (let i = 1; i < Math.min(header.length, 5); i++) {
      const val = String(rows[2][i]).trim();
      if (val === "Sim" || val === "Não") { colEstruct = i; break; }
    }
  }

  const products: RawProduct[] = [];
  const seen = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length < 5) continue;

    const codigo = String(row[colCodigo] ?? "").trim();
    if (!codigo || !codigo.startsWith("001")) continue;

    let isStructured = false;
    if (colEstruct !== -1) isStructured = String(row[colEstruct]).trim() === "Sim";
    else if (colEstructLimpo !== -1) isStructured = String(row[colEstructLimpo]).trim() === "Sim";
    if (isStructured) continue;

    const status = String(row[colStatus] ?? "").trim();
    if (status !== "Ativado") continue;
    if (seen.has(codigo)) continue;
    seen.add(codigo);

    const alternativo = colReduzido !== -1 ? String(row[colReduzido] ?? "").trim() : null;
    const nome = String(row[colNome] ?? "").trim();
    const tipo = cleanTipoProduto(String(row[colTipo] ?? "").trim() || null);
    if (!nome) continue;

    products.push({
      codigo_produto: codigo,
      codigo_reduzido: alternativo && alternativo !== "" ? alternativo : null,
      nome_produto: nome,
      tipo_produto: tipo && tipo !== "" ? tipo : null,
      ativo: true,
    });
  }

  return products;
}

export async function seedStockProductsFromBuffer(buffer: ArrayBuffer): Promise<{
  success: boolean;
  total: number;
  inserted: number;
  skipped: number;
  error?: string;
}> {
  try {
    const workbook = XLSX.read(buffer, { type: "array" });
    const products = parseWorkbook(workbook);

    console.log(`Parsed ${products.length} active non-structured products`);

    if (products.length === 0) {
      return { success: false, total: 0, inserted: 0, skipped: 0, error: "Nenhum produto encontrado na planilha" };
    }

    let inserted = 0;
    let skipped = 0;
    const chunkSize = 50;

    for (let i = 0; i < products.length; i += chunkSize) {
      const chunk = products.slice(i, i + chunkSize);
      const payload = chunk.map((p) => ({
        codigo_produto: p.codigo_produto,
        codigo_reduzido: p.codigo_reduzido,
        nome_produto: p.nome_produto,
        tipo_produto: p.tipo_produto,
        familia_codigo: extractFamilia(p.codigo_produto),
        variacao: extractVariacao(p.nome_produto),
        unidade_medida: "UNID",
        ativo: true,
      }));

      const { error } = await supabase
        .from("stock_products")
        .upsert(payload, { onConflict: "codigo_produto", ignoreDuplicates: true });

      if (error) {
        console.error(`Error inserting chunk ${i}:`, error);
        skipped += chunk.length;
      } else {
        inserted += chunk.length;
      }
    }

    return { success: true, total: products.length, inserted, skipped };
  } catch (e: any) {
    console.error("Seed error:", e);
    return { success: false, total: 0, inserted: 0, skipped: 0, error: e.message };
  }
}
