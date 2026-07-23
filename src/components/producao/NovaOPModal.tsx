import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { Loader2, AlertTriangle, Search, Trash2, Package, Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  buscarProdutos,
  ultimoDeptoDoUsuario,
  criarOrdem,
  abrirOrdem,
  listarTipos,
  SKU_MAX_RESULTADOS,
  type StockPickerRow,
} from "@/services/opService";

// ── Opções (rótulos do FRM-07-11) ─────────────────────────────────────────────
const TIPO_ORDEM_OPTS = [
  { value: "FABRICACAO", label: "Fabricação" },
  { value: "EMBALAGEM_FINAL", label: "Embalagem final" },
];
const TIPO_PRODUTO_OPTS = [
  { value: "ACABADO", label: "Acabado" },
  { value: "EM_PROCESSO", label: "Em processo" },
];
const DESTINO_OPTS = [
  { value: "INTERNACIONAL", label: "Internacional" },
  { value: "NACIONAL", label: "Nacional" },
  { value: "NAO_APLICAVEL", label: "Não aplicável" },
];

function dateToYMD(d: Date | undefined): string | null {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface ItemRow {
  codigo_produto: string;
  codigo_alternativo_produto: string | null;
  produto_nome: string;
  produto_unidade: string | null;
  quantidade: string; // string enquanto o operador digita; convertido no salvar
}

// ── Picker de SKU (server-side, debounce 300ms, race-guard) ────────────────────
const SkuPicker = forwardRef<{ focus: () => void }, { onPick: (p: StockPickerRow) => void; disabled?: boolean }>(
  function SkuPicker({ onPick, disabled }, ref) {
    const [search, setSearch] = useState("");
    const [open, setOpen] = useState(false);
    const [results, setResults] = useState<StockPickerRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [truncado, setTruncado] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>();
    const buscaIdRef = useRef(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

    useEffect(() => {
      if (search.trim().length < 2) {
        setResults([]);
        setErro(null);
        setTruncado(false);
        return;
      }
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        const id = ++buscaIdRef.current;
        setLoading(true);
        setErro(null);
        try {
          const rows = await buscarProdutos(search);
          if (id !== buscaIdRef.current) return; // resposta antiga — descarta
          setResults(rows);
          setTruncado(rows.length === SKU_MAX_RESULTADOS);
        } catch (e: any) {
          if (id !== buscaIdRef.current) return;
          setErro(e?.message || "Falha ao consultar o catálogo");
          setResults([]);
          setTruncado(false);
        } finally {
          if (id === buscaIdRef.current) setLoading(false);
        }
      }, 300);
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, [search]);

    useEffect(() => {
      function handleClick(e: MouseEvent) {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
      }
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    return (
      <div ref={containerRef} className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={search}
          disabled={disabled}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar SKU por código alternativo, nome ou código…"
          className="pl-8"
        />
        {open && search.trim().length >= 1 && (
          <div className="absolute left-0 top-full z-[90] mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover text-sm shadow-lg">
            {loading && (
              <div className="flex items-center justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && erro && (
              <div className="flex items-start gap-2 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Erro ao buscar produtos: {erro}.</span>
              </div>
            )}
            {!loading && !erro && search.trim().length < 2 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Digite 2+ caracteres para buscar…</p>
            )}
            {!loading && !erro && search.trim().length >= 2 && results.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum produto ativo encontrado.</p>
            )}
            {!loading &&
              !erro &&
              results.map((p) => (
                <button
                  key={p.codigo_produto}
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-accent"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPick(p);
                    setSearch("");
                    setOpen(false);
                  }}
                >
                  <span className="font-mono text-xs">
                    <span className="font-medium">{p.codigo_alternativo || "—"}</span>
                    <span className="text-muted-foreground"> · {p.codigo_produto}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {p.nome_produto} · {p.unidade_medida || "—"}
                  </span>
                </button>
              ))}
            {!loading && !erro && truncado && (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                Mostrando os {SKU_MAX_RESULTADOS} primeiros — refine a busca.
              </p>
            )}
          </div>
        )}
      </div>
    );
  },
);

interface NovaOPModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}

