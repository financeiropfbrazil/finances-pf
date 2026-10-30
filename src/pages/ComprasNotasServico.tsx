import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileSpreadsheet,
  Hash,
  Loader2,
  Package,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  buscarXmlNfse,
  listarNfseRecebidas,
  type NfseRecebida,
  type ResultadoNfseRecebidas,
  type SituacaoAlvo,
  type SituacaoFisco,
} from "@/services/nfseRecebidasService";
import { NfseDetalheEtapas } from "@/components/nfse/NfseDetalheEtapas";
import { PeriodoPicker, atalhosPeriodo, type Periodo } from "@/components/PeriodoPicker";
import { buscarRelatorioEtapas, exportarEtapasXLSX } from "@/services/notasEtapasExport";
import { buscarRelatorioQuestor, exportarQuestorXLSX } from "@/services/notasQuestorExport";
import { formatCurrency, formatDate, formatDoc, formatInstanteBrt } from "@/components/nfse/nfseFormatos";

const ROTULO_FISCO: Record<SituacaoFisco, string> = {
  normal: "Normal",
  cancelada: "Cancelada",
  substituida: "Substituída",
};
/** Nome no padrão de download do ADN: <chave>-NFSe.xml. */
function baixarXml(xml: string, chave: string, numero: string | null) {
  const conteudo = xml.trimStart().startsWith("<?xml") ? xml : `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
  const nome = chave ? `${chave}-NFSe.xml` : `NFSe-${numero || "sem-numero"}.xml`;
  const url = URL.createObjectURL(new Blob([conteudo], { type: "application/xml;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const ComprasNotasServico = () => {
  const { toast } = useToast();
  const [periodo, setPeriodo] = useState<Periodo>(() => atalhosPeriodo(false)[0].periodo);
  const [dados, setDados] = useState<ResultadoNfseRecebidas | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  // Cada filtro diz qual eixo pergunta (PLANO-NFSE D6 / regra LIVRO × ESPELHO do CLAUDE.md).
  const [filtroFisco, setFiltroFisco] = useState<"todas" | SituacaoFisco>("todas");
  const [filtroAlvo, setFiltroAlvo] = useState<"todas" | SituacaoAlvo>("todas");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [carregandoXml, setCarregandoXml] = useState<string | null>(null);
  const [xmlDialog, setXmlDialog] = useState<{ open: boolean; nota: NfseRecebida | null; xml: string }>({
    open: false,
    nota: null,
    xml: "",
  });

  // ── Fetch ──
  const fetchRows = useCallback(async () => {
    if (!periodo.de || !periodo.ate) return;
    setLoading(true);
    try {
      setDados(await listarNfseRecebidas(periodo.de, periodo.ate));
    } catch (e) {
      setDados(null);
      toast({ title: "Erro", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [periodo.de, periodo.ate, toast]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const rows = useMemo(() => dados?.itens ?? [], [dados]);

  // ── Filtering ──
  const filtered = useMemo(() => {
    let list = rows;
    if (filtroFisco !== "todas") list = list.filter((r) => r.situacao_fisco === filtroFisco);
    if (filtroAlvo !== "todas") list = list.filter((r) => r.situacao_alvo === filtroAlvo);
    if (searchTerm.trim()) {
      const s = searchTerm.toLowerCase();
      const digitos = s.replace(/\D/g, "");
      list = list.filter(
        (r) =>
          (r.prestador_nome || "").toLowerCase().includes(s) ||
          (r.numero || "").toLowerCase().includes(s) ||
          (digitos.length > 0 && (r.prestador_doc || "").includes(digitos)),
      );
    }
    return list;
  }, [rows, filtroFisco, filtroAlvo, searchTerm]);

  // ── Downloads (NFSE-1.15 etapas · NFSE-1.16 contabilidade): período e notas da lista no momento do clique ──
  const filtrosDaTela = () => {
    const ROTULO_ALVO: Record<string, string> = {
      lancada_nfse: "lançada",
      lancada_outra_especie: "lançada em outra espécie",
      nao_lancada: "não lançada",
      sem_dado_alvo: "sem dado",
    };
    return [
      filtroFisco !== "todas" && `No fisco: ${filtroFisco === "substituida" ? "substituída" : filtroFisco}`,
      filtroAlvo !== "todas" && `No Alvo: ${ROTULO_ALVO[filtroAlvo] ?? filtroAlvo}`,
      searchTerm.trim() && `Busca: "${searchTerm.trim()}"`,
    ].filter(Boolean) as string[];
  };

  const [baixando, setBaixando] = useState(false);
  const baixarExcel = async () => {
    if (!periodo.de || !periodo.ate) return;
    setBaixando(true);
    try {
      const chaves = new Set(filtered.map((r) => r.chave_acesso));
      const linhas = (await buscarRelatorioEtapas("nfse", periodo.de, periodo.ate)).filter(
        (l) => l.chave_acesso && chaves.has(l.chave_acesso),
      );
      if (linhas.length === 0) {
        toast({ title: "Nada para baixar neste filtro" });
        return;
      }
      const r = await exportarEtapasXLSX("nfse", linhas, { de: periodo.de, ate: periodo.ate, filtros: filtrosDaTela() });
      toast({ title: "Excel baixado", description: `${r.linhas} nota(s) · ${r.arquivo}` });
    } catch (e) {
      toast({ title: "Não foi possível gerar o Excel", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBaixando(false);
    }
  };

  const [baixandoQuestor, setBaixandoQuestor] = useState(false);
  const baixarQuestor = async () => {
    if (!periodo.de || !periodo.ate) return;
    setBaixandoQuestor(true);
    try {
      const chaves = new Set(filtered.map((r) => r.chave_acesso));
      const rel = await buscarRelatorioQuestor(periodo.de, periodo.ate);
      const linhas = rel.linhas.filter((l) => chaves.has(l.chave_acesso));
      if (linhas.length === 0) {
        toast({ title: "Nada para baixar neste filtro" });
        return;
      }
      const r = await exportarQuestorXLSX({ ...rel, linhas }, { de: periodo.de, ate: periodo.ate, filtros: filtrosDaTela() });
      toast({
        title: "Excel para a contabilidade baixado",
        description: `${r.linhas} nota(s), ${r.semNatureza} sem natureza · ${r.arquivo}`,
      });
    } catch (e) {
      toast({ title: "Não foi possível gerar o Excel", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBaixandoQuestor(false);
    }
  };

  const footerTotal = useMemo(() => filtered.reduce((s, r) => s + (r.valor_servico || 0), 0), [filtered]);
  const ind = dados?.indicadores;
  const espelhoDesde = formatDate(dados?.alvo_espelho_desde);

  // ── Badges ──
  const fiscoBadge = (r: NfseRecebida) => {
    if (r.situacao_fisco === "normal")
      return (
        <Badge variant="outline" className="text-[10px]">
          Normal
        </Badge>
      );
    return (
      <Badge variant="destructive" className="text-[10px]">
        {ROTULO_FISCO[r.situacao_fisco]}
      </Badge>
    );
  };

  const alvoBadge = (r: NfseRecebida) => {
    if (r.situacao_alvo === "lancada_nfse")
      return (
        <Badge className="bg-success text-success-foreground hover:bg-success/90 text-[10px]">
          Lançada{r.alvo_data_entrada ? ` ${formatDate(r.alvo_data_entrada)}` : ""}
        </Badge>
      );
    if (r.situacao_alvo === "lancada_outra_especie")
      return (
        <Badge
          className="bg-info text-info-foreground hover:bg-info/90 text-[10px]"
          title={
            r.alvo_vinculo === "citado_na_nota"
              ? `No Alvo como ${r.alvo_especies ?? "outra espécie"} ${r.alvo_doc_numero ?? ""} — número citado na própria nota`
              : r.alvo_especies || ""
          }
        >
          Lançada como {r.alvo_especies || "outra espécie"}
        </Badge>
      );
    if (r.situacao_alvo === "sem_dado_alvo")
      return (
        <Badge
          variant="outline"
          className="text-[10px] text-muted-foreground"
          title={`O espelho do contas a pagar do Alvo só tem títulos com vencimento a partir de ${espelhoDesde}`}
        >
          Sem dado do Alvo
        </Badge>
      );
    if (r.situacao_fisco !== "normal")
      return (
        <Badge variant="outline" className="text-[10px]">
          Não lançada
        </Badge>
      );
    const atrasada = (r.dias_desde_emissao ?? 0) > 15;
    return (
      <Badge
        variant="outline"
        className={atrasada ? "text-[10px] border-warning text-warning" : "text-[10px]"}
        title={r.dias_desde_emissao != null ? `Emitida há ${r.dias_desde_emissao} dias` : undefined}
      >
        Não lançada{atrasada ? ` · ${r.dias_desde_emissao} d` : ""}
      </Badge>
    );
  };

  // ── XML ──
  const obterXml = async (r: NfseRecebida): Promise<string | null> => {
    setCarregandoXml(r.chave_acesso);
    try {
      const xml = await buscarXmlNfse(r.chave_acesso);
      if (!xml) toast({ title: "XML não encontrado", variant: "destructive" });
      return xml;
    } catch (e) {
      toast({ title: "Erro ao buscar o XML", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return null;
    } finally {
      setCarregandoXml(null);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Notas de Serviço (NFS-e)</h1>
        <p className="text-muted-foreground">
          NFS-e recebidas pelo ambiente nacional (ADN), com a situação de cada uma no fisco e no Alvo. Só leitura.
        </p>
      </div>

      {/* Filtros de período */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PeriodoPicker valor={periodo} onChange={setPeriodo} permitirTudo={false} />
          <span className="text-[11px] text-muted-foreground">pela data de emissão</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground" title="Última leitura do ambiente nacional (horário de Brasília)">
            Notas do ADN lidas até {formatInstanteBrt(dados?.atualizado_em)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={baixarExcel}
            disabled={baixando || loading || filtered.length === 0}
            className="gap-1"
            title="Excel de controle das etapas — com o período e os filtros da tela"
          >
            {baixando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Baixar Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={baixarQuestor}
            disabled={baixandoQuestor || loading || filtered.length === 0}
            className="gap-1"
            title="Natureza do Questor de cada nota, para a contabilidade — com o período e os filtros da tela"
          >
            {baixandoQuestor ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel p/ contabilidade
          </Button>
          <Button variant="outline" size="sm" onClick={fetchRows} disabled={loading} className="gap-1">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Atualizar
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Recebidas no período", value: ind?.recebidas ?? "—", icon: Hash },
          { label: "No Alvo: lançadas", value: ind?.lancadas ?? "—", icon: CheckCircle2 },
          {
            label: "No Alvo: não lançadas há +15 dias",
            value: ind ? `${ind.nao_lancadas_15d} · ${formatCurrency(ind.nao_lancadas_15d_valor)}` : "—",
            icon: Clock,
          },
          {
            label: "Canceladas no fisco e lançadas no Alvo",
            value: ind?.canceladas_e_lancadas ?? "—",
            icon: AlertTriangle,
          },
          { label: "Valor Total", value: formatCurrency(ind?.valor), icon: Package },
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
          placeholder="Buscar por prestador, CNPJ ou número..."
          className="h-8 text-xs sm:max-w-xs"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <Select value={filtroFisco} onValueChange={(v) => setFiltroFisco(v as typeof filtroFisco)}>
          <SelectTrigger className="h-8 w-52 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">No fisco: todas</SelectItem>
            <SelectItem value="normal">No fisco: normal</SelectItem>
            <SelectItem value="cancelada">No fisco: cancelada</SelectItem>
            <SelectItem value="substituida">No fisco: substituída</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroAlvo} onValueChange={(v) => setFiltroAlvo(v as typeof filtroAlvo)}>
          <SelectTrigger className="h-8 w-60 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">No Alvo: todas</SelectItem>
            <SelectItem value="lancada_nfse">No Alvo: lançada</SelectItem>
            <SelectItem value="lancada_outra_especie">No Alvo: lançada em outra espécie</SelectItem>
            <SelectItem value="nao_lancada">No Alvo: não lançada</SelectItem>
            <SelectItem value="sem_dado_alvo">No Alvo: sem dado (nota antiga)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-4">
        No fisco: o que o ambiente nacional diz da nota (eventos de cancelamento e substituição). No Alvo: título da
        nota no contas a pagar do Alvo (CNPJ do prestador + número), lido às 06h40 e às 12h40 (dias úteis) — nota
        lançada aparece na leitura seguinte. O espelho só tem títulos com vencimento a partir de {espelhoDesde}: nota mais antiga fica
        "Sem dado do Alvo".
      </p>

      {/* Tabela */}
      <Card>
        {/* minmax(0, 1fr): se a lista não couber, ela rola dentro do card em vez de alargar a página inteira. */}
        <CardContent className="grid grid-cols-[minmax(0,1fr)] p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Nenhuma NFS-e encontrada no período.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6 px-1" />
                  <TableHead className="text-xs px-2">Número</TableHead>
                  <TableHead className="text-xs px-2">Prestador</TableHead>
                  <TableHead className="text-xs px-2">CNPJ/CPF</TableHead>
                  <TableHead className="text-xs px-2">Município</TableHead>
                  <TableHead className="text-xs text-right px-2">V. Serviço</TableHead>
                  <TableHead className="text-xs px-2">Emissão</TableHead>
                  <TableHead className="text-xs px-2">No fisco</TableHead>
                  <TableHead className="text-xs px-2">No Alvo</TableHead>
                  <TableHead className="text-xs px-2">Pedido no Alvo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <NotaLinha
                    key={r.chave_acesso}
                    r={r}
                    expandida={expandedId === r.chave_acesso}
                    onToggle={() => setExpandedId(expandedId === r.chave_acesso ? null : r.chave_acesso)}
                    fiscoBadge={fiscoBadge(r)}
                    alvoBadge={alvoBadge(r)}
                    carregandoXml={carregandoXml === r.chave_acesso}
                    onVerXml={async () => {
                      const xml = await obterXml(r);
                      if (xml) setXmlDialog({ open: true, nota: r, xml });
                    }}
                    onBaixarXml={async () => {
                      const xml = await obterXml(r);
                      if (xml) baixarXml(xml, r.chave_acesso, r.numero);
                    }}
                  />
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={5} className="text-xs">
                    Total: {filtered.length} NFS-e
                  </TableCell>
                  <TableCell className="text-xs text-right font-semibold tabular-nums">
                    {formatCurrency(footerTotal)}
                  </TableCell>
                  <TableCell colSpan={4} />
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
              XML da NFS-e {xmlDialog.nota?.numero} — {xmlDialog.nota?.prestador_nome}
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
              onClick={() =>
                xmlDialog.nota && baixarXml(xmlDialog.xml, xmlDialog.nota.chave_acesso, xmlDialog.nota.numero)
              }
            >
              <Download className="h-3 w-3" /> Baixar XML
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function NotaLinha({
  r,
  expandida,
  onToggle,
  fiscoBadge,
  alvoBadge,
  carregandoXml,
  onVerXml,
  onBaixarXml,
}: {
  r: NfseRecebida;
  expandida: boolean;
  onToggle: () => void;
  fiscoBadge: JSX.Element;
  alvoBadge: JSX.Element;
  carregandoXml: boolean;
  onVerXml: () => void;
  onBaixarXml: () => void;
}) {
  return (
    <>
      <TableRow
        className={expandida ? "cursor-pointer bg-accent/60" : "cursor-pointer hover:bg-muted/50"}
        onClick={onToggle}
      >
        <TableCell className="px-1">
          {expandida ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="text-xs px-2 tabular-nums">{r.numero || "—"}</TableCell>
        <TableCell className="text-xs max-w-[200px] truncate px-2" title={r.prestador_nome || ""}>
          {r.prestador_nome || "—"}
        </TableCell>
        <TableCell className="text-xs whitespace-nowrap px-2 tabular-nums">{formatDoc(r.prestador_doc)}</TableCell>
        <TableCell className="text-xs max-w-[140px] truncate px-2">{r.municipio_emissor || "—"}</TableCell>
        <TableCell className="text-xs text-right whitespace-nowrap font-medium px-2 tabular-nums">
          {formatCurrency(r.valor_servico)}
        </TableCell>
        <TableCell className="text-xs px-2 tabular-nums">{formatDate(r.data_emissao)}</TableCell>
        <TableCell className="whitespace-nowrap px-2">{fiscoBadge}</TableCell>
        <TableCell className="whitespace-nowrap px-2">{alvoBadge}</TableCell>
        <TableCell className="text-xs px-2 tabular-nums">{r.alvo_pedido || "—"}</TableCell>
      </TableRow>

      {expandida && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={10} className="p-0">
            <NfseDetalheEtapas
              nota={r}
              carregandoXml={carregandoXml}
              onVerXml={onVerXml}
              onBaixarXml={onBaixarXml}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default ComprasNotasServico;
