// supabase/functions/receber-nfe/index.ts
//
// Endpoint público para terceiros enviarem NF-e (XML em base64) via API.
// Fluxo: valida x-api-key → decodifica base64 → parseia XML → dedup por
// chave_acesso → insere em compras_nfe com origem='Alvo'.
//
// Deploy (manual, NÃO pelo Lovable — função pública sem JWT de usuário):
//   supabase functions deploy receber-nfe --no-verify-jwt --project-ref hbtggrbauguukewiknew
//
// Secret necessário (já criado):
//   NFE_API_KEY  → chave que o terceiro envia no header x-api-key

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Extração de um valor de tag simples: <tag>valor</tag> ────────────────
function pick(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m ? m[1].trim() : null;
}
function num(xml: string, tag: string): number | null {
  const v = pick(xml, tag);
  if (v === null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ── Extrai um bloco <bloco>...</bloco> (primeira ocorrência) ──────────────
function block(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

interface ParsedNfe {
  chave_acesso: string;
  numero: string | null;
  serie: string | null;
  modelo: string | null;
  natureza_operacao: string | null;
  data_emissao: string | null;
  emitente_cnpj: string | null;
  emitente_nome: string | null;
  valor_produtos: number | null;
  valor_frete: number | null;
  valor_seguro: number | null;
  valor_desconto: number | null;
  valor_outras_despesas: number | null;
  base_calculo_icms: number | null;
  valor_icms: number | null;
  base_icms_st: number | null;
  valor_icms_st: number | null;
  valor_ipi: number | null;
  valor_ii: number | null;
  valor_pis: number | null;
  valor_cofins: number | null;
  valor_fcp: number | null;
  valor_total: number | null;
  itens: any[];
}

function parseNfe(xml: string): ParsedNfe {
  // Chave: atributo Id de <infNFe Id="NFe3526...">  → tira "NFe", 44 díg
  const idMatch = xml.match(/<infNFe[^>]*\bId="([^"]+)"/);
  const idRaw = idMatch ? idMatch[1] : "";
  const chave = idRaw.replace(/^NFe/, "").trim();
  if (chave.length !== 44) {
    throw new Error(`Chave de acesso inválida (esperado 44 dígitos, veio "${chave}")`);
  }

  const ide = block(xml, "ide") || "";
  const emit = block(xml, "emit") || "";
  const tot = block(xml, "ICMSTot") || "";

  // Itens: cada <det ...>...</det> → dados básicos do produto
  const itens: any[] = [];
  const detRegex = /<det\s+nItem="(\d+)"[\s\S]*?<\/det>/g;
  let dm: RegExpExecArray | null;
  while ((dm = detRegex.exec(xml)) !== null) {
    const det = dm[0];
    const prod = block(det, "prod") || "";
    itens.push({
      numero_item: Number(dm[1]),
      codigo_produto: pick(prod, "cProd"),
      descricao: pick(prod, "xProd"),
      ncm: pick(prod, "NCM"),
      cfop: pick(prod, "CFOP"),
      unidade: pick(prod, "uCom"),
      quantidade: num(prod, "qCom"),
      valor_unitario: num(prod, "vUnCom"),
      valor_total: num(prod, "vProd"),
      pedido_xml: pick(prod, "xPed"), // <xPed> do item (pode vir "sujo")
      item_pedido_xml: pick(prod, "nItemPed"),
    });
  }

  return {
    chave_acesso: chave,
    numero: pick(ide, "nNF"),
    serie: pick(ide, "serie"),
    modelo: pick(ide, "mod"),
    natureza_operacao: pick(ide, "natOp"),
    data_emissao: pick(ide, "dhEmi"),
    emitente_cnpj: pick(emit, "CNPJ"),
    emitente_nome: pick(emit, "xNome"),
    valor_produtos: num(tot, "vProd"),
    valor_frete: num(tot, "vFrete"),
    valor_seguro: num(tot, "vSeg"),
    valor_desconto: num(tot, "vDesc"),
    valor_outras_despesas: num(tot, "vOutro"),
    base_calculo_icms: num(tot, "vBC"),
    valor_icms: num(tot, "vICMS"),
    base_icms_st: num(tot, "vBCST"),
    valor_icms_st: num(tot, "vST"),
    valor_ipi: num(tot, "vIPI"),
    valor_ii: num(tot, "vII"),
    valor_pis: num(tot, "vPIS"),
    valor_cofins: num(tot, "vCOFINS"),
    valor_fcp: num(tot, "vFCP"),
    valor_total: num(tot, "vNF"),
    itens,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ status: "error", message: "method not allowed" }, 405);

  // 1) Auth por API-key
  const apiKey = req.headers.get("x-api-key");
  const expected = Deno.env.get("NFE_API_KEY");
  if (!expected) return json({ status: "error", message: "server misconfigured" }, 500);
  if (!apiKey || apiKey !== expected) {
    return json({ status: "error", message: "invalid api key" }, 401);
  }

  // 2) Body
  let body: { xml_base64?: string; origem?: string };
  try {
    body = await req.json();
  } catch {
    return json({ status: "error", message: "invalid json body" }, 400);
  }
  if (!body.xml_base64) {
    return json({ status: "error", message: "missing xml_base64" }, 400);
  }

  // 3) Decodifica base64 → XML
  let xml: string;
  try {
    xml = new TextDecoder().decode(Uint8Array.from(atob(body.xml_base64), (c) => c.charCodeAt(0)));
  } catch {
    return json({ status: "error", message: "xml_base64 is not valid base64" }, 400);
  }

  // 4) Parseia
  let parsed: ParsedNfe;
  try {
    parsed = parseNfe(xml);
  } catch (e) {
    return json({ status: "error", message: `xml parse error: ${(e as Error).message}` }, 400);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 5) Dedup por chave_acesso → se existe, ignora
  const { data: existing } = await supabase
    .from("compras_nfe")
    .select("id")
    .eq("chave_acesso", parsed.chave_acesso)
    .maybeSingle();

  if (existing) {
    return json({ status: "ok", chave_acesso: parsed.chave_acesso, duplicada: true });
  }

  // 6) Insere
  const { itens, ...campos } = parsed;
  const { error } = await supabase.from("compras_nfe").insert({
    ...campos,
    tipo_documento: "NFe",
    origem: body.origem || "Alvo",
    raw_xml: xml,
    dados_extraidos: { itens },
  });

  if (error) {
    // corrida: se outra requisição inseriu a mesma chave no meio → trata como dup
    if (error.code === "23505") {
      return json({ status: "ok", chave_acesso: parsed.chave_acesso, duplicada: true });
    }
    return json({ status: "error", message: error.message }, 500);
  }

  return json({ status: "ok", chave_acesso: parsed.chave_acesso, duplicada: false });
});
