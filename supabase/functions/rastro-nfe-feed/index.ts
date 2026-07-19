// supabase/functions/rastro-nfe-feed/index.ts
// Feed de leitura das NF-e de entrada (compras_nfe) para o projeto irmão Rastro P&F.
// O Rastro usa estas notas no "momento 1" do recebimento: conferir a mercadoria na
// doca contra a NF do fornecedor. O lote canônico NÃO sai daqui — o Rastro consulta
// o MovEstq do Alvo ao vivo (momento 2, via erp-proxy). Por isso o feed não envia lote.
//
// Somente leitura. O Rastro nunca escreve no Hub.
//
// Segurança: exige header "x-rastro-key" igual ao secret RASTRO_FEED_KEY. Sem a chave
// correta, 401. verify_jwt = false (a auth é a chave própria, não o JWT do Supabase).
//
// Contrato:
//   GET /functions/v1/rastro-nfe-feed?desde=<ISO8601>&limit=<n<=500>
//   -> { notas: [...], proximo_desde: "<ISO8601>", tem_mais: bool }
// Incremental por updated_at: o Rastro guarda proximo_desde e repete na próxima rodada.

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-rastro-key",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const LIMIT_PADRAO = 100;
const LIMIT_MAX = 500;
const DESDE_PADRAO = "1970-01-01T00:00:00Z";

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json({ erro: "Use GET" }, 405);
  }

  // ── Autenticação por chave compartilhada ──
  const chaveEsperada = Deno.env.get("RASTRO_FEED_KEY");
  if (!chaveEsperada) {
    console.error("rastro-nfe-feed: RASTRO_FEED_KEY não configurada");
    return json({ erro: "Servidor sem chave configurada" }, 500);
  }
  if (req.headers.get("x-rastro-key") !== chaveEsperada) {
    return json({ erro: "nao autorizado" }, 401);
  }

  // ── Parâmetros ──
  const url = new URL(req.url);

  const desdeParam = url.searchParams.get("desde");
  const desde = desdeParam ?? DESDE_PADRAO;
  if (desdeParam !== null && Number.isNaN(Date.parse(desdeParam))) {
    return json({ erro: "Parâmetro 'desde' inválido (esperado ISO8601)" }, 400);
  }

  const limitParam = url.searchParams.get("limit");
  let limit = LIMIT_PADRAO;
  if (limitParam !== null) {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1) {
      return json({ erro: "Parâmetro 'limit' inválido (inteiro >= 1)" }, 400);
    }
    limit = Math.min(n, LIMIT_MAX);
  }

  // ── Consulta ──
  // service_role fica confinada aqui dentro; nenhuma rota de escrita é exposta.
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Filtros explícitos: hoje as 418 linhas são todas NFe/55/normal, mas o filtro
  // protege quando entrarem NFS-e (modelo 55 ausente) ou notas canceladas.
  const { data, error } = await db
    .from("compras_nfe")
    .select(
      "chave_acesso, numero, serie, emitente_cnpj, emitente_nome, data_emissao, valor_total, status_lancamento, dados_extraidos, updated_at",
    )
    .eq("tipo_documento", "NFe")
    .eq("modelo", "55")
    .eq("situacao", "normal")
    .gt("updated_at", desde)
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("rastro-nfe-feed: erro na consulta:", error.message);
    return json({ erro: "consulta" }, 500);
  }

  const notas = (data ?? []).map((n: any) => {
    const de = typeof n.dados_extraidos === "string"
      ? seguroParse(n.dados_extraidos)
      : n.dados_extraidos;

    const itens = (Array.isArray(de?.itens) ? de.itens : []).map((it: any, i: number) => ({
      n_item: it?.numero_item ?? i + 1,
      cprod_fornecedor: it?.codigo_produto ?? null,
      descricao_fornecedor: it?.descricao ?? null,
      ncm: it?.ncm ?? null,
      un: it?.unidade ?? null,
      qtd: it?.quantidade ?? null,
    }));

    return {
      chave_acesso: n.chave_acesso,
      numero: n.numero,
      serie: n.serie,
      emitente: { cnpj: n.emitente_cnpj, nome: n.emitente_nome },
      data_emissao: n.data_emissao,
      valor_total: n.valor_total === null ? null : Number(n.valor_total),
      status_lancamento: n.status_lancamento ?? "pendente",
      atualizado_em: isoPreciso(n.updated_at),
      itens,
    };
  });

  const proximo = notas.length ? notas[notas.length - 1].atualizado_em : desde;

  return json({ notas, proximo_desde: proximo, tem_mais: notas.length === limit }, 200);
});

/**
 * PostgREST devolve timestamptz como "2026-07-15 17:44:10.336167+00" (espaço, microssegundos).
 * new Date().toISOString() truncaria para milissegundos — e o cursor truncado para BAIXO
 * faria a última nota reaparecer em toda chamada seguinte (o filtro é `>`). Por isso a
 * normalização é textual: preserva os microssegundos e só ajusta separador e offset.
 */
function isoPreciso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    return v.replace(" ", "T").replace(/([+-]00(:00)?)$/, "Z");
  }
  return String(v);
}

function seguroParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
