/**
 * Detalhe de uma NF-e de produto recebida em 6 etapas — o mesmo esquema da NFS-e (PLANO-NFE NFE-4):
 *   1 Nota fiscal · 2 Pedidos · 3 MovEstq · 4 DANFE (PDF da nota) · 5 PDF do boleto · 6 DocFin
 *
 * Fonte: RPC `nfe_recebida_detalhe` (NFE-3). Anexos: buckets privados `nfe-nf-pdf` / `nfe-boleto-pdf` + RPCs
 * `nfe_anexo_registrar` / `nfe_anexo_remover`. As peças visuais vêm da NFS-e (`NfseDetalheEtapas`).
 *
 * Eixos sempre com nome (regra LIVRO × ESPELHO do CLAUDE.md): "No Alvo" são os espelhos do Alvo (MovEstq em
 * rastreio_nf, títulos em fin_parcelas_pagar); "Vínculo no Hub" é o que alguém marcou nesta tela. A situação no
 * fisco NÃO é acompanhada: a nota chega pela Riosoft (Arqimport) já autorizada e o Hub não consulta a SEFAZ.
 */
import { useRef, type MutableRefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  Download,
  Eye,
  FileText,
  Link as LinkIcon,
  Loader2,
  PackageCheck,
  Paperclip,
  Receipt,
  RefreshCw,
  Send,
  ShoppingCart,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AreaAnexo,
  Aviso,
  Campo,
  CartaoCandidato,
  ChaveMovEstq,
  Coluna,
  Etiquetas,
  LeituraBoleto,
  LinhaParcela,
  Regua,
  SituacaoPedido,
  colunasPorLinha,
  emitidaHa,
  parcelaPaga,
  parcelaVencida,
  useLarguraVisivel,
  type AcoesAnexo,
  type EstadoEtapa,
} from "@/components/nfse/NfseDetalheEtapas";
import { formatCurrency, formatDate, formatDoc, formatInstanteBrt, hojeBrt } from "@/components/nfse/nfseFormatos";
import {
  anexarPdfNfe,
  buscarDetalheNfe,
  lerBoletoNfe,
  removerAnexoNfe,
  type DetalheNfe,
} from "@/services/nfeRecebidasService";

const ACOES_NFE: AcoesAnexo = { anexar: anexarPdfNfe, remover: removerAnexoNfe, nomeNota: "DANFE" };

export const chaveDetalheNfe = (id: string) => ["nfe-detalhe", id] as const;

export function NfeDetalheEtapas({
  nfeId,
  onVerXml,
  onBaixarXml,
  onVincular,
  onDesvincular,
}: {
  nfeId: string;
  onVerXml: () => void;
  onBaixarXml: () => void;
  onVincular: () => void;
  onDesvincular: () => void;
}) {
  const queryClient = useQueryClient();
  const colunas = useRef<(HTMLElement | null)[]>([]);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: chaveDetalheNfe(nfeId),
    queryFn: () => buscarDetalheNfe(nfeId),
    staleTime: 30_000,
  });
  const atualizar = () => queryClient.invalidateQueries({ queryKey: chaveDetalheNfe(nfeId) });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando as etapas da nota...
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex items-center gap-3 p-6 text-xs">
        <AlertTriangle className="h-4 w-4 text-rose-600" />
        <span>{error instanceof Error ? error.message : "Nota não encontrada."}</span>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  return (
    <Etapas
      d={data}
      onVerXml={onVerXml}
      onBaixarXml={onBaixarXml}
      onVincular={onVincular}
      onDesvincular={onDesvincular}
      onAtualizar={atualizar}
      atualizando={isFetching}
      colunas={colunas}
    />
  );
}

