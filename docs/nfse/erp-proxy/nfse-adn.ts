/**
 * Rotas da NFS-e Nacional — ADN (Ambiente de Dados Nacional), distribuição por NSU.
 * Fase 0 do PLANO-NFSE (finances-pf): sonda de cobertura. SÓ LEITURA — não grava nada.
 *
 *   GET /nfse-adn/teste?nsu=1&lote=1  → uma chamada ao ADN; devolve o HTTP, a ESTRUTURA do JSON
 *                                       (nomes e tipos, sem valores) e a 1ª entrada do lote sem
 *                                       o XML. Serve para confirmar o formato antes de drenar.
 *   GET /nfse-adn/dfe/:nsu            → um lote a partir do NSU, com o XML já descompactado.
 *                                       Fim da fila (NENHUM_DOCUMENTO_LOCALIZADO) = lista vazia;
 *                                       404 sem essa marca = erro (pode ser caminho errado).
 *
 * Certificado: o mesmo da rota /nfe (CERT_PFX_BASE64 + CERT_PFX_PASSWORD), e-CNPJ da matriz.
 * Auth: requireSupabaseAuth em index.ts + guarda abaixo — só chamada de SISTEMA (X-System-Secret).
 * JWT de usuário (Financial Hub ou Hub IA) recebe 403: são notas fiscais de terceiros.
 */

import { Router, Request, Response, NextFunction } from "express";
import https from "https";
import zlib from "zlib";

const router = Router();

const ADN_HOST = process.env.NFSE_ADN_HOST || "adn.nfse.gov.br";
const ADN_BASE = "/contribuintes";
const TIMEOUT_MS = 30_000;

// ── Só chamada de sistema ──
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.user?.source !== "system") {
    res.status(403).json({ ok: false, error: "Rota restrita a chamadas de sistema (X-System-Secret)." });
    return;
  }
  next();
});

// ── Certificado (base64 → Buffer) — mesma regra da rota /nfe ──
function carregarPfx(): Buffer {
  const b64 = process.env.CERT_PFX_BASE64;
  if (!b64) throw new Error("CERT_PFX_BASE64 não configurada.");
  const buf = Buffer.from(b64, "base64");
  if (!(buf[0] === 0x30 && buf[1] === 0x82)) throw new Error("CERT_PFX_BASE64 não é PKCS#12 válido.");
  return buf;
}

type RespostaAdn = { status: number; body: string; duracao_ms: number };

function getAdn(path: string, pfx: Buffer, senha: string): Promise<RespostaAdn> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const req = https.request(
      { host: ADN_HOST, path, method: "GET", pfx, passphrase: senha, headers: { Accept: "application/json" } },
      (res) => {
        let d = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: d, duracao_ms: Date.now() - t0 }));
      }
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`Timeout de ${TIMEOUT_MS / 1000}s no ADN.`)));
    req.on("error", reject);
    req.end();
  });
}

function caminhoDfe(nsu: number, lote: boolean): string {
  return `${ADN_BASE}/DFe/${nsu}${lote ? "?lote=true" : ""}`;
}

// XML vem gzip + base64; se não for gzip, tenta base64 puro; se nada der, devolve null.
function descompactar(b64: unknown): string | null {
  if (typeof b64 !== "string" || b64.length === 0) return null;
  const buf = Buffer.from(b64, "base64");
  try {
    return zlib.gunzipSync(buf).toString("utf-8");
  } catch {
    const txt = buf.toString("utf-8");
    return txt.trimStart().startsWith("<") ? txt : null;
  }
}

