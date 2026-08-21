import { supabase } from "@/integrations/supabase/client";

/**
 * Service do módulo Movimentação de Salas (FS3-1).
 *
 * Leitura DIRETA nas tabelas prod_* — a RLS gateia por `salas.access` (policies
 * de SELECT criadas na FS1/FS2). Escrita SEMPRE por RPC `SECURITY DEFINER`:
 * não existe policy de INSERT/UPDATE em nenhuma tabela do módulo, então
 * `.insert()` direto falharia de qualquer forma.
 *
 * Padrão da casa: `(supabase as any)`. Não é atalho — o
 * `src/integrations/supabase/types.ts` é gerado e não conhece nenhuma tabela
 * `prod_*` (nem `op_*`), porque os objetos deste módulo foram criados por SQL
 * fora das migrations. As interfaces abaixo são a tipagem de verdade, no mesmo
 * formato de `opService.ts`.
 *
 * REGRA QUE NÃO SE QUEBRA: o front NUNCA calcula `quantidade_base`. Envia
 * quantidade + unidade; a RPC converte pela `escala_unidades` e grava
 * `quantidade_base` e `fator_usado`. `pesoDaUnidade` existe só para EXIBIR a
 * conversão ao operador.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Item de `prod_produtos.escala_unidades` (jsonb). `posicao = 1` é a unidade base. */
export interface EscalaUnidade {
  unidade: string;
  posicao: number;
  peso: number;
}

export interface Sala {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  tipo_producao: string;
  ativa: boolean;
  prefixo_lote: string | null;
}

/** Produto já resolvido com o papel que ele tem NAQUELA sala. */
export interface ProdutoSala {
  id: string;
  codigo_alvo: string;
  alternativo: string | null;
  nome: string;
  nome_curto: string | null;
  unidade_base: string;
  escala_unidades: EscalaUnidade[];
  controla_lote: boolean;
  papel: "INSUMO" | "PRODUTO";
}

export interface MotivoRefugo {
  id: string;
  codigo: string;
  nome: string;
  aplica_a: "INSUMO" | "PRODUTO" | "AMBOS";
  ordem: number;
  provisorio: boolean;
}

export type TipoMovimento = "ENTRADA" | "REFUGO" | "SAIDA";

/** Linha do log do dia — as três tabelas normalizadas num formato só. */
export interface MovimentoLog {
  id: string;
  tipo: TipoMovimento;
  produto_id: string;
  produto_nome: string;
  quantidade: number;
  unidade: string;
  lote: string | null;
  motivo_nome: string | null;
  registrado_por: string;
  registrado_por_nome: string;
  registrado_em: string;
  data_movimento: string;
  estornada_em: string | null;
  motivo_estorno: string | null;
}

export interface VinculoEquipe {
  user_id: string;
  nome: string;
  email: string | null;
  atribuido_em: string;
}

// ─── Leituras ─────────────────────────────────────────────────────────────────

/**
 * Salas que o usuário pode operar.
 *
 * Regra: vínculo ativo em `prod_sala_usuarios`. Admin vê todas as salas ativas
 * mesmo sem vínculo — espelha o bypass de `profiles.is_admin` que existe dentro
 * de `user_has_sala_permission` (ela retorna true na primeira linha para admin).
 * Sem esse ramo o Pedro, que é admin e NÃO tem vínculo, veria "nenhuma sala".
 *
 * Isto é conveniência de UI: quem decide de fato é a RPC, no momento de gravar.
 */
export async function listarSalasDoUsuario(userId: string, isAdmin: boolean): Promise<Sala[]> {
  const campos = "id, codigo, nome, descricao, tipo_producao, ativa, prefixo_lote";

  if (isAdmin) {
    const { data, error } = await (supabase as any)
      .from("prod_salas")
      .select(campos)
      .eq("ativa", true)
      .order("nome");
    if (error) throw new Error(error.message);
    return (data ?? []) as Sala[];
  }

  const { data: vinculos, error: errVinculos } = await (supabase as any)
    .from("prod_sala_usuarios")
    .select("sala_id")
    .eq("user_id", userId)
    .is("revogado_em", null);
  if (errVinculos) throw new Error(errVinculos.message);

  const salaIds = (vinculos ?? []).map((v: any) => v.sala_id);
  if (salaIds.length === 0) return [];

  const { data, error } = await (supabase as any)
    .from("prod_salas")
    .select(campos)
    .in("id", salaIds)
    .eq("ativa", true)
    .order("nome");
  if (error) throw new Error(error.message);
  return (data ?? []) as Sala[];
}

