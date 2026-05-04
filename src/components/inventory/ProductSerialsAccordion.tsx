import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Package2, AlertTriangle, AlertCircle, CheckCircle2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface SerialRow {
  controle: number;
  numero_serie: string;
  numero_ctrl_lote: string | null;
  data_validade_ctrl_lote: string | null;
  codigo_loc_armaz: string | null;
  codigo_loc_armaz_num_ser: string | null;
  codigo_entidade_fabricante: string | null;
  data_cadastro_alvo: string | null;
}

interface Props {
  codigoProduto: string;
}

type LoteStatus = "expired" | "warning" | "ok" | "no_validity";

interface LoteInfo {
  numero: string;
  validade: string | null;
  status: LoteStatus;
  diasRestantes: number | null;
  seriais: SerialRow[];
  localPrincipal: string;
  multipleLocais: boolean;
}

const formatDate = (iso: string | null): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
};

/**
 * Pega o local físico legível, removendo prefixos ruidosos como "1.01 - "
 * Exemplo: "1.01 - 008 ( ESTOQUE DE ACABADOS)" → "008 (ESTOQUE DE ACABADOS)"
 */
const cleanLocalName = (codigo: string | null, nomeCompleto: string | null): string => {
  if (nomeCompleto && nomeCompleto.trim() !== "") {
    return nomeCompleto
      .replace(/^[\d.]+\s*-\s*/, "")
      .replace(/\(\s+/g, "(")
      .trim();
  }
  if (codigo) return codigo;
  return "—";
};

/**
 * Calcula status do lote baseado em validade.
 * - expired: validade < hoje
 * - warning: validade <= hoje + 90 dias
 * - ok: validade > hoje + 90 dias
 * - no_validity: sem validade cadastrada
 */
const getStatusLote = (validade: string | null): { status: LoteStatus; diasRestantes: number | null } => {
  if (!validade) return { status: "no_validity", diasRestantes: null };

  try {
    const dataValidade = new Date(validade);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const diff = dataValidade.getTime() - hoje.getTime();
    const dias = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (dias < 0) return { status: "expired", diasRestantes: dias };
    if (dias <= 90) return { status: "warning", diasRestantes: dias };
    return { status: "ok", diasRestantes: dias };
  } catch {
    return { status: "no_validity", diasRestantes: null };
  }
};

const formatDiasRestantes = (dias: number | null): string => {
  if (dias === null) return "";
  if (dias < 0) {
    const meses = Math.floor(Math.abs(dias) / 30);
    if (meses < 1) return `vencido há ${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? "s" : ""}`;
    return `vencido há ${meses} ${meses === 1 ? "mês" : "meses"}`;
  }
  if (dias === 0) return "vence hoje";
  if (dias <= 30) return `vence em ${dias} dia${dias !== 1 ? "s" : ""}`;
  if (dias <= 90) {
    const meses = Math.round(dias / 30);
    return `vence em ${meses} ${meses === 1 ? "mês" : "meses"}`;
  }
  return "";
};

export function ProductSerialsAccordion({ codigoProduto }: Props) {
  const [seriais, setSeriais] = useState<SerialRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("stock_serials_em_estoque" as any)
        .select(
          "controle, numero_serie, numero_ctrl_lote, data_validade_ctrl_lote, codigo_loc_armaz, codigo_loc_armaz_num_ser, codigo_entidade_fabricante, data_cadastro_alvo",
        )
        .eq("codigo_produto", codigoProduto)
        .order("numero_ctrl_lote", { ascending: true })
        .order("numero_serie", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("[ProductSerialsAccordion] erro:", error.message);
        setSeriais([]);
      } else {
        setSeriais((data as any as SerialRow[]) || []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [codigoProduto]);

  // Agrupa seriais em lotes com metadados (validade, local principal, status)
  const lotes = useMemo<LoteInfo[]>(() => {
    if (!seriais || seriais.length === 0) return [];

    const grupos = new Map<string, SerialRow[]>();
    for (const s of seriais) {
      const lote = s.numero_ctrl_lote || "(sem lote)";
      if (!grupos.has(lote)) grupos.set(lote, []);
      grupos.get(lote)!.push(s);
    }

    const lotesArr: LoteInfo[] = Array.from(grupos.entries()).map(([numero, items]) => {
      const validade = items[0].data_validade_ctrl_lote;
      const { status, diasRestantes } = getStatusLote(validade);

      // Identifica local principal (se todos os seriais estão no mesmo local)
      const locais = new Set(items.map((s) => s.codigo_loc_armaz || ""));
      const multipleLocais = locais.size > 1;
      const localPrincipal = multipleLocais
        ? `${locais.size} locais`
        : cleanLocalName(items[0].codigo_loc_armaz, items[0].codigo_loc_armaz_num_ser);

      return { numero, validade, status, diasRestantes, seriais: items, localPrincipal, multipleLocais };
    });

    // Ordena: vencidos primeiro, depois vencendo, depois ok, depois sem validade
    const statusOrder: Record<LoteStatus, number> = {
      expired: 0,
      warning: 1,
      ok: 2,
      no_validity: 3,
    };
    return lotesArr.sort((a, b) => {
      const diff = statusOrder[a.status] - statusOrder[b.status];
      if (diff !== 0) return diff;
      // Empate: ordem por numero do lote
      return a.numero.localeCompare(b.numero);
    });
  }, [seriais]);

  // Resumo geral pra header
  const resumo = useMemo(() => {
    if (!seriais) return null;
    const totalUnidades = seriais.length;
    const totalLotes = lotes.length;
    const lotesVencidos = lotes.filter((l) => l.status === "expired").length;
    const lotesVencendo = lotes.filter((l) => l.status === "warning").length;

    // Local principal global
    const locaisGlobais = new Map<string, number>();
    for (const s of seriais) {
      const local = cleanLocalName(s.codigo_loc_armaz, s.codigo_loc_armaz_num_ser);
      locaisGlobais.set(local, (locaisGlobais.get(local) || 0) + 1);
    }
    const localPrincipalGlobal =
      locaisGlobais.size === 0 ? "—" : Array.from(locaisGlobais.entries()).sort((a, b) => b[1] - a[1])[0][0];
    const concentracaoLocal =
      locaisGlobais.size === 0
        ? 100
        : Math.round(((locaisGlobais.get(localPrincipalGlobal) || 0) / totalUnidades) * 100);

    return {
      totalUnidades,
      totalLotes,
      lotesVencidos,
      lotesVencendo,
      localPrincipalGlobal,
      concentracaoLocal,
      multipleLocais: locaisGlobais.size > 1,
    };
  }, [seriais, lotes]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-6 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Carregando seriais...
      </div>
    );
  }

  if (!seriais || seriais.length === 0) {
    return (
      <div className="px-6 py-4 text-xs text-muted-foreground italic">Nenhum serial em estoque para este produto.</div>
    );
  }

  return (
    <div className="bg-muted/20 border-t">
      {/* Cabeçalho de resumo */}
      {resumo && (
        <div className="px-6 py-3 border-b bg-background/50">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            <div className="flex items-center gap-1.5">
              <Package2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium text-foreground">{resumo.totalUnidades} unidades</span>
              <span className="text-muted-foreground">
                em {resumo.totalLotes} lote{resumo.totalLotes !== 1 ? "s" : ""}
              </span>
            </div>

            {resumo.lotesVencidos > 0 && (
              <div className="flex items-center gap-1.5 text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                <span className="font-medium">
                  {resumo.lotesVencidos} lote{resumo.lotesVencidos !== 1 ? "s" : ""} vencido
                  {resumo.lotesVencidos !== 1 ? "s" : ""}
                </span>
              </div>
            )}

            {resumo.lotesVencendo > 0 && (
              <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="font-medium">{resumo.lotesVencendo} vencendo em 90 dias</span>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">
                Local principal: <span className="text-foreground">{resumo.localPrincipalGlobal}</span>
                {resumo.multipleLocais && <span className="text-muted-foreground"> ({resumo.concentracaoLocal}%)</span>}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Lista de lotes */}
      <div className="px-6 py-4 space-y-3">
        {lotes.map((lote) => {
          const isExpired = lote.status === "expired";
          const isWarning = lote.status === "warning";
          const isOk = lote.status === "ok";
          const noValidity = lote.status === "no_validity";

          return (
            <div
              key={lote.numero}
              className={cn(
                "rounded-md border bg-background overflow-hidden transition-colors",
                isExpired && "border-destructive/50 bg-destructive/5",
                isWarning && "border-amber-500/40 bg-amber-500/5",
                isOk && "border-border",
                noValidity && "border-muted-foreground/20",
              )}
            >
              {/* Header do lote */}
              <div className="flex items-center justify-between gap-4 px-3 py-2 border-b bg-muted/30">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="text-xs font-mono font-semibold text-foreground">Lote {lote.numero}</span>
                  <span className="text-xs text-muted-foreground">
                    {lote.validade ? `Val. ${formatDate(lote.validade)}` : "Sem validade"}
                  </span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">
                    {lote.seriais.length} unidade{lote.seriais.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {lote.localPrincipal}
                  </span>
                </div>

                <div className="shrink-0">
                  {isExpired && (
                    <div className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                      <AlertCircle className="h-3 w-3" />
                      {formatDiasRestantes(lote.diasRestantes) || "Vencido"}
                    </div>
                  )}
                  {isWarning && (
                    <div className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-500">
                      <AlertTriangle className="h-3 w-3" />
                      {formatDiasRestantes(lote.diasRestantes)}
                    </div>
                  )}
                  {isOk && (
                    <div className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-500">
                      <CheckCircle2 className="h-3 w-3" />
                      OK
                    </div>
                  )}
                  {noValidity && (
                    <div className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      Sem validade
                    </div>
                  )}
                </div>
              </div>

              {/* Pílulas dos seriais */}
              <div className="px-3 py-2.5 flex flex-wrap gap-1.5">
                {lote.seriais.map((s) => {
                  const localSerial = cleanLocalName(s.codigo_loc_armaz, s.codigo_loc_armaz_num_ser);
                  return (
                    <span
                      key={s.controle}
                      title={`Serial: ${s.numero_serie}\nLocal: ${localSerial}\nFabricante: ${s.codigo_entidade_fabricante || "—"}\nCadastrado: ${formatDate(s.data_cadastro_alvo)}`}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-muted hover:bg-muted-foreground/10 cursor-help transition-colors text-foreground"
                    >
                      {s.numero_serie}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