// O nome exato dos campos da resposta crua não está confirmado em documentação acessível:
// procura pelos nomes conhecidos, sem diferenciar maiúsculas.
function campo(obj: any, nomes: string[]): any {
  if (!obj || typeof obj !== "object") return undefined;
  const chaves = Object.keys(obj);
  for (const n of nomes) {
    const k = chaves.find((c) => c.toLowerCase() === n.toLowerCase());
    if (k !== undefined && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function listaDoLote(json: any): any[] {
  const l = campo(json, ["LoteDFe", "Lote", "Documentos", "DFe"]);
  if (Array.isArray(l)) return l;
  return l && typeof l === "object" ? [l] : [];
}

type Documento = {
  nsu: number | null;
  chave: string | null;
  tipo_documento: string | null;
  tipo_evento: string | null;
  gerado_em: string | null;
  xml: string | null;
  campos_desconhecidos: string[];
};

const CAMPOS_CONHECIDOS = [
  "NSU", "ChaveAcesso", "TipoDocumento", "TipoEvento", "DataHoraGeracao", "DataHoraRecebimento",
  "ArquivoXml", "ArquivoXML", "Arquivo", "XmlGZipB64", "DocumentoXml",
];

function normalizar(d: any): Documento {
  const nsu = Number(campo(d, ["NSU"]));
  const txt = (v: any) => (v === undefined || v === null ? null : String(v));
  return {
    nsu: Number.isFinite(nsu) ? nsu : null,
    chave: txt(campo(d, ["ChaveAcesso"])),
    tipo_documento: txt(campo(d, ["TipoDocumento"])),
    tipo_evento: txt(campo(d, ["TipoEvento"])),
    gerado_em: txt(campo(d, ["DataHoraGeracao", "DataHoraRecebimento"])),
    xml: descompactar(campo(d, ["ArquivoXml", "Arquivo", "XmlGZipB64", "DocumentoXml"])),
    campos_desconhecidos: d && typeof d === "object"
      ? Object.keys(d).filter((k) => !CAMPOS_CONHECIDOS.some((c) => c.toLowerCase() === k.toLowerCase()))
      : [],
  };
}

// Descreve a forma de um valor (chaves e tipos), sem expor conteúdo.
function estrutura(v: any, prof = 0): any {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length === 0 ? "array(0)" : [`array(${v.length})`, estrutura(v[0], prof + 1)];
  if (typeof v === "object") {
    if (prof > 4) return "object";
    const o: Record<string, any> = {};
    for (const k of Object.keys(v)) o[k] = estrutura(v[k], prof + 1);
    return o;
  }
  if (typeof v === "string") return `string(${v.length})`;
  return typeof v;
}

function lerNsu(v: unknown, padrao: number): number | null {
  if (v === undefined || v === "") return padrao;
  const s = String(v);
  if (!/^\d{1,15}$/.test(s)) return null;
  return parseInt(s, 10);
}

function credenciais(): { pfx: Buffer; senha: string } {
  const senha = process.env.CERT_PFX_PASSWORD;
  if (!senha) throw new Error("CERT_PFX_PASSWORD ausente.");
  return { pfx: carregarPfx(), senha };
}

// ═══ GET /nfse-adn/teste?nsu=1&lote=1 ═══
router.get("/teste", async (req: Request, res: Response) => {
  const nsu = lerNsu(req.query.nsu, 1);
  if (nsu === null) { res.status(400).json({ ok: false, error: "nsu inválido." }); return; }
  const lote = String(req.query.lote ?? "1") !== "0";

  let cred: { pfx: Buffer; senha: string };
  try { cred = credenciais(); } catch (e) { res.status(200).json({ ok: false, etapa: "certificado", error: (e as Error).message }); return; }

  const caminho = caminhoDfe(nsu, lote);
  let r: RespostaAdn;
  try {
    r = await getAdn(caminho, cred.pfx, cred.senha);
  } catch (e: any) {
    res.status(200).json({ ok: false, etapa: "conexao_adn", host: ADN_HOST, caminho, error: e?.message, code: e?.code });
    return;
  }

  let json: any = null;
  try { json = JSON.parse(r.body); } catch { /* corpo não é JSON */ }

  const lista = json ? listaDoLote(json) : [];
  const primeira = lista.length > 0 ? normalizar(lista[0]) : null;
  res.status(200).json({
    ok: true,
    host: ADN_HOST,
    caminho,
    http_status: r.status,
    duracao_ms: r.duracao_ms,
    content_type_json: json !== null,
    corpo_chars: r.body.length,
    // Só quando não é JSON: começo do corpo, para diagnóstico (página de erro, HTML do gateway etc.).
    corpo_inicio: json === null ? r.body.slice(0, 300) : undefined,
    estrutura: json !== null ? estrutura(json) : undefined,
    status_processamento: json ? campo(json, ["StatusProcessamento"]) ?? null : null,
    documentos_no_lote: lista.length,
    primeira_entrada: primeira
      ? { ...primeira, xml: undefined, xml_chars: primeira.xml?.length ?? null, xml_inicio: primeira.xml?.slice(0, 120) ?? null }
      : null,
  });
});

// ═══ GET /nfse-adn/dfe/:nsu ═══
router.get("/dfe/:nsu", async (req: Request, res: Response) => {
  const nsu = lerNsu(req.params.nsu, 0);
  if (nsu === null) { res.status(400).json({ ok: false, error: "nsu inválido." }); return; }

  let cred: { pfx: Buffer; senha: string };
  try { cred = credenciais(); } catch (e) { res.status(500).json({ ok: false, etapa: "certificado", error: (e as Error).message }); return; }

  let r: RespostaAdn;
  try {
    r = await getAdn(caminhoDfe(nsu, true), cred.pfx, cred.senha);
  } catch (e: any) {
    res.status(504).json({ ok: false, etapa: "conexao_adn", error: e?.message, code: e?.code });
    return;
  }

  let json: any = null;
  try { json = JSON.parse(r.body); } catch { /* corpo não é JSON */ }
  const statusProc = json ? (campo(json, ["StatusProcessamento"]) ?? null) : null;

  // Fim da fila: não é erro. Só com a marca explícita do ADN — um 404 sem ela pode ser caminho
  // errado, e lê-lo como "fila vazia" daria cobertura zero sem nenhum erro aparente.
  if (statusProc === "NENHUM_DOCUMENTO_LOCALIZADO") {
    res.status(200).json({ ok: true, fim: true, status_http: r.status, status_processamento: statusProc, documentos: [] });
    return;
  }
  if (r.status === 429) {
    res.status(429).json({ ok: false, etapa: "limite_adn", status_http: r.status, erros: json ? campo(json, ["Erros", "Erro"]) ?? null : null });
    return;
  }
  if (r.status !== 200 || json === null || statusProc === "REJEICAO") {
    res.status(502).json({
      ok: false,
      etapa: "resposta_adn",
      status_http: r.status,
      status_processamento: statusProc,
      erros: json ? campo(json, ["Erros", "Erro", "Alertas"]) ?? null : null,
      corpo_inicio: json === null ? r.body.slice(0, 300) || "(vazio)" : undefined,
    });
    return;
  }

  const documentos = listaDoLote(json).map(normalizar);
  res.status(200).json({
    ok: true,
    fim: false,
    status_http: r.status,
    status_processamento: statusProc,
    duracao_ms: r.duracao_ms,
    documentos,
  });
});

export default router;
