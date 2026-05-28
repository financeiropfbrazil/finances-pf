import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Calendar as CalendarIcon,
  Loader2,
  DollarSign,
  Clock,
  FileClock,
  Filter,
  X,
  TrendingUp,
  Package,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { getDashboardSuprimentos, type PeriodoFiltro } from "@/services/dashboardSuprimentosService";

// ════════════════════════════════════════════════════════════
// FORMATADORES
// ════════════════════════════════════════════════════════════

function formatBRL(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor));
}

function formatBRLCompact(valor: number): string {
  if (valor >= 1_000_000) return `R$ ${(valor / 1_000_000).toFixed(1)}M`;
  if (valor >= 1_000) return `R$ ${(valor / 1_000).toFixed(0)}k`;
  return formatBRL(valor);
}

function formatDias(dias: number | null): string {
  if (dias === null) return "—";
  if (dias < 1) {
    const horas = dias * 24;
    return `${horas.toFixed(1)}h`;
  }
  return `${dias.toFixed(1)} ${dias === 1 ? "dia" : "dias"}`;
}

// ════════════════════════════════════════════════════════════
// COMPONENTE
// ════════════════════════════════════════════════════════════

export default function SuprimentosDashboard() {
  const [dataDe, setDataDe] = useState<Date | undefined>(undefined);
  const [dataAte, setDataAte] = useState<Date | undefined>(undefined);

  const periodo: PeriodoFiltro = useMemo(
    () => ({
      dataDe: dataDe ? format(dataDe, "yyyy-MM-dd") : null,
      dataAte: dataAte ? format(dataAte, "yyyy-MM-dd") : null,
    }),
    [dataDe, dataAte],
  );

  const temFiltro = !!dataDe || !!dataAte;

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard_suprimentos", periodo.dataDe, periodo.dataAte],
    queryFn: () => getDashboardSuprimentos(periodo),
  });

  const limparFiltro = () => {
    setDataDe(undefined);
    setDataAte(undefined);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard de Suprimentos</h1>
        <p className="text-sm text-muted-foreground">Visão geral de requisições e pedidos de compra.</p>
      </div>

      {/* Filtro de período */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Período</span>
            <span className="text-xs text-muted-foreground">(afeta os cards e o funil)</span>
            {temFiltro && (
              <Button variant="ghost" size="sm" onClick={limparFiltro} className="ml-auto h-7 text-xs">
                <X className="mr-1 h-3 w-3" /> Limpar
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:max-w-md">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Data de</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-full justify-start text-left font-normal h-9 text-xs",
                      !dataDe && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {dataDe ? format(dataDe, "dd/MM/yyyy", { locale: ptBR }) : "—"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dataDe} onSelect={setDataDe} initialFocus locale={ptBR} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Data até</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-full justify-start text-left font-normal h-9 text-xs",
                      !dataAte && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {dataAte ? format(dataAte, "dd/MM/yyyy", { locale: ptBR }) : "—"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dataAte} onSelect={setDataAte} initialFocus locale={ptBR} />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !data ? (
        <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
          <p>Não foi possível carregar os dados.</p>
        </div>
      ) : (
        <>
          {/* Cards de números */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Valor médio */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Valor médio do pedido</p>
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                </div>
                <p className="mt-2 text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                  {formatBRL(data.valorMedio.valorMedio)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.valorMedio.qtd} pedidos · total {formatBRLCompact(data.valorMedio.valorTotal)}
                </p>
              </CardContent>
            </Card>

            {/* Tempo médio de aprovação */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Tempo médio de aprovação</p>
                  <Clock className="h-4 w-4 text-amber-600" />
                </div>
                <p className="mt-2 text-3xl font-bold text-foreground">{formatDias(data.tempoAprovacao.diasMedio)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.tempoAprovacao.qtd > 0
                    ? `${data.tempoAprovacao.qtd} aprovações · de ${formatDias(data.tempoAprovacao.diasMin)} a ${formatDias(data.tempoAprovacao.diasMax)}`
                    : "Sem aprovações no período"}
                </p>
              </CardContent>
            </Card>

            {/* Tempo médio req → pedido */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">Tempo médio req → pedido</p>
                  <FileClock className="h-4 w-4 text-blue-600" />
                </div>
                <p className="mt-2 text-3xl font-bold text-foreground">{formatDias(data.tempoReqPedido.diasMedio)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.tempoReqPedido.qtd > 0
                    ? `${data.tempoReqPedido.qtd} ${data.tempoReqPedido.qtd === 1 ? "conversão" : "conversões"} via Hub`
                    : "Sem conversões via Hub no período"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Funil de status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4" />
                Funil de status dos pedidos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const totalFunil = data.funil.reduce((s, e) => s + e.qtd, 0);
                if (totalFunil === 0) {
                  return <p className="text-sm text-muted-foreground">Nenhum pedido no período.</p>;
                }
                return (
                  <div className="space-y-3">
                    {data.funil.map((estagio) => {
                      const pct = totalFunil > 0 ? (estagio.qtd / totalFunil) * 100 : 0;
                      return (
                        <div key={estagio.estagio}>
                          <div className="mb-1 flex items-center justify-between text-sm">
                            <span className="font-medium">{estagio.estagio}</span>
                            <span className="text-muted-foreground">
                              {estagio.qtd} ({pct.toFixed(0)}%)
                            </span>
                          </div>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, backgroundColor: estagio.cor }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    <p className="pt-2 text-xs text-muted-foreground">Total: {totalFunil} pedidos</p>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* Volume mensal — sempre últimos 6 meses (independe do filtro) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4" />
                Volume mensal de pedidos
                <span className="text-xs font-normal text-muted-foreground">(últimos 6 meses)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.volumeMensal.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem dados nos últimos 6 meses.</p>
              ) : (
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.volumeMensal} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                      <XAxis dataKey="mesLabel" tick={{ fontSize: 12 }} className="text-muted-foreground" />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 12 }}
                        className="text-muted-foreground"
                        label={{ value: "Qtd", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 12 }}
                        className="text-muted-foreground"
                        tickFormatter={(v) => formatBRLCompact(v)}
                      />
                      <RechartsTooltip
                        formatter={(value: any, name: string) => {
                          if (name === "Total (R$)") return [formatBRL(value), name];
                          return [value, "Volume (qtd)"];
                        }}
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: "12px" }} />
                      <Bar yAxisId="left" dataKey="qtd" name="Volume (qtd)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar
                        yAxisId="right"
                        dataKey="valorTotal"
                        name="Total (R$)"
                        fill="#059669"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
