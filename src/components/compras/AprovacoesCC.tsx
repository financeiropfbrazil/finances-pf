import type { AprovacaoCC } from "@/services/requisicoesService";

const rotulos: Record<AprovacaoCC["situacao"], string> = {
  aprovado: "Aprovado",
  dispensado_autor: "Dispensado — autor lidera este CC",
  sem_lider: "Sem líder — não bloqueia",
  pendente: "Aguardando aprovação",
  rejeitado: "Requisição rejeitada — encerrada",
};

export function AprovacoesCC({ grupos, erro }: { grupos: AprovacaoCC[]; erro?: string }) {
  if (erro) return <p role="alert" className="text-destructive">{erro}</p>;
  if (!grupos.length) return null;
  return <section className="rounded-lg border p-4 space-y-3" aria-label="Aprovações por centro de custo">
    <h2 className="font-semibold">Aprovações por centro de custo</h2>
    <p className="text-sm text-muted-foreground">O envio aguarda todos os centros de custo. Cada CC precisa de apenas um de seus líderes.</p>
    {grupos.map((g) => <div key={g.codigo_centro_ctrl} className="border-t pt-2 text-sm">
      <strong>{g.codigo_centro_ctrl}</strong> — {rotulos[g.situacao]}
      <div className="text-muted-foreground">Líderes: {g.lideres.map((l) => l.nome).join(", ") || "Nenhum"}</div>
      {g.aprovado_por && <div>Decisão: {g.aprovado_nome || g.lideres.find((l) => l.user_id === g.aprovado_por)?.nome || g.aprovado_por}
        {g.aprovado_em && ` · ${new Date(g.aprovado_em).toLocaleString("pt-BR")}`}</div>}
    </div>)}
  </section>;
}
