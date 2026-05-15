/**
 * Etapa 4 do wizard de Bulk Edit Produtos: Preview antes/depois + criação do job.
 *
 * Etapa critica — ultima oportunidade do usuario ver o que vai acontecer.
 *
 * Fluxo:
 * 1. Estado inicial: botao "Preparar preview"
 * 2. Loop SERIAL de Load por produto (GET /produto/load?codigo=X)
 *    - Contador em tempo real (X/N)
 *    - Barra de progresso
 *    - Botao Cancelar mantem snapshots ja carregados mas nao cria job
 *    - Se algum Load falhar, marca o produto como erro mas continua
 * 3. Apos carregamento: tabela 1 linha por produto, celulas coloridas por
 *    campo: "sem mudanca" (cinza) ou "antigo -> novo" (amarelo destaque)
 * 4. Confirmacao textual: digitar "ALTERAR" para habilitar criacao do job
 * 5. Ao confirmar: chama bulk_edit_create_job RPC e avanca para Etapa 5
 */

import { useState, useRef, useMemo } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ArrowRight, CheckCircle2, XCircle, AlertTriangle, Loader2, Play, Ban } from "lucide-react";
import { loadProduto, createBulkJob } from "@/services/produtoBulkService";
import { BULK_EDIT_PRODUTO_FIELDS } from "@/constants/bulkEditFields";
import type { LinhaPreCheckOk } from "./Etapa3PreCheck";

// Tipos publicos exportados
export interface LinhaPreviewPronta {
  sequencia: number;
  codigoAlternativo: string;
  codigoAlvo: string;
  snapshotCompleto: any;
  valoresAntigos: Record<string, string>;
  valoresNovos: Record<string, string>;
}

interface Etapa4Props {
  camposEscolhidos: string[];
  linhasPreCheck: LinhaPreCheckOk[];
  onVoltar: () => void;
  onAvancar: (jobId: string, linhasPreview: LinhaPreviewPronta[]) => void;
}

// Tipos internos
type EstadoEtapa4 = "inicial" | "carregando" | "carregado" | "criando_job";
type LoadStatus = "pendente" | "carregando" | "ok" | "erro";

interface LinhaCarregamento {
  sequencia: number;
  codigoAlternativo: string;
  codigoAlvo: string;
  status: LoadStatus;
  snapshot: any | null;
  erro: string | null;
  valoresAntigos: Record<string, string>;
}

