// src/components/compras/LancarNfePagamento.tsx
//
// Etapa B / Fatia 5 — Seção de pagamento do lançamento de NF-e.
// Componente separado (filho do LancarNfeModalV2).
//
// - Busca a condição de pagamento (pedido_compra_cond_pagamento) em
//   condicoes_pagamento e gera as parcelas automaticamente.
// - Parcelas sobre o TOTAL DOS ITENS (o que será lançado), não o da nota.
// - Cada parcela: vencimento (Date Picker editável), valor (editável),
//   tipo de cobrança (dropdown, default 0000021 BOLETO OUTROS BANCOS).
// - Tipo de conta a pagar (header), default 0000016 SANTANDER-PF.
// - Listas de tipo de conta (24) e tipo de cobrança (22): constantes curadas.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon, Plus, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Listas fixas curadas ───────────────────────────────────────────────────

// Tipo de Conta a Pagar (CodigoTipoPagRec, header). Default 0000016 SANTANDER-PF.
const TIPOS_CONTA_PAGAR = [
  { codigo: "0000016", nome: "SANTANDER - PF" },
  { codigo: "0000015", nome: "SANTANDER - BIO" },
  { codigo: "0000025", nome: "SAFRA - PF" },
  { codigo: "0000026", nome: "ITAU" },
  { codigo: "0000014", nome: "PF EXTERIOR - ÁUSTRIA" },
  { codigo: "0000002", nome: "PAGAR" },
  { codigo: "0000001", nome: "RECEBER" },
  { codigo: "0000017", nome: "ADIANTAMENTO AO FORNECEDOR" },
  { codigo: "0000004", nome: "ADIANTAMENTO A FORNECEDOR - BIO" },
  { codigo: "0000005", nome: "ADIANTAMENTO A FORNECEDOR - IMPORTAÇÃO" },
  { codigo: "0000008", nome: "BAIXA ADIANTAMENTO FORNECEDORES" },
  { codigo: "0000020", nome: "BAIXA ADIANT A FORNECEDOR - IMPORTAÇÃO" },
  { codigo: "0000006", nome: "BAIXA ADIANTAMENTO DE CLIENTES" },
  { codigo: "0000009", nome: "BAIXA ADIANTAMENTO DE DESPESAS" },
  { codigo: "0000007", nome: "BAIXA DE ADT DESPACHANTE ADUANEIROS" },
  { codigo: "0000010", nome: "BONIFICAÇÃO" },
  { codigo: "0000011", nome: "CAIXINHA" },
  { codigo: "0000024", nome: "CREDITO ICMS" },
  { codigo: "0000019", nome: "ENCONTRO DE CONTAS" },
  { codigo: "0000018", nome: "IMPORTAÇÃO INICIAL" },
  { codigo: "0000013", nome: "MasterCard - FINAL 2196 - FINANCEIRO" },
  { codigo: "0000012", nome: "MasterCard - FINAL 5401 - JORGE" },
  { codigo: "0000023", nome: "MasterCard - FINAL 6216 - GUILHERME" },
  { codigo: "0000021", nome: "MasterCard - FINAL 6216 - GUILHERME" },
];

// Tipo de Cobrança (CodigoTipoCobranca, parcela). Default 0000021 BOLETO OUTROS BANCOS.
const TIPOS_COBRANCA = [
  { codigo: "0000021", nome: "BOLETO OUTROS BANCOS" },
  { codigo: "0000011", nome: "BOLETO SANTANDER" },
  { codigo: "0000022", nome: "BOLETOS CONTAS CONSUMO" },
  { codigo: "0000006", nome: "PIX" },
  { codigo: "0000002", nome: "CARTAO DE CREDITO" },
  { codigo: "0000003", nome: "DDA" },
  { codigo: "0000007", nome: "DEBITO AUTOMATICO" },
  { codigo: "0000004", nome: "TED OUTROS BANCOS" },
  { codigo: "0000014", nome: "TRANSF SANTANDER - FOLHA" },
  { codigo: "0000005", nome: "TRANSMISSAO DE ARQUIVO" },
  { codigo: "0000012", nome: "CAMBIO" },
  { codigo: "0000013", nome: "CREDITO ICMS" },
  { codigo: "0000019", nome: "DARF S/ COD. DE BARRAS" },
  { codigo: "0000020", nome: "GPS S/ COD. BARRAS" },
  { codigo: "0000016", nome: "GUIA RECALCULADA" },
  { codigo: "0000018", nome: "GUIA TRIBUTOS C/ BARRAS" },
  { codigo: "0000008", nome: "PGTO ANTECIPADO" },
  { codigo: "0000015", nome: "BAIXA ADIANTAMENTO" },
  { codigo: "0000017", nome: "ENCONTRO DE CONTAS" },
  { codigo: "0000009", nome: "AGUARDANDO BOLETO" },
  { codigo: "0000010", nome: "AGUARDANDO REEMBOLSO AUSTRIA" },
  { codigo: "0000001", nome: "-------" },
];

