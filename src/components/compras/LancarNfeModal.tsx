/**
 * LancarNfeModal — modal de lançamento de NF-e de produto no Alvo (Fase 3).
 *
 * Fluxo:
 *  1. Lê os itens da NF do dados_extraidos (já no objeto nfe).
 *  2. Recarrega os itens do PEDIDO vinculado do Alvo (PedComp/Load, browser-side).
 *  3. DE-PARA MANUAL: para cada item da NF, o usuário escolhe (dropdown) qual
 *     item do pedido corresponde — ou "Não lançar este item".
 *     SUGESTÃO leve: pré-seleciona por código de produto igual, se houver.
 *  4. Permite LANÇAR PARCIAL: itens sem mapeamento são ignorados.
 *  5. Gera parcelas pela condição de pagamento do pedido.
 *  6. Chama lancarNfeNoAlvo (serviço com quantidade real) e marca a nota como lançada.
 *
 * Mapeamento é EFÊMERO (vive no modal; some ao fechar sem lançar).
 */

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authenticateAlvo, clearAlvoToken } from "@/services/alvoService";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, AlertTriangle, ArrowRight } from "lucide-react";
import {
  lancarNfeNoAlvo,
  type LancarNfeInput,
  type NfeItemInput,
  type NfeParcelaInput,
} from "@/services/alvoMovEstqLancarNfeService";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const NAO_LANCAR = "__none__";

const fmtBRL = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

interface NfeItemExtraido {
  numero_item: number;
  codigo_produto: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
}

interface PedidoItem {
  codigoProduto: string;
  nomeProduto: string;
  quantidade: number;
  valorTotal: number;
  sequencia: number;
}

interface NfeRow {
  id: string;
  numero: string | null;
  serie: string | null;
  data_emissao: string | null;
  valor_total: number | null;
  emitente_cnpj: string | null;
  emitente_nome: string | null;
  chave_acesso: string;
  valor_icms: number | null;
  base_calculo_icms: number | null;
  raw_xml: string | null;
  dados_extraidos: any;
  pedido_compra_numero: string | null;
  pedido_compra_entidade: string | null;
  pedido_compra_classe: string | null;
  pedido_compra_centro_custo: string | null;
  pedido_compra_cond_pagamento: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nfe: NfeRow | null;
  onLancado: () => void;
}

