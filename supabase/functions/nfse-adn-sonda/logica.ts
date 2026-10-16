// =====================================================================
// nfse-adn-sonda — lógica (NFSE-0.3, PLANO-NFSE.md)
// Separada do Deno.serve (index.ts) para ser testada sem rede nem banco.
// =====================================================================

// Carimbo gravado em sync_runs.observacao: prova qual versão rodou.
export const VERSAO = "v1-2026-10-16";

/** Um documento como a rota /nfse-adn/dfe/:nsu do erp-proxy devolve. */
export type DocAdn = {
  nsu: number | null;
  chave: string | null;
  tipo_documento: string | null;
  tipo_evento: string | null;
  gerado_em: string | null;
  xml: string | null;
  campos_desconhecidos?: string[];
};

export type RespostaLote =
  | { ok: true; fim: boolean; status_http: number; status_processamento: string | null; documentos: DocAdn[] }
  | { ok: false; http: number; etapa: string; erro: string };

/** Linha gravada em nfse_adn_doc (o resto das colunas o gatilho extrai do XML). */
export type LinhaDoc = {
  nsu: number;
  chave_acesso: string | null;
  tipo_documento: string | null;
  tipo_evento: string | null;
  gerado_em: string | null;
  xml: string | null;
};

/** Traduz a resposta HTTP da rota /nfse-adn/dfe/:nsu (contrato em docs/nfse/erp-proxy/LEIA-ME.md). */
export function interpretarLote(http: number, corpo: any): RespostaLote {
  if (http === 200 && corpo?.ok === true && Array.isArray(corpo.documentos)) {
    return {
      ok: true,
      fim: corpo.fim === true,
      status_http: Number(corpo.status_http ?? 0),
      status_processamento: corpo.status_processamento ?? null,
      documentos: corpo.documentos,
    };
  }
  const etapa = typeof corpo?.etapa === "string"
    ? corpo.etapa
    : http === 0 ? "conexao_gateway" : http === 401 ? "auth_gateway" : http === 403 ? "rota_restrita" : "gateway";
  const detalhe = corpo?.error ?? corpo?.erros ?? corpo?.corpo_inicio ?? corpo?.status_processamento ?? null;
  const adn = corpo?.status_http ? ` (ADN ${corpo.status_http})` : "";
  const txt = detalhe === null ? "" : `: ${typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe)}`;
  return { ok: false, http, etapa, erro: `HTTP ${http}${adn}${txt}`.slice(0, 500) };
}

export type SituacaoData = "ok" | "sem_fuso" | "ilegivel" | "vazio";

const COM_FUSO = /(Z|[+-]\d{2}:?\d{2})$/i;
const SEM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Data/hora de geração no ADN → timestamptz.
 * Sem fuso: SUPÕE horário de Brasília (-03:00) e conta quantas vieram assim — a suposição
 * fica visível no sync_runs. Ilegível: grava null (não derruba o lote) e conta.
 */
export function normalizarGeradoEm(v: string | null): { valor: string | null; situacao: SituacaoData } {
  if (v === null || v.trim() === "") return { valor: null, situacao: "vazio" };
  const s = v.trim();
  if (COM_FUSO.test(s) && !Number.isNaN(Date.parse(s))) return { valor: s, situacao: "ok" };
  if (SEM_FUSO.test(s)) return { valor: `${s}-03:00`, situacao: "sem_fuso" };
  if (SO_DATA.test(s)) return { valor: `${s}T00:00:00-03:00`, situacao: "sem_fuso" };
  return { valor: null, situacao: "ilegivel" };
}

export type MotivoParada =
  | "fim_da_fila"          // ADN respondeu NENHUM_DOCUMENTO_LOCALIZADO
  | "sem_avanco"           // o lote só trouxe NSU <= o pedido (ADN que devolve "a partir de", no fim)
  | "max_lotes"
  | "prazo"
  | "limite_adn"           // 429
  | "erro_adn"             // rejeição, HTTP inesperado, gateway, conexão
  | "erro_gravacao"
  | "documento_sem_nsu"
  | "lote_vazio_sem_marca";

export const PARADAS_COM_ERRO: MotivoParada[] = [
  "limite_adn", "erro_adn", "erro_gravacao", "documento_sem_nsu", "lote_vazio_sem_marca",
];

export type ResultadoDrenagem = {
  nsu_inicial: number;
  nsu_final: number | null;
  lotes: number;
  documentos: number;
  por_tipo: Record<string, number>;
  sem_xml: number;
  gerado_em: Record<SituacaoData, number>;
  campos_desconhecidos: string[];
  parado_por: MotivoParada | null;
  erro: string | null;
  lotes_log: Array<{ nsu_pedido: number; docs: number; nsu_min: number | null; nsu_max: number | null; status: string }>;
};

export type Deps = {
  buscarLote: (nsu: number) => Promise<RespostaLote>;
  gravar: (linhas: LinhaDoc[]) => Promise<void>;
  agora: () => number;
  pausa: (ms: number) => Promise<void>;
};

export type OpcoesDrenagem = { nsuInicial: number; maxLotes: number; prazoMs: number; pausaMs: number; t0: number };

