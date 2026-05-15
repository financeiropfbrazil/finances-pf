/**
 * Etapa 3 do wizard de Bulk Edit Produtos: pre-check no ERP Alvo.
 *
 * Recebe as linhas válidas da Etapa 2 e:
 * - Detecta CodigoAlternativo duplicado (bloqueio absoluto, sem opção de ignorar)
 * - Chama POST /produto/list-by-alternativos no Alvo para obter:
 *   - Mapa Alternativo → Codigo estruturado
 *   - Nome atual (snapshot pré-save)
 *   - Status atual
 * - Marca linhas como "encontrada" (verde) ou "não encontrada" (vermelho)
 * - Permite avançar somente se todas encontradas, OU se usuário marcar
 *   "Ignorar não encontradas"
 * - Cache em memória: se a planilha não mudou desde a última checagem,
 *   reutiliza o resultado sem chamar o Alvo de novo
 */

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, ArrowRight, CheckCircle2, XCircle, AlertTriangle, Loader2, Search, RefreshCw } from "lucide-react";
import { listProdutosByAlternativos, type ProdutoLookupResult } from "@/services/produtoBulkService";
import type { LinhaPlanilhaValida } from "./Etapa2Upload";

// ─── Tipos públicos exportados ────────────────────────────────────

export interface LinhaPreCheckOk {
  sequencia: number;
  codigoAlternativo: string;
  codigoAlvo: string; // Codigo estruturado retornado pelo Alvo (ex: 001.010.041)
  nomeAtualAlvo: string;
  statusAtualAlvo: string;
  valoresNovos: Record<string, string>;
}

interface Etapa3Props {
  linhasPlanilha: LinhaPlanilhaValida[];
  onVoltar: () => void;
  onAvancar: (linhas: LinhaPreCheckOk[]) => void;
}

interface EstadoCache {
  assinatura: string;
  resultado: ProdutoLookupResult;
}

