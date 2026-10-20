/**
 * Detalhe de uma NFS-e recebida em 6 etapas (esquema do Pedro, 20/10/2026):
 *   1 Nota fiscal · 2 Pedidos · 3 MovEstq · 4 PDF da nota · 5 PDF do boleto · 6 DocFin
 *
 * Fonte: RPC `nfse_recebida_detalhe` (NFSE-1.11), carregada quando a linha abre. Anexos: buckets privados
 * `nfse-nf-pdf` / `nfse-boleto-pdf` + RPCs `nfse_anexo_registrar` / `nfse_anexo_remover` (NFSE-1.10).
 *
 * Eixos sempre com nome (PLANO-NFSE D6): "No fisco" é o ADN; "No Alvo" são os espelhos do Alvo
 * (MovEstq em rastreio_nf, títulos em fin_parcelas_pagar) — com o horário da última leitura à vista.
 */
import { Fragment, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileText,
  Loader2,
  Paperclip,
  PackageCheck,
  Receipt,
  RefreshCw,
  ScanLine,
  Send,
  ShoppingCart,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  anexarPdfNfse,
  buscarDetalheNfse,
  lerBoletoNfse,
  linkAnexoNfse,
  removerAnexoNfse,
  type AnexoNfse,
  type BoletoConferidoIA,
  type DetalheNfse,
  type LeituraBoletoIA,
  type NfseRecebida,
  type ParcelaDocFin,
  type PedidoCandidato,
  type TipoAnexoNfse,
} from "@/services/nfseRecebidasService";
import { formatBytes, formatCurrency, formatDate, formatDoc, formatInstanteBrt, hojeBrt } from "./nfseFormatos";

// ════════════════════════════════════════════════════════════
// ESTADO DE CADA ETAPA
// ════════════════════════════════════════════════════════════
type EstadoEtapa = "feito" | "pendente" | "atencao" | "na";

const ESTADO: Record<EstadoEtapa, { rotulo: string; barra: string; chip: string; circulo: string; linha: string }> = {
  feito: {
    rotulo: "Concluída",
    barra: "bg-emerald-600",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
    circulo: "border-emerald-600 bg-emerald-600 text-white",
    linha: "bg-emerald-600",
  },
  pendente: {
    rotulo: "Pendente",
    barra: "bg-amber-500",
    chip: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
    circulo: "border-amber-500 bg-background text-amber-700 dark:text-amber-300",
    linha: "bg-border",
  },
  atencao: {
    rotulo: "Atenção",
    barra: "bg-rose-600",
    chip: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300",
    circulo: "border-rose-600 bg-rose-600 text-white",
    linha: "bg-border",
  },
  na: {
    rotulo: "Sem dado",
    barra: "bg-border",
    chip: "border-border bg-muted text-muted-foreground",
    circulo: "border-border bg-background text-muted-foreground",
    linha: "bg-border",
  },
};

const ESTILO_FORCA: Record<PedidoCandidato["forca"], string> = {
  1: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  2: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300",
  3: "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-300",
  4: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
};
const ROTULO_FORCA: Record<PedidoCandidato["forca"], string> = {
  1: "Citado na nota",
  2: "Saldo ±20%",
  3: "Contrato recorrente",
  4: "Valor ±20%",
};

// ════════════════════════════════════════════════════════════
// PEÇAS DE LAYOUT
// ════════════════════════════════════════════════════════════
function Campo({ label, valor, mono }: { label: string; valor: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 truncate text-right font-medium text-foreground", mono && "tabular-nums")}>
        {valor ?? "—"}
      </span>
    </div>
  );
}

type Etiqueta = { texto: string; alerta?: boolean } | false | null | undefined | "";

/** Linha de etiquetas "a · b · c" em texto corrido: ao quebrar, o "·" fica no fim da linha, não no começo. */
function Etiquetas({ itens }: { itens: Etiqueta[] }) {
  const lista = itens.filter(Boolean) as { texto: string; alerta?: boolean }[];
  if (lista.length === 0) return null;
  return (
    <p className="pt-0.5 text-[10px] leading-snug text-muted-foreground">
      {lista.map((e, i) => (
        <Fragment key={e.texto}>
          <span className={e.alerta ? "text-amber-700 dark:text-amber-300" : undefined}>{e.texto}</span>
          {i < lista.length - 1 && "\u00a0· "}
        </Fragment>
      ))}
    </p>
  );
}

