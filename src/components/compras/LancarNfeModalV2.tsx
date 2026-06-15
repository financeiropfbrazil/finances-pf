// src/components/compras/LancarNfeModalV2.tsx
//
// Etapa B — Modal de lançamento de NF-e (produto) no Alvo. Versão nova (V2),
// construída ao lado do LancarNfeModal antigo, em fatias. Quando completo e
// validado, substitui o antigo (trocar o import/uso em ComprasNotasFiscais).
//
// FATIA 1: esqueleto + cabeçalho da nota + seletor de tipo de lançamento.
// Ainda NÃO tem itens, imposto, lote nem pagamento — vêm nas próximas fatias.
// O botão "Lançar" fica desabilitado até as fatias seguintes preencherem itens.
//
// Mesma assinatura do modal antigo (open, onOpenChange, nfe, onLancado) para
// a troca final ser trivial.

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { LancarNfeItensTable } from "@/components/compras/LancarNfeItensTable";

// ── Tipos de lançamento (MovEstq) ──────────────────────────────────────────
// E0000158 = entrada com laudo (produto de lote). E0000003 = entrada comum.
// "Automático com aviso": a fatia de itens vai sugerir E0000158 quando houver
// produto que controla lote. Por ora, default editável.
const TIPOS_LANCAMENTO = [
  { codigo: "E0000158", nome: "Entrada NF-e c/ Laudo (lote)" },
  { codigo: "E0000003", nome: "Entrada NF-e (comum)" },
];

// Shape mínimo da nota que o modal recebe (linha de compras_nfe).
// Tipado frouxo (as any na origem) porque types.ts está desatualizado.
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
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
};

export function LancarNfeModalV2({ open, onOpenChange, nfe, onLancado }: LancarNfeModalV2Props) {
  const [tipoLancamento, setTipoLancamento] = useState("E0000158");

  // Reset ao abrir/trocar de nota
  useEffect(() => {
    if (open) {
      setTipoLancamento("E0000158");
    }
  }, [open, nfe?.id]);

  if (!nfe) return null;

  const temPedido = !!nfe.pedido_compra_numero;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Lançar NF-e no estoque
            <Badge variant="outline" className="font-mono text-xs">
              {nfe.numero || "s/nº"}
              {nfe.serie ? `-${nfe.serie}` : ""}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* ── Cabeçalho da nota (leitura) ── */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="col-span-2">
              <span className="text-muted-foreground">Fornecedor</span>
              <p className="font-medium">{nfe.emitente_nome || "—"}</p>
              <p className="text-xs text-muted-foreground font-mono">{nfe.emitente_cnpj || ""}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Emissão</span>
              <p className="font-medium">{fmtData(nfe.data_emissao)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Valor total da nota</span>
              <p className="font-medium">{fmtMoeda(nfe.valor_total)}</p>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Chave de acesso</span>
              <p className="font-mono text-xs break-all">{nfe.chave_acesso || "—"}</p>
            </div>
          </div>

          {/* ── Vínculo com pedido (se houver) ── */}
          {temPedido ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Pedido de compra</span>
                <Badge variant="secondary" className="font-mono">
                  {nfe.pedido_compra_numero}
                </Badge>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <div>
                  Classe: <span className="text-foreground">{nfe.pedido_compra_classe || "—"}</span>
                </div>
                <div>
                  Centro de custo: <span className="text-foreground">{nfe.pedido_compra_centro_custo || "—"}</span>
                </div>
                <div>
                  Cond. pagamento: <span className="text-foreground">{nfe.pedido_compra_cond_pagamento || "—"}</span>
                </div>
                <div>
                  Valor do pedido: <span className="text-foreground">{fmtMoeda(nfe.pedido_compra_valor)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
              Esta nota ainda não está vinculada a um pedido de compra. Vincule antes de lançar.
            </div>
          )}

          <Separator />

          {/* ── Tipo de lançamento ── */}
          <div className="space-y-1.5">
            <Label htmlFor="tipo-lancamento">Tipo de lançamento</Label>
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
          </div>

          {/* ── Itens (fatia 2b) ── */}
          <LancarNfeItensTable
            itensXml={(nfe.dados_extraidos?.itens || []) as any}
            onChange={() => {
              /* fatia seguinte: guardar itens p/ o payload */
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled title="Disponível quando os itens forem preenchidos">
            Lançar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
