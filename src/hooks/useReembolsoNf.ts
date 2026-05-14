/**
 * Hooks TanStack Query da Frente 3 — Intercompany / Reembolso NF.
 *
 * Consome funções de @/services/intercompanyReembolsoNfService.
 * Define queryKeys, cache invalidation e callbacks.
 *
 * Convenção de queryKey:
 *   ["reembolso-nf", "rascunho"]         → estado da cesta (Lado 2)
 *   ["reembolso-nf", "movestq", filtros] → NFs disponíveis (Lado 1)
 *
 * Mutations invalidam as queries afetadas automaticamente.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EmitReembolsoNFRequest,
  EmitReembolsoNFResponse,
  MovEstqDisponivel,
  MovEstqFiltros,
  RascunhoDetails,
  SyncMovEstqRequest,
  SyncMovEstqResponse,
  TipoBloco,
} from "@/types/intercompanyReembolsoNf";
import {
  addRateioToRascunho,
  discardRascunho,
  emitirInvoice,
  getMovEstqDisponivel,
  getRascunhoDetails,
  initOrResumeRascunho,
  removeRateioFromRascunho,
  setRascunhoItemKonto,
  syncMovEstq,
} from "@/services/intercompanyReembolsoNfService";

// ─── Query keys (centralizadas pra invalidação consistente) ───
const QK = {
  rascunho: () => ["reembolso-nf", "rascunho"] as const,
  movestq: (filtros: MovEstqFiltros) => ["reembolso-nf", "movestq", filtros] as const,
  movestqAll: () => ["reembolso-nf", "movestq"] as const,
};

// ═════════════════════════════════════════════════════════════
// Queries — Lado 1 e Lado 2
// ═════════════════════════════════════════════════════════════

/**
 * Lista NFs disponíveis do MovEstq. Filtragem server-side; mude `filtros`
 * pra disparar nova query (TanStack cuida do cache por queryKey).
 *
 * Como a view tem 603 linhas hoje, mantemos staleTime 5min — sem refetch
 * agressivo. Sandra clica "Sincronizar" pra forçar atualização.
 */
export function useMovEstqDisponivel(filtros: MovEstqFiltros = {}) {
  return useQuery<MovEstqDisponivel[]>({
    queryKey: QK.movestq(filtros),
    queryFn: () => getMovEstqDisponivel(filtros),
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
}

/**
 * Estado da cesta. Driver principal do Lado 2.
 *
 * `enabled` permite postergar o fetch até `initOrResumeRascunho` rodar
 * na montagem da página (Passo 3.5 vai usar isso).
 */
export function useRascunhoDetails(enabled: boolean = true) {
  return useQuery<RascunhoDetails>({
    queryKey: QK.rascunho(),
    queryFn: getRascunhoDetails,
    enabled,
    staleTime: 30 * 1000, // 30s — Sandra interage com a cesta o tempo todo
  });
}

// ═════════════════════════════════════════════════════════════
// Mutations — cesta
// ═════════════════════════════════════════════════════════════

/**
 * Inicializa ou recupera o rascunho ativo do user.
 * Componente chama no `useEffect` da montagem; após sucesso, ativa
 * `useRascunhoDetails(enabled=true)`.
 */
export function useInitOrResumeRascunho() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: initOrResumeRascunho,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.rascunho() });
    },
  });
}

export function useAddRateioToRascunho() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rateioId: string) => addRateioToRascunho(rateioId),
    onSuccess: () => {
      // Cesta mudou; view também (rateio consumido sai da listagem)
      qc.invalidateQueries({ queryKey: QK.rascunho() });
      qc.invalidateQueries({ queryKey: QK.movestqAll() });
    },
  });
}

export function useRemoveRateioFromRascunho() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) => removeRateioFromRascunho(itemId),
    onSuccess: () => {
      // Item removido volta pra view
      qc.invalidateQueries({ queryKey: QK.rascunho() });
      qc.invalidateQueries({ queryKey: QK.movestqAll() });
    },
  });
}

export function useSetRascunhoItemKonto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, tipoBloco }: { itemId: string; tipoBloco: TipoBloco }) =>
      setRascunhoItemKonto(itemId, tipoBloco),
    onSuccess: () => {
      // Só a cesta muda — view não é afetada
      qc.invalidateQueries({ queryKey: QK.rascunho() });
    },
  });
}

export function useDiscardRascunho() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: discardRascunho,
    onSuccess: () => {
      // Itens descartados voltam pra view
      qc.invalidateQueries({ queryKey: QK.rascunho() });
      qc.invalidateQueries({ queryKey: QK.movestqAll() });
    },
  });
}

// ═════════════════════════════════════════════════════════════
// Mutations — gateway
// ═════════════════════════════════════════════════════════════

/**
 * Sincroniza MovEstq do Alvo. Retorna summary com totais.
 * Após sucesso, invalida a view pra recarregar com os novos rateios.
 */
export function useSyncMovEstq() {
  const qc = useQueryClient();
  return useMutation<SyncMovEstqResponse, unknown, SyncMovEstqRequest>({
    mutationFn: syncMovEstq,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.movestqAll() });
    },
  });
}

/**
 * Emite invoice no Alvo + converte rascunho → master.
 * Após sucesso, INVALIDA TUDO (cesta esvazia, view recarrega).
 *
 * Em caso de erro `kind="alvo_orfao"`, o componente DEVE abrir modal crítico
 * bloqueante — a cesta NÃO foi convertida no Hub mas o DocFin existe no Alvo.
 * Componente deve permitir copiar `error.details.chave_orfa` pra Sandra avisar TI.
 */
export function useEmitirInvoice() {
  const qc = useQueryClient();
  return useMutation<EmitReembolsoNFResponse, unknown, EmitReembolsoNFRequest>({
    mutationFn: emitirInvoice,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.rascunho() });
      qc.invalidateQueries({ queryKey: QK.movestqAll() });
    },
  });
}
