import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Mail, FileText, FileDown, ChevronLeft, ChevronRight } from "lucide-react";
import { format, subDays } from "date-fns";

// ── Types ──

type EmailNfStatus = "pendente" | "classificada" | "processada" | "erro" | "ignorada";
type EmailNfModelo = "nfe_55" | "nfse" | "nfcom_62" | "cte_57" | "outro" | "sem_xml";

interface EmailNotaFiscal {
  id: string;
  status: EmailNfStatus;
  email_received_at: string | null;
  modelo: EmailNfModelo;
  numero_nota: string | null;
  serie: string | null;
  emitente_nome: string | null;
  emitente_cnpj: string | null;
  empresa_filial: string | null;
  valor_total: number | null;
  tem_xml: boolean;
  tem_pdf: boolean;
}

// ── Helpers ──

const PAGE_SIZE = 20;

const statusConfig: Record<EmailNfStatus, { label: string; className: string }> = {
  pendente: { label: "Pendente", className: "bg-amber-100 text-amber-800 border-amber-200" },
  classificada: { label: "Classificada", className: "bg-blue-100 text-blue-800 border-blue-200" },
  processada: { label: "Processada", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  erro: { label: "Erro", className: "bg-red-100 text-red-800 border-red-200" },
  ignorada: { label: "Ignorada", className: "bg-muted text-muted-foreground border-border" },
};

const modeloConfig: Record<EmailNfModelo, { label: string; className: string }> = {
  nfe_55: { label: "NF-e", className: "bg-blue-100 text-blue-800 border-blue-200" },
  nfse: { label: "NFS-e", className: "bg-purple-100 text-purple-800 border-purple-200" },
  nfcom_62: { label: "NFCOM", className: "bg-teal-100 text-teal-800 border-teal-200" },
  cte_57: { label: "CT-e", className: "bg-amber-100 text-amber-800 border-amber-200" },
  outro: { label: "Outro", className: "bg-muted text-muted-foreground border-border" },
  sem_xml: { label: "Sem XML", className: "border-border text-muted-foreground" },
};

const empresaLabels: Record<string, string> = {
  "1.01": "P&F",
  "2.01": "Biocollagen",
};

const fmtCNPJ = (cnpj: string) => {
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    const now = new Date();
    if (dt.getFullYear() !== now.getFullYear()) {
      return format(dt, "dd/MM/yy HH:mm");
    }
    return format(dt, "dd/MM HH:mm");
  } catch {
    return d;
  }
};

// ── Component ──

