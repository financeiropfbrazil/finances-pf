import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

interface ParcCondPagChild {
  Numero: number;
  DiasPrazo: number;
  PercentualFracao: number;
}

async function fetchWithRetry(url: string, init: RequestInit, token: string): Promise<Response> {
  let currentToken = token;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), "riosoft-token": currentToken },
    });
    if (resp.status !== 409) return resp;
    clearAlvoToken();
    await delay(500 * attempt);
    const reAuth = await authenticateAlvo();
    if (!reAuth.success || !reAuth.token) throw new Error("Falha re-auth após 409");
    currentToken = reAuth.token;
  }
  throw new Error("Conflito de sessão (409) persistente");
}

export async function syncCondicoesPagamento(
  onProgress?: (msg: string) => void
): Promise<number> {
  clearAlvoToken();
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) throw new Error("Falha na autenticação");

  // 1. Busca lista de condPags (cabeçalhos)
  onProgress?.("Buscando lista de condições de pagamento...");
  const listResp = await fetchWithRetry(
    `${ERP_BASE_URL}/condPag/GetListForComponents`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        FormName: "condPag",
        ClassInput: "condPag",
        ControllerForm: "condPag",
        TypeObject: "rsSearch",
        BindingName: "",
        ClassVinculo: "condPag",
        DisabledCache: false,
        Filter: "(Estruturado == '002' OR Estruturado LIKE '002.%')",
        Input: "defaultSearch",
        IsGroupBy: false,
        Order: "Estruturado ASC",
        OrderUser: "",
        PageIndex: 1,
        PageSize: 500,
        Shortcut: "condpag",
        Type: "GridTable",
      }),
    },
    auth.token
  );

  if (!listResp.ok) throw new Error(`HTTP ${listResp.status} ao listar condPags`);
  const list = await listResp.json();
  if (!Array.isArray(list)) throw new Error("Resposta inválida do GetListForComponents");

  // Só folhas com parcelas > 0
  const folhas = list.filter((c: any) => c.Grupo === "F" && (c.QuantidadeParcela || 0) > 0);
  onProgress?.(`${folhas.length} condições ativas encontradas. Buscando parcelas...`);

  // 2. Para cada condPag, chama Load com loadChild=ParcCondPagChildList
  const headers: any[] = [];
  const childrenByCod: Record<string, ParcCondPagChild[]> = {};

  for (let i = 0; i < folhas.length; i++) {
    const c = folhas[i];
    const codigo = c.Codigo;
    onProgress?.(`Carregando parcelas: ${i + 1}/${folhas.length} (${codigo})`);

    const loadResp = await fetchWithRetry(
      `${ERP_BASE_URL}/CondPag/Load?codigo=${encodeURIComponent(codigo)}&loadChild=ParcCondPagChildList`,
      { method: "GET" },
      auth.token
    );

    if (!loadResp.ok) {
      console.warn(`[syncCondPag] falha ao carregar ${codigo}: HTTP ${loadResp.status}`);
      continue;
    }

    const full = await loadResp.json();
    headers.push({
      codigo: full.Codigo,
      nome: full.Nome,
      quantidade_parcelas: full.QuantidadeParcela || 1,
      dias_entre_parcelas: full.DiasEntreParcelas || 0,
      primeiro_vencimento_apos: full.PrimeiroVencimentoApos || 0,
      updated_at: new Date().toISOString(),
    });

    const parcelas = (full.ParcCondPagChildList as any[]) || [];
    childrenByCod[codigo] = parcelas.map(p => ({
      Numero: p.Numero,
      DiasPrazo: p.DiasPrazo || 0,
      PercentualFracao: p.PercentualFracao || 0,
    }));

    // pequeno respiro pra não sobrecarregar o ERP
    await delay(50);
  }

  // 3. Limpa e re-popula condicoes_pagamento (headers)
  onProgress?.("Salvando condições no Supabase...");
  await supabase.from("condicoes_pagamento").delete().neq("codigo", "");
  const { error: errH } = await supabase
    .from("condicoes_pagamento")
    .upsert(headers, { onConflict: "codigo" });
  if (errH) throw new Error(`Erro Supabase headers: ${errH.message}`);

  // 4. Limpa e re-popula condicoes_pagamento_parcelas (children)
  await (supabase as any).from("condicoes_pagamento_parcelas").delete().neq("codigo_cond_pag", "");
  const parcelasPayload: any[] = [];
  for (const [codigo, parcelas] of Object.entries(childrenByCod)) {
    for (const p of parcelas) {
      parcelasPayload.push({
        codigo_cond_pag: codigo,
        numero: p.Numero,
        dias_prazo: p.DiasPrazo,
        percentual_fracao: p.PercentualFracao || null,
        updated_at: new Date().toISOString(),
      });
    }
  }
  if (parcelasPayload.length > 0) {
    const { error: errP } = await (supabase as any)
      .from("condicoes_pagamento_parcelas")
      .upsert(parcelasPayload, { onConflict: "codigo_cond_pag,numero" });
    if (errP) throw new Error(`Erro Supabase parcelas: ${errP.message}`);
  }

  onProgress?.(`Sincronização concluída: ${headers.length} condições, ${parcelasPayload.length} parcelas.`);
  return headers.length;
}
