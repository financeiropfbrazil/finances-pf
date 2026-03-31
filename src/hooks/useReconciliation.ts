import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePeriod } from "@/contexts/PeriodContext";

export interface ReconciliationData {
  id: string;
  module_name: string;
  accounting_account: string;
  management_balance: number;
  accounting_balance: number;
  difference: number;
  status: "reconciled" | "justified" | "divergent";
  justification: string | null;
  updated_at: string;
}

/**
 * Encapsulates reconciliation logic for a given module.
 * Fetches the reconciliation_summary row for the current period + moduleId,
 * and provides computed properties.
 */
export function useReconciliation(moduleId: string | string[]) {
  const { selectedPeriod } = usePeriod();
  const [rows, setRows] = useState<ReconciliationData[]>([]);
  const [loading, setLoading] = useState(true);

  const moduleIds = Array.isArray(moduleId) ? moduleId : [moduleId];

  const fetch = useCallback(async () => {
    if (!selectedPeriod) return;
    setLoading(true);
    const { data } = await supabase
      .from("reconciliation_summary")
      .select("*")
      .eq("period_id", selectedPeriod.id)
      .in("module_name", moduleIds);
    if (data) setRows(data as unknown as ReconciliationData[]);
    setLoading(false);
  }, [selectedPeriod, moduleId]);

  useEffect(() => { fetch(); }, [fetch]);

  const getModule = (id: string) => rows.find(r => r.module_name === id) ?? null;

  // Single module convenience
  const single = rows.length === 1 ? rows[0] : rows.find(r => r.module_name === moduleIds[0]) ?? null;

  const managementBalance = Number(single?.management_balance ?? 0);
  const accountingBalance = Number(single?.accounting_balance ?? 0);
  const difference = managementBalance - accountingBalance;
  const status = single?.status ?? "divergent";
  const isReconciled = status === "reconciled";
  const isJustified = status === "justified";
  const isDivergent = status === "divergent";

  return {
    rows,
    single,
    getModule,
    managementBalance,
    accountingBalance,
    difference,
    status,
    isReconciled,
    isJustified,
    isDivergent,
    loading,
    refetch: fetch,
  };
}
