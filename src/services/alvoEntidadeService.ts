import { supabase } from "@/integrations/supabase/client";

/**
 * SYNC DE ENTIDADES (fornecedores/clientes) — via GATEWAY.
 *
 * ── Mudança de 19/07/2026: saiu do Alvo direto, entrou no erp-proxy ─────────
 * Antes, este service chamava `Entidade/GetListForComponents` DIRETO do
 * navegador, autenticando com `alvo_username`/`alvo_password` lidos do
 * localStorage. Isso significava que só quem tinha as credenciais configuradas
 * (o admin) conseguia sincronizar — as operadoras de compras recebiam
 * "Credenciais não configuradas" e ficavam dependendo de alguém do financeiro.
 * Resultado prático: o cache de entidades ficou 18 dias sem atualizar
 * (01/07 → 19/07) e 43 fornecedores novos ficaram invisíveis no Hub.
 *
 * Agora usa o gateway (`erp-proxy`), igual ao sync de produtos: o servidor
 * autentica com as credenciais do Render e qualquer usuário logado no Hub
 * consegue sincronizar. Efeito colateral bem-vindo: a senha do ERP sai do
 * navegador.
 *
 * Rotas usadas (ver erp-proxy/src/routes/entidade.ts):
 *   POST /entidade/list         { pageIndex, pageSize, filter }
 *   POST /entidade/cidade-list  { pageIndex, pageSize }
 *
 * O retry de 409 (conflito de sessão do Alvo) não é mais necessário aqui — o
 * `callAlvo` do gateway já reautentica e repete internamente.
 */

const ERP_PROXY_URL = "https://erp-proxy.onrender.com";
const PAGE_SIZE = 500;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Filtro de fornecedor (mesma regra usada na tela do Alvo)
const FILTRO_FORNECEDOR =
  "( CodigoStatEnt IN ('01','02','11','03','09','04','05','10','06','07','08') &&  Entidade1Query[ EntCategQuery [ CodigoCategoria like '002%'] ])";

// ─── Comunicação com o gateway ───

async function getSupabaseJWT(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sessão do Supabase inválida. Faça login novamente.");
  }
  return session.access_token;
}

