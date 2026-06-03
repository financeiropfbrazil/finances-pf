// supabase/functions/extrair-nfe/index.ts
//
// Marco 2.0 + 2.1 da Fase 2 — Extração de NF-e de produto a partir do PDF (DANFE).
// Recebe o PDF em base64, manda pro Claude Sonnet, devolve JSON estruturado +
// um bloco de conferência determinística (aritmética, destinatário, chave).
//
// NÃO toca em tabela, pasta ou dedup. É a peça isolada e testável:
//   POST { pdfBase64, arquivoNome? } -> { ok, extracao, conferencia, uso }
//
// Teste rápido (depois de deploy):
//   supabase functions invoke extrair-nfe --no-verify-jwt \
//     --data "{\"pdfBase64\":\"<BASE64_DO_PDF>\",\"arquivoNome\":\"zomus.pdf\"}"

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

const CNPJ_PF = "26602204000196"; // P&F Brasil — destinatário esperado

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ──────────────────────────────────────────────────────────────
// Prompt de extração — pede JSON puro, campos fixos, sem markdown.
// ──────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é um extrator de dados de DANFE (Documento Auxiliar da Nota Fiscal Eletrônica, NF-e modelo 55).
Leia o documento e devolva APENAS um objeto JSON válido, sem markdown, sem cercas de código, sem nenhum texto antes ou depois.

Regras:
- Valores numéricos: ponto decimal, sem separador de milhar, sem símbolo de moeda. Ex: 1234.56 (não "1.234,56").
- Datas: formato ISO yyyy-MM-dd.
- CNPJ/CPF: apenas dígitos, sem pontuação.
- Chave de acesso: 44 dígitos, sem espaços.
- Campo ausente no documento: use null (não invente, não estime).
- Não calcule nem "corrija" valores: transcreva exatamente o que está impresso.
- Itens: um objeto por linha da tabela de produtos/serviços.

