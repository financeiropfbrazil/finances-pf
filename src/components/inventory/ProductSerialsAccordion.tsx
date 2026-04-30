import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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

const formatDate = (iso: string | null): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
};

const cleanLocal = (codigo: string | null, nomeCompleto: string | null): string => {
  if (nomeCompleto && nomeCompleto.trim() !== "") return nomeCompleto;
  if (codigo) return codigo;
  return "—";
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

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Carregando seriais...
      </div>
    );
  }

  if (!seriais || seriais.length === 0) {
    return <div className="px-4 py-3 text-xs text-muted-foreground italic">Nenhum serial em estoque.</div>;
  }

  // Agrupa por lote
  const porLote = new Map<string, SerialRow[]>();
  for (const s of seriais) {
    const lote = s.numero_ctrl_lote || "(sem lote)";
    if (!porLote.has(lote)) porLote.set(lote, []);
    porLote.get(lote)!.push(s);
  }

  return (
    <div className="bg-muted/10 border-t">
      <div className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground">
        <Tag className="h-3.5 w-3.5" />
        {seriais.length} serial{seriais.length !== 1 ? "s" : ""} em estoque
      </div>
      <div className="px-4 pb-3 space-y-3">
        {Array.from(porLote.entries()).map(([lote, items]) => {
          const validade = items[0].data_validade_ctrl_lote;
          return (
            <div key={lote} className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="text-xs font-mono">
                  Lote {lote}
                </Badge>
                {validade && <span className="text-muted-foreground">Validade: {formatDate(validade)}</span>}
                <span className="text-muted-foreground">
                  ({items.length} unidade{items.length !== 1 ? "s" : ""})
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-1 pl-2 text-xs">
                {items.map((s) => (
                  <div
                    key={s.controle}
                    className="font-mono text-foreground truncate"
                    title={`${s.numero_serie} | ${cleanLocal(s.codigo_loc_armaz, s.codigo_loc_armaz_num_ser)}`}
                  >
                    {s.numero_serie}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