export function LancarNfeModal({ open, onOpenChange, nfe, onLancado }: Props) {
  const { toast } = useToast();
  const [loadingPedido, setLoadingPedido] = useState(false);
  const [pedidoItens, setPedidoItens] = useState<PedidoItem[]>([]);
  const [erroPedido, setErroPedido] = useState<string | null>(null);
  // mapa: numero_item da NF -> "sequencia|codigoProduto" do pedido (ou NAO_LANCAR)
  const [mapa, setMapa] = useState<Record<number, string>>({});
  const [lancando, setLancando] = useState(false);

  const nfeItens: NfeItemExtraido[] = useMemo(() => {
    if (!nfe?.dados_extraidos?.itens) return [];
    return nfe.dados_extraidos.itens as NfeItemExtraido[];
  }, [nfe]);

  // Carrega itens do pedido do Alvo ao abrir
  useEffect(() => {
    if (!open || !nfe?.pedido_compra_numero) return;
    let cancelado = false;

    (async () => {
      setLoadingPedido(true);
      setErroPedido(null);
      setPedidoItens([]);
      setMapa({});
      try {
        const auth = await authenticateAlvo();
        if (!auth.success || !auth.token) throw new Error("Falha na autenticação ERP");

        const url = `${ERP_BASE_URL}/PedComp/Load?codigoEmpresaFilial=1.01&numero=${encodeURIComponent(nfe.pedido_compra_numero!)}&loadChild=All`;
        const resp = await fetch(url, { method: "GET", headers: { "riosoft-token": auth.token } });
        if (resp.status === 409) clearAlvoToken();
        if (!resp.ok) throw new Error(`Erro ao carregar pedido (HTTP ${resp.status})`);

        const data = await resp.json();
        const itemList = (data?.ItemPedCompChildList || []) as any[];
        const itens: PedidoItem[] = itemList.map((it) => ({
          codigoProduto: it.CodigoProduto,
          nomeProduto: it.NomeProduto || it.DescricaoAlternativaProduto || it.CodigoProduto,
          quantidade: it.QuantidadeProdUnidMedPrincipal,
          valorTotal: it.ValorTotal,
          sequencia: it.Sequencia,
        }));

        if (cancelado) return;
        setPedidoItens(itens);

        // Sugestão leve: pré-mapeia por código de produto igual
        const sugestao: Record<number, string> = {};
        for (const ni of nfeItens) {
          const match = itens.find((pi) => pi.codigoProduto === ni.codigo_produto);
          if (match) sugestao[ni.numero_item] = `${match.sequencia}|${match.codigoProduto}`;
        }
        setMapa(sugestao);
      } catch (e: any) {
        if (!cancelado) setErroPedido(e?.message || "Erro ao carregar pedido");
      } finally {
        if (!cancelado) setLoadingPedido(false);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [open, nfe, nfeItens]);

  const itensMapeados = useMemo(
    () => nfeItens.filter((ni) => mapa[ni.numero_item] && mapa[ni.numero_item] !== NAO_LANCAR),
    [nfeItens, mapa],
  );
  const valorMapeado = useMemo(() => itensMapeados.reduce((s, ni) => s + (ni.valor_total || 0), 0), [itensMapeados]);

  const handleLancar = async () => {
    if (!nfe || itensMapeados.length === 0) return;
    setLancando(true);
    try {
      const codigoEntidade = nfe.pedido_compra_entidade;
      const classe = nfe.pedido_compra_classe;
      const cc = nfe.pedido_compra_centro_custo;
      if (!codigoEntidade) throw new Error("Pedido sem entidade vinculada");
      if (!classe) throw new Error("Pedido sem classe definida");

      // Condição de pagamento: extrai o código (antes do espaço/parêntese)
      const condPag = (nfe.pedido_compra_cond_pagamento || "").split(" ")[0];
      if (!condPag) throw new Error("Pedido sem condição de pagamento");

      // Monta itens do lançamento a partir do de-para
      const itensInput: NfeItemInput[] = itensMapeados.map((ni, idx) => {
        const [seqStr, codPed] = (mapa[ni.numero_item] || "").split("|");
        return {
          codigoProduto: ni.codigo_produto,
          sequencia: ni.numero_item || idx + 1,
          codigoProdutoPedComp: codPed || ni.codigo_produto,
          sequenciaItemPedComp: parseInt(seqStr, 10) || idx + 1,
          valorProduto: ni.valor_total,
          quantidade: ni.quantidade, // ⭐ quantidade real
          unidade: ni.unidade, // ⭐ unidade real
          codigoNCM: ni.ncm || undefined,
          classeRecDesp: classe,
          centroCusto: cc || "",
        };
      });

      // Parcelas pela condição de pagamento
      const { data: condPagData } = await supabase
        .from("condicoes_pagamento")
        .select("quantidade_parcelas, dias_entre_parcelas, primeiro_vencimento_apos")
        .eq("codigo", condPag)
        .maybeSingle();

      const qtdParcelas = condPagData?.quantidade_parcelas || 1;
      const diasEntre = condPagData?.dias_entre_parcelas || 30;
      const primeiroApos = condPagData?.primeiro_vencimento_apos || 30;
      // Valor lançado = soma dos itens mapeados (lançamento parcial)
      const valorLancado = valorMapeado;
      const valorParcela = Math.floor((valorLancado / qtdParcelas) * 100) / 100;

      const parcelas: NfeParcelaInput[] = [];
      const dtEmissao = new Date(nfe.data_emissao || new Date());
      for (let i = 0; i < qtdParcelas; i++) {
        const dtVenc = new Date(dtEmissao);
        dtVenc.setDate(dtVenc.getDate() + primeiroApos + diasEntre * i);
        const isLast = i === qtdParcelas - 1;
        const val = isLast ? valorLancado - valorParcela * (qtdParcelas - 1) : valorParcela;
        parcelas.push({
          sequencia: i + 1,
          numeroDuplicata: `${nfe.numero}/${i + 1}-${qtdParcelas}`,
          dataEmissao: nfe.data_emissao || new Date().toISOString(),
          valorParcela: Number(val.toFixed(2)),
          dataVencimento: dtVenc.toISOString().split("T")[0],
        });
      }

      const input: LancarNfeInput = {
        numero: nfe.numero || "",
        serie: nfe.serie || "1",
        dataEmissao: nfe.data_emissao || new Date().toISOString(),
        valorTotal: valorLancado,
        fornecedorCnpj: (nfe.emitente_cnpj || "").replace(/\D/g, ""),
        fornecedorNome: nfe.emitente_nome || "",
        codigoEntidade,
        pedidoNumero: nfe.pedido_compra_numero || "",
        codigoCondPag: condPag,
        chaveAcessoNfe: nfe.chave_acesso || "",
        itens: itensInput,
        parcelas,
        classeRecDesp: classe,
        centroCusto: cc || "",
        icmsBase: nfe.base_calculo_icms || 0,
        icmsPercentual:
          nfe.valor_icms && nfe.base_calculo_icms
            ? Math.round((nfe.valor_icms / nfe.base_calculo_icms) * 10000) / 100
            : 0,
        icmsValor: nfe.valor_icms || 0,
      };

      toast({ title: "Enviando NF-e para o Alvo ERP..." });
      const result = await lancarNfeNoAlvo(input);
      if (!result.success) {
        toast({ title: "❌ Erro no Alvo", description: result.error, variant: "destructive" });
        setLancando(false);
        return;
      }

      // Marca a nota como lançada
      const user = (await supabase.auth.getUser()).data.user;
      const { data: current } = await supabase.from("compras_nfe").select("*").eq("id", nfe.id).single();
      if (current) {
        await supabase.from("compras_nfe").upsert(
          {
            ...current,
            status_lancamento: "lancada",
            lancado_por: user?.id || null,
            lancado_em: new Date().toISOString(),
            erp_chave_movestq: result.chave,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" },
        );
      }

      toast({ title: `✅ NF-e lançada no Alvo! Chave: ${result.chave}` });
      onOpenChange(false);
      onLancado();
    } catch (err: any) {
      toast({ title: "❌ Erro", description: err.message, variant: "destructive" });
    } finally {
      setLancando(false);
    }
  };

  if (!nfe) return null;

  const parcial = itensMapeados.length < nfeItens.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Lançar NF-e no Alvo — De-Para de Itens</DialogTitle>
          <p className="text-xs text-muted-foreground">
            NF-e #{nfe.numero} — {nfe.emitente_nome} — {fmtBRL(nfe.valor_total)} · Pedido {nfe.pedido_compra_numero}
          </p>
        </DialogHeader>

        {loadingPedido ? (
          <div className="flex items-center justify-center py-8 gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs text-muted-foreground">Carregando itens do pedido no Alvo...</span>
          </div>
        ) : erroPedido ? (
          <div className="flex items-center gap-2 text-red-600 text-sm py-4">
            <AlertTriangle className="h-4 w-4" /> {erroPedido}
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Para cada item da NF, escolha o item correspondente no pedido. Itens deixados como "Não lançar" serão
              ignorados (lançamento parcial permitido).
            </p>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">#</TableHead>
                  <TableHead className="text-xs">Item da NF</TableHead>
                  <TableHead className="text-xs text-right">Qtd</TableHead>
                  <TableHead className="text-xs text-right">Valor</TableHead>
                  <TableHead className="text-xs w-8"></TableHead>
                  <TableHead className="text-xs">Item do Pedido (Alvo)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nfeItens.map((ni) => (
                  <TableRow key={ni.numero_item}>
                    <TableCell className="text-xs">{ni.numero_item}</TableCell>
                    <TableCell className="text-xs max-w-[220px]">
                      <div className="font-mono text-[10px] text-muted-foreground">{ni.codigo_produto}</div>
                      <div className="truncate">{ni.descricao}</div>
                    </TableCell>
                    <TableCell className="text-xs text-right">
                      {ni.quantidade} {ni.unidade}
                    </TableCell>
                    <TableCell className="text-xs text-right">{fmtBRL(ni.valor_total)}</TableCell>
                    <TableCell>
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={mapa[ni.numero_item] || NAO_LANCAR}
                        onValueChange={(v) => setMapa((prev) => ({ ...prev, [ni.numero_item]: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NAO_LANCAR} className="text-xs text-muted-foreground">
                            — Não lançar este item —
                          </SelectItem>
                          {pedidoItens.map((pi) => (
                            <SelectItem
                              key={`${pi.sequencia}|${pi.codigoProduto}`}
                              value={`${pi.sequencia}|${pi.codigoProduto}`}
                              className="text-xs"
                            >
                              [{pi.sequencia}] {pi.codigoProduto} — {pi.nomeProduto} ({fmtBRL(pi.valorTotal)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between rounded border bg-muted/30 p-3 text-xs">
              <div>
                <span className="text-muted-foreground">Itens a lançar: </span>
                <strong>{itensMapeados.length}</strong> de {nfeItens.length}
                {parcial && (
                  <Badge variant="outline" className="ml-2 text-[10px] border-amber-500/50 text-amber-600">
                    Lançamento parcial
                  </Badge>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Valor a lançar: </span>
                <strong>{fmtBRL(valorMapeado)}</strong>
                <span className="text-muted-foreground"> / {fmtBRL(nfe.valor_total)}</span>
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleLancar}
            disabled={loadingPedido || !!erroPedido || itensMapeados.length === 0 || lancando}
            className="gap-2 bg-green-600 hover:bg-green-700"
          >
            {lancando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Lançar{" "}
            {itensMapeados.length > 0 ? `(${itensMapeados.length} item${itensMapeados.length > 1 ? "s" : ""})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
