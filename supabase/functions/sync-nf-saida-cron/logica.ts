// =====================================================================
// sync-nf-saida-cron — lógica (sem rede, sem Supabase: tudo injetado)
// PLANO-VENDAS.md §12 (Ajuste A) e §13. Testes: logica.test.ts
// =====================================================================

export const FILIAL = "1.01";
export const MODELOS = ["NF-e", "NFS-e"] as const;
export type Modelo = (typeof MODELOS)[number];

// ── Dependências ──────────────────────────────────────────────────────
export interface RespostaProxy {
  ok: boolean;
  status: number;
  data: any;
  erro?: string;
}
export type Passthrough = (endpoint: string, method: "GET" | "POST", payload?: unknown) => Promise<RespostaProxy>;

export interface ResumoLista {
  linhas: number;
  novas: number;
  mudaram: number;
  iguais: number;
  reconferir: number;
}
export interface ItemFila {
  id: string;
  modelo: string;
  serie: string;
  numero_alvo: string;
}
export interface Banco {
  registrarLista(linhas: unknown[]): Promise<ResumoLista>;
  filaDetalhe(limite: number): Promise<ItemFila[]>;
  idDaNota(filial: string, modelo: string, serie: string, numeroAlvo: string): Promise<string | null>;
  gravarDetalhe(id: string, payload: unknown | null): Promise<{ resultado: string; versao: number }>;
  registrarFalha(id: string, erro: string): Promise<{ tentativas: number; detalhe_status: string }>;
}
export interface Deps {
  proxy: Passthrough;
  banco: Banco;
  agora: () => number; // ms; injetável para testar o watchdog
}

// ── Opções e resultado ────────────────────────────────────────────────
export interface Opcoes {
  modelos: Modelo[];
  desde: string; // 'YYYY-MM-DD': a lista para na 1ª página com emissão anterior
  pageSize: number; // 1..300 (teto do GetListForComponents)
  maxPaginas: number;
  maxDetalhes: number;
  concorrencia: number;
  inicio: number; // ms do início da execução
  watchdogMs: number;
}

export interface Resultado {
  paginas: number;
  linhas_lidas: number;
  novas: number;
  mudaram: number;
  iguais: number;
  reconferir: number;
  lista_incompleta: string[]; // modelos cuja lista não chegou até a data de corte
  detalhes_tentados: number;
  nova_versao: number;
  sem_mudanca: number;
  ausentes: number;
  falhas: number;
  erros: number;
  parado_por_watchdog: boolean;
  notas: Array<Record<string, unknown>>; // modo "notas": o que aconteceu com cada uma
  detalhes: Array<Record<string, unknown>>; // amostra de erros para sync_runs.detalhes
}

export function novoResultado(): Resultado {
  return {
    paginas: 0,
    linhas_lidas: 0,
    novas: 0,
    mudaram: 0,
    iguais: 0,
    reconferir: 0,
    lista_incompleta: [],
    detalhes_tentados: 0,
    nova_versao: 0,
    sem_mudanca: 0,
    ausentes: 0,
    falhas: 0,
    erros: 0,
    parado_por_watchdog: false,
    notas: [],
    detalhes: [],
  };
}

function anotarErro(res: Resultado, etapa: string, erro: string, extra: Record<string, unknown> = {}) {
  res.erros++;
  if (res.detalhes.length < 50) res.detalhes.push({ etapa, erro: erro.slice(0, 500), ...extra });
}

// ── Endpoints do Alvo (grafia provada no Lab em 05/11/2026) ───────────
export function envelopeLista(modelo: Modelo, pageIndex: number, pageSize: number) {
  return {
    BindingName: "",
    ClassInput: "NotaFiscal",
    ClassVinculo: "notaFiscal",
    ControllerForm: "notaFiscal",
    DisabledCache: false,
    Filter: `( CodigoEmpresaFilial == '${FILIAL}' && ModeloCtrlDf == '${modelo}' )`,
    FormName: "notaFiscal",
    Input: "gridTableNotaFiscal",
    IsGroupBy: false,
    Order: "Numero DESC",
    OrderUser: "",
    PageIndex: pageIndex,
    PageSize: pageSize,
    Shortcut: "notafiscal",
    StatusColumns: [],
    Type: "GridTable",
    TypeObject: "tabForm",
  };
}

export function endpointLoad(modelo: string, serie: string, numeroAlvo: string): string {
  return (
    `notaFiscal/Load?modeloCtrlDf=${encodeURIComponent(modelo)}` +
    `&serieCtrlDf=${encodeURIComponent(serie)}` +
    `&numero=${encodeURIComponent(numeroAlvo)}` +
    `&loadParent=All&loadChild=All&loadOneToOne=All`
  );
}

// 'YYYY-MM-DD' da data como o Alvo escreveu; null se ausente/vazia.
export function dataEmissao(linha: any): string | null {
  const v = linha?.DataEmissao;
  if (typeof v !== "string" || v.length < 10) return null;
  const d = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= "1901-01-01" ? d : null;
}

