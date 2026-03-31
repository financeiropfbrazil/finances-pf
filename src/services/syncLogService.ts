import { supabase } from "@/integrations/supabase/client";

export async function iniciarSyncLog(syncNome: string): Promise<string | null> {
  const { data: job } = await supabase
    .from("sync_jobs")
    .select("*")
    .eq("nome", syncNome)
    .maybeSingle();

  if (job) {
    await supabase.from("sync_jobs").upsert({
      ...job,
      ultimo_status: "running",
      updated_at: new Date().toISOString(),
    } as any, { onConflict: "id" });
  }

  const { data: log } = await supabase
    .from("sync_log")
    .insert({
      sync_job_id: job?.id || null,
      sync_nome: syncNome,
      status: "running",
      started_at: new Date().toISOString(),
    } as any)
    .select("id")
    .single();

  return log?.id || null;
}

export async function finalizarSyncLog(
  logId: string | null,
  syncNome: string,
  resultado: {
    status: "success" | "partial" | "error";
    records_processed?: number;
    records_errors?: number;
    error_message?: string;
  }
) {
  const now = new Date().toISOString();

  if (logId) {
    const { data: current } = await supabase
      .from("sync_log")
      .select("*")
      .eq("id", logId)
      .single();

    if (current) {
      await supabase.from("sync_log").upsert({
        ...current,
        finished_at: now,
        status: resultado.status,
        records_processed: resultado.records_processed || 0,
        records_errors: resultado.records_errors || 0,
        error_message: resultado.error_message || null,
      } as any, { onConflict: "id" });
    }
  }

  const { data: job } = await supabase
    .from("sync_jobs")
    .select("*")
    .eq("nome", syncNome)
    .maybeSingle();

  if (job) {
    await supabase.from("sync_jobs").upsert({
      ...job,
      ultimo_status: resultado.status,
      ultima_execucao: now,
      ultimo_erro: resultado.error_message || null,
      registros_ultima_sync: resultado.records_processed || 0,
      updated_at: now,
    } as any, { onConflict: "id" });
  }
}