export function NovaOPModal({ open, onOpenChange, onCreated }: NovaOPModalProps) {
  const { user } = useAuth();
  const { data: tipos = [] } = useQuery({ queryKey: ["op_tipos"], queryFn: listarTipos });

  const [tipoId, setTipoId] = useState("");
  const [tipoOrdem, setTipoOrdem] = useState("FABRICACAO"); // default
  const [tipoProduto, setTipoProduto] = useState("");
  const [destino, setDestino] = useState(""); // sem default (decisão consciente)
  const [produtoFamilia, setProdutoFamilia] = useState("Tricvalve");
  const [lote, setLote] = useState("");
  const [dataInicio, setDataInicio] = useState<Date | undefined>(undefined);
  const [dataFim, setDataFim] = useState<Date | undefined>(undefined);
  const [numeroReferencia, setNumeroReferencia] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [emitidoDepto, setEmitidoDepto] = useState("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const pickerRef = useRef<{ focus: () => void }>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const markDirty = () => setDirty(true);

  // Reset + pré-preenchimento do depto ao abrir.
  useEffect(() => {
    if (!open) return;
    setTipoId("");
    setTipoOrdem("FABRICACAO");
    setTipoProduto("");
    setDestino("");
    setProdutoFamilia("Tricvalve");
    setLote("");
    setDataInicio(new Date());
    setDataFim(undefined);
    setNumeroReferencia("");
    setObservacoes("");
    setItems([]);
    setEmitidoDepto("");
    setDirty(false);
    setSaving(false);
    if (user?.id) ultimoDeptoDoUsuario(user.id).then(setEmitidoDepto).catch(() => {});
  }, [open, user?.id]);

  const adicionarItem = (p: StockPickerRow) => {
    if (items.some((i) => i.codigo_produto === p.codigo_produto)) {
      toast.warning("Este SKU já está na lista — edite a quantidade.");
      setTimeout(() => qtyRefs.current[p.codigo_produto]?.focus(), 0);
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        codigo_produto: p.codigo_produto,
        codigo_alternativo_produto: p.codigo_alternativo,
        produto_nome: p.nome_produto,
        produto_unidade: p.unidade_medida,
        quantidade: "",
      },
    ]);
    markDirty();
    setTimeout(() => qtyRefs.current[p.codigo_produto]?.focus(), 0);
  };

  const removerItem = (codigo: string) => {
    setItems((prev) => prev.filter((i) => i.codigo_produto !== codigo));
    markDirty();
  };

  const setQty = (codigo: string, value: string) => {
    setItems((prev) => prev.map((i) => (i.codigo_produto === codigo ? { ...i, quantidade: value } : i)));
    markDirty();
  };

  const validar = (): string | null => {
    if (!tipoId) return "Selecione o tipo de OP.";
    if (!tipoOrdem) return "Selecione o tipo de ordem.";
    if (!tipoProduto) return "Selecione o tipo de produto.";
    if (!destino) return "Selecione o destino.";
    if (items.length === 0) return "Adicione ao menos 1 item.";
    for (const i of items) {
      const q = Number(i.quantidade);
      if (!Number.isFinite(q) || q <= 0) return `Informe uma quantidade > 0 para ${i.codigo_produto}.`;
    }
    return null;
  };

  const doClose = () => onOpenChange(false);

  const attemptClose = () => {
    if (saving) return;
    if (dirty) setConfirmClose(true);
    else doClose();
  };

  const salvar = async (abrir: boolean) => {
    const erro = validar();
    if (erro) {
      toast.error(erro);
      return;
    }
    setSaving(true);
    try {
      const dados = {
        tipo_id: tipoId,
        tipo_ordem: tipoOrdem,
        tipo_produto: tipoProduto,
        destino,
        produto_familia: produtoFamilia.trim() || null,
        lote: lote.trim() || null,
        data_inicio: dateToYMD(dataInicio),
        data_fim_planejada: dateToYMD(dataFim),
        numero_referencia: numeroReferencia.trim() || null,
        observacoes: observacoes.trim() || null,
        emitido_depto: emitidoDepto.trim() || null,
      };
      const itensPayload = items.map((i) => ({
        codigo_produto: i.codigo_produto,
        codigo_alternativo_produto: i.codigo_alternativo_produto,
        produto_nome: i.produto_nome,
        produto_unidade: i.produto_unidade,
        quantidade_planejada: Number(i.quantidade),
      }));
      const { id, numero } = await criarOrdem(dados, itensPayload);
      if (abrir) await abrirOrdem(id);
      toast.success(`OP ${numero} criada${abrir ? " e aberta" : ""}.`);
      setDirty(false);
      onCreated();
      doClose();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar a OP.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (o) onOpenChange(true);
          else attemptClose();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Ordem de Produção</DialogTitle>
            <DialogDescription>Nº automático (2026-05xx) — atribuído ao salvar.</DialogDescription>
          </DialogHeader>

          {/* ── Cabeçalho ── */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Tipo de OP *</Label>
                <Select
                  value={tipoId}
                  onValueChange={(v) => {
                    setTipoId(v);
                    markDirty();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione…" />
                  </SelectTrigger>
                  <SelectContent>
                    {tipos.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Família do produto</Label>
                <Input
                  value={produtoFamilia}
                  onChange={(e) => {
                    setProdutoFamilia(e.target.value);
                    markDirty();
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <RadioRow
                label="Tipo de ordem"
                required
                value={tipoOrdem}
                onChange={(v) => {
                  setTipoOrdem(v);
                  markDirty();
                }}
                options={TIPO_ORDEM_OPTS}
              />
              <RadioRow
                label="Tipo de produto"
                required
                value={tipoProduto}
                onChange={(v) => {
                  setTipoProduto(v);
                  markDirty();
                }}
                options={TIPO_PRODUTO_OPTS}
              />
              <RadioRow
                label="Destino"
                required
                value={destino}
                onChange={(v) => {
                  setDestino(v);
                  markDirty();
                }}
                options={DESTINO_OPTS}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DateField
                label="Início"
                value={dataInicio}
                onChange={(d) => {
                  setDataInicio(d);
                  markDirty();
                }}
              />
              <DateField
                label="Fim planejado"
                value={dataFim}
                onChange={(d) => {
                  setDataFim(d);
                  markDirty();
                }}
              />
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Lote</Label>
                <Input
                  value={lote}
                  onChange={(e) => {
                    setLote(e.target.value);
                    markDirty();
                  }}
                  placeholder="Opcional"
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nº de referência</Label>
                <Input
                  value={numeroReferencia}
                  onChange={(e) => {
                    setNumeroReferencia(e.target.value);
                    markDirty();
                  }}
                  placeholder="Opcional"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Departamento emissor</Label>
                <Input
                  value={emitidoDepto}
                  onChange={(e) => {
                    setEmitidoDepto(e.target.value);
                    markDirty();
                  }}
                  placeholder="Ex.: Produção"
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Observações</Label>
                <Textarea
                  value={observacoes}
                  onChange={(e) => {
                    setObservacoes(e.target.value);
                    markDirty();
                  }}
                  rows={1}
                  placeholder="Opcional"
                />
              </div>
            </div>
          </div>

          {/* ── Itens ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Itens da OP</h3>
              <span className="text-xs text-muted-foreground">
                {items.length} {items.length === 1 ? "item" : "itens"}
              </span>
            </div>
            <SkuPicker ref={pickerRef} onPick={adicionarItem} disabled={saving} />

            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-6 text-center">
                <Package className="h-6 w-6 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">Busque um SKU acima para adicionar. Mínimo 1 item.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Código</th>
                      <th className="px-3 py-2 font-medium">Produto</th>
                      <th className="px-3 py-2 font-medium">Unid.</th>
                      <th className="w-32 px-3 py-2 font-medium">Quantidade</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.codigo_produto} className="border-b last:border-b-0">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
                          <span className="font-medium">{it.codigo_alternativo_produto || "—"}</span>
                          <span className="text-muted-foreground"> · {it.codigo_produto}</span>
                        </td>
                        <td className="px-3 py-2">{it.produto_nome}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{it.produto_unidade || "—"}</td>
                        <td className="px-3 py-2">
                          <Input
                            ref={(el) => {
                              qtyRefs.current[it.codigo_produto] = el;
                            }}
                            type="number"
                            min="0"
                            step="any"
                            inputMode="decimal"
                            value={it.quantidade}
                            onChange={(e) => setQty(it.codigo_produto, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                pickerRef.current?.focus();
                              }
                            }}
                            className="h-8 w-28 tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removerItem(it.codigo_produto)}
                            title="Remover item"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={attemptClose} disabled={saving}>
              Cancelar
            </Button>
            <Button variant="secondary" onClick={() => salvar(false)} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar rascunho
            </Button>
            <Button onClick={() => salvar(true)} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar e abrir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
            <AlertDialogDescription>
              Há dados não salvos nesta OP. Se fechar agora, eles serão perdidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClose(false);
                doClose();
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Helpers de campo ───────────────────────────────────────────────────────────

function RadioRow({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </Label>
      <RadioGroup value={value} onValueChange={onChange} className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
        {options.map((o) => {
          const id = `${label}-${o.value}`;
          return (
            <div key={o.value} className="flex items-center gap-1.5">
              <RadioGroupItem value={o.value} id={id} />
              <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
                {o.label}
              </Label>
            </div>
          );
        })}
      </RadioGroup>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn("w-full justify-start text-left font-normal", !value && "text-muted-foreground")}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? format(value, "dd/MM/yyyy", { locale: ptBR }) : "Selecionar"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <CalendarComponent
            mode="single"
            selected={value}
            onSelect={onChange}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
