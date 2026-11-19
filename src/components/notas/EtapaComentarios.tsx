/**
 * Etapa 7 — Comentários (PLANO-NFE NFE-15), comum ao detalhe da NF-e e da NFS-e.
 *
 * Registro em ordem decrescente (o mais novo em cima) de comentários curtos dos usuários do Hub, com quem escreveu e
 * data/hora com segundos (Brasília). Só acréscimo. Ocupa a largura toda, abaixo das 6 etapas: numa coluna da grade
 * ficaria sozinha numa linha ou espremida em tela pequena.
 */
import { useState, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Coluna, type EstadoEtapa } from "@/components/nfse/NfseDetalheEtapas";
import {
  LIMITE_COMENTARIO,
  adicionarComentario,
  chaveComentarios,
  formatarInstanteComSegundos,
  iniciais,
  listarComentarios,
  type TipoNotaComentario,
} from "@/services/notaComentariosService";

/** Comentários da nota — o detalhe usa o mesmo cache para a régua e para a etapa. */
export function useComentariosNota(tipo: TipoNotaComentario, chave: string | null | undefined) {
  return useQuery({
    queryKey: chaveComentarios(tipo, chave ?? ""),
    queryFn: () => listarComentarios(tipo, chave as string),
    enabled: !!chave,
    staleTime: 30_000,
  });
}

/** Estado da etapa 7 na régua: com comentário = concluída; sem = opcional. */
export const estadoComentarios = (n: number | undefined): EstadoEtapa => (n && n > 0 ? "feito" : "opcional");

export function EtapaComentarios({
  tipo,
  chave,
  colRef,
}: {
  tipo: TipoNotaComentario;
  chave: string;
  colRef: (el: HTMLElement | null) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const consulta = useComentariosNota(tipo, chave);
  const comentarios = consulta.data ?? [];
  const [texto, setTexto] = useState("");
  const limpo = texto.trim();
  const restante = LIMITE_COMENTARIO - texto.length;

  const enviar = useMutation({
    mutationFn: () => adicionarComentario(tipo, chave, limpo),
    onSuccess: () => {
      setTexto("");
      qc.invalidateQueries({ queryKey: chaveComentarios(tipo, chave) });
    },
    onError: (e) =>
      toast({ title: "Não foi possível adicionar", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
  });
  const podeEnviar = limpo.length > 0 && limpo.length <= LIMITE_COMENTARIO && !enviar.isPending;
  const teclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && podeEnviar) {
      e.preventDefault();
      enviar.mutate();
    }
  };

  const ultimo = comentarios[0];
  const resumo = consulta.isLoading
    ? "Carregando…"
    : comentarios.length === 0
      ? "Nenhum comentário ainda"
      : `${comentarios.length} ${comentarios.length === 1 ? "comentário" : "comentários"} · último de ${ultimo.autor}, ${formatarInstanteComSegundos(ultimo.criado_em)}`;

  return (
    <Coluna
      n={7}
      titulo="Comentários"
      icone={<MessageSquare className="h-4 w-4" />}
      estado={estadoComentarios(comentarios.length)}
      resumo={resumo}
      colRef={colRef}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* Novo comentário */}
        <div className="flex flex-col gap-1.5">
          <Textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value.slice(0, LIMITE_COMENTARIO))}
            onKeyDown={teclar}
            maxLength={LIMITE_COMENTARIO}
            rows={3}
            placeholder="Escreva um comentário curto sobre esta nota…"
            aria-label="Novo comentário"
            className="min-h-[72px] resize-none text-xs"
          />
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn("text-[10px] tabular-nums", restante <= 20 ? "font-medium text-amber-600" : "text-muted-foreground")}
              aria-live="polite"
            >
              {texto.length}/{LIMITE_COMENTARIO}
            </span>
            <div className="flex items-center gap-2">
              <span className="hidden text-[10px] text-muted-foreground sm:inline">Ctrl+Enter</span>
              <Button size="sm" className="h-7 gap-1 text-xs" disabled={!podeEnviar} onClick={() => enviar.mutate()}>
                {enviar.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Adicionar
              </Button>
            </div>
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Fica registrado com o seu nome e a hora. Não dá para editar nem apagar depois.
          </p>
        </div>

        {/* Registro, do mais novo ao mais antigo */}
        <div className="min-w-0">
          {consulta.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando comentários…
            </div>
          ) : consulta.error ? (
            <p className="py-4 text-xs text-rose-600">
              Não foi possível carregar os comentários: {consulta.error instanceof Error ? consulta.error.message : String(consulta.error)}
            </p>
          ) : comentarios.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              Nenhum comentário ainda. O primeiro aparece aqui.
            </p>
          ) : (
            <ol className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1" aria-label="Comentários">
              {comentarios.map((c) => (
                <li key={c.id} className="flex gap-2.5 rounded-md border border-border bg-muted/30 p-2.5">
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                      c.meu ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
                    )}
                    aria-hidden="true"
                  >
                    {iniciais(c.autor)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {c.autor}
                        {c.meu && <span className="ml-1 font-normal text-muted-foreground">(você)</span>}
                      </span>
                      <time dateTime={c.criado_em} className="text-[10px] tabular-nums text-muted-foreground">
                        {formatarInstanteComSegundos(c.criado_em)}
                      </time>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-snug text-foreground">{c.texto}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Coluna>
  );
}
