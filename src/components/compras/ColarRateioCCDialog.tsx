import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ClipboardPaste, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  casarCentroDeCusto,
  formatarCentavosBRL,
  formatarPercentualUnidades,
  interpretarListaColada,
  montarRateioExatoPorValor,
  type CasamentoCC,
  type CentroCustoRef,
} from "@/lib/rateioExato";

/**
 * Card RATEIO-MASSA — colar a lista de centros de custo com VALOR em R$.
 *
 * A pessoa cola do Excel (ou digita) uma linha por centro de custo: nome ou código,
 * e o valor. O diálogo:
 *   - lê os valores em centavos (recusa, com a linha apontada, o que não souber ler);
 *   - casa os nomes com o cadastro — AUTOMÁTICO só quando o nome ou o código bate
 *     exatamente; o que for aproximado vira sugestão e ESPERA a escolha da pessoa;
 *   - mostra o percentual de cada linha, derivado pelo maior resto (soma 100,0000%);
 *   - só libera "Aplicar" quando tudo está casado e o total confere com o do item.
 *
 * Toda a matemática vive em `@/lib/rateioExato` (testada). Aqui é só tela.
 */

export interface LinhaRateioAplicada {
  codigo_centro_ctrl: string;
  centro_ctrl_label: string;
  centavos: number;
}

interface ColarRateioCCDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  centrosCusto: readonly CentroCustoRef[];
  /** Total que a lista precisa fechar, em centavos. `null` = sem conferência aqui. */
  totalEsperadoCentavos: number | null;
  /** Ex.: "15.02 — VIAGENS". Só para o título. */
  classeLabel?: string;
  onAplicar: (linhas: LinhaRateioAplicada[]) => void;
  /**
   * Quando o item tem quantidade 1, permite usar a soma da lista como valor do item
   * (o caso do serviço rateado). Ausente = o botão não aparece.
   */
  onUsarSomaComoValorDoItem?: (centavos: number) => void;
}

const EXEMPLO = `Almoxarifado/Expedição\tR$ 2.250,00
Corelab\tR$ 2.057,14
TI – Tecnologia da Informação\tR$ 900,00`;

const MOTIVO_IGNORADA: Record<"cabecalho" | "total" | "valor_zero", string> = {
  cabecalho: "cabeçalho",
  total: "linha de total",
  valor_zero: "valor zero",
};

