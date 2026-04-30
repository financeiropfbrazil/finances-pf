import { authenticateAlvo, clearAlvoToken } from "./alvoService";
import { supabase } from "@/integrations/supabase/client";

const ERP_BASE_URL = "https://pef.it4you.inf.br/api";
const PAGE_SIZE = 500;
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Filtro de fornecedor (mesma regra usada na tela do Alvo)
const FILTRO_FORNECEDOR =
  "( CodigoStatEnt IN ('01','02','11','03','09','04','05','10','06','07','08') &&  Entidade1Query[ EntCategQuery [ CodigoCategoria like '002%'] ])";

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
 * Faz uma chamada paginada ao GetListForComponents com retry de auth (409).
 */
async function fetchPageEntidades(
  page: number,
  pageSize: number,
  filter: string,
  tokenRef: { token: string },
): Promise<any[]> {
  let resp: Response | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    resp = await fetch(`${ERP_BASE_URL}/Entidade/GetListForComponents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "riosoft-token": tokenRef.token,
      },
      body: JSON.stringify({
        FormName: "entidade",
        ClassInput: "Entidade",
        ControllerForm: "entidade",
        TypeObject: "tabForm",
        Filter: filter,
        Input: "gridTableEntidade",
        IsGroupBy: false,
        Order: "Nome ASC",
        PageIndex: page,
        PageSize: pageSize,
        Shortcut: "entidade",
        Type: "GridTable",
      }),
    });

    if (resp && resp.status === 409) {
      clearAlvoToken();
      await delay(1000 * attempt);
      const auth = await authenticateAlvo();
      if (auth.token) tokenRef.token = auth.token;
      continue;
    }
    break;
  }

  if (!resp || !resp.ok) throw new Error(`HTTP ${resp?.status}`);
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

/**
 * FASE 0 — Carrega cidades do Alvo APENAS SE houver entidades sem uf/municipio.
 * Detecta o cenário primeiro e só busca o catálogo se for útil.
 * Retorna o mapa codigoCidade → { nome, uf }, ou null se não houver entidades a enriquecer.
 */
async function carregarCidadesSeNecessario(
  tokenRef: { token: string },
  onProgress?: (msg: string) => void,
): Promise<CidadeMap | null> {
  // Verifica se há entidades sem uf/municipio
  const { count, error } = await supabase
    .from("compras_entidades_cache")
    .select("codigo_entidade", { count: "exact", head: true })
    .or("uf.is.null,municipio.is.null");

  if (error) {
    console.warn(`[Cidades] Erro ao verificar entidades sem cidade:`, error.message);
  }

  // Se não há entidades sem cidade E é a primeira vez (cache vazio também precisa), pula
  if (!count || count === 0) {
    onProgress?.("Cidades: nada a enriquecer (todas as entidades já têm UF/município).");
    return null;
  }

  onProgress?.(`Carregando catálogo de cidades do Alvo (${count} entidades sem cidade)...`);
  const cidadeMap: CidadeMap = {};
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    let resp: Response | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      resp = await fetch(`${ERP_BASE_URL}/Cidade/GetListForComponents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "riosoft-token": tokenRef.token,
        },
        body: JSON.stringify({
          FormName: "cidade",
          ClassInput: "Cidade",
          ControllerForm: "cidade",
          TypeObject: "tabForm",
          Filter: "",
          Input: "gridTableCidade",
          IsGroupBy: false,
          Order: "Codigo ASC",
          PageIndex: page,
          PageSize: PAGE_SIZE,
          Shortcut: "cidade",
          Type: "GridTable",
        }),
      });

      if (resp && resp.status === 409) {
        clearAlvoToken();
        await delay(1000 * attempt);
        const auth = await authenticateAlvo();
        if (auth.token) tokenRef.token = auth.token;
        continue;
      }
      break;
    }

    if (!resp || !resp.ok) {
      console.warn(`[Cidades] Erro HTTP ${resp?.status} na página ${page}, abortando enriquecimento.`);
      return Object.keys(cidadeMap).length > 0 ? cidadeMap : null;
    }

    const data = await resp.json();
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
 * FASE 1 — Sync amplo: traz TODAS as entidades (sem filtro).
 * Faz upsert mapeando todos campos. Usa cidadeMap (se disponível) APENAS para
 * preencher uf/municipio em entidades que ainda não têm — preserva dados existentes.
 */
async function syncEntidadesAmplo(
  tokenRef: { token: string },
  cidadeMap: CidadeMap | null,
  onProgress?: (msg: string) => void,
): Promise<number> {
  // Carrega o set de entidades que JÁ têm uf/municipio populados
  // (para evitar sobrescrever com null/erro caso cidadeMap esteja incompleto)
  const entidadesComCidade = new Set<string>();
  if (cidadeMap) {
    const { data: existentes } = await supabase
      .from("compras_entidades_cache")
      .select("codigo_entidade")
      .not("uf", "is", null)
      .not("municipio", "is", null);
    (existentes || []).forEach((e: any) => entidadesComCidade.add(e.codigo_entidade));
  }

  let page = 1;
  let totalSaved = 0;
  let totalEnriquecidas = 0;
  let hasMore = true;

  while (hasMore) {
    onProgress?.(`Buscando entidades... página ${page}`);
    const data = await fetchPageEntidades(page, PAGE_SIZE, "", tokenRef);

    if (data.length === 0) {
      hasMore = false;
      break;
    }

    const records = data
      .filter((e: any) => e.Codigo && e.CPFCNPJ)
      .map((e: any) => {
        // Só enriquece com cidadeMap se entidade NÃO tinha cidade antes (preserva dados)
        const jaTemCidade = entidadesComCidade.has(e.Codigo);
        const usarCidadeMap = !jaTemCidade && cidadeMap ? cidadeMap : undefined;
        const record = mapEntidadeToRecord(e, usarCidadeMap);

        // Se enriqueceu, conta
        if (!jaTemCidade && record.uf && record.municipio) {
          totalEnriquecidas++;
        }

        // Se já tinha cidade, NUNCA sobrescreve (remove do payload pra preservar)
        if (jaTemCidade) {
          delete (record as any).uf;
          delete (record as any).municipio;
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

    onProgress?.(`${totalSaved} entidades sincronizadas (${totalEnriquecidas} enriquecidas com cidade)...`);

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
async function marcarFornecedores(tokenRef: { token: string }, onProgress?: (msg: string) => void): Promise<number> {
  let page = 1;
  const codigosFornecedores: string[] = [];
  let hasMore = true;

  while (hasMore) {
    onProgress?.(`Identificando fornecedores... página ${page}`);
    const data = await fetchPageEntidades(page, PAGE_SIZE, FILTRO_FORNECEDOR, tokenRef);

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
 */
export async function syncEntidades(onProgress?: (msg: string) => void): Promise<number> {
  clearAlvoToken();
  const auth = await authenticateAlvo();
  if (!auth.token) throw new Error("Falha na autenticação ERP");

  const tokenRef = { token: auth.token };

  // FASE 0 — cidades (só se houver entidades sem uf/municipio)
  onProgress?.("Fase 0/3: verificando cidades...");
  const cidadeMap = await carregarCidadesSeNecessario(tokenRef, onProgress);

  // FASE 1 — sync amplo
  onProgress?.("Fase 1/3: sincronizando entidades...");
  const totalAmplo = await syncEntidadesAmplo(tokenRef, cidadeMap, onProgress);

  // FASE 2 — marcar fornecedores
  onProgress?.("Fase 2/3: marcando fornecedores...");
  const totalFornecedores = await marcarFornecedores(tokenRef, onProgress);

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
