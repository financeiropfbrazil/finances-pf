import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, AlertTriangle, Trash2, ShieldAlert, Info } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { SkuPicker } from "./NovaOPModal";
import type { StockPickerRow } from "@/services/opService";
import {
  listarOPsAbertas,
  listarCentrosCusto,
  funcionarioDoUsuario,
  rmPendenteDeConclusao,
  CENTRO_CUSTO_PADRAO,
} from "@/services/reqMatService";
import { criarRMNoAlvo, concluirEnvioRM, DESCRICAO_MAX, type DadosRMEnvio } from "@/services/alvoReqMatSaveService";

/**
 * NOVA REQUISIÇÃO DE MATERIAL — o modal de criação.  ·  OP-2.7
 *
 * Molde do `NovaOPModal` (Dialog XL, cabeçalho em cima + grade de itens
 * embaixo, dirty-check, `onCreated` para o pai revalidar). O picker de SKU é o
 * MESMO componente, importado — não uma cópia.
 *
 * As três decisões do Pedro (07/08/2026) que este arquivo materializa estão
 * comentadas onde valem:
 *   (a) unidade de medida  → ver `alvoReqMatSaveService.montarClassObject`
 *   (b) centro de custo    → ver `reqMatService.listarCentrosCusto`
 *   (c) funcionário        → ver `reqMatService.funcionarioDoUsuario`
 *
 * ⚠ O ciclo de envio tem TRÊS passos e o segundo não é opcional — o motivo está
 *   em `alvoReqMatSaveService.ts`. Aqui só se trata do resultado.
 */

interface ItemRow {
  codigo_produto: string;
  codigo_alternativo_produto: string | null;
  produto_nome: string;
  produto_unidade: string | null;
  quantidade: string;
}

interface NovaRMModalProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Chamado após um envio que mexeu no livro — o pai revalida as queries. */
  onCreated: () => void;
  /** Pré-seleciona a OP (usado quando o modal abre da tela da OP). */
  opIdInicial?: string | null;
}

