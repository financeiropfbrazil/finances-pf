// =====================================================================
// Edge Function: exportar-notas-recebidas-balancete   (COMPRAS · janela de leitura)   v1
// PLANO-NFE.md — NFE-21. Ordem do Pedro em 23/11/2026 (agente Klaus: "se eu pedir uma análise no balancete e
// tiver alguma NF envolvida, ele seja capaz de consultar os itens, prazos, cnpj... tudo o que tem na NF").
// =====================================================================
// Janela SÓ DE LEITURA para o Balancete P&F buscar as NOTAS RECEBIDAS (o documento como o fornecedor emitiu):
//   - NF-e de produto (compras_nfe, entrada pela Riosoft/Arqimport), com o XML completo;
//   - NFS-e (v_nfse_recebida + nfse_adn_doc, ambiente nacional), com o XML completo.
// Mesmo desenho da exportar-notas-balancete (VND-9): o Hub não envia nada; quem chama é o Balancete.
// NÃO é o lançamento no Alvo (isso é "notas de entrada" no Balancete). Não grava nada no Hub.
//
// POST, header x-api-key = segredo BALANCETE_RECEBIDAS_KEY (só desta janela; o mesmo guardado no Balancete).
// Sem o segredo configurado a função fica fechada (500).
//   { "acao": "resumo", "meses": 13 }
//       → por mês e tipo: quantidade de notas e impressão digital; e quando chegou a última NF-e e a última
//         leitura do ambiente nacional (para saber se a fonte está em dia).
//   { "acao": "mes", "tipo": "nfe" | "nfse", "mes": "AAAA-MM", "pagina": 1, "por_pagina": 20 }
//       → as notas do mês (por data de emissão), com o XML e a situação no Hub, em páginas de até 50.
// Kill-switch: sync_settings.job_name = 'exportar-notas-recebidas-balancete' (false → 503).
// SECRETS: BALANCETE_RECEBIDAS_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Deploy: verify_jwt = false (auth real = x-api-key). Nenhuma mudança de banco: só lê tabelas e views que existem.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import {
  chaveConfere, intervaloMes, lerPedido, montarNfe, montarNfse, paginacao, pedidosPorNota, resumoMeses, ultimosMeses,
} from "./logica.ts";

const VERSAO = "v1-2026-11-23";
const JOB_NAME = "exportar-notas-recebidas-balancete";
const BLOCO = 500; // abaixo do limite de linhas por leitura da API (1.000 no padrão do Supabase)

const COLS_NFE_RESUMO =
  "id, chave_acesso, data_emissao, updated_at, status_lancamento, recebido, pedido_compra_numero, erp_chave_movestq, situacao";
const COLS_NFE = [
  "id", "chave_acesso", "modelo", "numero", "serie", "data_emissao", "natureza_operacao",
  "emitente_cnpj", "emitente_nome", "emitente_ie", "emitente_uf", "emitente_municipio", "destinatario_cnpj", "destinatario_nome",
  "valor_produtos", "valor_frete", "valor_seguro", "valor_desconto", "valor_outras_despesas", "valor_ipi",
  "base_calculo_icms", "valor_icms", "base_icms_st", "valor_icms_st", "valor_ii", "valor_fcp", "valor_pis", "valor_cofins",
  "valor_total", "imported_at", "origem", "situacao", "status_lancamento", "lancado_em", "recebido", "recebido_em",
  "erp_chave_movestq", "pedido_compra_numero", "pedido_compra_entidade", "pedido_compra_classe",
  "pedido_compra_centro_custo", "pedido_compra_cond_pagamento", "pedido_compra_valor", "updated_at", "raw_xml",
].join(", ");
const COLS_NFSE_RESUMO =
  "nsu, chave_acesso, data_emissao, situacao_fisco, cancelada_em, situacao_alvo, alvo_chave_docfin, alvo_chave_movestq, alvo_valor, alvo_parcelas, alvo_pagamento, alvo_pedido, alvo_vinculo";
