/**
 * Realizado de Despesas — visão UNIFICADA (MovEstq + DocFin).
 *
 * Lista o realizado de despesa das duas fontes numa só tela:
 *  - MovEstq: realizado de NF de entrada (desp_realizado_*)
 *  - DocFin: despesa nativa (folha, impostos, cartão, RDESP) (desp_docfin_*)
 *
 * Uma linha por documento; valor = soma dos rateios de despesa.
 * Accordion expande os rateios (centro de custo + nome, classe, classificação).
 *
 * Espelha o padrão visual de IntercompanyMaster (tabela expansível, filtros,
 * resumo, paginação, export Excel). Gate: APENAS administrador.
 *
 * RPCs: listar_despesa_realizada_unificada · get_despesa_realizada_rateios
 */

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions } from "@/hooks/usePermissions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertCircle,
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
  Coins,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldX,
  X,
} from "lucide-react";
import { format } from "date-fns";

const PAGE_SIZE = 20;

// ─── Tipos ─────────────────────────────────────────────────────────

interface DespesaItem {
  fonte: "MovEstq" | "DocFin";
  chave: string;
  filial: string;
  especie: string | null;
  numero: string | null;
  data_competencia: string | null;
  ano: number;
  mes: number;
  codigo_entidade: string | null;
  nome_entidade: string | null;
  cpf_cnpj_entidade: string | null;
  valor_despesa: number;
  qtd_rateios: number;
  qtd_ccs: number;
}

interface ListResponse {
  items: DespesaItem[];
  pagination: { total: number; page: number; page_size: number; total_pages: number };
  resumo: { total_docs: number; soma_brl: number };
}

interface RateioDetalhe {
  ordem_classe: number;
  codigo_classe: string | null;
  ordem_rateio: number;
  codigo_centro_ctrl: string | null;
  nome_centro_ctrl: string | null;
  valor_brl: number;
  percentual: number | null;
  classificacao: string | null;
  categoria: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────

const formatBRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatCompetencia = (ano: number, mes: number) => `${String(mes).padStart(2, "0")}/${ano}`;

const fonteCls: Record<string, string> = {
  MovEstq: "bg-blue-500/15 text-blue-700 border-blue-300",
  DocFin: "bg-violet-500/15 text-violet-700 border-violet-300",
};

const MESES = [
  { v: 1, l: "Janeiro" },
  { v: 2, l: "Fevereiro" },
  { v: 3, l: "Março" },
  { v: 4, l: "Abril" },
  { v: 5, l: "Maio" },
  { v: 6, l: "Junho" },
  { v: 7, l: "Julho" },
  { v: 8, l: "Agosto" },
  { v: 9, l: "Setembro" },
  { v: 10, l: "Outubro" },
  { v: 11, l: "Novembro" },
  { v: 12, l: "Dezembro" },
];

const hoje = new Date();
const ANO_ATUAL = hoje.getFullYear();
const MES_ATUAL = hoje.getMonth() + 1;
const ANOS = Array.from({ length: ANO_ATUAL - 2024 + 1 }, (_, i) => 2024 + i).reverse();

// ─── Componente principal ──────────────────────────────────────────

export default function RealizadoDespesas() {
  const { isAdmin, loading: permLoading } = usePermissions();

  // Filtros — default mês corrente
  const [ano, setAno] = useState<number>(ANO_ATUAL);
  const [mes, setMes] = useState<number>(MES_ATUAL);
  const [fonte, setFonte] = useState<string>("");
  const [especie, setEspecie] = useState<string>("");
  const [busca, setBusca] = useState<string>("");
  const [buscaDebounced, setBuscaDebounced] = useState<string>("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 400);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    setPage(1);
  }, [ano, mes, fonte, especie, buscaDebounced]);

