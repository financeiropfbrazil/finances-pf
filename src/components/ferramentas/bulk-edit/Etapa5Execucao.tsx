/**
 * Etapa 5 do wizard de Bulk Edit Produtos: EXECUÇÃO REAL.
 *
 * Aqui produtos são REALMENTE alterados no ERP Alvo.
 *
 * Fluxo:
 * 1. Banner avisando que vamos começar — botão "Iniciar execução"
 * 2. Loop sequencial:
 *    - Para cada produto: monta payload SavePartial usando snapshot da Etapa 4
 *    - POST /produto/save-partial no erp-proxy
 *    - Grava resultado no Supabase via bulk_edit_record_item
 *    - 750ms de delay entre saves
 *    - Atualiza UI em tempo real (status por linha)
 * 3. Pausa automática se 3 erros consecutivos
 * 4. Cancelamento via flag, mantém saves já feitos
 * 5. Ao final: chama bulk_edit_finish_job, mostra resumo
 * 6. window.onbeforeunload durante execução
 *
 * Todos os erros são capturados e mostrados na UI por linha + contador geral.
 */

import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Play,
  Pause,
  History,
  PartyPopper,
} from "lucide-react";
import {
  savePartialProduto,
  recordBulkItem,
  startBulkJob,
  finishBulkJob,
  montarPayloadSavePartial,
  type BulkItemStatus,
} from "@/services/produtoBulkService";
import { BULK_EDIT_PRODUTO_FIELDS } from "@/constants/bulkEditFields";
import type { LinhaPreviewPronta } from "./Etapa4Preview";

const DELAY_MS_ENTRE_SAVES = 750;
const MAX_ERROS_CONSECUTIVOS = 3;

// ─── Tipos internos ──────────────────────────────────────────────

type EstadoEtapa5 = "inicial" | "executando" | "pausado_erros" | "concluido" | "cancelado";

type StatusItem = "pendente" | "executando" | "sucesso" | "falha";

interface LinhaExecucao {
  sequencia: number;
  codigoAlternativo: string;
  codigoAlvo: string;
  snapshotCompleto: any;
  valoresAntigos: Record<string, string>;
  valoresNovos: Record<string, string>;
  status: StatusItem;
  erro: string | null;
  processadoEm: Date | null;
}

interface Etapa5Props {
  jobId: string;
  camposEscolhidos: string[];
  linhasPreview: LinhaPreviewPronta[];
}

