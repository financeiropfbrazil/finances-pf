import { converterSolicitada, type UnidadeRequisicao } from "../../../supabase/functions/_shared/requisicao-unidades";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";

export function posicaoInicialUnidade(unidades: UnidadeRequisicao[]): number | null {
  const compras = unidades.filter(u => u.compras);
  // Uma unidade de compras bloqueada continua selecionada e explica sua restrição.
  if (compras.length === 1) return compras[0].posicao;
  if (compras.length > 1) return null;
  const validas = unidades.filter(u => !restricaoUnidadeRequisicao(u));
  return validas.length === 1 ? validas[0].posicao : null;
}

export function restricaoUnidadeRequisicao(unidade?: UnidadeRequisicao): string | null {
  if (!unidade) return null;
  try { converterSolicitada(1, unidade); return null; }
  catch {
    return unidade.tipo === "Divisor"
      ? `${unidade.codigo} (posição ${unidade.posicao}) usa conversão do tipo Divisor, ainda não validada para requisições no Alvo. Não é possível adicionar o item nessa unidade. A seleção foi mantida; nenhuma conversão para outra unidade será feita automaticamente.`
      : `${unidade.codigo} (posição ${unidade.posicao}) tem uma conversão ainda não suportada para requisições. Não é possível adicionar o item nessa unidade. Confira o cadastro com Suprimentos.`;
  }
}

export function UnidadeRequisicaoSelect({ unidades, posicao, onChange, carregando, erro, onRetry, produtoSelecionado = true, pausado = false }: {
  unidades: UnidadeRequisicao[]; posicao: number | null; onChange: (posicao: number) => void; carregando: boolean;
  erro?: Error | null; onRetry?: () => void; produtoSelecionado?: boolean; pausado?: boolean;
}) {
  const avisoId = useId();
  const restricao = restricaoUnidadeRequisicao(unidades.find(u => u.posicao === posicao));
  const mensagem = !produtoSelecionado ? "Selecione um produto para consultar as unidades."
    : carregando ? "Consultando unidades no Alvo…"
    : pausado ? "Consulta pausada por falta de conexão. Reconecte-se e tente novamente."
    : erro ? `Não foi possível consultar as unidades: ${erro.message}`
    : !unidades.length ? "O Produto/Load retornou nenhuma unidade cadastrada. Confira o cadastro com Suprimentos ou tente novamente."
    : restricao;
  return <>
    <Select value={posicao === null ? "" : String(posicao)} onValueChange={value => onChange(Number(value))}
      disabled={!produtoSelecionado || carregando || pausado || !!erro || !unidades.length}>
      <SelectTrigger aria-label="Unidade solicitada" aria-describedby={mensagem ? avisoId : undefined}
        aria-invalid={!!erro || !!restricao} aria-busy={carregando} className="text-foreground">
        <SelectValue placeholder={carregando ? "Carregando unidades…" : "Selecione a unidade"} />
      </SelectTrigger>
      <SelectContent>{unidades.map(u => <SelectItem key={u.posicao} value={String(u.posicao)}>
        {u.codigo} — posição {u.posicao}{u.compras ? " (compras)" : ""}{restricaoUnidadeRequisicao(u) ? " — indisponível" : ""}
      </SelectItem>)}</SelectContent>
    </Select>
    {mensagem && <p id={avisoId} role={erro || restricao ? "alert" : "status"}
      className="flex items-start gap-2 rounded-md border border-border bg-muted p-3 text-sm text-foreground">
      {carregando && <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />}{mensagem}
    </p>}
    {produtoSelecionado && !carregando && (erro || pausado || !unidades.length) && onRetry &&
      <Button type="button" variant="outline" onClick={onRetry}>Tentar novamente</Button>}
  </>;
}
