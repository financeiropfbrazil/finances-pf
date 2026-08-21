import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Trash2, Undo2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LogDoDia } from "@/components/salas/LogDoDia";
import { FluxoEntrada } from "@/components/salas/FluxoEntrada";
import { FluxoRefugo } from "@/components/salas/FluxoRefugo";
import { FluxoSaida } from "@/components/salas/FluxoSaida";
import { DialogoEstorno, podeMostrarEstorno } from "@/components/salas/DialogoEstorno";
import { AbaEquipe } from "@/components/salas/AbaEquipe";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSalaContexto, useMovimentosDoDia } from "@/hooks/useSalaContexto";
import type { MovimentoLog, TipoMovimento } from "@/services/salasService";
import { cn } from "@/lib/utils";

/**
 * Movimentação de Salas — painel da sala (FS3-5).
 *
 * Uma decisão por tela: o painel só faz duas coisas — oferecer os três eventos
 * e mostrar o que já aconteceu hoje. Cada evento abre seu próprio fluxo em
 * passos (FS3-6/7/8).
 *
 * Os botões aparecem conforme a permissão do RBAC. Esconder é conveniência: a
 * RPC cobra permissão E vínculo com a sala na hora de gravar, e é ela quem
 * decide de verdade.
 */
type FluxoAberto = TipoMovimento | null;

export default function MovimentacaoSalas() {
  const {
    salas,
    salaAtiva,
    selecionarSala,
    carregando,
    insumos,
    produtosFinais,
    podeEntrada,
    podeRefugo,
    podeSaida,
    podeEstornar,
    podeGerirEquipe,
    userId,
  } = useSalaContexto();

  const [fluxo, setFluxo] = useState<FluxoAberto>(null);
  const [estornando, setEstornando] = useState<MovimentoLog | null>(null);
  const { movimentos, carregando: carregandoLog, recarregar } = useMovimentosDoDia(salaAtiva?.id ?? null);

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

  if (fluxo) {
    const fecharFluxo = () => setFluxo(null);
    const concluir = () => {
      setFluxo(null);
      recarregar(); // o registro tem de aparecer no log já na volta
    };
    return (
      <div className="p-4 sm:p-6">
        {fluxo === "ENTRADA" ? (
          <FluxoEntrada
            sala={salaAtiva}
            insumos={insumos}
            onConcluido={concluir}
            onCancelar={fecharFluxo}
          />
        ) : fluxo === "REFUGO" ? (
          <FluxoRefugo
            sala={salaAtiva}
            insumos={insumos}
            produtosFinais={produtosFinais}
            onConcluido={concluir}
            onCancelar={fecharFluxo}
          />
        ) : (
          <FluxoSaida
            sala={salaAtiva}
            produtosFinais={produtosFinais}
            onConcluido={concluir}
            onCancelar={fecharFluxo}
          />
        )}
      </div>
    );
  }

  const eventos: { tipo: TipoMovimento; rotulo: string; icone: typeof ArrowDownToLine; visivel: boolean }[] = [
    { tipo: "ENTRADA", rotulo: "Entrada", icone: ArrowDownToLine, visivel: podeEntrada },
    { tipo: "REFUGO", rotulo: "Refugo", icone: Trash2, visivel: podeRefugo },
    { tipo: "SAIDA", rotulo: "Saída", icone: ArrowUpFromLine, visivel: podeSaida },
  ];
  const eventosVisiveis = eventos.filter((e) => e.visivel);

  const logDoDia = (
    <>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => recarregar()}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Atualizar
        </button>
      </div>
      <LogDoDia
        movimentos={movimentos}
        carregando={carregandoLog}
        acaoDaLinha={(mov) =>
          podeMostrarEstorno(mov, userId, podeEstornar) ? (
            <button
              type="button"
              onClick={() => setEstornando(mov)}
              aria-label={`Estornar ${mov.produto_nome}`}
              className="flex h-12 w-12 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Undo2 className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null
        }
      />
    </>
  );

  return (
    <div className="p-4 sm:p-6">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="truncate text-xl font-semibold text-foreground">{salaAtiva.nome}</h1>
        {salas.length > 1 ? (
          <button
            type="button"
            onClick={() => selecionarSala(null)}
            className="shrink-0 text-sm text-primary underline-offset-4 hover:underline"
          >
            Trocar de sala
          </button>
        ) : null}
      </header>

      {eventosVisiveis.length === 0 ? (
        <Card className="mt-6 p-4 text-sm text-muted-foreground">
          Você está vinculado a esta sala, mas seu perfil não permite registrar movimentos. Fale com
          o gestor se isso não estiver certo.
        </Card>
      ) : (
        <div
          className={cn(
            "mt-6 grid gap-3",
            eventosVisiveis.length === 1 ? "sm:grid-cols-1" : "sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {eventosVisiveis.map((evento) => (
            <button
              key={evento.tipo}
              type="button"
              onClick={() => setFluxo(evento.tipo)}
              className="flex h-24 items-center justify-center gap-3 rounded-lg border-2 border-border bg-card text-lg font-medium text-foreground transition-colors hover:bg-accent active:bg-accent"
            >
              <evento.icone className="h-6 w-6" aria-hidden="true" />
              {evento.rotulo}
            </button>
          ))}
        </div>
      )}

      <section className="mt-8">
        {podeGerirEquipe ? (
          <Tabs defaultValue="movimentos">
            <TabsList>
              <TabsTrigger value="movimentos" className="h-11 px-4">
                Hoje na sala
              </TabsTrigger>
              <TabsTrigger value="equipe" className="h-11 px-4">
                Equipe
              </TabsTrigger>
            </TabsList>
            <TabsContent value="movimentos" className="mt-4">
              {logDoDia}
            </TabsContent>
            <TabsContent value="equipe" className="mt-4">
              <AbaEquipe sala={salaAtiva} />
            </TabsContent>
          </Tabs>
        ) : (
          <>
            <h2 className="text-base font-semibold text-foreground">Hoje na sala</h2>
            <div className="mt-2">{logDoDia}</div>
          </>
        )}
      </section>

      <DialogoEstorno
        movimento={estornando}
        onFechar={() => setEstornando(null)}
        onEstornado={() => {
          setEstornando(null);
          recarregar();
        }}
      />
    </div>
  );
}
