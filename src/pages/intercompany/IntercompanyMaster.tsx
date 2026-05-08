import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ArrowDownToLine, ChevronRight, FileText, Loader2, Plus, RefreshCw } from "lucide-react";
import { listarMaster } from "@/services/intercompanyMasterListService";
import type { MasterItem, MasterStatusUnificado } from "@/types/intercompanyMaster";

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const formatEUR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "EUR" });
const formatDate = (iso: string) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// Mapeia status → cor do badge (Tailwind via classes)
const statusColor: Record<MasterStatusUnificado, string> = {
  rascunho: "bg-slate-500/15 text-slate-700 border-slate-300",
  pendente_emissao: "bg-amber-500/15 text-amber-700 border-amber-300",
  emitida: "bg-emerald-500/15 text-emerald-700 border-emerald-300",
  erro: "bg-red-500/15 text-red-700 border-red-300",
  sincronizada: "bg-blue-500/15 text-blue-700 border-blue-300",
  classificada: "bg-violet-500/15 text-violet-700 border-violet-300",
  pendente_eur: "bg-orange-500/15 text-orange-700 border-orange-300",
  pendente_revisao: "bg-yellow-500/15 text-yellow-700 border-yellow-300",
  validada: "bg-teal-500/15 text-teal-700 border-teal-300",
  reconciliada: "bg-cyan-600/15 text-cyan-700 border-cyan-300",
};

export default function IntercompanyMaster() {
  const navigate = useNavigate();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["intercompany_master_list", "no-filters", 1, 20],
    queryFn: () => listarMaster({}, 1, 20),
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Intercompany Master</h1>
          <p className="text-sm text-muted-foreground">Invoices intercompany P&amp;F ↔ PEF Áustria</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="outline" size="sm" disabled title="Em breve">
            <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
            Exportar
          </Button>
          <Button size="sm" onClick={() => navigate("/intercompany/reembolsos/novo")}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Novo Reembolso
          </Button>
        </div>
      </div>

      {/* Resumo (placeholder — vai virar accordion na 5.3.B) */}
      {data?.resumo && (
        <Card className="border-muted">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Total: </span>
              <span className="font-semibold">{data.resumo.total_invoices} invoices</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div>
              <span className="text-xs text-muted-foreground">Soma EUR: </span>
              <span className="font-mono font-semibold">{formatEUR(data.resumo.soma_eur)}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Soma BRL: </span>
              <span className="font-mono font-semibold">{formatBRL(data.resumo.soma_brl)}</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-[10px]">
                Hub: {data.resumo.qtd_hub}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                Alvo: {data.resumo.qtd_alvo}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {/* Error */}
      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-destructive">Erro ao carregar invoices</p>
              <p className="text-xs text-muted-foreground mt-1 break-words">
                {(error as Error)?.message ?? "Erro desconhecido"}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!isLoading && !error && data?.items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mb-2 opacity-40" />
            <p className="text-sm">Nenhum invoice encontrado.</p>
          </CardContent>
        </Card>
      )}

      {/* Tabela */}
      {!isLoading && !error && data?.items && data.items.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Nº Invoice</th>
                  <th className="px-4 py-3 font-medium">Data</th>
                  <th className="px-4 py-3 font-medium">Tipo</th>
                  <th className="px-4 py-3 font-medium">Classe</th>
                  <th className="px-4 py-3 font-medium">Konto AT</th>
                  <th className="px-4 py-3 font-medium text-right">EUR</th>
                  <th className="px-4 py-3 font-medium text-right">BRL</th>
                  <th className="px-4 py-3 font-medium">CCs</th>
                  <th className="px-4 py-3 font-medium">Origem</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <MasterRow key={`${item.source_table}-${item.id}`} item={item} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
            Mostrando {data.items.length} de {data.pagination.total} invoices · Página {data.pagination.page} de{" "}
            {data.pagination.total_pages} · (Filtros e paginação chegam na próxima entrega)
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Linha da tabela ────────────────────────────────────────────────────

function MasterRow({ item }: { item: MasterItem }) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/20 transition-colors">
      <td className="px-4 py-2.5 font-mono text-xs">{item.numero_invoice ?? "—"}</td>
      <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(item.data_emissao)}</td>
      <td className="px-4 py-2.5">
        <Badge variant="outline" className="text-[10px] capitalize">
          {item.tipo}
        </Badge>
      </td>
      <td className="px-4 py-2.5">
        {item.classe_codigo ? (
          <span className="font-mono text-xs">{item.classe_codigo}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {item.konto_at_numero ? (
          <span className="font-mono text-xs">{item.konto_at_numero}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right font-mono">{formatEUR(item.valor_eur)}</td>
      <td className="px-4 py-2.5 text-right font-mono">{formatBRL(item.valor_brl)}</td>
      <td className="px-4 py-2.5">
        {item.total_ccs > 0 ? (
          <Badge variant="secondary" className="text-[10px]">
            {item.total_ccs} {item.total_ccs === 1 ? "CC" : "CCs"}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <Badge variant="outline" className="text-[10px]">
          {item.origem}
        </Badge>
      </td>
      <td className="px-4 py-2.5">
        <Badge variant="outline" className={`text-[10px] border ${statusColor[item.status_unificado] ?? ""}`}>
          {item.status_label}
        </Badge>
      </td>
      <td className="px-4 py-2.5 text-right">
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </td>
    </tr>
  );
}
