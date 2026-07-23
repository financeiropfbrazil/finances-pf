import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHasPermission } from "@/hooks/useHasPermission";
import { PERMISSIONS } from "@/constants/permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { DataSection, Field } from "@/components/DataSection";
import { cn } from "@/lib/utils";
import { Loader2, ArrowLeft, Pencil, Play, Ban, CheckCircle2, Send } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { getStatusOP } from "@/lib/statusOP";
import { NovaOPModal, type EdicaoOP } from "@/components/producao/NovaOPModal";
import {
  obterOrdem,
  transicionar,
  registrarAprovacao,
  registrarComunicacao,
} from "@/services/opService";

const TIPO_ORDEM_LABEL: Record<string, string> = { FABRICACAO: "Fabricação", EMBALAGEM_FINAL: "Embalagem final" };
const TIPO_PRODUTO_LABEL: Record<string, string> = { ACABADO: "Acabado", EM_PROCESSO: "Em processo" };
const DESTINO_LABEL: Record<string, string> = {
  INTERNACIONAL: "Internacional",
  NACIONAL: "Nacional",
  NAO_APLICAVEL: "Não aplicável",
};

const numeroFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

function formatData(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = iso.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [a, m, dia] = d.split("-").map(Number);
      if (a && m && dia) return format(new Date(a, m - 1, dia), "dd/MM/yyyy", { locale: ptBR });
    }
    return format(new Date(iso), "dd/MM/yyyy", { locale: ptBR });
  } catch {
    return "—";
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: ptBR });
  } catch {
    return "—";
  }
}

