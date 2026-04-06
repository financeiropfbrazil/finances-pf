import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Mail, ChevronLeft, ChevronRight } from "lucide-react";
import EmailNfeDetailSheet from "@/components/email-nfe/EmailNfeDetailSheet";
import EmailNfeTable, { type EmailNotaFiscal } from "@/components/email-nfe/EmailNfeTable";
import { useComprasStatus } from "@/components/email-nfe/useComprasStatus";
import { format, subDays } from "date-fns";

const PAGE_SIZE = 20;

export default function EmailNfe() {
  const queryClient = useQueryClient();
  const today = new Date();
  const thirtyDaysAgo = subDays(today, 30);

  const [dateFrom, setDateFrom] = useState(() => format(thirtyDaysAgo, "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(() => format(today, "yyyy-MM-dd"));
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterModelo, setFilterModelo] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedNfId, setSelectedNfId] = useState<string | null>(null);

  // ── KPIs ──
  const { data: kpis } = useQuery({
    queryKey: ["email-nfe-kpis"],
    queryFn: async () => {
      const counts = { total: 0, pendente: 0, processada: 0, erro: 0, importadas: 0 };

      const { count: total } = await (supabase as any)
        .from("email_notas_fiscais")
        .select("id", { count: "exact", head: true })
        .neq("status", "ignorada");
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
      counts.importadas = processada || 0;

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
      let q = (supabase as any)
        .from("email_notas_fiscais")
        .select(
          "id, status, email_received_at, modelo, numero_nota, serie, emitente_nome, emitente_cnpj, empresa_filial, valor_total, tem_xml, tem_pdf, xml_storage_path, pdf_storage_path, chave_acesso",
          { count: "exact" }
        )
        .order("email_received_at", { ascending: false })
        .neq("status", "ignorada");

      if (dateFrom) q = q.gte("email_received_at", dateFrom + "T00:00:00");
      if (dateTo) q = q.lte("email_received_at", dateTo + "T23:59:59");
      if (filterStatus !== "all") q = q.eq("status", filterStatus);
      if (filterModelo !== "all") q = q.eq("modelo", filterModelo);
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

  // ── Compras status check ──
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const { comprasStatus, refreshCheck } = useComprasStatus(rowIds);

  const handleImportDone = () => {
    queryClient.invalidateQueries({ queryKey: ["email-nfe-list"] });
    queryClient.invalidateQueries({ queryKey: ["email-nfe-kpis"] });
    refreshCheck(rowIds);
  };

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold text-foreground">Email NF-e</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
            <p className="text-sm text-muted-foreground">Importadas</p>
            <p className="text-2xl font-bold text-emerald-600">{kpis?.importadas ?? 0}</p>
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
          <EmailNfeTable
            rows={rows}
            comprasStatus={comprasStatus}
            onOpenDetail={setSelectedNfId}
            onImportDone={handleImportDone}
          />

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

      <EmailNfeDetailSheet
        selectedId={selectedNfId}
        onClose={() => setSelectedNfId(null)}
      />
    </div>
  );
}
