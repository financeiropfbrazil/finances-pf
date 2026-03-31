import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AssetCategory {
  id: string;
  code: string;
  label: string;
  account_asset: string;
  account_depreciation: string | null;
  depreciable: boolean;
  default_monthly_rate: number | null;
  default_useful_life_months: number | null;
  sort_order: number | null;
}

export function useFixedAssetsCategories() {
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("fixed_assets_categories")
        .select("*")
        .order("sort_order");
      if (data) setCategories(data as unknown as AssetCategory[]);
      setLoading(false);
    })();
  }, []);

  const labelMap = new Map(categories.map(c => [c.code, c.label]));
  const getLabel = (code: string) => labelMap.get(code) ?? code;

  return { categories, loading, getLabel };
}
