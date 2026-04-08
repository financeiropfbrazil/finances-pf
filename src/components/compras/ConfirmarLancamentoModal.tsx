import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty, CommandGroup } from "@/components/ui/command";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, Plus, Trash2, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────

export interface ClasseCCRow {
  id: string;
  codigo: string;
  nome: string;
  percentual: number;
  valor: number;
}

export interface ClasseRow {
  id: string;
  codigoClasseRecDesp: string;
  nomeClasse: string;
  percentual: number;
  valor: number;
  centrosCusto: ClasseCCRow[];
}

export interface ParcelaInput {
  sequencia: number;
  numeroDuplicata: string;
  dataEmissao: string;
  valorParcela: number;
  dataVencimento: string;
}

export interface ImpostosInput {
  baseISS: number; aliquotaISS: number; valorISS: number; deduzISSValorTotal: boolean;
  baseIRRF: number; aliquotaIRRF: number; valorIRRF: number; deduzIRRFValorTotal: boolean;
  baseINSS: number; aliquotaINSS: number; valorINSS: number; deduzINSSValorTotal: boolean;
  basePIS: number; aliquotaPIS: number; valorPIS: number; deduzPISValorTotal: boolean;
  baseCOFINS: number; aliquotaCOFINS: number; valorCOFINS: number; deduzCOFINSValorTotal: boolean;
  baseCSLL: number; aliquotaCSLL: number; valorCSLL: number; deduzCSLLValorTotal: boolean;
}