/** Produtos vinculados à sala, com o papel (INSUMO ou PRODUTO) de cada um. */
export async function listarProdutosDaSala(salaId: string): Promise<ProdutoSala[]> {
  const { data, error } = await (supabase as any)
    .from("prod_sala_produtos")
    .select(
      "papel, produto:prod_produtos(id, codigo_alvo, alternativo, nome, nome_curto, unidade_base, escala_unidades, controla_lote, ativo)",
    )
    .eq("sala_id", salaId);
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((linha: any) => linha.produto && linha.produto.ativo)
    .map((linha: any) => ({
      id: linha.produto.id,
      codigo_alvo: linha.produto.codigo_alvo,
      alternativo: linha.produto.alternativo,
      nome: linha.produto.nome,
      nome_curto: linha.produto.nome_curto,
      unidade_base: linha.produto.unidade_base,
      escala_unidades: (linha.produto.escala_unidades ?? []) as EscalaUnidade[],
      controla_lote: linha.produto.controla_lote,
      papel: linha.papel,
    }))
    .sort((a: ProdutoSala, b: ProdutoSala) =>
      (a.nome_curto ?? a.nome).localeCompare(b.nome_curto ?? b.nome, "pt-BR"),
    );
}

/**
 * Motivos de refugo ativos que se aplicam a um tipo de item.
 * `AMBOS` entra nas duas listas — é o que a RPC aceita.
 */
export async function listarMotivosRefugo(tipoItem: "INSUMO" | "PRODUTO"): Promise<MotivoRefugo[]> {
  const { data, error } = await (supabase as any)
    .from("prod_sala_motivos_refugo")
    .select("id, codigo, nome, aplica_a, ordem, provisorio")
    .eq("ativo", true)
    .in("aplica_a", [tipoItem, "AMBOS"])
    .order("ordem");
  if (error) throw new Error(error.message);
  return (data ?? []) as MotivoRefugo[];
}

/** Resolve nomes de pessoas em lote. `profiles` sempre por `user_id`, nunca por `id`. */
async function resolverNomes(userIds: string[]): Promise<Record<string, string>> {
  const unicos = Array.from(new Set(userIds.filter(Boolean)));
  if (unicos.length === 0) return {};

  const { data, error } = await (supabase as any)
    .from("profiles")
    .select("user_id, full_name, email")
    .in("user_id", unicos);
  if (error) throw new Error(error.message);

  const mapa: Record<string, string> = {};
  (data ?? []).forEach((p: any) => {
    mapa[p.user_id] = p.full_name || p.email || "—";
  });
  return mapa;
}

/**
 * Log do dia da sala: entradas, refugos e saídas de hoje, mais recente primeiro.
 *
 * "Hoje" é o dia do OPERADOR (fuso do navegador), não o do servidor: quem olha a
 * tela quer ver o próprio turno. O corte é feito em `data_movimento`, que é o
 * momento do fato — `registrado_em` é o momento do registro, e os dois podem
 * divergir se a tela um dia permitir lançar movimento retroativo.
 */
