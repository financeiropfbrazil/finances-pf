import { Card } from "@/components/ui/card";
import { useSalaContexto } from "@/hooks/useSalaContexto";

/**
 * Movimentação de Salas — entrada do módulo (FS3-3).
 *
 * Nesta tarefa a página resolve só a sala: uma sala vinculada entra direto,
 * mais de uma pede escolha, nenhuma explica o porquê. Os três botões de evento
 * e o log do dia entram na FS3-5.
 *
 * A rota já está gateada por `salas.access` no `App.tsx`; aqui não se repete o
 * gate de acesso ao módulo, só o de escopo (em que sala a pessoa trabalha).
 */
export default function MovimentacaoSalas() {
  const { salas, salaAtiva, selecionarSala, carregando } = useSalaContexto();

  if (carregando) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Sem vínculo: o RBAC deixou entrar no módulo, mas ninguém ligou a pessoa a
  // uma sala. Dizer exatamente o que falta e quem resolve.
  if (salas.length === 0) {
    return (
      <div className="p-6">
        <Card className="mx-auto max-w-lg p-6 text-center">
          <h2 className="text-lg font-semibold text-foreground">Nenhuma sala vinculada</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Você tem acesso ao módulo, mas ainda não está vinculado a nenhuma sala de produção.
            Peça ao gestor para incluir você na equipe da sala.
          </p>
        </Card>
      </div>
    );
  }

  if (!salaAtiva) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-foreground">Movimentação de Salas</h1>
        <p className="mt-1 text-sm text-muted-foreground">Escolha a sala em que você vai trabalhar.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {salas.map((sala) => (
            <button
              key={sala.id}
              type="button"
              onClick={() => selecionarSala(sala.id)}
              className="min-h-[80px] rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            >
              <div className="text-base font-medium text-foreground">{sala.nome}</div>
              <div className="mt-1 text-xs text-muted-foreground">{sala.codigo}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-foreground">{salaAtiva.nome}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{salaAtiva.codigo}</p>
    </div>
  );
}