export interface DadosLancamento {
  classes: ClasseRow[];
  codigoCondPag: string;
  nomeCondPag: string;
  codigoProduto: string;
  nomeProduto: string;
  sequenciaItemPedComp: number;
  codigoEntidade: string;
  impostos: ImpostosInput;
  parcelas: ParcelaInput[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nfse: {
    id: string;
    numero: string | null;
    serie?: string | null;
    prestador_nome: string | null;
    prestador_cnpj: string | null;
    valor_servico: number | null;
    data_emissao: string | null;
    pedido_compra_numero: string | null;
    pedido_compra_entidade: string | null;
    pedido_compra_cond_pagamento: string | null;
    valor_iss: number | null;
    valor_iss_retido: number | null;
    iss_retido: boolean | null;
    base_calculo_iss: number | null;
    aliquota_iss: number | null;
    valor_pis: number | null;
    valor_cofins: number | null;
    valor_retencao_inss: number | null;
    valor_retencao_irrf: number | null;
    valor_retencao_csll: number | null;
    valor_deducoes: number | null;
    raw_xml: string | null;
  };
  onConfirmarLancamento: (dadosEditados: DadosLancamento) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

const uid = () => crypto.randomUUID();

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

const fmtCnpj = (c: string | null) => {
  if (!c) return "";
  const d = c.replace(/\D/g, "");
  if (d.length !== 14) return c;
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
};

const fmtDate = (d: string | null) => {
  if (!d) return "";
  try { return new Date(d).toLocaleDateString("pt-BR"); } catch { return d; }
};

const fmtDateISO = (d: Date) => d.toISOString().slice(0, 10);

// ── SearchableSelect (condPag only) ──────────────────────────────────

interface SearchableSelectProps {
  value: string;
  onValueChange: (codigo: string, nome: string) => void;
  options: { codigo: string; nome: string }[];
  placeholder?: string;
  className?: string;
}

function SearchableSelect({ value, onValueChange, options, placeholder = "Selecione...", className }: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find(o => o.codigo === value);
  const displayLabel = selected ? `${selected.codigo} — ${selected.nome}` : "";
  const filtered = useMemo(() => {
    if (!search) return options.slice(0, 50);
    const q = search.toLowerCase();
    return options.filter(o => o.codigo.toLowerCase().includes(q) || o.nome.toLowerCase().includes(q)).slice(0, 50);
  }, [options, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className={cn("justify-between font-normal truncate", className)}>
          <span className="truncate">{displayLabel || <span className="text-muted-foreground">{placeholder}</span>}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar..." value={search} onValueChange={setSearch} className="h-8 text-xs" />
          <CommandList className="max-h-48">
            <CommandEmpty className="py-2 text-center text-xs text-muted-foreground">Nenhum resultado</CommandEmpty>
            <CommandGroup>
              {filtered.map(o => (
                <CommandItem key={o.codigo} value={o.codigo} onSelect={() => { onValueChange(o.codigo, o.nome); setOpen(false); setSearch(""); }} className="text-xs">
                  <Check className={cn("mr-1 h-3 w-3", value === o.codigo ? "opacity-100" : "opacity-0")} />
                  {o.codigo} — {o.nome}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Internal types ───────────────────────────────────────────────────

interface CondPagOption { codigo: string; nome: string }
interface CondPagRow { codigo: string; nome: string; quantidade_parcelas: number | null; dias_entre_parcelas: number | null; primeiro_vencimento_apos: number | null }
interface CondPagParcelaRow { codigo_cond_pag: string; numero: number; dias_prazo: number; percentual_fracao: number | null; }
interface PedidoItem { codigoProduto: string; nomeProduto: string; sequencia: number }
interface ClasseOption { codigo: string; nome: string; }
interface CCOption { codigo: string; nome: string; }

// ── Component ──────────────────────────────────────────────────────────

export default function ConfirmarLancamentoModal({ open, onOpenChange, nfse, onConfirmarLancamento }: Props) {
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<ClasseRow[]>([]);
  const [codigoCondPag, setCodigoCondPag] = useState("");
  const [nomeCondPag, setNomeCondPag] = useState("");
  const [codigoProduto, setCodigoProduto] = useState("");
  const [nomeProduto, setNomeProduto] = useState("");
  const [seqItem, setSeqItem] = useState(1);
  const [codigoEntidade, setCodigoEntidade] = useState("");

  const [condPagOptions, setCondPagOptions] = useState<CondPagOption[]>([]);
  const [condPagFull, setCondPagFull] = useState<CondPagRow[]>([]);
  const [condPagParcelas, setCondPagParcelas] = useState<CondPagParcelaRow[]>([]);
  const [classeOptions, setClasseOptions] = useState<ClasseOption[]>([]);
  const [ccOptions, setCcOptions] = useState<CCOption[]>([]);

  const [impostos, setImpostos] = useState<ImpostosInput>({
    baseISS: 0, aliquotaISS: 0, valorISS: 0, deduzISSValorTotal: false,
    baseIRRF: 0, aliquotaIRRF: 0, valorIRRF: 0, deduzIRRFValorTotal: false,
    baseINSS: 0, aliquotaINSS: 0, valorINSS: 0, deduzINSSValorTotal: false,
    basePIS: 0, aliquotaPIS: 0, valorPIS: 0, deduzPISValorTotal: false,
    baseCOFINS: 0, aliquotaCOFINS: 0, valorCOFINS: 0, deduzCOFINSValorTotal: false,
    baseCSLL: 0, aliquotaCSLL: 0, valorCSLL: 0, deduzCSLLValorTotal: false,
  });

  const [parcelas, setParcelas] = useState<ParcelaInput[]>([]);

  const valorNfse = nfse.valor_servico ?? 0;

  const dadosOriginais = useRef<{
    classes: ClasseRow[];
    codigoCondPag: string;
    nomeCondPag: string;
    codigoProduto: string;
    nomeProduto: string;
  } | null>(null);

  // ── Generate parcelas from condPag ────────────────────────────────

  const gerarParcelas = useCallback((condPagCodigo: string, parcelasCondPag: CondPagParcelaRow[]) => {
    const parcelasDaCond = parcelasCondPag
      .filter(p => p.codigo_cond_pag === condPagCodigo)
      .sort((a, b) => a.numero - b.numero);

    if (parcelasDaCond.length === 0) {
      // Fallback: parcela única no dia da emissão
      const dt = nfse.data_emissao ? new Date(nfse.data_emissao + "T12:00:00") : new Date();
      setParcelas([{
        sequencia: 1,
        numeroDuplicata: `${nfse.numero || "0"}/1-1`,
        dataEmissao: fmtDateISO(dt),
        valorParcela: valorNfse,
        dataVencimento: fmtDateISO(dt),
      }]);
      return;
    }

    const qtd = parcelasDaCond.length;
    const dtEmissao = nfse.data_emissao ? new Date(nfse.data_emissao + "T12:00:00") : new Date();

    // Determina se usa percentual_fracao explícito ou fração igual
    const somaPct = parcelasDaCond.reduce((s, p) => s + (p.percentual_fracao || 0), 0);
    const usaPercentual = somaPct > 99 && somaPct < 101; // tolerância

    const novas: ParcelaInput[] = [];
    let acumulado = 0;

    for (let i = 0; i < qtd; i++) {
      const pc = parcelasDaCond[i];
      const isLast = i === qtd - 1;

      let val: number;
      if (usaPercentual) {
        val = isLast
          ? Math.round((valorNfse - acumulado) * 100) / 100
          : Math.round(valorNfse * (pc.percentual_fracao || 0) / 100 * 100) / 100;
      } else {
        const valorBase = Math.floor(valorNfse / qtd * 100) / 100;
        val = isLast ? Math.round((valorNfse - valorBase * (qtd - 1)) * 100) / 100 : valorBase;
      }
      acumulado += val;

      const dtVenc = new Date(dtEmissao);
      dtVenc.setDate(dtVenc.getDate() + pc.dias_prazo);

      novas.push({
        sequencia: pc.numero,
        numeroDuplicata: `${nfse.numero || "0"}/${pc.numero}-${qtd}`,
        dataEmissao: fmtDateISO(dtEmissao),
        valorParcela: val,
        dataVencimento: fmtDateISO(dtVenc),
      });
    }
    setParcelas(novas);
  }, [valorNfse, nfse.data_emissao, nfse.numero]);

  // ── Load data on open ──────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      const [pedidoRes, condRes, classeRes, ccRes, parcCondRes] = await Promise.all([
        nfse.pedido_compra_numero
          ? supabase.from("compras_pedidos")
              .select("itens, classe_rateio, codigo_cond_pag, nome_cond_pag, codigo_entidade")
              .eq("numero", nfse.pedido_compra_numero)
              .eq("codigo_empresa_filial", "1.01")
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from("condicoes_pagamento").select("codigo, nome, quantidade_parcelas, dias_entre_parcelas, primeiro_vencimento_apos").order("codigo"),
        supabase.from("classes_rec_desp").select("codigo, nome").eq("grupo", "F").eq("is_active", true).order("codigo"),
        supabase.from("cost_centers").select("erp_code, name").eq("group_type", "F").eq("is_active", true).order("erp_code"),
        (supabase as any).from("condicoes_pagamento_parcelas").select("codigo_cond_pag, numero, dias_prazo, percentual_fracao").order("codigo_cond_pag").order("numero"),
      ]);

      if (cancelled) return;

      const condRows = (condRes.data as CondPagRow[]) || [];
      setCondPagFull(condRows);
      setCondPagOptions(condRows.map(c => ({ codigo: c.codigo, nome: c.nome })));

      const parcCondRows = (parcCondRes.data as CondPagParcelaRow[]) || [];
      setCondPagParcelas(parcCondRows);

      const classeRows = (classeRes.data as { codigo: string; nome: string }[]) || [];
      setClasseOptions(classeRows);
      const ccRows = (ccRes.data as { erp_code: string; name: string }[]) || [];
      setCcOptions(ccRows.map(c => ({ codigo: c.erp_code, nome: c.name })));

      const pedido = pedidoRes.data as any;

      // Itens do pedido
      const itens = (pedido?.itens as any[]) || [];
      const first = itens[0];
      const prodCod = first?.codigoProduto || first?.CodigoProduto || "002.003";
      const prodNom = first?.nomeProduto || first?.NomeProduto || "SERVIÇO";
      const seq = first?.sequencia ?? first?.Sequencia ?? 1;
      setCodigoProduto(prodCod);
      setNomeProduto(prodNom);
      setSeqItem(seq);

      const cpCod = pedido?.codigo_cond_pag || (nfse.pedido_compra_cond_pagamento || "").split(" ")[0] || "";
      const cpNome = pedido?.nome_cond_pag || nfse.pedido_compra_cond_pagamento || "";
      setCodigoCondPag(cpCod);
      setNomeCondPag(cpNome);

      setCodigoEntidade(nfse.pedido_compra_entidade || pedido?.codigo_entidade || "");

      // Classes + CCs from classe_rateio (readonly)
      const rateio = (pedido?.classe_rateio as any[]) || [];
      if (rateio.length > 0) {
        const built: ClasseRow[] = rateio.map((cr: any) => {
          const pct = cr.percentual || 0;
          const val = Math.round(valorNfse * pct / 100 * 100) / 100;
          const ccs: ClasseCCRow[] = (cr.centrosCusto || []).map((cc: any) => ({
            id: uid(), codigo: cc.codigo || "", nome: cc.nome || "",
            percentual: cc.percentual || 100,
            valor: Math.round(val * (cc.percentual || 100) / 100 * 100) / 100,
          }));
          return {
            id: uid(), codigoClasseRecDesp: cr.classe || "", nomeClasse: cr.nomeClasse || "",
            percentual: pct, valor: val,
            centrosCusto: ccs.length > 0 ? ccs : [{ id: uid(), codigo: "", nome: "", percentual: 100, valor: val }],
          };
        });
        const sumBuilt = built.reduce((s, c) => s + c.valor, 0);
        const diff = Math.round((valorNfse - sumBuilt) * 100) / 100;
        if (diff !== 0 && built.length > 0) {
          built[built.length - 1].valor = Math.round((built[built.length - 1].valor + diff) * 100) / 100;
        }
        setClasses(built);
        dadosOriginais.current = { classes: JSON.parse(JSON.stringify(built)), codigoCondPag: cpCod, nomeCondPag: cpNome, codigoProduto: prodCod, nomeProduto: prodNom };
      } else {
        const defaultClasses: ClasseRow[] = [{ id: uid(), codigoClasseRecDesp: "", nomeClasse: "", percentual: 100, valor: valorNfse, centrosCusto: [{ id: uid(), codigo: "", nome: "", percentual: 100, valor: valorNfse }] }];
        setClasses(defaultClasses);
        dadosOriginais.current = { classes: JSON.parse(JSON.stringify(defaultClasses)), codigoCondPag: cpCod, nomeCondPag: cpNome, codigoProduto: prodCod, nomeProduto: prodNom };
      }

      // Só carrega ISS se iss_retido === true; demais retenções zeradas.
      const issRet = nfse.iss_retido === true;
      setImpostos({
        baseISS: issRet ? (nfse.base_calculo_iss || 0) : 0,
        aliquotaISS: issRet ? (nfse.aliquota_iss || 0) : 0,
        valorISS: issRet ? (nfse.valor_iss || 0) : 0,
        deduzISSValorTotal: false,
        baseIRRF: 0, aliquotaIRRF: 0, valorIRRF: 0, deduzIRRFValorTotal: false,
        baseINSS: 0, aliquotaINSS: 0, valorINSS: 0, deduzINSSValorTotal: false,
        basePIS: 0, aliquotaPIS: 0, valorPIS: 0, deduzPISValorTotal: false,
        baseCOFINS: 0, aliquotaCOFINS: 0, valorCOFINS: 0, deduzCOFINSValorTotal: false,
        baseCSLL: 0, aliquotaCSLL: 0, valorCSLL: 0, deduzCSLLValorTotal: false,
      });

      // Parcelas
      gerarParcelas(cpCod, (parcCondRes.data as CondPagParcelaRow[]) || []);

      setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [open, nfse.pedido_compra_numero, nfse.pedido_compra_entidade, nfse.pedido_compra_cond_pagamento, valorNfse, gerarParcelas,
    nfse.base_calculo_iss, nfse.aliquota_iss, nfse.valor_iss, nfse.valor_retencao_irrf, nfse.valor_retencao_inss,
    nfse.valor_pis, nfse.valor_cofins, nfse.valor_retencao_csll]);

  // ── Imposto field change ──────────────────────────────────────────

  const handleImpostoChange = useCallback((
    prefix: "ISS" | "IRRF" | "INSS" | "PIS" | "COFINS" | "CSLL",
    field: "base" | "aliquota" | "valor" | "deduz",
    rawValue: number | boolean,
  ) => {
    setImpostos(prev => {
      const next = { ...prev };
      const baseKey = `base${prefix}` as keyof ImpostosInput;
      const aliqKey = `aliquota${prefix}` as keyof ImpostosInput;
      const valKey = `valor${prefix}` as keyof ImpostosInput;
      const dedKey = `deduz${prefix}ValorTotal` as keyof ImpostosInput;

      if (field === "deduz") {
        (next as any)[dedKey] = rawValue as boolean;
      } else if (field === "base") {
        (next as any)[baseKey] = rawValue as number;
        (next as any)[valKey] = Math.round((rawValue as number) * (prev[aliqKey] as number) / 100 * 100) / 100;
      } else if (field === "aliquota") {
        (next as any)[aliqKey] = rawValue as number;
        (next as any)[valKey] = Math.round((prev[baseKey] as number) * (rawValue as number) / 100 * 100) / 100;
      } else if (field === "valor") {
        (next as any)[valKey] = rawValue as number;
        const base = prev[baseKey] as number;
        (next as any)[aliqKey] = base > 0 ? Math.round((rawValue as number) / base * 100 * 10000) / 10000 : 0;
      }
      return next;
    });
  }, []);

  // ── Parcela mutations ─────────────────────────────────────────────

  const addParcela = useCallback(() => {
    setParcelas(prev => {
      const seq = prev.length + 1;
      const dtEmissao = nfse.data_emissao ? new Date(nfse.data_emissao) : new Date();
      const dtVenc = new Date(dtEmissao);
      dtVenc.setDate(dtVenc.getDate() + 30 * seq);
      return [...prev, {
        sequencia: seq,
        numeroDuplicata: `${nfse.numero || "0"}/${seq}-${seq}`,
        dataEmissao: fmtDateISO(dtEmissao),
        valorParcela: 0,
        dataVencimento: fmtDateISO(dtVenc),
      }];
    });
  }, [nfse.data_emissao, nfse.numero]);

  const addClasse = useCallback(() => {
    setClasses(prev => [...prev, {
      id: uid(), codigoClasseRecDesp: "", nomeClasse: "",
      percentual: 0, valor: 0,
      centrosCusto: [{ id: uid(), codigo: "", nome: "", percentual: 100, valor: 0 }],
    }]);
  }, []);

  const removeClasse = useCallback((classeId: string) => {
    setClasses(prev => prev.filter(c => c.id !== classeId));
  }, []);

  const updateClasseCodigo = useCallback((classeId: string, codigo: string, nome: string) => {
    setClasses(prev => prev.map(c => c.id === classeId ? { ...c, codigoClasseRecDesp: codigo, nomeClasse: nome } : c));
  }, []);

  const updateClasseValor = useCallback((classeId: string, valor: number) => {
    setClasses(prev => prev.map(c => {
      if (c.id !== classeId) return c;
      const pct = valorNfse > 0 ? Math.round(valor / valorNfse * 10000) / 100 : 0;
      return { ...c, valor, percentual: pct };
    }));
  }, [valorNfse]);

  const addCC = useCallback((classeId: string) => {
    setClasses(prev => prev.map(c => c.id === classeId
      ? { ...c, centrosCusto: [...c.centrosCusto, { id: uid(), codigo: "", nome: "", percentual: 0, valor: 0 }] }
      : c));
  }, []);

  const removeCC = useCallback((classeId: string, ccId: string) => {
    setClasses(prev => prev.map(c => c.id === classeId
      ? { ...c, centrosCusto: c.centrosCusto.filter(cc => cc.id !== ccId) }
      : c));
  }, []);

  const updateCCCodigo = useCallback((classeId: string, ccId: string, codigo: string, nome: string) => {
    setClasses(prev => prev.map(c => c.id === classeId
      ? { ...c, centrosCusto: c.centrosCusto.map(cc => cc.id === ccId ? { ...cc, codigo, nome } : cc) }
      : c));
  }, []);

  const updateCCValor = useCallback((classeId: string, ccId: string, valor: number) => {
    setClasses(prev => prev.map(c => {
      if (c.id !== classeId) return c;
      return {
        ...c,
        centrosCusto: c.centrosCusto.map(cc => {
          if (cc.id !== ccId) return cc;
          const pct = c.valor > 0 ? Math.round(valor / c.valor * 10000) / 100 : 0;
          return { ...cc, valor, percentual: pct };
        }),
      };
    }));
  }, []);

  const removeParcela = useCallback((seq: number) => {
    setParcelas(prev => prev.filter(p => p.sequencia !== seq).map((p, i) => ({ ...p, sequencia: i + 1 })));
  }, []);

  const updateParcela = useCallback((seq: number, field: "dataVencimento", value: string) => {
    setParcelas(prev => prev.map(p => p.sequencia === seq ? { ...p, [field]: value } : p));
  }, []);

  // ── Validation ─────────────────────────────────────────────────────

  const totalParcelas = useMemo(() => Math.round(parcelas.reduce((s, p) => s + p.valorParcela, 0) * 100) / 100, [parcelas]);
  const difParcelas = useMemo(() => Math.round((valorNfse - totalParcelas) * 100) / 100, [valorNfse, totalParcelas]);

  const totalClasses = useMemo(() => Math.round(classes.reduce((s, c) => s + c.valor, 0) * 100) / 100, [classes]);
  const difClasses = useMemo(() => Math.round((valorNfse - totalClasses) * 100) / 100, [valorNfse, totalClasses]);

  const classesValidas = useMemo(() => {
    if (classes.length === 0) return false;
    for (const c of classes) {
      if (!c.codigoClasseRecDesp) return false;
      if (c.centrosCusto.length === 0) return false;
      const totCC = Math.round(c.centrosCusto.reduce((s, cc) => s + cc.valor, 0) * 100) / 100;
      if (Math.abs(totCC - c.valor) > 0.01) return false;
      for (const cc of c.centrosCusto) { if (!cc.codigo) return false; }
    }
    return true;
  }, [classes]);

  const podeLancar = classesValidas && difClasses === 0 && !!codigoCondPag
    && difParcelas === 0 && parcelas.length > 0 && !loading;

  // ── Audit ─────────────────────────────────────────────────────────

  const registrarAlteracoes = async (dadosFinais: DadosLancamento) => {
    const orig = dadosOriginais.current;
    if (!orig) return;
    const user = (await supabase.auth.getUser()).data.user;
    const usuario = user?.email || "desconhecido";
    const alteracoes: any[] = [];
    const nfseId = nfse.id;
    const numNfse = nfse.numero || "";
    const numPed = nfse.pedido_compra_numero || "";

    if (orig.codigoCondPag !== dadosFinais.codigoCondPag) {
      alteracoes.push({ compras_nfse_id: nfseId, numero_nfse: numNfse, pedido_numero: numPed, campo: "cond_pagamento", valor_anterior: `${orig.codigoCondPag} (${orig.nomeCondPag})`, valor_novo: `${dadosFinais.codigoCondPag} (${dadosFinais.nomeCondPag})`, usuario });
    }
    if (orig.codigoProduto !== dadosFinais.codigoProduto) {
      alteracoes.push({ compras_nfse_id: nfseId, numero_nfse: numNfse, pedido_numero: numPed, campo: "produto", valor_anterior: `${orig.codigoProduto} (${orig.nomeProduto})`, valor_novo: `${dadosFinais.codigoProduto} (${dadosFinais.nomeProduto})`, usuario });
    }
    if (alteracoes.length > 0) {
      await supabase.from("compras_lancamento_auditoria" as any).insert(alteracoes as any);
      console.log(`[Auditoria] ${alteracoes.length} alteração(ões) registrada(s) para NFS-e ${numNfse}`);
    }
  };

  // ── Submit ────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    const dados: DadosLancamento = {
      classes,
      codigoCondPag,
      nomeCondPag,
      codigoProduto,
      nomeProduto,
      sequenciaItemPedComp: seqItem,
      codigoEntidade,
      impostos,
      parcelas,
    };
    await registrarAlteracoes(dados);
    onConfirmarLancamento(dados);
  };

  // ── Render ─────────────────────────────────────────────────────────

  const impostoBlocks: { prefix: "ISS" | "IRRF" | "INSS" | "PIS" | "COFINS" | "CSLL"; label: string }[] = [
    { prefix: "ISS", label: "ISS" },
    { prefix: "IRRF", label: "IRRF" },
    { prefix: "INSS", label: "INSS" },
    { prefix: "PIS", label: "PIS RF" },
    { prefix: "COFINS", label: "COFINS RF" },
    { prefix: "CSLL", label: "CSLL RF" },
  ];

  const getImpostoValor = (prefix: string) => (impostos as any)[`valor${prefix}`] as number;

  const defaultOpenItems = impostoBlocks
    .filter(b => getImpostoValor(b.prefix) > 0)
    .map(b => b.prefix);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl p-0 gap-0 flex flex-col max-h-[90vh]"
        onPointerDownOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
      >
        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="text-base">Confirmar Lançamento no ERP</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Confira os dados abaixo antes de enviar para o Alvo.
          </DialogDescription>
        </DialogHeader>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">Carregando dados do pedido...</div>
          ) : (
            <>
              {/* ── Seção 1: Documento (readonly) ── */}
              <section className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Documento</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                  <Field label="Número" value={nfse.numero || "—"} />
                  <Field label="Série" value={nfse.serie || "1"} />
                  <Field label="Data Emissão" value={fmtDate(nfse.data_emissao)} />
                  <Field label="Valor Serviço" value={fmt(valorNfse)} highlight />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2">
                  <Field label="Prestador" value={nfse.prestador_nome || "—"} />
                  <Field label="CNPJ" value={fmtCnpj(nfse.prestador_cnpj)} />
                  <Field label="Entidade no Alvo" value={codigoEntidade || "—"} />
                </div>
              </section>

              {/* ── Seção: Classes e Centros de Custo ── */}
              <section className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Classes e Centros de Custo</h4>
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={addClasse}>
                    <Plus className="h-3 w-3 mr-1" /> Classe
                  </Button>
                </div>

                <div className="space-y-3">
                  {classes.map((classe) => {
                    const totCC = Math.round(classe.centrosCusto.reduce((s, cc) => s + cc.valor, 0) * 100) / 100;
                    const difCC = Math.round((classe.valor - totCC) * 100) / 100;
                    return (
                      <div key={classe.id} className="rounded-md border bg-muted/20 p-3 space-y-2">
                        <div className="flex items-start gap-2">
                          <div className="flex-1 space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Classe</Label>
                            <SearchableSelect
                              value={classe.codigoClasseRecDesp}
                              onValueChange={(cod, nome) => updateClasseCodigo(classe.id, cod, nome)}
                              options={classeOptions}
                              placeholder="Selecione classe..."
                              className="h-8 text-xs w-full"
                            />
                          </div>
                          <div className="w-32 space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Valor (R$)</Label>
                            <Input type="number" step="0.01"
                              className="h-8 text-xs text-right tabular-nums"
                              value={classe.valor || ""}
                              onChange={e => updateClasseValor(classe.id, parseFloat(e.target.value) || 0)} />
                          </div>
                          <Button variant="ghost" size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive mt-5"
                            onClick={() => removeClasse(classe.id)}
                            disabled={classes.length <= 1}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>

                        <div className="pl-4 border-l-2 border-border space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-[11px] text-muted-foreground">Centros de Custo</Label>
                            <Button variant="ghost" size="sm" className="text-[11px] h-6 px-2" onClick={() => addCC(classe.id)}>
                              <Plus className="h-3 w-3 mr-1" /> CC
                            </Button>
                          </div>

                          {classe.centrosCusto.map((cc) => (
                            <div key={cc.id} className="flex items-start gap-2">
                              <div className="flex-1">
                                <SearchableSelect
                                  value={cc.codigo}
                                  onValueChange={(cod, nome) => updateCCCodigo(classe.id, cc.id, cod, nome)}
                                  options={ccOptions}
                                  placeholder="Selecione centro..."
                                  className="h-8 text-xs w-full"
                                />
                              </div>
                              <div className="w-32">
                                <Input type="number" step="0.01"
                                  className="h-8 text-xs text-right tabular-nums"
                                  value={cc.valor || ""}
                                  onChange={e => updateCCValor(classe.id, cc.id, parseFloat(e.target.value) || 0)} />
                              </div>
                              <Button variant="ghost" size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => removeCC(classe.id, cc.id)}
                                disabled={classe.centrosCusto.length <= 1}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}

                          {difCC !== 0 && (
                            <p className="text-[11px] text-destructive font-medium">
                              Soma dos CCs ({fmt(totCC)}) não bate com valor da classe ({fmt(classe.valor)}) — dif: {fmt(difCC)}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between px-1 pt-2 border-t">
                  <span className="text-xs font-medium text-muted-foreground">Total Classes</span>
                  <div className="flex items-center gap-3">
                    <span className={cn("text-sm font-semibold tabular-nums", difClasses !== 0 ? "text-destructive" : "text-foreground")}>
                      {fmt(totalClasses)}
                    </span>
                    <span className={cn("text-xs tabular-nums", difClasses !== 0 ? "text-destructive font-medium" : "text-muted-foreground")}>
                      {difClasses !== 0 ? `(dif: ${fmt(difClasses)})` : `= ${fmt(valorNfse)}`}
                    </span>
                  </div>
                </div>
              </section>

              {/* ── Seção 2: Impostos e Deduções ── */}
              <section className="rounded-lg border p-4 space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Impostos e Deduções</h4>
                <Accordion type="multiple" defaultValue={defaultOpenItems} className="space-y-1.5">
                  {impostoBlocks.map(({ prefix, label }) => {
                    const val = getImpostoValor(prefix);
                    const baseKey = `base${prefix}` as keyof ImpostosInput;
                    const aliqKey = `aliquota${prefix}` as keyof ImpostosInput;
                    const valKey = `valor${prefix}` as keyof ImpostosInput;
                    const dedKey = `deduz${prefix}ValorTotal` as keyof ImpostosInput;

                    return (
                      <AccordionItem key={prefix} value={prefix} className="border rounded-md px-3">
                        <AccordionTrigger className="py-2.5 text-sm hover:no-underline">
                          <span className="flex items-center gap-2">
                            <span className="font-medium text-xs">{label}</span>
                            <span className={cn("text-xs tabular-nums", val > 0 ? "text-foreground" : "text-muted-foreground")}>
                              — {fmt(val)}
                            </span>
                          </span>
                        </AccordionTrigger>
                        <AccordionContent className="pb-3 pt-1">
                          <div className="grid grid-cols-3 gap-3 mb-3">
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">Base</Label>
                              <Input
                                type="number" step="0.01" className="h-8 text-xs text-right tabular-nums"
                                value={impostos[baseKey] as number || ""}
                                onChange={e => handleImpostoChange(prefix, "base", parseFloat(e.target.value) || 0)}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">Alíquota %</Label>
                              <Input
                                type="number" step="0.01" className="h-8 text-xs text-right tabular-nums"
                                value={impostos[aliqKey] as number || ""}
                                onChange={e => handleImpostoChange(prefix, "aliquota", parseFloat(e.target.value) || 0)}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">Valor</Label>
                              <Input
                                type="number" step="0.01" className="h-8 text-xs text-right tabular-nums"
                                value={impostos[valKey] as number || ""}
                                onChange={e => handleImpostoChange(prefix, "valor", parseFloat(e.target.value) || 0)}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={impostos[dedKey] as boolean}
                              onCheckedChange={v => handleImpostoChange(prefix, "deduz", v)}
                            />
                            <Label className="text-xs text-muted-foreground">Deduzir do valor total</Label>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </section>

              {/* ── Seção 3: Parcelas ── */}
              <section className="rounded-lg border p-4 space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Parcelas</h4>

                <div className="max-w-xs space-y-1">
                  <Label className="text-[11px] text-muted-foreground">Condição de Pagamento</Label>
                  <SearchableSelect
                    value={codigoCondPag}
                    onValueChange={(cod, nome) => {
                      setCodigoCondPag(cod);
                      setNomeCondPag(nome);
                      gerarParcelas(cod, condPagParcelas);
                    }}
                    options={condPagOptions}
                    placeholder="Selecione condição..."
                    className="h-8 text-xs w-full"
                  />
                </div>

                <div className="rounded-md border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-[11px] w-8 text-center">#</TableHead>
                        <TableHead className="text-[11px]">Nº Duplicata</TableHead>
                        <TableHead className="text-[11px] hidden sm:table-cell">Emissão</TableHead>
                        <TableHead className="text-[11px] text-right">Valor (R$)</TableHead>
                        <TableHead className="text-[11px]">Vencimento</TableHead>
                        <TableHead className="text-[11px] w-8" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parcelas.map(p => (
                        <TableRow key={p.sequencia}>
                          <TableCell className="text-xs text-center text-muted-foreground">{p.sequencia}</TableCell>
                          <TableCell className="text-xs font-mono">{p.numeroDuplicata}</TableCell>
                          <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">{fmtDate(p.dataEmissao)}</TableCell>
                          <TableCell className="text-xs text-right tabular-nums font-medium">
                            {p.valorParcela.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="p-1.5">
                            <Input
                              type="date" className="h-7 text-xs w-32"
                              value={p.dataVencimento}
                              onChange={e => updateParcela(p.sequencia, "dataVencimento", e.target.value)}
                            />
                          </TableCell>
                          <TableCell className="p-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => removeParcela(p.sequencia)} disabled={parcelas.length <= 1}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Total row outside Table for cleaner layout */}
                  <div className="flex items-center justify-between px-4 py-2.5 border-t bg-muted/20">
                    <span className="text-xs font-medium text-muted-foreground">Total Parcelas</span>
                    <div className="flex items-center gap-3">
                      <span className={cn("text-sm font-semibold tabular-nums", difParcelas !== 0 ? "text-destructive" : "text-foreground")}>
                        {fmt(totalParcelas)}
                      </span>
                      <span className={cn("text-xs tabular-nums", difParcelas !== 0 ? "text-destructive font-medium" : "text-muted-foreground")}>
                        {difParcelas !== 0 ? `(dif: ${fmt(difParcelas)})` : `= ${fmt(valorNfse)}`}
                      </span>
                    </div>
                  </div>
                </div>

                <Button variant="outline" size="sm" className="text-xs h-7" onClick={addParcela}>
                  <Plus className="h-3 w-3 mr-1" /> Parcela
                </Button>
              </section>
            </>
          )}
        </div>

        {/* ── Footer (always visible, sticky) ── */}
        <div className="shrink-0 border-t bg-background px-6 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <span className="text-[11px] text-muted-foreground mr-auto">
            NFS-e #{nfse.numero || "?"} → Alvo ERP (MovEstq)
          </span>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!podeLancar}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Lançar no Alvo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Read-only field ──────────────────────────────────────────────────

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="text-[11px] text-muted-foreground leading-none">{label}</span>
      <p className={cn("text-sm truncate", highlight ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>{value}</p>
    </div>
  );
}