export async function listarMovimentosDoDia(salaId: string): Promise<MovimentoLog[]> {
  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);
  const desde = inicioDoDia.toISOString();

  const [entradas, refugos, saidas] = await Promise.all([
    (supabase as any)
      .from("prod_entradas")
      .select(
        "id, produto_id, quantidade, unidade, lote, registrado_por, registrado_em, data_movimento, estornada_em, motivo_estorno",
      )
      .eq("sala_id", salaId)
      .gte("data_movimento", desde),
    (supabase as any)
      .from("prod_refugos")
      .select(
        "id, produto_id, quantidade, unidade, lote, motivo_id, registrado_por, registrado_em, data_movimento, estornada_em, motivo_estorno",
      )
      .eq("sala_id", salaId)
      .gte("data_movimento", desde),
    (supabase as any)
      .from("prod_saidas")
      .select(
        "id, produto_id, quantidade, unidade, lote_producao, registrado_por, registrado_em, data_movimento, estornada_em, motivo_estorno",
      )
      .eq("sala_id", salaId)
      .gte("data_movimento", desde),
  ]);

  for (const r of [entradas, refugos, saidas]) {
    if (r.error) throw new Error(r.error.message);
  }

  const linhasEntrada = (entradas.data ?? []) as any[];
  const linhasRefugo = (refugos.data ?? []) as any[];
  const linhasSaida = (saidas.data ?? []) as any[];

  const produtoIds = [...linhasEntrada, ...linhasRefugo, ...linhasSaida].map((l) => l.produto_id);
  const userIds = [...linhasEntrada, ...linhasRefugo, ...linhasSaida].map((l) => l.registrado_por);
  const motivoIds = linhasRefugo.map((l) => l.motivo_id).filter(Boolean);

  const [nomesPessoas, nomesProdutos, nomesMotivos] = await Promise.all([
    resolverNomes(userIds),
    resolverProdutos(produtoIds),
    resolverMotivos(motivoIds),
  ]);

  const normalizar = (
    linha: any,
    tipo: TipoMovimento,
    lote: string | null,
    motivoNome: string | null,
  ): MovimentoLog => ({
    id: linha.id,
    tipo,
    produto_id: linha.produto_id,
    produto_nome: nomesProdutos[linha.produto_id] ?? "—",
    quantidade: Number(linha.quantidade),
    unidade: linha.unidade,
    lote,
    motivo_nome: motivoNome,
    registrado_por: linha.registrado_por,
    registrado_por_nome: nomesPessoas[linha.registrado_por] ?? "—",
    registrado_em: linha.registrado_em,
    data_movimento: linha.data_movimento,
    estornada_em: linha.estornada_em,
    motivo_estorno: linha.motivo_estorno,
  });

  return [
    ...linhasEntrada.map((l) => normalizar(l, "ENTRADA", l.lote, null)),
    ...linhasRefugo.map((l) => normalizar(l, "REFUGO", l.lote, nomesMotivos[l.motivo_id] ?? null)),
    ...linhasSaida.map((l) => normalizar(l, "SAIDA", l.lote_producao, null)),
  ].sort((a, b) => b.data_movimento.localeCompare(a.data_movimento));
}

async function resolverProdutos(produtoIds: string[]): Promise<Record<string, string>> {
  const unicos = Array.from(new Set(produtoIds.filter(Boolean)));
  if (unicos.length === 0) return {};

  const { data, error } = await (supabase as any)
    .from("prod_produtos")
    .select("id, nome, nome_curto")
    .in("id", unicos);
  if (error) throw new Error(error.message);

  const mapa: Record<string, string> = {};
  (data ?? []).forEach((p: any) => {
    mapa[p.id] = p.nome_curto || p.nome;
  });
  return mapa;
}

async function resolverMotivos(motivoIds: string[]): Promise<Record<string, string>> {
  const unicos = Array.from(new Set(motivoIds.filter(Boolean)));
  if (unicos.length === 0) return {};

  const { data, error } = await (supabase as any)
    .from("prod_sala_motivos_refugo")
    .select("id, nome")
    .in("id", unicos);
  if (error) throw new Error(error.message);

  const mapa: Record<string, string> = {};
  (data ?? []).forEach((m: any) => {
    mapa[m.id] = m.nome;
  });
  return mapa;
}

/** Vínculos ativos da sala, com nome resolvido por `profiles.user_id`. */
export async function listarEquipe(salaId: string): Promise<VinculoEquipe[]> {
  const { data, error } = await (supabase as any)
    .from("prod_sala_usuarios")
    .select("user_id, atribuido_em")
    .eq("sala_id", salaId)
    .is("revogado_em", null)
    .order("atribuido_em");
  if (error) throw new Error(error.message);

  const linhas = (data ?? []) as any[];
  if (linhas.length === 0) return [];

  const { data: perfis, error: errPerfis } = await (supabase as any)
    .from("profiles")
    .select("user_id, full_name, email")
    .in(
      "user_id",
      linhas.map((l) => l.user_id),
    );
  if (errPerfis) throw new Error(errPerfis.message);

  const porUsuario: Record<string, any> = {};
  (perfis ?? []).forEach((p: any) => {
    porUsuario[p.user_id] = p;
  });

  return linhas.map((l) => ({
    user_id: l.user_id,
    nome: porUsuario[l.user_id]?.full_name || porUsuario[l.user_id]?.email || "—",
    email: porUsuario[l.user_id]?.email ?? null,
    atribuido_em: l.atribuido_em,
  }));
}

// ─── Escritas (só por RPC) ────────────────────────────────────────────────────

/**
 * As mensagens de erro das RPCs são texto pronto para o operador, em português
 * ("Lote X vencido em 30/06/2026 — não pode entrar na sala"). Propagamos como
 * vieram: quem chama mostra `error.message` sem traduzir nem reformular.
 */

export interface DadosEntrada {
  salaId: string;
  produtoId: string;
  quantidade: number;
  unidade: string;
  lote?: string | null;
  validade?: string | null; // 'YYYY-MM-DD'
  nfNumero?: string | null;
  observacao?: string | null;
}

