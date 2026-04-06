import { useState, useEffect, useCallback } from "react";
import { invokeImportEmailNfe } from "@/services/importEmailNfeService";

export interface ComprasInfo {
  already_in_compras: boolean;
  destino: string;
}

export function useComprasStatus(rowIds: string[]) {
  const [comprasStatus, setComprasStatus] = useState<Record<string, ComprasInfo>>({});
  const [isChecking, setIsChecking] = useState(false);

  const checkCompras = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setIsChecking(true);
    try {
      const data = await invokeImportEmailNfe("check", ids);
      if (data?.results) {
        const map: Record<string, ComprasInfo> = {};
        for (const r of data.results) {
          map[r.id] = {
            already_in_compras: r.already_in_compras ?? false,
            destino: r.destino ?? "",
          };
        }
        setComprasStatus(map);
      }
    } catch (err) {
      console.error("Compras check failed:", err);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    if (rowIds.length > 0) {
      checkCompras(rowIds);
    }
  }, [rowIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshCheck = useCallback((ids: string[]) => {
    checkCompras(ids);
  }, [checkCompras]);

  return { comprasStatus, isChecking, refreshCheck, setComprasStatus };
}
