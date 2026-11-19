/**
 * Tipo de lançamento do MovEstq no Alvo — cabeçalho (PLANO-NFE NFE-14), para as telas de NF-e e NFS-e.
 *
 * Fonte: RPC `alvo_tipo_lanc(bigint[])` (rastreio_nf.codigo_tipo_lanc + descrição do catálogo do Hub, stock_tipos_lanc;
 * gate nfe_pode_acessar() ou nfse_pode_acessar()). O Alvo não manda o nome do tipo no MovEstq e o catálogo cobre só
 * parte dos códigos: a tela mostra o código e usa a descrição como apoio, quando há.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TipoLanc {
  codigo: string | null;
  descricao: string | null;
}

const LOTE = 5000;

/** Tipo de cada lançamento (chave do MovEstq → tipo). Chaves repetidas ou vazias são ignoradas. */
export async function buscarTiposLanc(chaves: (number | null | undefined)[]): Promise<Map<number, TipoLanc>> {
  const unicas = [...new Set(chaves.filter((c): c is number => typeof c === "number" && Number.isFinite(c)))];
  const mapa = new Map<number, TipoLanc>();
  for (let i = 0; i < unicas.length; i += LOTE) {
    const { data, error } = await (supabase as any).rpc("alvo_tipo_lanc", { p_chaves: unicas.slice(i, i + LOTE) });
    if (error) throw new Error(error.message);
    for (const l of (data ?? []) as { chave_movestq: number; codigo_tipo_lanc: string | null; descricao: string | null }[]) {
      mapa.set(Number(l.chave_movestq), { codigo: l.codigo_tipo_lanc, descricao: l.descricao });
    }
  }
  return mapa;
}

/** "E0000003 · Compra (NF-e)" — ou só o código, sem descrição no catálogo. */
export const rotuloTipoLanc = (t: TipoLanc | null | undefined): string =>
  t?.codigo ? (t.descricao ? `${t.codigo} · ${t.descricao}` : t.codigo) : "";

/** Tipo de um lançamento só (detalhe da nota). */
export function useTipoLanc(chave: number | null | undefined) {
  return useQuery({
    queryKey: ["alvo-tipo-lanc", chave ?? null],
    queryFn: async () => (await buscarTiposLanc([chave])).get(chave as number) ?? null,
    enabled: typeof chave === "number",
    staleTime: 5 * 60_000,
  });
}