export default function ProducaoOrdemDetalhe() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const podeCriar = useHasPermission(PERMISSIONS.PRODUCAO_ORDENS_CREATE);
  const podeGerir = useHasPermission(PERMISSIONS.PRODUCAO_ORDENS_MANAGE);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["op_detalhe", id],
    queryFn: () => obterOrdem(id!),
    enabled: !!id,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [aprovarOpen, setAprovarOpen] = useState(false);
  const [aprovarDepto, setAprovarDepto] = useState("");
  const [comunicarOpen, setComunicarOpen] = useState(false);
  const [comunicadoA, setComunicadoA] = useState("");
  const [comunicarDepto, setComunicarDepto] = useState("");
  const [acting, setActing] = useState(false);

  const refetchTudo = () => {
    queryClient.invalidateQueries({ queryKey: ["op_detalhe", id] });
    queryClient.invalidateQueries({ queryKey: ["op_lista"] });
    queryClient.invalidateQueries({ queryKey: ["op_counts"] });
  };

  const run = async (fn: () => Promise<void>, after?: () => void) => {
    setActing(true);
    try {
      await fn();
      refetchTudo();
      after?.();
    } catch (e: any) {
      toast.error(e?.message || "Erro na operação.");
    } finally {
      setActing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <p>Ordem de Produção não encontrada ou sem acesso.</p>
        <Button variant="outline" onClick={() => navigate("/producao/ordens")}>
          <ArrowLeft className="h-4 w-4" /> Voltar à lista
        </Button>
      </div>
    );
  }

  const o = data.ordem;
  const sv = getStatusOP(o.status);
  const totalQtd = data.itens.reduce((s: number, i: any) => s + Number(i.quantidade_planejada || 0), 0);

  const isRascunho = o.status === "RASCUNHO";
  const cancelavel = ["RASCUNHO", "ABERTA", "EM_ANDAMENTO"].includes(o.status);
  const isCancelada = o.status === "CANCELADA";

  const edicao: EdicaoOP = {
    id: o.id,
    numero: o.numero,
    dados: {
      tipo_id: o.tipo_id,
      tipo_ordem: o.tipo_ordem,
      tipo_produto: o.tipo_produto,
      destino: o.destino,
      produto_familia: o.produto_familia,
      lote: o.lote,
      data_inicio: o.data_inicio,
      data_fim_planejada: o.data_fim_planejada,
      numero_referencia: o.numero_referencia,
      observacoes: o.observacoes,
      emitido_depto: o.emitido_depto,
    },
    itens: data.itens.map((i: any) => ({
      codigo_produto: i.codigo_produto,
      codigo_alternativo_produto: i.codigo_alternativo_produto,
      produto_nome: i.produto_nome,
      produto_unidade: i.produto_unidade,
      quantidade_planejada: Number(i.quantidade_planejada),
    })),
  };

  const doAbrir = () =>
    run(async () => {
      await transicionar(o.id, "ABERTA");
      toast.success("OP aberta.");
    });

  const doCancelar = () => {
    if (!motivo.trim()) {
      toast.error("Informe o motivo do cancelamento.");
      return;
    }
    run(
      async () => {
        await transicionar(o.id, "CANCELADA", motivo.trim());
        toast.success("OP cancelada.");
      },
      () => {
        setCancelOpen(false);
        setMotivo("");
      },
    );
  };

  const doAprovar = () =>
    run(
      async () => {
        await registrarAprovacao(o.id, aprovarDepto.trim());
        toast.success("Aprovação registrada.");
      },
      () => {
        setAprovarOpen(false);
        setAprovarDepto("");
      },
    );

  const doComunicar = () => {
    if (!comunicadoA.trim()) {
      toast.error("Informe para quem a OP foi comunicada.");
      return;
    }
    run(
      async () => {
        await registrarComunicacao(o.id, comunicadoA.trim(), comunicarDepto.trim());
        toast.success("Comunicação registrada.");
      },
      () => {
        setComunicarOpen(false);
        setComunicadoA("");
        setComunicarDepto("");
      },
    );
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" className="mt-1 h-8 w-8 p-0" onClick={() => navigate("/producao/ordens")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-2xl font-bold tracking-tight tabular-nums text-foreground">{o.numero}</h1>
              <Badge variant="outline" className={cn(sv.className, "flex items-center gap-1.5")}>
                <sv.Icon className={cn("h-3 w-3", sv.iconAnimate && "animate-spin")} />
                {sv.label}
              </Badge>
              <Badge variant="outline" className="border-border text-muted-foreground">
                {TIPO_ORDEM_LABEL[o.tipo_ordem] || o.tipo_ordem}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {o.tipo_nome || "—"} · {data.itens.length} {data.itens.length === 1 ? "SKU" : "SKUs"} ·{" "}
              <span className="tabular-nums">{numeroFmt.format(totalQtd)}</span> un
            </p>
          </div>
        </div>

        {/* Ações condicionais por status/permissão */}
        <div className="flex flex-wrap gap-2">
          {isRascunho && podeCriar && (
            <Button variant="outline" onClick={() => setEditOpen(true)} disabled={acting}>
              <Pencil className="h-4 w-4" /> Editar
            </Button>
          )}
          {isRascunho && podeCriar && (
            <Button onClick={doAbrir} disabled={acting}>
              <Play className="h-4 w-4" /> Abrir
            </Button>
          )}
          {!isCancelada && podeGerir && (
            <Button variant="outline" onClick={() => setAprovarOpen(true)} disabled={acting}>
              <CheckCircle2 className="h-4 w-4" /> Registrar aprovação
            </Button>
          )}
          {!isCancelada && podeGerir && (
            <Button variant="outline" onClick={() => setComunicarOpen(true)} disabled={acting}>
              <Send className="h-4 w-4" /> Registrar comunicação
            </Button>
          )}
          {cancelavel && podeGerir && (
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setCancelOpen(true)}
              disabled={acting}
            >
              <Ban className="h-4 w-4" /> Cancelar
            </Button>
          )}
        </div>
      </div>

      {/* Dados da OP */}
      <DataSection title="Dados da OP">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Tipo de OP" value={o.tipo_nome} />
          <Field label="Tipo de ordem" value={TIPO_ORDEM_LABEL[o.tipo_ordem] || o.tipo_ordem} />
          <Field label="Tipo de produto" value={TIPO_PRODUTO_LABEL[o.tipo_produto] || o.tipo_produto} />
          <Field label="Destino" value={DESTINO_LABEL[o.destino] || o.destino} />
          <Field label="Família" value={o.produto_familia} />
          <Field label="Lote" value={o.lote} />
          <Field label="Nº de referência" value={o.numero_referencia} mono />
          <Field label="Início" value={formatData(o.data_inicio)} mono />
          <Field label="Fim planejado" value={formatData(o.data_fim_planejada)} mono />
          <Field label="Emitido por" value={o.emitido_por_nome} />
          <Field label="Depto emissor" value={o.emitido_depto} />
          <Field label="Emitido em" value={formatDateTime(o.emitido_em)} mono />
          {o.aprovado_em && <Field label="Aprovado por" value={o.aprovado_por_nome} />}
          {o.aprovado_em && <Field label="Aprovado depto" value={o.aprovado_depto} />}
          {o.aprovado_em && <Field label="Aprovado em" value={formatDateTime(o.aprovado_em)} mono />}
          {o.comunicado_em && <Field label="Comunicado a" value={o.comunicado_a} />}
          {o.comunicado_em && <Field label="Comunicado depto" value={o.comunicado_depto} />}
          {o.comunicado_em && <Field label="Comunicado em" value={formatDateTime(o.comunicado_em)} mono />}
          {o.cancelada_em && <Field label="Cancelada por" value={o.cancelada_por_nome} />}
          {o.cancelada_em && <Field label="Cancelada em" value={formatDateTime(o.cancelada_em)} mono />}
          {o.fechada_em && <Field label="Fechada por" value={o.fechada_por_nome} />}
          {o.fechada_em && <Field label="Fechada em" value={formatDateTime(o.fechada_em)} mono />}
        </div>
        {o.motivo_cancelamento && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <span className="block text-[10px] uppercase tracking-wide text-destructive">Motivo do cancelamento</span>
            <span className="text-sm text-foreground">{o.motivo_cancelamento}</span>
          </div>
        )}
        {o.observacoes && (
          <div className="mt-4">
            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Observações</span>
            <span className="whitespace-pre-wrap text-sm text-foreground">{o.observacoes}</span>
          </div>
        )}
      </DataSection>

      {/* Itens */}
      <DataSection title="Itens planejados" subtitle={`${data.itens.length} ${data.itens.length === 1 ? "item" : "itens"}`} flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">#</th>
                <th className="px-4 py-2.5 font-medium">Código</th>
                <th className="px-4 py-2.5 font-medium">Produto</th>
                <th className="px-4 py-2.5 font-medium">Unid.</th>
                <th className="px-4 py-2.5 text-right font-medium">Qtd. planejada</th>
              </tr>
            </thead>
            <tbody>
              {data.itens.map((it: any) => (
                <tr key={it.id} className="border-b last:border-b-0">
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{it.sequencia}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                    <span className="font-medium">{it.codigo_alternativo_produto || "—"}</span>
                    <span className="text-muted-foreground"> · {it.codigo_produto}</span>
                  </td>
                  <td className="px-4 py-2.5">{it.produto_nome}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{it.produto_unidade || "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{numeroFmt.format(Number(it.quantidade_planejada))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataSection>

      {/* Histórico de status */}
      <DataSection title="Histórico de status" subtitle={`${data.historico.length} evento(s)`}>
        {data.historico.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem eventos registrados.</p>
        ) : (
          <ol className="space-y-3">
            {data.historico.map((h: any) => {
              const sPara = getStatusOP(h.para);
              const sDe = h.de ? getStatusOP(h.de) : null;
              return (
                <li key={h.id} className="flex gap-3">
                  <Badge variant="outline" className={cn(sPara.className, "mt-0.5 flex h-fit items-center gap-1")}>
                    <sPara.Icon className="h-3 w-3" />
                    {sPara.label}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      {sDe ? `${sDe.label} → ${sPara.label}` : `Criada como ${sPara.label}`}
                    </p>
                    {h.motivo && <p className="text-xs text-muted-foreground">Motivo: {h.motivo}</p>}
                    <p className="text-xs text-muted-foreground">
                      {h.usuario_nome || "—"} · {formatDateTime(h.created_at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </DataSection>

      {/* Modal de edição (rascunho) */}
      <NovaOPModal open={editOpen} onOpenChange={setEditOpen} onCreated={refetchTudo} edicao={edicao} />

      {/* Cancelar */}
      <Dialog open={cancelOpen} onOpenChange={(op) => !acting && setCancelOpen(op)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar OP {o.numero}</DialogTitle>
            <DialogDescription>O motivo é obrigatório e fica registrado no histórico.</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Motivo *</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} placeholder="Ex.: OP de teste da Fase 1" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={acting}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={doCancelar}
              disabled={acting || !motivo.trim()}
            >
              {acting && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancelar OP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Registrar aprovação */}
      <Dialog open={aprovarOpen} onOpenChange={(op) => !acting && setAprovarOpen(op)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar aprovação</DialogTitle>
            <DialogDescription>Carimba você como aprovador, com a data/hora atual.</DialogDescription>
          </DialogHeader>
          <div>
            <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Departamento</Label>
            <Input value={aprovarDepto} onChange={(e) => setAprovarDepto(e.target.value)} placeholder="Opcional" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAprovarOpen(false)} disabled={acting}>
              Voltar
            </Button>
            <Button onClick={doAprovar} disabled={acting}>
              {acting && <Loader2 className="h-4 w-4 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Registrar comunicação */}
      <Dialog open={comunicarOpen} onOpenChange={(op) => !acting && setComunicarOpen(op)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar comunicação</DialogTitle>
            <DialogDescription>Carimba a data/hora atual com o destinatário informado.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Comunicado a *</Label>
              <Input value={comunicadoA} onChange={(e) => setComunicadoA(e.target.value)} placeholder="Ex.: Qualidade" />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Departamento</Label>
              <Input value={comunicarDepto} onChange={(e) => setComunicarDepto(e.target.value)} placeholder="Opcional" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setComunicarOpen(false)} disabled={acting}>
              Voltar
            </Button>
            <Button onClick={doComunicar} disabled={acting || !comunicadoA.trim()}>
              {acting && <Loader2 className="h-4 w-4 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