export async function registrarEntrada(dados: DadosEntrada): Promise<string> {
  const { data, error } = await (supabase as any).rpc("prod_registrar_entrada", {
    p_sala_id: dados.salaId,
    p_produto_id: dados.produtoId,
    p_quantidade: dados.quantidade,
    p_unidade: dados.unidade,
    p_lote: dados.lote ?? null,
    p_validade: dados.validade ?? null,
    p_nf_numero: dados.nfNumero ?? null,
    p_observacao: dados.observacao ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface DadosRefugo {
  salaId: string;
  produtoId: string;
  tipoItem: "INSUMO" | "PRODUTO";
  motivoId: string;
  quantidade: number;
  unidade: string;
  lote?: string | null;
  observacao?: string | null;
}

export async function registrarRefugo(dados: DadosRefugo): Promise<string> {
  const { data, error } = await (supabase as any).rpc("prod_registrar_refugo", {
    p_sala_id: dados.salaId,
    p_produto_id: dados.produtoId,
    p_tipo_item: dados.tipoItem,
    p_motivo_id: dados.motivoId,
    p_quantidade: dados.quantidade,
    p_unidade: dados.unidade,
    p_lote: dados.lote ?? null,
    p_batelada_id: null, // sem batelada no MVP (Ajuste B)
    p_observacao: dados.observacao ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface DadosSaida {
  salaId: string;
  produtoId: string;
  quantidade: number;
  unidade: string;
  loteProducao: string;
  observacao?: string | null;
}

export async function registrarSaida(dados: DadosSaida): Promise<string> {
  const { data, error } = await (supabase as any).rpc("prod_registrar_saida", {
    p_sala_id: dados.salaId,
    p_produto_id: dados.produtoId,
    p_quantidade: dados.quantidade,
    p_unidade: dados.unidade,
    p_lote_producao: dados.loteProducao,
    p_batelada_id: null, // sem batelada no MVP (Ajuste B)
    p_observacao: dados.observacao ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/**
 * Estorno (soft). A RPC é a autoridade sobre quem pode: autor dentro de 60
 * minutos, ou quem tem `salas.estornar`. A UI esconde o botão por conveniência,
 * mas se ela recusar, a mensagem dela é o que o operador vê.
 */
export async function estornarMovimento(
  tipo: TipoMovimento,
  id: string,
  motivo: string,
): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("prod_estornar_movimento", {
    p_tipo: tipo,
    p_id: id,
    p_motivo: motivo,
  });
  if (error) throw new Error(error.message);
  return data as boolean;
}

export async function vincularUsuario(
  salaId: string,
  userId: string,
  motivo?: string | null,
): Promise<string> {
  const { data, error } = await (supabase as any).rpc("prod_sala_usuario_vincular", {
    p_sala_id: salaId,
    p_user_id: userId,
    p_motivo: motivo ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function revogarUsuario(
  salaId: string,
  userId: string,
  motivo?: string | null,
): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("prod_sala_usuario_revogar", {
    p_sala_id: salaId,
    p_user_id: userId,
    p_motivo: motivo ?? null,
  });
  if (error) throw new Error(error.message);
  return data as boolean;
}

// ─── Auxiliares de exibição ───────────────────────────────────────────────────

/** Peso da unidade na escala do produto. Só para EXIBIR conversão — nunca para gravar. */
export function pesoDaUnidade(produto: ProdutoSala, unidade: string): number | null {
  const item = produto.escala_unidades.find((u) => u.unidade === unidade);
  return item ? Number(item.peso) : null;
}

/** Unidade base do produto = `posicao = 1` da escala; cai para `unidade_base` se faltar. */
export function unidadePadrao(produto: ProdutoSala): string {
  const base = produto.escala_unidades.find((u) => u.posicao === 1);
  return base?.unidade ?? produto.unidade_base;
}

/**
 * Texto da conversão para a tela ("2 KG = 2.000 GRAMAS").
 * Retorna null quando a unidade escolhida já é a base — aí não há o que explicar.
 */
export function textoConversao(
  produto: ProdutoSala,
  unidade: string,
  quantidade: number,
): string | null {
  const peso = pesoDaUnidade(produto, unidade);
  if (peso === null || peso === 1) return null;
  const base = unidadePadrao(produto);
  if (unidade === base) return null;
  const total = quantidade * peso;
  return `${formatarNumero(quantidade)} ${unidade} = ${formatarNumero(total)} ${base}`;
}

export function formatarNumero(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}
