/*
  Serviço de enriquecimento automático de NF Entrada.
  Busca Classe Rec/Desp e Centro de Custo do ERP Alvo para cada NF pendente.
  Insere todas as linhas de rateio em nf_entrada_rateio e atualiza
  class_rec_desp_codigo/cost_center_id na nf_entrada com os valores de maior valor absoluto.
*/
import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_SESSION_RETRIES = 3;
const DELAY_BETWEEN_CALLS_MS = 300;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EnrichResult {
  enriched: number;
  partial: number;
  skipped: number;
  errors: number;
}

export interface EnrichProgress {
  current: number;
  total: number;
  message: string;
}

async function loadNfDetailComRetry(
  chave: number,
  token: string
): Promise<{ data: any; usedToken: string }> {
  let currentToken = token;

  for (let attempt = 1; attempt <= MAX_SESSION_RETRIES; attempt++) {
    const url =
      `${ERP_BASE_URL}/MovEstq/Load` +
      `?codigoEmpresaFilial=1.01&chave=${chave}` +
      `&loadChild=MovEstqClasseRecDespChildList`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "riosoft-token": currentToken,
      },
    });

    if (resp.status !== 409) {
      if (!resp.ok) throw new Error(`HTTP ${resp.status} para chave ${chave}`);
      const data = await resp.json();
      return { data, usedToken: currentToken };
    }

    if (attempt === MAX_SESSION_RETRIES) {
      throw new Error("Conflito de sessão ERP persistente (HTTP 409).");
    }

    clearAlvoToken();
    await delay(1000 * attempt);
    const reAuth = await authenticateAlvo();
    if (!reAuth.success || !reAuth.token) {
      throw new Error("Falha na re-autenticação após conflito de sessão.");
    }
    currentToken = reAuth.token;
  }
  throw new Error("Falha inesperada no fluxo de retry");
}