const DEFAULT_TIPO_CONTA = "0000016";
const DEFAULT_TIPO_COBRANCA = "0000021";

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ParcelaUI {
  sequencia: number;
  vencimento: Date;
  valor: number;
  tipoCobranca: string;
}

export interface PagamentoState {
  tipoContaPagar: string;
  codigoCondPag: string | null;
  nomeCondPag: string | null;
  parcelas: ParcelaUI[];
}

interface LancarNfePagamentoProps {
  codigoCondPagPedido: string | null; // pedido_compra_cond_pagamento
  totalItens: number; // base das parcelas (total dos itens)
  dataEmissao: string | null; // base para os vencimentos
  onChange: (estado: PagamentoState) => void;
}

const fmtMoeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function addDias(base: Date, dias: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  return d;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function LancarNfePagamento({
  codigoCondPagPedido,
  totalItens,
  dataEmissao,
  onChange,
}: LancarNfePagamentoProps) {
  const [tipoContaPagar, setTipoContaPagar] = useState(DEFAULT_TIPO_CONTA);
  const [condPag, setCondPag] = useState<{
    codigo: string;
    nome: string;
    qtd: number;
    diasEntre: number;
    primeiro: number;
  } | null>(null);
  const [parcelas, setParcelas] = useState<ParcelaUI[]>([]);
  const [datePopoverIdx, setDatePopoverIdx] = useState<number | null>(null);
  const [carregando, setCarregando] = useState(false);

  // Busca a condição de pagamento do pedido.
  useEffect(() => {
    if (!codigoCondPagPedido) {
      setCondPag(null);
      return;
    }
    (async () => {
      setCarregando(true);
      const { data } = await (supabase as any)
        .from("condicoes_pagamento")
        .select("codigo, nome, quantidade_parcelas, dias_entre_parcelas, primeiro_vencimento_apos")
        .eq("codigo", codigoCondPagPedido)
        .maybeSingle();
      if (data) {
        setCondPag({
          codigo: data.codigo,
          nome: data.nome,
          qtd: Math.max(1, data.quantidade_parcelas || 1),
          diasEntre: data.dias_entre_parcelas || 30,
          primeiro: data.primeiro_vencimento_apos || 30,
        });
      } else {
        setCondPag(null);
      }
      setCarregando(false);
    })();
  }, [codigoCondPagPedido]);

  // Gera as parcelas quando a condição ou o total mudam.
  useEffect(() => {
    if (!condPag || totalItens <= 0) {
      setParcelas([]);
      return;
    }
    const base = dataEmissao ? new Date(`${dataEmissao}T00:00:00`) : new Date();
    const qtd = condPag.qtd;
    const valorBase = Math.floor((totalItens / qtd) * 100) / 100;
    const novas: ParcelaUI[] = [];
    for (let i = 0; i < qtd; i++) {
      const venc = addDias(base, condPag.primeiro + condPag.diasEntre * i);
      const valor = i === qtd - 1 ? Number((totalItens - valorBase * (qtd - 1)).toFixed(2)) : valorBase;
      novas.push({ sequencia: i + 1, vencimento: venc, valor, tipoCobranca: DEFAULT_TIPO_COBRANCA });
    }
    setParcelas(novas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condPag, totalItens, dataEmissao]);

  // Sobe o estado para o pai.
  useEffect(() => {
    onChange({
      tipoContaPagar,
      codigoCondPag: condPag?.codigo || null,
      nomeCondPag: condPag?.nome || null,
      parcelas,
    });
  }, [tipoContaPagar, condPag, parcelas, onChange]);

  const atualizarParcela = useCallback((idx: number, patch: Partial<ParcelaUI>) => {
    setParcelas((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }, []);

  const adicionarParcela = () => {
    setParcelas((prev) => {
      const ultima = prev[prev.length - 1];
      const venc = ultima ? addDias(ultima.vencimento, condPag?.diasEntre || 30) : new Date();
      return [...prev, { sequencia: prev.length + 1, vencimento: venc, valor: 0, tipoCobranca: DEFAULT_TIPO_COBRANCA }];
    });
  };

  const removerParcela = (idx: number) =>
    setParcelas((prev) => prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, sequencia: i + 1 })));

  const totalParcelas = parcelas.reduce((s, p) => s + p.valor, 0);
  const diferenca = Number((totalParcelas - totalItens).toFixed(2));
  const fecha = Math.abs(diferenca) < 0.01;

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">Pagamento</h4>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 max-w-2xl">
        {/* Tipo de conta a pagar */}
        <div className="space-y-1.5">
          <Label className="text-xs">Conta a pagar</Label>
          <Select value={tipoContaPagar} onValueChange={setTipoContaPagar}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPOS_CONTA_PAGAR.map((t) => (
                <SelectItem key={t.codigo} value={t.codigo} className="text-xs">
                  <span className="font-mono mr-2">{t.codigo}</span>
                  {t.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Condição de pagamento (leitura) */}
        <div className="space-y-1.5">
          <Label className="text-xs">Condição de pagamento</Label>
          <div className="flex h-9 items-center rounded-md border bg-muted/30 px-3 text-xs">
            {carregando ? (
              "carregando..."
            ) : condPag ? (
              <span>
                <span className="font-mono mr-2">{condPag.codigo}</span>
                {condPag.nome}
              </span>
            ) : (
              <span className="text-amber-600">condição não encontrada</span>
            )}
          </div>
        </div>
      </div>

      {/* Tabela de parcelas */}
      <div className="rounded-md border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2 font-medium w-12">#</th>
              <th className="p-2 font-medium">Vencimento</th>
              <th className="p-2 font-medium text-right">Valor</th>
              <th className="p-2 font-medium">Tipo de cobrança</th>
              <th className="p-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {parcelas.map((p, idx) => (
              <tr key={idx} className="border-t">
                <td className="p-2 font-mono text-center">{p.sequencia}</td>
                <td className="p-2">
                  <Popover open={datePopoverIdx === idx} onOpenChange={(v) => setDatePopoverIdx(v ? idx : null)}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs font-normal">
                        <CalendarIcon className="h-3 w-3" />
                        {format(p.vencimento, "dd/MM/yyyy", { locale: ptBR })}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={p.vencimento}
                        onSelect={(d) => {
                          if (d) {
                            atualizarParcela(idx, { vencimento: d });
                            setDatePopoverIdx(null);
                          }
                        }}
                        initialFocus
                        locale={ptBR}
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </td>
                <td className="p-2 text-right">
                  <Input
                    type="number"
                    step="0.01"
                    value={p.valor}
                    onChange={(e) => atualizarParcela(idx, { valor: Number(e.target.value) || 0 })}
                    className="h-8 w-28 text-right text-xs ml-auto"
                  />
                </td>
                <td className="p-2">
                  <Select value={p.tipoCobranca} onValueChange={(v) => atualizarParcela(idx, { tipoCobranca: v })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_COBRANCA.map((t) => (
                        <SelectItem key={t.codigo} value={t.codigo} className="text-xs">
                          <span className="font-mono mr-2">{t.codigo}</span>
                          {t.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="p-2">
                  {parcelas.length > 1 && (
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => removerParcela(idx)}>
                      <Trash2 className="h-3 w-3 text-muted-foreground" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {parcelas.length === 0 && (
              <tr>
                <td colSpan={5} className="p-3 text-center text-muted-foreground">
                  {condPag ? "Sem parcelas." : "Defina a condição de pagamento."}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30">
              <td colSpan={2} className="p-2 text-right text-muted-foreground">
                Total das parcelas
              </td>
              <td className="p-2 text-right font-semibold">{fmtMoeda(totalParcelas)}</td>
              <td colSpan={2} className="p-2">
                {!fecha && (
                  <span className="flex items-center gap-1 text-[11px] text-destructive">
                    <AlertTriangle className="h-3 w-3" /> dif. {fmtMoeda(diferenca)} vs itens
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={adicionarParcela}>
        <Plus className="h-3 w-3" /> Adicionar parcela
      </Button>
    </div>
  );
}