export function NovaRMModal({ open, onOpenChange, onCreated, opIdInicial = null }: NovaRMModalProps) {
  const { user } = useAuth();

  const [opId, setOpId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [centroCusto, setCentroCusto] = useState(CENTRO_CUSTO_PADRAO);
  const [texto, setTexto] = useState("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const markDirty = () => setDirty(true);

  const { data: ops = [], isLoading: carregandoOps } = useQuery({
    queryKey: ["rm_ops_abertas"],
    queryFn: listarOPsAbertas,
    enabled: open,
  });

  const { data: centros = [] } = useQuery({
    queryKey: ["rm_centros_custo"],
    queryFn: listarCentrosCusto,
    enabled: open,
  });

  // (c) Funcionário do usuário logado. `null` = sem de-para ⇒ não cria.
  const { data: funcionario, isLoading: carregandoFunc } = useQuery({
    queryKey: ["rm_funcionario", user?.id],
    queryFn: () => funcionarioDoUsuario(user!.id),
    enabled: open && !!user?.id,
  });

  const opSelecionada = useMemo(() => ops.find((o) => o.id === opId) ?? null, [ops, opId]);

  // Trava anti-duplicata: RM `enviado` não confirmada NAQUELA OP.
  const { data: pendenteConclusao, refetch: recarregarPendente } = useQuery({
    queryKey: ["rm_pendente_conclusao", opId],
    queryFn: () => rmPendenteDeConclusao(opId),
    enabled: open && !!opId,
  });

  // ── Prefixo da Descrição ───────────────────────────────────────────────────
  // ⚠ O prefixo CONTA no limite de 40 do Alvo. Ele entra no `maxLength` do
  //   input, não só na exibição — senão o bloqueio no 40º é mentira e o ERP
  //   devolve BrokenRules depois de o operador ter digitado tudo.
  const prefixo = opSelecionada ? `OP ${opSelecionada.numero} - ` : "";
  const restante = Math.max(0, DESCRICAO_MAX - prefixo.length);
  const descricaoCompleta = `${prefixo}${descricao}`;

  useEffect(() => {
    if (!open) return;
    setOpId(opIdInicial ?? "");
    setDescricao("");
    setCentroCusto(CENTRO_CUSTO_PADRAO);
    setTexto("");
    setItems([]);
    setDirty(false);
    setEnviando(false);
  }, [open, opIdInicial]);

  // O Texto é o carregador humano da OP para quem atende NA TELA DO ALVO — é
  // onde cabe o contexto que não coube nos 40 chars da Descrição. Aceita longo
  // (398 chars gravados sem truncar, §10.16). Pré-preenchido, editável.
  useEffect(() => {
    if (!opSelecionada || dirty) return;
    const partes = [`Ordem de Produção ${opSelecionada.numero}`];
    if (opSelecionada.produto_familia) partes.push(opSelecionada.produto_familia);
    if (opSelecionada.data_inicio) {
      partes.push(`início ${format(new Date(`${opSelecionada.data_inicio}T00:00:00`), "dd/MM/yyyy", { locale: ptBR })}`);
    }
    partes.push("Requisição criada pelo Financial Hub.");
    setTexto(partes.join(" · "));
  }, [opSelecionada, dirty]);

  const adicionarItem = (p: StockPickerRow) => {
    if (items.some((i) => i.codigo_produto === p.codigo_produto)) {
      toast.warning("Este SKU já está na lista — edite a quantidade.");
      setTimeout(() => qtyRefs.current[p.codigo_produto]?.focus(), 0);
      return;
    }
    // Validação #8 — bloqueio NO PICKER, dizendo qual produto e o que falta.
    // 155 dos 2.806 produtos ativos (5,5%) estão sem `unidade_medida`; sem ela
    // o `CodigoProdUnidMed` iria vazio e o Alvo responde NullReferenceException
    // sem dizer o campo (§6.3-N — foi assim que se perderam quatro tentativas).
    if (!p.unidade_medida || !p.unidade_medida.trim()) {
      toast.error(
        `O produto ${p.codigo_alternativo || p.codigo_produto} (${p.nome_produto}) está sem unidade de medida no cadastro. ` +
          "Peça o cadastro da unidade antes de requisitar este item.",
      );
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        codigo_produto: p.codigo_produto,
        codigo_alternativo_produto: p.codigo_alternativo,
        produto_nome: p.nome_produto,
        produto_unidade: p.unidade_medida,
        quantidade: "",
      },
    ]);
    markDirty();
    setTimeout(() => qtyRefs.current[p.codigo_produto]?.focus(), 0);
  };

  const removerItem = (codigo: string) => {
    setItems((prev) => prev.filter((i) => i.codigo_produto !== codigo));
    markDirty();
  };

  const setQty = (codigo: string, value: string) => {
    setItems((prev) => prev.map((i) => (i.codigo_produto === codigo ? { ...i, quantidade: value } : i)));
    markDirty();
  };

  /**
   * As 10 validações do Hub ANTES do POST.
   *
   * 🔴 O Alvo responde `NullReferenceException` sem dizer qual campo falta
   *    (§6.3-N). Tudo que puder falhar aqui, falha aqui — cada validação é uma
   *    tentativa que não se perde.
   */
  const validar = (): string | null => {
    if (!user?.id) return "Sessão expirada — faça login novamente."; // #1
    if (!funcionario) return "Seu usuário não tem funcionário do ERP configurado."; // #2
    if (!opId || !opSelecionada) return "Selecione a Ordem de Produção."; // #3
    if (!["ABERTA", "EM_ANDAMENTO"].includes(opSelecionada.status))
      return `A OP ${opSelecionada.numero} está ${opSelecionada.status} e não recebe requisição.`; // #3
    if (!descricao.trim()) return "Informe a descrição da requisição."; // #4
    if (descricaoCompleta.length > DESCRICAO_MAX)
      return `A descrição tem ${descricaoCompleta.length} caracteres — o ERP aceita no máximo ${DESCRICAO_MAX}.`; // #4
    if (!centroCusto) return "Selecione o centro de custo."; // #5
    if (!centros.some((c) => c.codigo === centroCusto))
      return "O centro de custo selecionado não está ativo — escolha outro."; // #5
    if (items.length === 0) return "Adicione ao menos 1 item."; // #6
    for (const i of items) {
      if (!i.codigo_produto) return "Há item sem código de produto."; // #7
      if (!i.produto_unidade || !i.produto_unidade.trim())
        return `O produto ${i.codigo_alternativo_produto || i.codigo_produto} está sem unidade de medida no cadastro.`; // #8
      const q = Number(i.quantidade);
      if (!Number.isFinite(q) || q <= 0)
        return `Informe uma quantidade maior que zero para ${i.codigo_alternativo_produto || i.codigo_produto}.`; // #9
    }
    if (pendenteConclusao) return "Há uma RM desta OP com o envio incompleto — conclua-a antes de criar outra."; // #10
    return null;
  };

  const montarDados = (): DadosRMEnvio => ({
    op_id: opId,
    op_numero: opSelecionada!.numero,
    descricao: descricaoCompleta,
    codigo_centro_ctrl: centroCusto,
    codigo_funcionario: funcionario!.codigo,
    texto: texto.trim(),
    itens: items.map((i) => ({
      codigo_produto: i.codigo_produto,
      codigo_alternativo_produto: i.codigo_alternativo_produto,
      produto_unidade: i.produto_unidade!,
      quantidade: Number(i.quantidade),
    })),
  });

  const doClose = () => onOpenChange(false);

  const attemptClose = () => {
    if (enviando) return;
    if (dirty) setConfirmClose(true);
    else doClose();
  };

  const enviar = async () => {
    const erro = validar();
    if (erro) {
      toast.error(erro);
      return;
    }
    setEnviando(true);
    try {
      const r = await criarRMNoAlvo(montarDados());
      onCreated(); // o livro mexeu em qualquer desfecho — o pai revalida sempre

      if (r.ok) {
        toast.success(`RM ${r.numero} criada e em atendimento Manual.`);
        setDirty(false);
        doClose();
        return;
      }

      if (r.numero) {
        // O estado perigoso: existe no ERP e está morta. NÃO fechamos o modal —
        // o operador precisa ver o alerta e o botão de concluir.
        toast.error(`RM ${r.numero} criada, mas o envio não terminou. Conclua o passo 2.`);
        await recarregarPendente();
      } else {
        toast.error(r.erro || "Falha ao criar a requisição.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Erro inesperado ao criar a requisição.");
    } finally {
      setEnviando(false);
    }
  };

  /** Reexecuta SÓ os passos 2 e 3, a partir do número já gravado. */
  const concluir = async () => {
    if (!pendenteConclusao?.numero_reqmat || !opSelecionada || !funcionario) return;
    setEnviando(true);
    try {
      const p = pendenteConclusao.payload || {};
      const r = await concluirEnvioRM(pendenteConclusao.id, pendenteConclusao.numero_reqmat, {
        op_id: pendenteConclusao.op_id,
        op_numero: opSelecionada.numero,
        descricao: p.descricao ?? "",
        codigo_centro_ctrl: p.codigo_centro_ctrl ?? centroCusto,
        codigo_funcionario: p.codigo_funcionario ?? funcionario.codigo,
        texto: p.texto ?? "",
        itens: p.itens ?? [],
      });
      onCreated();
      if (r.ok) {
        toast.success(`RM ${r.numero} agora está em atendimento Manual.`);
        await recarregarPendente();
      } else {
        toast.error(r.erro || "O passo 2 falhou de novo — confira a RM no Alvo.");
      }
    } finally {
      setEnviando(false);
    }
  };

  // ── Bloqueios de tela ──────────────────────────────────────────────────────
  const semFuncionario = !carregandoFunc && !funcionario;
  const semOP = !carregandoOps && ops.length === 0;
  const bloqueado = semFuncionario || semOP || !!pendenteConclusao;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (o) onOpenChange(true);
          else attemptClose();
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova Requisição de Material</DialogTitle>
            <DialogDescription>
              O número da RM é atribuído pelo ERP no envio. A requisição nasce vinculada a uma Ordem de Produção.
            </DialogDescription>
          </DialogHeader>

          {/* ── Gate do de-para (molde do L7-B: mensagem clara e caminho de saída) ── */}
          {semFuncionario && (
            <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-foreground">Seu usuário não tem funcionário do ERP configurado</p>
                <p className="mt-0.5 text-muted-foreground">
                  A requisição não foi criada para não sair com a identidade de outra pessoa. Peça ao administrador
                  para vincular o seu código de funcionário do Alvo ao seu perfil.
                </p>
              </div>
            </div>
          )}

          {semOP && (
            <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-foreground">Nenhuma Ordem de Produção aberta</p>
                <p className="mt-0.5 text-muted-foreground">
                  Toda RM nasce de uma OP. Abra uma Ordem de Produção antes de requisitar material.
                </p>
              </div>
            </div>
          )}

          {/* 🔴 O estado perigoso: existe no ERP e nasceu morta. */}
          {pendenteConclusao && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">
                    RM {pendenteConclusao.numero_reqmat} criada, mas ainda em atendimento Automático
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    RM automática nunca é atendida (16 de 16 no ano estão abertas). Conclua o envio.
                  </p>
                  {pendenteConclusao.erro_mensagem && (
                    <p className="mt-1 break-words font-mono text-xs text-destructive">
                      {pendenteConclusao.erro_mensagem}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Não crie outra requisição para esta OP — a RM já existe no ERP e uma nova ficaria duplicada.
                  </p>
                </div>
                <Button size="sm" onClick={concluir} disabled={enviando}>
                  {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Concluir envio (passo 2)
                </Button>
              </div>
            </div>
          )}

          {/* ── Cabeçalho ── */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Ordem de Produção *</Label>
                <Select
                  value={opId}
                  onValueChange={(v) => {
                    setOpId(v);
                    markDirty();
                  }}
                  disabled={enviando || semFuncionario}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={carregandoOps ? "Carregando…" : "Selecione a OP"} />
                  </SelectTrigger>
                  <SelectContent>
                    {ops.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.numero}
                        {o.data_inicio
                          ? ` · início ${format(new Date(`${o.data_inicio}T00:00:00`), "dd/MM/yyyy", { locale: ptBR })}`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                {/* (c) FUNCIONÁRIO: leitura, não dropdown. Ver `funcionarioDoUsuario`. */}
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Funcionário</Label>
                <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm">
                  {carregandoFunc ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : funcionario ? (
                    <>
                      <span className="truncate">{funcionario.nome}</span>
                      <span className="font-mono text-xs text-muted-foreground">{funcionario.codigo}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Quem requisita responde pela requisição. Quem retira é registrado no atendimento.
                </p>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <Label className="text-xs font-medium text-muted-foreground">Descrição *</Label>
                <span
                  className={`text-xs tabular-nums ${
                    descricaoCompleta.length >= DESCRICAO_MAX ? "text-amber-600" : "text-muted-foreground"
                  }`}
                >
                  {descricaoCompleta.length}/{DESCRICAO_MAX}
                </span>
              </div>
              <div className="flex items-stretch">
                {prefixo && (
                  <span className="flex items-center whitespace-nowrap rounded-l-md border border-r-0 border-input bg-muted px-3 font-mono text-sm text-muted-foreground">
                    {prefixo}
                  </span>
                )}
                <Input
                  value={descricao}
                  onChange={(e) => {
                    setDescricao(e.target.value);
                    markDirty();
                  }}
                  // O prefixo consome parte dos 40 — o resto é o que sobra.
                  maxLength={restante}
                  disabled={enviando || !opSelecionada || bloqueado}
                  placeholder={opSelecionada ? "Ex.: insumos da etapa de corte" : "Selecione a OP primeiro"}
                  className={prefixo ? "rounded-l-none" : ""}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                O ERP aceita 40 caracteres na descrição — o contexto completo vai no campo Texto, abaixo.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                {/* (b) CENTRO: `cost_centers`, NÃO `rh_centros_custo`. Ver `listarCentrosCusto`. */}
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Centro de custo *</Label>
                <Select
                  value={centroCusto}
                  onValueChange={(v) => {
                    setCentroCusto(v);
                    markDirty();
                  }}
                  disabled={enviando || bloqueado}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o centro de custo" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {centros.map((c) => (
                      <SelectItem key={c.codigo} value={c.codigo}>
                        <span className="font-mono text-xs">{c.codigo}</span> · {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Texto</Label>
              <Textarea
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  markDirty();
                }}
                rows={3}
                disabled={enviando || bloqueado}
                placeholder="Contexto para quem atende no almoxarifado"
              />
              <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                Este texto aparece na tela de atendimento do Alvo — é o que diz ao almoxarifado a que OP o material se
                destina.
              </p>
            </div>

            {/* ── Itens ── */}
            <div className="rounded-md border border-border p-3">
              <div className="mb-3 flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground">Itens *</Label>
                <span className="text-xs text-muted-foreground">{items.length} item(ns)</span>
              </div>

              <SkuPicker onPick={adicionarItem} disabled={enviando || bloqueado} />

              {items.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nenhum item ainda — busque o SKU acima para adicionar.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {items.map((i) => (
                    <div key={i.codigo_produto} className="flex items-center gap-2 rounded-md border p-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs">
                          <span className="font-medium">{i.codigo_alternativo_produto || "—"}</span>
                          <span className="text-muted-foreground"> · {i.codigo_produto}</span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{i.produto_nome}</p>
                      </div>
                      <Input
                        ref={(el) => {
                          qtyRefs.current[i.codigo_produto] = el;
                        }}
                        value={i.quantidade}
                        onChange={(e) => setQty(i.codigo_produto, e.target.value)}
                        disabled={enviando}
                        inputMode="decimal"
                        placeholder="Qtd"
                        className="w-24 text-right tabular-nums"
                      />
                      <span className="w-16 shrink-0 truncate text-xs text-muted-foreground">{i.produto_unidade}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removerItem(i.codigo_produto)}
                        disabled={enviando}
                        title="Remover item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={attemptClose} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={enviar} disabled={enviando || bloqueado}>
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Criar no ERP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
            <AlertDialogDescription>
              A requisição ainda não foi enviada ao ERP. O que você preencheu será perdido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClose(false);
                setDirty(false);
                doClose();
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
