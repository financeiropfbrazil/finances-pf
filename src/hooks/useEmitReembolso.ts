import { useState } from "react";
import {
  criarRascunhoReembolso,
  emitirReembolsoNoAlvo,
  atualizarStatusEmissao,
} from "@/services/intercompanyMasterService";
import type { CriarReembolsoInput } from "@/types/intercompany";

type Status = "idle" | "criando" | "emitindo" | "sucesso" | "erro";

interface Resultado {
  master_id: string;
  chave_alvo?: number;
  numero_invoice: string;
}

export function useEmitReembolso() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const reset = () => {
    setStatus("idle");
    setError(null);
    setResultado(null);
  };

  const emitir = async (input: CriarReembolsoInput) => {
    try {
      setError(null);
      setResultado(null);
      setStatus("criando");

      const criar = await criarRascunhoReembolso(input);

      setStatus("emitindo");
      const emit = await emitirReembolsoNoAlvo({
        master_id: criar.master_id,
        numero_invoice: criar.numero_invoice,
        numero_sequencial: criar.numero_sequencial,
        descricao_rica: input.descricao_rica,
        classe_codigo: input.classe_codigo,
        centro_custo_erp_code: input.centro_custo_erp_code, // ✅ NOVO
        cambio_eur_brl: input.cambio_eur_brl,
        valor_eur: input.valor_eur,
        valor_brl: criar.valor_brl,
      });

      await atualizarStatusEmissao(
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
        });
        setStatus("sucesso");
      } else {
        setError(emit.error ?? "Erro desconhecido");
        setStatus("erro");
      }
    } catch (err: any) {
      setError(err?.message ?? "Erro desconhecido");
      setStatus("erro");
    }
  };

  return { status, error, resultado, emitir, reset };
}
