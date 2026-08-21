import { useState } from "react";
import { toast } from "sonner";
import { PassoFluxo } from "@/components/salas/PassoFluxo";
import { CartaoEscolha } from "@/components/salas/CartaoEscolha";
import { TecladoNumerico, valorNumerico } from "@/components/salas/TecladoNumerico";
import { SeletorUnidade, LinhaConferencia, VisorQuantidade } from "@/components/salas/CamposPasso";
import { Input } from "@/components/ui/input";
import {
  registrarSaida,
  textoConversao,
  unidadePadrao,
  formatarNumero,
  type ProdutoSala,
  type Sala,
} from "@/services/salasService";

/**
 * Saída de produto da sala (FS3-8) — 3 passos do §E.4.
 *
 * Produto → Quantidade e lote → Conferência.
 *
 * SOBRE O CAMPO "LOTE": é o lote de PRODUÇÃO, o número da peça que a sala
 * acabou de fazer — não o lote do material que entrou. Rótulo "Lote" por
 * decisão do §B.2; se a sala confundir com o lote do material no teste, o
 * próprio §B.2 manda trocar para "Lote de produção".
 *
 * É campo livre e obrigatório: a origem do número ainda é desconhecida (§F.2 do
 * Ajuste B) e o Pedro vai investigar. Por isso nenhuma validação de formato
 * aqui — inventar uma máscara agora seria chutar a regra de outra pessoa.
 */
export interface FluxoSaidaProps {
  sala: Sala;
  produtosFinais: ProdutoSala[];
  onConcluido: () => void;
  onCancelar: () => void;
}

export function FluxoSaida({ sala, produtosFinais, onConcluido, onCancelar }: FluxoSaidaProps) {
  const [passo, setPasso] = useState(1);
  const [produto, setProduto] = useState<ProdutoSala | null>(null);
  const [unidade, setUnidade] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [loteProducao, setLoteProducao] = useState("");
  const [enviando, setEnviando] = useState(false);

  const escolherProduto = (p: ProdutoSala) => {
    setProduto(p);
    setUnidade(unidadePadrao(p));
    setQuantidade("");
    setPasso(2);
  };

  const voltar = () => {
    if (passo === 1) {
      onCancelar();
      return;
    }
    setPasso(passo - 1);
  };

  const qtd = valorNumerico(quantidade);
  const conversao = produto && qtd ? textoConversao(produto, unidade, qtd) : null;
  const podeContinuar = !!qtd && loteProducao.trim() !== "";

  const enviar = async () => {
    if (!produto || !qtd) return;
    setEnviando(true);
    try {
      await registrarSaida({
        salaId: sala.id,
        produtoId: produto.id,
        quantidade: qtd,
        unidade,
        loteProducao: loteProducao.trim(),
      });
      toast.success("Saída registrada.");
      onConcluido();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível registrar a saída.");
    } finally {
      setEnviando(false);
    }
  };

  if (passo === 1) {
    return (
      <PassoFluxo
        titulo="Saída — o que saiu?"
        descricao={sala.nome}
        passoAtual={1}
        totalPassos={3}
        onVoltar={voltar}
      >
        {produtosFinais.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Esta sala não tem produto de saída cadastrado.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {produtosFinais.map((p) => (
              <CartaoEscolha
                key={p.id}
                titulo={p.nome_curto ?? p.nome}
                subtitulo={p.codigo_alvo}
                selecionado={produto?.id === p.id}
                onClick={() => escolherProduto(p)}
              />
            ))}
          </div>
        )}
      </PassoFluxo>
    );
  }

  if (passo === 2 && produto) {
    return (
      <PassoFluxo
        titulo="Quanto saiu?"
        descricao={produto.nome_curto ?? produto.nome}
        passoAtual={2}
        totalPassos={3}
        onVoltar={voltar}
        acaoPrincipal={{
          rotulo: "Continuar",
          onClick: () => setPasso(3),
          desabilitada: !podeContinuar,
        }}
      >
        <SeletorUnidade produto={produto} unidade={unidade} onEscolher={setUnidade} />

        <div className="mt-4">
          <VisorQuantidade quantidade={quantidade} unidade={unidade} conversao={conversao} />
        </div>

        <div className="mt-4">
          <TecladoNumerico
            valor={quantidade}
            onChange={setQuantidade}
            casasDecimais={unidade === "UNID" ? 0 : 3}
          />
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-medium text-foreground">Lote</span>
          <Input
            value={loteProducao}
            onChange={(e) => setLoteProducao(e.target.value)}
            placeholder="Lote de produção desta peça"
            className="mt-1 h-14 text-base"
            autoComplete="off"
          />
        </label>
      </PassoFluxo>
    );
  }

  if (passo === 3 && produto && qtd) {
    return (
      <PassoFluxo
        titulo="Confira antes de registrar"
        descricao={sala.nome}
        passoAtual={3}
        totalPassos={3}
        onVoltar={voltar}
        acaoPrincipal={{
          rotulo: "Registrar saída",
          onClick: enviar,
          carregando: enviando,
        }}
      >
        <dl className="divide-y divide-border rounded-lg border border-border bg-card">
          <LinhaConferencia rotulo="Item" valor={produto.nome_curto ?? produto.nome} />
          <LinhaConferencia rotulo="Código" valor={produto.codigo_alvo} />
          <LinhaConferencia rotulo="Quantidade" valor={`${formatarNumero(qtd)} ${unidade}`} destaque />
          {conversao ? <LinhaConferencia rotulo="Equivale a" valor={conversao} /> : null}
          <LinhaConferencia rotulo="Lote" valor={loteProducao.trim()} />
        </dl>
      </PassoFluxo>
    );
  }

  return null;
}