export default function EmailNfe() {
  const today = new Date();
  const thirtyDaysAgo = subDays(today, 30);

  const [dateFrom, setDateFrom] = useState(() => format(thirtyDaysAgo, "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(() => format(today, "yyyy-MM-dd"));
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterModelo, setFilterModelo] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // ── KPIs ──
  const { data: kpis } = useQuery({
    queryKey: ["email-nfe-kpis"],
    queryFn: async () => {
      const counts = { total: 0, pendente: 0, processada: 0, erro: 0 };

      const { count: total } = await (supabase as any)
        .from("email_notas_fiscais")
        .select("id", { count: "exact", head: true });
      counts.total = total || 0;

      const { count: pendente } = await (supabase as any)
        .from("email_notas_fiscais")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente");
      counts.pendente = pendente || 0;

      const { count: processada } = await (supabase as any)
        .from("email_notas_fiscais")
        .select("id", { count: "exact", head: true })
        .eq("status", "processada");
      counts.processada = processada || 0;

      const { count: erro } = await (supabase as any)
        .from("email_notas_fiscais")
        .select("id", { count: "exact", head: true })
        .eq("status", "erro");
      counts.erro = erro || 0;

      return counts;
    },
  });

  // ── Main query ──
  const offset = (page - 1) * PAGE_SIZE;

  const { data: queryResult, isLoading } = useQuery({
    queryKey: ["email-nfe-list", dateFrom, dateTo, filterStatus, filterModelo, search, page],
    queryFn: async () => {
      let q = supabase
        .from("email_notas_fiscais")
        .select(
          "id, status, email_received_at, modelo, numero_nota, serie, emitente_nome, emitente_cnpj, empresa_filial, valor_total, tem_xml, tem_pdf",
          { count: "exact" }
        )
        .order("email_received_at", { ascending: false });

      // Period filter
      if (dateFrom) q = q.gte("email_received_at", dateFrom + "T00:00:00");
      if (dateTo) q = q.lte("email_received_at", dateTo + "T23:59:59");

      // Status filter
      if (filterStatus !== "all") q = q.eq("status", filterStatus);

      // Modelo filter
      if (filterModelo !== "all") q = q.eq("modelo", filterModelo);

      // Search
      if (search.trim()) {
        q = q.or(`emitente_nome.ilike.%${search.trim()}%,numero_nota.ilike.%${search.trim()}%`);
      }

      q = q.range(offset, offset + PAGE_SIZE - 1);

      const { data, count, error } = await q;
      if (error) throw error;
      return { rows: (data || []) as EmailNotaFiscal[], total: count || 0 };
    },
  });

  const rows = queryResult?.rows || [];
  const totalCount = queryResult?.total || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const showFrom = totalCount === 0 ? 0 : offset + 1;
  const showTo = Math.min(offset + PAGE_SIZE, totalCount);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Email NF-e</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Recebidas</p>
            <p className="text-2xl font-bold">{kpis?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Pendentes</p>
            <p className={`text-2xl font-bold ${(kpis?.pendente ?? 0) > 0 ? "text-amber-600" : ""}`}>
              {kpis?.pendente ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Processadas</p>
            <p className="text-2xl font-bold text-emerald-600">{kpis?.processada ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Erros</p>
            <p className={`text-2xl font-bold ${(kpis?.erro ?? 0) > 0 ? "text-red-600" : ""}`}>
              {kpis?.erro ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">De</label>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="w-[150px]" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Até</label>
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="w-[150px]" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="classificada">Classificada</SelectItem>
              <SelectItem value="processada">Processada</SelectItem>
              <SelectItem value="erro">Erro</SelectItem>
              <SelectItem value="ignorada">Ignorada</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Modelo</label>
          <Select value={filterModelo} onValueChange={(v) => { setFilterModelo(v); setPage(1); }}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="nfe_55">NF-e</SelectItem>
              <SelectItem value="nfse">NFS-e</SelectItem>
              <SelectItem value="nfcom_62">NFCOM</SelectItem>
              <SelectItem value="cte_57">CT-e</SelectItem>
              <SelectItem value="outro">Outro</SelectItem>
              <SelectItem value="sem_xml">Sem XML</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Busca</label>
          <Input
            placeholder="Emitente ou número..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-[220px]"
          />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Mail className="h-12 w-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">Nenhuma nota fiscal recebida</p>
          <p className="text-sm">As notas fiscais aparecerão aqui quando forem recebidas por email.</p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Recebido</TableHead>
                <TableHead>Modelo</TableHead>
                <TableHead>Número</TableHead>
                <TableHead>Emitente</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Anexos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const sc = statusConfig[row.status] || statusConfig.pendente;
                const mc = modeloConfig[row.modelo] || modeloConfig.outro;
                const isErro = row.status === "erro";
                const isPendente = row.status === "pendente";

                return (
                  <TableRow
                    key={row.id}
                    className={`${isErro ? "bg-red-50" : ""} ${isPendente ? "font-medium" : ""}`}
                  >
                    <TableCell>
                      <Badge variant="outline" className={`${sc.className} text-[10px] whitespace-nowrap`}>
                        {sc.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{fmtDate(row.email_received_at)}</TableCell>
                    <TableCell>
                      <Badge variant={row.modelo === "sem_xml" ? "outline" : "outline"} className={`${mc.className} text-[10px] whitespace-nowrap`}>
                        {mc.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {row.numero_nota || row.serie
                        ? `${row.numero_nota || ""}${row.serie ? "/" + row.serie : ""}`
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {row.emitente_nome ? (
                        <div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <p className="max-w-[200px] truncate text-sm">{row.emitente_nome}</p>
                            </TooltipTrigger>
                            <TooltipContent>{row.emitente_nome}</TooltipContent>
                          </Tooltip>
                          {row.emitente_cnpj && (
                            <p className="text-xs text-muted-foreground">{fmtCNPJ(row.emitente_cnpj)}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.empresa_filial ? (
                        <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                          {empresaLabels[row.empresa_filial] || row.empresa_filial}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row.valor_total ? fmtBRL(row.valor_total) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {row.tem_xml && (
                          <Tooltip>
                            <TooltipTrigger><FileText className="h-4 w-4 text-blue-500" /></TooltipTrigger>
                            <TooltipContent>XML</TooltipContent>
                          </Tooltip>
                        )}
                        {row.tem_pdf && (
                          <Tooltip>
                            <TooltipTrigger><FileDown className="h-4 w-4 text-red-500" /></TooltipTrigger>
                            <TooltipContent>PDF</TooltipContent>
                          </Tooltip>
                        )}
                        {!row.tem_xml && !row.tem_pdf && <span className="text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Exibindo {showFrom} a {showTo} de {totalCount} registros</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
              </Button>
              <span>Página {page} de {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Próximo <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