export async function enriquecerNfEntrada(
  ano: number,
  mes: number,
  onProgress?: (progress: EnrichProgress) => void
): Promise<EnrichResult> {
  const padM = String(mes).padStart(2, "0");
  const startDate = `${ano}-${padM}-01`;
  const lastDay = new Date(ano, mes, 0).getDate();
  const endDate = `${ano}-${padM}-${String(lastDay).padStart(2, "0")}`;

  // 1. Buscar todas as NFs do período
  const { data: todasNfs, error: fetchErr } = await supabase
    .from("nf_entrada")
    .select("id, erp_chave")
    .eq("origem", "MOVESTQ")
    .gte("data_movimento", startDate)
    .lte("data_movimento", endDate);

  if (fetchErr) throw new Error(`Erro ao buscar NFs: ${fetchErr.message}`);
  if (!todasNfs || todasNfs.length === 0) {
    return { enriched: 0, partial: 0, skipped: 0, errors: 0 };
  }

  // 2. Descobrir quais já têm rateio
  const { data: jaEnriquecidas } = await supabase
    .from("nf_entrada_rateio" as any)
    .select("nf_entrada_id")
    .in("nf_entrada_id", todasNfs.map((n) => n.id));

  const jaSet = new Set((jaEnriquecidas ?? []).map((r: any) => r.nf_entrada_id));
  const pendentes = todasNfs.filter((n) => !jaSet.has(n.id));

  if (pendentes.length === 0) {
    return { enriched: 0, partial: 0, skipped: 0, errors: 0 };
  }

  onProgress?.({
    current: 0,
    total: pendentes.length,
    message: `${pendentes.length} NFs para enriquecer. Autenticando...`,
  });

  // 3. Autenticar
  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    throw new Error(`Falha na autenticação: ${auth.error}`);
  }
  let currentToken = auth.token;

  // 4. Mapas de lookup
  const { data: costCenters } = await supabase
    .from("cost_centers")
    .select("id, erp_code")
    .eq("is_active", true);

  const ccMap = new Map<string, string>(
    (costCenters ?? [])
      .filter((c) => c.erp_code)
      .map((c) => [c.erp_code!, c.id])
  );

  const { data: classes } = await supabase
    .from("classes_rec_desp")
    .select("codigo, nome");

  const classMap = new Map<string, string>(
    (classes ?? []).map((c) => [c.codigo, c.nome])
  );

  // 5. Processar cada NF
  const result: EnrichResult = {
    enriched: 0,
    partial: 0,
    skipped: 0,
    errors: 0,
  };

  for (let i = 0; i < pendentes.length; i++) {
    const row = pendentes[i];

    try {
      onProgress?.({
        current: i + 1,
        total: pendentes.length,
        message: `${i + 1}/${pendentes.length}: buscando chave ${row.erp_chave}...`,
      });

      const { data: detail, usedToken } = await loadNfDetailComRetry(
        row.erp_chave,
        currentToken
      );
      currentToken = usedToken;

      const classeList: any[] = detail?.MovEstqClasseRecDespChildList ?? [];

      if (classeList.length === 0) {
        result.skipped++;
        await delay(DELAY_BETWEEN_CALLS_MS);
        continue;
      }

      // 6. Montar linhas de rateio
      const rateioRows: any[] = [];
      let seq = 1;

      for (const classeItem of classeList) {
        const codigoClasse = classeItem.CodigoClasseRecDesp ?? "";
        const nomeClasse = classMap.get(codigoClasse) ?? codigoClasse;
        const classePercentual = classeItem.Percentual ?? 0;
        const classeValor = classeItem.Valor ?? 0;
        const rateioList: any[] = classeItem.RateioMovEstqChildList ?? [];

        if (rateioList.length === 0) {
          rateioRows.push({
            nf_entrada_id: row.id,
            erp_chave: row.erp_chave,
            sequencia: seq++,
            class_rec_desp_codigo: codigoClasse,
            class_rec_desp_nome: nomeClasse,
            classe_percentual: classePercentual,
            classe_valor: classeValor,
            cost_center_id: null,
            cost_center_erp_code: null,
            centro_percentual: null,
            centro_valor: null,
          });
        } else {
          for (const rateioItem of rateioList) {
            const codigoCc = rateioItem.CodigoCentroCtrl ?? "";
            rateioRows.push({
              nf_entrada_id: row.id,
              erp_chave: row.erp_chave,
              sequencia: seq++,
              class_rec_desp_codigo: codigoClasse,
              class_rec_desp_nome: nomeClasse,
              classe_percentual: classePercentual,
              classe_valor: classeValor,
              cost_center_id: ccMap.get(codigoCc) ?? null,
              cost_center_erp_code: codigoCc,
              centro_percentual: rateioItem.Percentual ?? 0,
              centro_valor: rateioItem.Valor ?? 0,
            });
          }
        }
      }

      // 7. Inserir rateio
      const { error: insertErr } = await (supabase as any)
        .from("nf_entrada_rateio")
        .insert(rateioRows);

      if (insertErr) {
        console.error(`Erro inserindo rateio ${row.erp_chave}:`, insertErr);
        result.errors++;
        await delay(DELAY_BETWEEN_CALLS_MS);
        continue;
      }

      // 8. Atualizar campos de exibição rápida na nf_entrada
      const maioreClasse = classeList.reduce((max: any, cur: any) =>
        (cur.Valor ?? 0) > (max.Valor ?? 0) ? cur : max
      );
      const codigoPrincipal = maioreClasse.CodigoClasseRecDesp ?? "";
      const rateioPrincipal: any[] = maioreClasse.RateioMovEstqChildList ?? [];
      const maiorCc = rateioPrincipal.length > 0
        ? rateioPrincipal.reduce((max: any, cur: any) =>
            (cur.Valor ?? 0) > (max.Valor ?? 0) ? cur : max
          )
        : null;

      await supabase
        .from("nf_entrada")
        .update({
          class_rec_desp_codigo: codigoPrincipal,
          class_rec_desp_nome: classMap.get(codigoPrincipal) ?? codigoPrincipal,
          cost_center_id: maiorCc
            ? (ccMap.get(maiorCc.CodigoCentroCtrl ?? "") ?? null)
            : null,
        })
        .eq("id", row.id);

      const hasCc = rateioRows.some((r) => r.cost_center_id);
      if (hasCc) result.enriched++;
      else result.partial++;

      onProgress?.({
        current: i + 1,
        total: pendentes.length,
        message: `${i + 1}/${pendentes.length}: chave ${row.erp_chave} → ${rateioRows.length} linhas de rateio`,
      });
    } catch (err: any) {
      console.error(`Erro enriquecendo chave ${row.erp_chave}:`, err);
      result.errors++;
    }

    await delay(DELAY_BETWEEN_CALLS_MS);
  }

  return result;
}