function Etapas({
  d,
  onVerXml,
  onBaixarXml,
  onVincular,
  onDesvincular,
  onAtualizar,
  atualizando,
  colunas,
}: {
  d: DetalheNfe;
  onVerXml: () => void;
  onBaixarXml: () => void;
  onVincular: () => void;
  onDesvincular: () => void;
  onAtualizar: () => void;
  atualizando: boolean;
  colunas: MutableRefObject<(HTMLElement | null)[]>;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const visivel = useLarguraVisivel(raiz);
  const porLinha = colunasPorLinha(visivel.largura);
  const n = d.nota;
  const hoje = hojeBrt();
  const espelhoDesde = formatDate(d.meta.alvo_espelho_desde);
  const vinculados = d.pedidos.vinculados ?? [];
  const vinculoHub = d.pedidos.vinculo_hub ?? [];
  const candidatos = d.pedidos.candidatos ?? [];
  const lancada = n.situacao_alvo === "lancada";
  const semDado = n.situacao_alvo === "sem_dado_alvo";
  const anexoNf = d.anexos.find((a) => a.tipo === "nf");
  const anexoBoleto = d.anexos.find((a) => a.tipo === "boleto");
  const parcelas = d.docfin.parcelas ?? [];
  const pagas = parcelas.filter(parcelaPaga).length;
  const vencidas = parcelas.filter((p) => parcelaVencida(p, hoje)).length;
  const proxima = parcelas
    .filter((p) => !parcelaPaga(p))
    .sort((a, b) => (a.data_vencimento ?? "").localeCompare(b.data_vencimento ?? ""))[0];
  const itens = n.itens ?? [];
  const cfops = [...new Set(itens.map((i) => i.cfop).filter(Boolean))];

  // ── estado de cada etapa ──
  const e1: EstadoEtapa = n.tem_xml ? "feito" : "atencao";
  const e2: EstadoEtapa =
    vinculados.length > 0 || vinculoHub.length > 0
      ? "feito"
      : !n.faturavel || semDado
        ? "na"
        : candidatos.length > 0
          ? "pendente"
          : "atencao";
  const e3: EstadoEtapa = lancada ? "feito" : semDado ? "na" : "pendente";
  const e4: EstadoEtapa = anexoNf ? "feito" : "pendente";
  const e5: EstadoEtapa = anexoBoleto ? "feito" : "pendente";
  const e6: EstadoEtapa =
    parcelas.length === 0 ? (semDado ? "na" : "pendente") : vencidas > 0 ? "atencao" : pagas === parcelas.length ? "feito" : "pendente";

  const regua = [
    { titulo: "Nota fiscal", estado: e1 },
    { titulo: "Pedidos", estado: e2 },
    { titulo: "MovEstq", estado: e3 },
    { titulo: "DANFE", estado: e4 },
    { titulo: "PDF do boleto", estado: e5 },
    { titulo: "DocFin", estado: e6 },
  ];
  const ir = (i: number) => colunas.current[i]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  const ref = (i: number) => (el: HTMLElement | null) => {
    colunas.current[i] = el;
  };
  const uf = n.emitente_uf_xml;
  const municipio = n.emitente_municipio_xml;

  return (
    <div
      ref={raiz}
      className={cn("grid grid-cols-[minmax(0,1fr)] gap-3 bg-muted/40 p-4", visivel.presa && "sticky left-0")}
      style={visivel.presa && visivel.largura ? { width: visivel.largura } : undefined}
    >
      <Regua etapas={regua} onIr={ir} />

      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${porLinha}, minmax(0, 1fr))` }}>
        {/* 1 — NOTA FISCAL */}
        <Coluna
          n={1}
          titulo="Nota fiscal"
          icone={<FileText className="h-4 w-4" />}
          estado={e1}
          resumo={`NF-e ${n.numero ?? "—"}${n.serie ? ` série ${n.serie}` : ""} · ${n.origem === "Upload" ? "upload manual" : "recebida da Riosoft"}`}
          colRef={ref(0)}
          rodape={
            <>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={!n.tem_xml} onClick={onVerXml}>
                <Eye className="h-3 w-3" /> Ver XML
              </Button>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={!n.tem_xml} onClick={onBaixarXml}>
                <Download className="h-3 w-3" /> Baixar XML
              </Button>
            </>
          }
        >
          <p className="line-clamp-2 font-medium text-foreground" title={n.emitente_nome ?? ""}>
            {n.emitente_nome ?? "—"}
          </p>
          <Campo label="CNPJ" valor={formatDoc(n.emitente_cnpj)} mono />
          {(municipio || uf) && <Campo label="Município" valor={[municipio, uf].filter(Boolean).join(" · ")} />}
          <Campo label="Emissão" valor={formatDate(n.data_emissao)} />
          <Campo label="Natureza" valor={n.natureza_operacao} />
          <Campo label="V. produtos" valor={formatCurrency(n.valor_produtos)} mono />
          {!!n.valor_ipi && <Campo label="IPI" valor={formatCurrency(n.valor_ipi)} mono />}
          {!!n.valor_icms_st && <Campo label="ICMS-ST" valor={formatCurrency(n.valor_icms_st)} mono />}
          {!!n.valor_frete && <Campo label="Frete" valor={formatCurrency(n.valor_frete)} mono />}
          <Campo label="V. total" valor={formatCurrency(n.valor_total)} mono />
          <Etiquetas
            itens={[
              { texto: `${itens.length} ${itens.length === 1 ? "item" : "itens"}` },
              cfops.length > 0 && { texto: `CFOP ${cfops.join(", ")}` },
              !n.faturavel && { texto: "sem CFOP de venda", alerta: true },
            ]}
          />
          {n.informacoes_complementares && (
            <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted-foreground" title={n.informacoes_complementares}>
              {n.informacoes_complementares}
            </p>
          )}
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
            Situação no fisco não acompanhada: a nota chega autorizada pela Riosoft e o Hub não consulta a SEFAZ.
          </p>
        </Coluna>

        {/* 2 — PEDIDOS */}
        <Coluna
          n={2}
          titulo="Pedidos"
          icone={<ShoppingCart className="h-4 w-4" />}
          estado={e2}
          resumo={
            vinculados.length > 0
              ? `Ligada no MovEstq a ${vinculados.length === 1 ? "1 pedido" : `${vinculados.length} pedidos`}`
              : vinculoHub.length > 0
                ? `Vinculada no Hub a ${vinculoHub.length === 1 ? "1 pedido" : `${vinculoHub.length} pedidos`}`
                : !n.faturavel
                  ? "Nota sem venda — não sugere pedido"
                  : candidatos.length > 0
                    ? `${candidatos.length} candidato${candidatos.length > 1 ? "s" : ""} encontrado${candidatos.length > 1 ? "s" : ""}`
                    : "Nenhum pedido encontrado"
          }
          colRef={ref(1)}
          rodape={
            !lancada ? (
              vinculoHub.length > 0 ? (
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={onDesvincular}>
                  <Unlink className="h-3 w-3" /> Desvincular
                </Button>
              ) : (
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={onVincular}>
                  <LinkIcon className="h-3 w-3" /> Vincular pedido
                </Button>
              )
            ) : undefined
          }
        >
          {vinculados.length > 0 &&
            vinculados.map((p) => (
              <div
                key={p.numero}
                className="flex flex-col gap-1 rounded-md border border-emerald-200 bg-emerald-50/40 p-2 dark:border-emerald-900 dark:bg-emerald-950/20"
              >
                <span className="text-xs font-semibold tabular-nums">Pedido {p.numero}</span>
                {p.no_hub && <SituacaoPedido p={p} />}
                <Campo label="Pedido em" valor={formatDate(p.data_pedido)} />
                <Campo label="Valor do pedido" valor={formatCurrency(p.valor_pedido)} mono />
                <Campo label="Nesta nota" valor={formatCurrency(p.valor_na_nf)} mono />
                <Etiquetas
                  itens={[
                    p.natureza && { texto: p.natureza },
                    !p.no_hub && { texto: "pedido fora do Hub — sem status e aprovação", alerta: true },
                  ]}
                />
              </div>
            ))}

          {vinculados.length === 0 &&
            vinculoHub.map((p) => (
              <div
                key={p.numero}
                className="flex flex-col gap-1 rounded-md border border-sky-200 bg-sky-50/40 p-2 dark:border-sky-900 dark:bg-sky-950/20"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold tabular-nums">Pedido {p.numero}</span>
                  <span className="text-[10px] text-muted-foreground">{p.principal ? "Vínculo no Hub · principal" : "Vínculo no Hub"}</span>
                </div>
                {p.no_hub && <SituacaoPedido p={p} />}
                <Campo label="Pedido em" valor={formatDate(p.data_pedido)} />
                <Campo label="Valor do pedido" valor={formatCurrency(p.valor_pedido)} mono />
                {p.vinculado_por && (
                  <p className="text-[10px] text-muted-foreground">
                    por {p.vinculado_por} em {formatInstanteBrt(p.vinculado_em)}
                  </p>
                )}
              </div>
            ))}

          {vinculados.length === 0 && vinculoHub.length > 0 && (
            <Aviso>Vínculo feito nesta tela. Quando a nota for lançada no Alvo, vale o pedido do lançamento.</Aviso>
          )}

          {vinculados.length === 0 && vinculoHub.length === 0 && !n.faturavel && (
            <Aviso>
              Nenhum item com CFOP de venda ({cfops.join(", ") || "sem CFOP"}) — remessa, retorno, bonificação ou similar. Não
              há pedido para sugerir.
            </Aviso>
          )}

          {vinculados.length === 0 && n.faturavel && candidatos.length > 0 && (
            <>
              {lancada && <Aviso>Lançada no Alvo sem pedido. Estes pedidos poderiam ser desta nota:</Aviso>}
              {candidatos.map((c, i) => (
                <CartaoCandidato key={c.numero} c={c} destaque={i === 0 && vinculoHub.length === 0} espelhoDesde={espelhoDesde} />
              ))}
              <p className="text-[11px] leading-snug text-muted-foreground">
                Sugestão automática: mesmo fornecedor, pedido em R$ com saldo dentro de ±20% do valor total da nota; pedido
                encerrado no Alvo não entra. "Citado na nota" = número do pedido no &lt;xPed&gt; ou nas informações
                complementares. Saldo = valor do pedido − notas já ligadas a ele no Alvo − notas vinculadas a ele no Hub
                que o Alvo ainda não tem.
              </p>
            </>
          )}

          {vinculados.length === 0 && vinculoHub.length === 0 && n.faturavel && candidatos.length === 0 && (
            <Aviso tom={semDado ? "neutro" : "atencao"}>
              {lancada
                ? "Lançada no Alvo sem pedido, e nenhum pedido do fornecedor tem saldo parecido com o valor da nota."
                : "Nenhum pedido do mesmo fornecedor com saldo dentro de ±20% do valor da nota (pedidos em R$ de 400 dias antes até 60 dias depois da emissão)."}
              {n.pedidos_citados && n.pedidos_citados.length > 0 && ` A nota cita o pedido ${n.pedidos_citados.join(", ")} (xPed).`}
            </Aviso>
          )}
        </Coluna>

        {/* 3 — MOVESTQ */}
        <Coluna
          n={3}
          titulo="MovEstq"
          icone={<PackageCheck className="h-4 w-4" />}
          estado={e3}
          resumo={
            d.movestq
              ? `Lançada · chave ${d.movestq.chave_movestq}`
              : lancada
                ? n.alvo_chave_movestq != null
                  ? `Lançada · chave ${n.alvo_chave_movestq}`
                  : `Lançada · achada em ${n.alvo_fonte ?? "espelho do Alvo"}`
                : semDado
                  ? `Sem dado do Alvo (nota anterior a ${espelhoDesde})`
                  : "Não encontrada no Alvo"
          }
          colRef={ref(2)}
          rodape={
            !lancada && !semDado ? (
              <div className="flex w-full items-center justify-between gap-2">
                <Button size="sm" className="h-7 gap-1 text-xs" disabled title="O lançamento pelo Hub está em definição">
                  <Send className="h-3 w-3" /> Em breve
                </Button>
                <span className="text-[10px] text-muted-foreground">Lançar no Alvo pelo Hub</span>
              </div>
            ) : undefined
          }
        >
          {d.movestq ? (
            <>
              <ChaveMovEstq chave={d.movestq.chave_movestq} />
              <Campo label="Espécie" valor={`${d.movestq.especie ?? "—"}${d.movestq.serie ? ` · série ${d.movestq.serie}` : ""}`} />
              <Campo label="Tipo de lançamento" valor={d.movestq.codigo_tipo_lanc} mono />
              <Campo label="Entrada" valor={formatDate(d.movestq.data_entrada)} />
              <Campo label="Digitação" valor={formatInstanteBrt(d.movestq.data_hora_digitacao)} />
              <Campo label="Valor" valor={formatCurrency(d.movestq.valor_documento)} mono />
              <Campo label="Itens" valor={d.movestq.qtd_itens} />
              <Campo
                label="Pedido no lançamento"
                valor={vinculados.length > 0 ? vinculados.map((p) => p.numero).join(", ") : "sem pedido"}
                mono
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Achada em: {n.alvo_fonte ?? "—"} · lido do Alvo em {formatInstanteBrt(d.movestq.carregado_em)}
              </p>
            </>
          ) : lancada ? (
            <>
              {n.alvo_chave_movestq != null && <ChaveMovEstq chave={n.alvo_chave_movestq} />}
              {n.alvo_data_entrada && <Campo label="Entrada" valor={formatDate(n.alvo_data_entrada)} />}
              <Aviso>
                Achada em: {n.alvo_fonte ?? "espelho do Alvo"}. Os dados do MovEstq ainda não foram lidos pelo Hub.
              </Aviso>
            </>
          ) : semDado ? (
            <Aviso>O espelho do Alvo no Hub começa em {espelhoDesde}. Não dá para saber se esta nota foi lançada.</Aviso>
          ) : (
            <>
              <Aviso tom="atencao">
                Não encontrada no Alvo{n.dias_desde_emissao != null ? ` · ${emitidaHa(n.dias_desde_emissao)}` : ""}.
              </Aviso>
              {candidatos[0] && vinculoHub.length === 0 ? (
                <>
                  <span className="mt-1 text-[11px] font-medium text-foreground">Pedido sugerido para o lançamento</span>
                  <CartaoCandidato c={candidatos[0]} destaque espelhoDesde={espelhoDesde} />
                </>
              ) : vinculoHub[0] ? (
                <span className="text-[11px] text-muted-foreground">Pedido vinculado no Hub: {vinculoHub.map((p) => p.numero).join(", ")}.</span>
              ) : (
                <span className="text-[11px] text-muted-foreground">Sem pedido candidato para sugerir.</span>
              )}
            </>
          )}
        </Coluna>

        {/* 4 — DANFE */}
        <Coluna
          n={4}
          titulo="DANFE"
          icone={<Paperclip className="h-4 w-4" />}
          estado={e4}
          resumo={anexoNf ? "Anexado" : "Aguardando o PDF da nota (DANFE)"}
          colRef={ref(3)}
        >
          <AreaAnexo chave={n.chave_acesso} tipo="nf" anexo={anexoNf} onMudou={onAtualizar} acoes={ACOES_NFE} />
        </Coluna>

        {/* 5 — PDF DO BOLETO */}
        <Coluna
          n={5}
          titulo="PDF do boleto"
          icone={<Receipt className="h-4 w-4" />}
          estado={e5}
          resumo={anexoBoleto ? "Anexado" : "Aguardando o boleto"}
          colRef={ref(4)}
        >
          <AreaAnexo chave={n.chave_acesso} tipo="boleto" anexo={anexoBoleto} onMudou={onAtualizar} acoes={ACOES_NFE} />
          <LeituraBoleto key={anexoBoleto?.id ?? "sem-anexo"} anexo={anexoBoleto} leitor={lerBoletoNfe} />
          <p className="text-[10px] leading-snug text-muted-foreground">
            Será pré-requisito para lançar a nota pelo Hub (regra em definição).
          </p>
        </Coluna>

        {/* 6 — DOCFIN */}
        <Coluna
          n={6}
          titulo="DocFin"
          icone={<Banknote className="h-4 w-4" />}
          estado={e6}
          resumo={
            parcelas.length === 0
              ? semDado
                ? "Sem dado do Alvo"
                : "Sem título no contas a pagar"
              : `DocFin ${parcelas[0].chave_docfin ?? "—"} · ${pagas}/${parcelas.length} paga${parcelas.length > 1 ? "s" : ""}`
          }
          colRef={ref(5)}
        >
          {parcelas.length > 0 ? (
            <>
              {proxima && !vencidas && (
                <Campo label="Próximo vencimento" valor={formatDate(proxima.data_prorrogacao || proxima.data_vencimento)} />
              )}
              {vencidas > 0 && <Aviso tom="atencao">{vencidas} parcela(s) vencida(s) e em aberto.</Aviso>}
              {parcelas.map((p, i) => (
                <LinhaParcela key={`${p.chave_docfin}-${p.sequencia}-${i}`} p={p} total={parcelas.length} hoje={hoje} />
              ))}
              <p className="mt-1 text-[10px] text-muted-foreground">
                Títulos lidos do Alvo em {formatInstanteBrt(d.meta.titulos_lidos_em)} (06h40 e 12h40, dias úteis)
              </p>
            </>
          ) : (
            <Aviso>
              {semDado
                ? `O espelho do contas a pagar começa em ${espelhoDesde}.`
                : "A nota ainda não tem título no contas a pagar do Alvo. Depois do lançamento, o título aparece na próxima leitura (06h40 ou 12h40, dias úteis)."}
            </Aviso>
          )}
        </Coluna>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          Riosoft: última nota recebida em {formatInstanteBrt(d.meta.riosoft_ultima_entrada)} · Alvo: títulos lidos em{" "}
          {formatInstanteBrt(d.meta.titulos_lidos_em)}
        </span>
        <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]" onClick={onAtualizar} disabled={atualizando}>
          {atualizando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Atualizar etapas
        </Button>
      </div>
    </div>
  );
}