const COLS_NFSE = [
  "nsu", "chave_acesso", "numero", "data_emissao", "prestador_doc", "prestador_nome", "cmun_emissor", "municipio_emissor",
  "tomador_doc", "intermediario_doc", "valor_servico", "valor_liquido", "gerado_em", "situacao_fisco", "cancelada_em",
  "situacao_alvo", "alvo_especies", "alvo_chave_docfin", "alvo_chave_movestq", "alvo_data_entrada", "alvo_valor",
  "alvo_parcelas", "alvo_pagamento", "alvo_pedido", "alvo_vinculo", "alvo_doc_numero", "alvo_cnpj",
].join(", ");

// Brasília sem horário de verão (desde 2019): UTC−3 fixo.
function hojeBrasil(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const esperada = Deno.env.get("BALANCETE_RECEBIDAS_KEY");
  if (!esperada) return json({ error: "Função fechada: segredo BALANCETE_RECEBIDAS_KEY não configurado" }, 500);
  if (!chaveConfere(req.headers.get("x-api-key"), esperada)) return json({ error: "Não autorizado" }, 401);

  const hoje = hojeBrasil();
  const body = await req.json().catch(() => null);
  const pedido = lerPedido(body, hoje);
  if ("erro" in pedido) return json({ error: pedido.erro }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: settings } = await supabase
    .from("sync_settings")
    .select("enabled, paused_reason")
    .eq("job_name", JOB_NAME)
    .maybeSingle();
  if (settings && settings.enabled === false) {
    return json({ error: `Janela desligada no Hub: ${settings.paused_reason || "sem motivo"}` }, 503);
  }

  // Lê todas as linhas de uma consulta, em blocos, e confere o total: se a API cortar linhas em silêncio, falha
  // em vez de devolver um resumo incompleto (um mês com menos notas teria impressão diferente e pareceria "mudou").
  async function tudo(montar: (opcoes?: { count: "exact" }) => any, ordem: string): Promise<any[]> {
    const r: any[] = [];
    let total: number | null = null;
    for (let de = 0; ; de += BLOCO) {
      const { data, error, count } = await (de === 0 ? montar({ count: "exact" }) : montar()).order(ordem).range(de, de + BLOCO - 1);
      if (error) throw new Error(error.message);
      if (de === 0) total = count ?? null;
      r.push(...(data ?? []));
      if (!data || data.length < BLOCO) break;
    }
    if (total === null || r.length !== total) throw new Error(`leitura incompleta: ${r.length} de ${total ?? "?"} linhas`);
    return r;
  }

  try {
    if (pedido.acao === "resumo") {
      const meses = ultimosMeses(pedido.meses, hoje);
      const de = `${meses[0]}-01`;
      const [nfe, vinculos, nfse] = await Promise.all([
        tudo((o) => supabase.from("compras_nfe").select(COLS_NFE_RESUMO, o).gte("data_emissao", de), "id"),
        tudo((o) => supabase.from("compras_nfe_pedidos").select("nfe_id, pedido_numero, is_principal", o), "id"),
        tudo((o) => supabase.from("v_nfse_recebida").select(COLS_NFSE_RESUMO, o).gte("data_emissao", de), "nsu"),
      ]);
      const pedidos = pedidosPorNota(vinculos);
      const porMes = await resumoMeses(meses, nfe.map((l) => ({ linha: l, pedidos: pedidos.get(l.id) ?? [] })), nfse);

      // Situação das fontes: quando chegou a última NF-e da Riosoft e a última leitura do ambiente nacional.
      const [{ data: ultNfe }, { data: ultAdn }, { data: rodada }] = await Promise.all([
        supabase.from("compras_nfe").select("imported_at").order("imported_at", { ascending: false }).limit(1),
        supabase.from("nfse_adn_doc").select("lido_em").order("lido_em", { ascending: false }).limit(1),
        supabase.from("sync_runs").select("started_at, finished_at, total_erros")
          .eq("job_type", "nfse_adn").order("started_at", { ascending: false }).limit(1),
      ]);
      return json({
        gerado_em: new Date().toISOString(),
        meses: porMes,
        fontes: {
          nfe_ultima_chegada: ultNfe?.[0]?.imported_at ?? null,
          nfse_ultima_leitura: ultAdn?.[0]?.lido_em ?? null,
          nfse_ultima_rodada: rodada?.[0] ?? null,
        },
        versao: VERSAO,
      });
    }

    const { de, ate } = intervaloMes(pedido.mes);
    const inicio = (pedido.pagina - 1) * pedido.porPagina;
    const fim = inicio + pedido.porPagina - 1;

    if (pedido.tipo === "nfe") {
      const { data, count, error } = await supabase.from("compras_nfe")
        .select(COLS_NFE, { count: "exact" })
        .gte("data_emissao", de).lt("data_emissao", ate)
        .order("chave_acesso").range(inicio, fim);
      if (error) throw new Error(error.message);
      const ids = (data ?? []).map((n: any) => n.id);
      if (ids.length !== Math.min(pedido.porPagina, Math.max(0, (count ?? 0) - inicio))) {
        throw new Error(`página incompleta: ${ids.length} notas, esperadas ${Math.min(pedido.porPagina, Math.max(0, (count ?? 0) - inicio))}`);
      }
      const { data: vinc, error: e2 } = ids.length
        ? await supabase.from("compras_nfe_pedidos").select("nfe_id, pedido_numero, is_principal").in("nfe_id", ids)
        : { data: [], error: null };
      if (e2) throw new Error(e2.message);
      const pedidos = pedidosPorNota(vinc ?? []);
      const notas = (data ?? []).map((n: any) => montarNfe(n, pedidos.get(n.id) ?? []));
      return json({
        gerado_em: new Date().toISOString(), tipo: "nfe", mes: pedido.mes,
        ...paginacao(count ?? 0, pedido.pagina, pedido.porPagina), na_pagina: notas.length, notas, versao: VERSAO,
      });
    }

    const { data, count, error } = await supabase.from("v_nfse_recebida")
      .select(COLS_NFSE, { count: "exact" })
      .gte("data_emissao", de).lt("data_emissao", ate)
      .order("chave_acesso").range(inicio, fim);
    if (error) throw new Error(error.message);
    const nsus = (data ?? []).map((n: any) => n.nsu);
    if (nsus.length !== Math.min(pedido.porPagina, Math.max(0, (count ?? 0) - inicio))) {
      throw new Error(`página incompleta: ${nsus.length} notas, esperadas ${Math.min(pedido.porPagina, Math.max(0, (count ?? 0) - inicio))}`);
    }
    const { data: docs, error: e2 } = nsus.length
      ? await supabase.from("nfse_adn_doc").select("nsu, xml").in("nsu", nsus)
      : { data: [], error: null };
    if (e2) throw new Error(e2.message);
    const xmlPorNsu = new Map<string, string | null>((docs ?? []).map((d: any) => [String(d.nsu), d.xml ?? null]));
    const semXml = nsus.filter((x: unknown) => !xmlPorNsu.get(String(x)));
    if (semXml.length) throw new Error(`NFS-e sem XML no espelho do ambiente nacional: NSU ${semXml.join(", ")}`);
    const notas = (data ?? []).map((n: any) => montarNfse(n, xmlPorNsu.get(String(n.nsu)) ?? null));
    return json({
      gerado_em: new Date().toISOString(), tipo: "nfse", mes: pedido.mes,
      ...paginacao(count ?? 0, pedido.pagina, pedido.porPagina), na_pagina: notas.length, notas, versao: VERSAO,
    });
  } catch (e) {
    console.error(`[${JOB_NAME}] ${(e as Error).message}`);
    return json({ error: `Falha na leitura: ${(e as Error).message}`.slice(0, 500) }, 500);
  }
});