/**
 * Lê lotes do ADN a partir de nsuInicial e grava cada lote antes de pedir o próximo.
 * O próximo pedido usa o MAIOR NSU recebido (não +1): funciona se o ADN devolver "depois do NSU"
 * ou "a partir do NSU" — no segundo caso relê 1 documento por lote (upsert, sem efeito) e o fim
 * aparece como "sem_avanco". Para no primeiro erro, sem insistir.
 */
export async function drenar(deps: Deps, op: OpcoesDrenagem): Promise<ResultadoDrenagem> {
  const res: ResultadoDrenagem = {
    nsu_inicial: op.nsuInicial,
    nsu_final: null,
    lotes: 0,
    documentos: 0,
    por_tipo: {},
    sem_xml: 0,
    gerado_em: { ok: 0, sem_fuso: 0, ilegivel: 0, vazio: 0 },
    campos_desconhecidos: [],
    parado_por: null,
    erro: null,
    lotes_log: [],
  };
  const desconhecidos = new Set<string>();
  let cursor = op.nsuInicial;

  for (let i = 0; i < op.maxLotes; i++) {
    if (i > 0) await deps.pausa(op.pausaMs);
    // depois da pausa: nenhum lote começa fora do prazo
    if (deps.agora() - op.t0 > op.prazoMs) { res.parado_por = "prazo"; break; }

    const r = await deps.buscarLote(cursor);
    res.lotes++;

    if (!r.ok) {
      res.parado_por = r.http === 429 ? "limite_adn" : "erro_adn";
      res.erro = `${r.etapa}: ${r.erro}`;
      res.lotes_log.push({ nsu_pedido: cursor, docs: 0, nsu_min: null, nsu_max: null, status: `erro ${r.http}` });
      break;
    }
    if (r.fim) {
      res.parado_por = "fim_da_fila";
      res.lotes_log.push({ nsu_pedido: cursor, docs: 0, nsu_min: null, nsu_max: null, status: r.status_processamento ?? "fim" });
      break;
    }
    if (r.documentos.length === 0) {
      res.parado_por = "lote_vazio_sem_marca";
      res.erro = `ADN respondeu ${r.status_http} (${r.status_processamento ?? "sem status"}) sem documentos e sem NENHUM_DOCUMENTO_LOCALIZADO`;
      res.lotes_log.push({ nsu_pedido: cursor, docs: 0, nsu_min: null, nsu_max: null, status: "vazio sem marca" });
      break;
    }
    if (r.documentos.some((d) => d.nsu === null || !Number.isFinite(d.nsu))) {
      res.parado_por = "documento_sem_nsu";
      res.erro = `lote pedido em ${cursor} trouxe documento sem NSU legível — nada deste lote foi gravado`;
      res.lotes_log.push({ nsu_pedido: cursor, docs: r.documentos.length, nsu_min: null, nsu_max: null, status: "sem NSU" });
      break;
    }

    const linhas: LinhaDoc[] = r.documentos.map((d) => {
      const g = normalizarGeradoEm(d.gerado_em);
      res.gerado_em[g.situacao]++;
      if (d.xml === null) res.sem_xml++;
      const tipo = d.tipo_documento ?? "(sem tipo)";
      const chaveTipo = d.tipo_evento ? `${tipo}/${d.tipo_evento}` : tipo;
      res.por_tipo[chaveTipo] = (res.por_tipo[chaveTipo] ?? 0) + 1;
      for (const c of d.campos_desconhecidos ?? []) desconhecidos.add(c);
      return {
        nsu: d.nsu as number,
        chave_acesso: d.chave,
        tipo_documento: d.tipo_documento,
        tipo_evento: d.tipo_evento,
        gerado_em: g.valor,
        xml: d.xml,
      };
    });

    try {
      await deps.gravar(linhas);
    } catch (e) {
      res.parado_por = "erro_gravacao";
      res.erro = `gravar lote pedido em ${cursor}: ${(e as Error)?.message ?? String(e)}`.slice(0, 500);
      res.lotes_log.push({ nsu_pedido: cursor, docs: linhas.length, nsu_min: null, nsu_max: null, status: "erro ao gravar" });
      break;
    }

    const nsus = linhas.map((l) => l.nsu);
    const min = Math.min(...nsus);
    const max = Math.max(...nsus);
    res.documentos += linhas.length;
    res.nsu_final = res.nsu_final === null ? max : Math.max(res.nsu_final, max);
    res.lotes_log.push({ nsu_pedido: cursor, docs: linhas.length, nsu_min: min, nsu_max: max, status: "ok" });

    if (max <= cursor) { res.parado_por = "sem_avanco"; break; }
    cursor = max;
  }

  if (res.parado_por === null) res.parado_por = "max_lotes";
  res.campos_desconhecidos = [...desconhecidos].sort();
  return res;
}

/** O que o modo "teste" conclui sobre a semântica do NSU pedido × 1º NSU devolvido. */
export function lerSemantica(nsuPedido: number, primeiroNsu: unknown): string {
  if (typeof primeiroNsu !== "number" || !Number.isFinite(primeiroNsu)) return "indefinida (sem 1ª entrada com NSU)";
  if (primeiroNsu === nsuPedido) return "a partir do NSU pedido (>=)";
  if (primeiroNsu > nsuPedido) return "depois do NSU pedido (>)";
  return "anterior ao NSU pedido (inesperado)";
}
