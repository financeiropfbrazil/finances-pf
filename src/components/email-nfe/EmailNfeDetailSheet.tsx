import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  FileText, Building2, Target, DollarSign, Tags, Info, Copy, Mail,
  FileDown,
} from "lucide-react";
import { format } from "date-fns";

// ── Helpers ──

const fmtCNPJ = (cnpj: string | null) => {
  if (!cnpj) return "—";
  const d = cnpj.replace(/\D/g, "");
  if (d.length !== 14) return cnpj;
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
};

const fmtBRL = (v: number | null | undefined) => {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
};

const fmtDateFull = (d: string | null) => {
  if (!d) return "—";
  try {
    return format(new Date(d), "dd/MM/yyyy 'às' HH:mm");
  } catch {
    return d;
  }
};

const fmtDateShort = (d: string | null, dateOnly = false) => {
  if (!d) return "—";
  try {
    const raw = dateOnly && d.length === 10 ? d + "T12:00:00" : d;
    return format(new Date(raw), "dd/MM/yyyy");
  } catch {
    return d;
  }
};

// ── Sub-components ──

function DetailRow({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="text-sm font-semibold text-foreground">{children}</h3>
    </div>
  );
}

// ── Badge configs ──

const statusConfig: Record<string, { label: string; className: string }> = {
  pendente: { label: "Pendente", className: "bg-amber-100 text-amber-800 border-amber-200" },
  classificada: { label: "Classificada", className: "bg-blue-100 text-blue-800 border-blue-200" },
  processada: { label: "Processada", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  erro: { label: "Erro", className: "bg-red-100 text-red-800 border-red-200" },
  ignorada: { label: "Ignorada", className: "bg-muted text-muted-foreground border-border" },
};

const modeloConfig: Record<string, { label: string; className: string }> = {
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

const origemConfig: Record<string, { label: string; className: string }> = {
  manual: { label: "Manual", className: "bg-muted text-muted-foreground" },
  pedido: { label: "Pedido", className: "bg-blue-100 text-blue-800" },
  historico: { label: "Histórico", className: "bg-emerald-100 text-emerald-800" },
  ai: { label: "✨ IA", className: "bg-purple-100 text-purple-800" },
};

// ── Value rows for section 5 ──

interface ValueField {
  label: string;
  key: string;
  red?: boolean;
}

const valueFields: ValueField[] = [
  { label: "Produtos/Serviços", key: "valor_produtos" },
  { label: "Desconto", key: "valor_desconto", red: true },
  { label: "Frete", key: "valor_frete" },
  { label: "ICMS", key: "valor_icms" },
  { label: "IPI", key: "valor_ipi" },
  { label: "PIS", key: "valor_pis" },
  { label: "COFINS", key: "valor_cofins" },
  { label: "ISS", key: "valor_iss" },
  { label: "Retenções", key: "valor_retencoes" },
];

// ── Main component ──

interface Props {
  selectedId: string | null;
  onClose: () => void;
}

export default function EmailNfeDetailSheet({ selectedId, onClose }: Props) {
  const { data: nf, isLoading } = useQuery({
    queryKey: ["email-nfe-detail", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("email_notas_fiscais")
        .select("*")
        .eq("id", selectedId)
        .single();
      if (error) throw error;
      return data as Record<string, any>;
    },
  });

  const handleCopyChave = () => {
    if (nf?.chave_acesso) {
      navigator.clipboard.writeText(nf.chave_acesso);
      toast.success("Chave copiada");
    }
  };

  const sc = statusConfig[nf?.status] || statusConfig.pendente;
  const mc = modeloConfig[nf?.modelo] || modeloConfig.outro;

  const title = nf?.numero_nota
    ? `NF ${nf.numero_nota}${nf.serie ? "/" + nf.serie : ""}`
    : "Email NF-e";

  const hasClassificacao = nf?.classe_codigo || nf?.centro_custo_codigo || nf?.pedido_numero;

  return (
    <Sheet open={!!selectedId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto p-0">
        {isLoading || !nf ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            {/* Header */}
            <SheetHeader className="p-6 pb-4 border-b">
              <SheetTitle className="text-lg">{title}</SheetTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className={`${sc.className} text-[10px]`}>{sc.label}</Badge>
                <Badge variant="outline" className={`${mc.className} text-[10px]`}>{mc.label}</Badge>
              </div>
            </SheetHeader>

            <div className="p-6 space-y-6">
              {/* Section 1 — Email */}
              <div className="bg-muted/30 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-4">
                  <DetailRow
                    label="De"
                    value={
                      nf.email_from_name || nf.email_from ? (
                        <div>
                          {nf.email_from_name && <span className="font-semibold">{nf.email_from_name}</span>}
                          {nf.email_from && <p className="text-xs text-muted-foreground">{nf.email_from}</p>}
                        </div>
                      ) : null
                    }
                  />
                  <DetailRow label="Recebido" value={fmtDateFull(nf.email_received_at)} />
                  <DetailRow label="Assunto" value={nf.email_subject} className="col-span-2" />
                </div>
              </div>

              {/* Section 2 — Documento Fiscal */}
              <div>
                <SectionTitle icon={FileText}>Documento Fiscal</SectionTitle>
                <div className="grid grid-cols-3 gap-4">
                  <DetailRow
                    label="Modelo"
                    value={<Badge variant="outline" className={`${mc.className} text-[10px]`}>{mc.label}</Badge>}
                  />
                  <DetailRow
                    label="Número/Série"
                    value={
                      nf.numero_nota || nf.serie
                        ? `${nf.numero_nota || ""}${nf.serie ? "/" + nf.serie : ""}`
                        : null
                    }
                  />
                  <DetailRow label="Data Emissão" value={fmtDateShort(nf.data_emissao)} />
                </div>

                {nf.chave_acesso && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground mb-0.5">Chave de Acesso</p>
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-xs break-all flex-1">{nf.chave_acesso}</code>
                      <Button variant="ghost" size="sm" onClick={handleCopyChave} className="shrink-0">
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}

                {nf.natureza_operacao && (
                  <div className="mt-3">
                    <DetailRow label="Natureza da Operação" value={nf.natureza_operacao} />
                  </div>
                )}
              </div>

              {/* Section 3 — Emitente */}
              <div>
                <SectionTitle icon={Building2}>Emitente</SectionTitle>
                <div className="grid grid-cols-2 gap-4">
                  <DetailRow label="Razão Social" value={nf.emitente_nome} />
                  <DetailRow label="Nome Fantasia" value={nf.emitente_nome_fantasia} />
                  <DetailRow label="CNPJ" value={fmtCNPJ(nf.emitente_cnpj)} />
                  <DetailRow label="IE" value={nf.emitente_ie} />
                  <DetailRow
                    label="Município/UF"
                    value={
                      nf.emitente_municipio || nf.emitente_uf
                        ? `${nf.emitente_municipio || ""}${nf.emitente_uf ? "/" + nf.emitente_uf : ""}`
                        : null
                    }
                  />
                  <DetailRow
                    label="Fornecedor Alvo"
                    value={
                      nf.fornecedor_codigo ? (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200" variant="outline">
                          {nf.fornecedor_codigo}
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-200" variant="outline">
                          Não encontrado
                        </Badge>
                      )
                    }
                  />
                </div>
              </div>

              {/* Section 4 — Destinatário */}
              <div>
                <SectionTitle icon={Target}>Destinatário</SectionTitle>
                <div className="grid grid-cols-2 gap-4">
                  <DetailRow label="Razão Social" value={nf.destinatario_nome} />
                  <DetailRow label="CNPJ" value={fmtCNPJ(nf.destinatario_cnpj)} />
                  <DetailRow
                    label="Empresa"
                    value={
                      nf.empresa_filial ? (
                        <Badge variant="outline" className="text-[10px]">
                          {empresaLabels[nf.empresa_filial] || nf.empresa_filial}
                        </Badge>
                      ) : null
                    }
                  />
                </div>
              </div>

              {/* Section 5 — Valores */}
              <div>
                <SectionTitle icon={DollarSign}>Valores</SectionTitle>
                <div className="text-2xl font-bold text-right mb-3">
                  {fmtBRL(nf.valor_total)}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {valueFields.map(({ label, key, red }) => {
                    const val = nf[key];
                    if (!val || val === 0) return null;
                    return (
                      <div key={key} className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <span className={`font-mono text-sm text-right ${red && val > 0 ? "text-red-500" : ""}`}>
                          {fmtBRL(val)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Section 6 — Classificação */}
              {hasClassificacao && (
                <div>
                  <SectionTitle icon={Tags}>Classificação</SectionTitle>
                  <div className="grid grid-cols-2 gap-4">
                    {nf.classe_codigo && (
                      <DetailRow
                        label="Classe"
                        value={`${nf.classe_codigo}${nf.classe_nome ? " - " + nf.classe_nome : ""}`}
                      />
                    )}
                    <DetailRow label="Centro de Custo" value={nf.centro_custo_nome} />
                    <DetailRow label="Pedido de Compra" value={nf.pedido_numero} />
                    {nf.origem && (
                      <DetailRow
                        label="Origem"
                        value={
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${(origemConfig[nf.origem] || origemConfig.manual).className}`}
                          >
                            {(origemConfig[nf.origem] || origemConfig.manual).label}
                          </Badge>
                        }
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Section 7 — Informações */}
              <div>
                <SectionTitle icon={Info}>Informações</SectionTitle>
                <div className="grid grid-cols-2 gap-4">
                  <DetailRow
                    label="Anexos"
                    value={
                      nf.tem_xml || nf.tem_pdf ? (
                        <div className="flex items-center gap-3">
                          {nf.tem_xml && (
                            <span className="flex items-center gap-1 text-sm">
                              <FileText className="h-4 w-4 text-blue-500" /> XML
                            </span>
                          )}
                          {nf.tem_pdf && (
                            <span className="flex items-center gap-1 text-sm">
                              <FileDown className="h-4 w-4 text-red-500" /> PDF
                            </span>
                          )}
                        </div>
                      ) : null
                    }
                  />
                  <DetailRow
                    label="Status"
                    value={
                      <Badge variant="outline" className={`${sc.className} text-[10px]`}>{sc.label}</Badge>
                    }
                  />
                  <DetailRow label="Criado em" value={fmtDateFull(nf.created_at)} />
                </div>

                {nf.status === "erro" && nf.error_message && (
                  <div className="mt-2 p-3 bg-red-500/10 border border-red-500/20 rounded-md">
                    <p className="text-sm text-red-400">{nf.error_message}</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
