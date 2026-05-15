/**
 * Etapa 1 do wizard de Bulk Edit Produtos.
 *
 * O usuário escolhe quais campos quer editar em massa via checkboxes.
 * Depois pode baixar uma planilha modelo (XLSX) pré-formatada com as
 * colunas escolhidas, contendo:
 * - Header em negrito (linha 1)
 * - Linha de exemplo (linha 2)
 * - Validação de dados (dropdown) em colunas enum
 * - Largura de coluna ajustada
 *
 * Não persiste nada ainda — só state local + download client-side.
 * Quando o usuário clica "Avançar", chama onAvancar com a lista de keys
 * dos campos escolhidos, que o orquestrador passa para a Etapa 2.
 */

import { useState, useMemo } from "react";
import * as XLSX from "xlsx";
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
  // State local: lista de keys dos campos marcados
  const [selecionados, setSelecionados] = useState<string[]>(camposEscolhidos);

  const podeAvancar = selecionados.length > 0;

  const toggleCampo = (key: string) => {
    setSelecionados((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  // Mantém a ordem dos campos conforme aparecem na whitelist (não na ordem de clique)
  const camposOrdenados = useMemo(
    () => BULK_EDIT_PRODUTO_FIELDS.filter((f) => selecionados.includes(f.key)),
    [selecionados],
  );

  /**
   * Gera e baixa a planilha modelo no browser.
   * Estrutura:
   * - Coluna A: CodigoAlternativo (fixa, identificador)
   * - Colunas B em diante: campos escolhidos pelo usuário
   * - Linha 1: headers
   * - Linha 2: exemplo preenchido
   * - Validação de dados em colunas enum (dropdown)
   */
  const baixarPlanilhaModelo = () => {
    if (selecionados.length === 0) {
      toast.error("Selecione pelo menos um campo para gerar o modelo.");
      return;
    }

    try {
      // 1. Montar headers
      const headers = ["CodigoAlternativo", ...camposOrdenados.map((f) => f.key)];

      // 2. Montar linha de exemplo
      const exemploRow: any[] = ["82000085"]; // CodigoAlternativo de exemplo
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

      // 3. Criar worksheet a partir de array de arrays (AOA)
      const aoa = [headers, exemploRow];
      const ws = XLSX.utils.aoa_to_sheet(aoa);

      // 4. Ajustar largura das colunas
      const colWidths = headers.map((h, idx) => {
        if (idx === 0) return { wch: 18 }; // CodigoAlternativo
        const field = camposOrdenados[idx - 1];
        if (!field) return { wch: 20 };
        if (field.type === "enum") return { wch: 25 };
        return { wch: Math.max(20, field.maxLength ? Math.min(field.maxLength, 50) : 25) };
      });
      ws["!cols"] = colWidths;

      // 5. Negrito no header (linha 1)
      const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
        if (!ws[cellRef]) continue;
        ws[cellRef].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: "FFE5E7EB" } },
        };
      }

      // 6. Validação de dados (dropdown) para colunas enum
      // Aplica em 500 linhas (linhas 2-501) para o usuário ter espaço
      const dataValidations: any[] = [];
      camposOrdenados.forEach((field, idx) => {
        if (field.type === "enum" && field.options) {
          const colIdx = idx + 1; // +1 porque a coluna A é CodigoAlternativo
          const colLetter = XLSX.utils.encode_col(colIdx);
          const values = field.options.map((o) => o.value).join(",");
          dataValidations.push({
            type: "list",
            allowBlank: true,
            sqref: `${colLetter}2:${colLetter}501`,
            formulas: [`"${values}"`],
          });
        }
      });

      if (dataValidations.length > 0) {
        (ws as any)["!dataValidation"] = dataValidations;
      }

      // 7. Criar workbook
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Bulk Edit Produtos");

      // 8. Aba de instruções
      const instrucoes = [
        ["INSTRUÇÕES DE PREENCHIMENTO"],
        [""],
        ["1. Preencha 1 produto por linha, a partir da linha 2 (mantenha o header intacto)."],
        ["2. A coluna 'CodigoAlternativo' é OBRIGATÓRIA — é como identificamos o produto no ERP."],
        ["3. Deixe vazias as células dos campos que você NÃO quer alterar nesse produto."],
        ["4. Cada produto pode ter campos diferentes preenchidos — a planilha não precisa estar 100% preenchida."],
        ["5. Para campos com valores específicos (Status, Tipo), use o dropdown que aparece ao clicar na célula."],
        [""],
        ["CAMPOS NESTA PLANILHA:"],
        [""],
        ...camposOrdenados.map((f) => [
          `• ${f.key} — ${f.label}` +
            (f.type === "enum"
              ? ` (valores aceitos: ${f.options?.map((o) => o.value).join(", ")})`
              : f.maxLength
                ? ` (texto livre, máx ${f.maxLength} caracteres)`
                : " (texto livre)"),
        ]),
      ];
      const wsInstr = XLSX.utils.aoa_to_sheet(instrucoes);
      wsInstr["!cols"] = [{ wch: 100 }];
      XLSX.utils.book_append_sheet(wb, wsInstr, "Instruções");

      // 9. Disparar download
      const dataStr = format(new Date(), "yyyy-MM-dd");
      const fileName = `bulk-edit-produtos-modelo-${dataStr}.xlsx`;
      XLSX.writeFile(wb, fileName);

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
              {selecionados.length} campo{selecionados.length !== 1 ? "s" : ""} selecionado
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
