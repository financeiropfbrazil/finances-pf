import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function syncCondicoesPagamento(): Promise<number> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt === 1) clearAlvoToken(); // Token fresco
    const auth = await authenticateAlvo();
    if (!auth.token) throw new Error("Falha na autenticação");

    const resp = await fetch(`${ERP_BASE_URL}/CondPag/Listar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "riosoft-token": auth.token },
    });

    if (resp.status === 409) {
      clearAlvoToken();
      await delay(1000 * attempt);
      continue;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    if (!Array.isArray(data)) throw new Error("Resposta inválida");

    const records = data.map((c: any) => ({
      codigo: c.Codigo,
      nome: c.Nome,
      quantidade_parcelas: c.QuantidadeParcela || 1,
      dias_entre_parcelas: c.DiasEntreParcelas || 0,
      primeiro_vencimento_apos: c.PrimeiroVencimentoApos || 0,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("condicoes_pagamento")
      .upsert(records, { onConflict: "codigo" });

    if (error) throw new Error(`Erro Supabase: ${error.message}`);
    return records.length;
  }
  throw new Error("Conflito de sessão persistente (409)");
}
