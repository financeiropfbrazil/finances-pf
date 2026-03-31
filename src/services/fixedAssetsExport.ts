import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

interface ExportParams {
  periodId: string;
  periodYear: number;
  periodMonth: number;
  categories: { id: string; code: string; label: string; account_asset: string; account_depreciation?: string | null }[];
  items: any[];
  reconciliation: any[];
  categoryIdLabelMap: Map<string, string>;
  periods: { id: string; year: number; month: number }[];
}

const fmtBRL = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("pt-BR") : "";
const MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

export async function exportFixedAssetsExcel(params: ExportParams) {
  const { periodId, periodYear, periodMonth, categories, items, reconciliation, categoryIdLabelMap, periods } = params;
  const wb = XLSX.utils.book_new();
  const periodLabel = `${MONTHS[periodMonth - 1]}/${periodYear}`;
  const now = new Date().toLocaleDateString("pt-BR") + " " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  // --- Aba 1: Inventário Completo ---
  const catMap = new Map(categories.map(c => [c.code, c]));
  const invHeader = [
    ["Relatório de Imobilizado — P&F Brasil"],
    [`Período: ${periodLabel}`],
    [`Gerado em: ${now}`],
    [],
    ["Código","Patrimônio","Descrição","Categoria","Conta Contábil","Localização","Responsável","Departamento",
     "Data Aquisição","Vida Útil (meses)","Taxa Depr. (%)","Valor Bruto","Depr. Acumulada","Valor Líquido","Status","Origem"],
  ];
  const invRows = items.map((i: any) => {
    const cat = catMap.get(i.category);
    return [
      i.asset_code, i.asset_tag ?? "", i.asset_description, cat?.label ?? i.category, cat?.account_asset ?? "",
      i.location ?? "", i.responsible_name ?? "", i.responsible_department ?? "",
      fmtDate(i.acquisition_date), i.useful_life_months ?? "", i.monthly_depreciation_rate ?? "",
      Number(i.gross_value), Number(i.accumulated_depreciation), Number(i.net_value ?? (Number(i.gross_value) - Number(i.accumulated_depreciation))),
      i.status === "ativo" ? "Ativo" : i.status === "baixado" ? "Baixado" : i.status,
      i.source === "auditoria" ? "Auditoria" : i.source === "alvo" ? "ERP" : "Manual",
    ];
  });
  const ws1 = XLSX.utils.aoa_to_sheet([...invHeader, ...invRows]);
  ws1["!cols"] = [
    { wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 20 }, { wch: 18 }, { wch: 15 }, { wch: 18 }, { wch: 15 },
    { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 10 },
  ];
  // Format BRL columns (L, M, N = cols 11,12,13 in data rows starting at row 6)
  for (let r = 5; r < 5 + invRows.length; r++) {
    for (const c of [11, 12, 13]) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws1[addr]) ws1[addr].t = "n";
    }
  }
  XLSX.utils.book_append_sheet(wb, ws1, "Inventário Completo");

  // --- Aba 2: Movimentação do Mês ---
  const { data: depHistory } = await supabase
    .from("depreciation_history").select("category_id, depreciation_amount").eq("period_id", periodId);
  const hasDepreciation = (depHistory ?? []).length > 0;

  if (hasDepreciation) {
    // Find prior period
    const priorDate = new Date(periodYear, periodMonth - 2, 1);
    const priorYear = priorDate.getFullYear();
    const priorMo = priorDate.getMonth() + 1;
    const priorPeriod = periods.find(p => p.year === priorYear && p.month === priorMo);

    let priorItems: any[] = [];
    if (priorPeriod) {
      const { data } = await supabase.from("fixed_assets_items")
        .select("category_id, gross_value, accumulated_depreciation, status")
        .eq("period_id", priorPeriod.id).eq("status", "ativo");
      priorItems = data ?? [];
    }

    const priorByCat: Record<string, number> = {};
    for (const item of priorItems) {
      const cid = item.category_id ?? "_none";
      priorByCat[cid] = (priorByCat[cid] ?? 0) + Number(item.gross_value) - Number(item.accumulated_depreciation);
    }

    const periodStart = new Date(periodYear, periodMonth - 1, 1);
    const periodEnd = new Date(periodYear, periodMonth, 0);

    const movRows: any[][] = [];
    const totals = { prior: 0, acq: 0, disp: 0, dep: 0, final: 0 };

    for (const cat of categories) {
      const catItems = items.filter((i: any) => i.category_id === cat.id);
      const acq = catItems.filter((i: any) => {
        if (!i.acquisition_date) return false;
        const d = new Date(i.acquisition_date);
        return d >= periodStart && d <= periodEnd;
      }).reduce((s: number, i: any) => s + Number(i.gross_value), 0);
      const disp = catItems.filter((i: any) => i.status === "baixado").reduce((s: number, i: any) => s + Number(i.gross_value), 0);
      const dep = (depHistory ?? []).filter((d: any) => d.category_id === cat.id).reduce((s: number, d: any) => s + Number(d.depreciation_amount), 0);
      const prior = priorByCat[cat.id] ?? 0;
      const finalBal = catItems.filter((i: any) => i.status === "ativo").reduce((s: number, i: any) => s + Number(i.gross_value) - Number(i.accumulated_depreciation), 0);

      if (prior || acq || disp || dep || finalBal) {
        movRows.push([`${cat.account_asset} ${cat.label}`, prior, acq, disp, dep, finalBal]);
        totals.prior += prior; totals.acq += acq; totals.disp += disp; totals.dep += dep; totals.final += finalBal;
      }
    }

    const movHeader = [
      ["Relatório de Imobilizado — P&F Brasil"],
      [`Período: ${periodLabel}`],
      [`Gerado em: ${now}`],
      [],
      ["Conta","Saldo Anterior","(+) Aquisições","(-) Baixas","(-) Depreciação Mês","(=) Saldo Final"],
    ];
    movRows.push(["TOTAL", totals.prior, totals.acq, totals.disp, totals.dep, totals.final]);

    const ws2 = XLSX.utils.aoa_to_sheet([...movHeader, ...movRows]);
    ws2["!cols"] = [{ wch: 35 }, { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws2, "Movimentação do Mês");
  }

  // --- Aba 3: Conciliação Contábil ---
  const reconHeader = [
    ["Relatório de Imobilizado — P&F Brasil"],
    [`Período: ${periodLabel}`],
    [`Gerado em: ${now}`],
    [],
    ["Conta Ativo","Conta Depreciação","Categoria","Valor Bruto","Depr. Acumulada","Líquido Gerencial",
     "Saldo Ctb. Ativo","Saldo Ctb. Depr.","Líquido Contábil","Diferença","Status"],
  ];
  const reconRows = reconciliation.map((r: any) => {
    const netVal = Number(r.net_value ?? 0);
    const accNet = Number(r.accounting_net ?? 0);
    const diff = Number(r.difference ?? netVal - accNet);
    const statusLabel = r.status === "reconciled" ? "Conciliado" : r.status === "justified" ? "Justificado" : "Divergente";
    return [
      r.account_asset, r.account_depreciation ?? "", categoryIdLabelMap.get(r.category_id) ?? "—",
      r.gross_value, r.accumulated_depreciation, netVal,
      Number(r.accounting_balance_asset ?? 0), Number(r.accounting_balance_depreciation ?? 0), accNet,
      diff, statusLabel,
    ];
  });
  // Totals
  if (reconRows.length > 0) {
    const t = reconciliation.reduce((acc: any, r: any) => ({
      gross: acc.gross + Number(r.gross_value), dep: acc.dep + Number(r.accumulated_depreciation),
      net: acc.net + Number(r.net_value ?? 0), balA: acc.balA + Number(r.accounting_balance_asset ?? 0),
      balD: acc.balD + Number(r.accounting_balance_depreciation ?? 0), accNet: acc.accNet + Number(r.accounting_net ?? 0),
      diff: acc.diff + Number(r.difference ?? 0),
    }), { gross: 0, dep: 0, net: 0, balA: 0, balD: 0, accNet: 0, diff: 0 });
    reconRows.push(["TOTAL", "", "", t.gross, t.dep, t.net, t.balA, t.balD, t.accNet, t.diff, ""]);
  }

  const ws3 = XLSX.utils.aoa_to_sheet([...reconHeader, ...reconRows]);
  ws3["!cols"] = [{ wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws3, "Conciliação Contábil");

  // Download
  const filename = `Imobilizado_${periodYear}_${String(periodMonth).padStart(2, "0")}.xlsx`;
  XLSX.writeFile(wb, filename);
}