export function Etapa3PreCheck({ linhasPlanilha, onVoltar, onAvancar }: Etapa3Props) {
  const [executando, setExecutando] = useState(false);
  const [cache, setCache] = useState<EstadoCache | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ignorarNaoEncontradas, setIgnorarNaoEncontradas] = useState(false);

  // ─── Detectar duplicados (bloqueio absoluto) ─────────────────────

  const duplicados = useMemo(() => {
    const mapa = new Map<string, number[]>();
    linhasPlanilha.forEach((l, idx) => {
      const seq = idx + 1;
      const arr = mapa.get(l.codigoAlternativo) || [];
      arr.push(seq);
      mapa.set(l.codigoAlternativo, arr);
    });
    const dups: Array<{ codigo: string; linhas: number[] }> = [];
    mapa.forEach((linhas, codigo) => {
      if (linhas.length > 1) dups.push({ codigo, linhas });
    });
    return dups;
  }, [linhasPlanilha]);

  const temDuplicados = duplicados.length > 0;

  // ─── Assinatura da planilha (para cache) ─────────────────────────

  const assinaturaAtual = useMemo(
    () =>
      linhasPlanilha
        .map((l) => l.codigoAlternativo)
        .sort()
        .join("|"),
    [linhasPlanilha],
  );

  // Se a planilha mudou, invalida o cache automaticamente
  const cacheValido = cache !== null && cache.assinatura === assinaturaAtual;

  // ─── Executar pre-check ───────────────────────────────────────────

  const executarPreCheck = async () => {
    if (temDuplicados) {
      toast.error(`Há ${duplicados.length} código(s) duplicado(s) na planilha. Corrija antes de avançar.`);
      return;
    }

    setExecutando(true);
    setErro(null);
    setIgnorarNaoEncontradas(false);

    try {
      const alternativos = linhasPlanilha.map((l) => l.codigoAlternativo);
      const resultado = await listProdutosByAlternativos(alternativos);

      setCache({ assinatura: assinaturaAtual, resultado });

      const encontrados = resultado.found.length;
      const naoEncontrados = resultado.not_found.length;

      if (naoEncontrados === 0) {
        toast.success(`${encontrados} produto(s) encontrado(s) no Alvo. Pronto para avançar.`);
      } else {
        toast.warning(`${encontrados} encontrado(s), ${naoEncontrados} NÃO encontrado(s) no Alvo.`);
      }
    } catch (err: any) {
      console.error("Erro no pre-check:", err);
      const msg = err?.message || String(err);
      setErro(msg);
      toast.error(`Falha no pre-check: ${msg}`);
    } finally {
      setExecutando(false);
    }
  };

  // ─── Status por linha (depois do pre-check) ──────────────────────

  const linhasEnriquecidas = useMemo(() => {
    if (!cacheValido || !cache) return null;

    // Indexar resultado.found por alternativo
    const mapaEncontrados = new Map(cache.resultado.found.map((p) => [p.alternativo, p]));

    return linhasPlanilha.map((linha, idx) => {
      const sequencia = idx + 1;
      const encontrado = mapaEncontrados.get(linha.codigoAlternativo);
      return {
        sequencia,
        linha,
        encontrado, // undefined se não encontrado
      };
    });
  }, [cacheValido, cache, linhasPlanilha]);

  const totalEncontradas = linhasEnriquecidas ? linhasEnriquecidas.filter((x) => x.encontrado).length : 0;
  const totalNaoEncontradas = linhasEnriquecidas ? linhasEnriquecidas.filter((x) => !x.encontrado).length : 0;

  const todasEncontradas = linhasEnriquecidas !== null && totalNaoEncontradas === 0;
  const podeAvancar =
    !executando &&
    !temDuplicados &&
    linhasEnriquecidas !== null &&
    (todasEncontradas || (ignorarNaoEncontradas && totalEncontradas > 0));

  // ─── Handler de avanço ────────────────────────────────────────────

  const handleAvancar = () => {
    if (!podeAvancar || !linhasEnriquecidas) return;

    const linhasParaProsseguir: LinhaPreCheckOk[] = linhasEnriquecidas
      .filter((x) => x.encontrado)
      .map((x, idx) => ({
        sequencia: idx + 1, // re-numera 1..N só com os encontrados
        codigoAlternativo: x.linha.codigoAlternativo,
        codigoAlvo: x.encontrado!.codigo,
        nomeAtualAlvo: x.encontrado!.nome,
        statusAtualAlvo: x.encontrado!.status,
        valoresNovos: x.linha.valoresNovos,
      }));

    onAvancar(linhasParaProsseguir);
  };

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header explicativo */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="flex items-start gap-3 p-4">
          <Search className="h-5 w-5 shrink-0 text-blue-600" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">Verificação prévia no ERP Alvo</p>
            <p className="text-muted-foreground">
              Vamos consultar o ERP em 1 chamada para confirmar que todos os{" "}
              <strong>{linhasPlanilha.length} produto(s)</strong> existem mesmo. Isso evita descobrir códigos errados
              durante a execução em massa. A consulta pode levar até 90 segundos.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Bloqueio absoluto: duplicados */}
      {temDuplicados && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 shrink-0 text-red-600" />
              <div className="flex-1 space-y-2 text-sm">
                <p className="font-medium text-foreground">
                  {duplicados.length} CodigoAlternativo duplicado(s) na planilha
                </p>
                <p className="text-muted-foreground">
                  Cada produto deve aparecer só 1 vez na planilha. Volte à Etapa 2, corrija o arquivo e reenvie. Não é
                  possível ignorar duplicados.
                </p>
                <div className="space-y-1 pt-2">
                  {duplicados.map((d) => (
                    <p key={d.codigo} className="text-xs font-mono text-foreground">
                      <strong>{d.codigo}</strong> — linhas {d.linhas.join(", ")}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Estado: ANTES de executar (e sem duplicados) */}
      {!temDuplicados && !cacheValido && !erro && !executando && (
        <Card>
          <CardContent className="flex min-h-[200px] flex-col items-center justify-center gap-4 p-8 text-center">
            <Search className="h-12 w-12 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Pronto para consultar o Alvo</p>
              <p className="text-sm text-muted-foreground">
                Vamos verificar {linhasPlanilha.length} código(s) alternativo(s).
              </p>
            </div>
            <Button onClick={executarPreCheck}>
              <Search className="h-4 w-4" />
              Iniciar pre-check
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Estado: EXECUTANDO */}
      {executando && (
        <Card>
          <CardContent className="flex min-h-[200px] flex-col items-center justify-center gap-4 p-8 text-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                Consultando {linhasPlanilha.length} produto(s) no ERP Alvo...
              </p>
              <p className="text-sm text-muted-foreground">Aguarde — pode levar até 90 segundos.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Estado: ERRO */}
      {erro && !executando && (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 shrink-0 text-red-600" />
              <div className="space-y-1 text-sm">
                <p className="font-medium text-foreground">Falha no pre-check</p>
                <p className="text-muted-foreground">{erro}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={executarPreCheck}>
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Estado: SUCESSO — Cards de resumo */}
      {cacheValido && linhasEnriquecidas && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="flex items-center gap-3 p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{totalEncontradas}</p>
                  <p className="text-xs text-muted-foreground">Encontrados no Alvo</p>
                </div>
              </CardContent>
            </Card>
            <Card className={totalNaoEncontradas > 0 ? "border-red-500/30 bg-red-500/5" : "border-border"}>
              <CardContent className="flex items-center gap-3 p-4">
                <XCircle
                  className={totalNaoEncontradas > 0 ? "h-5 w-5 text-red-600" : "h-5 w-5 text-muted-foreground"}
                />
                <div>
                  <p className="text-2xl font-bold text-foreground">{totalNaoEncontradas}</p>
                  <p className="text-xs text-muted-foreground">Não encontrados</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <Button variant="ghost" size="sm" onClick={executarPreCheck} className="text-muted-foreground">
                  <RefreshCw className="h-4 w-4" />
                  Reexecutar pre-check
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Toggle "Ignorar não encontrados" */}
          {totalNaoEncontradas > 0 && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex items-start gap-3 p-4">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
                <div className="flex-1 space-y-2 text-sm">
                  <p className="font-medium text-foreground">
                    {totalNaoEncontradas} produto(s) NÃO encontrado(s) no Alvo
                  </p>
                  <p className="text-muted-foreground">
                    Esses códigos podem ter sido digitados errados ou os produtos foram excluídos. Você pode{" "}
                    <strong>voltar e corrigir</strong>, ou marcar a opção abaixo para prosseguir somente com os{" "}
                    <strong>{totalEncontradas} encontrado(s)</strong>.
                  </p>
                  <label className="flex cursor-pointer items-center gap-2 pt-1">
                    <Checkbox
                      checked={ignorarNaoEncontradas}
                      onCheckedChange={(checked) => setIgnorarNaoEncontradas(!!checked)}
                    />
                    <span className="text-sm font-medium text-foreground">
                      Ignorar não encontrados e prosseguir com {totalEncontradas} válido(s)
                    </span>
                  </label>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabela de resultados */}
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-secondary text-xs uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">#</th>
                      <th className="px-3 py-2 text-left font-medium">CodigoAlternativo</th>
                      <th className="px-3 py-2 text-left font-medium">Codigo Alvo</th>
                      <th className="px-3 py-2 text-left font-medium">Nome Atual</th>
                      <th className="px-3 py-2 text-left font-medium">Status Alvo</th>
                      <th className="px-3 py-2 text-left font-medium">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasEnriquecidas.map((x) => {
                      const naoEncontrado = !x.encontrado;
                      return (
                        <tr
                          key={x.sequencia}
                          className={`border-t border-border ${naoEncontrado ? "bg-red-500/5" : ""}`}
                        >
                          <td className="px-3 py-2 text-muted-foreground">{x.sequencia}</td>
                          <td className="px-3 py-2 font-mono text-xs">{x.linha.codigoAlternativo}</td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {x.encontrado?.codigo || <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            {x.encontrado?.nome || <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {x.encontrado?.status || <span className="text-muted-foreground/40">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            {naoEncontrado ? (
                              <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-xs text-red-600">
                                <XCircle className="mr-1 h-3 w-3" />
                                Não encontrado
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-600"
                              >
                                <CheckCircle2 className="mr-1 h-3 w-3" />
                                OK
                              </Badge>
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

      {/* Botões de navegação */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onVoltar} disabled={executando}>
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <Button onClick={handleAvancar} disabled={!podeAvancar}>
          Avançar
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