async function callGatewayEntidade(path: string, body: unknown): Promise<any> {
  const jwt = await getSupabaseJWT();
  const resp = await fetch(`${ERP_PROXY_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });

  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    // resposta sem body ou inválida
  }

  if (!resp.ok) {
    const msg = data?.error || `HTTP ${resp.status}`;
    const err = new Error(msg) as Error & { status?: number; details?: any };
    err.status = resp.status;
    err.details = data?.details;
    throw err;
  }

  return data;
}

/**
 * Mapa de cidades Alvo: codigoCidade → { nome, uf }.
 * Construído pela Fase 0 do sync, usado para enriquecer entidades novas.
 */
type CidadeMap = Record<string, { nome: string; uf: string }>;

/**
 * Mapeia 1 registro do GetListForComponents para o formato do banco.
 * Aproveita TODOS os campos que vêm sem custo extra (header + Entidade1Object).
 * Se cidadeMap for fornecido, enriquece uf/municipio quando codigo_cidade existe.
 */
function mapEntidadeToRecord(e: any, cidadeMap?: CidadeMap) {
  const ent1 = e.Entidade1Object || {};
  const cidInfo = cidadeMap && e.CodigoCidade ? cidadeMap[e.CodigoCidade] : null;

  return {
    // Identificação
    codigo_entidade: e.Codigo,
    codigo_alternativo: e.CodigoAlternativo,
    cnpj: e.CPFCNPJ,
    nome: e.Nome || e.NomeFantasia || "",
    nome_fantasia: e.NomeFantasia,
    ie: e.RGIE,
    inscricao_municipal: e.InscricaoMunicipal,
    tipo_pessoa: e.Tipo,

    // Endereço
    cep: e.Cep,
    tipo_logradouro: e.CodigoTipoLograd,
    endereco: e.Endereco,
    numero_endereco: e.NumeroEndereco,
    complemento_endereco: e.ComplementoEndereco,
    bairro: e.Bairro,
    codigo_cidade_alvo: e.CodigoCidade,
    uf: cidInfo?.uf || null,
    municipio: cidInfo?.nome || null,

    // Status
    codigo_stat_ent: e.CodigoStatEnt,

    // Datas
    entidade_desde: e.EntidadeDesde || null,
    data_cadastro_alvo: e.DataCadastro || null,
    data_fundacao: e.DataFundacao || null,
    data_situacao_cadastral_federal: ent1.DataSituacaoCadastralFederal || null,

    // Tributário
    optante_simples_federal: e.OptanteSimplesFederal,

    // Bancário
    numero_banco_deposito: e.NumeroBancoDeposito,
    numero_agencia_deposito: e.NumeroAgenciaDeposito,
    numero_conta_deposito: ent1.NumeroContaDeposito,
    tipo_chave_pix: ent1.TipoChavePIX,
    chave_pix: ent1.ChavePIX || null,
    tipo_chave_pix_deposito: ent1.TipoChavePIXDeposito,
    chave_pix_deposito: ent1.ChavePIXDeposito || null,
    codigo_iban: ent1.CodigoIBAN,

    // Flags
    grupo_alvo: ent1.Grupo,
    entidade_motorista: ent1.EntidadeMotorista,
    entidade_transportador: ent1.EntidadeTransportador,
    microempreendedor_individual: ent1.MicroEmpreendedorIndividual,
    possui_penhora_judicial: ent1.PossuiPenhoraJudicial,

    // Auditoria
    updated_at: new Date().toISOString(),
  };
}

/**
 * Busca uma página de entidades via gateway.
 * (O retry de 409 vive no gateway — `callAlvo` reautentica e repete.)
 */
async function fetchPageEntidades(page: number, pageSize: number, filter: string): Promise<any[]> {
  const data = await callGatewayEntidade("/entidade/list", {
    pageIndex: page,
    pageSize,
    filter,
  });
  return Array.isArray(data) ? data : [];
}

/**
 * FASE 0 — Carrega cidades do Alvo APENAS SE houver entidades sem uf/municipio.
 * Detecta o cenário primeiro e só busca o catálogo se for útil.
 * Retorna o mapa codigoCidade → { nome, uf }, ou null se não houver entidades a enriquecer.
 */
async function carregarCidadesSeNecessario(onProgress?: (msg: string) => void): Promise<CidadeMap | null> {
  // Verifica se há entidades sem uf/municipio
  // Só vale carregar o catálogo se houver entidade RESOLÚVEL: tem
  // codigo_cidade_alvo mas está sem uf/municipio. Entidade sem código de
  // cidade no ERP (76 casos em 19/07/2026) nunca será enriquecida — sem este
  // filtro, a Fase 0 baixaria o catálogo inteiro em toda sincronização à toa.
  const { count, error } = await supabase
    .from("compras_entidades_cache")
    .select("codigo_entidade", { count: "exact", head: true })
    .not("codigo_cidade_alvo", "is", null)
    .or("uf.is.null,municipio.is.null");

  if (error) {
    console.warn(`[Cidades] Erro ao verificar entidades sem cidade:`, error.message);
  }

  // Se não há entidades sem cidade, pula
  if (!count || count === 0) {
    onProgress?.("Cidades: nada a enriquecer (todas as entidades já têm UF/município).");
    return null;
  }

  onProgress?.(`Carregando catálogo de cidades do ERP (${count} entidades sem cidade)...`);
  const cidadeMap: CidadeMap = {};
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    let data: any[] = [];
    try {
      data = await callGatewayEntidade("/entidade/cidade-list", {
        pageIndex: page,
        pageSize: PAGE_SIZE,
      });
    } catch (err: any) {
      // Falha aqui NÃO aborta o sync: sem o mapa, a Fase 1 apenas não enriquece
      // uf/municipio (e preserva o que já está no banco, ver regra anti-perda).
      console.warn(`[Cidades] Erro na página ${page}: ${err?.message}. Abortando enriquecimento.`);
      return Object.keys(cidadeMap).length > 0 ? cidadeMap : null;
    }

    if (!Array.isArray(data) || data.length === 0) {
      hasMore = false;
      break;
    }

    data.forEach((c: any) => {
      cidadeMap[c.Codigo] = {
        nome: c.NomeCompleto || c.Nome || "",
        uf: c.SiglaUnidFederacao || "",
      };
    });

    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
      await delay(300);
    }
  }

  onProgress?.(`Cidades carregadas: ${Object.keys(cidadeMap).length} no catálogo.`);
  return cidadeMap;
}

/**
 * FASE 1 — Sync amplo: traz TODAS as entidades (sem filtro) e faz upsert.
 * Regra anti-perda: se NÃO conseguiu resolver a cidade via cidadeMap, remove
 * uf/municipio do payload pra preservar o que já está no banco. Isso vale
 * tanto pra entidades novas quanto pras que já tinham cidade.
 */
async function syncEntidadesAmplo(cidadeMap: CidadeMap | null, onProgress?: (msg: string) => void): Promise<number> {
  let page = 1;
  let totalSaved = 0;
  let totalEnriquecidas = 0;
  let hasMore = true;

  while (hasMore) {
    onProgress?.(`Buscando entidades... página ${page}`);
    const data = await fetchPageEntidades(page, PAGE_SIZE, "");

    if (data.length === 0) {
      hasMore = false;
      break;
    }

    const records = data
      .filter((e: any) => e.Codigo && e.CPFCNPJ)
      .map((e: any) => {
        const record: any = mapEntidadeToRecord(e, cidadeMap || undefined);

        // Regra anti-perda: só grava uf/municipio quando temos certeza que resolveu.
        // Se não conseguiu resolver, remove os campos do payload pra preservar
        // o que já está no banco (não sobrescreve com null).
        if (!record.uf || !record.municipio) {
          delete record.uf;
          delete record.municipio;
        } else {
          totalEnriquecidas++;
        }

        return record;
      });

    if (records.length > 0) {
      const { error } = await supabase
        .from("compras_entidades_cache")
        .upsert(records as any, { onConflict: "codigo_entidade" });

      if (error) console.warn(`[Entidade] Erro upsert page ${page}:`, error.message);
      else totalSaved += records.length;
    }

    onProgress?.(`${totalSaved} entidades sincronizadas (${totalEnriquecidas} c/ cidade resolvida)...`);

    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
      await delay(300);
    }
  }

  return totalSaved;
}

/**
 * FASE 2 — Marca fornecedores: roda com filtro CodigoCategoria=002%
 * e atualiza e_fornecedor=true via RPC SECURITY DEFINER (CORS PATCH).
 */
async function marcarFornecedores(onProgress?: (msg: string) => void): Promise<number> {
  let page = 1;
  const codigosFornecedores: string[] = [];
  let hasMore = true;

  while (hasMore) {
    onProgress?.(`Identificando fornecedores... página ${page}`);
    const data = await fetchPageEntidades(page, PAGE_SIZE, FILTRO_FORNECEDOR);

    if (data.length === 0) {
      hasMore = false;
      break;
    }

    const codigos = data.filter((e: any) => e.Codigo).map((e: any) => e.Codigo as string);
    codigosFornecedores.push(...codigos);
    onProgress?.(`${codigosFornecedores.length} fornecedores identificados...`);

    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      page++;
      await delay(300);
    }
  }

  if (codigosFornecedores.length === 0) return 0;

  const sb = supabase as any;
  const { data: resultado, error } = await sb.rpc("marcar_fornecedores", {
    p_codigos: codigosFornecedores,
  });

  if (error) {
    console.error(`[Fornecedor] Erro RPC marcar_fornecedores:`, error.message);
    return 0;
  }

  console.log(`[Fornecedor] RPC retornou:`, resultado);
  return resultado?.marcados || codigosFornecedores.length;
}

/**
 * Sync principal: roda Fase 0 (cidades, se necessário) + Fase 1 (amplo) + Fase 2 (fornecedores).
 *
 * Não exige credencial do Alvo no navegador — a autenticação acontece no
 * gateway. Qualquer usuário logado no Hub (com permissão na tela que chama)
 * consegue executar.
 */
export async function syncEntidades(onProgress?: (msg: string) => void): Promise<number> {
  // FASE 0 — cidades (só se houver entidades sem uf/municipio)
  onProgress?.("Fase 0/3: verificando cidades...");
  const cidadeMap = await carregarCidadesSeNecessario(onProgress);

  // FASE 1 — sync amplo
  onProgress?.("Fase 1/3: sincronizando entidades...");
  const totalAmplo = await syncEntidadesAmplo(cidadeMap, onProgress);

  // FASE 2 — marcar fornecedores
  onProgress?.("Fase 2/3: marcando fornecedores...");
  const totalFornecedores = await marcarFornecedores(onProgress);

  // Salvar metadata
  await supabase
    .from("compras_config")
    .upsert(
      { chave: "sync_entidades_ts", valor: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "chave" },
    );
  await supabase
    .from("compras_config")
    .upsert(
      { chave: "sync_entidades_count", valor: String(totalAmplo), updated_at: new Date().toISOString() },
      { onConflict: "chave" },
    );
  await supabase
    .from("compras_config")
    .upsert(
      { chave: "sync_fornecedores_count", valor: String(totalFornecedores), updated_at: new Date().toISOString() },
      { onConflict: "chave" },
    );

  onProgress?.(`Concluído: ${totalAmplo} entidades, ${totalFornecedores} fornecedores marcados`);
  return totalAmplo;
}
