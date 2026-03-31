import { useRef, useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileX2, ArrowDownCircle, ArrowUpCircle, CheckCircle2, Unlink } from "lucide-react";
import { parseOfxFile, type OfxTransaction } from "@/lib/ofxParser";
import { useToast } from "@/hooks/use-toast";

// BANKID → ERP code mapping
const BANKID_TO_ERP: Record<string, string> = {
  "033": "0000016", // Santander
  "237": "0000017", // Bradesco
  "341": "0000018", // Itaú
  "001": "0000019", // Banco do Brasil
  "104": "0000020", // Caixa Econômica
};

const BANK_NAMES: Record<string, string> = {
  "0000016": "Santander",
  "0000017": "Bradesco",
  "0000018": "Itaú",
  "0000019": "Banco do Brasil",
  "0000020": "Caixa Econômica",
};

interface Props {
  transactions: OfxTransaction[];
  onImport: (txs: OfxTransaction[]) => void;
  matchedIds: Set<string>;
  processedIds: Set<string>;
  disabled?: boolean;
  selectedBank: string;
  selectedPeriod: string; // "YYYY-MM"
  selectedOfxId?: string | null;
  onSelectOfx?: (fitId: string | null) => void;
  onUnmatch?: (fitId: string) => void;
}

const formatBRL = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatDate = (dateStr: string) => {
  if (!dateStr) return "—";
  try {
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y}`;
  } catch {
    return dateStr;
  }
};

export default function BankStatementTable({ transactions, onImport, matchedIds, processedIds, disabled, selectedBank, selectedPeriod, selectedOfxId, onSelectOfx, onUnmatch }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const { toast } = useToast();

  const validateAndImport = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".ofx")) {
      toast({ title: "Arquivo inválido", description: "Selecione um arquivo .OFX", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const result = parseOfxFile(text);

      // BANKID validation
      if (result.bankId) {
        const expectedErpCode = BANKID_TO_ERP[result.bankId];
        if (expectedErpCode && expectedErpCode !== selectedBank) {
          const ofxBankName = BANK_NAMES[expectedErpCode] || `BANKID ${result.bankId}`;
          const selectedBankName = BANK_NAMES[selectedBank] || selectedBank;
          toast({
            title: "⛔ Arquivo incompatível",
            description: `Este OFX pertence ao ${ofxBankName}, mas o banco selecionado é ${selectedBankName}. Selecione o banco correto no dropdown.`,
            variant: "destructive",
          });
          return;
        }
      }

      // Period date validation — check if OFX transactions match the selected month/year
      if (result.transactions.length > 0 && selectedPeriod) {
        const [selYear, selMonth] = selectedPeriod.split("-").map(Number);
        const monthCounts: Record<string, number> = {};
        for (const tx of result.transactions) {
          if (!tx.date) continue;
          const key = tx.date.substring(0, 7); // "YYYY-MM"
          monthCounts[key] = (monthCounts[key] || 0) + 1;
        }
        const dominantMonth = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0];
        if (dominantMonth) {
          const [domYear, domMonth] = dominantMonth[0].split("-").map(Number);
          if (domYear !== selYear || domMonth !== selMonth) {
            const monthNames = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
            toast({
              title: "⛔ Período incompatível",
              description: `O OFX contém lançamentos de ${monthNames[domMonth]}/${domYear}, mas o período selecionado é ${monthNames[selMonth]}/${selYear}. Selecione o mês correto antes de importar.`,
              variant: "destructive",
            });
            return;
          }
        }
      }

      onImport(result.transactions);
      toast({
        title: "✅ OFX importado!",
        description: `${result.transactions.length} lançamentos encontrados.${result.accountId ? ` Conta: ${result.accountId}` : ""}`,
      });
    };
    reader.readAsText(file, "latin1");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndImport(file);
  };

  const totals = transactions.reduce(
    (acc, tx) => {
      if (tx.amount >= 0) acc.entradas += tx.amount;
      else acc.saidas += tx.amount;
      return acc;
    },
    { entradas: 0, saidas: 0 }
  );

  const handleRowClick = (tx: OfxTransaction) => {
    if (!onSelectOfx) return;
    const isMatched = matchedIds.has(tx.fitId);
    const isProcessed = processedIds.has(tx.fitId);
    if (isMatched || isProcessed) return;
    onSelectOfx(selectedOfxId === tx.fitId ? null : tx.fitId);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Extrato Bancário (OFX)</CardTitle>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".ofx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) validateAndImport(f);
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="outline" className="gap-2" onClick={() => fileRef.current?.click()} disabled={disabled}>
              <Upload className="h-4 w-4" /> Importar OFX
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {transactions.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground transition-colors ${
              dragOver ? "bg-primary/5 ring-2 ring-primary/20 ring-inset" : ""
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <FileX2 className="h-10 w-10" />
            <p className="text-sm">Arraste um arquivo .OFX aqui ou clique em "Importar OFX"</p>
          </div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-center">Match</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => {
                  const isMatched = matchedIds.has(tx.fitId);
                  const isProcessed = processedIds.has(tx.fitId);
                  const isNeg = tx.amount < 0;
                  const isSelected = selectedOfxId === tx.fitId;
                  const isPending = !isMatched && !isProcessed;
                  return (
                    <TableRow
                      key={tx.fitId}
                      className={`
                        ${isProcessed ? "bg-success/5 opacity-60" : ""}
                        ${isMatched && !isProcessed ? "bg-success/10 border-l-2 border-l-success" : ""}
                        ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : ""}
                        ${isPending && onSelectOfx ? "cursor-pointer hover:bg-muted/50" : ""}
                      `}
                      onClick={() => handleRowClick(tx)}
                    >
                      <TableCell className="whitespace-nowrap">{formatDate(tx.date)}</TableCell>
                      <TableCell className="max-w-[250px] truncate text-muted-foreground">{tx.memo || "—"}</TableCell>
                      <TableCell className={`text-right font-medium ${isNeg ? "text-danger" : "text-success"}`}>
                        <span className="inline-flex items-center gap-1">
                          {isNeg ? <ArrowDownCircle className="h-3.5 w-3.5" /> : <ArrowUpCircle className="h-3.5 w-3.5" />}
                          {formatBRL(tx.amount)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {isProcessed ? (
                          <CheckCircle2 className="inline h-4 w-4 text-success" />
                        ) : isMatched ? (
                          <div className="inline-flex items-center gap-1">
                            <Badge variant="default" className="text-[10px]">Conciliado</Badge>
                            {onUnmatch && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-muted-foreground hover:text-destructive"
                                onClick={(e) => { e.stopPropagation(); onUnmatch(tx.fitId); }}
                                title="Desfazer match"
                              >
                                <Unlink className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ) : isSelected ? (
                          <Badge variant="outline" className="text-[10px] border-primary text-primary">Selecionado</Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow className="font-semibold">
                  <TableCell colSpan={2}>Total ({transactions.length} lançamentos)</TableCell>
                  <TableCell className="text-right">{formatBRL(totals.entradas + totals.saidas)}</TableCell>
                  <TableCell />
                </TableRow>
                <TableRow className="text-xs">
                  <TableCell colSpan={2} className="text-muted-foreground">Entradas / Saídas</TableCell>
                  <TableCell className="text-right">
                    <span className="text-success">{formatBRL(totals.entradas)}</span>
                    {" / "}
                    <span className="text-danger">{formatBRL(totals.saidas)}</span>
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