export function numeroAlvo(n: string | number): string {
  const s = String(n).trim();
  return /^\d+$/.test(s) ? s.padStart(10, "0") : s;
}

const estourou = (deps: Deps, op: Opcoes) => deps.agora() - op.inicio > op.watchdogMs;

// ── Passo 1: LISTA ────────────────────────────────────────────────────
// Página por página (Numero DESC) até a 1ª página com emissão anterior a
// `desde`. Página com linha de outra filial/modelo é recusada inteira.
export async function passoLista(deps: Deps, op: Opcoes, res: Resultado): Promise<void> {
  for (const modelo of op.modelos) {
    let chegouNoCorte = false;
    for (let pagina = 1; pagina <= op.maxPaginas; pagina++) {
      if (estourou(deps, op)) {
        res.parado_por_watchdog = true;
        break;
      }
      const r = await deps.proxy("notaFiscal/GetListForComponents", "POST", envelopeLista(modelo, pagina, op.pageSize));
      if (!r.ok) {
        anotarErro(res, "lista", r.erro ?? `HTTP ${r.status}`, { modelo, pagina });
        break;
      }
      if (!Array.isArray(r.data)) {
        anotarErro(res, "lista", `resposta não é array: ${JSON.stringify(r.data)?.slice(0, 200)}`, { modelo, pagina });
        break;
      }
      const linhas = r.data as any[];
      res.paginas++;
      if (linhas.length === 0) {
        chegouNoCorte = true;
        break;
      }
      const fora = linhas.filter((l) => l?.CodigoEmpresaFilial !== FILIAL || l?.ModeloCtrlDf !== modelo);
      if (fora.length > 0) {
        anotarErro(res, "lista", `${fora.length} linha(s) fora da filial/modelo — página recusada`, {
          modelo,
          pagina,
          amostra: fora.slice(0, 3).map((l) => [l?.CodigoEmpresaFilial, l?.ModeloCtrlDf, l?.Numero]),
        });
        break;
      }
      try {
        const s = await deps.banco.registrarLista(linhas);
        res.linhas_lidas += s.linhas;
        res.novas += s.novas;
        res.mudaram += s.mudaram;
        res.iguais += s.iguais;
        res.reconferir += s.reconferir;
      } catch (e: any) {
        anotarErro(res, "lista/gravar", e?.message ?? String(e), { modelo, pagina });
        break;
      }
      const datas = linhas.map(dataEmissao).filter((d): d is string => d !== null);
      const maisAntiga = datas.length ? datas.reduce((a, b) => (a < b ? a : b)) : null;
      if ((maisAntiga !== null && maisAntiga < op.desde) || linhas.length < op.pageSize) {
        chegouNoCorte = true;
        break;
      }
    }
    if (!chegouNoCorte) res.lista_incompleta.push(modelo);
  }
}

// ── Leitura e gravação de UMA nota ────────────────────────────────────
type Desfecho = "nova_versao" | "sem_mudanca" | "ausente" | "falha";

async function lerUma(deps: Deps, n: ItemFila, res: Resultado): Promise<Desfecho> {
  res.detalhes_tentados++;
  const r = await deps.proxy(endpointLoad(n.modelo, n.serie, n.numero_alvo), "GET");
  try {
    if (r.ok && r.data !== null && typeof r.data === "object" && !Array.isArray(r.data)) {
      const g = await deps.banco.gravarDetalhe(n.id, r.data);
      if (g.resultado === "nova_versao") {
        res.nova_versao++;
        return "nova_versao";
      }
      res.sem_mudanca++;
      return "sem_mudanca";
    }
    if (r.ok && (r.data === null || r.data === undefined || r.data === "")) {
      // Lab 05/11/2026: número inexistente → corpo null
      await deps.banco.gravarDetalhe(n.id, null);
      res.ausentes++;
      return "ausente";
    }
    const erro = r.erro ?? (r.ok ? `resposta inesperada: ${JSON.stringify(r.data)?.slice(0, 200)}` : `HTTP ${r.status}`);
    await deps.banco.registrarFalha(n.id, erro);
    res.falhas++;
    anotarErro(res, "detalhe", erro, { nota: `${n.modelo} ${n.serie} ${n.numero_alvo}` });
    return "falha";
  } catch (e: any) {
    const erro = e?.message ?? String(e);
    res.falhas++;
    anotarErro(res, "detalhe/gravar", erro, { nota: `${n.modelo} ${n.serie} ${n.numero_alvo}` });
    try {
      await deps.banco.registrarFalha(n.id, erro);
    } catch (e2: any) {
      anotarErro(res, "detalhe/falha", e2?.message ?? String(e2), { nota: n.numero_alvo });
    }
    return "falha";
  }
}

