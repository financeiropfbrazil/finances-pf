// Snapshot bb6e771: somente reprodução local do defeito, não utilizado pelo app.
import { converterSolicitada, type UnidadeRequisicao } from "../../../supabase/functions/_shared/requisicao-unidades";

export function restricaoUnidadeRequisicao(unidade?: UnidadeRequisicao): string | null {
  if (!unidade) return null;
  try { converterSolicitada(1, unidade); return null; }
  catch {
    return unidade.tipo === "Divisor"
      ? `${unidade.codigo} (posição ${unidade.posicao}) usa conversão do tipo Divisor, ainda não validada para requisições no Alvo. Não é possível adicionar o item nessa unidade. A seleção foi mantida; nenhuma conversão para outra unidade será feita automaticamente.`
      : `${unidade.codigo} (posição ${unidade.posicao}) tem uma conversão ainda não suportada para requisições. Não é possível adicionar o item nessa unidade. Confira o cadastro com Suprimentos.`;
  }
}

export function UnidadeRequisicaoSelect({ unidades, posicao, onChange, carregando }: {
  unidades: UnidadeRequisicao[]; posicao: number | null; onChange: (posicao: number) => void; carregando: boolean;
}) {
  const mensagem = restricaoUnidadeRequisicao(unidades.find(u => u.posicao === posicao));
  return <>
    <select aria-label="Unidade solicitada" aria-describedby={mensagem ? "restricao-unidade-requisicao" : undefined}
      aria-invalid={!!mensagem} className="w-full rounded border p-2" value={posicao ?? ""}
      onChange={e => onChange(Number(e.target.value))} disabled={carregando}>
      <option value="" disabled>Selecione a unidade</option>
      {unidades.map(u => <option key={u.posicao} value={u.posicao}>{u.codigo} — posição {u.posicao}{u.compras ? " (compras)" : ""}{restricaoUnidadeRequisicao(u) ? " — indisponível" : ""}</option>)}
    </select>
    {mensagem && <p id="restricao-unidade-requisicao" role="alert" className="text-sm text-destructive">{mensagem}</p>}
  </>;
}
