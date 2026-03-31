import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_SESSION_RETRIES = 3;
const PAGE_SIZE = 50;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SyncPedCompResult {
  total: number;
  inserted: number;
  updated: number;
  errors: number;
}

async function fetchWithRetry(
  endpoint: string,
  body: object,
  token: string
): Promise<{ data: any[]; usedToken: string }> {
  let currentToken = token;

  for (let attempt = 1; attempt <= MAX_SESSION_RETRIES; attempt++) {
    const resp = await fetch(`${ERP_BASE_URL}/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "riosoft-token": currentToken,
      },
      body: JSON.stringify(body),
    });

    if (resp.status !== 409) {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      return { data: Array.isArray(data) ? data : [], usedToken: currentToken };
    }

    console.warn(`[PedComp] 409 sessão conflitante (tentativa ${attempt}/${MAX_SESSION_RETRIES})`);
    if (attempt === MAX_SESSION_RETRIES) {
      throw new Error("Conflito de sessão ERP persistente (HTTP 409).");
    }
    clearAlvoToken();
    await delay(1000 * attempt);
    const reAuth = await authenticateAlvo();
    if (!reAuth.success || !reAuth.token) throw new Error("Falha na re-autenticação após 409");
    currentToken = reAuth.token;
  }
  throw new Error("Falha inesperada no fluxo de retry");
}

async function fetchAllPedidos(
  token: string,
  filter: string,
  onProgress?: (msg: string) => void
): Promise<{ pedidos: any[]; usedToken: string }> {
  const allPedidos: any[] = [];
  let pageIndex = 1;
  let hasMore = true;
  let currentToken = token;

  while (hasMore) {
    onProgress?.(`Buscando pedidos... página ${pageIndex}`);
    const result = await fetchWithRetry("PedComp/GetListForComponents", {
      FormName: "pedComp",
      ClassInput: "PedComp",
      ControllerForm: "pedComp",
      TypeObject: "tabForm",
      Filter: filter,
      Input: "gridTablePedComp",
      IsGroupBy: false,
      Order: "DataPedido DESC",
      PageIndex: pageIndex,
      PageSize: PAGE_SIZE,
      Shortcut: "pedcomp",
      Type: "GridTable",
    }, currentToken);

    currentToken = result.usedToken;
    if (result.data.length > 0) {
      allPedidos.push(...result.data);
      pageIndex++;
      if (result.data.length < PAGE_SIZE) hasMore = false;
    } else {
      hasMore = false;
    }
    await delay(200);
  }

  return { pedidos: allPedidos, usedToken: currentToken };
}

async function resolveEntidadesCnpj(
  codigosUnicos: string[],
  token: string,
  onProgress?: (msg: string) => void
): Promise<{ cache: Map<string, { cnpj: string | null; nome: string | null }>; usedToken: string }> {
  const cache = new Map<string, { cnpj: string | null; nome: string | null }>();
  let currentToken = token;

  // Load existing cache from Supabase
  const { data: cached } = await supabase
    .from("compras_entidades_cache")
    .select("codigo_entidade, cnpj, nome")
    .in("codigo_entidade", codigosUnicos);

  if (cached) {
    for (const c of cached) {
      cache.set(c.codigo_entidade, { cnpj: c.cnpj, nome: c.nome });
    }
  }

  const missing = codigosUnicos.filter((c) => !cache.has(c));

  for (let i = 0; i < missing.length; i++) {
    const codigo = missing[i];
    onProgress?.(`Resolvendo entidades: ${i + 1} de ${missing.length}...`);

    try {
      const result = await fetchWithRetry("Entidade/GetListForComponents", {
        FormName: "entidade",
        ClassInput: "Entidade",
        ControllerForm: "entidade",
        TypeObject: "tabForm",
        Filter: `( Codigo == '${codigo}' )`,
        Input: "gridTableEntidade",
        IsGroupBy: false,
        Order: "Codigo",
        PageIndex: 1,
        PageSize: 1,
        Shortcut: "entidade",
        Type: "GridTable",
      }, currentToken);

      currentToken = result.usedToken;

      if (result.data.length > 0) {
        const ent = result.data[0];
        const cnpj = ent.CPFCNPJ || ent.CPF || null;
        const nome = ent.Nome || ent.NomeFantasia || null;
        cache.set(codigo, { cnpj, nome });

        await supabase.from("compras_entidades_cache").upsert({
          codigo_entidade: codigo,
          cnpj: cnpj,
          nome: ent.Nome || ent.NomeFantasia || null,
          ie: ent.RGIE || null,
          uf: ent.SiglaUnidFederacao || null,
          municipio: ent.NomeCidade || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "codigo_entidade" });
      } else {
        cache.set(codigo, { cnpj: null, nome: null });
      }
    } catch (err) {
      console.warn(`[PedComp] Falha ao resolver entidade ${codigo}:`, err);
      cache.set(codigo, { cnpj: null, nome: null });
    }
    await delay(200);
  }

  return { cache, usedToken: currentToken };
}

function mapPedido(pedido: any, entidade: { cnpj: string | null; nome: string | null } | null) {
  return {
    numero: pedido.Numero,
    codigo_empresa_filial: pedido.CodigoEmpresaFilial || "1.01",
    status: pedido.Status,
    aprovado: pedido.Aprovado,
    status_aprovacao: pedido.StatusAprovacao,
    comprado: pedido.Comprado,
    tipo:
      pedido.ValorServico > 0 && (pedido.ValorMercadoria || 0) === 0
        ? "Serviço"
        : (pedido.ValorMercadoria || 0) > 0 && (pedido.ValorServico || 0) === 0
        ? "Produto"
        : "Misto",
    data_pedido: pedido.DataPedido ? pedido.DataPedido.split("T")[0] : null,
    data_cadastro: pedido.DataCadastro ? pedido.DataCadastro.split("T")[0] : null,
    data_entrega: pedido.DataEntrega ? pedido.DataEntrega.split("T")[0] : null,
    data_validade: pedido.DataValidade ? pedido.DataValidade.split("T")[0] : null,
    codigo_entidade: pedido.CodigoEntidade,
    nome_entidade: pedido.NomeEntidade || entidade?.nome || null,
    cnpj_entidade: pedido.CPFCNPJ || entidade?.cnpj || null,
    valor_mercadoria: pedido.ValorMercadoria || 0,
    valor_servico: pedido.ValorServico || 0,
    valor_total: pedido.ValorTotal || 0,
    valor_frete: pedido.ValorFrete || 0,
    valor_desconto: pedido.ValorDescontoGeral || 0,
    codigo_cond_pag: pedido.CondPagPedCompObject?.CodigoCondPag || null,
    nome_cond_pag: null,
    codigo_usuario: pedido.CodigoUsuario,
    texto: pedido.Texto,
    texto_historico: pedido.TextoHistorico || null,
    synced_at: new Date().toISOString(),
  };
}

export async function syncPedidosCompra(
  mes: number,
  ano: number,
  onProgress?: (msg: string) => void
): Promise<SyncPedCompResult> {
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    throw new Error("Falha na autenticação com o ERP Alvo.");
  }

  // Build date filter for the selected period
  const mesStr = String(mes).padStart(2, "0");
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const diaFinalStr = String(ultimoDia).padStart(2, "0");
  const filter = `( CodigoEmpresaFilial == '1.01' && DataPedido >= #01/${mesStr}/${ano} 00:00:00# && DataPedido <= #${diaFinalStr}/${mesStr}/${ano} 23:59:59# )`;

  // Step 1: Fetch pedidos for the period
  const { pedidos, usedToken } = await fetchAllPedidos(auth.token, filter, onProgress);
  onProgress?.(`${pedidos.length} pedidos encontrados no ERP para ${mesStr}/${ano}.`);

  if (pedidos.length === 0) {
    return { total: 0, inserted: 0, updated: 0, errors: 0 };
  }

  // Step 2: Resolve entity CNPJs
  const codigosUnicos = [...new Set(pedidos.map((p: any) => p.CodigoEntidade).filter(Boolean))] as string[];
  const { cache: entidadeCache } = await resolveEntidadesCnpj(codigosUnicos, usedToken, onProgress);

  // Step 3: Save pedidos
  onProgress?.("Salvando pedidos...");

  // Get existing pedidos to differentiate insert vs update
  const { data: existing } = await supabase
    .from("compras_pedidos")
    .select("numero, codigo_empresa_filial");
  const existingSet = new Set((existing || []).map((e) => `${e.codigo_empresa_filial}|${e.numero}`));

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  // Batch upsert in chunks of 50
  const mapped = pedidos.map((p: any) => mapPedido(p, entidadeCache.get(p.CodigoEntidade) ?? null));

  for (let i = 0; i < mapped.length; i += 50) {
    const batch = mapped.slice(i, i + 50);
    const { error } = await supabase
      .from("compras_pedidos")
      .upsert(batch, { onConflict: "codigo_empresa_filial,numero" });

    if (error) {
      console.error("[PedComp] Erro ao salvar batch:", error);
      errors += batch.length;
    } else {
      for (const item of batch) {
        const key = `${item.codigo_empresa_filial}|${item.numero}`;
        if (existingSet.has(key)) updated++;
        else inserted++;
      }
    }
    await delay(200);
  }

  let currentToken = usedToken;
  const startDate = `${ano}-${mesStr}-01`;
  const endDate = `${ano}-${mesStr}-${diaFinalStr}`;

  // Step 3.4: Load detalhes completos de cada pedido
  onProgress?.("Carregando detalhes dos pedidos...");

  const { data: pedidosSemDetalhes } = await supabase
    .from("compras_pedidos")
    .select("numero, detalhes_carregados")
    .eq("codigo_empresa_filial", "1.01")
    .gte("data_pedido", startDate)
    .lte("data_pedido", endDate)
    .or("detalhes_carregados.is.null,detalhes_carregados.eq.false");

  const semDetalhes = pedidosSemDetalhes || [];

  for (let i = 0; i < semDetalhes.length; i++) {
    const ped = semDetalhes[i];
    onProgress?.(`Carregando detalhes: ${i + 1} de ${semDetalhes.length} pedidos...`);

    try {
      const loadUrl = `${ERP_BASE_URL}/PedComp/Load?codigoEmpresaFilial=1.01&numero=${encodeURIComponent(ped.numero)}&loadChild=All`;

      const loadResp = await fetch(loadUrl, {
        method: "GET",
        headers: { "riosoft-token": currentToken },
      });

      if (loadResp.status === 409) {
        clearAlvoToken();
        await delay(1000);
        const reAuth = await authenticateAlvo();
        if (reAuth.token) currentToken = reAuth.token;
        continue;
      }

      if (!loadResp.ok) continue;

      const loadData = await loadResp.json();

      const itens = (loadData?.ItemPedCompChildList || []).map((item: any) => ({
        sequencia: item.Sequencia,
        codigoProduto: item.CodigoProduto,
        nomeProduto: item.NomeProduto || item.DescricaoAlternativaProduto,
        unidade: item.CodigoProdUnidMed,
        quantidade: item.QuantidadeProdUnidMedPrincipal,
        valorUnitario: item.ValorUnitario,
        valorTotal: item.ValorTotal,
        itemServico: item.ItemServico,
        cancelado: item.Cancelado,
        classe: item.ItemPedCompClasseRecdespChildList?.[0]?.CodigoClasseRecDesp || null,
        centroCusto: item.ItemPedCompClasseRecdespChildList?.[0]?.RateioItemPedCompChildList?.[0]?.CodigoCentroCtrl || null,
        classeRateio: (item.ItemPedCompClasseRecdespChildList || []).map((c: any) => ({
          classe: c.CodigoClasseRecDesp,
          valor: c.Valor,
          percentual: c.Percentual,
          centrosCusto: (c.RateioItemPedCompChildList || []).map((r: any) => ({
            codigo: r.CodigoCentroCtrl, valor: r.Valor, percentual: r.Percentual,
          })),
        })),
      }));

      const parcelas = (loadData?.ParcPagPedCompChildList || []).map((p: any) => ({
        sequencia: p.Sequencia,
        duplicata: p.NumeroDuplicata,
        diasEntreParcelas: p.DiasEntreParcelas,
        percentual: p.PercentualFracao,
        valor: p.ValorParcela,
        vencimento: p.DataVencimento?.split("T")[0] || null,
      }));

      let classeRateio = (loadData?.PedCompClasseRecDespChildList || []).map((c: any) => ({
        classe: c.CodigoClasseRecDesp,
        valor: c.Valor,
        percentual: c.Percentual,
        centrosCusto: (c.RateioPedCompChildList || []).map((r: any) => ({
          codigo: r.CodigoCentroCtrl, valor: r.Valor, percentual: r.Percentual,
        })),
      }));
      if (classeRateio.length === 0) {
        for (const item of (loadData?.ItemPedCompChildList || [])) {
          const ic = item.ItemPedCompClasseRecdespChildList || [];
          classeRateio.push(...ic.map((c: any) => ({
            classe: c.CodigoClasseRecDesp, valor: c.Valor, percentual: c.Percentual,
            centrosCusto: (c.RateioItemPedCompChildList || []).map((r: any) => ({
              codigo: r.CodigoCentroCtrl, valor: r.Valor, percentual: r.Percentual,
            })),
          })));
        }
      }

      const nomeCondPag = loadData?.CondPagPedCompObject?.Nome || null;
      const classeRecDesp = classeRateio[0]?.classe || null;
      const centroCusto = classeRateio[0]?.centrosCusto?.[0]?.codigo || null;

      await supabase.from("compras_pedidos").upsert({
        numero: ped.numero,
        codigo_empresa_filial: "1.01",
        itens,
        parcelas,
        classe_rateio: classeRateio,
        nome_cond_pag: nomeCondPag,
        classe_rec_desp: classeRecDesp,
        centro_custo: centroCusto,
        detalhes_carregados: true,
        detalhes_carregados_em: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "codigo_empresa_filial,numero" });

    } catch (err) {
      console.warn(`[PedComp] Erro ao carregar detalhes ${ped.numero}:`, err);
    }
    await delay(300);
  }

  onProgress?.(`Detalhes carregados para ${semDetalhes.length} pedidos.`);

  // Step 3.5: Cache anexos no Supabase Storage
  onProgress?.("Buscando anexos dos pedidos...");

  const { data: pedidosSemCache } = await supabase
    .from("compras_pedidos")
    .select("numero, anexos")
    .eq("codigo_empresa_filial", "1.01")
    .gte("data_pedido", startDate)
    .lte("data_pedido", endDate);

  const pedidosParaCachear = (pedidosSemCache || []).filter(p => {
    if (!p.anexos || (p.anexos as any[]).length === 0) return true;
    return (p.anexos as any[]).some((a: any) => !a.storagePath);
  });

  let anexosCacheados = 0;
  for (let i = 0; i < pedidosParaCachear.length; i++) {
    const ped = pedidosParaCachear[i];
    onProgress?.(`Verificando anexos: ${i + 1} de ${pedidosParaCachear.length} pedidos...`);

    try {
      const loadUrl = `${ERP_BASE_URL}/PedComp/Load?codigoEmpresaFilial=1.01&numero=${encodeURIComponent(ped.numero)}&loadChild=PedCompArquivoChildList`;

      const loadResp = await fetch(loadUrl, {
        method: "GET",
        headers: { "riosoft-token": currentToken },
      });

      if (loadResp.status === 409) {
        clearAlvoToken();
        await delay(1000);
        const reAuth = await authenticateAlvo();
        if (reAuth.token) currentToken = reAuth.token;
        continue;
      }

      if (!loadResp.ok) continue;

      const loadData = await loadResp.json();
      const arquivos = loadData?.PedCompArquivoChildList || [];

      if (arquivos.length === 0) continue;

      const anexosAtualizados: any[] = [];
      for (const arq of arquivos) {
        const path = arq.Arquivo || "";
        const nome = path.split("\\").pop() || path;
        const storagePath = `pedidos/${ped.numero}/${arq.Sequencia}_${nome}`;

        const { data: existingFiles } = await supabase.storage
          .from("attachments")
          .list(`pedidos/${ped.numero}`, { search: `${arq.Sequencia}_` });

        if (existingFiles && existingFiles.some(f => f.name === `${arq.Sequencia}_${nome}`)) {
          anexosAtualizados.push({
            sequencia: arq.Sequencia,
            nomeArquivo: nome,
            caminhoOriginal: path,
            usuario: arq.CodigoUsuario,
            data: arq.DataArquivo?.split("T")[0] || null,
            observacao: arq.Observacao,
            storagePath,
          });
          continue;
        }

        try {
          const dlResp = await fetch(`${ERP_BASE_URL}/pedComp/DownloadFile`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "riosoft-token": currentToken,
            },
            body: JSON.stringify({
              property: "Arquivo",
              classVincul: "PedCompArquivo",
              nameFile: nome,
              pathFile: path,
            }),
          });

          if (dlResp.ok) {
            const blob = await dlResp.blob();
            const arrayBuffer = await blob.arrayBuffer();

            const { error: upErr } = await supabase.storage
              .from("attachments")
              .upload(storagePath, new Uint8Array(arrayBuffer), {
                contentType: blob.type || "application/pdf",
                upsert: true,
              });

            if (!upErr) anexosCacheados++;

            anexosAtualizados.push({
              sequencia: arq.Sequencia,
              nomeArquivo: nome,
              caminhoOriginal: path,
              usuario: arq.CodigoUsuario,
              data: arq.DataArquivo?.split("T")[0] || null,
              observacao: arq.Observacao,
              storagePath: upErr ? null : storagePath,
            });
          }
        } catch { /* skip individual file */ }
        await delay(300);
      }

      if (anexosAtualizados.length > 0) {
        await supabase
          .from("compras_pedidos")
          .upsert({
            numero: ped.numero,
            codigo_empresa_filial: "1.01",
            anexos: anexosAtualizados,
            updated_at: new Date().toISOString(),
          }, { onConflict: "codigo_empresa_filial,numero" });
      }
    } catch (err) {
      console.warn(`[PedComp] Erro ao cachear anexos do pedido ${ped.numero}:`, err);
    }
    await delay(200);
  }

  if (anexosCacheados > 0) {
    onProgress?.(`${anexosCacheados} anexo(s) cacheado(s) no Storage.`);
  }

  // Step 4: Save sync timestamp with period info
  await supabase
    .from("compras_config")
    .upsert(
      { chave: "pedcomp_last_sync_ts", valor: JSON.stringify({ timestamp: Date.now(), mes, ano }), updated_at: new Date().toISOString() },
      { onConflict: "chave" }
    );

  const summary = `Sincronização concluída: ${mapped.length} pedidos de ${String(mes).padStart(2, "0")}/${ano} (${inserted} novos, ${updated} atualizados)`;
  onProgress?.(summary);

  return { total: mapped.length, inserted, updated, errors };
}