function Coluna({
  n,
  titulo,
  icone,
  estado,
  resumo,
  rodape,
  colRef,
  children,
}: {
  n: number;
  titulo: string;
  icone: ReactNode;
  estado: EstadoEtapa;
  resumo: string;
  rodape?: ReactNode;
  colRef: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  const e = ESTADO[estado];
  return (
    <section
      ref={colRef}
      className="flex min-h-[300px] flex-col overflow-hidden rounded-md border border-border bg-background shadow-sm"
    >
      <div className={cn("h-1 shrink-0", e.barra)} />
      <header className="flex flex-col gap-1 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold",
              e.circulo,
            )}
          >
            {n}
          </span>
          <span className="text-muted-foreground">{icone}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{titulo}</span>
          <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium", e.chip)}>{e.rotulo}</span>
        </div>
        <p className="line-clamp-2 pl-8 text-[11px] leading-snug text-muted-foreground" title={resumo}>
          {resumo}
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-1.5 p-3 text-xs">{children}</div>
      {rodape && <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-3 py-2">{rodape}</footer>}
    </section>
  );
}

/**
 * Largura visível da área que rola a tabela (o detalhe fica preso nela, `sticky left-0`) — ou a do próprio
 * bloco, fora de tabela. As colunas se ajustam a ela, nunca o contrário: com largura mínima por coluna, as 6
 * juntas alargavam a tabela e a página inteira passava da tela (20/10/2026).
 */
function useLarguraVisivel(ref: RefObject<HTMLElement>) {
  const [medida, setMedida] = useState({ largura: 0, presa: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let rolador = el.parentElement;
    while (rolador && !/(auto|scroll)/.test(getComputedStyle(rolador).overflowX)) rolador = rolador.parentElement;
    const alvo = rolador ?? el;
    const medir = () => setMedida({ largura: alvo.clientWidth, presa: rolador !== null });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(alvo);
    return () => ro.disconnect();
  }, [ref]);
  return medida;
}

const LARGURA_MIN_COLUNA = 230;
const VAO = 12;

/** 6 lado a lado quando cabem; senão 3 + 3, 2 + 2 + 2 ou uma embaixo da outra — sem rolagem para o lado. */
function colunasPorLinha(largura: number) {
  if (!largura) return 3;
  const util = largura - 32; // p-4
  return [6, 3, 2].find((n) => n * LARGURA_MIN_COLUNA + (n - 1) * VAO <= util) ?? 1;
}

/** Régua das 6 etapas: mostra o andamento e leva até a coluna ao clicar. */
function Regua({ etapas, onIr }: { etapas: { titulo: string; estado: EstadoEtapa }[]; onIr: (i: number) => void }) {
  return (
    <ol className="flex items-center overflow-x-auto rounded-md border border-border bg-background px-3 py-2">
      {etapas.map((et, i) => (
        <li key={et.titulo} className="flex min-w-0 flex-1 items-center">
          <button
            type="button"
            onClick={() => onIr(i)}
            className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted/60"
            title={`${i + 1}. ${et.titulo} — ${ESTADO[et.estado].rotulo}`}
          >
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-semibold",
                ESTADO[et.estado].circulo,
              )}
            >
              {i + 1}
            </span>
            <span className="truncate text-[11px] font-medium text-foreground">{et.titulo}</span>
          </button>
          {i < etapas.length - 1 && <span className={cn("mx-2 h-0.5 min-w-4 flex-1 rounded", ESTADO[et.estado].linha)} />}
        </li>
      ))}
    </ol>
  );
}

/** Chave do MovEstq no Alvo em destaque, com cópia — é por ela que se acha o lançamento no Alvo. */
function ChaveMovEstq({ chave }: { chave: number }) {
  const { toast } = useToast();
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(String(chave));
      toast({ title: "Chave do MovEstq copiada", description: String(chave) });
    } catch {
      toast({ title: "Não foi possível copiar", description: String(chave), variant: "destructive" });
    }
  };
  return (
    <div className="mb-1 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-[10px] text-muted-foreground">Chave do MovEstq no Alvo</span>
        <span className="text-base font-semibold tabular-nums text-foreground">{chave}</span>
      </div>
      <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-[11px]" onClick={copiar} title="Copiar a chave">
        <Copy className="h-3 w-3" /> Copiar
      </Button>
    </div>
  );
}

const emitidaHa = (dias: number) => (dias <= 0 ? "emitida hoje" : dias === 1 ? "emitida há 1 dia" : `emitida há ${dias} dias`);