Estrutura EXATA do JSON de saída:
{
  "tipo_documento": "NFE",
  "modelo": "55",
  "chave_acesso": "string 44 dígitos ou null",
  "numero": "string ou null",
  "serie": "string ou null",
  "data_emissao": "yyyy-MM-dd ou null",
  "natureza_operacao": "string ou null",
  "protocolo_autorizacao": "string ou null",
  "emitente": { "cnpj": "string ou null", "nome": "string ou null", "ie": "string ou null", "uf": "string ou null", "municipio": "string ou null" },
  "destinatario": { "cnpj": "string ou null", "nome": "string ou null" },
  "valores": {
    "valor_produtos": número ou null,
    "valor_frete": número ou null,
    "valor_seguro": número ou null,
    "valor_desconto": número ou null,
    "valor_outras_despesas": número ou null,
    "valor_ipi": número ou null,
    "base_calculo_icms": número ou null,
    "valor_icms": número ou null,
    "valor_icms_st": número ou null,
    "valor_total": número ou null
  },
  "itens": [
    {
      "numero_item": número,
      "codigo_produto": "string ou null",
      "descricao": "string ou null",
      "ncm": "string ou null",
      "cfop": "string ou null",
      "unidade": "string ou null",
      "quantidade": número ou null,
      "valor_unitario": número ou null,
      "valor_total": número ou null,
      "valor_icms": número ou null,
      "valor_ipi": número ou null
    }
  ],
  "pedido_compra_texto_livre": "string ou null (qualquer 'Ordem de Compra'/'Pedido'/'xPed' citado nas informações complementares; só transcreva, é dica fraca)",
  "info_complementares": "string ou null (texto das informações complementares/adicionais)"
}`;

const USER_INSTRUCTION =
  "Extraia os dados desta NF-e (DANFE) seguindo exatamente a estrutura e as regras. Responda só com o JSON.";

// ──────────────────────────────────────────────────────────────
// Helpers de conferência determinística (NÃO confiam no modelo)
// ──────────────────────────────────────────────────────────────
function arred(n: number): number {
  return Math.round(n * 100) / 100;
}

function soNumero(v: unknown): number {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", "."));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

// DV da chave de acesso NF-e: módulo 11 sobre os 43 primeiros dígitos.
function chaveDvValido(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  const base = chave.slice(0, 43);
  let peso = 2;
  let soma = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += parseInt(base[i], 10) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto === 0 || resto === 1 ? 0 : 11 - resto;
  return dv === parseInt(chave[43], 10);
}

function conferir(extracao: any) {
  const v = extracao?.valores ?? {};
  const prod = soNumero(v.valor_produtos);
  const frete = soNumero(v.valor_frete);
  const ipi = soNumero(v.valor_ipi);
  const odesp = soNumero(v.valor_outras_despesas);
  const seguro = soNumero(v.valor_seguro);
  const desc = soNumero(v.valor_desconto);
  const icmsSt = soNumero(v.valor_icms_st);
  const total = soNumero(v.valor_total);

  // Fórmula padrão NF-e: prod + frete + seguro + outras + IPI + ICMS-ST - desconto
  const calculado = arred(prod + frete + seguro + odesp + ipi + icmsSt - desc);
  const diff = arred(total - calculado);
  const aritmetica_ok = Math.abs(diff) <= 0.02; // tolerância de centavos

  const chave: string = extracao?.chave_acesso ?? "";
  const chave_valida = chaveDvValido(chave);

  const destCnpj = (extracao?.destinatario?.cnpj ?? "").replace(/\D/g, "");
  const destinatario_ok = destCnpj === CNPJ_PF;

  // Soma dos itens confere com valor_produtos?
  const somaItens = arred((extracao?.itens ?? []).reduce((s: number, it: any) => s + soNumero(it.valor_total), 0));
  const itens_conferem = Math.abs(arred(somaItens - prod)) <= 0.02;

  return {
    aritmetica_ok,
    aritmetica_diff: diff,
    aritmetica_calculado: calculado,
    aritmetica_total_nota: total,
    chave_valida,
    destinatario_ok,
    destinatario_cnpj_extraido: destCnpj || null,
    itens_conferem,
    soma_itens: somaItens,
    // Veredito agregado: alta confiança só se tudo bate.
    confianca: aritmetica_ok && chave_valida && destinatario_ok ? "alta" : "revisar",
  };
}

// ──────────────────────────────────────────────────────────────
function extrairJsonDoTexto(texto: string): any {
  // Remove cercas de markdown se o modelo escorregar, e pega o 1º objeto {...}.
  const limpo = texto
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    return JSON.parse(limpo);
  } catch {
    const ini = limpo.indexOf("{");
    const fim = limpo.lastIndexOf("}");
    if (ini >= 0 && fim > ini) {
      return JSON.parse(limpo.slice(ini, fim + 1));
    }
    throw new Error("Resposta do modelo não é JSON parseável");
  }
}

// ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, erro: "Use POST" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const pdfBase64: string | undefined = body.pdfBase64;
    const arquivoNome: string | undefined = body.arquivoNome;

    if (!pdfBase64) {
      return json({ ok: false, erro: "Campo pdfBase64 é obrigatório" }, 400);
    }
    if (!ANTHROPIC_API_KEY) {
      return json({ ok: false, erro: "ANTHROPIC_API_KEY_NF não configurada nos secrets" }, 500);
    }

    // Limpa prefixo data URL se vier (ex: "data:application/pdf;base64,....")
    const cleanB64 = pdfBase64.includes(",") ? pdfBase64.split(",")[1] : pdfBase64;

    const anthropicReq = {
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: cleanB64 },
            },
            { type: "text", text: USER_INSTRUCTION },
          ],
        },
      ],
    };

    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(anthropicReq),
    });

    if (!resp.ok) {
      const errTxt = await resp.text().catch(() => "");
      return json({ ok: false, erro: `Anthropic HTTP ${resp.status}`, detalhe: errTxt.slice(0, 500) }, 502);
    }

    const data = await resp.json();
    const texto = (data.content ?? [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");

    let extracao: any;
    try {
      extracao = extrairJsonDoTexto(texto);
    } catch (e) {
      return json({ ok: false, erro: "Falha ao parsear JSON do modelo", textoBruto: texto.slice(0, 800) }, 422);
    }

    if (arquivoNome) extracao.arquivo_nome = arquivoNome;

    const conferencia = conferir(extracao);

    return json({
      ok: true,
      extracao,
      conferencia,
      uso: {
        modelo_solicitado: MODEL,
        modelo_usado: data.model ?? null,
        input_tokens: data.usage?.input_tokens ?? null,
        output_tokens: data.usage?.output_tokens ?? null,
      },
    });
  } catch (e) {
    return json({ ok: false, erro: String(e?.message ?? e) }, 500);
  }
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
