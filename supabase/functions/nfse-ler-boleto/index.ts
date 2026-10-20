// =====================================================================
// nfse-ler-boleto — lê a linha digitável do boleto em PDF com o Claude e confere por regra (PLANO-NFSE, Fase B).
//
// SÓ LEITURA: não grava em tabela, pasta nem no Alvo. Devolve o que leu e a conferência de cada boleto.
//
// POST, corpo JSON — um dos dois:
//   { "anexo_id": "<uuid>" }   boleto já anexado na etapa 5 (lido da pasta nfse-boleto-pdf pela service role)
//   { "pdfBase64": "..." }     teste com outro PDF, sem salvar nada
// Acesso: usuário logado com compras.nfse.access (ou admin), pelo Authorization do app — ou x-cron-secret
// (= CRON_SECRET) para chamada pelo banco. Deploy: verify_jwt = false (o gate está aqui), no config.toml.
//
// A IA lê; boleto.ts decide: DV módulo 10/11 da linha, e banco/valor/vencimento tirados da própria linha
// comparados com o que está impresso. Só sai "perfeita" com o DV válido E o valor e o vencimento impressos
// iguais aos da linha (o DV geral sozinho não pega toda troca no valor ou no fator).
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Anthropic from "npm:@anthropic-ai/sdk";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { conferirLinhaDigitavel, soDigitos, type LinhaConferida } from "./boleto.ts";

export const VERSAO = "v1-2026-10-20";
const MODELO = "claude-opus-5-5";
const CNPJ_PF = "26602204000196"; // P&F Brasil, a pagadora esperada
const LIMITE_BYTES = 10 * 1024 * 1024; // o mesmo da pasta nfse-boleto-pdf

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SISTEMA = `Você lê boletos bancários brasileiros (ficha de compensação) em PDF e transcreve o que está impresso.

Regras:
- Transcreva exatamente; não calcule, não complete e não corrija nada.
- Um PDF pode ter vários boletos (um por parcela). O mesmo boleto costuma aparecer repetido no recibo do pagador, no comprovante de entrega e na ficha de compensação: devolva UM item por linha digitável distinta.
- A linha digitável fica no alto da ficha de compensação, ao lado do código do banco (ex.: "341-7"). Copie todos os dígitos, na ordem, sem pular nenhum, com os pontos e espaços como impressos.
- Se algum dígito da linha estiver ilegível, ponha linha_legivel = false e transcreva o resto sem chutar.
- Datas em AAAA-MM-DD. Valores como número com ponto decimal (1234.56). CNPJ só com dígitos.
- Campo que não aparece no boleto: null.`;

const INSTRUCAO = "Transcreva os boletos deste PDF seguindo as regras.";

const texto = { type: "string" };
const textoOuNulo = { anyOf: [{ type: "string" }, { type: "null" }] };
const numeroOuNulo = { anyOf: [{ type: "number" }, { type: "null" }] };
const CAMPOS = {
  linha_digitavel: texto,
  linha_legivel: { type: "boolean" },
  banco_impresso: textoOuNulo,
  beneficiario_nome: textoOuNulo,
  beneficiario_cnpj: textoOuNulo,
  pagador_cnpj: textoOuNulo,
  vencimento: textoOuNulo,
  valor_documento: numeroOuNulo,
  nosso_numero: textoOuNulo,
  numero_documento: textoOuNulo,
  pix_copia_e_cola: textoOuNulo,
};
const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["boletos"],
  properties: {
    boletos: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: Object.keys(CAMPOS), properties: CAMPOS },
    },
  },
};

interface BoletoLido {
  linha_digitavel: string;
  linha_legivel: boolean;
  banco_impresso: string | null;
  beneficiario_nome: string | null;
  beneficiario_cnpj: string | null;
  pagador_cnpj: string | null;
  vencimento: string | null;
  valor_documento: number | null;
  nosso_numero: string | null;
  numero_documento: string | null;
  pix_copia_e_cola: string | null;
}

