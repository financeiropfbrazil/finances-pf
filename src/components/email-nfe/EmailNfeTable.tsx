import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invokeImportEmailNfe } from "@/services/importEmailNfeService";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileText, FileDown, CheckCircle2, CircleDashed, AlertCircle,
  MoreHorizontal, Upload, ExternalLink, Eye, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { downloadStorageFile } from "@/utils/storageDownload";
import type { ComprasInfo } from "./useComprasStatus";
import MassImportDialog from "./MassImportDialog";

// ── Types ──

export type EmailNfStatus = "pendente" | "classificada" | "processada" | "erro" | "ignorada";
export type EmailNfModelo = "nfe_55" | "nfse" | "nfcom_62" | "cte_57" | "outro" | "sem_xml";

export interface EmailNotaFiscal {
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
  xml_storage_path: string | null;
  pdf_storage_path: string | null;
  chave_acesso: string | null;
}

// ── Config ──

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

const IMPORTABLE_MODELOS: EmailNfModelo[] = ["nfe_55", "nfse", "nfcom_62", "cte_57"];

const destinoRoutes: Record<string, string> = {
  compras_nfse: "/compras/notas-servico",
  compras_nfe: "/compras/notas-fiscais",
};

// ── Helpers ──

import { format } from "date-fns";

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
    return dt.getFullYear() !== now.getFullYear()
      ? format(dt, "dd/MM/yy HH:mm")
      : format(dt, "dd/MM HH:mm");
  } catch {
    return d;
  }
};

// ── Props ──

interface Props {
  rows: EmailNotaFiscal[];
  comprasStatus: Record<string, ComprasInfo>;
  onOpenDetail: (id: string) => void;
  onImportDone: () => void;
}

