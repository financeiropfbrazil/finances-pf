// src/components/compras/LancarNfeModalV2.tsx
//
// Etapa B — Modal de lançamento de NF-e (produto) no Alvo. Versão nova (V2).
//
// Layout profissional de ERP: quase tela cheia, header fixo no topo, conteúdo
// rolável no meio, footer fixo embaixo (Lançar/Cancelar sempre visíveis).
// Cabeçalho da nota compacto; seções bem separadas.
//
// FATIAS PRONTAS: 1 (cabeçalho + tipo), 2b (tabela de itens completa).
// PRÓXIMAS: 3 (impostos), 4 (lote), 5 (pagamento), 6 (conferência + lançar).

import { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { LancarNfeItensTable, type ItemLancamento } from "@/components/compras/LancarNfeItensTable";
import { X, FileText, Building2, Calendar, Hash, KeyRound, Link2, AlertTriangle } from "lucide-react";

const TIPOS_LANCAMENTO = [
  { codigo: "E0000158", nome: "Entrada NF-e c/ Laudo (lote)" },
  { codigo: "E0000003", nome: "Entrada NF-e (comum)" },
];

interface NfeRow {
  id: string;
  numero: string | null;
  serie: string | null;
  chave_acesso: string | null;
  data_emissao: string | null;
  emitente_nome: string | null;
  emitente_cnpj: string | null;
  valor_total: number | null;
  raw_xml: string | null;
  dados_extraidos: any;
  pedido_compra_numero: string | null;
  pedido_compra_entidade: string | null;
  pedido_compra_classe: string | null;
  pedido_compra_centro_custo: string | null;
  pedido_compra_cond_pagamento: string | null;
  pedido_compra_valor: number | null;
  [k: string]: any;
}

interface LancarNfeModalV2Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nfe: NfeRow | null;
  onLancado: () => void;
}

const fmtMoeda = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtData = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
};

const fmtCnpj = (c: string | null) => {
  if (!c) return "";
  const d = c.replace(/\D/g, "");
  if (d.length !== 14) return c;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

// Bloco compacto de info do cabeçalho (label pequeno + valor)
function InfoBloco({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-0.5 text-sm font-medium truncate">{children}</div>
    </div>
  );
}

export function LancarNfeModalV2({ open, onOpenChange, nfe, onLancado }: LancarNfeModalV2Props) {
  const [tipoLancamento, setTipoLancamento] = useState("E0000158");
  const [itens, setItens] = useState<ItemLancamento[]>([]);

  useEffect(() => {
    if (open) {
      setTipoLancamento("E0000158");
      setItens([]);
    }
  }, [open, nfe?.id]);

  if (!nfe) return null;

  const temPedido = !!nfe.pedido_compra_numero;
  const totalItens = itens.reduce((s, it) => s + it.valorProduto, 0);
  const diferenca = Number((totalItens - (nfe.valor_total || 0)).toFixed(2));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[95vw] w-[95vw] h-[92vh] p-0 gap-0 flex flex-col overflow-hidden sm:rounded-lg"
        // remove o X padrão do shadcn (temos um próprio no header)
      >
        {/* ─────────── HEADER FIXO ─────────── */}
        <div className="shrink-0 border-b bg-muted/30 px-6 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-primary/10 p-2">
                <FileText className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-semibold leading-tight">Lançar NF-e no estoque</h2>
                <p className="text-xs text-muted-foreground">
                  NF {nfe.numero || "s/nº"}
                  {nfe.serie ? `-${nfe.serie}` : ""} · entrada de mercadoria
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Linha de infos compactas */}
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4 lg:grid-cols-5">
            <InfoBloco icon={Building2} label="Fornecedor">
              <span title={nfe.emitente_nome || ""}>{nfe.emitente_nome || "—"}</span>
              <div className="text-[11px] font-normal text-muted-foreground font-mono">
                {fmtCnpj(nfe.emitente_cnpj)}
              </div>
            </InfoBloco>
            <InfoBloco icon={Calendar} label="Emissão">
              {fmtData(nfe.data_emissao)}
            </InfoBloco>
            <InfoBloco icon={Hash} label="Valor da nota">
              {fmtMoeda(nfe.valor_total)}
            </InfoBloco>
            <InfoBloco icon={Link2} label="Pedido">
              {temPedido ? (
                <Badge variant="secondary" className="font-mono text-xs">
                  {nfe.pedido_compra_numero}
                </Badge>
              ) : (
                <span className="text-amber-600 text-xs">não vinculado</span>
              )}
            </InfoBloco>
            <InfoBloco icon={KeyRound} label="Chave de acesso">
              <span className="font-mono text-[11px] font-normal break-all" title={nfe.chave_acesso || ""}>
                {nfe.chave_acesso ? `${nfe.chave_acesso.slice(0, 12)}…${nfe.chave_acesso.slice(-6)}` : "—"}
              </span>
            </InfoBloco>
          </div>
        </div>

        {/* ─────────── CONTEÚDO ROLÁVEL ─────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {!temPedido && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Esta nota não está vinculada a um pedido de compra. Vincule antes de lançar.
            </div>
          )}

          {/* Tipo de lançamento */}
          <section className="space-y-1.5 max-w-xl">
            <Label htmlFor="tipo-lancamento" className="text-sm font-medium">
              Tipo de lançamento
            </Label>
            <Select value={tipoLancamento} onValueChange={setTipoLancamento}>
              <SelectTrigger id="tipo-lancamento" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_LANCAMENTO.map((t) => (
                  <SelectItem key={t.codigo} value={t.codigo}>
                    <span className="font-mono text-xs mr-2">{t.codigo}</span>
                    {t.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Produtos com controle de lote sugerem automaticamente o tipo com laudo (E0000158).
            </p>
          </section>

          <Separator />

          {/* Itens */}
          <section>
            <LancarNfeItensTable
              itensXml={(nfe.dados_extraidos?.itens || []) as any}
              classePedido={nfe.pedido_compra_classe}
              ccPedido={nfe.pedido_compra_centro_custo}
              onChange={setItens}
            />
          </section>

          {/* Placeholder próximas fatias */}
          <Separator />
          <section className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Impostos, lote e pagamento entram nas próximas etapas.
          </section>
        </div>

        {/* ─────────── FOOTER FIXO ─────────── */}
        <div className="shrink-0 border-t bg-muted/30 px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            {/* Conferência rápida de diferença */}
            <div className="flex items-center gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Total itens: </span>
                <span className="font-semibold">{fmtMoeda(totalItens)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Nota: </span>
                <span className="font-semibold">{fmtMoeda(nfe.valor_total)}</span>
              </div>
              <Badge variant={Math.abs(diferenca) < 0.01 ? "secondary" : "destructive"} className="font-mono">
                dif. {fmtMoeda(diferenca)}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button disabled title="Disponível quando todas as etapas estiverem completas">
                Lançar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
