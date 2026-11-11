import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Ban, ChevronDown, ChevronRight, Download, Globe2, Hash, Loader2, Package, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PeriodoPicker, atalhosPeriodo, type Periodo } from "@/components/PeriodoPicker";
import { formatCurrency, formatDate, formatDoc, formatInstanteBrt } from "@/components/nfse/nfseFormatos";
import {
  buscarDetalheNotaSaida,
  exportarNotasSaidaXLSX,
  listarItensNotasSaida,
  listarNotasSaida,
  type DetalheNotaSaida,
  type FiltrosNotasSaida,
  type NotaSaida,
  type ResultadoNotasSaida,
} from "@/services/vendasNotasService";

const SEM_CLASSE = "(sem classe)";
const SEM_REGIAO = "(sem região)";
const TIPOS = ["venda", "remessa", "devolução de compra", "outros", SEM_CLASSE];

const fmtQtd = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 4 });

/** Detalhe de uma nota (itens, lotes, séries, parcelas), carregado ao abrir a linha. */
function DetalheNota({ id }: { id: string }) {
  const [det, setDet] = useState<DetalheNotaSaida | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    buscarDetalheNotaSaida(id)
      .then((d) => vivo && setDet(d))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : String(e)));
    return () => {
      vivo = false;
    };
  }, [id]);

  if (erro) return <p className="p-3 text-xs text-destructive">Não foi possível abrir a nota: {erro}</p>;
  if (!det)
    return (
      <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando a nota…
      </div>
    );

  const seriesPorItem = new Map<number, number>();
  det.series.forEach((s) => seriesPorItem.set(s.sequencia_item, (seriesPorItem.get(s.sequencia_item) ?? 0) + 1));
  const lotesPorItem = new Map<number, string[]>();
  det.lotes.forEach((l) => {
    const v = [l.numero_lote, l.data_validade ? `val. ${formatDate(l.data_validade)}` : null, l.quantidade != null ? `${fmtQtd(l.quantidade)} un` : null]
      .filter(Boolean)
      .join(" · ");
    lotesPorItem.set(l.sequencia_item, [...(lotesPorItem.get(l.sequencia_item) ?? []), v]);
  });

  return (
    <div className="space-y-3 bg-muted/30 p-3">
      <div className="grid grid-cols-[minmax(0,1fr)] overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">#</TableHead>
              <TableHead className="text-[11px]">Produto</TableHead>
              <TableHead className="text-[11px]">Natureza / CFOP</TableHead>
              <TableHead className="text-right text-[11px]">Qtde</TableHead>
              <TableHead className="text-right text-[11px]">Unitário</TableHead>
              <TableHead className="text-right text-[11px]">Total</TableHead>
              <TableHead className="text-right text-[11px]">ICMS</TableHead>
              <TableHead className="text-right text-[11px]">ISS</TableHead>
              <TableHead className="text-[11px]">Lotes / séries</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {det.itens.map((i) => (
              <TableRow key={i.sequencia}>
                <TableCell className="text-xs">{i.sequencia}</TableCell>
                <TableCell className="text-xs">
                  <div className="font-medium">{i.nome_produto || "—"}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {i.codigo_produto}
                    {i.codigo_alternativo ? ` · ${i.codigo_alternativo}` : ""}
                    {i.unidade ? ` · ${i.unidade}` : ""}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {i.natureza_operacao || "—"}
                  {i.cfop ? <span className="text-muted-foreground"> · {i.cfop}</span> : null}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">{fmtQtd(i.quantidade)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{formatCurrency(i.valor_unitario)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{formatCurrency(i.valor_total)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{formatCurrency(i.valor_icms)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{formatCurrency(i.valor_iss)}</TableCell>
                <TableCell className="text-[11px] text-muted-foreground">
                  {(lotesPorItem.get(i.sequencia) ?? []).map((l, k) => (
                    <div key={k}>{l}</div>
                  ))}
                  {seriesPorItem.get(i.sequencia) ? <div>{seriesPorItem.get(i.sequencia)} nº de série</div> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {det.parcelas.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Parcelas: </span>
          {det.parcelas
            .map((p) => `${formatDate(p.data_vencimento)} ${formatCurrency(p.valor)}${p.nome_cond_pag ? ` (${p.nome_cond_pag})` : ""}`)
            .join(" · ")}
        </div>
      )}
      {det.classes.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Classes no Alvo: </span>
          {det.classes.map((c) => `${c.codigo_classe} ${formatCurrency(c.valor)}`).join(" · ")}
        </div>
      )}
    </div>
  );
}

const VendasNotasSaida = () => {
  const { toast } = useToast();
  const [periodo, setPeriodo] = useState<Periodo>(() => atalhosPeriodo(false)[0].periodo);
  const [dados, setDados] = useState<ResultadoNotasSaida | null>(null);
  const [loading, setLoading] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtroModelo, setFiltroModelo] = useState<"todos" | "NF-e" | "NFS-e">("todos");
  const [filtroTipo, setFiltroTipo] = useState<string>("todos");
  const [filtroRegiao, setFiltroRegiao] = useState<string>("todas");
  // Livro: o que o Alvo diz da nota (cancelada ou não).
  const [filtroCancelada, setFiltroCancelada] = useState<"todas" | "validas" | "canceladas">("todas");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [baixando, setBaixando] = useState(false);

  const fetchRows = useCallback(async () => {
    if (!periodo.de || !periodo.ate) return;
    setLoading(true);
    setExpandedId(null);
    try {
      setDados(await listarNotasSaida({ de: periodo.de, ate: periodo.ate }));
    } catch (e) {
      setDados(null);
      toast({ title: "Erro ao carregar as notas de saída", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [periodo.de, periodo.ate, toast]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const regioes = useMemo(
    () => Array.from(new Set((dados?.linhas ?? []).map((n) => n.regiao ?? SEM_REGIAO))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [dados],
  );

  const filtrosDaTela = (): FiltrosNotasSaida => ({
    de: periodo.de!,
    ate: periodo.ate!,
    busca,
    modelos: filtroModelo === "todos" ? null : [filtroModelo],
    tipos: filtroTipo === "todos" ? null : [filtroTipo],
    regioes: filtroRegiao === "todas" ? null : [filtroRegiao],
    incluirCanceladas: filtroCancelada !== "validas",
  });

  const filtered = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = busca.replace(/\D/g, "");
    return (dados?.linhas ?? []).filter((n) => {
      if (filtroModelo !== "todos" && n.modelo !== filtroModelo) return false;
      if (filtroTipo !== "todos" && (n.tipo_operacao ?? SEM_CLASSE) !== filtroTipo) return false;
      if (filtroRegiao !== "todas" && (n.regiao ?? SEM_REGIAO) !== filtroRegiao) return false;
      if (filtroCancelada === "validas" && n.cancelada) return false;
      if (filtroCancelada === "canceladas" && !n.cancelada) return false;
      if (!termo) return true;
      return (
        (n.razao_social ?? "").toLowerCase().includes(termo) ||
        (n.nome_fantasia ?? "").toLowerCase().includes(termo) ||
        (digitos !== "" &&
          (String(n.numero) === digitos.replace(/^0+/, "") ||
            (n.cpf_cnpj ?? "").includes(digitos) ||
            (n.numero_pedvenda ?? "").includes(digitos)))
      );
    });
  }, [dados, busca, filtroModelo, filtroTipo, filtroRegiao, filtroCancelada]);

  // Totais da tela: notas canceladas no Alvo ficam fora do valor.
  const resumo = useMemo(() => {
    const validas = filtered.filter((n) => !n.cancelada);
    const porRegiao = new Map<string, number>();
    validas.forEach((n) => porRegiao.set(n.regiao ?? SEM_REGIAO, (porRegiao.get(n.regiao ?? SEM_REGIAO) ?? 0) + (n.valor_total || 0)));
    return {
      notas: filtered.length,
      canceladas: filtered.length - validas.length,
      valor: validas.reduce((s, n) => s + (n.valor_total || 0), 0),
      regioes: Array.from(porRegiao.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [filtered]);

  const baixarExcel = async () => {
    if (!periodo.de || !periodo.ate) return;
    setBaixando(true);
    try {
      const itens = await listarItensNotasSaida(filtrosDaTela());
      const ids = new Set(filtered.map((n) => `${n.modelo}|${n.serie}|${n.numero}`));
      const r = exportarNotasSaidaXLSX(
        filtered,
        itens.filter((i) => ids.has(`${i.modelo}|${i.serie}|${i.numero}`)),
        filtrosDaTela(),
      );
      toast({ title: "Excel baixado", description: `${r.notas} nota(s), ${r.itens} item(ns) · ${r.arquivo}` });
    } catch (e) {
      toast({ title: "Não foi possível gerar o Excel", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBaixando(false);
    }
  };

  // Espelho: situação da nota no Hub (não confundir com cancelamento, que é do Alvo).
  const situacaoBadges = (n: NotaSaida) => (
    <div className="flex flex-wrap gap-1">
      {n.cancelada ? (
        <Badge variant="destructive" className="text-[10px]" title={n.data_cancelamento ? `Cancelada em ${formatDate(n.data_cancelamento)}` : undefined}>
          Cancelada
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[10px]">
          Válida
        </Badge>
      )}
      {n.situacao_hub === "provisoria" && (
        <Badge variant="outline" className="border-warning text-[10px] text-warning" title="NFS-e sem retorno da prefeitura: o número ainda pode mudar">
          Provisória
        </Badge>
      )}
      {n.ausente_desde && (
        <Badge variant="outline" className="border-warning text-[10px] text-warning" title={`Não aparece mais na lista do Alvo desde ${formatInstanteBrt(n.ausente_desde)}`}>
          Sumiu do Alvo
        </Badge>
      )}
    </div>
  );

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Notas de Saída</h1>
        <p className="text-muted-foreground">
          Notas fiscais emitidas pela P&amp;F no Alvo (NF-e e NFS-e), com itens, lotes, séries e parcelas. Só leitura.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodoPicker valor={periodo} onChange={setPeriodo} permitirTudo={false} />
          <span className="text-[11px] text-muted-foreground">pela data de emissão</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="text-[11px] text-muted-foreground" title="Última leitura da lista de notas no Alvo (horário de Brasília)">
            Lidas do Alvo até {formatInstanteBrt(dados?.ultima_leitura_alvo)}
          </span>
          {dados && !dados.agendamento_ligado && (
            <Badge variant="outline" className="border-warning text-[10px] text-warning">
              Atualização automática desligada
            </Badge>
          )}
          {dados && dados.pendentes_detalhe > 0 && (
            <Badge variant="outline" className="text-[10px]" title="Notas já listadas cujo detalhe (itens) ainda não foi lido">
              {dados.pendentes_detalhe} aguardando detalhe
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={baixarExcel} disabled={baixando || loading || filtered.length === 0} className="gap-1">
            {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Baixar Excel
          </Button>
          <Button variant="outline" size="sm" onClick={fetchRows} disabled={loading} className="gap-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Atualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Notas no período", value: dados ? resumo.notas : "—", icon: Hash },
          { label: "Canceladas no Alvo", value: dados ? resumo.canceladas : "—", icon: Ban },
          { label: "Valor (sem as canceladas)", value: dados ? formatCurrency(resumo.valor) : "—", icon: Package },
          {
            label: "Por região",
            value: dados && resumo.regioes.length ? resumo.regioes.slice(0, 3).map(([r, v]) => `${r} ${formatCurrency(v)}`).join(" · ") : "—",
            icon: Globe2,
          },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="flex items-center gap-2 p-3">
              <c.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="truncate text-sm font-semibold tabular-nums" title={typeof c.value === "string" ? c.value : undefined}>
                  {c.value}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col flex-wrap gap-2 sm:flex-row">
        <Input
          placeholder="Buscar por cliente, CNPJ, número ou pedido..."
          className="h-8 text-xs sm:max-w-xs"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <Select value={filtroModelo} onValueChange={(v) => setFiltroModelo(v as typeof filtroModelo)}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">NF-e e NFS-e</SelectItem>
            <SelectItem value="NF-e">Só NF-e (produto)</SelectItem>
            <SelectItem value="NFS-e">Só NFS-e (serviço)</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroTipo} onValueChange={setFiltroTipo}>
          <SelectTrigger className="h-8 w-52 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Operação: todas</SelectItem>
            {TIPOS.map((t) => (
              <SelectItem key={t} value={t}>
                Operação: {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroRegiao} onValueChange={setFiltroRegiao}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Região: todas</SelectItem>
            {regioes.map((r) => (
              <SelectItem key={r} value={r}>
                Região: {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroCancelada} onValueChange={(v) => setFiltroCancelada(v as typeof filtroCancelada)}>
          <SelectTrigger className="h-8 w-52 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">No Alvo: válidas e canceladas</SelectItem>
            <SelectItem value="validas">No Alvo: só válidas</SelectItem>
            <SelectItem value="canceladas">No Alvo: só canceladas</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="-mt-4 text-[11px] text-muted-foreground">
        Operação é a classe da nota no Alvo (venda, remessa…). A lista é atualizada às 08h20, 13h20 e 18h20 nos dias úteis; nota emitida
        depois disso aparece na leitura seguinte. Clique na linha para ver os itens.
      </p>

      <Card>
        <CardContent className="grid grid-cols-[minmax(0,1fr)] p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <AlertTriangle className="h-5 w-5" /> Nenhuma nota neste período e filtro.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6" />
                    <TableHead className="text-xs">Emissão</TableHead>
                    <TableHead className="text-xs">Nota</TableHead>
                    <TableHead className="text-xs">Cliente</TableHead>
                    <TableHead className="text-xs">Região</TableHead>
                    <TableHead className="text-xs">Operação</TableHead>
                    <TableHead className="text-xs">Natureza</TableHead>
                    <TableHead className="text-xs">Pedido</TableHead>
                    <TableHead className="text-right text-xs">Valor</TableHead>
                    <TableHead className="text-xs">Situação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((n) => {
                    const aberto = expandedId === n.id;
                    return (
                      <Fragment key={n.id}>
                        <TableRow className="cursor-pointer" onClick={() => setExpandedId(aberto ? null : n.id)}>
                          <TableCell className="py-2">
                            {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          </TableCell>
                          <TableCell className="whitespace-nowrap py-2 text-xs">{formatDate(n.data_emissao)}</TableCell>
                          <TableCell className="whitespace-nowrap py-2 text-xs">
                            <span className="text-muted-foreground">{n.modelo}</span> {n.numero}
                            {n.numero_nfse_prefeitura ? <div className="text-[10px] text-muted-foreground">prefeitura {n.numero_nfse_prefeitura}</div> : null}
                          </TableCell>
                          <TableCell className="py-2 text-xs">
                            <div className="font-medium">{n.razao_social || n.nome_fantasia || "—"}</div>
                            <div className="text-[10px] text-muted-foreground">
                              {formatDoc(n.cpf_cnpj)}
                              {n.nome_pais ? ` · ${n.nome_pais}` : ""}
                              {n.uf ? `/${n.uf}` : ""}
                            </div>
                          </TableCell>
                          <TableCell className="py-2 text-xs">{n.regiao ?? SEM_REGIAO}</TableCell>
                          <TableCell className="py-2 text-xs">{n.tipo_operacao ?? SEM_CLASSE}</TableCell>
                          <TableCell className="py-2 text-xs">{n.natureza_principal || "—"}</TableCell>
                          <TableCell className="py-2 text-xs">{n.numero_pedvenda || "—"}</TableCell>
                          <TableCell className={`py-2 text-right text-xs tabular-nums ${n.cancelada ? "text-muted-foreground line-through" : ""}`}>
                            {formatCurrency(n.valor_total)}
                            {n.moeda_codigo && n.moeda_codigo !== "0000001" && n.valor_original ? (
                              <div className="text-[10px] text-muted-foreground no-underline">
                                moeda {Number(n.valor_original).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="py-2">{situacaoBadges(n)}</TableCell>
                        </TableRow>
                        {aberto && (
                          <TableRow>
                            <TableCell colSpan={10} className="p-0">
                              <DetalheNota id={n.id} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={8} className="text-xs">
                      {resumo.notas} nota(s) · total sem as canceladas
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold tabular-nums">{formatCurrency(resumo.valor)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default VendasNotasSaida;
