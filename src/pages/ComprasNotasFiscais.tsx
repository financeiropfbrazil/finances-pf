import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DataSection } from "@/components/DataSection";
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
import {
  Search,
  Download,
  CheckCircle2,
  XCircle,
  Loader2,
  Hash,
  Package,
  ChevronDown,
  ChevronRight,
  Eye,
  Copy,
  Link as LinkIcon,
  Unlink,
  RefreshCw,
  HelpCircle,
  AlertTriangle,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { VincularPedidoNfeDialog } from "@/components/compras/VincularPedidoNfeDialog";
import { UploadXmlButton } from "@/components/compras/UploadXmlButton";
import { listarNfeNoAlvo, type NfeNoAlvo } from "@/services/comprasNfeNoAlvoService";
import {
  buscarEspelhoAlvoDesde,
  buscarUltimaLevaRiosoft,
  buscarXmlNfe,
  desvincularPedidosNfe,
  listarNotasDoPeriodo,
} from "@/services/nfeRecebidasService";
import { PeriodoPicker, atalhosPeriodo, type Periodo } from "@/components/PeriodoPicker";
import { NfeDetalheEtapas, chaveDetalheNfe } from "@/components/nfe/NfeDetalheEtapas";
import { buscarRelatorioEtapas, exportarEtapasXLSX, type LinhaEtapas } from "@/services/notasEtapasExport";
import { buscarComentariosLote } from "@/services/notaComentariosService";
import {
  cfopsDaNota,
  diasUteisSemLeva,
  notaCasaBusca,
  situacaoAlvoDaNota,
  type SituacaoAlvoLista,
} from "@/components/nfe/nfeLista";
import { formatInstanteBrt } from "@/components/nfse/nfseFormatos";
import { FiltroCabecalho, type OpcaoFiltro } from "@/components/FiltroCabecalho";
import { buscarTiposLanc, rotuloTipoLanc, type TipoLanc } from "@/services/alvoTipoLancService";
import {
  aplicarFiltros,
  descreverFiltros,
  filtroAtivo,
  opcoesDaColuna,
  type DefColuna,
  type FiltrosColunas,
} from "@/lib/filtroColunas";
import { useQueryClient } from "@tanstack/react-query";

// ── Types ──
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
interface NfeRow {
  id: string;
  numero: string | null;
  serie: string | null;
  chave_acesso: string;
  emitente_nome: string | null;
  emitente_cnpj: string | null;
  emitente_ie: string | null;
  emitente_uf: string | null;
  valor_produtos: number | null;
  valor_icms: number | null;
  valor_ipi: number | null;
  valor_frete: number | null;
  valor_desconto: number | null;
  valor_total: number | null;
  base_calculo_icms: number | null;
  data_emissao: string | null;
  natureza_operacao: string | null;
  situacao: string | null;
  origem: string | null;
  recebido: boolean | null;
  /** Não vem na lista (pesaria MB em período longo): buscado sob demanda em Ver/Baixar XML (NFE-5). */
  raw_xml?: string | null;
  dados_extraidos: any;
  status_lancamento: string | null;
  pedido_compra_numero: string | null;
  pedido_compra_entidade: string | null;
  pedido_compra_classe: string | null;
  pedido_compra_centro_custo: string | null;
  pedido_compra_cond_pagamento: string | null;
  pedido_compra_valor: number | null;
  /** Quando a nota chegou ao Hub (leva da Riosoft ou upload manual). */
  imported_at: string | null;
}

// ── Helpers ──
const formatCurrency = (v: number | null | undefined) =>
  v != null ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v) : "—";
const formatDate = (d: string | null | undefined) => {
  if (!d) return "—";
  // data_emissao é um date "YYYY-MM-DD" — formata por split pra não aplicar
  // timezone (new Date("2026-06-03") vira meia-noite UTC e recua 1 dia em UTC-3).
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return d;
};
const formatCnpj = (cnpj: string | null) => {
  if (!cnpj) return "—";
  const c = cnpj.replace(/\D/g, "");
  if (c.length !== 14) return cnpj;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
};
/** Dia ("YYYY-MM-DD") de um instante, no horário de Brasília. */
const diaIsoBrt = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/** Rótulos e ordem do "No Alvo" no filtro do cabeçalho (NFE-12). */
const ROTULO_ALVO: Record<SituacaoAlvoLista, string> = {
  lancada: "Lançada",
  nao_encontrada: "Não encontrada",
  sem_como_saber: "Sem como saber",
  sem_dado_alvo: "Sem dado do Alvo",
};
const ORDEM_ALVO: string[] = ["lancada", "nao_encontrada", "sem_como_saber", "sem_dado_alvo"];

/** Dia (dd/mm/aaaa) de um instante, no horário de Brasília. */
const formatDiaBrt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";

