import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Period {
  id: string;
  year: number;
  month: number;
  status: string;
}

interface PeriodContextType {
  periods: Period[];
  selectedPeriod: Period | null;
  setSelectedPeriod: (period: Period) => void;
  loading: boolean;
  ensurePeriod: (year: number, month: number) => Promise<string | null>;
}

const PeriodContext = createContext<PeriodContextType | undefined>(undefined);

export const PeriodProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPeriods = async () => {
    const { data } = await supabase
      .from("periods")
      .select("*")
      .order("year", { ascending: false })
      .order("month", { ascending: false });

    if (data && data.length > 0) {
      setPeriods(data);
      if (!selectedPeriod) {
        const jan2026 = data.find(p => p.year === 2026 && p.month === 1);
        setSelectedPeriod(jan2026 ?? data[0]);
      }
    }
    setLoading(false);
  };

  useEffect(() => { fetchPeriods(); }, []);

  const ensurePeriod = async (year: number, month: number): Promise<string | null> => {
    const existing = periods.find(p => p.year === year && p.month === month);
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from("periods")
      .insert({ year, month, status: "open" })
      .select("id")
      .single();

    if (error || !data) return null;

    await fetchPeriods();
    return data.id;
  };

  return (
    <PeriodContext.Provider value={{ periods, selectedPeriod, setSelectedPeriod, loading, ensurePeriod }}>
      {children}
    </PeriodContext.Provider>
  );
};

export const usePeriod = () => {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error("usePeriod must be used within PeriodProvider");
  return ctx;
};