type Beneficiario = "igual_prestador" | "mesma_raiz" | "diferente" | "sem_dado";

interface BoletoConferido {
  lido: BoletoLido;
  conferencia: LinhaConferida;
  confere: {
    /** Vencimento tirado da linha = o impresso. null quando um dos dois falta. */
    vencimento: boolean | null;
    valor: boolean | null;
    pagador_pf: boolean | null;
    beneficiario: Beneficiario;
  };
  /**
   * DV válido E valor impresso = valor da linha E (sem vencimento na linha OU vencimento impresso = o da linha).
   * O DV geral sozinho não basta: a regra Febraban leva os restos 0, 1 e 10 ao mesmo DV, e uma troca no valor
   * ou no fator pode passar por ele — a leitura independente do impresso fecha esse buraco.
   */
  perfeita: boolean;
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "content-type": "application/json" } });

/** Usuário logado com a permissão de Notas de Serviço, ou chamada do banco com o segredo. */
async function autorizado(req: Request): Promise<{ ok: true } | { ok: false; status: number; erro: string }> {
  const segredo = req.headers.get("x-cron-secret");
  if (segredo && CRON_SECRET && segredo === CRON_SECRET) return { ok: true };
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, status: 401, erro: "Não autorizado" };
  const cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: usuario } = await cliente.auth.getUser(token);
  if (!usuario?.user) return { ok: false, status: 401, erro: "Não autorizado" };
  const { data: pode, error } = await cliente.rpc("nfse_pode_acessar");
  if (error || pode !== true) return { ok: false, status: 403, erro: "Sem permissão de Notas de Serviço" };
  return { ok: true };
}

/** PDF do anexo de boleto (ativo) + CNPJ do prestador da nota, para conferir o beneficiário. */
async function pdfDoAnexo(anexoId: string) {
  const adm = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: anexo, error } = await adm
    .from("nfse_anexo")
    .select("id, chave_acesso, tipo, bucket_id, storage_path, removido_em")
    .eq("id", anexoId)
    .maybeSingle();
  if (error) throw new Error(`Anexo: ${error.message}`);
  if (!anexo || anexo.removido_em) throw new Error("Anexo não encontrado ou removido");
  if (anexo.tipo !== "boleto") throw new Error("O anexo não é um boleto");
  const { data: arquivo, error: errArq } = await adm.storage.from(anexo.bucket_id).download(anexo.storage_path);
  if (errArq || !arquivo) throw new Error(`Arquivo: ${errArq?.message ?? "não encontrado"}`);
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const { data: nota } = await adm
    .from("v_nfse_recebida")
    .select("prestador_doc")
    .eq("chave_acesso", anexo.chave_acesso)
    .maybeSingle();
  return { bytes, prestadorDoc: soDigitos(nota?.prestador_doc) || null };
}

function compararBeneficiario(cnpjLido: string | null, prestador: string | null): Beneficiario {
  const lido = soDigitos(cnpjLido);
  if (!lido || !prestador) return "sem_dado";
  if (lido === prestador) return "igual_prestador";
  if (lido.length === 14 && prestador.length === 14 && lido.slice(0, 8) === prestador.slice(0, 8)) return "mesma_raiz";
  return "diferente";
}

function conferir(lido: BoletoLido, prestador: string | null): BoletoConferido {
  const referencia = lido.vencimento && /^\d{4}-\d{2}-\d{2}$/.test(lido.vencimento) ? new Date(`${lido.vencimento}T12:00:00Z`) : new Date();
  const c = conferirLinhaDigitavel(lido.linha_digitavel, referencia);
  const vencimento = c.vencimento && lido.vencimento ? c.vencimento === lido.vencimento : null;
  const valor = c.valor != null && lido.valor_documento != null ? Math.abs(c.valor - lido.valor_documento) < 0.005 : null;
  const pagador = soDigitos(lido.pagador_cnpj);
  return {
    lido,
    conferencia: c,
    confere: {
      vencimento,
      valor,
      pagador_pf: pagador ? pagador === CNPJ_PF : null,
      beneficiario: compararBeneficiario(lido.beneficiario_cnpj, prestador),
    },
    perfeita: c.valida && lido.linha_legivel && valor === true && (c.vencimento === null || vencimento === true),
  };
}