export function Etapa4Preview({ camposEscolhidos, linhasPreCheck, onVoltar, onAvancar }: Etapa4Props) {
  const [estado, setEstado] = useState<EstadoEtapa4>("inicial");

  const [linhas, setLinhas] = useState<LinhaCarregamento[]>(() =>
    linhasPreCheck.map((l) => ({
      sequencia: l.sequencia,
      codigoAlternativo: l.codigoAlternativo,
      codigoAlvo: l.codigoAlvo,
      status: "pendente" as LoadStatus,
      snapshot: null,
      erro: null,
      valoresAntigos: {},
    })),
  );

  const cancelarRef = useRef(false);
  const [confirmacao, setConfirmacao] = useState("");

  const camposOrdenados = useMemo(
    () => BULK_EDIT_PRODUTO_FIELDS.filter((f) => camposEscolhidos.includes(f.key)),
    [camposEscolhidos],
  );

  // Loop serial de Load
  const carregarSnapshots = async () => {
    setEstado("carregando");
    cancelarRef.current = false;

    setLinhas((prev) =>
      prev.map((l) => ({
        ...l,
        status: "pendente" as LoadStatus,
        snapshot: null,
        erro: null,
        valoresAntigos: {},
      })),
    );

    for (let i = 0; i < linhasPreCheck.length; i++) {
      if (cancelarRef.current) break;

      const linhaPreCheck = linhasPreCheck[i];

      setLinhas((prev) => prev.map((l, idx) => (idx === i ? { ...l, status: "carregando" as LoadStatus } : l)));

      try {
        const snapshot = await loadProduto(linhaPreCheck.codigoAlvo);

        const valoresAntigos: Record<string, string> = {};
        for (const campoKey of Object.keys(linhaPreCheck.valoresNovos)) {
          const valAtual = snapshot[campoKey];
          valoresAntigos[campoKey] = valAtual == null ? "" : String(valAtual);
        }

        setLinhas((prev) =>
          prev.map((l, idx) =>
            idx === i
              ? {
                  ...l,
                  status: "ok" as LoadStatus,
                  snapshot,
                  valoresAntigos,
                }
              : l,
          ),
        );
      } catch (err: any) {
        console.error(`Erro ao carregar produto ${linhaPreCheck.codigoAlvo}:`, err);
        setLinhas((prev) =>
          prev.map((l, idx) =>
            idx === i
              ? {
                  ...l,
                  status: "erro" as LoadStatus,
                  erro: err?.message || String(err),
                }
              : l,
          ),
        );
      }
    }

    setEstado("carregado");

    if (cancelarRef.current) {
      toast.warning("Carregamento cancelado.");
    }
  };

  const cancelarCarregamento = () => {
    cancelarRef.current = true;
    toast.info("Cancelando apos o produto atual...");
  };

  // Estatisticas
  const totalLinhas = linhas.length;
  const carregadasOk = linhas.filter((l) => l.status === "ok").length;
  const comErro = linhas.filter((l) => l.status === "erro").length;
  const pendentes = linhas.filter((l) => l.status === "pendente" || l.status === "carregando").length;
  const atual = carregadasOk + comErro;
  const progresso = totalLinhas > 0 ? (atual / totalLinhas) * 100 : 0;

  const linhaTemMudanca = (l: LinhaCarregamento): boolean => {
    if (l.status !== "ok") return false;
    const preCheck = linhasPreCheck.find((lp) => lp.codigoAlvo === l.codigoAlvo);
    if (!preCheck) return false;
    for (const [campo, valorNovo] of Object.entries(preCheck.valoresNovos)) {
      const valorAntigo = l.valoresAntigos[campo] ?? "";
      if (valorAntigo !== valorNovo) return true;
    }
    return false;
  };

  const totalComMudanca = linhas.filter(linhaTemMudanca).length;
  const totalSemMudanca = carregadasOk - totalComMudanca;

  // Workaround para narrowing agressivo do TS:
  // extrai estado como string para evitar inferencia que considera
  // comparacoes "carregado" vs "criando_job" como inalcancaveis
  const estadoStr = estado as string;
  const estaCriandoJob = estadoStr === "criando_job";
  const estaCarregado = estadoStr === "carregado";
  const podeRenderizarBotaoCriar = (estaCarregado || estaCriandoJob) && totalComMudanca > 0;

  const podeConfirmar = estaCarregado && carregadasOk > 0 && confirmacao.trim().toUpperCase() === "ALTERAR";

  const criarJob = async () => {
    if (!podeConfirmar) return;
    setEstado("criando_job");

    try {
      const linhasParaJob: LinhaPreviewPronta[] = [];
      linhasPreCheck.forEach((preCheck, idx) => {
        const linha = linhas[idx];
        if (linha.status !== "ok") return;
        if (!linhaTemMudanca(linha)) return;
        linhasParaJob.push({
          sequencia: linhasParaJob.length + 1,
          codigoAlternativo: preCheck.codigoAlternativo,
          codigoAlvo: preCheck.codigoAlvo,
          snapshotCompleto: linha.snapshot,
          valoresAntigos: linha.valoresAntigos,
          valoresNovos: preCheck.valoresNovos,
        });
      });

      if (linhasParaJob.length === 0) {
        toast.error(
          "Nenhuma linha com mudanca real para executar. Todos os valores propostos ja sao iguais aos atuais.",
        );
        setEstado("carregado");
        return;
      }

      const jobId = await createBulkJob({
        tipo: "produtos_campos",
        total_itens: linhasParaJob.length,
        campos_alterados: camposEscolhidos,
        input_planilha: {
          total_linhas: linhasPreCheck.length,
          campos: camposEscolhidos,
        },
        parametros: {
          erros_pre_save: comErro,
          linhas_sem_mudanca: totalSemMudanca,
        },
      });

      toast.success(`Job criado: ${linhasParaJob.length} produto(s) prontos para alteracao.`);
      onAvancar(jobId, linhasParaJob);
    } catch (err: any) {
      console.error("Erro ao criar job:", err);
      toast.error(`Falha ao criar job: ${err?.message || String(err)}`);
      setEstado("carregado");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-blue-600" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">Ultima verificacao antes da execucao</p>
            <p className="text-muted-foreground">
              Vamos carregar o estado atual de cada produto no Alvo (1 chamada por produto, ~3s cada). Voce vera o diff
              "antes -&gt; depois" linha por linha. Os snapshots ficam salvos no job para permitir reversao. Para{" "}
              {linhasPreCheck.length} produtos, estime{" "}
              <strong>~{Math.ceil((linhasPreCheck.length * 3) / 60)} min</strong>.
            </p>
          </div>
        </CardContent>
      </Card>

      {estado === "inicial" && (
        <Card>
          <CardContent className="flex min-h-[200px] flex-col items-center justify-center gap-4 p-8 text-center">
            <Play className="h-12 w-12 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Pronto para preparar o preview</p>
              <p className="text-sm text-muted-foreground">Carregaremos {linhasPreCheck.length} snapshot(s) do Alvo.</p>
            </div>
            <Button onClick={carregarSnapshots}>
              <Play className="h-4 w-4" />
              Preparar preview
            </Button>
          </CardContent>
        </Card>
      )}

      {estado === "carregando" && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div className="flex-1">
                <p className="font-medium text-foreground">Carregando snapshots do Alvo...</p>
                <p className="text-sm text-muted-foreground">
                  <strong>
                    {atual}/{totalLinhas}
                  </strong>{" "}
                  carregado(s) — {pendentes} restante(s)
                  {comErro > 0 && ` · ${comErro} com erro`}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={cancelarCarregamento}>
                <Ban className="h-4 w-4" />
                Cancelar
              </Button>
            </div>
            <Progress value={progresso} className="h-2" />
            {(() => {
              const carregandoAgora = linhas.find((l) => l.status === "carregando");
              if (carregandoAgora) {
                return (
                  <p className="text-xs text-muted-foreground">
                    Carregando agora: {carregandoAgora.codigoAlternativo} -&gt; {carregandoAgora.codigoAlvo}
                  </p>
                );
              }
              return null;
            })()}
          </CardContent>
        </Card>
      )}

      {(estaCarregado || estaCriandoJob) && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{totalComMudanca}</p>
                  <p className="text-xs text-muted-foreground">Com mudancas</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <AlertTriangle className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{totalSemMudanca}</p>
                  <p className="text-xs text-muted-foreground">Sem mudanca (serao puladas)</p>
                </div>
              </CardContent>
            </Card>
            <Card className={comErro > 0 ? "border-red-500/30 bg-red-500/5" : "border-border"}>
              <CardContent className="flex items-center gap-3 p-4">
                <XCircle className={comErro > 0 ? "h-5 w-5 text-red-600" : "h-5 w-5 text-muted-foreground"} />
                <div>
                  <p className="text-2xl font-bold text-foreground">{comErro}</p>
                  <p className="text-xs text-muted-foreground">Erros no Load</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={carregarSnapshots}
                  disabled={estaCriandoJob}
                  className="text-muted-foreground"
                >
                  Recarregar snapshots
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-secondary text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">#</th>
                      <th className="px-3 py-2 text-left font-medium">Codigo Alvo</th>
                      <th className="px-3 py-2 text-left font-medium">Alternativo</th>
                      {camposOrdenados.map((f) => (
                        <th key={f.key} className="px-3 py-2 text-left font-medium">
                          {f.label}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((linha, idx) => {
                      const preCheck = linhasPreCheck[idx];
                      const isErro = linha.status === "erro";
                      const temMudanca = linhaTemMudanca(linha);
                      return (
                        <tr
                          key={linha.sequencia}
                          className={`border-t border-border ${
                            isErro ? "bg-red-500/5" : temMudanca ? "" : "bg-muted/30"
                          }`}
                        >
                          <td className="px-3 py-2 text-muted-foreground">{linha.sequencia}</td>
                          <td className="px-3 py-2 font-mono text-xs">{linha.codigoAlvo}</td>
                          <td className="px-3 py-2 font-mono text-xs">{linha.codigoAlternativo}</td>
                          {camposOrdenados.map((f) => {
                            const valorNovo = preCheck.valoresNovos[f.key];
                            if (valorNovo == null) {
                              return (
                                <td key={f.key} className="px-3 py-2 text-muted-foreground/30">
                                  —
                                </td>
                              );
                            }
                            const valorAntigo = linha.valoresAntigos[f.key] ?? "";
                            const mudou = valorAntigo !== valorNovo;
                            return (
                              <td key={f.key} className="px-3 py-2">
                                {linha.status !== "ok" ? (
                                  <span className="text-muted-foreground/40">—</span>
                                ) : !mudou ? (
                                  <span className="text-xs text-muted-foreground">sem mudanca</span>
                                ) : (
                                  <div className="space-y-0.5">
                                    <div className="line-through text-xs text-muted-foreground">
                                      {valorAntigo || "(vazio)"}
                                    </div>
                                    <div className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                                      -&gt; {valorNovo}
                                    </div>
                                  </div>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2">
                            {linha.status === "ok" && temMudanca && (
                              <Badge
                                variant="outline"
                                className="border-amber-500/30 bg-amber-500/10 text-xs text-amber-600"
                              >
                                Alterar
                              </Badge>
                            )}
                            {linha.status === "ok" && !temMudanca && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                Pular
                              </Badge>
                            )}
                            {linha.status === "erro" && (
                              <div className="flex flex-col gap-1">
                                <Badge
                                  variant="outline"
                                  className="w-fit border-red-500/30 bg-red-500/10 text-xs text-red-600"
                                >
                                  <XCircle className="mr-1 h-3 w-3" />
                                  Erro
                                </Badge>
                                <p className="text-xs text-red-600">{linha.erro}</p>
                              </div>
                            )}
                            {linha.status === "carregando" && (
                              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
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

          {totalComMudanca > 0 && (
            <Card className="border-amber-500/40 bg-amber-500/5">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                  <div className="flex-1 space-y-2 text-sm">
                    <p className="font-medium text-foreground">Confirmacao final</p>
                    <p className="text-muted-foreground">
                      Voce esta prestes a alterar <strong>{totalComMudanca} produto(s)</strong> em producao no ERP Alvo.
                      Para confirmar, digite{" "}
                      <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">
                        ALTERAR
                      </code>{" "}
                      no campo abaixo.
                    </p>
                    <div className="pt-2">
                      <Input
                        type="text"
                        placeholder="Digite ALTERAR para confirmar"
                        value={confirmacao}
                        onChange={(e) => setConfirmacao(e.target.value)}
                        disabled={estaCriandoJob}
                        className="max-w-sm font-mono"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onVoltar} disabled={estado === "carregando" || estaCriandoJob}>
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        {podeRenderizarBotaoCriar && (
          <Button onClick={criarJob} disabled={!podeConfirmar || estaCriandoJob}>
            {estaCriandoJob ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Criando job...
              </>
            ) : (
              <>
                Criar job e prosseguir
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
