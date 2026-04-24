import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, AlertTriangle, X, PackageOpen } from "lucide-react";
import { buscarMovimentacaoProduto } from "@/services/alvoEstoqueService";

interface ProductMovementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  codigoProduto: string;
  nomeProduto: string;
  dataReferencia: string; // YYYY-MM-DD
  unidadeMedida: string | null;
}

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatQty = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

const dash = (v: any) => (v == null || v === "" ? "—" : v);

const formatDateBR = (v: string | null | undefined) => {
  if (!v) return "—";
  if (v.includes("/")) return v;
  const dateOnly = v.includes("T") ? v.split("T")[0] : v;
  const [y, m, d] = dateOnly.split("-");
  if (!y || !m || !d) return v;
  return `${d}/${m}/${y}`;
};

/**
 * Normaliza qualquer formato de data do Alvo para YYYY-MM-DD.
 * O Alvo retorna "2026-03-31T00:00:00-03:00" (ISO) nas movimentações.
 */
const toYMD = (v: string | null | undefined): string => {
  if (!v) return "";
  if (v.includes("T")) return v.split("T")[0];
  if (v.includes("/")) {
    const [d, m, y] = v.split("/");
    return `${y}-${m}-${d}`;
  }
  return v;
};

const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function SaldoSection({ label, item, fallbackData }: { label: string; item: any; fallbackData?: string }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground">{label}</h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Data</p>
          <p className="text-sm font-medium">{formatDateBR(item?.Data || fallbackData)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Quantidade</p>
          <p className="text-sm font-medium">{item?.QtdSaldo != null ? formatQty(item.QtdSaldo) : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Valor Total</p>
          <p className="text-sm font-medium">{item?.ValorSaldo != null ? formatBRL(item.ValorSaldo) : "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Custo Médio</p>
          <p className="text-sm font-medium">{item?.CustoMedio != null ? formatBRL(item.CustoMedio) : "—"}</p>
        </div>
      </div>
    </div>
  );
}

export function ProductMovementModal({
  open,
  onOpenChange,
  codigoProduto,
  nomeProduto,
  dataReferencia,
  unidadeMedida,
}: ProductMovementModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movements, setMovements] = useState<any[]>([]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setMovements([]);

    buscarMovimentacaoProduto(codigoProduto, dataReferencia, unidadeMedida)
      .then((data) => setMovements(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, codigoProduto, dataReferencia, unidadeMedida]);

  /**
   * Particionamento do array bruto do Alvo em:
   * - saldoAnterior: última movimentação REAL anterior ao dia selecionado
   *                  (linha com Operacao "Saldo Anterior" do Alvo é ignorada,
   *                   porque queremos rastreabilidade à última mov real)
   * - movimentacoesDoDia: todas as movimentações com data === dataReferencia
   * - saldoFinal: snapshot de saldo ao fim do dia (última mov do dia,
   *               ou o próprio saldo anterior se não houve movimento hoje)
   */
  const dataRefYMD = dataReferencia;

  // Filtra movimentações "reais" (ignora linhas sintéticas de Saldo Anterior que o Alvo injeta)
  const realMovements = movements.filter((m) => m.Operacao !== "Saldo Anterior");

  // Separa pelo dia
  const anteriores = realMovements.filter((m) => toYMD(m.Data) < dataRefYMD);
  const movimentacoesDoDia = realMovements.filter((m) => toYMD(m.Data) === dataRefYMD);

  // Saldo Anterior = última movimentação REAL antes do dia (opção 2 — rastreabilidade)
  const saldoAnterior = anteriores.length > 0 ? anteriores[anteriores.length - 1] : null;

  // Saldo Final = última mov do dia (se houve movimento) ou saldo anterior (se não)
  const saldoFinal =
    movimentacoesDoDia.length > 0
      ? movimentacoesDoDia[movimentacoesDoDia.length - 1]
      : saldoAnterior
        ? { ...saldoAnterior, Data: dataRefYMD } // mesmo saldo, data do dia selecionado
        : null;

  const [y, m] = dataReferencia.split("-");
  const mesAnoLabel = `${MONTH_NAMES[parseInt(m, 10) - 1]}/${y}`;

  const temSaldoAnterior = saldoAnterior !== null;
  const semMovimentosDoDia = movimentacoesDoDia.length === 0;
  const semDadosTotais = realMovements.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] flex flex-col p-0 gap-0">
        {/* Fixed header */}
        <div className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground leading-tight truncate">{nomeProduto}</h2>
              <p className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-1">
                <span className="font-mono">{codigoProduto}</span>
                <span>·</span>
                <span>Ref.: {formatDateBR(dataReferencia)}</span>
                <span>·</span>
                <span>{mesAnoLabel}</span>
              </p>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shrink-0 mt-0.5"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Fechar</span>
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto min-h-0 px-6 pb-6 pt-4 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Consultando ERP...</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 py-8 justify-center text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {!loading && !error && semDadosTotais && (
            <p className="text-center text-sm text-muted-foreground py-8">
              Nenhuma movimentação encontrada para este produto.
            </p>
          )}

          {!loading && !error && !semDadosTotais && (
            <>
              {/* 1. Saldo Anterior (última mov real antes do dia) */}
              {temSaldoAnterior ? (
                <SaldoSection label="Saldo Anterior" item={saldoAnterior} />
              ) : (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-foreground">Saldo Anterior</h4>
                  <p className="text-xs text-muted-foreground">
                    Não há movimentações anteriores a esta data. Produto novo ou primeiro registro.
                  </p>
                </div>
              )}

              <Separator />

              {/* 2. Movimentações do dia */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-foreground">
                  Movimentações do Dia
                  {movimentacoesDoDia.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({movimentacoesDoDia.length})
                    </span>
                  )}
                </h4>
                {semMovimentosDoDia ? (
                  <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                    <PackageOpen className="h-4 w-4" />
                    <span className="text-xs">Sem movimentações neste dia</span>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs whitespace-nowrap">Data</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Operação</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Tipo</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Documento</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Entidade</TableHead>
                          <TableHead className="text-xs text-right whitespace-nowrap">Qtd Entrada</TableHead>
                          <TableHead className="text-xs text-right whitespace-nowrap">Qtd Saída</TableHead>
                          <TableHead className="text-xs text-right whitespace-nowrap">Saldo Qtde</TableHead>
                          <TableHead className="text-xs text-right whitespace-nowrap">Valor Saldo</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {movimentacoesDoDia.map((mov, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="text-xs whitespace-nowrap">{formatDateBR(mov.Data)}</TableCell>
                            <TableCell className="text-xs">{dash(mov.Operacao)}</TableCell>
                            <TableCell className="text-xs">{dash(mov.TipoLanc)}</TableCell>
                            <TableCell className="text-xs font-mono">{dash(mov.Documento)}</TableCell>
                            <TableCell className="text-xs">{dash(mov.Entidade)}</TableCell>
                            <TableCell className="text-xs text-right">
                              {mov.QtdEntrada != null && mov.QtdEntrada !== 0 && mov.QtdEntrada !== ""
                                ? formatQty(mov.QtdEntrada)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              {mov.QtdSaida != null && mov.QtdSaida !== 0 && mov.QtdSaida !== ""
                                ? formatQty(mov.QtdSaida)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              {mov.QtdSaldo != null ? formatQty(mov.QtdSaldo) : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-right">
                              {mov.ValorSaldo != null ? formatBRL(mov.ValorSaldo) : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              <Separator />

              {/* 3. Saldo Final */}
              <div className="font-bold">
                <SaldoSection label="Saldo Final" item={saldoFinal} fallbackData={dataRefYMD} />
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
