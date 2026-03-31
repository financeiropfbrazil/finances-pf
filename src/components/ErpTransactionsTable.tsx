import { useMemo } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDownCircle, ArrowUpCircle, FileX2, CheckCircle2, Unlink } from "lucide-react";
import type { FaturaERP } from "@/services/alvoService";

interface Props {
  transactions: FaturaERP[];
  loading?: boolean;
  matchedIds?: Set<string>;
  selectedErpId?: string | null;
  onSelectErp?: (erpId: string | null) => void;
  onUnmatch?: (erpId: string) => void;
}

const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatDate = (dateStr?: string) => {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR");
  } catch {
    return dateStr;
  }
};

function getSignedValue(tx: FaturaERP): number {
  const raw = Number(tx.ValorBruto ?? 0);
  return tx.Tipo === "PAG" ? -Math.abs(raw) : Math.abs(raw);
}

export default function ErpTransactionsTable({ transactions, loading, matchedIds, selectedErpId, onSelectErp, onUnmatch }: Props) {
  const sorted = useMemo(() => {
    return [...transactions].sort((a, b) => {
      const da = a.DataVencimento ? new Date(a.DataVencimento).getTime() : 0;
      const db = b.DataVencimento ? new Date(b.DataVencimento).getTime() : 0;
      return da - db;
    });
  }, [transactions]);

  const totals = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    sorted.forEach((tx) => {
      const v = getSignedValue(tx);
      if (v >= 0) entradas += v;
      else saidas += v;
    });
    return { entradas, saidas, liquido: entradas + saidas };
  }, [sorted]);

  const handleRowClick = (tx: FaturaERP) => {
    if (!onSelectErp) return;
    const isMatched = matchedIds?.has(tx.Id);
    if (isMatched) return;
    onSelectErp(selectedErpId === tx.Id ? null : tx.Id);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dados do ERP — Faturas Financeiras</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (sorted.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dados do ERP — Faturas Financeiras</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
          <FileX2 className="h-10 w-10" />
          <p>Nenhum lançamento encontrado no ERP para este período.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Dados do ERP — Faturas Financeiras</CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table className="table-fixed w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[90px]">Data</TableHead>
              <TableHead className="w-auto">Descrição</TableHead>
              <TableHead className="w-[60px] text-center">Tipo</TableHead>
              <TableHead className="w-[130px] text-right">Valor</TableHead>
              <TableHead className="w-[60px] text-center">Match</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((tx) => {
              const signed = getSignedValue(tx);
              const isPag = tx.Tipo === "PAG";
              const isMatched = matchedIds?.has(tx.Id);
              const isSelected = selectedErpId === tx.Id;
              const isPending = !isMatched;
              const descPart = tx.ObservacaoDocFin || tx.CodigoNomeEntidade || "—";
              const description = tx.Numero ? `${tx.Numero} - ${descPart}` : descPart;
              return (
                <TableRow
                  key={tx.Id}
                  className={`
                    ${isMatched ? "bg-success/10 border-l-2 border-l-success" : ""}
                    ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : ""}
                    ${isPending && onSelectErp ? "cursor-pointer hover:bg-muted/50" : ""}
                  `}
                  onClick={() => handleRowClick(tx)}
                >
                  <TableCell className="whitespace-nowrap text-xs py-2 px-3">
                    {formatDate(tx.DataVencimento)}
                  </TableCell>
                  <TableCell className="truncate text-muted-foreground text-xs py-2 px-3" title={description}>
                    {description}
                  </TableCell>
                  <TableCell className="text-center py-2 px-2">
                    {isPag ? (
                      <span className="inline-flex items-center gap-0.5 text-destructive text-xs">
                        <ArrowDownCircle className="h-3.5 w-3.5" /> PAG
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-success text-xs">
                        <ArrowUpCircle className="h-3.5 w-3.5" /> REC
                      </span>
                    )}
                  </TableCell>
                  <TableCell className={`text-right font-medium text-xs py-2 px-3 whitespace-nowrap ${isPag ? "text-destructive" : "text-success"}`}>
                    {formatBRL(signed)}
                  </TableCell>
                  <TableCell className="text-center py-2 px-2">
                    {isMatched ? (
                      <div className="inline-flex items-center gap-1">
                        <CheckCircle2 className="inline h-4 w-4 text-success" />
                        {onUnmatch && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); onUnmatch(tx.Id); }}
                            title="Desfazer match"
                          >
                            <Unlink className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ) : tx.Realizado === "Sim" ? (
                      <CheckCircle2 className="inline h-4 w-4 text-success" />
                    ) : isSelected ? (
                      <Badge variant="outline" className="text-[10px] border-primary text-primary">Selecionado</Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow className="font-semibold text-xs">
              <TableCell colSpan={3} className="py-2 px-3">
                Total ({sorted.length})
              </TableCell>
              <TableCell className="text-right py-2 px-3">{formatBRL(totals.liquido)}</TableCell>
              <TableCell className="py-2 px-2" />
            </TableRow>
            <TableRow className="text-[11px]">
              <TableCell colSpan={3} className="text-muted-foreground py-1.5 px-3">Entradas / Saídas</TableCell>
              <TableCell className="text-right py-1.5 px-3 whitespace-nowrap">
                <span className="text-success">{formatBRL(totals.entradas)}</span>
                {" / "}
                <span className="text-destructive">{formatBRL(totals.saidas)}</span>
              </TableCell>
              <TableCell className="py-1.5 px-2" />
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  );
}