export function ColarRateioCCDialog({
  open,
  onOpenChange,
  centrosCusto,
  totalEsperadoCentavos,
  classeLabel,
  onAplicar,
  onUsarSomaComoValorDoItem,
}: ColarRateioCCDialogProps) {
  const [texto, setTexto] = useState("");
  // Escolha manual por número da linha colada (para ambíguos e não encontrados).
  const [escolhas, setEscolhas] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!open) {
      setTexto("");
      setEscolhas({});
    }
  }, [open]);

  const porCodigo = useMemo(() => new Map(centrosCusto.map((c) => [c.erp_code, c])), [centrosCusto]);

  const leitura = useMemo(() => interpretarListaColada(texto), [texto]);

  const linhas = useMemo(
    () =>
      leitura.linhas.map((l) => {
        const casamento: CasamentoCC = casarCentroDeCusto(l, centrosCusto);
        const escolhido = escolhas[l.linha] ? porCodigo.get(escolhas[l.linha]) ?? null : null;
        const cc = casamento.tipo === "exato" ? casamento.cc : escolhido;
        return { ...l, casamento, cc };
      }),
    [leitura, centrosCusto, escolhas, porCodigo],
  );

  const pendentes = linhas.filter((l) => !l.cc).length;
  const totalColado = linhas.reduce((s, l) => s + l.centavos, 0);
  const diferenca = totalEsperadoCentavos === null ? 0 : totalColado - totalEsperadoCentavos;
  const linhaTotal = leitura.ignoradas.find((i) => i.motivo === "total");

  // Percentuais exatos (maior resto) sobre as linhas já casadas, consolidando CC repetido.
  const exato = useMemo(() => {
    const casadas = linhas.filter((l) => l.cc);
    if (casadas.length === 0 || pendentes > 0) return { rateio: null, erro: null as string | null };
    try {
      const rateio = montarRateioExatoPorValor([
        {
          codigo_classe_rec_desp: "_",
          ccs: casadas.map((l) => ({
            codigo_centro_ctrl: l.cc!.erp_code,
            centro_ctrl_label: l.cc!.name,
            centavos: l.centavos,
          })),
        },
      ]);
      return { rateio, erro: null };
    } catch (e) {
      return { rateio: null, erro: e instanceof Error ? e.message : String(e) };
    }
  }, [linhas, pendentes]);

  const unidadesPorCodigo = useMemo(() => {
    const m = new Map<string, { unidades: number; linhasOriginais: number }>();
    exato.rateio?.classes[0]?.ccs.forEach((cc) =>
      m.set(cc.codigo_centro_ctrl, { unidades: cc.unidades, linhasOriginais: cc.linhasOriginais }),
    );
    return m;
  }, [exato]);

  const podeAplicar =
    linhas.length > 0 &&
    leitura.erros.length === 0 &&
    pendentes === 0 &&
    diferenca === 0 &&
    exato.rateio !== null &&
    exato.erro === null;

  const aplicar = () => {
    if (!podeAplicar || !exato.rateio) return;
    onAplicar(
      exato.rateio.classes[0].ccs.map((cc) => ({
        codigo_centro_ctrl: cc.codigo_centro_ctrl,
        centro_ctrl_label: cc.centro_ctrl_label ?? porCodigo.get(cc.codigo_centro_ctrl)?.name ?? "",
        centavos: cc.centavos,
      })),
    );
    onOpenChange(false);
  };

  const escolher = (linha: number, codigo: string) => setEscolhas((prev) => ({ ...prev, [linha]: codigo }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardPaste className="h-4 w-4" />
            Colar rateio por valor{classeLabel ? ` — ${classeLabel}` : ""}
          </DialogTitle>
          <DialogDescription>
            Cole do Excel uma linha por centro de custo: o nome (ou o código) e o valor em R$. O valor de cada linha é o
            que vai para o ERP; o percentual é calculado para fechar exatamente 100,0000%.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            aria-label="Lista de centros de custo e valores"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={EXEMPLO}
            rows={7}
            className="font-mono text-xs"
          />

          {texto.trim() !== "" && (
            <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="resumo-colagem">
              <Badge variant="secondary">{linhas.length} linha{linhas.length === 1 ? "" : "s"}</Badge>
              <Badge variant="secondary">{linhas.length - pendentes} reconhecida{linhas.length - pendentes === 1 ? "" : "s"}</Badge>
              {pendentes > 0 && (
                <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">
                  {pendentes} para escolher
                </Badge>
              )}
              <span className="ml-auto font-mono">
                Colado: <strong>{formatarCentavosBRL(totalColado)}</strong>
                {totalEsperadoCentavos !== null && (
                  <>
                    {" "}· Item: <strong>{formatarCentavosBRL(totalEsperadoCentavos)}</strong>{" "}
                    {diferenca === 0 ? (
                      <span className="text-emerald-600">✓ confere</span>
                    ) : (
                      <span className="text-destructive">
                        diferença de {formatarCentavosBRL(Math.abs(diferenca))} {diferenca > 0 ? "a mais" : "a menos"}
                      </span>
                    )}
                  </>
                )}
              </span>
            </div>
          )}

          {totalEsperadoCentavos !== null && diferenca !== 0 && totalColado > 0 && onUsarSomaComoValorDoItem && (
            <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-2 text-xs">
              <span>
                O item está com {formatarCentavosBRL(totalEsperadoCentavos)}. Se a lista está certa, use a soma dela como
                valor do item.
              </span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onUsarSomaComoValorDoItem(totalColado)}>
                Usar {formatarCentavosBRL(totalColado)} como valor do item
              </Button>
            </div>
          )}

          {leitura.erros.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs space-y-1" role="alert">
              {leitura.erros.map((e) => (
                <p key={e.linha} className="flex items-start gap-1.5 text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    Linha {e.linha}: {e.erro} <span className="font-mono opacity-70">"{e.textoOriginal.trim()}"</span>
                  </span>
                </p>
              ))}
            </div>
          )}

          {leitura.ignoradas.length > 0 && (
            <div className="rounded-md bg-muted/50 p-2 text-xs space-y-0.5 text-muted-foreground">
              {leitura.ignoradas.map((i) => (
                <p key={i.linha} className="flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    Linha {i.linha} ignorada ({MOTIVO_IGNORADA[i.motivo]})
                    {i.motivo === "total" && i.centavos !== undefined && (
                      <>
                        : {formatarCentavosBRL(i.centavos)}{" "}
                        {i.centavos === totalColado ? (
                          <span className="text-emerald-600">— confere com a soma das linhas</span>
                        ) : (
                          <span className="text-destructive">
                            — NÃO confere com a soma das linhas ({formatarCentavosBRL(totalColado)})
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </p>
              ))}
            </div>
          )}

          {exato.erro && (
            <p className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive" role="alert">
              {exato.erro}
            </p>
          )}

          {linhas.length > 0 && (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium w-10">Linha</th>
                    <th className="px-2 py-1.5 text-left font-medium">Colado</th>
                    <th className="px-2 py-1.5 text-left font-medium">Centro de custo no Alvo</th>
                    <th className="px-2 py-1.5 text-right font-medium">Valor</th>
                    <th className="px-2 py-1.5 text-right font-medium">%</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => {
                    const pct = l.cc ? unidadesPorCodigo.get(l.cc.erp_code) : undefined;
                    const sugestoes = l.casamento.tipo === "exato" ? [] : l.casamento.sugestoes;
                    return (
                      <tr key={l.linha} className={cn("border-t align-top", !l.cc && "bg-amber-500/5")}>
                        <td className="px-2 py-1.5 font-mono text-muted-foreground">{l.linha}</td>
                        <td className="px-2 py-1.5">{l.nome || <span className="font-mono">{l.codigo}</span>}</td>
                        <td className="px-2 py-1.5">
                          {l.casamento.tipo === "exato" ? (
                            <span className="flex items-center gap-1">
                              <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                              <span className="font-mono text-muted-foreground">{l.casamento.cc.erp_code}</span>
                              <span>{l.casamento.cc.name}</span>
                            </span>
                          ) : (
                            <div className="space-y-1">
                              {l.cc ? (
                                <span className="flex items-center gap-1">
                                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                  <span className="font-mono text-muted-foreground">{l.cc.erp_code}</span>
                                  <span>{l.cc.name}</span>
                                  <span className="text-muted-foreground">(escolhido)</span>
                                </span>
                              ) : (
                                <span className="text-amber-700 dark:text-amber-400">
                                  {l.casamento.tipo === "ambiguo" ? "Não bateu exato — escolha:" : "Não encontrado — escolha:"}
                                </span>
                              )}
                              <div className="flex flex-wrap gap-1">
                                {sugestoes.slice(0, 3).map((s) => (
                                  <Button
                                    key={s.erp_code}
                                    type="button"
                                    size="sm"
                                    variant={l.cc?.erp_code === s.erp_code ? "default" : "outline"}
                                    className="h-6 px-2 text-[11px]"
                                    onClick={() => escolher(l.linha, s.erp_code)}
                                  >
                                    {s.name}
                                  </Button>
                                ))}
                              </div>
                              <Select value={escolhas[l.linha] ?? ""} onValueChange={(v) => escolher(l.linha, v)}>
                                <SelectTrigger className="h-7 text-[11px]" aria-label={`Centro de custo da linha ${l.linha}`}>
                                  <SelectValue placeholder="Outro centro de custo…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {centrosCusto.map((c) => (
                                    <SelectItem key={c.erp_code} value={c.erp_code} className="text-xs">
                                      {c.erp_code} — {c.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">{formatarCentavosBRL(l.centavos)}</td>
                        <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap">
                          {pct ? formatarPercentualUnidades(pct.unidades) : "—"}
                          {pct && pct.linhasOriginais > 1 && (
                            <span className="block text-[10px] text-amber-700 dark:text-amber-400">
                              CC repetido: {pct.linhasOriginais} linhas somadas
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {exato.rateio && (
                  <tfoot className="border-t bg-muted/30 font-medium">
                    <tr>
                      <td className="px-2 py-1.5" colSpan={3}>
                        Total ({exato.rateio.classes[0].ccs.length} centro{exato.rateio.classes[0].ccs.length === 1 ? "" : "s"} de custo)
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{formatarCentavosBRL(exato.rateio.totalCentavos)}</td>
                      <td className="px-2 py-1.5 text-right font-mono" data-testid="soma-percentual">
                        {formatarPercentualUnidades(
                          exato.rateio.classes[0].ccs.reduce((s, c) => s + c.unidades, 0),
                        )}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={aplicar} disabled={!podeAplicar}>
            {exato.rateio
              ? `Aplicar ${exato.rateio.classes[0].ccs.length} centro${exato.rateio.classes[0].ccs.length === 1 ? "" : "s"} de custo`
              : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
