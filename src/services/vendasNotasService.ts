/**
 * Vendas → Notas de Saída (PLANO-VENDAS VND-7): notas fiscais emitidas pela P&F, espelho do Alvo.
 *
 * Fonte: RPCs `vendas_notas_listar`, `vendas_nota_detalhe` e `vendas_itens_listar` (SECURITY DEFINER,
 * gate `vendas.notas.access`, só leitura), que leem a `v_nf_saida` e as tabelas `nf_saida*` (VND-3).
 * O espelho anda pela Edge `sync-nf-saida-cron` (VND-6: 08h20, 13h20 e 18h20, dias úteis).
 *
 * LIVRO × ESPELHO (CLAUDE.md): `cancelada` é o que o Alvo diz da nota (livro); `situacao_hub`,
 * `ausente_desde` e `detalhe_status` são do espelho (o Hub já leu? a nota sumiu da lista do Alvo?).
 */
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

/** RPCs novas ainda não estão nos tipos gerados do Supabase: chamada tipada à mão (sem `any`). */
type RpcSolta = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const rpc: RpcSolta = (fn, args) => (supabase.rpc as unknown as RpcSolta).call(supabase, fn, args);

export interface NotaSaida {
  id: string;
  modelo: "NF-e" | "NFS-e" | string;
  serie: string;
  numero: number;
  data_emissao: string;
  data_competencia: string | null;
  codigo_entidade: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  cpf_cnpj: string | null;
  sigla_pais: string | null;
  nome_pais: string | null;
  uf: string | null;
  nome_cidade: string | null;
  regiao: string | null;
  intercompany_austria: boolean | null;
  natureza_principal: string | null;
  abrangencia: string | null;
  classe_principal: string | null;
  tipo_operacao: string | null;
  numero_pedvenda: string | null;
  vendedor_principal: string | null;
  cancelada: boolean;
  data_cancelamento: string | null;
  numero_nfse_prefeitura: string | null;
  moeda_codigo: string | null;
  cambio: number | null;
  valor_original: number | null;
  valor_total: number;
  valor_produto: number | null;
  valor_servico: number | null;
  valor_frete: number | null;
  valor_desconto: number | null;
  valor_icms: number | null;
  valor_ipi: number | null;
  valor_iss: number | null;
  situacao_hub: string | null;
  detalhe_status: string | null;
  ausente_desde: string | null;
}

export interface GrupoResumo {
  notas: number;
  valor: number;
}

export interface ResultadoNotasSaida {
  total: number;
  ultima_leitura_alvo: string | null;
  ultima_rodada: { fim: string; erros: number; origem: string } | null;
  pendentes_detalhe: number;
  agendamento_ligado: boolean;
  resumo: {
    notas: number;
    canceladas: number;
    valor_total: number;
    por_regiao: (GrupoResumo & { regiao: string })[];
    por_tipo: (GrupoResumo & { tipo: string })[];
  };
  linhas: NotaSaida[];
}

export interface FiltrosNotasSaida {
  de: string;
  ate: string;
  busca?: string;
  modelos?: string[] | null;
  tipos?: string[] | null;
  regioes?: string[] | null;
  incluirCanceladas?: boolean;
}

function params(f: FiltrosNotasSaida) {
  return {
    p_de: f.de,
    p_ate: f.ate,
    p_busca: f.busca?.trim() ? f.busca.trim() : null,
    p_modelos: f.modelos?.length ? f.modelos : null,
    p_tipos: f.tipos?.length ? f.tipos : null,
    p_regioes: f.regioes?.length ? f.regioes : null,
    p_incluir_canceladas: f.incluirCanceladas ?? true,
  };
}

/** A RPC devolve até 5000 notas por chamada; busca em blocos até chegar ao `total` (resumo vem do 1º bloco). */
export async function listarNotasSaida(f: FiltrosNotasSaida): Promise<ResultadoNotasSaida> {
  const BLOCO = 5000;
  let primeiro: ResultadoNotasSaida | null = null;
  const linhas: NotaSaida[] = [];
  for (let offset = 0; ; offset += BLOCO) {
    const { data, error } = await rpc("vendas_notas_listar", { ...params(f), p_limit: BLOCO, p_offset: offset });
    if (error) throw new Error(error.message);
    const r = data as ResultadoNotasSaida;
    primeiro ??= r;
    linhas.push(...(r.linhas ?? []));
    if (!r.linhas || r.linhas.length < BLOCO || linhas.length >= r.total) break;
  }
  return { ...(primeiro as ResultadoNotasSaida), linhas };
}

export interface ItemNotaSaida {
  sequencia: number;
  item_servico: boolean | null;
  codigo_produto: string | null;
  codigo_alternativo: string | null;
  nome_produto: string | null;
  natureza_operacao: string | null;
  cfop: string | null;
  ncm: string | null;
  unidade: string | null;
  quantidade: number | null;
  valor_unitario: number | null;
  valor_total: number | null;
  valor_frete: number | null;
  valor_desconto: number | null;
  valor_icms: number | null;
  valor_ipi: number | null;
  valor_pis: number | null;
  valor_cofins: number | null;
  valor_iss: number | null;
  numero_pedvenda: string | null;
}

