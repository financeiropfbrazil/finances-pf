import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import {
  listarSalasDoUsuario,
  listarProdutosDaSala,
  listarMotivosRefugo,
  listarMovimentosDoDia,
  type ProdutoSala,
  type Sala,
} from "@/services/salasService";

/**
 * Contexto da sala em que o operador está trabalhando (FS3-2).
 *
 * Junta as três coisas que toda tela do módulo precisa: em que sala estou,
 * o que existe nela, e o que eu posso fazer.
 *
 * SOBRE PERMISSÃO — o módulo tem DOIS eixos, e confundi-los dá erro silencioso:
 *   - o PAPEL dá o verbo  (`salas.registrar.entrada` — permissão global do RBAC);
 *   - o VÍNCULO dá o lugar (`prod_sala_usuarios` — em que sala você trabalha).
 * O vínculo já foi aplicado ao montar a lista de salas (`listarSalasDoUsuario`),
 * então, uma vez dentro de uma sala, basta o verbo para decidir o que mostrar.
 * Esconder botão é conveniência: a RPC (`user_has_sala_permission`) é quem
 * decide de fato, e ela cobra os dois eixos.
 *
 */
export function useSalaContexto() {
  const { user, profile } = useAuth();
  const isAdmin = profile?.is_admin === true;

  const podeEntrada = useHasPermission(PERMISSIONS.SALAS_REGISTRAR_ENTRADA);
  const podeRefugo = useHasPermission(PERMISSIONS.SALAS_REGISTRAR_REFUGO);
  const podeSaida = useHasPermission(PERMISSIONS.SALAS_REGISTRAR_SAIDA);
  const podeEstornar = useHasPermission(PERMISSIONS.SALAS_ESTORNAR);
  const podeGerirEquipe = useHasPermission(PERMISSIONS.SALAS_CADASTROS_MANAGE);

  const [salaIdSelecionada, setSalaIdSelecionada] = useState<string | null>(null);

  const { data: salas = [], isLoading: carregandoSalas } = useQuery({
    queryKey: ["salas_do_usuario", user?.id, isAdmin],
    queryFn: () => listarSalasDoUsuario(user!.id, isAdmin),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  /**
   * Com uma sala só, entra direto — sem seletor (§B.4). Com duas ou mais, espera
   * a escolha. `useMemo` em vez de `useEffect` + `setState` para não renderizar
   * uma vez com `null` antes de resolver.
   */
  const salaAtiva: Sala | null = useMemo(() => {
    if (salas.length === 0) return null;
    if (salaIdSelecionada) return salas.find((s) => s.id === salaIdSelecionada) ?? null;
    if (salas.length === 1) return salas[0];
    return null;
  }, [salas, salaIdSelecionada]);

  const { data: produtos = [], isLoading: carregandoProdutos } = useQuery({
    queryKey: ["salas_produtos", salaAtiva?.id],
    queryFn: () => listarProdutosDaSala(salaAtiva!.id),
    enabled: !!salaAtiva,
    staleTime: 5 * 60_000,
  });

  const insumos = useMemo(() => produtos.filter((p: ProdutoSala) => p.papel === "INSUMO"), [produtos]);
  const produtosFinais = useMemo(
    () => produtos.filter((p: ProdutoSala) => p.papel === "PRODUTO"),
    [produtos],
  );

  return {
    salas,
    salaAtiva,
    selecionarSala: setSalaIdSelecionada,
    precisaEscolherSala: salas.length > 1 && !salaAtiva,
    produtos,
    insumos,
    produtosFinais,
    carregando: carregandoSalas || carregandoProdutos,
    podeEntrada,
    podeRefugo,
    podeSaida,
    podeEstornar,
    podeGerirEquipe,
    isAdmin,
    userId: user?.id ?? null,
  };
}

/**
 * Motivos de refugo do tipo de item escolhido. Consulta só depois que o
 * operador escolheu entre peça e insumo — a lista muda conforme a escolha, e
 * `AMBOS` entra nas duas (é o que a RPC aceita).
 */
export function useMotivosRefugo(tipoItem: "INSUMO" | "PRODUTO" | null) {
  const { data: motivos = [], isLoading } = useQuery({
    queryKey: ["salas_motivos_refugo", tipoItem],
    queryFn: () => listarMotivosRefugo(tipoItem!),
    enabled: !!tipoItem,
    staleTime: 5 * 60_000,
  });

  return { motivos, carregando: isLoading };
}

/**
 * Log do dia da sala. `staleTime` curto porque é a confirmação visual de que o
 * registro entrou — o operador acabou de tocar em "Registrar" e quer ver a linha.
 */
export function useMovimentosDoDia(salaId: string | null) {
  const { data: movimentos = [], isLoading, refetch } = useQuery({
    queryKey: ["salas_movimentos_dia", salaId],
    queryFn: () => listarMovimentosDoDia(salaId!),
    enabled: !!salaId,
    staleTime: 15_000,
  });

  return { movimentos, carregando: isLoading, recarregar: refetch };
}
