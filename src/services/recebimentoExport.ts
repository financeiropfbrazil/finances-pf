import type { LaudoFila } from "./recebimentoService";

/**
 * Exportação XLSX da Fila de Inspeção (REC-1.3).
 *
 * PLANA, uma linha por laudo — sem o agrupamento por NF da tela. Exporta
 * exatamente o conjunto que está na tela (todos os filtros já aplicados);
 * a tela não pagina no servidor, então o array recebido já é o conjunto
 * completo do filtro.
 *
 * TIPAGEM (o Excel precisa ordenar e filtrar de verdade):
 *   - datas viajam como `Date` e viram células `t:"d"` com formato dd/mm/yyyy;
 *   - quantidade, dias parado e chave viajam como `number` (`t:"n"`);
 *   - o resto é texto — inclusive NF e nº do laudo, que têm zeros à esquerda
 *     e viram lixo se o Excel os tratar como número.
 * Comportamento verificado contra o SheetJS 0.18.5 do projeto (as datas
 * voltam no dia certo, sem escorregar de fuso).
 *
 * ⚠ FREEZE DE CABEÇALHO: o writer XLSX do SheetJS community (0.18.5) não
 * emite `<pane>` — `write_ws_xml_sheetviews` só escreve `workbookViewId`.
 * Não há como congelar a 1ª linha por essa lib sem dependência nova. Em
 * troca, o cabeçalho sai com AUTOFILTRO (`!autofilter`), que dá ordenação e
 * filtro nativos no Excel. Ver REC-1.3 no PLANO-OP.md.
 */

interface ColunaExport {
  label: string;
  tipo: "texto" | "numero" | "data";
  largura: number;
  valor: (l: LaudoFila) => string | number | Date | null;
}

/**
 * Data → `Date` no dia LOCAL, sem hora. Colunas `date` ("YYYY-MM-DD") são
 * parseadas por componentes para não voltar um dia no fuso de Brasília;
 * timestamps completos são reduzidos ao seu dia local (é o mesmo dia que a
 * tela mostra na coluna Emissão).
 */
function dataPura(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [ano, mes, dia] = iso.split("-").map(Number);
    return new Date(ano, mes - 1, dia);
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function numero(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const COLUNAS_BASE: ColunaExport[] = [
  { label: "NF", tipo: "texto", largura: 12, valor: (l) => l.numero_documento || "" },
  { label: "Laudo", tipo: "texto", largura: 14, valor: (l) => l.numero || "" },
  { label: "Código do produto", tipo: "texto", largura: 18, valor: (l) => l.codigo_produto || "" },
  { label: "Nome do produto", tipo: "texto", largura: 42, valor: (l) => l.produto_nome || "" },
  { label: "Lote", tipo: "texto", largura: 14, valor: (l) => l.numero_ctrl_lote || "" },
  { label: "Validade do lote", tipo: "data", largura: 16, valor: (l) => dataPura(l.data_validade_ctrl_lote) },
  { label: "Quantidade", tipo: "numero", largura: 12, valor: (l) => numero(l.quantidade) },
  { label: "Unidade", tipo: "texto", largura: 10, valor: (l) => l.codigo_prod_unid_med || "" },
  { label: "Data de emissão", tipo: "data", largura: 16, valor: (l) => dataPura(l.data_emissao) },
  { label: "Dias parado", tipo: "numero", largura: 12, valor: (l) => numero(l.dias_parado) },
  { label: "Status", tipo: "texto", largura: 14, valor: (l) => l.status || "" },
  { label: "Resultado da análise", tipo: "texto", largura: 20, valor: (l) => l.resultado_analise || "" },
  { label: "Data do resultado", tipo: "data", largura: 16, valor: (l) => dataPura(l.data_resultado) },
  { label: "Chave MovEstq", tipo: "numero", largura: 14, valor: (l) => numero(l.chave_movestq) },
];

const COLUNAS_CONCLUIDOS: ColunaExport[] = [
  { label: "Quantidade aprovada", tipo: "numero", largura: 18, valor: (l) => numero(l.quantidade_aprovada) },
  { label: "Quantidade reprovada", tipo: "numero", largura: 18, valor: (l) => numero(l.quantidade_reprovada) },
];

/** `fila-inspecao_AAAA-MM-DD_HHmm.xlsx` — carimbo do momento da exportação. */
function nomeArquivo(agora: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const data = `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
  const hora = `${p(agora.getHours())}${p(agora.getMinutes())}`;
  return `fila-inspecao_${data}_${hora}.xlsx`;
}

/**
 * Gera e baixa a planilha. Devolve o nome do arquivo e quantas linhas saíram
 * (a tela usa isso no toast — o usuário confere o que levou).
 */
export async function exportarFilaXLSX(
  laudos: LaudoFila[],
  escopo: "fila" | "concluidos",
): Promise<{ arquivo: string; linhas: number }> {
  const XLSX = await import("xlsx");

  const colunas = escopo === "concluidos" ? [...COLUNAS_BASE, ...COLUNAS_CONCLUIDOS] : COLUNAS_BASE;

  const cabecalho = colunas.map((c) => c.label);
  const linhas = laudos.map((l) => colunas.map((c) => c.valor(l)));

  // cellDates: valores Date viram células de data (t:"d"), não texto.
  const ws = XLSX.utils.aoa_to_sheet([cabecalho, ...linhas], { cellDates: true });

  // Formato visível das colunas de data (o valor já é data de verdade).
  const colunasData = colunas.map((c, i) => (c.tipo === "data" ? i : -1)).filter((i) => i >= 0);
  for (let r = 1; r <= linhas.length; r++) {
    for (const c of colunasData) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "d") cell.z = "dd/mm/yyyy";
    }
  }

  ws["!cols"] = colunas.map((c) => ({ wch: c.largura }));

  // Autofiltro no cabeçalho (o freeze de painel não existe nesta lib — ver
  // o comentário do topo). Só faz sentido com pelo menos uma linha de dados.
  if (linhas.length > 0) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: linhas.length, c: colunas.length - 1 },
      }),
    };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, escopo === "concluidos" ? "Concluídos" : "Fila de Inspeção");

  const arquivo = nomeArquivo(new Date());
  XLSX.writeFile(wb, arquivo, { cellDates: true });

  return { arquivo, linhas: linhas.length };
}
