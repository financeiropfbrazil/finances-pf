import { Fragment, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataSection, Field } from "@/components/DataSection";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Loader2, ArrowLeft, AlertTriangle, Boxes, RefreshCw, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { getStatusRM } from "@/lib/statusRM";
import { obterRM, type RMItem } from "@/services/reqMatService";
import {
  conferirRMNoAlvo,
  isReqMatInexistenteNoAlvo,
  type ResultadoConferencia,
} from "@/services/alvoReqMatLoadService";

const numeroFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

function formatData(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    // `date` puro (validade de lote) chega como "YYYY-MM-DD"; parse com
    // componentes locais evita o escorregão de um dia em Brasília.
    const d = String(iso).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) {
      const [a, m, dia] = d.split("-").map(Number);
      if (a && m && dia) return format(new Date(a, m - 1, dia), "dd/MM/yyyy", { locale: ptBR });
    }
    return format(new Date(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return "—";
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: ptBR });
  } catch {
    return "—";
  }
}

export default function ProducaoRMDetalhe() {
  const { numero } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["rm_detalhe", numero],
    queryFn: () => obterRM(numero!),
    enabled: !!numero,
  });

  // ── Conferência sob demanda (só leitura) ──────────────────────────────────
  // Não é sincronização: o resultado vive em memória e NÃO vai para o espelho.
  // `conferencia` = última leitura bem-sucedida; `avisoConferencia` = o que
  // impediu a leitura (412, exceção do ERP, guarda anti-wipe, rede).
  const [conferindo, setConferindo] = useState(false);
  const [conferencia, setConferencia] = useState<ResultadoConferencia | null>(null);
  const [avisoConferencia, setAvisoConferencia] = useState<{ titulo: string; texto: string } | null>(null);

  const conferir = async () => {
    if (!data || !numero) return;
    setConferindo(true);
    setAvisoConferencia(null);
    try {
      const r = await conferirRMNoAlvo(numero, {
        status: data.cabecalho.status,
        tipo_atendimento: data.cabecalho.tipo_atendimento,
        baixou_estoque: data.cabecalho.baixou_estoque,
        itens: data.itens.map((i) => ({
          sequencia: i.sequencia,
          quantidade: i.quantidade,
          quantidade_atendida: i.quantidade_atendida,
          quantidade_saldo: i.quantidade_saldo,
        })),
      });
      setConferencia(r);
      if (r.diferencas.length === 0) {
        // Sucesso silencioso: nada mudou é a resposta mais comum, e um toast a
        // cada clique vira ruído. O carimbo "conferida às HH:MM" já informa.
        toast.success("Conferido — nada mudou no ERP.");
      } else {
        toast.warning(`${r.diferencas.length} diferença(s) entre o Hub e o ERP.`, {
          description: "Veja o painel no topo da página.",
        });
      }
    } catch (e: unknown) {
      // Falha NUNCA é fatal: a tela continua mostrando o espelho.
      setConferencia(null);
      if (isReqMatInexistenteNoAlvo(e)) {
        setAvisoConferencia({
          titulo: "Não encontrada no ERP",
          texto:
            "Esta requisição pode ter sido excluída no Alvo. O que está abaixo é o último estado conhecido — " +
            "a sincronização confirma. O Hub não marca exclusão a partir de uma consulta isolada.",
        });
      } else {
        setAvisoConferencia({
          titulo: "Não foi possível conferir agora",
          texto: `${e instanceof Error ? e.message : "Erro desconhecido"}. Os dados abaixo seguem sendo o último estado sincronizado.`,
        });
      }
    } finally {
      setConferindo(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p>{error instanceof Error ? error.message : "Requisição não encontrada ou sem acesso."}</p>
        <Button variant="outline" onClick={() => navigate("/producao/rm")}>
          <ArrowLeft className="h-4 w-4" /> Voltar à lista
        </Button>
      </div>
    );
  }

  const c = data.cabecalho;
  // Linha inteira, não só o status: `ausente_desde` precede o literal do Alvo
  // (o badge do cabeçalho acompanha a faixa vermelha logo abaixo).
  const sv = getStatusRM(c);

  // Totais do cabeçalho somados a partir dos ITENS. `quantidade_saldo` entra
  // como o Alvo entregou — NUNCA `pedido − atendido`: quando o almoxarifado
  // atende a mais, o excedente vai para `quantidade_atendida_maior` e o saldo
  // não fica negativo (§10.4, prova na RM 0000002251).
  const totalPedido = data.itens.reduce((s, i) => s + i.quantidade, 0);
  const totalAtendido = data.itens.reduce((s, i) => s + i.quantidade_atendida, 0);
  const totalSaldo = data.itens.reduce((s, i) => s + i.quantidade_saldo, 0);
  const totalExcedente = data.itens.reduce((s, i) => s + i.quantidade_atendida_maior, 0);

  const lotesPorItem = new Map<number, typeof data.lotes>();
  data.lotes.forEach((l) => {
    const cur = lotesPorItem.get(l.sequencia_item) || [];
    cur.push(l);
    lotesPorItem.set(l.sequencia_item, cur);
  });

  const rotuloItem = (i: RMItem) => i.produto_nome || i.codigo_produto || "—";

  return (
    <div className="grid grid-cols-1 gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" className="mt-1 h-8 w-8 p-0" onClick={() => navigate("/producao/rm")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-bold tracking-tight tabular-nums text-foreground">{c.numero}</h1>
              <Badge variant="outline" className={cn(sv.className, "flex items-center gap-1.5")}>
                <sv.Icon className="h-3 w-3" />
                {sv.label}
              </Badge>
              <Badge variant="outline" className="border-border text-muted-foreground">
                {c.origem || "origem —"}
              </Badge>
              {c.tipo_atendimento && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className={cn(
                          "cursor-help",
                          c.tipo_atendimento === "Automático"
                            ? "border-red-500/30 bg-red-500/15 text-red-700 dark:text-red-400"
                            : "border-border text-muted-foreground",
                        )}
                      >
                        {c.tipo_atendimento}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      {c.tipo_atendimento === "Automático"
                        ? "RM com TipoAtendimento “Automático” nunca é atendida sozinha — medido no ano inteiro: 13 Automático = 13 Abertas."
                        : "Atendimento manual pelo almoxarifado — é o modo que efetivamente baixa estoque."}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {c.descricao || "(sem descrição)"} · {data.itens.length} {data.itens.length === 1 ? "item" : "itens"} ·{" "}
              <span className="tabular-nums">
                {numeroFmt.format(totalAtendido)} de {numeroFmt.format(totalPedido)} atendido
              </span>
            </p>
          </div>
        </div>

        {/* Conferência sob demanda — LEITURA. Não sincroniza, não grava. */}
        <Button variant="outline" onClick={conferir} disabled={conferindo} className="shrink-0">
          {conferindo ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Conferir no ERP
        </Button>
      </div>

      {/* Resultado da conferência — sempre em memória, nunca no espelho. */}
      {avisoConferencia && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium text-amber-700 dark:text-amber-400">{avisoConferencia.titulo}</p>
          <p className="mt-0.5 text-muted-foreground">{avisoConferencia.texto}</p>
        </div>
      )}

      {conferencia && conferencia.diferencas.length === 0 && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <span className="text-muted-foreground">
            Conferido no ERP às {format(conferencia.conferidoEm, "HH:mm", { locale: ptBR })} — nada mudou.
          </span>
        </div>
      )}

      {conferencia && conferencia.diferencas.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
            O ERP está diferente do que esta tela mostra ({conferencia.diferencas.length}{" "}
            {conferencia.diferencas.length === 1 ? "diferença" : "diferenças"})
          </p>
          <div className="mt-2 w-0 min-w-full overflow-x-auto">
            <table className="w-max min-w-full text-xs">
              <thead>
                <tr className="text-left uppercase text-muted-foreground">
                  <th className="py-1 pr-4 font-medium">Campo</th>
                  <th className="py-1 pr-4 font-medium">Nesta tela</th>
                  <th className="py-1 font-medium">No ERP agora</th>
                </tr>
              </thead>
              <tbody>
                {conferencia.diferencas.map((d) => (
                  <tr key={d.campo} className="border-t border-amber-500/20">
                    <td className="py-1 pr-4">{d.campo}</td>
                    <td className="py-1 pr-4 tabular-nums text-muted-foreground line-through">{d.noHub}</td>
                    <td className="py-1 font-medium tabular-nums">{d.noAlvo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* O usuário precisa saber que isto NÃO foi gravado — senão sai da
              tela achando que a lista já está corrigida. */}
          <p className="mt-2 text-xs text-muted-foreground">
            Valores conferidos agora no ERP, às {format(conferencia.conferidoEm, "HH:mm", { locale: ptBR })}. Esta
            consulta <strong>não altera o Hub</strong> — a lista e o consolidado atualizam na próxima sincronização.
          </p>
        </div>
      )}

      {c.ausente_desde && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <span className="font-medium text-destructive">Ausente no Alvo desde {formatDateTime(c.ausente_desde)}.</span>{" "}
          <span className="text-muted-foreground">
            A requisição sumiu da listagem do ERP e o espelho a preservou — nada foi apagado.
          </span>
        </div>
      )}

      {/* Dados da RM */}
      <DataSection title="Dados da requisição">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Número" value={c.numero} mono />
          <Field label="Data" value={formatData(c.data)} mono />
          <Field label="Filial" value={c.codigo_empresa_filial} mono />
          <Field label="Operação" value={c.operacao} />
          <Field label="Requisitante (usuário)" value={c.codigo_usuario} />
          <Field label="Funcionário" value={c.codigo_funcionario} mono />
          <Field label="Centro de controle" value={c.codigo_centro_ctrl} mono />
          <Field label="Local de armazenagem" value={c.codigo_loc_armaz} mono />
          <Field label="Baixou estoque" value={c.baixou_estoque} />
          <Field label="Tipo de lançamento" value={c.codigo_tipo_lanc} mono />
          <Field label="Gera empenho" value={c.gera_empenho} />
          <Field label="Espécie" value={c.especie_documento} />
          <Field label="Entrega" value={formatDateTime(c.data_entrega)} mono />
          <Field label="Entregou (func.)" value={c.codigo_funcionario_entregou} mono />
          <Field label="Retirou (func.)" value={c.codigo_funcionario_retirou} mono />
          <Field label="Validade" value={formatData(c.data_validade)} mono />
          <Field label="OP vinculada" value={data.vinculo?.op_numero || "—"} mono />
          <Field label="Envio pelo Hub" value={data.vinculo?.status_envio || "—"} />
          <Field label="Sincronizado em" value={formatDateTime(c.sincronizado_em)} mono />
          <Field label="Detalhado em" value={formatDateTime(c.detalhes_carregados_em)} mono />
        </div>

        {!data.vinculo && (
          // Estado normal, não erro: 96,4% das RMs de produção nascem na tela do
          // Alvo e não têm OP. É a medida do vazamento (§10.7), não um defeito.
          <p className="mt-4 text-xs text-muted-foreground">
            Sem vínculo com Ordem de Produção — requisição criada diretamente no Alvo.
          </p>
        )}
      </DataSection>

      {/* Itens */}
      <DataSection
        title="Itens"
        subtitle={`${data.itens.length} ${data.itens.length === 1 ? "item" : "itens"} · saldo ${numeroFmt.format(totalSaldo)}`}
        flush
      >
        <div className="w-0 min-w-full overflow-x-auto">
          <table className="w-max min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="px-4 py-2.5 font-medium">Código</th>
                <th className="px-4 py-2.5 font-medium">Produto</th>
                <th className="px-4 py-2.5 font-medium">Unid.</th>
                <th className="px-4 py-2.5 font-medium">Local</th>
                <th className="px-4 py-2.5 text-right font-medium">Pedido</th>
                <th className="px-4 py-2.5 text-right font-medium">Atendido</th>
                <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                <th className="px-4 py-2.5 text-right font-medium">Devolvido</th>
                <th className="px-4 py-2.5 text-right font-medium">Perdido</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-medium">Atendido em</th>
              </tr>
            </thead>
            <tbody>
              {data.itens.map((i) => (
                <tr key={`${i.numero_reqmat}-${i.sequencia}`} className="border-b last:border-b-0">
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{i.sequencia}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                    <span className="font-medium">{i.codigo_alternativo_produto || "—"}</span>
                    <span className="text-muted-foreground"> · {i.codigo_produto || "—"}</span>
                  </td>
                  <td className="max-w-[320px] px-4 py-2.5">
                    <span className="line-clamp-1">{rotuloItem(i)}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                    {i.codigo_prod_unid_med || "—"}
                    {/* Posição ≠ 1 significa unidade SECUNDÁRIA do cadastro — medido
                        em 76 itens do ano. Marcar evita ler a quantidade na unidade errada. */}
                    {i.posicao_prod_unid_med != null && i.posicao_prod_unid_med !== 1 && (
                      <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400">
                        (un. {i.posicao_prod_unid_med})
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">
                    {i.codigo_loc_armaz || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{numeroFmt.format(i.quantidade)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                    {numeroFmt.format(i.quantidade_atendida)}
                    {i.quantidade_atendida_maior > 0 && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-1.5 cursor-help rounded border border-amber-500/30 bg-amber-500/15 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                              +{numeroFmt.format(i.quantidade_atendida_maior)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            Excedente carimbado pelo Alvo em <code>QuantidadeAtendidaMaior</code>: no atendimento a
                            quantidade é digitada, e saiu mais material do que o pedido. Não é conta do Hub.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2.5 text-right tabular-nums",
                      i.quantidade_saldo > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
                    )}
                  >
                    {numeroFmt.format(i.quantidade_saldo)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {numeroFmt.format(i.quantidade_devolvida)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {numeroFmt.format(i.quantidade_perdida)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">
                    {formatDateTime(i.data_hora_atendimento || i.data_atendimento)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 text-xs font-medium">
                <td className="px-4 py-2.5" colSpan={5}>
                  Total
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{numeroFmt.format(totalPedido)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {numeroFmt.format(totalAtendido)}
                  {totalExcedente > 0 && (
                    <span className="ml-1.5 text-amber-700 dark:text-amber-400">
                      +{numeroFmt.format(totalExcedente)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{numeroFmt.format(totalSaldo)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </DataSection>

      {/* Lotes */}
      <DataSection
        title="Lotes consumidos"
        subtitle={`${data.lotes.length} ${data.lotes.length === 1 ? "linha" : "linhas"}`}
        icon={<Boxes className="h-3.5 w-3.5" />}
        flush
      >
        {data.lotes.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Sem lotes registrados. A lista de lotes é escrita no <strong>atendimento</strong>, não na criação — item não
            atendido tem zero lotes, e produto sem controle de lote nunca terá.
          </p>
        ) : (
          <div className="w-0 min-w-full overflow-x-auto">
            <table className="w-max min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium">Produto</th>
                  <th className="px-4 py-2.5 font-medium">Lote</th>
                  <th className="px-4 py-2.5 font-medium">Validade</th>
                  <th className="px-4 py-2.5 font-medium">Local</th>
                  <th className="px-4 py-2.5 text-right font-medium">Quantidade</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(lotesPorItem.entries())
                  .sort((a, b) => a[0] - b[0])
                  .map(([seq, linhas]) => {
                    const item = data.itens.find((i) => i.sequencia === seq);
                    // Conferência: a regra de fechamento do Alvo exige que os
                    // lotes batam EXATAMENTE com o atendido do item (§10.20).
                    // Somamos `quantidade` — NUNCA `quantidade_bruta`, cujo
                    // significado não está fechado (5 para 1 galão na RM 2275;
                    // 4 nas duas linhas de um rateio de 4 na 2272).
                    //
                    // Só itens COM lote chegam aqui (o mapa vem de `data.lotes`),
                    // então produto sem controle de lote não gera aviso falso —
                    // são 597 itens atendidos sem lote nenhum no espelho, e
                    // nenhum deles é anomalia.
                    const somaLotes = linhas.reduce((s, l) => s + l.quantidade, 0);
                    const bate = item ? Math.abs(somaLotes - item.quantidade_atendida) < 0.000001 : true;
                    return (
                      <Fragment key={seq}>
                        {linhas.map((l, idx) => (
                          <tr key={l.id} className="border-b last:border-b-0">
                            <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{idx === 0 ? seq : ""}</td>
                            <td className="max-w-[280px] px-4 py-2.5">
                              <span className="line-clamp-1">
                                {idx === 0 ? item?.produto_nome || l.codigo_produto || "—" : ""}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                              {l.numero_ctrl_lote || "—"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                              {formatData(l.data_validade_ctrl_lote)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">
                              {l.codigo_loc_armaz || "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{numeroFmt.format(l.quantidade)}</td>
                          </tr>
                        ))}
                        {!bate && (
                          <tr className="border-b bg-amber-500/5 last:border-b-0">
                            <td colSpan={6} className="px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
                              Item {seq}: lote registrado ({numeroFmt.format(somaLotes)}) sem bater com o atendido (
                              {numeroFmt.format(item?.quantidade_atendida ?? 0)}). Divergência do próprio ERP — no
                              espelho inteiro são 4 casos, todos de RM ainda <strong>Aberta</strong> com lote já
                              apontado. Não é conta do Hub.
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </DataSection>
    </div>
  );
}
