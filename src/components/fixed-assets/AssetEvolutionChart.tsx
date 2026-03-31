import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp } from "lucide-react";

interface ChartPoint {
  label: string;
  gross: number;
  depreciation: number;
  net: number;
}

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export default function AssetEvolutionChart() {
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);

      // Get last 12 periods
      const { data: periods } = await supabase
        .from("periods")
        .select("id, year, month")
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(12);

      if (!periods || periods.length === 0) {
        setLoading(false);
        return;
      }

      // Reverse to chronological order
      const sorted = [...periods].reverse();
      const periodIds = sorted.map(p => p.id);

      // Fetch all active items for these periods in one query
      const { data: items } = await supabase
        .from("fixed_assets_items")
        .select("period_id, gross_value, accumulated_depreciation, status")
        .in("period_id", periodIds)
        .eq("status", "ativo");

      // Aggregate by period
      const byPeriod = new Map<string, { gross: number; dep: number }>();
      for (const item of items ?? []) {
        const cur = byPeriod.get(item.period_id) ?? { gross: 0, dep: 0 };
        cur.gross += Number(item.gross_value);
        cur.dep += Number(item.accumulated_depreciation);
        byPeriod.set(item.period_id, cur);
      }

      const chartData: ChartPoint[] = sorted.map(p => {
        const agg = byPeriod.get(p.id) ?? { gross: 0, dep: 0 };
        return {
          label: `${MONTH_LABELS[p.month - 1]}/${String(p.year).slice(2)}`,
          gross: agg.gross,
          depreciation: agg.dep,
          net: agg.gross - agg.dep,
        };
      });

      setData(chartData);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-primary" />
          Evolução do Imobilizado
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <YAxis
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              width={50}
            />
            <Tooltip
              formatter={(value: number, name: string) => [
                formatBRL(value),
                name === "gross" ? "Valor Bruto" : name === "depreciation" ? "Depr. Acumulada" : "Valor Líquido",
              ]}
              labelStyle={{ fontWeight: 600 }}
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Legend
              formatter={(value) =>
                value === "gross" ? "Valor Bruto" : value === "depreciation" ? "Depr. Acumulada" : "Valor Líquido"
              }
              wrapperStyle={{ fontSize: 11 }}
            />
            <Line
              type="monotone"
              dataKey="gross"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="depreciation"
              stroke="hsl(var(--destructive))"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="net"
              stroke="hsl(var(--success))"
              strokeWidth={3}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
