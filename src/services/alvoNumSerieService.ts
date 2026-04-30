import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const PAGE_SIZE = 500;
const MAX_RETRIES = 3;
const UPSERT_BATCH_SIZE = 500;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mapeia 1 registro do numSerie/GetListForComponents para o formato do banco.
 */
function mapSerialToRecord(s: any) {
  return {
    controle: s.Controle,
    codigo_produto: s.CodigoProduto,
    numero_serie: s.NumeroSerie || "",
    numero_ctrl_lote: s.NumeroCtrlLote || null,
    data_validade_ctrl_lote: s.DataValidadeCtrlLote || null,
    codigo_entidade_fabricante: s.CodigoEntidadeFabricante || null,
    codigo_entidade_cliente: s.CodigoEntidadeCliente || null,
    codigo_loc_armaz: s.CodigoLocArmaz || null,
    codigo_loc_armaz_num_ser: s.CodigoLocArmazNumSer || null,
    cancelado: s.Cancelado || null,
    origem_estoque: s.OrigemEstoque || null,
    data_cadastro_alvo: s.DataCadastro || null,
  };
}

/**
 * Faz uma chamada paginada ao numSerie/GetListForComponents com retry de auth (409).
 */
async function fetchPageSerials(page: number, tokenRef: { token: string }): Promise<any[]> {
  let resp: Response | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    resp = await fetch(`${ERP_BASE_URL}/numSerie/GetListForComponents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "riosoft-token": tokenRef.token,
      },
      body: JSON.stringify({
        FormName: "numSerie",
        ClassInput: "numSerie",
        ControllerForm: "numSerie",
        TypeObject: "rsSearch",
        Filter: "",
        Input: "defaultSearch",
        IsGroupBy: false,
        Order: "",
        PageIndex: page,
        PageSize: PAGE_SIZE,
        Shortcut: "numserie",
        Type: "GridTable",
      }),
    });

    if (resp && resp.status === 409) {
      clearAlvoToken();
      await delay(1000 * attempt);
      const auth = await authenticateAlvo();
      if (auth.token) tokenRef.token = auth.token;
      continue;
    }
    break;
  }

  if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status} ao buscar seriais`);
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Sync principal: busca todos os seriais do Alvo, faz upsert via RPC em batches.
 */
export async function syncNumSerie(
  onProgress?: (msg: string) => void,
): Promise<{ total: number; inseridos: number; atualizados: number }> {
  clearAlvoToken();
  const auth = await authenticateAlvo();
  if (!auth.token) throw new Error("Falha na autenticação ERP");

  const tokenRef = { token: auth.token };

  // ETAPA 1 — Busca todos os seriais paginados
  let page = 1;
  const todosSerials: any[] = [];
  let hasMore = true;

  while (hasMore) {
    onProgress?.(`Buscando seriais... página ${page}`);
    const data = await fetchPageSerials(page, tokenRef);

    if (data.length === 0) {
      hasMore = false;
      break;
    }

    todosSerials.push(...data);
    onProgress?.(`${todosSerials.length} seriais coletados...`);

    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
      await delay(300);
    }
  }

  if (todosSerials.length === 0) {
    return { total: 0, inseridos: 0, atualizados: 0 };
  }

  // ETAPA 2 — Upsert em batches via RPC
  onProgress?.(`Salvando ${todosSerials.length} seriais no banco...`);
  const sb = supabase as any;
  let totalInseridos = 0;
  let totalAtualizados = 0;

  for (let i = 0; i < todosSerials.length; i += UPSERT_BATCH_SIZE) {
    const batch = todosSerials.slice(i, i + UPSERT_BATCH_SIZE).map(mapSerialToRecord);

    const { data: resultado, error } = await sb.rpc("upsert_serials_batch", {
      p_serials: batch,
    });

    if (error) {
      console.error(`[NumSerie] Erro RPC batch ${i}:`, error.message);
      throw new Error(`Erro ao salvar batch ${i}: ${error.message}`);
    }

    totalInseridos += resultado?.inseridos || 0;
    totalAtualizados += resultado?.atualizados || 0;

    onProgress?.(
      `Salvos ${i + batch.length}/${todosSerials.length} (${totalInseridos} novos, ${totalAtualizados} atualizados)`,
    );
  }

  // ETAPA 3 — Salvar metadata
  await supabase.from("compras_config").upsert(
    {
      chave: "sync_numserie_ts",
      valor: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chave" },
  );

  await supabase.from("compras_config").upsert(
    {
      chave: "sync_numserie_count",
      valor: String(todosSerials.length),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chave" },
  );

  onProgress?.(`Concluído: ${todosSerials.length} seriais (${totalInseridos} novos, ${totalAtualizados} atualizados)`);

  return {
    total: todosSerials.length,
    inseridos: totalInseridos,
    atualizados: totalAtualizados,
  };
}
