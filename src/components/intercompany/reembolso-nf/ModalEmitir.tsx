/**
 * Modal de emissão de invoice da Frente 3.
 *
 * Sandra preenche:
 *   - Número da invoice (auto-sugerido via RPC sugerir_proximo_numero_invoice, editável)
 *   - Câmbio EUR→BRL
 *   - Data de emissão (default hoje, editável)
 *   - Descrição rica (textarea, vai pro campo Observacao do DocFin Alvo)
 *
 * Preview calculado:
 *   - Total BRL (da cesta)
 *   - Total EUR (Total BRL ÷ câmbio)
 *   - Quantidade de itens
 *
 * Ao confirmar:
 *   - Chama useEmitirInvoice → POST /intercompany/reembolso-nf/emit
 *   - Sucesso: vira TELA DE SUCESSO dentro do modal, com botão "Baixar PDF"
 *     e "Ir para o Master" (operador controla quando sair — sem redirect automático)
 *   - Erro "alvo_orfao": abre ModalOrfao com chave_orfa
 *   - Outros erros: toast vermelho, modal permanece aberto pra retry
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, CheckCircle2, Download, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useEmitirInvoice } from "@/hooks/useReembolsoNf";
import { ReembolsoNfError, friendlyErrorMessage } from "@/services/intercompanyReembolsoNfService";
import { buscarSugestaoNumero } from "@/services/intercompanyMasterService";
import { downloadIntercompanyPdf } from "@/utils/downloadIntercompanyPdf";
import type { RascunhoDetails, SugestaoNumeroInvoice } from "@/types/intercompanyReembolsoNf";
import { ModalOrfao } from "./ModalOrfao";

const formatBRL = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatEUR = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "EUR" });

const hojeISO = () => new Date().toISOString().slice(0, 10);

interface ModalEmitirProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rascunho: RascunhoDetails;
}

export function ModalEmitir({ open, onOpenChange, rascunho }: ModalEmitirProps) {
  const navigate = useNavigate();
  const emitirMutation = useEmitirInvoice();

  // ─── State do form ───
  const [numeroInvoice, setNumeroInvoice] = useState("");
  const [cambioStr, setCambioStr] = useState("");
  const [dataEmissao, setDataEmissao] = useState(hojeISO());
  const [descricaoRica, setDescricaoRica] = useState("");

  // ─── Sugestão de número ───
  const [sugestao, setSugestao] = useState<SugestaoNumeroInvoice | null>(null);
  const [loadingSugestao, setLoadingSugestao] = useState(false);

  // ─── Modal Orfão (erro tardio) ───
  const [orfaoChave, setOrfaoChave] = useState<number | null>(null);

  // ─── Sucesso: guarda o resultado pra mostrar tela de download ───
  const [sucessoResult, setSucessoResult] = useState<{
    numero_invoice: string;
    chave_alvo?: number;
    storage_path?: string | null;
  } | null>(null);

  // Carrega sugestão quando o modal abre
  useEffect(() => {
    if (!open) return;
    setLoadingSugestao(true);
    buscarSugestaoNumero()
      .then((s) => {
        setSugestao(s);
        if (!numeroInvoice && s?.sugestao) setNumeroInvoice(s.sugestao);
      })
      .catch(() => {
        // Silencioso — Sandra pode digitar manualmente
      })
      .finally(() => setLoadingSugestao(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset ao fechar (mas só se NÃO foi sucesso — sucesso já navega pra fora)
  useEffect(() => {
    if (!open && emitirMutation.isIdle) {
      setCambioStr("");
      setDataEmissao(hojeISO());
      setDescricaoRica("");
      setSucessoResult(null);
      emitirMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ─── Cálculos ───
  const cambioNum = parseFloat(cambioStr.replace(",", ".")) || 0;
  const totalEur = useMemo(
    () => (cambioNum > 0 ? +(rascunho.total_brl / cambioNum).toFixed(2) : 0),
    [cambioNum, rascunho.total_brl],
  );

  // ─── Validações ───
  const numeroValido = /^\d{3,4}\/\d{4}$/.test(numeroInvoice.trim());
  const cambioValido = cambioNum > 0;
  const dataValida = !!dataEmissao;
  const descricaoValida = descricaoRica.trim().length > 0;
  const formValido = numeroValido && cambioValido && dataValida && descricaoValida;

  // ─── Handler de emissão ───
  const handleEmitir = async () => {
    if (!formValido) return;
    try {
      const result = await emitirMutation.mutateAsync({
        numero_invoice: numeroInvoice.trim(),
        cambio_eur_brl: cambioNum,
        data_emissao: dataEmissao,
        descricao_rica: descricaoRica.trim(),
      });

      if (result.success && result.master) {
        toast({
          title: `Invoice ${result.master.numero_invoice} emitida com sucesso!`,
          description: `Chave Alvo: ${result.master.chave_docfin_alvo} · ${result.master.blocos_criados} blocos · ${formatEUR(result.master.valor_eur_total)}`,
        });
        setSucessoResult({
          numero_invoice: result.master.numero_invoice,
          chave_alvo: result.master.chave_docfin_alvo,
          storage_path: result.pdf_status?.storage_path ?? null,
        });
        // NÃO fecha o modal nem redireciona — vira tela de sucesso com download
      }
    } catch (err) {
      // Erro tardio (alvo orfão): abre modal crítico
      if (err instanceof ReembolsoNfError && err.kind === "alvo_orfao") {
        const chave = err.details?.chave_orfa;
        if (chave) {
          setOrfaoChave(chave);
          onOpenChange(false); // fecha modal emitir
        } else {
          toast({
            title: "Erro tardio",
            description: friendlyErrorMessage(err),
            variant: "destructive",
          });
        }
        return;
      }
      // Outros erros: toast e modal permanece aberto
      toast({
        title: "Falha ao emitir invoice",
        description: friendlyErrorMessage(err),
        variant: "destructive",
      });
    }
  };

  // ─── Handler de download do PDF ───
  const handleDownloadPdf = async () => {
    if (!sucessoResult?.storage_path) return;
    const ok = await downloadIntercompanyPdf(
      "intercompany-reembolso-nf",
      sucessoResult.storage_path,
      `INV ${sucessoResult.numero_invoice.replace("/", ".")} - PF GMBH - RE.pdf`,
    );
    if (!ok) {
      toast({
        title: "Não foi possível baixar o PDF",
        description: "O arquivo pode não estar disponível. Tente pela tela de invoices.",
        variant: "destructive",
      });
    }
  };

  // ─── Fecha a tela de sucesso e vai pro Master ───
  const handleFecharSucesso = () => {
    setSucessoResult(null);
    onOpenChange(false);
    navigate("/intercompany/master");
  };

  const isPending = emitirMutation.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !isPending && !sucessoResult && onOpenChange(v)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{sucessoResult ? "Invoice emitida" : "Emitir Invoice no Alvo"}</DialogTitle>
            <DialogDescription>
              {sucessoResult
                ? "A invoice foi registrada no Alvo e no Hub."
                : `${rascunho.total_itens} ${rascunho.total_itens === 1 ? "item" : "itens"} · Total ${formatBRL(rascunho.total_brl)}`}
            </DialogDescription>
          </DialogHeader>

          {sucessoResult ? (
            /* ═══════════ TELA DE SUCESSO ═══════════ */
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-emerald-600">
                    Invoice {sucessoResult.numero_invoice} emitida com sucesso!
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Chave Alvo: <span className="font-mono">{sucessoResult.chave_alvo}</span>
                  </p>
                  {!sucessoResult.storage_path && (
                    <p className="text-xs text-amber-600 mt-2">
                      O PDF não está disponível para download (a geração pode ter falhado). A invoice foi emitida
                      normalmente no Alvo.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                {sucessoResult.storage_path && (
                  <Button variant="outline" onClick={handleDownloadPdf}>
                    <Download className="mr-1.5 h-4 w-4" />
                    Baixar PDF
                  </Button>
                )}
                <Button onClick={handleFecharSucesso} className="ml-auto">
                  Ir para o Master
                </Button>
              </div>
            </div>
          ) : (
            /* ═══════════ FORM DE EMISSÃO ═══════════ */
            <div className="space-y-4">
              {/* Sugestão de número */}
              {sugestao && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-primary/5 border border-primary/20 rounded p-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span>
                    Sugestão: <span className="font-mono font-semibold">{sugestao.sugestao}</span> · Maior sequencial em{" "}
                    {sugestao.ano}: {sugestao.maior_sequencial}
                  </span>
                </div>
              )}

              {/* Linha 1: Número + Data */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="numero-inv" className="text-xs">
                    Número da Invoice *
                  </Label>
                  <Input
                    id="numero-inv"
                    value={numeroInvoice}
                    onChange={(e) => setNumeroInvoice(e.target.value)}
                    placeholder={loadingSugestao ? "Carregando..." : "Ex: 132/2026"}
                    className="font-mono"
                    disabled={isPending}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Formato NNN/AAAA</p>
                </div>
                <div>
                  <Label htmlFor="data-emissao" className="text-xs">
                    Data de emissão *
                  </Label>
                  <Input
                    id="data-emissao"
                    type="date"
                    value={dataEmissao}
                    onChange={(e) => setDataEmissao(e.target.value)}
                    disabled={isPending}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Vencimento = data + 14 dias</p>
                </div>
              </div>

              {/* Linha 2: Câmbio + Preview EUR */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="cambio" className="text-xs">
                    Câmbio EUR → BRL *
                  </Label>
                  <Input
                    id="cambio"
                    type="text"
                    inputMode="decimal"
                    value={cambioStr}
                    onChange={(e) => setCambioStr(e.target.value)}
                    placeholder="Ex: 6.10"
                    disabled={isPending}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">PTAX dia anterior</p>
                </div>
                <div>
                  <Label className="text-xs">Total em EUR (calculado)</Label>
                  <div className="h-10 px-3 flex items-center rounded-md border border-input bg-muted/50 text-sm font-mono font-semibold">
                    {totalEur > 0 ? formatEUR(totalEur) : "—"}
                  </div>
                  {totalEur > 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {formatBRL(rascunho.total_brl)} ÷ {cambioStr.replace(".", ",")}
                    </p>
                  )}
                </div>
              </div>

              {/* Descrição */}
              <div>
                <Label htmlFor="descricao" className="text-xs">
                  Descrição (Observação no DocFin Alvo) *
                </Label>
                <Textarea
                  id="descricao"
                  value={descricaoRica}
                  onChange={(e) => setDescricaoRica(e.target.value)}
                  placeholder="Ex: Reembolso de despesas - matéria-prima BioCollagen mar/2026"
                  rows={3}
                  disabled={isPending}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Texto que vai pro campo Observação do DocFin Alvo. Seja descritivo.
                </p>
              </div>

              {/* Aviso de validação */}
              {!formValido && (numeroInvoice || cambioStr || descricaoRica) && (
                <div className="flex items-start gap-2 text-xs text-amber-600 bg-amber-500/5 border border-amber-500/20 rounded p-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    {!numeroValido && <p>Número deve estar no formato NNN/AAAA (ex: 132/2026)</p>}
                    {!cambioValido && <p>Câmbio deve ser maior que zero</p>}
                    {!dataValida && <p>Selecione a data de emissão</p>}
                    {!descricaoValida && <p>Preencha a descrição</p>}
                  </div>
                </div>
              )}
            </div>
          )}

          {!sucessoResult && (
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                Cancelar
              </Button>
              <Button onClick={handleEmitir} disabled={!formValido || isPending} className="min-w-[160px]">
                {isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Emitindo no Alvo...
                  </>
                ) : (
                  <>
                    <Send className="mr-1.5 h-4 w-4" />
                    Emitir Invoice
                  </>
                )}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal crítico de órfão (se rolar) */}
      <ModalOrfao
        open={orfaoChave !== null}
        chaveOrfa={orfaoChave}
        numeroInvoice={numeroInvoice}
        onClose={() => setOrfaoChave(null)}
      />
    </>
  );
}