// ── Passo 2: DETALHE das pendentes, uma a uma (N em paralelo) ─────────
export async function passoDetalhe(deps: Deps, op: Opcoes, res: Resultado): Promise<void> {
  if (op.maxDetalhes <= 0) return;
  let fila: ItemFila[];
  try {
    fila = await deps.banco.filaDetalhe(op.maxDetalhes);
  } catch (e: any) {
    anotarErro(res, "detalhe/fila", e?.message ?? String(e));
    return;
  }
  let i = 0;
  const trabalhador = async () => {
    while (i < fila.length) {
      if (estourou(deps, op)) {
        res.parado_por_watchdog = true;
        return;
      }
      const n = fila[i++];
      await lerUma(deps, n, res);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, op.concorrencia) }, () => trabalhador()));
}

// ── Modo "notas": notas escolhidas, uma a uma (teste e conferência) ───
// Se a nota ainda não existe no Hub e o Alvo a devolve, o próprio Load
// serve de linha de lista (tem a identidade e os campos do cabeçalho).
// Número que o Alvo não tem e o Hub também não tem: só é relatado.
export async function passoNotas(
  deps: Deps,
  op: Opcoes,
  notas: Array<{ modelo: string; serie: string; numero: string }>,
  res: Resultado,
): Promise<void> {
  for (const pedido of notas) {
    if (estourou(deps, op)) {
      res.parado_por_watchdog = true;
      break;
    }
    const modelo = pedido.modelo;
    const serie = pedido.serie;
    const numero = numeroAlvo(pedido.numero);
    const rotulo = `${modelo} ${serie} ${numero}`;
    try {
      let id = await deps.banco.idDaNota(FILIAL, modelo, serie, numero);
      if (id) {
        const d = await lerUma(deps, { id, modelo, serie, numero_alvo: numero }, res);
        res.notas.push({ nota: rotulo, ja_existia: true, desfecho: d });
        continue;
      }
      res.detalhes_tentados++;
      const r = await deps.proxy(endpointLoad(modelo, serie, numero), "GET");
      if (r.ok && (r.data === null || r.data === undefined || r.data === "")) {
        res.notas.push({ nota: rotulo, ja_existia: false, desfecho: "nao_existe_no_alvo" });
        continue;
      }
      if (!(r.ok && r.data !== null && typeof r.data === "object" && !Array.isArray(r.data))) {
        const erro = r.erro ?? `HTTP ${r.status}`;
        anotarErro(res, "notas", erro, { nota: rotulo });
        res.notas.push({ nota: rotulo, ja_existia: false, desfecho: "falha", erro });
        continue;
      }
      if (r.data.CodigoEmpresaFilial !== FILIAL || r.data.ModeloCtrlDf !== modelo || r.data.SerieCtrlDf !== serie || r.data.Numero !== numero) {
        const erro = `o Alvo devolveu outra nota: ${r.data.CodigoEmpresaFilial} ${r.data.ModeloCtrlDf} ${r.data.SerieCtrlDf} ${r.data.Numero}`;
        anotarErro(res, "notas", erro, { nota: rotulo });
        res.notas.push({ nota: rotulo, ja_existia: false, desfecho: "falha", erro });
        continue;
      }
      const s = await deps.banco.registrarLista([r.data]);
      res.novas += s.novas;
      id = await deps.banco.idDaNota(FILIAL, modelo, serie, numero);
      if (!id) throw new Error("nota não apareceu depois de registrada");
      const g = await deps.banco.gravarDetalhe(id, r.data);
      if (g.resultado === "nova_versao") res.nova_versao++;
      else res.sem_mudanca++;
      res.notas.push({ nota: rotulo, ja_existia: false, desfecho: g.resultado, versao: g.versao });
    } catch (e: any) {
      const erro = e?.message ?? String(e);
      anotarErro(res, "notas", erro, { nota: rotulo });
      res.notas.push({ nota: rotulo, desfecho: "falha", erro });
    }
  }
}

// ── Resumo de uma linha para sync_runs.observacao ─────────────────────
export function resumo(modo: string, op: Opcoes, res: Resultado, versao: string, extra: string[] = []): string {
  return [
    `[${modo}]`,
    modo !== "detalhe" && modo !== "notas" ? `lista desde ${op.desde}: ${res.paginas} pág., ${res.linhas_lidas} linhas (novas ${res.novas}, mudaram ${res.mudaram}, iguais ${res.iguais}, reconferir ${res.reconferir})` : null,
    res.lista_incompleta.length ? `LISTA INCOMPLETA: ${res.lista_incompleta.join(",")}` : null,
    `detalhe ${res.detalhes_tentados} lidas (nova versão ${res.nova_versao}, sem mudança ${res.sem_mudanca}, ausentes ${res.ausentes}, falhas ${res.falhas})`,
    res.erros ? `erros ${res.erros}` : null,
    res.parado_por_watchdog ? "PARADO PELO WATCHDOG" : null,
    ...extra,
    `edge ${versao}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
