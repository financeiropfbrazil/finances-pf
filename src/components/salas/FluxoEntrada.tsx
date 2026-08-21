import { useState } from "react";
import { toast } from "sonner";
import { PassoFluxo } from "@/components/salas/PassoFluxo";
import { CartaoEscolha } from "@/components/salas/CartaoEscolha";
import { TecladoNumerico, valorNumerico } from "@/components/salas/TecladoNumerico";
import { Input } from "@/components/ui/input";
import { SeletorUnidade, LinhaConferencia, VisorQuantidade } from "@/components/salas/CamposPasso";
import {
  registrarEntrada,
  textoConversao,
  unidadePadrao,
  formatarNumero,
  type ProdutoSala,
  type Sala,
} from "@/services/salasService";

/**
 * Entrada de insumo na sala (FS3-6) — 4 passos do §E.2.
 *
 * Insumo → Quantidade → Lote e validade → Conferência.
 *
 * O front NÃO valida lote vencido, de propósito. A regra é do banco
 * (`p_validade < p_data_movimento`, comparada com o relógio do servidor) e
 * duplicá-la aqui criaria duas verdades que podem divergir — o navegador do
 * tablet pode estar com a data errada. A RPC recusa e a mensagem dela é
 * mostrada como veio: "Lote X vencido em 30/06/2026 — não pode entrar na sala".
 */
export interface FluxoEntradaProps {
  sala: Sala;
  insumos: ProdutoSala[];
  onConcluido: () => void;
  onCancelar: () => void;
}

export function FluxoEntrada({ sala, insumos, onConcluido, onCancelar }: FluxoEntradaProps) {
  const [passo, setPasso] = useState(1);
  const [produto, setProduto] = useState<ProdutoSala | null>(null);
  const [unidade, setUnidade] = useState<string>("");
  const [quantidade, setQuantidade] = useState("");
  const [lote, setLote] = useState("");
  const [validade, setValidade] = useState("");
  const [enviando, setEnviando] = useState(false);

  const escolherProduto = (p: ProdutoSala) => {
    setProduto(p);
    setUnidade(unidadePadrao(p)); // base pré-selecionada (§E.2 passo 2)
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
  const precisaLote = produto?.controla_lote ?? false;
  const loteOk = !precisaLote || (lote.trim() !== "" && validade !== "");

  const enviar = async () => {
    if (!produto || !qtd) return;
    setEnviando(true);
    try {
      await registrarEntrada({
        salaId: sala.id,
        produtoId: produto.id,
        quantidade: qtd,
        unidade,
        lote: precisaLote ? lote.trim() : null,
        validade: precisaLote ? validade : null,
      });
      toast.success("Entrada registrada.");
      onConcluido();
    } catch (e: any) {
      // Mensagem da RPC, sem traduzir nem reformular (§E.2).
      toast.error(e?.message || "Não foi possível registrar a entrada.");
    } finally {
      setEnviando(false);
    }
  };

  if (passo === 1) {
    return (
      <PassoFluxo
        titulo="Entrada — o que entrou?"
        descricao={sala.nome}
        passoAtual={1}
        totalPassos={4}
        onVoltar={voltar}
      >
        {insumos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Esta sala não tem insumos cadastrados.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {insumos.map((p) => (
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
        titulo="Quanto entrou?"
        descricao={produto.nome_curto ?? produto.nome}
        passoAtual={2}
        totalPassos={4}
        onVoltar={voltar}
        acaoPrincipal={{
          rotulo: "Continuar",
          onClick: () => setPasso(3),
          desabilitada: !qtd,
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
      </PassoFluxo>
    );
  }

  if (passo === 3 && produto) {
    return (
      <PassoFluxo
        titulo="Lote e validade"
        descricao={produto.nome_curto ?? produto.nome}
        passoAtual={3}
        totalPassos={4}
        onVoltar={voltar}
        acaoPrincipal={{
          rotulo: "Continuar",
          onClick: () => setPasso(4),
          desabilitada: !loteOk,
        }}
      >
        {precisaLote ? (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-foreground">Lote do material</span>
              <Input
                value={lote}
                onChange={(e) => setLote(e.target.value)}
                placeholder="Como está na etiqueta"
                className="mt-1 h-14 text-base"
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-foreground">Validade do lote</span>
              <Input
                type="date"
                value={validade}
                onChange={(e) => setValidade(e.target.value)}
                className="mt-1 h-14 text-base tabular-nums"
              />
            </label>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Este item não controla lote. Pode continuar.
          </p>
        )}
      </PassoFluxo>
    );
  }

  if (passo === 4 && produto && qtd) {
    return (
      <PassoFluxo
        titulo="Confira antes de registrar"
        descricao={sala.nome}
        passoAtual={4}
        totalPassos={4}
        onVoltar={voltar}
        acaoPrincipal={{
          rotulo: "Registrar entrada",
          onClick: enviar,
          carregando: enviando,
        }}
      >
        <dl className="divide-y divide-border rounded-lg border border-border bg-card">
          <LinhaConferencia rotulo="Item" valor={produto.nome_curto ?? produto.nome} />
          <LinhaConferencia rotulo="Código" valor={produto.codigo_alvo} />
          <LinhaConferencia rotulo="Quantidade" valor={`${formatarNumero(qtd)} ${unidade}`} destaque />
          {conversao ? <LinhaConferencia rotulo="Equivale a" valor={conversao} /> : null}
          {precisaLote ? <LinhaConferencia rotulo="Lote" valor={lote.trim()} /> : null}
          {precisaLote ? (
            <LinhaConferencia
              rotulo="Validade"
              valor={validade ? new Date(`${validade}T00:00:00`).toLocaleDateString("pt-BR") : "—"}
            />
          ) : null}
        </dl>
      </PassoFluxo>
    );
  }

  return null;
}