function Aviso({ children, tom = "neutro" }: { children: ReactNode; tom?: "neutro" | "atencao" }) {
  return (
    <p
      className={cn(
        "rounded border px-2 py-1.5 text-[11px] leading-snug",
        tom === "atencao"
          ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          : "border-border bg-muted/40 text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

// ════════════════════════════════════════════════════════════
// ETAPA 2 — CANDIDATO A PEDIDO
// ════════════════════════════════════════════════════════════
function CartaoCandidato({ c, destaque }: { c: PedidoCandidato; destaque?: boolean }) {
  const pct = Number(c.diferenca_pct);
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border border-dashed p-2",
        destaque ? "border-sky-300 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tabular-nums">Pedido {c.numero}</span>
        <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-medium", ESTILO_FORCA[c.forca])} title={c.motivo}>
          {ROTULO_FORCA[c.forca]}
        </Badge>
      </div>
      <Campo label="Pedido em" valor={formatDate(c.data_pedido)} />
      <Campo label="Valor do pedido" valor={formatCurrency(c.valor_pedido)} mono />
      <Campo label="Saldo" valor={formatCurrency(c.saldo)} mono />
      <Campo
        label="Diferença"
        valor={`${pct > 0 ? "+" : ""}${pct.toLocaleString("pt-BR")}%`}
        mono
      />
      <Etiquetas
        itens={[
          c.natureza && { texto: c.natureza },
          c.status && { texto: c.status },
          c.nfs_ligadas > 0 && { texto: `${c.nfs_ligadas} NF(s) já ligada(s)` },
          c.so_raiz_cnpj && { texto: "CNPJ de outra filial", alerta: true },
        ]}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ETAPAS 4 e 5 — ANEXO EM PDF
// ════════════════════════════════════════════════════════════
function AreaAnexo({
  chave,
  tipo,
  anexo,
  onMudou,
}: {
  chave: string;
  tipo: TipoAnexoNfse;
  anexo: AnexoNfse | undefined;
  onMudou: () => void;
}) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  const nomeTipo = tipo === "nf" ? "PDF da nota" : "PDF do boleto";

  const enviar = async (arquivo: File | undefined) => {
    if (!arquivo) return;
    setEnviando(true);
    try {
      await anexarPdfNfse(chave, tipo, arquivo);
      toast({ title: anexo ? `${nomeTipo} trocado` : `${nomeTipo} anexado`, description: arquivo.name });
      onMudou();
    } catch (e) {
      toast({ title: "Não foi possível anexar", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setEnviando(false);
      if (input.current) input.current.value = "";
    }
  };

  const abrir = async () => {
    if (!anexo) return;
    try {
      window.open(await linkAnexoNfse(anexo), "_blank", "noopener,noreferrer");
    } catch (e) {
      toast({ title: "Não foi possível abrir", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const remover = async () => {
    if (!anexo) return;
    try {
      await removerAnexoNfse(anexo.id);
      toast({ title: `${nomeTipo} removido` });
      onMudou();
    } catch (e) {
      toast({ title: "Não foi possível remover", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => enviar(e.target.files?.[0])}
      />
      {anexo ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2">
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-rose-700 dark:text-rose-300" />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium" title={anexo.nome_original}>
                {anexo.nome_original}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {formatBytes(anexo.tamanho_bytes)} · {formatInstanteBrt(anexo.enviado_em)}
              </p>
              {anexo.enviado_por && <p className="truncate text-[11px] text-muted-foreground">por {anexo.enviado_por}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={abrir}>
              <Eye className="h-3 w-3" /> Abrir
            </Button>
            <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={enviando} onClick={() => input.current?.click()}>
              {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Trocar
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => setConfirmarRemocao(true)}>
              <Trash2 className="h-3 w-3" /> Remover
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={enviando}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            enviar(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1.5 rounded-md border-2 border-dashed px-3 py-6 text-center transition-colors",
            arrastando ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40 hover:bg-muted/40",
          )}
        >
          {enviando ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="h-5 w-5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-foreground">{enviando ? "Enviando..." : `Anexar ${nomeTipo}`}</span>
          <span className="text-[11px] text-muted-foreground">Arraste o arquivo ou clique · PDF até 10 MB</span>
        </button>
      )}

      <AlertDialog open={confirmarRemocao} onOpenChange={setConfirmarRemocao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover o {nomeTipo}?</AlertDialogTitle>
            <AlertDialogDescription>
              O anexo sai desta nota. O arquivo fica guardado no histórico do Hub.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={remover}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ════════════════════════════════════════════════════════════
// ETAPA 5 — LEITURA DO BOLETO PELA IA (teste da Fase B: só lê, não salva nada)
// ════════════════════════════════════════════════════════════
const ROTULO_BENEFICIARIO: Record<BoletoConferidoIA["confere"]["beneficiario"], { texto: string; ok: boolean | null }> = {
  igual_prestador: { texto: "Beneficiário = prestador", ok: true },
  mesma_raiz: { texto: "Beneficiário: mesma raiz do prestador", ok: true },
  diferente: { texto: "Beneficiário DIFERENTE do prestador", ok: false },
  sem_dado: { texto: "Beneficiário sem conferência", ok: null },
};

function Selo({ ok, children }: { ok: boolean | null; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium",
        ok === true && ESTADO.feito.chip,
        ok === false && ESTADO.atencao.chip,
        ok === null && ESTADO.na.chip,
      )}
    >
      {ok === true ? <CheckCircle2 className="h-3 w-3" /> : ok === false ? <XCircle className="h-3 w-3" /> : null}
      {children}
    </span>
  );
}

function CartaoBoletoLido({ b, indice, total }: { b: BoletoConferidoIA; indice: number; total: number }) {
  const { toast } = useToast();
  const c = b.conferencia;
  const linha = c.linha_formatada ?? b.lido.linha_digitavel;
  const benef = ROTULO_BENEFICIARIO[b.confere.beneficiario];
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(c.linha || linha);
      toast({ title: "Linha digitável copiada" });
    } catch {
      toast({ title: "Não foi possível copiar", variant: "destructive" });
    }
  };
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md border p-2",
        b.perfeita ? "border-emerald-300 dark:border-emerald-800" : "border-rose-300 dark:border-rose-800",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold">
          {total > 1 ? `Boleto ${indice + 1} de ${total}` : "Boleto"}
          {c.banco ? ` · banco ${c.banco}` : ""}
        </span>
        <Selo ok={b.perfeita}>{b.perfeita ? "Linha perfeita" : "Revisar"}</Selo>
      </div>
      <div className="flex items-start gap-1">
        <code className="min-w-0 flex-1 break-all rounded bg-muted/50 px-1.5 py-1 font-mono text-[11px] leading-relaxed">{linha}</code>
        <Button variant="ghost" size="sm" className="h-6 shrink-0 px-1.5" onClick={copiar} title="Copiar a linha digitável">
          <Copy className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        <Selo ok={c.valida}>{c.valida ? "Dígitos verificadores ok" : "Dígito verificador falhou"}</Selo>
        <Selo ok={b.confere.valor}>Valor {formatCurrency(c.valor)}</Selo>
        {c.tipo === "bancario" && <Selo ok={b.confere.vencimento}>Vence {formatDate(c.vencimento)}</Selo>}
        <Selo ok={b.confere.pagador_pf}>Pagador P&amp;F</Selo>
        <Selo ok={benef.ok}>{benef.texto}</Selo>
      </div>
      {c.erros.length > 0 && <p className="text-[10px] text-rose-700 dark:text-rose-300">{c.erros.join(" · ")}</p>}
      {!b.lido.linha_legivel && <p className="text-[10px] text-rose-700 dark:text-rose-300">A IA marcou dígito ilegível.</p>}
      <div className="text-[10px] leading-snug text-muted-foreground">
        {b.lido.beneficiario_nome ?? "—"} · {formatDoc(b.lido.beneficiario_cnpj)}
        {b.lido.numero_documento ? ` · doc. ${b.lido.numero_documento}` : ""}
        {b.lido.nosso_numero ? ` · nosso nº ${b.lido.nosso_numero}` : ""}
        {b.confere.valor === false && ` · impresso ${formatCurrency(b.lido.valor_documento)}`}
        {b.confere.vencimento === false && ` · vencimento impresso ${formatDate(b.lido.vencimento)}`}
      </div>
    </div>
  );
}

/** Botões "Ler linha digitável" (boleto anexado) e "Testar outro PDF" (não salva), e o resultado. */
function LeituraBoleto({ anexo }: { anexo: AnexoNfse | undefined }) {
  const input = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState<"anexo" | "teste" | null>(null);
  const [resultado, setResultado] = useState<{ origem: string; leitura: LeituraBoletoIA } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const ler = async (entrada: { anexo: AnexoNfse } | { arquivo: File }) => {
    const origem = "anexo" in entrada ? entrada.anexo.nome_original : entrada.arquivo.name;
    setLendo("anexo" in entrada ? "anexo" : "teste");
    setErro(null);
    setResultado(null);
    try {
      setResultado({ origem, leitura: await lerBoletoNfse(entrada) });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setLendo(null);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-dashed border-border pt-2">
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) ler({ arquivo: f });
        }}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {anexo && (
          <Button size="sm" className="h-7 gap-1 text-xs" disabled={lendo !== null} onClick={() => ler({ anexo })}>
            {lendo === "anexo" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanLine className="h-3 w-3" />} Ler linha digitável
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-[11px] text-muted-foreground"
          disabled={lendo !== null}
          onClick={() => input.current?.click()}
          title="Lê um PDF qualquer sem anexar à nota"
        >
          {lendo === "teste" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Testar outro PDF (não salva)
        </Button>
      </div>
      {lendo && <p className="text-[11px] text-muted-foreground">Lendo com IA e conferindo os dígitos… leva alguns segundos.</p>}
      {erro && <Aviso tom="atencao">Leitura falhou: {erro}</Aviso>}
      {resultado && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{resultado.origem}</span> ·{" "}
            {resultado.leitura.boletos.length === 0
              ? "nenhuma linha digitável encontrada"
              : `${resultado.leitura.boletos.length} boleto(s) · ${resultado.leitura.todas_perfeitas ? "todas as linhas perfeitas" : "revisar"}`}
          </p>
          {resultado.leitura.boletos.map((b, i) => (
            <CartaoBoletoLido key={b.conferencia.linha || i} b={b} indice={i} total={resultado.leitura.boletos.length} />
          ))}
          <p className="text-[10px] text-muted-foreground">
            Teste — nada foi salvo. {resultado.leitura.uso.modelo_usado ?? resultado.leitura.uso.modelo_solicitado} ·{" "}
            {resultado.leitura.uso.input_tokens ?? "?"}+{resultado.leitura.uso.output_tokens ?? "?"} tokens ·{" "}
            {(resultado.leitura.uso.duracao_ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s
          </p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// ETAPA 6 — PARCELA DO DOCFIN
// ════════════════════════════════════════════════════════════
const ROTULO_CLASSE: Record<string, { rotulo: string; estilo: string }> = {
  pago: { rotulo: "Pago", estilo: ESTADO.feito.chip },
  quitado_adto: { rotulo: "Quitado por adiantamento", estilo: ESTADO.feito.chip },
  baixa_sem_mov: { rotulo: "Baixado sem movimento bancário", estilo: ESTADO.na.chip },
  agrupado: { rotulo: "Agrupado em fatura", estilo: ESTADO.na.chip },
  aberto: { rotulo: "Em aberto", estilo: ESTADO.pendente.chip },
};

function parcelaPaga(p: ParcelaDocFin) {
  return p.classe_pagamento === "pago" || p.classe_pagamento === "quitado_adto";
}

function parcelaVencida(p: ParcelaDocFin, hoje: string) {
  const limite = p.data_prorrogacao || p.data_vencimento;
  return !parcelaPaga(p) && p.classe_pagamento === "aberto" && !!limite && limite < hoje;
}

function LinhaParcela({ p, total, hoje }: { p: ParcelaDocFin; total: number; hoje: string }) {
  const classe = ROTULO_CLASSE[p.classe_pagamento ?? ""] ?? { rotulo: p.situacao ?? "—", estilo: ESTADO.na.chip };
  const vencida = parcelaVencida(p, hoje);
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">
          Parcela {p.sequencia ?? "?"}
          {total > 1 ? `/${total}` : ""}
        </span>
        <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium", vencida ? ESTADO.atencao.chip : classe.estilo)}>
          {vencida ? "Vencida" : classe.rotulo}
        </span>
      </div>
      <Campo label="Valor" valor={formatCurrency(p.valor_original)} mono />
      <Campo label="Vencimento" valor={formatDate(p.data_vencimento)} />
      {p.data_prorrogacao && p.data_prorrogacao !== p.data_vencimento && (
        <Campo label="Prorrogação" valor={formatDate(p.data_prorrogacao)} />
      )}
      {p.data_pagamento && <Campo label="Pagamento" valor={formatDate(p.data_pagamento)} />}
      {!!p.valor_pago && p.valor_pago !== p.valor_original && <Campo label="Valor pago" valor={formatCurrency(p.valor_pago)} mono />}
      {(!!p.valor_juros || !!p.valor_multa) && (
        <Campo label="Juros + multa" valor={formatCurrency((p.valor_juros ?? 0) + (p.valor_multa ?? 0))} mono />
      )}
      {p.tipo_cobranca && <Campo label="Cobrança" valor={p.tipo_cobranca} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// COMPONENTE
// ════════════════════════════════════════════════════════════
export function NfseDetalheEtapas({
  nota,
  carregandoXml,
  onVerXml,
  onBaixarXml,
}: {
  nota: NfseRecebida;
  carregandoXml: boolean;
  onVerXml: () => void;
  onBaixarXml: () => void;
}) {
  const queryClient = useQueryClient();
  const colunas = useRef<(HTMLElement | null)[]>([]);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["nfse-detalhe", nota.chave_acesso],
    queryFn: () => buscarDetalheNfse(nota.chave_acesso),
    staleTime: 30_000,
  });
  const atualizar = () => queryClient.invalidateQueries({ queryKey: ["nfse-detalhe", nota.chave_acesso] });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando as etapas da nota...
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex items-center gap-3 p-6 text-xs">
        <AlertTriangle className="h-4 w-4 text-rose-600" />
        <span>{error instanceof Error ? error.message : "Nota não encontrada."}</span>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  return <Etapas d={data} carregandoXml={carregandoXml} onVerXml={onVerXml} onBaixarXml={onBaixarXml} onAtualizar={atualizar} atualizando={isFetching} colunas={colunas} />;
}

function Etapas({
  d,
  carregandoXml,
  onVerXml,
  onBaixarXml,
  onAtualizar,
  atualizando,
  colunas,
}: {
  d: DetalheNfse;
  carregandoXml: boolean;
  onVerXml: () => void;
  onBaixarXml: () => void;
  onAtualizar: () => void;
  atualizando: boolean;
  colunas: MutableRefObject<(HTMLElement | null)[]>;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const visivel = useLarguraVisivel(raiz);
  const porLinha = colunasPorLinha(visivel.largura);
  const n = d.nota;
  const hoje = hojeBrt();
  const espelhoDesde = formatDate(d.meta.alvo_espelho_desde);
  const vinculados = d.pedidos.vinculados ?? [];
  const candidatos = d.pedidos.candidatos ?? [];
  const lancada = n.situacao_alvo === "lancada_nfse" || n.situacao_alvo === "lancada_outra_especie";
  const semDado = n.situacao_alvo === "sem_dado_alvo";
  const anexoNf = d.anexos.find((a) => a.tipo === "nf");
  const anexoBoleto = d.anexos.find((a) => a.tipo === "boleto");
  const parcelas = d.docfin.parcelas ?? [];
  const pagas = parcelas.filter(parcelaPaga).length;
  const vencidas = parcelas.filter((p) => parcelaVencida(p, hoje)).length;
  const proxima = parcelas.filter((p) => !parcelaPaga(p)).sort((a, b) => (a.data_vencimento ?? "").localeCompare(b.data_vencimento ?? ""))[0];

  // ── estado de cada etapa ──
  const e1: EstadoEtapa = n.situacao_fisco === "normal" ? "feito" : "atencao";
  const e2: EstadoEtapa = vinculados.length > 0 ? "feito" : candidatos.length > 0 ? "pendente" : semDado ? "na" : "atencao";
  const e3: EstadoEtapa = lancada ? "feito" : semDado ? "na" : n.situacao_fisco !== "normal" ? "na" : "pendente";
  const e4: EstadoEtapa = anexoNf ? "feito" : "pendente";
  const e5: EstadoEtapa = anexoBoleto ? "feito" : "pendente";
  const e6: EstadoEtapa =
    parcelas.length === 0 ? (semDado ? "na" : "pendente") : vencidas > 0 ? "atencao" : pagas === parcelas.length ? "feito" : "pendente";

  const regua = [
    { titulo: "Nota fiscal", estado: e1 },
    { titulo: "Pedidos", estado: e2 },
    { titulo: "MovEstq", estado: e3 },
    { titulo: "PDF da nota", estado: e4 },
    { titulo: "PDF do boleto", estado: e5 },
    { titulo: "DocFin", estado: e6 },
  ];
  const ir = (i: number) => colunas.current[i]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  const ref = (i: number) => (el: HTMLElement | null) => {
    colunas.current[i] = el;
  };
  const issRetido = n.iss_retido === "2" ? "Sim" : n.iss_retido === "1" ? "Não" : null;

  // minmax(0, 1fr) em tudo: nada aqui dentro empurra a largura da tabela.
  return (
    <div
      ref={raiz}
      className={cn("grid grid-cols-[minmax(0,1fr)] gap-3 bg-muted/40 p-4", visivel.presa && "sticky left-0")}
      style={visivel.presa && visivel.largura ? { width: visivel.largura } : undefined}
    >
      <Regua etapas={regua} onIr={ir} />

      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${porLinha}, minmax(0, 1fr))` }}>
        {/* 1 — NOTA FISCAL */}
        <Coluna
          n={1}
          titulo="Nota fiscal"
          icone={<FileText className="h-4 w-4" />}
          estado={e1}
          resumo={`NFS-e ${n.numero ?? "—"} · ${n.situacao_fisco === "normal" ? "normal no fisco" : n.situacao_fisco === "cancelada" ? "cancelada no fisco" : "substituída no fisco"}`}
          colRef={ref(0)}
          rodape={
            <>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={carregandoXml} onClick={onVerXml}>
                {carregandoXml ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} Ver XML
              </Button>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={carregandoXml} onClick={onBaixarXml}>
                <Download className="h-3 w-3" /> Baixar XML
              </Button>
            </>
          }
        >
          <p className="line-clamp-2 font-medium text-foreground" title={n.prestador_nome ?? ""}>
            {n.prestador_nome ?? "—"}
          </p>
          <Campo label="CNPJ/CPF" valor={formatDoc(n.prestador_doc)} mono />
          <Campo label="Emissão" valor={formatDate(n.data_emissao)} />
          <Campo label="Competência" valor={formatDate(n.competencia)} />
          <Campo label="Município" valor={n.municipio_emissor} />
          <Campo label="V. serviço" valor={formatCurrency(n.valor_servico)} mono />
          <Campo label="V. líquido" valor={formatCurrency(n.valor_liquido)} mono />
          {issRetido && <Campo label="ISS retido" valor={issRetido} />}
          {n.codigo_servico && <Campo label="Cód. serviço" valor={n.codigo_servico} mono />}
          {n.descricao_servico && (
            <p className="mt-1 line-clamp-4 text-[11px] leading-snug text-muted-foreground" title={n.descricao_servico}>
              {n.descricao_servico}
            </p>
          )}
          {n.situacao_fisco !== "normal" && (
            <Aviso tom="atencao">
              {n.situacao_fisco === "cancelada" ? "Cancelada" : "Substituída"} no fisco
              {n.cancelada_em ? ` em ${formatInstanteBrt(n.cancelada_em)}` : ""}.
              {lancada ? " Atenção: está lançada no Alvo." : ""}
            </Aviso>
          )}
        </Coluna>

        {/* 2 — PEDIDOS */}
        <Coluna
          n={2}
          titulo="Pedidos"
          icone={<ShoppingCart className="h-4 w-4" />}
          estado={e2}
          resumo={
            vinculados.length > 0
              ? `Ligada no MovEstq a ${vinculados.length === 1 ? "1 pedido" : `${vinculados.length} pedidos`}`
              : candidatos.length > 0
                ? `${candidatos.length} candidato${candidatos.length > 1 ? "s" : ""} encontrado${candidatos.length > 1 ? "s" : ""}`
                : "Nenhum pedido encontrado"
          }
          colRef={ref(1)}
        >
          {vinculados.length > 0 ? (
            vinculados.map((p) => (
              <div key={p.numero} className="flex flex-col gap-1 rounded-md border border-emerald-200 bg-emerald-50/40 p-2 dark:border-emerald-900 dark:bg-emerald-950/20">
                <span className="text-xs font-semibold tabular-nums">Pedido {p.numero}</span>
                <Campo label="Pedido em" valor={formatDate(p.data_pedido)} />
                <Campo label="Valor do pedido" valor={formatCurrency(p.valor_pedido)} mono />
                <Campo label="Nesta nota" valor={formatCurrency(p.valor_na_nf)} mono />
                <Etiquetas
                  itens={[
                    p.natureza && { texto: p.natureza },
                    p.status && { texto: p.status },
                    !p.no_hub && { texto: "pedido fora do Hub", alerta: true },
                  ]}
                />
              </div>
            ))
          ) : candidatos.length > 0 ? (
            <>
              {lancada && <Aviso>Lançada no Alvo sem pedido. Estes pedidos poderiam ser desta nota:</Aviso>}
              {candidatos.map((c, i) => (
                <CartaoCandidato key={c.numero} c={c} destaque={i === 0} />
              ))}
              <p className="text-[11px] leading-snug text-muted-foreground">
                Sugestão automática: mesmo fornecedor, pedido em R$, valor ou saldo dentro de ±20% do valor da nota.
              </p>
            </>
          ) : (
            <Aviso tom={semDado ? "neutro" : "atencao"}>
              {lancada
                ? "Lançada no Alvo sem pedido, e nenhum pedido do fornecedor bate com o valor."
                : "Nenhum pedido do mesmo fornecedor com valor ou saldo dentro de ±20% (pedidos em R$ de 400 dias antes até 60 dias depois da emissão). Pode ser que o pedido ainda não tenha sido criado."}
            </Aviso>
          )}
        </Coluna>

        {/* 3 — MOVESTQ */}
        <Coluna
          n={3}
          titulo="MovEstq"
          icone={<PackageCheck className="h-4 w-4" />}
          estado={e3}
          resumo={
            d.movestq
              ? `Lançada · chave ${d.movestq.chave_movestq}`
              : lancada
                ? n.alvo_chave_movestq != null
                  ? `Lançada · chave ${n.alvo_chave_movestq}`
                  : `Lançada como ${n.alvo_especies ?? "outra espécie"}`
                : semDado
                  ? `Sem dado do Alvo (nota anterior a ${espelhoDesde})`
                  : "Não lançada no Alvo"
          }
          colRef={ref(2)}
          rodape={
            !lancada && !semDado && n.situacao_fisco === "normal" ? (
              <div className="flex w-full items-center justify-between gap-2">
                <Button size="sm" className="h-7 gap-1 text-xs" disabled title="O lançamento pelo Hub está em definição">
                  <Send className="h-3 w-3" /> Em breve
                </Button>
                <span className="text-[10px] text-muted-foreground">Lançar no Alvo pelo Hub</span>
              </div>
            ) : undefined
          }
        >
          {d.movestq ? (
            <>
              <ChaveMovEstq chave={d.movestq.chave_movestq} />
              <Campo label="Espécie" valor={`${d.movestq.especie ?? "—"}${d.movestq.serie ? ` · série ${d.movestq.serie}` : ""}`} />
              <Campo label="Tipo de lançamento" valor={d.movestq.codigo_tipo_lanc} mono />
              <Campo label="Entrada" valor={formatDate(d.movestq.data_entrada)} />
              <Campo label="Digitação" valor={formatInstanteBrt(d.movestq.data_hora_digitacao)} />
              <Campo label="Valor" valor={formatCurrency(d.movestq.valor_documento)} mono />
              <Campo label="Itens" valor={d.movestq.qtd_itens} />
              <Campo
                label="Pedido no lançamento"
                valor={vinculados.length > 0 ? vinculados.map((p) => p.numero).join(", ") : "sem pedido"}
                mono
              />
              <p className="mt-1 text-[10px] text-muted-foreground">Lido do Alvo em {formatInstanteBrt(d.movestq.carregado_em)}</p>
            </>
          ) : lancada ? (
            <>
              {n.alvo_chave_movestq != null && <ChaveMovEstq chave={n.alvo_chave_movestq} />}
              <Aviso>
                {n.alvo_chave_movestq != null
                  ? "Chave tirada do título no contas a pagar do Alvo; os dados do MovEstq ainda não foram lidos pelo Hub."
                  : "O título está no contas a pagar do Alvo; o MovEstq ainda não foi lido pelo Hub."}
              </Aviso>
            </>
          ) : semDado ? (
            <Aviso>O espelho do Alvo no Hub começa em {espelhoDesde}. Não dá para saber se esta nota foi lançada.</Aviso>
          ) : (
            <>
              <Aviso tom="atencao">
                Não lançada no Alvo{n.dias_desde_emissao != null ? ` · ${emitidaHa(n.dias_desde_emissao)}` : ""}.
              </Aviso>
              {candidatos[0] ? (
                <>
                  <span className="mt-1 text-[11px] font-medium text-foreground">Pedido sugerido para o lançamento</span>
                  <CartaoCandidato c={candidatos[0]} destaque />
                </>
              ) : (
                <span className="text-[11px] text-muted-foreground">Sem pedido candidato para sugerir.</span>
              )}
            </>
          )}
        </Coluna>

        {/* 4 — PDF DA NOTA */}
        <Coluna
          n={4}
          titulo="PDF da nota"
          icone={<Paperclip className="h-4 w-4" />}
          estado={e4}
          resumo={anexoNf ? "Anexado" : "Aguardando o PDF da NFS-e"}
          colRef={ref(3)}
        >
          <AreaAnexo chave={n.chave_acesso} tipo="nf" anexo={anexoNf} onMudou={onAtualizar} />
        </Coluna>

        {/* 5 — PDF DO BOLETO */}
        <Coluna
          n={5}
          titulo="PDF do boleto"
          icone={<Receipt className="h-4 w-4" />}
          estado={e5}
          resumo={anexoBoleto ? "Anexado" : "Aguardando o boleto"}
          colRef={ref(4)}
        >
          <AreaAnexo chave={n.chave_acesso} tipo="boleto" anexo={anexoBoleto} onMudou={onAtualizar} />
          <LeituraBoleto key={anexoBoleto?.id ?? "sem-anexo"} anexo={anexoBoleto} />
          <p className="text-[10px] leading-snug text-muted-foreground">
            Será pré-requisito para lançar a nota pelo Hub (regra em definição).
          </p>
        </Coluna>

        {/* 6 — DOCFIN */}
        <Coluna
          n={6}
          titulo="DocFin"
          icone={<Banknote className="h-4 w-4" />}
          estado={e6}
          resumo={
            parcelas.length === 0
              ? semDado
                ? "Sem dado do Alvo"
                : "Sem título no contas a pagar"
              : `DocFin ${parcelas[0].chave_docfin ?? "—"} · ${pagas}/${parcelas.length} paga${parcelas.length > 1 ? "s" : ""}`
          }
          colRef={ref(5)}
        >
          {parcelas.length > 0 ? (
            <>
              {proxima && !vencidas && (
                <Campo label="Próximo vencimento" valor={formatDate(proxima.data_prorrogacao || proxima.data_vencimento)} />
              )}
              {vencidas > 0 && <Aviso tom="atencao">{vencidas} parcela(s) vencida(s) e em aberto.</Aviso>}
              {parcelas.map((p, i) => (
                <LinhaParcela key={`${p.chave_docfin}-${p.sequencia}-${i}`} p={p} total={parcelas.length} hoje={hoje} />
              ))}
              <p className="mt-1 text-[10px] text-muted-foreground">
                Títulos lidos do Alvo em {formatInstanteBrt(d.meta.titulos_lidos_em)} (06h40 e 12h40, dias úteis)
              </p>
            </>
          ) : (
            <Aviso>
              {semDado
                ? `O espelho do contas a pagar começa em ${espelhoDesde}.`
                : "A nota ainda não tem título no contas a pagar do Alvo. Depois do lançamento, o título aparece na próxima leitura (06h40 ou 12h40, dias úteis)."}
            </Aviso>
          )}
        </Coluna>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          Fisco (ADN) lido até {formatInstanteBrt(d.meta.adn_lido_em)} · Alvo: títulos lidos em{" "}
          {formatInstanteBrt(d.meta.titulos_lidos_em)}
        </span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]" onClick={onAtualizar} disabled={atualizando}>
          {atualizando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Atualizar etapas
        </Button>
      </div>
    </div>
  );
}
