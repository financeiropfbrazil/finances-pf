import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Loader2, RotateCcw } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";
import * as XLSX from "xlsx";

type ContaPagar = {
  id: string;
  chave_docfin: number;
  numero: string | null;
  especie: string | null;
  codigo_situacao: string | null;
  nome_situacao: string | null;
  nome_entidade: string | null;
  cnpj_cpf: string | null;
  valor_bruto: number | null;
  valor_pago: number | null;
  data_vencimento: string | null;
  data_competencia: string | null;
  data_emissao: string | null;
  data_pagamento: string | null;
  classe_rec_desp: string | null;
  centro_custo: string | null;
};

const agingColors = ["#ef4444", "#f97316", "#eab308", "#38bdf8", "#3b82f6", "#9ca3af"];

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });

const defaultInicio = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const defaultFim = () => {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
};

const CustomTooltip = ({ active, payload, label, labelPrefix }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded bg-gray-900 px-3 py-1.5 text-xs text-white shadow-lg">
      {labelPrefix && <p className="mb-0.5 text-gray-400">{labelPrefix}{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-medium">{fmtBRL(p.value)}</p>
      ))}
    </div>
  );
};

export default function ContasPagarDashboard() {
  const [rows, setRows] = useState<ContaPagar[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataInicio, setDataInicio] = useState(defaultInicio);
  const [dataFim, setDataFim] = useState(defaultFim);
  const [exporting, setExporting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    let all: ContaPagar[] = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
      const { data } = await supabase
        .from("contas_pagar")
        .select("id,chave_docfin,numero,especie,codigo_situacao,nome_situacao,nome_entidade,cnpj_cpf,valor_bruto,valor_pago,data_vencimento,data_competencia,data_emissao,data_pagamento,classe_rec_desp,centro_custo")
        .range(from, from + batchSize - 1);
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < batchSize) break;
      from += batchSize;
    }
    setRows(all);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const filtered = useMemo(() =>
    rows.filter(r => {
      const dv = r.data_vencimento;
      if (!dv) return false;
      return dv >= dataInicio && dv <= dataFim;
    }),
  [rows, dataInicio, dataFim]);

  const hoje = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const hojeStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // === KPIs ===
  const kpis = useMemo(() => {
    let totalAberto = 0, vencidos = 0, aVencer30 = 0, pagoNoPeriodo = 0;
    const hoje30 = new Date(hoje);
    hoje30.setDate(hoje30.getDate() + 30);
    const hoje30Str = `${hoje30.getFullYear()}-${String(hoje30.getMonth() + 1).padStart(2, "0")}-${String(hoje30.getDate()).padStart(2, "0")}`;

    filtered.forEach(r => {
      const sit = r.codigo_situacao;
      if (sit === "02.001" || sit === "02.004") {
        totalAberto += r.valor_bruto || 0;
      }
      if (sit === "02.001" && r.data_vencimento && r.data_vencimento < hojeStr) {
        vencidos += r.valor_bruto || 0;
      }
      if (sit === "02.001" && r.data_vencimento && r.data_vencimento >= hojeStr && r.data_vencimento <= hoje30Str) {
        aVencer30 += r.valor_bruto || 0;
      }
      if (sit === "02.002" && r.data_pagamento && r.data_pagamento >= dataInicio && r.data_pagamento <= dataFim) {
        pagoNoPeriodo += r.valor_pago || 0;
      }
    });
    return [
      { label: "Total em Aberto", value: totalAberto, color: "border-yellow-500/40 bg-yellow-500/5", textColor: "text-yellow-600 dark:text-yellow-400" },
      { label: "Vencidos", value: vencidos, color: "border-red-500/40 bg-red-500/5", textColor: "text-red-600 dark:text-red-400" },
      { label: "A Vencer (30 dias)", value: aVencer30, color: "border-blue-500/40 bg-blue-500/5", textColor: "text-blue-600 dark:text-blue-400" },
      { label: "Pago no Período", value: pagoNoPeriodo, color: "border-green-500/40 bg-green-500/5", textColor: "text-green-600 dark:text-green-400" },
    ];
  }, [filtered, hojeStr, hoje, dataInicio, dataFim]);

  // === Cashflow — últimos 12 meses de pagamentos ===
  const cashflowData = useMemo(() => {
    const meses = new Map<string, number>();
    const cur = new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1);
    for (let i = 0; i < 12; i++) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
      meses.set(key, 0);
      cur.setMonth(cur.getMonth() + 1);
    }
    rows.forEach(r => {
      if (r.codigo_situacao !== "02.002" || !r.data_pagamento) return;
      const key = r.data_pagamento.slice(0, 7);
      if (meses.has(key)) meses.set(key, meses.get(key)! + (r.valor_pago || 0));
    });
    return Array.from(meses.entries()).map(([key, valor]) => ({
      mes: key.slice(5) + "/" + key.slice(2, 4),
      valor,
    }));
  }, [rows, hoje]);

  // === Aging ===
  const agingData = useMemo(() => {
    const faixas = [
      { name: "Vencido", total: 0 },
      { name: "Hoje", total: 0 },
      { name: "1-7d", total: 0 },
      { name: "8-15d", total: 0 },
      { name: "16-30d", total: 0 },
      { name: "30+d", total: 0 },
    ];
    filtered.filter(r => r.codigo_situacao === "02.001").forEach(r => {
      if (!r.data_vencimento) return;
      const venc = new Date(r.data_vencimento + "T00:00:00");
      const diff = Math.floor((venc.getTime() - hoje.getTime()) / 86400000);
      const v = r.valor_bruto || 0;
      if (diff < 0) faixas[0].total += v;
      else if (diff === 0) faixas[1].total += v;
      else if (diff <= 7) faixas[2].total += v;
      else if (diff <= 15) faixas[3].total += v;
      else if (diff <= 30) faixas[4].total += v;
      else faixas[5].total += v;
    });
    return faixas;
  }, [filtered, hoje]);

  // === Top 10 ===
  const top10Data = useMemo(() => {
    const map = new Map<string, { saldo: number; fullName: string }>();
    filtered.filter(r => r.codigo_situacao === "02.001").forEach(r => {
      const name = r.nome_entidade || "Sem nome";
      const existing = map.get(name);
      const saldo = (r.valor_bruto || 0) - (r.valor_pago || 0);
      if (existing) existing.saldo += saldo;
      else map.set(name, { saldo, fullName: name });
    });
    return Array.from(map.values())
      .map(e => ({ name: e.fullName.length > 25 ? e.fullName.slice(0, 25) + "…" : e.fullName, saldo: e.saldo, fullName: e.fullName }))
      .sort((a, b) => b.saldo - a.saldo)
      .slice(0, 10);
  }, [filtered]);

  // === Pagos vs Abertos (donut) ===
  const pagosAbertosData = useMemo(() => {
    let aberto = 0, pago = 0;
    filtered.forEach(r => {
      const sit = r.codigo_situacao;
      if (sit === "02.001" || sit === "02.004" || sit === "02.006") aberto += r.valor_bruto || 0;
      if (sit === "02.002") pago += r.valor_pago || 0;
    });
    return [
      { name: "Em Aberto", valor: aberto },
      { name: "Pago", valor: pago },
    ];
  }, [filtered]);

  // === Títulos Atrasados ===
  const atrasados = useMemo(() => {
    return filtered
      .filter(r => r.codigo_situacao === "02.001" && r.data_vencimento && r.data_vencimento < hojeStr)
      .map(r => {
        const venc = new Date(r.data_vencimento + "T00:00:00");
        const dias = Math.floor((hoje.getTime() - venc.getTime()) / 86400000);
        return { ...r, diasAtraso: dias };
      })
      .sort((a, b) => b.diasAtraso - a.diasAtraso)
      .slice(0, 10);
  }, [filtered, hoje, hojeStr]);

  // === Competência ===
  const competenciaData = useMemo(() => {
    const map = new Map<string, { qtd: number; total: number; aberto: number; pago: number }>();
    filtered.forEach(r => {
      const dc = r.data_competencia;
      if (!dc) return;
      const key = dc.slice(0, 7);
      if (!map.has(key)) map.set(key, { qtd: 0, total: 0, aberto: 0, pago: 0 });
      const e = map.get(key)!;
      e.qtd++;
      e.total += r.valor_bruto || 0;
      if (r.codigo_situacao === "02.001" || r.codigo_situacao === "02.004") e.aberto += r.valor_bruto || 0;
      if (r.codigo_situacao === "02.002") e.pago += r.valor_pago || 0;
    });
    return Array.from(map.entries())
      .map(([comp, v]) => ({ comp, ...v }))
      .sort((a, b) => b.comp.localeCompare(a.comp));
  }, [filtered]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data: entidades } = await supabase
        .from("compras_entidades_cache")
        .select("cnpj, codigo_alternativo")
        .not("codigo_alternativo", "is", null);
      const codAltMap = new Map((entidades || []).map(e => [e.cnpj, e.codigo_alternativo]));
      const exportRows = filtered.map(r => ({
        "Competência": r.data_competencia || "",
        "Nº Documento": r.numero || "",
        "Fornecedor": r.nome_entidade || "",
        "CNPJ": r.cnpj_cpf || "",
        "Código Alternativo": codAltMap.get((r.cnpj_cpf || "").replace(/\D/g, "")) || "",
        "Espécie": r.especie || "",
        "Valor Bruto": r.valor_bruto || 0,
        "Valor Pago": r.valor_pago || 0,
        "Saldo": (r.valor_bruto || 0) - (r.valor_pago || 0),
        "Situação": r.nome_situacao || "",
        "Classe Rec/Desp": r.classe_rec_desp || "",
        "Centro de Custo": r.centro_custo || "",
      }));
      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Contas a Pagar");
      XLSX.writeFile(wb, `contas_pagar_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  const resetDates = () => {
    setDataInicio(defaultInicio());
    setDataFim(defaultFim());
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">
      {/* Header + Filtro */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Dashboard — Contas a Pagar</h1>
          <p className="text-xs text-muted-foreground">{filtered.length.toLocaleString("pt-BR")} registros no período</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} className="h-8 w-40 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <Input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} className="h-8 w-40 text-sm" />
          </div>
          <Button variant="ghost" size="sm" onClick={resetDates} title="Resetar para mês atual">
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Limpar
          </Button>
        </div>
      </div>

      {/* Linha 1 — KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(k => (
          <Card key={k.label} className={`border ${k.color}`}>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
              <p className={`mt-1 text-2xl font-bold ${k.textColor}`}>{fmtBRL(k.value)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Linha 2 — Cashflow */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground">Cashflow — Pagamentos Realizados</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={cashflowData}>
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `R$ ${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip labelPrefix="Mês: " />} />
              <Bar dataKey="valor" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Linha 3 — Aging + Top 10 */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground">Aging — Vencimentos por Faixa</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={agingData}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => fmtBRL(v)} tick={{ fontSize: 10 }} width={80} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                  {agingData.map((_, i) => (
                    <Cell key={i} fill={agingColors[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground">Top 10 Fornecedores — Saldo em Aberto</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={top10Data} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" tickFormatter={v => fmtBRL(v)} tick={{ fontSize: 10 }} />
                <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 10 }} />
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="rounded bg-gray-900 px-3 py-1.5 text-xs text-white shadow-lg">
                      <p className="mb-0.5 text-gray-400">{d.fullName}</p>
                      <p className="font-medium">{fmtBRL(d.saldo)}</p>
                    </div>
                  );
                }} />
                <Bar dataKey="saldo" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Linha 4 — Donut + Atrasados */}
      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground">Pagos vs Abertos</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pagosAbertosData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="valor" paddingAngle={2}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  <Cell fill="#eab308" />
                  <Cell fill="#22c55e" />
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground">Títulos Atrasados</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[310px] overflow-auto">
            {atrasados.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nenhum título atrasado 🎉</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead>Nº Doc</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Dias</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {atrasados.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="max-w-[140px] truncate text-xs">{r.nome_entidade || "—"}</TableCell>
                      <TableCell className="text-xs">{r.numero || "—"}</TableCell>
                      <TableCell className="text-xs">{r.data_vencimento ? r.data_vencimento.split("-").reverse().join("/") : "—"}</TableCell>
                      <TableCell className="text-right text-xs font-medium text-red-600 dark:text-red-400">{r.diasAtraso}</TableCell>
                      <TableCell className="text-right text-xs font-medium text-red-600 dark:text-red-400">{fmtBRL(r.valor_bruto || 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Linha 5 — Competência */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground">Contas a Pagar por Competência</CardTitle>
          <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
            Exportar
          </Button>
        </CardHeader>
        <CardContent className="max-h-[320px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Competência</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Valor Total</TableHead>
                <TableHead className="text-right">Em Aberto</TableHead>
                <TableHead className="text-right">Pago</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {competenciaData.map(row => (
                <TableRow key={row.comp}>
                  <TableCell>{row.comp.slice(5) + "/" + row.comp.slice(0, 4)}</TableCell>
                  <TableCell className="text-right">{row.qtd}</TableCell>
                  <TableCell className="text-right">{fmtBRL(row.total)}</TableCell>
                  <TableCell className="text-right">{fmtBRL(row.aberto)}</TableCell>
                  <TableCell className="text-right">{fmtBRL(row.pago)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
