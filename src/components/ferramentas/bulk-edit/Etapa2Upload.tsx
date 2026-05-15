/**
 * Etapa 2 do wizard de Bulk Edit Produtos: upload + parse + validação.
 *
 * Recebe os campos escolhidos na Etapa 1 e:
 * - Aceita drag-and-drop ou click pra escolher arquivo .xlsx
 * - Parse com SheetJS (xlsx)
 * - Valida estrutura: header CodigoAlternativo + campos esperados
 * - Valida cada linha: identificador presente, valores enum válidos,
 *   ao menos 1 campo a alterar preenchido, comprimento máximo
 * - Preview em tabela com linhas inválidas destacadas em vermelho
 * - Limite 500 linhas (alinhado com RPC bulk_edit_record_item)
 * - Permite avanço se todas válidas, OU se usuário marcar "ignorar inválidas"
 *
 * Saída para o orquestrador (via onAvancar): lista de linhas VÁLIDAS já parseadas,
 * cada uma com {sequencia, codigoAlternativo, valoresNovos: {campo: valor}}.
 */

import { useState, useRef, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { BULK_EDIT_PRODUTO_FIELDS, getBulkEditFieldByKey, normalizeEnumValue } from "@/constants/bulkEditFields";

const MAX_LINHAS = 500;

// ─── Tipos públicos exportados ────────────────────────────────────

export interface LinhaPlanilhaValida {
  sequencia: number; // 1-indexed
  codigoAlternativo: string;
  valoresNovos: Record<string, string>; // {campo: valor já normalizado}
}

interface LinhaPlanilhaParseada {
  numeroLinhaExcel: number; // linha no Excel (2-indexed, considerando header)
  codigoAlternativo: string;
  valoresNovos: Record<string, string>;
  erros: string[]; // vazio se linha válida
}

interface Etapa2Props {
  camposEscolhidos: string[];
  onVoltar: () => void;
  onAvancar: (linhas: LinhaPlanilhaValida[], nomeArquivo: string) => void;
}

export function Etapa2Upload({ camposEscolhidos, onVoltar, onAvancar }: Etapa2Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState<string>("");
  const [linhas, setLinhas] = useState<LinhaPlanilhaParseada[]>([]);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [ignorarInvalidas, setIgnorarInvalidas] = useState(false);

  const camposOrdenados = useMemo(
    () => BULK_EDIT_PRODUTO_FIELDS.filter((f) => camposEscolhidos.includes(f.key)),
    [camposEscolhidos],
  );

  // ─── Drag handlers ──────────────────────────────────────────────

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processarArquivo(files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processarArquivo(file);
    // Limpa o input pra permitir reupload do mesmo arquivo
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ─── Parse + validação ──────────────────────────────────────────

  const processarArquivo = useCallback(
    async (file: File) => {
      setParsing(true);
      setErroGeral(null);
      setLinhas([]);
      setIgnorarInvalidas(false);
      setNomeArquivo(file.name);

      try {
        // Validar extensão
        if (!file.name.match(/\.xlsx?$/i)) {
          throw new Error(`Arquivo deve ser .xlsx ou .xls (recebido: ${file.name})`);
        }

        // Validar tamanho (10MB max)
        if (file.size > 10 * 1024 * 1024) {
          throw new Error(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Limite: 10MB.`);
        }

        // Ler como ArrayBuffer
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });

        // Procurar a aba "Bulk Edit Produtos" (case-insensitive), ou usar a primeira aba
        let sheetName = wb.SheetNames.find(
          (n) => n.toLowerCase().includes("bulk") && n.toLowerCase().includes("produto"),
        );
        if (!sheetName) sheetName = wb.SheetNames[0];

        if (!sheetName) throw new Error("Planilha vazia ou sem abas.");

        const ws = wb.Sheets[sheetName];

        // Converter pra array de arrays
        const rows = XLSX.utils.sheet_to_json<any[]>(ws, {
          header: 1,
          defval: "",
          raw: false, // tudo como string
        });

        if (rows.length === 0) {
          throw new Error("Planilha vazia.");
        }

        // Validar header
        const headers = (rows[0] as any[]).map((h) => String(h).trim());
        const headerErrors: string[] = [];

        if (headers[0] !== "CodigoAlternativo") {
          headerErrors.push(`A primeira coluna deve ser "CodigoAlternativo" (encontrado: "${headers[0]}")`);
        }

        // Verificar se todos os campos escolhidos estão presentes
        const camposEsperados = camposOrdenados.map((f) => f.key);
        const camposFaltantes = camposEsperados.filter((c) => !headers.includes(c));
        if (camposFaltantes.length > 0) {
          headerErrors.push(
            `Colunas esperadas não encontradas: ${camposFaltantes.join(", ")}. Use a planilha modelo gerada na Etapa 1.`,
          );
        }

        // Verificar colunas extras (não bloqueante, só aviso)
        const colunasExtras = headers.slice(1).filter((h) => !camposEsperados.includes(h) && h !== "");
        if (colunasExtras.length > 0) {
          // Não bloqueia, mas mostra warning
          console.warn(`Planilha tem colunas extras que serão ignoradas: ${colunasExtras.join(", ")}`);
        }

        if (headerErrors.length > 0) {
          throw new Error(headerErrors.join(" | "));
        }

        // Mapa header → índice da coluna
        const colIdx: Record<string, number> = {};
        headers.forEach((h, i) => {
          colIdx[h] = i;
        });

        // Processar linhas de dados (a partir da linha 2 do Excel = índice 1 do array)
        const linhasParseadas: LinhaPlanilhaParseada[] = [];
        const dataRows = rows.slice(1);

        if (dataRows.length === 0) {
          throw new Error("Planilha sem linhas de dados. Preencha pelo menos 1 linha após o header.");
        }

        if (dataRows.length > MAX_LINHAS) {
          throw new Error(
            `Limite de ${MAX_LINHAS} linhas por job excedido (encontradas: ${dataRows.length}). Divida a planilha em múltiplos jobs.`,
          );
        }

        for (let i = 0; i < dataRows.length; i++) {
          const row = dataRows[i];
          const numeroLinhaExcel = i + 2; // +2 porque linha 1 é header e Excel é 1-indexed
          const erros: string[] = [];

          // Pular linhas totalmente vazias (sem erro, apenas ignora)
          const todasVazias = row.every((cell) => cell === "" || cell == null);
          if (todasVazias) continue;

          // CodigoAlternativo é obrigatório
          const codigoAlternativo = String(row[colIdx.CodigoAlternativo] ?? "").trim();
          if (!codigoAlternativo) {
            erros.push("CodigoAlternativo vazio");
          }

          // Processar campos editáveis
          const valoresNovos: Record<string, string> = {};
          let temPeloMenosUmCampo = false;

          for (const field of camposOrdenados) {
            const rawValue = row[colIdx[field.key]];
            const value = rawValue == null ? "" : String(rawValue).trim();

            if (value === "") continue; // célula vazia = não alterar esse campo nessa linha

            temPeloMenosUmCampo = true;

            // Validar enum
            if (field.type === "enum" && field.options) {
              const normalized = normalizeEnumValue(field, value);
              if (normalized == null) {
                const valores = field.options.map((o) => o.value).join(", ");
                erros.push(`${field.key}: valor "${value}" inválido (aceitos: ${valores})`);
              } else {
                valoresNovos[field.key] = normalized;
              }
            } else {
              // Texto livre
              if (field.maxLength && value.length > field.maxLength) {
                erros.push(`${field.key}: valor com ${value.length} caracteres excede o máximo de ${field.maxLength}`);
              } else {
                valoresNovos[field.key] = value;
              }
            }
          }

          if (!temPeloMenosUmCampo && codigoAlternativo) {
            erros.push("Nenhum campo a alterar preenchido (preencha ao menos uma das colunas editáveis)");
          }

          linhasParseadas.push({
            numeroLinhaExcel,
            codigoAlternativo,
            valoresNovos,
            erros,
          });
        }

        if (linhasParseadas.length === 0) {
          throw new Error("Nenhuma linha com dados encontrada (todas as linhas estavam vazias).");
        }

        setLinhas(linhasParseadas);

        const validas = linhasParseadas.filter((l) => l.erros.length === 0).length;
        const invalidas = linhasParseadas.length - validas;

        if (invalidas === 0) {
          toast.success(`${validas} linha(s) válida(s) — pronto para avançar.`);
        } else {
          toast.warning(
            `${validas} válida(s), ${invalidas} com erro. Corrija a planilha ou marque "Ignorar linhas inválidas".`,
          );
        }
      } catch (err: any) {
        console.error("Erro ao processar planilha:", err);
        setErroGeral(err?.message || String(err));
        setLinhas([]);
        toast.error(err?.message || "Erro ao processar planilha");
      } finally {
        setParsing(false);
      }
    },
    [camposOrdenados],
  );

  // ─── Reset ──────────────────────────────────────────────────────

  const resetar = () => {
    setNomeArquivo("");
    setLinhas([]);
    setErroGeral(null);
    setIgnorarInvalidas(false);
  };

  // ─── Avançar ────────────────────────────────────────────────────

  const validas = linhas.filter((l) => l.erros.length === 0);
  const invalidas = linhas.filter((l) => l.erros.length > 0);
  const temLinhas = linhas.length > 0;
  const todasValidas = temLinhas && invalidas.length === 0;
  const podeAvancar = todasValidas || (temLinhas && ignorarInvalidas && validas.length > 0);

  const handleAvancar = () => {
    if (!podeAvancar) return;
    const linhasParaProsseguir: LinhaPlanilhaValida[] = validas.map((l, idx) => ({
      sequencia: idx + 1,
      codigoAlternativo: l.codigoAlternativo,
      valoresNovos: l.valoresNovos,
    }));
    onAvancar(linhasParaProsseguir, nomeArquivo);
  };

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Aviso de limite */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <FileSpreadsheet className="h-5 w-5 shrink-0 text-blue-600" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">Upload da planilha preenchida</p>
            <p className="text-muted-foreground">
              Envie o arquivo Excel (.xlsx) que você baixou na Etapa 1 e preencheu. Limite:{" "}
              <strong>{MAX_LINHAS} linhas por job</strong>. Se precisar editar mais produtos, divida em múltiplos jobs.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Dropzone ou Preview */}
      {!temLinhas && !erroGeral && (
        <Card>
          <CardContent
            className={`flex min-h-[300px] flex-col items-center justify-center gap-4 border-2 border-dashed p-8 transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/30"
            }`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileInput} className="hidden" />
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-1 text-center">
              <p className="font-medium text-foreground">
                {parsing
                  ? "Processando arquivo..."
                  : isDragging
                    ? "Solte o arquivo aqui"
                    : "Arraste o arquivo aqui ou clique para selecionar"}
              </p>
              <p className="text-sm text-muted-foreground">Aceita .xlsx ou .xls (máx 10MB, {MAX_LINHAS} linhas)</p>
            </div>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={parsing}>
              Selecionar arquivo
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Erro geral (problema na estrutura da planilha) */}
      {erroGeral && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 shrink-0 text-red-600" />
              <div className="space-y-1 text-sm">
                <p className="font-medium text-foreground">Não foi possível processar a planilha</p>
                <p className="text-muted-foreground">{erroGeral}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={resetar}>
              <RotateCcw className="h-4 w-4" />
              Tentar outro arquivo
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Resumo de validação */}
      {temLinhas && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="flex items-center gap-3 p-4">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <div>
                <p className="text-2xl font-bold text-foreground">{validas.length}</p>
                <p className="text-xs text-muted-foreground">Linhas válidas</p>
              </div>
            </CardContent>
          </Card>
          <Card className={invalidas.length > 0 ? "border-red-500/30 bg-red-500/5" : "border-border"}>
            <CardContent className="flex items-center gap-3 p-4">
              <XCircle className={invalidas.length > 0 ? "h-5 w-5 text-red-600" : "h-5 w-5 text-muted-foreground"} />
              <div>
                <p className="text-2xl font-bold text-foreground">{invalidas.length}</p>
                <p className="text-xs text-muted-foreground">Linhas com erro</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{nomeArquivo}</p>
                <p className="text-xs text-muted-foreground">{linhas.length} linha(s) processada(s)</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Toggle "Ignorar linhas inválidas" */}
      {invalidas.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="flex-1 space-y-2 text-sm">
              <p className="font-medium text-foreground">Há {invalidas.length} linha(s) com erro</p>
              <p className="text-muted-foreground">
                Você pode <strong>corrigir a planilha</strong> e enviá-la novamente, ou marcar a opção abaixo para
                prosseguir <strong>somente com as {validas.length} linhas válidas</strong> (as inválidas serão
                ignoradas).
              </p>
              <label className="flex cursor-pointer items-center gap-2 pt-1">
                <Checkbox checked={ignorarInvalidas} onCheckedChange={(checked) => setIgnorarInvalidas(!!checked)} />
                <span className="text-sm font-medium text-foreground">
                  Ignorar linhas inválidas e prosseguir com {validas.length} válidas
                </span>
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabela de preview */}
      {temLinhas && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-secondary text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">#</th>
                    <th className="px-3 py-2 text-left font-medium">Linha Excel</th>
                    <th className="px-3 py-2 text-left font-medium">CodigoAlternativo</th>
                    {camposOrdenados.map((f) => (
                      <th key={f.key} className="px-3 py-2 text-left font-medium">
                        {f.label}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha, idx) => {
                    const isInvalida = linha.erros.length > 0;
                    return (
                      <tr key={idx} className={`border-t border-border ${isInvalida ? "bg-red-500/5" : ""}`}>
                        <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{linha.numeroLinhaExcel}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {linha.codigoAlternativo || <span className="text-red-600">(vazio)</span>}
                        </td>
                        {camposOrdenados.map((f) => (
                          <td key={f.key} className="px-3 py-2">
                            {linha.valoresNovos[f.key] || <span className="text-muted-foreground/40">—</span>}
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          {isInvalida ? (
                            <div className="flex flex-col gap-1">
                              <Badge
                                variant="outline"
                                className="w-fit border-red-500/30 bg-red-500/10 text-xs text-red-600"
                              >
                                <XCircle className="mr-1 h-3 w-3" />
                                Erro
                              </Badge>
                              {linha.erros.map((e, i) => (
                                <p key={i} className="text-xs text-red-600">
                                  • {e}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-600"
                            >
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                              OK
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Botões de navegação */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onVoltar}>
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <div className="flex items-center gap-2">
          {temLinhas && (
            <Button variant="ghost" onClick={resetar}>
              <RotateCcw className="h-4 w-4" />
              Reenviar planilha
            </Button>
          )}
          <Button onClick={handleAvancar} disabled={!podeAvancar}>
            Avançar
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
