/**
 * Etapa 1 do wizard de Bulk Edit Produtos.
 *
 * O usuário escolhe quais campos quer editar em massa via checkboxes.
 * Depois pode baixar uma planilha modelo (XLSX) pré-formatada com as
 * colunas escolhidas, contendo:
 * - Header em negrito com background cinza (linha 1)
 * - Linha de exemplo (linha 2)
 * - Validação de dados (dropdown) em colunas enum
 * - Largura de coluna ajustada
 *
 * Usa exceljs (não xlsx/SheetJS) porque a versão Community Edition do
 * SheetJS não aplica estilos de célula nem data validations.
 *
 * Não persiste nada ainda — só state local + download client-side.
 */

import { useState, useMemo } from "react";
import ExcelJS from "exceljs";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Download, ArrowRight, Info } from "lucide-react";
import { BULK_EDIT_PRODUTO_FIELDS, type BulkEditFieldDefinition } from "@/constants/bulkEditFields";
import { format } from "date-fns";

interface Etapa1Props {
  /** Campos já escolhidos (vindo do state do orquestrador) */
  camposEscolhidos: string[];
  /** Chamado quando o usuário avança */
  onAvancar: (camposEscolhidos: string[]) => void;
}

export function Etapa1ConfigurarColunas({ camposEscolhidos, onAvancar }: Etapa1Props) {
  const [selecionados, setSelecionados] = useState<string[]>(camposEscolhidos);

  const podeAvancar = selecionados.length > 0;

  const toggleCampo = (key: string) => {
    setSelecionados((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  // Mantém a ordem dos campos conforme aparecem na whitelist
  const camposOrdenados = useMemo(
    () => BULK_EDIT_PRODUTO_FIELDS.filter((f) => selecionados.includes(f.key)),
    [selecionados],
  );

  /**
   * Gera e baixa a planilha modelo no browser usando exceljs.
   * Estrutura:
   * - Aba "Bulk Edit Produtos": header em negrito com fill cinza + linha de exemplo
   *   + data validation (dropdown) em colunas enum (vale para linhas 2-501)
   * - Aba "Instruções": texto explicativo do preenchimento
   */
  const baixarPlanilhaModelo = async () => {
    if (selecionados.length === 0) {
      toast.error("Selecione pelo menos um campo para gerar o modelo.");
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Hub P&F — Bulk Edit Produtos";
      workbook.created = new Date();

      // ─── ABA 1: Bulk Edit Produtos ────────────────────────────────
      const ws = workbook.addWorksheet("Bulk Edit Produtos");

      // 1. Headers (linha 1)
      const headers = ["CodigoAlternativo", ...camposOrdenados.map((f) => f.key)];
      ws.addRow(headers);

      // 2. Linha de exemplo (linha 2)
      const exemploRow: any[] = ["82000085"];
      for (const field of camposOrdenados) {
        if (field.type === "enum" && field.options && field.options.length > 0) {
          exemploRow.push(field.options[0].value);
        } else if (field.key === "Nome" || field.key.startsWith("NomeAlternativo")) {
          exemploRow.push("EXEMPLO - MOCK DEVICE AORTIC VALVE");
        } else if (field.key === "CodigoBarras") {
          exemploRow.push("7891234567890");
        } else {
          exemploRow.push("valor exemplo");
        }
      }
      ws.addRow(exemploRow);

      // 3. Estilizar linha de header (negrito + fill cinza claro)
      const headerRow = ws.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE5E7EB" }, // cinza claro do design
        };
        cell.alignment = { vertical: "middle", horizontal: "left" };
        cell.border = {
          bottom: { style: "thin", color: { argb: "FF9CA3AF" } },
        };
      });

      // 4. Larguras de coluna
      ws.columns = headers.map((_h, idx) => {
        if (idx === 0) return { width: 22 }; // CodigoAlternativo
        const field = camposOrdenados[idx - 1];
        if (!field) return { width: 25 };
        if (field.type === "enum") return { width: 28 };
        return {
          width: Math.max(22, field.maxLength ? Math.min(field.maxLength, 50) : 28),
        };
      });

      // 5. Data validations (dropdown) em colunas enum, válido para linhas 2-501
      camposOrdenados.forEach((field, idx) => {
        if (field.type === "enum" && field.options) {
          const colNum = idx + 2; // +2 porque coluna 1 = CodigoAlternativo, e exceljs é 1-indexed
          const colLetter = numberToColumnLetter(colNum);
          const values = field.options.map((o) => o.value).join(",");

          for (let row = 2; row <= 501; row++) {
            ws.getCell(`${colLetter}${row}`).dataValidation = {
              type: "list",
              allowBlank: true,
              formulae: [`"${values}"`],
              showErrorMessage: true,
              errorStyle: "error",
              errorTitle: "Valor inválido",
              error: `Valores aceitos: ${values}`,
            };
          }
        }
      });

      // 6. Freeze do header (linha 1 sempre visível ao rolar)
      ws.views = [{ state: "frozen", ySplit: 1 }];

      // 7. AutoFilter no header
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };

      // ─── ABA 2: Instruções ────────────────────────────────────────
      const wsInstr = workbook.addWorksheet("Instruções");
      wsInstr.columns = [{ width: 100 }];

      wsInstr.addRow(["INSTRUÇÕES DE PREENCHIMENTO"]);
      wsInstr.addRow([""]);
      wsInstr.addRow(["1. Preencha 1 produto por linha, a partir da linha 2 (mantenha o header intacto)."]);
      wsInstr.addRow(["2. A coluna 'CodigoAlternativo' é OBRIGATÓRIA — é como identificamos o produto no ERP."]);
      wsInstr.addRow(["3. Deixe vazias as células dos campos que você NÃO quer alterar nesse produto."]);
      wsInstr.addRow([
        "4. Cada produto pode ter campos diferentes preenchidos — a planilha não precisa estar 100% preenchida.",
      ]);
      wsInstr.addRow([
        "5. Para campos com valores específicos (Status, Tipo), use o dropdown que aparece ao clicar na célula.",
      ]);
      wsInstr.addRow([""]);
      wsInstr.addRow(["CAMPOS NESTA PLANILHA:"]);
      wsInstr.addRow([""]);

      for (const f of camposOrdenados) {
        let desc = `• ${f.key} — ${f.label}`;
        if (f.type === "enum") {
          desc += ` (valores aceitos: ${f.options?.map((o) => o.value).join(", ")})`;
        } else if (f.maxLength) {
          desc += ` (texto livre, máx ${f.maxLength} caracteres)`;
        } else {
          desc += " (texto livre)";
        }
        wsInstr.addRow([desc]);
      }

      // Negrito no título da aba de instruções
      wsInstr.getRow(1).font = { bold: true, size: 14 };
      wsInstr.getRow(9).font = { bold: true };

      // ─── Disparar download ────────────────────────────────────────
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const dataStr = format(new Date(), "yyyy-MM-dd");
      const fileName = `bulk-edit-produtos-modelo-${dataStr}.xlsx`;

      // Cria link temporário e clica nele
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(`Planilha "${fileName}" baixada com ${camposOrdenados.length} campo(s) configurado(s).`);
    } catch (err: any) {
      console.error("Erro ao gerar planilha modelo:", err);
      toast.error(`Erro ao gerar planilha: ${err?.message || String(err)}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Instruções */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <Info className="h-5 w-5 shrink-0 text-blue-600" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">Escolha os campos que você quer editar em massa</p>
            <p className="text-muted-foreground">
              Marque um ou mais campos abaixo. Depois você baixa uma planilha modelo pré-formatada com essas colunas —
              basta preencher offline e fazer o upload no próximo passo.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Lista de campos com checkboxes */}
      <Card>
        <CardContent className="space-y-1 p-2">
          {BULK_EDIT_PRODUTO_FIELDS.map((field) => {
            const isChecked = selecionados.includes(field.key);
            return (
              <label
                key={field.key}
                htmlFor={`field-${field.key}`}
                className="flex cursor-pointer items-start gap-3 rounded-md p-3 transition-colors hover:bg-secondary"
              >
                <Checkbox
                  id={`field-${field.key}`}
                  checked={isChecked}
                  onCheckedChange={() => toggleCampo(field.key)}
                  className="mt-1"
                />
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{field.label}</span>
                    <span className="text-xs font-mono text-muted-foreground">{field.key}</span>
                    {field.type === "enum" ? (
                      <Badge variant="outline" className="text-xs">
                        Dropdown ({field.options?.length} opções)
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Texto {field.maxLength ? `(máx ${field.maxLength})` : "livre"}
                      </Badge>
                    )}
                  </div>
                  {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
                  {field.type === "enum" && field.options && (
                    <p className="text-xs text-muted-foreground">
                      Valores: {field.options.map((o) => o.label).join(" | ")}
                    </p>
                  )}
                </div>
              </label>
            );
          })}
        </CardContent>
      </Card>

      {/* Resumo da seleção */}
      {selecionados.length > 0 && (
        <Card className="border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-4">
            <p className="text-sm font-medium text-foreground">
              {selecionados.length} campo
              {selecionados.length !== 1 ? "s" : ""} selecionado
              {selecionados.length !== 1 ? "s" : ""}:
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              CodigoAlternativo (obrigatório) + {camposOrdenados.map((f) => f.label).join(", ")}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Botões de ação */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={baixarPlanilhaModelo} disabled={!podeAvancar}>
          <Download className="h-4 w-4" />
          Baixar planilha modelo
        </Button>

        <Button onClick={() => onAvancar(selecionados)} disabled={!podeAvancar}>
          Avançar
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Converte um número de coluna (1-indexed) em letra de coluna do Excel.
 * 1 → A, 2 → B, ..., 26 → Z, 27 → AA, 28 → AB
 */
function numberToColumnLetter(num: number): string {
  let result = "";
  while (num > 0) {
    const remainder = (num - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    num = Math.floor((num - 1) / 26);
  }
  return result;
}