export function Etapa5Execucao({ jobId, camposEscolhidos, linhasPreview }: Etapa5Props) {
  const [estado, setEstado] = useState<EstadoEtapa5>("inicial");
  const [linhas, setLinhas] = useState<LinhaExecucao[]>(() =>
    linhasPreview.map((l) => ({
      sequencia: l.sequencia,
      codigoAlternativo: l.codigoAlternativo,
      codigoAlvo: l.codigoAlvo,
      snapshotCompleto: l.snapshotCompleto,
      valoresAntigos: l.valoresAntigos,
      valoresNovos: l.valoresNovos,
      status: "pendente" as StatusItem,
      erro: null,
      processadoEm: null,
    })),
  );

  const cancelarRef = useRef(false);
  const pausarRef = useRef(false);
  const errosConsecutivosRef = useRef(0);

  // Workaround narrowing TS
  const estadoStr = estado as string;
  const estaExecutando = estadoStr === "executando";
  const estaPausado = estadoStr === "pausado_erros";
  const estaConcluido = estadoStr === "concluido" || estadoStr === "cancelado";

  // ─── beforeunload warning durante execução ───────────────────────

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (estaExecutando) {
        e.preventDefault();
        e.returnValue = "Execução em andamento. Sair agora pode deixar produtos pela metade.";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [estaExecutando]);

  // ─── Loop de execução ────────────────────────────────────────────

  const executarTudo = async () => {
    setEstado("executando");
    cancelarRef.current = false;
    pausarRef.current = false;
    errosConsecutivosRef.current = 0;

    // Marca o job como em_execucao no Supabase
    try {
      await startBulkJob(jobId);
    } catch (err: any) {
      toast.error(`Falha ao iniciar job: ${err?.message || String(err)}`);
      setEstado("inicial");
      return;
    }

    for (let i = 0; i < linhas.length; i++) {
      // Verifica flags de controle
      if (cancelarRef.current) break;
      if (pausarRef.current) {
        setEstado("pausado_erros");
        return;
      }

      // Pula itens que já foram processados (caso de retomada)
      if (linhas[i].status === "sucesso" || linhas[i].status === "falha") {
        continue;
      }

      const linha = linhas[i];

      // Marca como executando
      setLinhas((prev) => prev.map((l, idx) => (idx === i ? { ...l, status: "executando" as StatusItem } : l)));

      let sucessoNesteItem = false;
      let mensagemErro: string | null = null;
      let responseAlvo: any = null;
      let httpStatusFinal: number | null = null;

      // ─── 1. Tenta SavePartial no Alvo ───────────────────────────
      try {
        const payload = montarPayloadSavePartial(linha.snapshotCompleto, linha.valoresNovos);
        responseAlvo = await savePartialProduto(payload);
        httpStatusFinal = 200;
        sucessoNesteItem = true;
      } catch (err: any) {
        mensagemErro = err?.message || String(err);
        httpStatusFinal = err?.status || null;
        responseAlvo = err?.details || null;
        console.error(`Save falhou para ${linha.codigoAlvo}:`, err);
      }

      // ─── 2. Grava resultado no Supabase (sempre, sucesso ou falha)
      try {
        await recordBulkItem({
          job_id: jobId,
          sequencia: linha.sequencia,
          identificador: linha.codigoAlternativo,
          codigo_alvo: linha.codigoAlvo,
          snapshot_antes: linha.snapshotCompleto,
          payload_enviado: montarPayloadSavePartial(linha.snapshotCompleto, linha.valoresNovos),
          response_alvo: responseAlvo,
          http_status: httpStatusFinal,
          status: (sucessoNesteItem ? "sucesso" : "falha") as BulkItemStatus,
          erro_mensagem: mensagemErro,
        });
      } catch (err: any) {
        // Erro ao gravar no Supabase — situação crítica
        const msgRpc = err?.message || String(err);
        console.error(`CRITICO: falhou ao gravar item no Supabase (${linha.codigoAlvo}):`, err);
        toast.error(
          `Atenção: produto ${linha.codigoAlternativo} pode ter sido alterado no Alvo mas não foi registrado. Erro: ${msgRpc}`,
        );
        // Se o save no Alvo deu OK mas o Supabase falhou, marca como falha localmente
        // pra alertar o usuário, mas o save é real
        if (sucessoNesteItem) {
          mensagemErro = `Save OK no Alvo, mas falhou gravar no Hub: ${msgRpc}`;
          sucessoNesteItem = false;
        } else {
          mensagemErro = `${mensagemErro || "Erro"} | Falha também ao gravar no Hub: ${msgRpc}`;
        }
      }

      // ─── 3. Atualiza UI ─────────────────────────────────────────
      setLinhas((prev) =>
        prev.map((l, idx) =>
          idx === i
            ? {
                ...l,
                status: (sucessoNesteItem ? "sucesso" : "falha") as StatusItem,
                erro: mensagemErro,
                processadoEm: new Date(),
              }
            : l,
        ),
      );

      // ─── 4. Lógica de erros consecutivos ────────────────────────
      if (sucessoNesteItem) {
        errosConsecutivosRef.current = 0;
      } else {
        errosConsecutivosRef.current += 1;
        if (errosConsecutivosRef.current >= MAX_ERROS_CONSECUTIVOS) {
          toast.warning(`${MAX_ERROS_CONSECUTIVOS} erros consecutivos. Execução pausada.`);
          pausarRef.current = true;
          // o próximo loop iteration vai detectar e pausar
        }
      }

      // ─── 5. Delay entre saves ───────────────────────────────────
      if (i < linhas.length - 1) {
        await new Promise((r) => setTimeout(r, DELAY_MS_ENTRE_SAVES));
      }
    }

    // ─── Fim do loop: decide estado final ──────────────────────────
    // Lê os contadores diretamente do state mais recente via callback
    setLinhas((prev) => {
      const sucessos = prev.filter((l) => l.status === "sucesso").length;
      const falhas = prev.filter((l) => l.status === "falha").length;
      const pendentes = prev.filter((l) => l.status === "pendente").length;

      // Decide estado final assincronamente
      void (async () => {
        try {
          await finishBulkJob({
            job_id: jobId,
            itens_sucesso: sucessos,
            itens_falha: falhas,
            itens_pulado: pendentes,
            observacoes: cancelarRef.current ? "Job cancelado pelo usuário." : undefined,
          });
        } catch (err: any) {
          console.error("Falha ao finalizar job:", err);
          toast.error(`Falha ao finalizar job no Supabase: ${err?.message || String(err)}`);
        }
      })();

      if (cancelarRef.current) {
        setEstado("cancelado");
        toast.info(`Execução cancelada. ${sucessos} alterações foram aplicadas.`);
      } else {
        setEstado("concluido");
        if (falhas === 0) {
          toast.success(`Concluído: ${sucessos} produto(s) alterado(s).`);
        } else {
          toast.warning(`Concluído com erros: ${sucessos} OK, ${falhas} falha(s).`);
        }
      }
      return prev;
    });
  };

  // ─── Controles do usuário ────────────────────────────────────────

  const continuarAposPausa = () => {
    pausarRef.current = false;
    errosConsecutivosRef.current = 0;
    void executarTudo();
  };

  const pararAposPausa = async () => {
    // Marca como cancelado e finaliza
    cancelarRef.current = true;

    const sucessos = linhas.filter((l) => l.status === "sucesso").length;
    const falhas = linhas.filter((l) => l.status === "falha").length;
    const pendentes = linhas.filter((l) => l.status === "pendente").length;

    try {
      await finishBulkJob({
        job_id: jobId,
        itens_sucesso: sucessos,
        itens_falha: falhas,
        itens_pulado: pendentes,
        observacoes: "Parado pelo usuário após erros consecutivos.",
      });
    } catch (err: any) {
      console.error("Falha ao finalizar:", err);
    }

    setEstado("cancelado");
    toast.info(`Execução parada. ${sucessos} alterações aplicadas.`);
  };

  const cancelarExecucao = () => {
    if (estaExecutando) {
      cancelarRef.current = true;
      toast.info("Cancelando após o produto atual...");
    }
  };

  // ─── Estatísticas ────────────────────────────────────────────────

  const totalLinhas = linhas.length;
  const sucessos = linhas.filter((l) => l.status === "sucesso").length;
  const falhas = linhas.filter((l) => l.status === "falha").length;
  const executando = linhas.filter((l) => l.status === "executando").length;
  const pendentes = linhas.filter((l) => l.status === "pendente").length;
  const processados = sucessos + falhas;
  const progresso = totalLinhas > 0 ? (processados / totalLinhas) * 100 : 0;

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header com job ID */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-blue-600" />
          <div className="flex-1 space-y-1 text-sm">
            <p className="font-medium text-foreground">Execução do job no ERP Alvo</p>
            <p className="text-muted-foreground">
              Job: <span className="font-mono text-xs">{jobId}</span>
            </p>
            <p className="text-muted-foreground">
              {totalLinhas} produto(s) a alterar — delay de {DELAY_MS_ENTRE_SAVES}ms entre saves — estimativa{" "}
              <strong>~{Math.ceil((totalLinhas * (DELAY_MS_ENTRE_SAVES + 2000)) / 1000 / 60)} min</strong>. Pausa
              automática após {MAX_ERROS_CONSECUTIVOS} erros consecutivos.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ESTADO: INICIAL */}
      {estado === "inicial" && (
        <Card>
          <CardContent className="flex min-h-[200px] flex-col items-center justify-center gap-4 p-8 text-center">
            <Play className="h-12 w-12 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Pronto para iniciar a execução</p>
              <p className="text-sm text-muted-foreground">
                Os {totalLinhas} produtos serão alterados no Alvo a partir deste ponto.
              </p>
            </div>
            <Button onClick={() => void executarTudo()} size="lg">
              <Play className="h-4 w-4" />
              Iniciar execução
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ESTADO: EXECUTANDO ou PAUSADO ou CONCLUÍDO */}
      {(estaExecutando || estaPausado || estaConcluido) && (
        <>
          {/* Cards de resumo */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{sucessos}</p>
                  <p className="text-xs text-muted-foreground">Sucesso</p>
                </div>
              </CardContent>
            </Card>
            <Card className={falhas > 0 ? "border-red-500/30 bg-red-500/5" : "border-border"}>
              <CardContent className="flex items-center gap-3 p-4">
                <XCircle className={falhas > 0 ? "h-5 w-5 text-red-600" : "h-5 w-5 text-muted-foreground"} />
                <div>
                  <p className="text-2xl font-bold text-foreground">{falhas}</p>
                  <p className="text-xs text-muted-foreground">Falha</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Loader2
                  className={estaExecutando ? "h-5 w-5 animate-spin text-primary" : "h-5 w-5 text-muted-foreground"}
                />
                <div>
                  <p className="text-2xl font-bold text-foreground">{pendentes}</p>
                  <p className="text-xs text-muted-foreground">Pendente</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{totalLinhas}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Barra de progresso */}
          {(estaExecutando || estaPausado) && (
            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between text-sm">
                  <p className="text-muted-foreground">
                    <strong>
                      {processados}/{totalLinhas}
                    </strong>{" "}
                    processado(s)
                    {executando > 0 && ` · ${executando} em andamento`}
                  </p>
                  {estaExecutando && (
                    <Button variant="outline" size="sm" onClick={cancelarExecucao}>
                      <Pause className="h-4 w-4" />
                      Cancelar
                    </Button>
                  )}
                </div>
                <Progress value={progresso} className="h-2" />
                {(() => {
                  const executandoAgora = linhas.find((l) => l.status === "executando");
                  if (executandoAgora) {
                    return (
                      <p className="text-xs text-muted-foreground">
                        Executando agora: {executandoAgora.codigoAlternativo} -&gt; {executandoAgora.codigoAlvo}
                      </p>
                    );
                  }
                  return null;
                })()}
              </CardContent>
            </Card>
          )}

          {/* Banner de pausa por erros consecutivos */}
          {estaPausado && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                  <div className="flex-1 space-y-2 text-sm">
                    <p className="font-medium text-foreground">
                      Execução pausada — {MAX_ERROS_CONSECUTIVOS} erros consecutivos detectados
                    </p>
                    <p className="text-muted-foreground">
                      Algo pode estar errado com o ERP Alvo ou com a planilha. Verifique as últimas falhas abaixo. Você
                      pode continuar (tentando o próximo) ou parar e revisar.
                    </p>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={continuarAposPausa}>
                        <Play className="h-4 w-4" />
                        Continuar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void pararAposPausa()}>
                        Parar e revisar
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Banner de conclusão */}
          {estaConcluido && (
            <Card
              className={falhas === 0 ? "border-emerald-500/40 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5"}
            >
              <CardContent className="flex items-start gap-3 p-4">
                {falhas === 0 ? (
                  <PartyPopper className="h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                )}
                <div className="flex-1 space-y-2 text-sm">
                  <p className="font-medium text-foreground">
                    {estado === "cancelado"
                      ? "Execução cancelada"
                      : falhas === 0
                        ? "Execução concluída com sucesso!"
                        : "Execução concluída com erros"}
                  </p>
                  <p className="text-muted-foreground">
                    <strong>{sucessos}</strong> produto(s) alterado(s) com sucesso
                    {falhas > 0 && (
                      <>
                        , <strong>{falhas}</strong> com erro
                      </>
                    )}
                    {pendentes > 0 && (
                      <>
                        , <strong>{pendentes}</strong> não processado(s)
                      </>
                    )}
                    . O job ficou registrado no histórico — você pode reverter as alterações se necessário.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button asChild>
                      <Link to="/ferramentas/bulk-edit/historico">
                        <History className="h-4 w-4" />
                        Ver no histórico
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link to="/ferramentas/bulk-edit/produtos-campos">Novo bulk edit</Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabela de execução */}
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-secondary text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">#</th>
                      <th className="px-3 py-2 text-left font-medium">Codigo Alvo</th>
                      <th className="px-3 py-2 text-left font-medium">Alternativo</th>
                      <th className="px-3 py-2 text-left font-medium">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((linha) => {
                      const isErro = linha.status === "falha";
                      const isOk = linha.status === "sucesso";
                      const isExec = linha.status === "executando";
                      return (
                        <tr
                          key={linha.sequencia}
                          className={`border-t border-border ${
                            isErro ? "bg-red-500/5" : isOk ? "bg-emerald-500/5" : isExec ? "bg-blue-500/5" : ""
                          }`}
                        >
                          <td className="px-3 py-2 text-muted-foreground">{linha.sequencia}</td>
                          <td className="px-3 py-2 font-mono text-xs">{linha.codigoAlvo}</td>
                          <td className="px-3 py-2 font-mono text-xs">{linha.codigoAlternativo}</td>
                          <td className="px-3 py-2">
                            {linha.status === "pendente" && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                Aguardando
                              </Badge>
                            )}
                            {isExec && (
                              <Badge
                                variant="outline"
                                className="border-blue-500/30 bg-blue-500/10 text-xs text-blue-600"
                              >
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                Executando...
                              </Badge>
                            )}
                            {isOk && (
                              <Badge
                                variant="outline"
                                className="border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-600"
                              >
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                Sucesso
                              </Badge>
                            )}
                            {isErro && (
                              <div className="flex flex-col gap-1">
                                <Badge
                                  variant="outline"
                                  className="w-fit border-red-500/30 bg-red-500/10 text-xs text-red-600"
                                >
                                  <XCircle className="mr-1 h-3 w-3" />
                                  Falha
                                </Badge>
                                {linha.erro && (
                                  <p className="text-xs text-red-600" title={linha.erro}>
                                    {linha.erro.length > 100 ? linha.erro.slice(0, 100) + "..." : linha.erro}
                                  </p>
                                )}
                              </div>
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
        </>
      )}
    </div>
  );
}
