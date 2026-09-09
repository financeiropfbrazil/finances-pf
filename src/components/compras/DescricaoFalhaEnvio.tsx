import type { AvisoFalhaEnvio } from "@/lib/requisicaoPosEnvio";

/**
 * Corpo do toast de falha no envio ao ERP.
 *
 * Quando o aviso vem com `detalheTecnico`, a frase principal foi reescrita em
 * português de quem usa o Hub e o texto literal do ERP precisa continuar visível —
 * embaixo, menor, identificado como detalhe técnico. É a regra do card de 09/09/2026:
 * traduzir a mensagem sem esconder a original, que é o que o Suprimentos leva ao
 * suporte do ERP. Sem `detalheTecnico`, a descrição já contém o texto do ERP e o
 * toast fica exatamente como era.
 */
export function DescricaoFalhaEnvio({ aviso }: { aviso: AvisoFalhaEnvio }) {
  if (!aviso.detalheTecnico) return <>{aviso.descricao}</>;

  return (
    <>
      {aviso.descricao}
      <span className="mt-1 block text-xs opacity-80">Detalhe técnico (ERP): {aviso.detalheTecnico}</span>
    </>
  );
}