// NFE-7: a coluna "Situação" mostrava sempre "Recebida" — a situação no fisco NÃO é acompanhada (PLANO-NFE, regra 2:
// a nota chega autorizada pela Riosoft e o Hub não consulta a SEFAZ). No lugar dela, "Chegou em": a data em que a
// nota entrou no Hub (leva da Riosoft ou upload manual), que mostra o atraso entre a emissão e a chegada.
const chegouEm = (r: { imported_at: string | null; origem: string | null }) => {
  const via = r.origem === "Upload" ? "Upload manual" : "Riosoft (Arqimport)";
  return (
    <span className="whitespace-nowrap" title={`${via} · ${formatInstanteBrt(r.imported_at)}`}>
      {formatDiaBrt(r.imported_at)}
      {r.origem === "Upload" && <span className="ml-1 text-[10px] text-muted-foreground">upload</span>}
    </span>
  );
};

/**
 * Baixa o XML da NF-e como arquivo. `raw_xml` é o nfeProc completo (NF-e +
 * protocolo de autorização) gravado no recebimento; só ganha a declaração
 * <?xml ...?> quando falta (fica fora da assinatura, não a invalida).
 * Nome no padrão de download da SEFAZ: <chave>-procNFe.xml.
 */
function baixarXmlNfe(nfe: { raw_xml: string | null; chave_acesso: string | null; numero: string | null }): boolean {
  if (!nfe.raw_xml) return false;
  const xml = nfe.raw_xml.trimStart().startsWith("<?xml")
    ? nfe.raw_xml
    : `<?xml version="1.0" encoding="UTF-8"?>\n${nfe.raw_xml}`;
  const chave = (nfe.chave_acesso || "").replace(/\D/g, "");
  const nome = chave.length === 44 ? `${chave}-procNFe.xml` : `NFe-${nfe.numero || "sem-numero"}.xml`;
  const url = URL.createObjectURL(new Blob([xml], { type: "application/xml;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

/** Período inicial: ?de&ate, ou ?mes&ano (links antigos), ou "Este mês". */
function periodoDaUrl(sp: URLSearchParams): Periodo {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const de = sp.get("de");
  const ate = sp.get("ate");
  if (de && ate && iso.test(de) && iso.test(ate) && de <= ate) return { de, ate };
  const mes = Number(sp.get("mes"));
  const ano = Number(sp.get("ano"));
  if (mes >= 1 && mes <= 12 && ano >= 2000 && ano <= 2100) {
    const p = (n: number) => String(n).padStart(2, "0");
    return { de: `${ano}-${p(mes)}-01`, ate: `${ano}-${p(mes)}-${p(new Date(ano, mes, 0).getDate())}` };
  }
  return atalhosPeriodo(false)[0].periodo;
}

const ComprasNotasFiscais = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Link direto (ex.: Rastreio de Compras → "Abrir em Notas Fiscais"): ?de=2026-10-01&ate=2026-10-31&busca=1782.
  // ?mes=10&ano=2026 (links antigos) ainda abre o mês inteiro.
  const [searchParams] = useSearchParams();
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDaUrl(searchParams));
  const [rows, setRows] = useState<NfeRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get("busca") ?? "");
  // Dois eixos, cada filtro diz qual pergunta faz (regra LIVRO × ESPELHO do CLAUDE.md):
  // "No Alvo" = o Alvo já tem a nota? (espelho) · "Pedido no Hub" = vínculo feito nesta tela.
  // NFE-8: "sem como saber" junta a nota sem venda não achada e a nota anterior ao espelho do Alvo.
  const [filtroAlvo, setFiltroAlvo] = useState<"todas" | "lancada" | "nao_encontrada" | "sem_como_saber">("todas");
  const [filtroVinculo, setFiltroVinculo] = useState<"todos" | "vinculada" | "sem_vinculo">("todos");
  const [noAlvo, setNoAlvo] = useState<Map<string, NfeNoAlvo>>(new Map());
  const [erroAlvo, setErroAlvo] = useState<string | null>(null);
  /** Início do espelho do contas a pagar (NFE-8). Sem ela, nenhuma nota vira "Sem dado do Alvo" (como antes). */
  const [espelhoDesde, setEspelhoDesde] = useState<string | null>(null);
  /** Última nota recebida da Riosoft (NFE-10). undefined = não deu para consultar (o aviso some). */
  const [ultimaLeva, setUltimaLeva] = useState<string | null | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [xmlDialog, setXmlDialog] = useState<{
    open: boolean;
    numero: string;
    fornecedor: string;
    xml: string;
    chave: string;
    temXml: boolean;
  }>({
    open: false,
    numero: "",
    fornecedor: "",
    xml: "",
    chave: "",
    temXml: false,
  });
  const [vincularDialog, setVincularDialog] = useState<{ open: boolean; nfe: NfeRow | null }>({
    open: false,
    nfe: null,
  });
  const [alertAction, setAlertAction] = useState<{ type: "desvincular"; nfe: NfeRow } | null>(null);

  // ── Fetch ──
  const fetchRows = useCallback(async () => {
    if (!periodo.de || !periodo.ate) return;
    setLoadingRows(true);
    const startDate = periodo.de;
    const endDate = periodo.ate;
    const [resNotas, resAlvo, resEspelho, resLeva] = await Promise.allSettled([
      listarNotasDoPeriodo<NfeRow>(startDate, endDate),
      listarNfeNoAlvo(startDate, endDate),
      buscarEspelhoAlvoDesde(),
      buscarUltimaLevaRiosoft(),
    ]);
    setEspelhoDesde(resEspelho.status === "fulfilled" ? resEspelho.value : null);
    setUltimaLeva(resLeva.status === "fulfilled" ? resLeva.value : undefined);
    if (resNotas.status === "rejected") {
      toast({ title: "Erro", description: String(resNotas.reason), variant: "destructive" });
    } else {
      setRows(resNotas.value);
    }
    // Sem a resposta do Alvo, a coluna fica "?" — nunca "não encontrada" por falta de dado.
    if (resAlvo.status === "fulfilled") {
      setNoAlvo(resAlvo.value);
      setErroAlvo(null);
    } else {
      setNoAlvo(new Map());
      setErroAlvo(resAlvo.reason instanceof Error ? resAlvo.reason.message : String(resAlvo.reason));
    }
    setLoadingRows(false);
  }, [periodo.de, periodo.ate, toast]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // ── Tipo de lançamento do MovEstq no Alvo (NFE-14, só o cabeçalho): carrega depois do "No Alvo", sem segurar a lista ──
  const [tiposLanc, setTiposLanc] = useState<Map<number, TipoLanc>>(new Map());
  useEffect(() => {
    let vivo = true;
    const chaves = [...noAlvo.values()].map((a) => a.chave_movestq);
    if (chaves.every((c) => c == null)) {
      setTiposLanc(new Map());
      return;
    }
    buscarTiposLanc(chaves)
      .then((m) => vivo && setTiposLanc(m))
      .catch(() => vivo && setTiposLanc(new Map()));
    return () => {
      vivo = false;
    };
  }, [noAlvo]);
  const tipoDa = (r: { id: string }): TipoLanc | undefined => {
    const c = noAlvo.get(r.id)?.chave_movestq;
    return c != null ? tiposLanc.get(c) : undefined;
  };

  const toggleExpand = (nfe: NfeRow) => {
    setExpandedId(expandedId === nfe.id ? null : nfe.id);
  };

  const estaVinculada = (r: NfeRow) => r.status_lancamento === "vinculada";

  /** XML sob demanda (a lista não traz o raw_xml). */
  const xmlDaNota = async (r: NfeRow): Promise<string | null> => {
    try {
      return await buscarXmlNfe(r.id);
    } catch (e) {
      toast({ title: "Não foi possível carregar o XML", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return null;
    }
  };

  /** "No Alvo" de cada nota (NFE-8): lançada · não encontrada · sem como saber (sem venda) · sem dado do Alvo. */
  const situacaoAlvo = useMemo(() => {
    const m = new Map<string, SituacaoAlvoLista>();
    for (const r of rows) m.set(r.id, situacaoAlvoDaNota(noAlvo.has(r.id), r, espelhoDesde));
    return m;
  }, [rows, noAlvo, espelhoDesde]);

  // ── Filtro no cabeçalho (NFE-12): estilo Excel, em cascata; some quando o período muda ──
  const [filtrosColuna, setFiltrosColuna] = useState<FiltrosColunas>({});
  useEffect(() => {
    setFiltrosColuna({});
  }, [periodo.de, periodo.ate]);
  const colunasFiltro = useMemo<DefColuna<NfeRow>[]>(
    () => [
      { id: "numero", rotulo: "Número", tipo: "texto", texto: (r) => r.numero ?? "" },
      { id: "fornecedor", rotulo: "Fornecedor", tipo: "valores", valores: (r) => (r.emitente_nome ? [r.emitente_nome] : []) },
      { id: "cnpj", rotulo: "CNPJ", tipo: "valores", valores: (r) => (r.emitente_cnpj ? [r.emitente_cnpj] : []), rotuloValor: formatCnpj },
      { id: "valor", rotulo: "V. Total", tipo: "intervalo", numero: (r) => r.valor_total },
      {
        id: "emissao",
        rotulo: "Emissão",
        tipo: "valores",
        valores: (r) => (r.data_emissao ? [r.data_emissao] : []),
        rotuloValor: formatDate,
        ordem: (a, b) => b.localeCompare(a),
      },
      { id: "cfop", rotulo: "CFOP", tipo: "valores", valores: (r) => cfopsDaNota(r) },
      {
        id: "chegou",
        rotulo: "Chegou em",
        tipo: "valores",
        valores: (r) => (r.imported_at ? [diaIsoBrt(r.imported_at)] : []),
        rotuloValor: formatDate,
        ordem: (a, b) => b.localeCompare(a),
      },
      {
        id: "alvo",
        rotulo: "No Alvo",
        tipo: "valores",
        valores: (r) => {
          const s = situacaoAlvo.get(r.id);
          return s ? [s] : [];
        },
        rotuloValor: (v) => ROTULO_ALVO[v as SituacaoAlvoLista] ?? v,
        ordem: (a, b) => ORDEM_ALVO.indexOf(a) - ORDEM_ALVO.indexOf(b),
      },
      {
        id: "tipo",
        rotulo: "Tipo lanç.",
        tipo: "valores",
        valores: (r) => {
          const c = noAlvo.get(r.id)?.chave_movestq;
          const t = c != null ? tiposLanc.get(c) : undefined;
          return t?.codigo ? [t.codigo] : [];
        },
        rotuloValor: (v) => {
          const t = [...tiposLanc.values()].find((x) => x.codigo === v);
          return rotuloTipoLanc(t) || v;
        },
      },
      {
        id: "pedido",
        rotulo: "Pedido no Hub",
        tipo: "valores",
        valores: (r) => (r.status_lancamento === "vinculada" && r.pedido_compra_numero ? [r.pedido_compra_numero] : []),
      },
    ],
    [situacaoAlvo, noAlvo, tiposLanc],
  );
  // Sem resposta do Alvo, o filtro "No Alvo" não vale (como o seletor de cima).
  const defsAtivas = useMemo(
    () => (erroAlvo ? colunasFiltro.filter((d) => d.id !== "alvo") : colunasFiltro),
    [colunasFiltro, erroAlvo],
  );
  const nFiltrosColuna = defsAtivas.filter((d) => filtroAtivo(filtrosColuna[d.id])).length;

  // ── Filtering ──
  const filtradaTopo = useMemo(() => {
    let list = rows;
    if (filtroAlvo !== "todas" && !erroAlvo) {
      list = list.filter((r) => {
        const s = situacaoAlvo.get(r.id);
        return (s === "sem_dado_alvo" ? "sem_como_saber" : s) === filtroAlvo;
      });
    }
    if (filtroVinculo !== "todos") {
      list = list.filter((r) => (estaVinculada(r) ? "vinculada" : "sem_vinculo") === filtroVinculo);
    }
    if (searchTerm.trim()) {
      list = list.filter((r) => notaCasaBusca(r, searchTerm));
    }
    return list;
  }, [rows, filtroAlvo, filtroVinculo, searchTerm, situacaoAlvo, erroAlvo]);
  const filtered = useMemo(
    () => aplicarFiltros(filtradaTopo, defsAtivas, filtrosColuna),
    [filtradaTopo, defsAtivas, filtrosColuna],
  );
  /** Opções de cada coluna de lista, em cascata (das notas que passam nos OUTROS filtros). */
  const opcoesColuna = useMemo(() => {
    const m: Record<string, OpcaoFiltro[]> = {};
    for (const d of colunasFiltro) {
      if (d.tipo === "valores") m[d.id] = opcoesDaColuna(aplicarFiltros(filtradaTopo, defsAtivas, filtrosColuna, d.id), d);
    }
    return m;
  }, [colunasFiltro, defsAtivas, filtradaTopo, filtrosColuna]);
  const cabecalho = (id: string, conteudo: ReactNode, opts?: { title?: string; direita?: boolean }) => {
    const def = colunasFiltro.find((d) => d.id === id)!;
    return (
      <TableHead className={`text-xs px-2 ${opts?.direita ? "text-right" : ""}`} title={opts?.title}>
        <div className={`flex items-center ${opts?.direita ? "justify-end" : ""}`}>
          <span>{conteudo}</span>
          <FiltroCabecalho
            rotulo={def.rotulo}
            tipo={def.tipo}
            filtro={filtrosColuna[id]}
            onChange={(f) => setFiltrosColuna((prev) => ({ ...prev, [id]: f }))}
            opcoes={opcoesColuna[id]}
            alinhar={opts?.direita ? "end" : "start"}
            desabilitado={id === "alvo" && !!erroAlvo}
            motivoDesabilitado="Sem resposta do Alvo agora — o filtro de No Alvo não vale"
          />
        </div>
      </TableHead>
    );
  };

  const summary = useMemo(() => {
    const total = rows.length;
    const conta = (q: (s: SituacaoAlvoLista | undefined) => boolean) => rows.filter((r) => q(situacaoAlvo.get(r.id))).length;
    const lancadas = conta((s) => s === "lancada");
    const naoEncontradas = conta((s) => s === "nao_encontrada");
    const semComoSaber = conta((s) => s === "sem_como_saber" || s === "sem_dado_alvo");
    const vinculadas = rows.filter(estaVinculada).length;
    const valorTotal = rows.reduce((s, r) => s + (r.valor_total || 0), 0);
    return { total, lancadas, naoEncontradas, semComoSaber, vinculadas, valorTotal };
  }, [rows, situacaoAlvo]);

  const footerTotal = useMemo(() => filtered.reduce((s, r) => s + (r.valor_total || 0), 0), [filtered]);

  // ── Aviso da Riosoft (NFE-10): laranja com 2 dias úteis ou mais sem nota nova ──
  const diasSemLeva = diasUteisSemLeva(ultimaLeva ?? null);
  const levaAtrasada = diasSemLeva !== null && diasSemLeva >= 2;

  // ── Download de controle das etapas (NFE-6): período e notas da lista no momento do clique ──
  const [baixando, setBaixando] = useState(false);
  const baixarExcel = async () => {
    if (!periodo.de || !periodo.ate) return;
    setBaixando(true);
    try {
      const porId = new Map(filtered.map((r) => [r.id, r]));
      const relatorio = (await buscarRelatorioEtapas("nfe", periodo.de, periodo.ate)).filter((l) => l.id && porId.has(l.id));
      const chaveDe = (l: LinhaEtapas) => l.chave_acesso || porId.get(l.id!)!.chave_acesso;
      // Comentários da etapa 7 (NFE-16), nas colunas finais.
      const comentarios = await buscarComentariosLote("nfe", relatorio.map(chaveDe));
      // CFOP (NFE-7-A): o mesmo da coluna da tela, montado a partir dos itens que a lista já carregou.
      const linhas = relatorio.map((l) => {
        const t = l.chave_movestq != null ? tiposLanc.get(Number(l.chave_movestq)) : undefined;
        return {
          ...l,
          cfop: cfopsDaNota(porId.get(l.id!)!).join(" · "),
          tipo_lanc: t?.codigo ?? null,
          tipo_lanc_descricao: t?.descricao ?? null,
          comentarios: comentarios.get(chaveDe(l)) ?? [],
        };
      });
      if (linhas.length === 0) {
        toast({ title: "Nada para baixar neste filtro" });
        return;
      }
      const filtros = [
        filtroAlvo !== "todas" &&
          ({ lancada: "No Alvo: lançadas", nao_encontrada: "No Alvo: não encontradas", sem_como_saber: "No Alvo: sem como saber" } as const)[
            filtroAlvo
          ],
        filtroVinculo !== "todos" && (filtroVinculo === "vinculada" ? "Pedido no Hub: vinculado" : "Pedido no Hub: sem vínculo"),
        searchTerm.trim() && `Busca: "${searchTerm.trim()}"`,
        ...descreverFiltros(defsAtivas, filtrosColuna),
      ].filter(Boolean) as string[];
      const r = await exportarEtapasXLSX("nfe", linhas, { de: periodo.de, ate: periodo.ate, filtros });
      toast({ title: "Excel baixado", description: `${r.linhas} nota(s) · ${r.arquivo}` });
    } catch (e) {
      toast({ title: "Não foi possível gerar o Excel", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBaixando(false);
    }
  };

  const noAlvoBadge = (r: NfeRow) => {
    if (erroAlvo)
      return (
        <Badge variant="outline" className="text-[10px]" title={`Não foi possível consultar o Alvo: ${erroAlvo}`}>
          ?
        </Badge>
      );
    const a = noAlvo.get(r.id);
    const sit = situacaoAlvo.get(r.id);
    if (!a && sit === "sem_dado_alvo")
      return (
        <Badge
          variant="outline"
          className="text-[10px] border-dashed text-muted-foreground"
          title={`O espelho do Alvo no Hub começa em ${formatDate(espelhoDesde)}: não dá para saber se esta nota foi lançada.`}
        >
          Sem dado do Alvo
        </Badge>
      );
    if (!a && sit === "sem_como_saber")
      return (
        <Badge
          variant="outline"
          className="text-[10px] border-dashed text-muted-foreground"
          title="Nota sem CFOP de venda (remessa, retorno, consignação, bonificação…). O Hub só enxerga no Alvo os lançamentos com título a pagar ou pedido: se ela foi lançada sem título, não aparece aqui. Confira no Alvo."
        >
          Sem como saber
        </Badge>
      );
    if (a)
      return (
        <Badge
          className="bg-success text-success-foreground hover:bg-success/90 text-[10px]"
          title={`Achada em: ${a.fonte}${a.chave_movestq ? ` · MovEstq ${a.chave_movestq}` : ""}`}
        >
          Lançada{a.data_entrada ? ` ${formatDate(a.data_entrada)}` : ""}
        </Badge>
      );
    return (
      <Badge variant="outline" className="text-[10px]">
        Não encontrada
      </Badge>
    );
  };

  const vinculoBadge = (r: NfeRow) =>
    estaVinculada(r) ? (
      <Badge className="bg-info text-info-foreground hover:bg-info/90 text-[10px]">
        Ped. {r.pedido_compra_numero}
      </Badge>
    ) : (
      <span className="text-[10px] text-muted-foreground">—</span>
    );

  // ── Desvincular ──
  const handleConfirmAction = async () => {
    if (!alertAction) return;
    const { type, nfe } = alertAction;
    if (type === "desvincular") {
      // RPC compras_nfe_desvincular (PLANO-NFE NFE-1): limpa as colunas legadas e os vínculos múltiplos.
      try {
        await desvincularPedidosNfe(nfe.id);
        toast({ title: "Vinculação removida" });
        queryClient.invalidateQueries({ queryKey: chaveDetalheNfe(nfe.id) });
      } catch (e) {
        toast({ title: "Erro", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      }
    }
    setAlertAction(null);
    fetchRows();
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Notas Fiscais (NF-e)</h1>
        <p className="text-muted-foreground">
          NF-e de produto recebidas (via integração ou upload manual de XML) e a situação de cada uma no Alvo.
        </p>
        {ultimaLeva !== undefined && (
          <p
            className={`mt-1 flex items-center gap-1 text-[11px] ${
              levaAtrasada ? "font-medium text-amber-600" : "text-muted-foreground"
            }`}
            title="A Riosoft (Arqimport) manda as notas por volta de 12h nos dias úteis. Laranja: 2 dias úteis ou mais sem nenhuma nota nova (feriados não entram na conta)."
          >
            {levaAtrasada && <AlertTriangle className="h-3 w-3 shrink-0" />}
            Última nota recebida da Riosoft: {ultimaLeva ? formatInstanteBrt(ultimaLeva) : "nenhuma"}
            {levaAtrasada &&
              ` — ${diasSemLeva} dias úteis sem nota nova. Pode ser só falta de nota; se continuar, falar com a Riosoft.`}
          </p>
        )}
      </div>

      {/* Filtros de período */}
      {/* Barra do período e dos botões: quebra de linha em tela pequena (antes a página rolava para o lado). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodoPicker valor={periodo} onChange={setPeriodo} permitirTudo={false} />
          <span className="text-[11px] text-muted-foreground">pela data de emissão</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UploadXmlButton onImported={fetchRows} />
          <Button
            variant="outline"
            size="sm"
            onClick={baixarExcel}
            disabled={baixando || loadingRows || filtered.length === 0}
            className="gap-1"
            title="Excel de controle das etapas — com o período e os filtros da tela"
          >
            {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Baixar Excel
          </Button>
          <Button variant="outline" size="sm" onClick={fetchRows} disabled={loadingRows} className="gap-1">
            {loadingRows ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Atualizar
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Total NF-e", value: summary.total, icon: Hash },
          { label: "No Alvo: lançadas", value: erroAlvo ? "?" : summary.lancadas, icon: CheckCircle2 },
          { label: "No Alvo: não encontradas", value: erroAlvo ? "?" : summary.naoEncontradas, icon: XCircle },
          { label: "No Alvo: sem como saber", value: erroAlvo ? "?" : summary.semComoSaber, icon: HelpCircle },
          { label: "Pedido vinculado no Hub", value: summary.vinculadas, icon: LinkIcon },
          { label: "Valor Total", value: formatCurrency(summary.valorTotal), icon: Package },
        ].map((c) => (
          <Card key={c.label}>
            <CardContent className="p-3 flex items-center gap-2">
              <c.icon className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="text-sm font-semibold tabular-nums">{c.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="Buscar por fornecedor, CNPJ, número, chave, pedido ou CFOP..."
          className="h-8 text-xs sm:max-w-sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <Select value={filtroAlvo} onValueChange={(v) => setFiltroAlvo(v as typeof filtroAlvo)} disabled={!!erroAlvo}>
          <SelectTrigger className="h-8 w-52 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">No Alvo: todas</SelectItem>
            <SelectItem value="lancada">No Alvo: lançadas</SelectItem>
            <SelectItem value="nao_encontrada">No Alvo: não encontradas</SelectItem>
            <SelectItem value="sem_como_saber">No Alvo: sem como saber</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroVinculo} onValueChange={(v) => setFiltroVinculo(v as typeof filtroVinculo)}>
          <SelectTrigger className="h-8 w-52 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Pedido no Hub: todos</SelectItem>
            <SelectItem value="vinculada">Pedido no Hub: vinculado</SelectItem>
            <SelectItem value="sem_vinculo">Pedido no Hub: sem vínculo</SelectItem>
          </SelectContent>
        </Select>
        {nFiltrosColuna > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setFiltrosColuna({})}>
            Limpar filtros das colunas ({nFiltrosColuna})
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground -mt-4">
        {erroAlvo
          ? `Não foi possível consultar o Alvo agora (${erroAlvo}). A coluna "No Alvo" ficou como "?".`
          : "No Alvo: conferido nos espelhos do Alvo — o contas a pagar é lido às 06h40 e às 12h40 (dias úteis), então a nota lançada aparece na leitura seguinte. “Sem como saber”: nota sem CFOP de venda (remessa, retorno, consignação, bonificação…) que o Hub não acha — o espelho só vê lançamentos com título a pagar ou pedido. Situação no fisco não é acompanhada (a Riosoft envia a nota já autorizada)."}
      </p>

      {/* Tabela */}
      <Card>
        {/* minmax(0, 1fr): se a lista não couber, ela rola dentro do card em vez de alargar a página inteira. */}
        <CardContent className="grid grid-cols-[minmax(0,1fr)] p-0">
          {loadingRows ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Nenhuma NF-e encontrada no período.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6 px-1" />
                  {cabecalho("numero", "Número")}
                  {cabecalho("fornecedor", "Fornecedor")}
                  {cabecalho("cnpj", "CNPJ")}
                  {cabecalho("valor", "V. Total", { direita: true })}
                  {cabecalho("emissao", "Emissão")}
                  {cabecalho("cfop", "CFOP", { title: "CFOP dos itens da nota, como o fornecedor emitiu" })}
                  {cabecalho("chegou", "Chegou em", { title: "Quando a nota chegou ao Hub (leva da Riosoft ou upload)" })}
                  {cabecalho("alvo", "No Alvo")}
                  {cabecalho("tipo", "Tipo lanç.", { title: "Tipo de lançamento do MovEstq no Alvo (cabeçalho)" })}
                  {cabecalho("pedido", "Pedido no Hub")}
                  <TableHead className="text-xs px-2">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="py-10 text-center text-sm text-muted-foreground">
                      Nenhuma NF-e com esses filtros.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((r) => {
                  const itens = (r.dados_extraidos?.itens || []) as NfeItemExtraido[];
                  const cfops = cfopsDaNota(r);
                  const alvo = noAlvo.get(r.id);
                  return (
                    <TooltipProvider key={r.id}>
                      <>
                        <TableRow
                          className={
                            expandedId === r.id ? "cursor-pointer bg-accent/60" : "cursor-pointer hover:bg-muted/50"
                          }
                          onClick={() => toggleExpand(r)}
                        >
                          <TableCell className="px-1">
                            {expandedId === r.id ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </TableCell>
                          <TableCell className="text-xs px-2 tabular-nums">{r.numero || "—"}</TableCell>
                          <TableCell className="text-xs max-w-[180px] truncate px-2">
                            {r.emitente_nome || "—"}
                          </TableCell>
                          <TableCell className="text-xs font-mono px-2 tabular-nums">
                            {formatCnpj(r.emitente_cnpj)}
                          </TableCell>
                          <TableCell className="text-xs text-right whitespace-nowrap font-medium px-2 tabular-nums">
                            {formatCurrency(r.valor_total)}
                          </TableCell>
                          <TableCell className="text-xs px-2 tabular-nums">{formatDate(r.data_emissao)}</TableCell>
                          <TableCell
                            className="text-xs font-mono px-2 tabular-nums whitespace-nowrap"
                            title={r.natureza_operacao || undefined}
                          >
                            {cfops.length > 0 ? cfops.join(" · ") : "—"}
                          </TableCell>
                          <TableCell className="text-xs px-2 tabular-nums">{chegouEm(r)}</TableCell>
                          <TableCell className="px-2">{noAlvoBadge(r)}</TableCell>
                          <TableCell
                            className="text-[11px] font-mono px-2 whitespace-nowrap tabular-nums text-muted-foreground"
                            title={rotuloTipoLanc(tipoDa(r)) || undefined}
                          >
                            {tipoDa(r)?.codigo ?? "—"}
                          </TableCell>
                          <TableCell className="px-2">{vinculoBadge(r)}</TableCell>
                          <TableCell className="px-2" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              {estaVinculada(r) ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1 text-xs h-7"
                                  title="Desvincular o pedido"
                                  onClick={() => setAlertAction({ type: "desvincular", nfe: r })}
                                >
                                  <Unlink className="h-3 w-3" />
                                </Button>
                              ) : !alvo && !erroAlvo ? (
                                // Vincular serve às notas que o Alvo ainda não tem (o Rastreio usa o
                                // vínculo para sugerir a NF ao pedido). Nota já lançada traz o pedido do Alvo.
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1 text-xs h-7"
                                  onClick={() => setVincularDialog({ open: true, nfe: r })}
                                >
                                  <LinkIcon className="h-3 w-3" /> Vincular
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>

                        {expandedId === r.id && (
                          <TableRow>
                            <TableCell colSpan={12} className="p-0">
                              <NfeDetalheEtapas
                                nfeId={r.id}
                                onVerXml={async () => {
                                  const xml = await xmlDaNota(r);
                                  setXmlDialog({
                                    open: true,
                                    numero: r.numero || "",
                                    fornecedor: r.emitente_nome || "",
                                    xml: xml || "Sem XML disponível",
                                    chave: r.chave_acesso || "",
                                    temXml: !!xml,
                                  });
                                }}
                                onBaixarXml={async () => {
                                  const xml = await xmlDaNota(r);
                                  if (!baixarXmlNfe({ ...r, raw_xml: xml })) toast({ title: "Sem XML disponível" });
                                }}
                                onVincular={() => setVincularDialog({ open: true, nfe: r })}
                                onDesvincular={() => setAlertAction({ type: "desvincular", nfe: r })}
                              />
                              <div className="space-y-3 bg-muted/40 px-4 pb-4">
                                {/* Itens da Nota (do dados_extraidos) */}
                                <DataSection
                                  title="Itens da Nota"
                                  subtitle={`${itens.length} ${itens.length === 1 ? "item" : "itens"}`}
                                  flush
                                >
                                  {itens.length === 0 ? (
                                    <p className="text-xs text-muted-foreground italic p-4">Sem itens detalhados.</p>
                                  ) : (
                                    <div className="overflow-auto">
                                      <Table>
                                        <TableHeader>
                                          <TableRow>
                                            <TableHead className="text-[10px]">#</TableHead>
                                            <TableHead className="text-[10px]">Código</TableHead>
                                            <TableHead className="text-[10px]">Descrição</TableHead>
                                            <TableHead className="text-[10px] font-mono">NCM</TableHead>
                                            <TableHead className="text-[10px] font-mono">CFOP</TableHead>
                                            <TableHead className="text-[10px]">Unid.</TableHead>
                                            <TableHead className="text-[10px] text-right">Qtd.</TableHead>
                                            <TableHead className="text-[10px] text-right">V. Unit.</TableHead>
                                            <TableHead className="text-[10px] text-right">V. Total</TableHead>
                                          </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                          {itens.map((it) => (
                                            <TableRow key={it.numero_item}>
                                              <TableCell className="text-[10px] tabular-nums">
                                                {it.numero_item}
                                              </TableCell>
                                              <TableCell className="text-[10px]">{it.codigo_produto}</TableCell>
                                              <TableCell className="text-[10px] max-w-[220px] truncate">
                                                <Tooltip>
                                                  <TooltipTrigger asChild>
                                                    <span>{it.descricao}</span>
                                                  </TooltipTrigger>
                                                  <TooltipContent className="max-w-sm">
                                                    <p className="text-xs">{it.descricao}</p>
                                                  </TooltipContent>
                                                </Tooltip>
                                              </TableCell>
                                              <TableCell className="text-[10px] font-mono tabular-nums">
                                                {it.ncm || "—"}
                                              </TableCell>
                                              <TableCell className="text-[10px] font-mono tabular-nums">
                                                {it.cfop || "—"}
                                              </TableCell>
                                              <TableCell className="text-[10px]">{it.unidade || "—"}</TableCell>
                                              <TableCell className="text-[10px] text-right tabular-nums">
                                                {it.quantidade ?? "—"}
                                              </TableCell>
                                              <TableCell className="text-[10px] text-right tabular-nums">
                                                {formatCurrency(it.valor_unitario)}
                                              </TableCell>
                                              <TableCell className="text-[10px] text-right tabular-nums">
                                                {formatCurrency(it.valor_total)}
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </div>
                                  )}
                                </DataSection>

                                {/* Valores e Impostos */}
                                <DataSection title="Valores e Impostos">
                                  <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
                                    <div>
                                      <span className="text-muted-foreground">V. Produtos:</span>{" "}
                                      {formatCurrency(r.valor_produtos)}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">V. Frete:</span>{" "}
                                      {formatCurrency(r.valor_frete)}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">V. Desconto:</span>{" "}
                                      {formatCurrency(r.valor_desconto)}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">ICMS:</span>{" "}
                                      {formatCurrency(r.valor_icms)}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">IPI:</span> {formatCurrency(r.valor_ipi)}
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">V. Total:</span>{" "}
                                      <span className="font-semibold">{formatCurrency(r.valor_total)}</span>
                                    </div>
                                  </div>
                                </DataSection>

                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    </TooltipProvider>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="text-xs">
                    Total: {filtered.length} NF-e(s)
                  </TableCell>
                  <TableCell className="text-xs text-right font-semibold tabular-nums">
                    {formatCurrency(footerTotal)}
                  </TableCell>
                  <TableCell colSpan={7} />
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Ver XML */}
      <Dialog open={xmlDialog.open} onOpenChange={(open) => setXmlDialog((prev) => ({ ...prev, open }))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              XML da NF-e {xmlDialog.numero} — {xmlDialog.fornecedor}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3">
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">{xmlDialog.xml}</pre>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => {
                navigator.clipboard.writeText(xmlDialog.xml);
                toast({ title: "Copiado!" });
              }}
            >
              <Copy className="h-3 w-3" /> Copiar XML
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={!xmlDialog.temXml}
              onClick={() =>
                baixarXmlNfe({ raw_xml: xmlDialog.xml, chave_acesso: xmlDialog.chave, numero: xmlDialog.numero })
              }
            >
              <Download className="h-3 w-3" /> Baixar XML
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vincular */}
      {vincularDialog.nfe && (
        <VincularPedidoNfeDialog
          open={vincularDialog.open}
          onOpenChange={(open) => setVincularDialog((prev) => ({ ...prev, open }))}
          nfe={{
            id: vincularDialog.nfe.id,
            numero: vincularDialog.nfe.numero,
            emitente_nome: vincularDialog.nfe.emitente_nome,
            emitente_cnpj: vincularDialog.nfe.emitente_cnpj,
            valor_total: vincularDialog.nfe.valor_total,
          }}
          onVinculado={() => {
            if (vincularDialog.nfe) queryClient.invalidateQueries({ queryKey: chaveDetalheNfe(vincularDialog.nfe.id) });
            setVincularDialog({ open: false, nfe: null });
            fetchRows();
          }}
        />
      )}

      {/* Desvincular */}
      <AlertDialog
        open={!!alertAction}
        onOpenChange={(open) => {
          if (!open) setAlertAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Desvinculação</AlertDialogTitle>
            <AlertDialogDescription>
              {alertAction && `Desvincular NF-e #${alertAction.nfe.numero} do pedido?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ComprasNotasFiscais;