export default function EmailNfeTable({ rows, comprasStatus, onOpenDetail, onImportDone }: Props) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importingId, setImportingId] = useState<string | null>(null);
  const [massImportOpen, setMassImportOpen] = useState(false);

  // Eligibility
  const isEligible = (row: EmailNotaFiscal) =>
    row.status !== "ignorada" &&
    row.chave_acesso !== null &&
    IMPORTABLE_MODELOS.includes(row.modelo) &&
    !comprasStatus[row.id]?.already_in_compras;

  const eligibleIds = useMemo(() => rows.filter(isEligible).map((r) => r.id), [rows, comprasStatus]);

  // Selection
  const allSelected = eligibleIds.length > 0 && eligibleIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligibleIds));
    }
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Individual import
  const handleImportOne = async (row: EmailNotaFiscal) => {
    setImportingId(row.id);
    try {
      const data = await invokeImportEmailNfe("import", [row.id]);
      const r = data?.results?.[0];
      if (r?.success || (r && !r.error)) {
        toast.success(`NF importada para ${r.destino || "Compras"}`);
        onImportDone();
      } else {
        toast.error(r?.error || r?.message || "Erro ao importar");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao importar");
    } finally {
      setImportingId(null);
    }
  };

  // Mass import items
  const massImportItems = useMemo(
    () => rows.filter((r) => selected.has(r.id)).map((r) => ({ id: r.id, emitente_nome: r.emitente_nome })),
    [rows, selected]
  );

  const handleMassImportClose = (imported: boolean) => {
    setMassImportOpen(false);
    setSelected(new Set());
    if (imported) onImportDone();
  };

  // Compras indicator
  const renderComprasIndicator = (row: EmailNotaFiscal) => {
    const info = comprasStatus[row.id];
    if (info?.already_in_compras) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </TooltipTrigger>
          <TooltipContent>Já importada para Compras</TooltipContent>
        </Tooltip>
      );
    }
    if (IMPORTABLE_MODELOS.includes(row.modelo) && row.chave_acesso) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <CircleDashed className="h-4 w-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>Pendente importação</TooltipContent>
        </Tooltip>
      );
    }
    if (row.modelo === "outro" || row.modelo === "sem_xml") {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertCircle className="h-4 w-4 text-amber-500" />
          </TooltipTrigger>
          <TooltipContent>Sem destino definido</TooltipContent>
        </Tooltip>
      );
    }
    return <span className="text-muted-foreground">—</span>;
  };

  // Eligibility tooltip for disabled checkboxes
  const disabledReason = (row: EmailNotaFiscal): string | null => {
    if (comprasStatus[row.id]?.already_in_compras) return "Já importada";
    if (!row.chave_acesso) return "Sem chave de acesso";
    if (!IMPORTABLE_MODELOS.includes(row.modelo)) return "Modelo sem destino";
    if (row.status === "ignorada") return "Ignorada";
    return null;
  };

  return (
    <>
      {/* Mass action bar */}
      {someSelected && (
        <div className="flex items-center justify-between px-4 py-2 bg-primary text-primary-foreground rounded-md">
          <span>{selected.size} nota(s) selecionada(s)</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setMassImportOpen(true)}>
              <Upload className="h-4 w-4 mr-1" /> Importar para Compras
            </Button>
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleAll}
                aria-label="Selecionar todos"
              />
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Recebido</TableHead>
            <TableHead>Modelo</TableHead>
            <TableHead>Número</TableHead>
            <TableHead>Emitente</TableHead>
            <TableHead>Empresa</TableHead>
            <TableHead className="w-[80px] text-center">Compras</TableHead>
            <TableHead className="text-right">Valor</TableHead>
            <TableHead>Anexos</TableHead>
            <TableHead className="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const sc = statusConfig[row.status] || statusConfig.pendente;
            const mc = modeloConfig[row.modelo] || modeloConfig.outro;
            const isErro = row.status === "erro";
            const isPendente = row.status === "pendente";
            const eligible = isEligible(row);
            const reason = disabledReason(row);
            const info = comprasStatus[row.id];

            return (
              <TableRow
                key={row.id}
                className={`cursor-pointer hover:bg-muted/50 ${isErro ? "bg-red-50" : ""} ${isPendente ? "font-medium" : ""}`}
                onClick={() => onOpenDetail(row.id)}
              >
                {/* Checkbox */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {eligible ? (
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggleOne(row.id)}
                    />
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span><Checkbox disabled /></span>
                      </TooltipTrigger>
                      <TooltipContent>{reason}</TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>

                {/* Status */}
                <TableCell>
                  <Badge variant="outline" className={`${sc.className} text-[10px] whitespace-nowrap`}>
                    {sc.label}
                  </Badge>
                </TableCell>

                {/* Recebido */}
                <TableCell className="whitespace-nowrap text-sm">{fmtDate(row.email_received_at)}</TableCell>

                {/* Modelo */}
                <TableCell>
                  <Badge variant="outline" className={`${mc.className} text-[10px] whitespace-nowrap`}>
                    {mc.label}
                  </Badge>
                </TableCell>

                {/* Número */}
                <TableCell className="text-sm">
                  {row.numero_nota || row.serie
                    ? `${row.numero_nota || ""}${row.serie ? "/" + row.serie : ""}`
                    : <span className="text-muted-foreground">—</span>}
                </TableCell>

                {/* Emitente */}
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

                {/* Empresa */}
                <TableCell>
                  {row.empresa_filial ? (
                    <Badge variant="outline" className="text-[10px] whitespace-nowrap">
                      {empresaLabels[row.empresa_filial] || row.empresa_filial}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>

                {/* Compras indicator */}
                <TableCell className="text-center">
                  {renderComprasIndicator(row)}
                </TableCell>

                {/* Valor */}
                <TableCell className="text-right font-mono text-sm">
                  {row.valor_total ? fmtBRL(row.valor_total) : <span className="text-muted-foreground">—</span>}
                </TableCell>

                {/* Anexos */}
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {row.xml_storage_path && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadStorageFile(row.xml_storage_path!, `${row.numero_nota || "nf"}_${row.serie || ""}.xml`);
                            }}
                            className="p-1 rounded hover:bg-muted"
                          >
                            <FileText className="h-4 w-4 text-blue-500" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Baixar XML</TooltipContent>
                      </Tooltip>
                    )}
                    {row.pdf_storage_path && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadStorageFile(row.pdf_storage_path!, `${row.numero_nota || "nf"}_${row.serie || ""}.pdf`);
                            }}
                            className="p-1 rounded hover:bg-muted"
                          >
                            <FileDown className="h-4 w-4 text-red-500" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Baixar PDF</TooltipContent>
                      </Tooltip>
                    )}
                    {!row.xml_storage_path && row.tem_xml && <FileText className="h-4 w-4 text-blue-500 opacity-30" />}
                    {!row.pdf_storage_path && row.tem_pdf && <FileDown className="h-4 w-4 text-red-500 opacity-30" />}
                    {!row.tem_xml && !row.tem_pdf && <span className="text-muted-foreground">—</span>}
                  </div>
                </TableCell>

                {/* Actions */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onOpenDetail(row.id)}>
                        <Eye className="h-4 w-4 mr-2" /> Ver detalhes
                      </DropdownMenuItem>
                      {eligible && (
                        <DropdownMenuItem
                          disabled={importingId === row.id}
                          onClick={() => handleImportOne(row)}
                        >
                          {importingId === row.id ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4 mr-2" />
                          )}
                          Importar para Compras
                        </DropdownMenuItem>
                      )}
                      {info?.already_in_compras && info.destino && (
                        <DropdownMenuItem
                          onClick={() => navigate(destinoRoutes[info.destino] || "/compras/notas-fiscais")}
                        >
                          <ExternalLink className="h-4 w-4 mr-2" /> Ver em Compras
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <MassImportDialog
        open={massImportOpen}
        items={massImportItems}
        onClose={handleMassImportClose}
      />
    </>
  );
}
