import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_SESSION_RETRIES = 3;
const DELAY_MS = 200;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EnrichClassesResult {
  enriched: number;
  skipped: number;
  errors: number;
}

async function loadClasseComRetry(
  codigo: string,
  token: string
): Promise<{ data: any; usedToken: string }> {
  let currentToken = token;

  for (let attempt = 1; attempt <= MAX_SESSION_RETRIES; attempt++) {
    const url =
      `${ERP_BASE_URL}/ClasseRecDesp/Load` +
      `?codigoEmpresaFilial=1.01&codigo=${encodeURIComponent(codigo)}`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "riosoft-token": currentToken,
      },
    });

    if (resp.status !== 409) {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
      throw new Error("Falha na re-autenticação.");
    }
    currentToken = reAuth.token;
  }
  throw new Error("Falha inesperada no fluxo de retry");
}

export async function enriquecerClassesComContaContabil(
  onProgress?: (current: number, total: number, message: string) => void
): Promise<EnrichClassesResult> {
  // 1. Buscar apenas classes Folha sem conta contábil ainda
  const { data: classes, error } = await (supabase as any)
    .from("classes_rec_desp")
    .select("id, codigo, nome")
    .eq("grupo", "F")
    .is("conta_contabil_reduzida", null);

  if (error) throw new Error(`Erro ao buscar classes: ${error.message}`);
  if (!classes || classes.length === 0) {
    return { enriched: 0, skipped: 0, errors: 0 };
  }

  onProgress?.(0, classes.length,
    `${classes.length} classes para enriquecer. Autenticando...`
  );

  const auth = await authenticateAlvo();
  if (!auth.success || !auth.token) {
    throw new Error(`Falha na autenticação: ${auth.error}`);
  }
  let currentToken = auth.token;

  const result: EnrichClassesResult = {
    enriched: 0,
    skipped: 0,
    errors: 0,
  };

  for (let i = 0; i < classes.length; i++) {
    const cls = classes[i];
    try {
      onProgress?.(
        i + 1,
        classes.length,
        `${i + 1}/${classes.length}: ${cls.codigo} — ${cls.nome}...`
      );

      const { data: detail, usedToken } = await loadClasseComRetry(
        cls.codigo,
        currentToken
      );
      currentToken = usedToken;

      const contaReduzida: number | null =
        detail?.ClasseRecDespUserFieldsObject?.UserConta_Contab ?? null;

      if (!contaReduzida) {
        result.skipped++;
        await delay(DELAY_MS);
        continue;
      }

      const { error: updateErr, data: updateData } = await (supabase as any)
        .from("classes_rec_desp")
        .update({ conta_contabil_reduzida: contaReduzida })
        .eq("codigo", cls.codigo)
        .select("id");

      if (updateErr) {
        console.error(`Erro atualizando ${cls.codigo}:`, updateErr.message, updateErr.details);
        result.errors++;
      } else if (!updateData || updateData.length === 0) {
        console.warn(`Update sem efeito para ${cls.codigo}`);
        result.errors++;
      } else {
        result.enriched++;
      }
    } catch (err: any) {
      console.error(`Erro na classe ${cls.codigo}:`, err);
      result.errors++;
    }

    await delay(DELAY_MS);
  }

  return result;
}