Deno.serve(async (req) => {
  console.log(`[nfse-ler-boleto] build=edge nfse-ler-boleto ${VERSAO}`);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, erro: "Use POST" }, 405);

  const acesso = await autorizado(req);
  if (!acesso.ok) return json({ ok: false, erro: acesso.erro }, acesso.status);
  if (!ANTHROPIC_API_KEY) return json({ ok: false, erro: "ANTHROPIC_API_KEY não configurada" }, 500);

  const t0 = Date.now();
  try {
    const corpo = await req.json().catch(() => ({}));
    let pdf64: string;
    let prestadorDoc: string | null = null;
    if (typeof corpo?.anexo_id === "string") {
      const r = await pdfDoAnexo(corpo.anexo_id);
      if (r.bytes.length > LIMITE_BYTES) return json({ ok: false, erro: "O PDF passa de 10 MB" }, 413);
      pdf64 = encodeBase64(r.bytes);
      prestadorDoc = r.prestadorDoc;
    } else if (typeof corpo?.pdfBase64 === "string" && corpo.pdfBase64.length > 0) {
      pdf64 = corpo.pdfBase64.includes(",") ? corpo.pdfBase64.split(",")[1] : corpo.pdfBase64;
      if (pdf64.length * 0.75 > LIMITE_BYTES) return json({ ok: false, erro: "O PDF passa de 10 MB" }, 413);
    } else {
      return json({ ok: false, erro: "Mande anexo_id ou pdfBase64" }, 400);
    }

    const claude = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    // deno-lint-ignore no-explicit-any
    const resposta: any = await claude.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
      system: SISTEMA,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf64 } },
            { type: "text", text: INSTRUCAO },
          ],
        },
      ],
      // deno-lint-ignore no-explicit-any
    } as any);

    const uso = {
      modelo_solicitado: MODELO,
      modelo_usado: resposta.model ?? null,
      input_tokens: resposta.usage?.input_tokens ?? null,
      output_tokens: resposta.usage?.output_tokens ?? null,
      duracao_ms: Date.now() - t0,
    };
    if (resposta.stop_reason === "refusal") {
      return json({ ok: false, erro: "O modelo recusou a leitura", detalhe: resposta.stop_details ?? null, uso }, 422);
    }
    if (resposta.stop_reason === "max_tokens") return json({ ok: false, erro: "Resposta cortada (max_tokens)", uso }, 422);

    // deno-lint-ignore no-explicit-any
    const textoResposta = (resposta.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    let lidos: BoletoLido[];
    try {
      lidos = JSON.parse(textoResposta).boletos ?? [];
    } catch {
      return json({ ok: false, erro: "Resposta do modelo não é JSON", bruto: textoResposta.slice(0, 500), uso }, 422);
    }

    // O mesmo boleto repetido (recibo + ficha) conta uma vez.
    const vistos = new Set<string>();
    const boletos = lidos
      .filter((b) => {
        const k = soDigitos(b.linha_digitavel);
        if (!k || vistos.has(k)) return false;
        vistos.add(k);
        return true;
      })
      .map((b) => conferir(b, prestadorDoc));

    return json({
      ok: true,
      versao: VERSAO,
      boletos,
      todas_perfeitas: boletos.length > 0 && boletos.every((b) => b.perfeita),
      prestador_doc: prestadorDoc,
      uso,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[nfse-ler-boleto] erro: ${msg}`);
    return json({ ok: false, erro: msg, uso: { duracao_ms: Date.now() - t0 } }, 500);
  }
});
