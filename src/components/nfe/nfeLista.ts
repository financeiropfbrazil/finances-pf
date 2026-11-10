/**
 * Regras puras da lista de NF-e (Suprimentos → Notas Fiscais) — NFE-7.
 *
 * Os itens vêm de `compras_nfe.dados_extraidos.itens`, gravados na chegada (Edge `receber-nfe`, Riosoft) ou no
 * upload manual (`parseNfeXml`): os dois guardam `cfop` e `pedido_xml` (o <xPed> do item, às vezes "sujo").
 */

export interface ItemListaNfe {
  cfop?: string | null;
  pedido_xml?: string | null;
}

export interface NotaBuscavel {
  numero: string | null;
  emitente_nome: string | null;
  emitente_cnpj: string | null;
  chave_acesso: string | null;
  pedido_compra_numero: string | null;
  dados_extraidos?: { itens?: ItemListaNfe[] | null } | null;
}

const itensDa = (n: Pick<NotaBuscavel, "dados_extraidos">): ItemListaNfe[] =>
  Array.isArray(n.dados_extraidos?.itens) ? (n.dados_extraidos!.itens as ItemListaNfe[]) : [];

const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const semZerosAEsquerda = (s: string) => s.replace(/^0+(?=\d)/, "");

/** CFOPs distintos da nota, na ordem dos itens. */
export function cfopsDaNota(n: Pick<NotaBuscavel, "dados_extraidos">): string[] {
  const vistos: string[] = [];
  for (const it of itensDa(n)) {
    const c = (it.cfop ?? "").trim();
    if (c && !vistos.includes(c)) vistos.push(c);
  }
  return vistos;
}

/** Números de pedido citados nos itens (<xPed>), só os que são número, sem zeros à esquerda e sem repetição. */
export function pedidosCitadosNosItens(n: Pick<NotaBuscavel, "dados_extraidos">): string[] {
  const vistos: string[] = [];
  for (const it of itensDa(n)) {
    const bruto = (it.pedido_xml ?? "").trim();
    if (!/^\d+$/.test(bruto)) continue;
    const p = semZerosAEsquerda(bruto);
    if (!vistos.includes(p)) vistos.push(p);
  }
  return vistos;
}

/**
 * A nota entra na busca? Fornecedor e número por trecho (como antes); CNPJ e chave de acesso pelos dígitos, com ou
 * sem pontuação; pedido (citado no item ou vinculado no Hub) e CFOP pelo número exato — "4779" acha o pedido 0004779.
 */
export function notaCasaBusca(n: NotaBuscavel, termo: string): boolean {
  const s = termo.trim().toLowerCase();
  if (!s) return true;
  if ((n.emitente_nome ?? "").toLowerCase().includes(s)) return true;
  if ((n.numero ?? "").toLowerCase().includes(s)) return true;

  // Só dígitos e pontuação de documento: "11.222.333/0001-44", "3526 1100 ...", "0004779".
  if (!/^[\d\s./-]+$/.test(s)) return false;
  const d = soDigitos(s);
  if (!d) return false;
  if (soDigitos(n.emitente_cnpj).includes(d)) return true;
  if (d.length >= 10 && soDigitos(n.chave_acesso).includes(d)) return true;
  const pedido = semZerosAEsquerda(d);
  if (d.length >= 3) {
    if (pedidosCitadosNosItens(n).includes(pedido)) return true;
    if (n.pedido_compra_numero && semZerosAEsquerda(soDigitos(n.pedido_compra_numero)) === pedido) return true;
  }
  if (d.length === 4 && cfopsDaNota(n).includes(d)) return true;
  return false;
}

/** Resumo dos erros do upload de XML para o aviso: os 2 primeiros com o motivo, e quantos mais houver. */
export function resumoErrosUpload(erros: string[]): string | null {
  if (erros.length === 0) return null;
  const primeiros = erros.slice(0, 2).join(" · ");
  return erros.length > 2 ? `${primeiros} · e mais ${erros.length - 2}` : primeiros;
}
