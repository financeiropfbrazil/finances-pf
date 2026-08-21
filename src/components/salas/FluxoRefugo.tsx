import { useState } from "react";
import { toast } from "sonner";
import { PassoFluxo } from "@/components/salas/PassoFluxo";
import { CartaoEscolha } from "@/components/salas/CartaoEscolha";
import { TecladoNumerico, valorNumerico } from "@/components/salas/TecladoNumerico";
import { SeletorUnidade, LinhaConferencia, VisorQuantidade } from "@/components/salas/CamposPasso";
import { Input } from "@/components/ui/input";
import { useMotivosRefugo } from "@/hooks/useSalaContexto";
import {
  registrarRefugo,
  textoConversao,
  unidadePadrao,
  formatarNumero,
  type MotivoRefugo,
  type ProdutoSala,
  type Sala,
} from "@/services/salasService";

/**
 * Refugo de peça ou de insumo (FS3-7) — 4 passos do §E.3.
 *
 * O que foi refugado → Motivo → Quantidade e lote → Conferência.
 *
 * O tipo do item NÃO é uma pergunta separada: ele sai do papel que o produto
 * tem na sala (`papel`), porque perguntar duas vezes a mesma coisa é onde o
 * operador erra. A RPC recusa a combinação errada de qualquer forma
 * ("Produto é INSUMO nesta sala, não PRODUTO"), e a lista de motivos muda com a
 * escolha — motivo de peça não aparece para insumo.
 */
export interface FluxoRefugoProps {
  sala: Sala;
  insumos: ProdutoSala[];
  produtosFinais: ProdutoSala[];
  onConcluido: () => void;
  onCancelar: () => void;
}

export function FluxoRefugo({
  sala,
  insumos,
  produtosFinais,
  onConcluido,
  onCancelar,
}: FluxoRefugoProps) {
  const [passo, setPasso] = useState(1);
  const [produto, setProduto] = useState<ProdutoSala | null>(null);
  const [motivo, setMotivo] = useState<MotivoRefugo | null>(null);
  const [unidade, setUnidade] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [lote, setLote] = useState("");
  const [enviando, setEnviando] = useState(false);

  const tipoItem = produto?.papel ?? null;
  const { motivos, carregando: carregandoMotivos } = useMotivosRefugo(tipoItem);

  const escolherProduto = (p: ProdutoSala) => {
    setProduto(p);
    setUnidade(unidadePadrao(p));
    setQuantidade("");
    setMotivo(null); // a lista muda com o tipo; motivo antigo não pode sobreviver
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
  // A RPC exige lote só para refugo de INSUMO que controla lote.
  const precisaLote = (produto?.controla_lote ?? false) && tipoItem === "INSUMO";
  const podeContinuarQuantidade = !!qtd && (!precisaLote || lote.trim() !== "");

  const enviar = async () => {
    if (!produto || !motivo || !qtd) return;
    setEnviando(true);
    try {
      await registrarRefugo({
        salaId: sala.id,
        produtoId: produto.id,
        tipoItem: produto.papel,
        motivoId: motivo.id,
        quantidade: qtd,
        unidade,
        lote: lote.trim() === "" ? null : lote.trim(),
      });
      toast.success("Refugo registrado.");
      onConcluido();
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível registrar o refugo.");
    } finally {
      setEnviando(false);
    }
  };

  if (passo === 1) {
    return (
      <PassoFluxo
        titulo="Refugo — o que foi refugado?"
        descricao={sala.nome}
        passoAtual={1}
        totalPassos={4}
        onVoltar={voltar}
      >
        <div className="space-y-6">
          <GrupoItens
            titulo="Peça produzida"
            itens={produtosFinais}
            selecionadoId={produto?.id}
            onEscolher={escolherProduto}
          />
          <GrupoItens
            titulo="Insumo"
            itens={insumos}
            selecionadoId={produto?.id}
            onEscolher={escolherProduto}
          />
        </div>
      </PassoFluxo>
    );
  }

  if (passo === 2 && produto) {
    return (
      <PassoFluxo
        titulo="Por que foi refugado?"
        descricao={produto.nome_curto ?? produto.nome}
        passoAtual={2}
        totalPassos={4}
        onVoltar={voltar}
      >
        {carregandoMotivos ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Carregando motivos…</p>
        ) : motivos.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum motivo cadastrado para este tipo de item.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {motivos.map((m) => (
              <CartaoEscolha
                key={m.id}
                titulo={m.nome}
                selecionado={motivo?.id === m.id}
                onClick={() => {
                  setMotivo(m);
                  setPasso(3);
                }}
              />
            ))}
          </div>
        )}
      </PassoFluxo>
    );
  }

  if (passo === 3 && produto) {
    return (
      <PassoFluxo
        titulo="Quanto foi refugado?"
        descricao={produto.nome_curto ?? produto.nome}
        passoAtual={3}
        totalPassos={4}
        onVoltar={voltar}
        acaoPrincipal={{
          rotulo: "Continuar",
          onClick: () => setPasso(4),
          desabilitada: !podeContinuarQuantidade,
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

        {precisaLote ? (
          <label className="mt-4 block">
            <span className="text-sm font-medium text-foreground">Lote do material</span>
            <Input
              value={lote}
              onChange={(e) => setLote(e.target.value)}
              placeholder="Como está na etiqueta"
              className="mt-1 h-14 text-base"
              autoComplete="off"
            />
          </label>
        ) : null}
      </PassoFluxo>
    );
  }

  if (passo === 4 && produto && motivo && qtd) {
    return (
      <PassoFluxo
        titulo="Confira antes de registrar"
        descricao={sala.nome}
        passoAtual={4}
        totalPassos={4}
        onVoltar={voltar}
        acaoPrincipal={{
          rotulo: "Registrar refugo",
          onClick: enviar,
          carregando: enviando,
        }}
      >
        <dl className="divide-y divide-border rounded-lg border border-border bg-card">
          <LinhaConferencia
            rotulo="Tipo"
            valor={produto.papel === "PRODUTO" ? "Peça produzida" : "Insumo"}
          />
          <LinhaConferencia rotulo="Item" valor={produto.nome_curto ?? produto.nome} />
          <LinhaConferencia rotulo="Motivo" valor={motivo.nome} />
          <LinhaConferencia rotulo="Quantidade" valor={`${formatarNumero(qtd)} ${unidade}`} destaque />
          {conversao ? <LinhaConferencia rotulo="Equivale a" valor={conversao} /> : null}
          {lote.trim() !== "" ? <LinhaConferencia rotulo="Lote" valor={lote.trim()} /> : null}
        </dl>
      </PassoFluxo>
    );
  }

  return null;
}

function GrupoItens({
  titulo,
  itens,
  selecionadoId,
  onEscolher,
}: {
  titulo: string;
  itens: ProdutoSala[];
  selecionadoId?: string;
  onEscolher: (p: ProdutoSala) => void;
}) {
  if (itens.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {itens.map((p) => (
          <CartaoEscolha
            key={p.id}
            titulo={p.nome_curto ?? p.nome}
            subtitulo={p.codigo_alvo}
            selecionado={selecionadoId === p.id}
            onClick={() => onEscolher(p)}
          />
        ))}
      </div>
    </div>
  );
}