export interface DetalheNotaSaida {
  nota: NotaSaida & Record<string, unknown>;
  itens: ItemNotaSaida[];
  lotes: { sequencia_item: number; ordem: number; codigo_produto: string | null; numero_lote: string | null; data_validade: string | null; codigo_local: string | null; quantidade: number | null }[];
  series: { sequencia_item: number; controle_num_serie: number }[];
  parcelas: { sequencia_cond: number; sequencia_parcela: number; duplicata: string | null; nome_cond_pag: string | null; data_vencimento: string | null; valor: number | null; chave_docfin: number | null }[];
  classes: { codigo_classe: string; valor: number | null; natureza: string | null }[];
}

export async function buscarDetalheNotaSaida(id: string): Promise<DetalheNotaSaida | null> {
  const { data, error } = await rpc("vendas_nota_detalhe", { p_id: id });
  if (error) throw new Error(error.message);
  return (data as DetalheNotaSaida | null) ?? null;
}

export interface ItemExcelNotaSaida extends ItemNotaSaida {
  modelo: string;
  serie: string;
  numero: number;
  data_emissao: string;
  cliente: string | null;
  pais: string | null;
  regiao: string | null;
  tipo_operacao: string | null;
  cancelada: boolean;
}

export async function listarItensNotasSaida(f: FiltrosNotasSaida): Promise<ItemExcelNotaSaida[]> {
  const { data, error } = await rpc("vendas_itens_listar", params(f));
  if (error) throw new Error(error.message);
  return (data as ItemExcelNotaSaida[]) ?? [];
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const data = (iso: string | null | undefined) => {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

/** Excel com duas abas: uma linha por nota e uma linha por item (mesmo período e filtros da tela). */
export function exportarNotasSaidaXLSX(notas: NotaSaida[], itens: ItemExcelNotaSaida[], f: FiltrosNotasSaida) {
  const abaNotas = notas.map((n) => ({
    Modelo: n.modelo,
    Série: n.serie,
    Número: n.numero,
    Emissão: data(n.data_emissao),
    Competência: data(n.data_competencia),
    Cliente: n.razao_social,
    "CNPJ/CPF": n.cpf_cnpj,
    País: n.nome_pais,
    UF: n.uf,
    Região: n.regiao,
    "Tipo de operação": n.tipo_operacao ?? "(sem classe)",
    Classe: n.classe_principal,
    Natureza: n.natureza_principal,
    "Pedido de venda": n.numero_pedvenda,
    Cancelada: n.cancelada ? "Sim" : "Não",
    "Cancelada em": data(n.data_cancelamento),
    Moeda: n.moeda_codigo,
    Câmbio: num(n.cambio),
    "Valor na moeda": num(n.valor_original),
    "Valor total": num(n.valor_total),
    Produtos: num(n.valor_produto),
    Serviços: num(n.valor_servico),
    Frete: num(n.valor_frete),
    Desconto: num(n.valor_desconto),
    ICMS: num(n.valor_icms),
    IPI: num(n.valor_ipi),
    ISS: num(n.valor_iss),
    "Nº NFS-e na prefeitura": n.numero_nfse_prefeitura,
    "No espelho": n.situacao_hub,
  }));
  const abaItens = itens.map((i) => ({
    Modelo: i.modelo,
    Série: i.serie,
    Número: i.numero,
    Emissão: data(i.data_emissao),
    Cliente: i.cliente,
    País: i.pais,
    Região: i.regiao,
    "Tipo de operação": i.tipo_operacao ?? "(sem classe)",
    Cancelada: i.cancelada ? "Sim" : "Não",
    Item: i.sequencia,
    Produto: i.codigo_produto,
    "Código alternativo": i.codigo_alternativo,
    Nome: i.nome_produto,
    Natureza: i.natureza_operacao,
    CFOP: i.cfop,
    NCM: i.ncm,
    Unidade: i.unidade,
    Quantidade: num(i.quantidade),
    "Valor unitário": num(i.valor_unitario),
    "Valor total": num(i.valor_total),
    Frete: num(i.valor_frete),
    Desconto: num(i.valor_desconto),
    ICMS: num(i.valor_icms),
    IPI: num(i.valor_ipi),
    PIS: num(i.valor_pis),
    COFINS: num(i.valor_cofins),
    ISS: num(i.valor_iss),
    "Pedido de venda": i.numero_pedvenda,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(abaNotas), "Notas");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(abaItens), "Itens");
  const arquivo = `notas-de-saida-${f.de}-a-${f.ate}.xlsx`;
  XLSX.writeFile(wb, arquivo);
  return { arquivo, notas: abaNotas.length, itens: abaItens.length };
}