  const rpcArgs = useMemo(
    () => ({
      p_ano: ano,
      p_mes: mes,
      p_fonte: fonte || null,
      p_especie: especie || null,
      p_busca: buscaDebounced || null,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    [ano, mes, fonte, especie, buscaDebounced, page],
  );

  const filtrosAtivos = useMemo(() => {
    let n = 0;
    if (fonte) n++;
    if (especie) n++;
    if (buscaDebounced) n++;
    return n;
  }, [fonte, especie, buscaDebounced]);

  const listQuery = useQuery({
    queryKey: ["realizado_despesas_list", rpcArgs],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("listar_despesa_realizada_unificada" as never, rpcArgs as never);
      if (error) throw error;
      return data as unknown as ListResponse;
    },
    enabled: isAdmin,
  });

  const limparFiltros = () => {
    setFonte("");
    setEspecie("");
    setBusca("");
  };

  const handleExportar = async () => {
    setExportando(true);
    try {
      // Busca tudo (sem paginação) para o mês/filtros atuais
      const { data, error } = await supabase.rpc(
        "listar_despesa_realizada_unificada" as never,
        {
          ...rpcArgs,
          p_limit: 100,
          p_offset: 0,
        } as never,
      );
      if (error) throw error;
      const resp = data as unknown as ListResponse;

      // Se houver mais de 100, pagina para juntar tudo
      const todos: DespesaItem[] = [...resp.items];
      const totalPages = resp.pagination.total_pages;
      for (let p = 2; p <= totalPages; p++) {
        const { data: d2, error: e2 } = await supabase.rpc(
          "listar_despesa_realizada_unificada" as never,
          {
            ...rpcArgs,
            p_limit: 100,
            p_offset: (p - 1) * 100,
          } as never,
        );
        if (e2) throw e2;
        todos.push(...((d2 as unknown as ListResponse).items || []));
      }

      const lista = todos.map((i) => ({
        Competência: formatCompetencia(i.ano, i.mes),
        Fonte: i.fonte,
        Espécie: i.especie ?? "",
        Número: i.numero ?? "",
        "Código Entidade": i.codigo_entidade ?? "",
        Entidade: i.nome_entidade ?? "",
        "CPF/CNPJ": i.cpf_cnpj_entidade ?? "",
        "Valor (BRL)": i.valor_despesa,
        Rateios: i.qtd_rateios,
        "Centros de Custo": i.qtd_ccs,
      }));

      const resumo = [
        { Métrica: "Total de documentos", Valor: resp.resumo.total_docs },
        { Métrica: "Soma (BRL)", Valor: resp.resumo.soma_brl },
        { Métrica: "Competência", Valor: formatCompetencia(ano, mes) },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lista), "Despesas");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), "Resumo");
      const dataStr = format(new Date(), "yyyy-MM-dd_HH-mm");
      XLSX.writeFile(wb, `realizado_despesas_${ano}-${String(mes).padStart(2, "0")}_${dataStr}.xlsx`);
    } catch (err) {
      console.error("Erro ao exportar:", err);
      alert(`Erro ao exportar: ${(err as Error).message}`);
    } finally {
      setExportando(false);
    }
  };

  // Gate de admin
  if (permLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-muted-foreground">
        <ShieldX className="h-16 w-16" />
        <h2 className="text-xl font-semibold text-foreground">Acesso Restrito</h2>
        <p>Esta página é restrita a administradores.</p>
      </div>
    );
  }

  const data = listQuery.data;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
            <Coins className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Realizado de Despesas</h1>
            <p className="text-sm text-muted-foreground">
              Visão unificada do realizado — MovEstq (NF de entrada) + DocFin (despesa nativa).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportar} disabled={exportando || listQuery.isLoading}>
            {exportando ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Exportando...
              </>
            ) : (
              <>
                <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
                Exportar Excel
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Barra de Filtros */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Filtros</span>
              {filtrosAtivos > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {filtrosAtivos} ativo{filtrosAtivos > 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            {filtrosAtivos > 0 && (
              <Button variant="ghost" size="sm" onClick={limparFiltros} className="h-7 text-xs">
                <X className="mr-1 h-3 w-3" />
                Limpar
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Ano */}
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Ano</Label>
              <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANOS.map((a) => (
                    <SelectItem key={a} value={String(a)}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Mês */}
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Mês</Label>
              <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MESES.map((m) => (
                    <SelectItem key={m.v} value={String(m.v)}>
                      {m.l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Fonte */}
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Fonte</Label>
              <Select value={fonte || "_all"} onValueChange={(v) => setFonte(v === "_all" ? "" : v)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas</SelectItem>
                  <SelectItem value="MovEstq">MovEstq (NF entrada)</SelectItem>
                  <SelectItem value="DocFin">DocFin (nativa)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Espécie */}
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Espécie</Label>
              <Input
                value={especie}
                onChange={(e) => setEspecie(e.target.value.toUpperCase())}
                placeholder="FOL, CAR, NF..."
                className="h-9 text-xs"
              />
            </div>

            {/* Busca */}
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Entidade ou número..."
                  className="pl-7 h-9 text-xs"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resumo */}
      {data?.resumo && (
        <Card className="border-muted">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
            <div>
              <span className="text-xs text-muted-foreground">Competência: </span>
              <span className="font-semibold">{formatCompetencia(ano, mes)}</span>
            </div>
            <div className="h-4 w-px bg-border" />
            <div>
              <span className="text-xs text-muted-foreground">Documentos: </span>
              <span className="font-semibold">{data.resumo.total_docs}</span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Total: </span>
              <span className="font-mono font-semibold">{formatBRL(data.resumo.soma_brl)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {listQuery.isLoading && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {/* Error */}
      {listQuery.error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-destructive">Erro ao carregar despesas</p>
              <p className="text-xs text-muted-foreground mt-1 break-words">
                {(listQuery.error as Error)?.message ?? "Erro desconhecido"}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => listQuery.refetch()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!listQuery.isLoading && !listQuery.error && data?.items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mb-2 opacity-40" />
            <p className="text-sm">Nenhuma despesa encontrada para {formatCompetencia(ano, mes)}.</p>
            {filtrosAtivos > 0 && (
              <Button variant="link" size="sm" onClick={limparFiltros} className="mt-2">
                Limpar filtros
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabela */}
      {!listQuery.isLoading && !listQuery.error && data?.items && data.items.length > 0 && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-3 font-medium w-8" />
                  <th className="px-3 py-3 font-medium">Competência</th>
                  <th className="px-3 py-3 font-medium">Fonte</th>
                  <th className="px-3 py-3 font-medium">Espécie</th>
                  <th className="px-3 py-3 font-medium">Número</th>
                  <th className="px-3 py-3 font-medium">Entidade</th>
                  <th className="px-3 py-3 font-medium text-right">Valor (BRL)</th>
                  <th className="px-3 py-3 font-medium text-center">CCs</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => {
                  const rowId = `${item.fonte}-${item.chave}`;
                  return (
                    <DespesaRow
                      key={rowId}
                      item={item}
                      expanded={expandedId === rowId}
                      onToggle={() => setExpandedId((prev) => (prev === rowId ? null : rowId))}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2.5 text-xs">
            <span className="text-muted-foreground">
              Mostrando {data.items.length} de {data.pagination.total} · Página {data.pagination.page} de{" "}
              {data.pagination.total_pages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || listQuery.isFetching}
                className="h-7 text-xs"
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= data.pagination.total_pages || listQuery.isFetching}
                className="h-7 text-xs"
              >
                Próximo
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Linha + accordion ──────────────────────────────────────────────

interface DespesaRowProps {
  item: DespesaItem;
  expanded: boolean;
  onToggle: () => void;
}

function DespesaRow({ item, expanded, onToggle }: DespesaRowProps) {
  return (
    <>
      <tr className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-2.5">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </td>
        <td className="px-3 py-2.5 whitespace-nowrap">{formatCompetencia(item.ano, item.mes)}</td>
        <td className="px-3 py-2.5">
          <Badge variant="outline" className={`text-[10px] border ${fonteCls[item.fonte] ?? ""}`}>
            {item.fonte}
          </Badge>
        </td>
        <td className="px-3 py-2.5">
          {item.especie ? (
            <span className="font-mono text-xs">{item.especie}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-2.5 font-mono text-xs">{item.numero ?? "—"}</td>
        <td className="px-3 py-2.5">
          <span className="text-xs">{item.nome_entidade ?? <span className="text-muted-foreground">—</span>}</span>
        </td>
        <td className="px-3 py-2.5 text-right font-mono">{formatBRL(item.valor_despesa)}</td>
        <td className="px-3 py-2.5 text-center">
          {item.qtd_ccs > 0 ? (
            <Badge variant="secondary" className="text-[10px]">
              {item.qtd_ccs}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      </tr>
      {expanded && <DespesaRowDetails item={item} />}
    </>
  );
}

function DespesaRowDetails({ item }: { item: DespesaItem }) {
  const rateiosQuery = useQuery({
    queryKey: ["realizado_despesas_rateios", item.fonte, item.chave],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_despesa_realizada_rateios" as never,
        {
          p_fonte: item.fonte,
          p_chave: item.chave,
        } as never,
      );
      if (error) throw error;
      return (data || []) as unknown as RateioDetalhe[];
    },
  });

  return (
    <tr className="bg-muted/10">
      <td colSpan={8} className="px-6 py-4">
        <div className="space-y-3">
          {/* Cabeçalho do documento */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-xs">
            <DetailField label="Entidade (código)" value={item.codigo_entidade ?? "—"} mono />
            <DetailField label="CPF/CNPJ" value={item.cpf_cnpj_entidade ?? "—"} mono />
            <DetailField label="Chave (Alvo)" value={item.chave} mono />
            <DetailField label="Rateios" value={String(item.qtd_rateios)} />
          </div>

          {/* Rateios / Centros de Custo */}
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
              Centros de Custo ({item.qtd_ccs})
            </p>
            {rateiosQuery.isLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Carregando rateios...
              </div>
            )}
            {rateiosQuery.error && (
              <p className="text-xs text-destructive">
                Erro ao carregar rateios: {(rateiosQuery.error as Error).message}
              </p>
            )}
            {rateiosQuery.data && rateiosQuery.data.length > 0 && (
              <div className="rounded-md border border-border bg-background overflow-hidden">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/20 text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Centro de Custo</th>
                      <th className="px-3 py-2 font-medium">Classe</th>
                      <th className="px-3 py-2 font-medium">Classificação</th>
                      <th className="px-3 py-2 font-medium text-right">%</th>
                      <th className="px-3 py-2 font-medium text-right">Valor (BRL)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rateiosQuery.data.map((r, idx) => (
                      <tr
                        key={`${r.ordem_classe}-${r.ordem_rateio}-${idx}`}
                        className="border-b border-border/30 last:border-0"
                      >
                        <td className="px-3 py-1.5">
                          <div className="flex flex-col">
                            <span>{r.nome_centro_ctrl ?? "—"}</span>
                            <span className="font-mono text-muted-foreground">{r.codigo_centro_ctrl ?? "—"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 font-mono">{r.codigo_classe ?? "—"}</td>
                        <td className="px-3 py-1.5">{r.classificacao ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {r.percentual == null ? "—" : `${Number(r.percentual).toFixed(2)}%`}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">{formatBRL(r.valor_brl)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rateiosQuery.data && rateiosQuery.data.length === 0 && (
              <p className="text-xs text-muted-foreground">Sem rateios registrados.</p>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-muted-foreground uppercase tracking-wide block">{label}</span>
      <span className={mono ? "text-foreground font-mono" : "text-foreground"}>{value}</span>
    </div>
  );
}
