import { useState } from "react";
import {
  criarRascunhoReembolsoManual,
  emitirReembolsoManualNoAlvo,
  atualizarStatusEmissaoManual,
} from "@/services/intercompanyMasterService";
import type { CriarReembolsoManualInput } from "@/types/intercompany";

type Status = "idle" | "criando" | "emitindo" | "sucesso" | "erro";

interface ResultadoManual {
  master_id: string;
  chave_alvo?: number;
  numero_invoice: string;
  pdf_status?: {
    gerado: boolean;
    anexado_alvo: boolean;
    upload_identify_guid?: string;
    storage_path?: string;
    erro?: string;
  };
}

/**
 * Hook que orquestra emissão de Reembolso Manual (Frente 4).
 *
 * Fluxo:
 *   1. criarRascunhoReembolsoManual → RPC Supabase cria master + blocos + rateios
 *   2. emitirReembolsoManualNoAlvo → gateway cria DocFin no Alvo + PDF + anexação + Storage
 *   3. atualizarStatusEmissaoManual → RPC Supabase atualiza status do master
 *
 * Estados:
 *   - idle: pronto pra novo submit
 *   - criando: rascunho sendo salvo no Hub
 *   - emitindo: chamada ao gateway em andamento
 *   - sucesso: tudo OK, resultado disponível
 *   - erro: algo falhou, error preenchido
 */
export function useEmitReembolsoManual() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoManual | null>(null);

  const reset = () => {
    setStatus("idle");
    setError(null);
    setResultado(null);
  };

  const emitir = async (input: CriarReembolsoManualInput) => {
    try {
      setError(null);
      setResultado(null);

      // ─── Fase 1: cria rascunho no Hub ───
      setStatus("criando");
      const criar = await criarRascunhoReembolsoManual(input);

      // ─── Fase 2: emite no Alvo via gateway ───
      setStatus("emitindo");
      const emit = await emitirReembolsoManualNoAlvo({
        master_id: criar.master_id,
        numero_invoice: criar.numero_invoice,
        numero_sequencial: criar.numero_sequencial,
        ano: criar.ano,
        descricao_observacao: input.descricao_observacao,
        description_pdf: input.description_pdf,
        cambio_eur_brl: input.cambio_eur_brl,
        valor_eur_total: criar.valor_eur,
        valor_brl: criar.valor_brl,
        markup_aplicado: criar.markup_aplicado,
        valor_eur_service_fee: criar.valor_eur_service_fee,
        valor_eur_other_expenses: criar.valor_eur_other_expenses,
        blocos: input.blocos,
      });

      // ─── Fase 3: atualiza status no Hub ───
      await atualizarStatusEmissaoManual(
        criar.master_id,
        emit.success,
        emit.chave_docfin_alvo,
        emit.success ? undefined : emit.error,
      );

      if (emit.success) {
        setResultado({
          master_id: criar.master_id,
          chave_alvo: emit.chave_docfin_alvo,
          numero_invoice: criar.numero_invoice,
          pdf_status: emit.pdf_status,
        });
        setStatus("sucesso");
      } else {
        setError(emit.error ?? "Erro desconhecido na emissão Alvo");
        setStatus("erro");
      }
    } catch (err: any) {
      setError(err?.message ?? "Erro desconhecido");
      setStatus("erro");
    }
  };

  return { status, error, resultado, emitir, reset };
}
