import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listarEquipe,
  listarUsuariosAtivos,
  vincularUsuario,
  revogarUsuario,
  type Sala,
} from "@/services/salasService";

/**
 * Equipe da sala (FS3-10, §E.6).
 *
 * Visível só com `salas.cadastros.manage`. Lista os vínculos ativos, permite
 * adicionar e revogar — sempre pelas RPCs, nunca por escrita direta.
 *
 * O aviso do §E.6 está na tela e não é decoração: **vincular não concede
 * permissão**. Vínculo diz em que sala a pessoa trabalha; o papel
 * (`operador_salas` etc.) é atribuído no admin do Hub. Sem essa frase, o gestor
 * vincula alguém, a pessoa continua sem conseguir registrar, e a culpa cai na
 * tela.
 */
export interface AbaEquipeProps {
  sala: Sala;
}

export function AbaEquipe({ sala }: AbaEquipeProps) {
  const [selecionado, setSelecionado] = useState<string>("");
  const [ocupado, setOcupado] = useState(false);

  const { data: equipe = [], isLoading, refetch } = useQuery({
    queryKey: ["salas_equipe", sala.id],
    queryFn: () => listarEquipe(sala.id),
    staleTime: 60_000,
  });

  const { data: usuarios = [] } = useQuery({
    queryKey: ["salas_usuarios_ativos"],
    queryFn: listarUsuariosAtivos,
    staleTime: 5 * 60_000,
  });

  const jaVinculados = new Set(equipe.map((v) => v.user_id));
  const disponiveis = usuarios.filter((u) => !jaVinculados.has(u.user_id));

  const vincular = async () => {
    if (!selecionado) return;
    setOcupado(true);
    try {
      await vincularUsuario(sala.id, selecionado);
      toast.success("Operador vinculado à sala.");
      setSelecionado("");
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível vincular.");
    } finally {
      setOcupado(false);
    }
  };

  const revogar = async (userId: string, nome: string) => {
    setOcupado(true);
    try {
      await revogarUsuario(sala.id, userId);
      toast.success(`Vínculo de ${nome} revogado.`);
      refetch();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível revogar.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground">Adicionar à equipe</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Vincular à sala <strong>não</strong> concede permissão. O papel do usuário
          (operador, qualidade, gestor) é atribuído no admin do Hub — o vínculo só diz em qual sala
          ele trabalha.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Select value={selecionado} onValueChange={setSelecionado}>
            <SelectTrigger className="h-12 flex-1">
              <SelectValue placeholder="Escolha a pessoa" />
            </SelectTrigger>
            <SelectContent>
              {disponiveis.map((u) => (
                <SelectItem key={u.user_id} value={u.user_id}>
                  {u.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            onClick={vincular}
            disabled={!selecionado || ocupado}
            className="h-12 sm:w-40"
          >
            Vincular
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-foreground">Equipe atual</h3>
        {isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">Carregando…</p>
        ) : equipe.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Ninguém vinculado a esta sala ainda.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {equipe.map((v) => (
              <li key={v.user_id} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{v.nome}</span>
                  {v.email ? (
                    <span className="block truncate text-xs text-muted-foreground">{v.email}</span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => revogar(v.user_id, v.nome)}
                  className="h-11 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <UserMinus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Revogar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
